import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReviewedPublicationBatch} from '../scripts/reviewed-publication-batch.mjs';
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'reviewed-batch-'));t.after(()=>rm(directory,{recursive:true,force:true}));return new ReviewedPublicationBatch({directory});}
const spec={batchId:'review-20261104',siteId:'metho',articleId:'article-one',content:{title:'已校对',markdown:'正文'}};
test('a lost submit response recovers the original receipt without another POST',async t=>{
  const batch=await fixture(t);let receipt=null,posts=0;
  const adapter={lookup:async()=>receipt,submit:async key=>{posts++;receipt={requestKey:key,articleId:spec.articleId,job:{status:'queued'}};throw Error('Response lost');}};
  assert.equal((await batch.deliver(spec,adapter)).state,'unknown');
  const resumed=await batch.deliver(spec,adapter);assert.equal(resumed.state,'submitted');assert.equal(posts,1);assert.equal(resumed.receipt.requestKey,(await batch.prepare(spec)).requestKey);
});
test('a failed receipt query does not authorize a submission',async t=>{
  const batch=await fixture(t);let posts=0;
  const result=await batch.deliver(spec,{lookup:async()=>{throw Error('Timeout');},submit:async()=>{posts++;}});
  assert.equal(result.state,'unknown');assert.equal(posts,0);assert.equal(result.error.phase,'lookup');
});
test('an empty malformed lookup response is uncertainty rather than an absence acknowledgement',async t=>{
  const batch=await fixture(t);let posts=0;
  const result=await batch.deliver(spec,{lookup:async()=>undefined,submit:async()=>posts++});
  assert.equal(result.state,'unknown');assert.equal(posts,0);
});
test('frozen identity rejects changed content before another network operation',async t=>{
  const batch=await fixture(t);await batch.prepare(spec);let calls=0;
  await assert.rejects(batch.deliver({...spec,content:{...spec.content,markdown:'并发修改'}},{lookup:async()=>calls++,submit:async()=>calls++}),{code:'batch_conflict'});assert.equal(calls,0);
});
test('a definitive missing request uses the durable original key; only verified public readback marks published',async t=>{
  const batch=await fixture(t),prepared=await batch.prepare(spec);
  const result=await batch.deliver(spec,{lookup:async()=>{throw Object.assign(Error('Not found'),{statusCode:404});},submit:async key=>{const persisted=JSON.parse(await readFile(batch.path(spec),'utf8'));assert.equal(persisted.state,'submit_intent');assert.equal(persisted.requestKey,key);return {requestKey:key,job:{status:'success'}};}});
  assert.equal(result.state,'submitted');assert.equal(result.requestKey,prepared.requestKey);
  await assert.rejects(batch.recordReadback(spec,{url:'https://example.org/news/article-one/',contentHash:'wrong'}),/must match/);
  assert.equal((await batch.recordReadback(spec,{url:'https://example.org/news/article-one/',contentHash:prepared.contentHash})).state,'published');
});
test('a receipt from a different request remains for attention, never published',async t=>{
  const batch=await fixture(t);const result=await batch.deliver(spec,{lookup:async()=>({requestKey:'another-request',job:{status:'success'}}),submit:async()=>{throw Error('Must not submit');}});
  assert.equal(result.state,'needs_attention');assert.equal(result.error.code,'receipt_mismatch');await assert.rejects(batch.recordReadback(spec,{url:'https://example.org/',contentHash:result.contentHash}),/acknowledged/);
});
