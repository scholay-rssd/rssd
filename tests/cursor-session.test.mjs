import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Conversations,attachmentBlocks,configurationRestoration,assertRunScope,scopedTools} from '../desktop/scripts/agent/session-state.mjs';
import {createAgentTools} from '../desktop/scripts/agent/tools.mjs';
import {createDraft,readDraft,saveDraft} from '../scripts/editorial-workspace.mjs';
test('new conversation preserves previous history and variants; rejects directory escape',async()=>{const root=await mkdtemp(join(tmpdir(),'scholay-session-'));try{const c=new Conversations(root);await c.save({sessionId:'old',history:[{role:'user',text:'选题'}],configuration:{model:'variant'}});await c.save({sessionId:'new',history:[]});assert.equal((await c.list()).length,2);assert.equal((await c.load('old')).history[0].text,'选题');assert.equal((await c.current()).sessionId,'new');await assert.rejects(c.load('../../secret'));}finally{await rm(root,{recursive:true,force:true});}});
test('attachments obey real capability and payload limits',()=>{assert.throws(()=>attachmentBlocks([{type:'image',mimeType:'image/png',data:'eA=='}],{}));assert.throws(()=>attachmentBlocks(Array(7).fill({type:'text',text:'a'}),{}));assert.throws(()=>attachmentBlocks([{type:'image',mimeType:'image/svg+xml',data:'eA=='}],{promptCapabilities:{image:true}}));assert.equal(attachmentBlocks([{type:'text',text:'source',name:'来源.md'}],{})[0].type,'text');});
test('manuscript tool emits exact before and after diff; concurrent edits prevent stale undo',async()=>{const root=await mkdtemp(join(tmpdir(),'scholay-review-'));try{await mkdir(join(root,'_ops/inventory'),{recursive:true});await mkdir(join(root,'articles'));await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:['新闻聚合']}));await createDraft({id:'qa-review',title:'QA',markdown:'# Old'},root);const events=[];const tool=createAgentTools({root,approve:async()=>false,emit:e=>events.push(e)});const before=await readDraft('qa-review',root);await tool('draft_save',{id:'qa-review',markdown:'# New',expectedSha256:before.sha256});const change=events.find(e=>e.type==='file_change').change;assert.equal(change.oldText,'# Old');assert.equal(change.newText,'# New');await saveDraft({id:'qa-review',markdown:'# Human edit',expectedSha256:change.sha256},root);await assert.rejects(saveDraft({id:'qa-review',markdown:change.oldText,expectedSha256:change.sha256},root));assert.equal((await readDraft('qa-review',root)).markdown,'# Human edit');}finally{await rm(root,{recursive:true,force:true});}});

test('a task restores its own model after another ACP process changes the global default',()=>{
  const available=[{id:'model',category:'model',currentValue:'b',options:[{value:'a'},{value:'b'}]},{id:'mode',category:'mode',currentValue:'agent',options:[{value:'agent'},{value:'plan'}]}];
  assert.deepEqual(configurationRestoration({configOptions:[{id:'model',currentValue:'a'}]},{configOptions:available}),[{id:'model',value:'a',category:'model'}]);
  assert.deepEqual(configurationRestoration({configOptions:[{id:'model',currentValue:'b'}]},{configOptions:available}),[]);
  assert.deepEqual(configurationRestoration({configOptions:[{id:'model',currentValue:'retired'}]},{configOptions:available}),[]);
});

test('a late MCP call cannot enter a different task or a newer run',()=>{
 assert.doesNotThrow(()=>assertRunScope({taskId:'a',runId:'run-new'},'a','run-new'));
 assert.throws(()=>assertRunScope({taskId:'a',runId:'run-old'},'a','run-new'),/没有执行/);
 assert.throws(()=>assertRunScope({taskId:'b',runId:'run-new'},'a','run-new'),/没有执行/);
 assert.throws(()=>assertRunScope({},'a','run-new'));
 const list=scopedTools([{inputSchema:{properties:{},required:[]}}],'a');assert.deepEqual(list[0].inputSchema.required,['taskId','runId']);
});

test('each business mode advertises only tools for its operation surface',()=>{
 const tools=['task_read','task_update','task_topic_progress','asset_register','draft_read','draft_create','draft_save','draft_preview','works_list','cloud_submit'].map(name=>({name,inputSchema:{properties:{},required:[]}}));
 assert.deepEqual(scopedTools(tools,'id','image').map(t=>t.name),['task_read','asset_register']);
 assert.deepEqual(scopedTools(tools,'id','rss').map(t=>t.name),['task_read','task_update','task_topic_progress']);
 for(const mode of ['xiwen','observation','opensource','calendar','history'])assert.deepEqual(scopedTools(tools,'id',mode).map(t=>t.name),['task_read','task_update','task_topic_progress','draft_read','draft_create','draft_save','draft_preview']);
});

test('the installed Unix CLI runtime preserves the first ACP line and paths with spaces',{skip:process.platform==='win32'},async()=>{
 const {unixCursorCommand}=await import('../desktop/scripts/runtime/cursor-command.mjs');
 const {symlink,realpath}=await import('node:fs/promises');const {spawn}=await import('node:child_process');
 const root=await mkdtemp(join(tmpdir(),'scholay cursor '));
 try{
  const launcher=join(root,'cursor-agent');await writeFile(launcher,'#!/bin/sh\nexit 99\n');
  await symlink(process.execPath,join(root,'node'));
  await writeFile(join(root,'index.js'),"process.stdin.once('data',x=>{process.stdout.write(x);process.exit(0)})");
  const launch=unixCursorCommand(launcher,['acp']);assert.equal(launch.command,join(await realpath(root),'node'));
  const line=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})+'\n';
  const child=spawn(launch.command,launch.args,{stdio:['pipe','pipe','ignore']});let output='';child.stdout.on('data',b=>output+=b);
  const exited=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)});child.stdin.end(line);
  assert.equal(await exited,0);assert.equal(output,line);
 }finally{await rm(root,{recursive:true,force:true});}
});
