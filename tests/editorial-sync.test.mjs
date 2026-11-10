import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp,secret} from '../admin/server.mjs';
import {digest} from '../admin/model.mjs';
import {createDocument,readDocument,saveDocument,setReview,enqueue,claim,finish} from '../admin/store.mjs';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';
import {createDraft,readDraft,saveDraft,packedDraft} from '../scripts/editorial-workspace.mjs';
import {synchronizationState,localFingerprint,optionalJson} from '../scripts/editorial-sync.mjs';
import {renderArticle} from '../scripts/article-format.mjs';

test('sync state compares the local fingerprint to its acknowledged official revision',()=>{
  const base={revision:2,fingerprint:'A'},remote={publishedVersion:2};
  for(const [local,version,state] of [['A',2,'synced'],['B',2,'local_changed'],['A',3,'remote_changed'],['B',3,'conflict'],['B',null,'conflict']]){
    assert.equal(synchronizationState({base,local,remote:{publishedVersion:version},known:true}),state);
  }
  assert.equal(synchronizationState({base,local:'A',remote,known:false}),'unknown');
  assert.equal(synchronizationState({local:'A',remote,known:true}),'unlinked');
  assert.equal(synchronizationState({local:'A',known:true}),'unpublished');
});
test('cloud preview cache shares bundles across formats, invalidates revisions, and never caches action version reads',async t=>{
 const f=await fixture(t),markdown=String.raw`# 公式稿件

行内 \(N_i\)，以及 \[\frac{M C}{R}\]。`;
 const draft=await createDraft({id:'draft-formula-cache',title:'公式稿件',markdown},f.root);
 const packet=await f.client.prepare(draft.id,{metadata:f.meta});await f.client.publish(draft.id,{packetSha256:packet.prepared.packetSha256});f.complete();await f.client.status(draft.id);
 f.calls.length=0;
 await Promise.all(Array.from({length:10},()=>f.client.cloud(draft.id,{cache:true})));
 const notes=await f.client.cloud(draft.id,{cache:true,notes:true});assert.ok(notes.html.includes(String.raw`\(N_i\)`));assert.ok(notes.html.includes(String.raw`\frac{M C}{R}`));assert.equal(f.calls.length,1);
 await f.client.cloud(draft.id);assert.equal(f.calls.length,2);
 const id=f.app.db.prepare('SELECT id FROM documents').get().id,old=readDocument(f.app.db,id);
 saveDocument(f.app.db,id,{...old.data,markdown:markdown+'\n\n后台新内容'},1,'admin');
 assert.equal((await f.client.cloud(draft.id,{cache:true})).version,1);
 assert.equal((await f.client.cloud(draft.id)).version,2);
 await f.client.refresh();assert.equal((await f.client.cloud(draft.id,{cache:true,notes:true})).version,2);
 assert.equal((await readDraft(draft.id,f.root)).markdown,markdown);assert.ok(f.calls.every(x=>x.method==='GET'));
 await f.client.cloudAction(draft.id,{action:'withdraw',expectedVersion:2,expectedPublishedVersion:1,confirmed:true});f.complete();await f.client.cloudActionStatus(draft.id);
 assert.equal((await f.client.cloud(draft.id,{cache:true})).publishedVersion,null);
});
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'scholay-sync-'));
  await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:['新闻聚合']}));
  const app=await createApp({dbPath:join(root,'admin.sqlite'),origin:'https://today.scholay.com'});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const raw=secret(),tokenFile=join(root,'token');await writeFile(tokenFile,raw,{mode:0o600});
  if(process.platform==='win32'){
    // NTFS has no POSIX 600 mode; mirror the installed native vault's token environment.
    const previousToken=process.env.SCHOLAY_TODAY_TOKEN;
    process.env.SCHOLAY_TODAY_TOKEN=raw;
    t.after(()=>{if(previousToken===undefined)delete process.env.SCHOLAY_TODAY_TOKEN;else process.env.SCHOLAY_TODAY_TOKEN=previousToken;});
  }
  app.db.prepare('INSERT INTO tokens(id,name,hash,scope,created) VALUES(?,?,?,?,?)').run('test-token','test',digest(raw),'editorial_publish',Date.now());
  const calls=[];let offline=false;
  const fetcher=async(url,options={})=>{
    if(offline)throw Error('offline');const u=new URL(url);calls.push({path:u.pathname+u.search,method:options.method||'GET'});
    if(u.pathname.startsWith('/manage/')){const response=await app.inject({method:options.method||'GET',url:u.pathname+u.search,headers:options.headers,...(options.body?{payload:options.body}:{})});return new Response(response.body,{status:response.statusCode});}
    const row=app.db.prepare('SELECT id FROM documents WHERE permalink=?').get(u.pathname);if(!row)return new Response('Not found',{status:404});const d=readDocument(app.db,row.id);if(!d.published)return new Response('Not found',{status:404});
    const body=d.kind==='news'?'<div class="article-body">'+renderArticle(d.published.markdown.replace(/^# [^\n]+\n+/,''))+'</div>':'';
    return new Response('<link rel="canonical" href="'+url+'">'+body);
  };
  const client=createWebsitePublisher({root,tokenFile,fetcher});
  const meta={date:'2026-10-02',summary:'测试摘要',author:'编辑',category:'学者观察'};
  const complete=()=>{const job=claim(app.db);assert(job);finish(app.db,job.id,{ok:true,release:'admin-'+job.id,hash:job.snapshot_hash});};
  const save=async(id,markdown)=>{const d=await readDraft(id,root);return saveDraft({id,markdown,expectedSha256:d.sha256},root);};
  return {root,app,client,meta,calls,complete,save,offline:()=>{offline=true;}};
}
test('publication freezes A; changes to B while queued remain pending after a successful readback',async t=>{
  const f=await fixture(t),draft=await createDraft({id:'draft-one',title:'原稿',markdown:'# 原稿\n\nA'},f.root);
  await f.client.refresh();assert.equal((await f.client.inspect(draft.id)).sync.state,'unpublished');
  const packet=await f.client.prepare(draft.id,{metadata:f.meta});await f.client.publish(draft.id,{packetSha256:packet.prepared.packetSha256});
  await f.save(draft.id,'# 原稿\n\nB');f.complete();
  const detail=await f.client.status(draft.id);assert.equal(detail.receipt.publicReadback,true);assert.equal(detail.sync.state,'local_changed');
  assert.equal((await readDraft(draft.id,f.root)).markdown,'# 原稿\n\nB');
  const before=await readFile(join(f.root,'.local/today/remote-index.json'));f.offline();await assert.rejects(f.client.refresh(),/offline/);
  assert.deepEqual(await readFile(join(f.root,'.local/today/remote-index.json')),before);
  assert.equal((await f.client.snapshot()).articles[0].sync.state,'local_changed');
});
test('remote changes block stale previews; pulling keeps dirty text and merging requires the current fingerprint',async t=>{
  const f=await fixture(t),d=await createDraft({id:'draft-conflict',title:'合并稿',markdown:'# 合并稿\n\nA'},f.root);
  const p=await f.client.prepare(d.id,{metadata:f.meta});await f.client.publish(d.id,{packetSha256:p.prepared.packetSha256});f.complete();await f.client.status(d.id);
  const id=f.app.db.prepare('SELECT id FROM documents').get().id,old=readDocument(f.app.db,id);
  const updated=saveDocument(f.app.db,id,{...old.data,markdown:'# 合并稿\n\n官网的 B'},1,'admin');setReview(f.app.db,id,updated.latest_revision,'approved','admin');enqueue(f.app.db,id,2,'publish',Date.now(),'admin');f.complete();
  await f.save(d.id,'# 合并稿\n\n本地的 C');await f.client.refresh();assert.equal((await f.client.inspect(d.id)).sync.state,'conflict');
  await assert.rejects(f.client.prepare(d.id,{metadata:f.meta}),/未合并/);
  const pulled=await f.client.pull(d.id);assert.equal(pulled.conflict,true);assert.equal((await readDraft(d.id,f.root)).markdown,'# 合并稿\n\n本地的 C');
  const incoming=(await f.client.inspect(d.id)).incoming;assert.equal(incoming.revision,2);assert.match(incoming.markdown,/官网的 B/);
  const fingerprint=await localFingerprint(f.root,d.id);await f.save(d.id,'# 合并稿\n\n合并 B 和 C');
  await assert.rejects(f.client.acceptMerge(d.id,{revision:2,expectedFingerprint:fingerprint}),/本地内容已变化/);
  await f.client.acceptMerge(d.id,{revision:2,expectedFingerprint:await localFingerprint(f.root,d.id)});
  const final=await f.client.prepare(d.id,{metadata:f.meta});assert.equal(final.prepared.expectedVersion,2);
});
test('published bundle excludes admin drafts; WebP round trips without another watermark; pulls keep IDs and backups',async t=>{
  const f=await fixture(t),id='server-article',sharp=(await import('sharp')).default;
  const image=await sharp({create:{width:300,height:200,channels:3,background:'#336699'}}).webp().toBuffer();
  const path='/article-media/'+digest(image.toString('base64'))+'.webp';
  // Asset identity is a bytes hash, not a string hash.
  const {createHash}=await import('node:crypto');const assetPath='/article-media/'+createHash('sha256').update(image).digest('hex')+'.webp';
  const data={id,title:'官网稿',markdown:'# 官网稿\n\n正文\n\n![示例]('+assetPath+')',assets:[{path:assetPath,data:image.toString('base64')}],...f.meta};
  const row=createDocument(f.app.db,'news',data,'seed',{seed:true});
  saveDocument(f.app.db,row.id,{...data,markdown:'# 尚未发布的私稿'},1,'admin');
  const pulled=await f.client.pull(id);assert.equal(pulled.conflict,false);const local=await readDraft(id,f.root);assert.match(local.markdown,/官网稿/);assert.doesNotMatch(local.markdown,/私稿/);
  assert.equal((await f.client.inspect(id)).sync.state,'remote_changed');
  const packed=await packedDraft(id,f.root);assert.equal(packed.assets[0].data,data.assets[0].data);assert.equal(packed.assets[0].path,assetPath);
  await f.client.pull(id);assert.equal(Object.keys(JSON.parse(await readFile(join(f.root,'_ops/inventory/article-index.json'))).articles).length,1);
  assert.equal((await readdir(join(f.root,'.local/today',id,'backups'))).length,1);
  await assert.rejects(f.client.prepare(id,{metadata:f.meta}),/后台有尚未公开/);
});
test('calendar records round trip structured dates and source links through an acknowledged revision',async t=>{
  const f=await fixture(t);
  const data={id:'year:seed',title:'跨年会议',category:'学术会议',tags:['专题'],start:'2026-12-30',end:'2027-01-03',dateBasis:'官方会议日程',summary:'会议摘要',body:'旧正文',sourceName:'主办方',sourceUrl:'https://example.org/conf',provenance:'已核验',reviewedAt:'2026-10-01T00:00:00Z'};
  const row=createDocument(f.app.db,'year',data,'seed',{seed:true}),id='record-'+row.id;
  await f.client.pull(id);const draft=await readDraft(id,f.root);await f.save(id,draft.markdown.replace('旧正文','新的会议说明'));
  const packet=await f.client.prepare(id);await f.client.publish(id,{packetSha256:packet.prepared.packetSha256});f.complete();
  const result=await f.client.status(id);assert.equal(result.receipt.publicReadback,true);assert.equal(result.sync.state,'synced');
  const published=readDocument(f.app.db,row.id).published;assert.equal(published.start,data.start);assert.equal(published.end,data.end);assert.equal(published.sourceUrl,data.sourceUrl);assert.equal(published.body,'新的会议说明');
});
test('catalog lists published DB fields with bounded keyset pages and rejects unbounded or stale reads',async t=>{
  const f=await fixture(t);for(let i=0;i<103;i++)createDocument(f.app.db,'news',{id:'row-'+i,title:'标题 '+i,summary:'摘要',markdown:'# 私有大正文不属于列表',assets:[],...f.meta},'seed',{seed:true});
  const token=await readFile(join(f.root,'token'),'utf8');const call=url=>f.app.inject({url:'/manage/api/news'+url,headers:{authorization:'Bearer '+token}});
  const first=(await call('/catalog?limit=80')).json();assert.equal(first.items.length,80);assert(first.next);assert(!JSON.stringify(first).includes('markdown'));assert(!JSON.stringify(first).includes('assets'));
  assert.equal((await call('/catalog?limit=100000')).statusCode,400);
  const second=(await call('/catalog?limit=80&after='+first.next+'&generation='+first.generation)).json();assert.equal(second.items.length,23);assert.equal(second.next,null);
  f.app.db.prepare('INSERT INTO audit(at,actor,action) VALUES(?,?,?)').run(Date.now(),'test','write');assert.equal((await call('/catalog?generation='+first.generation)).statusCode,409);
  const all=await f.client.catalog();assert.equal(all.items.length,103);assert.equal(all.source,'server-database');
  const plan=f.app.db.prepare('EXPLAIN QUERY PLAN SELECT rowid FROM documents WHERE rowid>? ORDER BY rowid LIMIT 101').all(0);assert.match(JSON.stringify(plan),/INTEGER PRIMARY KEY/);
});

test('private cloud handoff, local edits, private save, publication, withdrawal and republishing preserve one identity',async t=>{
  const f=await fixture(t),id='private-handoff';
  const row=createDocument(f.app.db,'news',{id,title:'云端交接稿',markdown:'# 云端交接稿\n\n云端未公开 A',assets:[],...f.meta},'cloud-agent');
  assert.equal((await f.client.catalog({all:true})).items[0].publishedVersion,null);
  await f.client.pull(id,{source:'cloud'});assert.match((await readDraft(id,f.root)).markdown,/未公开 A/);
  await f.save(id,'# 云端交接稿\n\n兼职修改 B');
  let p=await f.client.prepare(id,{intent:'draft'});
  await assert.rejects(f.client.publish(id,{packetSha256:p.prepared.packetSha256}),/用途不匹配/);
  let result=await f.client.saveCloud(id,{packetSha256:p.prepared.packetSha256});
  assert.equal(result.stage,'draft_saved');assert.equal(result.sync.state,'synced');
  assert.equal(readDocument(f.app.db,row.id).published_revision,null);assert.equal(f.app.db.prepare('SELECT count(*) AS n FROM jobs').get().n,0);
  assert.equal(readDocument(f.app.db,row.id).latest_revision,2);
  p=await f.client.prepare(id,{intent:'publish'});await f.client.publish(id,{packetSha256:p.prepared.packetSha256});f.complete();
  assert.equal((await f.client.status(id)).stage,'published');
  await f.client.cloudAction(id,{action:'withdraw',confirmed:true,expectedVersion:2,expectedPublishedVersion:2});f.complete();
  await f.client.refresh();await f.save(id,'# 云端交接稿\n\n撤回后的修订 C');
  p=await f.client.prepare(id,{intent:'publish'});await f.client.publish(id,{packetSha256:p.prepared.packetSha256});f.complete();
  result=await f.client.status(id);assert.equal(result.stage,'published');assert.equal(readDocument(f.app.db,row.id).published_revision,3);
  assert.match(readDocument(f.app.db,row.id).published.markdown,/修订 C/);assert.equal(f.app.db.prepare('SELECT count(*) AS n FROM documents').get().n,1);
});

test('concurrent private revisions produce a conflict and cannot silently overwrite either editor',async t=>{
  const f=await fixture(t),id='private-conflict';
  const row=createDocument(f.app.db,'news',{id,title:'并发稿',markdown:'# 并发稿\n\nA',assets:[],...f.meta},'cloud-agent');
  await f.client.pull(id,{source:'cloud'});await f.save(id,'# 并发稿\n\n本地 B');
  saveDocument(f.app.db,row.id,{...readDocument(f.app.db,row.id).data,markdown:'# 并发稿\n\n云端 C'},1,'other-editor');
  await f.client.refresh();assert.equal((await f.client.inspect(id)).sync.state,'conflict');
  await assert.rejects(f.client.prepare(id,{intent:'draft'}),/未公开|未合并/);
  assert.equal((await f.client.pull(id,{source:'cloud'})).conflict,true);assert.match((await readDraft(id,f.root)).markdown,/本地 B/);
  await f.save(id,'# 并发稿\n\n核对 B 和 C 的合并稿');
  await f.client.acceptMerge(id,{revision:2,expectedFingerprint:await localFingerprint(f.root,id)});
  const p=await f.client.prepare(id,{intent:'draft'});await f.client.saveCloud(id,{packetSha256:p.prepared.packetSha256});
  assert.equal(readDocument(f.app.db,row.id).latest_revision,3);assert.equal(readDocument(f.app.db,row.id).published_revision,null);
});

test('private draft requests are idempotent and draft-only credentials cannot publish or delete',async t=>{
  const f=await fixture(t),raw=secret();f.app.db.prepare('INSERT INTO tokens(id,name,hash,scope,created) VALUES(?,?,?,?,?)').run('draft-token','cloud-agent',digest(raw),'editorial_draft',Date.now());
  const call=(path,data)=>f.app.inject({method:data?'POST':'GET',url:'/manage/api/news'+path,headers:{authorization:'Bearer '+raw},...(data?{payload:data}:{})});
  const data={requestKey:secret(),expectedVersion:0,expectedPublishedVersion:null,data:{id:'agent-private',title:'私稿',markdown:'# 私稿\n\n未公开',assets:[],...f.meta}};
  assert.equal((await call('/drafts',data)).statusCode,200);assert.equal((await call('/drafts',data)).json().revision,1);
  assert.equal(f.app.db.prepare('SELECT count(*) AS n FROM documents').get().n,1);
  assert.equal((await call('/drafts',{...data,data:{...data.data,title:'复用键篡改'}})).statusCode,409);
  assert.equal((await call('/drafts/requests/'+data.requestKey)).json().revision,1);
  assert.equal((await call('/cloud/agent-private')).json().publishedVersion,null);
  assert.equal((await call('/publish',data)).statusCode,403);
  assert.equal((await call('/actions',{articleId:'agent-private',action:'delete'})).statusCode,403);
});

test('agent publication confirmation is bound to its preview and cancellation performs no write',async t=>{
  const {createAgentTools}=await import('../desktop/scripts/agent/tools.mjs');
  const f=await fixture(t),id='agent-confirmation';await createDraft({id,title:'确认测试',markdown:'# 确认测试\n\n正文'},f.root);
  let approved=false,cards=[];
  const client={...f.client,publish:async(...args)=>{await f.client.publish(...args);f.complete();return f.client.status(id);}};
  const run=createAgentTools({root:f.root,client,approve:async card=>{cards.push(card);return approved;}});
  await assert.rejects(run('cloud_prepare',{id,intent:'draft',metadata:f.meta}),/云端交稿即公开/);
  await f.client.prepare(id,{intent:'draft',metadata:f.meta});await assert.rejects(run('cloud_submit',{id}),/旧预览为非公开草稿/);assert.equal(cards.length,0);
  await run('cloud_prepare',{id,intent:'publish',metadata:f.meta});
  await assert.rejects(run('cloud_submit',{id}),/用户取消/);assert.equal(f.app.db.prepare('SELECT count(*) AS n FROM documents').get().n,0);
  assert.match(cards[0].html,/正文/);approved=true;
  assert.equal((await run('cloud_submit',{id})).stage,'published');
  assert.equal(cards[1].intent,'publish');
  assert.equal((await run('works_list',{source:'cloud'})).items[0].id,id);
  assert.equal(f.app.db.prepare('SELECT count(*) AS n FROM jobs').get().n,1);
});

test('conflicting private images are staged for offline merge and retain their original derivative bytes',async t=>{
  const f=await fixture(t),id='private-image-merge';
  const row=createDocument(f.app.db,'news',{id,title:'配图合并',markdown:'# 配图合并\n\nA',assets:[],...f.meta},'cloud-agent');
  await f.client.pull(id,{source:'cloud'});await f.save(id,'# 配图合并\n\n本地修改');
  const sharp=(await import('sharp')).default,{createHash}=await import('node:crypto');
  const bytes=await sharp({create:{width:300,height:200,channels:3,background:'#338866'}}).webp().toBuffer();
  const assetPath='/article-media/'+createHash('sha256').update(bytes).digest('hex')+'.webp';
  saveDocument(f.app.db,row.id,{...readDocument(f.app.db,row.id).data,markdown:'# 配图合并\n\n云端修改\n\n![云端图]('+assetPath+')',assets:[{path:assetPath,data:bytes.toString('base64')}]},1,'other');
  assert.equal((await f.client.pull(id,{source:'cloud'})).conflict,true);
  const incoming=(await f.client.inspect(id)).incoming;
  assert.match(incoming.markdown,/assets\/cloud\//);assert.match((await readDraft(id,f.root)).markdown,/本地修改/);
  await f.save(id,incoming.markdown+'\n\n保留本地修改');
  await f.client.acceptMerge(id,{revision:2,expectedFingerprint:await localFingerprint(f.root,id)});
  const packed=await packedDraft(id,f.root);assert.equal(packed.assets[0].path,assetPath);assert.equal(packed.assets[0].data,bytes.toString('base64'));
});

test('new structured private manuscripts retain typed fields, media, identity and idempotent receipts',async t=>{
  const f=await fixture(t),{randomUUID}=await import('node:crypto');
  const templates=[
    ['year','学术情报',{title:'跨年科研会议',start:'2026-12-30',end:'2027-01-03',category:'学术会议',tags:['会议'],dateBasis:'官方会议日程',summary:'会议日程简介',body:'会议正文',sourceName:'主办方',sourceUrl:'https://example.org/conference',provenance:'已核验官网',reviewedAt:'2026-10-04T00:00:00Z'},'## 摘要\n\n会议日程简介\n\n## 正文\n\n会议正文'],
    ['history','昔日学术',{title:'历史科学事件',year:2000,dateKey:'02-29',domain:'科学史',eventType:'论文发表',importance:'B',factSummary:'事实简介',historicalSignificance:'历史意义',sources:[{label:'原始文献',url:'https://example.org/paper'}],preciseToDay:true},'## 事实摘要\n\n事实简介\n\n## 学术意义\n\n历史意义'],
    ['openSource','学术开源',{title:'开放科研项目',date:'2026-10-04',category:'基础设施',summary:'项目简介',value:'项目价值',url:'https://github.com/example/project',status:'资料核验，未安装实测'},'## 项目简介\n\n项目简介\n\n## 学术价值\n\n项目价值']
  ];
  for(const [kind,category,fields,body] of templates){
    const id='record-'+randomUUID(),draft=await createDraft({id,title:fields.title,column:category,archiveCategory:category,markdown:'# '+fields.title+'\n\n'+body,record:{kind,fields}},f.root);
    const sharp=(await import('sharp')).default;const image=(await sharp({create:{width:300,height:200,channels:3,background:'#335577'}}).png().toBuffer());
    const dir=join(f.root,draft.canonicalPath,'..');await mkdir(join(dir,'assets'),{recursive:true});await writeFile(join(dir,'assets/figure.png'),image);await f.save(id,draft.markdown+'\n\n![研究示意图](assets/figure.png)\n');
    const p=await f.client.prepare(id,{intent:'draft',metadata:{...f.meta,category}});const saved=await f.client.saveCloud(id,{packetSha256:p.prepared.packetSha256});
    assert.equal(saved.stage,'draft_saved');assert.equal(saved.receipt.publishedVersion,null);assert.equal(saved.receipt.articleId,id);assert.equal(f.app.db.prepare('SELECT count(*) AS n FROM jobs').get().n,0);
    const row=readDocument(f.app.db,id.slice(7));assert.equal(row.kind,kind);assert.equal(row.data.assets.length,1);assert.equal(row.data.title,fields.title);
    if(kind==='year'){assert.equal(row.data.start,fields.start);assert.equal(row.data.end,fields.end);}
    if(kind==='history'){assert.equal(row.data.year,fields.year);assert.equal(row.data.dateKey,fields.dateKey);}
    const token=await readFile(join(f.root,'token'),'utf8');const packet=JSON.parse(await readFile(join(f.root,'.local/today',id,'prepared.json'),'utf8'));const send=payload=>f.app.inject({method:'POST',url:'/manage/api/news/drafts',headers:{authorization:'Bearer '+token},payload});
    const malformed={...packet,requestKey:randomUUID(),data:{...packet.data,markdown:packet.data.markdown.replace('\n\n##','\n\n被遗漏的导语\n\n##')}};
    const rejected=await send(malformed);assert.equal(rejected.statusCode,400);assert.match(rejected.json().error,/导语/);
    assert.equal((await send(packet)).json().revision,1);
    assert.equal((await send({...packet,requestKey:randomUUID()})).statusCode,409);
    const pulled=await f.client.pull(id,{source:'cloud'});assert.equal(pulled.conflict,false);
    const pulledBase=await readFile(join(f.root,'.local/today',id,'sync.json'));
    assert.equal((await f.client.status(id)).sync.state,'synced');
    assert.deepEqual(await readFile(join(f.root,'.local/today',id,'sync.json')),pulledBase,'querying an acknowledged request must retain the pulled asset baseline');
    const packed=await packedDraft(id,f.root);assert.equal(packed.assets[0].data,packet.data.assets[0].data);assert(!packed.markdown.includes('assets/published'));
    assert.equal((await f.client.cloud(id)).kind,kind);
  }
  assert.equal((await f.client.catalog()).items.length,0);assert.equal((await f.client.catalog({all:true})).items.length,3);
});
