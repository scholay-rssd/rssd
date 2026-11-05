import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles} from '../scripts/site-config.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {openNotebook,beginNotebookPrompt,checkNotebook,exportNotebook} from '../desktop/scripts/agent/notebook-store.mjs';
import {acceptNotebookTurn} from '../desktop/scripts/agent/notebook-turns.mjs';
import {changeNotebookTemplate} from '../desktop/scripts/agent/notebook-template-store.mjs';
import {createAgentTools} from '../desktop/scripts/agent/tools.mjs';
const context=()=>({skills:[],brands:[],sources:[],webEnabled:false});

for(const authored of [false,true])test(`organizing an existing template preserves its structure and block IDs (authored=${authored})`,async t=>{
 const {store,task}=await setup(t),template={id:'existing',mode:'essay',name:'既有结构',prompt:'核对资料',kind:'article',materials:[{name:'背景',prompt:'交代背景'},{name:'分析',prompt:'分析证据'}]};
 let next=await changeNotebookTemplate(store,task.id,{spaceId:task.spaceId,expectedRevision:task.revision,template});
 if(authored)next=await store.update(task.id,{notebook:{...next.notebook,blocks:next.notebook.blocks.map(b=>b.type==='paragraph'?{...b,text:'作者已完成的正文',state:'ready'}:b)}},next.revision);
 const original=JSON.parse(JSON.stringify(next.notebook));
 next=await beginNotebookPrompt(store,task.id,{action:'organize',text:'继续整理',expectedRevision:next.revision,turnContext:{...context(),template}});
 assert.deepEqual(next.notebook,original);
 assert.deepEqual(next.notebookTurns[0].candidate.blocks,original.blocks);
 assert.deepEqual(next.notebookTurns[0].candidate.groups,original.groups);
 assert.equal(next.notebookTurns[0].candidate.templateSelection.instanceId,original.templateSelection.instanceId);
});

test('changing the turn template releases untouched old presets only in the candidate',async t=>{
 const {store,task}=await setup(t),template={id:'old',mode:'essay',name:'原模板',prompt:'旧方向',kind:'article'};
 let next=await changeNotebookTemplate(store,task.id,{spaceId:task.spaceId,expectedRevision:task.revision,template});
 const original=JSON.parse(JSON.stringify(next.notebook)),oldIds=new Set(original.blocks.map(b=>b.id));
 next=await beginNotebookPrompt(store,task.id,{action:'organize',text:'换个方向',expectedRevision:next.revision,turnContext:{...context(),template:{...template,id:'new',name:'新模板'}}});
 assert.deepEqual(next.notebook,original);
 assert.equal(next.notebookTurns[0].candidate.blocks.some(b=>oldIds.has(b.id)),false);
 assert.equal(next.notebookTurns[0].candidate.mounts.templates.length,1);
 assert.equal(next.notebookTurns[0].candidate.templateSelection.template.id,'new');
});

test('a local-only turn overrides an article context that previously allowed network reads',async t=>{
 const {store,task,call}=await setup(t);
 const {mountResource,setContextNetwork}=await import('../desktop/scripts/agent/writing-context-store.mjs');
 await setContextNetwork(store,task,true);
 const mounted=await mountResource(store,task,{kind:'web',url:'https://example.org/article'},{fetcher:async()=>new Response('<title>原始资料</title><p>资料正文</p>')});
 const next=await beginNotebookPrompt(store,task.id,{expectedRevision:task.revision,text:'只用已有资料',action:'organize',turnContext:context()});
 assert.equal(next.workflow.allowNetwork,false);assert.equal(next.workflow.sources,'rss');
 assert.equal((await call('resource_list',{})).allowNetwork,false);
 await assert.rejects(call('resource_read',{mountId:mounted.mount.id,locator:{url:'https://example.org/article'}}),/未允许联网/);
});
async function setup(t,site=profiles[0]){const root=await mkdtemp(join(tmpdir(),'today-turn-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'.site.json'),JSON.stringify(site));await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({version:1,articles:{},annexColumns:site.columns}));const store=new TaskStore(root);let task=await openNotebook(store,(await store.create({mode:'observation'})).id,{empty:true});task=await store.update(task.id,{notebook:{...task.notebook,sectionId:sectionsForSite(site)[0].id}},task.revision);return {store,task,call:createAgentTools({root,taskId:task.id,taskStore:store,approve:()=>false})};}
test('file attachment validation precedes turn mutation and snapshots only the files actually sent',async t=>{
 const {store,task}=await setup(t),base={expectedRevision:task.revision,text:'读取附件',action:'organize',turnContext:{...context(),files:[{name:'伪造附件'}]}};
 await assert.rejects(beginNotebookPrompt(store,task.id,{...base,attachments:[{type:'text',name:'大文件',text:'x'.repeat(150001)}]}),/文本附件/);
 assert.equal((await store.get(task.id)).notebookTurns,undefined);
 const next=await beginNotebookPrompt(store,task.id,{...base,attachments:[{id:'file',type:'text',name:'资料.md',text:'只供本轮阅读'}]});
 assert.equal(next.notebookTurns[0].context.files[0].name,'资料.md');assert.equal(next.notebookTurns[0].context.files[0].text,undefined);assert.equal(next.notebook.blocks.length,0);
 await store.runtime(task.id,{notebookAction:null,turnStatus:'已完成'});const ready=await store.get(task.id);
 const following=await beginNotebookPrompt(store,task.id,{expectedRevision:ready.revision,text:'继续',action:'organize',turnContext:context()});assert.deepEqual(following.notebookTurns[1].context.files,[]);
});
for(const site of profiles)test(`${site.id}: per-turn candidate, acceptance, attribution and idempotency`,async t=>{
 const {store,task,call}=await setup(t,site),original=JSON.parse(JSON.stringify(task.notebook));
 let next=await beginNotebookPrompt(store,task.id,{expectedRevision:task.revision,text:'写一段',action:'organize',turnContext:{...context(),sources:[{id:'source',title:'原文',summary:'原始材料',url:'https://example.org/source',acquiredVia:'rss',reviewed:false}]}});
 const turnId=next.notebookTurns[0].id;assert.deepEqual(next.notebook,original);
 const view=await call('task_read',{});assert.equal(view.notebookTurns,undefined);assert.equal(view.notebook.sources[0].id,'source');
 await call('task_update',{expectedRevision:next.revision,notebook:{title:'候选标题',blocks:[{id:'draft',type:'paragraph',text:'新生成的正文',state:'ready',sourceIds:['source']}]}});
 next=await store.get(task.id);assert.deepEqual(next.notebook,original);
 await store.runtime(task.id,{notebookAction:null,turnStatus:'已完成',busy:false});next=await store.get(task.id);
 assert.equal(next.notebookTurns[0].candidate,undefined);assert.equal(next.notebookTurns[0].status,'ready');
 const accepted=await acceptNotebookTurn(store,task.id,{turnId,expectedRevision:next.revision});assert.equal(accepted.notebook.title,'候选标题');assert.equal(accepted.notebook.blocks[0].locked,true);assert.equal(accepted.notebook.sources[0].url,'https://example.org/source');
 assert.equal((await acceptNotebookTurn(store,task.id,{turnId,expectedRevision:0})).revision,accepted.revision);
});
test('template mounts do not write placeholders into the official document; research and next turns do not inherit mounts',async t=>{
 const {store,task}=await setup(t),template={id:'one',mode:'essay',name:'写作计划',prompt:'先论点后证据',kind:'article'};
 let next=await beginNotebookPrompt(store,task.id,{action:'organize',text:'讨论',expectedRevision:task.revision,turnContext:{...context(),template,webEnabled:true}});
 assert.equal(next.notebook.blocks.length,0);assert.ok(next.notebookTurns[0].candidate.blocks.length);assert.equal(next.workflow.sources,'combined');
 await store.runtime(task.id,{notebookAction:null,turnStatus:'已停止'});next=await store.get(task.id);assert.equal(next.notebookTurns[0].status,'interrupted');assert.equal(next.notebook.blocks.length,0);
 next=await beginNotebookPrompt(store,task.id,{action:'research',text:'查资料',expectedRevision:next.revision,turnContext:{...context(),template}});
 assert.equal(next.notebookTurns[1].candidate.blocks.length,0);assert.equal(next.workflow.sources,'rss');
});
test('accepting a stale rewrite never overwrites author changes, including same-text newer revisions',async t=>{
 const {store,task,call}=await setup(t);let next=await store.update(task.id,{notebook:{...task.notebook,blocks:[{id:'p',type:'paragraph',text:'原文',state:'ready',locked:true,sourceIds:[]}]}},task.revision);
 next=await beginNotebookPrompt(store,task.id,{expectedRevision:next.revision,text:'改写',action:'revise',targetIds:['p'],turnContext:context()});const turnId=next.notebookTurns[0].id;
 await call('notebook_patch',{expectedRevision:next.revision,updates:[{id:'p',text:'AI 改写',state:'ready'}]});await store.runtime(task.id,{notebookAction:null,turnStatus:'已完成'});next=await store.get(task.id);
 next=await store.update(task.id,{notebook:{...next.notebook,blocks:next.notebook.blocks.map(b=>({...b,text:'人工续写'}))}},next.revision);
 await assert.rejects(acceptNotebookTurn(store,task.id,{turnId,expectedRevision:next.revision}),/CONFLICT/);assert.equal((await store.get(task.id)).notebook.blocks[0].text,'人工续写');
});
test('research sources can be accepted as attributed material without implicitly mounting future searches',async t=>{
 const {store,task,call}=await setup(t);let next=await beginNotebookPrompt(store,task.id,{action:'research',text:'查资料',expectedRevision:task.revision,turnContext:{...context(),webEnabled:true}});
 await call('task_update',{expectedRevision:next.revision,notebook:{sources:[{id:'web',title:'原始资料',summary:'来源中的说明',url:'https://example.org/original',acquiredVia:'web',reviewed:false}]}});
 await store.runtime(task.id,{busy:false,queued:false,status:'已完成'});next=await store.get(task.id);assert.equal(next.notebook.blocks.length,0);
 const turn=next.notebookTurns[0];assert.equal(turn.items[0].kind,'source');next=await acceptNotebookTurn(store,task.id,{turnId:turn.id,expectedRevision:next.revision});assert.deepEqual(next.notebook.blocks[0].sourceIds,['web']);assert.equal(next.notebook.context,undefined);
});
for(const mode of ['opensource','calendar','history'])test(`${mode}: accepting a structured template keeps the existing record export contract`,async t=>{
 const {store,task,call}=await setup(t),template={id:mode,mode,name:'记录模板',prompt:'整理记录',kind:'article'};
 let next=await beginNotebookPrompt(store,task.id,{action:'organize',text:'填写',expectedRevision:task.revision,turnContext:{...context(),template,sources:[{id:'ref',title:'机构原文',url:'https://example.org',summary:'资料',acquiredVia:'rss',reviewed:false}]}});
 const view=await call('task_read',{}),fields=mode==='calendar'?{start:'2026-10-18',category:profiles[0].yearCategories[0],tags:[],dateBasis:'正式日程',sourceName:'机构',sourceUrl:'https://example.org',provenance:'已核验'}:mode==='history'?{year:1950,dateKey:'10-18',domain:'科技',eventType:'发现',importance:'B',preciseToDay:true}:{date:'2026-10-18',category:profiles[0].sourceCategories[0],url:'https://example.org'};
 await call('task_update',{expectedRevision:next.revision,notebook:{title:'记录标题',fields,blocks:view.notebook.blocks.map(b=>b.locked?b:{...b,text:b.type==='heading'?'补充说明':'记录内容',state:'ready',sourceIds:['ref']})}});
 await store.runtime(task.id,{busy:false,queued:false,status:'已完成'});next=await store.get(task.id);next=await acceptNotebookTurn(store,task.id,{turnId:next.notebookTurns[0].id,expectedRevision:next.revision});assert.ok(next.articleId.startsWith('record-'));assert.equal(next.mode,mode);
 const check=await checkNotebook(store,next);assert.equal(check.ready,true,check.issues.join(';'));assert.ok((await exportNotebook(store,task.id,next.revision)).completedAt);
});
