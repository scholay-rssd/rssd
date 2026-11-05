import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {configuredSectionFeeds,fetchSectionRssLeads,parseRssFeed} from '../scripts/rssd-topic-rss.mjs';
import {fetchPublicText} from '../scripts/rssd-topic-public.mjs';

const feed=(id,url,folderId,extra={})=>({id,url,siteUrl:null,title:id,folderId,sourceType:'rss',customTitle:false,refreshIntervalMin:null,autoTranslate:false,openMode:null,archived:false,connectorId:null,...extra});
const catalog=()=>({version:1,connectors:[],workspaces:[{spaceId:'pets',siteId:'pets',name:'萌宠',folders:[{id:'cats',name:'每日一猫',position:1,parentId:null},{id:'extra',name:'每日一猫 · 扩增',position:2,parentId:null},{id:'dogs',name:'每日一狗',position:3,parentId:null}],feeds:[feed('feed-cat','https://cats.example/rss','cats'),feed('feed-more','https://more.example/rss','extra'),feed('feed-dog','https://dogs.example/rss','dogs'),feed('feed-http','http://old.example/rss','cats'),feed('feed-podcast','https://audio.example/rss','cats',{sourceType:'podcast'}),feed('feed-archived','https://gone.example/rss','cats',{archived:true})]}]});
const organization={siteId:'pets',sections:[{id:'daily-cat',name:'每日一猫'},{id:'daily-dog',name:'每日一狗'},{id:'missing',name:'没有映射'}]};
const policy={siteId:'pets',sectionId:'daily-cat',enabled:true};

test('RSS planning uses explicit enabled site/section and exact folder names only',()=>{
  const result=configuredSectionFeeds({catalog:catalog(),organization,policy});
  assert.deepEqual(result.feeds.map(x=>x.id),['feed-cat','feed-more']);
  assert.deepEqual(result.folders.map(x=>x.id),['cats','extra']);
  assert.deepEqual(new Set(result.skipped.map(x=>x.id)),new Set(['feed-http','feed-podcast']));
  assert(!result.feeds.some(x=>x.id==='feed-archived'||x.id==='feed-dog'));
  assert.throws(()=>configuredSectionFeeds({catalog:catalog(),organization,policy:{...policy,enabled:false}}),/explicitly enabled/);
  assert.throws(()=>configuredSectionFeeds({catalog:catalog(),organization,policy:{...policy,sectionId:'missing'}}),/explicit RSS folder/);
  assert.throws(()=>configuredSectionFeeds({catalog:catalog(),organization:{...organization,siteId:'other'},policy}),/does not match/);
  assert.throws(()=>configuredSectionFeeds({catalog:catalog(),organization,policy:{...policy,sectionId:'unknown'}}),/unknown or ambiguous/);
});

test('parser reads RSS and Atom safely without network or external entities',async()=>{
  const rss='<?xml version="1.0"?><rss><channel><item><title>猫 &amp; care</title><link>https://cats.example/a</link><description><![CDATA[<p>Important <b>care</b></p><script>bad()</script>]]></description><pubDate>Mon, 02 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>';
  const a=await parseRssFeed(rss);assert.equal(a[0].title,'猫 & care');assert.match(a[0].summary,/Important care/);assert(!a[0].summary.includes('bad()'));
  const atom='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Entry</title><link rel="self" href="https://cats.example/self"/><link rel="alternate" href="https://cats.example/article"/><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><script>bad()</script><p>Actual text</p></div></content><updated>2026-11-02T12:00:00Z</updated></entry></feed>';
  const b=await parseRssFeed(atom);assert.equal(b[0].link,'https://cats.example/article');assert.equal(b[0].summary,'Actual text');
  await assert.rejects(parseRssFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel/></rss>'),/Invalid/);
  await assert.rejects(parseRssFeed('<html><body>not a feed</body></html>'),/Invalid/);
  await assert.rejects(parseRssFeed('x'.repeat(1048577)),/input/);
});

test('an unresponsive isolated RSS parser is stopped within its deadline',async()=>{
  const child=new EventEmitter(),signals=[];child.stdout=new PassThrough();child.stdin=new PassThrough();child.kill=signal=>{signals.push(signal);return true;};
  await assert.rejects(parseRssFeed('<rss/>',{timeoutMs:15,spawnProcess:()=>child}),/timed out/);
  assert.deepEqual(signals,['SIGTERM']);child.emit('close',null);
});

test('RSS discovery bounds work, filters unsafe, stale and duplicate article links, and treats leads as unverified',async()=>{
  const now=Date.parse('2026-11-02T13:00:00Z'),calls=[];
  const fetchText=async(url,options)=>{calls.push({url,options});return {reachable:true,originalUrl:url,finalUrl:url,text:'fixture'};};
  const parseFeed=async()=>[
    {title:'A',link:'https://cats.example/story?id=3&utm_source=x',summary:'Lead only',publishedAt:'2026-11-02T12:00:00Z'},
    {title:'Duplicate',link:'https://cats.example/story?id=3',summary:'duplicate',publishedAt:'2026-11-02T12:00:00Z'},
    {title:'Secret',link:'https://cats.example/private?token=abc',publishedAt:'2026-11-02T12:00:00Z'},
    {title:'Private',link:'https://127.0.0.1/private',publishedAt:'2026-11-02T12:00:00Z'},
    {title:'Old',link:'https://cats.example/old',publishedAt:'2020-01-01T00:00:00Z'},
    {title:'Future',link:'https://cats.example/future',publishedAt:'2027-01-01T00:00:00Z'}
  ];
  const out=await fetchSectionRssLeads({catalog:catalog(),organization,policy,now,fetchText,parseFeed});
  assert.equal(calls.length,2);assert(calls.every(c=>c.options.proxyMode==='configured-rss'&&c.options.configuredRssHost===new URL(c.url).hostname));
  assert.equal(out.leads.length,1);assert.equal(out.leads[0].url,'https://cats.example/story?id=3');assert.match(out.notice,/untrusted leads/);assert.equal(out.leads[0].verified,undefined);
});

test('failures are bounded and a complete inability to obtain recent leads stops discovery',async()=>{
  let calls=0;
  await assert.rejects(fetchSectionRssLeads({catalog:catalog(),organization,policy,fetchText:async()=>{calls++;throw Error('not available');}}),/No recent/);
  assert.equal(calls,2);
  calls=0;await assert.rejects(fetchSectionRssLeads({catalog:catalog(),organization,policy:{...policy,enabled:false},fetchText:async()=>{calls++;}}),/explicitly enabled/);assert.equal(calls,0);
  await assert.rejects(fetchSectionRssLeads({catalog:catalog(),organization,policy,maxFeeds:11}),/limits/);
});

function request(responses,seen){return (url,opts,callback)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=()=>setImmediate(()=>{seen.push(String(url));const item=responses.shift(),res=new PassThrough();res.statusCode=item.status;res.headers=item.headers||{};callback(res);res.end(item.body||'');});return req;};}
test('configured RSS proxy exception is exact-host only and validates each redirect and DNS',async()=>{
  const resolve=async()=>[{address:'198.18.16.138',family:4}],seen=[];
  const ok=await fetchPublicText('https://cats.example/rss',{proxyMode:'configured-rss',configuredRssHost:'cats.example',resolve,request:request([{status:200,headers:{'content-type':'application/rss+xml'},body:'<rss/>'}],seen)});
  assert.equal(ok.text,'<rss/>');assert.deepEqual(seen,['https://cats.example/rss']);
  await assert.rejects(fetchPublicText('https://cats.example.evil/rss',{proxyMode:'configured-rss',configuredRssHost:'cats.example',resolve}),/does not match/);
  await assert.rejects(fetchPublicText('https://cats.example/rss',{proxyMode:'configured-rss',configuredRssHost:'cats.example',resolve,request:request([{status:302,headers:{location:'https://cats.example.evil/feed'}}],[])}),/unlisted/);
  await assert.rejects(fetchPublicText('https://cats.example/rss',{proxyMode:'configured-rss',configuredRssHost:'cats.example',resolve:async()=>[{address:'198.18.16.1',family:4},{address:'10.0.0.5',family:4}]}),/public addresses/);
});
