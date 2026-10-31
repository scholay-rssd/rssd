import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import {profiles} from '../scripts/site-config.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {BLOG_SITES,blogPreset} from '../web/themes/journal/blog-presets.mjs';

test('nine presets cover the sites; engine homepages keep published bodies, routes and a small CSS budget',async t=>{
  assert.equal(BLOG_SITES['scholay-today'],undefined);
  assert.equal(Object.keys(BLOG_SITES).length,9);
  const root=await mkdtemp(join(tmpdir(),'blog-themes-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const profile of profiles.filter(s=>!s.legacy&&!['personal','piggytuck'].includes(s.id))){
    // Authored homepages have separate byte-hash coverage. Exercise each blog
    // skin here without depending on a Next build or portfolio assets.
    const site={...profile,themeId:'journal'},preset=blogPreset(site);
    const snapshot={news:[{id:'published-note',title:'A published note',category:site.columns[1],date:'2026-10-16',markdown:'# A published note\n\nKeep this exact published body.'}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:published-note':'/news/stable-note/'}};
    const before=JSON.stringify(snapshot),target=join(root,site.id);
    await buildSiteRelease({site,source:process.cwd(),target,job:{id:'blog-'+site.id,snapshot,snapshot_hash:'published-fixture'}});
    assert.equal(JSON.stringify(snapshot),before);
    const html=await readFile(join(target,'index.html'),'utf8');
    assert.match(html,new RegExp(`data-blog="${preset.id}"`));
    assert.match(html,/href="\/news\/stable-note\/"/);
    assert.match(html,/class="home-directory"/);
    // Language preference is the only optional script on these static homes.
    assert.doesNotMatch(html.replace(/<script defer src="\/site-language\.js"><\/script>/g,''),/<script[^>]+src=/);
    assert.doesNotMatch(html,/fonts\.googleapis|unpkg|jsdelivr/);
    const css=await readFile(join(target,'site-theme.css'));
    // Raised from 9 KB when shared structures (structures.css) and per-site skins landed: ~9.4 KB gzip, one cached request.
    assert.ok(gzipSync(css).length<12000,`${site.id} CSS must stay under 12 KB gzip`);
    assert.doesNotMatch(css.toString(),/@import|@font-face|https?:/);
    const content=JSON.parse(await readFile(join(target,'published-content.json')));
    assert.equal(content.records[0].bodyMarkdown,snapshot.news[0].markdown);
    assert.equal(content.records[0].route,'/news/stable-note/');
    assert.match(await readFile(join(target,'theme-license.txt'),'utf8'),/Permission is hereby granted/);
  }
});
