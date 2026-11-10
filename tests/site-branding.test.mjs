import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profiles} from '../scripts/site-config.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {siteBranding} from '../sites/branding/assets.mjs';
import manifest from '../sites/branding/manifest.json' with {type:'json'};

test('approved nine-site branding reaches headers and multi-size favicons without changing academic branding',async t=>{
 const root=await mkdtemp(join(tmpdir(),'site-branding-'));t.after(()=>rm(root,{recursive:true,force:true}));
 assert.equal(manifest['scholay-today'].file,'academic.png');assert.equal(manifest['scholay-today'].version,undefined);
 for(const profile of profiles.filter(s=>!s.legacy)){
  const site={...profile,themeId:'journal'},brand=siteBranding(site.id);assert(brand?.logo.includes('?v=bw-v8-20261017'));
  for(const file of Object.values(brand.files))assert((await readFile(join('sites/branding',file))).length>0);
  // Custom homepages are validated with their separately built static artifacts.
  if(['personal','piggytuck'].includes(site.id))continue;
  const target=join(root,site.id),snapshot={news:[],data:{year:[],history:[]},openSource:{items:[]},permalinks:{}};
  await buildSiteRelease({site,source:process.cwd(),target,job:{id:'branding-'+site.id,snapshot,snapshot_hash:'empty-branding-fixture'}});
  const html=await readFile(join(target,'index.html'),'utf8');assert(html.includes('src="'+brand.logo+'"'));assert(html.includes(brand.links));
  for(const [path,file] of Object.entries(brand.files))assert.deepEqual(await readFile(join(target,path)),await readFile(join('sites/branding',file)));
  const ico=await readFile(join(target,'favicon.ico'));assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),3);assert.deepEqual([ico[6],ico[22],ico[38]],[16,32,48]);
  assert((await readFile(join(target,'site-logo.webp'))).length<20000);
 }
});
