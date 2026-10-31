import {validatePrivateEditorial} from '../contracts/article-internal-notes.mjs';
import {validateSectionId,sectionsForSite,requirePublishSection} from '../contracts/site-sections.mjs';
import {syncSectionCatalog} from './site-section-catalog.mjs';
import {publicationDirectory,siteForWorkspace} from './site-config.mjs';
import {releaseCloudCopy,recoverCloudRelease,archivePrivateEditorial} from './editorial-cloud-release.mjs';
import {exportCloudArticle} from './cloud-article-export.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {isPrivateFile} from './private-file.mjs';
// The CLI and desktop share one version-bound website publishing protocol.
// Credentials remain in this Node process; the renderer receives no token/path.
import {readFile,writeFile,mkdir,rename,rm,stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {workspaceRoot,readDraft,packedDraft,workspaceCall,withWorkspaceLock,sha} from './editorial-workspace.mjs';
import {validateNews} from '../admin/news.mjs';
import {renderArticle} from './article-format.mjs';
import {articleBodyOnPage} from './website-article-readback.mjs';
export {articleBodyOnPage} from './website-article-readback.mjs';
import {localFingerprint,syncItem,atomicJson,importPublished} from './editorial-sync.mjs';
import {recordFields,RECORD_STRUCTURE,structureFor} from './editorial-record.mjs';
import {validate,day} from '../admin/model.mjs';
import {deleteLocalDraft,setDraftCategory,recoverDeletedDraft,discardPulledCopy} from './editorial-management.mjs';
import {draftCategory} from './archive-taxonomy.mjs';
import {cachedRemoteRead,retryAfterMs} from './remote-read-cache.mjs';
import {readWebsiteCatalog,transientReadError} from './website-catalog.mjs';
import {protectMathMarkdown,restoreMathHtml} from './article-math.mjs';
import {enqueuePublished} from './publishing-flow.mjs';
import {kickPublishingFlow} from './publishing-flow-worker.mjs';
import {recordPublicationIntent} from './publishing-flow-recovery.mjs';
import {publicationQueueConfig,publicationQueueClient,cloudPublicationJobId} from './publication-queue-client.mjs';
import {kickPublicationQueue} from './publication-queue-worker.mjs';
import {indexPublicationQueue,queuePublicationBinding,readPublicationQueueIdentity,publicationContinuation,continuationPending,continuationNeedsAttention} from './publication-queue-status.mjs';
import {durableWriteJson} from './durable-json.mjs';
import {saveCloudContinuationArtifact,readCloudContinuationEvidence,assertCloudArtifactSupersessionSettled,CLOUD_CONTINUATION_SITES} from './publishing-flow-artifact.mjs';
import {assertCloudRecoverySettled,restoreOriginalCloudRequest} from './publication-cloud-identity-recovery.mjs';

function validatePayload(input,site){
  const article=validateNews(input,null,site);
  if(input.record){
    if(input.id!=='record-'+input.record.documentId)throw Error('稿件与官网记录绑定不匹配');
    const fields=validate(input.record.kind,{...input.record.fields,...(article.sectionId?{sectionId:article.sectionId}:{}),assets:article.assets},input.record.fields,site);delete fields.assets;
    article.record={...input.record,fields};
  }
  return article;
}

const optional=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const atomic=durableWriteJson;

const pending=r=>r&&(r.job?['queued','running'].includes(r.job.status)||r.job.status==='success'&&!r.publicReadback:(r.status==='submit_intent'));
// One resource link has exactly one record. A new draft for a link that another
// record already owns must update that record instead of creating a duplicate.
export function linkOwner(items,record){
  if(record?.kind!=='openSource'||typeof record.fields?.url!=='string')return null;
  const key='openSource:'+record.fields.url;
  return (items||[]).find(item=>item.key===key&&item.documentId!==record.documentId)||null;
}
// English and later steps run in the cloud only for sites the cloud continues;
// any other site keeps the local owner even when the queue asks for the cloud.
export function continuationOwnerFor(site,queue){
  return queue?.continuationOwner==='cloud'&&CLOUD_CONTINUATION_SITES.includes(site.id)?'cloud':'local';
}
export function publicationStage(packet,receipt){
  if(!receipt||receipt.requestKey!==packet?.requestKey)return packet?'prepared':'local';
  if(receipt.asyncQueue?.phase==='needs_review')return 'failed';
  if(receipt.status==='draft_saved')return 'draft_saved';
  if(receipt.job?.status==='success')return receipt.publicReadback?(receipt.cleanupError?'cleanup':'published'):'verify';
  if(['queued','running','failed'].includes(receipt.job?.status))return receipt.job.status;
  if(receipt.status==='submit_intent')return 'unknown';
  if(receipt.status==='not_submitted')return 'prepared';
  return receipt.status==='rejected'?'rejected':'unknown';
}
export function createWebsitePublisher({root=workspaceRoot,site=siteForWorkspace(root),origin=process.env.SCHOLAY_TODAY_ORIGIN||site.origin,tokenFile=process.env.SCHOLAY_TODAY_TOKEN_FILE||join(publicationDirectory(root) ,'publish-token'),fetcher=fetch,queueKick=kickPublicationQueue}={}){
  if(origin!==site.origin&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Unsupported website origin');
  const metadataOf=data=>({date:data.date||'',summary:data.summary||'',author:data.author||site.author,category:data.category||site.columns[0],...(validateSectionId(data.sectionId,site)?{sectionId:data.sectionId}:{})});
  let verified=false,flowSite=site;
  async function checkPublicationSection(meta){
    if(!site.sectionCatalog&&meta.category!=='未归栏'&&!meta.sectionId)return; // Read compatibility for older publishers.
    requirePublishSection(meta.sectionId,site);
    if(site.sectionCatalog){const catalog=await syncSectionCatalog(root,site,{fetcher,force:true});if(catalog.status!=='ready')throw Error('暂时无法核验线上栏目，请联网后再推送');site={...site,sectionCatalog:catalog};flowSite=site;}
    requirePublishSection(meta.sectionId,site);
  }
  async function continuePublication(data,receipt){
    try{const flow=await enqueuePublished({root,site:flowSite,data,receipt});receipt.publishingFlow=flow;if(flow.status==='queued')await kickPublishingFlow({root,site:flowSite,tokenFile});}
    catch(e){receipt.publishingFlow={status:'deferred',error:e.message};}
  }
  async function handshake(){if(verified||site.legacy)return;const response=await fetcher(origin+'/manage/api/site',{redirect:'error',signal:AbortSignal.timeout(20000)});const descriptor=await response.json();if(!response.ok||descriptor.protocol!=='scholay-content'||descriptor.version!==1||descriptor.siteId!==site.id||descriptor.origin!==site.origin)throw Error('服务器身份或协议版本与当前站点不匹配');if(descriptor.capabilities?.includes('language-editions-v1'))flowSite={...site,languages:['zh-CN','en']};verified=true;}
  const paths=id=>{if(typeof id!=='string'||!/^[a-z0-9][a-z0-9-]{2,99}$/.test(id))throw Error('Invalid article ID');const dir=join(publicationDirectory(root),id);return {id,dir,packet:join(dir,'prepared.json'),receipt:join(dir,'receipt.json'),metadata:join(dir,'metadata.json')};};
  async function connection(localOnly=false){if(localOnly&&process.env.SCHOLAY_DESKTOP_RUNTIME==='1'&&!process.env.SCHOLAY_TODAY_TOKEN)return {configured:false,requiresCheck:true,origin,message:'推送时连接当前站点'};if(process.env.SCHOLAY_TODAY_TOKEN)return {configured:true,origin};if(process.env.SCHOLAY_REQUIRE_VAULT==='1')return {configured:false,origin,message:'请在设置 → 账号与连接中绑定官网凭证。'};try{const s=await stat(tokenFile);return s.size>0&&await isPrivateFile(tokenFile,s)?{configured:true,origin}:{configured:false,origin,message:'官网发布凭证需为非空私有文件。'};}catch{return {configured:false,origin,message:'本机尚未配置官网发布凭证，请按项目维护文档完成绑定。'};}}
  async function api(path,data,signal){
    await handshake();const c=await connection();if(!c.configured)throw Error(c.message);
    const token=process.env.SCHOLAY_TODAY_TOKEN||(await readFile(tokenFile,'utf8')).trim();if(!token)throw Error('官网发布凭证为空。');
    const timeout=AbortSignal.timeout(30000);
    const response=await fetcher(origin+'/manage/api/news'+path,{method:data?'POST':'GET',headers:{'X-Scholay-Site':site.id,'X-Scholay-Protocol':'1',Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout});
    let value;
    try{value=await response.json();}catch(error){if(transientReadError(error))throw error;throw Object.assign(Error('官网返回了非 JSON 响应（HTTP '+response.status+'）'+(response.status===413?'：图文稿件超过服务器上传限额。':'')),{statusCode:response.status,retryAfterMs:retryAfterMs(response)});}
    if(!response.ok)throw Object.assign(Error(value.error||'官网请求失败（'+response.status+'）'),{statusCode:response.status,retryAfterMs:retryAfterMs(response)});return value;
  }
  async function metadata(id,draft){const p=paths(id),local=await optional(p.metadata),registry=await optional(join(root,'_ops/inventory/today-articles.json'));return metadataOf({...{date:draft.batchDate||'',category:draftCategory(draft)},...(local||registry?.[id]||{}),...(draft.sectionId?{sectionId:draft.sectionId}:{})});}
  async function remoteId(id,index){
    const binding=await optional(join(paths(id).dir,'remote-id.json'));
    if(binding){if(binding.origin!==origin||binding.siteId!==site.id)throw Error('稿件云端编号所属站点不匹配');paths(binding.id);return binding.id;}
    const released=(index||await optional(join(root,'_ops/inventory/article-index.json')))?.cloudArticles?.[id];
    const target=released?.cloud?.articleId||id;paths(target);return target;
  }
  async function localIdForPull(id){
    paths(id);const index=await optional(join(root,'_ops/inventory/article-index.json'));
    const entries={...index?.cloudArticles,...index?.articles};
    if(entries[id])return id;
    const aliases=[];
    for(const local of Object.keys(entries))if(await remoteId(local,index)===id)aliases.push(local);
    if(aliases.length>1)throw Error('多个本地稿件绑定同一云端编号，请先核对');
    return aliases[0]||id;
  }
  async function packedPayload(id,pack,meta){
    const record=await optional(join(paths(id).dir,'record.json'));
    return validatePayload({id:await remoteId(id),title:pack.markdown.match(/^# (.+)$/m)?.[1]||pack.draft.shortTitle,markdown:pack.markdown,assets:pack.assets,...meta,...(record?{record:{...record,fields:recordFields(record.kind,record.fields,pack.markdown)}}:{})},site);
  }
  async function locked(id,work,{recovery=false}={}){
    const p=paths(id);
    // Desktop tabs, background queries and CLI calls share this process-owned
    // lock. Brief contention waits for the original operation, never resubmits it.
    return withFileLock(join(p.dir,'operation.lock'),async()=>{if(!recovery)await assertCloudRecoverySettled(p.dir);await assertCloudArtifactSupersessionSettled({root,jobId:(await optional(p.receipt))?.asyncQueue?.jobId});return work(p);},{timeout:90000});
  }
  async function inspect(id){
    paths(id);await recoverCloudRelease(root,id);
    const released=(await optional(join(root,'_ops/inventory/article-index.json')))?.cloudArticles?.[id];
    if(released){const old=await optional(paths(id).receipt),action=await optional(join(paths(id).dir,'cloud-action.json'));const receipt=action?.action==='publish'&&action.publicReadback&&action.version===released.cloud.publishedVersion?{...action,revision:action.version}:old;return {id,title:released.shortTitle,canonicalPath:released.canonicalPath,sourceSha256:released.cloud.sourceSha256,metadata:metadataOf(await optional(paths(id).metadata)||{}),metadataSha256:'',stage:released.cloud.publishedVersion?'published':'draft_saved',localReleased:true,stale:false,validation:'',receipt,prepared:null,html:'',warnings:[]};}
    const draft=await readDraft(id,root),p=paths(id),meta=await metadata(id,draft);
    const [packet,savedReceipt,action,preview]=await Promise.all([optional(p.packet),optional(p.receipt),optional(join(p.dir,'cloud-action.json')),workspaceCall('draft_preview',{id,embedImages:true},root)]);
    const useAction=action?.action==='publish'&&['unknown','queued','running','success'].includes(action.status)&&(!savedReceipt||Date.parse(action.submittedAt)>=Date.parse(savedReceipt.submittedAt));
    const receipt=useAction?{...action,revision:action.version}:savedReceipt;
    const stage=useAction?(action.status==='success'?(action.publicReadback?(action.cleanupError?'cleanup':'published'):'verify'):action.status):publicationStage(packet,receipt);
    let stale=Boolean(packet&&packet.sourceSha256!==draft.sha256),validation='';
    if(packet&&!stale){try{const pack=await packedDraft(id,root);stale=sha(JSON.stringify(await packedPayload(id,pack,meta)))!==sha(JSON.stringify(packet.data));}catch(e){stale=true;validation=e.message;}}
    const catalog=await optional(join(publicationDirectory(root) ,'remote-index.json'));
    const target=await remoteId(id);
    const sync=await syncItem(root,id,catalog?.items.find(x=>x.id===target),Boolean(catalog&&(!catalog.partial||catalog.items.some(x=>x.id===target))),pending(receipt));
    const incoming=await optional(join(p.dir,'incoming.json'));
    return {id,title:draft.shortTitle,canonicalPath:draft.canonicalPath,sourceSha256:draft.sha256,metadata:meta,metadataSha256:sha(JSON.stringify(meta)),stage,stale,validation,receipt,sync,cleanupError:receipt?.cleanupError,
      incoming:incoming?{revision:incoming.revision,html:previewHtml(incoming.data),markdown:incoming.localMarkdown||incoming.data.markdown,metadata:metadataOf(incoming.data)}:null,
      prepared:packet?{requestKey:packet.requestKey,packetSha256:sha(JSON.stringify(packet)),sourceSha256:packet.sourceSha256,preparedAt:packet.preparedAt,intent:packet.intent||'publish',expectedVersion:packet.expectedVersion,title:packet.data.title,metadata:metadataOf(packet.data),assetCount:packet.data.assets.length}:null,
      html:packet?previewHtml(packet.data):preview.html,warnings:packet?[]:preview.warnings||[]};
  }
  function previewHtml(data,notes=false){const sources=new Map(data.assets.map(a=>[a.path,'data:image/'+(a.path.endsWith('.jpg')?'jpeg':a.path.split('.').pop())+';base64,'+a.data]));const prepared=notes?protectMathMarkdown(data.markdown):null;return restoreMathHtml(renderArticle(prepared?.markdown??data.markdown,{imageSources:sources}),prepared?.replacements||[]);}
  async function snapshot(){
    const {articles}=await workspaceCall('draft_list',{},root);
    const catalog=await optional(join(publicationDirectory(root) ,'remote-index.json'));
    const items=await Promise.all(articles.map(async d=>{const p=paths(d.id),packet=await optional(p.packet),saved=await optional(p.receipt),action=await optional(join(p.dir,'cloud-action.json'));const useAction=action?.action==='publish'&&['unknown','queued','running','success'].includes(action.status)&&(!saved||Date.parse(action.submittedAt)>=Date.parse(saved.submittedAt));const receipt=useAction?{...action,revision:action.version}:saved,meta=await metadata(d.id,d),target=await remoteId(d.id);return {...d,...(d.id.startsWith('record-')?{recordKind:structureFor(d.archiveCategory).kind}:{}),metadata:meta,archiveCategory:sectionsForSite(site).find(s=>s.id===meta.sectionId)?.name||meta.category,stage:useAction?(action.status==='success'?(action.publicReadback?(action.cleanupError?'cleanup':'published'):'verify'):action.status):publicationStage(packet,receipt),receipt,preparedAt:packet?.preparedAt||null,...(await optional(join(p.dir,'pull-origin.json'))?{editCopy:true}:{}),sync:await syncItem(root,d.id,catalog?.items.find(x=>x.id===target),Boolean(catalog&&(!catalog.partial||catalog.items.some(x=>x.id===target))),pending(receipt))};}));
    return {connection:await connection(true),checkedAt:catalog?.checkedAt||null,articles:items.reverse()};
  }
  async function refresh(){const started=Date.now();return withFileLock(join(publicationDirectory(root) ,'refresh.lock'),async()=>{const cached=await optional(join(publicationDirectory(root) ,'remote-index.json'));return !cached?.partial&&Date.parse(cached?.fetchedAt)>=started?snapshot():refreshIndex();},{timeout:115000});}
  async function refreshIndex(){
    const started=Date.now();const items=[];let after=0,generation;
    do{
      const result=await api('/index?after='+after+(generation===undefined?'':'&generation='+generation));
      if(!Array.isArray(result.items)||result.items.length>100||result.items.some(x=>typeof x.id!=='string'||!Number.isSafeInteger(x.version)||!(x.publishedVersion==null||Number.isSafeInteger(x.publishedVersion))))throw Error('官网版本目录不完整，仍保留上次缓存。');
      if(generation!==undefined&&generation!==result.generation)throw Error('官网版本在分页期间变化，请重新刷新');generation=result.generation;
      items.push(...result.items);if(result.next==null)break;
      if(!Number.isSafeInteger(result.next)||result.next<=after||items.length>30000)throw Error('官网版本分页无效');after=result.next;
    }while(true);
    const indexFile=join(publicationDirectory(root) ,'remote-index.json');await withFileLock(indexFile+'.lock',async()=>{const recent=await optional(indexFile);if(Date.parse(recent?.checkedAt)>started){for(const item of recent.items){const i=items.findIndex(x=>x.id===item.id);if(i<0)items.push(item);else if(item.version>=items[i].version)items[i]=item;}}await atomicJson(indexFile,{items,checkedAt:new Date().toISOString(),fetchedAt:new Date().toISOString()});});
    // Upgrade only proven historical receipts. Merely having the same title or
    // article ID never establishes a synchronization baseline.
    const {articles}=await workspaceCall('draft_list',{},root);
    for(const draft of articles){
      const p=paths(draft.id),receipt=await optional(p.receipt),packet=await optional(p.packet);
      if(await optional(join(p.dir,'sync.json'))||!receipt?.publicReadback||receipt.job?.status!=='success'||receipt.requestKey!==packet?.requestKey||!Number.isSafeInteger(receipt.revision))continue;
      await locked(draft.id,async()=>{
        if(await optional(join(p.dir,'sync.json')))return;
        let fingerprint=packet.localFingerprint||'legacy-published-base';
        if(!packet.localFingerprint&&draft.sha256===packet.sourceSha256){
          try{
            const before=await localFingerprint(root,draft.id),meta=await metadata(draft.id,draft);
            const pack=await packedDraft(draft.id,root);
            if(sha(JSON.stringify(await packedPayload(draft.id,pack,meta)))===sha(JSON.stringify(packet.data))&&before===await localFingerprint(root,draft.id))fingerprint=before;
          }catch{/* Incomplete local files remain dirty, never silently synced. */}
        }
        await atomicJson(join(p.dir,'sync.json'),{remoteId:packet.data.id,revision:receipt.revision,cloudRevision:receipt.revision,publishedRevision:receipt.revision,fingerprint,at:receipt.checkedAt,origin:'receipt',requestKey:receipt.requestKey});
      });
    }
    return snapshot();
  }
  async function catalog({all=false,cache=false,refresh=false}={}){
    if(!cache)return readWebsiteCatalog({api,all});
    const file=join(publicationDirectory(root),'catalog-'+(all?'all':'published')+'.json'),epoch=await optional(join(publicationDirectory(root),'read-cache-epoch.json'));
    const identity=JSON.stringify([site.id,origin,all,epoch?.value]);
    return cachedRemoteRead({file,identity,force:!!refresh,minInterval:refresh==='changed'?0:30000,allowStale:refresh!=='changed',seed:async()=>{
      // An invalidated catalog remains useful for display while refreshing;
      // only the same site's previous complete snapshot can seed a fallback.
      const old=await optional(file);let sameSite=false;try{sameSite=JSON.stringify(JSON.parse(old?.identity).slice(0,3))===JSON.stringify([site.id,origin,all]);}catch{}
      if(sameSite&&!old.denied&&old.value&&!old.value.partial)return old.value;
      if(old||!all)return null;
      const prior=await optional(join(root,'.local/publication-center/website.json'));
      return prior?.version===2&&prior.scope==='all'&&!prior.partial&&Array.isArray(prior.items)&&prior.items.every(x=>{try{return new URL(x.url).origin===origin;}catch{return false;}})?prior:null;
    },load:async()=>{const value=await readWebsiteCatalog({api,all,file:file+'.progress',identity});return {value:all?await withEnglish(value):value};}});
  }
  // English editions are separate documents whose route names the Chinese
  // source. Each published Chinese news item records whether its English page
  // is live, still being produced, or missing. A failed English read leaves the
  // state unknown; it never reports a gap it has not seen.
  async function withEnglish(value){
    if(!value?.items?.length||value.partial)return value;
    let editions;try{editions=await readWebsiteCatalog({api,all:true,locale:'en'});}catch{return value;}
    const live=new Set(),produced=new Set();
    for(const x of editions.items){let id;try{id=new URL(x.url).pathname.match(/^\/en\/news\/([^/]+)\/$/)?.[1];}catch{}if(id)(x.publicationState==='published'?live:produced).add(id);}
    const items=await Promise.all(value.items.map(async x=>{
      if(x.kind!=='news'||x.publicationState!=='published'||!x.articleId)return x;
      if(live.has(x.articleId))return {...x,english:'live'};
      let receipt=null;try{receipt=await optional(paths(x.articleId).receipt);}catch{/* an unknown local ID has no receipt here */}
      const flow=receipt?.asyncQueue?.continuation||receipt?.publishingFlow;
      return {...x,english:produced.has(x.articleId)||continuationPending(flow)?'pending':'missing'};
    }));
    return {...value,items};
  }
  async function cacheRemote(id,remote){
    const file=join(publicationDirectory(root) ,'remote-index.json');
    return withFileLock(file+'.lock',async()=>{const value=await optional(file)||{items:[],partial:true};const prior=value.items.find(x=>x.id===id);value.items=value.items.filter(x=>x.id!==id);value.items.push({id,version:remote.version,publishedVersion:remote.publishedVersion});value.checkedAt=new Date().toISOString();await atomicJson(file,value);if(!prior||prior.version!==remote.version||prior.publishedVersion!==remote.publishedVersion)await atomicJson(join(publicationDirectory(root),'read-cache-epoch.json'),{value:randomUUID()});});
  }

  async function pull(id,params={}){const localId=await localIdForPull(id);return locked(localId,async p=>{
    const receipt=await optional(p.receipt),action=await optional(join(p.dir,'cloud-action.json'));
    if(pending(receipt)||action&&['unknown','queued','running'].includes(action.status))throw Error('作品有未完成的发布操作，请先查询结果再取回');
    const scope=params.source==='cloud'?'cloud':'published';
    const target=await remoteId(localId),bundle=await api('/'+scope+'/'+target);bundle.data=validatePayload(bundle.data,site);
    bundle.scope=scope;if(scope==='cloud')bundle.revision=bundle.version;else bundle.publishedVersion=bundle.revision;
    if(bundle.data.id!==target)throw Error('官网稿件编号不匹配');
    // A fresh checkout may have only the archived pointer. Preserve its cloud
    // identity before the pull replaces that pointer with a local manuscript.
    if(target!==localId&&!await optional(join(p.dir,'remote-id.json')))await atomicJson(join(p.dir,'remote-id.json'),{id:target,previousId:localId,siteId:site.id,origin,reason:'cloud-pointer',createdAt:new Date().toISOString()});
    const index=await optional(join(root,'_ops/inventory/article-index.json')),pointer=await optional(join(p.dir,'private-archive.json'))||index?.cloudArticles?.[localId]?.cloud;
    if(pointer?.privateNotesPath){
      const archive=await api('/source-archives/'+pointer.archiveId);
      if(archive.archiveSha256!==pointer.archiveSha256||sha(JSON.stringify(archive.bundle))!==pointer.archiveSha256||archive.bundle?.articleId!==target)throw Error('内部备注归档校验失败，未取回');
      const file=archive.bundle.files?.find(f=>f.path===pointer.privateNotesPath);
      if(!file||sha(Buffer.from(file.data,'base64'))!==file.sha256)throw Error('内部备注归档文件缺失或已损坏');
      bundle.privateEditorial=validatePrivateEditorial(JSON.parse(Buffer.from(file.data,'base64').toString('utf8')));
    }else{
      // Pushed from another machine: this Mac has no pointer, so ask the site.
      // A transient failure stops the pull rather than dropping the notes.
      let found;try{found=await remotePrivateNotes(target,bundle.version);}catch(error){throw Error('作者备注暂时无法取回，请稍后再编辑：'+error.message);}
      if(found?.privateEditorial)bundle.privateEditorial=found.privateEditorial;
    }
    const result=await importPublished(root,bundle,{...params,localId});await cacheRemote(target,{version:bundle.version,publishedVersion:bundle.publishedVersion});return result;
  });}
  // The site's newest author notes at or below a version, written by any
  // machine. An older server without the lookup answers as unsupported.
  async function remotePrivateNotes(target,revision){
    let result;
    try{result=await api('/source-archives/private-notes/'+target+(revision?'?revision='+revision:''));}
    catch(error){if(error.statusCode===404&&!/云端作品不存在/.test(error.message))return {unsupported:true,revision:null,privateEditorial:null};throw error;}
    if(result.articleId!==target)throw Error('作者备注所属作品不匹配');
    return {revision:result.revision??null,privateEditorial:result.privateEditorial?validatePrivateEditorial(result.privateEditorial):null};
  }
  // Notes for a work. A local manuscript uses its own file. A cloud-only work
  // asks the site, which also covers other machines, and falls back to the
  // file this Mac kept when it released the article. Nothing is written to
  // internal-notes.json, so viewing never changes a manuscript.
  async function privateNotes(id,{revision}={}){
    const p=paths(id),index=await optional(join(root,'_ops/inventory/article-index.json'));
    const local=await optional(join(p.dir,'internal-notes.json'));
    const retained=local?{source:'local',revision:null,privateEditorial:validatePrivateEditorial(local)}:null;
    if(index?.articles?.[id])return retained||{source:'local',revision:null,privateEditorial:null};
    const target=await remoteId(id,index);
    let remote;
    try{remote=await cachedRemoteRead({file:join(p.dir,'read-private-notes.json'),identity:JSON.stringify([site.id,origin,target,revision??null]),minInterval:30000,load:async()=>({value:await remotePrivateNotes(target,revision)})});}
    catch(error){if(retained)return retained;throw error;}
    if(remote.privateEditorial)return {source:'cloud',revision:remote.revision,privateEditorial:remote.privateEditorial};
    return retained||{source:remote.unsupported?'unsupported':'cloud',revision:null,privateEditorial:null};
  }
  async function detailCache(id,scope,load){
    const p=paths(id),index=await optional(join(publicationDirectory(root),'remote-index.json')),item=index?.items.find(x=>x.id===id);
    const revision=item?(scope==='cloud'?[item.version,item.publishedVersion]:item.publishedVersion):index&&!index.partial?'absent':'unknown';
    return cachedRemoteRead({file:join(p.dir,'read-'+scope+'.json'),identity:JSON.stringify([site.id,origin,id,scope,revision]),load:async()=>({value:await load()})});
  }
  async function published(id,{cache=false,notes=false}={}){
    paths(id);const load=async()=>{const bundle=await api('/published/'+id);bundle.data=validatePayload(bundle.data,site);if(bundle.data.id!==id)throw Error('官网记录编号不匹配');return bundle;};
    const bundle=cache?await detailCache(id,'published',load):await load(),data=bundle.data;
    if(data.id!==id)throw Error('官网记录编号不匹配');
    return {id,revision:bundle.revision,title:data.title,metadata:metadataOf(data),html:previewHtml(data,notes),url:origin+bundle.url,kind:data.record?.kind||'news',structure:structureFor(RECORD_STRUCTURE[data.record?.kind]?.category||metadataOf(data).category,data.record?.kind||null)};
  }
  async function cloud(id,{cache=false,notes=false}={}){
    paths(id);const load=async()=>{const bundle=await api('/cloud/'+id);bundle.data=validatePayload(bundle.data,site);if(bundle.data.id!==id)throw Error('云端记录编号不匹配');return bundle;};
    const bundle=cache?await detailCache(id,'cloud',load):await load(),data=bundle.data;
    if(data.id!==id)throw Error('云端记录编号不匹配');
    return {id,revision:bundle.version,version:bundle.version,publishedVersion:bundle.publishedVersion,title:data.title,metadata:metadataOf(data),html:previewHtml(data,notes),url:origin+bundle.url,kind:data.record?.kind||'news',notes};
  }
  async function exportCloud(id,{directory}={}){
    paths(id);
    const bundle=await api('/cloud/'+id);
    bundle.data=validatePayload(bundle.data,site);
    if(bundle.data.id!==id)throw Error('云端记录编号不匹配');
    return exportCloudArticle({root,directory,origin,bundle});
  }
  async function cloudAction(id,params){return locked(id,async p=>{
    if(params.confirmed!==true)throw Error('请明确确认云端操作');
    const file=join(p.dir,'cloud-action.json'),old=await optional(file);
    if(old&&['unknown','queued','running'].includes(old.status||old.job?.status))throw Error('上次云端操作结果未确定，请先查询原任务');
    const request={articleId:id,action:params.action,expectedVersion:params.expectedVersion,expectedPublishedVersion:params.expectedPublishedVersion,confirmed:true,requestKey:randomUUID()};
    const intent={...request,status:'unknown',submittedAt:new Date().toISOString()};await atomic(file,intent);
    try{const result=await api('/actions',request);const saved={...intent,...result};await atomic(file,saved);return settleAction(id,p,saved);}
    catch(e){if(e.statusCode&&e.statusCode<500)await atomic(file,{...intent,status:'rejected',error:e.message});throw e;}
  });}
  async function cloudActionStatus(id){return locked(id,async p=>{
    const file=join(p.dir,'cloud-action.json'),old=await optional(file);if(!old)return null;
    try{const result=await api('/actions/'+old.requestKey);const saved={...old,...result};await atomic(file,saved);return settleAction(id,p,saved);}
    catch(e){if(e.statusCode===404){const result={...old,status:'not_submitted'};await atomic(file,result);return result;}throw e;}
  });}
  async function publicReadback(id,revision,data,url){
    const remote=await api('/'+id);
    if(remote.publishedVersion!==revision||sha(JSON.stringify(validatePayload(remote.published,site)))!==sha(JSON.stringify(data)))throw Error('官网当前公开版本或正文与本次任务不同，请核对');
    if(url!==(data.record?remote.url:'/news/'+id+'/'))throw Error('官网返回了不匹配的文章地址');
    const response=await fetcher(origin+url,{redirect:'error',signal:AbortSignal.timeout(30000)}),html=await response.text();
    if(!response.ok||!html.includes('<link rel="canonical" href="'+origin+url+'">')||(!data.record&&!articleBodyOnPage(html,data.markdown,site)))throw Error('公开页面尚未与本次正文一致，请稍后重新核验');
    await cacheRemote(id,remote);return remote;
  }
  async function taskOwns(id){
    const base=join(root,'.local/workbench/tasks');
    for(const name of await readdir(base).catch(()=>[])){const task=await optional(join(base,name,'task.json')).catch(()=>null);if(task?.articleId===id&&!task.completedAt&&!task.stoppedAt&&task.workflow?.authorized)return true;}
    return false;
  }
  async function settleAction(id,p,action,force=false){
    if(action.status!=='success')return {...action,stage:action.status};
    const file=join(p.dir,'cloud-action.json');
    if(action.action==='publish'){
      action.publicReadback=false;
      try{
        const remote=await api('/cloud/'+id),data=validatePayload(remote.data,site);
        if(action.version!==action.expectedVersion||remote.version!==action.version)throw Error('云端版本已变化，保留本地工作副本');
        await publicReadback(id,action.version,data,action.url);action.publicReadback=true;delete action.readbackError;
        const continued={...action,revision:action.version,job:{status:'success'}};await continuePublication(data,continued);if(continued.publishingFlow)action.publishingFlow=continued.publishingFlow;
        const index=await optional(join(root,'_ops/inventory/article-index.json'));
        if(index?.articles?.[id]&&(force||!await taskOwns(id))){
          let proof=await optional(join(p.dir,'release-proof.json'));
          if(!proof||proof.requestKey!==action.requestKey){
            const draft=await readDraft(id,root),fingerprint=await localFingerprint(root,id),pack=await packedDraft(id,root);
            if(sha(JSON.stringify(await packedPayload(id,pack,await metadata(id,draft))))!==sha(JSON.stringify(data)))throw Error('本地已有新的修改，保留工作副本');
            if(await localFingerprint(root,id)!==fingerprint)throw Error('稿件在核验时发生变化，保留本地副本');
            proof={requestKey:action.requestKey,data,sourceSha256:draft.sha256,localFingerprint:fingerprint,proofType:'content-action',preparedAt:new Date().toISOString()};
            await atomic(join(p.dir,'release-proof.json'),proof);
          }
          if(!site.retainLocal){await releaseCloudCopy({root,id,packet:proof,receipt:{...action,revision:action.version},api});action.localReleased=true;}delete action.cleanupError;delete action.awaitingDelivery;
        }else if(index?.cloudArticles?.[id]){await recoverCloudRelease(root,id);action.localReleased=true;delete action.cleanupError;delete action.awaitingDelivery;}else if(index?.articles?.[id]){action.awaitingDelivery=true;}
      }catch(e){if(action.publicReadback)action.cleanupError=e.message;else action.readbackError=e.message;}
    }else if(action.action==='withdraw'){
      try{const remote=await api('/'+id);if(remote.publishedVersion!==null)throw Error('官网仍有公开版本，请稍后重新核验撤回');const response=await fetcher(origin+action.url,{redirect:'error',signal:AbortSignal.timeout(30000)});if(response.status!==404&&response.status!==410)throw Error('公开页面尚未撤回，请稍后重新核验');action.withdrawnReadback=true;delete action.readbackError;await cacheRemote(id,remote);}catch(e){action.readbackError=e.message;}
    }
    action.stage=action.action==='publish'?(!action.publicReadback?'verify':action.cleanupError?'cleanup':'published'):action.status;
    action.checkedAt=new Date().toISOString();await atomic(file,action);return action;
  }
  // Reconcile only durable requests. This can query/verify/retire, never submit.
  // A local file lock coalesces callers from hidden tabs, focus and refresh.
  async function reconcile(){
    return withFileLock(join(publicationDirectory(root) ,'reconcile.lock'),async()=>{
      const results=[];let changed=false;
      for(const id of await readdir(join(publicationDirectory(root))).catch(()=>[])){
        if(!/^[a-z0-9][a-z0-9-]{2,99}$/.test(id))continue;
        const p=paths(id),receipt=await optional(p.receipt).catch(()=>null),action=await optional(join(p.dir,'cloud-action.json')).catch(()=>null),packet=await optional(p.packet).catch(()=>null);
        const index=await optional(join(root,'_ops/inventory/article-index.json'));
        const actionPending=action&&(['unknown','queued','running'].includes(action.status)||action.status==='success'&&(action.action==='publish'&&(!action.publicReadback||index?.articles?.[id]&&!action.localReleased)||action.action==='withdraw'&&!action.withdrawnReadback));
        const receiptPending=receipt&&(pending(receipt)||packet?.releaseLocal&&receipt.publicReadback&&index?.articles?.[id]);
        if(!actionPending&&!receiptPending)continue;
        const prior=actionPending?action:receipt;
        if(prior.cleanupError&&Date.now()-Date.parse(prior.checkedAt)<30000)continue;
        try{
          const value=actionPending?await cloudActionStatus(id):await status(id);
          const next=actionPending?await optional(join(p.dir,'cloud-action.json')):await optional(p.receipt);
          const state=x=>JSON.stringify([x?.status,x?.job?.status,x?.publicReadback,x?.withdrawnReadback,x?.localReleased,x?.cleanupError,x?.readbackError]);
          if(state(prior)!==state(next)||value.localReleased)changed=true;
          results.push({id,stage:value.stage||next?.status,localReleased:!!value.localReleased,cleanupError:value.cleanupError});
        }catch(e){results.push({id,error:e.message});}
      }
      return {changed,results};
    },{timeout:1000});
  }
  async function cloudActionCached(id){return optional(join(paths(id).dir,'cloud-action.json'));}
  async function localAction(id,params){return locked(id,async p=>{
    const receipt=await optional(p.receipt),action=await optional(join(p.dir,'cloud-action.json'));
    if(pending(receipt)||action&&['unknown','queued','running'].includes(action.status))throw Error('作品有未完成的发布操作，请先查询结果');
    if(params.action==='recover_deleted'){
      try{await api('/'+id);}catch(error){if(error.statusCode===410)return recoverDeletedDraft(root,{...params,id});throw error;}
      throw Error('云端记录没有删除，请直接推送更新');
    }
    if(params.action==='metadata'){
      const draft=await readDraft(id,root),before=await metadata(id,draft),input=params.metadata;
      if(params.expectedSourceSha256!==draft.sha256)throw Error('正文已变化，请重新载入后保存');
      if(params.expectedMetadataSha256!==sha(JSON.stringify(before)))throw Error('发布信息已变化，请重新载入后保存');
      if(!input||typeof input!=='object'||Array.isArray(input))throw Error('稿件信息须为对象');
      for(const [key,max] of [['date',10],['summary',4000],['author',100],['category',80]])if(typeof input[key]!=='string'||input[key].length>max)throw Error('稿件信息字段格式无效：'+key);
      if(input.date)day(input.date);
      const next=metadataOf(input);if(next.sectionId){requirePublishSection(next.sectionId,site);next.category=sectionsForSite(site).find(s=>s.id===next.sectionId).name;}else if(Object.hasOwn(input,'sectionId'))next.category='未归栏';
      await withWorkspaceLock(root,async()=>{const current=await readDraft(id,root);if(current.sha256!==draft.sha256||sha(JSON.stringify(await metadata(id,current)))!==params.expectedMetadataSha256)throw Error('稿件或栏目已变化，请重新载入后保存');const file=join(root,'_ops/inventory/article-index.json'),index=await optional(file);if(Object.hasOwn(input,'sectionId')){if(next.sectionId)index.articles[id].sectionId=next.sectionId;else delete index.articles[id].sectionId;if(!current.id.startsWith('record-'))index.articles[id].archiveCategory=next.category;}await atomic(p.metadata,next);if(Object.hasOwn(input,'sectionId'))await atomic(file,index);});
      return inspect(id);
    }
    return params.action==='delete'?deleteLocalDraft(root,{...params,id}):params.action==='discard_pull'?discardPulledCopy(root,{...params,id}):params.action==='category'?setDraftCategory(root,{...params,id}):Promise.reject(Error('本地操作无效'));
  });}
  async function acceptMerge(id,{revision,expectedFingerprint}={}){return locked(id,async p=>{
    const incoming=await optional(join(p.dir,'incoming.json'));if(!incoming||incoming.revision!==revision)throw Error('对照版本已变化，请重新取回');
    const target=await remoteId(id),remote=await api('/'+target);if(remote.version!==revision)throw Error('官网又有更新，请重新比较');
    if(await localFingerprint(root,id)!==expectedFingerprint)throw Error('本地内容已变化，请重新检查合并结果');
    // An explicit merge acknowledges the remote base while keeping the local
    // result dirty until it is separately previewed and published.
    await atomicJson(join(p.dir,'sync.json'),{remoteId:target,revision,cloudRevision:revision,publishedRevision:remote.publishedVersion,fingerprint:'merged-pending-publication',at:new Date().toISOString(),origin:'merge'});
    await rm(join(p.dir,'incoming.json'),{force:true});await cacheRemote(target,remote);return inspect(id);
  });}
  async function prepare(id,params={}){return locked(id,async p=>{
    const previous=await optional(p.receipt);if(pending(previous))throw Error('上次推送尚未确认结果，请先查询原任务。不要重新生成请求。');
    const intent=params.intent==='draft'?'draft':'publish';
    const draft=await readDraft(id,root),before=await metadata(id,draft);
    if(params.expectedSourceSha256&&params.expectedSourceSha256!==draft.sha256)throw Error('稿件已被其他编辑器更新，请重新载入后预览。');
    if(params.expectedMetadataSha256&&params.expectedMetadataSha256!==sha(JSON.stringify(before)))throw Error('发布信息已变化，请重新载入后编辑。');
    const meta=metadataOf(params.metadata||before);await checkPublicationSection(meta);const frozenFingerprint=await localFingerprint(root,id,meta);
    const pack=await packedDraft(id,root);
    // The server enforces this too; checking the cached catalog first gives the
    // producer a clear answer before any preview is frozen. An unreadable
    // catalog never blocks a push on its own.
    const recordBinding=await optional(join(p.dir,'record.json'));
    if(recordBinding?.kind==='openSource'){
      const owner=linkOwner((await catalog({all:true,cache:true}).catch(()=>null))?.items,recordBinding);
      if(owner)throw Object.assign(Error('该资源链接已有记录「'+owner.title+'」（'+owner.articleId+'）。请取回该记录再更新，不要新建。'),{code:'duplicate_source',existing:{articleId:owner.articleId,documentId:owner.documentId}});
    }
    let target=await remoteId(id),remote;
    try{remote=await api('/'+target);}catch(error){
      if(error.statusCode!==410||target!==id)throw error;
      if(await optional(join(p.dir,'record.json')))throw Error('该结构化记录已在云端删除，请先恢复对应记录');
      // A tombstone is immutable. Keep the local manuscript and receipts intact,
      // but bind this explicit new push to one durable, fresh cloud identity.
      target='draft-'+randomUUID();
      await atomicJson(join(p.dir,'remote-id.json'),{id:target,previousId:id,siteId:site.id,origin,reason:'deleted',createdAt:new Date().toISOString()});
      remote=await api('/'+target);
    }
    const data=await packedPayload(id,pack,meta);
    await cacheRemote(target,remote);
    // A newer admin draft is not implicitly approved by a desktop upload.
    const previousPacket=await optional(p.packet);
    const ownFailedRevision=previous?.job?.status==='failed'&&previous.revision===remote.version&&previousPacket?.requestKey===previous.requestKey&&sha(JSON.stringify(remote.data))===sha(JSON.stringify(previousPacket.data));
    let base=await optional(join(p.dir,'sync.json'));
    if(target!==id&&base?.remoteId!==target)base=null;
    const acknowledged=base?.cloudRevision===remote.version;
    if(remote.version>0&&remote.publishedVersion!==remote.version&&!ownFailedRevision&&!acknowledged)throw Error('官网后台有尚未公开的版本，请先取回云端草稿并核对。');
    if(base?.cloudRevision!==undefined&&base.cloudRevision!==remote.version&&!ownFailedRevision)throw Error('云端存在未合并的新版，请先取回比较。');
    if(!base&&remote.publishedVersion&&previous?.publicReadback&&previous.revision===remote.publishedVersion&&previousPacket){
      // Preserve the historical receipt's base, even when the current draft
      // is dirty. The old packet remains the evidence for that publication.
      base={revision:previous.revision,fingerprint:previousPacket.localFingerprint||'legacy-published-base',at:previous.checkedAt,origin:'receipt'};
      await atomicJson(join(p.dir,'sync.json'),base);
    }
    if(remote.publishedVersion&&!acknowledged&&(!base||base.revision!==remote.publishedVersion))throw Error('官网存在未合并的已发布版本。请先取回官网版本并比较，再生成发布预览。');
    if(base&&!remote.publishedVersion&&!ownFailedRevision&&!acknowledged)throw Error('官网文章已撤下，请先核对官网状态，不能自动重新公开。');
    if((await readDraft(id,root)).sha256!==pack.draft.sha256)throw Error('稿件在生成预览时发生变化，请重新预览。');
    if(await localFingerprint(root,id,meta)!==frozenFingerprint||sha(JSON.stringify(await metadata(id,draft)))!==sha(JSON.stringify(before)))throw Error('正文、图片或发布信息在预览时变化，请重新预览');
    const packet={...(!site.legacy?{siteId:site.id,spaceId:site.spaceId,origin}:{}),data,intent,releaseLocal:params.releaseLocal===true,expectedVersion:remote.version,expectedPublishedVersion:remote.publishedVersion??null,requestKey:randomUUID(),sourceSha256:pack.draft.sha256,localFingerprint:frozenFingerprint,preparedAt:new Date().toISOString()};
    if(previous)await atomic(join(p.dir,'receipt-'+previous.requestKey+'.json'),previous);
    await atomic(p.metadata,meta);await atomic(p.packet,packet);
    await writeFile(join(p.dir,'preview.html'),'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>官网发布预览</title><style>body{max-width:740px;margin:40px auto;padding:0 22px;font:17px/1.9 system-ui}img{max-width:100%;height:auto}pre{overflow:auto}</style>'+previewHtml(data),{mode:0o600});
    return inspect(id);
  });}
  async function publish(id,{packetSha256,retry=false,intent='publish',background=false}={}){return locked(id,async p=>{
    const packet=await optional(p.packet);if(!packet)throw Error('请先生成官网发布预览。');
    if(!site.legacy&&(packet.siteId!==site.id||packet.origin!==origin))throw Error('发布预览所属站点已变化，请重新预览');
    if((packet.intent||'publish')!==intent)throw Error('预览用途不匹配，请重新生成对应的云端草稿或公开预览。');
    if(packetSha256!==sha(JSON.stringify(packet)))throw Error('预览版本已变化，请重新查看后确认推送。');
    const old=await optional(p.receipt);
    if(old?.requestKey===packet.requestKey){
      if(old.asyncQueue&&old.asyncQueue.packetSha256===packetSha256){
        await indexPublicationQueue(root,site,id,packet.data.title);
        if(old.asyncQueue.owner==='local'&&old.asyncQueue.phase==='queued')try{await queueKick({root,site,tokenFile,id});}catch{}
        return inspect(id);
      }
      if(old.job||old.status==='rejected')throw Error('该请求已有回执，请先查询结果；需要修订时重新生成预览。');
      if(!retry&&old.status!=='not_submitted')throw Error('上次提交结果尚未确认，请先查询原请求。');
    }
    const pack=await packedDraft(id,root),meta=await metadata(id,pack.draft);
    if(packet.sourceSha256!==pack.draft.sha256)throw Error('正文已在预览后修改，请重新生成预览。');
    const current=await packedPayload(id,pack,meta);
    if(sha(JSON.stringify(current))!==sha(JSON.stringify(packet.data)))throw Error('发布信息或图片已在预览后修改，请重新生成预览。');
    await checkPublicationSection(meta);
    const queue=await publicationQueueConfig(root);
    if(background||queue){
      const receipt={intent,status:'local_queued',requestKey:packet.requestKey,sourceSha256:packet.sourceSha256,submittedAt:new Date().toISOString(),job:{id:packet.requestKey,status:'queued'},asyncQueue:{version:1,owner:'local',phase:'queued',...(queue?{endpoint:queue.endpoint,continuationOwner:continuationOwnerFor(site,queue)}:{}),packetSha256:sha(JSON.stringify(packet)),updatedAt:new Date().toISOString(),attempts:0}};
      receipt.asyncQueue.binding=queuePublicationBinding(site,packet,receipt);
      await atomic(p.receipt,receipt);
      await indexPublicationQueue(root,site,id,packet.data.title);
      try{await queueKick({root,site,tokenFile,id});}catch(error){receipt.asyncQueue.error=error.message;await atomic(p.receipt,receipt);}
      return inspect(id);
    }
    const submission={intent,status:'submit_intent',requestKey:packet.requestKey,sourceSha256:packet.sourceSha256,submittedAt:new Date().toISOString()};
    await atomic(p.receipt,submission);
    // Register before the first write; optional continuation cannot block Chinese.
    try{await recordPublicationIntent({root,site:flowSite,articleId:id,packet,submittedAt:submission.submittedAt});await kickPublishingFlow({root,site:flowSite,tokenFile});}catch{}
    try{const receipt=await api(intent==='draft'?'/drafts':'/publish',packet);await atomic(p.receipt,{...submission,...receipt,status:intent==='draft'?'draft_saved':'submitted'});if(intent==='draft')await acknowledgeDraft(p,packet,receipt);}
    catch(e){if([400,401,403,409,413].includes(e.statusCode))await atomic(p.receipt,{...submission,status:'rejected',error:e.message});throw e;}
    return finish(id,p);
  });}
  async function finish(id,p,force=false){
    let result=await inspect(id);if(result.localReleased)return result;
    const packet=await optional(p.packet),receipt=await optional(p.receipt);
    if(!['draft_saved','published','cleanup'].includes(result.stage))return result;
    try{await archivePrivateEditorial({root,id,packet,receipt,api});if(receipt.cleanupError?.startsWith('内部备注未归档：')){delete receipt.cleanupError;await atomic(p.receipt,receipt);result=await inspect(id);}}
    catch(e){receipt.cleanupError='内部备注未归档：'+e.message;await atomic(p.receipt,receipt);return {...result,receipt,cleanupError:receipt.cleanupError};}
    if(!(force||packet?.releaseLocal))return result;
    if(receipt.asyncQueue&&receipt.publicReadback&&receipt.asyncQueue.continuationOwner!=='cloud'){
      const continuation=await publicationContinuation(root,receipt);
      // A failed handoff still needs the frozen local source. Once its plan is
      // durable, the existing flow owns a separate immutable source snapshot.
      if(!continuation||continuation.status==='deferred'||continuationPending(continuation)&&!(/^[a-f0-9]{40}$/.test(continuation.id||'')&&await optional(join(root,'.local/publishing-flow/jobs',continuation.id,'plan.json'))))return result;
    }
    try{await releaseCloudCopy({root,id,packet,receipt,api});delete receipt.cleanupError;receipt.localReleased=true;await atomic(p.receipt,receipt);return {...result,stage:receipt.publicReadback?'published':'draft_saved',receipt,cleanupError:undefined,localReleased:true,html:'',prepared:null};}
    catch(e){receipt.cleanupError=e.message;receipt.checkedAt=new Date().toISOString();await atomic(p.receipt,receipt);return {...result,receipt,stage:receipt.publicReadback?'cleanup':result.stage,cleanupError:e.message};}
  }
  async function acknowledgeDraft(p,packet,receipt){
    const base=await optional(join(p.dir,'sync.json'));
    // A subsequent pull can acknowledge the same revision with rewritten local
    // asset paths. Querying its old request must not rewind that newer baseline.
    if((base?.remoteId||p.id)===packet.data.id&&base?.revision>=receipt.revision)return;
    await atomicJson(join(p.dir,'sync.json'),{remoteId:packet.data.id,revision:receipt.revision,cloudRevision:receipt.revision,publishedRevision:receipt.publishedVersion??null,fingerprint:packet.localFingerprint,at:new Date().toISOString(),origin:'cloud-save',requestKey:receipt.requestKey});
    await cacheRemote(packet.data.id,{version:receipt.version,publishedVersion:receipt.publishedVersion});
  }
  async function status(id,{flowPolicy}={}){const requestedAt=Date.now();return locked(id,async p=>{
    const current=await inspect(id);if(current.localReleased)return current;
    const saved=await optional(p.receipt),packet=await optional(p.packet);
    // A query that waited behind another query can use its freshly checked result.
    if(saved?.requestKey===packet?.requestKey&&Date.parse(saved?.checkedAt)>requestedAt)return current;
    if(!saved?.requestKey)throw Error('该稿件尚未推送。');
    if(saved.asyncQueue){
      if(saved.asyncQueue.owner==='local'&&['queued','transferring'].includes(saved.asyncQueue.phase)){
        await queueKick({root,site,tokenFile,id});return current;
      }
      if(saved.asyncQueue.owner==='cloud')return refreshQueuedCloud(id,p,packet,saved);
    }
    if(saved.intent==='draft'){
      let result;
      try{result=await api('/drafts/requests/'+saved.requestKey);}catch(e){if(e.statusCode!==404)throw e;await atomic(p.receipt,{...saved,status:'not_submitted',checkedAt:new Date().toISOString()});return inspect(id);}
      if(packet?.requestKey!==saved.requestKey)throw Error('草稿预览与原请求不一致');
      await atomic(p.receipt,{...saved,...result,status:'draft_saved',checkedAt:new Date().toISOString(),publicReadback:false});
      await acknowledgeDraft(p,packet,result);return finish(id,p);
    }
    const receipt={...saved,...await api('/requests/'+saved.requestKey),status:'submitted',checkedAt:new Date().toISOString(),publicReadback:false};
    await atomic(p.receipt,receipt);
    if(receipt.job.status==='success'){
      try{
        if(packet?.requestKey!==saved.requestKey)throw Error('本地预览与任务不一致，请核对原回执。');
        const target=packet.data.id,remote=await api('/'+target);
        if(receipt.url!==(packet.data.record?remote.url:'/news/'+target+'/'))throw Error('官网返回了不匹配的文章地址。');
        if(remote.publishedVersion!==receipt.revision)throw Error('官网当前公开版本与本次任务不同，请核对。');
        if(packet.data.record&&sha(JSON.stringify(remote.published?.record))!==sha(JSON.stringify(packet.data.record)))throw Error('官网数据库记录与本次任务内容不同');
        const response=await fetcher(origin+receipt.url,{redirect:'error',signal:AbortSignal.timeout(30000)}),html=await response.text();
        if(!response.ok||!html.includes('<link rel="canonical" href="'+origin+receipt.url+'">')||(!packet.data.record&&!articleBodyOnPage(html,packet.data.markdown,site)))throw Error('公开页面尚未与本次正文一致，请稍后重新核验。');
        receipt.publicReadback=true;delete receipt.readbackError;
        const fingerprint=packet.localFingerprint||(packet.sourceSha256===(await readDraft(id,root)).sha256&&!((await inspect(id)).stale)?await localFingerprint(root,id):'legacy-published-base');
        const base=await optional(join(p.dir,'sync.json'));
        if(!((base?.remoteId||p.id)===packet.data.id&&base?.revision>=receipt.revision))await atomicJson(join(p.dir,'sync.json'),{remoteId:packet.data.id,revision:receipt.revision,cloudRevision:receipt.revision,publishedRevision:receipt.revision,fingerprint,at:receipt.checkedAt,origin:'publish',requestKey:receipt.requestKey});
        await cacheRemote(target,remote);
        if(flowPolicy){receipt.publishingFlow=await enqueuePublished({root,site:{...flowSite,languages:['zh-CN','en']},data:packet.data,receipt,policy:flowPolicy});}
        else if(!saved.asyncQueue?.endpoint){await continuePublication(packet.data,receipt);if(receipt.asyncQueue)receipt.asyncQueue.continuation={...receipt.publishingFlow,owner:'local'};}
      }catch(e){receipt.readbackError=e.message;}
      await atomic(p.receipt,receipt);
    }
    return finish(id,p);
  });}
  async function refreshQueuedCloud(id,p,packet,saved){
    const binding=await readPublicationQueueIdentity({root,site,id,packet,receipt:saved});
    const queue=saved.asyncQueue,client=publicationQueueClient({endpoint:queue.endpoint,site,tokenFile,fetcher});
    if(queue.jobId!==cloudPublicationJobId(site.id,binding.requestKey))throw Error('后台发布任务编号与冻结请求不匹配');
    const result=await client.status(queue.jobId,packet||{requestKey:binding.requestKey,data:{id:binding.articleId}},{continuationOwner:queue.continuationOwner||'local'});
    const terminal=['rejected','needs_review'].includes(result.status),complete=['complete','draft_saved'].includes(result.status);
    const receipt={...saved,...result.receipt,status:complete?(saved.intent==='draft'?'draft_saved':'submitted'):terminal?'rejected':'submitted',publicReadback:result.receipt?.publicReadback===true,...(result.duplicateOf?{duplicateOf:result.duplicateOf}:{}),checkedAt:new Date().toISOString(),asyncQueue:{...queue,binding,phase:complete?'complete':terminal?'needs_review':result.stage||result.status,updatedAt:result.updatedAt,continuation:result.continuation?{...result.continuation,owner:'cloud'}:undefined,...(result.error?{error:result.error}:{})}};
    if(!result.receipt?.job)receipt.job={id:queue.jobId,status:terminal?'failed':result.status==='queued'?'queued':'running',...(result.error?{error:result.error}:{})};
    if(complete&&saved.intent!=='draft'&&(!receipt.publicReadback||receipt.job?.status!=='success'))throw Error('云端任务尚无完整的公开核验回执');
    if(complete&&saved.intent==='draft')await acknowledgeDraft(p,packet,receipt);
    if(complete&&receipt.publicReadback){
      const base=await optional(join(p.dir,'sync.json'));
      if(!((base?.remoteId||p.id)===binding.articleId&&base?.revision>=receipt.revision)){
        if(!packet)throw Error('归档稿件缺少原同步基线，请核对原任务');
        await atomicJson(join(p.dir,'sync.json'),{remoteId:binding.articleId,revision:receipt.revision,cloudRevision:receipt.revision,publishedRevision:receipt.revision,fingerprint:packet.localFingerprint,at:receipt.checkedAt,origin:'publish',requestKey:receipt.requestKey});
      }
      receipt.publishingFlow={...result.continuation,owner:'cloud'};
      if(queue.continuationOwner==='cloud'&&result.continuation?.status==='complete'){
        try{
          // A durable local artifact is a separate read-only import. Never
          // mirror the remote plan into jobs/ or let a completed status prune
          // its recovery index before this result has reached stable storage.
          const cached=saved.asyncQueue.continuation?.artifact;
          let retained=false;
          if(cached){receipt.asyncQueue.continuation.artifact=cached;try{retained=!!await readCloudContinuationEvidence({root,siteId:site.id,articleId:binding.articleId,receipt});}catch{/* A missing cache can be restored only to its original digest. */}}
          if(!retained){
            const response=await client.continuationArtifact(queue.jobId,packet||{requestKey:binding.requestKey,data:{id:binding.articleId}});
            if(response.status!=='ready')throw Error('云端续作证据尚未就绪');
            if(cached&&response.artifactSha256!==cached.sha256)throw Error('云端续作证据与已取回版本不符');
            receipt.asyncQueue.continuation.artifact=await saveCloudContinuationArtifact({root,siteId:site.id,articleId:binding.articleId,receipt,response});
          }
          receipt.publishingFlow={...receipt.asyncQueue.continuation};
        }catch(error){
          receipt.asyncQueue.continuation={...receipt.asyncQueue.continuation,status:'artifact_pending',complete:false,error:error.code==='FLOW_ARTIFACT'||error.statusCode===409?'云端续作已完成，结果身份核对未通过，原任务已保留':'云端续作已完成，结果尚未取回，稍后继续原任务'};
          receipt.publishingFlow={...receipt.asyncQueue.continuation};
        }
      }
      // Keep the existing English/Ente producer until a tested cloud provider
      // and cloud policy have explicitly taken ownership of new continuations.
      if(queue.continuationOwner!=='cloud'){
        await refreshLocalContinuation(packet,receipt,binding,saved);
      }
    }
    await atomic(p.receipt,receipt);return finish(id,p);
  }
  async function refreshLocalContinuation(packet,receipt,binding,prior=receipt){
    let continuation=await publicationContinuation(root,prior);
    if(continuation?.owner==='local'&&/^[a-f0-9]{40}$/.test(continuation.id||'')){
      const plan=await optional(join(root,'.local/publishing-flow/jobs',continuation.id,'plan.json'));
      if(!plan||plan.siteId!==site.id||plan.origin!==site.origin||plan.articleId!==binding.articleId||plan.revision!==receipt.revision)throw Error('后续任务与冻结发布身份不匹配');
      if(continuationPending(continuation)&&!continuationNeedsAttention(continuation))await kickPublishingFlow({root,site:flowSite,tokenFile});
    }else if(!continuation||continuationPending(continuation)){
      if(!packet)throw Error('后续任务尚未冻结，保留原稿归档待核对');
      try{await handshake();await continuePublication(packet.data,receipt);}catch(error){receipt.publishingFlow={status:'deferred',error:error.message};}
      continuation={...receipt.publishingFlow,owner:'local'};
    }
    receipt.publishingFlow={...continuation,owner:'local'};
    receipt.asyncQueue.continuation=await publicationContinuation(root,{...receipt,asyncQueue:{...receipt.asyncQueue,continuation:receipt.publishingFlow}});
  }
  async function refreshCloudContinuation(id,expected){
    return locked(id,async p=>{
      const saved=await optional(p.receipt),queue=saved?.asyncQueue;
      if(!expected?.requestKey||!expected.jobId||saved?.requestKey!==expected.requestKey||queue?.jobId!==expected.jobId||queue.owner!=='cloud'||queue.continuationOwner!=='cloud')throw Error('Cloud continuation request changed; original status consumer stopped');
      return refreshQueuedCloud(id,p,await optional(p.packet),saved);
    });
  }
  async function recoverCloudRequest(id,expected){
    const p=paths(id);
    return withFileLock(join(p.dir,'queue-worker.lock'),()=>locked(id,current=>restoreOriginalCloudRequest({root,site,id,paths:current,expected,api,tokenFile,fetcher}),{recovery:true}),{timeout:100});
  }
  async function runQueued(id){
    let query=false;
    const result=await locked(id,async p=>{
      const saved=await optional(p.receipt),packet=await optional(p.packet),queue=saved?.asyncQueue;
      if(!queue)return inspect(id);
      if(queue.owner==='cloud'){
        try{return await refreshQueuedCloud(id,p,packet,saved);}
        catch(error){
          const fatal=[400,401,403,404,409].includes(error.statusCode);
          saved.asyncQueue={...queue,...(fatal?{phase:'needs_review'}:{}),error:error.message,retryAt:Date.now()+30000,updatedAt:new Date().toISOString()};
          await atomic(p.receipt,saved);return inspect(id);
        }
      }
      if(saved.publicReadback&&saved.job?.status==='success'||saved.intent==='draft'&&saved.status==='draft_saved'){
        const binding=await readPublicationQueueIdentity({root,site,id,packet,receipt:saved});queue.binding=binding;queue.phase='complete';
        if(saved.intent!=='draft')await refreshLocalContinuation(packet,saved,binding);
        queue.updatedAt=new Date().toISOString();await atomic(p.receipt,saved);return finish(id,p);
      }
      if(queue.phase==='complete'||queue.phase==='needs_review')return inspect(id);
      if(saved.requestKey!==packet?.requestKey||queue.packetSha256!==sha(JSON.stringify(packet)))throw Error('后台发布预览身份已变化，请核对原任务');
      if(queue.retryAt>Date.now())return inspect(id);
      if((saved.job?.id!==packet.requestKey&&saved.job)||queue.phase==='submitted'){query=true;return null;}
      queue.phase='transferring';queue.updatedAt=new Date().toISOString();queue.attempts=(queue.attempts||0)+1;await atomic(p.receipt,saved);
      try{
        if(queue.endpoint){
          const client=publicationQueueClient({endpoint:queue.endpoint,site,tokenFile,fetcher}),jobId=cloudPublicationJobId(site.id,packet.requestKey);
          const ownership={continuationOwner:queue.continuationOwner||'local'};
          let accepted;try{accepted=await client.status(jobId,packet,ownership);}catch(error){if(error.statusCode!==404)throw error;accepted=await client.submit(packet,ownership);}
          const receipt={...saved,status:'submitted',asyncQueue:{...queue,owner:'cloud',phase:accepted.stage||accepted.status,jobId:accepted.jobId,updatedAt:new Date().toISOString()},job:{id:accepted.jobId,status:'queued'}};
          await atomic(p.receipt,receipt);return refreshQueuedCloud(id,p,packet,receipt);
        }
        const lookup=(saved.intent==='draft'?'/drafts/requests/':'/requests/')+packet.requestKey;
        let receipt;try{receipt=await api(lookup);}catch(error){if(error.statusCode!==404)throw error;receipt=await api(saved.intent==='draft'?'/drafts':'/publish',packet);}
        await atomic(p.receipt,{...saved,...receipt,status:saved.intent==='draft'?'draft_saved':'submitted',asyncQueue:{...queue,phase:'submitted'}});
        if(saved.intent==='draft')await acknowledgeDraft(p,packet,receipt);else query=true;
        return inspect(id);
      }catch(error){
        const fatal=Boolean(error.statusCode>=400&&error.statusCode<500&&![408,425,429].includes(error.statusCode))||queue.attempts>=8;
        await atomic(p.receipt,{...saved,asyncQueue:{...queue,phase:fatal?'needs_review':'queued',error:error.message,retryAt:Date.now()+Math.min(300000,5000*2**Math.min(queue.attempts,6))},...(fatal?{status:'rejected',job:{id:packet.requestKey,status:'failed',error:error.message}}:{})});
        return inspect(id);
      }
    });
    if(!query)return result;
    const value=await status(id),receipt=value.receipt;
    if(receipt?.job?.status==='failed'||['rejected','not_submitted'].includes(receipt?.status)){
      await locked(id,async p=>{const latest=await optional(p.receipt);if(latest?.requestKey===receipt.requestKey)await atomic(p.receipt,{...latest,asyncQueue:{...latest.asyncQueue,phase:'needs_review',error:receipt.job?.error||receipt.error||'原发布请求需要核对',updatedAt:new Date().toISOString()}});});
      return inspect(id);
    }
    if(receipt?.publicReadback||receipt?.intent==='draft'&&receipt.status==='draft_saved'){
      await locked(id,async p=>{const latest=await optional(p.receipt);if(latest?.requestKey===receipt.requestKey)await atomic(p.receipt,{...latest,asyncQueue:{...latest.asyncQueue,phase:'complete',...(latest.publishingFlow?{continuation:{...latest.publishingFlow,owner:'local'}}:{}),updatedAt:new Date().toISOString()}});});
      return inspect(id);
    }
    return value;
  }
  async function resumeSubmission(id,intent){
    const p=paths(id),packet=await optional(p.packet),saved=await optional(p.receipt);
    if(packet?.requestKey!==intent.requestKey||saved?.requestKey!==intent.requestKey||saved.intent==='draft')throw Error('Original submission identity changed; review required');
    if(saved.publicReadback&&saved.job?.status==='success')return saved;
    let result;
    try{result=await status(id,{flowPolicy:intent.policy});}
    catch(e){
      if(e.statusCode!==404)throw e;
      // A locally cached job is not proof that the server still has this
      // request. Recheck under the article lock, then replay only its frozen
      // payload and original optimistic versions after an authoritative 404.
      await locked(id,async current=>{
        const latestPacket=await optional(current.packet),latestReceipt=await optional(current.receipt);
        if(sha(JSON.stringify(latestPacket))!==sha(JSON.stringify(packet))||latestReceipt?.requestKey!==intent.requestKey||latestReceipt.intent==='draft')throw Error('Original submission identity changed; review required');
        try{await api('/requests/'+intent.requestKey);return;}catch(missing){if(missing.statusCode!==404)throw missing;}
        if((intent.resends||0)>=3)throw Error('Original submission recovery exhausted');
        const pack=await packedDraft(id,root),meta=await metadata(id,pack.draft);
        if(packet.sourceSha256!==pack.draft.sha256||sha(JSON.stringify(await packedPayload(id,pack,meta)))!==sha(JSON.stringify(packet.data)))throw Error('Original submission source changed; review required');
        intent.resends=(intent.resends||0)+1;
        await atomic(join(root,'.local/publishing-flow/submissions',intent.requestKey+'.json'),intent);
        const submission={...latestReceipt,status:'submit_intent',publicReadback:false,recoveryAt:new Date().toISOString()};
        await atomic(current.receipt,submission);
        try{await atomic(current.receipt,{...submission,...await api('/publish',packet),status:'submitted'});}
        catch(sendError){if([400,401,403,409,413].includes(sendError.statusCode))await atomic(current.receipt,{...submission,status:'rejected',error:sendError.message});throw sendError;}
      });
      return (await status(id,{flowPolicy:intent.policy})).receipt;
    }
    const receipt=result.receipt||result;
    if(receipt.job?.status==='failed'){
      if((intent.buildRetries||0)>=3)throw Error('Original build recovery exhausted');
      intent.buildRetries=(intent.buildRetries||0)+1;
      await atomic(join(root,'.local/publishing-flow/submissions',intent.requestKey+'.json'),intent);
      await api('/requests/'+intent.requestKey+'/retry',{jobId:receipt.job.id});
      return (await status(id,{flowPolicy:intent.policy})).receipt;
    }
    return receipt;
  }
  return {root,siteId:site.id,spaceId:site.spaceId,reconcile,resumeSubmission,runQueued,refreshCloudContinuation,recoverCloudRequest,enqueue:(id,params)=>publish(id,{...params,background:true}),releaseLocal:(id)=>site.retainLocal?inspect(id):locked(id,async p=>{const action=await optional(join(p.dir,'cloud-action.json'));const receipt=await optional(p.receipt);if(action?.action==='publish'&&action.status==='success'&&(!receipt||Date.parse(action.submittedAt)>=Date.parse(receipt.submittedAt))){await settleAction(id,p,action,true);return inspect(id);}return finish(id,p,true);}),snapshot,inspect,prepare,publish,saveCloud:(id,params)=>publish(id,{...params,intent:'draft'}),status,connection,refresh,pull,acceptMerge,catalog,published,cloud,privateNotes,exportCloud,cloudAction,cloudActionStatus,cloudActionCached,localAction};
}
