import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {profiles} from '../scripts/site-config.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';
import {sectionRssFeeds} from '../web/engine/section-rss.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
const selected=['scholay-today','legis','metho','enter','xsiching','study'];
test('all 28 column feeds have distinct polling URLs, first twenty records, full bodies and stable original GUIDs',()=>{
 const urls=new Set();
 for(const site of profiles.filter(s=>selected.includes(s.id))){
  const records=sectionsForSite(site).flatMap(section=>Array.from({length:27},(_,i)=>({title:'完整文章 '+i,summary:'摘要',category:section.name,route:'/news/'+section.id+'-'+i+'/',date:'2026-10-'+String(i+1).padStart(2,'0'),markdown:'全文末尾。\n\n![配图](./image.png)'})));
  for(const feed of sectionRssFeeds(site,records)){
   const url=site.origin+'/'+feed.path;assert(!urls.has(url));urls.add(url);
   assert.equal((feed.xml.match(/<item>/g)||[]).length,20);assert.equal((feed.xml.match(/全文末尾。/g)||[]).length,20);
   assert(feed.xml.includes('href="'+url+'" rel="self"'));assert(feed.xml.includes('<guid isPermaLink="true">'+site.origin+'/news/'));
   assert(!feed.xml.includes('<title>完整文章 0</title>'));assert(feed.xml.includes('<title>完整文章 26</title>'));
   assert(feed.xml.includes('src="'+site.origin+'/news/'));assert(!feed.xml.includes('<guid isPermaLink="true">'+url));
  }
 }
 assert.equal(urls.size,28);
});
test('academic and journal releases hash column feeds and keep cache timestamps on an unchanged rebuild',async t=>{
 const root=await mkdtemp(join(tmpdir(),'column-rss-release-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const site of profiles.filter(s=>['scholay-today','enter'].includes(s.id))){
  const section=sectionsForSite(site)[0],snapshot={
   news:[{id:'column-note',sectionId:section.id,title:'分栏正文',summary:'完整摘要',category:site.columns[0],date:'2026-10-20',markdown:'正文保留全部内容。\n\n![图](https://example.org/image.png)'}],
   data:{year:[{id:'event',title:'学术会议',category:site.yearCategories[0],start:'2026-12-30',summary:'日程',body:'日程正文',sourceName:'主办方',sourceUrl:'https://example.org/event',provenance:'已核验官网'}],history:[{id:'history',title:'历史记录',dateKey:'02-29',year:2000,domain:'计算史',factSummary:'事实',sources:[{label:'论文',url:'https://example.org/paper'}]}]},
   openSource:{items:[{title:'工具',date:'2026-09-30',category:site.sourceCategories[0],summary:'简介',value:'价值',url:'https://example.org/project',status:'公开收录'}]},
   permalinks:{'news:column-note':'/news/unchanged-original/','year:event':'/calendar/event/','history:history':'/history/record/','openSource:https://example.org/project':'/open-source/project/'}
  };
  const initial=JSON.stringify(snapshot),first=join(root,site.id+'-first'),second=join(root,site.id+'-second');
  let manifest=await buildSiteRelease({site,target:first,source:process.cwd(),now:new Date('2026-10-20T00:00:00Z'),job:{id:'column-first-'+site.id,snapshot,snapshot_hash:'fixture'}});
  const path='feeds/'+section.id+'.xml',feed=await readFile(join(first,path),'utf8'),timestamp=(await stat(join(first,path))).mtimeMs;
  assert(feed.includes(site.origin+'/news/unchanged-original/'));assert(feed.includes('正文保留全部内容。'));assert.equal(manifest.hashes[path],createHash('sha256').update(feed).digest('hex'));
  manifest=await buildSiteRelease({site,target:second,previousRoot:first,source:process.cwd(),now:new Date('2026-10-21T00:00:00Z'),job:{id:'column-second-'+site.id,snapshot,snapshot_hash:'fixture'}});
  assert.equal(await readFile(join(second,path),'utf8'),feed);assert.equal((await stat(join(second,path))).mtimeMs,timestamp);assert.equal(JSON.stringify(snapshot),initial);
 }
});
