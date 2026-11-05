import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profiles,validateSite} from '../scripts/site-config.mjs';
import {validateNavigation,navigationMatches} from '../contracts/site-navigation.mjs';
import {navigationForSite,renderNavigation} from '../web/engine/site-navigation.mjs';
import {createFeedIndex,renderFeed} from '../web/engine/content-feed.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {homepagePath} from '../web/engine/theme-homepage.mjs';

test('section counts vary independently of navigation; unsafe destinations are rejected',()=>{
 const site=profiles.find(s=>s.id==='legis');
 for(const count of [1,3,5,8]){
  const changed=validateSite({...site,publicColumns:Array.from({length:count},(_,i)=>'板块 '+i)});
  assert.deepEqual(navigationForSite(changed),navigationForSite(site));
 }
 for(const href of ['javascript:alert(1)','//elsewhere.test','/../private','/%2e%2e/private','/\\evil.test'])assert.throws(()=>validateNavigation([{id:'link',label:'入口',view:'page',href}]));
 assert.throws(()=>validateNavigation([site.navigation[0],site.navigation[0]]));
 assert.throws(()=>validateSite({...site,publicColumns:['重复','重复']}));
});
test('all ten sites choose independent destinations and retain a single feed entrance',()=>{
 for(const site of profiles){
  const nav=navigationForSite(site);
  assert.equal(nav.filter(n=>n.view==='feed').length,1,site.id);
  assert(!nav.some(n=>/^\/archive\/.+/.test(n.href)),site.id+' promotes a section into navigation');
 }
 const today=navigationForSite(profiles[0]);
 assert(today.some(n=>n.href==='/#/year'));assert(today.some(n=>n.href==='/#/history'));
 const design=profiles.find(s=>s.id==='piggytuck');
 assert(navigationForSite(design).some(n=>n.href==='/works/'));
 assert(!navigationForSite({...design,display:{version:1,modules:{gallery:{enabled:false}}}}).some(n=>n.href==='/gallery/'));
 assert(navigationMatches(today.find(n=>n.id==='year'),'/#/year/record'));
 assert(navigationMatches(today.find(n=>n.id==='history'),'/history/old-record/'));
 assert(!navigationMatches(today.find(n=>n.id==='year'),'/archive/'));
 assert.deepEqual(today.map(n=>n.label),['首页','今日学术','昔日学术','学术新闻','留言板']);
 const selected=renderNavigation(profiles.find(s=>s.id==='personal'),'/archive/reflections/page/2/');
 assert.equal((selected.match(/aria-current="page"/g)||[]).length,1);
 assert.match(selected,/data-nav="feed" class="active" aria-current="page"/);
});
test('the same records appear in the feed and grouped sections without copying bodies or changing URLs',()=>{
 const record=(id,collectionId,date)=>({id,title:'标题 '+id,summary:'摘要',route:'/news/'+id+'/',collectionId,publication:{date},bodyMarkdown:'不能进入检索索引的正文'});
 const content={siteId:'test',collections:[{id:'main',name:'主板块',route:'/archive/main/',includes:['old']},{id:'old',name:'旧板块',route:'/archive/old/',legacy:true}],records:Array.from({length:27},(_,i)=>record('r'+i,i%2?'old':'main','2026-10-17'))};
 const before=JSON.stringify(content),index=createFeedIndex(content);
 const first=renderFeed(index,{label:'手记',section:'main'}),second=renderFeed(index,{label:'手记',section:'main',page:2});
 assert.equal(first.pages,2);assert.equal((first.body.match(/class="feed-entry"/g)||[]).length,24);assert.equal((second.body.match(/class="feed-entry"/g)||[]).length,3);
 assert.match(first.body,/\/archive\/main\/page\/2\//);assert.match(first.body,/旧栏目与既有文章/);
 assert.equal(new Set(index.records.map(r=>r.route)).size,27);assert(!JSON.stringify(index).includes('不能进入检索索引的正文'));assert.equal(JSON.stringify(content),before);
});
test('generated feed pagination, category routes and detail navigation keep original permalinks',async t=>{
 const target=await mkdtemp(join(tmpdir(),'site-nav-feed-'));t.after(()=>rm(target,{recursive:true,force:true}));
 const site=profiles.find(s=>s.id==='legis');
 const snapshot={news:Array.from({length:26},(_,i)=>({id:'n'+i,title:'文章 '+i,summary:'摘要 '+i,markdown:'# 正文\n\n原内容',date:'2026-10-17',category:'法律前沿',sectionId:'frontiers'})),data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:n0':'/news/frozen/'}};
 await buildSiteRelease({source:process.cwd(),target,site,job:{id:'navigation',snapshot,snapshot_hash:'fixture'}});
 for(const route of ['archive','archive/page/2','archive/frontiers','archive/frontiers/page/2','news/frozen','journal'])await access(join(target,route,'index.html'));
 const article=await readFile(join(target,'news/frozen/index.html'),'utf8');assert.match(article,/原内容/);assert.match(article,/data-nav="feed" class="active" aria-current="page"/);
 const archive=await readFile(join(target,'archive/index.html'),'utf8');assert.match(archive,/feed-search/);assert.equal((archive.match(/class="feed-entry"/g)||[]).length,24);
 const nav=archive.match(/<nav aria-label="主导航">([\s\S]*?)<\/nav>/)[1];assert.doesNotMatch(nav,/archive\/frontiers/);
 assert.match(await readFile(join(target,'sitemap-content.xml'),'utf8'),/archive\/page\/2/);
 for(const path of ['content-feed.js','content-feed-index.json'])assert.throws(()=>homepagePath(path));
 await assert.rejects(buildSiteRelease({source:process.cwd(),target:join(target,'collision'),site,job:{id:'collision',snapshot:{...snapshot,permalinks:{'news:n0':'/archive/page/2/'}},snapshot_hash:'fixture'}}),/collides with article/);
});
