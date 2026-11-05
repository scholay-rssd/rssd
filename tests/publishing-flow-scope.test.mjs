import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles} from '../scripts/site-config.mjs';
import {atomic,configureFlow,enqueuePublished,flowDirectory,flowStatus,todayTick,validateFlowPlanIds} from '../scripts/publishing-flow.mjs';
import {superviseFlows} from '../scripts/publishing-flow-supervisor.mjs';

const site={...profiles.find(item=>item.id==='metho'),languages:['zh-CN','en']};
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'today-flow-scope-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const sources=['first-source','second-source'].map(id=>({id,title:'范围测试',summary:'原文保持不变。',markdown:'# 范围测试\n\n原文保持不变。',assets:[],date:'2026-10-25',author:site.author,category:site.columns[0]}));
 await configureFlow(root,site,{version:1,siteId:site.id,origin:site.origin,enabled:true,autoRun:true,translate:false,authorization:'Scope regression only',articleIds:sources.map(source=>source.id),targets:[]});
 for(const data of sources)await enqueuePublished({root,site,data,receipt:{revision:1,url:'/news/'+data.id+'/',publicReadback:true,job:{status:'success'}}});
 const plans=(await flowStatus(root)).map(row=>row.plan),reads=[];
 const options={root,site,readSource:async(id,{plan})=>{reads.push(id);assert.equal(plan.articleId,id);return {version:1,publishedVersion:1,sha256:plan.sha256};},translate:async()=>assert.fail('Translation is disabled in this fixture'),publishEdition:async()=>assert.fail('English is disabled in this fixture'),fetcher:async()=>Response.json({version:1,links:Object.fromEntries(sources.map(source=>['/news/'+source.id+'/','https://enterscholar.com/t/-/12345']))})};
 const file=join(root,'supervisor.json'),entry={root,site,tokenFile:join(root,'unused-token')};await atomic(file,{version:1,workspaces:[entry]});
 return {root,plans,reads,options,file,entry};
}

test('plan scope filters before the limit, isolates state, treats empty as none, and can resume the default queue',async t=>{
 const f=await fixture(t),[excluded,selected]=f.plans;
 const planFile=join(flowDirectory(f.root),'jobs',excluded.id,'plan.json'),stateFile=join(flowDirectory(f.root),'jobs',excluded.id,'state.json'),policyFile=join(flowDirectory(f.root),'policy.json');
 const planBytes=await readFile(planFile),policyBytes=await readFile(policyFile);
 assert.deepEqual((await flowStatus(f.root,{pendingOnly:true,limit:1,planIds:[selected.id]})).map(row=>row.plan.id),[selected.id]);
 assert.equal((await flowStatus(f.root,{planIds:f.plans.map(plan=>plan.id)})).length,2);
 const result=await todayTick({...f.options,planIds:[selected.id]});assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].id,selected.id);assert.equal(result.jobs[0].complete,true);assert.deepEqual(f.reads,[selected.articleId]);
 await assert.rejects(readFile(stateFile),error=>error.code==='ENOENT');assert.deepEqual(await readFile(planFile),planBytes);assert.deepEqual(await readFile(policyFile),policyBytes);
 assert.deepEqual(await flowStatus(f.root,{planIds:[]}),[]);assert.deepEqual(await todayTick({...f.options,planIds:[]}),{modelCalls:0,jobs:[]});assert.deepEqual(f.reads,[selected.articleId]);
 assert.deepEqual((await todayTick(f.options)).jobs.map(row=>row.id),[excluded.id]);assert.deepEqual(f.reads,[selected.articleId,excluded.articleId]);assert((await flowStatus(f.root)).every(row=>row.state.complete));
});

test('invalid or duplicate plan scopes fail before reading or running work',async t=>{
 const f=await fixture(t),id=f.plans[0].id;
 for(const planIds of [null,id,[id,id],['A'.repeat(40)],['g'.repeat(40)],[id.slice(1)],[undefined],Array(1)]){
  assert.throws(()=>validateFlowPlanIds(planIds),/planIds/);
  await assert.rejects(flowStatus(f.root,{planIds}),/planIds/);await assert.rejects(todayTick({...f.options,planIds}),/planIds/);
 }
 assert.deepEqual(f.reads,[]);assert.equal(validateFlowPlanIds(undefined),undefined);assert.deepEqual(validateFlowPlanIds([]),[]);
 const input=[id],validated=validateFlowPlanIds(input);input.length=0;assert.deepEqual(validated,[id]);
});

test('supervisor empty scope stays idle despite pending flows and local intents; invalid scopes reject the whole round',async t=>{
 const f=await fixture(t);await atomic(join(flowDirectory(f.root),'submissions','local-submission-123.json'),{status:'pending',articleId:'unrelated-source'});
 await atomic(f.file,{version:1,workspaces:[{...f.entry,planIds:[]}]});let runs=0;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),100);
 try{await superviseFlows(f.file,{signal:controller.signal,intervalMs:10,run:async()=>{runs++;controller.abort();return {code:0};}});}finally{clearTimeout(timer);controller.abort();}
 assert.equal(runs,0);assert((await flowStatus(f.root)).every(row=>Object.keys(row.state).length===0));
 for(const planIds of [null,[f.plans[0].id,f.plans[0].id],['bad-id']]){
  await atomic(f.file,{version:1,workspaces:[f.entry,{...f.entry,planIds}]});
  await assert.rejects(superviseFlows(f.file,{run:async()=>{runs++;return {code:0};}}),/planIds/);assert.equal(runs,0,'No earlier workspace runs before a later invalid scope is rejected');
 }
});
