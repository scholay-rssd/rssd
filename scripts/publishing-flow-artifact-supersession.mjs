// Explicit, GET-only adoption of a reviewed English revision. Normal artifact
// imports remain immutable. No authorization, publication or draft is created.
import {readFile,readdir,stat,open,realpath} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validateSite,publicationDirectory} from './site-config.mjs';
import {publicationQueueClient} from './publication-queue-client.mjs';
import {queuePublicationBinding,readPublicationQueueIdentity} from './publication-queue-status.mjs';
import {assertCloudRecoverySettled} from './publication-cloud-identity-recovery.mjs';
import {validateCloudContinuationArtifact,continuationArtifactSha256} from './publishing-flow-artifact.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {durableWriteJson} from './durable-json.mjs';

const optional=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const fail=message=>{throw Object.assign(Error('Cloud artifact supersession: '+message),{statusCode:409});};
const inputKeys=['version','root','site','articleId','jobId','requestKey','handoffDirectory','tokenFile','expectedReceiptSha256','expectedOldArtifactSha256','expectedNewArtifactSha256','expectedNewEditionSha256','newReviewedEdition','reviewed','reason'];
const editionKeys=['title','summary','markdown'];
function checkReplacement(response,old,input){
 const next=validateCloudContinuationArtifact(response),stable=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['edition','english'].includes(key)));
 if(response.artifactSha256!==input.expectedNewArtifactSha256||!isDeepStrictEqual(stable(old),stable(next))||next.english.revision<=old.english.revision||next.english.url!==old.english.url||!isDeepStrictEqual(next.edition,input.newReviewedEdition))fail('only the reviewed newer English edition of this same complete source may supersede it');
}

async function assertNoDistribution(directory,a){
 // Scan only durable distribution records, not arbitrary operator notes or
 // unapproved batch manifests. A cohort member is already a frozen grant.
 const matches=value=>{
  if(!value||typeof value!=='object')return false;
  if(value.jobId===a.jobId||value.planId===a.flowId||value.flowId===a.flowId)return true;
  if(value.siteId===a.siteId&&value.articleId===a.articleId&&value.revision===a.revision&&value.sha256===a.sourceSha256&&value.artifactSha256)return true;
  return Object.values(value).some(matches);
 };
 async function walk(path){
  const entries=await readdir(path,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  for(const entry of entries){
   if(entry.isSymbolicLink())fail('distribution records must not be symlinks');
   const file=join(path,entry.name);
   if(entry.isDirectory())await walk(file);
   else if(entry.name.endsWith('.json')){
    const value=await optional(file);
    if(entry.name===a.jobId+'.json'||matches(value))fail('a frozen distribution already owns this job; retain its original artifact');
   }
  }
 }
 for(const name of ['cloud-authorizations','outbox','receipts','slots','recovery-cohorts','grants'])await walk(join(directory,name));
}

export async function supersedeCloudContinuationArtifact(input,{fetcher=fetch,writeJson=durableWriteJson,now=Date.now()}={}){
 if(!exact(input,inputKeys)||input.version!==1||!isAbsolute(input.root||'')||!isAbsolute(input.tokenFile||'')||!isAbsolute(input.handoffDirectory||'')||!/^[a-z0-9][a-z0-9-]{2,99}$/.test(input.articleId||'')||!/^[a-zA-Z0-9_-]{12,128}$/.test(input.requestKey||'')||!['jobId','expectedReceiptSha256','expectedOldArtifactSha256','expectedNewArtifactSha256','expectedNewEditionSha256'].every(key=>hex(input[key]))||input.expectedOldArtifactSha256===input.expectedNewArtifactSha256||!exact(input.newReviewedEdition,editionKeys)||hash(input.newReviewedEdition)!==input.expectedNewEditionSha256||input.reviewed!==true||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>4000)fail('use an exact reviewed candidate, old receipt and both artifact hashes');
 for(const name of ['SCHOLAY_TODAY_TOKEN','SCHOLAY_TODAY_TOKEN_FILE','SCHOLAY_TODAY_ORIGIN','SCHOLAY_SITE_ID','SCHOLAY_SITE_CONFIG','SCHOLAY_SITE_JSON','SCHOLAY_PUBLICATION_QUEUE_CONFIG'])if(process.env[name])fail('clear ambient publication configuration; use the original explicit site and token file');
 const site=validateSite(input.site),bound=await optional(join(input.root,'.site.json'));
 if(bound?.id!==site.id||bound.origin!==site.origin||!(await stat(input.handoffDirectory)).isDirectory())fail('use the original site-bound workspace and existing handoff directory');
 const policyFile=join(input.root,'.local/publishing-flow/policy.json'),policy=await optional(policyFile);
 if(policy?.version!==1||policy.siteId!==site.id||policy.origin!==site.origin||!isAbsolute(policy.handoffDirectory||''))fail('retain the existing workspace policy binding to its original handoff directory');
 const handoffDirectory=await realpath(policy.handoffDirectory);
 if(await realpath(input.handoffDirectory)!==handoffDirectory)fail('the requested handoff directory differs from the canonical workspace policy');
 const assertPolicy=async()=>{if(!isDeepStrictEqual(await optional(policyFile),policy)||await realpath(policy.handoffDirectory)!==handoffDirectory||await realpath(input.handoffDirectory)!==handoffDirectory)fail('the original handoff policy binding changed');};
 const directory=join(publicationDirectory(input.root),input.articleId),remote=join(input.root,'.local/publishing-flow/remote'),file=join(remote,input.jobId+'.json'),pointerFile=join(remote,input.jobId+'.supersession.json'),archiveFile=join(remote,'superseded',input.jobId+'-'+input.expectedOldArtifactSha256+'.json');
 const identity={root:input.root,siteId:site.id,origin:site.origin,articleId:input.articleId,jobId:input.jobId,requestKey:input.requestKey,handoffDirectory,policySha256:hash(policy),oldReceiptSha256:input.expectedReceiptSha256,oldArtifactSha256:input.expectedOldArtifactSha256,newArtifactSha256:input.expectedNewArtifactSha256,newEditionSha256:input.expectedNewEditionSha256,reviewed:true,reason:input.reason};
 // Ordinary handoff/authorize hold postiz.lock. Ordinary publication workers
 // hold queue-worker -> operation -> artifact. Never invert either order.
 return withFileLock(join(handoffDirectory,'postiz.lock'),()=>withFileLock(join(directory,'queue-worker.lock'),()=>withFileLock(join(directory,'operation.lock'),()=>withFileLock(file+'.lock',async()=>{
  await assertPolicy();
  await assertCloudRecoverySettled(directory);
  const pointer=await optional(pointerFile);
  if(pointer&&(!exact(pointer,['version','phase','intentSha256','intent'])||pointer.version!==1||!['prepared','committed'].includes(pointer.phase)||pointer.intentSha256!==continuationArtifactSha256(pointer.intent)||!isDeepStrictEqual(pointer.intent.identity,identity)))fail('resume the exact retained artifact supersession');
  const resume=pointer?.intent,current={receipt:await optional(join(directory,'receipt.json')),artifact:await optional(file)},old=resume?.original||current;
  if(hash(old.receipt)!==input.expectedReceiptSha256||old.artifact?.artifactSha256!==input.expectedOldArtifactSha256)fail('the old receipt or artifact changed');
  const a=validateCloudContinuationArtifact(old.artifact,{jobId:input.jobId,siteId:site.id,origin:site.origin,articleId:input.articleId,requestKey:input.requestKey});
  const q=old.receipt?.asyncQueue,ref=q?.continuation?.artifact;
  if(q?.owner!=='cloud'||q.continuationOwner!=='cloud'||q.jobId!==a.jobId||old.receipt.requestKey!==a.requestKey||old.receipt.revision!==a.revision||old.receipt.url!==new URL(a.sourceUrl).pathname||old.receipt.publicReadback!==true||old.receipt.job?.status!=='success'||!exact(ref,['version','jobId','id','sha256','key'])||ref.version!==1||ref.jobId!==a.jobId||ref.id!==a.flowId||ref.sha256!==input.expectedOldArtifactSha256||ref.key!==a.jobId+'.json')fail('the original receipt does not bind the complete old artifact');
  if(resume&&pointer.phase==='committed'){
   checkReplacement(current.artifact,a,input);
   if(!isDeepStrictEqual(current,resume.replacement)||!isDeepStrictEqual(await optional(archiveFile),resume))fail('a later receipt, artifact or immutable archive changed; never rewind it');
   return {status:'superseded',alreadySuperseded:true,jobId:a.jobId,artifactSha256:input.expectedNewArtifactSha256};
  }
  await assertNoDistribution(handoffDirectory,a);
  const localPacket=await optional(join(directory,'prepared.json'));
  await readPublicationQueueIdentity({root:input.root,site,id:input.articleId,packet:localPacket,receipt:old.receipt});
  const client=publicationQueueClient({endpoint:q.endpoint,site,tokenFile:input.tokenFile,token:null,fetcher});
  const recovered=await client.recoveryPacket(a.jobId,{articleId:a.articleId,requestKey:a.requestKey}),packet=structuredClone(recovered.packet);
  if(hash(packet)!==q.packetSha256&&site.legacy){delete packet.siteId;delete packet.spaceId;delete packet.origin;}
  queuePublicationBinding(site,packet,old.receipt);
  if(localPacket&&!isDeepStrictEqual(localPacket,packet)||recovered.sourceSha256!==a.sourceSha256||sourceContentSha256(packet.data)!==a.sourceSha256||recovered.receipt.revision!==old.receipt.revision||recovered.receipt.url!==old.receipt.url||recovered.receipt.job.id!==old.receipt.job.id)fail('the original frozen packet, asset bytes, source or successful receipt changed');
  const response=await client.continuationArtifact(a.jobId,packet);
  if(response.status==='pending'){
   if(resume)fail('the prepared replacement is no longer complete');
   return {status:'pending',jobId:a.jobId};
  }
  checkReplacement(response,a,input);
  const token=(await readFile(input.tokenFile,'utf8')).trim();
  const live=await fetcher(site.origin+'/manage/api/news/flow-source/'+a.articleId+'?identity=1',{method:'GET',headers:{Authorization:'Bearer '+token,'X-Scholay-Site':site.id,'X-Scholay-Protocol':'1'},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!live.ok)fail('the original Chinese source cannot be verified');
  const source=await live.json();if(source.version!==a.revision||source.publishedVersion!==a.revision||source.sha256!==a.sourceSha256)fail('the current Chinese source changed');
  const replacement={receipt:structuredClone(old.receipt),artifact:response};replacement.receipt.asyncQueue.continuation.artifact={...ref,sha256:response.artifactSha256};
  const intent={version:1,identity,preparedAt:resume?.preparedAt??now,original:old,replacement,proof:{recoveryPacket:recovered,localPacketSha256:hash(localPacket)}};
  if(resume&&!isDeepStrictEqual(resume,intent))fail('the frozen supersession evidence changed');
  for(const name of ['receipt','artifact'])if(resume&&!isDeepStrictEqual(current[name],old[name])&&!isDeepStrictEqual(current[name],replacement[name]))fail('local evidence changed outside the pending supersession');
  if(!isDeepStrictEqual(await optional(join(directory,'prepared.json')),localPacket)||!isDeepStrictEqual(await optional(join(directory,'receipt.json')),current.receipt)||!isDeepStrictEqual(await optional(file),current.artifact))fail('local evidence changed during GET verification');
  const archive=await optional(archiveFile);if(archive&&!isDeepStrictEqual(archive,intent))fail('the immutable supersession archive changed');
  await assertPolicy();
  const frozen={version:1,phase:'prepared',intentSha256:continuationArtifactSha256(intent),intent};
  if(!resume)await writeJson(pointerFile,frozen);
  if(!archive)await writeJson(archiveFile,intent);
  // Flush the newly created archive directory entry before committing. The
  // prepared pointer itself already contains both full snapshots.
  if(process.platform!=='win32'){const handle=await open(remote,'r');try{await handle.sync();}finally{await handle.close();}}
  if(!isDeepStrictEqual(current.artifact,response))await writeJson(file,response);
  if(!isDeepStrictEqual(current.receipt,replacement.receipt))await writeJson(join(directory,'receipt.json'),replacement.receipt);
  await writeJson(pointerFile,{...frozen,phase:'committed'});
  return {status:'superseded',jobId:a.jobId,artifactSha256:response.artifactSha256};
 },{timeout:100}),{timeout:100}),{timeout:100}),{timeout:100});
}

export async function supersedeCloudContinuationArtifactFromFile(file,options){return supersedeCloudContinuationArtifact(JSON.parse(await readFile(file,'utf8')),options);}
