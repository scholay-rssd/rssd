import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {normalizeFrozenSchedule,compileSchedule,slotsForDay,captureScheduleTick,dispatchScheduledSlot,reconcileScheduledWork,runNextScheduledWork,checkScheduledPublication} from '../scripts/rssd-multisite-scheduler.mjs';
import {runMultisiteSupervisor} from '../scripts/rssd-multisite-supervisor.mjs';
import {CenterError} from '../scripts/rssd-center-client.mjs';

const plan={version:1,timezone:'Asia/Shanghai',sites:[
 {siteId:'one',sections:[{sectionId:'news',verified:true,dailyLimit:2,slots:[{id:'morning',time:'08:00',count:2}]},{sectionId:'unknown',verified:false}]},
 {siteId:'two',sections:[{sectionId:'news',verified:true,dailyLimit:1,slots:[{id:'noon',time:'08:05',count:1}]}]},
]};
const profiles=[{id:'one',spaceId:'space-one'},{id:'two',spaceId:'space-two'}];
const config=(site,space,section='news')=>({siteId:site,workspaceId:space,sectionId:section,destinationId:`site-${site}`,enabled:true,verified:true,requiredLocales:['zh-CN'],maxDelayMinutes:120});
const connection={origin:'https://center.example',orgId:'org-one',workerId:'device-one'};
const at=value=>Date.parse(value);
async function fixture(t,configs=[config('one','space-one')]){
 const home=await mkdtemp(join(tmpdir(),'rssd-multisite-schedule-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const remote=new Map(),calls={prepare:0,enqueue:0,lookup:0};let time=at('2026-11-02T00:00:00Z');
 const args={plan,profiles,configs,connection,home,clock:()=>time,ready:async()=>({ready:true}),
  prepare:async({slot})=>{calls.prepare++;return {id:slot.id,workspaceId:slot.workspaceId,sectionId:slot.sectionId,kind:'write',title:`Topic ${slot.siteId} ${slot.unit}`,brief:'Verified source',requiredLocales:slot.requiredLocales};},
  lookup:async id=>{calls.lookup++;return remote.has(id)?{state:'found',demand:remote.get(id)}:{state:'missing',complete:true};},
  enqueue:async demand=>{calls.enqueue++;const row={id:demand.id,payload:demand,state:'queued'};remote.set(demand.id,row);return row;}};
 return {args,remote,calls,setTime:value=>{time=at(value);},state:async()=>JSON.parse(await readFile(join(home,'multisite-scheduler.json'),'utf8'))};
}

test('crashed work reconciles only the original demand and never implies public publication',async t=>{
 const f=await fixture(t);await captureScheduleTick(f.args);await dispatchScheduledSlot(f.args);
 const state=await f.state(),entry=state.entries.find(e=>e.status==='demand_created');entry.work={state:'running',token:'original-token',startedAt:new Date(f.args.clock()).toISOString()};
 await writeFile(join(f.args.home,'multisite-scheduler.json'),JSON.stringify(state));
 const found=await reconcileScheduledWork({...f.args,inspect:async({slot,demand})=>{assert.equal(slot.id,entry.slot.id);assert.equal(demand.id,entry.slot.id);return {state:'submitted',demandId:slot.id,workId:'work',publications:[{id:'publication',requestId:'request',locale:'zh-CN',revision:1,contentHash:'a'.repeat(64)}]};}});
 assert.equal(found.state,'submitted');const after=await f.state();assert.equal(after.entries.find(x=>x.slot.id===entry.slot.id).work.reason,'original_receipt_reconciled');
 assert.equal(after.entries.find(x=>x.slot.id===entry.slot.id).work.publicationCheck.state,'pending');
 const publicUrls=[{locale:'zh-CN',url:'https://example.org/news/x/'}];
 assert.equal((await checkScheduledPublication({...f.args,inspect:async()=>({state:'pending',reason:'community_link_pending',publicUrls})})).state,'pending');
 assert.deepEqual((await f.state()).entries.find(x=>x.slot.id===entry.slot.id).work.publicationCheck.publicUrls,publicUrls);
 assert.equal((await checkScheduledPublication({...f.args,inspect:async()=>({state:'verified',reason:'receiver_public_pages_and_community_confirmed',urls:publicUrls,communityUrl:'https://enterscholar.com/t/-/12345'})})).state,'verified');
 assert.equal((await f.state()).entries.find(x=>x.slot.id===entry.slot.id).work.publicationCheck.communityUrl,'https://enterscholar.com/t/-/12345');
});

test('only a fresh original queued demand can retry after crash; ambiguous states block',async t=>{
 const f=await fixture(t);await captureScheduleTick(f.args);await dispatchScheduledSlot(f.args);const state=await f.state(),entry=state.entries.find(e=>e.status==='demand_created');entry.work={state:'running',token:'original-token',startedAt:new Date(f.args.clock()).toISOString()};await writeFile(join(f.args.home,'multisite-scheduler.json'),JSON.stringify(state));
 assert.equal((await reconcileScheduledWork({...f.args,inspect:async()=>({state:'retry',demandId:entry.slot.id})})).state,'retry');
 assert.equal((await runNextScheduledWork({...f.args,runWork:async({slot})=>({state:'blocked',demandId:slot.id})})).state,'blocked');
 assert.equal((await reconcileScheduledWork({...f.args,inspect:async()=>{throw Error('must not retry blocked');}})).state,'idle');
});

test('an existing demand is not turned into a late article on a later day',async t=>{
 const f=await fixture(t);await captureScheduleTick(f.args);await dispatchScheduledSlot(f.args);f.setTime('2026-11-03T00:00:00Z');let calls=0;
 const result=await runNextScheduledWork({...f.args,runWork:async()=>{calls++;}});assert.equal(result.state,'expired');assert.equal(result.reason,'original_work_expired');assert.equal(calls,0);assert.equal((await f.state()).entries.find(x=>x.status==='demand_created').work.state,'expired');
});

test('supervisor captures another site while a long article is running',async t=>{
 const f=await fixture(t,[config('one','space-one'),config('two','space-two')]),controller=new AbortController();let started,release,captured,articleSignal,finished=false;
 const startedP=new Promise(resolve=>started=resolve),releaseP=new Promise(resolve=>release=resolve),capturedP=new Promise(resolve=>captured=resolve);
 const adapter={ready:f.args.ready,lookup:f.args.lookup,enqueue:f.args.enqueue,prepare:f.args.prepare};
 const run=runMultisiteSupervisor({...f.args,enabled:true,adapter,signal:controller.signal,captureEveryMs:1000,dispatchEveryMs:1000,workEveryMs:1000,runWork:async({signal})=>{articleSignal=signal;started();await releaseP;return {state:'blocked'};},onEvent:event=>{if(event.type==='capture'&&event.captured===1)captured();}}).then(value=>{finished=true;return value;});
 try{await Promise.race([startedP,new Promise((_,reject)=>setTimeout(()=>reject(Error('article did not start')),5000))]);f.setTime('2026-11-02T00:05:00Z');await Promise.race([capturedP,new Promise((_,reject)=>setTimeout(()=>reject(Error('second slot was not captured')),4000))]);assert((await f.state()).entries.some(e=>e.slot.siteId==='two'));controller.abort();await new Promise(resolve=>setTimeout(resolve,50));assert.equal(articleSignal.aborted,false);assert.equal(finished,false);}
 finally{controller.abort();release();await run;}
});

test('frozen inventory normalizes only formerly active, fully specified routines without enabling them',()=>{
 const snapshot={version:1,timezone:'Asia/Shanghai',sites:[{siteId:'one',sections:[
  {sectionId:'news',legacyScheduleFile:{scopeBeforeGlobalHold:'active',currentlyEnabled:false,countPerDay:2,produceAtLocalAll:['08:00','08:30'],mode:'xiwen',requireEnglish:true,requireFlow:true}},
  {sectionId:'unknown',legacyScheduleFile:{scopeBeforeGlobalHold:'disabled'}}]}]};
 const normalized=normalizeFrozenSchedule(snapshot),section=normalized.sites[0].sections[0];
 assert.equal(section.verified,true);assert.equal(section.contentMode,'xiwen');assert.equal(section.requireFlow,true);assert.deepEqual(section.requiredLocales,['zh-CN','en']);assert.equal(section.slots.length,2);
 assert.equal(normalized.sites[0].sections[1].verified,false);assert.deepEqual(compileSchedule(normalized,[],profiles),[]);
 assert.throws(()=>compileSchedule(normalized,[config('one','space-one')],profiles),/Languages differ/);
 const enabled={...config('one','space-one'),requiredLocales:['zh-CN','en']};assert.equal(slotsForDay(normalized,[enabled],{profiles,now:at('2026-11-02T00:00:00Z')}).length,2);
 const corrupt=structuredClone(snapshot);corrupt.sites[0].sections[0].legacyScheduleFile.produceAtLocalAll=['08:00'];assert.throws(()=>normalizeFrozenSchedule(corrupt),/Incomplete/);
});

test('explicit new rules enable inactive placeholders without rewriting historical rules',()=>{
 const snapshot={version:1,timezone:'Asia/Shanghai',sites:[{siteId:'one',sections:[
  {sectionId:'news',legacyScheduleFile:{scopeBeforeGlobalHold:'active',countPerDay:1,produceAtLocalAll:['08:00'],mode:'news',requireEnglish:false,requireFlow:true}},
  {sectionId:'unknown',legacyScheduleFile:{scopeBeforeGlobalHold:'disabled'}}]}]};
 const newRules={version:1,timezone:'Asia/Shanghai',sites:[{siteId:'one',sections:[{sectionId:'unknown',provenance:{kind:'owner-authorized-new-rule',note:'owner requested all sites'},dailyLimit:1,contentMode:'news',requireFlow:true,requiredLocales:['zh-CN'],slots:[{id:'new-morning',time:'10:00',count:1}]}]}]};
 const plan=normalizeFrozenSchedule(snapshot,{newRules});assert.equal(plan.sites[0].sections[0].provenance,undefined);
 assert.equal(plan.sites[0].sections[1].provenance.kind,'owner-authorized-new-rule');
 assert.equal(compileSchedule(plan,[config('one','space-one','unknown')],profiles).length,1);
 const altered=structuredClone(newRules);altered.sites[0].sections[0].sectionId='news';assert.throws(()=>normalizeFrozenSchedule(snapshot,{newRules:altered}),/inactive/);
 const noProof=structuredClone(newRules);delete noProof.sites[0].sections[0].provenance;assert.throws(()=>normalizeFrozenSchedule(snapshot,{newRules:noProof}),/authorization/);
 const invalid=structuredClone(newRules);invalid.sites[0].sections[0].slots[0].count=2;assert.throws(()=>normalizeFrozenSchedule(snapshot,{newRules:invalid}),/slot units/);
});

test('frozen site editorial rules are carried into each slot and cannot be altered after capture',async t=>{
 const snapshot={version:1,timezone:'Asia/Shanghai',crossSiteEditorialRules:{additionalBySite:{one:['保留来源适用地区与日期']}},sites:[{siteId:'one',sections:[{sectionId:'news',legacyScheduleFile:{scopeBeforeGlobalHold:'active',countPerDay:1,produceAtLocalAll:['08:00'],mode:'documentation',requireEnglish:false,requireFlow:true}}]}]};
 const f=await fixture(t);f.args.plan=normalizeFrozenSchedule(snapshot);await captureScheduleTick(f.args);
 let state=await f.state();assert.deepEqual(state.entries[0].slot.editorialRules,['保留来源适用地区与日期']);assert.equal(state.entries[0].slot.contentMode,'documentation');
 state.entries[0].slot.editorialRules=[];await writeFile(join(f.args.home,'multisite-scheduler.json'),JSON.stringify(state));
 assert.equal((await dispatchScheduledSlot(f.args)).reason,'configuration_changed');assert.equal(f.calls.enqueue,0);
});

test('an unclaimed expired slot does not block a different site',async t=>{
 const f=await fixture(t,[{...config('one','space-one'),maxPerDay:1,maxDelayMinutes:2},config('two','space-two')]);
 await captureScheduleTick(f.args);assert.equal((await dispatchScheduledSlot(f.args)).state,'demand_created');
 f.setTime('2026-11-02T00:05:00Z');await captureScheduleTick(f.args);assert.equal((await dispatchScheduledSlot(f.args)).state,'demand_created');
 let calls=0;assert.equal((await runNextScheduledWork({...f.args,runWork:async()=>{calls++;}})).state,'expired');
 const next=await runNextScheduledWork({...f.args,runWork:async({slot})=>{calls++;assert.equal(slot.siteId,'two');return {state:'blocked'};}});
 assert.equal(next.state,'blocked');assert.equal(calls,1);
});

test('temporary readiness and source failures retry the same slot within its window',async t=>{
 const f=await fixture(t,[{...config('one','space-one'),maxPerDay:1}]);await captureScheduleTick(f.args);
 f.args.ready=async()=>({ready:false});const first=await dispatchScheduledSlot(f.args);assert.equal(first.state,'scheduled');assert.equal(first.reason,'not_ready');
 f.args.ready=async()=>({ready:true});assert.equal((await dispatchScheduledSlot(f.args)).state,'idle');
 f.setTime('2026-11-02T00:01:01Z');const base=f.args.prepare;f.args.prepare=async()=>{throw Object.assign(Error('connection reset'),{code:'ECONNRESET'});};
 const second=await dispatchScheduledSlot(f.args);assert.equal(second.id,first.id);assert.equal(second.reason,'prepare_temporarily_unavailable');assert.equal(f.calls.enqueue,0);
 f.args.prepare=base;f.setTime('2026-11-02T00:02:02Z');const third=await dispatchScheduledSlot(f.args);assert.equal(third.id,first.id);assert.equal(third.state,'demand_created');assert.equal(f.calls.enqueue,1);
});

test('readiness lost after preparing retains and retries the original demand without recreating it',async t=>{
 const f=await fixture(t,[{...config('one','space-one'),maxPerDay:1}]);await captureScheduleTick(f.args);let checks=0;
 f.args.ready=async()=>({ready:++checks!==2});const first=await dispatchScheduledSlot(f.args);assert.equal(first.state,'pending');assert.equal(first.reason,'not_ready');assert.equal(f.calls.prepare,1);assert.equal(f.calls.enqueue,0);
 f.setTime('2026-11-02T00:01:01Z');const second=await dispatchScheduledSlot(f.args);assert.equal(second.state,'demand_created');assert.equal(second.id,first.id);assert.equal(f.calls.prepare,1);assert.equal(f.calls.enqueue,1);
});

test('a Center network error is retried but authorization failure remains blocked',async t=>{
 const f=await fixture(t,[{...config('one','space-one'),maxPerDay:1}]);await captureScheduleTick(f.args);
 f.args.ready=async()=>{throw new CenterError('Center is unreachable; the original request is retained');};
 assert.equal((await dispatchScheduledSlot(f.args)).reason,'prepare_temporarily_unavailable');
 f.setTime('2026-11-02T00:01:01Z');f.args.ready=async()=>{throw new CenterError('forbidden',{status:403,code:'forbidden'});};
 assert.equal((await dispatchScheduledSlot(f.args)).state,'blocked');assert.equal(f.calls.enqueue,0);
});

test('invalid editorial content remains blocked and expiring retries never create a demand',async t=>{
 const f=await fixture(t,[{...config('one','space-one'),maxPerDay:1,maxDelayMinutes:2}]);await captureScheduleTick(f.args);
 f.args.prepare=async()=>{throw Error('Topic novelty was not verified');};assert.equal((await dispatchScheduledSlot(f.args)).state,'blocked');assert.equal(f.calls.enqueue,0);
 const g=await fixture(t,[{...config('one','space-one'),maxPerDay:1,maxDelayMinutes:2}]);await captureScheduleTick(g.args);g.args.ready=async()=>({ready:false});assert.equal((await dispatchScheduledSlot(g.args)).state,'scheduled');
 g.setTime('2026-11-02T00:03:00Z');await captureScheduleTick(g.args);assert.equal((await g.state()).entries[0].status,'missed');assert.equal(g.calls.enqueue,0);
});

test('sections default off and require verified schedules, canonical site bindings and explicit languages',()=>{
 assert.deepEqual(compileSchedule(plan,[],profiles),[]);assert.equal(compileSchedule(plan,[config('one','space-one')],profiles).length,1);
 assert.throws(()=>compileSchedule(plan,[{...config('one','space-one'),verified:false}],profiles),/verified/);
 assert.throws(()=>compileSchedule(plan,[config('one','space-one','unknown')],profiles),/verified/);
 assert.throws(()=>compileSchedule(plan,[config('one','space-two')],profiles),/canonical/);
 assert.throws(()=>compileSchedule(plan,[{...config('one','space-one'),requiredLocales:[]}],profiles),/languages/);
 assert.throws(()=>compileSchedule(plan,[{...config('one','space-one'),maxPerDay:3}],profiles));
 const bad=structuredClone(plan);bad.sites[0].sections[0].dailyLimit=3;assert.throws(()=>compileSchedule(bad,[config('one','space-one')],profiles),/equal/);
});

test('a verified time with multiple units produces distinct stable IDs on each Shanghai day',()=>{
 const configs=[config('one','space-one')];let slots=slotsForDay(plan,configs,{profiles,now:at('2026-11-01T16:00:00Z')});
 assert.equal(slots.length,2);assert.equal(slots[0].date,'2026-11-02');assert.equal(slots[0].scheduledAt,'2026-11-02T00:00:00.000Z');assert.notEqual(slots[0].id,slots[1].id);
 assert.equal(slots[0].id,slotsForDay(plan,configs,{profiles,now:at('2026-11-02T00:30:00Z')})[0].id);
 assert.notEqual(slots[0].id,slotsForDay(plan,configs,{profiles,now:at('2026-11-03T00:00:00Z')})[0].id);
 assert.equal(slotsForDay(plan,[{...configs[0],maxPerDay:1}],{profiles,now:at('2026-11-02T00:00:00Z')}).length,1);
});

test('independent capture persists all due units without calling a model or duplicating slots',async t=>{
 const f=await fixture(t);const [a,b]=await Promise.all([captureScheduleTick(f.args),captureScheduleTick(f.args)]);
 assert.equal(a.captured.length+b.captured.length,2);assert.equal(f.calls.prepare,0);assert.equal(f.calls.enqueue,0);
 const state=await f.state();assert.deepEqual(state.entries.map(x=>x.status),['scheduled','scheduled']);
});

test('slow content generation does not block capture of other sites and delayed slots remain queued',async t=>{
 const f=await fixture(t,[config('one','space-one'),config('two','space-two')]);await captureScheduleTick(f.args);
 let started,release;const startedPromise=new Promise(r=>started=r),gate=new Promise(r=>release=r),base=f.args.prepare;
 f.args.prepare=async x=>{started();await gate;return base(x);};const busy=dispatchScheduledSlot(f.args);await startedPromise;
 f.setTime('2026-11-02T00:05:00Z');const captured=await captureScheduleTick(f.args);assert.equal(captured.captured.length,1);
 assert.equal((await f.state()).entries.filter(e=>e.status==='scheduled').length,2);release();assert.equal((await busy).state,'demand_created');
 assert.equal((await f.state()).entries.filter(e=>e.status==='scheduled').length,2);
});

test('first startup records unknown earlier history without inventing old orders',async t=>{
 const f=await fixture(t);f.setTime('2026-11-02T00:30:01Z');const result=await captureScheduleTick(f.args);
 assert.equal(result.missed.length,0);assert.equal(result.captured.length,0);assert.equal(result.gaps[0].kind,'initial_history_unknown');assert.equal(result.gaps[0].potentialUncaptured,null);assert.equal((await f.state()).entries.length,0);assert.equal(f.calls.prepare,0);assert.equal((await dispatchScheduledSlot(f.args)).state,'idle');
 f.setTime('2026-11-03T00:00:00Z');assert.equal((await captureScheduleTick(f.args)).captured.length,2);
});

test('cross-day outages record bounded conditional missing identities without creating late orders',async t=>{
 const f=await fixture(t);f.setTime('2026-11-01T23:59:00Z');await captureScheduleTick(f.args);
 f.setTime('2026-11-03T00:30:00Z');const result=await captureScheduleTick(f.args),gap=result.gaps[0];
 assert.equal(gap.kind,'offline_interval');assert.equal(gap.potentialUncaptured,4);assert.equal(gap.estimateCondition,'if_plan_remained_enabled_and_unchanged');
 assert.deepEqual(gap.potentialSlots.map(x=>x.scheduledAt),['2026-11-02T00:00:00.000Z','2026-11-02T00:00:00.000Z','2026-11-03T00:00:00.000Z','2026-11-03T00:00:00.000Z']);
 assert.equal(new Set(gap.potentialSlots.map(x=>x.id)).size,4);assert.equal((await f.state()).entries.length,0);assert.equal(f.calls.prepare,0);assert.equal(f.calls.enqueue,0);
 assert.equal((await dispatchScheduledSlot(f.args)).state,'idle');assert.equal((await captureScheduleTick(f.args)).gaps.length,0);
});

test('the midnight boundary records yesterday as potential only and captures today within grace',async t=>{
 const f=await fixture(t,[{...config('one','space-one'),maxPerDay:2}]);f.args.plan=structuredClone(plan);
 f.args.plan.sites[0].sections[0].slots=[{id:'late',time:'23:59',count:1},{id:'early',time:'00:00',count:1}];
 f.setTime('2026-11-02T15:58:00Z');await captureScheduleTick(f.args);
 f.setTime('2026-11-02T16:00:30Z');const result=await captureScheduleTick(f.args);
 assert.equal(result.gaps[0].potentialUncaptured,1);assert.equal(result.gaps[0].potentialSlots[0].scheduledAt,'2026-11-02T15:59:00.000Z');
 assert.equal(result.captured.length,1);const state=await f.state();assert.equal(state.entries.filter(e=>e.status==='scheduled').length,1);assert.equal(state.entries.find(e=>e.status==='scheduled').slot.scheduledAt,'2026-11-02T16:00:00.000Z');
});

test('changed or missing plan observations and long outages stay explicitly unknown',async t=>{
 const f=await fixture(t);f.setTime('2026-11-01T23:59:00Z');await captureScheduleTick(f.args);f.args.configs=[{...f.args.configs[0],maxPerDay:1}];
 f.setTime('2026-11-03T00:30:00Z');const changed=(await captureScheduleTick(f.args)).gaps[0];assert.equal(changed.kind,'configuration_history_unknown');assert.equal(changed.potentialUncaptured,null);assert.notEqual(changed.previousPlanHash,changed.currentPlanHash);
 const state=await f.state();delete state.lastPlanHash;await writeFile(join(f.args.home,'multisite-scheduler.json'),JSON.stringify(state));
 f.setTime('2026-11-04T00:30:00Z');const legacy=(await captureScheduleTick(f.args)).gaps[0];assert.equal(legacy.kind,'configuration_history_unknown');assert.equal(legacy.previousPlanHash,null);assert.equal(legacy.potentialUncaptured,null);
 f.setTime('2027-02-04T00:30:00Z');const prolonged=(await captureScheduleTick(f.args)).gaps[0];assert.equal(prolonged.kind,'offline_interval');assert.equal(prolonged.potentialUncaptured,null);assert.equal(prolonged.potentialSlots,undefined);
 assert.equal(f.calls.prepare,0);assert.equal(f.calls.enqueue,0);
});

test('a newly enabled configuration never backfills even a recent pre-observation time',async t=>{
 const f=await fixture(t);f.args.configs=[];f.setTime('2026-11-01T23:59:00Z');await captureScheduleTick(f.args);
 f.args.configs=[config('one','space-one')];f.setTime('2026-11-02T00:05:00Z');const result=await captureScheduleTick(f.args);
 assert.equal(result.gaps[0].kind,'configuration_history_unknown');assert.equal(result.gaps[0].to,'2026-11-02T00:05:00.000Z');
 assert.equal(result.captured.length,0);assert.equal(result.missed.length,0);assert.equal((await f.state()).entries.length,0);
 assert.equal(f.calls.enqueue,0);assert.equal((await dispatchScheduledSlot(f.args)).state,'idle');
});

test('a lost submission response is reconciled by original ID after a crash or day boundary',async t=>{
 const f=await fixture(t);await captureScheduleTick(f.args);const send=f.args.enqueue;f.args.enqueue=async demand=>{await send(demand);throw Error('response lost');};
 assert.equal((await dispatchScheduledSlot(f.args)).state,'pending');assert.equal(f.calls.enqueue,1);
 f.setTime('2026-11-03T04:00:00Z');const recovered=await dispatchScheduledSlot(f.args);assert.equal(recovered.state,'demand_created');assert.equal(recovered.reason,'original_found');assert.equal(f.calls.enqueue,1);
});

test('an unreceived original request is marked missed after expiry and is never sent late',async t=>{
 const f=await fixture(t);await captureScheduleTick(f.args);f.args.enqueue=async()=>{f.calls.enqueue++;throw Error('offline');};
 assert.equal((await dispatchScheduledSlot(f.args)).state,'pending');f.setTime('2026-11-03T04:00:00Z');
 const result=await dispatchScheduledSlot(f.args);assert.equal(result.state,'missed');assert.equal(f.calls.enqueue,1);assert.equal(f.remote.size,0);
});

test('a pending original blocks the next unit in its section but not a different site',async t=>{
 const f=await fixture(t,[config('one','space-one'),config('two','space-two')]);await captureScheduleTick(f.args);
 f.args.enqueue=async demand=>{if(demand.workspaceId==='space-one')throw Error('offline');const row={id:demand.id,payload:demand};f.remote.set(demand.id,row);return row;};
 assert.equal((await dispatchScheduledSlot(f.args)).state,'pending');f.setTime('2026-11-02T00:05:00Z');await captureScheduleTick(f.args);
 assert.equal((await dispatchScheduledSlot(f.args)).state,'pending');
 const next=await dispatchScheduledSlot(f.args);assert.equal(next.state,'demand_created');assert.equal(f.calls.prepare,2);assert.equal([...f.remote.values()][0].payload.workspaceId,'space-two');
});

test('concurrent dispatch claims one unit once and crash lease expiry preserves the stable slot',async t=>{
 const f=await fixture(t);f.args.configs=[{...f.args.configs[0],maxPerDay:1}];await captureScheduleTick(f.args);
 let release,started;const gate=new Promise(r=>release=r),startedPromise=new Promise(r=>started=r),base=f.args.prepare;
 f.args.prepare=async x=>{started();await gate;return base(x);};const first=dispatchScheduledSlot(f.args);await startedPromise;
 assert.equal((await dispatchScheduledSlot(f.args)).state,'idle');release();assert.equal((await first).state,'demand_created');assert.equal(f.calls.enqueue,1);
});

test('a candidate that finishes after its lease or daily freshness is never sent',async t=>{
 const f=await fixture(t);await captureScheduleTick(f.args);const prepare=f.args.prepare;f.args.prepare=async x=>{const result=await prepare(x);f.setTime('2026-11-02T03:00:00Z');return result;};
 assert.equal((await dispatchScheduledSlot({...f.args,leaseMs:3600000})).state,'lease_lost');assert.equal(f.calls.enqueue,0);
 f.setTime('2026-11-02T03:00:01Z');await captureScheduleTick(f.args);assert((await f.state()).entries.every(x=>x.status==='missed'));
});

test('readiness, conflicts, switched identity and clock rollback fail closed',async t=>{
 const f=await fixture(t);await captureScheduleTick(f.args);f.args.ready=async()=>({ready:false});const unready=await dispatchScheduledSlot(f.args);assert.equal(unready.state,'scheduled');assert.equal(unready.reason,'not_ready');assert.equal(f.calls.enqueue,0);
 await assert.rejects(captureScheduleTick({...f.args,connection:{...connection,orgId:'other'}}),/another center/);
 f.setTime('2026-11-01T23:59:00Z');await assert.rejects(captureScheduleTick(f.args),/clock moved backwards/);
 const h=await fixture(t);await captureScheduleTick(h.args);h.args.lookup=async id=>({state:'found',demand:{id,payload:{id,title:'other'}}});assert.equal((await dispatchScheduledSlot(h.args)).reason,'identity_conflict');assert.equal(h.calls.enqueue,0);
});

test('a changed original time does not authorize a previously captured slot',async t=>{
 const f=await fixture(t);await captureScheduleTick(f.args);const changed=structuredClone(plan);changed.sites[0].sections[0].slots[0].time='08:15';
 const result=await dispatchScheduledSlot({...f.args,plan:changed});assert.equal(result.state,'blocked');assert.equal(result.reason,'configuration_changed');assert.equal(f.calls.prepare,0);assert.equal(f.calls.enqueue,0);
});

test('corrupted saved slot scope or timestamp cannot be dispatched',async t=>{
 const f=await fixture(t);await captureScheduleTick(f.args);const state=await f.state();state.entries[0].slot.workspaceId='space-two';
 // A changed workspace is caught against the verified profile before preparing.
 const {writeFile}=await import('node:fs/promises');await writeFile(join(f.args.home,'multisite-scheduler.json'),JSON.stringify(state));
 assert.equal((await dispatchScheduledSlot(f.args)).state,'blocked');assert.equal(f.calls.enqueue,0);
 const h=await fixture(t);await captureScheduleTick(h.args);const corrupted=await h.state();corrupted.entries[0].slot.scheduledAt='2026-11-02T00:01:00.000Z';await writeFile(join(h.args.home,'multisite-scheduler.json'),JSON.stringify(corrupted));
 await assert.rejects(dispatchScheduledSlot(h.args),/identity changed/);assert.equal(h.calls.enqueue,0);
});
