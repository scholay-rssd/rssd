import test from 'node:test';
import assert from 'node:assert/strict';
import {rssEntryTimes} from '../web/engine/rss-entry-times.mjs';
test('RSS first-twenty recency survives a presentation rebuild and changes only with source content',()=>{
 const pages=Object.fromEntries(Array.from({length:30},(_,i)=>['/history/'+i+'/',{lastmod:'2026-10-'+String(i%20+1).padStart(2,'0')+'T12:00:00.000Z'}])),first=rssEntryTimes({},pages,'2026-10-21');
 const items=Object.keys(pages).map((route,i)=>({route,item:{id:String(i),body:'原有文章 '+i}}));
 for(const {route,item}of items)first.updated(route,item);
 const second=rssEntryTimes(first.entries,Object.fromEntries(Object.keys(pages).map(route=>[route,{lastmod:'2026-11-01T00:00:00.000Z'}])),'2026-11-01');
 for(const {route,item}of items)second.updated(route,{body:item.body,id:item.id});
 const recent=entries=>Object.keys(entries).sort((a,b)=>entries[b].updated.localeCompare(entries[a].updated)||b.localeCompare(a)).slice(0,20);
 assert.deepEqual(second.entries,first.entries);assert.deepEqual(recent(second.entries),recent(first.entries));
 const edited=rssEntryTimes(first.entries,pages,'2026-11-02');edited.updated(items[0].route,{...items[0].item,body:'新正文'});assert.equal(edited.entries[items[0].route].updated,'2026-11-02T00:00:00.000Z');
 assert.equal(edited.updated('/history/new/',{id:'new'}),'2026-11-02T00:00:00.000Z');
});
