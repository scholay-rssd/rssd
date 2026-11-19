import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {openNotebook,exportNotebook,checkNotebook} from '../desktop/scripts/agent/notebook-store.mjs';
import {randomUUID} from 'node:crypto';
import {emptyWritingContext,migrateSourcesToContext,validateWritingContext,publicContextView,sourceEvidenceLinks,toolReadEvidence} from '../desktop/scripts/agent/writing-context.mjs';
import {recordToolRead,loadWritingContext,saveWritingContext,mountResource,unmountResource,adjustMountScope,searchMount,readMount,citeEvidence,freezeWritingContext,restoreBoundContext,assertContextScope,exportContextPath,applyMountList} from '../desktop/scripts/agent/writing-context-store.mjs';
import {parseMountSpec,parseProduceMounts,parseBriefMounts} from '../desktop/scripts/agent/resources/mount-spec.mjs';
import {parseDocument,sliceDocument} from '../desktop/scripts/agent/resources/parse-document.mjs';
import {zip} from '../desktop/scripts/agent/resources/zip.mjs';
import {resolveGithubMount,readGithubFile} from '../desktop/scripts/agent/resources/github.mjs';
import {readPublicPage,webSearchCandidate} from '../desktop/scripts/agent/resources/web.mjs';
import {resolveTimeRange,resolveRssMount,queryRssArticles} from '../desktop/scripts/agent/resources/rss.mjs';
import {parseArgs} from '../desktop/scripts/agent/headless/produce.mjs';
import {publicationDirectory} from '../scripts/site-config.mjs';

const blank=()=>({version:2,title:'短文',kind:'article',skills:[],blocks:[{id:'body',type:'paragraph',text:'正式正文足够长，用于导出。',state:'ready',sourceIds:[]}],groups:[],sources:[],fields:{},assets:{},mounts:{templates:[],brands:[]}});

test('GitHub reads require an explicitly mounted file and reject traversal before I/O',async()=>{
 const store={dir:()=>{throw Error('unexpected filesystem access');}},version={snapshot:{owner:'acme',repo:'tools',commit:'a'.repeat(40),files:[]}};
 const fetcher=async()=>{throw Error('unexpected network access');};
 await assert.rejects(readGithubFile(store,'task',{version},'README.md',fetcher),/目录范围/);
 for(const path of ['../private','/absolute','docs/../../private','C:/private','docs\\private']){
  version.snapshot.files=[{path}];await assert.rejects(readGithubFile(store,'task',{version},path,fetcher),/路径无效/);
 }
});

test('public page reads reject redirects to local services before following them',async()=>{
 const calls=[];
 await assert.rejects(readPublicPage('https://example.org/article',async(url,options)=>{calls.push(url);assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});}),/无法读取网页/);
 assert.deepEqual(calls,['https://example.org/article']);
});

test('headless agent selection and resource mounts coexist across all site mappings',async()=>{
 const {profiles}=await import('../scripts/site-config.mjs');
 const {spaceIdOf}=await import('../desktop/scripts/agent/headless/env.mjs');
 for(const profile of profiles)assert.equal(spaceIdOf(profile.id),profile.spaceId);
 assert.equal(spaceIdOf('today'),'academic');
 const args=parseArgs(['pets','stories','essay','brief.txt','--agent','codex','--mount','github:acme/tools@v1,dirs=docs','--allow-network','--no-publish']);
 assert.equal(args.agentId,'codex');assert.equal(args.mounts.length,1);assert.equal(args.allowNetwork,true);assert.equal(args.noPublish,true);
});

async function workspace(t){
 const root=await mkdtemp(join(tmpdir(),'today-writing-context-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'_ops/inventory'),{recursive:true});
 await mkdir(join(root,'articles'));
 await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{'draft-old':{id:'draft-old',title:'旧稿',sha256:'abc',sectionId:'observations',canonicalPath:'articles/old.md'}},annexColumns:[]}));
 return root;
}
async function fixture(t,extra={}){
 const root=await workspace(t);
 const store=new TaskStore(root);
 let task=await openNotebook(store,(await store.create({mode:'observation',skill:'unskilled'})).id);
 task=await store.update(task.id,{notebook:{...blank(),...extra.notebook}},task.revision);
 return {root,store,task};
}
function seedRss(path,{folder='学界',extra=[]}={}){
 const db=new DatabaseSync(path);
 db.exec(`CREATE TABLE folders(id INTEGER PRIMARY KEY, name TEXT, position INTEGER);
  CREATE TABLE feeds(id INTEGER PRIMARY KEY, title TEXT, folder_id INTEGER);
  CREATE TABLE library_archived_feeds(feed_id INTEGER);
  CREATE TABLE library_folder_links(folder_id INTEGER, parent_id INTEGER);
  CREATE TABLE articles(id INTEGER PRIMARY KEY, feed_id INTEGER, title TEXT, url TEXT, published_at TEXT, fetched_at TEXT, is_starred INTEGER, body_text TEXT, author TEXT);`);
 db.prepare('INSERT INTO folders(id,name,position) VALUES(1,?,0)').run(folder);
 db.prepare('INSERT INTO feeds(id,title,folder_id) VALUES(1,?,1)').run('学报');
 const now=new Date();
 const rows=[{id:11,title:'第一篇',days:2,starred:1,body:'甲文'},{id:12,title:'第二篇',days:10,starred:0,body:'乙文'},...extra];
 for(const row of rows){
  const published=new Date(now);published.setUTCDate(published.getUTCDate()-(row.days||1));
  db.prepare('INSERT INTO articles(id,feed_id,title,url,published_at,fetched_at,is_starred,body_text,author) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(row.id,1,row.title,'https://example.org/'+row.id,published.toISOString(),published.toISOString(),row.starred||0,row.body||'', '');
 }
 db.close();
}

test('old notebook sources migrate without rewriting the article body',()=>{
 const sources=[{id:'s1',title:'旧来源',summary:'摘要',url:'https://example.org/a',acquiredVia:'rss',rssId:'11',reviewed:false}];
 const context=migrateSourcesToContext(sources,'draft-1','academic');
 assert.equal(context.schemaVersion,1);
 assert.equal(context.mounts.length,1);
 assert.equal(context.resources[context.mounts[0].resourceId].kind,'rss');
 assert.deepEqual(validateWritingContext(context).citations,[]);
 assert.equal(publicContextView(context).resources[0].title,'旧来源');
});

test('cross-space reads are rejected',async t=>{
 const {store,task}=await fixture(t);
 const context=emptyWritingContext(task.articleId,task.spaceId||'academic');
 await saveWritingContext(store,task,context);
 await assert.rejects(()=>loadWritingContext(store,{...task,spaceId:'pets'}),/跨空间/);
 const live=await loadWritingContext(store,task);
 assert.throws(()=>assertContextScope({...task,articleId:'draft-other'},{articleId:'draft-other'},live,store),/上下文不属于当前文章/);
 const rebound=await loadWritingContext(store,{...task,articleId:'record-switched'});
 assert.equal(rebound.articleId,'record-switched');
});

test('dynamic RSS ranges freeze to article IDs and later arrivals stay out',async t=>{
 const {root,store,task}=await fixture(t);
 const db=join(root,'papr.db');
 seedRss(db);
 process.env.SCHOLAY_RSS_DB=db;
 t.after(()=>delete process.env.SCHOLAY_RSS_DB);
 const mounted=await mountResource(store,task,{kind:'rss',group:'学界',range:'30d'});
 assert.equal(mounted.mounted,true);
 const frozen=await freezeWritingContext(store,task,'run-1');
 const ids=frozen.mounts[0].scope.articleIds;
 assert.deepEqual([...ids].sort((a,b)=>a-b),[11,12]);
 const later=new DatabaseSync(db);
 later.prepare('INSERT INTO articles(id,feed_id,title,url,published_at,fetched_at,is_starred,body_text,author) VALUES(13,1,?,?,?,?,0,?,?)').run('新到','https://example.org/13',new Date().toISOString(),new Date().toISOString(),'丙文','');
 later.close();
 const live=queryRssArticles(task.spaceId,root,{folderId:1,start:resolveTimeRange('30d').start,end:new Date().toISOString()});
 assert.ok(live.some(a=>a.id===13));
 const search=await searchMount(store,task,frozen.mounts[0].id,'');
 assert.equal(search.items.some(a=>a.id===13),false);
 assert.deepEqual(search.items.map(a=>a.id).sort((a,b)=>a-b),[11,12]);
});

test('file updates create a new hash and leave the previous mount on the old copy',async t=>{
 const {store,task}=await fixture(t);
 const dir=await mkdtemp(join(tmpdir(),'today-book-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'notes.md');
 await writeFile(path,'# One\nfirst\n# Two\nsecond\n');
 const first=await mountResource(store,task,{kind:'file',path,chapters:'1-1'});
 const hash1=first.context.versions[0].contentHash;
 await writeFile(path,'# One\nchanged\n# Two\nsecond\n');
 const second=await mountResource(store,task,{kind:'file',path,whole:true});
 assert.notEqual(second.context.versions.at(-1).contentHash,hash1);
 const old=await readMount(store,task,first.context.mounts[0].id,{chapterId:'h1'});
 assert.match(old.evidence.text,/first/);
 assert.doesNotMatch(old.evidence.text,/changed/);
});

test('scanned PDFs are marked needs_ocr and are not searchable as full text',()=>{
 const bytes=Buffer.concat([Buffer.from('%PDF-1.1\n'),Buffer.alloc(5000,1)]);
 const parsed=parseDocument(bytes,'scan.pdf');
 assert.equal(parsed.needsOcr,true);
 assert.equal(parsed.coverage,'none');
});

test('markdown, txt, text PDF and EPUB keep location-preserving slices',()=>{
 const md=parseDocument(Buffer.from('# Intro\nhello\n# Body\nworld\n'),'a.md');
 assert.equal(md.locationKind,'line');
 assert.equal(sliceDocument(md,{chapterIds:['h2']}).chapters[0].title,'Body');
 const txt=parseDocument(Buffer.from('plain text'),'a.txt');
 assert.equal(txt.chapters[0].text,'plain text');
 const pdf=parseDocument(Buffer.from('%PDF-1.1\n1 0 obj<< /Type /Page >>endobj\nstream\nBT (Hello page) Tj\nET\nendstream\n'),'a.pdf');
 assert.equal(pdf.locationKind,'page');
 assert.match(pdf.chapters[0].text,/Hello page/);
 const epub=zip(new Map([
  ['META-INF/container.xml','<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
  ['OEBPS/content.opf','<?xml version="1.0"?><package><metadata><dc:title>Demo Book</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>'],
  ['OEBPS/c1.xhtml','<html><body><h1>Chapter</h1><p>ebook text</p></body></html>'],
 ]),true);
 const book=parseDocument(epub,'book.epub');
 assert.equal(book.kind,'epub');
 assert.match(book.chapters[0].text,/ebook text/);
});

test('GitHub truncated trees fetch subtrees and do not claim a complete repo read',async()=>{
 const calls=[];
 const fetcher=async url=>{
  calls.push(url);
  if(url.includes('/commits/main'))return {ok:true,status:200,json:async()=>({sha:'a'.repeat(40),commit:{message:'fix'},html_url:'https://github.com/o/r'})};
  if(url.includes('/git/trees/'+'a'.repeat(40)+'?recursive=1'))return {ok:true,status:200,json:async()=>({truncated:true,tree:[{path:'docs',type:'tree',sha:'b'.repeat(40)}]})}
  if(url.includes('/git/trees/'+'a'.repeat(40))&&!url.includes('recursive'))return {ok:true,status:200,json:async()=>({tree:[{path:'docs',type:'tree',sha:'b'.repeat(40)},{path:'README.md',type:'blob',sha:'c'.repeat(40),size:12}]})};
  if(url.includes('/git/trees/'+'b'.repeat(40)+'?recursive=1'))return {ok:true,status:200,json:async()=>({truncated:false,tree:[{path:'guide.md',type:'blob',sha:'d'.repeat(40),size:20}]})};
  throw Error('unexpected '+url);
 };
 const mounted=await resolveGithubMount({repo:'o/r',ref:'main',dirs:['docs','README.md']},fetcher);
 assert.equal(mounted.version.snapshot.treeTruncated,true);
 assert.equal(mounted.version.snapshot.completeTree,false);
 assert.ok(mounted.version.gaps.some(g=>/截断/.test(g)));
 assert.deepEqual(mounted.version.snapshot.files.map(f=>f.path).sort(),['README.md','docs/guide.md']);
});

test('network failure is visible and fetch time is not a publication date',async()=>{
 await assert.rejects(readPublicPage('https://example.org/x',async()=>{throw Error('offline');}),/无法读取网页/);
 const page=await readPublicPage('https://example.org/x',async()=>({ok:true,status:200,headers:{get:()=>'text/html'},arrayBuffer:async()=>Buffer.from('<html><head><title>Note</title></head><body>hi</body></html>')}));
 assert.equal(page.publishedAt,null);
 assert.match(page.dateBasis,/不能当作发表日期/);
 const candidate=webSearchCandidate('大模型');
 assert.equal(candidate.acquiredVia,'search');
});

test('unmount keeps citations and evidence snapshots',async t=>{
 const {store,task}=await fixture(t);
 const dir=await mkdtemp(join(tmpdir(),'today-cite-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'a.txt');
 await writeFile(path,'quoted line');
 const mounted=await mountResource(store,task,{kind:'file',path,whole:true});
 const read=await readMount(store,task,mounted.context.mounts[0].id,{});
 await citeEvidence(store,task,{evidenceId:read.evidence.id,blockId:'body',label:'注1'});
 const gone=await unmountResource(store,task,mounted.context.mounts[0].id);
 assert.equal(gone.context.mounts.length,0);
 assert.equal(gone.context.evidence.length,1);
 assert.equal(gone.context.citations.length,1);
 assert.equal(gone.keptCitations,1);
});

test('old-format restore and export bind context to body SHA without publishing caches',async t=>{
 const {root,store,task}=await fixture(t,{notebook:{...blank(),sectionId:'observations',sources:[{id:'s1',title:'网页',summary:'',url:'https://example.org/old',acquiredVia:'web',reviewed:false}]}});
 const migrated=await loadWritingContext(store,task);
 assert.equal(migrated.mounts.length,1);
 const ready=await store.get(task.id);
 const done=await exportNotebook(store,task.id,ready.revision);
 const sidecar=JSON.parse(await readFile(exportContextPath(root,task.articleId),'utf8'));
 assert.equal(sidecar.bodySha,done.delivery.sha256);
 assert.equal(sidecar.schemaVersion,1);
 const notebook=JSON.parse(await readFile(join(publicationDirectory(root),task.articleId,'notebook.json'),'utf8'));
 assert.equal(notebook.document.blocks[0].text,'正式正文足够长，用于导出。');
 const restored=await restoreBoundContext(store,done,done.delivery.sha256);
 assert.equal(restored.bodySha,done.delivery.sha256);
});

test('scope checks reject the wrong mount version',async t=>{
 const {store,task}=await fixture(t);
 const dir=await mkdtemp(join(tmpdir(),'today-scope-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'a.md');
 await writeFile(path,'# A\none\n# B\ntwo\n');
 const mounted=await mountResource(store,task,{kind:'file',path,whole:true});
 const adjusted=await adjustMountScope(store,task,mounted.context.mounts[0].id,{chapterIds:['h1']});
 await assert.rejects(readMount(store,task,mounted.context.mounts[0].id,{chapterId:'h2'},{versionId:mounted.context.mounts[0].versionId}),/版本/);
 const ok=await readMount(store,task,mounted.context.mounts[0].id,{chapterId:'h1'},{versionId:adjusted.versionId});
 assert.match(ok.evidence.text,/one/);
});

test('headless mount specs parse CLI flags and brief frontmatter',async()=>{
 assert.deepEqual(parseMountSpec('rss:group=学界,range=30d'),{kind:'rss',articleId:undefined,group:'学界',folderId:undefined,feedId:undefined,starred:false,range:'30d',query:undefined,role:undefined});
 assert.equal(parseMountSpec('file:/tmp/book.epub,chapters=1-3').chapters,'1-3');
 assert.deepEqual(parseMountSpec('github:acme/tools@v1,dirs=docs|src'),{kind:'github',repo:'acme/tools',ref:'v1',dirs:['docs','src'],role:undefined});
 const parsed=parseProduceMounts(['today','observations','observation','brief.txt','--allow-network','--mount','rss:group=学界,range=7d']);
 assert.equal(parsed.allowNetwork,true);
 assert.equal(parsed.mounts[0].group,'学界');
 assert.deepEqual(parsed.argv,['today','observations','observation','brief.txt']);
 const args=parseArgs(['today','observations','observation','brief.txt','--no-publish','--mount','github:acme/tools@v1,dirs=docs']);
 assert.equal(args.noPublish,true);
 assert.equal(args.mounts[0].repo,'acme/tools');
 const brief=parseBriefMounts('---\nmount: rss:group=学界,range=30d\nmount: github:acme/tools@v1,dirs=docs\nallow-network: true\n---\n写一篇综述\n');
 assert.equal(brief.text,'写一篇综述\n');
 assert.equal(brief.allowNetwork,true);
 assert.equal(brief.mounts[0].group,'学界');
 assert.equal(brief.mounts[1].repo,'acme/tools');
});

test('headless produce mounts pin RSS collections and GitHub commits',async t=>{
 const {root,store,task}=await fixture(t);
 const db=join(root,'papr.db');
 seedRss(db);
 process.env.SCHOLAY_RSS_DB=db;
 t.after(()=>delete process.env.SCHOLAY_RSS_DB);
 const fetcher=async url=>{
  if(url.includes('/commits/v1'))return {ok:true,status:200,json:async()=>({sha:'e'.repeat(40),commit:{message:'release'},html_url:'https://github.com/acme/tools'})};
  if(url.includes('/git/trees/'+'e'.repeat(40)))return {ok:true,status:200,json:async()=>({truncated:false,tree:[{path:'docs/guide.md',type:'blob',sha:'f'.repeat(40),size:20},{path:'src/main.rs',type:'blob',sha:'1'.repeat(40),size:8}]})};
  throw Error('unexpected '+url);
 };
 const spec=parseProduceMounts(['today','observations','observation','brief.txt','--mount','rss:group=学界,range=30d','--mount','github:acme/tools@v1,dirs=docs']);
 const mounted=await applyMountList(store,task,spec.mounts,{fetcher});
 assert.equal(mounted.context.mounts.length,2);
 const rss=mounted.context.mounts.find(m=>mounted.context.resources.find(r=>r.id===m.resourceId)?.kind==='rss');
 const github=mounted.context.mounts.find(m=>mounted.context.resources.find(r=>r.id===m.resourceId)?.kind==='github');
 assert.deepEqual([...rss.scope.articleIds].sort((a,b)=>a-b),[11,12]);
 assert.equal(github.scope.commit,'e'.repeat(40));
 const version=mounted.context.versions.find(v=>v.id===github.versionId);
 assert.deepEqual(version.snapshot.files.map(f=>f.path),['docs/guide.md']);
 const frozen=await freezeWritingContext(store,task,'headless-run');
 assert.equal(frozen.mounts.find(m=>m.id===rss.id).scope.range.frozen,true);
 await assert.rejects(readMount(store,task,github.id,{path:'docs/guide.md'}),/未允许联网/);
});

test('native allowlist includes every context bridge method',async()=>{
 const native=await readFile(new URL('../desktop/src-tauri/src/cursor_agent.rs',import.meta.url),'utf8');
 const bridge=await readFile(new URL('../desktop/scripts/agent/bridge.mjs',import.meta.url),'utf8');
 const allowlist=native.match(/if !\[([^\]]+)\]\.contains\(&method\.as_str\(\)\)/)?.[1]||'';
 const allowed=new Set([...allowlist.matchAll(/"([^"]+)"/g)].map(x=>x[1]));
 const methods=[...bridge.matchAll(/method==='(context_[^']+)'/g)].map(x=>x[1]);
 assert.ok(methods.includes('context_mount'));
 for(const method of methods)assert.ok(allowed.has(method),`native bridge rejects ${method}`);
});

 test('web connector rejects HTTP-200 verification pages instead of recording source evidence',async()=>{
 for(const body of ['<title>Just a moment...</title>','<title>Chinese Text Project</title><p>Checking the security of your connection...</p>'])await assert.rejects(readPublicPage('https://example.org/source',async()=>new Response(body,{headers:{'content-type':'text/html'}})),/未读取正文/);
 const page=await readPublicPage('https://example.org/source',async()=>new Response('<title>Research</title><!-- private stale template -->Actual article text',{headers:{'content-type':'text/html'}}));assert.doesNotMatch(page.text,/private stale/);assert.match(page.text,/Actual article/);
 });

function addRead(context,{kind='web',role='evidence',locator,gap}){
 const resourceId=randomUUID(),versionId=randomUUID(),mountId=randomUUID(),id=randomUUID();
 context.resources[resourceId]={id:resourceId,kind,title:'资料',locator:{},createdAt:context.updatedAt};
 context.versions[versionId]={id:versionId,resourceId,immutable:true,createdAt:context.updatedAt,contentHash:'h',label:'page',snapshot:{}};
 context.mounts.push({id:mountId,resourceId,versionId,enabled:true,role,state:'ready',scope:{}});
 context.evidence.push({id,mountId,versionId,locator,text:'原文片段',hash:'h',truncated:false,readAt:context.updatedAt,...(gap?{gap}:{})});
 return id;
}
const cites=(id,sourceIds,state='ready')=>({id,type:'paragraph',text:'正文',state,sourceIds});
const source=(id,url,extra={})=>({id,title:'来源'+id,summary:'摘要',url,acquiredVia:'web',reviewed:false,...extra});

test('cited sources are matched to what was read by address or RSS id',()=>{
 const context=emptyWritingContext('article-x','academic');
 const web=addRead(context,{locator:{url:'https://www.example.org/paper/?utm_source=feed#top'}});
 const rss=addRead(context,{kind:'rss',locator:{articleId:42,url:'https://news.example.org/a'}});
 const repo=addRead(context,{kind:'github',locator:{owner:'Acme',repo:'tools',commit:'a'.repeat(40),path:'docs/guide.md',url:'https://github.com/Acme/tools/blob/'+'a'.repeat(40)+'/docs/guide.md#L1-L9'}});
 addRead(context,{kind:'signals',role:'lead',locator:{term:'热词',url:'https://hot.example.org/'}});
 addRead(context,{role:'lead',locator:{url:'https://lead.example.org/'}});
 addRead(context,{kind:'rss',locator:{articleId:7,url:'https://news.example.org/b'},gap:'缺正文'});
 const notebook={blocks:[cites('p1',['web','rss','repo','repo-root']),cites('p2',['hot','lead','summary','web']),cites('p3',['checked']),cites('draft',['draft-only'],'placeholder')],sources:[
  source('web','https://example.org/paper'),
  source('rss','https://elsewhere.example.org/moved',{acquiredVia:'rss',rssId:'42'}),
  source('repo','https://github.com/acme/tools/blob/main/docs/guide.md'),
  source('repo-root','https://github.com/acme/tools'),
  source('hot','https://hot.example.org/'),
  source('lead','https://lead.example.org/'),
  source('summary','https://news.example.org/b',{acquiredVia:'rss',rssId:7}),
  source('checked','https://unread.example.org/',{reviewed:true}),
  source('draft-only','https://draft.example.org/'),
  source('uncited','https://uncited.example.org/'),
 ]};
 const {links,gaps}=sourceEvidenceLinks(notebook,validateWritingContext(context));
 assert.deepEqual(links,[
  {sourceId:'web',blockIds:['p1','p2'],evidenceId:web},
  {sourceId:'rss',blockIds:['p1'],evidenceId:rss},
  {sourceId:'repo',blockIds:['p1'],evidenceId:repo},
  {sourceId:'repo-root',blockIds:['p1'],evidenceId:repo},
 ]);
 assert.deepEqual(gaps.map(g=>[g.sourceId,g.reason,g.blockIds]),[['hot','unread',['p2']],['lead','unread',['p2']],['summary','summary-only',['p2']]]);
});

test('export records cited reads and leaves unread sources as private to-dos without blocking',async t=>{
 const {root,store,task}=await fixture(t,{notebook:{...blank(),sectionId:'observations',blocks:[cites('body',['read','unread'])],sources:[source('read','https://example.org/read'),source('unread','https://example.org/unread')]}});
 const context=await loadWritingContext(store,task);
 const read=addRead(context,{locator:{url:'https://example.org/read'}});
 const manual=addRead(context,{locator:{url:'https://example.org/other'}});
 context.citations.push({id:randomUUID(),blockId:'body',evidenceId:manual,label:'注1'});
 await saveWritingContext(store,task,context);
 const checked=await checkNotebook(store,await store.get(task.id));
 assert.equal(checked.ready,true,checked.issues.join('；'));
 assert.equal(checked.notices.length,1);
 assert.match(checked.notices[0],/https:\/\/example\.org\/unread.*没有对应的已读原文.*引用行：body/);
 const done=await exportNotebook(store,task.id,(await store.get(task.id)).revision);
 assert.ok(done.completedAt);
 const note=done.notebook.blockNotes.body.notes.verification;
 assert.match(note,/来源「来源unread」/);
 assert.doesNotMatch(note,/来源read」/);
 const notes=JSON.parse(await readFile(join(publicationDirectory(root),task.articleId,'internal-notes.json'),'utf8'));
 assert.equal(notes.blockNotes.body.notes.verification,note);
 const sidecar=JSON.parse(await readFile(exportContextPath(root,task.articleId),'utf8'));
 assert.deepEqual(sidecar.citations.map(c=>[c.label,c.blockId,c.evidenceId]),[['注1','body',manual],['source:read','body',read]]);
 const {reloadNotebookDraft}=await import('../desktop/scripts/agent/notebook-store.mjs');
 const reopened=await reloadNotebookDraft(store,done.id,done.revision,{reopen:true});
 const again=await exportNotebook(store,reopened.id,reopened.revision);
 assert.equal(again.notebook.blockNotes.body.notes.verification,note);
 const resaved=JSON.parse(await readFile(exportContextPath(root,task.articleId),'utf8'));
 assert.deepEqual(resaved.citations.map(c=>c.label),['注1','source:read']);
});

test('library reads become read records only when they returned text',()=>{
 assert.deepEqual(toolReadEvidence('article_read',{article_id:9},{articleId:9,status:'cleaned',title:'论文',sourceUrl:'https://example.org/a',publishedAt:'2026-01-02',sourceKind:'cleaned',offset:0,complete:false,blocks:[{markdown:'## 方法'},{text:'正文'}]}),
  {via:'article_read',locator:{articleId:9,url:'https://example.org/a',title:'论文',publishedAt:'2026-01-02',sourceKind:'cleaned',offset:0},text:'## 方法\n\n正文',truncated:true});
 assert.equal(toolReadEvidence('article_read',{article_id:9},{articleId:9,status:'not_cleaned',hint:'尚无正文'}),null);
 assert.deepEqual(toolReadEvidence('page_read',{url:'https://example.org/p?x=1'},{status:'captured',requestedUrl:'https://example.org/p?x=1',document:{sourceUrl:'https://example.org/p',title:'页面',sourceKind:'browser_dom'},text:'页面正文',dateBasis:'not_provided',complete:true}),
  {via:'page_read',locator:{url:'https://example.org/p',title:'页面',publishedAt:undefined,dateBasis:'not_provided',sourceKind:'browser_dom'},text:'页面正文',truncated:false});
 assert.equal(toolReadEvidence('page_read',{url:'https://example.org/p'},{status:'blocked',text:'x'}),null);
 assert.equal(toolReadEvidence('feed_read',{},{status:'captured',text:'x'}),null);
 assert.throws(()=>validateWritingContext({...emptyWritingContext('article-x','academic'),evidence:[{id:'e',via:'draft_read',locator:{},text:'x',hash:'h',readAt:'now'}]}),/已读证据格式无效/);
 assert.throws(()=>validateWritingContext({...emptyWritingContext('article-x','academic'),evidence:[{id:'e',locator:{},text:'x',hash:'h',readAt:'now'}]}),/上下文字段无效/);
});

test('recorded library reads back the sources they read, once each',async t=>{
 const {store,task}=await fixture(t,{notebook:{...blank(),sectionId:'observations',blocks:[cites('body',['rss','page','other'])],sources:[source('rss','https://moved.example.org/a',{acquiredVia:'rss',rssId:'9'}),source('page','https://example.org/p/'),source('other','https://example.org/other')]}});
 const article={articleId:9,status:'cached',sourceUrl:'https://example.org/a',markdown:'读到的正文',complete:true};
 const first=await recordToolRead(store,task,{tool:'article_read',input:{article_id:9},result:article,runId:'run-1'});
 assert.equal(first.via,'article_read');assert.equal(first.runId,'run-1');
 assert.equal((await recordToolRead(store,task,{tool:'article_read',input:{article_id:9},result:article})).id,first.id);
 assert.equal(await recordToolRead(store,task,{tool:'article_read',input:{article_id:9},result:{articleId:9,status:'not_cleaned'}}),null);
 await recordToolRead(store,task,{tool:'page_read',input:{url:'https://example.org/p'},result:{status:'captured',document:{sourceUrl:'https://example.org/p'},text:'页面正文',complete:true}});
 const context=await loadWritingContext(store,task);
 assert.equal(context.evidence.length,2);assert.equal(context.mounts.length,3);
 const {links,gaps}=sourceEvidenceLinks((await store.get(task.id)).notebook,context);
 assert.deepEqual(links.map(l=>l.sourceId),['rss','page']);
 assert.deepEqual(gaps.map(g=>g.sourceId),['other']);
 const done=await exportNotebook(store,task.id,(await store.get(task.id)).revision);
 assert.match(done.notebook.blockNotes.body.notes.verification,/来源other」/);
 assert.doesNotMatch(done.notebook.blockNotes.body.notes.verification,/来源rss」|来源page」/);
 const plain=await store.create({mode:'observation',skill:'unskilled'});
 assert.equal(await recordToolRead(store,plain,{tool:'article_read',input:{article_id:9},result:article}),null);
});
