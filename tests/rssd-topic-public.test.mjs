import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fetchMethoCatalog,fetchPublicText,fetchAuthoritativeSource,isPublicAddress,publicHttpsUrl,CatalogSnapshotChangedError} from '../scripts/rssd-topic-public.mjs';

const site='https://metho.scholay.com';
const sitemap=paths=>'<urlset>'+paths.map(p=>'<url><loc>'+site+p+'</loc></url>').join('')+'</urlset>';
const archive=(page,pages,total,entries)=>'<p id="feed-count" role="status">'+total+' 条内容 · 第 '+page+' / '+pages+' 页</p>'+entries.map(([path,title])=>'<article class="feed-entry"><h2><a href="'+path+'">'+title+'</a></h2></article>').join('');
const ok=(url,text)=>({reachable:true,finalUrl:url,text});
test('catalog verifies all archive pages against exact sitemap and decodes titles',async()=>{
 const pages={'/sitemap-content.xml':sitemap(['/news/a/','/news/b/']),'/archive/':archive(1,2,2,[['/news/a/','Method &amp; analysis']]),'/archive/page/2/':archive(2,2,2,[['/news/b/','Second']])};
 const result=await fetchMethoCatalog({fetchPage:async url=>ok(url,pages[new URL(url).pathname]),now:()=>new Date('2026-11-02T12:00:00Z')});
 assert.deepEqual(result.titles,['Method & analysis','Second']);assert.equal(result.complete,true);assert.equal(result.workspaceId,'metho');
});
test('catalog fails closed when archive and sitemap differ, are incomplete, or change mid-read',async()=>{
 const pages={'/sitemap-content.xml':sitemap(['/news/a/','/news/b/']),'/archive/':archive(1,2,2,[['/news/a/','One']]),'/archive/page/2/':archive(2,2,2,[['/news/c/','Two']])};
 const fetchPage=async url=>ok(url,pages[new URL(url).pathname]);
 await assert.rejects(fetchMethoCatalog({fetchPage}),/do not match/);
 pages['/archive/page/2/']=archive(2,2,3,[['/news/b/','Two']]);await assert.rejects(fetchMethoCatalog({fetchPage,wait:async()=>{}}),/changed/);
 pages['/archive/page/2/']='broken';await assert.rejects(fetchMethoCatalog({fetchPage}),/count/);
});
test('archive snapshot conflicts retry the full collection with bounded backoff',async()=>{
 let attempts=0;const waits=[];
 const fetchPage=async url=>{const path=new URL(url).pathname;
  if(path==='/sitemap-content.xml'){attempts++;return ok(url,sitemap(['/news/a/','/news/b/']));}
  if(path==='/archive/')return ok(url,archive(1,2,2,[['/news/a/','One']]));
  return ok(url,archive(2,2,attempts<3?3:2,[['/news/b/','Two']]));
 };
 const catalog=await fetchMethoCatalog({fetchPage,wait:async ms=>{waits.push(ms);}});
 assert.deepEqual(catalog.titles,['One','Two']);assert.equal(attempts,3);assert.deepEqual(waits,[5000,15000]);
});
test('persistent snapshot conflict stops after three attempts; unrelated errors are not retried',async()=>{
 let attempts=0;const waits=[];
 const conflict=async url=>{const path=new URL(url).pathname;
  if(path==='/sitemap-content.xml'){attempts++;return ok(url,sitemap(['/news/a/','/news/b/']));}
  if(path==='/archive/')return ok(url,archive(1,2,2,[['/news/a/','One']]));
  return ok(url,archive(2,2,3,[['/news/b/','Two']]));
 };
 await assert.rejects(fetchMethoCatalog({fetchPage:conflict,wait:async ms=>{waits.push(ms);}}),CatalogSnapshotChangedError);
 assert.equal(attempts,3);assert.deepEqual(waits,[5000,15000]);
 attempts=0;waits.length=0;
 await assert.rejects(fetchMethoCatalog({fetchPage:async()=>{attempts++;throw Error('DNS denied');},wait:async ms=>{waits.push(ms);}}),/DNS denied/);
 assert.equal(attempts,1);assert.deepEqual(waits,[]);
});
test('private, synthetic, reserved and ambiguous addresses are rejected for arbitrary sources',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','198.18.16.138','192.0.2.1','::1','::ffff:8.8.8.8','fe80::1','fc00::1','2001:db8::1','2002:0a00:0001::1'])assert.equal(isPublicAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','2606:4700:4700::1111'])assert.equal(isPublicAddress(ip),true,ip);
 assert.throws(()=>publicHttpsUrl('http://example.org/'),/HTTPS/);assert.throws(()=>publicHttpsUrl('https://user:pass@example.org/'),/HTTPS/);
 assert.throws(()=>publicHttpsUrl('https://127.0.0.1/'),/Private/);assert.throws(()=>publicHttpsUrl('https://localhost/'),/Local/);
 await assert.rejects(fetchPublicText('https://example.org/',{resolve:async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],request:()=>{throw Error('must not connect');}}),/public addresses/);
});
function mockRequest(responses,seen){return (url,options,callback)=>{
 const req=new EventEmitter();req.destroy=()=>{};req.end=()=>setImmediate(()=>{
  seen.push({url:String(url),options});const item=responses.shift();const res=new PassThrough();res.statusCode=item.status;res.headers=item.headers||{};callback(res);res.end(item.body||'');
 });return req;
};}
test('allowlisted authority accepts synthetic proxy DNS, pins TLS and never claims semantic verification',async()=>{
 const seen=[];const result=await fetchAuthoritativeSource('https://pubmed.ncbi.nlm.nih.gov/123/',{resolve:async()=>[{address:'198.18.16.138',family:4}],request:mockRequest([{status:200,headers:{'content-type':'text/html'},body:'<p>Source text</p>'}],seen)});
 assert.equal(result.reachable,true);assert.equal(result.verified,undefined);assert.match(result.text,/Source text/);assert.equal(seen[0].options.family,4);assert.equal(seen[0].options.agent,false);
 let pinned;seen[0].options.lookup('pubmed.ncbi.nlm.nih.gov',{},(e,address)=>{pinned=address;});assert.equal(pinned,'198.18.16.138');
 await assert.rejects(fetchAuthoritativeSource('https://pubmed.ncbi.nlm.nih.gov.evil.example/',{resolve:async()=>[{address:'198.18.16.138',family:4}],request:()=>{throw Error('must not connect');}}),/unlisted/);
 await assert.rejects(fetchPublicText('https://metho.scholay.com.evil.example/',{proxyMode:'metho',resolve:async()=>[{address:'198.18.16.138',family:4}],request:()=>{throw Error('must not connect');}}),/unlisted/);
});
test('redirects cannot leave exact allowlist or reach private addresses',async()=>{
 const redirect=()=>mockRequest([{status:302,headers:{location:'https://doi.org.evil.example/path'}}],[]);
 await assert.rejects(fetchAuthoritativeSource('https://doi.org/x',{resolve:async()=>[{address:'198.18.16.138',family:4}],request:redirect()}),/unlisted/);
 const privateRedirect=mockRequest([{status:302,headers:{location:'https://127.0.0.1/private'}}],[]);
 await assert.rejects(fetchPublicText('https://example.org/',{resolve:async()=>[{address:'8.8.8.8',family:4}],request:privateRedirect}),/Private/);
});
test('public fetch limits response size and bounds stalled DNS',async()=>{
 const oversized=mockRequest([{status:200,headers:{'content-type':'text/plain'},body:'abcdef'}],[]);
 await assert.rejects(fetchPublicText('https://example.org/',{resolve:async()=>[{address:'8.8.8.8',family:4}],request:oversized,maxBytes:4}),/size limit/);
 await assert.rejects(fetchPublicText('https://example.org/',{resolve:()=>new Promise(()=>{}),timeoutMs:10}),/DNS resolution timed out/);
});
test('non-200 responses retain their HTTP status for narrow fallback selection',async()=>{
 const notAuthoritative=mockRequest([{status:203,headers:{'content-type':'text/html'}}],[]);
 await assert.rejects(fetchAuthoritativeSource('https://pubmed.ncbi.nlm.nih.gov/123/',{resolve:async()=>[{address:'8.8.8.8',family:4}],request:notAuthoritative}),{status:203});
});
