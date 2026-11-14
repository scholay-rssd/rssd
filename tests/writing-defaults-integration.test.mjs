import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildWritingDefaultsCatalog,resolveWritingDefaults} from '../contracts/writing-defaults.mjs';
import rules from '../contracts/writing-defaults-v1.cjs';
import {centerSkillSnapshot} from '../desktop/scripts/agent/center-skill-mounts.mjs';
import {installWritingDefaults} from '../scripts/install-writing-defaults.mjs';
import {workspaceWritingContext} from '../scripts/rssd-writing-defaults.mjs';
const source={repository:'scholay-rssd/rssd',commit:'a'.repeat(40),files:[{path:'contracts/writing-defaults.mjs',sha256:'b'.repeat(64)}]};
const catalog=buildWritingDefaultsCatalog({source});
async function temp(t){const p=await mkdtemp(join(tmpdir(),'writing-unified-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;}
test('a Center claim supplies exactly the same skills as file authoring and survives an offline resume',async t=>{
 const directory=await temp(t),baseline=resolveWritingDefaults(catalog,'metho','methods');
 const claim={id:'fixture-write',generation:1,workspaceId:'metho',sectionId:'methods',kind:'write',payload:{writingDefaults:baseline}};
 const args={claim,directory,origin:'https://center.example',writingPolicy:baseline.writingPolicy};
 const saved=await centerSkillSnapshot(args);assert.equal(saved.version,3);assert.equal(saved.defaults.baselineHash,baseline.hash);assert.deepEqual(saved.skills,baseline.skills);assert.deepEqual(saved.references,baseline.references);
 assert.deepEqual(await centerSkillSnapshot(args),saved);
 const changed=structuredClone(claim);changed.payload.writingDefaults=resolveWritingDefaults(catalog,'metho','statistics');
 await assert.rejects(centerSkillSnapshot({...args,claim:changed}),/认领不匹配/);
});
test('workspace migration preserves old guidance, then explicitly loads the online baseline before preferences',async t=>{
 const root=await temp(t);await mkdir(join(root,'.agents/skills/site-writing'),{recursive:true});await writeFile(join(root,'.agents/skills/site-writing/SKILL.md'),'old local custom guide');await writeFile(join(root,'AGENTS.md'),'existing instructions');
 const client={origin:'https://center.example',writingDefaultCatalog:async()=>catalog,writingDefaults:async(w,s)=>resolveWritingDefaults(catalog,w,s)};
 const result=await installWritingDefaults({root,workspaceId:'metho',client});assert.equal(result.changed.length,3);
 const old=JSON.parse(await readFile(join(root,'.local/writing-defaults/backups',rules.textHash('old local custom guide')+'.json')));assert.equal(old.text,'old local custom guide');
 await writeFile(join(root,'.local/writing-defaults/adjustments.json'),JSON.stringify({instructions:'本篇面向初学者，使用一个完整例子。'}));
 const context=await workspaceWritingContext(root,'methods',{client,directory:join(root,'session')});assert.equal(context.baselineHash,resolveWritingDefaults(catalog,'metho','methods').hash);assert.match(context.adjustment.instructions,/初学者/);assert.ok(context.instructions.indexOf('当前工作空间')<context.instructions.indexOf('本篇明确的本地偏好'));
 assert.match(await readFile(join(root,'AGENTS.md'),'utf8'),/existing instructions/);
 assert.deepEqual((await installWritingDefaults({root,workspaceId:'metho',client})).changed,[]);
});
