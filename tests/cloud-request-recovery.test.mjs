import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {profiles,setSiteContext,publicationDirectory} from '../scripts/site-config.mjs';
import {hash,atomic,optional} from '../scripts/publishing-flow.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {continuationArtifactSha256} from '../scripts/publishing-flow-artifact.mjs';
import {cloudPublicationJobId} from '../scripts/publication-queue-client.mjs';
import {queuePublicationBinding,indexPublicationQueue} from '../scripts/publication-queue-status.mjs';
import {restoreOriginalCloudRequest,assertCloudRecoverySettled} from '../scripts/publication-cloud-identity-recovery.mjs';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';
import {withFileLock} from '../scripts/editorial-lock.mjs';
import {durableWriteJson} from '../scripts/durable-json.mjs';
import {createCloudQueue} from '../scripts/cloud-queue.mjs';
import {createCloudQueueServer} from '../scripts/cloud-queue-server.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';

const site=profiles.find(value=>value.id==='metho'),id='draft-recovery-original';
const oldKey='original-accepted-request',newKey='duplicate-unsent-request';
const data={id,title:'原文研究',summary:'完整研究摘要',markdown:'# 原文研究\n\n不能丢失原稿限制。',date:'2026-10-24',category:site.columns[0],author:site.author,assets:[]};
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'cloud-identity-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));setSiteContext(site);
 const previous=process.env.SCHOLAY_TODAY_TOKEN;process.env.SCHOLAY_TODAY_TOKEN='RECOVERY_TEST_TOKEN';t.after(()=>{if(previous===undefined)delete process.env.SCHOLAY_TODAY_TOKEN;else process.env.SCHOLAY_TODAY_TOKEN=previous;});
 const directory=join(publicationDirectory(root),id),paths={dir:directory,packet:join(directory,'prepared.json'),receipt:join(directory,'receipt.json')};await mkdir(directory,{recursive:true});
 const packet={siteId:site.id,spaceId:site.spaceId,origin:site.origin,data,intent:'publish',releaseLocal:false,expectedVersion:0,expectedPublishedVersion:null,requestKey:oldKey,sourceSha256:'a'.repeat(64),localFingerprint:'b'.repeat(64),preparedAt:'2026-10-24T00:00:00Z'};
 const jobId=cloudPublicationJobId(site.id,oldKey),endpoint='https://queue.example',archive={intent:'publish',status:'submitted',requestKey:oldKey,sourceSha256:packet.sourceSha256,revision:1,url:'/news/'+id+'/',publicReadback:true,job:{id:'original-website-job',status:'success'},asyncQueue:{version:1,owner:'cloud',continuationOwner:'cloud',endpoint,jobId,packetSha256:hash(packet),continuation:{id:'c'.repeat(40),owner:'cloud',status:'queued'}}};archive.asyncQueue.binding=queuePublicationBinding(site,packet,archive);
 const newerPacket={...packet,requestKey:newKey,expectedVersion:1,expectedPublishedVersion:1,preparedAt:'2026-10-24T01:00:00Z'};
 const newerReceipt={intent:'publish',status:'local_queued',requestKey:newKey,sourceSha256:packet.sourceSha256,job:{id:newKey,status:'queued'},asyncQueue:{version:1,owner:'local',continuationOwner:'cloud',endpoint,phase:'queued',attempts:0,packetSha256:hash(newerPacket)}};newerReceipt.asyncQueue.binding=queuePublicationBinding(site,newerPacket,newerReceipt);
 const expected={articleId:id,originalRequestKey:oldKey,originalJobId:jobId,supersededRequestKey:newKey,expectedSourceSha256:sourceContentSha256(data)};
 const response={version:1,status:'ready',jobId,siteId:site.id,articleId:id,requestKey:oldKey,continuationOwner:'cloud',packetSha256:continuationArtifactSha256(packet),sourceSha256:expected.expectedSourceSha256,packet,receipt:{requestKey:oldKey,revision:1,url:archive.url,publicReadback:true,job:archive.job}};
 const sync={remoteId:id,revision:1,cloudRevision:1,publishedRevision:1,requestKey:oldKey,fingerprint:packet.localFingerprint};
 await atomic(paths.packet,newerPacket);await atomic(paths.receipt,newerReceipt);await atomic(join(directory,'receipt-'+oldKey+'.json'),archive);await atomic(join(directory,'sync.json'),sync);
 const calls=[],state={newCloud:404,newWebsite:404,remote:{version:1,publishedVersion:1,published:data},response};
 const api=async path=>{
  calls.push({kind:'website',path,method:'GET'});
  if(path==='/requests/'+newKey){if(state.newWebsite!==200)throw Object.assign(Error('New website lookup'),{statusCode:state.newWebsite});return {requestKey:newKey};}
  if(path==='/requests/'+oldKey)return response.receipt;
  if(path==='/'+id)return state.remote;
  assert.fail('Unexpected website API '+path);
 };
 const fetcher=async(url,options={})=>{
  assert.equal(options.method||'GET','GET','Recovery must never POST');const path=new URL(url).pathname;
  if(new URL(url).origin===endpoint){
   calls.push({kind:'queue',path,method:'GET'});
   if(path==='/v1/jobs/'+jobId+'/recovery-packet')return Response.json(state.response);
   if(path==='/v1/jobs/'+cloudPublicationJobId(site.id,newKey))return state.newCloud===200?Response.json({jobId:cloudPublicationJobId(site.id,newKey),siteId:site.id,requestKey:newKey,articleId:id,continuationOwner:'cloud'}):Response.json({error:'New cloud lookup'},{status:state.newCloud});
  }
  if(path==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin});
  if(path.startsWith('/manage/api/news')){try{return Response.json(await api(path.slice('/manage/api/news'.length)));}catch(error){return Response.json({error:error.message},{status:error.statusCode});}}
  assert.fail('Unexpected read '+url);
 };
 const options={root,site,id,paths,expected,api,fetcher,tokenFile:join(root,'unused-token')};
 const restore=extra=>restoreOriginalCloudRequest({...options,...extra}),publisher=()=>createWebsitePublisher({root,site,fetcher,tokenFile:options.tokenFile});
 const bytes=async()=>Promise.all([paths.packet,paths.receipt,join(directory,'receipt-'+oldKey+'.json'),join(directory,'sync.json')].map(file=>readFile(file,'utf8')));
 return {root,directory,paths,packet,newerPacket,newerReceipt,archive,expected,response,sync,state,calls,options,restore,publisher,bytes};
}

test('restores the exact accepted request and records the superseded complete intent using only GET, without rewinding a later refreshed receipt',async t=>{
 const f=await fixture(t),before=await f.bytes();const result=await f.publisher().recoverCloudRequest(id,f.expected);assert.equal(result.status,'restored');
 assert.deepEqual(await optional(f.paths.packet),f.packet);assert.deepEqual(await optional(f.paths.receipt),f.archive);
 const journal=await optional(join(f.directory,'superseded',newKey+'.json'));assert.equal(journal.superseded.status,'superseded');assert.deepEqual(journal.superseded.packet,f.newerPacket);assert.deepEqual(journal.superseded.receipt,f.newerReceipt);
 const after=await f.bytes();assert.equal(after[2],before[2]);assert.equal(after[3],before[3]);assert(f.calls.every(call=>call.method==='GET'));
 assert((await optional(join(publicationDirectory(f.root),'queue-index.json'))).items[id]);
 const refreshed={...f.archive,checkedAt:'2026-10-25T00:00:00Z',asyncQueue:{...f.archive.asyncQueue,phase:'complete'}};await atomic(f.paths.receipt,refreshed);const reads=f.calls.length;
 assert.equal((await f.publisher().recoverCloudRequest(id,f.expected)).alreadyRestored,true);assert.deepEqual(await optional(f.paths.receipt),refreshed);assert.equal(f.calls.length,reads);
});

test('ambiguous or attempted local intents, wrong source and already-existing new requests leave all original files untouched',async t=>{
 for(const change of [
  f=>{f.newerReceipt.asyncQueue.phase=null;},f=>{f.newerReceipt.asyncQueue.phase='transferring';},f=>{f.newerReceipt.asyncQueue.attempts=1;},f=>{f.newerReceipt.status='submit_intent';},f=>{f.newerReceipt.asyncQueue.jobId='f'.repeat(64);},
  f=>{f.expected.expectedSourceSha256='f'.repeat(64);},f=>{f.expected.originalJobId='f'.repeat(64);},f=>{f.state.newCloud=200;},f=>{f.state.newCloud=503;},f=>{f.state.newWebsite=200;},f=>{f.state.newWebsite=403;},
  f=>{f.state.remote={...f.state.remote,version:2};},f=>{f.state.remote={...f.state.remote,published:{...data,summary:'Changed'}};},
 ]){
  const f=await fixture(t);change(f);await atomic(f.paths.receipt,f.newerReceipt);const before=await f.bytes();await assert.rejects(f.restore());assert.deepEqual(await f.bytes(),before);assert.equal(await optional(join(f.directory,'cloud-request-recovery.json')),null);
 }
});

test('matching Markdown alone cannot supersede changed metadata, image bytes, old packet digest or original owner',async t=>{
 for(const change of [
  f=>{f.newerPacket.data={...data,summary:'New intended summary'};f.expected.expectedSourceSha256=sourceContentSha256(f.newerPacket.data);},
  f=>{f.newerPacket.data={...data,assets:[{path:'/article-media/'+('d'.repeat(64))+'.png',data:'new-bytes'}]};f.expected.expectedSourceSha256=sourceContentSha256(f.newerPacket.data);},
  f=>{f.archive.asyncQueue.packetSha256='f'.repeat(64);},f=>{f.archive.asyncQueue.owner='local';},f=>{f.archive.asyncQueue.binding.requestKey='other-original-request';},
 ]){
  const f=await fixture(t);change(f);f.newerReceipt.asyncQueue.packetSha256=hash(f.newerPacket);delete f.newerReceipt.asyncQueue.binding;f.newerReceipt.asyncQueue.binding=queuePublicationBinding(site,f.newerPacket,f.newerReceipt);
  await atomic(f.paths.packet,f.newerPacket);await atomic(f.paths.receipt,f.newerReceipt);await atomic(join(f.directory,'receipt-'+oldKey+'.json'),f.archive);const before=await f.bytes();await assert.rejects(f.restore());assert.deepEqual(await f.bytes(),before);
 }
});

test('equal content identity with changed asset bytes still refuses to supersede the newer packet',async t=>{
 const f=await fixture(t),asset={path:'/article-media/'+('d'.repeat(64))+'.png',data:'b2xkLWltYWdl'};
 f.packet.data={...data,assets:[asset]};f.newerPacket.data={...f.packet.data,assets:[{...asset,data:'bmV3LWltYWdl'}]};
 assert.equal(sourceContentSha256(f.packet.data),sourceContentSha256(f.newerPacket.data));
 f.expected.expectedSourceSha256=sourceContentSha256(f.packet.data);f.response.sourceSha256=f.expected.expectedSourceSha256;f.response.packetSha256=continuationArtifactSha256(f.packet);
 f.archive.asyncQueue.packetSha256=hash(f.packet);delete f.archive.asyncQueue.binding;f.archive.asyncQueue.binding=queuePublicationBinding(site,f.packet,f.archive);
 f.newerReceipt.asyncQueue.packetSha256=hash(f.newerPacket);delete f.newerReceipt.asyncQueue.binding;f.newerReceipt.asyncQueue.binding=queuePublicationBinding(site,f.newerPacket,f.newerReceipt);
 await atomic(f.paths.packet,f.newerPacket);await atomic(f.paths.receipt,f.newerReceipt);await atomic(join(f.directory,'receipt-'+oldKey+'.json'),f.archive);const before=await f.bytes();
 await assert.rejects(f.restore(),/asset bytes/);assert.deepEqual(await f.bytes(),before);
});

test('crashes at each durable transition stop ordinary workers and resume the same journal without re-sending',async t=>{
 for(const crash of [1,2,3,4,5]){
  const f=await fixture(t);let writes=0;
  const writeJson=async(file,value)=>{await durableWriteJson(file,value);if(++writes===crash)throw Error('Simulated crash');};
  const index=async(...args)=>{await indexPublicationQueue(...args);if(crash===5)throw Error('Simulated crash');};
  await assert.rejects(f.restore({writeJson,index}),/Simulated crash/);
  await assert.rejects(assertCloudRecoverySettled(f.directory),/incomplete/);const reads=f.calls.length;
  await assert.rejects(f.publisher().runQueued(id),/incomplete/);assert.equal(f.calls.length,reads);
  assert.equal((await f.restore()).status,'restored');await assertCloudRecoverySettled(f.directory);assert.deepEqual(await optional(f.paths.packet),f.packet);assert.deepEqual(await optional(f.paths.receipt),f.archive);
  assert(f.calls.every(call=>call.method==='GET'));
 }
});

test('a concurrent edit or changed evidence during recovery is retained, never overwritten from the journal',async t=>{
 const f=await fixture(t);let written=0;await assert.rejects(f.restore({writeJson:async(file,value)=>{await durableWriteJson(file,value);if(++written===1)throw Error('Interrupted');}}));
 const changed={...f.newerPacket,data:{...data,summary:'Concurrent editorial change'}};await atomic(f.paths.packet,changed);await assert.rejects(f.restore(),/outside the pending/);assert.deepEqual(await optional(f.paths.packet),changed);
 const g=await fixture(t),fetcher=async(url,options)=>{const response=await g.options.fetcher(url,options);if(url.endsWith('/recovery-packet'))await atomic(g.paths.receipt,{...g.newerReceipt,checkedAt:'Concurrent change'});return response;};
 await assert.rejects(g.restore({fetcher}),/changed during/);assert.equal((await optional(g.paths.receipt)).checkedAt,'Concurrent change');assert.equal(await optional(join(g.directory,'cloud-request-recovery.json')),null);
});

test('the publisher recovery obtains the worker lock before touching the operation or network',async t=>{
 const f=await fixture(t);let entered,release;const ready=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 const occupied=withFileLock(join(f.directory,'queue-worker.lock'),async()=>{entered();await hold;});await ready;
 try{await assert.rejects(f.publisher().recoverCloudRequest(id,f.expected),/文件正在保存/);assert.equal(f.calls.length,0);assert.equal(await optional(join(f.directory,'operation.lock')),null);}finally{release();await occupied;}
});

test('the recovery endpoint is original-credential and site scoped, validates packet bytes, and exposes no credentials or policy',async t=>{
 const root=await mkdtemp(join(tmpdir(),'recovery-packet-scope-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const tokenFile=join(root,'server-token');await writeFile(tokenFile,'SERVER_RECOVERY_SECRET',{mode:0o600});await protectPrivateFile(tokenFile);
 const other=profiles.find(value=>value.id==='study'),sites=[{site,tokenFile},{site:other,tokenFile}],directory=join(root,'queue');
 const queue=createCloudQueue({directory,sites,continuation:async()=>({id:'c'.repeat(40),status:'queued'}),fetcher:async(url,options)=>{
  assert.equal(options?.method||'GET','GET');const matched=sites.find(value=>new URL(url).origin===value.site.origin).site;
  return url.endsWith('/api/site')?Response.json({protocol:'scholay-content',version:1,siteId:matched.id,origin:matched.origin}):Response.json({scope:'all',items:[]});
 }});
 const principal=await queue.authorize(site.id,'Bearer ORIGINAL_RECOVERY_CREDENTIAL'),packet={siteId:site.id,spaceId:site.spaceId,origin:site.origin,data,intent:'publish',requestKey:oldKey,sourceSha256:'a'.repeat(64),expectedVersion:0,expectedPublishedVersion:null};
 const accepted=await queue.enqueue(site.id,packet,{credentialId:principal.credentialId,continuationOwner:'cloud'}),stateFile=join(directory,'jobs',accepted.jobId,'state.json'),state=await optional(stateFile);
 await atomic(stateFile,{...state,status:'complete',receipt:{requestKey:oldKey,revision:1,url:'/news/'+id+'/',publicReadback:true,job:{id:'website-job',status:'success'}}});
 const server=createCloudQueueServer({queue});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const endpoint='http://127.0.0.1:'+server.address().port+'/v1/jobs/'+accepted.jobId+'/recovery-packet',headers={Authorization:'Bearer ORIGINAL_RECOVERY_CREDENTIAL','X-Scholay-Site':site.id};
 assert.equal((await fetch(endpoint)).status,401);assert.equal((await fetch(endpoint,{headers:{...headers,Authorization:'Bearer ANOTHER_VALID_CREDENTIAL'}})).status,404);assert.equal((await fetch(endpoint,{headers:{...headers,'X-Scholay-Site':other.id}})).status,404);
 const result=await fetch(endpoint,{headers});assert.equal(result.status,200);const body=await result.json();assert.deepEqual(body.packet,packet);for(const secret of ['SERVER_RECOVERY_SECRET','ORIGINAL_RECOVERY_CREDENTIAL','credentialId','tokenFile','policy'])assert(!JSON.stringify(body).includes(secret));
 await atomic(join(directory,'jobs',accepted.jobId,'packet.json'),{...packet,data:{...data,markdown:'tampered'}});assert.equal((await fetch(endpoint,{headers})).status,409);
});

test('the standalone CLI restores the original pair through real GET-only HTTP and a private credential file',async t=>{
 const f=await fixture(t);let localSite;const methods=[];
 const server=createServer(async(request,response)=>{
  methods.push(request.method);const send=(code,value)=>{response.writeHead(code,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};
  if(request.method!=='GET')return send(405,{error:'Writes are forbidden'});
  if(request.url==='/manage/api/site')return send(200,{protocol:'scholay-content',version:1,siteId:site.id,origin:localSite.origin});
  if(request.headers.authorization!=='Bearer CLI_PRIVATE_RECOVERY_TOKEN')return send(401,{error:'Invalid token'});
  if(request.url==='/queue/v1/jobs/'+f.expected.originalJobId+'/recovery-packet')return send(200,f.response);
  if(request.url==='/queue/v1/jobs/'+cloudPublicationJobId(site.id,newKey)||request.url==='/manage/api/news/requests/'+newKey)return send(404,{error:'Not accepted'});
  if(request.url==='/manage/api/news/requests/'+oldKey)return send(200,f.response.receipt);
  if(request.url==='/manage/api/news/'+id)return send(200,{version:1,publishedVersion:1,published:data});
  return send(404,{error:'Unexpected path'});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});localSite={...site,origin:'http://127.0.0.1:'+server.address().port};
 for(const packet of [f.packet,f.newerPacket])packet.origin=localSite.origin;
 for(const [receipt,packet] of [[f.archive,f.packet],[f.newerReceipt,f.newerPacket]]){receipt.asyncQueue.endpoint=localSite.origin+'/queue';receipt.asyncQueue.packetSha256=hash(packet);delete receipt.asyncQueue.binding;receipt.asyncQueue.binding=queuePublicationBinding(localSite,packet,receipt);}
 f.response.packetSha256=continuationArtifactSha256(f.packet);
 await atomic(f.paths.packet,f.newerPacket);await atomic(f.paths.receipt,f.newerReceipt);await atomic(join(f.directory,'receipt-'+oldKey+'.json'),f.archive);await atomic(join(f.root,'.site.json'),localSite);
 const tokenFile=join(f.root,'private-token');await writeFile(tokenFile,'CLI_PRIVATE_RECOVERY_TOKEN',{mode:0o600});await protectPrivateFile(tokenFile);
 const input=join(f.root,'recovery-input.json');await atomic(input,{version:1,root:f.root,site:localSite,tokenFile,localId:id,expected:f.expected});
 const env={...process.env};for(const name of ['SCHOLAY_TODAY_TOKEN','SCHOLAY_TODAY_ORIGIN','SCHOLAY_SITE_ID','SCHOLAY_SITE_CONFIG','SCHOLAY_SITE_JSON'])delete env[name];
 const {stdout}=await promisify(execFile)(process.execPath,[join(process.cwd(),'scripts/cloud-request-recovery.mjs'),input],{env});assert.equal(JSON.parse(stdout).status,'restored');assert(!stdout.includes('CLI_PRIVATE_RECOVERY_TOKEN'));assert(methods.length>=5);assert(methods.every(method=>method==='GET'));assert.deepEqual(await optional(f.paths.receipt),f.archive);
});
