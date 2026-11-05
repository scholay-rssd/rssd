import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {automaticTopicTick,assertAutomaticTopicScope} from '../desktop/scripts/rssd-topic-auto.mjs';
import {runDesktopWorker,centerDesktopCall} from '../desktop/scripts/rssd-center.mjs';
import {writeCenterJson} from '../scripts/rssd-center-client.mjs';

const scope={agentId:'codex',workspaceIds:['metho'],sectionIds:['methods'],autoTopics:true};
async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'rssd-topic-auto-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const client={demands:async()=>[],works:async()=>[],createDemand:async()=>({})};
 return {home,client};
}
test('automatic topics require explicit opt-in and the exact continuous pilot scope',()=>{
 assert.equal(assertAutomaticTopicScope({...scope,autoTopics:false}),false);
 assert.equal(assertAutomaticTopicScope(scope),true);
 for(const change of [{once:true},{demandId:'one'},{agentId:'other'},{workspaceIds:['other']},{sectionIds:[]},{sectionIds:['methods','statistics']}])assert.throws(()=>assertAutomaticTopicScope({...scope,...change}));
});
test('daily limit is durable and a pending request is reconciled before another model call',async t=>{
 const {home,client}=await fixture(t),now=Date.parse('2026-11-02T04:00:00Z');let generation=0,reconciles=0;
 const adapters=async()=>{generation++;return {};};
 const replenish=async()=>{const path=join(home,'topic-maintainer.json');let state;try{state=JSON.parse(await readFile(path,'utf8'));}catch{state={version:1,workspaceId:'metho',sectionId:'methods',entries:[]};}
  const pending=state.entries.find(e=>e.status==='pending');if(pending){reconciles++;pending.status='accepted';}else state.entries.push({status:'accepted',createdAt:new Date(now).toISOString()});await writeCenterJson(path,state);return [];
 };
 assert.equal((await automaticTopicTick({client,home,clock:()=>now},{adapters,replenish})).state,'created');
 assert.equal((await automaticTopicTick({client,home,clock:()=>now},{adapters,replenish})).state,'created');
 assert.equal((await automaticTopicTick({client,home,clock:()=>now},{adapters,replenish})).state,'daily_limit');assert.equal(generation,2);
 await writeCenterJson(join(home,'topic-maintainer.json'),{version:1,workspaceId:'metho',sectionId:'methods',entries:[{status:'pending',createdAt:new Date(now).toISOString()},{status:'accepted',createdAt:new Date(now).toISOString()}]});
 assert.equal((await automaticTopicTick({client,home,clock:()=>now},{adapters,replenish})).state,'recovered');assert.equal(reconciles,1);assert.equal(generation,2);
 assert.equal((await automaticTopicTick({client,home,clock:()=>now},{adapters,replenish})).state,'daily_limit');
});
test('slow catalog fetch uses a fresh clock and rechecks the quota after midnight',async t=>{
 const {home,client}=await fixture(t);let now=Date.parse('2026-11-02T14:58:30Z'),checked;
 const adapters=async()=>{now+=2*60000;return {catalog:{fetchedAt:new Date(now).toISOString()}};};
 const replenish=async input=>{checked=input.now;assert.equal(input.catalog.fetchedAt,new Date(input.now).toISOString());return [];};
 assert.equal((await automaticTopicTick({client,home,clock:()=>now},{adapters,replenish})).state,'created');assert.equal(checked,now);
 now=Date.parse('2026-11-02T14:59:30Z');
 await writeCenterJson(join(home,'topic-maintainer.json'),{version:1,workspaceId:'metho',sectionId:'methods',entries:[{status:'accepted',createdAt:'2026-11-02T15:00:00Z'},{status:'pending',createdAt:'2026-11-02T15:00:10Z'}]});
 // Simulate another already-counted day without a pending reconciliation.
 const state=JSON.parse(await readFile(join(home,'topic-maintainer.json'),'utf8'));state.entries[1].status='accepted';await writeCenterJson(join(home,'topic-maintainer.json'),state);
 checked=undefined;assert.equal((await automaticTopicTick({client,home,clock:()=>now},{adapters,replenish})).state,'daily_limit');assert.equal(checked,undefined);
});
test('model generation crossing midnight rechecks the new day before saving or sending',async t=>{
 const {home,client}=await fixture(t);let now=Date.parse('2026-11-02T14:59:00Z'),stages=0;
 const entries=[{status:'accepted',createdAt:'2026-11-02T15:00:01Z'},{status:'accepted',createdAt:'2026-11-02T15:00:02Z'}];
 await writeCenterJson(join(home,'topic-maintainer.json'),{version:1,workspaceId:'metho',sectionId:'methods',entries});
 const adapters=async()=>({});
 const replenish=async input=>{now+=2*60000;await input.beforeStage({entries});stages++;return [];};
 await assert.rejects(automaticTopicTick({client,home,clock:()=>now},{adapters,replenish}),/当日自动选题已达到上限/);
 assert.equal(stages,0);assert.equal(JSON.parse(await readFile(join(home,'topic-maintainer.json'),'utf8')).entries.length,2);
});
test('stop prevents creating a pending candidate, and invalid saved state fails closed',async t=>{
 const {home,client}=await fixture(t);let posts=0;client.createDemand=async()=>{posts++;};
 assert.equal((await automaticTopicTick({client,home,shouldStop:async()=>true})).state,'stopped');assert.equal(posts,0);
 await writeCenterJson(join(home,'topic-maintainer.json'),{version:1,workspaceId:'metho',sectionId:'methods',entries:[{status:'pending',createdAt:'bad'}]});
 await assert.rejects(automaticTopicTick({client,home}),/状态损坏/);
});
test('worker invokes opt-in topic maintenance only after an idle turn and blocks on error',async t=>{
 const {home}=await fixture(t);await writeCenterJson(join(home,'connection.json'),{origin:'http://127.0.0.1:1',token:'rssd_device_'+'a'.repeat(48),identity:{orgId:'test'}});
 let ticks=0,turns=0;
 const turn=async()=>{turns++;return {state:'idle'};};
 const topicTick=async()=>{ticks++;throw Error('model unavailable');};const heartbeats=[];
 const connect=async()=>({client:{heartbeat:async value=>{heartbeats.push(value);throw Error('heartbeat unavailable');}}});
 await assert.rejects(runDesktopWorker(scope,{home,turn,topicTick,connect}),/model unavailable/);
 assert.equal(ticks,1);assert.equal(turns,1);
 const worker=JSON.parse(await readFile(join(home,'worker.json'),'utf8'));assert.equal(worker.state,'blocked');assert.equal(worker.autoTopics,true);
 assert.deepEqual(heartbeats,[{state:'blocked',agentId:'codex',message:'model unavailable'}]);
 ticks=0;
 const stopTurn=async()=>{await centerDesktopCall('stop',{},home);return {state:'idle'};};
 await runDesktopWorker({...scope,autoTopics:false},{home,turn:stopTurn,topicTick});assert.equal(ticks,0);
});
