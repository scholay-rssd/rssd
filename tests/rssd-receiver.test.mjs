import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReceiverStore} from '../receiver/store.mjs';
import p from '../contracts/rssd-v1.cjs';
import {publication} from '../contracts/rssd-publication.cjs';
import {contentKey} from '../contracts/rssd-publication.cjs';
const site={id:'demo',spaceId:'research',sections:[{id:'methods'}]};
const packet={version:1,requestId:'request-1',siteId:'demo',workspaceId:'research',sectionId:'methods',workId:'work-1',locale:'en',revision:1,
  contentHash:'a'.repeat(64),route:'/en/news/example/',content:{locale:'en',title:'An original',bodyMarkdown:'Full body',metadata:{author:'Example',privateNotes:'Must never ship'}}};
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'rssd-receiver-')),file=join(dir,'receiver.sqlite');let store=new ReceiverStore(file,site);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {get store(){return store;},restart(){store.close();store=new ReceiverStore(file,site);}};}
const receipt=job=>({requestId:job.id,contentHash:job.packet.contentHash,packetHash:p.hash(job.packet),revision:job.packet.revision,release:'release-1',url:'https://example.test'+job.packet.route});
test('receipt survives restart, distinguishes queued from success and rejects changed request replay',async t=>{
  const f=await fixture(t);assert.equal(f.store.accept(packet).state,'queued');assert.equal(f.store.accept(packet).state,'queued');
  assert.throws(()=>f.store.accept({...packet,content:{...packet.content,title:'changed'}}),{code:'request_conflict'});
  f.restart();const job=f.store.claim();assert.equal(job.resume,false);f.restart();assert.equal(f.store.claim().resume,true);
  assert.equal(f.store.finish(job.id,receipt(job)).state,'success');assert.equal(f.store.accept(packet).state,'success');
});
test('old revisions and changed routes cannot replace newer published content',async t=>{
  const f=await fixture(t);f.store.accept(packet);const j=f.store.claim();f.store.finish(j.id,receipt(j));
  f.store.accept({...packet,requestId:'request-2',revision:2});
  assert.throws(()=>f.store.accept({...packet,requestId:'old'}),{code:'stale_revision'});
  assert.throws(()=>f.store.accept({...packet,requestId:'moved',revision:3,route:'/news/moved/'}),{code:'route_conflict'});
  const j2=f.store.claim();f.store.fail(j2.id,'Build failed');assert.equal(f.store.db.prepare('SELECT revision FROM published').get().revision,1);
  assert.equal(f.store.retry(j2.id).state,'queued');
});
test('site isolation, public metadata allowlist and route ownership are enforced',async t=>{
  const f=await fixture(t);assert.throws(()=>f.store.accept({...packet,siteId:'other'}),{status:403});
  assert.deepEqual(publication(packet).content.metadata,{author:'Example'});f.store.accept(packet);
  assert.throws(()=>f.store.accept({...packet,workId:'another',requestId:'another'}),{code:'route_conflict'});
  assert.throws(()=>f.store.accept({...packet,route:'/../secret/'}));
  assert.throws(()=>f.store.accept({...packet,route:'/downloads/private/'}));
});
test('a failed destination revision cannot be retried after a newer revision arrives',async t=>{
  const f=await fixture(t);f.store.accept(packet);f.store.fail(f.store.claim().id,'Bad image');
  f.store.accept({...packet,requestId:'newer',revision:2});assert.throws(()=>f.store.retry(packet.requestId),{code:'stale_revision'});
});

test('final legacy deltas advance reserved revisions only before the center starts writing',async t=>{
 const f=await fixture(t),key=contentKey(packet),baseline=revision=>({rssdIdentity:{[key]:{documentId:'original',revision,route:packet.route}}});
 f.store.seedLegacyHeads(baseline(1));f.store.seedLegacyHeads(baseline(2));
 assert.throws(()=>f.store.seedLegacyHeads(baseline(1)),{code:'stale_revision'});
 assert.throws(()=>f.store.accept({...packet,revision:2}),{code:'stale_revision'});
 f.store.accept({...packet,revision:3});f.store.seedLegacyHeads(baseline(2));
 assert.throws(()=>f.store.seedLegacyHeads(baseline(4)),{code:'baseline_locked'});
 assert.equal(f.store.status().requests[0].count,1);
});
