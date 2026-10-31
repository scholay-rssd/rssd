import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runProductionTurn} from '../scripts/rssd-production-worker.mjs';
import protocol from '../contracts/rssd-v1.cjs';
import {CenterError} from '../scripts/rssd-center-client.mjs';
async function fixture(t){
  const home=await mkdtemp(join(tmpdir(),'rssd-worker-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const task={id:'demand-one',generation:1,workspaceId:'research',sectionId:'methods',state:'claimed',title:'A useful work',kind:'write',claimToken:'claim-one',payload:{requiredLocales:['zh-CN','en'],submittedLocales:[],policy:{version:1,targets:[]}}};
  const receipts=new Map(),packets=[],states=[];
  const client={origin:'https://center.example',activeClaim:async()=>task,claim:async()=>task,
    work:async()=>{throw new CenterError('Not found',{status:404});},heartbeat:async value=>states.push(value),
    changeDemand:async(id,action)=>{task.state=action.action==='resume'?'claimed':action.action;},
    submission:async id=>{if(receipts.has(id))return receipts.get(id);throw new CenterError('Not found',{status:404});},
    submit:async packet=>{packets.push(packet);const result={status:'accepted',requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,publicationIds:[],editions:packet.editions.map(e=>({locale:e.locale,revision:1,hash:protocol.hash(e)}))};receipts.set(packet.requestId,result);task.payload.submittedLocales.push(...packet.editions.map(e=>e.locale));return result;}};
  return {home,client,task,packets,states,receipts};
}
test('Chinese is accepted before English generation and translations retain the same work identity',async t=>{
  const f=await fixture(t);
  const result=await runProductionTurn({...f,agentId:'example',workspaceIds:['research'],producer:async({locale,source})=>{
    if(locale==='en'){assert.equal(f.packets.length,1);assert.equal(source.payload.bodyMarkdown,'中文全文');}
    return {title:locale,bodyMarkdown:locale==='zh-CN'?'中文全文':'Complete English text'};
  }});
  assert.equal(result.state,'accepted');assert.equal(f.packets.length,2);
  assert.equal(f.packets[0].workId,f.packets[1].workId);
  assert.deepEqual(f.packets[1].editions[0].translationOf,{workId:result.workId,locale:'zh-CN',revision:1});
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
