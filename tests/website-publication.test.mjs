import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';
import {createDraft,saveDraft,sha} from '../scripts/editorial-workspace.mjs';
import {renderArticle} from '../scripts/article-format.mjs';
import {websitePublisherCall} from '../desktop/scripts/website-publisher.mjs';
import {publicationQueueSnapshot} from '../scripts/publication-queue-status.mjs';
import {DEFAULT_SITE} from '../scripts/site-config.mjs';
import {createCloudQueue} from '../scripts/cloud-queue.mjs';
import {createCloudQueueServer} from '../scripts/cloud-queue-server.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'scholay-push-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({annexColumns:['新闻聚合'],articles:{}}));
  const draft=await createDraft({id:'test-local-news',title:'本地测试稿',markdown:'# 本地测试稿\n\n这是测试正文。'},root);
  const tokenFile=join(root,'test-token');await writeFile(tokenFile,'PRIVATE_TOKEN_SENTINEL',{mode:0o600});await protectPrivateFile(tokenFile);
  if(process.platform==='win32'){const before=process.env.SCHOLAY_TODAY_TOKEN;process.env.SCHOLAY_TODAY_TOKEN='PRIVATE_TOKEN_SENTINEL';t.after(()=>{if(before===undefined)delete process.env.SCHOLAY_TODAY_TOKEN;else process.env.SCHOLAY_TODAY_TOKEN=before;});}
  const calls=[],server={version:0,publishedVersion:null,data:null,job:'queued',timeout:false,badPage:false,submitted:null};
  const fetcher=async(url,options)=>{
    calls.push({url,method:options.method||'GET',body:options.body});
    const path=new URL(url).pathname;
    if(path.endsWith('/publish')){server.submitted=JSON.parse(options.body);server.version=1;server.data=server.submitted.data;if(server.timeout)throw Error('simulated submission timeout');return Response.json({articleId:draft.id,revision:1,url:'/news/'+draft.id+'/',job:{id:'job-one',status:server.job}});}
    if(path.includes('/requests/')){server.statusStarted?.();if(server.waitForStatus)await server.waitForStatus;return Response.json({articleId:draft.id,revision:1,url:'/news/'+draft.id+'/',job:{id:'job-one',status:server.job}});}
    if(path.includes('/source-archives/private-notes/'))return Response.json({error:'Not Found'},{status:404});
    if(path.startsWith('/manage/'))return Response.json({version:server.version,publishedVersion:server.publishedVersion,data:server.data});
    return new Response('<link rel="canonical" href="https://today.scholay.com/news/'+draft.id+'/"><div class="article-body">'+(server.badPage?'stale page':renderArticle(server.submitted.data.markdown.replace(/^# [^\n]+\n+/,'')))+'</div>');
  };
  const client=createWebsitePublisher({root,tokenFile,fetcher});
  const meta={date:'2026-10-02',summary:'来源和事实均保留的摘要',author:'测试编辑',category:'新闻聚合'};
  const prepare=()=>client.prepare(draft.id,{metadata:meta});
  return {root,draft,client,meta,calls,server,prepare,fetcher,tokenFile};
}
test('desktop reads local drafts without credentials or network disclosure; explicit confirmation is required',async t=>{
  const f=await fixture(t);const snap=await f.client.snapshot(),detail=await f.client.inspect(f.draft.id);
  assert.equal(snap.articles.length,1);assert.equal(detail.stage,'local');assert.equal(f.calls.length,0);
  assert(!JSON.stringify({snap,detail}).includes('PRIVATE_TOKEN_SENTINEL'));
  await assert.rejects(websitePublisherCall('publish',{id:f.draft.id},f.client),/明确确认/);
  await assert.rejects(websitePublisherCall('run_shell',{},f.client),/Unknown/);
  await assert.rejects(f.client.inspect('../escape'),/Invalid/);
});
test('cloud export saves the latest private revision with local images without pulling or publishing',async t=>{
  const f=await fixture(t),directory=await mkdtemp(join(tmpdir(),'scholay-export-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const bytes=Buffer.from('89504e470d0a1a0a','hex'),path='/article-media/'+sha(bytes)+'.png';
  const markdown=`# 云端新稿\n\n![配图](${path})\n\n![同一图片](https://today.scholay.com${path})`;
  f.server.data={id:'cloud-export-only',title:'云端新稿',markdown,assets:[{path,data:bytes.toString('base64')}],...f.meta};
  f.server.version=3;f.server.publishedVersion=2;
  const index=join(f.root,'_ops/inventory/article-index.json'),before=await readFile(index,'utf8');
  const result=await websitePublisherCall('cloud_export',{id:'cloud-export-only',directory},f.client);
  assert.equal(result.version,3);assert.equal(result.images,1);
  const image='assets/'+path.split('/').pop();
  assert.equal(await readFile(join(result.directory,'正文.md'),'utf8'),`# 云端新稿\n\n![配图](${image})\n\n![同一图片](${image})`);
  assert.deepEqual(await readFile(join(result.directory,image)),bytes);
  const metadata=JSON.parse(await readFile(join(result.directory,'文章信息.json'),'utf8'));
  assert.equal(metadata.version,3);assert.equal(metadata.publishedVersion,2);assert.equal(metadata.author,f.meta.author);
  assert(!JSON.stringify(metadata).includes('PRIVATE_TOKEN_SENTINEL'));
  // A second export gets its own folder; neither an existing export nor local work is overwritten.
  f.server.data.markdown='# 云端又更新了';f.server.version=4;f.server.publishedVersion=null;
  const next=await f.client.exportCloud('cloud-export-only',{directory});
  assert.notEqual(next.directory,result.directory);
  assert.equal(await readFile(join(next.directory,'正文.md'),'utf8'),'# 云端又更新了');
  assert.equal(await readFile(index,'utf8'),before);
  assert.equal((await f.client.snapshot()).articles.length,1);
  assert.deepEqual(f.calls.map(c=>[c.method,new URL(c.url).pathname]),[
    ['GET','/manage/api/news/cloud/cloud-export-only'],['GET','/manage/api/news/cloud/cloud-export-only'],
  ]);
});
test('cloud export rejects mismatched identities, damaged images and manuscript destinations without partial output',async t=>{
  const f=await fixture(t),directory=await mkdtemp(join(tmpdir(),'scholay-export-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  f.server.version=1;f.server.data={id:'other-article',title:'稿件',markdown:'# 正文',assets:[],...f.meta};
  await assert.rejects(f.client.exportCloud('cloud-export-only',{directory}),/编号不匹配/);
  f.server.data.id='cloud-export-only';
  f.server.data.assets=[{path:'/article-media/bad.png',data:Buffer.from('89504e470d0a1a0a','hex').toString('base64')}];
  await assert.rejects(f.client.exportCloud('cloud-export-only',{directory}),/图片路径/);
  f.server.data.assets=[];
  await assert.rejects(f.client.exportCloud('cloud-export-only',{directory:f.root}),/工作目录之外/);
  assert.deepEqual(await readdir(directory),[]);
});
test('local library snapshots expose saved editorial metadata without rewriting sources or contacting cloud',async t=>{
  const f=await fixture(t),dir=join(f.root,'.local/today',f.draft.id),indexFile=join(f.root,'_ops/inventory/article-index.json');
  const before=await readFile(indexFile,'utf8'),body=await readFile(join(f.root,f.draft.canonicalPath),'utf8');
  await mkdir(dir,{recursive:true});
  const meta={date:'2026-10-06',summary:'可检索的本机摘要，保留写稿日期',author:'本机编辑',category:'学者观察'};
  await writeFile(join(dir,'metadata.json'),JSON.stringify(meta));
  const row=(await f.client.snapshot()).articles[0];
  assert.deepEqual(row.metadata,meta);assert.equal(row.archiveCategory,meta.category);assert.equal(row.batchDate,null);
  assert.equal(f.calls.length,0);assert.equal(await readFile(indexFile,'utf8'),before);assert.equal(await readFile(join(f.root,f.draft.canonicalPath),'utf8'),body);
  await writeFile(join(dir,'metadata.json'),JSON.stringify({...meta,summary:'修改后摘要即时回读'}));
  assert.equal((await f.client.snapshot()).articles[0].metadata.summary,'修改后摘要即时回读');
});
test('metadata saves locally with version protection and invalidates an older frozen preview',async t=>{
  const f=await fixture(t),before=await f.client.inspect(f.draft.id);
  const params={id:f.draft.id,action:'metadata',metadata:f.meta,expectedSourceSha256:before.sourceSha256,expectedMetadataSha256:before.metadataSha256};
  const saved=await websitePublisherCall('local_action',params,f.client);
  assert.deepEqual(saved.metadata,f.meta);assert.equal(f.calls.length,0);
  assert.equal((await f.client.inspect(f.draft.id)).sourceSha256,before.sourceSha256);
  await assert.rejects(websitePublisherCall('local_action',{...params,metadata:{...f.meta,summary:'过期修改'}},f.client),/发布信息已变化/);
  const p=await f.prepare(),count=f.calls.length;
  const next=await websitePublisherCall('local_action',{...params,metadata:{...f.meta,summary:'本地修订摘要'},expectedMetadataSha256:p.metadataSha256},f.client);
  assert.equal(next.stale,true);assert.equal(f.calls.length,count);
  await assert.rejects(f.client.publish(f.draft.id,{packetSha256:p.prepared.packetSha256}),/正文|发布信息|变化/);
});
test('local metadata permits unfinished fields but rejects malformed dates and pending publication',async t=>{
  const f=await fixture(t),before=await f.client.inspect(f.draft.id);
  const params={id:f.draft.id,action:'metadata',metadata:{...f.meta,date:'',summary:''},expectedSourceSha256:before.sourceSha256,expectedMetadataSha256:before.metadataSha256};
  const saved=await websitePublisherCall('local_action',params,f.client);
  assert.equal(saved.metadata.date,'');assert.equal(saved.metadata.summary,'');assert.equal(f.calls.length,0);
  await assert.rejects(websitePublisherCall('local_action',{...params,expectedMetadataSha256:saved.metadataSha256,metadata:{...f.meta,date:'2026-02-30'}},f.client),/日期/);
  await assert.rejects(websitePublisherCall('local_action',{...params,expectedMetadataSha256:saved.metadataSha256,metadata:{...f.meta,summary:{text:'wrong'}}},f.client),/字段格式/);
  const prepared=await f.prepare();f.server.timeout=true;await assert.rejects(f.client.publish(f.draft.id,{packetSha256:prepared.prepared.packetSha256}));
  await assert.rejects(websitePublisherCall('local_action',{...params,expectedMetadataSha256:prepared.metadataSha256},f.client),/未完成的发布操作/);
});
test('preview freezes metadata, images and server version; changed sources cannot be submitted',async t=>{
  const f=await fixture(t),p=await f.prepare();
  assert.equal(p.stage,'prepared');assert.equal(p.prepared.expectedVersion,0);assert(f.calls.every(x=>x.method==='GET'));
  await assert.rejects(f.client.publish(f.draft.id,{packetSha256:'stale'}),/预览版本/);
  await saveDraft({id:f.draft.id,markdown:'# Cursor 已更新\n\n新正文',expectedSha256:f.draft.sha256},f.root);
  assert.equal((await f.client.inspect(f.draft.id)).stale,true);
  await assert.rejects(f.client.publish(f.draft.id,{packetSha256:p.prepared.packetSha256}),/正文已/);
  assert(f.calls.every(x=>x.method==='GET'));
  await assert.rejects(f.client.prepare(f.draft.id,{metadata:f.meta,expectedSourceSha256:f.draft.sha256}),/其他编辑器/);
});
test('an uncertain submission retains its request and blocks re-preparation; success requires exact public readback',async t=>{
  const f=await fixture(t),p=await f.prepare();f.server.timeout=true;
  await assert.rejects(f.client.publish(f.draft.id,{packetSha256:p.prepared.packetSha256}),/timeout/);
  const unknown=await f.client.inspect(f.draft.id);assert.equal(unknown.stage,'unknown');assert.equal(unknown.receipt.requestKey,p.prepared.requestKey);
  await assert.rejects(f.prepare(),/上次推送/);
  await assert.rejects(f.client.pull(f.draft.id,{source:'cloud'}),/未完成的发布操作/);
  const queued=await f.client.status(f.draft.id);assert.equal(queued.stage,'queued');
  await assert.rejects(f.client.publish(f.draft.id,{packetSha256:p.prepared.packetSha256,retry:true}),/已有回执/);
  f.server.job='success';f.server.publishedVersion=1;f.server.badPage=true;
  assert.equal((await f.client.status(f.draft.id)).stage,'verify');
  f.server.badPage=false;const done=await f.client.status(f.draft.id);
  assert.equal(done.stage,'published');assert.equal(done.receipt.publicReadback,true);
  assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
  assert.equal(JSON.parse(await readFile(join(f.root,'.local/today',f.draft.id,'receipt.json'),'utf8')).publicReadback,true);
});
test('explicit retry of an unknown request uses the exact original key and payload',async t=>{
  const f=await fixture(t),p=await f.prepare();f.server.timeout=true;
  await assert.rejects(f.client.publish(f.draft.id,{packetSha256:p.prepared.packetSha256}));
  await assert.rejects(f.client.publish(f.draft.id,{packetSha256:p.prepared.packetSha256}),/尚未确认/);
  f.server.timeout=false;await f.client.publish(f.draft.id,{packetSha256:p.prepared.packetSha256,retry:true});
  const posts=f.calls.filter(x=>x.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].body,posts[1].body);
});
test('an HTML upload rejection reports HTTP status; a confirmed missing private request can reuse its exact packet',async t=>{
  const f=await fixture(t),tokenFile=join(f.root,'test-token'),posts=[];let accepted=false;
  const client=createWebsitePublisher({root:f.root,tokenFile,fetcher:async(url,options)=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/drafts')){posts.push(options.body);if(!accepted)return new Response('<html>PRIVATE_UPSTREAM_BODY</html>',{status:413});return Response.json({requestKey:JSON.parse(options.body).requestKey,revision:1,version:1,publishedVersion:null});}
    if(path.includes('/drafts/requests/'))return Response.json({error:'草稿请求不存在'},{status:404});
    return Response.json({version:0,publishedVersion:null});
  }});
  const p=await client.prepare(f.draft.id,{intent:'draft',metadata:f.meta});
  await assert.rejects(client.saveCloud(f.draft.id,{packetSha256:p.prepared.packetSha256}),e=>e.statusCode===413&&/HTTP 413/.test(e.message)&&!e.message.includes('PRIVATE_UPSTREAM_BODY'));
  assert.equal((await client.inspect(f.draft.id)).stage,'rejected');
  const checked=await client.status(f.draft.id);assert.equal(checked.stage,'prepared');assert.equal(checked.receipt.status,'not_submitted');
  accepted=true;const result=await client.saveCloud(f.draft.id,{packetSha256:p.prepared.packetSha256});assert.equal(result.stage,'draft_saved');assert.equal(posts[0],posts[1]);
});
test('admin unpublished revisions and concurrent metadata edits are never silently approved',async t=>{
  const f=await fixture(t);f.server.version=2;f.server.publishedVersion=1;
  await assert.rejects(f.prepare(),/后台有尚未公开/);
  f.server.version=0;f.server.publishedVersion=null;const before=await f.client.inspect(f.draft.id);await f.prepare();
  await assert.rejects(f.client.prepare(f.draft.id,{metadata:f.meta,expectedMetadataSha256:before.metadataSha256}),/发布信息已变化/);
  assert(f.calls.every(x=>x.method==='GET'));
});
test('a failed transport does not expose token values in renderer responses and preserves the saved article',async t=>{
  const f=await fixture(t),p=await f.prepare();
  const file=join(f.root,f.draft.canonicalPath),before=sha(await readFile(file));
  await writeFile(join(f.root,'.local/today',f.draft.id,'metadata.json'),JSON.stringify({...f.meta,summary:'changed by another editor'}),{mode:0o600});
  await assert.rejects(f.client.publish(f.draft.id,{packetSha256:p.prepared.packetSha256}),/发布信息或图片/);
  assert.equal(sha(await readFile(file)),before);assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
});

test('changing a local image after preview invalidates the frozen package',async t=>{
  const f=await fixture(t),imagePath=join(f.root,f.draft.canonicalPath,'..','figure.png');
  const sharp=(await import('sharp')).default;const image=await sharp({create:{width:320,height:180,channels:3,background:'#376a41'}}).png().toBuffer();await writeFile(imagePath,image);
  await saveDraft({id:f.draft.id,markdown:f.draft.markdown+'\n\n![本地图](figure.png)',expectedSha256:f.draft.sha256},f.root);
  const prepared=await f.prepare();assert.equal(prepared.prepared.assetCount,1);assert.match(prepared.html,/src="data:image\/webp;base64,/);
  await writeFile(imagePath,await sharp({create:{width:320,height:180,channels:3,background:'#ff3344'}}).png().toBuffer());
  assert.equal((await f.client.inspect(f.draft.id)).stale,true);
  await assert.rejects(f.client.publish(f.draft.id,{packetSha256:prepared.prepared.packetSha256}),/图片已/);
  assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
});
test('an owned failed revision can be prepared again, but later admin changes remain protected',async t=>{
  const f=await fixture(t),p=await f.prepare();await f.client.publish(f.draft.id,{packetSha256:p.prepared.packetSha256});
  f.server.job='failed';await f.client.status(f.draft.id);
  const again=await f.prepare();assert.equal(again.prepared.expectedVersion,1);assert.notEqual(again.prepared.requestKey,p.prepared.requestKey);
  f.server.version=2;f.server.data={...f.server.data,summary:'administrator draft'};
  await assert.rejects(f.prepare(),/后台有尚未公开/);
});
// The English catalog is a separate read made after each complete Chinese one.
const englishCatalog=url=>new URL(url).searchParams.get('locale')==='en'?Response.json({items:[],next:null,generation:1,scope:'all'}):null;
test('parallel task and UI catalog refreshes coalesce and failed refresh retains last good cache',async t=>{
 const f=await fixture(t);let requests=0,fail=false;const fetcher=async url=>{const en=englishCatalog(url);if(en)return en;requests++;await new Promise(resolve=>setTimeout(resolve,40));if(fail)throw Error('offline');return Response.json({scope:'all',generation:5,items:[{articleId:'cloud-a',title:'A'}],next:null});};
 const make=()=>createWebsitePublisher({root:f.root,tokenFile:join(f.root,'test-token'),fetcher});const [a,b]=await Promise.all([make().catalog({all:true,cache:true,refresh:true}),make().catalog({all:true,cache:true,refresh:true})]);assert.equal(requests,1);assert.deepEqual(a,b);await make().catalog({all:true,cache:true});assert.equal(requests,1);await make().catalog({all:true,cache:true,refresh:true});assert.equal(requests,1);await new Promise(resolve=>setTimeout(resolve,5));fail=true;await assert.rejects(make().catalog({all:true,cache:true,refresh:'changed'}),/offline/);assert.deepEqual(await make().catalog({all:true,cache:true}),{...a,notice:'暂时无法更新，显示上次缓存；稍后再试。'});assert.equal(requests,2);
});

test('manual catalog refresh keeps complete cached work after failure and after a local invalidation',async t=>{
 const f=await fixture(t);let calls=0,fail=false;
 const client=createWebsitePublisher({root:f.root,tokenFile:join(f.root,'test-token'),fetcher:async url=>{const en=englishCatalog(url);if(en)return en;calls++;if(fail)throw Error('offline');return Response.json({items:[{id:'cached-one'}],next:null,generation:1,scope:'all'});}});
 await client.catalog({all:true,cache:true,refresh:true});fail=true;
 await client.catalog({all:true,cache:true,refresh:true});assert.equal(calls,1);
 const file=join(f.root,'.local/today/catalog-all.json'),state=JSON.parse(await readFile(file,'utf8'));state.checkedAt=Date.now()-31000;await writeFile(file,JSON.stringify(state));
 const fallback=await client.catalog({all:true,cache:true,refresh:true});assert.equal(calls,2);assert.deepEqual(fallback.items,[{id:'cached-one'}]);assert.match(fallback.notice,/缓存/);
 await writeFile(join(f.root,'.local/today/read-cache-epoch.json'),JSON.stringify({value:'changed'}));
 const invalidated=await client.catalog({all:true,cache:true});assert.deepEqual(invalidated.items,[{id:'cached-one'}]);assert.match(invalidated.notice,/缓存/);
});

test('author notes for cloud works come from this Mac first, then the site lookup for any machine',async t=>{
 const f=await fixture(t),notes=(text)=>({version:1,bodySha:'b'.repeat(64),internalNotes:{verification:text},modelSignatures:[]});
 let lookup={articleId:'cloud-made-elsewhere',revision:1,privateEditorial:notes('另一台机器的核对')},lookups=0,old=false;
 const fetcher=async(url,options)=>{
  if(new URL(url).pathname.includes('/source-archives/private-notes/')){lookups++;if(old)return Response.json({error:'Not Found'},{status:404});return Response.json({...lookup,articleId:new URL(url).pathname.split('/').pop()});}
  return f.fetcher(url,options);
 };
 const client=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,fetcher});
 // A local manuscript reads only its own file and never asks the site.
 await mkdir(join(f.root,'.local/today',f.draft.id),{recursive:true});
 await writeFile(join(f.root,'.local/today',f.draft.id,'internal-notes.json'),JSON.stringify(notes('本机备注')));
 assert.equal((await client.privateNotes(f.draft.id)).privateEditorial.internalNotes.verification,'本机备注');assert.equal(lookups,0);
 // A cloud-only work asks the site and reports the version the notes belong to.
 const remote=await client.privateNotes('cloud-made-elsewhere',{revision:2});
 assert.deepEqual({source:remote.source,revision:remote.revision,text:remote.privateEditorial.internalNotes.verification},{source:'cloud',revision:1,text:'另一台机器的核对'});
 await client.privateNotes('cloud-made-elsewhere',{revision:2});assert.equal(lookups,1);
 assert.equal(await readFile(join(f.root,'.local/today/cloud-made-elsewhere/internal-notes.json')).catch(()=>null),null);
 // An older site without the lookup falls back to the file this Mac kept.
 old=true;await mkdir(join(f.root,'.local/today/cloud-released'),{recursive:true});
 assert.equal((await client.privateNotes('cloud-released',{revision:3})).source,'unsupported');
 await writeFile(join(f.root,'.local/today/cloud-released/internal-notes.json'),JSON.stringify(notes('发布时保留')));
 await rm(join(f.root,'.local/today/cloud-released/read-private-notes.json'),{force:true});
 assert.equal((await client.privateNotes('cloud-released',{revision:3})).privateEditorial.internalNotes.verification,'发布时保留');
 // Pulling a work pushed elsewhere restores its notes into the editing copy.
 old=false;lookup={articleId:'',revision:1,privateEditorial:notes('取回时恢复')};
 f.server.data={id:'cloud-pull-notes',title:'别处推送',markdown:'# 别处推送\n\n正文',assets:[],...f.meta};f.server.version=1;f.server.publishedVersion=1;
 await client.pull('cloud-pull-notes',{source:'cloud'});
 assert.equal(JSON.parse(await readFile(join(f.root,'.local/today/cloud-pull-notes/internal-notes.json'),'utf8')).internalNotes.verification,'取回时恢复');
 // Viewing an explicit cloud revision must not show an unrelated local editing note.
 const cloudVersion=await client.privateNotes(f.draft.id,{revision:2});
 assert.equal(cloudVersion.source,'cloud');assert.equal(cloudVersion.privateEditorial.internalNotes.verification,'取回时恢复');
 assert.equal(JSON.parse(await readFile(join(f.root,'.local/today',f.draft.id,'internal-notes.json'),'utf8')).internalNotes.verification,'本机备注');
});

test('the full catalog marks each published Chinese news article as English live, pending or missing',async t=>{
 const f=await fixture(t),origin='https://today.scholay.com',news=(id,state='published')=>({kind:'news',articleId:id,publicationState:state,title:id,url:origin+'/news/'+id+'/'});
 await mkdir(join(f.root,'.local/today/news-queued'),{recursive:true});
 await writeFile(join(f.root,'.local/today/news-queued/receipt.json'),JSON.stringify({requestKey:'k',publicReadback:true,asyncQueue:{continuationOwner:'cloud',continuation:{status:'queued'}}}));
 await mkdir(join(f.root,'.local/today/news-skipped'),{recursive:true});
 await writeFile(join(f.root,'.local/today/news-skipped/receipt.json'),JSON.stringify({requestKey:'k',publicReadback:true,publishingFlow:{status:'disabled'}}));
 let englishFails=false;
 const fetcher=async url=>{
  if(new URL(url).searchParams.get('locale')==='en'){if(englishFails)throw Error('offline');return Response.json({scope:'all',generation:2,next:null,items:[{kind:'news',articleId:'edition-en-1',publicationState:'published',url:origin+'/en/news/news-live/'},{kind:'news',articleId:'edition-en-2',publicationState:'unpublished',url:origin+'/en/news/news-draft/'}]});}
  return Response.json({scope:'all',generation:1,next:null,items:[news('news-live'),news('news-draft'),news('news-queued'),news('news-skipped'),news('news-hidden','unpublished'),{kind:'year',articleId:'record-x',publicationState:'published',title:'x',url:origin+'/calendar/x/'}]});
 };
 const client=createWebsitePublisher({root:f.root,tokenFile:join(f.root,'test-token'),fetcher});
 const value=await client.catalog({all:true,cache:true,refresh:true});
 assert.deepEqual(Object.fromEntries(value.items.map(x=>[x.articleId,x.english])),{'news-live':'live','news-draft':'pending','news-queued':'pending','news-skipped':'missing','news-hidden':undefined,'record-x':undefined});
 // An unreadable English catalog leaves coverage unknown instead of reporting gaps.
 englishFails=true;await writeFile(join(f.root,'.local/today/read-cache-epoch.json'),JSON.stringify({value:'changed'}));
 const unknown=await client.catalog({all:true,cache:true,refresh:true});
 assert(unknown.items.every(x=>x.english===undefined));
});

test('catalog retries a disconnected JSON response body without restarting successful pages',async t=>{
 const f=await fixture(t),calls=[];let disconnected=false;
 const client=createWebsitePublisher({root:f.root,tokenFile:join(f.root,'test-token'),fetcher:async(url,options)=>{
  assert.equal(options.method,'GET');const en=englishCatalog(url);if(en)return en;const after=Number(new URL(url).searchParams.get('after'));calls.push(after);
  if(after===80&&!disconnected){disconnected=true;return {ok:true,status:200,headers:new Headers(),json:async()=>{throw new TypeError('terminated',{cause:{code:'UND_ERR_SOCKET'}});}};}
  return Response.json({items:[{id:after?'second':'first'}],next:after?null:80,generation:1,scope:'all'});
 }});
 const value=await client.catalog({all:true,cache:true});assert.deepEqual(value.items,[{id:'first'},{id:'second'}]);assert.deepEqual(calls,[0,80,80]);
});

test('section metadata survives frozen packet, publication acknowledgement and local synchronization fingerprint',async t=>{
 const f=await fixture(t),metadata={...f.meta,sectionId:'observations',category:'学者观察'};
 const p=await f.client.prepare(f.draft.id,{metadata});
 assert.equal(p.prepared.metadata.sectionId,'observations');
 await f.client.publish(f.draft.id,{packetSha256:p.prepared.packetSha256});
 f.server.job='success';f.server.publishedVersion=1;
 const result=await f.client.status(f.draft.id);
 assert.equal(result.stage,'published');assert.equal(result.stale,false);
 assert.equal(result.metadata.sectionId,'observations');
 assert.equal(result.sync.state,'synced');
});

for(const layout of ['annex','dated'])test(`deleted cloud IDs recover a ${layout} manuscript as an independent indexed copy without publishing the tombstone`,async t=>{
 const f=await fixture(t),indexFile=join(f.root,'_ops/inventory/article-index.json');
 if(layout==='dated'){
  const index=JSON.parse(await readFile(indexFile,'utf8')),entry=index.articles[f.draft.id];
  const canonicalPath='articles/2026-10/2026-10-02_'+f.draft.id+'_本地测试稿/正文.md';
  await mkdir(join(f.root,'articles/2026-10'),{recursive:true});
  await rename(dirname(join(f.root,entry.canonicalPath)),dirname(join(f.root,canonicalPath)));
  index.articles[f.draft.id]={...entry,canonicalPath,batchDate:'2026-10-02',dateBasis:'source-date'};
  await writeFile(indexFile,JSON.stringify(index));
 }
 const originalIndex=JSON.parse(await readFile(indexFile,'utf8'));
 await f.client.localAction(f.draft.id,{action:'metadata',metadata:f.meta,expectedSourceSha256:f.draft.sha256,expectedMetadataSha256:(await f.client.inspect(f.draft.id)).metadataSha256});
 const calls=[],client=createWebsitePublisher({root:f.root,tokenFile:join(f.root,'test-token'),fetcher:async(url,options)=>{calls.push([url,options.method]);return url.endsWith('/'+f.draft.id)?Response.json({error:'云端作品已删除'},{status:410}):Response.json({version:0,publishedVersion:null,data:null});}});
 assert.equal((await client.prepare(f.draft.id,{metadata:f.meta})).stage,'prepared');
 const fingerprint=(await client.inspect(f.draft.id)).sync.fingerprint;
 await assert.rejects(client.localAction(f.draft.id,{action:'recover_deleted',expectedFingerprint:fingerprint}),/请确认/);
 const next=await client.localAction(f.draft.id,{action:'recover_deleted',confirmed:true,expectedFingerprint:fingerprint});assert.notEqual(next.id,f.draft.id);
 assert.equal((await client.localAction(f.draft.id,{action:'recover_deleted',confirmed:true,expectedFingerprint:fingerprint})).id,next.id);
 const index=JSON.parse(await readFile(indexFile,'utf8')),entry=index.articles[next.id];
 assert.deepEqual(index.articles[f.draft.id],originalIndex.articles[f.draft.id]);
 assert.equal(entry.batchDate,null);assert.equal(entry.dateBasis,'annex');
 assert.deepEqual(index.annexColumns,['新闻聚合']);
 assert.match(entry.canonicalPath,/^articles\/annex\/新闻聚合\/\d{8}-[a-f0-9]{8}_本地测试稿\/正文\.md$/);
 assert.equal(await readFile(join(f.root,entry.canonicalPath),'utf8'),f.draft.markdown);
 const recovered=await client.inspect(next.id);assert.deepEqual(recovered.metadata,f.meta);assert.equal(recovered.sourceSha256,f.draft.sha256);
 const prepared=await client.prepare(next.id,{intent:'draft',releaseLocal:false,metadata:f.meta});assert.equal(prepared.stage,'prepared');assert.equal(prepared.prepared.intent,'draft');
 assert.equal((await client.snapshot()).articles.length,2);assert(calls.every(([,method])=>method==='GET'));
});

for(const intent of ['draft','publish'])test(`a deleted cloud identity automatically completes ${intent} with one local manuscript and verified cleanup`,async t=>{
 const f=await fixture(t),calls=[];let data=null,packet=null,archive=null;
 const fetcher=async(url,options)=>{
  const path=new URL(url).pathname;if(path.includes('/source-archives/private-notes/'))return Response.json({error:'Not Found'},{status:404});calls.push(path);
  if(path==='/manage/api/news/'+f.draft.id)return Response.json({error:'云端作品已删除'},{status:410});
  if(path.endsWith('/publish')||path.endsWith('/drafts')){packet=JSON.parse(options.body);data=packet.data;return Response.json({articleId:data.id,revision:1,version:1,publishedVersion:intent==='publish'?1:null,url:'/news/'+data.id+'/',...(intent==='publish'?{job:{id:'job',status:'queued'}}:{})});}
  if(path.includes('/requests/'))return Response.json({articleId:data.id,revision:1,url:'/news/'+data.id+'/',job:{id:'job',status:'success'}});
  if(path.endsWith('/source-archives')){archive=JSON.parse(options.body);assert.equal(archive.articleId,data.id);return Response.json({archiveId:sha(JSON.stringify(archive))});}
  if(path.includes('/source-archives/'))return Response.json({archiveSha256:sha(JSON.stringify(archive)),bundle:archive});
  if(path.startsWith('/manage/'))return Response.json({version:data?1:0,publishedVersion:data&&intent==='publish'?1:null,data});
  return new Response('<link rel="canonical" href="https://today.scholay.com/news/'+data.id+'/"><div class="article-body">'+renderArticle(data.markdown.replace(/^# [^\n]+\n+/,''))+'</div>');
 };
 const options={root:f.root,tokenFile:join(f.root,'test-token'),fetcher};let client=createWebsitePublisher(options);
 let prepared=await client.prepare(f.draft.id,{intent,releaseLocal:true,metadata:f.meta});
 const binding=JSON.parse(await readFile(join(f.root,'.local/today',f.draft.id,'remote-id.json'),'utf8'));
 assert.notEqual(binding.id,f.draft.id);assert.equal((await client.snapshot()).articles.length,1);
 client=createWebsitePublisher(options);prepared=await client.prepare(f.draft.id,{intent,releaseLocal:true,metadata:f.meta});
 assert.equal(JSON.parse(await readFile(join(f.root,'.local/today',f.draft.id,'remote-id.json'),'utf8')).id,binding.id);
 let result=await (intent==='draft'?client.saveCloud:client.publish)(f.draft.id,{packetSha256:prepared.prepared.packetSha256});
 if(intent==='publish')result=await client.status(f.draft.id);
 assert.equal(packet.data.id,binding.id);assert.equal(result.localReleased,true);assert.equal(result.stage,intent==='draft'?'draft_saved':'published');
 const index=JSON.parse(await readFile(join(f.root,'_ops/inventory/article-index.json'),'utf8'));assert.equal(Object.keys(index.articles).length,0);assert(archive.files.some(f=>f.path.endsWith('正文.md')));
 // Pulling from the cloud catalog must restore the original indexed manuscript,
 // including in a checkout that has only the archived pointer, not local state.
 await rm(join(f.root,'.local/today',f.draft.id,'remote-id.json'));
 const restored=await client.pull(binding.id,{source:'cloud'});assert.equal(restored.id,f.draft.id);assert.equal(restored.conflict,false);
 const restoredIndex=JSON.parse(await readFile(join(f.root,'_ops/inventory/article-index.json'),'utf8'));
 assert.deepEqual(Object.keys(restoredIndex.articles),[f.draft.id]);assert.deepEqual(Object.keys(restoredIndex.cloudArticles),[]);
 assert.equal(restoredIndex.articles[f.draft.id].canonicalPath,f.draft.canonicalPath);
 const next=await client.prepare(f.draft.id,{intent,releaseLocal:false,metadata:f.meta});assert.equal(next.prepared.expectedVersion,1);
 assert.equal(calls.filter(path=>path==='/manage/api/news/'+f.draft.id).length,1);
});

test('a retained manuscript follows its replacement cloud identity through refresh, pull and conflict resolution',async t=>{
 const f=await fixture(t),calls=[];let data=null,version=0;
 const client=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,fetcher:async(url,options)=>{
  const path=new URL(url).pathname;if(path.includes('/source-archives/private-notes/'))return Response.json({error:'Not Found'},{status:404});calls.push(path);
  if(path==='/manage/api/news/'+f.draft.id)return Response.json({error:'云端作品已删除'},{status:410});
  if(path.endsWith('/drafts')){data=JSON.parse(options.body).data;version++;return Response.json({articleId:data.id,revision:version,version,publishedVersion:null});}
  if(path.endsWith('/index'))return Response.json({items:[{id:data.id,version,publishedVersion:null}],generation:version,next:null});
  return Response.json({version,publishedVersion:null,data});
 }});
 const prepared=await client.prepare(f.draft.id,{intent:'draft',releaseLocal:false,metadata:f.meta});
 const saved=await client.saveCloud(f.draft.id,{packetSha256:prepared.prepared.packetSha256});
 assert.equal(saved.localReleased,undefined);assert.equal(saved.sync.state,'synced');
 const remote=data.id;assert.notEqual(remote,f.draft.id);
 data={...data,markdown:'# 本地测试稿\n\n云端第二版。'};version=2;
 assert.equal((await client.refresh()).articles[0].sync.state,'remote_changed');
 const pulled=await client.pull(f.draft.id,{source:'cloud'});assert.equal(pulled.id,f.draft.id);assert.equal(pulled.conflict,false);
 const clean=await client.inspect(f.draft.id);assert.equal(clean.sync.state,'synced');
 const local='# 本地测试稿\n\n尚未推送的本地修改。';
 await saveDraft({id:f.draft.id,markdown:local,expectedSha256:clean.sourceSha256},f.root);
 data={...data,markdown:'# 本地测试稿\n\n云端第三版。'};version=3;
 const conflict=await client.pull(remote,{source:'cloud'});assert.equal(conflict.id,f.draft.id);assert.equal(conflict.conflict,true);
 const detail=await client.inspect(f.draft.id);assert.equal(detail.sync.state,'conflict');assert.equal(detail.incoming.markdown,data.markdown);
 assert.equal(await readFile(join(f.root,f.draft.canonicalPath),'utf8'),local);
 await client.acceptMerge(f.draft.id,{revision:3,expectedFingerprint:detail.sync.fingerprint});
 const next=await client.prepare(f.draft.id,{intent:'draft',releaseLocal:false});assert.equal(next.prepared.expectedVersion,3);
 const index=JSON.parse(await readFile(join(f.root,'_ops/inventory/article-index.json'),'utf8'));
 assert.deepEqual(Object.keys(index.articles),[f.draft.id]);assert.equal(calls.filter(path=>path==='/manage/api/news/'+f.draft.id).length,1);
});

test('a push waits for another tab status read and continues with the checked revision',async t=>{
  const f=await fixture(t),prepared=await f.prepare();await f.client.publish(f.draft.id,{packetSha256:prepared.prepared.packetSha256});
  f.server.job='success';f.server.publishedVersion=1;await f.client.status(f.draft.id);
  let release,started;f.server.waitForStatus=new Promise(r=>release=r);const reading=new Promise(r=>started=r);f.server.statusStarted=started;
  const status=f.client.status(f.draft.id);await reading;
  const other=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,fetcher:f.fetcher});
  const pushing=other.prepare(f.draft.id,{metadata:f.meta});
  // Concurrent callers use one operation lock; no contention error escapes.
  await new Promise(r=>setTimeout(r,50));release();
  const [checked,next]=await Promise.all([status,pushing]);
  assert.equal(checked.stage,'published');assert.equal(next.stage,'prepared');assert.equal(next.prepared.expectedVersion,1);
  assert.equal(f.calls.filter(c=>c.method==='POST').length,1,'waiting does not submit a second request');
});
test('overlapping status polls reuse the result after waiting instead of fetching twice',async t=>{
  const f=await fixture(t),prepared=await f.prepare();await f.client.publish(f.draft.id,{packetSha256:prepared.prepared.packetSha256});
  let release,started;f.server.waitForStatus=new Promise(r=>release=r);const reading=new Promise(r=>started=r);f.server.statusStarted=started;
  const first=f.client.status(f.draft.id);await reading;const second=f.client.status(f.draft.id);
  await new Promise(r=>setTimeout(r,50));release();
  const results=await Promise.all([first,second]);assert(results.every(x=>x.stage==='queued'));
  assert.equal(f.calls.filter(c=>c.url.includes('/requests/')).length,1);
});

test('verified Chinese push inherits deployed language capability and retains its frozen continuation after a policy change',async t=>{
 const f=await fixture(t);const {profiles}=await import('../scripts/site-config.mjs');const {configureFlow,flowStatus,atomic}=await import('../scripts/publishing-flow.mjs');
 const site={...profiles.find(s=>s.id==='metho')};delete site.languages;await writeFile(join(f.root,'.site.json'),JSON.stringify(site));
 const policy={version:1,enabled:true,autoRun:false,siteId:site.id,origin:site.origin,authorization:'User approved a single article pilot',articleIds:[f.draft.id],handoffDirectory:join(f.root,'.local/handoff'),targets:[{platform:'discord',locale:'zh-CN',format:'summary',integrationId:'discord-pilot',channelId:'1562031229606301696'}]};
 await configureFlow(f.root,{...site,languages:['zh-CN','en']},policy);
 const client=createWebsitePublisher({root:f.root,site,tokenFile:f.tokenFile,fetcher:async(url,options={})=>{
  const path=new URL(url).pathname;if(path.endsWith('/api/site'))return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin,capabilities:['language-editions-v1']});
  if(!path.startsWith('/manage/'))return new Response('<link rel="canonical" href="'+site.origin+'/news/'+f.draft.id+'/"><div class="article-body">'+renderArticle(f.server.submitted.data.markdown.replace(/^# [^\n]+\n+/,''))+'</div>');
  return f.fetcher(url,options);
 }});
 const prepared=await client.prepare(f.draft.id,{metadata:{...f.meta,category:site.columns[0]}});await client.publish(f.draft.id,{packetSha256:prepared.prepared.packetSha256});f.server.job='success';f.server.publishedVersion=1;
 const result=await client.status(f.draft.id);assert.equal(result.stage,'published');assert.equal(result.receipt.publishingFlow.status,'queued');assert.equal((await flowStatus(f.root)).length,1);
 await atomic(join(f.root,'.local/publishing-flow/policy.json'),{...policy,authorization:''});const resumed=await client.status(f.draft.id);assert.equal(resumed.stage,'published');assert.equal(resumed.receipt.publicReadback,true);assert.equal(resumed.receipt.publishingFlow.status,'queued');assert.equal(resumed.receipt.publishingFlow.id,result.receipt.publishingFlow.id);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});

test('an interrupted Chinese submission is recovered by its original key and frozen internal-only policy',async t=>{
 const f=await fixture(t),prepared=await f.prepare(),packet=JSON.parse(await readFile(join(f.root,'.local/today',f.draft.id,'prepared.json'),'utf8'));
 const {atomic,flowStatus}=await import('../scripts/publishing-flow.mjs');
 const policy={version:1,siteId:'scholay-today',origin:'https://today.scholay.com',enabled:true,autoRun:false,authorization:'Five-site internal recovery acceptance',articleIds:[f.draft.id],targets:[]};
 // Simulate a crash after persisting intent, before POST. The ordinary producer
 // policy is disabled here so this test cannot start a real background process.
 const intent={articleId:f.draft.id,requestKey:packet.requestKey,policy,submittedAt:new Date().toISOString(),status:'pending'};
 await atomic(join(f.root,'.local/today',f.draft.id,'receipt.json'),{intent:'publish',requestKey:packet.requestKey,submittedAt:intent.submittedAt,status:'submit_intent'});
 await atomic(join(f.root,'.local/publishing-flow/submissions',packet.requestKey+'.json'),intent);
 const client=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,fetcher:async(url,opts)=>{
  if(new URL(url).pathname.includes('/requests/')&&!f.server.submitted)return Response.json({error:'missing'},{status:404});
  if(new URL(url).pathname.endsWith('/publish')){f.server.job='success';f.server.publishedVersion=1;}
  return f.fetcher(url,opts);
 }});
 const receipt=await client.resumeSubmission(f.draft.id,intent);assert.equal(receipt.publicReadback,true);assert.equal(receipt.requestKey,packet.requestKey);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 const jobs=await flowStatus(f.root);assert.equal(jobs.length,1);assert.deepEqual(jobs[0].plan.policy.targets,[]);
 await client.resumeSubmission(f.draft.id,intent);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal((await flowStatus(f.root)).length,1);
});

test('an authoritative missing request can replay its identical packet despite a cached queued job, once under concurrency',async t=>{
 const f=await fixture(t);await f.prepare();
 const {atomic}=await import('../scripts/publishing-flow.mjs'),dir=join(f.root,'.local/today',f.draft.id),packet=JSON.parse(await readFile(join(dir,'prepared.json'),'utf8'));
 const policy={version:1,siteId:'scholay-today',origin:'https://today.scholay.com',enabled:true,autoRun:false,authorization:'Recover the original approved publication',articleIds:[f.draft.id],targets:[]};
 const intent={articleId:f.draft.id,requestKey:packet.requestKey,policy,submittedAt:new Date().toISOString(),status:'pending'};
 await atomic(join(dir,'receipt.json'),{intent:'publish',requestKey:packet.requestKey,submittedAt:intent.submittedAt,status:'submitted',job:{id:'cached-job',status:'queued'}});
 const client=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,fetcher:async(url,options)=>{
  const path=new URL(url).pathname;
  if(path.includes('/requests/')&&!f.server.submitted)return Response.json({error:'missing'},{status:404});
  if(path.endsWith('/publish')){assert.deepEqual(JSON.parse(options.body),packet);f.server.job='success';f.server.publishedVersion=1;}
  return f.fetcher(url,options);
 }});
 const results=await Promise.all([client.resumeSubmission(f.draft.id,intent),client.resumeSubmission(f.draft.id,intent)]);
 assert(results.every(r=>r.publicReadback&&r.requestKey===packet.requestKey));
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 // Even if a server later prunes request history, proven public work is never resent.
 f.server.submitted=null;await client.resumeSubmission(f.draft.id,intent);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});

test('missing request recovery preserves the original request when the local manuscript changed',async t=>{
 const f=await fixture(t);await f.prepare();
 const {atomic}=await import('../scripts/publishing-flow.mjs'),dir=join(f.root,'.local/today',f.draft.id),packet=JSON.parse(await readFile(join(dir,'prepared.json'),'utf8'));
 const intent={articleId:f.draft.id,requestKey:packet.requestKey,status:'pending'};
 await atomic(join(dir,'receipt.json'),{intent:'publish',requestKey:packet.requestKey,status:'submitted',job:{id:'cached-job',status:'queued'}});
 await saveDraft({id:f.draft.id,markdown:'# 后续编辑\n\n保留此修改，不能重放旧稿。',expectedSha256:f.draft.sha256},f.root);
 const client=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,fetcher:async(url,options)=>new URL(url).pathname.includes('/requests/')?Response.json({error:'missing'},{status:404}):f.fetcher(url,options)});
 await assert.rejects(client.resumeSubmission(f.draft.id,intent),/source changed/);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 assert.equal(JSON.parse(await readFile(join(dir,'receipt.json'),'utf8')).requestKey,packet.requestKey);
 assert.equal(intent.resends,undefined);
});

test('confirmed desktop publication acknowledges a durable local queue without awaiting website writes',async t=>{
 const f=await fixture(t),prep=await f.prepare();let kicks=0;
 const client=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,fetcher:f.fetcher,queueKick:async()=>{kicks++;}});
 const writes=f.calls.filter(call=>call.method==='POST').length;
 const queued=await client.enqueue(f.draft.id,{packetSha256:prep.prepared.packetSha256});
 assert.equal(queued.stage,'queued');assert.equal(queued.receipt.asyncQueue.phase,'queued');assert.equal(kicks,1);
 assert.equal(f.calls.filter(call=>call.method==='POST').length,writes);
 const snapshot=await publicationQueueSnapshot({root:f.root,site:DEFAULT_SITE,globalData:null});
 assert.equal(snapshot.jobs.length,1);assert.equal(snapshot.jobs[0].requestKey,queued.receipt.requestKey);
 assert.equal(snapshot.jobs[0].status,'queued');assert(!JSON.stringify(snapshot).includes('PRIVATE_TOKEN_SENTINEL'));
 await assert.rejects(client.prepare(f.draft.id),/原任务/);
 const repeated=await client.enqueue(f.draft.id,{packetSha256:prep.prepared.packetSha256});assert.equal(repeated.receipt.requestKey,queued.receipt.requestKey);
});

test('local queue crosses real authenticated HTTP, resumes a lost acknowledgement and imports the original cloud receipt',async t=>{
 const f=await fixture(t);const prep=await f.prepare();
 const endpointRoot=join(f.root,'cloud-queue');let posts=0;
 const website=async(url,options={})=>{
  if(new URL(url).pathname==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId:DEFAULT_SITE.id,origin:DEFAULT_SITE.origin});
  if(new URL(url).pathname.includes('/requests/')&&!f.server.submitted)return Response.json({error:'missing'},{status:404});
  if(new URL(url).pathname.endsWith('/publish')){posts++;f.server.job='success';f.server.publishedVersion=1;}
  const response=await f.fetcher(url,options);
  if(new URL(url).pathname==='/manage/api/news/'+f.draft.id)return Response.json({version:f.server.version,publishedVersion:f.server.publishedVersion,data:f.server.data,published:f.server.data});
  return response;
 };
 const queue=createCloudQueue({directory:endpointRoot,sites:[{site:DEFAULT_SITE,tokenFile:f.tokenFile}],fetcher:website});
 const server=createCloudQueueServer({queue});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const endpoint='http://127.0.0.1:'+server.address().port;
 await writeFile(join(f.root,'.local/publication-queue.json'),JSON.stringify({version:1,enabled:true,endpoint}),{mode:0o600});
 let lost=false;
 const fetcher=async(url,options)=>{
  if(url.startsWith(endpoint)){
   const response=await fetch(url,options);
   if(options.method==='POST'&&!lost){lost=true;throw Error('Lost cloud acknowledgement after durable intake');}
   return response;
  }
  return website(url,options);
 };
 const client=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,fetcher,queueKick:async()=>{}});
 const ack=await client.publish(f.draft.id,{packetSha256:prep.prepared.packetSha256});
 assert.equal(ack.stage,'queued');assert.equal(posts,0);
 await client.runQueued(f.draft.id);
 let saved=JSON.parse(await readFile(join(f.root,'.local/today',f.draft.id,'receipt.json'),'utf8'));
 assert.equal(saved.asyncQueue.owner,'local');assert.equal(saved.requestKey,ack.receipt.requestKey);
 saved.asyncQueue.retryAt=0;await writeFile(join(f.root,'.local/today',f.draft.id,'receipt.json'),JSON.stringify(saved));
 const resumed=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,fetcher,queueKick:async()=>{}});
 await resumed.runQueued(f.draft.id);await queue.tick();
 const done=await resumed.status(f.draft.id);
 assert.equal(done.stage,'published');assert.equal(done.receipt.publicReadback,true);assert.equal(done.receipt.asyncQueue.owner,'cloud');
 assert.equal(done.receipt.requestKey,ack.receipt.requestKey);assert.equal(posts,1);
 await resumed.runQueued(f.draft.id);assert.equal(posts,1);
 const snapshot=await publicationQueueSnapshot({root:f.root,site:DEFAULT_SITE,globalData:null});assert.equal(snapshot.jobs[0].status,'complete');
});

test('a queued publication cannot consume a mutated preview, and a local enqueue failure remains visible and resumable',async t=>{
 const f=await fixture(t),prep=await f.prepare();
 const client=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,fetcher:f.fetcher,queueKick:async()=>{throw Error('worker temporarily unavailable');}});
 const ack=await client.enqueue(f.draft.id,{packetSha256:prep.prepared.packetSha256});assert.equal(ack.stage,'queued');
 assert.equal(ack.receipt.asyncQueue.error,'worker temporarily unavailable');
 const packetFile=join(f.root,'.local/today',f.draft.id,'prepared.json'),packet=JSON.parse(await readFile(packetFile,'utf8'));
 packet.data.markdown+='\nUnapproved change';await writeFile(packetFile,JSON.stringify(packet));
 await assert.rejects(client.runQueued(f.draft.id),/身份已变化/);
 assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
});

test('a failed original direct request becomes a review task rather than an endless background poll',async t=>{
 const f=await fixture(t),prep=await f.prepare();f.server.job='failed';
 const client=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,fetcher:f.fetcher,queueKick:async()=>{}});
 await client.enqueue(f.draft.id,{packetSha256:prep.prepared.packetSha256});
 const result=await client.runQueued(f.draft.id);assert.equal(result.receipt.asyncQueue.phase,'needs_review');
 assert.equal(result.stage,'failed');assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
 const count=f.calls.length;await client.runQueued(f.draft.id);assert.equal(f.calls.length,count);
});
test('local direct background publication keeps English/Ente progress separate and stops attention tasks without pruning',async t=>{
 const f=await fixture(t),{configureFlow,flowStatus,atomic}=await import('../scripts/publishing-flow.mjs'),{publicationRecoveryCandidates}=await import('../scripts/publication-queue-recover.mjs'),{runPublicationQueue}=await import('../scripts/publication-queue-worker.mjs');
 await configureFlow(f.root,DEFAULT_SITE,{version:1,siteId:DEFAULT_SITE.id,origin:DEFAULT_SITE.origin,enabled:true,autoRun:false,authorization:'Existing local continuation queue',articleIds:[f.draft.id],targets:[],translate:false});
 const client=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,queueKick:async()=>{},fetcher:async(url,request)=>{const path=new URL(url).pathname;if(path.includes('/requests/')&&!f.server.submitted)return Response.json({error:'missing'},{status:404});if(path.endsWith('/publish')){f.server.job='success';f.server.publishedVersion=1;}return f.fetcher(url,request);}});
 const prepared=await client.prepare(f.draft.id,{metadata:f.meta});await client.enqueue(f.draft.id,{packetSha256:prepared.prepared.packetSha256});const done=await client.runQueued(f.draft.id);assert.equal(done.stage,'published');assert.equal(done.receipt.asyncQueue.phase,'complete');assert.equal(done.receipt.asyncQueue.continuation.owner,'local');assert.equal(done.receipt.asyncQueue.continuation.status,'queued');assert.equal((await publicationQueueSnapshot({root:f.root,site:DEFAULT_SITE,globalData:null})).jobs[0].status,'waiting');
 const [{plan}]=await flowStatus(f.root);await atomic(join(f.root,'.local/publishing-flow/jobs',plan.id,'state.json'),{status:'needs_review',translation:{status:'failed'}});
 await runPublicationQueue({root:f.root,id:f.draft.id,site:DEFAULT_SITE,client,sleep:async()=>assert.fail('Attention must stop without polling')});const index=JSON.parse(await readFile(join(f.root,'.local/today/queue-index.json'),'utf8'));assert(index.items[f.draft.id]);assert.equal((await publicationRecoveryCandidates({root:f.root,site:DEFAULT_SITE,globalData:null})).candidates.length,0);assert.equal((await publicationQueueSnapshot({root:f.root,site:DEFAULT_SITE,globalData:null})).jobs[0].status,'needs_review');assert.equal(f.calls.filter(value=>value.method==='POST').length,1);
});
test('cloud continuation survives source archiving and retains recovery when completed evidence is unavailable',async t=>{
 const f=await fixture(t),{atomic,configureFlow,flowStatus}=await import('../scripts/publishing-flow.mjs'),{resumePublicationQueue}=await import('../scripts/publication-queue-recover.mjs'),flowId='e'.repeat(40),cloudSpace=join(f.root,'cloud-space');let posts=0,archive;
 const website=async(url,request={})=>{
  const path=new URL(url).pathname;
  if(path==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId:DEFAULT_SITE.id,origin:DEFAULT_SITE.origin});
  if(path.endsWith('/source-archives')){archive=JSON.parse(request.body);return Response.json({archiveId:sha(JSON.stringify(archive))});}
  if(path.includes('/source-archives/'))return Response.json({archiveSha256:sha(JSON.stringify(archive)),bundle:archive});
  if(path.includes('/requests/')&&!f.server.submitted)return Response.json({error:'missing'},{status:404});
  if(path.endsWith('/publish')){posts++;f.server.job='success';f.server.publishedVersion=1;}
  if(path==='/manage/api/news/'+f.draft.id)return Response.json({version:f.server.version,publishedVersion:f.server.publishedVersion,data:f.server.data,published:f.server.data});
  return f.fetcher(url,request);
 };
 const queue=createCloudQueue({directory:join(f.root,'cloud-intake'),sites:[{site:DEFAULT_SITE,tokenFile:f.tokenFile,workspaceRoot:cloudSpace}],fetcher:website,continuation:async()=>({status:'queued',id:flowId})}),server=createCloudQueueServer({queue});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});const endpoint='http://127.0.0.1:'+server.address().port;
 await atomic(join(f.root,'.local/publication-queue.json'),{version:1,enabled:true,endpoint,continuationOwner:'cloud'});await atomic(join(cloudSpace,'.local/publishing-flow/jobs',flowId,'state.json'),{status:'waiting',english:{status:'queued'},community:{status:'waiting'}});
 await configureFlow(f.root,DEFAULT_SITE,{version:1,siteId:DEFAULT_SITE.id,origin:DEFAULT_SITE.origin,enabled:true,autoRun:false,authorization:'Existing local continuation remains authorized',articleIds:[f.draft.id],targets:[],translate:false});
 const make=()=>createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,queueKick:async()=>{},fetcher:(url,request)=>url.startsWith(endpoint)?fetch(url,request):website(url,request)}),client=make();
 const prepared=await client.prepare(f.draft.id,{metadata:f.meta,releaseLocal:true});await client.enqueue(f.draft.id,{packetSha256:prepared.prepared.packetSha256});
 // Configuration changes affect future tasks; an already frozen cloud task
 // must not also enter the authorized local continuation queue.
 await atomic(join(f.root,'.local/publication-queue.json'),{version:1,enabled:true,endpoint,continuationOwner:'local'});
 await client.runQueued(f.draft.id);await queue.tick();const published=await client.runQueued(f.draft.id);assert.equal(published.localReleased,true);assert.equal(published.receipt.asyncQueue.continuation.status,'waiting');assert.equal(published.receipt.asyncQueue.binding.packetSha256,prepared.prepared.packetSha256);assert.equal((await flowStatus(f.root)).length,0);assert.equal((await queue.list(DEFAULT_SITE.id))[0].continuationOwner,'cloud');await assert.rejects(readFile(join(f.root,'.local/today',f.draft.id,'prepared.json')),error=>error.code==='ENOENT');
 let kicks=0;await resumePublicationQueue({root:f.root,site:DEFAULT_SITE,id:f.draft.id},{kick:async()=>kicks++});assert.equal(kicks,1);
 await atomic(join(cloudSpace,'.local/publishing-flow/jobs',flowId,'state.json'),{status:'waiting',complete:true,english:{status:'verified'},community:{status:'verified'}});const complete=await make().runQueued(f.draft.id);assert.equal(complete.receipt.asyncQueue.continuation.status,'artifact_pending');assert.equal(posts,1);assert.equal((await publicationQueueSnapshot({root:f.root,site:DEFAULT_SITE,globalData:null})).jobs[0].status,'waiting');
 await resumePublicationQueue({root:f.root,site:DEFAULT_SITE,id:f.draft.id},{kick:async()=>kicks++});assert.equal(kicks,2);
});
test('a deferred local continuation keeps its frozen source available instead of archiving it prematurely',async t=>{
 const f=await fixture(t),{configureFlow,atomic}=await import('../scripts/publishing-flow.mjs');await configureFlow(f.root,DEFAULT_SITE,{version:1,siteId:DEFAULT_SITE.id,origin:DEFAULT_SITE.origin,enabled:true,autoRun:false,authorization:'Approved local continuation',articleIds:[f.draft.id],targets:[],translate:false});await atomic(join(f.root,'.local/publishing-flow/policy.json'),{version:1,siteId:DEFAULT_SITE.id,origin:DEFAULT_SITE.origin,enabled:true,authorization:'',articleIds:[f.draft.id],targets:[],translate:false});
 const client=createWebsitePublisher({root:f.root,tokenFile:f.tokenFile,queueKick:async()=>{},fetcher:async(url,request)=>{const path=new URL(url).pathname;if(path.includes('/requests/')&&!f.server.submitted)return Response.json({error:'missing'},{status:404});if(path.endsWith('/publish')){f.server.job='success';f.server.publishedVersion=1;}return f.fetcher(url,request);}});const prepared=await client.prepare(f.draft.id,{metadata:f.meta,releaseLocal:true});await client.enqueue(f.draft.id,{packetSha256:prepared.prepared.packetSha256});const result=await client.runQueued(f.draft.id);assert.equal(result.receipt.publicReadback,true);assert.equal(result.receipt.asyncQueue.continuation.status,'deferred');assert.equal(result.localReleased,undefined);assert.equal(sha(JSON.stringify(JSON.parse(await readFile(join(f.root,'.local/today',f.draft.id,'prepared.json'),'utf8')))),prepared.prepared.packetSha256);assert.equal(await readFile(join(f.root,f.draft.canonicalPath),'utf8'),f.draft.markdown);assert(!f.calls.some(value=>value.url.includes('/source-archives')));
});
