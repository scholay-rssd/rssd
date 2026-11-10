import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {DEFAULT_SITE} from '../scripts/site-config.mjs';
import {navigationForSite} from '../web/engine/site-navigation.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';

test('academic news and the two calendars share atomic articles, frozen URLs and independent categories',async t=>{
 const target=await mkdtemp(join(tmpdir(),'academic-navigation-'));t.after(()=>rm(target,{recursive:true,force:true}));
 const year={id:'deadline',title:'科研项目申报',start:'2026-10-18',end:'2026-10-20',category:'学术会议',summary:'已核验的申报日期',body:'完整原文',sourceUrl:'https://example.org/event',sourceName:'主办方',provenance:'已核验官网'};
 const history={id:'discovery',sectionId:'observations',title:'研究方法的诞生',dateKey:'02-29',year:2000,domain:'计算史',factSummary:'历史事实',historicalSignificance:'原始学术意义',sources:[{label:'原文',url:'https://example.org/history'}]};
 const snapshot={data:{year:[year,{...year,id:'unchecked',provenance:'待核验'}],history:[history]},openSource:{items:[{title:'研究工具',date:'2026-10-18',category:'文献与写作',summary:'工具简介',value:'工具用途',url:'https://example.org/tool'}]},news:[{id:'observation',sectionId:'observations',title:'研究观察',date:'2026-10-18',category:'学者观察',summary:'研究摘要',markdown:'# 研究观察\n\n独立正文',author:'编辑部'},{id:'calendar-note',sectionId:'calendar',title:'没有具体日期的日程解读',date:'2026-10-18',category:'今日学术',summary:'日期尚未公布',markdown:'# 解读\n\n不虚构日程日期',author:'编辑部'}],permalinks:{'year:deadline':'/calendar/frozen-deadline/','history:discovery':'/history/frozen-discovery/','news:observation':'/news/frozen-observation/'}};
 const before=JSON.stringify(snapshot);
 await buildSiteRelease({source:process.cwd(),target,site:DEFAULT_SITE,job:{id:'navigation-test',snapshot,snapshot_hash:'test'}});
 assert.equal(JSON.stringify(snapshot),before);
 assert.deepEqual(navigationForSite(DEFAULT_SITE).map(n=>n.label),['首页','今日学术','昔日学术','学术新闻','留言板']);
 assert.equal(sectionsForSite(DEFAULT_SITE).find(s=>s.id==='calendar').name,'今日学术');
 assert.equal(sectionsForSite(DEFAULT_SITE).find(s=>s.id==='history').name,'昔日学术');
 const json=async path=>JSON.parse(await readFile(join(target,path),'utf8'));
 const content=await json('published-content.json'),index=await json('archive-index.json'),manifest=await json('calendar-index.json');
 assert.equal(content.records.find(r=>r.id==='history:discovery').collectionId,'history');
 assert.equal(content.records.find(r=>r.id==='year:deadline').collectionId,'calendar');
 assert(!content.records.some(r=>r.id==='year:unchecked'));
 const years=await json(manifest.year.slice(1)),histories=await json(manifest.history.slice(1));
 assert.deepEqual(years.map(r=>r.id),['deadline','unchecked']);
 assert.deepEqual(histories.map(r=>r.id),['discovery']);
 assert.equal(years[0].articleUrl,'/calendar/frozen-deadline/');assert.equal(years[1].articleUrl,undefined);
 assert.equal(histories[0].articleUrl,'/history/frozen-discovery/');
 assert.equal((await json(years[0].detailUrl.slice(1))).body,year.body);
 assert.equal(index.records.find(r=>r.route==='/history/frozen-discovery/').section,'history');
 assert.equal(index.records.find(r=>r.route==='/news/frozen-observation/').section,'observations');
 assert.equal(index.records.length,5);assert.equal(new Set(index.records.map(r=>r.route)).size,5);
 assert(index.sections.find(s=>s.slug==='intelligence').members.includes('calendar'));
 assert(!index.sections.find(s=>s.slug==='observations').members.includes('history'));
 for(const path of ['index.html','archive/index.html','archive/calendar/index.html','archive/history/index.html','calendar/frozen-deadline/index.html','history/frozen-discovery/index.html','news/frozen-observation/index.html']){
  const html=await readFile(join(target,path),'utf8'),nav=html.match(/<!-- site-navigation:start -->([\s\S]*?)<!-- site-navigation:end -->/)[1];
  assert.deepEqual([...nav.matchAll(/<a[^>]*>(.*?)<\/a>/g)].map(m=>m[1]),['首页','今日学术','昔日学术','学术新闻','留言板'],path);
 }
 const observations=await readFile(join(target,'archive/observations/index.html'),'utf8');assert(!observations.includes('frozen-discovery'));
 assert.match(await readFile(join(target,'archive/calendar/index.html'),'utf8'),/在今日学术日历中浏览/);
 assert.match(await readFile(join(target,'archive/history/index.html'),'utf8'),/在昔日学术日历中浏览/);
 assert.match(await readFile(join(target,'calendar/frozen-deadline/index.html'),'utf8'),/\/#\/year\?date=2026-10-18/);
 assert.match(await readFile(join(target,'history/frozen-discovery/index.html'),'utf8'),/\/#\/history\?date=02-29/);
});
