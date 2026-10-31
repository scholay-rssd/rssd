// A small, durable transport queue. Website publication and its existing
// continuation queue keep their own receipts; this service never writes a CMS DB.
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,open,readFile,rename,rm,readdir} from 'node:fs/promises';
import {dirname,join,isAbsolute} from 'node:path';
import {EventEmitter} from 'node:events';
import {withFileLock} from './editorial-lock.mjs';
import {validateSite} from './site-config.mjs';
import {validateNews} from '../admin/news.mjs';
import {validate as validateRecord} from '../admin/model.mjs';
import {editionRoute,sourceContentSha256} from '../contracts/language-editions.mjs';
import {articleBodyOnPage} from './website-article-readback.mjs';
import {isPrivateFile,protectPrivateFile} from './private-file.mjs';
import {CLOUD_CONTINUATION_SITES,createCloudContinuationArtifact} from './publishing-flow-artifact.mjs';
import {validateRecoveryPacket} from './publication-recovery-packet.mjs';

export const CLOUD_QUEUE_PROTOCOL='scholay-publishing-queue';
export const CLOUD_PACKET_BYTES=4*1024*1024;
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const fingerprint=value=>hash(canonical(value));
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
const terminal=new Set(['complete','draft_saved','rejected','needs_review']);
const continuationOwnerOf=state=>state.continuationOwner===undefined?'local':state.continuationOwner;
const optional=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
async function syncDirectory(directory){if(process.platform==='win32')return;const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
// The ACK follows file fsync, and directory fsync where supported. Windows
// cannot fsync directories through Node; the file is flushed before rename.
// A process exit after rename but before the response is recovered by the
// original deterministic ID.
async function durableCloudFile(file,contents){
 await mkdir(dirname(file),{recursive:true,mode:0o700});await syncDirectory(dirname(dirname(file)));const temporary=file+'.'+randomUUID()+'.tmp';
 try{const handle=await open(temporary,'wx',0o600);try{await protectPrivateFile(temporary);await handle.writeFile(contents);await handle.sync();}finally{await handle.close();}await rename(temporary,file);await syncDirectory(dirname(file));}
 finally{await rm(temporary,{force:true});}
}
export async function durableCloudJson(file,value){return durableCloudFile(file,JSON.stringify(value)+'\n');}
export const cloudJobId=(siteId,requestKey)=>hash([siteId,requestKey]);
function normalizedData(input,site){
 const data=validateNews(input,null,site);
 if(input.record){
  if(input.id!=='record-'+input.record.documentId)fail('Structured article identity mismatch');
  const fields=validateRecord(input.record.kind,{...input.record.fields,...(data.sectionId?{sectionId:data.sectionId}:{}),assets:data.assets},input.record.fields,site);delete fields.assets;
  data.record={...input.record,fields};
 }
 return data;
}
function publicationFingerprint(input,site){
 if(!input?.record)return 'news:'+fingerprint(normalizedData(input,site));
 const record=input.record;
 if(!['year','history','openSource'].includes(record.kind)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.documentId||'')||input.id!=='record-'+record.documentId||input.translationOf||input.locale&&input.locale!=='zh-CN')fail('Structured article identity mismatch',409);
 // The CMS reconstructs the envelope's summary, Markdown, display date and
 // column from its persisted record. Those display fields are not a revision
 // identity (and a valid record summary can exceed the news envelope limit).
 // Validate the actual fields and image bytes, then compare their stable hash.
 const normalized=validateRecord(record.kind,{...record.fields,...(input.sectionId?{sectionId:input.sectionId}:{}),assets:input.assets||[]},record.fields,site);
 const {assets=[],...fields}=normalized;
 return 'record:'+sourceContentSha256({id:input.id,record:{documentId:record.documentId,kind:record.kind,fields},assets});
}
function publicationMatches(actual,expected,site){
 if(!actual)return false;
 try{return publicationFingerprint(actual,site)===publicationFingerprint(expected,site);}catch{return false;}
}
function validatePacket(packet,site){
 if(!packet||typeof packet!=='object'||Array.isArray(packet)||typeof packet.requestKey!=='string'||!/^[a-zA-Z0-9_-]{12,128}$/.test(packet.requestKey))fail('Invalid publication request identity');
 if((packet.siteId!==undefined&&packet.siteId!==site.id)||(packet.origin!==undefined&&packet.origin!==site.origin)||(packet.spaceId!==undefined&&packet.spaceId!==site.spaceId))fail('Publication packet belongs to another site',409);
 if(!site.legacy&&(packet.siteId!==site.id||packet.origin!==site.origin))fail('A site-bound publication packet is required');
 if(!['publish','draft'].includes(packet.intent||'publish'))fail('Unsupported publication intent');
 if(!Number.isSafeInteger(packet.expectedVersion)||packet.expectedVersion<0||!(packet.expectedPublishedVersion===null||Number.isSafeInteger(packet.expectedPublishedVersion)&&packet.expectedPublishedVersion>0))fail('Missing optimistic publication versions');
 normalizedData(packet.data,site);
 if(Buffer.byteLength(JSON.stringify(packet))>CLOUD_PACKET_BYTES)fail('Publication package exceeds the website upload limit',413);
}
async function privateToken(file){
 if(!await isPrivateFile(file))throw Error('A private site token file is required');
 const token=(await readFile(file,'utf8')).trim();if(!token||token.length>4096)throw Error('The configured site token is invalid');return token;
}
const retryable=error=>[408,425,429].includes(error.statusCode)||error.statusCode>=500||!error.statusCode;
function receiptView(receipt){
 if(!receipt)return undefined;
 return {...Object.fromEntries(['requestKey','revision','version','publishedVersion','url','intent','submittedAt','checkedAt','publicReadback','status'].filter(key=>receipt[key]!==undefined).map(key=>[key,receipt[key]])),...(receipt.job?{job:{id:receipt.job.id,status:receipt.job.status,...(receipt.job.error?{error:String(receipt.job.error).slice(0,300)}:{})}}:{})};
}
function publicState(state){return {...Object.fromEntries(['jobId','siteId','articleId','requestKey','title','status','stage','createdAt','updatedAt','retryAt','error','duplicateOf','continuation'].filter(key=>state[key]!==undefined).map(key=>[key,state[key]])),continuationOwner:continuationOwnerOf(state),...(state.receipt?{receipt:receiptView(state.receipt)}:{})};}
export function createCloudQueue({directory,sites,fetcher=fetch,now=Date.now,continuation,maxSends=3,maxBuildRetries=3,maxFailures=12,pollMs=10000}={}){
 if(!isAbsolute(directory||'')||!Array.isArray(sites)||!sites.length)throw Error('Configure an absolute queue directory and site allowlist');
 const configured=new Map(),events=new EventEmitter(),authorizationCache=new Map(),authorizationChecks=new Map();let initialized,activeAuthorizations=0;
 for(const entry of sites){const site=validateSite(entry.site);if(configured.has(site.id)||!isAbsolute(entry.tokenFile||''))throw Error('Invalid cloud site allowlist');if(entry.workspaceRoot&&!isAbsolute(entry.workspaceRoot))throw Error('Cloud continuation workspace must be absolute');configured.set(site.id,{...entry,site});}
 const paths=jobId=>{if(!/^[a-f0-9]{64}$/.test(jobId||''))fail('Task not found',404);const dir=join(directory,'jobs',jobId);return {dir,packet:join(dir,'packet.json'),state:join(dir,'state.json'),lock:join(directory,'locks',jobId+'.lock')};};
 async function initialize(){return initialized||=(async()=>{await mkdir(directory,{recursive:true,mode:0o700});for(const name of ['jobs','pending','locks','article-locks','credentials','credential-locks'])await mkdir(join(directory,name),{recursive:true,mode:0o700});await syncDirectory(directory);await syncDirectory(dirname(directory));})();}
 async function markPending(state){const pointer=join(directory,'pending',state.jobId+'.json');if(terminal.has(state.status)){await rm(pointer,{force:true});await syncDirectory(dirname(pointer));}else if(!await optional(pointer))await durableCloudJson(pointer,{jobId:state.jobId});}
 function credentialPath(siteId,credentialId){if(!configured.has(siteId)||!/^[a-f0-9]{64}$/.test(credentialId||''))fail('Invalid submitting credential identity',401);return join(directory,'credentials',siteId,credentialId+'.token');}
 async function saveCredential(siteId,token){
  await initialize();const credentialId=hash(token),file=credentialPath(siteId,credentialId);let existing;try{existing=await privateToken(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing!==undefined&&existing!==token)throw Error('Submitting credential snapshot differs');
  if(existing===undefined)await durableCloudFile(file,token+'\n');return credentialId;
 }
 async function legacyCredentialId(siteId){return hash(await privateToken(configured.get(siteId).tokenFile));}
 async function owned(state,credentialId){return !credentialId||(state.credentialId||await legacyCredentialId(state.siteId))===credentialId;}
 async function authorize(siteId,bearer){
  const entry=configured.get(siteId);if(!entry)fail('Invalid site credential',401);
  const actual=typeof bearer==='string'&&bearer.startsWith('Bearer ')?bearer.slice(7):'';
  if(!actual||actual.length>4096||/[\x00-\x20\x7f]/.test(actual))fail('Invalid site credential',401);
  // The configured token is a compatibility principal, never a fallback for a
  // different submitter. Freeze its exact bytes too, so rotation cannot upgrade
  // an already accepted job's authority.
  let configuredToken;try{configuredToken=await privateToken(entry.tokenFile);}catch{fail('Site credentials are unavailable',503);}
  const credentialId=hash(actual),cacheKey=siteId+':'+credentialId;
  if(configuredToken&&timingSafeEqual(Buffer.from(hash(configuredToken),'hex'),Buffer.from(credentialId,'hex'))){await saveCredential(siteId,actual);return {...entry,credentialId};}
  if(authorizationCache.get(cacheKey)>now())return {...entry,credentialId};
  await initialize();
  return withFileLock(join(directory,'credential-locks',hash(cacheKey)+'.lock'),async()=>{
   if(authorizationCache.get(cacheKey)>now())return {...entry,credentialId};
   const window=authorizationChecks.get(siteId),checks=window&&window.start+60000>now()?window:{start:now(),count:0};
   if(activeAuthorizations>=8||checks.count>=60)fail('Site credential verification is busy; retry later',429);
   checks.count++;authorizationChecks.set(siteId,checks);activeAuthorizations++;
   try{
    await handshake(entry);
    const response=await fetcher(entry.site.origin+'/manage/api/news/catalog?scope=all&limit=1',{headers:{Authorization:'Bearer '+actual,'X-Scholay-Site':siteId,'X-Scholay-Protocol':'1'},redirect:'error',signal:AbortSignal.timeout(15000)});
    if([401,403].includes(response.status))fail('Site credential cannot access editorial content',response.status);
    if(!response.ok)fail('Site credential verification is temporarily unavailable',503);
    let value;try{value=await response.json();}catch{fail('Site credential verification is temporarily unavailable',503);}
    if(!Array.isArray(value?.items)||value.scope!==undefined&&value.scope!=='all')fail('Site credential verification is temporarily unavailable',503);
   }catch(error){if(error.statusCode)throw error;fail('Site credential verification is temporarily unavailable',503);}finally{activeAuthorizations--;}
   await saveCredential(siteId,actual);authorizationCache.delete(cacheKey);authorizationCache.set(cacheKey,now()+600000);while(authorizationCache.size>100)authorizationCache.delete(authorizationCache.keys().next().value);
   return {...entry,credentialId};
  },{timeout:20000});
 }
 async function enqueue(siteId,packet,{credentialId,continuationOwner='local'}={}){
  await initialize();
  if(!['local','cloud'].includes(continuationOwner))fail('Invalid continuation owner');
  if(continuationOwner==='cloud'&&!continuation)fail('Cloud continuation is unavailable',409);
  const entry=configured.get(siteId);if(!entry)fail('Unknown site',400);validatePacket(packet,entry.site);
  credentialId||=await saveCredential(siteId,await privateToken(entry.tokenFile));
  await privateToken(credentialPath(siteId,credentialId));
  const jobId=cloudJobId(siteId,packet.requestKey),p=paths(jobId);
  // An idempotent transport retry must not wait behind a network-bound worker.
  // A fully committed package/state can be acknowledged without mutating it.
  const knownPacket=await optional(p.packet),knownState=await optional(p.state);
  if(knownPacket&&fingerprint(knownPacket)!==fingerprint(packet)||knownState&&knownState.packetSha256!==fingerprint(packet))fail('This request key already has another immutable publication package',409);
  if(knownState&&(knownState.siteId!==siteId||knownState.requestKey!==packet.requestKey))throw Error('Corrupt cloud publication identity');
  if(knownState&&!await owned(knownState,credentialId))fail('This request key belongs to another submitting credential',409);
  if(knownState&&continuationOwnerOf(knownState)!==continuationOwner)fail('This request key already has another continuation owner',409);
  if(knownPacket&&knownState&&(terminal.has(knownState.status)||await optional(join(directory,'pending',jobId+'.json'))))return {accepted:true,...publicState(knownState)};
  const result=await withFileLock(p.lock,async()=>{
   const saved=await optional(p.packet);
   if(saved&&fingerprint(saved)!==fingerprint(packet))fail('This request key already has another immutable publication package',409);
   let state=await optional(p.state);
   if(state&&state.packetSha256!==fingerprint(packet))fail('This request key already has another immutable publication package',409);
   if(state&&!await owned(state,credentialId))fail('This request key belongs to another submitting credential',409);
   if(state&&continuationOwnerOf(state)!==continuationOwner)fail('This request key already has another continuation owner',409);
   if(!saved)await durableCloudJson(p.packet,packet);
   if(state&&(state.siteId!==siteId||state.requestKey!==packet.requestKey))throw Error('Corrupt cloud publication identity');
   if(!state){state={version:1,jobId,siteId,articleId:packet.data.id,requestKey:packet.requestKey,credentialId,continuationOwner,title:packet.data.title,status:'queued',stage:'accepted',createdAt:new Date(now()).toISOString(),updatedAt:new Date(now()).toISOString(),packetSha256:fingerprint(packet),sends:0,failures:0};await durableCloudJson(p.state,state);}
   await markPending(state);return {accepted:true,...publicState(state)};
  });events.emit('wake');return result;
 }
 async function view(state){
  const result=publicState(state),root=configured.get(state.siteId)?.workspaceRoot,id=state.continuation?.id;
  if(root&&/^[a-f0-9]{40}$/.test(id||'')){
   const flow=await optional(join(root,'.local/publishing-flow/jobs',id,'state.json'));
   if(flow){const stage=value=>value?Object.fromEntries(['status','url','revision','error'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]])):undefined;result.continuation={...result.continuation,status:flow.complete?'complete':flow.status||'queued',complete:flow.complete===true,...(flow.english?{english:stage(flow.english)}:{}),...(flow.community?{community:stage(flow.community)}:{}),...(flow.translation?{translation:stage(flow.translation)}:{}),...(flow.error?{error:String(flow.error).slice(0,300)}:{})};}
  }
  return result;
 }
 async function get(siteId,jobId,{credentialId}={}){const state=await optional(paths(jobId).state);if(!state||state.siteId!==siteId||!await owned(state,credentialId))fail('Task not found',404);return {accepted:true,...await view(state)};}
 async function continuationArtifact(siteId,jobId,{credentialId}={}){
  const state=await optional(paths(jobId).state);
  if(!credentialId||!state||state.siteId!==siteId||state.credentialId!==credentialId||!await owned(state,credentialId)||state.continuationOwner!=='cloud'||!CLOUD_CONTINUATION_SITES.includes(siteId))fail('Cloud continuation not found',404);
  const pending={version:1,status:'pending',jobId,siteId,articleId:state.articleId,requestKey:state.requestKey,continuationOwner:'cloud'};
  const entry=configured.get(siteId),id=state.continuation?.id;
  if(state.status!=='complete'||!entry.workspaceRoot||!/^[a-f0-9]{40}$/.test(id||''))return pending;
  const directory=join(entry.workspaceRoot,'.local/publishing-flow/jobs',id),flow=await optional(join(directory,'state.json'));
  if(!flow?.complete)return pending;
  const packet=await optional(paths(jobId).packet),plan=await optional(join(directory,'plan.json')),publication=await optional(join(directory,'website-en.json'));
  if(!packet||fingerprint(packet)!==state.packetSha256||cloudJobId(siteId,packet.requestKey)!==jobId||!plan)fail('Cloud continuation evidence is unavailable',409);
  return createCloudContinuationArtifact({queueState:state,packet,plan,state:flow,publication,site:entry.site});
 }
 async function recoveryPacket(siteId,jobId,{credentialId}={}){
  const p=paths(jobId),state=await optional(p.state);
  if(!credentialId||!state||state.siteId!==siteId||state.credentialId!==credentialId||!await owned(state,credentialId)||state.continuationOwner!=='cloud'||!CLOUD_CONTINUATION_SITES.includes(siteId))fail('Cloud recovery packet not found',404);
  const packet=await optional(p.packet),receipt=state.receipt,entry=configured.get(siteId);
  if(!packet||fingerprint(packet)!==state.packetSha256||cloudJobId(siteId,packet.requestKey)!==jobId||packet.requestKey!==state.requestKey||packet.data.id!==state.articleId||state.status!=='complete'||receipt?.requestKey!==state.requestKey||!receipt.publicReadback||receipt.job?.status!=='success')fail('The original published cloud request is not ready for recovery',409);
  validatePacket(packet,entry.site);
  // Unknown transport or content fields are refused, never echoed as secrets.
  if(fingerprint(normalizedData(packet.data,entry.site))!==fingerprint(packet.data))fail('The original publication contains unsupported recovery fields',409);
  return validateRecoveryPacket({version:1,status:'ready',jobId,siteId,articleId:state.articleId,requestKey:state.requestKey,continuationOwner:'cloud',packetSha256:state.packetSha256,sourceSha256:sourceContentSha256(packet.data),packet,receipt:{requestKey:receipt.requestKey,revision:receipt.revision,url:receipt.url,publicReadback:true,job:{id:receipt.job.id,status:receipt.job.status}}},{jobId,siteId,articleId:state.articleId,requestKey:state.requestKey,origin:entry.site.origin});
 }
 async function allStates(){const names=await readdir(join(directory,'jobs')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});const values=[];for(const id of names.filter(name=>/^[a-f0-9]{64}$/.test(name))){const state=await optional(paths(id).state);if(state)values.push(state);}return values.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.jobId.localeCompare(b.jobId));}
 async function list(siteId,{limit=100,credentialId}={}){const states=[];for(const state of (await allStates()).filter(state=>state.siteId===siteId).reverse()){if(await owned(state,credentialId))states.push(state);if(states.length>=Math.max(1,Math.min(100,limit)))break;}return Promise.all(states.map(view));}
 async function api(entry,path,body){
  const token=await privateToken(entry.tokenFile),response=await fetcher(entry.site.origin+'/manage/api/news'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'X-Scholay-Site':entry.site.id,'X-Scholay-Protocol':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
  let result;try{result=await response.json();}catch{throw Object.assign(Error('Website returned a non-JSON response'),{statusCode:response.status>=400?response.status:502});}
  if(!response.ok){const value=Number(response.headers.get('retry-after'));throw Object.assign(Error(response.status===409&&result?.code==='duplicate_source'?'Resource link already has a record; update that record instead':'Website request failed (HTTP '+response.status+')'),{statusCode:response.status,retryAfterMs:Number.isFinite(value)?Math.max(0,Math.min(value*1000,3600000)):0,...(result?.code==='duplicate_source'?{code:result.code,existing:result.existing}:{})});}return result;
 }
 async function handshake(entry){const response=await fetcher(entry.site.origin+'/manage/api/site',{redirect:'error',signal:AbortSignal.timeout(15000)});let data;try{data=await response.json();}catch{throw Object.assign(Error('Website identity response is invalid'),{statusCode:502});}if(!response.ok)throw Object.assign(Error('Website identity lookup failed'),{statusCode:response.status});if(data.protocol!=='scholay-content'||data.version!==1||data.siteId!==entry.site.id||data.origin!==entry.site.origin)fail('Website identity does not match the configured site',409);return data;}
 async function verify(entry,packet,receipt,{requireCurrentVersion=false}={}){
  const site=entry.site,remote=await api(entry,'/'+packet.data.id);
  if(!Number.isSafeInteger(receipt.revision)||remote.publishedVersion!==receipt.revision||requireCurrentVersion&&remote.version!==receipt.revision||!publicationMatches(remote.published,packet.data,site))fail('The currently published article differs from this task',409);
  const path=packet.data.record?remote.url:editionRoute(packet.data);
  if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||receipt.url!==path||new URL(path,site.origin).origin!==site.origin)fail('Website publication URL does not match the article',409);
  const url=site.origin+path,response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(30000)}),html=await response.text();
  if(!response.ok||!html.includes('<link rel="canonical" href="'+url+'">')||!packet.data.record&&!articleBodyOnPage(html,packet.data.markdown,site)||packet.data.locale==='en'&&!/<html[^>]*lang="en"/.test(html))throw Object.assign(Error('The public page is not ready for this article version'),{statusCode:503});
  return {...receipt,requestKey:packet.requestKey,publicReadback:true,checkedAt:new Date(now()).toISOString()};
 }
 async function persist(p,state){state.updatedAt=new Date(now()).toISOString();await durableCloudJson(p.state,state);await markPending(state);}
 async function execute(jobId){const p=paths(jobId);return withFileLock(p.lock,async()=>{
  const state=await optional(p.state);if(!state||terminal.has(state.status)||state.retryAt>now()){if(state&&terminal.has(state.status))await markPending(state);return state&&publicState(state);}
  const configuredEntry=configured.get(state.siteId),packet=await optional(p.packet);let entry=configuredEntry;
  try{
   if(!['local','cloud'].includes(continuationOwnerOf(state)))fail('Frozen continuation owner is invalid; review required',409);
   if(state.credentialId){entry={...configuredEntry,tokenFile:credentialPath(state.siteId,state.credentialId)};try{await privateToken(entry.tokenFile);}catch{fail('Original submitting credential is unavailable; review required',409);}}
   if(!entry||!packet||fingerprint(packet)!==state.packetSha256||cloudJobId(state.siteId,packet.requestKey)!==jobId)fail('The durable publication package is missing or changed',409);
   validatePacket(packet,entry.site);state.status='running';state.stage='checking';delete state.error;await persist(p,state);await handshake(entry);
   const draft=(packet.intent||'publish')==='draft',lookup=(draft?'/drafts/requests/':'/requests/')+packet.requestKey;let receipt;
   // No POST follows an ambiguous lookup: only an authoritative 404 permits
   // the original immutable request to be submitted again.
   try{receipt=await api(entry,lookup);}catch(error){
    if(error.statusCode!==404)throw error;
    if(state.sends>=maxSends)fail('Original request remains absent after bounded replay; review required',409);
    state.sends++;state.stage='submitting';state.intendedAt=new Date(now()).toISOString();state.submittedAt||=state.intendedAt;await persist(p,state);
    receipt=await api(entry,draft?'/drafts':'/publish',packet);
   }
   state.receipt={...receipt,requestKey:packet.requestKey,intent:packet.intent||'publish',submittedAt:state.submittedAt||state.createdAt};
   if(draft){
    if(!Number.isSafeInteger(receipt.revision))throw Error('Incomplete website draft receipt');
    const remote=await api(entry,'/cloud/'+packet.data.id);
    if(remote.version!==receipt.revision||!publicationMatches(remote.data,packet.data,entry.site))fail('The saved cloud draft differs from this task',409);
    state.status='draft_saved';state.stage='saved';delete state.retryAt;state.failures=0;await persist(p,state);return publicState(state);
   }
   if(!receipt.job||!['queued','running','failed','success'].includes(receipt.job.status))throw Error('Incomplete website publication receipt');
   if(receipt.job.status==='failed'){
    if((state.buildRetries||0)>=maxBuildRetries)fail('Website build failed after bounded recovery',409);
    const live=await api(entry,'/'+packet.data.id);
    if(live.version!==receipt.revision||!publicationMatches(live.data,packet.data,entry.site))fail('Website source changed before build recovery',409);
    state.buildRetries=(state.buildRetries||0)+1;state.stage='retrying_build';await persist(p,state);
    state.receipt={...state.receipt,...await api(entry,lookup+'/retry',{jobId:receipt.job.id})};
   }else if(receipt.job.status==='success'){
    state.stage='verifying';await persist(p,state);state.receipt=await verify(entry,packet,state.receipt);await persist(p,state);
    // Frozen source identity deduplicates this handoff even after a crash here.
    // Ownership belongs to the accepted transport envelope, not the current
    // server policy. Legacy envelopes remain local even after cloud rollout.
    if(state.continuationOwner==='cloud'){
     try{
      if(!continuation||!state.credentialId)fail('Cloud continuation authority is unavailable; review required',409);
      state.continuation=await continuation({entry,site:entry.site,packet,receipt:state.receipt,credentialId:state.credentialId});
     }catch(error){state.continuation={status:'deferred',error:'Publication is verified; continuation handoff is pending'};throw Object.assign(Error('Continuation handoff could not retain its original authority'),{statusCode:error.statusCode||503});}
    }
    state.status='complete';state.stage='published';delete state.retryAt;state.failures=0;await persist(p,state);return publicState(state);
   }
   state.status='waiting';state.stage='building';state.retryAt=now()+pollMs;state.failures=0;await persist(p,state);
  }catch(error){
   if(error.code==='duplicate_source'){
    // A retry can never succeed: the link belongs to another record. Keep the
    // package and name that record so the update can go to it.
    state.status='rejected';state.stage='rejected';state.error=String(error.message).slice(0,300);state.duplicateOf=error.existing?.articleId;delete state.retryAt;await persist(p,state);return publicState(state);
   }
   state.failures=(state.failures||0)+1;state.error=error.statusCode?String(error.message).slice(0,300):'The execution service could not finish this step; retained for recovery';
   if(!retryable(error)||state.failures>=maxFailures){state.status=error.statusCode===409?'needs_review':error.statusCode>=400&&error.statusCode<500?'rejected':'needs_review';delete state.retryAt;}
   else{state.status='retry_wait';state.retryAt=now()+Math.max(error.retryAfterMs||0,Math.min(300000,10000*2**Math.min(state.failures-1,5)));}
   await persist(p,state);
  }
  return publicState(state);
 },{timeout:100});}
 // Operator closure of a job that stopped for review before the website ever
// accepted it. Every website call is a GET: any request on the site for this
// key means the job must be verified, never closed. Package and receipt stay.
 async function close(siteId,jobId,{reason}={}){
  await initialize();const p=paths(jobId);
  if(!['duplicate_source'].includes(reason))fail('A supported closing reason is required');
  return withFileLock(join(directory,'worker.lock'),async()=>{
   const original=await optional(p.state);if(!original||original.siteId!==siteId)fail('Task not found',404);
   return withFileLock(join(directory,'article-locks',hash([siteId,original.articleId])+'.lock'),()=>withFileLock(p.lock,async()=>{
    const state=await optional(p.state),packet=await optional(p.packet),configuredEntry=configured.get(siteId);
    if(!state||!configuredEntry||state.siteId!==siteId||!packet||fingerprint(packet)!==state.packetSha256||cloudJobId(siteId,packet.requestKey)!==jobId||packet.requestKey!==state.requestKey)fail('The durable publication package is missing or changed',409);
    if(state.status==='rejected'&&state.closedReason===reason)return view(state);
    if(state.status!=='needs_review'||state.receipt||(packet.intent||'publish')!=='publish'||packet.data.record?.kind!=='openSource')fail('Only an unsent open-source record held for review can be closed',409);
    if(!state.credentialId)fail('Original publication authority is unavailable',409);
    const entry={...configuredEntry,tokenFile:credentialPath(siteId,state.credentialId)};await privateToken(entry.tokenFile);validatePacket(packet,entry.site);await handshake(entry);
    try{await api(entry,'/requests/'+state.requestKey);fail('The website already has this request; verify it instead of closing it',409);}
    catch(error){if(error.statusCode!==404)throw error;}
    // The link must belong to a different, existing record.
    const key='openSource:'+packet.data.record.fields?.url;let owner,after=0;
    for(let page=0;page<50&&!owner&&after!==null;page++){const catalog=await api(entry,'/catalog?scope=all&limit=100&after='+after);owner=catalog.items.find(item=>item.key===key&&item.documentId!==packet.data.record.documentId);after=catalog.next;}
    if(!owner)fail('No other record owns this link; leave the job for review',409);
    state.status='rejected';state.stage='rejected';state.closedReason=reason;state.closedAt=new Date(now()).toISOString();state.duplicateOf='record-'+owner.documentId;state.error='Resource link already has a record; update that record instead';delete state.retryAt;await persist(p,state);
    return view(state);
   }),{timeout:100});
  });
 }
 async function reverify(siteId,jobId){
  await initialize();const p=paths(jobId);
  // Local operator recovery is intentionally separate from the submission
  // worker: every website call below is GET, including a missing request.
  return withFileLock(join(directory,'worker.lock'),async()=>{
   const original=await optional(p.state);if(!original||original.siteId!==siteId)fail('Task not found',404);
   return withFileLock(join(directory,'article-locks',hash([siteId,original.articleId])+'.lock'),()=>withFileLock(p.lock,async()=>{
    const state=await optional(p.state),packet=await optional(p.packet),configuredEntry=configured.get(siteId);
    if(!state||!configuredEntry||state.siteId!==siteId||state.articleId!==original.articleId||!packet||fingerprint(packet)!==state.packetSha256||cloudJobId(siteId,packet.requestKey)!==jobId||packet.requestKey!==state.requestKey||packet.data.id!==state.articleId)fail('The durable publication package is missing or changed',409);
    if(state.status==='complete'&&state.reverification)return {reverified:true,...await view(state)};
    if(state.status!=='needs_review'||state.stage!=='verifying'||state.error!=='The currently published article differs from this task'||!packet.data.record||(packet.intent||'publish')!=='publish'||state.receipt?.job?.status!=='success'||typeof state.receipt.job.id!=='string'||!state.receipt.job.id||!Number.isSafeInteger(state.receipt.revision)||state.receipt.revision<1||state.receipt.requestKey!==state.requestKey)fail('Only a retained structured publication readback mismatch can be reverified',409);
    if(!state.credentialId||!['local','cloud'].includes(continuationOwnerOf(state)))fail('Original publication authority is unavailable',409);
    const entry={...configuredEntry,tokenFile:credentialPath(siteId,state.credentialId)};await privateToken(entry.tokenFile);validatePacket(packet,entry.site);await handshake(entry);
    const receipt=await api(entry,'/requests/'+state.requestKey);
    if(receipt.articleId!==state.articleId||receipt.revision!==state.receipt.revision||receipt.url!==state.receipt.url||receipt.job?.id!==state.receipt.job.id||receipt.job?.status!=='success')fail('The original successful publication request no longer matches',409);
    const verified=await verify(entry,packet,{...state.receipt,...receipt},{requireCurrentVersion:true});
    let resumed=state.continuation;
    if(state.continuationOwner==='cloud'){
     if(!continuation)fail('Cloud continuation is unavailable',409);
     resumed=await continuation({entry,site:entry.site,packet,receipt:verified,credentialId:state.credentialId});
    }
    state.reverification={version:1,at:new Date(now()).toISOString(),previousError:state.error,revision:verified.revision,websiteJobId:verified.job.id};
    state.receipt=verified;if(resumed)state.continuation=resumed;state.status='complete';state.stage='published';state.failures=0;delete state.error;delete state.retryAt;await persist(p,state);
    return {reverified:true,...await view(state)};
   }),{timeout:100});
  },{timeout:100});
 }
 async function tick({limit=3}={}){await initialize();return withFileLock(join(directory,'worker.lock'),async()=>{const names=await readdir(join(directory,'pending')),ready=[];for(const name of names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name))){const state=await optional(paths(name.slice(0,-5)).state);if(!state)throw Error('Pending cloud task has no durable state');if(terminal.has(state.status)){await markPending(state);continue;}if(!(state.retryAt>now()))ready.push(state);}ready.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.jobId.localeCompare(b.jobId));const result=[];for(const state of ready.slice(0,limit))result.push(await withFileLock(join(directory,'article-locks',hash([state.siteId,state.articleId])+'.lock'),()=>execute(state.jobId),{timeout:100}));return result;},{timeout:100});}
 function wait(milliseconds,signal){return new Promise(resolve=>{if(signal?.aborted)return resolve();const finish=()=>{clearTimeout(timer);events.off('wake',finish);signal?.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,milliseconds);events.once('wake',finish);signal?.addEventListener('abort',finish,{once:true});});}
 return {authorize,enqueue,get,list,continuationArtifact,recoveryPacket,reverify,close,tick,wait,configured};
}
export async function runCloudQueueWorker({queue,signal,intervalMs=30000,onTick=()=>{}}){while(!signal?.aborted){try{const results=await queue.tick();if(results.length)onTick(results);}catch(error){if(!String(error.message).startsWith('文件正在保存'))throw error;}if(!signal?.aborted)await queue.wait(intervalMs,signal);}}
