import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles} from '../scripts/site-config.mjs';
import {loadOrganization,organizeContent,validateOrganization} from '../web/engine/site-organization.mjs';
import {adaptPublishedSnapshot} from '../web/engine/published-content.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {buildThemeHome} from '../scripts/build-theme-home.mjs';
import {archiveSections} from '../scripts/archive-model.mjs';
const empty={news:[],data:{year:[],history:[]},openSource:{items:[]},permalinks:{}};
const note=(id,category)=>({id,title:'测试文章 '+id,summary:'隔离测试摘要',markdown:'# 测试文章\n\n原正文不改写。',category,date:'2026-10-14',author:'测试'});
const job=snapshot=>({id:'organization-test',snapshot,snapshot_hash:'unchanged'});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'today-organization-'));t.after(()=>rm(root,{recursive:true,force:true}));await cp('sites',join(root,'sites'),{recursive:true});await mkdir(join(root,'web/themes'),{recursive:true});await cp('web/themes/content.css',join(root,'web/themes/content.css'));return root;}

test('ten site sections match confirmed scope without changing the five legacy publication slots',async()=>{
 for(const [i,site]of profiles.entries()){const o=await loadOrganization(process.cwd(),site.id);assert.deepEqual(o.sections.filter(s=>!s.legacy).map(s=>s.name),site.publicColumns);assert.equal(site.columns.length,5);}
 assert.equal(archiveSections.length,7);
 const pets=await loadOrganization(process.cwd(),'pets');assert.deepEqual(pets.sections.map(s=>s.name),['宠物资讯','每日一猫','每日一狗','异宠大全']);
});
test('one primary section and explicit associations preserve original prose, links, old sections and input',async()=>{
 const site=profiles.find(s=>s.id==='xsime'),s={...empty,news:[note('old','输入札记'),note('new','中文输入方案')],permalinks:{'news:old':'/news/old-permanent/'}};
 const content=adaptPublishedSnapshot(s,site),before=JSON.stringify(content),o=await loadOrganization(process.cwd(),site.id);
 o.bindings=[{recordId:'news:new',sectionId:'input-schemes',tags:['拼音'],related:[{id:'xsime',role:'tutorial'}]}];
 const result=organizeContent(content,o);assert.equal(result.records[1].collectionId,'input-schemes');assert.equal(result.records[0].route,'/news/old-permanent/');assert(result.collections.find(c=>c.id==='column-2').legacy);
 assert.equal(JSON.stringify(content),before);assert.equal(result.records[1].bodyMarkdown,s.news[1].markdown);assert.deepEqual(result.records[1].tags,['拼音']);
 assert(!result.records[0].related); // Titles never create associations.
 for(const mutate of [x=>x.siteId='pets',x=>x.hubs[0].route='/../private/',x=>x.hubs[0].links=[{label:'bad',url:'javascript:alert(1)'}],x=>x.bindings[0].related[0].id='unknown',x=>x.sections.push(x.sections[0])]){const bad=structuredClone(o);mutate(bad);assert.throws(()=>validateOrganization(bad,site.id));}
});
test('new and old article routes remain reachable; missing draft bindings never become public',async t=>{
 const source=await fixture(t),site=profiles.find(s=>s.id==='pets'),snapshot={...empty,news:[note('old','相处日记'),note('new','异宠大全')],permalinks:{'news:old':'/news/original-link/'}};
 const o=await loadOrganization(source,site.id);o.bindings=[{recordId:'news:unpublished-draft',sectionId:'exotic-pets',tags:['private-tag'],related:[]}];await writeFile(join(source,'sites/organization/pets.json'),JSON.stringify(o));
 const target=join(source,'out');await buildSiteRelease({source,target,site,job:job(snapshot)});
 for(const route of ['archive/exotic-pets','archive/column-2','news/original-link','news/new'])await access(join(target,route,'index.html'));
 const content=JSON.parse(await readFile(join(target,'published-content.json')));assert.equal(content.records.length,2);assert(!JSON.stringify(content).includes('private-tag'));
 assert.match(await readFile(join(target,'archive/index.html'),'utf8'),/旧栏目与既有文章/);
 assert.match(await readFile(join(target,'content-feed.xml'),'utf8'),/original-link/);
 const collision={...snapshot,permalinks:{'news:old':'/archive/exotic-pets/'}};await assert.rejects(buildSiteRelease({source,target:join(source,'bad'),site,job:job(collision)}),/collides/);
});
test('all real portfolio series become durable pages and explicitly linked notes keep their article URL',async t=>{
 const source=await fixture(t);await buildThemeHome('piggytuck',join(source,'theme-homepages'));
 const site=profiles.find(s=>s.id==='piggytuck'),o=await loadOrganization(source,site.id);
 o.bindings=[{recordId:'news:design-note',sectionId:'column-2',tags:['角色'],related:[{id:'penguin',role:'note'}]}];await writeFile(join(source,'sites/organization/piggytuck.json'),JSON.stringify(o));
 const snapshot={...empty,news:[note('design-note','创作手记')],permalinks:{'news:design-note':'/news/kept-design-note/'}};
 const target=join(source,'out');await buildSiteRelease({source,target,site,job:job(snapshot)});
 const html=await readFile(join(target,'works/penguin/index.html'),'utf8');assert.match(html,/kept-design-note/);assert.equal((html.match(/<figure>/g)||[]).length,15);
 assert.match(await readFile(join(target,'news/kept-design-note/index.html'),'utf8'),/works\/penguin/);
 const index=await readFile(join(target,'works/index.html'),'utf8');assert.equal((index.match(/class="standing-cover"/g)||[]).length,16);
 assert.equal(await readFile(join(target,'catalog.js'),'utf8'),await readFile('web/themes/portfolio/homepage/catalog.js','utf8'));
});
test('personal project records use stable detail URLs and separate note roles without copying unpublished material',async t=>{
 const source=await fixture(t),site=profiles.find(s=>s.id==='personal'),o=await loadOrganization(source,site.id),dir=join(source,'theme-homepages/personal'),{byteHash}=await import('../web/engine/theme-homepage.mjs');
 const files={},html='<html><body>Preserved project detail</body></html>';
 for(const file of ['index.html',...o.hubs.filter(h=>h.existingPage).map(h=>h.route.slice(1)+'index.html')]){await mkdir(join(dir,'public',file,'..'),{recursive:true});await writeFile(join(dir,'public',file),html);files[file]=byteHash(html);}
 await writeFile(join(dir,'manifest.json'),JSON.stringify({version:1,siteId:site.id,themeId:'personal',origin:site.origin,files}));
 o.bindings=[{recordId:'news:update',sectionId:'input-method-projects',tags:[],related:[{id:'rimes',role:'update'}]},{recordId:'news:tutorial',sectionId:'input-method-projects',tags:[],related:[{id:'rimes',role:'tutorial'}]},{recordId:'news:draft',sectionId:'input-method-projects',tags:[],related:[{id:'rimes',role:'reflection'}]}];
 await writeFile(join(source,'sites/organization/personal.json'),JSON.stringify(o));
 const target=join(source,'out');await buildSiteRelease({source,target,site,job:job({...empty,news:[note('update','产品手记'),note('tutorial','产品手记')]})});
 assert.equal(await readFile(join(target,'projects/rimes/index.html'),'utf8'),html);
 const notes=JSON.parse(await readFile(join(target,'organization/project-notes.json')));assert.deepEqual(notes.projects.rimes.map(x=>x.role),['update','tutorial']);
 assert.match(await readFile(join(target,'project-notes/rimes/index.html'),'utf8'),/news\/update/);
 assert.doesNotMatch(await readFile(join(target,'archive/index.html'),'utf8'),/href="\/calendar\/"/);
 await access(join(target,'projects/split-keyboard/index.html'));await access(join(target,'calendar/index.html'));
});
test('academic collaboration and course sections preserve old routes and render explicit course distinctions',async t=>{
 const source=await fixture(t);await cp('web/themes/academic/public',join(source,'web/themes/academic/public'),{recursive:true});
 const site=profiles[0],o=await loadOrganization(source,site.id);o.bindings=[{recordId:'news:course',sectionId:'courses',tags:[],related:[],course:{format:'recording',fee:'free',registration:'not-applicable'}}];await writeFile(join(source,'sites/organization/scholay-today.json'),JSON.stringify(o));
 const target=join(source,'out');await buildSiteRelease({source,target,site,job:job({...empty,data:{year:[{id:'qa-year',title:'测试日程',start:'2026-10-14',category:'学术会议',tags:[],summary:'原摘要',sourceUrl:'https://example.org/event',sourceName:'测试来源',provenance:'已核验官网',dateBasis:'测试日期'}],history:[{id:'qa-history',title:'测试历史',domain:'测试领域',eventType:'历史事件',importance:'B',preciseToDay:true,year:2000,dateKey:'10-14',factSummary:'测试事实',historicalSignificance:'测试意义',sources:[{label:'测试来源',url:'https://example.org/history'}]}]},openSource:{items:[{title:'测试资源',date:'2026-10-14',url:'https://example.org/resource',summary:'测试简介',value:'测试用途',category:'文献与写作'}]},news:[note('course','学者观察'),note('partner','项目合作'),note('old','学者观察')]})});
 const courses=await readFile(join(target,'archive/courses/index.html'),'utf8');assert.match(courses,/录播 · 免费 · 无需报名/);assert.match(courses,/news\/course/);assert.match(await readFile(join(target,'news/course/index.html'),'utf8'),/录播 · 免费 · 无需报名/);
 const archive=JSON.parse(await readFile(join(target,'archive-index.json')));assert.equal(archive.sections.filter(s=>!s.legacy).length,4);assert(archive.sections.some(s=>s.slug==='courses'&&s.legacy));assert.equal(archive.records.find(r=>r.route==='/news/partner/').section,'collaboration');await access(join(target,'archive/observations/index.html'));await access(join(target,'news/old/index.html'));
});

test('retired catalog sections retain imported article routes without reopening a production column',async()=>{
 const site=profiles.find(s=>s.id==='xsime'),organization=await loadOrganization(process.cwd(),site.id);
 const configured={...site,sectionCatalog:{version:1,revision:'migration',sections:[...organization.sections.map(s=>({id:s.id,name:s.name})),{id:'archive',name:'历史文章',enabled:false,writable:false}]}};
 const snapshot={...empty,news:[{...note('old-import','历史文章'),sectionId:'archive'}],permalinks:{'news:old-import':'/news/permanent-original/'}};
 const content=adaptPublishedSnapshot(snapshot,configured),before=JSON.stringify(content),result=organizeContent(content,organization);
 assert.equal(result.records[0].sectionId,'archive');assert.equal(result.records[0].route,'/news/permanent-original/');assert.equal(result.records[0].bodyMarkdown,snapshot.news[0].markdown);assert(result.collections.find(c=>c.id==='archive').legacy);assert.equal(JSON.stringify(content),before);
 assert.deepEqual(result.collections.filter(c=>!c.legacy).map(c=>c.id),organization.sections.filter(c=>!c.legacy).map(c=>c.id));
 for(const patch of [{enabled:true,writable:false},{enabled:false,writable:true},{enabled:undefined,writable:undefined}]){
  const invalid=structuredClone(content);Object.assign(invalid.collections.find(c=>c.id==='archive'),patch);assert.throws(()=>organizeContent(invalid,organization),/Unknown article section/);
 }
});
