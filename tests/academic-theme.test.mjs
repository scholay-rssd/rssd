import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,access,cp,symlink} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {DEFAULT_SITE,profiles} from '../scripts/site-config.mjs';
import {themeForSite} from '../web/themes/registry.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {packageWebEngine} from '../scripts/package-web-engine.mjs';
const year={id:'year-one',title:'学术会议',category:'学术会议',tags:[],start:'2026-12-30',end:'2027-01-02',dateBasis:'官网日期',summary:'原有摘要',body:'原有正文',sourceName:'主办方',sourceUrl:'https://example.org/event',provenance:'已核验官网'};
const history={id:'history-one',title:'历史记录',dateKey:'02-29',year:2000,domain:'计算史',eventType:'论文发表',importance:'A',factSummary:'事实',historicalSignificance:'意义',sources:[{label:'论文',url:'https://example.org/paper'}]};
const resource={title:'开放工具',date:'2026-09-30',category:'文献与写作',summary:'简介',value:'原有价值',url:'https://example.org/project',status:'公开收录'};
test('all ten profiles select Themes and old academic configuration retains its renderer',()=>{
 assert.deepEqual(profiles.map(site=>themeForSite(site).id),['academic','docs','portfolio','personal','encyclopedia','journal','journal','journal','journal','journal']);
 const {themeId,...old}=DEFAULT_SITE;assert.equal(themeForSite(old).id,'academic');
 assert.equal(themeForSite({...DEFAULT_SITE,legacy:false}).id,'academic');
});
test('academic Theme preserves frozen links, eligibility, original data and timestamps through the common entrypoint',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'academic-theme-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const snapshot={data:{year:[year,{...year,id:'unverified',provenance:'待核验'}],history:[history]},openSource:{items:[resource]},news:[],permalinks:{'year:year-one':'/calendar/unchanged-original/','history:history-one':'/history/unchanged-original/','openSource:https://example.org/project':'/open-source/unchanged-original/'}};
 const input=JSON.stringify(snapshot),target=join(dir,'first'),job={id:'academic',snapshot,snapshot_hash:'fixture'};
 const manifest=await buildSiteRelease({job,source:process.cwd(),target,site:{...DEFAULT_SITE,legacy:false},now:'2026-10-13T00:00:00Z'});
 assert.equal(manifest.theme.id,'academic');assert.equal(manifest.contentVersion,1);
 const content=JSON.parse(await readFile(join(target,'published-content.json')));
 assert.equal(content.records.length,3);assert.equal(content.records.find(x=>x.id==='year:year-one').collectionId,'calendar');
 assert.equal(content.collections.find(x=>x.id==='history').route,'/archive/history/');
 for(const item of content.records)await access(join(target,item.route,'index.html'));
 assert.equal(JSON.parse(await readFile(join(target,'data.json'))).year.length,2);
 assert.equal(input,JSON.stringify(snapshot));assert(manifest.byteHashes['app.js']);
 const next=join(dir,'second');await buildSiteRelease({job,source:process.cwd(),target:next,previousRoot:target,now:'2026-10-14T00:00:00Z'});
 for(const file of ['index.html','seo-manifest.json','sitemap.xml','archive/index.html','calendar/unchanged-original/index.html'])assert.equal(await readFile(join(target,file),'utf8'),await readFile(join(next,file),'utf8'));
});
test('both deployment packages include every renderer but exclude unrelated homepage sources',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'theme-package-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const academic of [false,true]){
  const target=join(dir,String(academic));await packageWebEngine(target,{academic});
  for(const path of ['web/modules/registry.mjs','web/modules/calendar/client.js','web/modules/gallery/index.mjs','web/modules/graph/index.mjs','web/engine/knowledge-graph.mjs','web/themes/journal/render.mjs','web/themes/academic/render.mjs','web/themes/academic/content.mjs','web/themes/academic/build-seo.mjs','web/themes/academic/archive-pages.mjs'])await access(join(target,path));
  for(const path of ['web/themes/personal/homepage','web/themes/portfolio/homepage','desktop','editorial'])await assert.rejects(access(join(target,path)),{code:'ENOENT'});
  // Every module the renderers import must be inside the package itself.
  const pkg=join(dir,'resolve-'+academic);await cp(target,pkg,{recursive:true});
  for(const extra of ['admin','scripts','sites','contracts','package.json'])await cp(extra,join(pkg,extra),{recursive:true});
  await symlink(join(process.cwd(),'node_modules'),join(pkg,'node_modules'),process.platform==='win32'?'junction':'dir');
  for(const file of ['web/themes/journal/render.mjs','web/themes/academic/render.mjs'])await import(pathToFileURL(join(pkg,file)).href);
  await access(join(pkg,'web/themes/structures.css'));
  if(academic)assert.equal(await readFile(join(target,'web/themes/academic/public/app.js'),'utf8'),await readFile('web/themes/academic/public/app.js','utf8'));
  else await assert.rejects(access(join(target,'web/themes/academic/public')),{code:'ENOENT'});
 }
});

test('explicit notebook calendar publication renders in its selected section without a human-review status',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'academic-notebook-section-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const entry={...year,id:'notebook-calendar',sectionId:'calendar',provenance:'原文资料',body:'### 参与步骤\n\n先查看[官方公告](https://example.org/event)。\n\n<script>alert(1)</script>\n\n[危险链接](javascript:alert(1))',bodyHtml:'<img src=x onerror=alert(1)>'};
 const legacy={...year,id:'legacy-calendar',bodyHtml:'<script>untrusted</script>'};
 const snapshot={data:{year:[entry,legacy],history:[history]},openSource:{items:[resource]},news:[],permalinks:{}};
 const original=JSON.stringify(snapshot);
 await buildSiteRelease({job:{id:'section-test',snapshot,snapshot_hash:'section-test'},source:process.cwd(),target:dir,site:DEFAULT_SITE,now:'2026-10-15T00:00:00Z'});
 const content=JSON.parse(await readFile(join(dir,'published-content.json'))),item=content.records.find(x=>x.id==='year:notebook-calendar');
 assert.equal(item.collectionId,'calendar');
 const html=await readFile(join(dir,item.route,'index.html'),'utf8');assert.match(html,/<h3>参与步骤<\/h3>/);assert.match(html,/今日学术/);
 assert.match(await readFile(join(dir,'archive/calendar/index.html'),'utf8'),/学术会议/);
 const publicData=JSON.parse(await readFile(join(dir,'data.json'))),calendar=publicData.year.find(x=>x.id===entry.id);
 assert.match(calendar.bodyHtml,/<h3>参与步骤<\/h3>/);assert.match(calendar.bodyHtml,/href="https:\/\/example.org\/event"/);
 assert.doesNotMatch(calendar.bodyHtml,/<script|<img|href="javascript:/);assert.match(calendar.bodyHtml,/&lt;script&gt;/);
 assert.equal(calendar.body,entry.body);assert.equal(publicData.year.find(x=>x.id===legacy.id).bodyHtml,undefined);
 assert.equal(JSON.stringify(snapshot),original);
});

test('academic front page: instant HTML on "/", free of build-date content, calendar one click away',async t=>{
 const {renderFrontPage}=await import('../web/themes/academic/front-page.mjs');
 const input={news:[{id:'a',title:'较新的 <b>资讯</b>',summary:'摘要 [链接](https://e.org) ![图](x.png)',date:'2026-10-20'},{id:'b',title:'较早的资讯',summary:'x',date:'2026-10-01'}],openSource:[{title:'工具',summary:'简介',date:'2026-10-02'}],
  route:{news:x=>'/news/'+x.id+'/',openSource:()=>'/open-source/tool/'},sectionName:()=>'学界犀闻',sections:[{name:'学界犀闻',route:'/archive/observations/'}]};
 const html=renderFrontPage(input);
 assert.match(html,/^<div class="fp" data-front>/);
 assert.match(html,/<h1>今日学术<\/h1>/);
 assert.match(html,/class="fp-lead"><p class="fp-kicker">学界犀闻 · 2026-10-20<\/p><h2><a href="\/news\/a\/">较新的 &lt;b&gt;资讯&lt;\/b&gt;<\/a>/);
 assert.doesNotMatch(html,/<b>|!\[|\]\(http/);
 assert.match(html,/href="\/#\/year"[^>]*>进入科研日历/);assert.match(html,/href="\/#\/history"/);
 assert.equal(html,renderFrontPage({...input}),'same input, same bytes');
 assert.doesNotMatch(html,/20\d\d 年 \d+ 月/);
 const app=await readFile('web/themes/academic/public/app.js','utf8');
 assert.match(app,/frontHtml&&\(!raw\|\|raw==='\/'\)/);
});
