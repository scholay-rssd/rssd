import {describe,expect,it} from 'vitest';
import {SCHOLAY_TODAY,destinationUse,destinationRecord,draftPlacement,useOptions,typeOfColumn} from '../../scripts/agent/destinations.mjs';
import {TASK_TYPES,TASK_TYPE_IDS} from '../../scripts/agent/task-types.mjs';
import {RECORD_STRUCTURE} from '../../../scripts/editorial-record.mjs';
import {archiveCategories} from '../../../scripts/archive-taxonomy.mjs';
import {scopedTools} from '../../scripts/agent/session-state.mjs';
import {tools} from '../../scripts/agent/tools.mjs';
import {workflowPrompt} from '../../scripts/agent/workflow.mjs';

const COLUMNS=['学界犀闻','学者观察','昔日学术','学术情报','学术开源'];
describe('Scholay Today destination profile',()=>{
 it('has a place for every content type and names only columns the website knows',()=>{
  expect(Object.keys(SCHOLAY_TODAY.uses).sort()).toEqual([...TASK_TYPE_IDS].sort());
  for(const id of TASK_TYPE_IDS)expect(archiveCategories).toContain(destinationUse(id)!.column);
  expect(destinationUse('rss')).toBeNull();expect(destinationUse('constructor')).toBeNull();
 });
 it('binds exactly the structured types to the website record whose column matches',()=>{
  for(const id of TASK_TYPE_IDS){
   const use=destinationUse(id)!,record=destinationRecord(id);
   expect(!!record,id).toBe(!!TASK_TYPES[id].structured);expect(!!use.record,id).toBe(!!TASK_TYPES[id].structured);
   if(record)expect(RECORD_STRUCTURE[record.kind as keyof typeof RECORD_STRUCTURE].category).toBe(use.column);
  }
  expect(TASK_TYPE_IDS.map(id=>destinationRecord(id)?.kind||null)).toEqual([null,null,'openSource','year','history']);
 });
 it('resolves placement from the type alone and requires fields only for structured types',()=>{
  expect(draftPlacement('xiwen',undefined)).toEqual({column:'学界犀闻',archiveCategory:'学界犀闻',type:'xiwen'});
  expect(draftPlacement('observation',{ignored:true})).toEqual({column:'学者观察',archiveCategory:'学者观察',type:'observation'});
  expect(draftPlacement('calendar',{start:'2026-11-01'})).toEqual({column:'学术情报',archiveCategory:'学术情报',type:'calendar',record:{kind:'year',fields:{start:'2026-11-01'}}});
  expect(()=>draftPlacement('history',undefined)).toThrow('结构化稿件需要');expect(()=>draftPlacement('opensource',[])).toThrow('结构化稿件需要');
  expect(()=>draftPlacement('rss',{})).toThrow('没有这一类内容的位置');
 });
 it('keeps the acceptance checks of the notice and history records',()=>{
  expect(()=>destinationRecord('calendar')!.verify!({provenance:'待核验'})).toThrow('事项来源尚未核验');
  expect(()=>destinationRecord('calendar')!.verify!({provenance:'已核验官网'})).not.toThrow();
  expect(()=>destinationRecord('history')!.verify!({year:1915,dateKey:'11-25',preciseToDay:true})).not.toThrow();
  for(const fields of [{year:1915,dateKey:'11-25',preciseToDay:false},{year:1915,dateKey:'02-30',preciseToDay:true}])expect(()=>destinationRecord('history')!.verify!(fields)).toThrow('完整发生日期');
 });
});

describe('use of a finished post',()=>{
 it('proposes the type\'s column first, lets a free-form post go elsewhere and keeps a structured one bound',()=>{
  expect(useOptions('xiwen')).toEqual(['学界犀闻','学者观察','学术开源','学术情报','昔日学术']);
  expect(useOptions('observation')[0]).toBe('学者观察');expect(useOptions('observation')).toHaveLength(5);
  expect(useOptions('calendar')).toEqual(['学术情报']);expect(useOptions('history')).toEqual(['昔日学术']);expect(useOptions('opensource')).toEqual(['学术开源']);
  expect(useOptions('rss')).toEqual([]);expect(useOptions('image')).toEqual([]);
 });
 it('maps each column back to the type it receives by default',()=>{
  for(const id of TASK_TYPE_IDS)expect(typeOfColumn(destinationUse(id)!.column)).toBe(id);
  expect(typeOfColumn('新闻聚合')).toBeNull();expect(typeOfColumn('')).toBeNull();
 });
});

describe('the engine does not let the agent choose a column',()=>{
 const schema=(mode:string)=>scopedTools(tools,'t',mode).find((t:any)=>t.name==='draft_create')!.inputSchema;
 it.each(TASK_TYPE_IDS)('%s is offered a draft_create without column, archive category or record kind',mode=>{
  const {properties,required}=schema(mode),structured=!!TASK_TYPES[mode].structured;
  expect(Object.keys(properties).sort()).toEqual(['id','markdown','runId','taskId','title',...(structured?['fields']:[])].sort());
  expect(required.includes('fields')).toBe(structured);
  expect(JSON.stringify(schema(mode))).not.toMatch(/column|archiveCategory|"kind"|学/);
 });
 it.each(TASK_TYPE_IDS)('%s prompt names the task type, not a website column or record kind',mode=>{
  const task:any={id:'t',mode,title:'x',brief:'简介',days:7,articleId:'a',workIds:[],workflow:{authorized:true,sources:'combined'},topicConfirmed:null,outlineConfirmed:null,outline:{blocks:[]},runtime:{},ui:{},revision:1,board:{titles:[],sections:[{id:'s',title:'研究',slotCount:1,slots:[{id:'a',mode:'smart',prompt:'方向一'}],items:[]}]}};
  const prompt=workflowPrompt(task,{action:'topic'});
  expect(prompt).toContain('当前任务类型：'+TASK_TYPES[mode].name);
  for(const column of COLUMNS)expect(prompt).not.toContain(column);
  expect(prompt).not.toMatch(/record\.kind|archiveCategory|annexColumns/);
  if(TASK_TYPES[mode].structured){expect(prompt).toContain('draft_create 的 fields 完整保留 '+destinationRecord(mode)!.fields);expect(prompt).toContain(TASK_TYPES[mode].rules);}
 });
});
