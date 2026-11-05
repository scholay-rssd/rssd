import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {todayTick,flowStatus,flowDirectory} from '../scripts/publishing-flow.mjs';

const site={id:'metho',origin:'https://example.invalid'},start=1792900000000;
const source={title:'测试标题',summary:'保留事实。',markdown:'# 测试标题\n\n保留原始事实。'};
const edition={title:'Test title',summary:'Preserve the facts.',markdown:'# Test title\n\nPreserve the original facts.'};
const busy=()=>Object.assign(Error('Bounded translation round saved its checkpoint'),{code:'FLOW_LANGUAGE_BUSY'});
async function fixture(t,count){
 const root=await mkdtemp(join(tmpdir(),'flow-scheduling-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const ids=Array.from({length:count},(_,i)=>(i+1).toString(16).repeat(40)),plans=[],reads=[],models=[],publications=[],events=[];
 const stateFile=id=>join(flowDirectory(root),'jobs',id,'state.json'),planFile=id=>join(flowDirectory(root),'jobs',id,'plan.json');
 for(const [i,id] of ids.entries()){
  const dir=join(flowDirectory(root),'jobs',id);await mkdir(dir,{recursive:true});
  const plan={version:1,id,siteId:site.id,origin:site.origin,articleId:'fixture-'+i,revision:1,sha256:'f'.repeat(64),publicationCredential:'e'.repeat(64),source,sourceUrl:site.origin+'/news/fixture-'+i+'/',policy:{translate:true,targets:[]}};plans.push(plan);
  await writeFile(planFile(id),JSON.stringify(plan));
  await writeFile(stateFile(id),JSON.stringify({status:'waiting',checkedAt:0,translation:{status:'queued',attempts:0},community:{status:'verified',url:'https://enterscholar.com/t/-/12345'}}));
 }
 const state=async id=>JSON.parse(await readFile(stateFile(id),'utf8'));
 const patch=async(id,change)=>writeFile(stateFile(id),JSON.stringify({...await state(id),...change}));
 const options={root,site,planIds:ids,reviewBeforeEnglishPlanIds:ids,readSource:async(id,{plan})=>{reads.push(plan.id);events.push('read:'+plan.id);return {version:1,publishedVersion:1,sha256:'f'.repeat(64)};},fetcher:async()=>Response.json({version:1,links:Object.fromEntries(plans.map(plan=>[new URL(plan.sourceUrl).pathname,'https://enterscholar.com/t/-/12345']))}),publishEdition:async plan=>{publications.push(plan.id);events.push('publish:'+plan.id);return {status:'verified',url:site.origin+'/en/news/'+plan.articleId+'/',revision:1};},translate:async(_,{plan})=>{models.push(plan.id);events.push('model:'+plan.id);throw busy();}};
 return {root,ids,plans,reads,models,publications,events,stateFile,planFile,state,patch,options};
}

test('eight bounded rounds fairly share one model opportunity while preserving the six-task three-job shortlist',async t=>{
 const f=await fixture(t,6),shortlists=[];
 for(let round=0;round<8;round++){
  const now=start+(round+1)*600000,before=(await flowStatus(f.root,{pendingOnly:true,limit:3,now,planIds:f.ids})).map(row=>row.plan.id);shortlists.push(before);
  const result=await todayTick({...f.options,now});assert.equal(result.modelCalls,1);assert.deepEqual(result.jobs.map(row=>row.id),before);
  for(const id of before)assert.equal((await f.state(id)).checkedAt,now);
 }
 assert.deepEqual(f.models,[0,3,1,4,2,5,0,3].map(i=>f.ids[i]));
 assert.deepEqual(shortlists,Array.from({length:8},(_,i)=>f.ids.slice(i%2?3:0,i%2?6:3)));
 assert.equal(f.publications.length,0);for(const id of f.ids)assert.equal((await f.state(id)).translation.attempts,0);
});

test('future retries, terminal failures, review holds and complete states are filtered before shortlist/model selection',async t=>{
 const f=await fixture(t,8),now=start;
 await f.patch(f.ids[0],{retryAt:now+60000});
 await f.patch(f.ids[1],{translation:{status:'failed',startedAt:0}});
 await f.patch(f.ids[2],{status:'translation_review',edition});
 await f.patch(f.ids[3],{status:'needs_review'});
 await f.patch(f.ids[4],{complete:true});
 await f.patch(f.ids[5],{translation:{status:'queued',startedAt:30}});
 await f.patch(f.ids[6],{translation:{status:'queued'}});
 await f.patch(f.ids[7],{translation:{status:'queued',startedAt:10}});
 const before=await Promise.all(f.ids.slice(0,5).map(id=>readFile(f.stateFile(id),'utf8')));
 const result=await todayTick({...f.options,now});assert.equal(result.modelCalls,1);assert.deepEqual(f.reads,f.ids.slice(5));assert.deepEqual(f.models,[f.ids[6]]);
 assert.deepEqual(await Promise.all(f.ids.slice(0,5).map(id=>readFile(f.stateFile(id),'utf8'))),before);
});

test('ready English and translation-disabled jobs progress in original order alongside at most one older model candidate',async t=>{
 const f=await fixture(t,3);
 await f.patch(f.ids[0],{edition,translation:{status:'ready',startedAt:1}});
 await f.patch(f.ids[1],{translation:{status:'queued',startedAt:30}});
 await f.patch(f.ids[2],{translation:{status:'queued',startedAt:10}});
 const result=await todayTick({...f.options,reviewBeforeEnglishPlanIds:[],now:start});
 assert.equal(result.modelCalls,1);assert.deepEqual(f.reads,f.ids);assert.deepEqual(f.models,[f.ids[2]]);assert.deepEqual(f.publications,[f.ids[0]]);
 assert.deepEqual(f.events,['read:'+f.ids[0],'publish:'+f.ids[0],'read:'+f.ids[1],'read:'+f.ids[2],'model:'+f.ids[2]]);
 assert.equal((await f.state(f.ids[0])).complete,true);
 const disabled=await fixture(t,3);disabled.plans[0].policy.translate=false;await writeFile(disabled.planFile(disabled.ids[0]),JSON.stringify(disabled.plans[0]));
 const second=await todayTick({...disabled.options,now:start});assert.equal(second.modelCalls,1);assert.deepEqual(disabled.models,[disabled.ids[1]]);assert.deepEqual(disabled.reads,disabled.ids);assert.equal((await disabled.state(disabled.ids[0])).complete,true);
});

test('recovering the reserved candidate checkpoint may consume no model turn and never retranslates it',async t=>{
 const f=await fixture(t,2),plan=f.plans[0];
 await writeFile(join(flowDirectory(f.root),'jobs',plan.id,'translation-result.json'),JSON.stringify({planId:plan.id,sourceSha256:plan.sha256,edition}));
 const result=await todayTick({...f.options,now:start});assert.equal(result.modelCalls,0);assert.deepEqual(f.models,[]);assert.deepEqual(f.reads,f.ids);assert.equal((await f.state(plan.id)).status,'translation_review');assert.equal((await f.state(plan.id)).translation.recovered,true);
 const next=await todayTick({...f.options,now:start+600000});assert.equal(next.modelCalls,1);assert.deepEqual(f.models,[f.ids[1]]);assert.equal(f.publications.length,0);
});

test('a reserved candidate whose source drifted cannot yield its model turn to another unverified source',async t=>{
 const f=await fixture(t,2);
 const result=await todayTick({...f.options,now:start,readSource:async(id,{plan})=>{f.reads.push(plan.id);return {version:plan.id===f.ids[0]?2:1,publishedVersion:1,sha256:'f'.repeat(64)};}});
 assert.equal(result.modelCalls,0);assert.deepEqual(f.models,[]);assert.deepEqual(f.reads,f.ids);assert.equal((await f.state(f.ids[0])).status,'stale');
});

test('missing legacy start time is oldest and equal finite times preserve existing checkedAt shortlist order',async t=>{
 const f=await fixture(t,3);
 await f.patch(f.ids[0],{checkedAt:2,translation:{status:'queued',startedAt:10}});
 await f.patch(f.ids[1],{checkedAt:1,translation:{status:'queued',startedAt:10}});
 await f.patch(f.ids[2],{checkedAt:3,translation:{status:'queued',startedAt:20}});
 await todayTick({...f.options,now:start});assert.deepEqual(f.models,[f.ids[1]]);assert.deepEqual(f.reads,[f.ids[1],f.ids[0],f.ids[2]]);
 await f.patch(f.ids[2],{translation:{status:'queued'}});
 await todayTick({...f.options,now:start+600000});assert.deepEqual(f.models,[f.ids[1],f.ids[2]]);
});
