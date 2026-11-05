import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile, cp, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildSeoSite, siteOrigin} from '../scripts/build-seo.mjs';
import {createSeoState,sitemapXml,splitSitemap} from '../scripts/seo-state.mjs';

const detailRoute=route=>/^\/(calendar|history|open-source)\/[^/]+\/$/.test(route);
const locations=xml=>[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>match[1]);
// data.json and open-source.json are manual exports of private data.
const exports={skip:!(existsSync('data.json')&&existsSync('open-source.json'))&&'requires the private data exports'};

test('SEO output has canonical semantic pages and a hash-free sitemap', exports, async () => {
  const output=await mkdtemp(join(tmpdir(),'scholay-seo-test-'));
  try {
    const result=await buildSeoSite({output});
    assert(result.counts.calendar>0);
    assert(result.counts.history>0);
    assert(result.counts.openSource>0);
    const sitemap=await readFile(join(output,'sitemap.xml'),'utf8');
    const robots=await readFile(join(output,'robots.txt'),'utf8');
    const calendar=await readFile(join(output,'calendar','index.html'),'utf8');
    const firstDetail=await readFile(join(output,result.routes.find(route=>route.startsWith('/calendar/')&&detailRoute(route)),'index.html'),'utf8');
    assert.match(robots,new RegExp('Sitemap: '+siteOrigin.replaceAll('.','\\.')+'/sitemap\\.xml'));
    assert.match(sitemap,/<sitemapindex /);
    const listed=new Set();
    for(const url of locations(sitemap)) {
      const child=await readFile(join(output,new URL(url).pathname),'utf8');
      assert.match(child,/<urlset /);
      assert.equal(locations(child).length,(child.match(/<lastmod>/g)||[]).length);
      for(const page of locations(child))listed.add(page);
    }
    assert.deepEqual([...listed].sort(),result.routes.map(route=>siteOrigin+route).sort());
    assert.equal(result.routes.filter(detailRoute).length,Object.values(result.counts).reduce((a,b)=>a+b,0));
    assert(!sitemap.includes('#'));
    assert.equal((calendar.match(/rel="canonical"/g)||[]).length,1);
    assert.match(calendar,/<h1>今日学术<\/h1>/);
    assert.match(calendar,/<a class="interaction-link" href="\/#\/year">打开今日学术日历/);
    const history=await readFile(join(output,'history/index.html'),'utf8');
    assert.match(history,/<h1>昔日学术<\/h1>/);
    assert.match(history,/<a class="interaction-link" href="\/#\/history">打开昔日学术日历/);
    assert.match(calendar,/"@type":"CollectionPage"/);
    assert.equal((firstDetail.match(/rel="canonical"/g)||[]).length,1);
    assert.match(firstDetail,/<h1>.+<\/h1>/);
    assert.match(firstDetail,/"@type":"Article"/);
    const historyDetail=await readFile(join(output,result.routes.find(route=>route.startsWith('/history/')&&detailRoute(route)),'index.html'),'utf8');
    assert.match(historyDetail,/<dd>\d{4} 年 \d{1,2} 月 \d{1,2} 日<\/dd>/);
    const archive=await readFile(join(output,'archive/index.html'),'utf8');
    assert.match(archive,/class="archive-sidebar"/);assert.match(archive,/class="archive-grid"/);
    for(const name of ['学界犀闻','学者观察','昔日学术','今日学术','学术开源'])assert(archive.includes('<span>'+name+'</span>'));
    assert.match(archive,/<header class="site-header app-bar">/);assert.doesNotMatch(archive,/class="seo-header"|type="module"/);
    assert.match(archive,/href="\/#\/year"/);assert.match(archive,/href="https:\/\/pm.scholay.com\/"/);
    const legacy=await readFile(join(output,'news/index.html'),'utf8');assert.match(legacy,/http-equiv="refresh" content="0;url=\/archive\/"/);
    assert(!listed.has(siteOrigin+'/news/'));
    const archiveIndex=JSON.parse(await readFile(join(output,'archive-index.json'),'utf8'));
    assert.equal(archiveIndex.records.length,Object.values(result.counts).reduce((a,b)=>a+b,0));
    assert(!JSON.stringify(archiveIndex).includes('base64'));
  } finally {
    await rm(output,{recursive:true,force:true});
  }
});

test('content dates survive rebuilds and only affected pages and sitemaps change',async t=>{
  const root=await mkdtemp(join(tmpdir(),'scholay-seo-dates-')),output=join(root,'output');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await cp(new URL('../web/themes/academic/public/index.html',import.meta.url),join(root,'index.html'));
  const calendar={year:Array.from({length:121},(_,i)=>({id:'record-'+i,title:'记录 '+i,start:'2030-01-01',end:'2030-01-02',category:'会议',summary:'摘要',sourceName:'来源',sourceUrl:'https://example.org/'+i,provenance:'已核验官网'})),history:[{id:'history',title:'历史事件',dateKey:'02-29',year:1900,domain:'计算史',factSummary:'事实',sources:[{url:'https://example.org/history'}]}],exportedAt:'2026-09-01T00:00:00Z'};
  const sources={items:[{title:'开源项目',date:'2020-01-01',url:'https://example.org/project',summary:'简介',category:'工具'}]};
  const save=async()=>{await writeFile(join(root,'data.json'),JSON.stringify(calendar));await writeFile(join(root,'open-source.json'),JSON.stringify(sources));};
  const manifest=async()=>JSON.parse(await readFile(join(output,'seo-manifest.json'),'utf8'));
  await save();await buildSeoSite({root,output,now:'2026-09-20T01:00:00Z'});
  const first=await manifest();
  assert(first.routes.includes('/calendar/page/2/'));
  const page1=await readFile(join(output,'calendar/index.html'),'utf8'),page2=await readFile(join(output,'calendar/page/2/index.html'),'utf8');
  assert.match(page1,/rel="next" href="\/calendar\/page\/2\/"/);
  assert.match(page2,/rel="canonical" href="https:\/\/today.scholay.com\/calendar\/page\/2\/"/);
  assert.match(page2,/rel="prev" href="\/calendar\/"/);
  const reachable=new Set([...page1.matchAll(/href="(\/calendar\/[^/]+\/)"/g),...page2.matchAll(/href="(\/calendar\/[^/]+\/)"/g)].map(m=>m[1]));
  assert.equal(reachable.size,121);
  for(const value of Object.values(first.pages))assert.equal(value.lastmod,'2026-09-20T01:00:00Z');

  calendar.exportedAt='2026-09-21T02:00:00Z';sources.exportedAt=calendar.exportedAt;
  await save();await buildSeoSite({root,output,now:'2026-09-21T02:00:00Z'});
  assert.deepEqual(await manifest(),first);
  assert.equal((await stat(join(output,'sitemap.xml'))).mtime.toISOString(),'2026-09-20T01:00:00.000Z');

  const editedRoute=first.routes.find(route=>route.includes('record-0-'));
  calendar.year[0].summary='重新核对后的完整摘要';
  await save();await buildSeoSite({root,output,now:'2026-09-22T03:00:00Z'});
  const edited=await manifest();
  assert.equal(edited.pages[editedRoute].lastmod,'2026-09-22T03:00:00Z');
  const changedDetails=first.routes.filter(detailRoute).filter(route=>edited.pages[route].lastmod!==first.pages[route].lastmod);
  assert.deepEqual(changedDetails,[editedRoute]);
  assert.equal(edited.pages['/'].lastmod,'2026-09-22T03:00:00Z');
  for(const section of ['history','open-source'])assert.deepEqual(edited.files['sitemap-'+section+'.xml'],first.files['sitemap-'+section+'.xml']);
  assert.equal(edited.files['sitemap-calendar.xml'].lastmod,'2026-09-22T03:00:00Z');
  assert.equal(edited.files['sitemap-recent.xml'].lastmod,'2026-09-22T03:00:00Z');
  const detail=await readFile(join(output,editedRoute,'index.html'),'utf8');
  assert.match(detail,/"dateModified":"2026-09-22T03:00:00Z"/);
  assert.match(detail,/<time datetime="2026-09-22T03:00:00Z">/);

  calendar.year.shift();await save();await buildSeoSite({root,output,now:'2026-09-23T04:00:00Z'});
  const removed=await manifest();
  assert(!removed.pages[editedRoute]);assert(!removed.pages['/calendar/page/2/']);
  assert.equal(removed.files['sitemap-calendar.xml'].lastmod,'2026-09-23T04:00:00Z');
  assert.equal(removed.files['sitemap.xml'].lastmod,'2026-09-23T04:00:00Z');
  const xml=await readFile(join(output,'sitemap-calendar.xml'),'utf8');
  assert(!xml.includes(editedRoute));
  assert(!xml.includes('2026-09-23T04:00:00Z')); // Survivors retain their actual older dates.
  await assert.rejects(readFile(join(output,editedRoute,'index.html')));
});

test('sitemaps escape XML, split large sets, and reject future persisted timestamps',()=>{
  const entries=Array.from({length:10001},(_,i)=>({loc:siteOrigin+'/example/'+i+'/',lastmod:'2026-09-20T01:00:00Z'}));
  const chunks=splitSitemap('calendar',entries);
  assert.deepEqual(chunks.map(part=>part.entries.length),[10000,1]);
  assert.equal(chunks[1].name,'sitemap-calendar-2.xml');
  assert.match(sitemapXml([{...entries[0],loc:'https://example.org/?a=1&b=2'}]),/a=1&amp;b=2/);
  assert.throws(()=>sitemapXml(Array(50001).fill(entries[0])),/50,000/);
  const state=createSeoState({version:2,pages:{'/':{lastmod:'2030-01-01T00:00:00Z',hash:'old'}}},'2026-09-30T00:00:00Z');
  assert.throws(()=>state.page('/','content'),/Invalid prior SEO timestamp/);
});

test('root HTML exposes canonical, social metadata, structured data, and static crawl links', async () => {
  const root=await readFile(new URL('../web/themes/academic/public/index.html',import.meta.url),'utf8');
  assert.match(root,/<link rel="canonical" href="https:\/\/today\.scholay\.com\/">/);
  assert.match(root,/<meta property="og:image" content="https:\/\/today\.scholay\.com\/social-preview\.png">/);
  assert.match(root,/<meta name="twitter:card" content="summary_large_image">/);
  assert.match(root,/"@type":"WebSite"/);
  for(const route of ['/calendar/','/history/','/open-source/']) assert(root.includes('href="'+route+'"'));
});

test('academic RSS uses published news, escaped summaries and frozen links and survives rebuilds',exports,async t=>{
  const root=await mkdtemp(join(tmpdir(),'academic-rss-')),output=join(root,'out');
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const name of ['data.json','open-source.json'])await cp(name,join(root,name));
  await cp('web/themes/academic/public/index.html',join(root,'index.html'));
  const item={id:'rss-note',title:'A & B <研究>',summary:'摘要 <标签> & 内容',markdown:'正文',date:'2026-10-20'};
  await writeFile(join(root,'news.json'),JSON.stringify({items:[{...item,id:'older-note',date:'2026-10-19'},item]}));
  await writeFile(join(root,'permalinks.json'),JSON.stringify({'news:rss-note':'/news/frozen-note/'}));
  await buildSeoSite({root,output,now:'2026-10-20T00:00:00Z'});
  const rss=await readFile(join(output,'content-feed.xml'),'utf8');
  assert.match(rss,/<rss version="2.0"/);
  assert.match(rss,/<title>A &amp; B &lt;研究&gt;<\/title>/);
  assert.match(rss,/<description>摘要 &lt;标签&gt; &amp; 内容<\/description>/);
  assert.match(rss,/<guid isPermaLink="true">https:\/\/today.scholay.com\/news\/frozen-note\/<\/guid>/);
  assert.equal((rss.match(/<category>学界犀闻<\/category>/g)||[]).length,2);
  assert.equal((rss.match(/<category>今日学术<\/category>/g)||[]).length,20);
  assert.equal((rss.match(/<category>昔日学术<\/category>/g)||[]).length,20);
  assert(rss.indexOf('/news/frozen-note/')<rss.indexOf('/news/older-note/'));
  assert.match(rss,/<pubDate>Tue, 20 Oct 2026 00:00:00 GMT<\/pubDate>/);
  for(const path of ['index.html','archive/index.html','news/frozen-note/index.html']){
    const page=await readFile(join(output,path),'utf8');
    assert.match(page,/rel="alternate" type="application\/rss\+xml"/);
    assert.match(page,/<a href="\/content-feed.xml">RSS 订阅<\/a>/);
  }
  await buildSeoSite({root,output,now:'2026-10-21T00:00:00Z'});
  assert.equal(await readFile(join(output,'content-feed.xml'),'utf8'),rss);
  await writeFile(join(root,'news.json'),'{"items":[]}');
  await buildSeoSite({root,output});
  assert.doesNotMatch(await readFile(join(output,'content-feed.xml'),'utf8'),/\/news\/frozen-note\//);
});
