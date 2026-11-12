import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,cp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {editionArticleId,sourceContentSha256} from '../contracts/language-editions.mjs';
import {digest} from '../admin/model.mjs';

test('a bilingual site keeps an empty English entrance and feed without substituting Chinese articles',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-empty-english-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const site={...profiles.find(x=>x.id==='pets'),languages:['zh-CN','en']};
 const snapshot={news:[{id:'chinese-only',title:'中文专属文章',summary:'仅中文摘要',markdown:'# 中文专属文章\n\n仅中文正文',date:'2026-11-01',category:site.columns[0]}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{}};
 await buildSiteRelease({job:{id:'empty-en',snapshot,snapshot_hash:'fixture'},target:dir,source:resolve('.'),site});
 const home=await readFile(join(dir,'en/index.html'),'utf8');assert.match(home,/No English articles have been published yet/);assert.doesNotMatch(home,/中文专属文章|仅中文正文/);
 assert.equal(JSON.parse(await readFile(join(dir,'en/published-content.json'))).records.length,0);
 assert.doesNotMatch(await readFile(join(dir,'en/content-feed.xml'),'utf8'),/<item>/);assert.match(await readFile(join(dir,'sitemap-en.xml'),'utf8'),/\/en\//);
});

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

test('English pages take the site, section and author names from the site language pack',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-language-pack-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const site={...profiles.find(x=>x.id==='pets'),languages:['zh-CN','en']};
 const chinese={id:'pack-source',title:'比熊犬',summary:'比熊犬的起源与饲养要点。',markdown:'# 比熊犬\n\n比熊犬的起源与饲养要点。',date:'2026-11-05',category:'每日一狗',sectionId:'daily-dog',author:site.author,assets:[]};
 // A receiver marks a new English packet this way until Center binds its source revision.
 const english={...chinese,id:editionArticleId(chinese.id,'en'),locale:'en',translationSourceStatus:'unknown',translationCandidateArticleId:chinese.id,title:'Bichon Frise',summary:'Origins and care essentials.',markdown:'# Bichon Frise\n\nOrigins and care essentials.'};
 const snapshot={news:[chinese,english],data:{year:[],history:[]},openSource:{items:[]},permalinks:{['news:'+chinese.id]:'/news/'+chinese.id+'/',['news:'+english.id]:'/en/news/'+chinese.id+'/'}};
 await buildSiteRelease({job:{id:'language-pack',snapshot,snapshot_hash:digest(JSON.stringify(snapshot))},target:dir,source:resolve('.'),site,now:new Date('2026-11-12T00:00:00Z')});
 const en=await readFile(join(dir,'en/news/'+chinese.id+'/index.html'),'utf8'),zh=await readFile(join(dir,'news/'+chinese.id+'/index.html'),'utf8');
 assert.match(en,/<title>Bichon Frise · Piggytuck Pets<\/title>/);
 assert.match(en,/<p class="rssd-kicker">Piggytuck Pets \/ Dog of the Day<\/p>/);
 assert.match(en,/<p class="rssd-byline">Piggytuck Pets · 2026-11-05<\/p>/);
 const article=en.match(/<article\b[\s\S]*?<\/article>/)[0],header=en.match(/<header\b[\s\S]*?<\/header>/)[0],footer=en.match(/<footer\b[^>]*>[\s\S]*?<\/span>/)[0];
 for(const part of [article,header,footer])assert.doesNotMatch(part,/小猪|萌宠|每日一狗|宠物星球/);
 // The system's own uncertainty about the source revision is data, not a notice to readers.
 assert.doesNotMatch(en,/unverified source revision|This English edition/);assert.match(en,/<article class="rssd-article"[^>]* data-source-version-state="unknown"/);
 assert.equal(JSON.parse(await readFile(join(dir,'language-editions.json'),'utf8')).editions[0].sourceVersionState,'unknown');
 assert.match(zh,/<p class="rssd-kicker">小猪萌宠 \/ 每日一狗<\/p>/);assert.doesNotMatch(zh,/Piggytuck Pets|Dog of the Day/);
 const home=await readFile(join(dir,'en/index.html'),'utf8');
 assert.match(home,/<title>Piggytuck Pets<\/title>/);assert.match(home,/<h1>Piggytuck Pets<\/h1><p>Welcome to my pet planet\.<\/p>/);
 assert.match(await readFile(join(dir,'en/content-feed.xml'),'utf8'),/<category>Dog of the Day<\/category>/);
 const model=JSON.parse(await readFile(join(dir,en.match(/\/(export\/[a-f0-9]+\/)article\.css/)[1],'content.json'),'utf8'));
 assert.deepEqual([model.site.name,model.sectionName,model.author,model.locale],['Piggytuck Pets','Dog of the Day','Piggytuck Pets','en']);
});

test('a build without a language pack keeps the earlier names, and every site has a valid pack',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-no-language-pack-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const site={...profiles.find(x=>x.id==='metho'),languages:['zh-CN','en']};
 const news=[{id:'own-author',locale:'en',title:'Signed by a person',summary:'Available in English.',markdown:'# Signed by a person\n\nBody.',date:'2026-10-31',category:site.columns[0],sectionId:'methods',author:'Jane Example',assets:[]}];
 const snapshot={news,data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:own-author':'/en/news/own-author/'}};
 await buildSiteRelease({job:{id:'own-author',snapshot,snapshot_hash:digest(JSON.stringify(snapshot))},target:join(dir,'with'),source:resolve('.'),site});
 assert.match(await readFile(join(dir,'with/en/news/own-author/index.html'),'utf8'),/<p class="rssd-kicker">Metho · Research Methods \/ Methods Encyclopedia<\/p>[\s\S]*<p class="rssd-byline">Metho · 2026-10-31<\/p>/);
 const {localeAuthor}=await import('../web/engine/language-pack.mjs');
 assert.equal(localeAuthor({author:'Metho'},'Jane Example',site),'Jane Example');assert.equal(localeAuthor({author:'Metho'},site.author,site),'Metho');assert.equal(localeAuthor(null,site.author,site),site.author);
 // The same sources without sites/language: the built-in name for metho, and the Chinese section name.
 const bare=join(dir,'source');await cp('sites',join(bare,'sites'),{recursive:true});await rm(join(bare,'sites/language'),{recursive:true});await mkdir(join(bare,'web/themes'),{recursive:true});await cp('web/themes/content.css',join(bare,'web/themes/content.css'));
 await buildSiteRelease({job:{id:'own-author',snapshot,snapshot_hash:digest(JSON.stringify(snapshot))},target:join(dir,'without'),source:bare,site});
 assert.match(await readFile(join(dir,'without/en/news/own-author/index.html'),'utf8'),/<p class="rssd-kicker">研究方法 \/ 方法百科<\/p>/);
 assert.match(await readFile(join(dir,'without/en/index.html'),'utf8'),/<title>Metho · Research Methods<\/title>/);
 assert.match(await readFile(join(dir,'without/en/content-feed.xml'),'utf8'),/<category>Research articles<\/category>/);
 const {loadLanguagePack,validateLanguagePack}=await import('../web/engine/language-pack.mjs');
 assert.equal(await loadLanguagePack(dir,'metho'),null);
 for(const profile of profiles){const pack=await loadLanguagePack(resolve('.'),profile.id);assert.equal(pack?.siteId,profile.id,'language pack for '+profile.id);assert(pack.locales.en.name&&!/[一-鿿]/.test(JSON.stringify(pack.locales.en)),'English names for '+profile.id);}
 for(const bad of [{version:2,siteId:'metho',locales:{}},{version:1,siteId:'pets',locales:{}},{version:1,siteId:'metho',locales:{'zh-CN':{name:'x'}}},{version:1,siteId:'metho',locales:{en:{name:''}}},{version:1,siteId:'metho',locales:{en:{name:'x',sections:{'Bad Id':'y'}}}},{version:1,siteId:'metho',locales:{en:{name:'x',extra:1}}}])assert.throws(()=>validateLanguagePack(bad,'metho'),/Invalid language pack/);
});
