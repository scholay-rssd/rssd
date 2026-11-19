import test from 'node:test';
import assert from 'node:assert/strict';
import protocol from '../contracts/rssd-v1.cjs';
import {CHOSEN_WORK_TYPES} from '../contracts/work-types.mjs';

const base={workspaceId:'pets',sectionId:'daily-cat',title:'缅因猫：起源、特征与饲养要点'};

test('a demand asks for the same work types a writer may choose',()=>{
 assert.deepEqual(protocol.DEMAND_WORK_TYPES,[...CHOSEN_WORK_TYPES]);
});
test('a demand that states no type, source article or topic key is what it always was',()=>{
 assert.deepEqual(Object.keys(protocol.demand({...base,id:'d1'})),['id','workspaceId','sectionId','kind','title','brief','requiredLocales','source','priority']);
 assert.equal(protocol.hash(protocol.demand({...base,id:'d1'})),protocol.hash(protocol.demand({...base,id:'d1',workType:null,adaptedFrom:null,topicKey:null})));
});
test('a write demand may state its work type, the article a note is rewritten from and a topic key',()=>{
 const note=protocol.demand({...base,workType:'note',adaptedFrom:{workId:'work-1',revision:3,extra:'dropped'},topicKey:'maine-coon'});
 assert.equal(note.workType,'note');assert.deepEqual(note.adaptedFrom,{workId:'work-1',revision:3});assert.equal(note.topicKey,'maine-coon');
 assert.equal(protocol.demand({...base,workType:'article'}).workType,'article');
 // A stored payload validates to itself, as the scheduler's receipt check requires.
 assert.deepEqual(protocol.demand(note),note);
});
test('a demand refuses an unknown type, a source article without a note, and a type on a translation',()=>{
 assert.throws(()=>protocol.demand({...base,workType:'video'}),/Invalid work type/);
 assert.throws(()=>protocol.demand({...base,adaptedFrom:{workId:'work-1',revision:1}}),/Only a note/);
 assert.throws(()=>protocol.demand({...base,workType:'article',adaptedFrom:{workId:'work-1',revision:1}}),/Only a note/);
 assert.throws(()=>protocol.demand({...base,workType:'note',adaptedFrom:{workId:'work-1',revision:0}}),/adaptedFrom.revision/);
 assert.throws(()=>protocol.demand({...base,kind:'translate',source:{workId:'work-1',locale:'zh-CN',revision:1},workType:'note'}),/Only a write demand/);
 assert.throws(()=>protocol.demand({...base,topicKey:'x'.repeat(201)}),/topicKey/);
});
test('a write demand may record the lead that prompted its topic',()=>{
 const lead={provider:'tikhub',platformId:'douyin',term:'猫咪换毛季',observedAt:'2026-11-19T09:00:00+08:00',url:'https://www.douyin.com/hot/1',rank:3};
 assert.deepEqual(protocol.demand({...base,lead}).lead,{provider:'tikhub',platformId:'douyin',term:'猫咪换毛季',observedAt:'2026-11-19T01:00:00.000Z',url:'https://www.douyin.com/hot/1'});
 assert.deepEqual(protocol.demand({...base,lead:{provider:'editor',term:'读者来信',observedAt:'2026-11-19'}}).lead,{provider:'editor',term:'读者来信',observedAt:'2026-11-19T00:00:00.000Z'});
 assert.throws(()=>protocol.demand({...base,lead:{provider:'tikhub',term:'x',observedAt:'soon'}}),/lead.observedAt/);
 assert.throws(()=>protocol.demand({...base,lead:{provider:'tikhub',term:'x',observedAt:'2026-11-19',url:'javascript:alert(1)'}}),/lead.url/);
 assert.throws(()=>protocol.demand({...base,kind:'update',source:{workId:'work-1',locale:'zh-CN',revision:1},lead:{provider:'tikhub',term:'x',observedAt:'2026-11-19'}}),/Only a write demand records a lead/);
});
