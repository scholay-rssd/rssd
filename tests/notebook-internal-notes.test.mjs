import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {openNotebook,beginNotebookPrompt,exportNotebook,recordNotebookModel,reloadNotebookDraft} from '../desktop/scripts/agent/notebook-store.mjs';
import {acceptNotebookTurn} from '../desktop/scripts/agent/notebook-turns.mjs';
import {createAgentTools} from '../desktop/scripts/agent/tools.mjs';
import {notebookMarkdown,formatErrors} from '../desktop/scripts/agent/notebook.mjs';
import {readDraft,workspaceCall} from '../scripts/editorial-workspace.mjs';
import {appendInternalNotes,restorePrivateEditorial,validatePrivateEditorial} from '../contracts/article-internal-notes.mjs';
import {deviceName} from '../desktop/scripts/agent/device-name.mjs';
import {ARTICLE_WRITING_INSTRUCTIONS} from '../contracts/article-writing-policy.mjs';

async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'private-notebook-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:[]}));
 const store=new TaskStore(root);let task=await openNotebook(store,(await store.create({mode:'observation',skill:'essay'})).id);
 task=await store.update(task.id,{notebook:{...task.notebook,title:'正文与内部备注',sectionId:'observations',blocks:[{id:'body',type:'paragraph',text:'数据为模拟示例，不能解释为观测结果。',state:'ready',sourceIds:[]}]}},task.revision);
 const call=createAgentTools({root,taskId:task.id,taskStore:store,approve:async()=>true});return {root,store,task,call};
}
test('the first-pass JSON example writes body and attached notes in one revision and exports only prose',async t=>{
 const {store,task,call,root}=await setup(t);
 const active=await beginNotebookPrompt(store,task.id,{action:'revise',targetIds:['body'],text:'一次成文',expectedRevision:task.revision});
 const example=JSON.parse(ARTICLE_WRITING_INSTRUCTIONS.split('\n').find(line=>line.startsWith('{"expectedRevision"')));
 example.expectedRevision=active.revision;
 await call('task_update',example);
 const saved=await store.get(task.id);
 assert.equal(saved.revision,active.revision+1);
 assert.equal(saved.notebook.blocks[0].text,example.notebook.blocks[0].text);
 assert.equal(saved.notebook.blockNotes.body.notes.supplement,example.notebook.blockNotes.body.notes.supplement);
 await exportNotebook(store,task.id,saved.revision);
 const draft=await readDraft(task.articleId,root);
 assert.match(draft.markdown,/参与者相互独立/);assert.doesNotMatch(draft.markdown,/时间序列和聚类/);
 const notes=await workspaceCall('draft_private_notes',{id:task.articleId},root);
 assert.equal(notes.blockNotes.body.anchor.text,example.notebook.blocks[0].text);
});
test('private note tool appends with revision checks and never alters the public article',async t=>{
 const {store,task,call}=await setup(t);let next=await beginNotebookPrompt(store,task.id,{action:'revise',targetIds:['body'],text:'补充内部说明',expectedRevision:task.revision});
 const publicBody=notebookMarkdown(next.notebook);
 await call('notebook_notes',{expectedRevision:next.revision,notes:{images:'图片仅作氛围参考，与正文无直接关系。',writing:'使用简洁说明。'}});
 await assert.rejects(call('notebook_notes',{expectedRevision:next.revision,notes:{other:'过期更新'}}),/CONFLICT/);
 next=await store.get(task.id);assert.equal(notebookMarkdown(next.notebook),publicBody);
 assert.match(next.notebook.internalNotes.images,/氛围/);
 await assert.rejects(call('task_update',{expectedRevision:next.revision,notebook:{internalNotes:{images:'覆盖人工说明'}}}),/保留/);
 await assert.rejects(call('task_update',{expectedRevision:next.revision,notebook:{modelSignatures:[{modelId:'invented'}]}}),/运行服务/);
 assert.throws(()=>appendInternalNotes({}, {invented:'x'}),/字段/);
 assert.deepEqual(appendInternalNotes({writing:'已写说明'},{writing:'已写说明'}),{writing:'已写说明'});
 assert.ok(formatErrors({...next.notebook,internalNotes:{writing:42}}).some(x=>x.path==='internalNotes'));
});
test('candidate notes remain private, require acceptance, and detect concurrent author edits',async t=>{
 const {store,task,call}=await setup(t);
 let next=await beginNotebookPrompt(store,task.id,{action:'organize',text:'写作说明',expectedRevision:task.revision,turnContext:{skills:[],brands:[],sources:[],webEnabled:false}});
 const turnId=next.runtime.notebookAction.turnId;
 await call('notebook_notes',{expectedRevision:next.revision,notes:{writing:'这段只供作者查看。'}});
 assert.equal((await store.get(task.id)).notebook.internalNotes,undefined);
 await store.runtime(task.id,{notebookAction:null,turnStatus:'已完成',busy:false});next=await store.get(task.id);
 assert.equal(next.notebookTurns[0].items[0].kind,'internal');
 next=await acceptNotebookTurn(store,task.id,{turnId,expectedRevision:next.revision});
 assert.equal(next.notebook.internalNotes.writing,'这段只供作者查看。');
 assert.doesNotMatch(notebookMarkdown(next.notebook),/只供作者/);
 next=await beginNotebookPrompt(store,task.id,{action:'organize',text:'补充说明',expectedRevision:next.revision,turnContext:{skills:[],brands:[],sources:[],webEnabled:false}});
 const secondTurn=next.runtime.notebookAction.turnId;
 await call('notebook_notes',{expectedRevision:next.revision,notes:{writing:'AI 新增说明'}});
 await store.runtime(task.id,{notebookAction:null,turnStatus:'已完成',busy:false});next=await store.get(task.id);
 next=await store.update(task.id,{notebook:{...next.notebook,internalNotes:{writing:'作者独立修改'}}},next.revision);
 await assert.rejects(acceptNotebookTurn(store,task.id,{turnId:secondTurn,expectedRevision:next.revision}),/内部备注已修改/);
 assert.equal((await store.get(task.id)).notebook.internalNotes.writing,'作者独立修改');
});
test('clearing the last private field persists instead of restoring an older sidecar',async t=>{
 const {root,store,task}=await setup(t);let next=await store.update(task.id,{notebook:{...task.notebook,internalNotes:{other:'待删除备注'}}},task.revision);
 next=await exportNotebook(store,task.id,next.revision);next=await reloadNotebookDraft(store,task.id,next.revision,{reopen:true});
 next=await store.update(task.id,{notebook:{...next.notebook,internalNotes:{}}},next.revision);await exportNotebook(store,task.id,next.revision);
 const saved=JSON.parse(await readFile(join(root,'.local/today',task.articleId,'internal-notes.json'),'utf8'));assert.deepEqual(saved.internalNotes,{});
});
test('runtime signatures and private notes survive export and reopening without leaking into Markdown or summary',async t=>{
 const {root,store,task}=await setup(t);
 await recordNotebookModel(store,task.id,{runId:'actual-run',agentId:'test-adapter',agentName:'Test adapter',modelId:null,modelName:null,device:'Studio 机',startedAt:'2026-10-28T00:00:00Z',action:'organize',status:'running'});
 await recordNotebookModel(store,task.id,{runId:'actual-run',finishedAt:'2026-10-28T00:01:00Z',status:'completed'});
 let next=await store.get(task.id);
 next=await store.update(task.id,{notebook:{...next.notebook,internalNotes:{writing:'PRIVATE_SENTINEL',images:'图片来源仅记录在此'}}},next.revision);
 next=await exportNotebook(store,task.id,next.revision);
 const draft=await readDraft(task.articleId,root),state=join(root,'.local/today',task.articleId);
 assert.doesNotMatch(draft.markdown,/PRIVATE_SENTINEL|test-adapter|图片来源仅/);
 assert.doesNotMatch(await readFile(join(state,'metadata.json'),'utf8'),/PRIVATE_SENTINEL|test-adapter/);
 const privateData=JSON.parse(await readFile(join(state,'internal-notes.json'),'utf8'));
 assert.equal(privateData.internalNotes.writing,'PRIVATE_SENTINEL');assert.equal(privateData.modelSignatures.length,1);assert.equal(privateData.modelSignatures[0].modelId,null);assert.equal(privateData.modelSignatures[0].status,'completed');assert.equal(privateData.modelSignatures[0].device,'Studio 机');
 // Simulate reconstruction after public Markdown was edited independently.
 await rm(join(state,'notebook.json'));
 const other=await store.create({mode:'observation'});other.articleId=task.articleId;other.workIds=[task.articleId];await store.save(other);
 const reopened=await openNotebook(store,other.id);
 assert.deepEqual(reopened.notebook.internalNotes,privateData.internalNotes);assert.deepEqual(reopened.notebook.modelSignatures,privateData.modelSignatures);
});


test('row notes obey delegated IDs, append protection and candidate acceptance',async t=>{
 const {store,task,call}=await setup(t);
 let next=await store.update(task.id,{notebook:{...task.notebook,blocks:[...task.notebook.blocks,{id:'other',type:'paragraph',text:'其他正文',state:'ready',sourceIds:[]}]}},task.revision);
 next=await beginNotebookPrompt(store,task.id,{action:'revise',targetIds:['body'],text:'检查此行',expectedRevision:next.revision,turnContext:{skills:[],brands:[],sources:[],webEnabled:false}});
 const turnId=next.runtime.notebookAction.turnId;
 await assert.rejects(call('notebook_notes',{expectedRevision:next.revision,blockId:'missing',notes:{verification:'错误位置'}}),/不存在/);
 await assert.rejects(call('notebook_notes',{expectedRevision:next.revision,blockId:'other',notes:{verification:'越界'}}),/委派/);
 await call('notebook_notes',{expectedRevision:next.revision,blockId:'body',notes:{verification:'ROW_PRIVATE'}});
 assert.equal((await store.get(task.id)).notebook.blockNotes,undefined);
 await store.runtime(task.id,{notebookAction:null,turnStatus:'已完成',busy:false});next=await store.get(task.id);
 assert.equal(next.notebookTurns[0].items[0].blockId,'body');
 next=await acceptNotebookTurn(store,task.id,{turnId,expectedRevision:next.revision});
 assert.equal(next.notebook.blockNotes.body.notes.verification,'ROW_PRIVATE');assert.doesNotMatch(notebookMarkdown(next.notebook),/ROW_PRIVATE/);
 next=await beginNotebookPrompt(store,task.id,{action:'revise',targetIds:['body'],text:'补充',expectedRevision:next.revision});
 await assert.rejects(call('task_update',{expectedRevision:next.revision,notebook:{blockNotes:{body:{notes:{verification:'覆盖'}}}}}),/保留/);
 await call('notebook_notes',{expectedRevision:next.revision,blockId:'body',notes:{verification:'SECOND_PRIVATE'}});
 next=await store.get(task.id);assert.equal(next.notebook.blockNotes.body.notes.verification,'ROW_PRIVATE\n\nSECOND_PRIVATE');
});
test('row notes survive export, private cloud shape and local manuscript lookup without public leakage',async t=>{
 const {root,store,task}=await setup(t);let next=await store.update(task.id,{notebook:{...task.notebook,blockNotes:{body:{notes:{verification:'ROW_PRIVATE'}}}}},task.revision);
 next=await exportNotebook(store,task.id,next.revision);
 const data=await workspaceCall('draft_private_notes',{id:task.articleId},root);
 assert.equal(data.blockNotes.body.notes.verification,'ROW_PRIVATE');assert.equal(data.blockNotes.body.anchor.text,next.notebook.blocks[0].text);
 assert.deepEqual(validatePrivateEditorial(data),data);assert.doesNotMatch(JSON.stringify(await readDraft(task.articleId,root)),/ROW_PRIVATE/);
 next=await reloadNotebookDraft(store,task.id,next.revision,{reopen:true});assert.equal(next.notebook.blockNotes.body.notes.verification,'ROW_PRIVATE');
 next=await store.update(task.id,{notebook:{...next.notebook,blockNotes:{}}},next.revision);await exportNotebook(store,task.id,next.revision);
 assert.equal((await workspaceCall('draft_private_notes',{id:task.articleId},root)).blockNotes,undefined);
});
test('private anchors rebind only unambiguous rows, retaining unmatched and duplicate notes',()=>{
 const data={internalNotes:{},modelSignatures:[],blockNotes:{old:{notes:{other:'PRIVATE'},anchor:{type:'markdown',text:'code'}}}};
 const one=restorePrivateEditorial({blocks:[{id:'new',type:'paragraph',text:'code'}]},data);assert.equal(one.blockNotes.new.notes.other,'PRIVATE');
 const duplicate=restorePrivateEditorial({blocks:[{id:'a',type:'paragraph',text:'code'},{id:'b',type:'paragraph',text:'code'}]},data);assert.deepEqual(duplicate.blockNotes,data.blockNotes);
 assert.deepEqual(restorePrivateEditorial({blocks:[]},data).blockNotes,data.blockNotes);
 assert.throws(()=>validatePrivateEditorial({version:1,bodySha:'a'.repeat(64),...data,blockNotes:{bad:{notes:{unknown:'x'}}}}),/归档/);
});

test('method caveats move beside their rows and survive acceptance, export and reopening privately',async t=>{
 const {root,store,task,call}=await setup(t);
 const examples=[
  {id:'scope',body:'参与者相互独立，每人的前后测成对重抽。',note:'本文的写法不能直接套用到这两类数据上，需要另选针对其依赖结构的重抽方案。'},
  {id:'percentile',body:'95% percentile 区间取重抽统计量的第 2.5 和第 97.5 百分位数为端点。',note:'95% 是置信程序的名义覆盖率：在抽样假设合适、近似有效时，反复取样构造的区间应约有 95% 包含总体平均变化；小样本下实际覆盖率可能偏离。对手上这一个已经算出的区间，不能说“真实平均变化有 95% 的概率落在其中”。'},
 ];
 let next=await store.update(task.id,{notebook:{...task.notebook,blocks:examples.map(x=>({id:x.id,type:'paragraph',text:x.body+x.note,state:'ready',sourceIds:[]}))}},task.revision);
 next=await beginNotebookPrompt(store,task.id,{action:'revise',targetIds:examples.map(x=>x.id),text:'将旁支说明收进行间备注',expectedRevision:next.revision,turnContext:{skills:[],brands:[],sources:[],webEnabled:false}});
 const turnId=next.runtime.notebookAction.turnId;
 await call('notebook_patch',{expectedRevision:next.revision,updates:examples.map(x=>({id:x.id,text:x.body,state:'ready'}))});
 for(const example of examples){next=await store.get(task.id);await call('notebook_notes',{expectedRevision:next.revision,blockId:example.id,notes:{supplement:example.note}});}
 // AI changes remain candidates until the author accepts the prose and notes.
 next=await store.get(task.id);assert.equal(next.notebook.blocks[0].text,examples[0].body+examples[0].note);
 await store.runtime(task.id,{notebookAction:null,turnStatus:'已完成',busy:false});next=await store.get(task.id);
 assert.equal(next.notebookTurns[0].items.filter(x=>x.kind==='internal'&&x.field==='supplement').length,2);
 next=await acceptNotebookTurn(store,task.id,{turnId,expectedRevision:next.revision});
 next=await exportNotebook(store,task.id,next.revision);
 const publicDraft=await readDraft(task.articleId,root),privateData=validatePrivateEditorial(await workspaceCall('draft_private_notes',{id:task.articleId},root));
 assert.equal(privateData.bodySha,publicDraft.sha256);
 for(const x of examples){
  assert.ok(publicDraft.markdown.includes(x.body));assert.ok(!JSON.stringify(publicDraft).includes(x.note));
  assert.equal(privateData.blockNotes[x.id].notes.supplement,x.note);
  assert.equal(privateData.blockNotes[x.id].anchor.text,x.body);
 }
 assert.ok(!await readFile(join(root,'.local/today',task.articleId,'metadata.json'),'utf8').then(text=>examples.some(x=>text.includes(x.note))));
 next=await reloadNotebookDraft(store,task.id,next.revision,{reopen:true});
 for(const x of examples)assert.equal(next.notebook.blockNotes[x.id].notes.supplement,x.note);
});
test('model records carry an optional producing device and reject malformed names',async()=>{
 const base={version:1,bodySha:'a'.repeat(64),internalNotes:{},modelSignatures:[{runId:'r',agentId:'codex',agentName:'Codex',modelId:null,modelName:null,startedAt:'2026-10-29T00:00:00Z',action:'organize',status:'completed'}]};
 assert.equal(validatePrivateEditorial(base).modelSignatures[0].device,undefined);
 assert.equal(validatePrivateEditorial({...base,modelSignatures:[{...base.modelSignatures[0],device:'headless-1'}]}).modelSignatures[0].device,'headless-1');
 for(const device of [42,'x'.repeat(121)])assert.throws(()=>validatePrivateEditorial({...base,modelSignatures:[{...base.modelSignatures[0],device}]}),/模型记录格式无效/);
 assert.equal(await deviceName({env:{SCHOLAY_DEVICE_NAME:' 云主机 '},platform:'darwin'}),'云主机');
 assert.equal(await deviceName({env:{},platform:'linux',host:()=>'scholay-headless'}),'scholay-headless');
 assert.equal(await deviceName({env:{},platform:'darwin',host:()=>'fallback.local',run:(file,args,options,done)=>done(null,'Owner 的 Mac Studio\n')}),'Owner 的 Mac Studio');
 assert.equal(await deviceName({env:{},platform:'darwin',host:()=>'fallback.local',run:(file,args,options,done)=>done(Error('no scutil'))}),'fallback.local');
});
