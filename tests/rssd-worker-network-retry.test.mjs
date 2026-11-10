import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runDesktopWorker,centerDesktopCall} from '../desktop/scripts/rssd-center.mjs';
import {runProductionTurn} from '../scripts/rssd-production-worker.mjs';
import {CenterError,CenterOutbox,writeCenterJson} from '../scripts/rssd-center-client.mjs';
import protocol from '../contracts/rssd-v1.cjs';

async function fixture(t){const home=await mkdtemp(join(tmpdir(),'rssd-network-retry-'));t.after(()=>rm(home,{recursive:true,force:true}));return home;}
const scope={agentId:'codex',workspaceIds:['research'],sectionIds:['methods']};
const quick={retryDelaysMs:[0,0,0],pause:async()=>{}};

test('a lost claim response is reconciled as the same active claim before production',async t=>{
 const home=await fixture(t);let claimCalls=0,posts=0,remote=null,accepted=null;
 const claim={id:'demand-one',generation:1,workspaceId:'research',sectionId:'methods',state:'claimed',title:'Topic',kind:'write',claimToken:'claim-one',payload:{requiredLocales:['zh-CN'],submittedLocales:[],policy:{targets:[]}}};
 const client={origin:'https://center.example',activeClaim:async()=>remote,claim:async()=>{claimCalls++;remote=claim;throw new CenterError('claim response lost');},
  work:async()=>{throw new CenterError('missing',{status:404});},heartbeat:async()=>{},changeDemand:async()=>{},
  submission:async()=>{if(accepted)return accepted;throw new CenterError('missing',{status:404});},
  submit:async packet=>{posts++;accepted={requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,status:'accepted',demandState:'completed',publicationIds:[],editions:packet.editions.map(e=>({locale:e.locale,revision:1,hash:protocol.hash(e)}))};remote=null;return accepted;}};
 let turns=0;
 const turn=async args=>{turns++;const result=await runProductionTurn(args);if(result.state==='accepted')await centerDesktopCall('stop',{},home);return result;};
 await runDesktopWorker(scope,{home,connect:async()=>({client}),turn,producer:async()=>({title:'Topic',bodyMarkdown:'Full text'}),...quick});
 assert.equal(turns,2);assert.equal(claimCalls,1);assert.equal(posts,1);
 assert.equal(JSON.parse(await readFile(join(home,'worker.json'),'utf8')).state,'stopped');
});

test('a pending original submission is queried before another claim after network recovery',async t=>{
 const home=await fixture(t);let lookups=0,posts=0,activeCalls=0,claimCalls=0;
 const packet={requestId:'original-request',workId:'original-work',workspaceId:'research',sectionId:'methods',editions:[{locale:'zh-CN',title:'Saved',bodyMarkdown:'Saved body'}]};
 const receipt={requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,status:'accepted',publicationIds:[],editions:[{locale:'zh-CN',revision:1,hash:protocol.hash(protocol.submission(packet).editions[0])}]};
 const client={origin:'https://center.example',submission:async id=>{assert.equal(id,packet.requestId);if(++lookups===1)throw new CenterError('offline');return receipt;},submit:async()=>{posts++;},
  activeClaim:async()=>{if(++activeCalls===1)throw new CenterError('offline');return null;},claim:async()=>{claimCalls++;return null;},heartbeat:async()=>{}};
 const box=new CenterOutbox({directory:join(home,'outbox'),client});await box.enqueue(packet);
 const turn=async args=>{const result=await runProductionTurn(args);if(result.state==='idle')await centerDesktopCall('stop',{},home);return result;};
 await runDesktopWorker(scope,{home,connect:async()=>({client}),turn,producer:async()=>{throw Error('must not write');},...quick});
 assert.equal(lookups,2);assert.equal(posts,0);assert.equal(claimCalls,1);assert.equal((await box.list())[0].state,'accepted');
});

test('an unresolved original submission prevents claiming a different demand',async t=>{
 const home=await fixture(t);let claims=0,posts=0;
 const client={origin:'https://center.example',submission:async()=>{throw new CenterError('offline');},submit:async()=>{posts++;},activeClaim:async()=>null,claim:async()=>{claims++;return null;},heartbeat:async()=>{}};
 const box=new CenterOutbox({directory:join(home,'outbox'),client});
 await box.enqueue({requestId:'uncertain-request',workId:'saved-work',workspaceId:'research',sectionId:'methods',editions:[{locale:'zh-CN',title:'Saved',bodyMarkdown:'Saved body'}]});
 const result=await runProductionTurn({client,home,agentId:'codex',workspaceIds:['research'],sectionIds:['methods'],producer:async()=>{throw Error('must not write');}});
 assert.equal(result.state,'pending');assert.equal(claims,0);assert.equal(posts,0);assert.equal((await box.list())[0].state,'pending');
});

test('transient topic creation retries with the original saved demand identity',async t=>{
 const home=await fixture(t),original='topic-original';let attempts=0,generated=0;
 const topicTick=async()=>{attempts++;const path=join(home,'original.json');if(attempts===1){generated++;await writeCenterJson(path,{id:original});throw new CenterError('response lost');}
  assert.equal(JSON.parse(await readFile(path,'utf8')).id,original);await centerDesktopCall('stop',{},home);return {state:'recovered'};};
 await runDesktopWorker({agentId:'codex',workspaceIds:['metho'],sectionIds:['methods'],autoTopics:true},{home,connect:async()=>({client:{heartbeat:async()=>{}}}),turn:async()=>({state:'idle'}),topicTick,...quick});
 assert.equal(attempts,2);assert.equal(generated,1);
});

test('authentication, application errors, pending results and one-shot calls are not retried',async t=>{
 for(const mode of ['auth','ordinary','pending','once','exhausted']){
  const home=await fixture(t);let attempts=0;
  if(mode==='exhausted')await writeCenterJson(join(home,'active-claim.json'),{claim:{id:'retained-claim'}});
  const turn=async()=>{attempts++;if(mode==='pending')return {state:'pending',message:'retained'};if(mode==='auth')throw new CenterError('denied',{status:403,code:'forbidden'});if(mode==='ordinary')throw Object.assign(Error('ordinary'),{code:'network_error',status:0});throw new CenterError('offline');};
  const options={home,connect:async()=>({client:{heartbeat:async()=>{}}}),turn,...quick};
  if(mode==='pending'){assert.equal((await runDesktopWorker(scope,options)).state,'pending');assert.equal(attempts,1);}
  else {await assert.rejects(runDesktopWorker({...scope,...(mode==='once'?{once:true}:{})},options));assert.equal(attempts,mode==='exhausted'?4:1);}
 }
});

test('an idle continuous worker waits through an extended outage with capped backoff',async t=>{
 const home=await fixture(t);let attempts=0,waited=0;
 const turn=async()=>{attempts++;if(attempts<6)throw new CenterError('offline');await centerDesktopCall('stop',{},home);return {state:'idle'};};
 await runDesktopWorker(scope,{home,connect:async()=>({client:{origin:'https://center.example'}}),turn,retryDelaysMs:[1000,2000],idleRetryCapMs:3000,pause:async ms=>{waited+=ms;}});
 assert.equal(attempts,6);assert.equal(waited,12000);assert.equal(JSON.parse(await readFile(join(home,'worker.json'),'utf8')).state,'stopped');
});

test('an uncertain pending submission prevents unbounded idle retries',async t=>{
 const home=await fixture(t),client={origin:'https://center.example'};let attempts=0;
 const box=new CenterOutbox({directory:join(home,'outbox'),client});await box.enqueue({requestId:'pending-one',workId:'work-one',workspaceId:'research',sectionId:'methods',editions:[{locale:'zh-CN',title:'Saved',bodyMarkdown:'Saved'}]});
 await assert.rejects(runDesktopWorker(scope,{home,connect:async()=>({client}),turn:async()=>{attempts++;throw new CenterError('offline');},retryDelaysMs:[0,0],pause:async()=>{}}),/offline/);
 assert.equal(attempts,3);assert.equal((await box.list())[0].state,'pending');
});

test('stopping interrupts retry backoff without another operation',async t=>{
 const home=await fixture(t);let attempts=0,pauses=0;
 await runDesktopWorker(scope,{home,connect:async()=>({client:{}}),turn:async()=>{attempts++;throw new CenterError('offline');},retryDelaysMs:[5000],pause:async()=>{pauses++;await centerDesktopCall('stop',{},home);}});
 assert.equal(attempts,1);assert.equal(pauses,1);assert.equal(JSON.parse(await readFile(join(home,'worker.json'),'utf8')).state,'stopped');
});
