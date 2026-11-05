import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {replenishTopics,similarTopic} from '../scripts/rssd-topic-maintainer.mjs';
import {CatalogSnapshotChangedError} from '../scripts/rssd-topic-public.mjs';

async function fixture(t) {
  const home=await mkdtemp(join(tmpdir(),'rssd-topics-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const rows=[];
  const client={origin:'https://center.example',identity:async()=>({orgId:'org-one',workerId:'worker-one'}),demands:async({limit,offset})=>rows.slice(offset,offset+limit),works:async()=>[],createDemand:async payload=>{const row={id:payload.id,title:payload.title,payload};rows.push(row);return row;}};
  const topic={title:'倾向得分如何处理混杂',brief:'解释可比性和平衡诊断。',sources:[{title:'Method reference',url:'https://example.org/reference'}],sourceEvidence:[{title:'Method reference',url:'https://example.org/reference',excerpt:'A source-based abstract. '.repeat(8)}]};
  const catalog={workspaceId:'metho',origin:'https://metho.scholay.com',complete:true,titles:['缺失数据如何处理'],fetchedAt:new Date().toISOString()};
  return {home,client,rows,topic,catalog,refreshCatalog:async()=>catalog,workspaceId:'metho',sectionId:'methods',generate:async()=>[topic],judge:async()=>({duplicate:false,confidence:'high'}),verifySource:async source=>({verified:true,url:source.url})};
}
test('saves a uniquely identified demand and rejects repeating an existing topic',async t=>{
  const f=await fixture(t);const result=await replenishTopics(f);
  assert.equal(result.length,1);assert.equal(f.rows.length,1);assert.match(f.rows[0].payload.brief,/https:\/\/example.org\/reference/);
  assert.match(f.rows[0].payload.brief,/正文实际引用的每一项文献都必须列入文末参考文献/);assert.match(f.rows[0].payload.brief,/移除 utm_source 等无关追踪参数/);
  await assert.rejects(replenishTopics(f),/duplicates/);assert.equal(f.rows.length,1);
});
test('lost create response is recovered with the same identity without a second POST or new generation',async t=>{
  const f=await fixture(t);let calls=0,generations=0;
  const base=f.client.createDemand;f.client.createDemand=async payload=>{calls++;await base(payload);throw Error('response lost');};
  f.generate=async()=>{generations++;return [f.topic];};
  await assert.rejects(replenishTopics(f),/response lost/);
  f.client.createDemand=async()=>{throw Error('duplicate POST');};
  // Receipt recovery must work even if the next catalog fetch or model is unavailable.
  f.catalog=null;f.refreshCatalog=null;f.generate=null;f.judge=null;f.verifySource=null;f.client.works=null;
  const recovered=await replenishTopics(f);
  assert.equal(recovered[0].status,'accepted');assert.equal(calls,1);assert.equal(generations,1);assert.equal(f.rows.length,1);
});
test('changed public or center inventory prevents creating orders',async t=>{
  const f=await fixture(t);f.refreshCatalog=async()=>({...f.catalog,titles:['New public title']});
  await assert.rejects(replenishTopics(f),/catalog changed/);assert.equal(f.rows.length,0);
  f.refreshCatalog=async()=>f.catalog;let reads=0;f.client.works=async()=>++reads===1?[]:[{id:'new',editions:[{locale:'zh-CN',revision:1,title:'New center work'}]}];
  await assert.rejects(replenishTopics(f),/inventory changed/);assert.equal(f.rows.length,0);
});
test('an exhausted catalog snapshot retry cannot create or stage a demand',async t=>{
 const f=await fixture(t);let generated=0;f.generate=async()=>{generated++;return [f.topic];};
 f.refreshCatalog=async()=>{throw new CatalogSnapshotChangedError();};
 await assert.rejects(replenishTopics(f),CatalogSnapshotChangedError);
 assert.equal(generated,1);assert.equal(f.rows.length,0);
 await assert.rejects(readFile(join(f.home,'topic-maintainer.json')),{code:'ENOENT'});
});
test('the final quota gate runs before any intent is persisted or sent',async t=>{
 const f=await fixture(t);let stages=0;
 f.beforeStage=async({entries})=>{stages++;assert.equal(entries.length,0);throw Error('daily quota reached');};
 await assert.rejects(replenishTopics(f),/daily quota reached/);
 assert.equal(stages,1);assert.equal(f.rows.length,0);
 await assert.rejects(readFile(join(f.home,'topic-maintainer.json')),{code:'ENOENT'});
});
test('a saved pending payload mismatch stops before a retry',async t=>{
  const f=await fixture(t);f.client.createDemand=async()=>{throw Error('offline');};
  await assert.rejects(replenishTopics(f),/offline/);
  const path=join(f.home,'topic-maintainer.json'),state=JSON.parse(await readFile(path,'utf8'));state.entries[0].demand.brief='changed';await writeFile(path,JSON.stringify(state));
  await assert.rejects(replenishTopics(f),/payload changed/);
});
test('pending requests are not replayed against a different center identity',async t=>{
  const f=await fixture(t);f.client.createDemand=async()=>{throw Error('offline');};await assert.rejects(replenishTopics(f),/offline/);
  f.client.identity=async()=>({orgId:'other-org',workerId:'worker-one'});
  await assert.rejects(replenishTopics(f),/center identity mismatch/);assert.equal(f.rows.length,0);
});
test('rejection, uncertain novelty and unavailable sources never create orders',async t=>{
  const f=await fixture(t);f.judge=async()=>({duplicate:false,confidence:'low'});
  await assert.rejects(replenishTopics(f),/novelty/);assert.equal(f.rows.length,0);
  f.judge=async()=>({duplicate:false,confidence:'high'});f.verifySource=async()=>({verified:false});
  await assert.rejects(replenishTopics(f),/source/);assert.equal(f.rows.length,0);
  f.verifySource=async source=>({verified:true,url:source.url});f.generate=async()=>{throw Error('model unavailable');};
  await assert.rejects(replenishTopics(f),/model unavailable/);assert.equal(f.rows.length,0);
});
test('rejects stale/incomplete catalogs and catches punctuation or near-duplicate titles',async t=>{
  const f=await fixture(t);f.catalog.complete=false;await assert.rejects(replenishTopics(f),/catalog/);
  assert.equal(similarTopic('失访偏差：怎样影响结果？','失访偏差 怎样影响结果'),true);
  assert.equal(similarTopic('缺失数据的多重插补','随机化与因果推断'),false);
});
