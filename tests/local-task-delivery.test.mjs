import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {workflowCheck} from '../desktop/scripts/agent/workflow.mjs';
import {createDraft,readDraft,saveDraft} from '../scripts/editorial-workspace.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'scholay-local-delivery-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'_ops/inventory'),{recursive:true});await mkdir(join(root,'articles'));
 await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:['新闻聚合']}));
 return {root,store:new TaskStore(root)};
}
const modes=[
 {mode:'xiwen',category:'学界犀闻'},
 {mode:'observation',category:'学者观察'},
 {mode:'calendar',category:'学术情报',kind:'year',fields:{title:'科研事项',start:'2026-10-19',end:'2026-10-25',category:'学术会议',tags:['会议'],dateBasis:'官网活动日期',sourceName:'主办机构',sourceUrl:'https://example.org/event',provenance:'已核验官网',reviewedAt:'2026-10-05T00:00:00Z'},headings:['摘要','正文']},
 {mode:'history',category:'昔日学术',kind:'history',fields:{title:'科研史料',dateKey:'02-29',year:2000,domain:'科研软件史',eventType:'论文发表',importance:'B',sources:[{label:'出版社',url:'https://example.org/history'}],preciseToDay:true},headings:['事实摘要','学术意义']},
 {mode:'opensource',category:'学术开源',kind:'openSource',fields:{title:'科研项目',date:'2026-10-05',category:'基础设施',url:'https://example.org/project',status:'资料核验，未安装实测'},headings:['项目简介','学术价值']},
];
async function savedTask(root,store,spec=modes[1]){
 let task=await store.create({mode:spec.mode});
 task=await store.workflow(task.id,{action:'configure',sources:'combined',authorized:true,expectedRevision:task.revision});
 task=await store.update(task.id,{board:{titles:[],sections:[{id:'section',title:'研究',items:[{id:'news',title:'真实事件',summary:'核实原文后的事实',publisher:'机构',url:'https://example.org/source',date:'2026-10-05',selected:true}]}]}},task.revision);
 task=await store.confirm(task.id,'topic',task.revision);
 task=await store.update(task.id,{outline:{titleCandidates:['甲','乙','丙'],selectedTitle:0,blocks:[{id:'body',type:'paragraph',text:'生成正文',sourceIds:['news']}]}},task.revision);
 task=await store.confirm(task.id,'outline',task.revision);
 const title=spec.fields?.title||'保存到本地';
 const prose=spec.kind?'# '+title+'\n\n## '+spec.headings[0]+'\n\n已核实事实。\n\n## '+spec.headings[1]+'\n\n学术说明。':'# '+title+'\n\n'+('研究机构已核实的事实与适用范围。'.repeat(12));
 const draft=await createDraft({id:task.articleId,title,archiveCategory:spec.category,markdown:prose+'\n\n[来源](https://example.org/source)\n\n![待编辑图片](assets/placeholders/image-one.svg)',...(spec.kind?{record:{kind:spec.kind,fields:spec.fields}}:{})},root);
 task=await store.generated(task.id,task.articleId,draft.sha256);
 return {task,draft};
}
const params=(task,check)=>({destination:'local',expectedRevision:task.revision,expectedSha256:check.sha256,expectedFingerprint:check.fingerprint});

for(const spec of modes)test(spec.mode+': local delivery preserves saved text and placeholders without cloud access or a separate review',async t=>{
 const {root,store}=await fixture(t),{task,draft}=await savedTask(root,store,spec),check=await workflowCheck(root,task);
 assert.equal(check.draftReady,true);assert.equal(check.ready,false);assert.equal(task.workflow.review,undefined);assert.equal(task.stage,'draft');
 const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});globalThis.fetch=()=>{throw Error('Local delivery must not access a remote endpoint');};
 const ended=await store.finish(task.id,params(task,check));
 assert.ok(ended.completedAt);assert.equal(ended.stage,'deliver');assert.equal(ended.delivery.destination,'local');assert.equal(ended.delivery.sha256,draft.sha256);assert.equal(ended.delivery.canonicalPath,draft.canonicalPath);assert.equal(ended.delivery.taskRevision,task.revision);
 assert.equal(ended.workflow.authorized,false);assert.equal(ended.runtime.busy,false);assert.equal(ended.runtime.queued,false);assert.equal(ended.runtime.status,'已完成');
 assert.equal((await readDraft(task.articleId,root)).markdown,draft.markdown);assert.deepEqual(await store.leases(),{});
 await assert.rejects(access(join(root,'.local/today',task.articleId,'prepared.json')));await assert.rejects(access(join(root,'.local/today',task.articleId,'receipt.json')));
 assert.equal((await new TaskStore(root).finish(task.id,params(task,check))).completedAt,ended.completedAt);
 await assert.rejects(store.finish(task.id,{destination:'cloud',delivered:true}),/不能更改交稿位置/);
});

test('local delivery rejects concurrent editors, stale body SHA, task revisions and unsaved upstream changes',async t=>{
 const {root,store}=await fixture(t),{task,draft}=await savedTask(root,store),check=await workflowCheck(root,task);
 await store.lease(task.articleId,'editor-other');await assert.rejects(store.finish(task.id,params(task,check)),/另一个任务或编辑器/);await store.releaseOwner('editor-other');
 await assert.rejects(store.finish(task.id,{destination:'local'}),/当前任务版本和正文 SHA/);
 await assert.rejects(store.finish(task.id,{...params(task,check),expectedRevision:task.revision-1}),/任务已有新版/);
 await store.runtime(task.id,{busy:true,status:'执行中'});await assert.rejects(store.finish(task.id,params(task,check)),/先停止/);await store.runtime(task.id,{busy:false,status:'已停止'});
 const current=await saveDraft({id:draft.id,expectedSha256:draft.sha256,markdown:draft.markdown+'\n人工编辑保留。'},root);
 await assert.rejects(store.finish(task.id,params(task,check)),/CONFLICT/);assert.match((await readDraft(draft.id,root)).markdown,/人工编辑保留/);
 const stale=await store.update(task.id,{brief:'更改了上游范围'},task.revision);
 await assert.rejects(store.finish(task.id,{destination:'local',expectedRevision:stale.revision,expectedSha256:current.sha256}),/完成选题、生成/);
 assert.equal((await store.get(task.id)).completedAt,undefined);
});

test('local delivery checks structured record changes even if the Markdown SHA is unchanged',async t=>{
 const {root,store}=await fixture(t),{task}=await savedTask(root,store,modes[2]),check=await workflowCheck(root,task);
 const file=join(root,'.local/today',task.articleId,'record.json'),record=JSON.parse(await readFile(file,'utf8'));record.fields.start='2026-10-20';await writeFile(file,JSON.stringify(record));
 await assert.rejects(store.finish(task.id,params(task,check)),/栏目字段或图片已变化/);
 const changed=await workflowCheck(root,task);const ended=await store.finish(task.id,params(task,changed));assert.equal(ended.delivery.sha256,check.sha256);
});

test('delivery rejects unknown or contradictory destinations and a draft outside the current task',async t=>{
 const {root,store}=await fixture(t),task=await store.create({mode:'observation'});
 await assert.rejects(store.finish(task.id,{destination:'external'}),/本地或云端/);
 await assert.rejects(store.finish(task.id,{destination:'local',delivered:true}),/不能使用云端回执/);
 const other=await createDraft({id:'unrelated-work',title:'无关联',markdown:'# 无关联\n\n已保存'},root);
 await assert.rejects(store.finish(task.id,{destination:'local',expectedRevision:task.revision,expectedSha256:other.sha256}),/尚未保存当前稿件/);
 assert.equal((await store.get(task.id)).completedAt,undefined);
});

test('local delivery cannot hide an unresolved cloud submission or management request',async t=>{
 const {root,store}=await fixture(t),{task}=await savedTask(root,store),check=await workflowCheck(root,task),dir=join(root,'.local/today',task.articleId);
 await mkdir(dir,{recursive:true});
 for(const receipt of [{requestKey:'same-request',status:'submit_intent'},{requestKey:'same-request',status:'submitted',job:{status:'queued'}},{requestKey:'same-request',status:'submitted',job:{status:'running'}},{requestKey:'same-request',status:'submitted',job:{status:'success'},publicReadback:false}]){
  await writeFile(join(dir,'receipt.json'),JSON.stringify(receipt));const pending=await workflowCheck(root,task);assert.equal(pending.pendingCloudRequest.requestKey,'same-request');
  await assert.rejects(store.finish(task.id,params(task,check)),/原请求结果尚未确认/);assert.equal((await store.get(task.id)).completedAt,undefined);
 }
 await writeFile(join(dir,'receipt.json'),JSON.stringify({requestKey:'same-request',status:'not_submitted'}));
 await writeFile(join(dir,'cloud-action.json'),JSON.stringify({requestKey:'action-request',status:'unknown'}));
 assert.equal((await workflowCheck(root,task)).pendingCloudRequest.kind,'action');await assert.rejects(store.finish(task.id,params(task,check)),/原请求结果尚未确认/);
 await writeFile(join(dir,'cloud-action.json'),JSON.stringify({requestKey:'action-request',status:'not_submitted',job:{status:'queued'}}));
 assert.equal((await workflowCheck(root,task)).pendingCloudRequest,null);assert.equal((await store.finish(task.id,params(task,check))).delivery.destination,'local');
});
