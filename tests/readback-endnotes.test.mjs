import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {renderArticle,renderArticleParts} from '../scripts/article-format.mjs';
import {articleBodyOnPage,createWebsitePublisher} from '../scripts/website-publication.mjs';
import {headingAnchors} from '../web/themes/structures.mjs';
import {createDraft} from '../scripts/editorial-workspace.mjs';
import {profiles,publicationDirectory} from '../scripts/site-config.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';

const site={name:'小猪萌宠',origin:'https://pet.piggytuck.com'};
const markdown='# 标题\n\n导语。\n\n## 刊刻缘起、经数与碑式\n\n本节说明刊刻背景。\n\n## 参考文献\n\n1. [AKC](https://www.akc.org/)\n\n### 品牌与发布说明\n\n1. [小猪萌宠](https://pet.piggytuck.com)\n';
const text=markdown.replace(/^# [^\n]+\n+/,'');

test('readback accepts the single-body layout (academic theme)',()=>{
 const html='<div class="article-body">'+renderArticle(text)+'</div>';
 assert.equal(articleBodyOnPage(html,markdown,site),true);
});

test('readback accepts brand endnotes split into their own block (journal theme)',()=>{
 const parts=renderArticleParts(text,{site});
 assert.ok(parts.endnotes);
 const html='<div class="article-body">'+parts.body+'</div></div><aside class="sources"></aside><div class="prose"><div class="article-body article-endnotes">'+parts.endnotes+'</div></div>';
 assert.equal(articleBodyOnPage(html,markdown,site),true);
});

test('readback still rejects a page whose body or endnotes differ',()=>{
 const parts=renderArticleParts(text,{site});
 assert.equal(articleBodyOnPage('<div class="article-body">'+parts.body+'</div>',markdown,site),false);
 assert.equal(articleBodyOnPage('<div class="article-body">'+parts.body.replace('导语','别的')+'</div><div class="article-body article-endnotes">'+parts.endnotes+'</div>',markdown,site),false);
});

test('readback accepts journal heading anchors and still rejects a different version',()=>{
 const parts=renderArticleParts(text,{site});
 const live='<div class="article-body">'+headingAnchors(parts.body).body+'</div><div class="article-body article-endnotes">'+parts.endnotes+'</div>';
 assert.match(live,/<h2 id="刊刻缘起经数与碑式">/);
 assert.equal(articleBodyOnPage(live,markdown,site),true);
 assert.equal(articleBodyOnPage(live.replace('本节说明刊刻背景。','其他正文。'),markdown,site),false);
 assert.equal(articleBodyOnPage(live.replace('刊刻缘起、经数与碑式','另一标题'),markdown,site),false);
});

test('readback handles legacy site signatures and articles without brand notes',()=>{
 for(const source of ['# 标题\n\n导语。', '# 标题\n\n导语。\n\n[小猪萌宠](https://pet.piggytuck.com)']){
  const body=source.replace(/^# [^\n]+\n+/,'');
  assert.equal(articleBodyOnPage('<div class="article-body">'+renderArticle(body,{site})+'</div>',source,site),true);
  const parts=renderArticleParts(body,{site});
  const page='<div class="article-body">'+parts.body+'</div>'+(parts.endnotes?'<div class="article-body article-endnotes">'+parts.endnotes+'</div>':'');
  assert.equal(articleBodyOnPage(page,source,site),true);
 }
});

// Exercise both publication entry points against pages from the actual theme
// renderer. Every request is mocked; no live site or credential is used.
for(const siteId of ['metho','enter','pets','xsiching'])for(const flow of ['publish','cloud-action']){
 test(siteId+' '+flow+' verifies split notes without resubmitting or accepting stale pages',async t=>{
  const profile=profiles.find(s=>s.id===siteId),root=await mkdtemp(join(tmpdir(),'readback-theme-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const oldToken=process.env.SCHOLAY_TODAY_TOKEN;
  process.env.SCHOLAY_TODAY_TOKEN='READBACK_TEST_ONLY';
  t.after(()=>{if(oldToken===undefined)delete process.env.SCHOLAY_TODAY_TOKEN;else process.env.SCHOLAY_TODAY_TOKEN=oldToken;});
  await writeFile(join(root,'.site.json'),JSON.stringify(profile));
  await mkdir(join(root,'_ops/inventory'),{recursive:true});
  await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({annexColumns:profile.columns,articles:{}}));
  const source=markdown.replaceAll(site.name,profile.name).replaceAll(site.origin,profile.origin);
  const draft=await createDraft({id:'readback-note',title:'标题',column:profile.columns[0],markdown:source},root);
  const route='/news/'+draft.id+'/',posts=[];
  const state={version:0,publishedVersion:null,data:null,job:'queued',html:'',http:200,action:null};
  const response=()=>({articleId:draft.id,revision:1,url:route,job:{id:'readback-job',status:state.job}});
  const client=createWebsitePublisher({root,site:profile,fetcher:async(url,options)=>{
   const path=new URL(url).pathname;
   if(options.method==='POST')posts.push(path);
   if(path==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId,origin:profile.origin});
   if(path.endsWith('/publish'))return Response.json(response());
   if(path.includes('/requests/'))return Response.json(response());
   if(path.endsWith('/actions'))state.action=JSON.parse(options.body);
   if(path.endsWith('/actions')||path.includes('/actions/'))return Response.json({...state.action,status:state.job,version:1,url:route,job:response().job});
   if(path.startsWith('/manage/'))return Response.json({version:state.version,publishedVersion:state.publishedVersion,data:state.data,published:state.data});
   assert.equal(url,profile.origin+route);
   return new Response(state.html,{status:state.http});
  }});
  const prepared=await client.prepare(draft.id,{metadata:{date:'2026-10-17',summary:'公开回读测试摘要',author:profile.author,category:profile.columns[0]}});
  const packet=JSON.parse(await readFile(join(publicationDirectory(root),draft.id,'prepared.json'),'utf8'));
  state.data=packet.data;state.version=1;
  const target=join(root,'public');
  await buildSiteRelease({site:profile,source:process.cwd(),target,job:{id:'readback-'+siteId,snapshot_hash:'fixture',snapshot:{news:[state.data],data:{year:[],history:[]},openSource:{items:[]},permalinks:{}}}});
  const html=await readFile(join(target,route.slice(1),'index.html'),'utf8');
  assert.match(html,/class="article-body article-endnotes"/);
  if(siteId==='xsiching')assert.match(html,/<h2 id="刊刻缘起经数与碑式">/);
  const submitted=flow==='publish'
   ?await client.publish(draft.id,{packetSha256:prepared.prepared.packetSha256})
   :await client.cloudAction(draft.id,{action:'publish',expectedVersion:1,expectedPublishedVersion:null,confirmed:true});
  const requestKey=flow==='publish'?submitted.receipt.requestKey:submitted.requestKey;
  const check=()=>flow==='publish'?client.status(draft.id):client.cloudActionStatus(draft.id);
  state.job='success';state.publishedVersion=1;
  const notes=renderArticleParts(source.replace(/^# [^\n]+\n+/,''),{site:profile}).endnotes;
  for(const badHtml of [html.replace('导语。','其他正文。'),html.replace(notes,''),html.replace(notes,notes.replace(profile.name,'错误品牌')),html.replace('rel="canonical"','rel="alternate"')]){
   state.html=badHtml;const result=await check();
   assert.equal(result.stage,'verify');
   assert.equal((result.receipt||result).publicReadback,false);
  }
  state.html=html;state.http=503;assert.equal((await check()).stage,'verify');
  state.http=200;state.publishedVersion=2;assert.equal((await check()).stage,'verify');
  state.publishedVersion=1;const done=await check(),receipt=done.receipt||done;
  assert.equal(done.stage,'published');assert.equal(receipt.publicReadback,true);
  assert.equal(receipt.requestKey,requestKey);assert.equal(posts.length,1);
  assert.equal(await readFile(join(root,draft.canonicalPath),'utf8'),source);
 });
}
