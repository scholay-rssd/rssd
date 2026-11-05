import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {optimizeEntry} from '../web/themes/academic/entry-hints.mjs';

const year='/calendar-data/'+'a'.repeat(64)+'.json';
const stamp=text=>createHash('sha256').update(text).digest('hex').slice(0,10);
async function fixture(t){
 const target=await mkdtemp(join(tmpdir(),'academic-entry-'));t.after(()=>rm(target,{recursive:true,force:true}));
 await mkdir(join(target,'fonts'));
 await writeFile(join(target,'styles.css'),'body{}');await writeFile(join(target,'atlas.css'),'.a{}');
 await writeFile(join(target,'scholay-logo.png'),'png');
 await writeFile(join(target,'app.js'),"import {a} from './calendar-model.js?v=1';\nimport {createCalendarLoader} from './calendar-data.js?v=2';\nconst lazy=()=>import('./later.js');\n");
 await writeFile(join(target,'index.html'),'<head><link rel="canonical" href="https://today.scholay.com/">\n<link rel="stylesheet" href="/styles.css?v=old">\n<link rel="stylesheet" href="/atlas.css">\n<link rel="alternate" href="/content-feed.xml">\n<script src="/app.js?v=x" type="module"></script></head><body><a href="/#/year">年</a><img src="/scholay-logo.png"><img src="/missing.png"></body>');
 return target;
}

test('the calendar entry starts its data and modules with the page and stamps entry assets by content',async t=>{
 const target=await fixture(t);
 await optimizeEntry(target,{year});
 const html=await readFile(join(target,'index.html'),'utf8');
 assert.match(html,new RegExp('href="/styles.css\\?h='+stamp('body{}')+'"'));
 assert.match(html,new RegExp('href="/atlas.css\\?h='+stamp('.a{}')+'"'));
 assert.match(html,new RegExp('src="/scholay-logo.png\\?h='+stamp('png')+'"'));
 assert.match(html,/src="\/app.js\?h=[0-9a-f]{10}"/);
 // Untouched: absolute URLs, hash routes, non-assets and files that do not exist.
 assert.match(html,/href="https:\/\/today.scholay.com\/"/);assert.match(html,/href="\/#\/year"/);assert.match(html,/href="\/content-feed.xml"/);assert.match(html,/src="\/missing.png"/);
 const hints=html.indexOf('rel="preload" href="/calendar-index.json"'),firstStyle=html.indexOf('rel="stylesheet"');
 assert.ok(hints>0&&hints<firstStyle);
 assert.match(html,new RegExp('<link rel="preload" href="'+year+'" as="fetch" crossorigin>'));
 // Exact static import specifiers only; a dynamic import stays lazy.
 assert.match(html,/<link rel="modulepreload" href="\/calendar-model.js\?v=1">/);
 assert.match(html,/<link rel="modulepreload" href="\/calendar-data.js\?v=2">/);
 assert.doesNotMatch(html,/later.js/);
});

test('optimizing twice gives the same page',async t=>{
 const target=await fixture(t);
 await optimizeEntry(target,{year});const once=await readFile(join(target,'index.html'),'utf8');
 await optimizeEntry(target,{year});assert.equal(await readFile(join(target,'index.html'),'utf8'),once);
});

test('an unexpected year path is never preloaded',async t=>{
 const target=await fixture(t);
 await optimizeEntry(target,{year:'/elsewhere.json'});
 assert.doesNotMatch(await readFile(join(target,'index.html'),'utf8'),/elsewhere/);
});
