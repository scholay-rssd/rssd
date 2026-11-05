import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {addLanguageNavigation,languageControl,finalizeLanguageNavigation} from '../web/engine/language-navigation.mjs';
import {byteHash,copyThemeHomepage} from '../web/engine/theme-homepage.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {editionArticleId,sourceContentSha256} from '../contracts/language-editions.mjs';

const page=header=>`<html lang="zh-CN"><head><title>文章</title></head><body>${header}<main><h1>原始内容</h1></main></body></html>`;
test('paired pages switch to the exact translation while unpaired pages clearly link to the directory',()=>{
 const pairs=new Map([['/news/a/','/en/news/a/'],['/en/news/a/','/news/a/']]);
 const zh=languageControl({route:'/news/a/',englishHome:true,pairs});
 assert.match(zh,/href="\/en\/news\/a\/"/);assert.match(zh,/data-language-target="page"/);
 assert.match(zh,/data-language-switch="zh-CN" aria-current="page"/);
 const en=languageControl({route:'/en/news/a/',englishHome:true,pairs});
 assert.match(en,/href="\/news\/a\/"/);assert.match(en,/data-language-switch="en" aria-current="page"/);
 const missing=languageControl({route:'/news/untranslated/',englishHome:true,pairs});
 assert.match(missing,/data-language-target="directory"/);assert.match(missing,/href="\/en\/"/);assert.match(missing,/<small>目录<\/small>/);
 assert.match(missing,/本文暂无英文版/);assert.doesNotMatch(missing,/\/en\/news\/untranslated/);
 const unavailable=languageControl({route:'/archive/'});
 assert.match(unavailable,/aria-disabled="true"/);assert.match(unavailable,/暂无/);assert.doesNotMatch(unavailable,/href="\/en\//);
});
test('academic controls stay inside the toolbar, old unstyled links are replaced and decoration is idempotent',()=>{
 const site=profiles[0],html=page('<header class="site-header app-bar"><div class="app-bar-inner"><a href="/">品牌</a><nav>主导航</nav><button id="theme-toggle">主题</button></div><nav class="language-switch"><a href="/en/">English</a></nav></header>');
 const options={site,route:'/',englishHome:true},result=addLanguageNavigation(html,options);
 assert.match(result,/app-bar-inner[\s\S]*site-language-control[\s\S]*id="theme-toggle"[\s\S]*<\/div><\/header>/);
 assert.doesNotMatch(result,/class="language-switch"/);
 assert.equal((result.match(/href="\/site-language.css"/g)||[]).length,1);
 assert.equal(addLanguageNavigation(result,options),result);
 assert.match(result,/<main><h1>原始内容<\/h1><\/main>/);
});
test('the authored personal picker keeps all five language routes and verification files stay intact',()=>{
 const native=page('<header><label class="language-picker"><select id="language-select"><option>中文</option><option>English</option><option>日本語</option><option>Français</option><option>Español</option></select></label></header>');
 const result=addLanguageNavigation(native,{site:{id:'personal'},route:'/',englishHome:true});
 assert.equal(result.replace('<link rel="stylesheet" href="/site-language.css">',''),native);
 assert.equal(addLanguageNavigation('google-site-verification: value',{site:{},route:'/google.html'}),'google-site-verification: value');
});
test('reusing a validated older homepage updates shared asset hashes without changing its authored pages or artifact',async t=>{
 const root=await mkdtemp(join(tmpdir(),'language-homepage-reuse-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const site=profiles.find(s=>s.id==='personal'),source=join(root,'source'),target=join(root,'release'),artifact=join(source,'theme-homepages/personal');
 const html=page('<header><label class="language-picker"><select><option>中文</option><option>English</option></select></label></header>');
 const files={'index.html':html,'en/index.html':html.replace('lang="zh-CN"','lang="en"'),'site-language.css':'/* validated older CSS */','site-language.js':'/* validated older JS */'};
 const hashes={};
 for(const [file,bytes] of Object.entries(files)){
  await mkdir(join(artifact,'public',file,'..'),{recursive:true});await writeFile(join(artifact,'public',file),bytes);hashes[file]=byteHash(bytes);
 }
 const artifactManifest=JSON.stringify({version:1,themeId:'personal',siteId:site.id,origin:site.origin,files:hashes});
 await writeFile(join(artifact,'manifest.json'),artifactManifest);
 const homepage=await copyThemeHomepage({source,target,site,theme:{id:'personal',homepage:{}}});
 const manifest={homepage:{...homepage,hashes:undefined},hashes:{},byteHashes:{...homepage.hashes}};
 await finalizeLanguageNavigation({target,site,manifest});
 const saved=JSON.parse(await readFile(join(target,'release.json'),'utf8'));
 for(const file of ['site-language.css','site-language.js']){
  const bytes=await readFile(join(target,file));assert.notEqual(byteHash(bytes),hashes[file]);
  assert.equal(saved.byteHashes[file],byteHash(bytes),file+' must pass the publisher byte-hash verification');
  assert.equal(bytes.toString(),await readFile(new URL('../web/engine/'+file,import.meta.url),'utf8'));
 }
 for(const file of ['index.html','en/index.html'])assert.equal(await readFile(join(target,file),'utf8'),files[file]);
 assert.equal(saved.homepage.artifactHash,byteHash(artifactManifest));
 assert.equal(await readFile(join(artifact,'manifest.json'),'utf8'),artifactManifest);
 for(const [file,bytes] of Object.entries(files))assert.equal(await readFile(join(artifact,'public',file),'utf8'),bytes);
});
test('a real release includes controls on lists and untranslated articles without inventing translations or changing content dates',async t=>{
 const root=await mkdtemp(join(tmpdir(),'language-navigation-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const site=profiles.find(s=>s.id==='legis');
 const zh={id:'paired',title:'有英文版的文章',summary:'正文摘要保持不变。',markdown:'# 有英文版的文章\n\n正文保持不变。',date:'2026-10-23',category:site.columns[0],author:site.author};
 const en={...zh,id:editionArticleId(zh.id,'en'),locale:'en',translationOf:{articleId:zh.id,revision:1,sha256:sourceContentSha256(zh)},title:'Paired article',summary:'Original summary.',markdown:'# Paired article\n\nOriginal body.'};
 const other={...zh,id:'unpaired',title:'只有中文版的文章',markdown:'# 只有中文版的文章\n\n继续保留中文正文。'};
 const snapshot={news:[zh,en,other],data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:paired':'/news/paired/','news:unpaired':'/news/unpaired/',['news:'+en.id]:'/en/news/paired/'}};
 const options={site,source:process.cwd(),job:{id:'navigation',snapshot,snapshot_hash:'stable'}};
 const first=join(root,'a'),second=join(root,'b');
 const manifest=await buildSiteRelease({...options,target:first,now:new Date('2026-10-23T00:00:00Z')});
 for(const file of ['index.html','archive/index.html','news/paired/index.html','news/unpaired/index.html','en/index.html','en/news/paired/index.html']){
  const html=await readFile(join(first,file),'utf8');assert.equal((html.match(/class="site-language-control"/g)||[]).length,1,file);assert.ok(manifest.hashes[file]);
 }
 assert.match(await readFile(join(first,'news/unpaired/index.html'),'utf8'),/data-language-target="directory"/);
 assert.ok(manifest.hashes['site-language.css']);
 const content=JSON.parse(await readFile(join(first,'published-content.json'),'utf8'));assert.equal(content.records.find(r=>r.id==='news:unpaired').bodyMarkdown,other.markdown);
 await buildSiteRelease({...options,target:second,previousRoot:first,now:new Date('2026-10-24T00:00:00Z')});
 assert.equal(await readFile(join(first,'seo-manifest.json'),'utf8'),await readFile(join(second,'seo-manifest.json'),'utf8'));
 assert.equal(await readFile(join(first,'news/unpaired/index.html'),'utf8'),await readFile(join(second,'news/unpaired/index.html'),'utf8'));
});
