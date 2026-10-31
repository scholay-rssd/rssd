import {invoke} from '../lib/nativeCore';
import {adaptHistoryEvents} from './adapters';
import type {CalendarEvent,HistoryEvent} from './types';
export function siteCalendarEvents(records:any[],year:number):CalendarEvent[]{
 return records.flatMap(x=>{
  if(x.kind==='history')return adaptHistoryEvents([x as HistoryEvent]).map(e=>({...e,id:x.id||e.id}));
  if(x.kind!=='year'||typeof x.start!=='string')return [];
  let start=x.start,end=x.end;
  if(x.recurrence?.frequency==='yearly'){
   start=`${year}-${x.recurrence.monthDay}`;
   if(new Date(start+'T00:00:00Z').toISOString().slice(0,10)!==start){if(x.recurrence.monthDay==='02-29'&&x.recurrence.leapDay==='feb28')start=`${year}-02-28`;else return [];}
   end=null;
  }
  const date=(s:string)=>{const [y,m,d]=s.split('-').map(Number);return {year:y,month:m,day:d};};
  return [{id:x.id,title:x.title,tags:[x.category,...(x.tags||[])].filter(Boolean),precision:'day',start:date(start),...(end?{end:date(end)}:{}),kind:end?'span':'point',source:'year',approximate:false,payload:{summary:x.summary,body:x.body,sourceName:x.sourceName,sourceUrl:x.sourceUrl,provenance:{origin:'curated',sourceTier:'unknown',verification:x.provenance?.includes('已核验')?'verified':'unverified'}}} as CalendarEvent];
 });
}
export async function loadSiteCalendar(year:number){
 const result=await invoke<{records:any[];notice?:string;updatedAt:string}>('publications_call',{method:'site_calendar'});
 return {events:siteCalendarEvents(result.records,year),notice:result.notice,updatedAt:result.updatedAt};
}
