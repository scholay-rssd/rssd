import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {atomic,optional,hash,postizTick} from '../scripts/publishing-flow.mjs';
import {sourceContentSha256,editionArticleId} from '../contracts/language-editions.mjs';
import {saveCloudContinuationArtifact,continuationArtifactSha256,readCloudContinuationEvidence} from '../scripts/publishing-flow-artifact.mjs';
import {bindCloudHandoffEvidence,cloudHandoffPacket,handoffCloudContinuation} from '../scripts/publishing-flow-handoff.mjs';
import {initializeBatchGate,beginBatch,settleBatch,refreshBatch,batchGatedAdapter,validateCloudPostizPacket} from '../scripts/publishing-batch.mjs';
import {authorizeRecoveryCohort,handoffRecoveryCohort,recoveryCohortStatus,tickRecoveryCohort} from '../scripts/publishing-recovery-cohort.mjs';
import {profiles} from '../scripts/site-config.mjs';

const targets=[{platform:'discord',locale:'zh-CN',integrationId:'approved-discord',channelId:'1562031229606301696',format:'summary'},{platform:'devto',locale:'en',integrationId:'approved-devto',username:'approved_author',format:'article'}];
async function fixture(t){
 const temporary=await mkdtemp(join(tmpdir(),'draft-cohort-'));t.after(()=>rm(temporary,{recursive:true,force:true}));
 const directory=join(temporary,'handoff');await initializeBatchGate(directory);const articles=[];
 async function begin(siteId,batchId){
  const root=join(temporary,siteId),resultsDirectory=join(temporary,batchId),publicationDirectory=join(root,'receipts');await mkdir(resultsDirectory);await mkdir(root,{recursive:true});
  const manifest={version:1,resultsDirectory,entries:[{siteId,sectionId:'articles',root,publicationDirectory,requireFlow:true,requireEnglish:true},{siteId:'pets',sectionId:'articles',root:join(temporary,'pets'),publicationDirectory:join(temporary,'pets/receipts'),requireFlow:false,requireEnglish:false}]};
  await beginBatch(directory,batchId,manifest);return {siteId,batchId,root,resultsDirectory,publicationDirectory,manifest};
 }
 async function article(batch,articleId){
  const {siteId,root,publicationDirectory}=batch,origin=profiles.find(site=>site.id===siteId).origin,requestKey='original-request-'+articleId;
  const source={id:articleId,title:'中文研究文章',summary:'完整研究摘要。',markdown:'# 中文研究文章\n\n保留研究限制。',date:'2026-10-24',category:'文章',author:'测试',sectionId:'articles',assets:[]};
  const sha256=sourceContentSha256(source),jobId=hash([siteId,requestKey]),planId=hash([siteId,articleId,1,sha256]).slice(0,40);
  const artifact={version:1,jobId,siteId,origin,articleId,requestKey,continuationOwner:'cloud',flowId:planId,revision:1,sourceSha256:sha256,sourceUrl:origin+'/news/'+articleId+'/',brand:{name:siteId,slogan:'Research'},source,edition:{title:'Research article',summary:'Full research summary.',markdown:'# Research article\n\nRetain the study limitations.'},chinese:{status:'verified',url:origin+'/news/'+articleId+'/',revision:1},english:{status:'verified',url:origin+'/en/news/'+articleId+'/',revision:1},community:{status:'verified',url:'https://enterscholar.com/t/-/12345'}};
  const response={version:1,status:'ready',jobId,siteId,articleId,requestKey,continuationOwner:'cloud',artifactSha256:continuationArtifactSha256(artifact),artifact};
  const receipt={requestKey,sourceSha256:'c'.repeat(64),submittedAt:new Date().toISOString(),publicReadback:true,job:{status:'success'},url:'/news/'+articleId+'/',revision:1,publishingFlow:{id:planId,owner:'cloud'},asyncQueue:{owner:'cloud',continuationOwner:'cloud',jobId,packetSha256:'b'.repeat(64),binding:{version:1,siteId,origin,articleId,requestKey,packetSha256:'b'.repeat(64),sourceSha256:'c'.repeat(64)},continuation:{id:planId,status:'complete'}}};
  receipt.asyncQueue.continuation.artifact=await saveCloudContinuationArtifact({root,siteId,articleId,receipt,response});
  await atomic(join(publicationDirectory,articleId,'receipt.json'),receipt);await atomic(join(batch.resultsDirectory,articleId+'.result.json'),{site:siteId,sectionId:'articles',articleId,requestKey});
  const grant={version:1,siteId,articleId,revision:1,sha256,artifactSha256:response.artifactSha256,targets,mode:'draft',authorization:'Owner approved these exact existing draft accounts'};
  const member={batchId:batch.batchId,manifestSha256:hash(batch.manifest),section:siteId+'/articles',siteId,articleId,requestKey,jobId,planId,revision:1,sha256,artifactSha256:response.artifactSha256,grant};
  const value={...batch,member,receipt,response};articles.push(value);return value;
 }
 const firstBatch=await begin('metho','daily-20261023'),first=await article(firstBatch,'recovery-first'),outside=await article(firstBatch,'outside-recovery');
 await settleBatch(directory,firstBatch.batchId);
 const secondBatch=await begin('study','daily-20261024'),second=await article(secondBatch,'recovery-second');await refreshBatch(directory);
 const cohort={version:1,id:'recover-owner-approved',mode:'draft',authorization:'Owner explicitly authorized this exact recovery scope as drafts',expectedArticles:2,members:[first.member,second.member]};
 const policy={enabled:true,authorization:'Existing Postiz destination approval',sources:articles.map(({member})=>({siteId:member.siteId,articleId:member.articleId,sha256:member.sha256})),targets};await atomic(join(directory,'postiz-policy.json'),policy);
 const packets=async()=>Promise.all((await readdir(join(directory,'outbox')).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).filter(name=>name.endsWith('.json')).map(name=>optional(join(directory,'outbox',name))));
 const authorize=()=>authorizeRecoveryCohort({handoffDirectory:directory,cohort}),handoff=()=>handoffRecoveryCohort({handoffDirectory:directory,id:cohort.id});
 const batchBytes=async()=>Promise.all([join(directory,'today-batch.json'),join(directory,'today-batches',firstBatch.batchId+'.json')].map(file=>readFile(file,'utf8')));
 async function outsidePacket(){
  const {member,root,receipt}=outside,evidence=await readCloudContinuationEvidence({root,siteId:member.siteId,articleId:member.articleId,receipt});
  const frozen={version:1,jobId:member.jobId,planId:member.planId,batchId:member.batchId,manifestSha256:member.manifestSha256,section:member.section,requestKey:member.requestKey,grant:member.grant};
  const packet=cloudHandoffPacket(bindCloudHandoffEvidence(evidence,frozen),targets[0]);await atomic(join(directory,'cloud-authorizations',member.jobId+'.json'),frozen);await atomic(join(directory,'outbox',packet.id+'.json'),packet);return packet;
 }
 return {directory,cohort,first,second,outside,policy,articles,authorize,handoff,packets,batchBytes,outsidePacket};
}

test('an exact cross-batch cohort releases only its cloud drafts while leaving both incomplete daily manifests and gates untouched',async t=>{
 const f=await fixture(t),before=await f.batchBytes();
 const archived=JSON.parse(before[1]);assert.equal(archived.checks[0].status,'needs_review','two different articles occupy the same original section');assert.equal(archived.releaseReady,false);
 assert.equal((await f.authorize()).status,'authorized');assert.deepEqual(await f.packets(),[]);assert.deepEqual(await f.batchBytes(),before);
 assert.deepEqual(await f.authorize(),await f.authorize());assert.equal((await f.handoff()).packets,4);assert.deepEqual(await f.handoff(),await f.handoff());
 assert.deepEqual(await f.batchBytes(),before);
 const packets=await f.packets();for(const packet of packets)await validateCloudPostizPacket({handoffDirectory:f.directory,packet});
 assert.deepEqual(await f.batchBytes(),before);assert(packets.every(packet=>packet.cloudContinuation.mode==='draft'));
 const status=await recoveryCohortStatus({handoffDirectory:f.directory,id:f.cohort.id});assert.equal(status.articles,2);assert.equal(status.packets,4);assert(status.members.every(member=>member.deliveries.every(delivery=>delivery.status==='not_submitted'&&delivery.public===false)));
 const resumed=await handoffCloudContinuation({root:f.first.root,siteId:f.first.member.siteId,articleId:f.first.member.articleId,receipt:f.first.receipt,handoffDirectory:f.directory});assert.equal(resumed.batchId,f.first.batchId);
 const outside=await f.outsidePacket();await assert.rejects(validateCloudPostizPacket({handoffDirectory:f.directory,packet:outside}),/Waiting/);
 const local={...packets[0]};delete local.cloudContinuation;await assert.rejects(validateCloudPostizPacket({handoffDirectory:f.directory,packet:local}),/frozen cloud marker|original cloud draft/);
});

test('cohort authorization validates every member before writing and cannot broaden count, mode, account, source or original owner',async t=>{
 const f=await fixture(t);
 const changes=[
  value=>{value.expectedArticles=27;},value=>{value.mode='publish';},value=>{value.authorization='';},value=>{value.members.push(structuredClone(value.members[0]));value.expectedArticles++;},
  value=>{value.members[1].grant.targets=[{...targets[0],integrationId:'another-account'}];},value=>{value.members[1].sha256='f'.repeat(64);},value=>{value.members[1].artifactSha256='f'.repeat(64);},
  value=>{value.members[1].batchId='daily-other';},value=>{value.members[1].manifestSha256='f'.repeat(64);},value=>{value.members[1].requestKey='different-request-identity';},value=>{value.members[1].revision=2;},value=>{value.members[1].jobId='f'.repeat(64);},value=>{value.members[1].planId='f'.repeat(40);},value=>{value.members[1].section='study/other';},
 ];
 for(const change of changes){const cohort=structuredClone(f.cohort);change(cohort);await assert.rejects(authorizeRecoveryCohort({handoffDirectory:f.directory,cohort}));assert.equal(await optional(join(f.directory,'recovery-cohorts',cohort.id+'.json')),null);}
 assert.deepEqual(await f.packets(),[]);await f.authorize();
 const changed=structuredClone(f.cohort);changed.authorization+=' extended';await assert.rejects(authorizeRecoveryCohort({handoffDirectory:f.directory,cohort:changed}),/original exact/);
 await assert.rejects(authorizeRecoveryCohort({handoffDirectory:f.directory,cohort:{...f.cohort,id:'different-cohort'}}),/another frozen/);
});

test('ambiguous same-article producer section, request or owner is rejected without using unrelated section readiness',async t=>{
 const f=await fixture(t),file=join(f.directory,'today-batches',f.first.batchId+'.json'),original=await optional(file);
 for(const result of [
  {site:'metho',sectionId:'other',articleId:f.first.member.articleId,requestKey:f.first.member.requestKey},
  {site:'metho',sectionId:'articles',articleId:f.first.member.articleId,requestKey:'another-original-request'},
  {site:'metho',sectionId:'articles',articleId:f.first.member.articleId,taskId:'task-without-request'},
 ]){await atomic(file,{...original,productionResults:[...original.productionResults,result]});await assert.rejects(f.authorize(),/ambiguous section or request/);}
 await atomic(file,original);
 const other={...original,id:'daily-ambiguous'};await atomic(join(f.directory,'today-batches',other.id+'.json'),other);await assert.rejects(f.authorize(),/unique original batch owner/);
});

test('frozen cohort admission retains full body, source, artifact, grant and target checks and cannot authorize publish or local packets',async t=>{
 const f=await fixture(t);await f.authorize();await f.handoff();const packet=(await f.packets())[0];
 const validate=packet=>validateCloudPostizPacket({handoffDirectory:f.directory,packet});await validate(packet);
 for(const changed of [
  {...packet,body:packet.body+' altered',bodySha256:hash(packet.body+' altered')},
  {...packet,target:{...packet.target,integrationId:'other-account'}},
  {...packet,source:{...packet.source,revision:2}},
  {...packet,ownContentSha256:'f'.repeat(64)},
  {...packet,cloudContinuation:{...packet.cloudContinuation,mode:'publish'}},
  {...packet,cloudContinuation:{...packet.cloudContinuation,batchId:'different-batch'}},
  {...packet,cloudContinuation:{...packet.cloudContinuation,authorizationSha256:'f'.repeat(64)}},
  {...packet,cloudContinuation:{...packet.cloudContinuation,artifactSha256:'f'.repeat(64)}},
  {...packet,cloudContinuation:undefined},
 ])await assert.rejects(validate(changed));
 const member=f.cohort.members.find(member=>member.jobId===packet.cloudContinuation.jobId),authorizationFile=join(f.directory,'cloud-authorizations',member.jobId+'.json'),grant=await optional(authorizationFile);
 await atomic(authorizationFile,{...grant,grant:{...grant.grant,authorization:'Changed authorization'}});await assert.rejects(validate(packet),/frozen grant/);await atomic(authorizationFile,grant);
 const article=f.articles.find(item=>item.member.jobId===member.jobId),artifactFile=join(article.root,'.local/publishing-flow/remote',member.jobId+'.json');
 const artifact=await optional(artifactFile);artifact.artifact.edition.markdown+=' changed';await atomic(artifactFile,artifact);await assert.rejects(validate(packet),/evidence/);
});

test('removing an existing policy destination or mutating the retained manifest closes recovery admission',async t=>{
 const f=await fixture(t);await f.authorize();await f.handoff();const packet=(await f.packets())[0];
 await atomic(join(f.directory,'postiz-policy.json'),{...f.policy,targets:[]});await assert.rejects(validateCloudPostizPacket({handoffDirectory:f.directory,packet}),/destination/);
 await atomic(join(f.directory,'postiz-policy.json'),f.policy);
 const owner=packet.cloudContinuation.batchId===f.first.batchId?join(f.directory,'today-batches',f.first.batchId+'.json'):join(f.directory,'today-batch.json'),state=await optional(owner);
 state.manifest.minimumReady=1;await atomic(owner,state);await assert.rejects(validateCloudPostizPacket({handoffDirectory:f.directory,packet}),/manifest changed/);
});

test('a selected draft tick uses complete public-page preflight and real JSON-string settings readback, without touching another outbox receipt',async t=>{
 const f=await fixture(t);await f.authorize();await f.handoff();const outside=await f.outsidePacket(),packets=(await f.packets()).filter(packet=>packet.id!==outside.id),calls=[],saved=new Map();
 const outsideFile=join(f.directory,'receipts',outside.id+'.json');await atomic(outsideFile,{id:outside.id,status:'unknown',bodySha256:outside.bodySha256,delivery:{mode:'draft'},intendedAt:'2026-10-24T00:00:00Z'});const untouched=await readFile(outsideFile,'utf8');
 const executor=async(command,args)=>{
  calls.push(args);
  if(args[0]==='channels')return {stdout:JSON.stringify(targets.map(target=>({id:target.integrationId,provider:target.platform,disabled:false})))};
  if(args[0]==='create'){
   assert(!args.includes('--publish-now'));assert(!args.includes('--confirm-user-approved'));
   const body=await readFile(args[args.indexOf('--content-file')+1],'utf8'),packet=packets.find(packet=>packet.body===body&&packet.target.integrationId===args[args.indexOf('--channel')+1]);assert(packet);
   const post={id:'post-'+packet.id,state:'DRAFT',integration:{id:packet.target.integrationId},content:packet.body,settings:JSON.stringify({...packet.settings,title:packet.title})};saved.set(post.id,post);return {stdout:JSON.stringify({response:{postId:post.id}})};
  }
  if(args[0]==='get')return {stdout:JSON.stringify({posts:[saved.get(args[args.indexOf('--id')+1])]})};
  assert.fail('Unexpected operation: '+args[0]);
 };
 const fetcher=async url=>{
  const urlValue=new URL(url),site=profiles.find(site=>site.origin===urlValue.origin),own=packets.filter(packet=>packet.source.siteId===site?.id);
  if(urlValue.pathname==='/publishing-identities.json'){
   const articles={};for(const packet of own){articles[packet.source.articleId]={sha256:packet.source.sha256,route:'/news/'+packet.source.articleId+'/'};if(packet.target.locale==='en')articles[editionArticleId(packet.source.articleId,'en')]={sha256:packet.ownContentSha256,translationOf:{sha256:packet.source.sha256}};}
   return {ok:true,json:async()=>({siteId:site.id,articles})};
  }
  if(urlValue.pathname==='/community/links.json')return {ok:true,json:async()=>({links:Object.fromEntries(own.map(packet=>['/news/'+packet.source.articleId+'/',packet.communityUrl]))})};
  assert(own.some(packet=>packet.ownUrl===url));return {ok:true,text:async()=>'<link rel="canonical" href="'+url+'">'};
 };
 const options={handoffDirectory:f.directory,id:f.cohort.id,adapterOptions:{executor,fetcher,delivery:'publish',publishAuthorization:'A separate global publication policy cannot promote recovery'}};
 assert((await tickRecoveryCohort(options)).every(receipt=>receipt.status==='draft_saved'&&receipt.public===false));
 await tickRecoveryCohort(options);assert.equal(calls.filter(args=>args[0]==='create').length,4);assert.equal(calls.filter(args=>args[0]==='get').length,4);assert.equal(await readFile(outsideFile,'utf8'),untouched);
});

test('an uncertain cohort draft only reconciles after evidence becomes unavailable, and never repeats create',async t=>{
 const f=await fixture(t);await f.authorize();await f.handoff();const packet=(await f.packets())[0],receipts=join(f.directory,'receipts');
 await atomic(join(receipts,packet.id+'.json'),{id:packet.id,status:'unknown',bodySha256:packet.bodySha256,delivery:{mode:'draft'},intendedAt:'2026-10-24T00:00:00Z'});
 for(const other of (await f.packets()).filter(value=>value.id!==packet.id))await atomic(join(receipts,other.id+'.json'),{id:other.id,status:'draft_saved',bodySha256:other.bodySha256,delivery:{mode:'draft'}});
 await atomic(join(f.directory,'postiz-policy.json'),{...f.policy,enabled:false});let queries=0;
 const executor=async(command,args)=>{assert.equal(args[0],'posts');queries++;return {stdout:JSON.stringify([{id:'recovered-post',integration:{id:packet.target.integrationId},state:'DRAFT',content:packet.body,settings:JSON.stringify({...packet.settings,title:packet.title})}])};};
 const result=await tickRecoveryCohort({handoffDirectory:f.directory,id:f.cohort.id,adapterOptions:{executor,fetcher:async()=>assert.fail('No new write or preflight for an existing uncertain receipt')}});
 assert.equal(result.find(receipt=>receipt.id===packet.id).status,'draft_saved');assert.equal(queries,1);
});

test('packetIds is an exact optional filter; empty selection stays empty and malformed or repeated identities fail before transport',async t=>{
 const f=await fixture(t);await f.authorize();await f.handoff();let calls=0;const adapter={preflight:async()=>{calls++;},submit:async()=>({postId:'one'}),readback:async()=>({status:'draft_saved'})};
 assert.deepEqual(await postizTick({handoffDirectory:f.directory,adapter,packetIds:[]}),[]);assert.equal(calls,0);
 const packets=await f.packets();for(const packetIds of [null,'all',['invalid'],[packets[0].id,packets[0].id]])await assert.rejects(postizTick({handoffDirectory:f.directory,adapter,packetIds}),/unique exact/);
 assert.equal(calls,0);assert.equal((await postizTick({handoffDirectory:f.directory,adapter,packetIds:[packets[0].id]})).length,1);assert.equal(calls,1);
});

test('standalone cohort CLI uses the same immutable authorization and handoff protocol',async t=>{
 const f=await fixture(t),input=join(f.directory,'exact-scope.json');await atomic(input,f.cohort);const run=promisify(execFile),script=join(process.cwd(),'scripts/publishing-recovery-cohort.mjs');
 for(const [command,value,status] of [['authorize',input,'authorized'],['handoff',f.cohort.id,'ready'],['status',f.cohort.id,'valid']]){const {stdout}=await run(process.execPath,[script,command,f.directory,value]);assert.equal(JSON.parse(stdout).status,status);}
});

test('batch watch CLI first scan can import this module instead of deadlocking on validateBatchManifest',async t=>{
 const f=await fixture(t),body='recovery-cycle-scan',id=hash(body).slice(0,40);
 await atomic(join(f.directory,'outbox',id+'.json'),{id,body,bodySha256:hash(body),authorization:'test',source:{siteId:'unrelated',articleId:'unrelated-article'},planId:'a'.repeat(40)});
 const child=spawn(process.execPath,[join(process.cwd(),'scripts/publishing-batch.mjs'),'watch',f.directory],{stdio:['ignore','pipe','pipe']});
 const output={stdout:'',stderr:''};child.stdout.on('data',chunk=>{output.stdout+=chunk;});child.stderr.on('data',chunk=>{output.stderr+=chunk;});
 t.after(()=>{try{child.kill('SIGKILL');}catch{}});
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>finish(Error('watch CLI first scan did not finish: '+output.stderr+output.stdout)),8000);
  const finish=error=>{clearTimeout(timer);child.stdout.off('data',onData);child.off('exit',onExit);error?reject(error):resolve();};
  const onData=()=>{if(output.stdout.includes('\n'))finish();};
  const onExit=(code,signal)=>finish(Error('watch CLI exited before first scan ('+code+'/'+signal+'): '+output.stderr));
  child.stdout.on('data',onData);child.on('exit',onExit);onData();
 });
 assert.doesNotMatch(output.stderr,/unsettled top-level await/);
 const line=JSON.parse(output.stdout.trim().split('\n')[0]);
 assert.equal(line[0]?.status||line.status,'deferred');
});
