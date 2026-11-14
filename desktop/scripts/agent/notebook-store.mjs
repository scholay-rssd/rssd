import {activeNotebookTurn,notebookAgentTask,writeAgentNotebook,prepareNotebookTurn} from './notebook-turns.mjs';
import {notebookPreparation} from './notebook-completion.mjs';
import {validateSectionId,sectionsForSite} from '../../../contracts/site-sections.mjs';
import {resolveSkillMounts} from './writing-skill-catalog.mjs';
import {managedWritingWorkspace,workspaceWritingContext} from '../../../scripts/rssd-writing-defaults.mjs';
import writingDefaults from '../../../contracts/writing-defaults-v1.cjs';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {withFileLock} from '../../../scripts/editorial-lock.mjs';
import {atomicJson,optionalJson} from '../../../scripts/editorial-sync.mjs';
import {readDraft,createDraft,saveDraft,contained,withWorkspaceLock} from '../../../scripts/editorial-workspace.mjs';
import {publicationDirectory,siteForWorkspace} from '../../../scripts/site-config.mjs';
import {recordHeadings,recordFields,normalizeRecordMarkdown} from '../../../scripts/editorial-record.mjs';
import {markdownImages} from '../../../scripts/article-format.mjs';
import {validate,day} from '../../../admin/model.mjs';
import {destinationRecord,draftPlacement} from './destinations.mjs';
import {WRITING_SKILLS,kindMode,writingTypes,notebookIssues,notebookMarkdown,validateNotebook,upgradeNotebook,stampNotebook,notebookPromptScope} from './notebook.mjs';
import {pendingCloudDelivery} from './workflow.mjs';
import {imageAlt,publicationMetadataFromNotebook,writeNotebookImageRights} from './notebook-finalize.mjs';
import {loadWritingContext,saveWritingContext,freezeWritingContext,workflowFromContext,bindExportContext,restoreBoundContext} from './writing-context-store.mjs';
import {privateEditorialData,restorePrivateEditorial,validatePrivateEditorial} from '../../../contracts/article-internal-notes.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const writingHash=draft=>hash(JSON.stringify({type:draft.type??null,writingSkills:draft.writingSkills??null,shortTitle:draft.shortTitle??null}));
const draftSkills=(draft,fallback)=>{const values=draft?.writingSkills??(draft?.type?[draft.type]:null);if(!Array.isArray(values))return fallback;const known=values.filter(id=>Object.hasOwn(WRITING_SKILLS,id));return known.length||values.length===0||draft.type==='unskilled'?known:fallback;};
const writingMetadata=n=>({type:writingTypes(n.skills)[0],writingSkills:[...n.skills],shortTitle:n.title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'').trim().slice(0,60)});
const block=(type,text='',state='placeholder',extra={})=>({id:randomUUID(),type,text,state,sourceIds:[],...extra});
export async function recordNotebookModel(store,id,signature){return withFileLock(join(store.dir(id),'task.lock'),async()=>{
 const t=await store.get(id);if(!t.notebook)return;
 const records=[...(t.notebook.modelSignatures||[])],index=records.findIndex(s=>s.runId===signature.runId);
 if(index<0&&!signature.agentId)return;
 if(index>=0)records[index]={...records[index],...signature};else records.push(signature);
 t.notebook.modelSignatures=records;
 const turn=activeNotebookTurn(t);if(turn)turn.candidate.modelSignatures=structuredClone(records);
 t.revision++;return store.save(t);
});}
export async function openNotebook(store,id,{empty=false}={}){return withFileLock(join(store.dir(id),'task.lock'),async()=>{
 const t=await store.get(id);if(t.notebook){if(t.notebook.version===1){t.notebook=stampNotebook(t.notebook,undefined,{documentId:t.articleId,imported:true,actor:'import'});t.revision++;return store.save(t);}return t;}
 if(t.runtime?.busy||t.runtime?.queued)throw Error('请先停止旧流程，再打开统一文章板');
 if(['rss','image','legacy'].includes(t.mode))throw Error('该对话不使用文章板');
 const bound=destinationRecord(t.mode),kind=bound?.kind||'article';
 let draft=null,binding=null;
 if(t.workIds.includes(t.articleId)){draft=await readDraft(t.articleId,store.root);binding=await optionalJson(join(publicationDirectory(store.root),t.articleId,'record.json'));}
 const sources=t.board.sections.flatMap(s=>s.items).map(i=>({...i,acquiredVia:i.acquiredVia||'web',reviewed:false}));
 let blocks=[];
 if(draft){const text=draft.markdown.replace(/^# [^\n]+\n+/,'');blocks=[block('markdown',text,'ready',{locked:true})];}
 else if(t.outline.blocks.length)blocks=t.outline.blocks.map(b=>block(b.type==='heading'?'heading':b.type==='image'?'image':'paragraph',b.type==='image'?'':b.text,'placeholder',{id:b.id,level:2,caption:b.type==='image'?b.text:undefined,sourceIds:(b.sourceIds||[]).filter(id=>sources.some(s=>s.id===id))}));
 else if(bound)blocks=recordHeadings(kind).flatMap(text=>[block('heading',text,'ready',{level:2,locked:true}),block('paragraph')]);
 else blocks=empty?[]:[block('paragraph')];
 // Old empty smart slots remain visible requests, never silently become completed prose.
 for(const s of t.board.sections)for(const slot of s.slots||[])if(!s.items.some(i=>i.id===slot.id))blocks.push(block('paragraph',slot.prompt||slot.templateName||s.title,'placeholder',{id:'slot-'+slot.id}));
 const saved=draft?await optionalJson(join(publicationDirectory(store.root),t.articleId,'notebook.json')):null;
 const restored=saved?.bodySha===draft?.sha256?saved?.document:null;
 const privateNotes=draft?await optionalJson(join(publicationDirectory(store.root),t.articleId,'internal-notes.json')):null;
 t.notebook=stampNotebook(restored?{...restored,sectionId:draft.sectionId,baseSectionId:draft.sectionId||null,baseWritingHash:writingHash(draft),skills:draftSkills(draft,restored.skills),fields:binding?.fields||restored.fields,...(binding?{baseRecordHash:hash(JSON.stringify(binding))}:{})}:{version:1,title:draft?.markdown.match(/^# (.+)$/m)?.[1]||t.outline.titleCandidates?.[t.outline.selectedTitle||0]||'',kind,...(draft?.sectionId?{sectionId:draft.sectionId}:{}),skills:draftSkills(draft,t.writingSkill==='unskilled'?[]:[t.writingSkill||t.mode]),blocks,sources,fields:binding?.fields||{},...(draft?{baseSha:draft.sha256,baseSectionId:draft.sectionId||null,baseWritingHash:writingHash(draft)}:{}),...(binding?{baseRecordHash:hash(JSON.stringify(binding))}:{})},restored||undefined,{documentId:t.articleId,imported:!!draft,actor:draft?'import':'author'});
 if(!restored&&privateNotes)Object.assign(t.notebook,restorePrivateEditorial(t.notebook,validatePrivateEditorial(privateNotes)));
 if(draft?.sha256)await restoreBoundContext(store,t,draft.sha256).catch(async()=>{const context=await loadWritingContext(store,t);await saveWritingContext(store,t,context);});
 else {const context=await loadWritingContext(store,t);await saveWritingContext(store,t,context);}
 t.revision++;t.updatedAt=new Date().toISOString();return store.save(t);
 });}
export async function saveNotebook(store,id,n,revision,{agent=false}={}){return withFileLock(join(store.dir(id),'task.lock'),async()=>{
 const t=await store.get(id);if(t.completedAt)throw Error('成稿已保存，请在作品库中编辑');
 if(t.revision!==revision)throw Error('CONFLICT: 文章板已有新版，未覆盖你的内容，请重新读取后合并');
 if(!t.notebook)throw Error('请先打开文章板');
 if(!agent&&(t.runtime?.busy||t.runtime?.queued))throw Error('请先等待当前操作完成');
 const original=t.notebook,turn=activeNotebookTurn(t);if(agent&&turn)t.notebook=turn.candidate;
 if(JSON.stringify(n.templateSelection)!==JSON.stringify(t.notebook.templateSelection))throw Error('模板选中状态请通过模板操作修改');
 n=validateNotebook(n,t.notebook,{agent,scope:agent?t.runtime?.notebookAction:undefined});
 const sectionId=validateSectionId(n.sectionId,siteForWorkspace(store.root));if(sectionId)n.sectionId=sectionId;else delete n.sectionId;
 if(n.mounts?.skills)n.mounts.skills=await resolveSkillMounts(store.root,n.mounts.skills,t.notebook.mounts?.skills||[]);
 const assets={...upgradeNotebook(t.notebook).assets};
 for(const b of n.blocks.filter(b=>b.type==='image'&&b.text)){const registered=await optionalJson(join(store.dir(id),'images',b.text.split('/').at(-1)+'.json'));if(registered)assets[b.text]=registered;}
 // Receipts and canonical file hashes are server-owned, even when a full notebook is supplied.
 if(agent&&t.runtime?.notebookAction?.action==='organize'){const existing=new Set(t.notebook.blocks.map(b=>b.id));t.runtime.notebookAction.targetIds=[...new Set([...t.runtime.notebookAction.targetIds,...n.blocks.filter(b=>!existing.has(b.id)).map(b=>b.id)])];}
 t.notebook=stampNotebook({...n,assets,modelSignatures:t.notebook.modelSignatures,baseSha:t.notebook.baseSha,baseSectionId:t.notebook.baseSectionId,baseWritingHash:t.notebook.baseWritingHash,baseRecordHash:t.notebook.baseRecordHash,exportedSha:t.notebook.exportedSha},t.notebook,{documentId:t.articleId,actor:agent?'agent':'author'});
 if(agent&&turn){turn.candidate=t.notebook;turn.generated=true;t.notebook=original;}
 t.revision++;t.updatedAt=new Date().toISOString();return store.save(t);
 });}
export async function importNotebookImage(store,id,p){
 const t=await store.get(id);if(!t.notebook||t.completedAt)throw Error('请先打开可编辑文章板');
 let bytes,provenance={origin:p.generated?'generated':'imported',acquiredVia:p.generated?'generate':'local'};
 if(p.galleryTaskId){const {galleryBytes,galleryList}=await import('./image-library.mjs');bytes=await galleryBytes(store,p.galleryTaskId,p.assetId);const entry=(await galleryList(store)).find(x=>x.taskId===p.galleryTaskId&&x.id===p.assetId);provenance={...entry?.provenance,origin:entry?.origin||'imported',acquiredVia:'local'};}
 else if(p.url){const {fetchImage}=await import('./notebook-images.mjs');bytes=await fetchImage(p.url);provenance={origin:p.origin==='rss'?'rss':'web',acquiredVia:p.origin==='rss'?'local':'online',sourceUrl:p.sourceUrl||p.url,creator:p.creator||'',license:p.license||'',licenseUrl:p.licenseUrl||''};}
 else {if(typeof p.data!=='string'||p.data.length>12000000)throw Error('图片过大，限 9 MB');bytes=Buffer.from(p.data,'base64');}
 const sharp=(await import('sharp')).default,source=sharp(bytes,{limitInputPixels:64000000}),meta=await source.metadata();
 if(!['png','jpeg','webp'].includes(meta.format)||(meta.pages||1)>1)throw Error('请选择静态 PNG、JPEG 或 WebP 图片');
 const rendered=await source.rotate().resize({width:2000,withoutEnlargement:true}).webp({quality:88}).toBuffer(),name=hash(rendered)+'.webp',base=join(store.dir(id),'images');await mkdir(base,{recursive:true});await writeFile(join(base,name),rendered);
 const info=await sharp(rendered).metadata(),path='assets/notebook/'+name,asset={id:hash(rendered),path,sha256:hash(rendered),originalSha256:hash(bytes),width:info.width,height:info.height,format:'webp',...provenance,createdAt:new Date().toISOString()};
 await atomicJson(join(base,name+'.json'),asset);
 return {path,asset,src:'data:image/webp;base64,'+rendered.toString('base64')};
}
export async function applyNotebookImage(store,id,p,{agent=false}={}){
 const before=notebookAgentTask(await store.get(id)),b=before.notebook?.blocks.find(x=>x.id===p.blockId);
 if(!b||b.type!=='image'||before.completedAt)throw Error('图片位置已变化');
 if(before.revision!==p.expectedRevision)throw Error('CONFLICT: 文章板已有新版，未替换图片');
 if(agent){const scope=before.runtime?.notebookAction;if(!['image','complete'].includes(scope?.action)||!scope.targetIds.includes(b.id)||b.locked&&!scope.authorizedLockedIds?.includes(b.id))throw Error('当前运行没有这一图片位置的授权');if(scope.imageMethod==='generate'&&!p.generated||scope.imageMethod==='local'&&!p.galleryTaskId&&p.origin!=='rss'||scope.imageMethod==='online'&&!p.url)throw Error('图片取得方式不符合本次委派');}
 const imported=await importNotebookImage(store,id,p);
 return withFileLock(join(store.dir(id),'task.lock'),async()=>{const t=await store.get(id);if(t.completedAt||t.revision!==p.expectedRevision)throw Error('CONFLICT: 图片已取得，但内容行已有修改，请重新选用');
  const previous=agent?notebookAgentTask(t).notebook:t.notebook,n=upgradeNotebook(previous);n.assets={...n.assets,[imported.path]:imported.asset};
  const current=n.blocks.find(x=>x.id===p.blockId);
  const alt=imageAlt({...current,...(p.alt?{alt:p.alt}:{})},n);
  n.blocks=n.blocks.map(x=>x.id===p.blockId?{...x,text:imported.path,alt,state:'ready',locked:agent?!!x.locked:true}:x);writeAgentNotebook(t,stampNotebook(n,previous,{documentId:t.articleId,actor:agent?'agent':'author'}));t.revision++;t.updatedAt=new Date().toISOString();return store.save(t);
 });
}
export async function beginNotebookPrompt(store,id,p){return withFileLock(join(store.dir(id),'task.lock'),async()=>{
 const t=await store.get(id);if(!t.notebook||t.completedAt||t.runtime?.busy||t.runtime?.queued)throw Error('请先等待当前操作完成');
 if(t.revision!==p.expectedRevision)throw Error('CONFLICT: 文章板已有新版，请重新读取');
 const turn=p.turnContext?await prepareNotebookTurn(store,t,p):null;
 const writingNote=turn?.candidate||t.notebook;
 if(!t.notebookExport&&!t.notebook.baseSha&&await managedWritingWorkspace(store.root)){
  t.writingDefaults=await workspaceWritingContext(store.root,writingNote.sectionId,{directory:join(store.dir(id),'writing-defaults',writingDefaults.hash(writingNote.sectionId))});
  if(turn)turn.writingDefaults=t.writingDefaults;
 }
 const scope=notebookPromptScope(turn?.candidate||t.notebook,p);if(turn)scope.turnId=turn.id;
 // Per-turn network choices remain authoritative; mounting context must not
 // resurrect a previous run's transient permission.
 const sources=turn?(turn.context.webEnabled?'combined':'rss'):['research','image'].includes(scope.action)?(p.sources||'rss'):(t.notebook.context?.webEnabled?'combined':'rss');
 const frozen=await freezeWritingContext(store,t,scope.operationId||randomUUID());
 const fromContext=workflowFromContext(frozen,sources);
 const allowNetwork=turn?turn.context.webEnabled:fromContext.allowNetwork||sources==='combined';
 if(scope.action==='complete'&&!turn){const c=await checkNotebook(store,t,{preparing:true});if(!c.ready)throw Error(c.issues.join('；'));scope.imageMethod=allowNetwork?'online':'local';}
 t.runtime={...t.runtime,notebookAction:{...scope,operationId:frozen.frozenRunId||randomUUID()}};
 t.workflow={...t.workflow,version:1,authorized:true,sources:allowNetwork?'combined':'rss',allowNetwork,mountKinds:fromContext.mountKinds,contextRevision:fromContext.contextRevision};
 t.revision++;t.updatedAt=new Date().toISOString();return store.save(t);
});}
async function imageFile(store,t,path,draft){
 if(path.startsWith('assets/placeholders/'))throw Error('请替换占位图片');
 if(/^assets\/notebook\/[a-f0-9]{64}\.webp$/.test(path)){try{return await contained(join(store.dir(t.id),'images'),path.split('/').at(-1));}catch{}}
 if(draft)return contained(dirname(join(store.root,draft.canonicalPath)),path);
 throw Error('图片需要导入为本地文件');
}
export async function checkNotebook(store,t,{preparing=false}={}){
 const n=t.notebook,issues=preparing?notebookPreparation(n).filter(c=>!c.ok).map(c=>c.label):notebookIssues(n),markdown=normalizeRecordMarkdown(n.kind,notebookMarkdown(n));let fields=null,draft=null;
 if(t.writingDefaults&&!preparing)issues.push(...writingDefaults.deliveryIssues(n,t.writingDefaults));
 try{validateSectionId(n.sectionId,siteForWorkspace(store.root));}catch(e){issues.push(e.message);}
 try{draft=await readDraft(t.articleId,store.root);}catch(e){if(t.workIds.includes(t.articleId))issues.push('已有稿件无法读取：'+e.message);}
 if(draft&&n.baseSectionId!==undefined&&n.baseSectionId!==(draft.sectionId||null))issues.push('作品库栏目已变化，请重新载入，避免覆盖其他编辑');
 if(draft&&n.baseWritingHash&&writingHash(draft)!==n.baseWritingHash&&writingHash(draft)!==t.notebookExport?.writingHash)issues.push('作品库标题或文章类型已变化，请重新载入，避免覆盖其他编辑');
 if(n.baseSha&&draft?.sha256!==n.baseSha&&draft?.sha256!==t.notebookExport?.sha)issues.push('作品库正文已变化，请重新载入，避免覆盖其他编辑');
 if(n.kind!=='article')try{
  const binding=await optionalJson(join(publicationDirectory(store.root),t.articleId,'record.json'));
  if(n.baseRecordHash&&hash(JSON.stringify(binding))!==n.baseRecordHash&&hash(JSON.stringify(binding))!==t.notebookExport?.recordHash)throw Error('作品库正文已变化（发布字段已修改），请重新载入');
  const validationMarkdown=preparing&&!n.title.trim()&&n.titleTemplate?.requirement?.trim()?markdown.replace(/^# [^\n]*\n/,'# 待生成标题\n'):markdown;
  const candidate=recordFields(n.kind,{...n.fields,...(n.sectionId?{sectionId:n.sectionId}:{}),...(n.kind==='year'?{tags:n.fields.tags||[]}:{}),...(n.kind==='history'?{sources:n.sources.map(s=>({label:s.title,url:s.url}))}:{})},validationMarkdown);
  // Before writing, validate metadata and structure only. These temporary values
  // never reach a draft; final export validates the actual completed prose again.
  if(preparing)for(const key of ['summary','body','factSummary','historicalSignificance','value'])if(!candidate[key])candidate[key]='待完成';
  fields=validate(n.kind,candidate,binding?.fields||{id:n.kind+':editor:'+t.articleId.slice(7)},siteForWorkspace(store.root));
  if(n.kind==='history')day(String(fields.year).padStart(4,'0')+'-'+fields.dateKey);
 }catch(e){issues.push('结构化字段：'+e.message);}

 const images=[];
 for(const path of [...new Set(markdownImages(markdown))])try{const file=await imageFile(store,t,path,draft);await (await import('sharp')).default(await readFile(file)).metadata();images.push({path,file});}catch{issues.push('配图尚未就绪：'+path);}
 const pending=await pendingCloudDelivery(store.root,t.articleId);if(pending)issues.push('云端原请求待查询，请先在作品库查询原请求');
 return {ready:issues.length===0,issues,markdown,fields,images,draft};
}
export async function exportNotebook(store,id,revision,{completionOperationId}={}){
 await store.lease((await store.get(id)).articleId,id);
 try{return await withFileLock(join(store.dir(id),'task.lock'),async()=>{
  const t=await store.get(id);if(t.completedAt)return t;
  if(t.revision!==revision)throw Error('文章板已有新版，请重新核对');
  const completing=completionOperationId&&t.runtime?.notebookAction?.action==='complete'&&t.runtime.notebookAction.operationId===completionOperationId;
  if(completionOperationId&&!completing)throw Error('成稿运行已变化，请重新检查');
  if((t.runtime?.busy||t.runtime?.queued)&&!completing)throw Error('请等待对话完成');
  const c=await checkNotebook(store,t);if(!c.ready)throw Error(c.issues.join('；'));
  const n=t.notebook,sha=hash(c.markdown),writing=writingMetadata(n);
  // Persist an export intent first: a stopped process can resume this exact stable-ID save.
  const finalBinding=c.fields?{documentId:t.articleId.slice(7),kind:n.kind,fields:c.fields}:null;
  t.notebookExport={sha,revision:t.revision,writingHash:writingHash(writing),...(finalBinding?{recordHash:hash(JSON.stringify(finalBinding))}:{})};await store.save(t);
  let draft=c.draft;
  if(!draft)draft=await createDraft({id:t.articleId,title:n.title,sectionId:n.sectionId,markdown:c.markdown,...(n.kind==='article'&&!n.sectionId?{column:'未归栏',archiveCategory:'未归栏'}:draftPlacement(n.kind==='article'?(['xiwen','observation'].includes(t.mode)?t.mode:'observation'):kindMode[n.kind],c.fields)),type:writingTypes(n.skills)[0],writingSkills:[...n.skills],sources:n.sources.map(s=>({rssArticleId:Number(s.rssId)||null,url:s.url}))},store.root);
  else if(draft.sha256!==sha)draft=await saveDraft({id:t.articleId,markdown:c.markdown,expectedSha256:n.baseSha},store.root);
  const base=dirname(join(store.root,draft.canonicalPath));
  for(const im of c.images)if(im.path.startsWith('assets/notebook/')){await mkdir(join(base,'assets/notebook'),{recursive:true});await contained(base,'assets/notebook');if(im.file!==join(base,im.path))await copyFile(im.file,join(base,im.path));}
  await writeNotebookImageRights(store.root,t.articleId,n,c.images.map(im=>({path:im.path})));
  const site=siteForWorkspace(store.root),metaFile=join(publicationDirectory(store.root),t.articleId,'metadata.json'),existing=await optionalJson(metaFile),generated=publicationMetadataFromNotebook(n,site,draft);
  const publication={date:existing?.date||generated.date,summary:existing?.summary||generated.summary,author:existing?.author||generated.author,category:generated.sectionId===existing?.sectionId&&existing?.category?existing.category:generated.category,...(generated.sectionId?{sectionId:generated.sectionId}:{})};
  await mkdir(dirname(metaFile),{recursive:true,mode:0o700});await atomicJson(metaFile,publication);
  if(c.fields)await withWorkspaceLock(store.root,async()=>{if((await readDraft(t.articleId,store.root)).sha256!==sha)throw Error('CONFLICT: 正文已有新版');const file=join(publicationDirectory(store.root),t.articleId,'record.json'),old=await optionalJson(file);const currentHash=hash(JSON.stringify(old));if(n.baseRecordHash&&currentHash!==n.baseRecordHash&&currentHash!==t.notebookExport.recordHash)throw Error('CONFLICT: 发布字段已变化，保留了作品库中的新字段');await atomicJson(file,finalBinding);});
  await withWorkspaceLock(store.root,async()=>{const current=await readDraft(t.articleId,store.root);if(current.sha256!==sha)throw Error('CONFLICT: 正文已有新版，结构未绑定到其他版本');if(writingHash(current)!==(n.baseWritingHash||writingHash(draft))&&writingHash(current)!==t.notebookExport.writingHash)throw Error('CONFLICT: 作品库标题或文章类型已变化，请重新载入');if((current.sectionId||null)!==(c.draft?.sectionId||null)&&(current.sectionId||null)!==(n.sectionId||null))throw Error('CONFLICT: 作品库栏目已变化，请重新载入');const indexFile=join(store.root,'_ops/inventory/article-index.json'),index=await optionalJson(indexFile);if(index?.articles?.[t.articleId]){Object.assign(index.articles[t.articleId],writing);if(n.sectionId)index.articles[t.articleId].sectionId=n.sectionId;else delete index.articles[t.articleId].sectionId;await atomicJson(indexFile,index);}await atomicJson(join(publicationDirectory(store.root),t.articleId,'notebook.json'),{version:2,bodySha:sha,savedAt:new Date().toISOString(),document:{...upgradeNotebook(n),baseSectionId:n.sectionId||null,baseWritingHash:writingHash(writing),baseSha:sha,...(finalBinding?{baseRecordHash:hash(JSON.stringify(finalBinding))}:{}),exportedSha:sha}});if(Object.keys(n.internalNotes||{}).length||Object.keys(n.blockNotes||{}).length||n.modelSignatures?.length||await optionalJson(join(publicationDirectory(store.root),t.articleId,'internal-notes.json')))await atomicJson(join(publicationDirectory(store.root),t.articleId,'internal-notes.json'),{version:1,bodySha:sha,...privateEditorialData(n)});await bindExportContext(store,t,sha);});
  t.notebook={...n,baseSectionId:n.sectionId||null,baseWritingHash:writingHash(writing),baseSha:sha,...(finalBinding?{baseRecordHash:hash(JSON.stringify(finalBinding))}:{}),exportedSha:sha};t.workIds=[...new Set([...t.workIds,t.articleId])];t.generated={revision:t.revision,sha,at:new Date().toISOString()};t.draftStale=false;
  t.delivery={destination:'local',articleId:t.articleId,canonicalPath:draft.canonicalPath,sha256:sha,taskRevision:t.revision,at:new Date().toISOString()};t.completedAt=t.delivery.at;t.updatedAt=t.completedAt;t.stage='deliver';t.workflow={...t.workflow,authorized:false};t.runtime={...t.runtime,busy:false,queued:false,status:'已完成',pendingPrompt:null};return store.save(t);
 });}finally{await store.releaseOwner(id);}
}

export async function readNotebookImage(store,id,path){const t=await store.get(id);if(![...t.notebook?.blocks||[],...(t.notebookTurns||[]).flatMap(x=>x.candidate?.blocks||x.items?.flatMap(i=>i.blocks||[])||[])].some(b=>b.type==='image'&&b.text===path))throw Error('图片不在当前文章板');let d;try{d=await readDraft(t.articleId,store.root);}catch{}const file=await imageFile(store,t,path,d),sharp=(await import('sharp')).default;return {src:'data:image/webp;base64,'+(await sharp(await readFile(file)).resize({width:800,withoutEnlargement:true}).webp().toBuffer()).toString('base64')};}
// An explicit human re-read; retain the prior board alongside the task for recovery.
export async function reloadNotebookDraft(store,id,revision,{reopen=false}={}){return withFileLock(join(store.dir(id),'task.lock'),async()=>{
 const t=await store.get(id);if(!t.notebook||t.completedAt&&!reopen||t.runtime?.busy||t.runtime?.queued)throw Error('当前文章板不可重新载入');
 if(t.revision!==revision)throw Error('CONFLICT: 文章板已有新版，请先重新读取');
 if(await pendingCloudDelivery(store.root,t.articleId))throw Error('请先查询云端原请求');
 const draft=await readDraft(t.articleId,store.root),bound=await optionalJson(join(publicationDirectory(store.root),t.articleId,'record.json'));
 await atomicJson(join(store.dir(id),'notebook-before-reload-'+t.revision+'.json'),t.notebook);
 const saved=await optionalJson(join(publicationDirectory(store.root),t.articleId,'notebook.json')),matches=saved?.bodySha===draft.sha256;
 const next=matches?saved.document:{...upgradeNotebook(t.notebook),title:draft.markdown.match(/^# (.+)$/m)?.[1]||t.notebook.title,groups:[],blocks:[block('markdown',draft.markdown.replace(/^# [^\n]+\n+/,''),'ready',{locked:true})]};
 t.notebook=stampNotebook({...next,sectionId:draft.sectionId,baseSectionId:draft.sectionId||null,baseWritingHash:writingHash(draft),skills:draftSkills(draft,next.skills),fields:bound?.fields||next.fields,baseSha:draft.sha256,baseRecordHash:bound?hash(JSON.stringify(bound)):undefined,exportedSha:undefined},t.notebook,{documentId:t.articleId});
 if(matches)await restoreBoundContext(store,t,draft.sha256);
 if(reopen){delete t.completedAt;t.stage='draft';t.delivery=undefined;t.workflow={...t.workflow,authorized:false};t.runtime={...t.runtime,status:'可继续编辑',notebookAction:null};}
 t.revision++;t.updatedAt=new Date().toISOString();return store.save(t);
});}
