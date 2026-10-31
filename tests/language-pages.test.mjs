import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {editionArticleId,sourceContentSha256} from '../contracts/language-editions.mjs';
import {digest} from '../admin/model.mjs';

test('an English-only original gets its own route, RSS and sitemap without a fabricated Chinese version',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-english-original-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const site={...profiles.find(x=>x.id==='metho'),languages:['zh-CN','en']};
 const news=[{id:'english-original',locale:'en',title:'An English-only original',summary:'Available in English.',markdown:'# An English-only original\n\nIndependent English body.',date:'2026-10-31',category:site.columns[0],author:'Example',assets:[]}];
 const snapshot={news,data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:english-original':'/en/news/english-original/'}};
 await buildSiteRelease({job:{id:'english-original',snapshot,snapshot_hash:digest(JSON.stringify(snapshot))},target:dir,source:resolve('.'),site});
 const en=await readFile(join(dir,'en/news/english-original/index.html'),'utf8');
 assert.match(en,/Independent English body/);assert.doesNotMatch(en,/hreflang="zh-CN"/);assert.doesNotMatch(en,/data-community-source-route/);
 assert.doesNotMatch(await readFile(join(dir,'content-feed.xml'),'utf8'),/An English-only original/);
 assert.match(await readFile(join(dir,'en/content-feed.xml'),'utf8'),/An English-only original/);
 assert.match(await readFile(join(dir,'sitemap-en.xml'),'utf8'),/\/en\/news\/english-original\//);
});

for(const siteId of ['metho','scholay-today'])test(siteId+' renders independent English pages without leaking editions into Chinese feeds',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'today-language-pages-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const site={...profiles.find(x=>x.id===siteId),languages:['zh-CN','en']};
 const chinese={id:'test-original-source',title:'中文原稿',summary:'样本为 120 人。',markdown:'# 中文原稿\n\n样本为 120 人。\n\n![原图](https://example.org/image.webp)\n\n[来源](https://example.org/paper)',date:'2026-10-22',category:site.columns[0],author:site.author,assets:[]};
 const english={...chinese,id:editionArticleId(chinese.id,'en'),locale:'en',translationOf:{articleId:chinese.id,revision:1,sha256:sourceContentSha256(chinese)},title:'The English article',summary:'The sample includes 120 people.',markdown:'# The English article\n\nThe sample includes 120 people.\n\n![Original illustration](https://example.org/image.webp)\n\n[Source](https://example.org/paper)'};
 const year={id:'verified-year',title:'会议记录',category:site.yearCategories[0],tags:[],start:'2026-12-01',end:null,dateBasis:'官网日期',summary:'会议摘要',body:'',sourceName:'主办方',sourceUrl:'https://example.org/event',provenance:'已核验官网'};
 const history={id:'verified-history',title:'历史记录',dateKey:'01-01',year:2000,domain:'科学史',eventType:'论文发表',importance:'A',factSummary:'历史摘要',historicalSignificance:'意义',sources:[{label:'来源',url:'https://example.org/history'}],preciseToDay:true};
 const resource={title:'开放工具',date:'2026-10-01',category:site.sourceCategories[0],summary:'工具摘要',value:'研究价值',url:'https://example.org/project',relatedUrl:'',status:'公开收录'};
 const snapshot={news:[chinese,english],data:{year:[year],history:[history],counts:{year:1,history:1}},openSource:{items:[resource]},permalinks:{['news:'+chinese.id]:'/news/'+chinese.id+'/',['news:'+english.id]:'/en/news/'+chinese.id+'/'}};
 const job={id:'language-test',snapshot,snapshot_hash:digest(JSON.stringify(snapshot))};
 const target=join(dir,'release');const manifest=await buildSiteRelease({job,target,source:resolve('.'),site,now:new Date('2026-10-22T00:00:00Z')});
 if(siteId==='scholay-today'){
  const home=await readFile(join(target,'en/index.html'),'utf8');
  for(const pattern of [/href="\/seo\.css"/,/class="collection-hero"/,/class="record-grid"/,/class="record-card"/,/class="section-nav"/,/id="theme-toggle"/,/class="site-links"/])assert.match(home,pattern);
  const originalHome=await readFile(join(target,'index.html'),'utf8');
  assert.equal((originalHome.match(/class="site-language-control"/g)||[]).length,1);
  assert.equal(manifest.byteHashes['index.html'],digest(originalHome));
 }
 const en=await readFile(join(target,'en/news/'+chinese.id+'/index.html'),'utf8');
 const zh=await readFile(join(target,'news/'+chinese.id+'/index.html'),'utf8');
 assert.match(en,/<html lang="en">/);assert.match(en,/<h1>The English article<\/h1>/);
 assert.match(en,/data-community-source-route="\/news\/test-original-source\/"/);
 assert.equal((en.match(/src="\/language-discussion\.js"/g)||[]).length,1);assert(!en.includes('src="/community/discussion-links.v1.js"'));
 assert((await readFile(join(target,'language-discussion.js'),'utf8')).includes('communitySourceRoute'));
 assert(en.includes('href="'+site.origin+'/en/news/'+chinese.id+'/"'));
 assert(en.includes('hreflang="zh-CN"'));assert(zh.includes('hreflang="en"'));
 assert(!en.includes('样本为'));assert(!en.includes('src="/app.js"'));
 assert.match(en,/<meta property="og:locale" content="en_US">/);
 assert.match(en,/<meta name="twitter:title" content="The English article">/);
 assert.match(en,/<meta name="twitter:description" content="The sample includes 120 people\.">/);
 assert.match(en,/<meta property="og:image" content="https:\/\/example.org\/image.webp">/);
 assert.equal((en.match(/property="og:site_name"/g)||[]).length,1);
 const rss=await readFile(join(target,'content-feed.xml'),'utf8');assert(rss.includes('中文原稿'));assert(!rss.includes('The English article'));
 const enRss=await readFile(join(target,'en/content-feed.xml'),'utf8');assert.match(enRss,/<language>en<\/language>/);assert(enRss.includes(site.origin+'/en/news/'+chinese.id+'/'));
 const publicEn=JSON.parse(await readFile(join(target,'en/published-content.json'),'utf8'));assert.equal(publicEn.records.length,1);assert.equal(publicEn.records[0].stale,false);
 assert.equal(manifest.counts.languageEditions,1);assert(manifest.hashes['sitemap-en.xml']);
 const next=join(dir,'next');await buildSiteRelease({job,target:next,previousRoot:target,source:resolve('.'),site,now:new Date('2026-10-23T00:00:00Z')});
 const second=await readFile(join(next,'en/news/'+chinese.id+'/index.html'),'utf8');
 const at=[...second].findIndex((x,i)=>x!==en[i]);
 assert(second===en,JSON.stringify({at,before:en.slice(Math.max(0,at-80),at+200),after:second.slice(Math.max(0,at-80),at+200)}));
 assert.equal(await readFile(join(next,'sitemap-en.xml'),'utf8'),await readFile(join(target,'sitemap-en.xml'),'utf8'));
});
