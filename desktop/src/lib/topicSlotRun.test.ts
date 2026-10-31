import {describe,expect,it} from 'vitest';
import {workflowPrompt} from '../../scripts/agent/workflow.mjs';
import {topicSlotInstructions,validateTopicSlots} from '../../scripts/agent/topic-slots.mjs';
import {defaultTopicBoard} from '../editorial/topicTemplates';

const task=(over:any={}):any=>({id:'t',mode:'xiwen',title:'x',brief:'简介',days:7,articleId:'a',workIds:[],workflow:{authorized:true,sources:'combined'},topicConfirmed:null,outlineConfirmed:null,outline:{blocks:[]},runtime:{},ui:{},revision:1,
 board:{titles:[],sections:[{id:'s',title:'研究',items:[{id:'done',title:'已有',summary:'摘要',url:'https://example.org/x'}],slots:[{id:'done',mode:'smart',prompt:'已填'},{id:'a',mode:'smart',prompt:'方向一'},{id:'b',mode:'smart',prompt:'方向二'},{id:'m',mode:'manual'}]}]},...over});

describe('per-card AI retrieval',()=>{
 it('batch instructions list every empty smart slot',()=>{
  const text=topicSlotInstructions(task());
  expect(text).toContain('"slotId":"a"');expect(text).toContain('"slotId":"b"');expect(text).not.toContain('只处理下面这一个槽位');expect(text).not.toContain('"slotId":"done"');
 });
 it('a targeted run names only that slot and tells the agent to leave the others alone',()=>{
  const text=topicSlotInstructions(task(),'b');
  expect(text).toContain('只处理下面这一个槽位');expect(text).toContain('方向二');expect(text).not.toContain('"slotId":"a"');
  const prompt=workflowPrompt(task(),{action:'topic',target:'b'});
  expect(prompt).toContain('方向二');expect(prompt).not.toContain('"slotId":"a"');
 });
 it('rejects a target that is not an empty smart slot',()=>{
  for(const target of ['done','m','missing'])expect(()=>workflowPrompt(task(),{action:'topic',target})).toThrow('该槽位不是待检索的智能槽位');
  expect(()=>workflowPrompt(task(),{action:'topic'})).not.toThrow();
 });
});

describe('default topic board',()=>{
 it.each(['xiwen','observation','opensource','calendar','history','rss'] as const)('%s board passes the backend slot validation',mode=>{
  const empty={titles:[],sections:[],targetSections:1,targetPerSection:1};
  expect(()=>validateTopicSlots(empty,defaultTopicBoard(mode),{agent:false})).not.toThrow();
 });
});
