import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {addSocialMetadata} from '../web/engine/social-metadata.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';

const page=(origin,body='',lang='zh-CN')=>`<!doctype html><html lang="${lang}"><head><title>标题 &amp; 说明</title><meta name="description" content="摘要 &quot;引号&quot;"><link rel="canonical" href="${origin}/news/test/"></head><body>${body}</body></html>`;
const value=(html,key)=>html.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`))?.[1];
test('all ten sites have absolute, site-specific fallback images and idempotent metadata',()=>{
 for(const site of profiles){
  const original=page(site.origin),result=addSocialMetadata(original,{site,route:'/news/test/'});
  for(const key of ['og:type','og:locale','og:site_name','og:title','og:description','og:url','og:image','og:image:alt','og:image:type','twitter:card','twitter:title','twitter:description','twitter:image','twitter:image:alt'])assert.ok(value(result,key),site.id+': '+key);
  assert.equal(new URL(value(result,'og:image')).origin,site.origin);
  assert.equal(value(result,'og:image'),value(result,'twitter:image'));
  assert.equal(value(result,'og:title'),'标题 &amp; 说明');
  assert.equal(value(result,'og:description'),'摘要 &quot;引号&quot;');
  assert.equal(addSocialMetadata(result,{site,route:'/news/test/'}),result);
  assert.equal(result.slice(result.indexOf('</head>')),original.slice(original.indexOf('</head>')));
 }
});
test('article covers replace legacy defaults, relative URLs are expanded and stale fields are removed',()=>{
 const site=profiles.find(s=>s.id==='legis');
 const original=page(site.origin,'<article><img src="/article-media/first.webp" alt="第一张 &amp; 配图"><img src="/second.png"></article>')
  .replace('</head>','<meta property="og:type" content="article"><meta property="og:image" content="https://old.example/default.png"><meta property="og:image:width" content="999"></head>');
 const result=addSocialMetadata(original,{site,route:'/news/test/'});
 assert.equal(value(result,'og:image'),site.origin+'/article-media/first.webp');
 assert.equal(value(result,'og:image:alt'),'第一张 &amp; 配图');
 assert.equal(value(result,'og:image:width'),undefined);
 assert.equal(value(result,'og:image:type'),'image/webp');
 assert.equal((result.match(/property="og:image"/g)||[]).length,1);
 assert.doesNotMatch(result,/old\.example/);
 assert.equal(addSocialMetadata(result,{site,route:'/news/test/'}),result);
 const override=addSocialMetadata(original,{site,route:'/news/test/',record:{media:[{src:'javascript:alert(1)'}]}});
 assert.equal(value(override,'og:image'),site.origin+'/article-media/first.webp');
});
test('localized metadata is explicit; noindex pages stay untouched and cross-site canonicals fail',()=>{
 const site=profiles.find(s=>s.id==='personal'),source=page(site.origin,'','ja');
 const result=addSocialMetadata(source,{site,route:'/news/test/',title:'日本語の題名',description:'日本語の説明'});
 assert.equal(value(result,'og:locale'),'ja_JP');assert.equal(value(result,'twitter:title'),'日本語の題名');
 assert.throws(()=>addSocialMetadata(source,{site:{...site,origin:'https://other.example'},route:'/news/test/'}),/another site/);
 const error=source.replace('</head>','<meta name="robots" content="noindex,follow"></head>');
 assert.equal(addSocialMetadata(error,{site,route:'/404/'}),error);
});
test('journal releases publish article covers and image-free listing fallbacks in initial HTML',async t=>{
 const root=await mkdtemp(join(tmpdir(),'share-release-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const site=profiles.find(s=>s.id==='legis'),cover='/article-media/'+'a'.repeat(64)+'.webp';
 const snapshot={news:[{id:'test',title:'文章标题',category:site.columns[1],date:'2026-10-23',summary:'这里是文章的摘要，给读者提供阅读线索。',markdown:'# 文章标题\n\n正文保持不变。\n\n![文章封面]('+cover+')'}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:test':'/news/test/'}};
 const before=JSON.stringify(snapshot);
 const manifest=await buildSiteRelease({site,source:process.cwd(),target:root,job:{id:'share',snapshot,snapshot_hash:'fixture'}});
 const article=await readFile(join(root,'news/test/index.html'),'utf8'),home=await readFile(join(root,'index.html'),'utf8');
 assert.equal(value(article,'og:image'),site.origin+cover);
 assert.equal(value(article,'twitter:image'),site.origin+cover);
 assert.match(value(home,'og:image'),/\/apple-touch-icon\.png/);
 assert.ok(manifest.hashes['news/test/index.html']);
 assert.equal(JSON.stringify(snapshot),before);
});
