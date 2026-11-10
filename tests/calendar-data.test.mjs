import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeCalendarData} from '../web/themes/academic/calendar-data.mjs';
import {createCalendarLoader} from '../web/themes/academic/public/calendar-data.js';

const url=letter=>'/calendar-data/'+letter.repeat(64)+'.json';
const first={version:1,year:url('a'),history:url('b')};
function server(files){
 const calls=[];
 const loader=createCalendarLoader(async path=>{
  calls.push(path);const value=files[path];
  if(value instanceof Error)throw value;
  return {ok:value!==undefined,status:value===undefined?404:200,json:async()=>structuredClone(value)};
 });
 return {loader,calls};
}
test('calendar lists exclude bodies/assets, preserve search fields, and link sanitized complete records',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'calendar-data-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const record={id:'one',title:'Conference',category:'学术会议',tags:['AI'],start:'2026-10-16',summary:'Summary',body:'## Heading\n\n<script>bad()</script>',sectionId:'calendar',sourceUrl:'https://example.org',assets:[{data:'private-blob'}],bodyHtml:'<script>untrusted()</script>'};
 const data={year:[record],history:[{id:'history',factSummary:'fact',historicalSignificance:'meaning',sources:[],assets:[]}]};
 const original=JSON.stringify(data),manifest=await writeCalendarData(dir,data);
 const read=async path=>JSON.parse(await readFile(join(dir,path.slice(1))));
 const summaries=await read(manifest.year),detail=await read(summaries[0].detailUrl);
 assert.equal(summaries[0].body,undefined);assert.equal(summaries[0].assets,undefined);assert.equal(summaries[0].bodyHtml,undefined);
 for(const key of ['id','title','category','tags','start','summary'])assert.deepEqual(summaries[0][key],record[key]);
 assert.equal(detail.body,record.body);assert.equal(detail.sourceUrl,record.sourceUrl);assert.match(detail.bodyHtml,/<h2>Heading<\/h2>/);assert.doesNotMatch(detail.bodyHtml,/<script|private-blob/);
 assert.equal((await read(manifest.history))[0].historicalSignificance,'meaning');assert.equal(JSON.stringify(data),original);
 assert.deepEqual(await writeCalendarData(dir,data),manifest);
 const changed=await writeCalendarData(dir,{...data,year:[{...record,body:'New body'}]});
 assert.notEqual(changed.year,manifest.year);assert.equal(changed.history,manifest.history);
});
test('year navigation fetches only its index; detail/history are lazy and reused',async()=>{
 const files={'/calendar-index.json':first,[first.year]:[{id:'one',detailUrl:url('c')}],[first.history]:[{id:'old'}],[url('c')]:{id:'one',body:'full'}};
 const {loader,calls}=server(files);
 await Promise.all([loader.load('year'),loader.load('year')]);assert.deepEqual(calls,['/calendar-index.json',first.year]);
 assert.equal((await loader.record('year','one')).body,'full');await loader.record('year','one');assert.equal(calls.length,3);
 assert.equal(await loader.record('year','missing'),undefined);assert.equal(calls.length,3);
 assert.equal((await loader.record('history','old')).id,'old');assert.equal(calls.length,4);
});
test('a failed request does not poison retry',async()=>{
 const files={'/calendar-index.json':first,[first.year]:new Error('offline')};const {loader,calls}=server(files);
 await assert.rejects(loader.load('year'),/offline/);files[first.year]=[];assert.deepEqual(await loader.load('year'),[]);
 assert.deepEqual(calls,['/calendar-index.json',first.year,first.year]);
});
test('a release change refreshes missing collections and missing detail URLs',async()=>{
 const files={'/calendar-index.json':first,[first.year]:[{id:'one',detailUrl:url('c')}]};
 const {loader,calls}=server(files);await loader.load('year');
 const next={...first,year:url('d')};files['/calendar-index.json']=next;files[next.year]=[{id:'one',detailUrl:url('e')}];files[url('e')]={id:'one',body:'updated'};
 assert.equal((await loader.record('year','one')).body,'updated');assert.equal(calls.filter(x=>x==='/calendar-index.json').length,2);
 const fresh=server({'/calendar-index.json':next,[next.year]:[]});assert.deepEqual(await fresh.loader.load('year'),[]);
 const missing=server({'/calendar-index.json':next});await assert.rejects(missing.loader.load('year'),error=>error.status===404);assert.equal(missing.calls.length,4);
});
test('withdrawn records disappear after refresh; malformed remote paths are rejected',async()=>{
 const files={'/calendar-index.json':first,[first.year]:[{id:'one',detailUrl:url('c')}]};const {loader}=server(files);await loader.load('year');
 files['/calendar-index.json']={...first,year:url('d')};files[url('d')]=[];assert.equal(await loader.record('year','one'),undefined);
 const invalid=server({'/calendar-index.json':first,[first.year]:[{id:'bad',detailUrl:'https://other.test/private'}]});await assert.rejects(invalid.loader.record('year','bad'),/正文地址无效/);
 const manifest=server({'/calendar-index.json':{...first,year:'/manage/private'}});await assert.rejects(manifest.loader.load('year'),/索引格式无效/);
});
