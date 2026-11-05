import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gunzipSync} from 'node:zlib';
import {openStore,createDocument,enqueueSiteBuild,audit} from '../admin/store.mjs';
import {applyExactNotes,preparePlan,applyPlan,digest} from '../scripts/migrate-internal-editorial-notes.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'note-migration-'));const db=openStore(join(root,'test.sqlite'));
 t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
 const data={id:'article-test',title:'试用步骤',markdown:'# 试用步骤\n\n可以先试用（这是建议，本文未执行）：运行示例。\n\n来源与许可不变。\n',summary:'正文摘要'};
 const row=createDocument(db,'news',data,'token:original-author',{seed:true});
 const before={...db.prepare('SELECT * FROM documents WHERE id=?').get(row.id)};
 const revision=db.prepare('SELECT payload FROM revisions WHERE document_id=? AND version=1').get(row.id);
 const edits=[{field:'markdown',before:'（这是建议，本文未执行）',after:'',note:'原文：（这是建议，本文未执行）',category:'verification',anchor:'可以先试用：运行示例。'}];
 const input={version:1,siteId:'test',documents:[{document:before,revision:1,payloadSha256:digest(revision.payload),edits}]};
 return {db,root,input,before,original:revision.payload,plan:preparePlan(db,input,{markdownOf:(_,p)=>p.markdown})};
}
test('exact migration keeps old revisions, publication state and private author ACL; queues one rebuild',async t=>{
 const f=await fixture(t);const result=await applyPlan(f.db,f.plan,{backup:join(f.root,'backup.sqlite'),enqueueSiteBuild,audit});
 assert.ok((await readFile(join(f.root,'backup.sqlite'))).length>0);
 const row=f.db.prepare('SELECT * FROM documents WHERE id=?').get(f.before.id);
 assert.equal(row.latest_revision,2);assert.equal(row.published_revision,2);assert.equal(row.approved_revision,2);assert.equal(row.permalink,f.before.permalink);
 assert.equal(f.db.prepare('SELECT payload FROM revisions WHERE document_id=? AND version=1').get(row.id).payload,f.original);
 const current=JSON.parse(f.db.prepare('SELECT payload FROM revisions WHERE document_id=? AND version=2').get(row.id).payload);
 assert.match(current.markdown,/可以先试用：运行示例/);assert.match(current.markdown,/来源与许可不变/);assert.doesNotMatch(current.markdown,/未执行/);
 const archive=f.db.prepare('SELECT * FROM source_archives').get();assert.equal(archive.actor,'token:original-author');
 const bundle=JSON.parse(gunzipSync(archive.payload)),notes=JSON.parse(Buffer.from(bundle.files[0].data,'base64'));
 assert.equal(notes.bodySha,digest(current.markdown));assert.match(notes.blockNotes['migration-0'].notes.verification,/未执行/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM site_jobs').get().n,1);assert.ok(result.job.id);
 assert.throws(()=>preparePlan(f.db,f.input,{markdownOf:(_,p)=>p.markdown}),/Concurrent/);
});
test('concurrent edits and active publication queues abort the whole migration',async t=>{
 const f=await fixture(t);enqueueSiteBuild(f.db,'test');
 await assert.rejects(applyPlan(f.db,f.plan,{backup:join(f.root,'backup.sqlite'),enqueueSiteBuild,audit}),/queue is active/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM source_archives').get().n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM revisions').get().n,1);
 f.db.prepare('UPDATE documents SET updated=updated+1 WHERE id=?').run(f.before.id);
 assert.throws(()=>preparePlan(f.db,f.input,{markdownOf:(_,p)=>p.markdown}),/Concurrent/);
});
test('only unique explicitly approved spans move, and their original wording is retained',()=>{
 const edit={field:'markdown',before:'未实测',after:'',note:'原文：未实测',category:'verification'};
 assert.throws(()=>applyExactNotes({markdown:'未实测；未实测'},[edit]),/ambiguous/);
 assert.throws(()=>applyExactNotes({markdown:'正文'},[edit]),/missing/);
 assert.throws(()=>applyExactNotes({markdown:'未实测'},[{...edit,note:'删掉了'}]),/preserved/);
 assert.throws(()=>applyExactNotes({markdown:'未实测'},[{...edit,field:'title'}]),/Invalid/);
 const result=applyExactNotes({markdown:'未实测。小样本不保证覆盖率。'},[edit]);
 assert.equal(result.after.markdown,'。小样本不保证覆盖率。');
});
