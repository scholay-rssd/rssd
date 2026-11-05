import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {profiles,publicationDirectory} from '../scripts/site-config.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {continuationArtifactSha256,saveCloudContinuationArtifact} from '../scripts/publishing-flow-artifact.mjs';
import {queuePublicationBinding,indexPublicationQueue} from '../scripts/publication-queue-status.mjs';
import {cloudPublicationJobId} from '../scripts/publication-queue-client.mjs';
import {restoreEquivalentAcceptedCloudRequest} from '../scripts/publication-accepted-request-recovery.mjs';
import {restoreOriginalCloudRequest,assertCloudRecoverySettled} from '../scripts/publication-cloud-identity-recovery.mjs';
import {durableWriteJson} from '../scripts/durable-json.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';
import {withFileLock} from '../scripts/editorial-lock.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const optional=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const site=profiles.find(value=>value.id==='metho'),id='draft-accepted-equivalent',oldKey='original-batch-request',laterKey='later-accepted-request';
const secret='EXPLICIT_ORIGINAL_CREDENTIAL';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'accepted-request-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await durableWriteJson(join(root,'.site.json'),site);
 const publications=publicationDirectory(root),directory=join(publications,id),paths={packet:join(directory,'prepared.json'),receipt:join(directory,'receipt.json'),archive:join(directory,'receipt-'+oldKey+'.json'),sync:join(directory,'sync.json'),pointer:join(directory,'cloud-request-recovery.json'),journal:join(directory,'accepted-equivalent',laterKey+'.json')};
 const data={id,title:'原文研究',summary:'完整研究摘要',markdown:'# 原文研究\n\n保留研究限制。',date:'2026-10-24',category:site.columns[0],author:site.author,sectionId:'frontiers',assets:[{path:'/article-media/'+('d'.repeat(64))+'.png',data:'b3JpZ2luYWwtaW1hZ2U='}]};
 const sourceSha=sourceContentSha256(data),planId=hash([site.id,id,1,sourceSha]).slice(0,40),endpoint='https://queue.example';
 const original={siteId:site.id,spaceId:site.spaceId,origin:site.origin,data,intent:'publish',releaseLocal:false,expectedVersion:0,expectedPublishedVersion:null,requestKey:oldKey,sourceSha256:'a'.repeat(64),localFingerprint:'b'.repeat(64),preparedAt:'2026-10-24T00:00:00Z'};
 const later={...original,requestKey:laterKey,expectedVersion:1,expectedPublishedVersion:1,preparedAt:'2026-10-24T01:00:00Z'};
 const makeReceipt=packet=>{const receipt={intent:'publish',status:'submitted',requestKey:packet.requestKey,sourceSha256:packet.sourceSha256,revision:1,url:'/news/'+id+'/',publicReadback:true,job:{id:'website-'+packet.requestKey,status:'success'},asyncQueue:{owner:'cloud',continuationOwner:'cloud',jobId:cloudPublicationJobId(site.id,packet.requestKey),endpoint,packetSha256:hash(packet),continuation:{id:planId,owner:'cloud',status:'queued'}}};receipt.asyncQueue.binding=queuePublicationBinding(site,packet,receipt);return receipt;};
 const archive=makeReceipt(original),receipt=makeReceipt(later),sync={remoteId:id,revision:1,cloudRevision:1,publishedRevision:1,requestKey:oldKey,fingerprint:original.localFingerprint};
 const response=(packet,r)=>({version:1,status:'ready',jobId:r.asyncQueue.jobId,siteId:site.id,articleId:id,requestKey:packet.requestKey,continuationOwner:'cloud',packetSha256:continuationArtifactSha256(packet),sourceSha256:sourceContentSha256(packet.data),packet,receipt:{requestKey:r.requestKey,revision:1,url:r.url,publicReadback:true,job:r.job}});
 const cloudStatus=r=>({jobId:r.asyncQueue.jobId,siteId:site.id,articleId:id,requestKey:r.requestKey,continuationOwner:'cloud',status:'complete',continuation:{id:planId,status:'queued'},receipt:r});
 const handoffDirectory=join(root,'handoff'),manifest={version:1,resultsDirectory:join(root,'producer-results'),entries:[{siteId:site.id,sectionId:'frontiers',root,publicationDirectory:publications,requireFlow:true,requireEnglish:true}]};await mkdir(manifest.resultsDirectory,{recursive:true});
 const results=[{site:site.id,sectionId:'frontiers',articleId:id,requestKey:oldKey,taskId:'same-real-task'},{site:site.id,sectionId:'frontiers',articleId:id,requestKey:oldKey,taskId:'same-real-task'}];
 const batch={version:1,id:'daily-20261024',status:'settled',manifest,baselineResults:[],productionResults:results};
 const input={version:1,mode:'accepted-equivalent',root,site,tokenFile:join(root,'original-token'),localId:id,handoffDirectory,expected:{articleId:id,originalRequestKey:oldKey,originalJobId:archive.asyncQueue.jobId,laterRequestKey:laterKey,laterJobId:receipt.asyncQueue.jobId,planId,revision:1,expectedSourceSha256:sourceSha,batchId:batch.id,manifestSha256:hash(manifest),section:site.id+'/frontiers'}};
 await writeFile(input.tokenFile,secret,{mode:0o600});await protectPrivateFile(input.tokenFile);
 for(const [path,value] of [[paths.packet,later],[paths.receipt,receipt],[paths.archive,archive],[paths.sync,sync],[join(handoffDirectory,'today-batch.json'),batch]])await durableWriteJson(path,value);
 await durableWriteJson(join(manifest.resultsDirectory,'unrelated.result.json'),{site:site.id,articleId:id,sectionId:'other',requestKey:'noise-after-frozen-results'});
 const state={responses:[response(original,archive),response(later,receipt)],statuses:[cloudStatus(archive),cloudStatus(receipt)],website:[{...archive,articleId:id},{...receipt,articleId:id}],remote:{version:1,publishedVersion:1,data:structuredClone(data),published:structuredClone(data)},denyJob:null},calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url,method:options.method,site:options.headers['X-Scholay-Site']});assert.equal(options.method,'GET','accepted recovery must never POST');assert.equal(options.redirect,'error');
  if(options.headers.Authorization!=='Bearer '+secret||options.headers['X-Scholay-Site']!==site.id)return Response.json({error:'Wrong original credential or site'},{status:404});
  const path=new URL(url).pathname;
  for(let i=0;i<2;i++){
   const job=state.responses[i].jobId;
   if(path==='/v1/jobs/'+job+'/recovery-packet')return state.denyJob===job?Response.json({error:'Not owned'},{status:404}):Response.json(state.responses[i]);
   if(path==='/v1/jobs/'+job)return Response.json(state.statuses[i]);
   if(path==='/manage/api/news/requests/'+state.responses[i].requestKey)return Response.json(state.website[i]);
  }
  if(path==='/manage/api/news/'+id)return Response.json(state.remote);
  assert.fail('Unexpected request '+url);
 };
 const restore=options=>restoreEquivalentAcceptedCloudRequest(input,{fetcher,...options});
 const bytes=()=>Promise.all([paths.packet,paths.receipt,paths.archive,paths.sync,join(handoffDirectory,'today-batch.json'),join(manifest.resultsDirectory,'unrelated.result.json')].map(file=>readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;})));
 return {root,directory,publications,paths,data,original,later,archive,receipt,sync,manifest,batch,input,state,calls,fetcher,restore,bytes};
}

test('restores the unique original batch-owned accepted request, retains both histories, and leaves incomplete translation pending',async t=>{
 const f=await fixture(t),before=await f.bytes();assert.equal((await f.restore()).status,'restored');
 assert.deepEqual(await optional(f.paths.packet),f.original);assert.deepEqual(await optional(f.paths.receipt),f.archive);assert.deepEqual((await f.bytes()).slice(2),before.slice(2));
 const journal=await optional(f.paths.journal);assert.deepEqual(journal.retainedAccepted.packet,f.later);assert.deepEqual(journal.retainedAccepted.receipt,f.receipt);assert.equal(journal.mode,'accepted-equivalent');assert(!JSON.stringify(journal).includes(secret));assert(!JSON.stringify(journal).includes('tokenFile'));
 assert.equal((await optional(f.paths.receipt)).asyncQueue.continuation.status,'queued');assert.equal(await optional(join(f.root,'.local/publishing-flow/remote',f.input.expected.originalJobId+'.json')),null);
 assert.equal((await optional(f.paths.pointer)).phase,'committed');assert((await optional(join(f.publications,'queue-index.json'))).items[id]);assert.equal(f.calls.length,7);assert(f.calls.every(call=>call.method==='GET'));
 const refreshed={...f.archive,checkedAt:'2026-10-25T03:00:00Z',asyncQueue:{...f.archive.asyncQueue,phase:'complete'}};await durableWriteJson(f.paths.receipt,refreshed);const count=f.calls.length;
 assert.equal((await f.restore()).alreadyRestored,true);assert.deepEqual(await optional(f.paths.receipt),refreshed);assert.equal(f.calls.length,count);
});

test('an accepted receipt with archived prepared bytes is recovered only from its original credential-bound cloud packet',async t=>{
 const f=await fixture(t);await rm(f.paths.packet);assert.equal((await f.restore()).status,'restored');assert.deepEqual(await optional(f.paths.packet),f.original);assert.equal((await optional(f.paths.journal)).retainedAccepted.localPacket,null);
});

test('the unchanged cohort stays pending until the restored original job supplies its complete artifact, then accepts its original results',async t=>{
 const f=await fixture(t),{authorizeRecoveryCohort,handoffRecoveryCohort}=await import('../scripts/publishing-recovery-cohort.mjs');
 const e=f.input.expected,source={...f.data,assets:f.data.assets.map(({path})=>({path}))},artifact={version:1,jobId:e.originalJobId,siteId:site.id,origin:site.origin,articleId:id,requestKey:oldKey,continuationOwner:'cloud',flowId:e.planId,revision:1,sourceSha256:e.expectedSourceSha256,sourceUrl:site.origin+f.archive.url,brand:{name:site.name,slogan:'Research'},source,edition:{title:'Research article',summary:'Complete research summary.',markdown:'# Research article\n\nRetain the limitations.'},chinese:{status:'verified',url:site.origin+f.archive.url,revision:1},english:{status:'verified',url:site.origin+'/en/news/'+id+'/',revision:1},community:{status:'verified',url:'https://enterscholar.com/t/-/12345'}};
 const response={version:1,status:'ready',jobId:e.originalJobId,siteId:site.id,articleId:id,requestKey:oldKey,continuationOwner:'cloud',artifactSha256:continuationArtifactSha256(artifact),artifact};
 const targets=[{platform:'discord',locale:'zh-CN',integrationId:'approved-discord',channelId:'1562031229606301696',format:'summary'}],grant={version:1,siteId:site.id,articleId:id,revision:1,sha256:e.expectedSourceSha256,artifactSha256:response.artifactSha256,targets,mode:'draft',authorization:'Owner approved this exact draft account'};
 const cohort={version:1,id:'recover-original-accepted',mode:'draft',authorization:'Owner approved this exact recovery draft',expectedArticles:1,members:[{batchId:e.batchId,manifestSha256:e.manifestSha256,section:e.section,siteId:site.id,articleId:id,requestKey:oldKey,jobId:e.originalJobId,planId:e.planId,revision:1,sha256:e.expectedSourceSha256,artifactSha256:response.artifactSha256,grant}]};
 await durableWriteJson(join(f.input.handoffDirectory,'postiz-policy.json'),{enabled:true,authorization:'Separate original destination approval',sources:[{siteId:site.id,articleId:id,sha256:e.expectedSourceSha256}],targets});
 const authorize=()=>authorizeRecoveryCohort({handoffDirectory:f.input.handoffDirectory,cohort});
 await assert.rejects(authorize(),/original accepted cloud request changed/);const before=(await f.bytes()).slice(2);await f.restore();await assert.rejects(authorize(),/artifact is still pending/);
 const receipt=await optional(f.paths.receipt);receipt.asyncQueue.continuation.artifact=await saveCloudContinuationArtifact({root:f.root,siteId:site.id,articleId:id,receipt,response});await durableWriteJson(f.paths.receipt,receipt);
 assert.equal((await authorize()).status,'authorized');assert.equal((await handoffRecoveryCohort({handoffDirectory:f.input.handoffDirectory,id:cohort.id})).packets,1);assert.deepEqual((await f.bytes()).slice(2),before);
});

test('wrong credential, site, source, flow, revision and ambiguous producer ownership fail without rewriting any evidence',async t=>{
 const changes=[
  f=>{f.state.denyJob=f.input.expected.laterJobId;},
  f=>{f.state.statuses[1].jobId='f'.repeat(64);},
  f=>{f.state.statuses[1].continuation.id='f'.repeat(40);},
  f=>{f.state.statuses[1].status='running';},
  f=>{f.state.responses[1].siteId='study';},
  f=>{f.state.website[1]={...f.state.website[1],job:{id:f.receipt.job.id,status:'running'}};},
  f=>{delete f.state.website[1].articleId;},
  f=>{f.state.remote.version=2;},
  f=>{f.state.remote.published.assets[0].data='ZGlmZmVyZW50LWJ5dGVz';},
  f=>{f.state.remote.data.summary='New unpublished content';},
  f=>{f.batch.productionResults[1].requestKey=laterKey;},
  f=>{f.batch.productionResults[1].sectionId='other';},
  f=>{f.batch.productionResults[1].requestKey=undefined;},
  f=>{f.archive.asyncQueue.binding.requestKey=laterKey;},
  f=>{f.receipt.asyncQueue.owner='local';},
  f=>{f.receipt.url='/another-published-url/';},
 ];
 for(const change of changes){
  const f=await fixture(t);change(f);await durableWriteJson(f.paths.archive,f.archive);await durableWriteJson(f.paths.receipt,f.receipt);await durableWriteJson(join(f.input.handoffDirectory,'today-batch.json'),f.batch);
  const before=await f.bytes();await assert.rejects(f.restore());assert.deepEqual(await f.bytes(),before);assert.equal(await optional(f.paths.pointer),null);assert.equal(await optional(f.paths.journal),null);
 }
});

test('equal editorial source hashes cannot hide differing frozen image bytes or a second original batch owner',async t=>{
 const f=await fixture(t);f.later.data=structuredClone(f.original.data);f.later.data.assets[0].data='bmV3LWltYWdl';assert.equal(sourceContentSha256(f.original.data),sourceContentSha256(f.later.data));
 f.receipt.asyncQueue.packetSha256=hash(f.later);delete f.receipt.asyncQueue.binding;f.receipt.asyncQueue.binding=queuePublicationBinding(site,f.later,f.receipt);f.state.responses[1].packetSha256=continuationArtifactSha256(f.later);
 await durableWriteJson(f.paths.packet,f.later);await durableWriteJson(f.paths.receipt,f.receipt);const before=await f.bytes();await assert.rejects(f.restore(),/asset bytes/);assert.deepEqual(await f.bytes(),before);
 const g=await fixture(t);await durableWriteJson(join(g.input.handoffDirectory,'today-batches','another-daily-batch.json'),{...g.batch,id:'another-daily-batch'});await assert.rejects(g.restore(),/unique original batch owner/);assert.equal(g.calls.length,0);
});

test('each interrupted durable transition blocks normal workers and resumes without resending or losing the later accepted request',async t=>{
 for(const crash of ['pointer','journal','packet','receipt','index','committed']){
  const f=await fixture(t);let failed=false;const names=new Map([[f.paths.journal,'journal'],[f.paths.packet,'packet'],[f.paths.receipt,'receipt']]);
  const writeJson=async(file,value)=>{await durableWriteJson(file,value);if(!failed&&(file===f.paths.pointer?(value.phase==='committed'?'committed':'pointer'):names.get(file))===crash){failed=true;throw Error('Simulated interruption');}};
  const index=async(...args)=>{await indexPublicationQueue(...args);if(crash==='index')throw Error('Simulated interruption');};
  await assert.rejects(f.restore({writeJson,index}),/Simulated interruption/);
  if(crash==='committed')await assertCloudRecoverySettled(f.directory);else await assert.rejects(assertCloudRecoverySettled(f.directory),/incomplete/);
  assert.equal((await f.restore()).status,'restored');await assertCloudRecoverySettled(f.directory);assert.deepEqual(await optional(f.paths.packet),f.original);assert.deepEqual(await optional(f.paths.receipt),f.archive);assert.deepEqual((await optional(f.paths.journal)).retainedAccepted.receipt,f.receipt);assert(f.calls.every(call=>call.method==='GET'));
 }
});

test('concurrent changes, immutable journal tampering and a third intent are preserved and never overwritten',async t=>{
 const f=await fixture(t);await assert.rejects(f.restore({writeJson:async(file,value)=>{await durableWriteJson(file,value);throw Error('Interrupted');}}));
 const changed={...f.later,requestKey:'third-concurrent-intent'};await durableWriteJson(f.paths.packet,changed);await assert.rejects(f.restore(),/outside the pending/);assert.deepEqual(await optional(f.paths.packet),changed);
 const g=await fixture(t);await g.restore();const journal=await optional(g.paths.journal);journal.retainedAccepted.receipt.checkedAt='Changed';await durableWriteJson(g.paths.journal,journal);await assert.rejects(g.restore(),/journal changed/);
 const h=await fixture(t);const fetcher=async(...args)=>{const response=await h.fetcher(...args);if(args[0].endsWith('/news/'+id))await durableWriteJson(h.paths.receipt,{...h.receipt,checkedAt:'Concurrent update'});return response;};await assert.rejects(h.restore({fetcher}),/changed during/);assert.equal((await optional(h.paths.receipt)).checkedAt,'Concurrent update');assert.equal(await optional(h.paths.pointer),null);
});

test('the old unsent entry still rejects accepted current requests, and worker lock contention prevents network reads',async t=>{
 const f=await fixture(t);await assert.rejects(restoreOriginalCloudRequest({root:f.root,site,id,paths:{dir:f.directory,...f.paths},expected:{articleId:id,originalRequestKey:oldKey,originalJobId:f.input.expected.originalJobId,supersededRequestKey:laterKey,expectedSourceSha256:f.input.expected.expectedSourceSha256}}),/proven unsent/);
 let entered,release;const ready=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);const occupied=withFileLock(join(f.directory,'queue-worker.lock'),async()=>{entered();await hold;});await ready;
 try{await assert.rejects(f.restore(),/文件正在保存/);assert.equal(f.calls.length,0);assert.equal(await optional(join(f.directory,'operation.lock')),null);}finally{release();await occupied;}
});

test('the exact-input CLI uses only real authenticated GETs, rejects ambient credentials, and needs no editorial inventory',async t=>{
 const f=await fixture(t),methods=[];let localSite;
 const server=createServer(async(request,response)=>{
  methods.push(request.method);const result=await f.fetcher('https://queue.example'+request.url,{method:request.method,redirect:'error',headers:{Authorization:request.headers.authorization,'X-Scholay-Site':request.headers['x-scholay-site']}});response.writeHead(result.status,{'Content-Type':'application/json'});response.end(await result.text());
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 localSite={...site,origin:'http://127.0.0.1:'+server.address().port};f.input.site=localSite;
 for(const [packet,receipt,i] of [[f.original,f.archive,0],[f.later,f.receipt,1]]){packet.origin=localSite.origin;receipt.asyncQueue.endpoint=localSite.origin;receipt.asyncQueue.packetSha256=hash(packet);delete receipt.asyncQueue.binding;receipt.asyncQueue.binding=queuePublicationBinding(localSite,packet,receipt);f.state.responses[i].packetSha256=continuationArtifactSha256(packet);}
 await durableWriteJson(join(f.root,'.site.json'),localSite);await durableWriteJson(f.paths.packet,f.later);await durableWriteJson(f.paths.receipt,f.receipt);await durableWriteJson(f.paths.archive,f.archive);
 const inputFile=join(f.root,'exact-input.json');await durableWriteJson(inputFile,f.input);const script=join(process.cwd(),'scripts/cloud-accepted-request-recovery.mjs'),env={...process.env};
 for(const name of ['SCHOLAY_TODAY_TOKEN','SCHOLAY_TODAY_TOKEN_FILE','SCHOLAY_TODAY_ORIGIN','SCHOLAY_SITE_ID','SCHOLAY_SITE_CONFIG','SCHOLAY_SITE_JSON','SCHOLAY_PUBLICATION_QUEUE_CONFIG'])delete env[name];
 const exec=promisify(execFile);await assert.rejects(exec(process.execPath,[script,inputFile],{env:{...env,SCHOLAY_TODAY_TOKEN:'AMBIENT_TOKEN'}}),/neutral environment/);assert.equal(methods.length,0);
 const {stdout}=await exec(process.execPath,[script,inputFile],{env});assert.equal(JSON.parse(stdout).status,'restored');assert(!stdout.includes(secret));assert.equal(methods.length,7);assert(methods.every(method=>method==='GET'));assert.deepEqual(await optional(f.paths.receipt),f.archive);
 assert.equal(await optional(join(f.root,'_ops/inventory/article-index.json')),null);assert.deepEqual(await readdir(join(f.directory,'accepted-equivalent')),[laterKey+'.json']);
});
