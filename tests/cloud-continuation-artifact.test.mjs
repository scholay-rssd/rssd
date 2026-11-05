import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {profiles,publicationDirectory} from '../scripts/site-config.mjs';
import {createCloudQueue} from '../scripts/cloud-queue.mjs';
import {createCloudQueueServer} from '../scripts/cloud-queue-server.mjs';
import {publicationQueueClient} from '../scripts/publication-queue-client.mjs';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';
import {durableWriteJson} from '../scripts/durable-json.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';
import {sourceContentSha256,editionArticleId} from '../contracts/language-editions.mjs';
import {continuationArtifactSha256,validateCloudContinuationArtifact,saveCloudContinuationArtifact,readCloudContinuationEvidence} from '../scripts/publishing-flow-artifact.mjs';
import {queuePublicationBinding,indexPublicationQueue,settlePublicationQueue} from '../scripts/publication-queue-status.mjs';
import {publicationRecoveryCandidates} from '../scripts/publication-queue-recover.mjs';

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const site={...profiles.find(value=>value.id==='metho'),languages:['zh-CN','en']};
const tokens={alice:'ARTIFACT_ORIGINAL_ALICE_SECRET',bob:'ARTIFACT_OTHER_BOB_SECRET',server:'ARTIFACT_PRIVILEGED_SERVER_SECRET'};
const edition={title:'Cloud continuation',summary:'A complete verified translation.',markdown:'# Cloud continuation\n\nA complete verified translation with all original facts.'};
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'today-cloud-artifact-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,'queue'),workspaceRoot=join(root,'cloud'),tokenFile=join(root,'server-token');await writeFile(tokenFile,tokens.server,{mode:0o600});await protectPrivateFile(tokenFile);
 const otherSite=profiles.find(value=>value.id==='study');
 const queue=createCloudQueue({directory,sites:[{site,tokenFile,workspaceRoot},{site:otherSite,tokenFile,workspaceRoot}],continuation:async()=>assert.fail('Artifact reads must never execute work'),fetcher:async url=>{
  if(url.endsWith('/manage/api/site')){const selected=[site,otherSite].find(value=>value.origin===new URL(url).origin);return Response.json({protocol:'scholay-content',version:1,siteId:selected.id,origin:selected.origin});}
  return Response.json({items:[],scope:'all'});
 }});
 const server=createCloudQueueServer({queue});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});const endpoint='http://127.0.0.1:'+server.address().port;
 const client=publicationQueueClient({endpoint,site,token:tokens.alice});
 async function seed(id,{owner='cloud'}={}){
  const source={id,title:'云端续作',summary:'保留已核验的完整译文。',markdown:'# 云端续作\n\n保留已核验的完整译文与全部事实。',date:'2026-10-23',category:site.columns[0],author:site.author,assets:[]};
  const packet={siteId:site.id,spaceId:site.spaceId,origin:site.origin,intent:'publish',requestKey:'artifact-original-'+id,sourceSha256:'a'.repeat(64),expectedVersion:0,expectedPublishedVersion:null,data:source};
  const principal=await queue.authorize(site.id,'Bearer '+tokens.alice),accepted=await queue.enqueue(site.id,packet,{credentialId:principal.credentialId,continuationOwner:owner});
  const stateFile=join(directory,'jobs',accepted.jobId,'state.json'),queued=JSON.parse(await readFile(stateFile,'utf8')),sha256=sourceContentSha256(source),flowId=hash([site.id,id,1,sha256]).slice(0,40),flowDirectory=join(workspaceRoot,'.local/publishing-flow/jobs',flowId);
  const plan={version:1,id:flowId,siteId:site.id,origin:site.origin,articleId:id,revision:1,sha256,source:{...source,tokenFile:'/private/must-not-export',publicationCredential:'PRIVATE_SOURCE_METADATA'},sourceUrl:site.origin+'/news/'+id+'/',brand:{name:site.name,slogan:site.slogan||''},policy:{authorization:'PRIVATE_POLICY',targets:[{integrationId:'PRIVATE_TARGET'}]},publicationCredential:principal.credentialId};
  const english={...source,...edition,id:editionArticleId(id,'en'),assets:[],locale:'en',translationOf:{articleId:id,revision:1,sha256}};
  const flow={status:'waiting',complete:true,chinese:{status:'verified',url:plan.sourceUrl,revision:1},english:{status:'verified',url:site.origin+'/en/news/'+id+'/',revision:1,requestKey:'PRIVATE_ENGLISH_REQUEST'},community:{status:'verified',url:'https://enterscholar.com/t/-/12345'},edition:{...edition,provenance:{candidatePath:'/private/model-output'}},translation:{status:'ready',candidatePath:'/private/model-output'},checkedAt:1};
  const publication={status:'success',request:{requestKey:flow.english.requestKey,data:english},publicReadback:{status:'verified',url:flow.english.url,revision:1,bodySha256:hash(english.markdown)}};
  async function complete(){await durableWriteJson(join(flowDirectory,'plan.json'),plan);await durableWriteJson(join(flowDirectory,'state.json'),flow);await durableWriteJson(join(flowDirectory,'website-en.json'),publication);await durableWriteJson(stateFile,{...queued,status:'complete',receipt:{requestKey:packet.requestKey,revision:1,url:'/news/'+id+'/',publicReadback:true,job:{id:'website-build',status:'success'}},continuation:{id:flowId,status:'queued'}});}
  const receipt={intent:'publish',requestKey:packet.requestKey,sourceSha256:packet.sourceSha256,revision:1,url:'/news/'+id+'/',publicReadback:true,job:{id:'website-build',status:'success'},asyncQueue:{version:1,owner:'cloud',continuationOwner:owner,jobId:accepted.jobId,endpoint,phase:'complete',packetSha256:hash(packet),continuation:{id:flowId,status:'complete',owner}}};
  receipt.asyncQueue.binding=queuePublicationBinding(site,packet,receipt);
  return {id,packet,accepted,stateFile,flowId,flowDirectory,plan,flow,publication,receipt,complete};
 }
 return {root,directory,workspaceRoot,queue,endpoint,client,seed};
}

test('artifact API exposes only complete original-credential cloud evidence and stable public content',async t=>{
 const f=await fixture(t),job=await f.seed('artifact-source');
 const pending=await f.client.continuationArtifact(job.accepted.jobId,job.packet);assert.equal(pending.status,'pending');assert.equal(pending.artifact,undefined);assert.deepEqual(Object.keys(pending).sort(),['articleId','continuationOwner','jobId','requestKey','siteId','status','version']);
 await job.complete();const ready=await f.client.continuationArtifact(job.accepted.jobId,job.packet);assert.equal(ready.status,'ready');assert.equal(ready.artifact.sourceSha256,job.plan.sha256);
 const encoded=JSON.stringify(ready);for(const secret of [...Object.values(tokens),hash(tokens.alice),'PRIVATE_POLICY','PRIVATE_TARGET','PRIVATE_SOURCE_METADATA','/private/','credentialId','publicationCredential','tokenFile','provenance','candidatePath','targets','policy'])assert(!encoded.includes(secret),secret);
 await durableWriteJson(join(job.flowDirectory,'state.json'),{...job.flow,checkedAt:99999});assert.deepEqual(await f.client.continuationArtifact(job.accepted.jobId,job.packet),ready);
 for(const [token,siteId] of [[tokens.bob,site.id],[tokens.server,site.id],[tokens.alice,'study']]){
  const response=await fetch(f.endpoint+'/v1/jobs/'+job.accepted.jobId+'/continuation-artifact',{headers:{Authorization:'Bearer '+token,'X-Scholay-Site':siteId}});assert.equal(response.status,404);
 }
 const local=await f.seed('local-artifact-source',{owner:'local'});await local.complete();await assert.rejects(f.client.continuationArtifact(local.accepted.jobId,local.packet),error=>error.statusCode===404);
 const old=JSON.parse(await readFile(local.stateFile,'utf8'));delete old.continuationOwner;await durableWriteJson(local.stateFile,old);await assert.rejects(f.client.continuationArtifact(local.accepted.jobId,local.packet),error=>error.statusCode===404);
});

test('artifact export refuses changed source, publication identity, credentials and unpublished candidates',async t=>{
 const f=await fixture(t),job=await f.seed('changed-artifact-source');await job.complete();
 for(const mutation of [()=>({...job.plan,revision:2}),()=>({...job.plan,source:{...job.plan.source,markdown:'changed'}}),()=>({...job.plan,publicationCredential:hash(tokens.bob)})]){
  await durableWriteJson(join(job.flowDirectory,'plan.json'),mutation());await assert.rejects(f.client.continuationArtifact(job.accepted.jobId,job.packet),error=>error.statusCode===409);
 }
 await durableWriteJson(join(job.flowDirectory,'plan.json'),job.plan);
 await durableWriteJson(join(job.flowDirectory,'website-en.json'),{...job.publication,request:{...job.publication.request,data:{...job.publication.request.data,markdown:'unpublished replacement'}}});await assert.rejects(f.client.continuationArtifact(job.accepted.jobId,job.packet),error=>error.statusCode===409);
 await durableWriteJson(join(job.flowDirectory,'state.json'),{...job.flow,complete:false});assert.equal((await f.client.continuationArtifact(job.accepted.jobId,job.packet)).status,'pending');
});

test('remote artifact storage is immutable, receipt-bound, safe to repeat and never creates executable jobs',async t=>{
 const f=await fixture(t),job=await f.seed('stored-artifact-source');await job.complete();const response=await f.client.continuationArtifact(job.accepted.jobId,job.packet),root=join(f.root,'client');await mkdir(root);
 const options={root,siteId:site.id,articleId:job.id,receipt:job.receipt,response},ref=await saveCloudContinuationArtifact(options);assert.deepEqual(await saveCloudContinuationArtifact(options),ref);job.receipt.asyncQueue.continuation.artifact=ref;
 const evidence=await readCloudContinuationEvidence(options);assert.equal(evidence.plan.id,job.flowId);assert.equal(evidence.plan.policy,undefined);assert.deepEqual(evidence.state.edition,edition);assert.equal(evidence.state.complete,true);assert.equal(evidence.artifactSha256,response.artifactSha256);assert.equal(evidence.jobId,job.accepted.jobId);
 assert.deepEqual(await readdir(join(root,'.local/publishing-flow')),['remote']);
 for(const changes of [{siteId:'study'},{articleId:'another-source'},{receipt:{...job.receipt,revision:2}}])await assert.rejects(readCloudContinuationEvidence({...options,...changes}),error=>error.code==='FLOW_ARTIFACT');
 const pathReceipt=structuredClone(job.receipt);pathReceipt.asyncQueue.continuation.artifact.key='../jobs/forged.json';await assert.rejects(readCloudContinuationEvidence({...options,receipt:pathReceipt}),error=>error.code==='FLOW_ARTIFACT');
 const altered=structuredClone(response);altered.artifact.edition.markdown+=' tampered';assert.throws(()=>validateCloudContinuationArtifact(altered),error=>error.code==='FLOW_ARTIFACT');
 for(const mutate of [value=>{value.artifact.policy={targets:[]};},value=>{value.artifact.source.tokenFile='/private/credential';},value=>{value.artifact.siteId='legis';value.siteId='legis';}]){
  const unexpected=structuredClone(response);mutate(unexpected);unexpected.artifactSha256=continuationArtifactSha256(unexpected.artifact);assert.throws(()=>validateCloudContinuationArtifact(unexpected),error=>error.code==='FLOW_ARTIFACT');
 }
 altered.artifactSha256=continuationArtifactSha256(altered.artifact);await assert.rejects(saveCloudContinuationArtifact({...options,response:altered}),error=>error.code==='FLOW_ARTIFACT');
 await durableWriteJson(join(root,'.local/publishing-flow/remote',ref.key),altered);await assert.rejects(readCloudContinuationEvidence(options),error=>error.code==='FLOW_ARTIFACT');
 const localReceipt=structuredClone(job.receipt);localReceipt.asyncQueue.continuationOwner='local';assert.equal(await readCloudContinuationEvidence({...options,receipt:localReceipt}),null);
});

test('publisher retains archived cloud recovery until the complete artifact is durably imported',async t=>{
 const f=await fixture(t),job=await f.seed('archived-artifact-source');await job.complete();const root=join(f.root,'client');await mkdir(root);await durableWriteJson(join(root,'.site.json'),site);
 const directory=join(publicationDirectory(root),job.id),cloud={articleId:job.id,version:1,publishedVersion:1,sourceSha256:job.packet.sourceSha256,archiveId:'b'.repeat(64),archiveSha256:'b'.repeat(64)};
 await durableWriteJson(join(root,'_ops/inventory/article-index.json'),{articles:{},cloudArticles:{[job.id]:{shortTitle:job.packet.data.title,cloud}}});await durableWriteJson(join(directory,'release.json'),{phase:'complete',cloud});await durableWriteJson(join(directory,'sync.json'),{remoteId:job.id,revision:1});await durableWriteJson(join(directory,'receipt.json'),job.receipt);await indexPublicationQueue(root,site,job.id,job.packet.data.title);
 const tokenFile=join(root,'client-token');await writeFile(tokenFile,tokens.alice,{mode:0o600});await protectPrivateFile(tokenFile);let downloads=0,failDownload=true;
 const publisher=createWebsitePublisher({root,site,tokenFile,queueKick:async()=>assert.fail('Never enqueue local translation'),fetcher:async(url,options)=>{assert.equal(options.method,'GET');if(url.endsWith('/continuation-artifact')){downloads++;if(failDownload)return Response.json({error:'temporary unavailable'},{status:503});}return fetch(url,options);}});
 let result=await publisher.runQueued(job.id);assert.equal(result.receipt.publicReadback,true);assert.equal(result.receipt.asyncQueue.continuation.status,'artifact_pending');await settlePublicationQueue(root,site,job.id);assert.deepEqual((await publicationRecoveryCandidates({root,site,globalData:null})).candidates.map(item=>item.id),[job.id]);
 failDownload=false;result=await publisher.runQueued(job.id);assert.equal(result.receipt.asyncQueue.continuation.status,'complete');assert(result.receipt.asyncQueue.continuation.artifact);assert.equal(downloads,2);assert(await readCloudContinuationEvidence({root,siteId:site.id,articleId:job.id,receipt:result.receipt}));
 await publisher.runQueued(job.id);assert.equal(downloads,2);
 await rm(join(root,'.local/publishing-flow/remote',result.receipt.asyncQueue.continuation.artifact.key));const repaired=await publisher.runQueued(job.id);assert.equal(downloads,3);assert.deepEqual(repaired.receipt.asyncQueue.continuation.artifact,result.receipt.asyncQueue.continuation.artifact);
 await settlePublicationQueue(root,site,job.id);assert.equal((await publicationRecoveryCandidates({root,site,globalData:null})).candidates.length,0);
 await assert.rejects(readFile(join(directory,'prepared.json')),error=>error.code==='ENOENT');assert.deepEqual(await readdir(join(root,'.local/publishing-flow')),['remote']);
});
