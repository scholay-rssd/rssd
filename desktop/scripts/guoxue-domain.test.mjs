import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {workflowInstructions} from './agent/workflow.mjs';
import {GUOXUE} from './agent/guoxue-domain.mjs';

test('国学范围 reaches the agent while old shipped guides upgrade only in memory and frozen mounts remain intact',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-guoxue-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const folder=join(root,'.agents/skills/site-writing');await mkdir(folder,{recursive:true});
 const old=`# 内容写作\n围绕${GUOXUE.name}采集已核实的原始来源。区分事实、观点和计划。新闻与历史保留出处；年度惯例须有月日依据，不把发布日期当作事件日期。通过 draft_create、draft_save 按稳定编号与 SHA 保存。公开前遵守工作台确认流程，不通过 shell 绕过。\n`;
 await writeFile(join(folder,'SKILL.md'),old);
 const notebook={kind:'article',skills:['observation'],blocks:[],sources:[],fields:{}};
 const prompt=await workflowInstructions(root,'observation',{notebook},GUOXUE);
 assert.match(prompt,/四书五经、儒家思想、易经经典/);
 assert.match(prompt,/不得把现代自然科学/);assert.match(prompt,/人工锁/);
 assert(!prompt.includes('通过 draft_create'));
 assert.equal(await readFile(join(folder,'SKILL.md'),'utf8'),old);
 const mounted={id:'site-writing',content:'作者原有挂载原文',contentHash:'unchanged',version:'original'};
 const existing={...notebook,mounts:{skills:[mounted]}};
 const before=JSON.stringify(existing);
 const frozen=await workflowInstructions(root,'observation',{notebook:existing},GUOXUE);
 assert.match(frozen,/四书五经/);assert.equal(JSON.stringify(existing),before);
});
