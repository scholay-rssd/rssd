import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CenterOutbox,CenterError,createCenterClient,centerOrigin} from '../scripts/rssd-center-client.mjs';
import protocol from '../contracts/rssd-v1.cjs';
const packet={requestId:'offline-one',workId:'work-one',workspaceId:'research',sectionId:'methods',editions:[{locale:'en',title:'English',bodyMarkdown:'Full text'}]};
const accepted={requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,status:'accepted',publicationIds:['publication-one'],editions:[{locale:'en',revision:1,hash:protocol.hash(protocol.submission(packet).editions[0])}]};
async function fixture(t,client){const directory=await mkdtemp(join(tmpdir(),'rssd-outbox-'));t.after(()=>rm(directory,{recursive:true,force:true}));return new CenterOutbox({directory,client:{origin:'https://center.example',...client}});}
test('offline work is durable and never reported as published',async t=>{
  const box=await fixture(t,{submission:async()=>{throw new CenterError('Offline');}});
  await box.enqueue(packet);const result=await box.flushOne(packet.requestId);
  assert.equal(result.state,'pending');assert.equal(result.attempts,1);assert.equal(result.receipt,undefined);
  const recovered=new CenterOutbox({directory:box.directory,client:box.client});assert.deepEqual((await recovered.list())[0].packet.editions[0].bodyMarkdown,'Full text');
});
test('a lost response is recovered by the original request without a second POST',async t=>{
  let stored=false,posts=0;
  const box=await fixture(t,{submission:async()=>{if(stored)return accepted;throw new CenterError('Missing',{status:404});},submit:async()=>{posts++;stored=true;throw new CenterError('Response lost');}});
  await box.enqueue(packet);assert.equal((await box.flushOne(packet.requestId)).state,'pending');
  const recovered=await box.flushOne(packet.requestId);assert.equal(recovered.state,'accepted');assert.equal(posts,1);assert.deepEqual(recovered.receipt,accepted);
  assert(!JSON.stringify(recovered).includes('published'));
});
test('conflicts retain the full packet for explicit recovery and cannot be replaced',async t=>{
  const box=await fixture(t,{submission:async()=>{throw new CenterError('Missing',{status:404});},submit:async()=>{throw new CenterError('Changed',{status:409,code:'revision_conflict'});}});
  await box.enqueue(packet);assert.equal((await box.flushOne(packet.requestId)).state,'needs_attention');
  await assert.rejects(box.enqueue({...packet,editions:[{...packet.editions[0],bodyMarkdown:'Overwrite'}]}),{code:'request_conflict'});
  assert.equal((await box.list())[0].packet.editions[0].bodyMarkdown,'Full text');
});
test('credentials cannot follow redirects or be placed in queued packets',async t=>{
  assert.throws(()=>centerOrigin('http://remote.example'),/HTTPS/);assert.throws(()=>centerOrigin('https://token@example.org'),/credentials/);
  let options;const token='rssd_device_'+'a'.repeat(48);
  const client=createCenterClient({origin:'https://center.example',token,fetcher:async(url,opts)=>{options=opts;return new Response(JSON.stringify({protocolVersion:1}));}});
  await client.identity();assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+token);
  const box=await fixture(t,client);await box.enqueue({...packet,token});assert(!(await readFile(box.path(packet.requestId),'utf8')).includes(token));
});
test('no active claim is a valid null result, not a transport failure',async()=>{
  const client=createCenterClient({origin:'https://center.example',token:'rssd_device_'+'a'.repeat(48),fetcher:async()=>new Response('null')});
  assert.equal(await client.activeClaim(),null);
});
test('an unrelated edition receipt cannot mark local work as accepted',async t=>{
  const box=await fixture(t,{submission:async()=>({...accepted,editions:[{locale:'en',revision:1,hash:'incorrect'}]})});
  await box.enqueue(packet);const result=await box.flushOne(packet.requestId);assert.equal(result.state,'needs_attention');assert.equal(result.error.code,'receipt_mismatch');
});
