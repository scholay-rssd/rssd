import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReceiverStore} from '../receiver/store.mjs';
import p from '../contracts/rssd-v1.cjs';
import {publication} from '../contracts/rssd-publication.cjs';
import {contentKey} from '../contracts/rssd-publication.cjs';
import {DatabaseSync} from 'node:sqlite';
import {snapshotForPackets} from '../receiver/build.mjs';
const site={id:'demo',spaceId:'research',sections:[{id:'methods'}]};
const packet={version:1,requestId:'request-1',siteId:'demo',workspaceId:'research',sectionId:'methods',workId:'work-1',locale:'en',revision:1,
  contentHash:'a'.repeat(64),route:'/en/news/example/',content:{locale:'en',title:'An original',bodyMarkdown:'Full body',metadata:{author:'Example',privateNotes:'Must never ship'}}};
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'rssd-receiver-')),file=join(dir,'receiver.sqlite');let store=new ReceiverStore(file,site);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {get store(){return store;},restart(){store.close();store=new ReceiverStore(file,site);}};}
const receipt=job=>({requestId:job.id,contentHash:job.packet.contentHash,packetHash:p.hash(job.packet),revision:job.packet.revision,operation:job.packet.operation||'publish',operationSequence:job.operationSequence,release:'release-1',url:'https://example.test'+job.packet.route});
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

const action=(value,name,sequence,revision=value.revision)=>({...value,requestId:name+'-'+sequence,operation:name,revision,expectedRevision:value.revision,operationSequence:sequence,expectedOperationSequence:sequence-1});
test('withdraw and restore sequence survives restart without rewriting the content revision',async t=>{
 const f=await fixture(t);f.store.accept(packet);let job=f.store.claim();f.store.finish(job.id,receipt(job));
 const withdraw=action(packet,'withdraw',2);f.store.accept(withdraw);job=f.store.claim();
 assert.equal(job.operationSequence,2);assert.equal(job.packet.content,undefined);assert.equal(job.previousPackets[0].content.title,'An original');
 f.store.fail(job.id,'Build interrupted');assert.equal(f.store.status().publications,1);
 f.store.retry(job.id);job=f.store.claim();f.store.finish(job.id,receipt(job));
 assert.equal(f.store.status().publications,0);assert.equal(f.store.status().tombstones,1);f.restart();
 assert.equal(f.store.head(packet.workId,packet.locale).operationSequence,2);
 assert.throws(()=>f.store.accept({...packet,requestId:'accidental-revival',revision:2}),{code:'edition_hidden'});
 assert.equal(f.store.accept(packet).state,'success');assert.equal(f.store.claim(),null);
 const restore=action(packet,'restore',3);
 assert.throws(()=>f.store.accept({...restore,content:{...restore.content,bodyMarkdown:'Different same-revision body'}}),{code:'content_conflict'});
 assert.throws(()=>f.store.accept({...restore,expectedOperationSequence:1}),{code:'action_conflict'});
 f.store.accept(restore);job=f.store.claim();f.store.finish(job.id,receipt(job));
 assert.equal(f.store.head(packet.workId,packet.locale).revision,1);assert.equal(f.store.status().publications,1);
 assert.throws(()=>f.store.accept({...withdraw,requestId:'late-hide'}),{code:'action_conflict'});
});

test('delete tombstone blocks normal newer uploads and explicit restore can advance content',async t=>{
 const f=await fixture(t);f.store.accept(packet);let job=f.store.claim();f.store.finish(job.id,receipt(job));
 const deletion=action(packet,'delete',2);f.store.accept(deletion);job=f.store.claim();f.store.finish(job.id,receipt(job));
 assert.throws(()=>f.store.accept({...packet,requestId:'newer-but-not-restore',revision:9}),{code:'edition_hidden'});
 const restore={...action(packet,'restore',3,2),contentHash:'b'.repeat(64),content:{...packet.content,title:'New explicit revision'}};
 f.store.accept(restore);job=f.store.claim();f.store.finish(job.id,receipt(job));
 assert.equal(f.store.head(packet.workId,packet.locale).revision,2);assert.equal(f.store.head(packet.workId,packet.locale).operationSequence,3);
 assert.throws(()=>f.store.accept({...deletion,requestId:'old-delete-retry'}),{code:'action_conflict'});
 assert.throws(()=>f.store.accept({...action({...packet,revision:2,contentHash:'b'.repeat(64)},'withdraw',4),siteId:'other'}),{status:403});
});

test('legacy deleted identities with no public revision remain fenced until explicit restore',async t=>{
 const f=await fixture(t);f.store.seedLegacyHeads({rssdIdentity:{[contentKey(packet)]:{documentId:'deleted-original',route:packet.route,revision:0,deleted:true}}});
 assert.equal(f.store.head(packet.workId,packet.locale).operation,'delete');
 assert.throws(()=>f.store.accept(packet),{code:'edition_hidden'});
 f.store.accept({...action(packet,'restore',1),expectedRevision:0});const job=f.store.claim();f.store.finish(job.id,receipt(job));
 assert.equal(f.store.status().publications,1);
});

test('a legacy revision-zero identity supports another explicit delete without losing its fence',async t=>{
 const f=await fixture(t);f.store.seedLegacyHeads({rssdIdentity:{[contentKey(packet)]:{documentId:'unpublished-original',route:packet.route,revision:0,deleted:true}}});
 f.store.accept({...action(packet,'delete',1,0),expectedRevision:0});const job=f.store.claim();f.store.finish(job.id,receipt(job));
 assert.equal(f.store.status().tombstones,1);assert.equal(f.store.head(packet.workId,packet.locale).revision,0);
 assert.throws(()=>f.store.accept({...packet,requestId:'newer-upload'}),{code:'edition_hidden'});
});

test('upgrading pre-action SQLite retains old packet hashes and advances actions safely',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-old-receiver-')),file=join(dir,'old.sqlite'),db=new DatabaseSync(file),normalized=publication(packet),hash=p.hash(normalized);
 db.exec(`CREATE TABLE requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,work_key TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',error TEXT,receipt TEXT,created INTEGER NOT NULL);
 CREATE TABLE heads(work_key TEXT PRIMARY KEY,revision INTEGER NOT NULL,route TEXT UNIQUE NOT NULL,request_id TEXT NOT NULL);
 CREATE TABLE published(work_key TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);`);
 db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?,?)').run(packet.requestId,hash,contentKey(packet),1,JSON.stringify(normalized),'success',null,JSON.stringify({release:'old-release'}),1);
 db.prepare('INSERT INTO heads VALUES(?,?,?,?)').run(contentKey(packet),1,packet.route,packet.requestId);
 db.prepare('INSERT INTO published VALUES(?,?,?)').run(contentKey(packet),1,JSON.stringify(normalized));db.close();
 const store=new ReceiverStore(file,site);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 assert.equal(store.accept(packet).packetHash,hash);assert.equal(store.head(packet.workId,packet.locale).operationSequence,1);
 store.accept(action(packet,'withdraw',2));const job=store.claim();store.finish(job.id,receipt(job));assert.equal(store.status().tombstones,1);
});

test('same-millisecond queued actions follow their sequence even when request IDs sort backwards',async t=>{
 const f=await fixture(t);f.store.accept(packet);let job=f.store.claim();f.store.finish(job.id,receipt(job));
 f.store.accept({...action(packet,'withdraw',2),requestId:'z-first-withdraw'});
 f.store.accept({...action(packet,'restore',3),requestId:'a-later-restore'});
 f.store.db.prepare('UPDATE requests SET created=1').run();
 job=f.store.claim();assert.equal(job.id,'z-first-withdraw');f.store.finish(job.id,receipt(job));
 job=f.store.claim();assert.equal(job.id,'a-later-restore');f.store.finish(job.id,receipt(job));
 assert.equal(f.store.status().publications,1);assert.equal(f.store.head(packet.workId,packet.locale).operation,'restore');
});

test('a received request with a legacy-looking name cannot be reset by baseline seeding',async t=>{
 const f=await fixture(t),baseline={rssdIdentity:{[contentKey(packet)]:{documentId:'original',route:packet.route,revision:0}}};
 f.store.seedLegacyHeads(baseline);f.store.accept({...packet,requestId:'legacy:client-request'});
 f.store.seedLegacyHeads(baseline);assert.equal(f.store.head(packet.workId,packet.locale).revision,1);
});

test('action snapshots mask migrated articles and structured records without removing other languages',()=>{
 const chinese={...packet,workId:'legacy-work',locale:'zh-CN',route:'/news/original/'},english={...packet,workId:'legacy-work'},calendar={...chinese,workId:'legacy-calendar',route:'/calendar/original/'};
 const baseline={news:[{id:'original-zh',markdown:'Old Chinese'},{id:'original-en',markdown:'Keep English'}],data:{year:[{id:'calendar-original',title:'Old calendar'}],history:[]},openSource:{items:[]},permalinks:{'news:original-zh':chinese.route,'news:original-en':english.route,'year:calendar-original':calendar.route},editorialRecords:[{documentId:'calendar-document',kind:'year'}],rssdIdentity:{
  [contentKey(chinese)]:{id:'original-zh',kind:'news',documentId:'zh-doc',key:'news:original-zh'},
  [contentKey(english)]:{id:'original-en',kind:'news',documentId:'en-doc',key:'news:original-en'},
  [contentKey(calendar)]:{id:'calendar-original',kind:'year',documentId:'calendar-document',key:'year:calendar-original'}
 }};
 const removed=[publication({...action(chinese,'withdraw',1),expectedOperationSequence:0}),publication({...action(calendar,'delete',1),expectedOperationSequence:0})];
 const snapshot=snapshotForPackets(removed,{sections:[{id:'methods',name:'Methods'}]},baseline);
 assert.deepEqual(snapshot.news.map(x=>x.id),['original-en']);assert.equal(snapshot.data.year.length,0);assert.equal(snapshot.editorialRecords.length,0);
 assert.deepEqual(snapshot.permalinks,{'news:original-en':english.route});assert.equal(baseline.news.length,2);
});
