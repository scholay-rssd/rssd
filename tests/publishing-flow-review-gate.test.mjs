import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles} from '../scripts/site-config.mjs';
import {atomic,configureFlow,enqueuePublished,flowDirectory,flowStatus,todayTick,hash,validateFlowReviewPlanIds} from '../scripts/publishing-flow.mjs';
import {retryTranslation} from '../scripts/publishing-flow-recovery.mjs';
import {superviseFlows} from '../scripts/publishing-flow-supervisor.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';

const site={...profiles.find(item=>item.id==='metho'),languages:['zh-CN','en']};
const english={title:'Reviewed translation',summary:'The original facts remain.',markdown:'# Reviewed translation\n\nThe complete original facts remain unchanged.',provenance:{agentId:'translation-http',modelId:'self-hosted-model',attemptId:'original-attempt'}};
async function fixture(t,count=1,{targets=[],credentialBound=true}={}){
 const root=await mkdtemp(join(tmpdir(),'flow-review-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const sources=Array.from({length:count},(_,i)=>({id:'review-source-'+i,title:'审阅翻译',summary:'保留原始事实。',markdown:'# 审阅翻译\n\n保留完整原始事实。',date:'2026-10-25',category:site.columns[0],author:site.author,assets:[]}));
 await configureFlow(root,site,{version:1,siteId:site.id,origin:site.origin,enabled:true,autoRun:true,authorization:'Explicit review-gate fixture',articleIds:sources.map(source=>source.id),targets,handoffDirectory:join(root,'handoff')});
 let credential;if(credentialBound){const tokenFile=join(root,'original-token');await writeFile(tokenFile,'ORIGINAL_REVIEW_SUBMITTER',{mode:0o600});await protectPrivateFile(tokenFile);credential={tokenFile,credentialId:hash('ORIGINAL_REVIEW_SUBMITTER')};}
 for(const data of sources)await enqueuePublished({root,site,data,receipt:{revision:1,url:'/news/'+data.id+'/',publicReadback:true,job:{status:'success'}},...(credential?{credential}:{})});
 const plans=(await flowStatus(root)).map(row=>row.plan),published=[],reads=[],models=[];
 const stateFile=id=>join(flowDirectory(root),'jobs',id,'state.json');
 const readSource=async(id,{plan})=>{assert.equal(id,plan.articleId);reads.push(id);return {version:plan.revision,publishedVersion:plan.revision,sha256:plan.sha256};};
 const options={root,site,readSource,translate:async(source,{plan})=>{models.push(plan.id);return structuredClone(english);},publishEdition:async(plan,edition)=>{published.push({id:plan.id,edition});return {status:'verified',requestKey:'english-request-'+plan.id,url:site.origin+'/en/news/'+plan.articleId+'/',revision:1};},fetcher:async()=>Response.json({version:1,links:Object.fromEntries(sources.map(source=>['/news/'+source.id+'/','https://enterscholar.com/t/-/12345']))})};
 return {root,plans,published,reads,models,stateFile,options,readSource,readState:async id=>JSON.parse(await readFile(stateFile(id),'utf8'))};
}

test('an opted-in flow generates silently, waits without an English request, and explicit hash-bound acceptance releases it',async t=>{
 const f=await fixture(t),plan=f.plans[0],planFile=join(flowDirectory(f.root),'jobs',plan.id,'plan.json'),before=await readFile(planFile);
 const first=await todayTick({...f.options,planIds:[plan.id],reviewBeforeEnglishPlanIds:[plan.id]});assert.equal(first.modelCalls,1);assert.equal(first.jobs[0].status,'translation_review');assert.equal(first.jobs[0].complete,false);assert.equal(f.published.length,0);
 const held=await f.readState(plan.id);assert.equal(held.translation.status,'ready');assert.equal(held.translationReviewRequired,true);assert.deepEqual(held.edition,english);
 await assert.rejects(readFile(join(flowDirectory(f.root),'jobs',plan.id,'website-en.json')),error=>error.code==='ENOENT');assert.deepEqual(await flowStatus(f.root,{pendingOnly:true}),[]);
 const calls=f.reads.length;assert.deepEqual(await todayTick(f.options),{modelCalls:0,jobs:[]});assert.equal(f.reads.length,calls);
 const reviewed={...english,summary:'The fully reviewed original facts remain.'};await retryTranslation({root:f.root,site,id:plan.id,readSource:f.readSource,edition:reviewed});
 const ready=await f.readState(plan.id);assert.equal(ready.translation.reviewed,true);assert.equal(ready.translation.reviewedSourceSha256,plan.sha256);assert.equal(ready.translation.reviewedEditionSha256,hash(reviewed));assert.equal(ready.status,'waiting');
 assert.equal((await todayTick(f.options)).jobs[0].complete,true);assert.equal(f.models.length,1);assert.deepEqual(f.published,[{id:plan.id,edition:reviewed}]);assert.deepEqual(await readFile(planFile),before);
});

test('legacy reviewed flags, wrong source/hash and later edition changes cannot authorize the gate',async t=>{
 const f=await fixture(t),plan=f.plans[0],options={...f.options,planIds:[plan.id],reviewBeforeEnglishPlanIds:[plan.id]};
 for(const approval of [{reviewed:true},{reviewed:true,reviewedSourceSha256:'f'.repeat(64),reviewedEditionSha256:hash(english)},{reviewed:true,reviewedSourceSha256:plan.sha256,reviewedEditionSha256:'f'.repeat(64)},{reviewed:false,reviewedSourceSha256:plan.sha256,reviewedEditionSha256:hash(english)}]){
  await atomic(f.stateFile(plan.id),{edition:english,translation:{status:'ready',...approval}});assert.equal((await todayTick(options)).jobs[0].status,'translation_review');
 }
 await retryTranslation({root:f.root,site,id:plan.id,readSource:f.readSource});assert.equal((await todayTick(options)).jobs[0].status,'translation_review','ordinary retry is not approval');
 await retryTranslation({root:f.root,site,id:plan.id,readSource:f.readSource,edition:english});const state=await f.readState(plan.id);state.edition={...state.edition,summary:'A subsequent unreviewed edit.'};await atomic(f.stateFile(plan.id),state);
 assert.equal((await todayTick(f.options)).jobs[0].status,'translation_review');assert.equal(f.published.length,0);assert.equal(f.models.length,0);
 const before=await readFile(f.stateFile(plan.id));await assert.rejects(retryTranslation({root:f.root,site,id:plan.id,edition:english,readSource:async()=>({version:2,publishedVersion:2,sha256:plan.sha256})}),/Source changed/);assert.deepEqual(await readFile(f.stateFile(plan.id)),before);
});

test('awaiting review is filtered before the pending limit so three held editions cannot starve another plan',async t=>{
 const f=await fixture(t,4),held=f.plans.slice(0,3),other=f.plans[3];for(const plan of f.plans)await atomic(f.stateFile(plan.id),{edition:english,translation:{status:'ready'}});
 const options={...f.options,planIds:f.plans.map(plan=>plan.id),reviewBeforeEnglishPlanIds:held.map(plan=>plan.id)};
 const first=await todayTick(options);assert.equal(first.jobs.length,3);assert(first.jobs.every(job=>job.status==='translation_review'));assert.equal(f.published.length,0);
 assert.deepEqual((await flowStatus(f.root,{pendingOnly:true,limit:1})).map(row=>row.plan.id),[other.id]);
 assert.equal((await todayTick(options)).jobs[0].id,other.id);assert.deepEqual(f.published.map(item=>item.id),[other.id]);assert.equal(f.models.length,0);
});

test('review selection survives an interrupted model round while default unselected flows retain automatic publication',async t=>{
 const f=await fixture(t),plan=f.plans[0];
 const first=await todayTick({...f.options,planIds:[plan.id],reviewBeforeEnglishPlanIds:[plan.id],translate:async()=>{throw Object.assign(Error('Checkpoint saved'),{code:'FLOW_LANGUAGE_BUSY'});},now:1000000});
 assert.equal(first.jobs[0].translation,'queued');assert.equal((await f.readState(plan.id)).translationReviewRequired,true);
 assert.equal((await todayTick({...f.options,now:2000000})).jobs[0].status,'translation_review');assert.equal(f.published.length,0);
 const normal=await fixture(t);assert.equal((await todayTick(normal.options)).jobs[0].complete,true);assert.equal(normal.published.length,1);assert.equal((await normal.readState(normal.plans[0].id)).translationReviewRequired,undefined);
});

test('review IDs require an exact explicit subset and invalid supervisor scopes run no workspace',async t=>{
 const f=await fixture(t,2),[first,second]=f.plans.map(plan=>plan.id);
 assert.equal(validateFlowReviewPlanIds(undefined,undefined),undefined);assert.deepEqual(validateFlowReviewPlanIds([],[]),[]);
 for(const [review,scope] of [[[first],undefined],[[first],[second]],[[first,first],[first]],[['bad'],[first]],[null,[first]]]){
  assert.throws(()=>validateFlowReviewPlanIds(review,scope));await assert.rejects(todayTick({...f.options,planIds:scope,reviewBeforeEnglishPlanIds:review}));
 }
 assert.deepEqual(f.reads,[]);
 const file=join(f.root,'supervisor.json'),entry={root:f.root,site,tokenFile:join(f.root,'unused-token'),planIds:[first]};await atomic(file,{version:1,workspaces:[entry,{...entry,reviewBeforeEnglishPlanIds:[second]}]});let runs=0;
 await assert.rejects(superviseFlows(file,{run:async()=>{runs++;return {code:0};}}),/subset/);assert.equal(runs,0);
});

test('review gating refuses external-target or unbound local plans before any source, model or handoff side effect',async t=>{
 const target={platform:'discord',locale:'zh-CN',integrationId:'discord-account',channelId:'1562031229606301696',format:'summary'};
 for(const options of [{targets:[target]},{credentialBound:false}])await t.test(options.targets?'external-targets':'unbound-local',async t=>{
  const f=await fixture(t,1,options),plan=f.plans[0];let fetches=0;
  await assert.rejects(todayTick({...f.options,planIds:[plan.id],reviewBeforeEnglishPlanIds:[plan.id],fetcher:async()=>{fetches++;assert.fail('No map request before refusing the review scope');}}),/original-credential cloud continuation with no external targets/);
  assert.equal(fetches,0);assert.deepEqual(f.reads,[]);assert.deepEqual(f.models,[]);assert.deepEqual(f.published,[]);
  await assert.rejects(readFile(f.stateFile(plan.id)),error=>error.code==='ENOENT');await assert.rejects(readFile(join(f.root,'handoff','outbox')),error=>error.code==='ENOENT');
 });
 const mixed=await fixture(t,2,{targets:[target]}),first=mixed.plans[0];await atomic(join(flowDirectory(mixed.root),'jobs',first.id,'plan.json'),{...first,policy:{...first.policy,targets:[]}});
 await assert.rejects(todayTick({...mixed.options,planIds:mixed.plans.map(plan=>plan.id),reviewBeforeEnglishPlanIds:mixed.plans.map(plan=>plan.id)}),/no external targets/);assert.deepEqual(mixed.reads,[]);assert.deepEqual(mixed.models,[]);
 const normal=await fixture(t,1,{targets:[target],credentialBound:false});assert.equal((await todayTick(normal.options)).jobs[0].complete,true);assert.equal(normal.published.length,1);
 const state=await normal.readState(normal.plans[0].id);assert(Object.values(state.dispatch).some(value=>value.status==='ready'));assert.equal(state.translationReviewRequired,undefined);
});
