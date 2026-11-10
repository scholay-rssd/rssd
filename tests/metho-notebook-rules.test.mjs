import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {methoNotebookRules} from '../scripts/metho-notebook-rules.mjs';
import {TASK_MODE_NAMES} from '../desktop/scripts/agent/task-types.mjs';
const repo=new URL('../',import.meta.url).pathname;
const briefs={skip:!existsSync(repo+'docs/bot-writing-flow/briefs')&&'requires the private writing briefs'};
test('Metho rules select the actual column and optional statistical craft',briefs,async()=>{
 const m=await methoNotebookRules(repo,{sectionId:'methods',statistical:true});
 assert.ok(TASK_MODE_NAMES[m.taskMode]);assert.equal(m.column,'方法百科');assert.equal(m.taskMode,'observation');assert.equal(m.mode,'encyclopedia');
 assert.deepEqual(m.skills,['site-writing','statistics-explainer']);
 assert.ok(m.content.includes('方法百科'));assert.ok(m.content.includes('不投稿、不发布'));
 const f=await methoNotebookRules(repo,{sectionId:'frontiers'});assert.equal(f.taskMode,'xiwen');assert.ok(f.skills.includes('scholay-xiwen'));assert.notEqual(m.sha256,f.sha256);
 const e=await methoNotebookRules(repo,{sectionId:'experiments'});assert.equal(e.mode,'documentation');assert.ok(e.skills.includes('experiment-design'));
 await assert.rejects(methoNotebookRules(repo,{sectionId:'invalid'}));
});
