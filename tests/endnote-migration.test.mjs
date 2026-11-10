import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../admin/store.mjs';
import {planStore,applyStorePlan} from '../scripts/migrate-article-endnotes.mjs';
const body='已发布正文\n\n## 参考文献\n\n1. 文献\n\n### 品牌与发布说明\n\n1. 品牌\n';
test('cleanup preserves separate draft and public revisions, review state, history and frozen routes',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'endnote-migration-'));const db=openStore(join(dir,'db.sqlite'));t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
 db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)').run('doc','news','news:x','/news/frozen/',2,null,1,'draft',123);
 for(const [v,markdown] of [[1,body],[2,body.replace('已发布正文','未发布草稿')]])db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?)').run('doc',v,JSON.stringify({id:'x',markdown}),'author','original',123);
 const site={id:'fixture'},plan=planStore(db,site);assert.equal(plan.documents.length,1);
 const result=await applyStorePlan(db,plan,{backup:join(dir,'backup.sqlite')});assert.ok(result.job.id);
 const d=db.prepare('SELECT * FROM documents').get();assert.equal(d.review_state,'draft');assert.equal(d.approved_revision,null);assert.equal(d.permalink,'/news/frozen/');assert.equal(d.published_revision,3);assert.equal(d.latest_revision,4);
 const read=v=>JSON.parse(db.prepare('SELECT payload FROM revisions WHERE version=?').get(v).payload).markdown;
 assert.equal(read(1),body);assert.match(read(3),/^已发布正文/);assert.match(read(4),/^未发布草稿/);assert.match(read(3),/2\. 品牌/);assert.equal(planStore(db,site).documents.length,0);
});
test('an intervening edit aborts without adding a revision',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'endnote-conflict-'));const db=openStore(join(dir,'db.sqlite'));t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
 db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)').run('doc','news','news:x','/news/x/',1,1,1,'approved',123);
 db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?)').run('doc',1,JSON.stringify({markdown:body}),'author','original',123);
 const plan=planStore(db,{id:'fixture'});db.prepare('UPDATE documents SET updated=456').run();
 await assert.rejects(applyStorePlan(db,plan,{backup:join(dir,'backup.sqlite')}),/Concurrent/);assert.equal(db.prepare('SELECT count(*) AS n FROM revisions').get().n,1);
});
