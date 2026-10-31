import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openStore,createDocument,setReview,enqueue,claim,finish,saveDocument,snapshot} from '../admin/store.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {publicationAssetBytes} from '../web/engine/publication-assets.mjs';
import {withPublicationLock} from '../admin/publication-lock.mjs';

const image=Buffer.from('89504e470d0a1a0a00000000','hex');
const path='/article-media/'+createHash('sha256').update(image).digest('hex')+'.png';
const asset={path,data:image.toString('base64')};
const article=id=>({id,title:id,summary:'摘要',markdown:'# 标题\n\n![图注]('+path+')',date:'2026-10-18',assets:[asset]});

test('compact jobs pin new revisions and reuse only published images without changing stored originals',async t=>{
  const root=await mkdtemp(join(tmpdir(),'publication-assets-')),db=openStore(join(root,'db.sqlite'));
  t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
  const old=createDocument(db,'news',article('old-article'),'test');setReview(db,old.id,1,'approved','test');enqueue(db,old.id,1,'publish',Date.now(),'test');
  let job=claim(db);finish(db,job.id,{ok:true,hash:job.snapshot_hash,release:'admin-'+job.id});
  const fresh=createDocument(db,'news',article('new-article'),'test');setReview(db,fresh.id,1,'approved','test');enqueue(db,fresh.id,1,'publish',Date.now(),'test');
  // A newer private draft cannot influence this publication or its image bytes.
  saveDocument(db,fresh.id,{...article('new-article'),title:'private later draft'},1,'test');
  job=claim(db,{reusePublishedAssets:true});
  assert.deepEqual(job.snapshot.news.find(x=>x.id==='old-article').assets,[{path,fromPublished:true}]);
  assert.deepEqual(job.snapshot.news.find(x=>x.id==='new-article').assets,[asset]);
  assert.equal(job.snapshot.news.find(x=>x.id==='new-article').title,'new-article');
  assert.deepEqual(claim(db).snapshot,job.snapshot);
  assert.deepEqual(snapshot(db).news[0].assets,[asset]);
  assert.deepEqual(JSON.parse(db.prepare('SELECT payload FROM revisions WHERE document_id=? AND version=1').get(old.id).payload).assets,[asset]);
  const previous=join(root,'previous');await mkdir(join(previous,'article-media'),{recursive:true});await writeFile(join(previous,path.slice(1)),image);
  const target=join(root,'public'),site=profiles.find(s=>s.id==='pets');
  const manifest=await buildSiteRelease({job,source:process.cwd(),target,previousRoot:previous,site});
  assert.deepEqual(await readFile(join(target,path.slice(1))),image);
  assert(!(await readFile(join(target,'published-content.json'),'utf8')).includes('fromPublished'));
  assert(manifest.hashes[path.slice(1)]);
  finish(db,job.id,{ok:true,hash:job.snapshot_hash,release:manifest.release});
});

test('reused media requires the exact hash, existing file, and a safe path',async t=>{
  const root=await mkdtemp(join(tmpdir(),'publication-corrupt-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await assert.rejects(publicationAssetBytes({path,fromPublished:true},root),{code:'ENOENT'});
  await mkdir(join(root,'article-media'));await writeFile(join(root,path.slice(1)),'corrupt');
  await assert.rejects(publicationAssetBytes({path,fromPublished:true},root),/校验失败/);
  await assert.rejects(publicationAssetBytes({path},root),/缺少/);
  await assert.rejects(publicationAssetBytes({path:'/article-media/../../secret',fromPublished:true},root),/路径无效/);
});

test('academic builds materialize compact and newly staged media, including English-only images',async t=>{
 const root=await mkdtemp(join(tmpdir(),'academic-compact-assets-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const previous=join(root,'previous'),target=join(root,'public');await mkdir(join(previous,'article-media'),{recursive:true});await writeFile(join(previous,path.slice(1)),image);
 const site={...profiles.find(s=>s.id==='scholay-today'),languages:['zh-CN','en']};
 const chinese={...article('compact-article'),assets:[{path,fromPublished:true}]};
 const english={...article('english-only-image'),locale:'en',assets:[{path,fromPublished:true}]};
 const snapshot={news:[chinese,english],data:{year:[{id:'fixture-year',title:'会议',start:'2026-11-01',summary:'会议摘要',sourceName:'官网',sourceUrl:'https://example.org/event',provenance:'已核验官网'}],history:[{id:'fixture-history',title:'历史',dateKey:'01-01',year:2000,factSummary:'历史摘要',historicalSignificance:'意义',sources:[{label:'来源',url:'https://example.org/history'}]}]},openSource:{items:[{title:'工具',date:'2026-11-01',summary:'工具摘要',value:'用途',url:'https://example.org/tool'}]},permalinks:{'news:english-only-image':'/en/news/english-only-image/'}};
 const before=JSON.stringify(snapshot),manifest=await buildSiteRelease({job:{id:'compact',snapshot,snapshot_hash:'fixture'},source:process.cwd(),target,previousRoot:previous,site});
 assert.equal(JSON.stringify(snapshot),before);assert.deepEqual(await readFile(join(target,path.slice(1))),image);assert.equal(manifest.byteHashes[path.slice(1)],createHash('sha256').update(image).digest('hex'));
 const staged=join(root,'staged');await mkdir(join(staged,'article-media'),{recursive:true});await writeFile(join(staged,path.slice(1)),image);
 await buildSiteRelease({job:{id:'new-stage',snapshot:{...snapshot,news:[{...chinese,assets:[]}]},snapshot_hash:'fixture'},source:process.cwd(),target:staged,site});
 assert.match(await readFile(join(staged,'news/compact-article/index.html'),'utf8'),/article-media/);
});

test('flock serializes independent publication attempts and releases on failure',{skip:process.platform!=='linux'},async t=>{
  const root=await mkdtemp(join(tmpdir(),'publication-lock-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const lock=join(root,'lock');await writeFile(lock,'');let called=false;
  await assert.rejects(withPublicationLock(lock,async()=>{
    await withPublicationLock(lock,async()=>{called=true;});assert.equal(called,false);throw Error('failed job');
  }),/failed job/);
  await withPublicationLock(lock,async()=>{called=true;});assert.equal(called,true);
});
