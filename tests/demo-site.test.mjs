import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildDemo} from '../scripts/build-demo.mjs';
import {DEMO_STRUCTURES} from '../web/demo/catalogue.mjs';
import {DEMO_VARIANTS} from '../web/demo/variants.mjs';
import {DISPLAY_MODULES} from '../web/modules/registry.mjs';
import {THEMES} from '../web/themes/registry.mjs';
import {profiles} from '../scripts/site-config.mjs';

test('Demo variants cover every registered Theme and never collide with real sites',()=>{
  assert.deepEqual([...new Set(DEMO_VARIANTS.map(v=>v.themeId))].sort(),Object.keys(THEMES).sort());
  for(const v of DEMO_VARIANTS)assert(!profiles.some(p=>p.id===v.id),v.id);
  for(const id of Object.keys(DISPLAY_MODULES))assert(DEMO_STRUCTURES.some(s=>s.group==='展示模块'&&s.id===id),id);
});

test('Demo builds through the shared renderer and every catalogue entry renders',async t=>{
  const output=await mkdtemp(join(tmpdir(),'rssd-demo-'));t.after(()=>rm(output,{recursive:true,force:true}));
  const [journal,portfolio]=await buildDemo({output,only:['demo-archie','demo-portfolio']});
  for(const build of [journal,portfolio]){
    for(const s of DEMO_STRUCTURES){
      const route=s.route||build.routes[s.record];
      assert(route&&build.pages.has(route),`${build.variant.id} is missing ${s.id} at ${route}`);
    }
  }
  const page=route=>readFile(join(journal.target,route,'index.html'),'utf8');
  assert.match(await page('/news/atoms-math/'),/class="katex"[\s\S]*math-error/);
  assert.match(await page('/news/atoms-figures/'),/class="article-caption"/);
  assert.match(await page('/news/atoms-endnotes/'),/article-endnotes/);
  assert.doesNotMatch(await page('/news/roadmap-active/'),/scholay-view/);
  assert.match(await page('/en/news/atoms-typography/'),/<html lang="en">[\s\S]*language-switch/);
  const content=JSON.parse(await readFile(join(journal.target,'published-content.json'),'utf8'));
  assert.equal(content.knowledge.nodes.length,4);assert.equal(content.knowledge.relations.length,2);
  await access(join(portfolio.target,'index.html'));
  assert.match(await readFile(join(output,'index.html'),'utf8'),/demo-archie|archie/);
});
