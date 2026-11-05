import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profiles,publicationDirectory} from '../scripts/site-config.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';
import {validateNews} from '../admin/news.mjs';
import {adaptPublishedSnapshot} from '../web/engine/published-content.mjs';
import {organizeContent} from '../web/engine/site-organization.mjs';
import {writingCatalog} from '../desktop/scripts/agent/writing-skill-catalog.mjs';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {openNotebook,exportNotebook,reloadNotebookDraft,beginNotebookPrompt} from '../desktop/scripts/agent/notebook-store.mjs';
import {scopedTools} from '../desktop/scripts/agent/session-state.mjs';
import {flowPermission} from '../desktop/scripts/agent/workflow.mjs';
import {tools,createAgentTools} from '../desktop/scripts/agent/tools.mjs';
import {readDraft} from '../scripts/editorial-workspace.mjs';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';
const prose={id:'content-protocol-test',title:'具体问题',summary:'具体回答',markdown:'# 具体问题\n\n具体回答。',date:'2026-10-15',category:'旧分类',author:'编辑',assets:[]};
for(const site of profiles)test(site.id+' preserves explicit public sections independently of legacy category',async()=>{
 const organization=JSON.parse(await readFile(new URL('../sites/organization/'+site.id+'.json',import.meta.url),'utf8'));
 for(const section of sectionsForSite(site)){
  const article=validateNews({...prose,sectionId:section.id},null,site);
  const content=organizeContent(adaptPublishedSnapshot({news:[article]},site),organization);
  assert.equal(content.records[0].collectionId,section.id);
  assert.equal(content.records[0].bodyMarkdown,prose.markdown);
 }
 assert.throws(()=>validateNews({...prose,sectionId:'wrong-space-section'},null,site),/当前站点/);
 assert.equal(Object.hasOwn(validateNews(prose,null,site),'sectionId'),false);
});
test('block patch avoids skill roundtrips while retaining scope, locks, versions and revision conflicts',async t=>{
 const {root,store}=await fixture(t),dir=join(root,'.agents/skills/precise-writing');await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'SKILL.md'),'---\nname: precise-writing\ndescription: 写作规则\nversion: 1\n---\n只写具体的操作结果。');
 const mounted=(await writingCatalog(root)).skills[0];
 let task=await openNotebook(store,(await store.create({mode:'observation'})).id);
 const target=task.notebook.blocks[0].id;
 task=await store.update(task.id,{notebook:{...task.notebook,title:'区分结果',mounts:{...task.notebook.mounts,skills:[mounted]},blocks:[...task.notebook.blocks,{id:'protected-row',type:'paragraph',text:'作者原文',state:'ready',sourceIds:[],locked:true}]}},task.revision);
 task=await beginNotebookPrompt(store,task.id,{action:'fill',targetIds:[target],expectedRevision:task.revision});
 const exposed=scopedTools(tools,task.id,task.mode,true).find(t=>t.name==='notebook_patch');
 assert.ok(exposed);assert.ok(exposed.inputSchema.required.includes('runId'));
 assert.equal(scopedTools(tools,task.id,task.mode,false).some(t=>t.name==='notebook_patch'),false);
 assert.equal(flowPermission(task,{title:'scholay-workbench-notebook_patch: notebook_patch'}),true);
 assert.equal(flowPermission({...task,completedAt:new Date().toISOString()},{title:'scholay-workbench-notebook_patch: notebook_patch'}),false);
 const call=createAgentTools({root,taskId:task.id,taskStore:store,approve:()=>false});
 let view=await call('task_read');
 assert.equal(view.notebook.mounts.skills[0].content,undefined);
 const result=await call('notebook_patch',{expectedRevision:view.revision,updates:[{id:target,text:'正文已补齐。',state:'ready'}]});
 assert.equal(result.updatedBlocks.length,1);
 let current=await store.get(task.id);
 assert.deepEqual(current.notebook.mounts.skills,[mounted]);
 assert.equal(current.notebook.blocks[1].text,'作者原文');
 await assert.rejects(call('notebook_patch',{expectedRevision:view.revision,updates:[{id:target,text:'过期覆盖'}]}),/CONFLICT/);
 await assert.rejects(call('notebook_patch',{expectedRevision:current.revision,updates:[{id:'protected-row',text:'越界'}]}),/锁定/);
 await assert.rejects(call('notebook_patch',{expectedRevision:current.revision,updates:[{id:'missing',text:'新增'}]}),/已有文字/);
 view=await call('task_read');
 // Existing clients can send a compact full notebook without copying skill text.
 await call('task_update',{expectedRevision:view.revision,notebook:view.notebook});
 current=await store.get(task.id);assert.deepEqual(current.notebook.mounts.skills,[mounted]);
 await assert.rejects(call('task_update',{expectedRevision:current.revision,notebook:{mounts:{...current.notebook.mounts,skills:[]}}}),/用户挂载/);
});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'today-production-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'_ops/inventory'),{recursive:true});await mkdir(join(root,'articles'));await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:[]}));return {root,store:new TaskStore(root)};}
test('mounted workspace skill keeps its exact version across edits, export and reopen; agent cannot move section',async t=>{
 const {root,store}=await fixture(t),dir=join(root,'.agents/skills/precise-writing');await mkdir(dir,{recursive:true});
 const skill='---\nname: precise-writing\ndescription: 写具体问题\nversion: 1\n---\n保留来源并说明操作结果。\n';await writeFile(join(dir,'SKILL.md'),skill);
 const mounted=(await writingCatalog(root)).skills[0];assert.equal(mounted.content,skill);
 let a=await openNotebook(store,(await store.create({mode:'observation'})).id);
 a=await store.update(a.id,{notebook:{...a.notebook,title:'面向读者的问题',sectionId:'resources',mounts:{...a.notebook.mounts,skills:[mounted]},blocks:[{...a.notebook.blocks[0],text:'实用的操作说明。',state:'ready'}]}},a.revision);
 await writeFile(join(dir,'SKILL.md'),skill.replace('version: 1','version: 2'));
 await assert.rejects(store.update(a.id,{notebook:{...a.notebook,sectionId:'briefings'}},a.revision,{agent:true}),/栏目由作者/);
 a=await store.update(a.id,{notebook:{...a.notebook,title:'更新后的具体问题'}},a.revision);
 assert.equal(a.notebook.mounts.skills[0].version,'1');
 const saved=await exportNotebook(store,a.id,a.revision),draft=await readDraft(a.articleId,root);
 assert.equal(draft.sectionId,'resources');
 const client=createWebsitePublisher({root,fetcher:()=>{throw Error('Local read must not use network');}});
 assert.equal((await client.inspect(a.articleId)).metadata.sectionId,'resources');
 const reopened=await reloadNotebookDraft(store,a.id,saved.revision,{reopen:true});
 assert.deepEqual(reopened.notebook.mounts.skills,[mounted]);assert.equal(reopened.notebook.sectionId,'resources');
 const sidecar=JSON.parse(await readFile(join(publicationDirectory(root),a.articleId,'notebook.json'),'utf8'));assert.equal(sidecar.document.mounts.skills[0].contentHash,mounted.contentHash);
});
