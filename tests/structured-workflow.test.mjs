import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {flowPermission,taskToolPermission,autoConfiguration,workflowPrompt,workflowCheck} from '../desktop/scripts/agent/workflow.mjs';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {createDraft,readDraft,saveDraft} from '../scripts/editorial-workspace.mjs';
const task={mode:'xiwen',articleId:'draft-one',board:{titles:[],sections:[{id:'s',title:'科研',slotCount:1,slots:[{id:'smart',mode:'smart',prompt:'科研资助'}],items:[]}]},outline:{blocks:[]},assets:[],workflow:{authorized:true,sources:'combined'}};
const permission=(title,kind='other',rawInput={})=>({title,kind,rawInput});
test('workflow authorization uses scoped one-time decisions and honors source selection',()=>{
 for(const title of ['scholay-workbench-task_read: task_read','scholay-workbench-draft_save: draft_save','scholay-rss-article_read: article_read'])assert.ok(flowPermission(task,permission(title)));
 for(const title of ['scholay-workbench-cloud_submit: cloud_submit','scholay-workbench-local_manage: local_manage','different-task_read: task_read','scholay-workbench-task_read: draft_save'])assert.equal(flowPermission(task,permission(title)),false);
 assert.equal(flowPermission({...task,workflow:{authorized:false}},permission('scholay-workbench-task_read: task_read')),false);
 assert.equal(flowPermission(task,permission('scholay-workbench-task_read: task_read','execute')),false);
 assert.equal(flowPermission(task,permission('scholay-workbench-task_read: task_read','other',{command:'anything'})),false);
 assert.ok(flowPermission(task,permission('Web search: NASA news','search')));
 assert.ok(flowPermission(task,permission('Fetch https://science.nasa.gov/example','fetch')));
 for(const url of ['http://127.0.0.1/a','https://user:password@example.org','http://169.254.169.254/a','http://10.0.0.1/a','http://host.local/a'])assert.equal(flowPermission(task,permission('Fetch '+url,'fetch')),false);
 assert.equal(flowPermission({...task,workflow:{authorized:true,sources:'rss'}},permission('Fetch https://nasa.gov','fetch')),false);
 assert.equal(flowPermission({...task,workflow:{authorized:true,sources:'web'}},permission('scholay-rss-article_list: article_list')),false);
 const image=permission('Generate Image','other',{_toolName:'GenerateImage'});
 assert.equal(flowPermission(task,image),false);assert.equal(flowPermission({...task,outlineConfirmed:'yes',runtime:{lastAction:{action:'image'}},workflow:{authorized:true,sources:'rss'}},image),false);
 assert.equal(flowPermission(task,permission('scholay-workbench-asset_register: asset_register')),false);
});
test('Auto selection uses actual reported option and never silently substitutes another model',()=>{
 assert.deepEqual(autoConfiguration({configOptions:[{category:'model',id:'model',currentValue:'composer',options:[{options:[{name:'Auto',value:'default[]'}]}]}]}),{id:'model',value:'default[]',current:'composer'});
 assert.throws(()=>autoConfiguration({configOptions:[]}),/Auto/);
});
test('task grants include validated Cursor result reads and expire with authorization or task completion',async t=>{
 const homeDirectory=await mkdtemp(join(tmpdir(),'scholay-cursor-grant-'));t.after(()=>rm(homeDirectory,{recursive:true,force:true}));
 const dir=join(homeDirectory,'.cursor/projects/qa-workspace/agent-tools');await mkdir(dir,{recursive:true});
 const file=join(dir,'44c712a7-aa1b-4d21-91fd-39703aa55c70.txt');await writeFile(file,JSON.stringify({markdown:'source',document:{warnings:[]}}));
 const read=permission('Read File','read',{path:file});
 assert.equal(await taskToolPermission(task,read,{homeDirectory}),true);
 for(const patch of [{workflow:{authorized:false}},{completedAt:'2026-10-05'},{mode:'legacy'},{mode:'unknown'}])assert.equal(await taskToolPermission({...task,...patch},read,{homeDirectory}),false);
 assert.equal(await taskToolPermission(task,permission('scholay-workbench-cloud_submit: cloud_submit'),{homeDirectory}),false);
 assert.equal(await taskToolPermission(task,permission('scholay-workbench-local_manage: local_manage'),{homeDirectory}),false);
 assert.equal(await taskToolPermission(task,permission('execute','execute',{command:'touch /tmp/ungranted'}),{homeDirectory}),false);
 assert.equal(flowPermission({...task,completedAt:'2026-10-05'},permission('scholay-rss-page_read: page_read')),false);
});
test('native public page reads share the scoped source grant without enabling browser execution',()=>{
 for(const name of ['page_list','page_read']){
  const tool=permission(`scholay-rss-${name}: ${name}`);
  assert.equal(flowPermission(task,tool),true);
  assert.equal(flowPermission({...task,workflow:{authorized:true,sources:'web'}},tool),true);
  assert.equal(flowPermission({...task,workflow:{authorized:true,sources:'rss'}},tool),false);
  assert.equal(flowPermission({...task,mode:'image'},tool),false);
  assert.equal(flowPermission(task,{...tool,kind:'execute'}),false);
  assert.equal(flowPermission(task,{...tool,rawInput:{command:'arbitrary browser JS'}}),false);
 }
 assert.equal(flowPermission(task,permission('scholay-rss-page_eval: page_eval')),false);
 assert.equal(flowPermission(task,permission('scholay-rss-page_read: page_list')),false);
});
test('gallery and editorial tasks can read reference manuscripts without granting native writes',()=>{
 for(const mode of ['xiwen','observation','opensource','calendar','history','image']){
  const current={...task,mode};
  for(const server of ['scholay-rss','scholay-today']){
   for(const name of ['draft_list','draft_read','draft_preview'])assert.equal(flowPermission(current,permission(`${server}-${name}: ${name}`)),true);
   for(const name of ['draft_create','draft_save','publication_status'])assert.equal(flowPermission(current,permission(`${server}-${name}: ${name}`)),false);
  }
 }
 assert.equal(flowPermission({...task,mode:'rss'},permission('scholay-rss-draft_read: draft_read')),false);
 assert.equal(flowPermission({...task,mode:'image',workflow:{authorized:false}},permission('scholay-rss-draft_read: draft_read')),false);
});
test('structured actions reject missing authorization, locks and unconfirmed generation',()=>{
 assert.throws(()=>workflowPrompt({...task,workflow:{}},{action:'topic'}),/授权/);
 assert.throws(()=>workflowPrompt(task,{action:'outline'}),/确认选题/);
 assert.throws(()=>workflowPrompt(task,{action:'draft'}),/确认大纲/);
 assert.throws(()=>workflowPrompt(task,{action:'image',target:'other'}),/本地图库/);
 assert.throws(()=>workflowPrompt(task,{action:'item',target:'missing'}),/不存在/);
 assert.throws(()=>workflowPrompt(task,{action:'shell'}),/未知/);
 assert.match(workflowPrompt(task,{action:'topic'}),/本地资料/);
});
test('each current business mode uses structured actions and completed or legacy tasks cannot generate',async t=>{
 const root=await mkdtemp(join(tmpdir(),'scholay-modes-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new TaskStore(root);
 for(const mode of ['xiwen','observation','opensource','calendar','history','rss']){
  let current=await store.create({mode});
  current=await store.workflow(current.id,{action:'configure',authorized:true,sources:'combined',expectedRevision:current.revision});
  current=await store.update(current.id,{board:{...current.board,sections:structuredClone(task.board.sections)}},current.revision);
  const prompt=workflowPrompt(current,{action:'topic'});
  assert.match(prompt,/task_update 保存 board/);assert.match(prompt,/不操作云端/);
  assert.equal(current.board.targetSections,mode==='xiwen'?3:1);
  assert.equal(current.board.targetPerSection,1);
  await store.finish(current.id);assert.throws(()=>workflowPrompt({...current,completedAt:'2026-10-04'},{action:'topic'}),/已结束/);
 }
 assert.throws(()=>workflowPrompt({...task,mode:'legacy'},{action:'topic'}),/已结束/);
});
test('review tracks actual body and image bytes; source changes invalidate confirmed stages',async t=>{
 const root=await mkdtemp(join(tmpdir(),'scholay-flow-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'_ops/inventory'),{recursive:true});await mkdir(join(root,'articles'));await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:['学界犀闻']}));
 const store=new TaskStore(root);let v=await store.create({mode:'xiwen',brief:'scope'});v=await store.workflow(v.id,{action:'configure',sources:'combined',authorized:true,expectedRevision:v.revision});
 const board={titles:['test'],sections:[{id:'s',title:'test',items:[{id:'n',title:'news',summary:'fact',url:'https://example.org',date:'2026-10-04',publisher:'test'}]}]};
 v=await store.update(v.id,{board},v.revision);v=await store.confirm(v.id,'topic',v.revision);v=await store.update(v.id,{outline:{blocks:[{id:'b',type:'paragraph',text:'test'}]}},v.revision);v=await store.confirm(v.id,'outline',v.revision);
 const d=await createDraft({id:v.articleId,title:'test',column:'学界犀闻',markdown:'# Test\n\n'+('真实测试正文。'.repeat(30))+'\n\n[来源](https://example.org)\n\n![a](a.png)\n\n![b](b.png)'},root);
 const dir=dirname(join(root,d.canonicalPath));const bytes=await sharp({create:{width:30,height:30,channels:3,background:'red'}}).png().toBuffer();await writeFile(join(dir,'a.png'),bytes);await writeFile(join(dir,'b.png'),bytes);
 const before=await workflowCheck(root,v);assert.equal(before.ready,true);assert.equal(before.reviewed,false);
 v=await store.workflow(v.id,{action:'review',expectedRevision:v.revision,fingerprint:before.fingerprint});assert.equal((await workflowCheck(root,v)).reviewed,true);
 await writeFile(join(dir,'a.png'),await sharp(bytes).tint('blue').png().toBuffer());assert.equal((await workflowCheck(root,v)).reviewed,false);
 await assert.rejects(store.workflow(v.id,{action:'review',expectedRevision:v.revision,fingerprint:before.fingerprint}),/变化/);
 const current=await readDraft(v.articleId,root);await saveDraft({id:v.articleId,expectedSha256:current.sha256,markdown:current.markdown+'\nEdited'},root);assert.notEqual((await workflowCheck(root,v)).fingerprint,before.fingerprint);
 const edited=await readDraft(v.articleId,root);await saveDraft({id:v.articleId,expectedSha256:edited.sha256,markdown:'# '+('只有标题'.repeat(30))+'\n\n[来源](https://example.org/'+('long-path/'.repeat(30))+')\n\n![a](a.png)\n\n![b](b.png)'},root);
 assert.equal((await workflowCheck(root,v)).checks.find(c=>c.key==='body').ok,false,'headings, URLs and image paths are not body prose');
 v=await store.workflow(v.id,{action:'configure',sources:'rss',authorized:true,expectedRevision:v.revision});assert.equal(v.topicConfirmed,null);assert.equal(v.outlineConfirmed,null);assert.equal(v.workflow.review,null);
 await assert.rejects(store.workflow(v.id,{action:'configure',sources:'web',authorized:true,expectedRevision:1}),/新版/);
});

test('every literal frontend task operation is allowed by the native host boundary',async()=>{
 const {readFile}=await import('node:fs/promises');
 const host=await readFile(new URL('../desktop/src-tauri/src/cursor_agent.rs',import.meta.url),'utf8');
 const allowed=host.match(/if !\[(.*?)\]\.contains/s)[1];
 for(const file of ['StructuredWorkflow.tsx','ContentWorkspace.tsx','TaskCanvas.tsx']){
  const source=await readFile(new URL('../desktop/src/editorial/'+file,import.meta.url),'utf8');
  for(const match of source.matchAll(/taskCall(?:<[^\n]*?>)?\('(task_[a-z_]+)'/g))assert.ok(allowed.includes('"'+match[1]+'"'),`Native host must support ${file}: ${match[1]}`);
 }
 assert.ok(host.indexOf('require_main(&webview)?')<host.indexOf('if !['),'remote webviews must remain excluded');
});
