import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,secret} from '../admin/server.mjs';
import {digest} from '../admin/model.mjs';
import {createDocument,readDocument,saveDocument,claim,finish,snapshot} from '../admin/store.mjs';
import {createDraft,saveDraft} from '../scripts/editorial-workspace.mjs';
import {localFingerprint} from '../scripts/editorial-sync.mjs';
import {deleteLocalDraft,setDraftCategory} from '../scripts/editorial-management.mjs';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';

const year={id:'library-year',title:'日历原子文章',category:'学术会议',tags:['学术会议'],start:'2026-10-02',end:'2026-10-03',dateBasis:'会议日期',summary:'公开摘要',body:'可追溯正文',sourceName:'机构',sourceUrl:'https://example.org/event',provenance:'已核验官网'};
async function server(t){
  const dir=await mkdtemp(join(tmpdir(),'scholay-library-test-')),app=await createApp({dbPath:join(dir,'db.sqlite'),origin:'https://today.scholay.com'});
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  const token=scope=>{const raw=secret();app.db.prepare('INSERT INTO tokens(id,name,hash,scope,created) VALUES(?,?,?,?,?)').run(secret(),scope,digest(raw),scope,Date.now());return raw;};
  const credential=token('editorial_publish');
  const call=(path,data,raw=credential)=>app.inject({url:'/manage/api/news'+path,method:data?'POST':'GET',headers:{authorization:'Bearer '+raw},...(data?{payload:data}:{})});
  const row=createDocument(app.db,'year',year,'test',{seed:true}),id='record-'+row.id;
  const action=(kind,extra={})=>({requestKey:secret(),articleId:id,action:kind,confirmed:true,expectedVersion:1,expectedPublishedVersion:1,...extra});
  return {app,dir,call,token,row,id,action};
}
test('private catalog needs management scope, preserves public snapshots, and lists withdrawn drafts',async t=>{
  const f=await server(t);saveDocument(f.app.db,f.row.id,{...year,title:'尚未公开修订'},1,'editor');
  const publicList=await f.call('/catalog');assert.equal(publicList.json().items[0].title,'日历原子文章');
  const privateList=await f.call('/catalog?scope=all');assert.equal(privateList.json().items[0].title,'尚未公开修订');assert.equal(privateList.json().items[0].version,2);assert.equal(privateList.json().items[0].publishedVersion,1);
  assert.equal((await f.call('/catalog?scope=all',null,f.token('news_publish'))).statusCode,403);
  assert.equal((await f.call('/cloud/'+f.id,null,f.token('news_publish'))).statusCode,403);
  f.app.db.prepare('UPDATE documents SET published_revision=NULL WHERE id=?').run(f.row.id);
  assert.equal((await f.call('/catalog')).json().items.length,0);assert.equal((await f.call('/catalog?scope=all')).json().items.length,1);
  assert.equal((await f.call('/cloud/'+f.id)).json().data.title,'尚未公开修订');
});
test('cloud withdrawal is version bound, idempotent, and changes state only after a successful rebuild',async t=>{
  const f=await server(t),data=f.action('withdraw');
  assert.equal((await f.call('/actions',{...data,expectedVersion:9})).statusCode,409);
  assert.equal((await f.call('/actions',data,f.token('news_publish'))).statusCode,403);
  const accepted=await f.call('/actions',data);assert.equal(accepted.statusCode,200,accepted.body);
  assert.equal(readDocument(f.app.db,f.row.id).published_revision,1);
  assert.equal((await f.call('/actions',data)).json().job.id,accepted.json().job.id);
  const job=claim(f.app.db);assert.equal(job.snapshot.data.year.length,0);
  finish(f.app.db,job.id,{ok:true,release:'admin-'+job.id,hash:job.snapshot_hash});
  assert.equal((await f.call('/actions/'+data.requestKey)).json().status,'success');
  assert.equal((await f.call('/catalog?scope=all')).json().items[0].publishedVersion,null);
  assert.equal((await f.call('/actions',f.action('publish'))).statusCode,409);
  assert.equal((await f.call('/actions',f.action('publish',{expectedPublishedVersion:null}))).statusCode,200);
});
test('cloud deletion retains revision history, excludes deleted works, and failed jobs do not delete',async t=>{
  const f=await server(t),data=f.action('delete'),accepted=await f.call('/actions',data);assert.equal(accepted.statusCode,200);
  assert.throws(()=>saveDocument(f.app.db,f.row.id,{...year,title:'并发修改'},1,'editor'),/正在删除/);
  let job=claim(f.app.db);finish(f.app.db,job.id,{ok:false,error:'isolated build failure'});
  assert.equal((await f.call('/catalog?scope=all')).json().items.length,1);
  const retry=f.action('delete');assert.equal((await f.call('/actions',retry)).statusCode,200);
  job=claim(f.app.db);finish(f.app.db,job.id,{ok:true,release:'admin-'+job.id,hash:job.snapshot_hash});
  assert.equal((await f.call('/catalog?scope=all')).json().items.length,0);assert.equal(snapshot(f.app.db).data.year.length,0);
  assert.equal((await f.call('/cloud/'+f.id)).statusCode,404);assert.equal((await f.call('/'+f.id)).statusCode,410);
  assert.equal(f.app.db.prepare('SELECT count(*) AS n FROM revisions WHERE document_id=?').get(f.row.id).n,1);
  assert.equal((await f.call('/actions',retry)).json().deleted,true);
  assert.equal((await f.call('/actions/'+retry.requestKey,null,f.token('editorial_publish'))).statusCode,404);
});
test('unpublished cloud deletion requires no build and preserves history',async t=>{
  const f=await server(t);f.app.db.prepare('UPDATE documents SET published_revision=NULL WHERE id=?').run(f.row.id);
  const response=await f.call('/actions',f.action('delete',{expectedPublishedVersion:null}));assert.equal(response.json().status,'success');assert.equal(response.json().job,null);
  assert.equal(f.app.db.prepare('SELECT count(*) AS n FROM jobs').get().n,0);
});
async function local(t){
  const root=await mkdtemp(join(tmpdir(),'scholay-library-local-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({annexColumns:['新闻聚合'],articles:{}}));
  const draft=await createDraft({id:'library-draft',title:'本地作品',markdown:'# 本地作品\n\n测试内容'},root);
  return {root,draft};
}
test('local deletion protects concurrent edits and moves only the selected directory to a recoverable backup',async t=>{
  const f=await local(t),original=await localFingerprint(f.root,f.draft.id);
  await saveDraft({id:f.draft.id,expectedSha256:f.draft.sha256,markdown:'# Cursor 的最新修改'},f.root);
  await assert.rejects(deleteLocalDraft(f.root,{id:f.draft.id,expectedFingerprint:original,confirmed:true}),/已变化/);
  const fingerprint=await localFingerprint(f.root,f.draft.id),deleted=await deleteLocalDraft(f.root,{id:f.draft.id,expectedFingerprint:fingerprint,confirmed:true});
  assert.equal(Object.keys(JSON.parse(await readFile(join(f.root,'_ops/inventory/article-index.json'),'utf8')).articles).length,0);
  assert.equal(await readFile(join(f.root,deleted.backup,'files/正文.md'),'utf8'),'# Cursor 的最新修改');
  assert.equal(JSON.parse(await readFile(join(f.root,deleted.backup,'manifest.json'),'utf8')).state,'recycled');
});
test('category editing keeps identity and canonical path while updating the publication metadata',async t=>{
  const f=await local(t),fingerprint=await localFingerprint(f.root,f.draft.id);
  await setDraftCategory(f.root,{id:f.draft.id,category:'学术开源',expectedFingerprint:fingerprint});
  const index=JSON.parse(await readFile(join(f.root,'_ops/inventory/article-index.json'),'utf8'));
  assert.equal(index.articles[f.draft.id].canonicalPath,f.draft.canonicalPath);assert.equal(index.articles[f.draft.id].archiveCategory,'学术开源');
  const detail=await createWebsitePublisher({root:f.root}).inspect(f.draft.id);assert.equal(detail.metadata.category,'学术开源');
  assert.equal((await stat(join(f.root,f.draft.canonicalPath))).isFile(),true);
});
