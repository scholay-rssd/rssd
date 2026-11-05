import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {openNotebook,beginNotebookPrompt,checkNotebook,exportNotebook} from '../desktop/scripts/agent/notebook-store.mjs';
import {notebookPreparation,completionTargets} from '../desktop/scripts/agent/notebook-completion.mjs';
import {notebookPromptScope} from '../desktop/scripts/agent/notebook.mjs';
import {createAgentTools} from '../desktop/scripts/agent/tools.mjs';
import {readDraft} from '../scripts/editorial-workspace.mjs';
import {flowPermission} from '../desktop/scripts/agent/workflow.mjs';
const block=(id,extra={})=>({id,type:'paragraph',text:'',state:'placeholder',requirement:'说明证据和背景',sourceIds:[],...extra});
const note=()=>({version:2,title:'可复现的研究',kind:'article',sectionId:'observations',skills:[],fields:{},sources:[],groups:[],assets:{},mounts:{templates:[],brands:[]},blocks:[block('manual',{text:'保留人工正文',state:'ready',locked:true}),block('h',{type:'heading',level:2,requirement:''}),block('p')]});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'today-completion-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'_ops/inventory'),{recursive:true});await mkdir(join(root,'articles'));await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:[]}));const store=new TaskStore(root);let task=await openNotebook(store,(await store.create({mode:'observation',skill:'unskilled'})).id);task=await store.update(task.id,{notebook:note()},task.revision);return {root,store,task};}
test('preparation accepts actionable placeholders without treating unreviewed sources as a gate',()=>{const n=note();assert.ok(notebookPreparation(n).every(c=>c.ok));assert.deepEqual(completionTargets(n),['h','p']);n.blocks[2].requirement='';assert.equal(notebookPreparation(n).find(c=>c.id==='block:p').ok,false);n.blocks[2].sourceIds=['rss'];n.sources=[{id:'rss',title:'原文',summary:'摘要',url:'https://example.org',acquiredVia:'rss',reviewed:false}];assert.ok(notebookPreparation(n).every(c=>c.ok));n.blocks[2].locked=true;assert.throws(()=>notebookPromptScope(n,{action:'complete',targetIds:['manual']}),/保护/);});
test('one completion run fills placeholders and headings, preserves prose, and exports only after format passes',async t=>{
 const {root,store,task}=await fixture(t);assert.equal((await checkNotebook(store,task,{preparing:true})).ready,true);assert.equal((await checkNotebook(store,task)).ready,false);
 const started=await beginNotebookPrompt(store,task.id,{action:'complete',sources:'combined',expectedRevision:task.revision});const op=started.runtime.notebookAction.operationId;
 assert.deepEqual(started.runtime.notebookAction.targetIds,['h','p']);assert.deepEqual(started.runtime.notebookAction.authorizedLockedIds,[]);
 await assert.rejects(exportNotebook(store,task.id,started.revision,{completionOperationId:op}),/占位/);assert.equal((await store.get(task.id)).completedAt,undefined);
 const tools=createAgentTools({root,taskId:task.id,taskStore:store,approve:async()=>true});await assert.rejects(tools('notebook_patch',{expectedRevision:started.revision,updates:[{id:'manual',text:'覆盖'}]}),/委派|锁定/);
 await tools('notebook_patch',{expectedRevision:started.revision,updates:[{id:'h',text:'研究步骤',state:'ready'},{id:'p',text:'依据已提供的资料说明研究步骤。',state:'ready'}]});
 let latest=await store.get(task.id);assert.deepEqual(latest.notebook.blocks[0],started.notebook.blocks[0]);await store.runtime(task.id,{busy:true,queued:false});
 await assert.rejects(exportNotebook(store,task.id,latest.revision),/等待对话/);await assert.rejects(exportNotebook(store,task.id,latest.revision,{completionOperationId:'stale'}),/运行已变化/);
 const done=await exportNotebook(store,task.id,latest.revision,{completionOperationId:op});assert.ok(done.completedAt);const draft=await readDraft(done.articleId,root);assert.match(draft.markdown,/保留人工正文/);assert.match(draft.markdown,/依据已提供/);assert.equal(done.delivery.destination,'local');
});
test('cancelled completion cannot later auto-save or reuse its authorization',async t=>{const {store,task}=await fixture(t);const started=await beginNotebookPrompt(store,task.id,{action:'complete',expectedRevision:task.revision});await store.runtime(task.id,{busy:false,queued:false,status:'已停止'});await assert.rejects(exportNotebook(store,task.id,started.revision,{completionOperationId:started.runtime.notebookAction.operationId}),/运行已变化/);assert.equal((await store.get(task.id)).completedAt,undefined);});
test('ordinary conversations never receive automatic completion permission',async t=>{const {store,task}=await fixture(t);const started=await beginNotebookPrompt(store,task.id,{action:'fill',expectedRevision:task.revision});await assert.rejects(exportNotebook(store,task.id,started.revision,{completionOperationId:started.runtime.notebookAction.operationId}),/运行已变化/);});
test('image tools are available to a completion run, while image generation still requires its own explicit operation',()=>{const task={notebook:note(),mode:'observation',workflow:{authorized:true,sources:'combined'},runtime:{notebookAction:{action:'complete'}}};assert.equal(!!flowPermission(task,{kind:'other',title:'Generate Image',rawInput:{_toolName:'GenerateImage'}}),false);});


test('preparation checks component metadata without requiring AI prose or optional fields',async t=>{
 const {store}=await fixture(t);let task=await openNotebook(store,(await store.create({mode:'calendar',skill:'calendar'})).id);
 const {ACTIVE_SITE}=await import('../scripts/site-profile.mjs');
 task=await store.update(task.id,{notebook:{...task.notebook,sectionId:'calendar',title:'机构活动',fields:{start:'2026-10-16',category:ACTIVE_SITE.yearCategories[0],dateBasis:'机构日程',sourceName:'机构',sourceUrl:'https://example.org/event'},blocks:task.notebook.blocks.map(b=>b.state==='placeholder'?{...b,requirement:'依照活动原文整理本节'}:b)}},task.revision);
 assert.deepEqual((await checkNotebook(store,task,{preparing:true})).issues,[]);assert.equal((await checkNotebook(store,task)).ready,false);
 task=await store.update(task.id,{notebook:{...task.notebook,fields:{...task.notebook.fields,start:'2026-02-30'}}},task.revision);assert.equal((await checkNotebook(store,task,{preparing:true})).ready,false);
});
test('backend issues locate the relevant field, body, sources or preserved conflict actions',async()=>{
 const {completionIssueTarget}=await import('../desktop/scripts/agent/notebook-completion.mjs');const n=note();
 assert.deepEqual(completionIssueTarget(n,'结构化字段：发生年份无效'),{panel:'properties',field:'year'});
 assert.deepEqual(completionIssueTarget(n,'blocks.0.text：内容无效'),{panel:'body',blockId:'manual'});
 assert.deepEqual(completionIssueTarget(n,'结构化字段：至少填写一个来源，最多 20 个'),{panel:'sources'});
 assert.deepEqual(completionIssueTarget(n,'作品库正文已变化，请重新载入'),{panel:'conflict'});
});

test('missing section permits local authoring and exporting without inventing a section',async t=>{
 const {store,task}=await fixture(t),n={...task.notebook,blocks:[block('ready',{text:'正文已整理完成。',state:'ready'})]};delete n.sectionId;
 const saved=await store.update(task.id,{notebook:n},task.revision);
 assert.equal(saved.notebook.sectionId,undefined);
 for(const preparing of [true,false])assert.ok(!(await checkNotebook(store,saved,{preparing})).issues.includes('选择发布栏目'));
 const exported=await exportNotebook(store,saved.id,saved.revision);assert.equal(exported.notebook.sectionId,undefined);assert.ok(exported.completedAt);
});

test('manual research grants only one run; persistent writing permission survives reopening',async t=>{
 const {root,store,task}=await fixture(t);
 let current=await beginNotebookPrompt(store,task.id,{action:'research',sources:'combined',expectedRevision:task.revision});
 assert.equal(current.workflow.sources,'combined');assert.equal(current.notebook.context,undefined);
 current=await beginNotebookPrompt(store,current.id,{action:'organize',sources:'combined',expectedRevision:current.revision});
 assert.equal(current.workflow.sources,'rss');
 current=await store.update(current.id,{notebook:{...current.notebook,context:{webEnabled:true,excludedSourceIds:[]}}},current.revision);
 const reopened=new TaskStore(root);current=await reopened.get(current.id);
 current=await beginNotebookPrompt(reopened,current.id,{action:'organize',sources:'rss',expectedRevision:current.revision});assert.equal(current.workflow.sources,'combined');
 await assert.rejects(reopened.update(current.id,{notebook:{...current.notebook,context:{webEnabled:false,excludedSourceIds:[]}}},current.revision,{agent:true}),/上下文由作者/);
 current=await reopened.update(current.id,{notebook:{...current.notebook,context:{webEnabled:false,excludedSourceIds:[]}}},current.revision);
 current=await beginNotebookPrompt(reopened,current.id,{action:'organize',expectedRevision:current.revision});assert.equal(current.workflow.sources,'rss');
});

test('unmounted sources preserve prose and citations across export and reopen',async t=>{
 const {store,task}=await fixture(t),source={id:'s',title:'原文',summary:'资料摘要',url:'https://example.org/original',reviewed:true,acquiredVia:'rss'};
 const n={...task.notebook,sources:[source],context:{webEnabled:true,excludedSourceIds:['s']},blocks:[block('manual',{text:'作者已有正文',state:'ready',locked:true,sourceIds:['s']})]};
 const saved=await store.update(task.id,{notebook:n},task.revision),done=await exportNotebook(store,saved.id,saved.revision);
 const {reloadNotebookDraft}=await import('../desktop/scripts/agent/notebook-store.mjs');
 const reopened=await reloadNotebookDraft(store,done.id,done.revision,{reopen:true});assert.deepEqual(reopened.notebook.context,n.context);assert.deepEqual(reopened.notebook.sources,[source]);assert.equal(reopened.notebook.blocks[0].text,'作者已有正文');
 const {notebookMarkdown,notebookInstructions}=await import('../desktop/scripts/agent/notebook.mjs');assert.match(notebookMarkdown(reopened.notebook),/example.org\/original/);assert.match(notebookInstructions(reopened),/当前已取消挂载的素材 ID：\["s"\]/);
});
