import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createDraft,readDraft,sha} from '../scripts/editorial-workspace.mjs';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';
import {openStore,createDocument} from '../admin/store.mjs';
import {saveSourceArchive,readSourceArchive} from '../admin/source-archives.mjs';
import {samePublishedContent} from '../scripts/editorial-cloud-release.mjs';
import {asEditorialRecord,recordMarkdown} from '../scripts/editorial-record.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';
import {SITE} from '../scripts/site-config.mjs';

function useTestCredential(t){
 // Windows uses the native/vault credential path; POSIX file-mode checks remain strict.
 if(process.platform==='win32'){const before=process.env.SCHOLAY_TODAY_TOKEN;process.env.SCHOLAY_TODAY_TOKEN='test';t.after(()=>{if(before===undefined)delete process.env.SCHOLAY_TODAY_TOKEN;else process.env.SCHOLAY_TODAY_TOKEN=before;});}
}

async function setup(t,alter=()=>{},{record,remoteVersion=1,retainLocal=false}={}){
 const root=await mkdtemp(join(tmpdir(),'release-copy-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({annexColumns:['新闻聚合'],articles:{}}));
 const draft=await createDraft(record?{id:'record-00000000-0000-4000-8000-000000000001',title:record.fields.title,column:'学术情报',archiveCategory:'学术情报',sectionId:'calendar',record,markdown:recordMarkdown(record.kind,record.fields)}:{id:'release-copy-test',title:'测试原稿',markdown:'# 测试原稿\n\n正文保持完整。'},root);
 const tokenFile=join(root,'token');await writeFile(tokenFile,'test',{mode:0o600});
 useTestCredential(t);
 // Even unused, binary original assets must be archived before the directory can disappear.
 await writeFile(join(dirname(join(root,draft.canonicalPath)),'original.bin'),Buffer.from([0,255,128,1]));
 let data=null,version=0;const bundles=new Map();
 const client=createWebsitePublisher({root,site:{...SITE,retainLocal},tokenFile,fetcher:async(url,options)=>{
 const path=new URL(url).pathname;
 if(path.endsWith('/source-archives')){const bundle=JSON.parse(options.body),id=sha(JSON.stringify(bundle));bundles.set(id,bundle);await alter({root,draft,bundle});return Response.json({archiveId:id});}
 if(path.includes('/source-archives/')){const id=path.split('/').pop();return Response.json({archiveId:id,archiveSha256:id,bundle:bundles.get(id)});}
 if(path.endsWith('/drafts')){const packet=JSON.parse(options.body);data=record?asEditorialRecord({id:draft.id.slice(7),kind:record.kind,updated:'2026-10-16T00:00:00Z'},{...packet.data.record.fields,assets:packet.data.assets}):packet.data;version=remoteVersion;return Response.json({requestKey:packet.requestKey,revision:1,version:1,publishedVersion:null});}
 return Response.json({version,publishedVersion:null,data});
 }});
 const prepare=()=>client.prepare(draft.id,{intent:'draft',releaseLocal:true,metadata:{date:'2026-10-05',author:'测试',category:record?sectionsForSite(SITE).find(s=>s.id==='calendar').name:'学界犀闻',summary:'测试摘要',...(record?{sectionId:'calendar'}:{})}});
 return {root,draft,client,prepare,bundles};
}
async function assertServerAcceptsArchive(t,bundle){
 const root=await mkdtemp(join(tmpdir(),'archive-protocol-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const db=openStore(join(root,'admin.sqlite'));
 try{
  const doc=createDocument(db,'news',{id:bundle.articleId,title:'归档测试',date:'2026-10-05',author:'测试',category:'学界犀闻',summary:'摘要',markdown:'# 归档测试\n\n正文',assets:[]},'actor');
  const proof=saveSourceArchive(db,bundle,'actor',doc);
  assert.equal(proof.archiveId,sha(JSON.stringify(bundle)));
  assert.deepEqual(readSourceArchive(db,proof.archiveId,'actor').bundle,bundle);
 }finally{db.close();}
}

test('successful cloud save archives originals, reads them back, then retires the local copy and preserves the stable ID',async t=>{
 const f=await setup(t,({bundle})=>assertServerAcceptsArchive(t,bundle)),p=await f.prepare(),result=await f.client.saveCloud(f.draft.id,{packetSha256:p.prepared.packetSha256});
 assert.equal(result.localReleased,true);assert.equal(result.stage,'draft_saved');
 const index=JSON.parse(await readFile(join(f.root,'_ops/inventory/article-index.json')));
 assert(!index.articles[f.draft.id]);assert(index.cloudArticles[f.draft.id].cloud.archiveId);
 await assert.rejects(stat(join(f.root,f.draft.canonicalPath)),{code:'ENOENT'});
 const files=[...f.bundles.values()][0].files;assert(files.some(x=>x.path.replaceAll('\\','/').endsWith('/original.bin')&&x.sha256===sha(Buffer.from([0,255,128,1]))));
 assert(files.some(x=>x.path.replaceAll('\\','/').endsWith('/prepared.json')));
 assert.equal((await f.client.inspect(f.draft.id)).localReleased,true);
 assert.equal((await f.client.status(f.draft.id)).localReleased,true);
 assert.equal((await f.client.snapshot()).articles.length,0);
});
const calendarFields={title:'跨年科研会议',sectionId:'calendar',start:'2026-12-30',end:'2027-01-03',category:'学术会议',tags:['会议'],dateBasis:'官方会议日程',summary:'会议日程简介',body:'### 参与步骤\n\n会议正文',sourceName:'主办方',sourceUrl:'https://example.org/conference',provenance:'原文资料',reviewedAt:null};
test('structured records retire after verifying fields and media despite their reconstructed cloud envelope',async t=>{
 const f=await setup(t,undefined,{record:{kind:'year',fields:calendarFields}}),p=await f.prepare();
 const result=await f.client.saveCloud(f.draft.id,{packetSha256:p.prepared.packetSha256});
 assert.equal(result.localReleased,true);assert.equal(f.bundles.size,1);
});
test('structured retirement still rejects a different cloud revision before archiving',async t=>{
 const f=await setup(t,undefined,{record:{kind:'year',fields:calendarFields},remoteVersion:2}),p=await f.prepare();
 const result=await f.client.saveCloud(f.draft.id,{packetSha256:p.prepared.packetSha256});
 assert(!result.localReleased);assert.match(result.cleanupError,/云端内容/);assert.equal(f.bundles.size,0);await readDraft(f.draft.id,f.root);
});
test('structured comparison rejects changed prose, dates, identity, section and image bytes',()=>{
 const row={id:'calendar-record',kind:'year',updated:'2026-10-16T00:00:00Z'},data={...calendarFields,assets:[{path:'/article-media/figure.png',data:'original'}]};
 const remote=asEditorialRecord(row,data),packet={...remote,date:'2026-10-15',summary:'出版摘要',category:'学术日历',author:'另一个展示名称'};
 assert(samePublishedContent(packet,remote));
 // JSON key ordering has no semantic meaning; array and media ordering do.
 assert(samePublishedContent(packet,JSON.parse(JSON.stringify(remote,Object.keys(remote).reverse().concat(Object.keys(remote.record),Object.keys(calendarFields),'path','data')))));
 for(const update of [
   value=>{value.record.fields.body+='\n修改';value.markdown=recordMarkdown('year',value.record.fields);},
   value=>{value.record.fields.start='2027-01-01';},
   value=>{value.record.documentId='other-record';},
   value=>{value.sectionId='observations';},
   value=>{value.assets[0].data='changed';},
   value=>{value.markdown+='\n未同步到字段的正文';},
   value=>{value.title='不同标题';},
 ]){const changed=structuredClone(remote);update(changed);assert.equal(samePublishedContent(packet,changed),false);}
 assert.equal(samePublishedContent({id:'news',date:'2026-10-15'},{id:'news',date:'2026-10-16'}),false);
});
test('private editorial notes archive and restore independently of the public payload',async t=>{
 const f=await setup(t,({bundle})=>assertServerAcceptsArchive(t,bundle)),state=join(f.root,'.local/today',f.draft.id),privateFile=join(state,'internal-notes.json');await mkdir(state,{recursive:true});
 const privateData={version:1,bodySha:f.draft.sha256,internalNotes:{writing:'PRIVATE_ONLY_SENTINEL'},blockNotes:{row:{notes:{supplement:'SUPPLEMENT_PRIVATE_SENTINEL',verification:'ROW_PRIVATE_SENTINEL'},anchor:{type:'paragraph',text:'公开段落'}}},modelSignatures:[]};await writeFile(privateFile,JSON.stringify(privateData));
 const p=await f.prepare(),result=await f.client.saveCloud(f.draft.id,{packetSha256:p.prepared.packetSha256});
 assert.equal(result.localReleased,true);
 const archive=[...f.bundles.values()][0],file=archive.files.find(f=>f.path.endsWith('/internal-notes.json'));
 assert.equal(JSON.parse(Buffer.from(file.data,'base64')).internalNotes.writing,'PRIVATE_ONLY_SENTINEL');
 assert.equal(JSON.parse(Buffer.from(file.data,'base64')).blockNotes.row.notes.supplement,'SUPPLEMENT_PRIVATE_SENTINEL');
 const prepared=[...f.bundles.values()].flatMap(a=>a.files).find(f=>f.path.endsWith('/prepared.json'));
 assert.doesNotMatch(Buffer.from(prepared.data,'base64').toString(),/PRIVATE_ONLY_SENTINEL|ROW_PRIVATE_SENTINEL|SUPPLEMENT_PRIVATE_SENTINEL|internalNotes|blockNotes/);
 await rm(privateFile);await f.client.pull(f.draft.id,{source:'cloud'});
 assert.equal(JSON.parse(await readFile(privateFile,'utf8')).internalNotes.writing,'PRIVATE_ONLY_SENTINEL');
 assert.equal(JSON.parse(await readFile(privateFile,'utf8')).blockNotes.row.notes.verification,'ROW_PRIVATE_SENTINEL');
 assert.equal(JSON.parse(await readFile(privateFile,'utf8')).blockNotes.row.notes.supplement,'SUPPLEMENT_PRIVATE_SENTINEL');
 assert.doesNotMatch((await readDraft(f.draft.id,f.root)).markdown,/PRIVATE_ONLY_SENTINEL|SUPPLEMENT_PRIVATE_SENTINEL/);
});
test('private notes archive on cloud save when the local manuscript is retained',async t=>{
 const f=await setup(t,({bundle})=>assertServerAcceptsArchive(t,bundle),{retainLocal:true}),state=join(f.root,'.local/today',f.draft.id);await mkdir(state,{recursive:true});
 await writeFile(join(state,'internal-notes.json'),JSON.stringify({version:1,bodySha:f.draft.sha256,internalNotes:{other:'PRIVATE_RETAINED'},modelSignatures:[]}));
 const p=await f.client.prepare(f.draft.id,{intent:'draft',metadata:{date:'2026-10-28',author:'测试',category:'学界犀闻',summary:'保留原稿'}});
 const result=await f.client.saveCloud(f.draft.id,{packetSha256:p.prepared.packetSha256});
 assert.equal(result.stage,'draft_saved');assert(!result.localReleased);await readDraft(f.draft.id,f.root);
 assert.equal(f.bundles.size,1);assert.match(Buffer.from([...f.bundles.values()][0].files[0].data,'base64').toString(),/PRIVATE_RETAINED/);
 const pointer=JSON.parse(await readFile(join(state,'private-archive.json'),'utf8'));assert.equal(pointer.version,1);
 await f.client.status(f.draft.id);assert.equal(f.bundles.size,1);
});
test('a private archive failure keeps the manuscript and retries without resubmitting the article',async t=>{
 let fail=true;const f=await setup(t,()=>{if(fail)throw Error('archive offline');},{retainLocal:true}),state=join(f.root,'.local/today',f.draft.id);await mkdir(state,{recursive:true});
 await writeFile(join(state,'internal-notes.json'),JSON.stringify({version:1,bodySha:f.draft.sha256,internalNotes:{writing:'retry safely'},modelSignatures:[]}));
 const p=await f.client.prepare(f.draft.id,{intent:'draft',metadata:{date:'2026-10-28',author:'测试',category:'学界犀闻',summary:'保留原稿'}});
 const first=await f.client.saveCloud(f.draft.id,{packetSha256:p.prepared.packetSha256});assert.match(first.cleanupError,/内部备注未归档/);await readDraft(f.draft.id,f.root);
 fail=false;const retried=await f.client.status(f.draft.id);assert.equal(retried.cleanupError,undefined);assert.equal(retried.receipt.requestKey,first.receipt.requestKey);assert.equal(retried.receipt.revision,1);assert.equal(f.bundles.size,1);
});
test('concurrent edits during archive keep the entire local working copy',async t=>{
 const f=await setup(t,async({root,draft})=>writeFile(join(root,draft.canonicalPath),'# 新修改\n\n不能删除。'));
 const p=await f.prepare(),result=await f.client.saveCloud(f.draft.id,{packetSha256:p.prepared.packetSha256});
 assert(!result.localReleased);assert.match(result.cleanupError,/变化/);assert.match((await readDraft(f.draft.id,f.root)).markdown,/不能删除/);
});
test('immutable server archive validates binary bytes, version, owner and traversal without adding public records',async t=>{
 const root=await mkdtemp(join(tmpdir(),'source-archive-'));const db=openStore(join(root,'db'));t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
 const doc=createDocument(db,'news',{id:'test-source-archive',title:'归档测试',date:'2026-10-05',author:'测试',category:'学界犀闻',summary:'摘要',markdown:'# 归档测试\n\n正文',assets:[]},'actor');
 const bytes=Buffer.from([0,128,255]),input={articleId:'test-source-archive',revision:1,files:[{path:'articles/original.bin',data:bytes.toString('base64'),sha256:sha(bytes)}]};
 const proof=saveSourceArchive(db,input,'actor',doc);assert.deepEqual(readSourceArchive(db,proof.archiveId,'actor').bundle,input);
 assert.deepEqual(saveSourceArchive(db,input,'actor',doc),proof);assert.throws(()=>readSourceArchive(db,proof.archiveId,'other'),/不存在/);
 assert.throws(()=>saveSourceArchive(db,{...input,revision:2},'actor',doc),/版本/);
 assert.throws(()=>saveSourceArchive(db,{...input,files:[{...input.files[0],path:'../bad'}]},'actor',doc),/路径/);
 assert.throws(()=>saveSourceArchive(db,{...input,files:[{...input.files[0],sha256:'0'.repeat(64)}]},'actor',doc),/校验/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM jobs').get().n,0);
});

test('an interrupted indexed release only purges verified staged bytes; extra files block recovery',async t=>{
 const f=await setup(t),p=await f.prepare();await f.client.saveCloud(f.draft.id,{packetSha256:p.prepared.packetSha256});
 const {recoverCloudRelease}=await import('../scripts/editorial-cloud-release.mjs');
 const state=join(f.root,'.local/today',f.draft.id),journal=JSON.parse(await readFile(join(state,'release.json'))),file={path:'articles/staged.md',sha256:sha('archived')};
 await mkdir(join(state,'release-staging'),{recursive:true});await writeFile(join(state,'release-staging/0'),'archived');
 await writeFile(join(state,'release.json'),JSON.stringify({...journal,phase:'indexed',targets:[file.path],files:[file]}));
 await writeFile(join(state,'release-staging/new-file'),'new unarchived text');
 await assert.rejects(recoverCloudRelease(f.root,f.draft.id),/新文件/);assert.equal(await readFile(join(state,'release-staging/new-file'),'utf8'),'new unarchived text');
 await rm(join(state,'release-staging/new-file'));await recoverCloudRelease(f.root,f.draft.id);
 assert.equal(JSON.parse(await readFile(join(state,'release.json'))).phase,'complete');await assert.rejects(stat(join(state,'release-staging')),{code:'ENOENT'});
});

async function actionFixture(t,{queued=false,editDuringArchive=false}={}){
 const root=await mkdtemp(join(tmpdir(),'action-release-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({annexColumns:['新闻聚合'],articles:{}}));
 const draft=await createDraft({id:'public-action-copy',title:'已取回的稿件',markdown:'# 已取回的稿件\n\n应在公开核验后移出本机。'},root);
 const tokenFile=join(root,'token');await writeFile(tokenFile,'test',{mode:0o600});
 useTestCredential(t);
 const state={version:0,publishedVersion:null,data:null,status:queued?'queued':'success',action:null,posts:[],archives:new Map(),badPage:false};
 const {renderArticle}=await import('../scripts/article-format.mjs');
 const client=createWebsitePublisher({root,tokenFile,fetcher:async(url,options)=>{
  const path=new URL(url).pathname;
  if(options.method==='POST')state.posts.push(path);
  if(path.endsWith('/actions')){state.action=JSON.parse(options.body);return Response.json({...state.action,status:state.status,version:1,publishedVersion:state.publishedVersion,url:'/news/'+draft.id+'/',job:{id:'action-job',status:state.status}});}
  if(path.includes('/actions/'))return Response.json({...state.action,status:state.status,version:1,publishedVersion:state.publishedVersion,url:'/news/'+draft.id+'/',job:{id:'action-job',status:state.status}});
  if(path.endsWith('/source-archives')){const bundle=JSON.parse(options.body),id=sha(JSON.stringify(bundle));state.archives.set(id,bundle);if(editDuringArchive)await writeFile(join(root,draft.canonicalPath),'# 新正文\n\n归档时新增的修改必须保留。');return Response.json({archiveId:id});}
  if(path.includes('/source-archives/')){const id=path.split('/').pop();return Response.json({archiveSha256:id,bundle:state.archives.get(id)});}
  if(path.startsWith('/news/'))return state.publishedVersion?new Response('<link rel="canonical" href="https://today.scholay.com/news/'+draft.id+'/"><div class="article-body">'+(state.badPage?'stale':renderArticle(state.data.markdown.replace(/^# [^\n]+\n+/,'')))+'</div>'):new Response('withdrawn',{status:404});
  return Response.json({version:state.version,publishedVersion:state.publishedVersion,data:state.data,published:state.publishedVersion?state.data:null});
 }});
 await client.prepare(draft.id,{metadata:{date:'2026-10-06',author:'测试',category:'学界犀闻',summary:'摘要'}});
 const dir=join(root,'.local/today',draft.id),packet=JSON.parse(await readFile(join(dir,'prepared.json')));state.data=packet.data;state.version=1;state.publishedVersion=queued?null:1;
 // A previously private upload followed by pull has no current preview packet.
 await rm(join(dir,'prepared.json'));await writeFile(join(dir,'receipt.json'),JSON.stringify({requestKey:'old-private-save',intent:'draft',status:'draft_saved',revision:1,submittedAt:'2026-10-05T01:00:00Z'}));
 return {root,draft,client,state};
}
test('publishing a previously private cloud revision retires a matching local pull using its own action proof',async t=>{
 const f=await actionFixture(t);const result=await f.client.cloudAction(f.draft.id,{action:'publish',expectedVersion:1,expectedPublishedVersion:null,confirmed:true});
 assert.equal(result.publicReadback,true);assert.equal(result.localReleased,true);assert.equal(result.status,'success');assert.equal(result.stage,'published');assert.equal((await f.client.snapshot()).articles.length,0);
 assert.equal((await f.client.inspect(f.draft.id)).stage,'published');assert.equal(f.state.archives.size,1);assert(f.state.posts.every(x=>!x.endsWith('/publish')&&!x.endsWith('/drafts')));
 const old=JSON.parse(await readFile(join(f.root,'.local/today',f.draft.id,'receipt.json')));assert.equal(old.requestKey,'old-private-save');
});
test('background reconciliation observes the original action, verifies public content and refreshes retirement without a new submission',async t=>{
 const f=await actionFixture(t,{queued:true});const result=await f.client.cloudAction(f.draft.id,{action:'publish',expectedVersion:1,expectedPublishedVersion:null,confirmed:true});assert.equal(result.status,'queued');
 f.state.status='success';f.state.publishedVersion=1;f.state.badPage=true;let reconciliation=await f.client.reconcile();assert.equal(reconciliation.changed,true);assert.equal((await f.client.inspect(f.draft.id)).stage,'verify');const {pendingCloudDelivery}=await import('../desktop/scripts/agent/workflow.mjs');assert.equal((await pendingCloudDelivery(f.root,f.draft.id)).stage,'verify');assert.equal((await f.client.snapshot()).articles.length,1);
 f.state.badPage=false;reconciliation=await f.client.reconcile();assert.equal(reconciliation.changed,true);assert.equal(reconciliation.results[0].localReleased,true);assert.equal((await f.client.snapshot()).articles.length,0);assert.equal(f.state.posts.filter(x=>x.endsWith('/actions')).length,1);
 assert.deepEqual(await f.client.reconcile(),{changed:false,results:[]});
});
test('an action reports public but cleanup blocked, preserving new local content and the original public request',async t=>{
 const f=await actionFixture(t,{editDuringArchive:true});const result=await f.client.cloudAction(f.draft.id,{action:'publish',expectedVersion:1,expectedPublishedVersion:null,confirmed:true});
 assert.equal(result.publicReadback,true);assert(!result.localReleased);assert.match(result.cleanupError,/变化/);assert.equal((await f.client.inspect(f.draft.id)).stage,'cleanup');assert.match((await readDraft(f.draft.id,f.root)).markdown,/必须保留/);
 assert.equal((await f.client.snapshot()).articles.length,1);assert.equal(f.state.posts.filter(x=>x.endsWith('/actions')).length,1);
});

 test('an explicit desktop push retires verified local copies even when the site defaults to retention',async t=>{
 const f=await setup(t,()=>{},{retainLocal:true}),prepared=await f.prepare();
 const result=await f.client.saveCloud(f.draft.id,{packetSha256:prepared.prepared.packetSha256});
 assert.equal(result.localReleased,true);assert.equal((await f.client.snapshot()).articles.length,0);
 assert([...f.bundles.values()][0].files.some(f=>f.path.endsWith('正文.md')));
 });

test('pushing an editing copy from Works retires it and clears its editing marker',async t=>{
 const {publicationDirectory}=await import('../scripts/site-config.mjs');
 const f=await setup(t),state=join(publicationDirectory(f.root),f.draft.id);
 await mkdir(state,{recursive:true});await writeFile(join(state,'pull-origin.json'),JSON.stringify({entry:null,remoteId:f.draft.id,revision:1,at:'2026-10-29T00:00:00Z'}));
 assert.equal((await f.client.snapshot()).articles[0].editCopy,true);
 const p=await f.prepare(),result=await f.client.saveCloud(f.draft.id,{packetSha256:p.prepared.packetSha256});
 assert.equal(result.localReleased,true);
 await assert.rejects(stat(join(state,'pull-origin.json')),{code:'ENOENT'});
});
