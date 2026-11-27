import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles} from '../scripts/site-config.mjs';
import {renderInProcess,renderHere} from '../receiver/build.mjs';

const snapshot=()=>({news:[{id:'published-note',title:'A published note',category:profiles.find(x=>x.id==='metho').columns[1],date:'2026-10-16',markdown:'# A published note\n\nKeep this exact published body.'}],
  data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:published-note':'/news/stable-note/'}});

test('a release rendered in a child process matches one rendered in the receiver, while the receiver keeps running',async t=>{
  const root=await mkdtemp(join(tmpdir(),'render-process-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const site=profiles.find(x=>x.id==='metho'),job={id:'render-process',snapshot:snapshot(),snapshot_hash:'fixture'},now=new Date('2026-11-27T00:00:00Z');
  // The receiver's own timers keep firing during a render in another process.
  let ticks=0;const timer=setInterval(()=>{ticks++;},5);
  let child;try{child=await renderInProcess({job,site,source:process.cwd(),target:join(root,'child'),now});}finally{clearInterval(timer);}
  const here=await renderHere({job,site,source:process.cwd(),target:join(root,'here'),now});
  assert.deepEqual(child.hashes,here.hashes);
  assert.equal(await readFile(join(root,'child','news','stable-note','index.html'),'utf8'),await readFile(join(root,'here','news','stable-note','index.html'),'utf8'));
  assert.ok(ticks>0);
});

test('a child render reports the renderer error and a renderer that never answers is stopped',async t=>{
  const root=await mkdtemp(join(tmpdir(),'render-process-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const site={...profiles.find(x=>x.id==='metho'),themeId:'no-such-theme'};
  await assert.rejects(renderInProcess({job:{id:'x',snapshot:snapshot(),snapshot_hash:'x'},site,source:process.cwd(),target:join(root,'bad')}),/Unsupported Theme|Theme/);
  await assert.rejects(renderInProcess({job:{id:'y',snapshot:snapshot(),snapshot_hash:'y'},site:profiles.find(x=>x.id==='metho'),source:process.cwd(),target:join(root,'slow')},{timeoutMs:1}),/took longer than/);
});
