import test from 'node:test';
import assert from 'node:assert/strict';
import {applyEditorial, mergeEditorial, readYearCategories, validateItem} from '../scripts/merge-editorial.mjs';

const yearCategories=['节假日','培养节点','学术会议','自然科学基金','人文社科基金','国家科技项目','地方科研项目','人才计划','博士后项目','国际科研机会','学术出版','科研岗位'];
const item=(overrides={})=>({
 id:'year:editor:test:2026-01-01',title:'Test event',category:'学术会议',tags:['学术会议'],
 start:'2026-01-01',end:'2026-01-02',dateBasis:'会期',summary:'A summary',body:'',
 bodyTruncated:false,sourceName:'Example',sourceUrl:'https://example.org/a',
 provenance:'已核验官网',reviewedAt:'2026-09-29',...overrides
});

test('merge is idempotent: a second run adds nothing and keeps the same year array', () => {
 const first=mergeEditorial([], [item()], yearCategories);
 assert.equal(first.added,1);
 assert.equal(first.updated,0);
 const second=mergeEditorial(first.year, [item()], yearCategories);
 assert.equal(second.added,0);
 assert.equal(second.updated,1);
 assert.equal(second.skipped,0);
 assert.equal(second.year.length,1);
 assert.deepEqual(second.year, first.year);
});

test('existing records are replaced by id', () => {
 const existing=item({title:'Old title',summary:'Old summary'});
 const incoming=item({title:'New title',summary:'New summary',end:'2026-01-03'});
 const result=mergeEditorial([existing], [incoming], yearCategories);
 assert.equal(result.added,0);
 assert.equal(result.updated,1);
 assert.equal(result.year.length,1);
 assert.equal(result.year[0].title,'New title');
 assert.equal(result.year[0].end,'2026-01-03');
});

test('duplicate sourceUrl and start are reported and skipped', () => {
 const existing=item({id:'year:existing:2026-01-01'});
 const incoming=item({id:'year:editor:other:2026-01-01',title:'Other copy'});
 const result=mergeEditorial([existing], [incoming], yearCategories);
 assert.equal(result.added,0);
 assert.equal(result.updated,0);
 assert.equal(result.skipped,1);
 assert.equal(result.year.length,1);
 assert.equal(result.year[0].id,existing.id);
 assert.match(result.messages[0],/same sourceUrl and start/);
});

test('invalid items fail field checks and are not merged', () => {
 const base=item();
  const cases=[
  [{...base,extra:'unexpected'},'14 year fields'],
  [Object.fromEntries(Object.entries(base).filter(([key])=>key!=='summary')),'14 year fields'],
  [item({category:'不存在的栏目'}),'yearCategories'],
  [item({start:'2026/01/01'}),'YYYY-MM-DD'],
  [item({end:'14 October 2026'}),'YYYY-MM-DD'],
  [item({sourceUrl:'ftp://example.org/a'}),'http or https'],
  [item({sourceUrl:'not-a-url'}),'http or https']
 ];
 for(const [invalid,expect] of cases){
  const error=validateItem(invalid,yearCategories);
  assert.match(String(error), new RegExp(expect));
  const result=mergeEditorial([], [invalid], yearCategories);
  assert.equal(result.added,0);
  assert.equal(result.skipped,1);
  assert.deepEqual(result.year,[]);
 }
});

test('applyEditorial refreshes year and official counts without rewriting other records', () => {
 const kept=item({id:'year:kept:2026-02-01',start:'2026-02-01',sourceUrl:'https://example.org/kept',provenance:'来源待核验'});
 const data={version:1,counts:{year:1,official:0,history:4},year:[kept],history:[]};
 const incoming=item();
 const result=applyEditorial(data, [incoming], yearCategories);
 assert.equal(result.added,1);
 assert.equal(result.data.counts.year,2);
 assert.equal(result.data.counts.official,1);
 assert.equal(result.data.counts.history,4);
 assert.equal(result.data.year[0],kept);
 assert.equal(data.year.length,1);
});

test('readYearCategories follows the list in app.js', async () => {
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../web/themes/academic/public/app.js',import.meta.url),'utf8');
 assert.deepEqual(readYearCategories(source), yearCategories);
});
