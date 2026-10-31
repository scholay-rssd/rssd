import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,cp,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {byteHash,copyThemeHomepage,homepagePath} from '../web/engine/theme-homepage.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {themeForSite} from '../web/themes/registry.mjs';import {profiles} from '../scripts/site-config.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'today-theme-'));t.after(()=>rm(root,{recursive:true,force:true}));const site=profiles.find(s=>s.id==='personal'),theme=themeForSite(site),dir=join(root,'theme-homepages/personal');await mkdir(join(dir,'public'),{recursive:true});const html='<html><h1>Original personal design</h1></html>',files={'index.html':byteHash(html)};await writeFile(join(dir,'public/index.html'),html);for(const slug of ['rimes','scholay-today','scholay','skills','scholay-wiki']){const path='projects/'+slug+'/index.html';await mkdir(join(dir,'public/projects',slug),{recursive:true});await writeFile(join(dir,'public',path),html);files[path]=byteHash(html);}const manifest={version:1,themeId:theme.id,siteId:site.id,origin:site.origin,files};await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));return {source:root,target:join(root,'output'),site,theme,dir,manifest,html};}
test('a complete release preserves custom homepage bytes and publishes the shared model and modules',async t=>{const f=await fixture(t);await cp('sites',join(f.source,'sites'),{recursive:true});await mkdir(join(f.source,'web/themes'),{recursive:true});await cp('web/themes/content.css',join(f.source,'web/themes/content.css'));const snapshot={news:[{id:'note',title:'Human note',category:f.site.columns[1],markdown:'# Human note\n\nOriginal body',date:'2026-10-13'}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:note':'/news/note/'}};const before=JSON.stringify(snapshot);const manifest=await buildSiteRelease({...f,job:{id:'test',snapshot,snapshot_hash:'hash'}});assert.equal(await readFile(join(f.target,'index.html'),'utf8'),f.html);assert.equal(manifest.theme.id,'personal');assert.equal(manifest.byteHashes['index.html'],byteHash(f.html));assert.match(await readFile(join(f.target,'archive/index.html'),'utf8'),/Human note/);assert.equal(JSON.parse(await readFile(join(f.target,'published-content.json'))).siteId,f.site.id);assert.match(await readFile(join(f.target,'sitemap.xml'),'utf8'),/sitemap-content/);assert.equal(JSON.stringify(snapshot),before);});
test('cross-site, changed and missing homepage artifacts fail closed',async t=>{const f=await fixture(t);await assert.rejects(copyThemeHomepage({...f,site:{...f.site,id:'piggytuck'}}),/identity/);await writeFile(join(f.dir,'public/index.html'),'unexpected');await assert.rejects(copyThemeHomepage(f),/checksum/);await rm(join(f.dir,'manifest.json'));await assert.rejects(copyThemeHomepage(f),/ENOENT/);});

test('English articles use the shared directory while all authored localized home bytes remain intact',async t=>{
 const f=await fixture(t);f.site={...f.site,languages:['zh-CN','en']};await cp('sites',join(f.source,'sites'),{recursive:true});await mkdir(join(f.source,'web/themes'),{recursive:true});await cp('web/themes/content.css',join(f.source,'web/themes/content.css'));
 const home='<html lang="en"><h1>Authored English homepage</h1><script src="/_next/hydrate.js"></script></html>';
 await mkdir(join(f.dir,'public/en'));await writeFile(join(f.dir,'public/en/index.html'),home);f.manifest.files['en/index.html']=byteHash(home);await writeFile(join(f.dir,'manifest.json'),JSON.stringify(f.manifest));
 const snapshot={news:[{id:'english-original',locale:'en',title:'English original',summary:'English summary.',markdown:'# English original\n\nIndependent English text.',date:'2026-11-01',category:f.site.columns[0]}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:english-original':'/en/news/english-original/'}};
 const manifest=await buildSiteRelease({...f,job:{id:'english-home',snapshot,snapshot_hash:'fixture'}});
 assert.equal(await readFile(join(f.target,'index.html'),'utf8'),f.html);assert.equal(await readFile(join(f.target,'en/index.html'),'utf8'),home);
 assert.equal(manifest.byteHashes['en/index.html'],byteHash(home));
 const directory=await readFile(join(f.target,'en/journal/index.html'),'utf8');assert.match(directory,/English original/);assert.doesNotMatch(directory,/_next\/hydrate/);
 const article=await readFile(join(f.target,'en/news/english-original/index.html'),'utf8');assert.match(article,/href="\/en\/journal\/">← All articles/);assert.doesNotMatch(article,/_next\/hydrate/);
});
test('a homepage cannot replace content routes, escape its folder or follow a symlink',async t=>{for(const path of ['../secret','/index.html','foo/../../x','manage/index.html','calendar/index.html','release.json','.env','foo\\x'])assert.throws(()=>homepagePath(path));const f=await fixture(t);await rm(join(f.dir,'public/index.html'));await symlink('/etc/hosts',join(f.dir,'public/index.html'));await assert.rejects(copyThemeHomepage(f),/symlink/);});

// The production current path is a symlink; staging must not write through it.
test('migration bridge leaves the prior release immutable',async t=>{
 const {prepareThemeBridge}=await import('../scripts/prepare-theme-bridge.mjs');const f=await fixture(t);
 const old=join(f.source,'old'),current=join(f.source,'current');await mkdir(old);await writeFile(join(old,'index.html'),'legacy home');await writeFile(join(old,'site-content.json'),'published data');await symlink(old,current);
 await prepareThemeBridge({id:f.site.id,previous:current,target:f.target,source:f.source});
 assert.equal((await lstat(f.target)).isSymbolicLink(),false);
 assert.equal(await readFile(join(old,'index.html'),'utf8'),'legacy home');
 assert.equal(await readFile(join(f.target,'index.html'),'utf8'),f.html);
 assert.equal(await readFile(join(f.target,'site-content.json'),'utf8'),'published data');
 await assert.rejects(prepareThemeBridge({id:f.site.id,previous:current,target:f.target,source:f.source}),/already exists/);
});
