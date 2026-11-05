import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {topicSlotInstructions} from '../desktop/scripts/agent/topic-slots.mjs';

test('existing academic material keeps incomplete date evidence across save, reload and AI enrichment',async t=>{
 const root=await mkdtemp(join(tmpdir(),'scholay-existing-record-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new TaskStore(root);let task=await store.create({mode:'history'});
 const item={id:'original',title:'原始文献线索',summary:'史料只注明发表月份，实际日需要核对。',url:'https://example.org/archive',publisher:'原始档案',date:'1986-03',dateBasis:'原档案仅精确到月份',datePrecision:'month',recordId:'history-source-1',recordKind:'history',acquiredVia:'record',locked:true,selected:true,excluded:false};
 const board={titles:[],sections:[{id:'history-section',title:'文献史',slotCount:2,slots:[{id:'original',mode:'manual'},{id:'enrich',mode:'smart',prompt:'根据原档案核对实际发表日与来源，保留已有史料。'}],items:[item]}]};
 task=await store.update(task.id,{board},task.revision);
 const persisted=await new TaskStore(root).get(task.id);assert.deepEqual(persisted.board.sections[0].items[0],item);
 assert.match(topicSlotInstructions(persisted),/1986-03/);assert.match(topicSlotInstructions(persisted),/datePrecision/);
 const next=structuredClone(persisted.board);next.sections[0].items.push({id:'enrich',title:'日期核对结果',summary:'新增来源证据，不覆盖原始资料。',url:'https://example.org/primary-paper',publisher:'出版社',date:'1986-03-21',acquiredVia:'web'});
 const enriched=await store.update(task.id,{board:next},task.revision,{agent:true});assert.deepEqual(enriched.board.sections[0].items[0],item);
 const overwritten=structuredClone(enriched.board);overwritten.sections[0].items[0].date='1986-03-01';overwritten.sections[0].items[0].datePrecision='day';
 await assert.rejects(store.update(task.id,{board:overwritten},enriched.revision,{agent:true}),/已有|手动|锁定/);
 const replaced=structuredClone(enriched.board);replaced.sections[0].items[0].summary='AI替换旧记录';
 await assert.rejects(store.update(task.id,{board:replaced},enriched.revision),/手动/);
});

test('unknown dates remain explicit and invalid record provenance cannot masquerade as a manual source',async t=>{
 const root=await mkdtemp(join(tmpdir(),'scholay-date-evidence-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new TaskStore(root);const task=await store.create({mode:'calendar'});
 const item={id:'manual-record',title:'待核验事项',summary:'原记录没有可核实的起止日期。',url:'https://example.org/notice',publisher:'发布机构',date:'',datePrecision:'unknown',dateBasis:'原记录日期缺失，待核验',recordId:'notice-one',recordKind:'year',acquiredVia:'record',locked:true,selected:true,excluded:false};
 const board={titles:[],sections:[{id:'s',title:'申报事项',slotCount:1,slots:[{id:item.id,mode:'manual'}],items:[item]}]};
 const saved=await store.update(task.id,{board},task.revision);assert.equal(saved.board.sections[0].items[0].date,'');
 for(const change of [{date:'2026-13',datePrecision:'month'},{date:'2026-02-30',datePrecision:'day'},{recordId:''},{dateBasis:''}]){
  const fresh=await store.create({mode:'calendar'});const invalid=structuredClone(board);Object.assign(invalid.sections[0].items[0],change);
  await assert.rejects(store.update(fresh.id,{board:invalid},fresh.revision),/记录|日期/);
 }
 const fresh=await store.create({mode:'calendar'});const fake=structuredClone(board);fake.sections[0].slots[0]={id:item.id,mode:'smart',prompt:'核对事项'};
 await assert.rejects(store.update(fresh.id,{board:fake},fresh.revision,{agent:true}),/记录/);
});

test('a fixed enrichment slot may reuse original record evidence without allowing duplicate news or changed association',async t=>{
 const root=await mkdtemp(join(tmpdir(),'scholay-enrichment-source-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new TaskStore(root);let task=await store.create({mode:'history'});
 const original={id:'old',title:'原始论文',summary:'原资料仅标注月份，需核对日期。',url:'https://example.org/paper',sourceUrls:['https://example.org/archive'],publisher:'出版社',date:'1986-03',datePrecision:'month',dateBasis:'卷期月份，实际日未核验',recordId:'original-history',recordKind:'history',acquiredVia:'record',locked:true,selected:true,excluded:false};
 task=await store.update(task.id,{board:{titles:[],sections:[{id:'s',title:'文献史',slotCount:3,slots:[{id:'old',mode:'manual'},{id:'new',mode:'smart',enrichRecordId:original.recordId,prompt:'核对原论文实际在线日期'},{id:'other',mode:'smart',prompt:'另一独立事件'}],items:[original]}]}},task.revision);
 const board=structuredClone(task.board);board.sections[0].items.push({id:'new',title:'原始论文',summary:'已核对原文的实际日期与卷期差异。',url:original.url,publisher:'出版社',date:'1986-03-21',acquiredVia:'web'});
 const enriched=await store.update(task.id,{board},task.revision,{agent:true});assert.equal(enriched.board.sections[0].items.length,2);
 const duplicate=structuredClone(enriched.board);duplicate.sections[0].items.push({id:'other',title:'转载稿件',summary:'同来源另算新闻',url:'https://example.org/archive',publisher:'另一站',date:'2026-10-05',acquiredVia:'web'});
 await assert.rejects(store.update(task.id,{board:duplicate},enriched.revision,{agent:true}),/同一来源/);
 const changed=structuredClone(enriched.board);changed.sections[0].slots[1].enrichRecordId='other-record';
 await assert.rejects(store.update(task.id,{board:changed},enriched.revision),/固定|同一来源/);
});
