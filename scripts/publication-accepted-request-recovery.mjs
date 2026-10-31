// Recover the original batch-owned request when a later request was also
// accepted for exactly the same publication. Neither remote request is changed.
import {readFile,readdir} from 'node:fs/promises';
import {join,isAbsolute,resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {validateSite,publicationDirectory} from './site-config.mjs';
import {CLOUD_CONTINUATION_SITES,continuationArtifactSha256} from './publishing-flow-artifact.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {publicationQueueClient,cloudPublicationJobId,validateQueueEndpoint} from './publication-queue-client.mjs';
import {queuePublicationBinding,indexPublicationQueue} from './publication-queue-status.mjs';
import {isPrivateFile} from './private-file.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {durableWriteJson} from './durable-json.mjs';

const optional=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const hex=(value,length=64)=>typeof value==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(value);
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{3,128}$/.test(value);
const requestKey=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{12,128}$/.test(value);
const fail=message=>{throw Error('Accepted cloud request recovery: '+message);};
const expectedKeys=['articleId','originalRequestKey','originalJobId','laterRequestKey','laterJobId','planId','revision','expectedSourceSha256','batchId','manifestSha256','section'];

export function assertAcceptedRecoveryEnvironment(){
 for(const name of ['SCHOLAY_TODAY_TOKEN','SCHOLAY_TODAY_TOKEN_FILE','SCHOLAY_TODAY_ORIGIN','SCHOLAY_SITE_ID','SCHOLAY_SITE_CONFIG','SCHOLAY_SITE_JSON','SCHOLAY_PUBLICATION_QUEUE_CONFIG'])if(process.env[name])fail('use a neutral environment and the original private site credential file');
}

// Deliberately use the same frozen-results precedence as the batch/cohort gate.
// This only proves an original owner; it creates no Postiz authorization.
async function batchOwner(input,site,directory){
 const e=input.expected,current=await optional(join(input.handoffDirectory,'today-batch.json'));
 if(current?.version!==1||!['idle','producing','settled','complete'].includes(current.status))fail('retain the valid original batch gate');
 const states=current.status==='idle'?[]:[current];
 const names=await readdir(join(input.handoffDirectory,'today-batches')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
 for(const name of names.filter(name=>name.endsWith('.json')).sort()){
  if(!id(name.slice(0,-5)))continue;
  const state=await optional(join(input.handoffDirectory,'today-batches',name));
  if(state?.id+'.json'!==name)fail('an archived batch identity changed');states.push(state);
 }
 const seen=new Set(),owners=[];
 for(const state of states){
  if(state?.version!==1||!id(state.id)||seen.has(state.id)||!['producing','settled','complete'].includes(state.status)||!Array.isArray(state.baselineResults)||!Array.isArray(state.manifest?.entries)||!isAbsolute(state.manifest.resultsDirectory||''))fail('invalid or ambiguous retained batch');
  seen.add(state.id);let results=state.productionResults;
  if(results===undefined){
   results=[];const baseline=new Set(state.baselineResults);
   for(const name of (await readdir(state.manifest.resultsDirectory)).filter(name=>name.endsWith('.result.json')&&!baseline.has(name)).sort())results.push(await optional(join(state.manifest.resultsDirectory,name)));
  }
  if(!Array.isArray(results))fail('invalid frozen producer results');
  const matches=results.filter(result=>result?.site===site.id&&result.articleId===e.articleId&&!result.noPublish);
  if(matches.length)owners.push({state,matches});
 }
 if(owners.length!==1||owners[0].state.id!==e.batchId)fail('the article has no unique original batch owner');
 const {state,matches}=owners[0];
 if(hash(state.manifest)!==e.manifestSha256||matches.some(result=>site.id+'/'+result.sectionId!==e.section||result.requestKey!==e.originalRequestKey))fail('the original manifest, section or producer request differs');
 const entries=state.manifest.entries.filter(entry=>entry.siteId+'/'+entry.sectionId===e.section);
 if(entries.length!==1||!entries[0].requireFlow||resolve(entries[0].root||'')!==resolve(input.root)||resolve(entries[0].publicationDirectory||'')!==resolve(directory))fail('the original batch workspace differs');
 return {batchId:e.batchId,manifestSha256:e.manifestSha256,section:e.section,resultsSha256:continuationArtifactSha256(matches)};
}

function acceptedReceipt(receipt,site,e,key,jobId,endpoint){
 const q=receipt?.asyncQueue;
 if(receipt?.requestKey!==key||receipt.intent!=='publish'||receipt.publicReadback!==true||receipt.job?.status!=='success'||!receipt.job.id||receipt.revision!==e.revision||q?.owner!=='cloud'||q.continuationOwner!=='cloud'||q.jobId!==jobId||!q.binding||q.binding.version!==1||q.continuation?.id!==e.planId||receipt.publishingFlow?.id&&receipt.publishingFlow.id!==e.planId)fail('retain both exact accepted cloud receipts and their frozen flow identities');
 if(validateQueueEndpoint(q.endpoint)!==endpoint)fail('both accepted requests must use the same original queue endpoint');
 if(q.binding.siteId!==site.id||q.binding.origin!==site.origin||q.binding.articleId!==e.articleId)fail('an accepted receipt belongs to another source or site');
}
function localPacket(response,receipt,site){
 const packet=structuredClone(response.packet);
 if(hash(packet)!==receipt.asyncQueue.packetSha256&&site.legacy){delete packet.siteId;delete packet.spaceId;delete packet.origin;}
 queuePublicationBinding(site,packet,receipt);return packet;
}
function publicationResult(value,receipt,articleId){
 if(value?.requestKey!==undefined&&value.requestKey!==receipt.requestKey||value?.articleId!==undefined&&value.articleId!==articleId||value?.revision!==receipt.revision||value.url!==receipt.url||value.job?.id!==receipt.job.id||value.job.status!=='success')fail('an original website request no longer matches its successful receipt');
}
function pointerIntent(pointer,input,site){
 if(!exact(pointer,['version','phase','intentSha256','intent'])||pointer.version!==1||!['prepared','committed'].includes(pointer.phase)||continuationArtifactSha256(pointer.intent)!==pointer.intentSha256||pointer.intent.mode!=='accepted-equivalent'||pointer.intent.siteId!==site.id||pointer.intent.origin!==site.origin||pointer.intent.localId!==input.localId||!isDeepStrictEqual(pointer.intent.expected,input.expected))fail('resume the exact retained recovery; never replace an incomplete intent');
 return pointer.intent;
}

export async function restoreEquivalentAcceptedCloudRequest(input,{fetcher=fetch,writeJson=durableWriteJson,index=indexPublicationQueue}={}){
 assertAcceptedRecoveryEnvironment();
 if(!exact(input,['version','mode','root','site','tokenFile','localId','handoffDirectory','expected'])||input.version!==1||input.mode!=='accepted-equivalent'||!isAbsolute(input.root||'')||!isAbsolute(input.tokenFile||'')||!isAbsolute(input.handoffDirectory||'')||typeof input.localId!=='string'||!/^[a-z0-9][a-z0-9-]{2,99}$/.test(input.localId))fail('use an exact site-bound accepted-equivalent recovery input');
 const site=validateSite(input.site),bound=await optional(join(input.root,'.site.json')),e=input.expected;
 if(!CLOUD_CONTINUATION_SITES.includes(site.id)||bound?.id!==site.id||bound.origin!==site.origin)fail('the recovery workspace site identity differs');
 if(!exact(e,expectedKeys)||typeof e.articleId!=='string'||!/^[a-z0-9][a-z0-9-]{2,99}$/.test(e.articleId)||e.articleId!==input.localId||!requestKey(e.originalRequestKey)||!requestKey(e.laterRequestKey)||e.originalRequestKey===e.laterRequestKey||e.originalJobId!==cloudPublicationJobId(site.id,e.originalRequestKey)||e.laterJobId!==cloudPublicationJobId(site.id,e.laterRequestKey)||!hex(e.planId,40)||!Number.isSafeInteger(e.revision)||e.revision<1||!hex(e.expectedSourceSha256)||!id(e.batchId)||!hex(e.manifestSha256)||typeof e.section!=='string'||!e.section.startsWith(site.id+'/')||e.planId!==hash([site.id,e.articleId,e.revision,e.expectedSourceSha256]).slice(0,40))fail('name both exact jobs, original batch, source revision and flow');
 const publications=publicationDirectory(input.root),directory=join(publications,input.localId),paths={packet:join(directory,'prepared.json'),receipt:join(directory,'receipt.json')};
 return withFileLock(join(directory,'queue-worker.lock'),()=>withFileLock(join(directory,'operation.lock'),async()=>{
  const {assertCloudArtifactSupersessionSettled}=await import('./publishing-flow-artifact.mjs');
  for(const jobId of [e.originalJobId,e.laterJobId])await assertCloudArtifactSupersessionSettled({root:input.root,jobId});
  const pointerPath=join(directory,'cloud-request-recovery.json'),retained=await optional(pointerPath);
  if(retained&&(!exact(retained,['version','phase','intentSha256','intent'])||retained.version!==1||!['prepared','committed'].includes(retained.phase)||continuationArtifactSha256(retained.intent)!==retained.intentSha256))fail('the retained durable recovery pointer is invalid');
  const same=retained?.intent?.mode==='accepted-equivalent'&&isDeepStrictEqual(retained.intent.expected,e),resume=same?pointerIntent(retained,input,site):null;
  if(retained&&!same&&retained.phase!=='committed')fail('another durable recovery must finish first');
  const currentPacket=await optional(paths.packet),currentReceipt=await optional(paths.receipt),journalPath=join(directory,'accepted-equivalent',e.laterRequestKey+'.json');
  const owner=await batchOwner(input,site,publications);
  if(resume&&retained.phase==='committed'){
   if(!isDeepStrictEqual(await optional(journalPath),resume)||!isDeepStrictEqual(owner,resume.owner)||!isDeepStrictEqual(currentPacket,resume.restored.packet)||currentReceipt?.requestKey!==e.originalRequestKey||currentReceipt.asyncQueue?.owner!=='cloud'||currentReceipt.asyncQueue.jobId!==e.originalJobId)fail('a later publication or immutable journal changed; do not rewind it');
   queuePublicationBinding(site,currentPacket,currentReceipt);
   return {status:'restored',alreadyRestored:true,articleId:e.articleId,requestKey:e.originalRequestKey,jobId:e.originalJobId,retainedAcceptedRequestKey:e.laterRequestKey};
  }
  const laterReceipt=resume?.retainedAccepted.receipt||currentReceipt,archivePath=join(directory,'receipt-'+e.originalRequestKey+'.json'),archive=await optional(archivePath),syncPath=join(directory,'sync.json'),sync=await optional(syncPath);
  const endpoint=validateQueueEndpoint(archive?.asyncQueue?.endpoint);
  acceptedReceipt(archive,site,e,e.originalRequestKey,e.originalJobId,endpoint);acceptedReceipt(laterReceipt,site,e,e.laterRequestKey,e.laterJobId,endpoint);
  if(archive.url!==laterReceipt.url)fail('the accepted requests name different published URLs');
  if(sync?.requestKey!==e.originalRequestKey||sync.remoteId!==e.articleId||sync.revision!==e.revision||sync.cloudRevision!==e.revision||sync.publishedRevision!==e.revision)fail('retain the original published synchronization baseline');
  // One explicitly private credential is used for every GET; environment and
  // configured service credentials can never provide a more privileged fallback.
  if(!await isPrivateFile(input.tokenFile))fail('the original site credential file must be private');
  const token=(await readFile(input.tokenFile,'utf8')).trim();if(!token||token.length>4096||/[\x00-\x20\x7f]/.test(token))fail('the original site credential is invalid');
  const client=publicationQueueClient({endpoint,site,token,fetcher});
  const responses=[];
  for(const receipt of [archive,laterReceipt]){
   const jobId=receipt.asyncQueue.jobId,response=await client.recoveryPacket(jobId,{articleId:e.articleId,requestKey:receipt.requestKey}),packet=localPacket(response,receipt,site);
   publicationResult(response.receipt,receipt,e.articleId);
   if(response.sourceSha256!==e.expectedSourceSha256)fail('the frozen source differs from the confirmed content');
   const status=await client.status(jobId,response.packet,{continuationOwner:'cloud'});
   if(status.jobId!==jobId||status.siteId!==site.id||status.articleId!==e.articleId||status.status!=='complete'||status.continuation?.id!==e.planId)fail('both original cloud jobs must be complete and bound to the same flow');
   publicationResult(status.receipt,receipt,e.articleId);
   if(status.receipt.publicReadback!==true)fail('both cloud jobs must retain verified publication readback');
   responses.push({response,packet});
  }
  const [{packet,response},{packet:laterPacket,response:laterResponse}]=responses;
  if(packet.sourceSha256!==laterPacket.sourceSha256||!isDeepStrictEqual(packet.data,laterPacket.data))fail('the accepted requests differ in content, metadata or asset bytes');
  const website=async path=>{
   const response=await fetcher(site.origin+'/manage/api/news'+path,{method:'GET',headers:{Authorization:'Bearer '+token,'X-Scholay-Site':site.id,'X-Scholay-Protocol':'1'},redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Object.assign(Error('Original website GET failed (HTTP '+response.status+')'),{statusCode:response.status});return response.json();
  };
  for(const receipt of [archive,laterReceipt]){
   const result=await website('/requests/'+receipt.requestKey);publicationResult(result,receipt,e.articleId);
   if(result.articleId!==e.articleId)fail('an original website request has no exact article identity');
  }
  const remote=await website('/'+e.articleId);
  if(remote.version!==e.revision||remote.publishedVersion!==e.revision||sourceContentSha256(remote.published||{})!==e.expectedSourceSha256||!isDeepStrictEqual(remote.data,packet.data)||!isDeepStrictEqual(remote.published,packet.data))fail('the current website revision, metadata or asset bytes differ');
  const intent={version:1,mode:'accepted-equivalent',siteId:site.id,origin:site.origin,localId:input.localId,expected:structuredClone(e),owner,retainedAccepted:{requestKey:e.laterRequestKey,packet:laterPacket,receipt:laterReceipt,localPacket:resume?resume.retainedAccepted.localPacket:currentPacket},restored:{packet,receipt:archive},syncSha256:hash(sync),archiveSha256:hash(archive),packets:[response,laterResponse].map(value=>({jobId:value.jobId,packetSha256:value.packetSha256,sourceSha256:value.sourceSha256}))};
  if(resume&&!isDeepStrictEqual(resume,intent))fail('the retained recovery evidence changed');
  if(resume){
   if(![hash(resume.retainedAccepted.localPacket),hash(packet)].includes(hash(currentPacket))||![hash(laterReceipt),hash(archive)].includes(hash(currentReceipt)))fail('publication files changed outside the pending recovery');
  }else if(currentReceipt?.requestKey!==e.laterRequestKey||currentPacket&&!isDeepStrictEqual(currentPacket,laterPacket))fail('the current prepared request is not the exact later accepted request');
  if(hash(await optional(paths.packet))!==hash(currentPacket)||hash(await optional(paths.receipt))!==hash(currentReceipt)||hash(await optional(syncPath))!==intent.syncSha256||hash(await optional(archivePath))!==intent.archiveSha256||!isDeepStrictEqual(await batchOwner(input,site,publications),owner))fail('local evidence changed during read-only verification');
  const priorJournal=await optional(journalPath);if(priorJournal&&!isDeepStrictEqual(priorJournal,intent))fail('the immutable accepted-request journal already differs');
  const pointer={version:1,phase:'prepared',intentSha256:continuationArtifactSha256(intent),intent};
  if(!resume)await writeJson(pointerPath,pointer);
  if(!priorJournal)await writeJson(journalPath,intent);
  if(!isDeepStrictEqual(currentPacket,packet))await writeJson(paths.packet,packet);
  if(!isDeepStrictEqual(currentReceipt,archive))await writeJson(paths.receipt,archive);
  await index(input.root,site,input.localId,packet.data.title);
  await writeJson(pointerPath,{...pointer,phase:'committed'});
  return {status:'restored',articleId:e.articleId,requestKey:e.originalRequestKey,jobId:e.originalJobId,retainedAcceptedRequestKey:e.laterRequestKey};
 },{timeout:90000}),{timeout:100});
}
