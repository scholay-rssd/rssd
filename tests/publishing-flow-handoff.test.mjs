import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {atomic,optional,hash,postizTick} from '../scripts/publishing-flow.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {saveCloudContinuationArtifact,continuationArtifactSha256} from '../scripts/publishing-flow-artifact.mjs';
import {authorizeCloudHandoff,handoffCloudContinuation} from '../scripts/publishing-flow-handoff.mjs';
import {initializeBatchGate,beginBatch,refreshBatch,batchGatedAdapter,validateCloudPostizPacket} from '../scripts/publishing-batch.mjs';
import {postizAdapter} from '../scripts/publishing-flow-postiz.mjs';

async function fixture(t,{ready=true}={}){
 const temp=await mkdtemp(join(tmpdir(),'cloud-handoff-'));t.after(()=>rm(temp,{recursive:true,force:true}));
 const root=join(temp,'metho'),directory=join(temp,'handoff'),resultsDirectory=join(temp,'results'),publicationDirectory=join(root,'receipts');await mkdir(root);await mkdir(resultsDirectory);
 const siteId='metho',articleId='cloud-translated-article',origin='https://metho.example',requestKey='cloud-request-original-123';
 const source={id:articleId,title:'中文文章',summary:'完整中文摘要。',markdown:'# 中文文章\n\n完整中文正文。',date:'2026-10-23',category:'文章',author:'测试',sectionId:'articles',assets:[]};
 const sha256=sourceContentSha256(source),jobId=hash([siteId,requestKey]),flowId=hash([siteId,articleId,1,sha256]).slice(0,40);
 const edition={title:'English article',summary:'Complete English summary.',markdown:'# English article\n\nComplete English body.'};
 const artifact={version:1,jobId,siteId,origin,articleId,requestKey,continuationOwner:'cloud',flowId,revision:1,sourceSha256:sha256,sourceUrl:origin+'/news/'+articleId+'/',brand:{name:'Metho',slogan:'Methods and research'},source,edition,chinese:{status:'verified',url:origin+'/news/'+articleId+'/',revision:1},english:{status:'verified',url:origin+'/en/news/'+articleId+'/',revision:1},community:{status:'verified',url:'https://enterscholar.com/t/-/12345'}};
 const response={version:1,status:'ready',jobId,siteId,articleId,requestKey,continuationOwner:'cloud',artifactSha256:continuationArtifactSha256(artifact),artifact};
 const receipt={requestKey,sourceSha256:'c'.repeat(64),submittedAt:new Date().toISOString(),publicReadback:true,job:{status:'success'},url:'/news/'+articleId+'/',revision:1,publishingFlow:{id:flowId,owner:'cloud'},asyncQueue:{owner:'cloud',continuationOwner:'cloud',jobId,packetSha256:'b'.repeat(64),binding:{version:1,siteId,origin,articleId,requestKey,packetSha256:'b'.repeat(64),sourceSha256:'c'.repeat(64)},continuation:{id:flowId,status:'complete'}}};
 const targets=[{platform:'discord',locale:'zh-CN',integrationId:'discord-account',channelId:'1562031229606301696',format:'summary'},{platform:'devto',locale:'en',integrationId:'devto-account',username:'metho_author',format:'article'}];
 const grant={version:1,siteId,articleId,revision:1,sha256,artifactSha256:response.artifactSha256,targets,mode:'draft',authorization:'Approved draft accounts for this exact article'};
 const manifest={version:1,resultsDirectory,entries:[{siteId,sectionId:'articles',root,publicationDirectory,requireFlow:true,requireEnglish:true}]};
 await initializeBatchGate(directory);await beginBatch(directory,'daily-20261023',manifest);
 await atomic(join(resultsDirectory,'article.result.json'),{site:siteId,sectionId:'articles',articleId,requestKey});
 const saveReceipt=()=>atomic(join(publicationDirectory,articleId,'receipt.json'),receipt);
 async function complete(){receipt.asyncQueue.continuation.artifact=await saveCloudContinuationArtifact({root,siteId,articleId,receipt,response});await saveReceipt();}
 await saveReceipt();if(ready)await complete();
 const options={root,siteId,articleId,receipt,handoffDirectory:directory};
 const packets=async()=>(await readdir(join(directory,'outbox')).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).filter(name=>name.endsWith('.json')).sort().map(name=>join(directory,'outbox',name));
 const readPackets=async()=>Promise.all((await packets()).map(optional));
 return {root,directory,resultsDirectory,manifest,grant,receipt,response,jobId,flowId,options,complete,saveReceipt,readPackets};
}

test('cloud handoff waits for the durable artifact and explicit local authorization without creating executable jobs',async t=>{
 const f=await fixture(t,{ready:false});
 assert.equal((await handoffCloudContinuation({...f.options,authorization:f.grant})).status,'waiting_for_artifact');
 assert.equal((await refreshBatch(f.directory)).checks[0].status,'waiting_for_continuation');assert.deepEqual(await f.readPackets(),[]);
 await f.complete();assert.equal((await refreshBatch(f.directory)).status,'complete');
 assert.equal((await handoffCloudContinuation(f.options)).status,'waiting_for_authorization');assert.deepEqual(await f.readPackets(),[]);
 assert.deepEqual(await readdir(join(f.root,'.local/publishing-flow')),['remote']);
});

test('an exact cloud grant freezes once, resumes without new approval and produces only immutable draft packets',async t=>{
 const f=await fixture(t);const first=await authorizeCloudHandoff({...f.options,authorization:f.grant});assert.equal(first.status,'authorized');assert.deepEqual(await f.readPackets(),[]);
 assert.deepEqual(await authorizeCloudHandoff({...f.options,authorization:structuredClone(f.grant)}),first);
 const handed=await handoffCloudContinuation(f.options);assert.equal(handed.status,'ready');assert.equal(handed.packets.length,2);
 assert.deepEqual(await handoffCloudContinuation(f.options),handed);
 for(const packet of await f.readPackets()){
  assert.equal(packet.cloudContinuation.jobId,f.jobId);assert.equal(packet.cloudContinuation.mode,'draft');assert.equal(packet.cloudContinuation.authorizationSha256,first.authorizationSha256);
  assert.equal(packet.source.sha256,f.grant.sha256);assert.equal(packet.bodySha256,hash(packet.body));assert.equal(packet.cloudContinuation.batchId,'daily-20261023');
  if(packet.target.platform==='devto')assert.equal(packet.target.username,'metho_author');
 }
 assert.deepEqual(await readdir(join(f.root,'.local/publishing-flow')),['remote']);
});

test('changed source, translation artifact, account list and publish mode cannot expand a frozen cloud grant',async t=>{
 const f=await fixture(t);
 for(const patch of [{articleId:'another-article'},{revision:2},{sha256:'e'.repeat(64)},{artifactSha256:'e'.repeat(64)},{mode:'publish'},{authorization:''},{targets:[]},{targets:[{...f.grant.targets[0],integrationId:'*'}]}])await assert.rejects(authorizeCloudHandoff({...f.options,authorization:{...f.grant,...patch}}));
 assert.deepEqual(await f.readPackets(),[]);
 await authorizeCloudHandoff({...f.options,authorization:f.grant});
 await assert.rejects(handoffCloudContinuation({...f.options,authorization:{...f.grant,targets:[{...f.grant.targets[0],integrationId:'different-account'}]}}),/original authorization/);
 assert.deepEqual(await f.readPackets(),[]);
});

test('completed remote evidence satisfies the batch and draft reconciliation does not submit twice',async t=>{
 const f=await fixture(t);await handoffCloudContinuation({...f.options,authorization:f.grant});let sends=0,queries=0;
 const transport={delivery:{mode:'draft'},preflight:async()=>{},submit:async packet=>{sends++;return {postId:packet.id};},readback:async()=>{queries++;return {status:'draft_saved'};}};
 const tick=()=>postizTick({handoffDirectory:f.directory,adapter:batchGatedAdapter(f.directory,transport)});
 const state=await refreshBatch(f.directory);assert.equal(state.releaseReady,true);assert.equal(state.checks[0].cloudJobId,f.jobId);assert.equal(state.checks[0].artifactSha256,f.response.artifactSha256);
 assert((await tick()).every(result=>result.status==='draft_saved'));assert((await tick()).every(result=>result.status==='draft_saved'));assert.equal(sends,2);assert.equal(queries,2);
});

test('the batch rejects changed cloud bodies, accounts, identities and stripped artifact bindings before transport',async t=>{
 const f=await fixture(t);await handoffCloudContinuation({...f.options,authorization:f.grant});const packet=(await f.readPackets())[0];let calls=0;
 const preflight=packet=>batchGatedAdapter(f.directory,{preflight:async()=>{calls++;}}).preflight(packet);
 await preflight(packet);assert.equal(calls,1);
 const stripped={...packet};delete stripped.cloudContinuation;
 for(const changed of [stripped,{...packet,target:{...packet.target,integrationId:'different-account'}},{...packet,source:{...packet.source,revision:2}},{...packet,body:packet.body+' changed',bodySha256:hash(packet.body+' changed')},{...packet,cloudContinuation:{...packet.cloudContinuation,artifactSha256:'e'.repeat(64)}},{...packet,cloudContinuation:{...packet.cloudContinuation,mode:'publish'}}])await assert.rejects(preflight(changed));
 assert.equal(calls,1);
});

test('idle and unowned batches cannot release cloud packets even after removing their cloud marker',async t=>{
 const f=await fixture(t);await handoffCloudContinuation({...f.options,authorization:f.grant});const packet=(await f.readPackets())[0];
 await atomic(join(f.directory,'today-batch.json'),{version:1,status:'idle'});
 const stripped={...packet};delete stripped.cloudContinuation;
 for(const candidate of [packet,stripped]){
  await assert.rejects(batchGatedAdapter(f.directory,{preflight:async()=>assert.fail('No transport')}).preflight(candidate),/retained Today batch/);
  await assert.rejects(validateCloudPostizPacket({handoffDirectory:f.directory,packet:candidate}),/retained Today batch/);
 }
 await assert.rejects(handoffCloudContinuation(f.options),/unique retained Today batch/);
});

test('raw adapter cloud validation enforces the exact local grant without changing legacy packet handling',async t=>{
 const f=await fixture(t);await handoffCloudContinuation({...f.options,authorization:f.grant});const packet=(await f.readPackets())[0];
 await validateCloudPostizPacket({handoffDirectory:f.directory,packet});
 await assert.rejects(validateCloudPostizPacket({handoffDirectory:f.directory,packet:{...packet,target:{...packet.target,integrationId:'different-account'}}}));
 const stripped={...packet};delete stripped.cloudContinuation;await assert.rejects(validateCloudPostizPacket({handoffDirectory:f.directory,packet:stripped}));
 const legacy={...stripped,planId:'f'.repeat(40),source:{...stripped.source,articleId:'legacy-article'}};await validateCloudPostizPacket({handoffDirectory:f.directory,packet:legacy});
});

test('a real authorized cloud packet stays draft under global publish policy and direct submit cannot bypass its batch',async t=>{
 const f=await fixture(t);await handoffCloudContinuation({...f.options,authorization:f.grant});const packet=(await f.readPackets()).find(value=>value.target.platform==='discord'),calls=[];
 const adapter=postizAdapter({handoffDirectory:f.directory,allowedSources:[{siteId:f.grant.siteId,articleId:f.grant.articleId,sha256:f.grant.sha256}],allowedTargets:f.grant.targets,delivery:'publish',publishAuthorization:'Separate legacy publication approval',executor:async(command,args)=>{calls.push(args);return {stdout:JSON.stringify({response:{postId:'saved-cloud-draft'}})};},fetcher:async()=>assert.fail('Direct submit only performs its mandatory local batch validation')});
 assert.deepEqual(adapter.deliveryFor(packet),{mode:'draft'});
 await assert.rejects(adapter.submit(packet,{preflighted:true,delivery:{mode:'publish',authorization:'Separate legacy publication approval'}}),/cannot be promoted/);
 assert.equal((await adapter.submit(packet,{preflighted:true})).postId,'saved-cloud-draft');assert.equal(calls.length,1);
 assert.equal(calls[0][0],'create');assert(!calls[0].includes('--publish-now'));assert(!calls[0].includes('--confirm-user-approved'));
 await atomic(join(f.directory,'today-batch.json'),{version:1,status:'idle'});
 await assert.rejects(adapter.submit(packet,{preflighted:true}),/retained Today batch/);assert.equal(calls.length,1);
});

test('a frozen cloud batch continues through its archive while the next batch is incomplete',async t=>{
 const f=await fixture(t);await handoffCloudContinuation({...f.options,authorization:f.grant});const packets=await f.readPackets();
 await beginBatch(f.directory,'daily-20261024',f.manifest);assert.equal((await refreshBatch(f.directory)).releaseReady,false);
 assert.equal((await handoffCloudContinuation(f.options)).batchId,'daily-20261023');let calls=0;
 const gated=batchGatedAdapter(f.directory,{preflight:async()=>{calls++;}});for(const packet of packets)await gated.preflight(packet);assert.equal(calls,2);
});

test('a receipt or batch mismatch cannot authorize packets and a reserved conflicting slot is retained',async t=>{
 const f=await fixture(t);await assert.rejects(authorizeCloudHandoff({...f.options,authorization:f.grant,batchId:'daily-wrong'}),/requested batch/);
 const receipt=structuredClone(f.receipt);receipt.requestKey='different-request';await assert.rejects(authorizeCloudHandoff({...f.options,receipt,authorization:f.grant}));
 await authorizeCloudHandoff({...f.options,authorization:f.grant});await handoffCloudContinuation(f.options);const packet=(await f.readPackets())[0];
 await atomic(join(f.directory,'slots',packet.slot+'.json'),{id:'a'.repeat(40)});await assert.rejects(handoffCloudContinuation(f.options),/another delivery revision/);
 assert.equal((await optional(join(f.directory,'slots',packet.slot+'.json'))).id,'a'.repeat(40));
});

test('tampering with imported translation bytes closes the batch and cannot regenerate a different packet',async t=>{
 const f=await fixture(t);await handoffCloudContinuation({...f.options,authorization:f.grant});const before=await f.readPackets();
 const changed=structuredClone(f.response);changed.artifact.edition.markdown+=' tampered';changed.artifactSha256=continuationArtifactSha256(changed.artifact);
 await atomic(join(f.root,'.local/publishing-flow/remote',f.jobId+'.json'),changed);
 const state=await refreshBatch(f.directory);assert.equal(state.releaseReady,false);assert.equal(state.checks[0].status,'needs_review');
 await assert.rejects(handoffCloudContinuation(f.options));assert.deepEqual(await f.readPackets(),before);
});
