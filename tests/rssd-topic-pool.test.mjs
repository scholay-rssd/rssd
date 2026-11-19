import test from 'node:test';
import assert from 'node:assert/strict';
import protocol from '../contracts/rssd-v1.cjs';
import {fillTopicPool,poolDemand,poolSectionPolicy,poolSummary,MAX_POOL_BATCH} from '../scripts/rssd-topic-pool.mjs';
import {signalLeads,fetchSignalLeads} from '../scripts/rssd-topic-leads.mjs';
import {profiles} from '../scripts/site-config.mjs';

const scope={workspaceId:'pets',sectionId:'daily-cat'};
const topic=(title,extra={})=>({title,brief:'写清识别特征、行为与照护需求。',...extra});
// A stand-in Center: one section, the same refusals the real one gives.
function center({repeats=[]}={}){
 const rows=new Map(),calls={create:0,list:0};
 return {rows,calls,
  createDemand:async demand=>{
   calls.create++;
   if(rows.has(demand.id))throw Object.assign(Error('Demand identity already exists'),{status:409,code:'identity_conflict'});
   if(repeats.some(word=>demand.title.includes(word)))throw Object.assign(Error('This topic repeats the work w1 (旧文): same-subject'),{status:409,code:'topic_repeat'});
   const row={id:demand.id,title:demand.title,state:'queued',payload:demand};rows.set(demand.id,row);return row;
  },
  demands:async({sectionId,search})=>{calls.list++;return [...rows.values()].filter(row=>row.payload.sectionId===sectionId&&row.title.includes(search));}};
}

test('a batch is queued once: a second run of the same list creates nothing',async()=>{
 const client=center(),topics=[topic('缅因猫：温柔的巨人'),topic('布偶猫：性格与照护',{workType:'note',topicKey:'ragdoll',priority:3})];
 const first=await fillTopicPool({client,...scope,topics});
 assert.deepEqual(first.map(r=>r.state),['created','created']);assert.equal(client.rows.size,2);
 const stored=[...client.rows.values()][1].payload;
 assert.equal(stored.kind,'write');assert.equal(stored.workType,'note');assert.equal(stored.topicKey,'ragdoll');assert.equal(stored.priority,3);assert.deepEqual(stored.requiredLocales,['zh-CN','en']);
 const again=await fillTopicPool({client,...scope,topics});
 assert.deepEqual(again.map(r=>[r.state,r.demandState]),[['existing','queued'],['existing','queued']]);assert.equal(client.rows.size,2);
 assert.deepEqual(poolSummary([...first,...again]),{created:2,existing:2});
});
test('each topic gets its own answer: repeat, invalid, twice in the batch, and another title on the same identity',async()=>{
 const client=center({repeats:['暹罗猫']});
 const results=await fillTopicPool({client,...scope,topics:[topic('暹罗猫：起源与性格'),{title:'没有简述'},topic('英国短毛猫：圆脸与好脾气'),topic('英国短毛猫:圆脸与好脾气'),topic('孟加拉猫：野性外表',{unknown:1})]});
 assert.deepEqual(results.map(r=>r.state),['repeat','invalid','created','existing','invalid']);
 assert.match(results[0].reason,/same-subject/);assert.match(results[1].reason,/brief/);assert.match(results[3].reason,/twice/);assert.match(results[4].reason,/unknown/);
 // The invalid topics were never sent.
 assert.equal(client.calls.create,2);
 // The same identity with other content is a conflict, not silently taken as queued.
 const changed=await fillTopicPool({client,...scope,topics:[topic('英国短毛猫：圆脸与好脾气',{priority:9})]});
 assert.deepEqual(changed.map(r=>r.state),['conflict']);
});
test('a dry run plans the demands and sends nothing; an unexpected failure stops the batch',async()=>{
 const planned=await fillTopicPool({...scope,topics:[topic('缅因猫：温柔的巨人')],dryRun:true});
 assert.equal(planned[0].state,'planned');assert.equal(planned[0].demand.id,planned[0].id);assert.match(planned[0].id,/^pool-[a-f0-9]{40}$/);
 const client=center();client.createDemand=async()=>{throw Object.assign(Error('Center is unreachable'),{status:0,code:'network_error'});};
 await assert.rejects(fillTopicPool({client,...scope,topics:[topic('缅因猫：温柔的巨人')]}),/unreachable/);
 await assert.rejects(fillTopicPool({client,...scope,topics:[]}),/1 to/);
 await assert.rejects(fillTopicPool({client,...scope,topics:Array.from({length:MAX_POOL_BATCH+1},(_,i)=>topic('题目'+i))}),/1 to/);
});
test('a pool topic may only ask for a work type its section takes, and records its lead',()=>{
 const policy=poolSectionPolicy(profiles,'pets','daily-cat');
 assert.ok(policy.workTypes.includes('article'));
 const lead={provider:'tikhub',platformId:'douyin',term:'猫咪换毛季',observedAt:'2026-11-19T01:00:00Z'};
 const demand=poolDemand(topic('猫咪换毛季怎么护理',{lead,workType:policy.workTypes[0]}),{...scope,policy});
 assert.deepEqual(demand.lead,{...lead,observedAt:'2026-11-19T01:00:00.000Z'});
 assert.throws(()=>poolDemand(topic('只收长文的栏目',{workType:'note'}),{...scope,policy:{workTypes:['article']}}),/does not take note/);
 assert.throws(()=>poolSectionPolicy(profiles,'pets','no-such-section'),/Unknown section/);
 assert.throws(()=>poolSectionPolicy(profiles,'no-such-space','daily-cat'),/Unknown workspace/);
 // The identity ignores punctuation and width, like the repeat check's title comparison.
 assert.equal(poolDemand(topic('缅因猫：温柔的巨人'),scope).id,poolDemand(topic(' 缅因猫:温柔的巨人 '),scope).id);
 assert.notEqual(poolDemand(topic('缅因猫：温柔的巨人'),scope).id,poolDemand(topic('缅因猫：温柔的巨人'),{...scope,sectionId:'daily-dog'}).id);
});

const loaded={configured:true,source:'center',observedAt:'2026-11-19T02:00:00Z',items:[
 {platformId:'douyin',provider:'tikhub',observedAt:'2026-11-19T01:00:00Z',term:'榜首',rows:[{term:'猫咪换毛季',rank:2,url:'https://www.douyin.com/hot/1'},{term:'秋冬养猫',rank:1,url:'javascript:alert(1)'},{term:'  ',rank:3}]},
 {platformId:'bilibili',provider:'tikhub',observedAt:'2026-11-19T01:30:00Z',term:'猫咪换毛季',rows:[]},
 {platformId:'douyin',provider:'tikhub',observedAt:'2026-11-18T01:00:00Z',term:'旧榜',rows:[{term:'猫咪换毛季',rank:1},{term:'流浪猫过冬',rank:2}]},
 {platformId:'bad platform',observedAt:'2026-11-19T01:00:00Z',rows:[{term:'不合规的平台编号',rank:1}]},
 {platformId:'kuaishou',observedAt:'not a date',rows:[{term:'没有时间',rank:1}]}]};
test('hot-board signals become leads: newest first, by rank, once per platform, only safe links',()=>{
 const leads=signalLeads(loaded);
 assert.deepEqual(leads.map(l=>[l.platformId,l.term,l.rank]),[['bilibili','猫咪换毛季',1],['douyin','秋冬养猫',1],['douyin','猫咪换毛季',2],['douyin','流浪猫过冬',2]]);
 assert.equal(leads[2].url,'https://www.douyin.com/hot/1');assert.equal('url' in leads[1],false);
 assert.ok(leads.every(l=>l.provider==='tikhub'&&l.observedAt.endsWith('Z')));
 assert.deepEqual(signalLeads(loaded,{platformId:'douyin',query:'猫咪',limit:1}).map(l=>l.term),['猫咪换毛季']);
 // Every listed lead can be recorded on a demand as it is.
 for(const {rank,...lead} of leads)assert.deepEqual(protocol.demand({workspaceId:'pets',sectionId:'daily-cat',title:'题目',lead}).lead,lead);
});
test('unconfigured signals are an error, not an empty list',async()=>{
 assert.throws(()=>signalLeads({configured:false,reason:'当前空间未配置云端标签读取凭证',items:[]}),{code:'signals_unavailable'});
 await assert.rejects(fetchSignalLeads({},{load:async()=>({configured:false,reason:'无法读取热榜',items:[]})}),/无法读取热榜/);
 assert.equal((await fetchSignalLeads({limit:2},{load:async()=>loaded})).length,2);
 assert.throws(()=>signalLeads(loaded,{limit:0}),/between 1 and 500/);
});
