import test from 'node:test';
import assert from 'node:assert/strict';
import {SITE_SECTIONS,sectionsForSite,sectionWritingMode,validateSectionId} from '../contracts/site-sections.mjs';
import {assertHeadlessTarget} from '../desktop/scripts/agent/headless/target.mjs';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';

test('all sites declare writing defaults on stable sections without a four-section limit',()=>{
 const modes=new Set(['xiwen','observation','calendar','history','opensource','essay','documentation','design','encyclopedia']);
 for(const [id,sections] of Object.entries(SITE_SECTIONS)){
  assert.equal(new Set(sections.map(s=>s.id)).size,sections.length);
  for(const section of sections){assert.ok(modes.has(section.defaultMode));assert.equal(sectionWritingMode(id,section.id),section.defaultMode);}
 }
 assert.equal(sectionsForSite({id:'scholay-today'}).length,8);
 assert.equal(sectionWritingMode('scholay-today','history'),'history');
 assert.equal(sectionWritingMode('scholay-today','resources'),'opensource');
 assert.throws(()=>sectionWritingMode('pets','history'),/同步栏目配置/);
});

test('new sections and reordered defaults cannot retarget a headless task already in progress',()=>{
 const siteId='scholay-today',original=SITE_SECTIONS[siteId];
 const task={siteId,mode:'opensource',notebook:{sectionId:'resources',kind:'openSource',mounts:{skills:[{id:'original',content:'saved version'}]}}};
 const before=JSON.stringify(task),target={siteId,sectionId:'resources',mode:'opensource'};
 try{
  SITE_SECTIONS[siteId]=[{id:'new-section',name:'新增栏目',defaultMode:'essay'},...[...original].reverse().map(s=>({...s,defaultMode:'observation'}))];
  assert.equal(validateSectionId('resources',{id:siteId}),'resources');
  assert.equal(assertHeadlessTarget(task,target),task);
  assert.equal(JSON.stringify(task),before);
 }finally{SITE_SECTIONS[siteId]=original;}
});

test('resume and publication stop on changed site, section, mode or record kind without mutating saved work',()=>{
 const target={siteId:'scholay-today',sectionId:'history',mode:'history'};
 const task={siteId:target.siteId,mode:'history',notebook:{sectionId:'history',kind:'history',title:'原稿'}};
 for(const other of [{...target,siteId:'pets'},{...target,sectionId:'calendar'},{...target,mode:'calendar'}])assert.throws(()=>assertHeadlessTarget(task,other),/does not match/);
 assert.throws(()=>assertHeadlessTarget({...task,notebook:{...task.notebook,kind:'year'}},target),/record kind/);
 assert.throws(()=>assertHeadlessTarget({...task,notebook:{...task.notebook,sectionId:undefined}},target),/section/);
 assert.throws(()=>assertHeadlessTarget({...task,notebook:undefined},target),/section/);
 assert.doesNotThrow(()=>assertHeadlessTarget({...task,notebook:undefined},target,{allowMissingNotebook:true}));
 assert.equal(task.notebook.title,'原稿');
});

test('library snapshots keep the record type separate from the renamed category and chosen writing skill',async t=>{
 const root=await mkdtemp(join(tmpdir(),'section-routing-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'_ops/inventory'),{recursive:true});await mkdir(join(root,'articles'),{recursive:true});
 const id='record-11111111-1111-4111-8111-111111111111',canonicalPath='articles/history.md';
 const index={articles:{[id]:{shortTitle:'历史稿',canonicalPath,archiveCategory:'昔日学术',sectionId:'observations',type:'essay'}},annexColumns:['昔日学术']};
 const before=JSON.stringify(index),file=join(root,'_ops/inventory/article-index.json');
 await writeFile(file,before);await writeFile(join(root,canonicalPath),'# 历史稿\n\n## 事实摘要\n\n历史事实。\n\n## 学术意义\n\n历史意义。\n');
 const client=createWebsitePublisher({root,fetcher:()=>{throw Error('must not contact cloud');}});
 const row=(await client.snapshot()).articles[0];
 assert.equal(row.recordKind,'history');assert.equal(row.archiveCategory,'学者观察');assert.equal(row.type,'essay');
 assert.equal(await readFile(file,'utf8'),before);
});
