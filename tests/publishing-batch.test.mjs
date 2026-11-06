import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {initializeBatchGate,beginBatch,refreshBatch,batchGatedAdapter,setBatchThreshold,settleBatch,validateBatchManifest} from '../scripts/publishing-batch.mjs';
import {atomic,optional,hash,postizTick,externalPackage} from '../scripts/publishing-flow.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';

const batchCli=join(process.cwd(),'scripts/publishing-batch.mjs');
const runCli=promisify(execFile);
function watchBatchCli(directory,t){
 const child=spawn(process.execPath,[batchCli,'watch',directory],{stdio:['ignore','pipe','pipe']});
 const output={stdout:'',stderr:''};
 child.stdout.on('data',chunk=>{output.stdout+=chunk;});
 child.stderr.on('data',chunk=>{output.stderr+=chunk;});
 t.after(()=>{try{child.kill('SIGKILL');}catch{}});
 return {child,output};
}
function firstWatchScan({child,output},timeoutMs=8000){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>finish(Error('watch CLI first scan did not finish: '+output.stderr+output.stdout)),timeoutMs);
  const finish=error=>{clearTimeout(timer);child.stdout.off('data',onData);child.off('exit',onExit);error?reject(error):resolve(output);};
  const onData=()=>{if(output.stdout.includes('\n'))finish();};
  const onExit=(code,signal)=>finish(Error('watch CLI exited before first scan ('+code+'/'+signal+'): '+output.stderr));
  child.stdout.on('data',onData);child.on('exit',onExit);onData();
 });
}

async function fixture(t,{sites=['metho','pets'],minimumReady}={}){
 const root=await mkdtemp(join(tmpdir(),'today-batch-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,'handoff'),resultsDirectory=join(root,'results');await mkdir(resultsDirectory);
 const entries=sites.map(siteId=>({siteId,sectionId:'articles',root:join(root,siteId),publicationDirectory:join(root,siteId,'receipts'),requireFlow:siteId!=='pets',requireEnglish:siteId!=='pets'}));
 const manifest={version:1,resultsDirectory,entries,...(minimumReady===undefined?{}:{minimumReady})};await initializeBatchGate(directory);
 const targets=[{platform:'discord',locale:'zh-CN',integrationId:'discord-account',channelId:'1562031229606301696',format:'summary'},{platform:'devto',locale:'en',integrationId:'devto-account',format:'article'}];
 const edition={title:'Full English article',summary:'A translated summary.',markdown:'# Full English article\n\nComplete translated content.'};
 const topic='https://enterscholar.com/t/-/123456';
 function planFor(siteId,articleId=siteId+'-article'){
  const source={id:articleId,title:'中文文章',summary:'完整中文摘要',markdown:'# 中文文章\n\n完整中文正文。',sectionId:'articles'};
  return {id:hash([siteId,articleId]).slice(0,40),siteId,articleId,revision:1,sha256:sourceContentSha256(source),source,origin:'https://'+siteId+'.example',sourceUrl:'https://'+siteId+'.example/news/'+articleId+'/',brand:{name:siteId,slogan:'A useful slogan'},policy:{authorization:'test',targets}};
 }
 let preflights=0,sends=0,queries=0;
 const transport={preflight:async()=>{preflights++;},submit:async()=>{sends++;return {postId:'one-post'};},readback:async()=>{queries++;return {status:'verified'};}};
 const tick=()=>postizTick({handoffDirectory:directory,adapter:batchGatedAdapter(directory,transport)});
 async function packet({siteId='metho',articleId=siteId+'-article',locale='zh-CN',id}={}){
  const packet=externalPackage(planFor(siteId,articleId),targets.find(t=>t.locale===locale),edition,topic);if(id)packet.id=id;
  await atomic(join(directory,'outbox',packet.id+'.json'),packet);return packet;
 }
 async function evidence(siteId,{flowComplete=true,old=false,failedResult=false,articleId=siteId+'-article',resultTag}={}){
  const entry=entries.find(e=>e.siteId===siteId),plan=planFor(siteId,articleId),id=plan.id,requestKey='request-'+articleId;
  await atomic(join(resultsDirectory,siteId+'-'+(resultTag||(old?'old':'new'))+'.result.json'),{site:siteId,sectionId:entry.sectionId,taskId:'task-'+articleId,articleId,...(failedResult?{error:'connection dropped'}:{requestKey,publicReadback:true,jobStatus:'success'})});
  await atomic(join(entry.publicationDirectory,articleId,'receipt.json'),{requestKey,submittedAt:new Date().toISOString(),publicReadback:true,job:{status:'success'},url:'/news/'+articleId+'/',revision:1,publishingFlow:{id}});
  await atomic(join(entry.root,'.local/publishing-flow/jobs',id,'plan.json'),plan);
  await atomic(join(entry.root,'.local/publishing-flow/jobs',id,'state.json'),{complete:flowComplete,chinese:{status:'verified',revision:1},community:{status:'verified',url:topic},english:{status:flowComplete?'verified':'queued'},edition});
 }
 return {directory,manifest,entries,resultsDirectory,packet,evidence,tick,planFor,targets,edition,topic,counts:()=>({preflights,sends,queries})};
}

test('whole-batch barrier holds all external writes until every owned publication, translation and Ente link is complete',async t=>{
 const f=await fixture(t);await beginBatch(f.directory,'daily-20261023',f.manifest);const packet=await f.packet();
 await f.evidence('metho',{flowComplete:false});await f.evidence('pets');
 assert.equal((await f.tick())[0].status,'deferred');assert.deepEqual(f.counts(),{preflights:0,sends:0,queries:0});
 assert.equal(await optional(join(f.directory,'receipts',packet.id+'.json')),null);
 assert.equal((await refreshBatch(f.directory)).checks[0].status,'waiting_for_internal_completion');
 await f.evidence('metho');await f.tick();await f.tick();
 assert.equal((await refreshBatch(f.directory)).status,'complete');assert.deepEqual(f.counts(),{preflights:1,sends:1,queries:1});
});

test('the same batch resumes after interruption, excludes old results and refuses an overlapping batch',async t=>{
 const f=await fixture(t);await f.evidence('pets',{old:true});const first=await beginBatch(f.directory,'daily-20261023',f.manifest);
 assert.equal((await beginBatch(f.directory,'daily-20261023',f.manifest)).startedAt,first.startedAt);
 await assert.rejects(beginBatch(f.directory,'daily-20261024',f.manifest),/unfinished/);
 await f.evidence('metho',{failedResult:true});let state=await refreshBatch(f.directory);
 assert.equal(state.status,'producing');assert.equal(state.checks[0].status,'verified');assert.equal(state.checks[1].status,'waiting_for_production');
 await f.evidence('pets');state=await refreshBatch(f.directory);assert.equal(state.status,'complete');
 await beginBatch(f.directory,'daily-20261024',f.manifest);
 assert.equal((await optional(join(f.directory,'today-batches/daily-20261023.json'))).status,'complete');
 assert.equal((await refreshBatch(f.directory)).checks.every(c=>c.status==='waiting_for_production'),true);
});

test('missing or corrupt gate fails closed without reserving a write, while prior uncertain submissions can still be reconciled',async t=>{
 const f=await fixture(t),packet=await f.packet();await rm(join(f.directory,'today-batch.json'));
 assert.equal((await f.tick())[0].status,'deferred');assert.equal(f.counts().sends,0);
 await writeFile(join(f.directory,'today-batch.json'),'{broken');assert.equal((await f.tick())[0].status,'deferred');
 assert.equal(await optional(join(f.directory,'receipts',packet.id+'.json')),null);
 await atomic(join(f.directory,'receipts',packet.id+'.json'),{id:packet.id,status:'unknown'});
 assert.equal((await f.tick())[0].status,'verified');assert.deepEqual(f.counts(),{preflights:0,sends:0,queries:1});
});

test('duplicate produced article identities keep the batch closed and the original plan cannot be replaced on retry',async t=>{
 const f=await fixture(t);await beginBatch(f.directory,'daily-20261023',f.manifest);await f.evidence('metho');await f.evidence('pets');
 await atomic(join(f.resultsDirectory,'metho-duplicate.result.json'),{site:'metho',sectionId:'articles',articleId:'another-article'});
 const state=await refreshBatch(f.directory);assert.equal(state.status,'producing');assert.equal(state.checks[0].status,'needs_review');
 await assert.rejects(beginBatch(f.directory,'daily-20261023',{...f.manifest,entries:f.entries.slice(1)}),/original batch manifest/);
});

test('begin waits for the current transport lock, then all later submissions observe the new barrier',async t=>{
 const f=await fixture(t);await f.packet();let release,entered;
 const ready=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 const tick=postizTick({handoffDirectory:f.directory,adapter:batchGatedAdapter(f.directory,{preflight:async()=>{entered();await hold;},submit:async()=>({postId:'prior'}),readback:async()=>({status:'verified'})})});
 await ready;let begun=false;const beginning=beginBatch(f.directory,'daily-20261023',f.manifest).then(()=>{begun=true;});
 await new Promise(resolve=>setTimeout(resolve,80));assert.equal(begun,false);release();await tick;await beginning;
 const next=await f.packet({articleId:'next-article'});const results=await f.tick();assert.equal(results.find(r=>r.id===next.id).status,'deferred');assert.equal(f.counts().sends,0);
});

test('quantity release counts complete academic articles, excludes pets and unfinished translations, and submits only ready articles once',async t=>{
 const f=await fixture(t,{sites:['metho','enter','study','pets'],minimumReady:2});await beginBatch(f.directory,'daily-20261023',f.manifest);
 const ready=await f.packet(),second=await f.packet({siteId:'enter',locale:'en'}),unfinished=await f.packet({siteId:'study'}),pet=await f.packet({siteId:'pets'});
 await f.evidence('metho');await f.evidence('pets');await f.evidence('enter',{flowComplete:false});await f.evidence('study',{flowComplete:false});
 let state=await refreshBatch(f.directory);assert.equal(state.readyArticles,1);assert.equal(state.releaseReady,false);
 assert((await f.tick()).every(r=>r.status==='deferred'));assert.equal(f.counts().sends,0);
 await f.evidence('enter');state=await refreshBatch(f.directory);assert.equal(state.status,'producing');assert.equal(state.readyArticles,2);assert.equal(state.releaseReady,true);
 const results=await f.tick();assert.equal(results.find(r=>r.id===ready.id).status,'verified');assert.equal(results.find(r=>r.id===second.id).status,'verified');
 assert.equal(results.find(r=>r.id===unfinished.id).status,'deferred');assert.equal(results.find(r=>r.id===pet.id).status,'deferred');
 assert.equal(await optional(join(f.directory,'receipts',unfinished.id+'.json')),null);
 await f.tick();assert.deepEqual(f.counts(),{preflights:2,sends:2,queries:2});
});

test('the threshold accepts an explicit whole article count without replacing the original manifest or enabling a default',async t=>{
 const f=await fixture(t,{sites:['metho','enter','pets']});await beginBatch(f.directory,'daily-20261023',f.manifest);await f.evidence('metho');await f.evidence('pets');
 assert.equal((await refreshBatch(f.directory)).releaseReady,false);
 for(const count of [0,-1,1.5,3,NaN,Infinity,'1',null])await assert.rejects(setBatchThreshold(f.directory,'daily-20261023',count),/positive article count/);
 for(const count of [0,1.5,3])assert.throws(()=>validateBatchManifest({...f.manifest,minimumReady:count}),/positive article count/);
 await assert.rejects(setBatchThreshold(f.directory,'wrong-batch',1),/current batch/);
 const original=hash(f.manifest);await setBatchThreshold(f.directory,'daily-20261023',1);
 const resumed=await beginBatch(f.directory,'daily-20261023',f.manifest);assert.equal(hash(resumed.manifest),original);assert.equal(resumed.releasePolicy.minimumReady,1);assert.equal(resumed.releaseReady,true);
 await assert.rejects(beginBatch(f.directory,'daily-20261023',{...f.manifest,minimumReady:1}),/original batch manifest/);
 await f.packet();await f.tick();assert.equal(f.counts().sends,1);
});

test('settled partial batches permit tomorrow, retain failed sections and safely finish their own late continuations',async t=>{
 const f=await fixture(t,{sites:['metho','enter','pets'],minimumReady:1});await beginBatch(f.directory,'daily-20261023',f.manifest);
 await f.evidence('metho');await f.evidence('enter',{flowComplete:false});
 await atomic(join(f.resultsDirectory,'pets-failed.result.json'),{site:'pets',sectionId:'articles',error:'bounded production attempts exhausted'});
 const frozen=await settleBatch(f.directory,'daily-20261023');assert.equal(frozen.status,'settled');assert.equal(frozen.manifest.entries.length,3);assert.equal(frozen.checks[2].status,'waiting_for_production');
 const again=await settleBatch(f.directory,'daily-20261023');assert.equal(again.productionEndedAt,frozen.productionEndedAt);
 await beginBatch(f.directory,'daily-20261024',f.manifest);
 assert.equal((await refreshBatch(f.directory)).readyArticles,0);assert.equal((await optional(join(f.directory,'today-batches/daily-20261023.json'))).status,'settled');
 const old=await f.packet();await f.tick();assert.equal(f.counts().sends,1);
 await f.evidence('enter',{articleId:'enter-tomorrow',resultTag:'tomorrow'});await f.evidence('enter');
 const late=await f.packet({siteId:'enter',locale:'en'}),current=await f.packet({siteId:'enter',articleId:'enter-tomorrow'});
 const result=await f.tick();assert.equal(result.find(r=>r.id===late.id).status,'verified');assert.equal(result.find(r=>r.id===current.id).status,'verified');
 const archive=await optional(join(f.directory,'today-batches/daily-20261023.json'));assert.equal(archive.checks.find(c=>c.section==='enter/articles').articleId,'enter-article');assert.equal(archive.readyArticles,2);
 assert.equal((await refreshBatch(f.directory)).checks.find(c=>c.section==='enter/articles').articleId,'enter-tomorrow');
 await f.tick();assert.equal(f.counts().sends,3);assert.equal((await optional(join(f.directory,'receipts',old.id+'.json'))).status,'verified');
});

test('meeting the quantity threshold never authorizes another plan, revision, source, language edition or modified body',async t=>{
 const f=await fixture(t,{sites:['metho','pets'],minimumReady:1});await beginBatch(f.directory,'daily-20261023',f.manifest);await f.evidence('metho');
 const packet=await f.packet({locale:'en'});
 for(const patch of [{planId:'b'.repeat(40)},{source:{...packet.source,revision:2}},{source:{...packet.source,sha256:'b'.repeat(64)}},{ownContentSha256:'b'.repeat(64)},{ownUrl:packet.ownUrl.replace('/en/','/')},{body:packet.body+' changed',bodySha256:hash(packet.body+' changed')},{source:{...packet.source,articleId:'not-produced'}}]){
  const adapter=batchGatedAdapter(f.directory,{preflight:async()=>assert.fail('No transport for mismatched identities')});
  await assert.rejects(adapter.preflight({...packet,...patch}));
 }
 assert.deepEqual(f.counts(),{preflights:0,sends:0,queries:0});
 await f.tick();await f.tick();assert.equal(f.counts().sends,1);
});

test('one unreadable or failed article does not prevent other completed articles meeting the count',async t=>{
 const f=await fixture(t,{sites:['metho','enter','study','pets'],minimumReady:1});await beginBatch(f.directory,'daily-20261023',f.manifest);
 await f.evidence('metho');await f.evidence('enter');await writeFile(join(f.entries[1].publicationDirectory,'enter-article/receipt.json'),'{broken');
 await atomic(join(f.resultsDirectory,'study-failed.result.json'),{site:'study',sectionId:'articles',error:'production failed'});await writeFile(join(f.resultsDirectory,'broken.result.json'),'{broken');
 const state=await refreshBatch(f.directory);assert.equal(state.readyArticles,1);assert.equal(state.releaseReady,true);assert.equal(state.checks[1].status,'needs_review');assert.equal(state.checks[2].status,'waiting_for_production');assert.equal(state.evidenceErrors.length,1);
 await f.packet();await f.tick();assert.equal(f.counts().sends,1);
});

test('one article reported in two sections never counts twice toward release',async t=>{
 const f=await fixture(t,{sites:['metho','pets'],minimumReady:1});f.manifest.entries.push({...f.entries[0],sectionId:'other'});
 await beginBatch(f.directory,'daily-20261023',f.manifest);await f.evidence('metho');
 await atomic(join(f.resultsDirectory,'metho-other.result.json'),{site:'metho',sectionId:'other',articleId:'metho-article',requestKey:'request-metho-article'});
 const state=await refreshBatch(f.directory);assert.equal(state.readyArticles,0);assert.equal(state.releaseReady,false);assert.equal(state.checks[0].status,'needs_review');assert.equal(state.checks[2].status,'needs_review');
});

test('an uncertain submission from a ready partial batch reconciles after restart even when the ready count later falls',async t=>{
 const f=await fixture(t,{sites:['metho','pets'],minimumReady:1});await beginBatch(f.directory,'daily-20261023',f.manifest);await f.evidence('metho');const packet=await f.packet();let sends=0,queries=0;
 const transport={submit:async()=>{sends++;throw Error('timeout after provider accepted');},readback:async()=>{queries++;return {status:queries>1?'verified':'unknown'};}};
 await postizTick({handoffDirectory:f.directory,adapter:batchGatedAdapter(f.directory,transport)});assert.equal(sends,1);
 await f.evidence('metho',{flowComplete:false});assert.equal((await refreshBatch(f.directory)).releaseReady,false);
 await postizTick({handoffDirectory:f.directory,adapter:batchGatedAdapter(f.directory,transport)});assert.equal(sends,1);assert.equal(queries,2);assert.equal((await optional(join(f.directory,'receipts',packet.id+'.json'))).status,'verified');
});

test('structured Chinese permalinks count only when the successful receipt matches their frozen continuation route',async t=>{
 const f=await fixture(t,{minimumReady:1}),articleId='record-12345678-1234-1234-1234-123456789abc',route='/open-source/approved-tool/';
 await beginBatch(f.directory,'daily-20261023',f.manifest);await f.evidence('metho',{articleId});
 const plan=f.planFor('metho',articleId),dir=join(f.entries[0].root,'.local/publishing-flow/jobs',plan.id),receiptFile=join(f.entries[0].publicationDirectory,articleId,'receipt.json');
 plan.sourceUrl=plan.origin+route;plan.source.record={documentId:articleId.slice(7),kind:'openSource',fields:{name:'Approved tool',url:'https://example.org/tool'}};plan.sha256=sourceContentSha256(plan.source);
 await atomic(join(dir,'plan.json'),plan);const receipt=await optional(receiptFile);await atomic(receiptFile,{...receipt,url:route});
 const packet=externalPackage(plan,f.targets[0],f.edition,f.topic);await atomic(join(f.directory,'outbox',packet.id+'.json'),packet);
 assert.equal((await refreshBatch(f.directory)).readyArticles,1);await f.tick();assert.equal(f.counts().sends,1);
 await atomic(receiptFile,{...receipt,url:'/open-source/different-tool/'});const state=await refreshBatch(f.directory);assert.equal(state.readyArticles,0);assert.equal(state.checks[0].status,'needs_review');
 for(const url of ['//other.example/article/','/open-source/../approved-tool/','/open-source/tool/?query=1','/open-source/tool/#fragment','/open-source/tool%2fescape/']){
  await atomic(receiptFile,{...receipt,url});assert.equal((await refreshBatch(f.directory)).readyArticles,0);
 }
});

test('a completed legacy whole-batch archive keeps its ready packets available during the next unfinished batch',async t=>{
 const f=await fixture(t);await beginBatch(f.directory,'daily-20261023',f.manifest);await f.evidence('metho');await f.evidence('pets');
 assert.equal((await refreshBatch(f.directory)).status,'complete');await beginBatch(f.directory,'daily-20261024',f.manifest);assert.equal((await refreshBatch(f.directory)).releaseReady,false);
 const packet=await f.packet();const result=await f.tick();assert.equal(result.find(r=>r.id===packet.id).status,'verified');await f.tick();assert.equal(f.counts().sends,1);
});

test('direct CLI watch completes its first scan while recovery-cohort imports this module',async t=>{
 const f=await fixture(t);await beginBatch(f.directory,'daily-20261023',f.manifest);await f.packet();
 await atomic(join(f.directory,'postiz-policy.json'),{enabled:true,authorization:'Existing Postiz destination approval',sources:[{siteId:'metho',articleId:'*'}],targets:f.targets});
 const watching=watchBatchCli(f.directory,t),scan=await firstWatchScan(watching);
 assert.doesNotMatch(scan.stderr,/unsettled top-level await/);
 const line=JSON.parse(scan.stdout.trim().split('\n')[0]);
 assert.equal(line[0]?.status||line.status,'deferred');
});

test('non-watch CLI subcommands still print JSON and keep their error prefix',async t=>{
 const f=await fixture(t);
 const {stdout}=await runCli(process.execPath,[batchCli,'status',f.directory]);
 assert.equal(JSON.parse(stdout).status,'idle');assert.equal(stdout.trim().split('\n').length,1);
 await assert.rejects(runCli(process.execPath,[batchCli,'watch','relative-handoff']),error=>{
  assert.match(error.stderr,/Publishing batch: Use an absolute handoff directory/);
  assert.equal(error.code,1);return true;
 });
});
