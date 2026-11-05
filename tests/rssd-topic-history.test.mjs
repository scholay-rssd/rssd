import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicHistoryAdapter} from '../scripts/rssd-topic-history.mjs';
const origin='https://metho.scholay.com';
const slot={siteId:'metho',workspaceId:'metho'};
const map=(paths,site=origin)=>'<urlset>'+paths.map(x=>'<url><loc>'+site+x+'</loc></url>').join('')+'</urlset>';
const page=(n,pages,total,items)=>'<p id="feed-count">'+total+' 条内容 · 第 '+n+' / '+pages+' 页</p>'+items.map(([url,title])=>'<article class="feed-entry"><h2><a href="'+url+'">'+title+'</a></h2></article>').join('');
const mock=pages=>async url=>{let path=new URL(url).pathname;if(path==='/content-feed-index.json'&&!Object.hasOwn(pages,path)){const entries=Object.entries(pages).filter(([k])=>k.startsWith('/archive/')).flatMap(([,v])=>[...v.matchAll(/<h2><a href="([^"]+)">([^<]+)<\/a><\/h2>/g)].map(m=>({route:m[1],title:m[2].replaceAll('&amp;','&')})));return {reachable:true,finalUrl:url,text:JSON.stringify({siteId:'metho',version:1,records:entries})};}return {reachable:true,finalUrl:url,text:pages[path]};};
test('site history validates complete archive and returns site-bound titles',async()=>{
 const files={'/sitemap-content.xml':map(['/news/a/','/news/b/']),'/archive/':page(1,2,2,[['/news/a/','One &amp; two']]),'/archive/page/2/':page(2,2,2,[['/news/b/','Three']])};
 const read=createPublicHistoryAdapter({fetchPage:mock(files)}),result=await read({slot});assert.deepEqual(result.titles,['One & two','Three']);assert.equal(result.complete,true);assert.equal(result.siteId,'metho');assert.equal(result.origin,origin);
 await assert.rejects(read({slot:{siteId:'metho',workspaceId:'pets'}}),/scope/);await assert.rejects(read({slot:{siteId:'fake',workspaceId:'fake'}}),/scope/);
});
test('incomplete, duplicated, changed or cross-site history never becomes complete',async()=>{
 const files={'/sitemap-content.xml':map(['/news/a/','/news/b/']),'/archive/':page(1,2,2,[['/news/a/','A']]),'/archive/page/2/':page(2,2,2,[['/news/c/','C']])};const read=createPublicHistoryAdapter({fetchPage:mock(files),cacheMs:0});
 await assert.rejects(read({slot}),/do not match/);files['/archive/page/2/']=page(2,2,3,[['/news/b/','B']]);await assert.rejects(read({slot}),/changed/);
 files['/archive/page/2/']=page(2,2,2,[['/news/a/','A']]);await assert.rejects(read({slot}),/do not match/);files['/sitemap-content.xml']=map(['/news/a/'],'https://evil.example');await assert.rejects(read({slot}),/origin/);
});
test('cache verifies sitemap per read, isolates mutation, expires and never serves stale on failure',async()=>{
 let now=1000000,calls=0;const files={'/sitemap-content.xml':map(['/news/a/']),'/archive/':page(1,1,1,[['/news/a/','A']])};
 const read=createPublicHistoryAdapter({fetchPage:async url=>{calls++;if(files.fail)throw Error('offline');return mock(files)(url)},clock:()=>now,cacheMs:300000});
 const a=await read({slot});a.titles[0]='corrupt';const b=await read({slot});assert.equal(b.cacheHit,true);assert.equal(b.titles[0],'A');assert.equal(calls,7);
 files.fail=true;await assert.rejects(read({slot}),/offline/);files.fail=false;now+=300001;const c=await read({slot});assert.equal(c.cacheHit,false);
 files['/sitemap-content.xml']=map(['/news/b/']);await assert.rejects(read({slot}),/do not match/);
});
test('academic site uses category sitemap shards and academic archive format',async()=>{
 const o='https://today.scholay.com',academic={siteId:'scholay-today',workspaceId:'academic'};const paths=['calendar','history','open-source','news'];
 const files={'/sitemap.xml':'<sitemapindex>'+paths.map(x=>'<sitemap><loc>'+o+'/sitemap-'+x+'.xml</loc></sitemap>').join('')+'</sitemapindex>', '/archive/':'<span id="archive-result-count">4 篇 · 第 1 / 1 页</span>'+paths.map(x=>'<article class="archive-record"><a href="/'+x+'/a/"><h2>'+x+'</h2></a></article>').join('')};for(const x of paths)files['/sitemap-'+x+'.xml']=map(['/'+x+'/a/'],o);files['/archive-index.json']=JSON.stringify({records:paths.map(x=>({route:'/'+x+'/a/',title:x}))});
 const read=createPublicHistoryAdapter({fetchPage:mock(files)});const result=await read({slot:academic});assert.equal(result.titles.length,4);files['/sitemap.xml']=files['/sitemap.xml'].replace('<sitemap><loc>'+o+'/sitemap-news.xml</loc></sitemap>','');await assert.rejects(read({slot:academic}),/missing/);
});
test('sitemap mutation during full collection and malformed or oversized data fail closed',async()=>{
 let n=0;const xml=map(['/news/a/']);const read=createPublicHistoryAdapter({fetchPage:async url=>({reachable:true,finalUrl:url,text:new URL(url).pathname==='/archive/'?page(1,1,1,[['/news/a/','A']]):new URL(url).pathname==='/content-feed-index.json'?JSON.stringify({siteId:'metho',version:1,records:[{route:'/news/a/',title:'A'}]}):(++n===1?xml:xml+' ' )})});await assert.rejects(read({slot}),/changed/);
 const bad=createPublicHistoryAdapter({fetchPage:async url=>({reachable:true,finalUrl:url,text:'<!DOCTYPE urlset [<!ENTITY x "x">]><urlset><url><loc>&x;</loc></url></urlset>'})});await assert.rejects(bad({slot}),/Invalid sitemap/);
});
test('unchanged sitemap does not hide a changed catalog title',async()=>{
 const files={'/sitemap-content.xml':map(['/news/a/']),'/archive/':page(1,1,1,[['/news/a/','A']]),'/content-feed-index.json':JSON.stringify({version:1,siteId:'metho',records:[{route:'/news/a/',title:'A'}]})};
 const read=createPublicHistoryAdapter({fetchPage:mock(files)});await read({slot});
 files['/content-feed-index.json']=JSON.stringify({version:1,siteId:'metho',records:[{route:'/news/a/',title:'B'}]});
 await assert.rejects(read({slot}),/feed index do not match/);
});
test('HTML entities are decoded once while catalog titles stay literal',async()=>{
 const files={'/sitemap-content.xml':map(['/news/a/']),'/archive/':page(1,1,1,[['/news/a/','Code &amp;copy; and &amp; methods']]),'/content-feed-index.json':JSON.stringify({version:1,siteId:'metho',records:[{route:'/news/a/',title:'Code &copy; and & methods'}]})};
 const result=await createPublicHistoryAdapter({fetchPage:mock(files)})({slot});assert.deepEqual(result.titles,['Code &copy; and & methods']);
});
test('one bounded retry is allowed only for transient network failure',async()=>{
 const files={'/sitemap-content.xml':map(['/news/a/']),'/archive/':page(1,1,1,[['/news/a/','A']])};let n=0;
 const read=createPublicHistoryAdapter({fetchPage:async url=>{if(++n===1)throw Error('Public source timed out');return mock(files)(url)}});assert.equal((await read({slot})).complete,true);assert.equal(n,6);
 n=0;const blocked=createPublicHistoryAdapter({fetchPage:async()=>{n++;throw Error('Source DNS did not resolve exclusively to public addresses')}});await assert.rejects(blocked({slot}),/public addresses/);assert.equal(n,1);
});
test('collection deadline stops a slow inventory without returning a partial catalog',async()=>{
 let now=0;const files={'/sitemap-content.xml':map(['/news/a/']),'/archive/':page(1,1,1,[['/news/a/','A']])};
 const read=createPublicHistoryAdapter({clock:()=>now,maxDurationMs:1000,fetchPage:async url=>{now+=400;return mock(files)(url)}});
 await assert.rejects(read({slot}),/collection timed out/);
});
