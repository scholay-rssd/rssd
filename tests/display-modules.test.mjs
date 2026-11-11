import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profiles,validateSite} from '../scripts/site-config.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {adaptPublishedSnapshot} from '../web/engine/published-content.mjs';
import {validatePublicMedia} from '../contracts/published-content.mjs';
import {resolveDisplay,createDisplayHost,renderDisplayModules} from '../web/modules/registry.mjs';
import {eventMatches} from '../web/modules/calendar/model.mjs';
import {homepageFiles,byteHash,homepagePath} from '../web/engine/theme-homepage.mjs';
import {portfolioMedia} from '../web/engine/portfolio-media.mjs';
const lingxi=profiles.find(s=>s.id==='lingxi');
const snapshot={news:[{id:'human-note',title:'已有稿件',category:lingxi.columns[1],markdown:'# 已有稿件\n\n手写正文\n\n![保留原图注](https://example.org/image.png)',date:'2026-10-13'}],data:{year:[{id:'event',title:'跨年活动',start:'2026-12-30',end:'2027-01-02',summary:'旧摘要'}],history:[]},openSource:{items:[]},permalinks:{'news:human-note':'/news/frozen-link/','year:event':'/calendar/frozen-event/'}};
const display=(calendar,gallery=false,extra={})=>({version:1,modules:{calendar:{enabled:calendar},gallery:{enabled:gallery,...extra}}});
async function workspace(t){const root=await mkdtemp(join(tmpdir(),'today-modules-'));t.after(()=>rm(root,{recursive:true,force:true}));await cp('sites',join(root,'sites'),{recursive:true});await mkdir(join(root,'web/themes'),{recursive:true});await cp('web/themes/content.css',join(root,'web/themes/content.css'));return root;}
async function homepage(source,site,{real=false}={}){
 const dir=join(source,'theme-homepages',site.themeId),out=join(dir,'public');await mkdir(out,{recursive:true});
 if(real)await cp('web/themes/portfolio/homepage',out,{recursive:true});
 else {await writeFile(join(out,'index.html'),'<h1>Original authored homepage</h1>');await writeFile(join(out,'sitemap.xml'),'<urlset><url><loc>'+site.origin+'/projects/</loc></url></urlset>');}
 if(site.id==='personal')for(const slug of ['rimes','scholay-today','scholay','skills','scholay-wiki']){await mkdir(join(out,'projects',slug),{recursive:true});await writeFile(join(out,'projects',slug,'index.html'),'<h1>Original project</h1>');}
 const files={};for(const file of await homepageFiles(out))files[file]=byteHash(await readFile(join(out,file)));
 await writeFile(join(dir,'manifest.json'),JSON.stringify({version:1,siteId:site.id,origin:site.origin,themeId:site.themeId,files}));return {out,files};
}
test('site settings are explicit, independent from Theme, and reject unsupported options',()=>{
 assert.equal(resolveDisplay(profiles.find(s=>s.id==='personal')).modules.calendar.enabled,false);
 assert.equal(resolveDisplay({...lingxi,themeId:'portfolio'}).modules.gallery.enabled,false);
 // Without display settings every site gets the same default, whatever its name.
 for(const id of ['personal','piggytuck','pets']){const {display:_,...bare}=profiles.find(s=>s.id===id);assert.deepEqual(Object.entries(resolveDisplay(bare).modules).filter(([,m])=>m.enabled).map(([name])=>name),['calendar']);}
 assert.deepEqual(validateSite({...lingxi,display:display(false,true,{columns:3})}).display,display(false,true,{columns:3}));
 for(const bad of [{version:2,modules:{}},{version:1,modules:{login:{enabled:true}}},display(true,true,{columns:10}),{version:1,modules:{calendar:{enabled:true,script:'https://evil.test/plugin.js'}}}])assert.throws(()=>validateSite({...lingxi,display:bad}));
});
test('calendar disable preserves article bodies, frozen URLs, exports and old calendar entry; assets load only on their view',async t=>{
 const source=await workspace(t),before=JSON.stringify(snapshot),job={id:'local-test',snapshot,snapshot_hash:'fixture'},outputs={};
 for(const enabled of [true,false]){
  const target=join(source,String(enabled));outputs[enabled]=target;
  const result=await buildSiteRelease({source,target,job,site:{...lingxi,display:display(enabled,true)},now:new Date('2026-10-14T00:00:00Z')});
  assert.equal(result.display.modules.calendar.enabled,enabled);
  for(const route of Object.values(snapshot.permalinks))await access(join(target,route,'index.html'));
  const page=await readFile(join(target,'calendar/index.html'),'utf8');
  if(enabled){assert.match(page,/site-calendar.js/);assert.match(page,/display\/calendar\/style.css/);const data=JSON.parse(await readFile(join(target,'display/calendar/content.json')));assert.equal(data.records[0].event.end,'2027-01-02');}
  else {assert.doesNotMatch(page,/site-calendar.js|year-grid/);assert.match(page,/frozen-event/);await assert.rejects(access(join(target,'site-calendar.js')));}
  const journal=await readFile(join(target,'journal/index.html'),'utf8');assert.doesNotMatch(journal,/site-calendar.js|display\/gallery\/(style|client)/);
  const gallery=await readFile(join(target,'gallery/index.html'),'utf8');assert.match(gallery,/保留原图注/);assert.match(gallery,/news\/frozen-link/);assert.doesNotMatch(gallery,/site-calendar.js/);
  assert.match(await readFile(join(target,'sitemap-content.xml'),'utf8'),/gallery\//);
 }
 for(const file of ['published-content.json','site-content.json','content-feed.xml'])assert.equal(await readFile(join(outputs.true,file),'utf8'),await readFile(join(outputs.false,file),'utf8'));
 const body=html=>html.match(/<div class="article-body">([\s\S]*?)<\/div><\/div>/)[1];
 assert.equal(body(await readFile(join(outputs.true,'news/frozen-link/index.html'),'utf8')),body(await readFile(join(outputs.false,'news/frozen-link/index.html'),'utf8')));
 assert.equal(JSON.stringify(snapshot),before);
});
test('event projection handles ranges, leap days, historical dates and publication-only notices',()=>{
 const range={mode:'scheduled',start:'2026-12-30',end:'2027-01-02'};
 for(const d of ['2026-12-30','2027-01-01','2027-01-02'])assert(eventMatches(range,d,'year'));
 assert(!eventMatches(range,'2027-01-03','year'));
 assert(!eventMatches({...range,dateBasis:'发布日期（事件日期未核实）'},'2027-01-01','year'));
 const annual={mode:'annual',recurrence:{frequency:'yearly',monthDay:'02-29',leapDay:'feb28'}};
 assert(eventMatches(annual,'2027-02-28','year'));assert(eventMatches(annual,'2028-02-29','year'));assert(!eventMatches(annual,'2028-02-28','year'));
 assert(!eventMatches({...annual,recurrence:{...annual.recurrence,leapDay:'skip'}},'2027-02-28','year'));
 assert(eventMatches({mode:'historical',year:2000,monthDay:'10-14'},'2026-10-14','history'));
 assert(!eventMatches(range,'2026-12-30','history'));
});
test('read-only host scopes collections, rejects cross-site and collisions, and never exposes raw blobs',async()=>{
 const content=adaptPublishedSnapshot(snapshot,lingxi),host=createDisplayHost(content);
 assert.equal(host.records({collections:['column-2']}).length,1);
 assert.throws(()=>host.records()[0].title='changed',TypeError);assert.equal(host.media()[0].alt,'保留原图注');
 assert(!JSON.stringify(host.records()).includes('base64'));
 await assert.rejects(renderDisplayModules({site:{...lingxi,id:'pets'},content}),/another site/);
 await assert.rejects(renderDisplayModules({site:{...lingxi,display:display(true,true,{collections:['nonexistent']})},content}),/Unknown module collection/);
 await assert.rejects(renderDisplayModules({site:lingxi,content:{...content,records:[{...content.records[0],route:'/gallery/'}]}}),/conflicts/);
 for(const src of ['javascript:alert(1)','//example.org/x','/../private','file:///tmp/x'])assert.throws(()=>validatePublicMedia([{id:'x',src,alt:'x'}]));
 for(const path of ['gallery/index.html','display/gallery/client.js'])assert.throws(()=>homepagePath(path));
});
test('design gallery reuses all 200 real images and preserves every authored homepage byte',async t=>{
 const source=await workspace(t),site=profiles.find(s=>s.id==='piggytuck'),home=await homepage(source,site,{real:true}),target=join(source,'output');
 const job={id:'design-test',snapshot:{news:[],data:{year:[],history:[]},openSource:{items:[]},permalinks:{}},snapshot_hash:'fixture'};
 const manifest=await buildSiteRelease({source,target,site,job});
 const document=JSON.parse(await readFile(join(target,'published-content.json')));
 assert.equal(document.media.length,200);assert.equal(new Set(document.media.map(x=>x.collectionId)).size,16);
 for(const [file,hash] of Object.entries(home.files)){assert.equal(byteHash(await readFile(join(target,file))),hash,file);assert.equal(manifest.byteHashes[file],hash,file);}
 assert.equal((await readFile(join(target,'gallery/index.html'),'utf8')).match(/class="gallery-item"/g).length,200);
 for(const image of document.media)await access(join(target,image.src));
 const disabled=join(source,'disabled');await buildSiteRelease({source,target:disabled,site:{...site,display:display(false,false)},job});
 assert.equal(await readFile(join(disabled,'index.html'),'utf8'),await readFile(join(home.out,'index.html'),'utf8'));
 assert.equal(await readFile(join(disabled,'published-content.json'),'utf8'),await readFile(join(target,'published-content.json'),'utf8'));
 await assert.rejects(access(join(disabled,'display/gallery/client.js')));
 // The catalog cannot silently advertise an unpackaged image.
 await assert.rejects(portfolioMedia(target,{hashes:{'catalog.js':'present'}}),/missing/);
});
test('personal authored home survives and its routes join the stable sitemap while calendar is optional',async t=>{
 const source=await workspace(t),site=profiles.find(s=>s.id==='personal'),home=await homepage(source,site),target=join(source,'out');
 await buildSiteRelease({source,target,site,job:{id:'personal',snapshot,snapshot_hash:'fixture'}});
 assert((await readFile(join(target,'sitemap-content.xml'),'utf8')).includes('<loc>'+site.origin+'/</loc>'));
 assert.match(await readFile(join(target,'sitemap-content.xml'),'utf8'),/<lastmod>/);
 assert.equal(await readFile(join(target,'index.html'),'utf8'),await readFile(join(home.out,'index.html'),'utf8'));
 assert.doesNotMatch(await readFile(join(target,'journal/index.html'),'utf8'),/href="\/calendar\/"/);
});
test('academic disabled calendar preserves the original homepage, hash route reader and canonical article URLs',async t=>{
 const source=process.cwd(),root=await workspace(t),site={...profiles[0],display:display(false,false)},target=join(root,'academic');
 const input={news:[],data:{year:[{...snapshot.data.year[0],category:'学术会议',tags:[],dateBasis:'官网日期',body:'正文',sourceName:'主办方',sourceUrl:'https://example.org',provenance:'已核验官网'}],history:[{id:'past',title:'历史',dateKey:'10-14',year:2000,domain:'计算史',eventType:'论文发表',importance:'A',factSummary:'事实',historicalSignificance:'意义',sources:[{label:'来源',url:'https://example.org/past'}]}]},openSource:{items:[{title:'工具',date:'2026-10-14',category:'文献与写作',summary:'简介',value:'用途',url:'https://example.org/tool',status:'公开收录'}]},permalinks:snapshot.permalinks};
 const result=await buildSiteRelease({source,target,site,job:{id:'academic-off',snapshot:input,snapshot_hash:'fixture'}});
 assert.equal(result.display.modules.calendar.enabled,false);
 const html=await readFile(join(target,'index.html'),'utf8');assert.match(html,/data-calendar-enabled="false"/);
 const enabled=join(root,'academic-on');await buildSiteRelease({source,target:enabled,previousRoot:target,site:{...site,display:display(true,false)},job:{id:'academic-on',snapshot:input,snapshot_hash:'fixture'}});
 assert.equal(html.replace(' data-calendar-enabled="false"',''),await readFile(join(enabled,'index.html'),'utf8'));
 await access(join(target,'calendar/frozen-event/index.html'));await access(join(target,'calendar/index.html'));
});
