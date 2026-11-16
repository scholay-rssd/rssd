import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWritingDefaultsCatalog,resolveWritingDefaults} from '../contracts/writing-defaults.mjs';
import {normalizeNotebookResult} from '../contracts/notebook-output.mjs';
import publication from '../contracts/rssd-publication.cjs';
import recordContract from '../contracts/rssd-record.cjs';
import {centerWritingPrompt,parseCenterEdition} from '../desktop/scripts/agent/center-producer.mjs';
import {centerRecordContext,recordKindForMode} from '../desktop/scripts/agent/center-record.mjs';

const source={repository:'scholay-rssd/rssd',commit:'a'.repeat(40),files:[{path:'contracts/fixture.mjs',sha256:'b'.repeat(64)}]};
const catalog=buildWritingDefaultsCatalog({source});
const skillsFor=(workspaceId,sectionId)=>{const baseline=resolveWritingDefaults(catalog,workspaceId,sectionId);return {baseline,writingSkills:{skills:baseline.skills,snapshotHash:'c'.repeat(64),defaults:{baseline,baselineHash:baseline.hash,adjustment:{origin:'task',instructions:''}}}};};
const claim=(workspaceId,sectionId,extra={})=>({id:'demand-fixture-1',workspaceId,sectionId,title:'Fixture',payload:{brief:'Synthetic brief'},...extra});
const block=(id,type,text,extra={})=>({id,type,state:'ready',text,sourceIds:['s1'],...extra});
const sources=[{id:'s1',title:'Synthetic official notice',url:'https://example.org/notice',summary:'Fixture source',acquiredVia:'web',reviewed:false}];
const yearNotebook=(overrides={})=>({version:2,kind:'year',title:'合成基金 2027 年申请截止',summary:'合成摘要',skills:[],groups:[],sources,blockNotes:{},internalNotes:{},
 fields:{category:'自然科学基金',start:'2027-03-20',end:null,dateBasis:'申请截止：北京时间 16:00',sourceName:'合成基金委',sourceUrl:'https://example.org/notice',tags:['基金申请']},
 blocks:[block('h1','heading','摘要',{level:2}),block('p1','paragraph','合成基金 2027 年度申请于 3 月 20 日截止。'),block('h2','heading','正文',{level:2}),block('p2','paragraph','申请人应在截止前通过系统提交。')],...overrides});
const historyNotebook=(overrides={})=>({version:2,kind:'history',title:'合成学者发表奠基论文',summary:'合成摘要',skills:[],groups:[],sources,blockNotes:{},internalNotes:{},
 fields:{year:'1922',dateKey:'01-01',domain:'统计学史',eventType:'论文发表',importance:'A',preciseToDay:true},
 blocks:[block('h1','heading','事实摘要',{level:2}),block('p1','paragraph','合成学者的论文于 1922 年 1 月 1 日发表。'),block('h2','heading','学术意义',{level:2}),block('p2','paragraph','这篇论文改变了统计推断的表达方式。')],...overrides});
const articleNotebook=()=>({...yearNotebook(),kind:'article',fields:{}});
const context=(workspaceId,sectionId,extra={})=>{const c=claim(workspaceId,sectionId);return {locale:'zh-CN',sectionId,workspaceId,...centerRecordContext({claim:c,source:undefined,writingSkills:skillsFor(workspaceId,sectionId).writingSkills}),...extra};};

test('calendar and history columns map to their record kinds; translations and other columns do not',()=>{
 assert.equal(recordKindForMode('calendar'),'year');assert.equal(recordKindForMode('history'),'history');assert.equal(recordKindForMode('xiwen'),null);
 for(const [section,kind] of [['calendar','year'],['history','history'],['briefings',undefined],['observations',undefined]]){
  const {writingSkills}=skillsFor('academic',section);
  assert.equal(centerRecordContext({claim:claim('academic',section),writingSkills}).recordKind,kind,section);
  assert.equal(centerRecordContext({claim:claim('academic',section)}).recordKind,kind,section+' without a baseline uses the section catalog');
 }
 const {writingSkills}=skillsFor('academic','calendar');
 assert.deepEqual(centerRecordContext({claim:claim('academic','calendar',{kind:'translate'}),writingSkills}),{});
 assert.deepEqual(centerRecordContext({claim:claim('academic','calendar'),source:{payload:{}},writingSkills}),{});
 assert.equal(centerRecordContext({claim:claim('academic','calendar'),writingSkills}).recordId,'year:center:demand-fixture-1');
});

test('the writing prompt asks calendar and history columns for their record; other prompts are unchanged',()=>{
 const prompt=(workspaceId,sectionId)=>{const {baseline,writingSkills}=skillsFor(workspaceId,sectionId);return centerWritingPrompt({claim:claim(workspaceId,sectionId),locale:'zh-CN',writingPolicy:baseline.writingPolicy,writingSkills});};
 const calendar=prompt('academic','calendar');
 assert.match(calendar,/"kind":"year"/);assert.doesNotMatch(calendar,/"kind":"article"/);
 assert.match(calendar,/自然科学基金/);assert.match(calendar,/“摘要”“正文”/);assert.match(calendar,/不能用公告发布日代替/);
 const history=prompt('academic','history');
 assert.match(history,/"kind":"history"/);assert.match(history,/“事实摘要”“学术意义”/);assert.match(history,/preciseToDay（true）/);
 for(const [w,s] of [['academic','briefings'],['metho','statistics']]){const text=prompt(w,s);assert.match(text,/"kind":"article"/);assert.doesNotMatch(text,/本栏目交付 kind=/);}
});

test('a calendar result becomes a structured year record that passes the publication boundary',()=>{
 const raw=JSON.stringify(yearNotebook());
 assert.equal(normalizeNotebookResult(JSON.parse(raw)).notebook.kind,'year');
 const edition=parseCenterEdition(raw,context('academic','calendar'));
 assert.deepEqual(edition.metadata.record.kind,'year');
 const {fields}=edition.metadata.record;
 assert.equal(fields.id,'year:center:demand-fixture-1');assert.equal(fields.category,'自然科学基金');assert.equal(fields.start,'2027-03-20');assert.equal(fields.end,null);
 assert.equal(fields.provenance,'原文资料','a writer never marks its own record as verified');
 assert.equal(fields.sourceUrl,'https://example.org/notice');assert.deepEqual(fields.tags,['基金申请']);
 const parsed=recordContract.recordFields(edition.metadata.record,edition);
 assert.match(parsed.summary,/3 月 20 日截止/);assert.match(parsed.body,/通过系统提交/);
 const publicMetadata=publication.publicContent({...edition,locale:'zh-CN'}).metadata;
 assert.deepEqual(publicMetadata.record,edition.metadata.record);
});

test('a history result becomes a structured history record with its sources',()=>{
 const edition=parseCenterEdition(JSON.stringify(historyNotebook()),context('academic','history'));
 const {fields}=edition.metadata.record;
 assert.equal(edition.metadata.record.kind,'history');assert.equal(fields.id,'history:center:demand-fixture-1');
 assert.equal(fields.year,1922);assert.equal(fields.dateKey,'01-01');assert.equal(fields.preciseToDay,true);
 assert.deepEqual(fields.sources,[{label:'Synthetic official notice',url:'https://example.org/notice'}]);
 const parsed=recordContract.recordFields(edition.metadata.record,edition);
 assert.match(parsed.factSummary,/1 月 1 日发表/);assert.match(parsed.historicalSignificance,/统计推断/);
});

test('calendar and history columns refuse ordinary articles and incomplete records',()=>{
 assert.throws(()=>parseCenterEdition(JSON.stringify(articleNotebook()),context('academic','calendar')),/需要 year 结构化记录/);
 assert.throws(()=>parseCenterEdition(JSON.stringify(articleNotebook()),context('academic','history')),/需要 history 结构化记录/);
 const missingHeading=yearNotebook({blocks:yearNotebook().blocks.slice(1)});
 assert.throws(()=>parseCenterEdition(JSON.stringify(missingHeading),context('academic','calendar')),/结构化记录：.*heading/);
 const noDate=yearNotebook({fields:{...yearNotebook().fields,start:''}});
 assert.throws(()=>parseCenterEdition(JSON.stringify(noDate),context('academic','calendar')),/结构化记录/);
 const badCategory=yearNotebook({fields:{...yearNotebook().fields,category:'学术新闻'}});
 assert.throws(()=>parseCenterEdition(JSON.stringify(badCategory),context('academic','calendar')),/结构化记录/);
 const approximate=historyNotebook({fields:{...historyNotebook().fields,preciseToDay:false}});
 assert.throws(()=>parseCenterEdition(JSON.stringify(approximate),context('academic','history')),/preciseToDay=true/);
 const impossible=historyNotebook({fields:{...historyNotebook().fields,year:'1923',dateKey:'02-29'}});
 assert.throws(()=>parseCenterEdition(JSON.stringify(impossible),context('academic','history')),/结构化记录/);
});

test('ordinary columns keep articles, and a model cannot attach or forge a record',()=>{
 assert.throws(()=>parseCenterEdition(JSON.stringify(yearNotebook()),context('academic','briefings')),/只接受普通文章/);
 const forged={...articleNotebook(),metadata:{record:{kind:'year',fields:{id:'year:forged'}}}};
 const edition=parseCenterEdition(JSON.stringify(forged),context('academic','briefings'));
 assert.equal(edition.metadata.record,undefined);
 const calendar=parseCenterEdition(JSON.stringify({...yearNotebook(),metadata:{record:{kind:'year',fields:{id:'year:forged'}}}}),context('academic','calendar'));
 assert.equal(calendar.metadata.record.fields.id,'year:center:demand-fixture-1');
});
