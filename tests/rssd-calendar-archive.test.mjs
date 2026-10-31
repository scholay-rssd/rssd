import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {captureLegacyCalendar,readLegacyCalendar} from '../desktop/scripts/legacy-calendar.mjs';

test('private bundled calendar evidence survives replacement by an empty public app',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rssd-calendar-')),source=join(root,'source'),home=join(root,'data');t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(source);
 const seed={article:{id:7,url:'https://example.org/notice',body:''},date:'2026-01-01'};
 const fixtures={'historyEvents.json':[{id:'historical-id',title:'Synthetic evidence'}],'yearProgramSeeds.json':[seed],'yearOfficialSeeds.json':[seed],'yearOfficialBodyCache.json':{version:1,entries:[{articleId:7,sourceUrl:seed.article.url,body:'Complete original source body'}]}};
 for(const [file,value] of Object.entries(fixtures))await writeFile(join(source,file),JSON.stringify(value));
 const first=await captureLegacyCalendar(source,home),again=await captureLegacyCalendar(source,home);assert.equal(first.sha256,again.sha256);
 await writeFile(join(source,'historyEvents.json'),'[]');await assert.rejects(captureLegacyCalendar(source,home),/no historical/);
 const saved=await readLegacyCalendar(home);assert.equal(saved.history[0].id,'historical-id');assert.equal(saved.harvested[0].article.body,'Complete original source body');assert.equal(saved.official[0].article.body,'Complete original source body');
 const value=JSON.parse(await readFile(first.path,'utf8'));value.files['historyEvents.json']='[]';await writeFile(first.path,JSON.stringify(value));await assert.rejects(readLegacyCalendar(home),/checksum/);
});
