import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import m from '../contracts/rssd-media.cjs';
import p from '../contracts/rssd-v1.cjs';
import {prepareEditionMedia,stageMedia} from '../scripts/rssd-device-media.mjs';
import {CenterOutbox} from '../scripts/rssd-center-client.mjs';
import {ReceiverMedia} from '../receiver/media.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYZkAAAAASUVORK5CYII=','base64');
const missing=()=>Object.assign(Error('not found'),{status:404});
async function temp(t){const home=await mkdtemp(join(tmpdir(),'rssd-media-'));t.after(()=>rm(home,{recursive:true,force:true}));return home;}
test('device media survives a lost upload reply and is delivered once before the original submission',async t=>{
 const home=await temp(t),origin='https://center.example',stored=new Map();let downloads=0,uploads=0,submits=0;
 const client={origin,submission:async()=>{throw missing();},request:async(path,options)=>{
  if(options?.method==='POST'){uploads++;const body=options.body,manifest=m.decodeImage(body).manifest,id=m.mediaId(body.workspaceId,manifest.sha256);stored.set(id,{id,workspaceId:body.workspaceId,manifest});throw Error('response lost');}
  const value=stored.get(path.split('/').at(-1));if(!value)throw missing();return value;
 },submit:async packet=>{submits++;return {requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,status:'accepted',editions:packet.editions.map(e=>({locale:e.locale,revision:1,hash:p.hash(e)}))};}};
 const input={locale:'en',title:'Complete image',bodyMarkdown:'An image.\n\n![Evidence](https://images.example/figure.png)'};
 const options={edition:input,home,directory:join(home,'job'),client,workspaceId:'research',fetchBytes:async()=>{downloads++;return png;}};
 const edition=await prepareEditionMedia(options);await prepareEditionMedia(options);assert.equal(downloads,1);assert.match(edition.bodyMarkdown,/\/api\/rssd\/v1\/media\//);
 const outbox=new CenterOutbox({directory:join(home,'outbox'),client}),packet={requestId:'request-image',workId:'work-image',workspaceId:'research',sectionId:'methods',editions:[edition]};await outbox.enqueue(packet);
 assert.equal((await outbox.flushOne(packet.requestId)).state,'pending');assert.equal(submits,0);
 assert.equal((await outbox.flushOne(packet.requestId)).state,'accepted');assert.equal(uploads,1);assert.equal(submits,1);
});
test('media scope and byte integrity are enforced before a work can leave the outbox',async t=>{
 const home=await temp(t),origin='https://center.example',asset=await stageMedia({directory:join(home,'media'),origin,workspaceId:'research',bytes:png});
 const client={origin,submission:async()=>{throw missing();},request:async()=>({id:asset.id,workspaceId:'another-space',manifest:asset.manifest}),submit:async()=>{throw Error('must not submit');}};
 const outbox=new CenterOutbox({directory:join(home,'outbox'),client});await outbox.enqueue({requestId:'scope-image',workId:'scope',workspaceId:'research',sectionId:'methods',editions:[{locale:'en',title:'Private image',bodyMarkdown:'Body',media:[{id:asset.id}]}]});
 const result=await outbox.flushOne('scope-image');assert.equal(result.state,'needs_attention');assert.equal(result.error.code,'media_conflict');
 assert.throws(()=>m.decodeImage({...asset.manifest,data:Buffer.from('not an image').toString('base64')}));
});
test('receiver images are scoped to a private site store, content-addressed and idempotent',async t=>{
 const home=await temp(t),store=new ReceiverMedia(home),manifest=m.imageManifest(png);
 await assert.rejects(store.status(manifest.sha256),{status:404});assert.deepEqual(await store.accept(manifest.sha256,{...manifest,data:png.toString('base64')}),manifest);
 assert.deepEqual(await store.accept(manifest.sha256,{...manifest,data:png.toString('base64')}),manifest);assert.deepEqual(await store.bytes(manifest),png);
 await assert.rejects(store.accept('a'.repeat(64),{...manifest,data:png.toString('base64')}),{status:409});await assert.rejects(store.status('../not-a-hash'));
 assert.deepEqual(await readFile(join(home,manifest.path.split('/').at(-1))),png);
});
