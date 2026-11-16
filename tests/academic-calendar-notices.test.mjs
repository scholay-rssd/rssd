import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {publicationOnly,calendarEvent,agendaBuckets} from '../web/themes/academic/public/calendar-model.js';

const notice={id:'year:rss:fixture:2026-11-16',title:'Posted notice',category:'国际科研机会',start:'2026-11-16',end:null,dateBasis:'发布日期（事件日期未核实）',provenance:'已核验'};
const deadline={id:'year:editor:fixture',title:'Real deadline',category:'自然科学基金',start:'2026-11-16',end:null,dateBasis:'申请截止：北京时间 16:00',provenance:'原文资料'};
const soon={...deadline,id:'year:editor:soon',title:'Upcoming window',start:'2026-11-20'};
const soonNotice={...notice,id:'year:rss:fixture:2026-11-20',start:'2026-11-20'};

test('rows that only carry a posting date are notices, not calendar events',()=>{
 assert.equal(publicationOnly(notice),true);assert.equal(calendarEvent(notice),false);
 assert.equal(publicationOnly(deadline),false);assert.equal(calendarEvent(deadline),true);
});

test('today and upcoming agendas leave posted-date notices out',()=>{
 const {current,upcoming}=agendaBuckets([notice,deadline,soon,soonNotice],'2026-11-16');
 assert.deepEqual(current.map(x=>x.id),['year:editor:fixture']);
 assert.deepEqual(upcoming.map(x=>x.id),['year:editor:soon']);
});

test('calendar days skip notices and their badge and article page never claim a verified event date',async()=>{
 const app=await readFile(new URL('../web/themes/academic/public/app.js',import.meta.url),'utf8');
 assert.match(app,/kind==='year' \? calendarEvent\(s\)&&coversDate\(s,date\)/);
 assert.match(app,/publicationOnly\(s\)\?'<span class="badge needs">事件日期未核实<\/span>'/);
 assert.match(app,/calendar-model\.js\?v=20261116-notices/);
 const page=await readFile(new URL('../web/themes/academic/build-seo.mjs',import.meta.url),'utf8');
 assert.match(page,/includes\('发布日期'\)\?'事件日期未核实':item\.provenance/);
 const index=await readFile(new URL('../web/themes/academic/public/index.html',import.meta.url),'utf8');
 assert.match(index,/\/app\.js\?v=20261116-notices/);
});
