import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir,symlink,readlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createApp,secret} from '../admin/server.mjs';
import {seedStore,readDocument,snapshot,saveDocument,setReview,enqueueBatch,enqueue,claim,finish} from '../admin/store.mjs';
import {applyCleanup,archiveState} from '../admin/archive-cleanup.mjs';
import {digest,validate} from '../admin/model.mjs';
import {buildRelease,activateRelease,recoverRelease} from '../admin/worker.mjs';
import {localizeMessage} from '../admin/messages.mjs';

const origin='https://today.scholay.com',password='a-unique-test-passphrase-2026!';
const year={id:'example:year',title:'公开基线记录',category:'学术会议',tags:['学术会议'],start:'2026-12-30',end:'2027-01-02',dateBasis:'官网会议日期',summary:'公开摘要',body:'原有正文',bodyTruncated:false,sourceName:'主办方',sourceUrl:'https://example.org/event',provenance:'已核验官网',reviewedAt:null};
const history={id:'example:history',dateKey:'02-29',year:2000,title:'历史记录',domain:'计算史',eventType:'论文发表',importance:'A',factSummary:'历史事实',historicalSignificance:'研究意义',sources:[{label:'论文',url:'https://example.org/paper'}],preciseToDay:true};
const source={title:'开放工具',date:'2026-09-30',category:'文献与写作',summary:'工具简介',value:'适合文献管理',url:'https://example.org/project',relatedUrl:'',status:'公开收录'};
test('batch publishing pins every revision, blocks competing jobs, and publishes all or none',async t=>{
  const f=await fixture(t),db=f.app.db,ids=db.prepare("SELECT id FROM documents WHERE kind!='openSource'").all().map(x=>x.id);
  const members=ids.map(id=>{const before=readDocument(db,id),saved=saveDocument(db,id,{...before.data,title:'已审核批次 '+id},before.latest_revision,'test');setReview(db,id,saved.latest_revision,'approved','test');return {id,version:saved.latest_revision};});
  const before=JSON.stringify(snapshot(db).data.year);
  let queued=enqueueBatch(db,members,'test');
  assert.throws(()=>enqueue(db,ids[1],members[1].version,'publish',Date.now(),'test'),/已有待执行/);
  let job=claim(db);assert(job.snapshot.data.year[0].title.startsWith('已审核批次'));
  assert(job.snapshot.data.history[0].title.startsWith('已审核批次'));
  finish(db,queued.id,{ok:false,error:'failed build'});
  assert.equal(JSON.stringify(snapshot(db).data.year),before);
  queued=enqueueBatch(db,members,'test');
  const later=readDocument(db,ids[1]);saveDocument(db,later.id,{...later.data,title:'之后的私有草稿'},later.latest_revision,'test');
  job=claim(db);assert(!JSON.stringify(job.snapshot).includes('之后的私有草稿'));
  finish(db,queued.id,{ok:true,hash:job.snapshot_hash,release:'admin-'+queued.id});
  for(const m of members)assert.equal(readDocument(db,m.id).published_revision,m.version);
  assert.equal(readDocument(db,ids[1]).data.title,'之后的私有草稿');
});
test('archive cleanup refuses drift, keeps date semantics and source identity, and does not publish before activation',async t=>{
  const f=await fixture(t),db=f.app.db;
  const input={...year,provenance:'来源待核验',dateBasis:'通知发布日期，非会议日期'};
  db.prepare('UPDATE revisions SET payload=? WHERE document_id=?').run(JSON.stringify(input),f.doc);
  const state=archiveState(db),original=readDocument(db,f.doc);
  assert.throws(()=>applyCleanup(db,{expectedState:'stale'}),/版本已变化/);
  const queued=applyCleanup(db,{expectedState:state}),job=claim(db);
  assert.equal(job.snapshot.data.year[0].provenance,'已核验');
  for(const key of ['id','start','end','sourceUrl','dateBasis'])assert.equal(job.snapshot.data.year[0][key],input[key]);
  assert.equal(readDocument(db,f.doc).published.provenance,'来源待核验');
  assert.equal(readDocument(db,f.doc).permalink,original.permalink);
  finish(db,queued.id,{ok:true,hash:job.snapshot_hash,release:'admin-'+queued.id});
  assert.equal(readDocument(db,f.doc).published.provenance,'已核验');
  assert.equal(applyCleanup(db,{}).count,0);
});
test('archive cleanup CLI runs through the production current symlink',async t=>{
  const f=await fixture(t),manifest=join(f.dir,'cleanup.json');
  await symlink(resolve('.'),join(f.dir,'current'));
  await writeFile(manifest,JSON.stringify({expectedState:archiveState(f.app.db)}));
  const {stdout}=await promisify(execFile)(process.execPath,[join(f.dir,'current/admin/archive-cleanup.mjs'),'plan',manifest],{env:{...process.env,SCHOLAY_ADMIN_DB:join(f.dir,'admin.sqlite')}});
  assert.deepEqual(JSON.parse(stdout),{count:0,byKind:{}});
});
async function fixture(t,{setup=true}={}) {
  const dir=await mkdtemp(join(tmpdir(),'scholay-admin-test-'));
  await writeFile(join(dir,'data.json'),JSON.stringify({year:[year],history:[history],counts:{year:1,history:1,official:1}}));
  await writeFile(join(dir,'open-source.json'),JSON.stringify({items:[source]}));
  const app=await createApp({dbPath:join(dir,'admin.sqlite'),origin});
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  seedStore(app.db,dir);
  const code=secret();app.db.prepare("INSERT INTO meta VALUES('setup',?)").run(JSON.stringify({hash:digest(code),expires:Date.now()+60000}));
  let cookie='',csrf='';
  const call=async(path,{method='GET',data,headers={}}={})=>app.inject({method,url:'/manage/api'+path,headers:{origin,...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...headers},...(data?{payload:data}:{})});
  const initialize=async()=>{const r=await call('/setup',{method:'POST',data:{username:'owner',password,token:code}});assert.equal(r.statusCode,200,r.body);cookie=r.cookies[0].name+'='+r.cookies[0].value;csrf=r.json().csrf;return r;};
  if(setup)await initialize();
  const doc=app.db.prepare("SELECT id FROM documents WHERE kind='year'").get().id;
  const token=(scope)=>{const raw=secret();app.db.prepare('INSERT INTO tokens(id,name,hash,scope,created) VALUES(?,?,?,?,?)').run(secret(),scope,digest(raw),scope,Date.now());return raw;};
  return {app,dir,call,initialize,code,doc,token};
}
test('setup is single-use; login uses private sessions and admin assets never load analytics',async t=>{
  const f=await fixture(t,{setup:false});
  assert.equal((await f.call('/documents')).statusCode,401);
  assert.equal((await f.call('/setup',{method:'POST',data:{token:'bad',username:'owner',password}})).statusCode,403);
  const result=await f.initialize();
  assert.match(result.headers['set-cookie'],/HttpOnly/);assert.match(result.headers['set-cookie'],/Secure/);assert.match(result.headers['set-cookie'],/SameSite=Strict/);
  assert.equal((await f.call('/setup',{method:'POST',data:{token:f.code,username:'other',password}})).statusCode,409);
  const user=f.app.db.prepare('SELECT * FROM users').get();assert.match(user.password,/^\$argon2id\$/);assert(!user.password.includes(password));
  const page=await f.app.inject('/manage/');assert.equal(page.statusCode,200);assert.equal(page.headers['x-robots-tag'],'noindex, nofollow');assert(!page.body.includes('clarity'));assert.match(page.headers['content-security-policy'],/frame-ancestors 'none'/);
});
test('CSRF, foreign origins, expired sessions, and draft-only tokens cannot publish',async t=>{
  const f=await fixture(t),data={data:year,version:1};
  assert.equal((await f.call('/documents/'+f.doc,{method:'PUT',data,headers:{'x-csrf-token':'wrong'}})).statusCode,403);
  assert.equal((await f.call('/documents/'+f.doc,{method:'PUT',data,headers:{origin:'https://evil.example'}})).statusCode,403);
  const raw=f.token('ingest');
  for(const path of ['/documents','/jobs','/worker/claim']){
    const r=await f.app.inject({method:path.includes('claim')?'POST':'GET',url:'/manage/api'+path,headers:{authorization:'Bearer '+raw},...(path.includes('claim')?{payload:{}}:{})});assert([401,403].includes(r.statusCode));
  }
  f.app.db.prepare('UPDATE sessions SET seen=?').run(Date.now()-31*60000);
  assert.equal((await f.call('/documents')).statusCode,401);
});
test('saving, revision conflict and frozen queue prevent draft leakage and accidental overwrite',async t=>{
  const f=await fixture(t);
  const edited={...year,title:'审核通过的新标题'};
  const save=await f.call('/documents/'+f.doc,{method:'PUT',data:{data:edited,version:1}});assert.equal(save.statusCode,200);
  assert.equal(snapshot(f.app.db).data.year[0].title,year.title);
  assert.equal((await f.call('/documents/'+f.doc,{method:'PUT',data:{data:edited,version:1}})).statusCode,409);
  assert.equal((await f.call('/documents/'+f.doc+'/queue',{method:'POST',data:{action:'publish',version:2}})).statusCode,409);
  await f.call('/documents/'+f.doc+'/review',{method:'POST',data:{state:'approved',version:2}});
  const queued=await f.call('/documents/'+f.doc+'/queue',{method:'POST',data:{action:'publish',version:2}});assert.equal(queued.statusCode,200);
  assert.equal((await f.call('/documents/'+f.doc+'/queue',{method:'POST',data:{action:'publish',version:2}})).statusCode,409);
  await f.call('/documents/'+f.doc,{method:'PUT',data:{data:{...edited,title:'不能公开的后续草稿'},version:2}});
  const raw=f.token('publisher');
  const worker=async(path,data={})=>f.app.inject({method:'POST',url:'/manage/api/worker'+path,headers:{authorization:'Bearer '+raw},payload:data});
  const job=(await worker('/claim')).json().job;assert.equal(job.snapshot.data.year[0].title,edited.title);
  assert(!JSON.stringify(job.snapshot).includes('不能公开'));
  const replay=(await worker('/claim')).json().job;assert.equal(replay.id,job.id);assert.equal(replay.resume,true);
  assert.equal((await worker('/jobs/'+job.id+'/finish',{ok:true,release:'admin-'+job.id,hash:'wrong'})).statusCode,409);
  const done={ok:true,release:'admin-'+job.id,hash:job.snapshot_hash};assert.equal((await worker('/jobs/'+job.id+'/finish',done)).statusCode,200);assert.equal((await worker('/jobs/'+job.id+'/finish',done)).statusCode,200);
  assert.equal(snapshot(f.app.db).data.year[0].title,edited.title);assert.equal(readDocument(f.app.db,f.doc).data.title,'不能公开的后续草稿');
  assert.equal(seedStore(f.app.db,f.dir),false);assert.equal(readDocument(f.app.db,f.doc).data.title,'不能公开的后续草稿');
});
test('imports cannot overwrite manual changes and create only drafts',async t=>{
  const f=await fixture(t),raw=f.token('ingest');
  const response=await f.app.inject({method:'POST',url:'/manage/api/import',headers:{authorization:'Bearer '+raw},payload:{items:[{kind:'year',data:{...year,title:'外部覆盖尝试'}},{kind:'year',data:{...year,id:'new-import',title:'新候选内容'}}]}});
  assert.equal(response.statusCode,200);assert.deepEqual(response.json().results.map(r=>r.status),['exists','created']);
  assert.equal(readDocument(f.app.db,f.doc).data.title,year.title);assert.equal(snapshot(f.app.db).data.year.length,1);
});
test('cancel, failed retry, withdrawal, and restore retain history',async t=>{
  const f=await fixture(t);
  const future=(await f.call('/documents/'+f.doc+'/queue',{method:'POST',data:{action:'publish',version:1,scheduled:new Date(Date.now()+86400000).toISOString()}})).json();
  const raw=f.token('publisher'),worker=async(path,data={})=>f.app.inject({method:'POST',url:'/manage/api/worker'+path,headers:{authorization:'Bearer '+raw},payload:data});
  assert.equal((await worker('/claim')).json().job,null);
  assert.equal((await f.call('/jobs/'+future.id+'/cancel',{method:'POST'})).statusCode,200);
  const queued=(await f.call('/documents/'+f.doc+'/queue',{method:'POST',data:{action:'withdraw',version:1}})).json();
  await worker('/claim');await worker('/jobs/'+queued.id+'/finish',{ok:false,error:'test failure'});assert.equal(snapshot(f.app.db).data.year.length,1);
  assert.equal((await f.call('/jobs/'+queued.id+'/retry',{method:'POST'})).statusCode,200);
  const job=(await worker('/claim')).json().job;assert.equal(job.snapshot.data.year.length,0);
  await worker('/jobs/'+job.id+'/finish',{ok:true,release:'admin-'+job.id,hash:job.snapshot_hash});assert.equal(snapshot(f.app.db).data.year.length,0);
  assert.equal((await f.call('/documents/'+f.doc+'/restore',{method:'POST',data:{version:1,restore:1}})).statusCode,200);
  assert.equal(readDocument(f.app.db,f.doc).latest_revision,2);assert.equal(snapshot(f.app.db).data.year.length,0);
});
test('invalid dates and unsafe source URLs are rejected; leap day is retained',()=>{
  assert.throws(()=>validate('year',{...year,start:'2026-02-29'}));
  assert.throws(()=>validate('year',{...year,end:'2025-01-01'}));
  assert.throws(()=>validate('year',{...year,sourceUrl:'javascript:alert(1)'}));
  assert.throws(()=>validate('openSource',{...source,url:'https://user:pass@example.org'}));
  assert.equal(validate('history',history).dateKey,'02-29');
});
test('SEO retains original permalinks after edits and escapes hostile text',async t=>{
  const f=await fixture(t);const original=readDocument(f.app.db,f.doc).permalink;
  await f.call('/documents/'+f.doc,{method:'PUT',data:{version:1,data:{...year,title:'<script>alert(1)</script>',start:'2027-01-01',end:'2027-01-02'}}});
  await f.call('/documents/'+f.doc+'/review',{method:'POST',data:{state:'approved',version:2}});
  const snap=snapshot(f.app.db,{document_id:f.doc,action:'publish',revision:2});
  const target=join(f.dir,'release'),job={id:'test',snapshot:snap,snapshot_hash:digest(JSON.stringify(snap))};
  const release=await buildRelease({job,source:resolve('.'),target,now:'2026-09-20T00:00:00Z'});
  const publicEntries=await readdir(target);
  for(const privatePath of ['desktop','admin','scripts','.git','node_modules','.env'])assert(!publicEntries.includes(privatePath),'Private repository path entered public release: '+privatePath);
  const html=await readFile(join(target,original,'index.html'),'utf8');assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>alert'));
  const sitemap=await readFile(join(target,'sitemap-calendar.xml'),'utf8');assert(sitemap.includes(original));
  assert(release.hashes['sitemap-calendar.xml']);
  const next=join(f.dir,'next-release');
  await buildRelease({job,source:resolve('.'),target:next,previousRoot:target,now:'2026-09-21T00:00:00Z'});
  assert.equal(await readFile(join(next,'seo-manifest.json'),'utf8'),await readFile(join(target,'seo-manifest.json'),'utf8'));
  assert.equal(await readFile(join(next,'index.html'),'utf8'),await readFile(join(target,'index.html'),'utf8'));
  for(const file of ['admin.sqlite','admin/server.mjs','admin/public/admin.js'])await assert.rejects(readFile(join(target,file)));
});
test('a failed live verification restores the previous release after actually switching',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'scholay-rollback-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,'old'));await mkdir(join(dir,'new'));await symlink(join(dir,'old'),join(dir,'current'));
  await assert.rejects(activateRelease({base:dir,release:join(dir,'new'),verify:async()=>{assert.equal(await readlink(join(dir,'current')),join(dir,'new'));throw new Error('hash mismatch');}}),/hash mismatch/);
  assert.equal(await readlink(join(dir,'current')),join(dir,'old'));
});
test('successful activation replaces an existing link and clears its rollback marker',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'scholay-activation-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,'old'));await mkdir(join(dir,'new'));await symlink(join(dir,'old'),join(dir,'current'),'dir');
  await activateRelease({base:dir,release:join(dir,'new'),verify:async()=>assert.equal(await readlink(join(dir,'current')),join(dir,'new'))});
  assert.equal(await readlink(join(dir,'current')),join(dir,'new'));
  await assert.rejects(readlink(join(dir,'.admin-previous')),{code:'ENOENT'});
});
test('restart in a link replacement gap restores the old public root before reconciling the job',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'scholay-swap-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const old=join(dir,'old');await mkdir(old);await writeFile(join(old,'index.html'),'old site');
  await symlink(old,join(dir,'.admin-previous'),'dir');
  const result=await recoverRelease({base:dir,job:{id:'unfinished',snapshot_hash:'expected'},verify:async()=>assert.fail('incomplete switch must not be verified')});
  assert.equal(result.ok,false);assert.equal(await readFile(join(dir,'current/index.html'),'utf8'),'old site');
  await assert.rejects(readlink(join(dir,'.admin-previous')),{code:'ENOENT'});
});
test('password change revokes sessions and login attempts are limited with generic errors',async t=>{
  const f=await fixture(t);
  const response=await f.call('/password',{method:'POST',data:{current:password,password:'second-unique-passphrase-2026!'}});assert.equal(response.statusCode,200);
  assert.equal((await f.call('/documents')).statusCode,401);
  const login=async name=>f.app.inject({method:'POST',url:'/manage/api/login',headers:{origin},payload:{username:name,password:'incorrect'}});
  const known=await login('owner'),unknown=await login('unknown');assert.equal(known.statusCode,401);assert.equal(known.body,unknown.body);
  let last;for(let n=0;n<16;n++)last=await login('owner');assert.equal(last.statusCode,429);
});

test('restart after switching reconciles success, or restores the previous release on failed verification',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'scholay-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const old=join(dir,'releases/20260929-093218'),next=join(dir,'releases/admin-recovery');
  await mkdir(old,{recursive:true});await mkdir(next,{recursive:true});await writeFile(join(old,'index.html'),'old site');
  const manifest={jobId:'recovery',snapshotHash:'expected',release:'admin-recovery',previousRelease:'20260929-093218'};
  await writeFile(join(next,'release.json'),JSON.stringify(manifest));await symlink(next,join(dir,'current'));
  const job={id:'recovery',snapshot_hash:'expected'};
  const success=await recoverRelease({base:dir,job,verify:async()=>{}});assert.equal(success.ok,true);assert.equal(await readlink(join(dir,'current')),next);
  const failed=await recoverRelease({base:dir,job,verify:async()=>{throw new Error('readback mismatch');}});assert.equal(failed.ok,false);assert.equal(await readlink(join(dir,'current')),old);
});

test('website manuscript token is scoped; durable request keys, conflicts and failures preserve content',async t=>{
  const f=await fixture(t),raw=f.token('news_publish'),workerToken=f.token('publisher');
  const call=(path,data,token=raw)=>f.app.inject({method:data?'POST':'GET',url:'/manage/api/news'+path,headers:{authorization:'Bearer '+token},...(data?{payload:data}:{})});
  const data={id:'news-example',title:'新闻测试',summary:'事实摘要',markdown:'# 新闻测试\n\n正文与[来源](https://example.org/source)',date:'2026-10-02',category:'新闻聚合',author:'编辑部',assets:[]};
  const input={data,expectedVersion:0,requestKey:'first-request-123456'};
  assert.equal((await call('/publish',input,f.token('ingest'))).statusCode,403);
  assert.equal((await f.app.inject({url:'/manage/api/documents',headers:{authorization:'Bearer '+raw}})).statusCode,401);
  assert.equal((await call('/news-example')).json().version,0);
  const submitted=await call('/publish',input);assert.equal(submitted.statusCode,200,submitted.body);
  const receipt=submitted.json();assert.equal(receipt.url,'/news/news-example/');
  const repeat=await call('/publish',input);assert.equal(repeat.json().job.id,receipt.job.id);
  assert.equal((await call('/publish',{...input,data:{...data,title:'collision'}})).statusCode,409);
  assert.equal(snapshot(f.app.db).news.length,0);
  const worker=async(path,p={})=>f.app.inject({method:'POST',url:'/manage/api/worker'+path,headers:{authorization:'Bearer '+workerToken},payload:p});
  const job=(await worker('/claim')).json().job;assert.equal(job.snapshot.news[0].markdown,data.markdown);
  await worker('/jobs/'+job.id+'/finish',{ok:true,release:'admin-'+job.id,hash:job.snapshot_hash});
  assert.equal(snapshot(f.app.db).news[0].title,data.title);
  assert.equal((await call('/requests/'+input.requestKey)).json().job.status,'success');
  assert.equal((await call('/publish',{...input,requestKey:'new-request-123456',data:{...data,title:'overwriting'}})).statusCode,409);
  const updated=await call('/publish',{...input,expectedVersion:1,requestKey:'second-request-123456',data:{...data,title:'修订版本'}});
  assert.equal(updated.json().url,receipt.url);assert.equal(updated.json().revision,2);
  const failed=(await worker('/claim')).json().job;await worker('/jobs/'+failed.id+'/finish',{ok:false,error:'simulated failure'});
  assert.equal(snapshot(f.app.db).news[0].title,data.title);
  assert.equal((await call('/news-example')).json().data.title,'修订版本');
});

test('news renders public articles and assets, stable lastmod, and rejects unsafe images and dates',async t=>{
  const f=await fixture(t);const data={id:'news-safe',title:'可读文章',summary:'摘要',date:'2026-10-02',markdown:'# 可读文章\n\n<script>alert(1)</script>\n\n[坏链接](javascript:alert(1))',assets:[]};
  assert.throws(()=>validate('news',{...data,date:'2026-99-99'}),e=>e.statusCode===400);
  assert.throws(()=>validate('news',{...data,markdown:'![file](../../private.png)'}));
  const response=await f.call('/news/publish',{method:'POST',data:{requestKey:'render-request-12345',expectedVersion:0,data}});assert.equal(response.statusCode,200,response.body);
  const row=readDocument(f.app.db,response.json().id),snap=snapshot(f.app.db,{document_id:row.id,revision:1,action:'publish'});
  const job={id:'news-safe',snapshot:snap,snapshot_hash:digest(JSON.stringify(snap))};
  const target=join(f.dir,'news-release');await buildRelease({job,target,now:'2026-10-02T02:00:00Z'});
  const page=await readFile(join(target,'news/news-safe/index.html'),'utf8');
  assert(!page.includes('<script>alert'));assert(!page.includes('href="javascript:'));assert(page.includes('datePublished'));
  assert(page.includes('<header class="site-header app-bar">'));assert(!page.includes('seo-theme-toggle'));
  assert((await readFile(join(target,'sitemap-news.xml'),'utf8')).includes('/news/news-safe/'));
  await assert.rejects(readFile(join(target,'news.json')));
  const next=join(f.dir,'news-next');await buildRelease({job,target:next,previousRoot:target,now:'2026-10-03T02:00:00Z'});
  assert.equal(await readFile(join(next,'news/news-safe/index.html'),'utf8'),page);
});

test('structured record media renders in static pages without embedding bytes in public calendar JSON',async t=>{
  const f=await fixture(t),{createHash}=await import('node:crypto'),sharp=(await import('sharp')).default;
  const bytes=await sharp({create:{width:32,height:24,channels:3,background:'#996633'}}).webp().toBuffer();const path='/article-media/'+createHash('sha256').update(bytes).digest('hex')+'.webp';
  const snap=snapshot(f.app.db);snap.data.year[0]={...snap.data.year[0],body:'说明\n\n![日程示意]('+path+')',assets:[{path,data:bytes.toString('base64')}]};
  const target=join(f.dir,'release');await buildRelease({job:{id:'media-test',snapshot:snap,snapshot_hash:'test'},target});
  const route=snap.permalinks['year:'+year.id];const page=await readFile(join(target,route,'index.html'),'utf8');assert.match(page,/<img[^>]+alt="日程示意"/);assert.deepEqual(await readFile(join(target,path)),bytes);
  const data=JSON.parse(await readFile(join(target,'data.json'),'utf8'));assert.equal(data.year[0].assets,undefined);assert.equal(data.year[0].start,year.start);
});

test('private source archive API requires editorial auth, rejects stale versions and stays outside public snapshots',async t=>{
 const f=await fixture(t),raw=f.token('editorial_draft');
 const call=(path,data,token=raw)=>f.app.inject({method:data?'POST':'GET',url:'/manage/api/news'+path,headers:{authorization:'Bearer '+token},...(data?{payload:data}:{})});
 const data={id:'archive-api-test',title:'归档测试',summary:'摘要',date:'2026-10-05',markdown:'# 归档测试\n\n正文',assets:[]};
 const saved=await call('/drafts',{data,expectedVersion:0,expectedPublishedVersion:null,requestKey:'archive-api-request'});assert.equal(saved.statusCode,200,saved.body);
 const archive={articleId:data.id,revision:saved.json().revision,files:[{path:'articles/original.md',sha256:digest('原稿'),data:Buffer.from('原稿').toString('base64')}]};
 assert.equal((await call('/source-archives',archive,f.token('ingest'))).statusCode,403);
 assert.equal((await call('/source-archives',{...archive,revision:100})).statusCode,409);
 const proof=await call('/source-archives',archive);assert.equal(proof.statusCode,200,proof.body);
 const readback=await call('/source-archives/'+proof.json().archiveId);assert.deepEqual(readback.json().bundle,archive);
 assert.equal((await f.app.inject('/manage/api/news/source-archives/'+proof.json().archiveId)).statusCode,401);
 assert.equal((await call('/source-archives/'+proof.json().archiveId,undefined,f.token('editorial_draft'))).statusCode,404);
 assert(!JSON.stringify(snapshot(f.app.db)).includes('original.md'));
 // Author notes are found by article for any site credential, without the manuscript.
 const other=f.token('editorial_draft'),notesUrl='/source-archives/private-notes/'+data.id;
 assert.deepEqual((await call(notesUrl,undefined,other)).json(),{articleId:data.id,revision:null,privateEditorial:null});
 const notes={version:1,bodySha:'a'.repeat(64),internalNotes:{verification:'只核对了摘要'},modelSignatures:[]},bytes=Buffer.from(JSON.stringify(notes));
 const notesFile={path:'.local/today/'+data.id+'/internal-notes.json',sha256:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64')};
 assert.equal((await call('/source-archives',{...archive,files:[...archive.files,notesFile]})).statusCode,200);
 const found=await call(notesUrl+'?revision='+archive.revision,undefined,other);assert.equal(found.statusCode,200,found.body);
 assert.equal(found.json().revision,archive.revision);assert.deepEqual(found.json().privateEditorial.internalNotes,notes.internalNotes);
 assert(!found.body.includes('original.md')&&!found.body.includes(Buffer.from('原稿').toString('base64')));
 assert.equal((await call(notesUrl+'?revision=0',undefined,other)).statusCode,400);
 assert.equal((await call('/source-archives/private-notes/missing-article',undefined,other)).statusCode,404);
 assert.equal((await call(notesUrl,undefined,f.token('ingest'))).statusCode,403);
 assert.equal((await f.app.inject('/manage/api/news'+notesUrl)).statusCode,401);
});
test('admin text covers every interface language and API errors follow the chosen language',async t=>{
  const {ADMIN_LANGUAGES,ADMIN_MESSAGES}=new Function(await readFile('admin/public/admin-i18n.js','utf8')+';return {ADMIN_LANGUAGES,ADMIN_MESSAGES};')();
  const keys=Object.keys(ADMIN_MESSAGES.zh).sort(),vars=text=>[...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
  assert.deepEqual(ADMIN_LANGUAGES.map(([code])=>code),['zh','en','ja']);
  for(const [code] of ADMIN_LANGUAGES){
    assert.deepEqual(Object.keys(ADMIN_MESSAGES[code]).sort(),keys,code);
    for(const key of keys)assert.deepEqual(vars(ADMIN_MESSAGES[code][key]),vars(ADMIN_MESSAGES.zh[key]),code+' '+key);
  }
  const client=await readFile('admin/public/admin.js','utf8'),prefixes=new Set(keys.map(key=>key.split('.')[0]));
  for(const [,key] of client.matchAll(/'([a-z][A-Za-z]*\.[A-Za-z][\w.-]*)'/g))if(prefixes.has(key.split('.')[0]))assert(Object.hasOwn(ADMIN_MESSAGES.zh,key),'missing admin text '+key);
  for(const file of (await readdir('admin')).filter(name=>name.endsWith('.mjs'))){
    for(const [,message] of (await readFile(join('admin',file),'utf8')).matchAll(/fail\('([^']*[一-鿿][^']*)'(?=[,)])/g)){
      assert.notEqual(localizeMessage(message,'en'),message,file+': '+message);assert.notEqual(localizeMessage(message,'ja'),message,file+': '+message);
    }
  }
  assert.equal(localizeMessage('请填写 title','en'),'Fill in title.');assert.equal(localizeMessage('记录不存在','fr'),'记录不存在');
  const f=await fixture(t);
  assert.equal((await f.call('/documents/missing')).json().error,'记录不存在');
  assert.equal((await f.call('/documents/missing',{headers:{'x-scholay-language':'en'}})).json().error,'Record not found.');
  assert.equal((await f.call('/documents/missing',{headers:{'x-scholay-language':'ja'}})).json().error,'記録が見つかりません。');
  assert.equal((await f.call('/nowhere',{headers:{'x-scholay-language':'en'}})).json().error,'Page not found.');
  const script=await f.app.inject('/manage/admin-i18n.js');assert.equal(script.statusCode,200);assert.match(script.headers['content-type'],/javascript/);
  assert.match((await f.app.inject('/manage/')).body,/admin-i18n\.js[^>]*><\/script><script src="\/manage\/admin\.js"/);
});
test('browser editor saves keep the section and bundled images it cannot edit',async t=>{
  const f=await fixture(t),db=f.app.db,png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex'),path='/article-media/'+createHash('sha256').update(png).digest('hex')+'.png';
  const before=readDocument(db,f.doc),sectionId='calendar';
  saveDocument(db,f.doc,{...before.data,sectionId,body:'说明\n\n![示意]('+path+')',assets:[{path,data:png.toString('base64')}]},before.latest_revision,'desktop');
  const stored=readDocument(db,f.doc),{sectionId:_s,assets:_a,...form}=stored.data;
  const saved=await f.call('/documents/'+f.doc,{method:'PUT',data:{data:{...form,title:'后台改标题'},version:stored.latest_revision}});
  assert.equal(saved.statusCode,200,saved.body);
  const after=readDocument(db,f.doc).data;
  assert.equal(after.title,'后台改标题');assert.equal(after.sectionId,sectionId);assert.deepEqual(after.assets,stored.data.assets);
  assert.equal((await f.call('/documents/'+f.doc,{method:'PUT',data:{version:saved.json().latest_revision}})).statusCode,400);
});
