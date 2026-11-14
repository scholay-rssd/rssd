import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildWritingDefaultsCatalog,resolveWritingDefaults} from '../contracts/writing-defaults.mjs';
import {onlineWritingDefaults,freezeWritingDefaults,authoringWritingDefaults,createWritingDefaultsReader} from '../scripts/rssd-writing-defaults.mjs';
const catalog=buildWritingDefaultsCatalog({source:{repository:'scholay-rssd/rssd',commit:'a'.repeat(40),files:[{path:'contracts/writing-defaults.mjs',sha256:'b'.repeat(64)}]}});
const baseline=()=>resolveWritingDefaults(catalog,'pets','daily-cat');
test('a writing session fetches once, resumes its exact snapshot, and new sessions fetch again',async t=>{
 const root=await mkdtemp(join(tmpdir(),'writing-baseline-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;
 const client={origin:'https://center.example',writingDefaults:async()=>{calls++;return baseline();}},scope={client,workspaceId:'pets',sectionId:'daily-cat',siteId:'pets',binding:{taskId:'one'}};
 const first=await freezeWritingDefaults({...scope,directory:join(root,'one')});assert.equal(calls,1);
 client.writingDefaults=async()=>{calls++;throw Error('offline');};assert.deepEqual(await freezeWritingDefaults({...scope,directory:join(root,'one')}),first);assert.equal(calls,1);
 await assert.rejects(freezeWritingDefaults({...scope,directory:join(root,'two')}),/线上写作默认配置/);assert.equal(calls,2);
 await assert.rejects(freezeWritingDefaults({...scope,directory:join(root,'one'),sectionId:'daily-dog'}),/不匹配/);
 const disk=JSON.parse(await readFile(join(root,'one/writing-defaults.json')));assert.equal(disk.baseline.hash,first.baseline.hash);
});
test('fresh authoring does not use local rules after a network, provenance or scope error',async()=>{
 for(const writingDefaults of [async()=>{throw Error('offline');},async()=>({...baseline(),workspaceId:'other'}),async()=>({...baseline(),instructions:'older local rules'})])await assert.rejects(onlineWritingDefaults({client:{writingDefaults},workspaceId:'pets',sectionId:'daily-cat'}),e=>e.code==='writing_defaults_unavailable');
});
test('public defaults reading sends no credentials and rejects redirects at the fetch boundary',async()=>{
 let called;
 const client=createWritingDefaultsReader({origin:'https://center.example',fetcher:async(url,options)=>{called={url,options};return Response.json(baseline());}});
 const result=await authoringWritingDefaults({client,workspaceId:'pets',sectionId:'daily-cat',local:{instructions:'本篇只介绍家庭环境',images:{minimum:2}}});
 assert.equal(result.baseline.images.minimum,1);assert.equal(result.images.minimum,2);assert.match(called.url,/public\/v1\/writing-defaults\/pets\/daily-cat$/);assert.equal(called.options.redirect,'error');assert.equal(called.options.headers.Authorization,undefined);
});
