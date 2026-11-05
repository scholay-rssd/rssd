import test from 'node:test';
import {protectPrivateFile} from '../scripts/private-file.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Fastify from 'fastify';
import {profiles,setSiteContext} from '../scripts/site-config.mjs';
import {openStore,claim,finish,snapshot,readDocument,saveDocument} from '../admin/store.mjs';
import {submitNews,registerNewsApi} from '../admin/news-api.mjs';
import {asEditorialRecord,recordMarkdown,withRecordSourceLinks} from '../scripts/editorial-record.mjs';
import {sourceContentSha256,editionArticleId} from '../contracts/language-editions.mjs';
import {validateNews} from '../admin/news.mjs';
import {configureFlow,enqueuePublished,flowStatus,todayTick,externalPackage} from '../scripts/publishing-flow.mjs';
import {flowWebsite} from '../scripts/publishing-flow-website.mjs';
import {postizAdapter} from '../scripts/publishing-flow-postiz.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {digest} from '../admin/model.mjs';

const site={...profiles.find(x=>x.id==='enter'),languages:['zh-CN','en']};
const documentId='91e52c25-5d3b-4911-9b24-769157a52079',articleId='record-'+documentId;
const targets=[{platform:'discord',locale:'zh-CN',integrationId:'discord-account',channelId:'1562031229606301696',format:'summary'},{platform:'devto',locale:'en',integrationId:'devto-account',format:'article'}];
const topic='https://enterscholar.com/t/-/415723';
async function fixture(t){
 setSiteContext(site);
 const root=await mkdtemp(join(tmpdir(),'structured-publishing-')),db=openStore(join(root,'admin.sqlite'));
 t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
 const fields={title:'开放课程与工具',date:'2026-10-23',category:site.sourceCategories[0],summary:'完整项目简介。\n\n![原图](https://example.org/image.webp)',value:'使用方法与限制。\n\n[来源](https://example.org/source)',url:'https://example.org/project',relatedUrl:'',status:'公开收录',sectionId:'courses'};
 const data={id:articleId,title:fields.title,summary:fields.summary,markdown:recordMarkdown('openSource',fields),date:fields.date,category:site.columns[2],sectionId:'courses',author:site.author,assets:[],record:{documentId,kind:'openSource',fields}};
 const request={requestKey:'structured-source-request',expectedVersion:0,expectedPublishedVersion:null,data};
 const receipt=submitNews(db,request,'today');const job=claim(db);finish(db,job.id,{ok:true,hash:job.snapshot_hash,release:'admin-'+job.id});
 // An existing record keeps its stored permalink after title edits/imports.
 const preservedRoute='/open-source/2026-10-23-preserved-editor-slug/';db.prepare('UPDATE documents SET permalink=? WHERE id=?').run(preservedRoute,documentId);receipt.url=preservedRoute;
 const row=readDocument(db,documentId),source=withRecordSourceLinks(asEditorialRecord(row,row.published)),handoffDirectory=join(root,'handoff');
 const policy={version:1,siteId:site.id,origin:site.origin,enabled:true,authorization:'Approved structured continuation',articleIds:[articleId],targets,handoffDirectory};
 const english={title:'Open courses and tools',summary:'A complete introduction to the project and its limitations.',markdown:'# Open courses and tools\n\n## Introduction\n\nA complete introduction to the project.\n\n![Original image](https://example.org/image.webp)\n\n## Use and limitations\n\nMethods and limitations.\n\n[Source](https://example.org/source)\n\n[Project](https://example.org/project)'};
 return {root,db,source,receipt:{...receipt,job:{...receipt.job,status:'success'},publicReadback:true},request,policy,english,handoffDirectory};
}

test('structured publication API exposes its own identity, persists one Chinese record, and prevents stale English publication',async t=>{
 const f=await fixture(t),app=Fastify();t.after(()=>app.close());
 registerNewsApi(app,{db:f.db,bearer:r=>{r.actor='today';},session:r=>{r.actor='today';},body:r=>r.body,limit:()=>{}});
 const response=await app.inject({url:'/manage/api/news/flow-source/'+articleId,headers:{authorization:'Bearer fixture'}});
 assert.equal(response.statusCode,200);const bundle=response.json();
 assert.equal(bundle.data.record.documentId,documentId);assert.equal(bundle.url,f.receipt.url);assert.match(bundle.url,/^\/open-source\//);
 assert.equal(bundle.sha256,sourceContentSha256(f.source));
 const edition=validateNews({...f.source,...f.english,id:editionArticleId(articleId,'en'),assets:[],locale:'en',translationOf:{articleId,revision:1,sha256:bundle.sha256}});
 const result=submitNews(f.db,{data:edition,requestKey:'structured-english-request',expectedVersion:0,expectedPublishedVersion:null},'today');
 assert.equal(result.url,'/en/news/'+articleId+'/');
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM documents').get().n,2);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM documents WHERE kind='news' AND source_key=?").get('news:'+articleId).n,0);
 const before=readDocument(f.db,documentId);saveDocument(f.db,documentId,{...before.data,value:'管理员更新后的用途。'},1,'administrator');
 assert.equal(claim(f.db),null);assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(result.job.id).status,'failed');
 assert.throws(()=>submitNews(f.db,{data:edition,requestKey:'another-english-request',expectedVersion:1},'today'),/中文版本已变化/);
 assert.equal(sourceContentSha256({...f.source,date:'2099-01-01',author:'display author'}),bundle.sha256);
 assert.notEqual(sourceContentSha256({...f.source,record:{...f.source.record,fields:{...f.source.record.fields,value:'changed'}}}),bundle.sha256);
});

test('a structured source continues at its existing canonical URL and Ente mapping without duplicating either language',async t=>{
 const f=await fixture(t);await configureFlow(f.root,site,f.policy);
 const unmodified=JSON.stringify(f.request.data),first=await enqueuePublished({root:f.root,site,data:{...f.source,markdown:f.request.data.markdown},receipt:f.receipt});
 assert.deepEqual(await enqueuePublished({root:f.root,site,data:f.source,receipt:f.receipt}),first);
 const [{plan}]=await flowStatus(f.root);assert(plan.source.markdown.includes('https://example.org/project'));assert.equal(JSON.stringify(f.request.data),unmodified);
 const options={root:f.root,site,readSource:async()=>({version:1,publishedVersion:1,sha256:sourceContentSha256(f.source)}),translate:async()=>f.english,publishEdition:async()=>({status:'verified',url:site.origin+'/en/news/'+articleId+'/'}),fetcher:async()=>Response.json({version:1,links:{[f.receipt.url]:topic}})};
 assert.equal((await todayTick(options)).jobs[0].complete,true);await todayTick(options);
 const packets=await Promise.all((await readdir(join(f.handoffDirectory,'outbox'))).map(name=>readFile(join(f.handoffDirectory,'outbox',name),'utf8').then(JSON.parse)));
 assert.equal(packets.length,2);
 const zh=packets.find(p=>p.target.locale==='zh-CN'),en=packets.find(p=>p.target.locale==='en');
 assert.equal(zh.ownUrl,site.origin+f.receipt.url);assert.equal(en.ownUrl,site.origin+'/en/news/'+articleId+'/');
 assert.equal(zh.communityUrl,topic);assert.equal(en.communityUrl,topic);assert(en.body.includes('https://example.org/image.webp'));assert(en.body.includes('https://example.org/source'));
 const expected=validateNews({...f.source,...f.english,id:editionArticleId(articleId,'en'),assets:[],locale:'en',translationOf:{articleId,revision:1,sha256:sourceContentSha256(f.source)}});
 assert.equal(en.ownContentSha256,sourceContentSha256(expected));
 await assert.rejects(enqueuePublished({root:f.root,site,data:f.source,receipt:{...f.receipt,url:'/news/'+articleId+'/'}}),/verified/);
});

test('structured English website submission retains the one request key and reads back its deterministic public edition',async t=>{
 const f=await fixture(t);await configureFlow(f.root,site,f.policy);await enqueuePublished({root:f.root,site,data:f.source,receipt:f.receipt});
 const [{plan}]=await flowStatus(f.root),tokenFile=join(f.root,'token');await writeFile(tokenFile,'FIXTURE_TOKEN',{mode:0o600});await protectPrivateFile(tokenFile);let sends=0,request;
 const fetcher=async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/api/site'))return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin,capabilities:['language-editions-v1','structured-language-editions-v1']});
  if(path.includes('/flow-source/'))return Response.json(path.includes('edition-en-')?{version:1,publishedVersion:1,sha256:sourceContentSha256(request.data),url:'/en/news/'+articleId+'/'}:{version:1,publishedVersion:1,data:f.source,sha256:plan.sha256,url:f.receipt.url});
  if(path.includes('/cloud/'))return Response.json({error:'absent'},{status:404});
  if(path.endsWith('/publish')){request=JSON.parse(options.body);sends++;throw Error('uncertain submission');}
  if(path.includes('/requests/'))return Response.json({revision:1,url:'/en/news/'+articleId+'/',job:{status:'success'}});
  if(path===f.receipt.url)return new Response('<link rel="canonical" href="'+site.origin+f.receipt.url+'">');
  const {renderArticle}=await import('../scripts/article-format.mjs');return new Response('<html lang="en"><link rel="canonical" href="'+site.origin+'/en/news/'+articleId+'/"><div class="article-body">'+renderArticle(f.english.markdown.replace(/^# [^\n]+\n+/,''))+'</div></html>');
 };
 const website=flowWebsite({root:f.root,site,tokenFile,fetcher});
 assert.equal((await website.readSource(articleId)).data.id,articleId);assert.equal((await website.verify(f.source,1)).url,site.origin+f.receipt.url);
 const first=await website.publishEdition(plan,f.english),second=await website.publishEdition(plan,f.english);
 assert.equal(first.status,'verified');assert.equal(first.requestKey,second.requestKey);assert.equal(sends,1);assert.equal(request.data.record,undefined);assert.equal(request.data.translationOf.articleId,articleId);
});

test('structured sources render stable bilingual pages and public identities from compact snapshot bindings',async t=>{
 const f=await fixture(t),data=validateNews({...f.source,...f.english,id:editionArticleId(articleId,'en'),assets:[],locale:'en',translationOf:{articleId,revision:1,sha256:sourceContentSha256(f.source)}});
 const result=submitNews(f.db,{data,requestKey:'structured-render-request',expectedVersion:0,expectedPublishedVersion:null},'today');const pending=claim(f.db);finish(f.db,pending.id,{ok:true,hash:pending.snapshot_hash,release:'admin-'+pending.id});
 const snap=snapshot(f.db),target=join(f.root,'release'),job={id:'structured-render',snapshot:snap,snapshot_hash:digest(JSON.stringify(snap))};
 assert.equal(snap.editorialRecords.length,1);assert.deepEqual(Object.keys(snap.editorialRecords[0]).sort(),['documentId','key','kind','updated']);
 await buildSiteRelease({job,target,site,source:resolve('.'),now:new Date('2026-10-23T00:00:00Z')});
 const identities=JSON.parse(await readFile(join(target,'publishing-identities.json'),'utf8'));
 assert.equal(identities.articles[articleId].sha256,sourceContentSha256(f.source));assert.equal(identities.articles[articleId].route,f.receipt.url);
 assert.equal(identities.articles[data.id].sha256,sourceContentSha256(data));
 const en=await readFile(join(target,result.url.slice(1),'index.html'),'utf8'),zh=await readFile(join(target,f.receipt.url.slice(1),'index.html'),'utf8');
 assert(en.includes('data-community-source-route="'+f.receipt.url+'"'));assert(en.includes('href="'+f.receipt.url+'"'));assert(en.includes('https://example.org/image.webp'));assert(zh.includes('href="'+result.url+'"'));
 const feed=await readFile(join(target,'content-feed.xml'),'utf8');assert(feed.includes(site.origin+f.receipt.url));assert(!feed.includes(f.english.title));
});

test('Postiz uses the verified structured permalink and its Ente map during preflight', {skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await configureFlow(f.root,site,f.policy);await enqueuePublished({root:f.root,site,data:f.source,receipt:f.receipt});
 const [{plan}]=await flowStatus(f.root),command=join(f.root,'channels');await writeFile(command,'#!'+process.execPath+'\nprocess.stdout.write(JSON.stringify([{id:"discord-account",provider:"discord",disabled:false}]));\n',{mode:0o700});
 const packet=externalPackage(plan,targets[0],null,topic),identities={siteId:site.id,articles:{[articleId]:{sha256:plan.sha256,route:f.receipt.url}}};
 const fetcher=async url=>url.endsWith('/publishing-identities.json')?Response.json(identities):url.endsWith('/community/links.json')?Response.json({version:1,links:{[f.receipt.url]:topic}}):new Response('<link rel="canonical" href="'+site.origin+f.receipt.url+'">');
 const adapter=postizAdapter({handoffDirectory:f.handoffDirectory,command,fetcher,allowedTargets:targets,allowedSources:[{siteId:site.id,articleId,sha256:plan.sha256}]});
 await adapter.preflight(packet);
 const wrong={...packet,ownUrl:site.origin+'/news/'+articleId+'/'};await assert.rejects(adapter.preflight(wrong),/verified links|matching language permalink/);
});
