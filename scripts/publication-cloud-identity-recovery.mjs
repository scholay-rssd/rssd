// Called only under queue-worker.lock -> operation.lock. This restores an
// accepted cloud request, never submits either publication intent.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {continuationArtifactSha256,assertCloudArtifactSupersessionSettled} from './publishing-flow-artifact.mjs';
import {queuePublicationBinding,indexPublicationQueue} from './publication-queue-status.mjs';
import {cloudPublicationJobId,publicationQueueClient} from './publication-queue-client.mjs';
import {durableWriteJson} from './durable-json.mjs';

const optional=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw Error('Original cloud request recovery: '+message);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const key=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{12,128}$/.test(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const pointerFile=directory=>join(directory,'cloud-request-recovery.json');

export async function assertCloudRecoverySettled(directory){
 const pointer=await optional(pointerFile(directory));
 if(pointer&&(!exact(pointer,['version','phase','intentSha256','intent'])||pointer.version!==1||pointer.phase!=='committed'||continuationArtifactSha256(pointer.intent)!==pointer.intentSha256))fail('a durable recovery is incomplete; resume that exact recovery before any publication operation');
}
function validateExpected(expected,site){
 if(!exact(expected,['articleId','originalRequestKey','originalJobId','supersededRequestKey','expectedSourceSha256'])||typeof expected.articleId!=='string'||!/^[a-z0-9][a-z0-9-]{2,99}$/.test(expected.articleId)||!key(expected.originalRequestKey)||!key(expected.supersededRequestKey)||expected.originalRequestKey===expected.supersededRequestKey||!hex(expected.originalJobId)||!hex(expected.expectedSourceSha256)||cloudPublicationJobId(site.id,expected.originalRequestKey)!==expected.originalJobId)fail('name the exact original job, both requests, article and confirmed content hash');
}
function unsent(site,packet,receipt,expected){
 const q=receipt?.asyncQueue;
 if(receipt?.status!=='local_queued'||receipt.requestKey!==expected.supersededRequestKey||receipt.job?.id!==expected.supersededRequestKey||receipt.job.status!=='queued'||receipt.publicReadback||q?.owner!=='local'||q.continuationOwner!=='cloud'||q.phase!=='queued'||q.attempts!==0||q.jobId||!q.endpoint||packet?.requestKey!==expected.supersededRequestKey||(packet.intent||'publish')!=='publish'||receipt.intent!=='publish'||packet.data?.id!==expected.articleId)fail('the newer intent is not a proven unsent local publication');
 queuePublicationBinding(site,packet,receipt);
 if(sourceContentSha256(packet.data)!==expected.expectedSourceSha256)fail('the current content differs from the explicitly confirmed source');
}
function originalPacket(response,archive,site){
 const packet=structuredClone(response.packet);
 if(digest(packet)!==archive.asyncQueue?.packetSha256&&site.legacy){
  // The cloud client adds these fields to legacy transport. Removing only
  // those additions must reproduce the retained original local digest.
  delete packet.siteId;delete packet.spaceId;delete packet.origin;
 }
 queuePublicationBinding(site,packet,archive);return packet;
}
async function mustBeMissing(read,label){
 try{await read();}catch(error){if(error.statusCode===404)return;throw error;}
 fail(label+' already exists or has an uncertain outcome; keep both original intents');
}
function checkPointer(pointer,expected,site,id){
 if(!exact(pointer,['version','phase','intentSha256','intent'])||pointer.version!==1||!['prepared','committed'].includes(pointer.phase)||continuationArtifactSha256(pointer.intent)!==pointer.intentSha256||pointer.intent.siteId!==site.id||pointer.intent.origin!==site.origin||pointer.intent.localId!==id||!isDeepStrictEqual(pointer.intent.expected,expected))fail('the retained recovery intent differs; never replace it');
 return pointer.intent;
}

export async function restoreOriginalCloudRequest({root,site,id,paths,expected,api,tokenFile,fetcher,writeJson=durableWriteJson,index=indexPublicationQueue}){
 validateExpected(expected,site);
 await assertCloudArtifactSupersessionSettled({root,jobId:expected.originalJobId});
 const directory=paths.dir,pointerPath=pointerFile(directory),retained=await optional(pointerPath);
 const same=retained&&isDeepStrictEqual(retained.intent?.expected,expected),resume=same?checkPointer(retained,expected,site,id):null;
 if(retained&&retained.phase!=='committed'&&!same)fail('another recovery must finish before this request can change');
 const currentPacket=await optional(paths.packet),currentReceipt=await optional(paths.receipt),syncFile=join(directory,'sync.json'),sync=await optional(syncFile);
 if(resume&&retained.phase==='committed'){
  if(!isDeepStrictEqual(currentPacket,resume.restored.packet)||currentReceipt?.requestKey!==expected.originalRequestKey||currentReceipt.asyncQueue?.owner!=='cloud'||currentReceipt.asyncQueue.jobId!==expected.originalJobId)fail('a later publication intent now owns this article; do not rewind it');
  queuePublicationBinding(site,currentPacket,currentReceipt);
  if(!isDeepStrictEqual(await optional(join(directory,'superseded',expected.supersededRequestKey+'.json')),resume))fail('the immutable superseded journal changed');
  return {status:'restored',alreadyRestored:true,articleId:expected.articleId,requestKey:expected.originalRequestKey,jobId:expected.originalJobId,supersededRequestKey:expected.supersededRequestKey,sourceSha256:expected.expectedSourceSha256};
 }
 const newerPacket=resume?.superseded.packet||currentPacket,newerReceipt=resume?.superseded.receipt||currentReceipt;
 unsent(site,newerPacket,newerReceipt,expected);
 const archiveFile=join(directory,'receipt-'+expected.originalRequestKey+'.json'),archive=await optional(archiveFile),q=archive?.asyncQueue;
 if(archive?.requestKey!==expected.originalRequestKey||!archive.publicReadback||archive.job?.status!=='success'||archive.intent!=='publish'||q?.owner!=='cloud'||q.continuationOwner!=='cloud'||q.jobId!==expected.originalJobId||q.endpoint!==newerReceipt.asyncQueue.endpoint||archive.sourceSha256!==newerPacket.sourceSha256)fail('retain the exact original published cloud receipt and endpoint');
 const client=publicationQueueClient({endpoint:q.endpoint,site,tokenFile,fetcher});
 const response=await client.recoveryPacket(expected.originalJobId,{articleId:expected.articleId,requestKey:expected.originalRequestKey});
 if(response.sourceSha256!==expected.expectedSourceSha256||response.receipt.revision!==archive.revision||response.receipt.url!==archive.url||response.receipt.job.id!==archive.job.id)fail('the accepted cloud publication no longer matches the archived receipt');
 const packet=originalPacket(response,archive,site);
 if(packet.data.id!==expected.articleId||packet.sourceSha256!==newerPacket.sourceSha256||!isDeepStrictEqual(packet.data,newerPacket.data))fail('the newer intent changes content, metadata or asset bytes; it cannot be superseded');
 if(sync?.requestKey!==expected.originalRequestKey||sync.remoteId!==expected.articleId||sync.revision!==archive.revision||sync.cloudRevision!==archive.revision||sync.publishedRevision!==archive.revision)fail('the original published synchronization baseline changed');
 const newJobId=cloudPublicationJobId(site.id,expected.supersededRequestKey);
 await mustBeMissing(()=>client.status(newJobId,newerPacket,{continuationOwner:'cloud'}),'The newer cloud request');
 await mustBeMissing(()=>api('/requests/'+expected.supersededRequestKey),'The newer website request');
 const original=await api('/requests/'+expected.originalRequestKey);
 if(original.requestKey!==undefined&&original.requestKey!==expected.originalRequestKey||original.articleId!==undefined&&original.articleId!==expected.articleId||original.revision!==archive.revision||original.url!==archive.url||original.job?.id!==archive.job.id||original.job?.status!=='success')fail('the original website request is no longer the same successful publication');
 const remote=await api('/'+expected.articleId);
 if(remote.version!==archive.revision||remote.publishedVersion!==archive.revision||!remote.published||sourceContentSha256(remote.published)!==expected.expectedSourceSha256)fail('the website has another current revision or source; do not rewind it');
 const intent={version:1,siteId:site.id,origin:site.origin,localId:id,expected:structuredClone(expected),superseded:{status:'superseded',requestKey:expected.supersededRequestKey,packet:newerPacket,receipt:newerReceipt},restored:{packet,receipt:archive},syncSha256:digest(sync),archiveSha256:digest(archive),packetSha256:response.packetSha256,sourceSha256:response.sourceSha256};
 if(resume&&!isDeepStrictEqual(resume,intent))fail('the retained recovery evidence changed');
 // Either file may have reached disk before a crash. A third value is a
 // concurrent edit, never permission to overwrite it with either snapshot.
 if(resume){
  if(![digest(newerPacket),digest(packet)].includes(digest(currentPacket))||![digest(newerReceipt),digest(archive)].includes(digest(currentReceipt)))fail('publication files changed outside the pending recovery');
 }else if(currentPacket?.requestKey!==expected.supersededRequestKey||currentReceipt?.requestKey!==expected.supersededRequestKey)fail('the current request is no longer the selected unsent intent');
 if(digest(await optional(paths.packet))!==digest(currentPacket)||digest(await optional(paths.receipt))!==digest(currentReceipt)||digest(await optional(syncFile))!==intent.syncSha256||digest(await optional(archiveFile))!==intent.archiveSha256)fail('local evidence changed during the read-only verification');
 const journal=join(directory,'superseded',expected.supersededRequestKey+'.json'),priorJournal=await optional(journal);
 if(priorJournal&&!isDeepStrictEqual(priorJournal,intent))fail('retain the existing superseded-intent journal');
 const pointer={version:1,phase:'prepared',intentSha256:continuationArtifactSha256(intent),intent};
 // This first durable pointer blocks every ordinary publication operation.
 if(!resume)await writeJson(pointerPath,pointer);
 if(!priorJournal)await writeJson(journal,intent);
 if(!isDeepStrictEqual(currentPacket,packet))await writeJson(paths.packet,packet);
 if(!isDeepStrictEqual(currentReceipt,archive))await writeJson(paths.receipt,archive);
 await index(root,site,id,packet.data.title);
 if(retained?.phase!=='committed'||!same)await writeJson(pointerPath,{...pointer,phase:'committed'});
 return {status:'restored',articleId:expected.articleId,requestKey:expected.originalRequestKey,jobId:expected.originalJobId,supersededRequestKey:expected.supersededRequestKey,sourceSha256:expected.expectedSourceSha256};
}
