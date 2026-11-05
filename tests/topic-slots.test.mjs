import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {workflowPrompt} from '../desktop/scripts/agent/workflow.mjs';
const news=id=>({id,title:'新闻'+id,summary:'真实来源摘要',url:'https://example.org/'+id,publisher:'研究机构',date:'2026-10-04'});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'topic-slots-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=new TaskStore(root);let task=await store.create({mode:'xiwen'});task=await store.update(task.id,{board:{titles:[],sections:[{id:'s',title:'资助政策',slotCount:3,slots:[{id:'manual',mode:'manual'},{id:'smart',mode:'smart',prompt:'近期机构资助新规'},{id:'empty'}],items:[{...news('manual'),date:'',dateBasis:'RSS 未提供发布日期',acquiredVia:'rss',rssId:'42',locked:true,selected:true,excluded:false}]}]}},task.revision);return {store,task};}
test('manual RSS provenance, slot mode and direction survive reload and cannot be replaced',async t=>{
 const {store,task}=await fixture(t);assert.deepEqual((await store.get(task.id)).board,task.board);
 for(const mutate of [b=>b.sections[0].slots[0].mode='smart',b=>b.sections[0].slots[1].prompt='另一方向',b=>b.sections[0].items[0].title='替换',b=>b.sections[0].items[0].locked=false]){const board=structuredClone(task.board);mutate(board);await assert.rejects(store.update(task.id,{board},task.revision),/固定|手动|方向|日期/);}
 const board=structuredClone(task.board);board.sections[0].items[0].selected=false;board.sections[0].items[0].excluded=true;
 const updated=await store.update(task.id,{board},task.revision);assert.equal(updated.board.sections[0].items[0].locked,true);
});
test('agent fills only the assigned empty smart slot, with version and layout protection',async t=>{
 const {store,task}=await fixture(t);const board=structuredClone(task.board);board.sections[0].items.push(news('smart'));
 const updated=await store.update(task.id,{board},task.revision,{agent:true});assert.equal(updated.board.sections[0].items[1].selected,false);
 await assert.rejects(store.update(task.id,{board},task.revision,{agent:true}),/CONFLICT/);
 for(const mutate of [b=>b.sections[0].items.push(news('empty')),b=>b.sections[0].title='改名',b=>b.sections[0].slots.pop(),b=>b.sections[0].items[0].summary='覆盖',b=>b.sections[0].items[1].summary='覆盖']){const next=structuredClone(updated.board);mutate(next);await assert.rejects(store.update(task.id,{board:next},updated.revision,{agent:true}));}
});
test('deleting a configured slot removes it permanently and stale results cannot refill it',async t=>{
 const {store,task}=await fixture(t);const board=structuredClone(task.board);board.sections[0].slots=board.sections[0].slots.filter(s=>s.id!=='smart');board.sections[0].slotCount=2;
 const updated=await store.update(task.id,{board},task.revision);const stale=structuredClone(updated.board);stale.sections[0].items.push(news('smart'));await assert.rejects(store.update(task.id,{board:stale},updated.revision,{agent:true}),/对应槽位/);
});
test('prompt includes section, direction and existing materials, rejects collection without a smart slot',async t=>{
 const {task}=await fixture(t);const ready={...task,workflow:{authorized:true,sources:'combined'}};const prompt=workflowPrompt(ready,{action:'topic'});
 for(const expected of ['资助政策','近期机构资助新规','新闻manual','item.id 必须等于 slot.id','本地资料'])assert.ok(prompt.includes(expected));
 const empty={...ready,board:{titles:[],sections:[]}};assert.throws(()=>workflowPrompt(empty,{action:'topic'}),/智能采集方向/);
});

test('confirmation rejects missing AI material even when manual material is selected',async t=>{
 const {store,task}=await fixture(t);await assert.rejects(store.confirm(task.id,'topic',task.revision),/AI 素材/);
 const board=structuredClone(task.board);board.sections[0].items.push(news('smart'));
 const filled=await store.update(task.id,{board},task.revision,{agent:true});const confirmed=await store.confirm(task.id,'topic',filled.revision);assert.ok(confirmed.topicConfirmed);
});
test('manual re-added material in dismissed never prevents an unchanged board or new AI slot save',async t=>{
 const {store,task}=await fixture(t);const board=structuredClone(task.board);board.dismissed=[board.sections[0].items[0].url,board.sections[0].items[0].title];
 const manual=await store.update(task.id,{board},task.revision);
 const unchanged=await store.update(task.id,{board:manual.board},manual.revision,{agent:true});
 const rejected=structuredClone(unchanged.board);rejected.sections[0].items.push({...news('smart'),url:manual.board.dismissed[0]});
 await assert.rejects(store.update(task.id,{board:rejected},unchanged.revision,{agent:true}),/不能重新加入/);
 const next=structuredClone(unchanged.board);next.sections[0].items.push(news('smart'));
 const saved=await store.update(task.id,{board:next},unchanged.revision,{agent:true});assert.equal(saved.board.sections[0].items.length,2);
});
test('sequential collection exposes one active card, saves it, then allows the next; gaps are explicit',async t=>{
 const {store,task}=await fixture(t);let board=structuredClone(task.board);board.sections[0].slots[2]={id:'second',mode:'smart',prompt:'新的学术事件'};
 let v=await store.update(task.id,{board},task.revision);await store.runtime(v.id,{collection:{smart:{status:'queued'},second:{status:'queued'}}});
 await assert.rejects(store.collectionProgress(v.id,{slotId:'second',status:'searching'}),/顺序/);
 await store.collectionProgress(v.id,{slotId:'smart',status:'searching'});await assert.rejects(store.collectionProgress(v.id,{slotId:'second',status:'searching'}),/当前槽位/);
 board=structuredClone(v.board);board.sections[0].items.push(news('smart'));v=await store.update(v.id,{board},v.revision,{agent:true});assert.equal(v.runtime.collection.smart.status,'complete');
 v=await store.collectionProgress(v.id,{slotId:'second',status:'searching'});assert.equal(v.runtime.collection.second.status,'searching');
 v=await store.collectionProgress(v.id,{slotId:'second',status:'missing',detail:'未找到近一周机构原文'});assert.equal(v.runtime.collection.second.status,'missing');assert.ok(v.runtime.collection.second.detail);
});
