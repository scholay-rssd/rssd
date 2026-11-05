import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runProductionTurn} from '../scripts/rssd-production-worker.mjs';
import protocol from '../contracts/rssd-v1.cjs';
import {CenterError,CenterOutbox} from '../scripts/rssd-center-client.mjs';
async function fixture(t){
  const home=await mkdtemp(join(tmpdir(),'rssd-worker-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const task={id:'demand-one',generation:1,workspaceId:'research',sectionId:'methods',state:'claimed',title:'A useful work',kind:'write',claimToken:'claim-one',payload:{requiredLocales:['zh-CN','en'],submittedLocales:[],policy:{version:1,targets:[]}}};
  const receipts=new Map(),packets=[],states=[];
  const client={origin:'https://center.example',activeClaim:async()=>task,claim:async()=>task,
    work:async()=>{throw new CenterError('Not found',{status:404});},heartbeat:async value=>states.push(value),
    changeDemand:async(id,action)=>{task.state=action.action==='resume'?'claimed':action.action;},
    submission:async id=>{if(receipts.has(id))return receipts.get(id);throw new CenterError('Not found',{status:404});},
    submit:async packet=>{packets.push(packet);task.payload.submittedLocales.push(...packet.editions.map(e=>e.locale));const completed=task.payload.requiredLocales.every(locale=>task.payload.submittedLocales.includes(locale));const result={status:'accepted',requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,publicationIds:[],demandState:completed?'completed':'claimed',editions:packet.editions.map(e=>({locale:e.locale,revision:1,hash:protocol.hash(e)}))};receipts.set(packet.requestId,result);return result;}};
  return {home,client,task,packets,states,receipts};
}
const pilotSignature={agentId:'codex',status:'completed',modelId:'gpt-6.1-terra[max]'};
function pilot(f){f.task.workspaceId='metho';f.task.payload.requiredLocales=['zh-CN'];return {...f,agentId:'codex',workspaceIds:['metho'],sectionIds:['methods'],requiredModel:'gpt-6.1-terra'};}
test('the pilot refuses unrelated pending packets before any outbox flush',async t=>{
  const f=await fixture(t),box=new CenterOutbox({directory:join(f.home,'outbox'),client:f.client});
  await box.enqueue({requestId:'old-one',workId:'old-work',workspaceId:'research',sectionId:'methods',editions:[{locale:'en',title:'Existing',bodyMarkdown:'Already saved'}]});
  await assert.rejects(runProductionTurn({...pilot(f),producer:async()=>{throw Error('must not run');}}),/不属于研究方法试点/);
  assert.equal(f.packets.length,0);assert.equal((await box.list())[0].state,'pending');
});
test('an ineligible newly claimed demand stays recoverable and is marked blocked',async t=>{
  const f=await fixture(t),input=pilot(f);f.task.payload.requiredLocales=['zh-CN','en'];f.client.activeClaim=async()=>null;
  let blocked;f.client.changeDemand=async(id,change)=>{blocked={id,...change};};
  await assert.rejects(runProductionTurn({...input,producer:async()=>{throw Error('must not run');}}),/不属于研究方法中文试点/);
  assert.equal(blocked.id,f.task.id);assert.equal(blocked.action,'blocked');assert.equal(blocked.claimToken,f.task.claimToken);
  const saved=JSON.parse(await readFile(join(f.home,'active-claim.json'),'utf8'));
  assert.equal(saved.claim.id,f.task.id);assert.equal(saved.claim.claimToken,f.task.claimToken);assert.equal(f.packets.length,0);
});
test('the pilot rejects unverified generated or pending model signatures and accepts matching ones',async t=>{
  const f=await fixture(t),input=pilot(f),body={title:'研究方法',bodyMarkdown:'全文'};
  await assert.rejects(runProductionTurn({...input,producer:async()=>body}),/未确认由 Codex/);
  assert.equal(f.packets.length,0);
  const verified={...body,metadata:{notebook:{modelSignatures:[pilotSignature]}}};
  const result=await runProductionTurn({...input,resume:true,producer:async()=>verified});
  assert.equal(result.state,'accepted');assert.equal(f.packets.length,1);
  const g=await fixture(t),box=new CenterOutbox({directory:join(g.home,'outbox'),client:g.client});
  await box.enqueue({requestId:'old-two',workId:'old-work',workspaceId:'metho',sectionId:'methods',editions:[{locale:'zh-CN',...body,metadata:{notebook:{modelSignatures:[{...pilotSignature,modelId:'different-model'}]}}}]});
  await assert.rejects(runProductionTurn({...pilot(g),producer:async()=>verified}),/未确认由 Codex/);
  assert.equal(g.packets.length,0);assert.equal((await box.list())[0].state,'pending');
});
test('the pilot does not submit an unverified saved result or saved packet on resume',async t=>{
  const f=await fixture(t),input=pilot(f);
  await assert.rejects(runProductionTurn({...input,producer:async()=>{throw Error('interrupted');}}),/interrupted/);
  const directory=join(f.home,'jobs',protocol.hash(f.task.id+':'+f.task.generation));
  await writeFile(join(directory,'zh-CN.result.json'),JSON.stringify({title:'Saved',bodyMarkdown:'Original body'}));
  await assert.rejects(runProductionTurn({...input,resume:true,producer:async()=>{throw Error('must not regenerate');}}),/未确认由 Codex/);
  assert.equal(f.packets.length,0);
  await writeFile(join(directory,'zh-CN.packet.json'),JSON.stringify(protocol.submission({requestId:'saved-packet',workId:'saved-work',workspaceId:'metho',sectionId:'methods',editions:[{locale:'zh-CN',title:'Saved',bodyMarkdown:'Original body'}]})));
  await assert.rejects(runProductionTurn({...input,resume:true,producer:async()=>{throw Error('must not regenerate');}}),/未确认由 Codex/);
  assert.equal(f.packets.length,0);
});
test('Chinese is accepted before English generation and translations retain the same work identity',async t=>{
  const f=await fixture(t);
  const result=await runProductionTurn({...f,agentId:'example',workspaceIds:['research'],producer:async({locale,source})=>{
    if(locale==='en'){assert.equal(f.packets.length,1);assert.equal(source.payload.bodyMarkdown,'中文全文');}
    return {title:locale,bodyMarkdown:locale==='zh-CN'?'中文全文':'Complete English text'};
  }});
  assert.equal(result.state,'accepted');assert.equal(f.packets.length,2);
  assert.equal(f.packets[0].workId,f.packets[1].workId);
  assert.deepEqual(f.packets[1].editions[0].translationOf,{workId:result.workId,locale:'zh-CN',revision:1});
  assert.equal(JSON.parse(await readFile(join(f.home,'active-claim.json'),'utf8')).claim,null);
});

test('platform delivery instructions are frozen with the original claim across a restart',async t=>{
 const f=await fixture(t);f.task.payload.destinations=[{destinationId:'social',kind:'postiz',platform:'linkedin',locale:'en'}];let original;
 await assert.rejects(runProductionTurn({...f,agentId:'example',workspaceIds:['research'],producer:async({writingPolicy})=>{original=writingPolicy;assert.match(writingPolicy.instructions,/metadata.platformContent/);assert.match(writingPolicy.instructions,/linkedin/);throw Error('Quota exhausted');}}),/Quota exhausted/);
 f.task.payload.destinations=[{destinationId:'changed',kind:'postiz',platform:'facebook',locale:'en'}];
 await runProductionTurn({...f,agentId:'example',workspaceIds:['research'],resume:true,producer:async({writingPolicy})=>{assert.deepEqual(writingPolicy,original);return {title:'Complete work',bodyMarkdown:'Body'};}});
});
test('quota failure blocks the existing claim; explicit resume does not regenerate accepted Chinese',async t=>{
  const f=await fixture(t);let chineseCalls=0;
  await assert.rejects(runProductionTurn({...f,agentId:'example',workspaceIds:['research'],producer:async({locale})=>{
    if(locale==='en')throw Error('Quota exhausted');chineseCalls++;return {title:'中文',bodyMarkdown:'已保存的中文'};
  }}),/Quota exhausted/);
  assert.equal(f.task.state,'blocked');assert.equal(f.packets.length,1);
  assert.equal(JSON.parse(await readFile(join(f.home,'active-claim.json'),'utf8')).claim.id,'demand-one');
  const blocked=await runProductionTurn({...f,agentId:'example',workspaceIds:['research'],producer:async()=>{throw Error('Must not run');}});
  assert.equal(blocked.state,'blocked');
  const done=await runProductionTurn({...f,agentId:'example',workspaceIds:['research'],resume:true,producer:async({locale})=>{
    assert.equal(locale,'en');return {title:'English',bodyMarkdown:'Saved translation'};
  }});
  assert.equal(done.state,'accepted');assert.equal(chineseCalls,1);assert.equal(f.packets.length,2);
});
test('center outage during a claimed task still leaves both language packets on disk',async t=>{
  const f=await fixture(t);f.client.submission=async()=>{throw new CenterError('Offline');};
  const result=await runProductionTurn({...f,agentId:'example',workspaceIds:['research'],producer:async({locale})=>({title:locale,bodyMarkdown:'Complete body'})});
  assert.equal(result.state,'pending');assert.equal(result.submissions.length,2);assert.equal(f.packets.length,0);
  assert.equal(JSON.parse(await readFile(join(f.home,'active-claim.json'),'utf8')).claim.id,'demand-one');
});

test('after restart, an offline device can finish its cached claim without acquiring another task',async t=>{
  const f=await fixture(t);
  await assert.rejects(runProductionTurn({...f,agentId:'example',workspaceIds:['research'],producer:async()=>{throw Error('Device interrupted');}}),/Device interrupted/);
  f.client.activeClaim=async()=>{throw new CenterError('Center offline');};
  f.client.claim=async()=>{throw Error('Must not claim while offline');};
  f.client.submission=async()=>{throw new CenterError('Offline');};
  f.client.work=async()=>{throw Error('Must use cached base revisions');};
  const result=await runProductionTurn({...f,agentId:'example',workspaceIds:['research'],resume:true,producer:async({locale})=>({title:locale,bodyMarkdown:'Completed offline after restart'})});
  assert.equal(result.state,'pending');assert.equal(result.submissions.length,2);assert.equal(f.packets.length,0);
});
test('an explicit authorization rejection never falls back to a cached claim',async t=>{
  const f=await fixture(t);
  await assert.rejects(runProductionTurn({...f,agentId:'example',workspaceIds:['research'],producer:async()=>{throw Error('Stopped');}}));
  f.client.activeClaim=async()=>{throw new CenterError('Revoked',{status:401});};
  await assert.rejects(runProductionTurn({...f,agentId:'example',workspaceIds:['research'],resume:true,producer:async()=>{throw Error('Must not run');}}),{status:401});
});

test('a resumed task retains its original common writing policy across runtime updates',async t=>{
  const f=await fixture(t),original={version:'original',instructions:'Original instructions'};
  await assert.rejects(runProductionTurn({...f,agentId:'example',workspaceIds:['research'],writingPolicy:original,producer:async({writingPolicy})=>{
    assert.deepEqual(writingPolicy,original);throw Error('Quota exhausted');
  }}),/Quota/);
  const done=await runProductionTurn({...f,agentId:'example',workspaceIds:['research'],resume:true,writingPolicy:{version:'new',instructions:'Changed rules'},producer:async({writingPolicy})=>{
    assert.deepEqual(writingPolicy,original);return {title:'Retained policy',bodyMarkdown:'Complete text'};
  }});
  assert.equal(done.state,'accepted');
});
