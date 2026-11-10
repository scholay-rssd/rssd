import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profiles,siteDescriptor,siteForWorkspace} from '../scripts/site-config.mjs';
import {syncSectionCatalog,cachedSectionCatalog,siteWithCachedSections,sectionCatalogPath} from '../scripts/site-section-catalog.mjs';
import {sectionsForSite,writableSectionsForSite,requirePublishSection} from '../contracts/site-sections.mjs';
import {createDraft} from '../scripts/editorial-workspace.mjs';
import {localFingerprint} from '../scripts/editorial-sync.mjs';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';
import {validateNews} from '../admin/news.mjs';

const fixture=async t=>{const root=await mkdtemp(join(tmpdir(),'rssd-catalog-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;};
const response=value=>async()=>new Response(JSON.stringify(value),{status:200});
test('all ten online descriptors expose ordered stable IDs independently of the legacy five columns',()=>{
 assert.equal(profiles.length,10);
 for(const site of profiles){const d=siteDescriptor(site);assert.equal(d.sectionCatalog.sections.length,site.id==='scholay-today'?8:4);assert.equal(new Set(d.sectionCatalog.sections.map(s=>s.id)).size,d.sectionCatalog.sections.length);assert.deepEqual(d.articleCategories,d.sectionCatalog.sections.filter(s=>s.enabled!==false).map(s=>s.name));assert.deepEqual(d.sectionCatalog.sections.map(s=>s.order),d.sectionCatalog.sections.map((_,i)=>i));assert.equal(d.sectionCatalog.revision,siteDescriptor(site).sectionCatalog.revision);}
});

test('publication accepts catalog section names through 80 characters and rejects longer names',()=>{
 const data={id:'long-section-name',title:'栏目长度边界',summary:'摘要',markdown:'# 栏目长度边界\n\n正文。',author:'作者',date:'2026-10-25',sectionId:'long-section',assets:[]};
 for(const length of [41,80]){
  const name='栏'.repeat(length),site={...profiles[0],sections:[{id:data.sectionId,name}]};
  assert.equal(siteDescriptor(site).sectionCatalog.sections[0].name,name);
  const validated=validateNews({...data,category:name},null,site);
  assert.equal(validated.category,name);assert.equal(validated.sectionId,data.sectionId);
 }
 const name='栏'.repeat(81),site={...profiles[0],sections:[{id:data.sectionId,name}]};
 assert.throws(()=>siteDescriptor(site),/无效/);
 assert.throws(()=>validateNews({...data,category:name},null,site),/长度限制/);
});
test('rename and reorder preserve identity, removed IDs remain readable but cannot receive new publications',async t=>{
 const root=await fixture(t),site=profiles[1],first=siteDescriptor(site);
 await syncSectionCatalog(root,site,{fetcher:response(first)});
 const second=structuredClone(first);second.sectionCatalog.revision='changed';second.sectionCatalog.sections=second.sectionCatalog.sections.slice(0,2).reverse().map((s,i)=>({...s,name:i?'新版教程':'新版日志',order:i}));
 const next=await syncSectionCatalog(root,site,{force:true,fetcher:response(second)}),bound={...site,sectionCatalog:next};
 assert.equal(sectionsForSite(bound).find(s=>s.id==='tutorials').name,'新版教程');assert.deepEqual(writableSectionsForSite(bound).map(s=>s.id),['development','tutorials']);assert.equal(sectionsForSite(bound).find(s=>s.id==='input-skins').enabled,false);assert.throws(()=>requirePublishSection('input-skins',bound),/停用/);assert.equal(requirePublishSection('tutorials',bound),'tutorials');
});
test('offline reads use the last valid cache and never overwrite it with failures or another site',async t=>{
 const root=await fixture(t),site=profiles[6];await syncSectionCatalog(root,site,{fetcher:response(siteDescriptor(site))});const original=await readFile(sectionCatalogPath(root),'utf8');
 const offline=await syncSectionCatalog(root,site,{force:true,fetcher:async()=>{throw Error('offline');}});assert.equal(offline.status,'offline');assert.equal(offline.sections.length,4);
 const wrong=await syncSectionCatalog(root,site,{force:true,fetcher:response(siteDescriptor(profiles[7]))});assert.equal(wrong.status,'offline');assert.equal(await readFile(sectionCatalogPath(root),'utf8'),original);assert.equal(cachedSectionCatalog(root,profiles[7]),null);
});
test('malformed/duplicate catalogs are rejected; an explicitly empty directory does not restore bundled columns',async t=>{
 const root=await fixture(t),site=profiles[0],bad=siteDescriptor(site);bad.sectionCatalog.sections.push(bad.sectionCatalog.sections[0]);
 assert.equal((await syncSectionCatalog(root,site,{fetcher:response(bad)})).status,'unavailable');assert.deepEqual(sectionsForSite(siteWithCachedSections(root,site,{required:true})),[]);
 const empty=siteDescriptor(site);empty.sectionCatalog.sections=[];await syncSectionCatalog(root,site,{fetcher:response(empty)});assert.deepEqual(sectionsForSite(siteWithCachedSections(root,site)),[]);
});
test('new or renamed server sections need no desktop release and remain isolated per space',async t=>{
 const root=await fixture(t);for(const site of profiles){const dir=join(root,site.id),d=siteDescriptor(site);d.sectionCatalog.sections=[{id:'new-section',name:site.name+'新栏目',order:0,enabled:true,writable:true,defaultMode:'essay'}];await syncSectionCatalog(dir,site,{fetcher:response(d)});assert.equal(sectionsForSite(siteWithCachedSections(dir,site))[0].name,site.name+'新栏目');}
});
test('a manuscript may be saved unassigned, but preparing a cloud push fails before any cloud write',async t=>{
 const root=await fixture(t);await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({version:1,annexColumns:[],articles:{}}));
 const draft=await createDraft({id:'draft-unassigned',title:'未完成的想法',column:'未归栏',archiveCategory:'未归栏',type:'unskilled',writingSkills:[],markdown:'# 未完成的想法\n\n正文。'},root);assert.equal(draft.sectionId,undefined);assert.match(draft.canonicalPath,/未归栏/);
 let writes=0;const publisher=createWebsitePublisher({root,fetcher:async()=>{writes++;throw Error('unexpected network write');}});await assert.rejects(publisher.prepare('draft-unassigned',{metadata:{date:'2026-10-25',summary:'摘要',author:'作者',category:'未归栏'}}),/请选择发布栏目/);assert.equal(writes,0);
});

test('a section rename does not change saved manuscript fingerprints or bytes',async t=>{
 const root=await fixture(t),site=profiles[0];await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({version:1,annexColumns:[],articles:{}}));
 await syncSectionCatalog(root,site,{fetcher:response(siteDescriptor(site))});
 await createDraft({id:'rename-keeps-content',title:'原来的文章',column:'未归栏',archiveCategory:'未归栏',sectionId:'observations',markdown:'# 原来的文章\n\n正文。'},root);
 const fingerprint=await localFingerprint(root,'rename-keeps-content'),index=await readFile(join(root,'_ops/inventory/article-index.json'),'utf8');
 const renamed=siteDescriptor(site);renamed.sectionCatalog.revision='rename';renamed.sectionCatalog.sections.find(s=>s.id==='observations').name='观察新名字';
 await syncSectionCatalog(root,site,{force:true,fetcher:response(renamed)});
 assert.equal(await localFingerprint(root,'rename-keeps-content'),fingerprint);assert.equal(await readFile(join(root,'_ops/inventory/article-index.json'),'utf8'),index);
 const row=(await createWebsitePublisher({root,site:siteForWorkspace(root)}).snapshot()).articles[0];assert.equal(row.sectionId,'observations');assert.equal(row.archiveCategory,'观察新名字');
});
test('offline and newly disabled sections reject a fresh push before any cloud write',async t=>{
 const root=await fixture(t),site=profiles[0];await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({version:1,annexColumns:[],articles:{}}));await syncSectionCatalog(root,site,{fetcher:response(siteDescriptor(site))});
 await createDraft({id:'catalog-gated-draft',title:'原稿',column:'未归栏',archiveCategory:'未归栏',sectionId:'observations',markdown:'# 原稿\n\n正文。'},root);
 const disabled=siteDescriptor(site);disabled.sectionCatalog.sections.find(s=>s.id==='observations').enabled=false;
 for(const online of [false,true]){let writes=0;const client=createWebsitePublisher({root,site:siteForWorkspace(root),fetcher:async(url,options)=>{if(options?.method&&options.method!=='GET')writes++;if(!online)throw Error('offline');return new Response(JSON.stringify(disabled));}});await assert.rejects(client.prepare('catalog-gated-draft'),online?/停用/:/联网/);assert.equal(writes,0);}
});
