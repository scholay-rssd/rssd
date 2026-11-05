import test from 'node:test';
import assert from 'node:assert/strict';
import {addHomepageStructuredData} from '../web/engine/homepage-seo.mjs';
const site={name:'学术海',origin:'https://pm.scholay.com'};
const page=(route='/',lang='zh-CN')=>`<!doctype html><html lang="${lang}"><head><title>项目 &amp; 笔记</title><meta content="已有页面 &quot;介绍&quot;" name="description"><link href="${site.origin}${route}" rel="canonical"></head><body><main>已有内容</main><script>window.keep = true;</script></body></html>`;
const schema=html=>JSON.parse(html.match(/<script type="application\/ld\+json" data-homepage-seo>([\s\S]*?)<\/script>/)[1]);
test('homepage build adds linked site/page data while preserving all existing HTML',()=>{
 const html=page(),result=addHomepageStructuredData(html,{site,route:'/'}),data=schema(result);
 assert.equal(result.replace(/<script type="application\/ld\+json" data-homepage-seo>[\s\S]*?<\/script>\n/,''),html);
 assert.equal(data['@graph'][0].name,site.name);
 assert.equal(data['@graph'][1].name,'项目 & 笔记');
 assert.equal(data['@graph'][1].description,'已有页面 "介绍"');
 assert.equal(data['@graph'][1].isPartOf['@id'],data['@graph'][0]['@id']);
 assert.equal(addHomepageStructuredData(result,{site,route:'/'}),result);
});
test('localized project pages keep their own canonical and language',()=>{
 const route='/ja/projects/rimes/',data=schema(addHomepageStructuredData(page(route,'ja'),{site,route}));
 assert.equal(data['@graph'][1].url,site.origin+route);
 assert.equal(data['@graph'][1].inLanguage,'ja');
 assert.equal(data['@graph'][0].url,site.origin+'/');
});
test('noindex error pages remain untouched and wrong-site metadata fails the build',()=>{
 const error=page().replace('</head>','<meta name="robots" content="noindex, follow"></head>');
 assert.equal(addHomepageStructuredData(error,{site,route:'/404/'}),error);
 assert.throws(()=>addHomepageStructuredData(page(),{site:{...site,origin:'https://wrong.example'},route:'/'}),/canonical mismatch/);
 assert.throws(()=>addHomepageStructuredData(page(),{site,route:'/projects/'}),/canonical mismatch/);
 assert.throws(()=>addHomepageStructuredData(page().replace('<title>项目 &amp; 笔记</title>',''),{site,route:'/'}),/metadata incomplete/);
});
test('metadata cannot terminate the structured-data script',()=>{
 const html=page().replace('项目 &amp; 笔记','&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
 const result=addHomepageStructuredData(html,{site,route:'/'});
 assert.equal(schema(result)['@graph'][1].name,'</script><script>alert(1)</script>');
 assert.equal((result.match(/<script>/g)||[]).length,1);
 assert.match(result,/\\u003c\/script>/);
});
