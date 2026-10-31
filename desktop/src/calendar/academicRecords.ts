import {loadSiteCalendar} from './siteCalendar';
import {loadLegacyCalendar} from './legacyCalendar';
import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import {listCalendarEvents} from '../api';
import type {NewsItem} from '../editorial/taskWorkbench';
import type {TopicTemplate} from '../editorial/topicTemplates';
import {adaptHistoryEvents,calendarProvenance} from './adapters';
import {dateKeyFromParts,daysInMonth} from './helpers';
import historyEvents from './historyEvents.json';
import {nationalHolidays} from './nationalHolidays';
import type {CalendarEvent,HistoryEvent} from './types';
import {growYearEvents,loadGrowSeeds,type GrowSeed} from './yearGrow';
import {yearOfficialSeeds} from './yearOfficialSeedSets';
import {attachOfficialBodyCache} from './yearOfficialBodyCache';
import yearSeeds from './yearSeeds.json';
import yearTalentSeeds from './yearTalentSeeds.json';
import yearWindowSeeds from './yearWindowSeeds.json';
import yearProgramSeeds from './yearProgramSeeds.json';
import yearLocalSeeds from './yearLocalSeeds.json';
import yearSocialSeeds from './yearSocialSeeds.json';

export type AcademicMode='calendar'|'history';
export const historyRecords=adaptHistoryEvents(historyEvents as HistoryEvent[]);
const legacy=attachOfficialBodyCache([
 ...(yearProgramSeeds as GrowSeed[]),...(yearWindowSeeds as GrowSeed[]),
 ...(yearTalentSeeds as GrowSeed[]),...(yearLocalSeeds as GrowSeed[]),
 ...(yearSocialSeeds as GrowSeed[]),...(yearSeeds as GrowSeed[]),
]);

/** Read the same local evidence as the former calendar without writing or refreshing sources. */
export async function loadAcademicRecords(mode:AcademicMode,year:number):Promise<{events:CalendarEvent[];notice?:string}>{
 if(!ACTIVE_SITE.legacy){const result=await loadSiteCalendar(year);return {...result,events:result.events.filter(x=>x.source===(mode==='history'?'history':'year'))};}
 let archived=null,archiveNotice='';try{archived=await loadLegacyCalendar();}catch(error){archiveNotice='本机日历归档未能读取：'+String(error);}
 if(mode==='history')return {events:archived?adaptHistoryEvents(archived.history):historyRecords,...(archiveNotice?{notice:archiveNotice}:{})};
 const [official,rss]=await Promise.allSettled([listCalendarEvents(),loadGrowSeeds()]);
 const saved=official.status==='fulfilled'&&Array.isArray(official.value)&&official.value.length?official.value:archived?.official||yearOfficialSeeds;
 return {events:[...nationalHolidays(year),...growYearEvents([...saved,...(archived?.harvested||legacy),...(rss.status==='fulfilled'?rss.value:[])])],
  ...(archiveNotice?{notice:archiveNotice}:official.status==='rejected'||rss.status==='rejected'?{notice:'本地资料未完整读取，当前保留本机已有资料。可重试读取。'}:{})};
}

export function recordSources(event:CalendarEvent){
 const links=[...(event.payload.sources||[]),...(event.payload.sourceUrl?[{label:event.payload.sourceName||'来源原文',url:event.payload.sourceUrl}]:[])];
 return links.filter((link,index)=>/^https?:\/\//i.test(link.url)&&links.findIndex(other=>other.url===link.url)===index);
}
const pad=(n:number)=>String(n).padStart(2,'0');
export function recordDate(event:CalendarEvent){
 return `${event.start.year}-${pad(event.start.month)}${event.precision==='day'&&!event.approximate&&event.start.day?'-'+pad(event.start.day):''}`;
}
export function recordDateLabel(event:CalendarEvent){
 const start=recordDate(event),end=event.end?`${event.end.year}-${pad(event.end.month)}${event.end.day?'-'+pad(event.end.day):''}`:'';
 return start+(end&&start!==end?' — '+end:'')+(event.approximate?' · 日期待核对':'');
}
export function recordSummary(event:CalendarEvent){return event.payload.factSummary||event.payload.summary||event.payload.meta||event.payload.body?.slice(0,600)||'本地未保存事实摘要，请核对来源原文。';}
export function recordGaps(event:CalendarEvent){
 const gaps:string[]=[];
 if(event.precision==='month'||event.approximate||!event.start.day)gaps.push(event.source==='history'?'历史事件的确切月日与日期依据':'活动/申报开始、结束或截止日期的原文依据');
 if(event.source==='year'&&event.end&&!event.end.day)gaps.push('结束/截止日期的确切月日与时区');
 if(!recordSources(event).length)gaps.push('可访问的机构/出版社/档案原始链接');
 if(!event.payload.factSummary&&!event.payload.summary&&!event.payload.body)gaps.push('有来源的事实摘要与原文正文');
 if(event.payload.bodyTruncated)gaps.push('来源正文的截断部分（需获取完整页面）');
 if(event.source==='year'&&calendarProvenance(event).verification!=='verified')gaps.push('公告日期、活动日期与申请窗口的分别核验');
 return gaps.length?gaps:['原文的新版本、事实细节与来源交叉核验'];
}
export function recordMaterial(event:CalendarEvent,id:string):NewsItem{
 if(!event.id||event.id.length>200)throw Error('原记录 ID 需为 1–200 个字符。');
 const sources=recordSources(event);if(!sources.length)throw Error('此记录没有原文链接，请先增补来源。');
 const precise=event.precision==='day'&&!event.approximate&&!!event.start.day;
 return {id,title:event.title,summary:[recordSummary(event),`记录分类：${event.tags.join('、')}；日期：${recordDateLabel(event)}`,sources.length>1?'其他来源：'+sources.slice(1).map(s=>s.url).join('；'):''].filter(Boolean).join('\n'),url:sources[0].url,sourceUrls:sources.map(source=>source.url),publisher:sources[0].label||'已有记录',date:recordDate(event),
  dateBasis:precise?(event.source==='history'?'已有史料中的历史事件日期；仍须核对原始史料':'已有记录中的活动/申请日期；不是公告发布日期'):'仅确定月份，确切月日待来源核验，不以月首补造日期',
  acquiredVia:'record',recordId:event.id,recordKind:event.source,datePrecision:precise?'day':'month',eventKey:event.id,selected:true,locked:true,excluded:false};
}
export function recordEnrichmentTemplate(event:CalendarEvent):TopicTemplate{
 if(!event.id||event.id.length>200)throw Error('原记录 ID 需为 1–200 个字符。');
 const sources=recordSources(event);
 // No rolling publication window: this request targets a known historical or calendar record.
 const assemble=(facts:string,links:typeof sources)=>[
  `增补已有${event.source==='history'?'史料':'日历公告'}，原记录只读，不覆盖：${event.id}`,
  `记录：${event.title.slice(0,120)}`,
  `已有日期：${recordDateLabel(event)}；分类：${event.tags.join('、')}`,
  `已有事实：${facts}`,
  `原始来源：${links.length?links.map(s=>`${s.label} ${s.url}`).join('；'):'未记录，需补原始来源'}`,
  `待补字段：${recordGaps(event).join('；')}`,
  '仅增补目标新智能槽位，寻找不同证据或新版本；保留分栏、其他槽位与手动锁定内容。按已有事件/申请日期查原文，不限制近期史料发布日期。逐条回写最新 task revision，无证据时标记缺口。',
 ].join('\n');
 let prompt=assemble(recordSummary(event).slice(0,180),sources.slice(0,2));
 if(prompt.length>790)prompt=assemble(recordSummary(event).slice(0,80),sources.slice(0,1));
 if(prompt.length>790)prompt=assemble('',sources.slice(0,1));
 if(prompt.length>790)throw Error('该记录来源过长，请用 AI 模板编辑器精简增补范围。');
 return {id:'record-enrichment:'+event.id,name:'增补：'+event.title,prompt,mode:event.source==='history'?'history':'calendar',enrichRecordId:event.id};
}
export function recordOnDay(event:CalendarEvent,year:number,month:number,day:number){
 if(event.source==='history')return event.start.month===month&&event.start.day===day&&!event.approximate;
 if(!event.start.day||event.approximate||event.precision==='month')return false;
 const point=Date.UTC(year,month-1,day),start=Date.UTC(event.start.year,event.start.month-1,event.start.day);
 const end=event.end?Date.UTC(event.end.year,event.end.month-1,event.end.day||event.start.day):start;
 return point>=start&&point<=end;
}
export function recordsForMonth(events:readonly CalendarEvent[],month:number,query='',tag='',day:string|null=null,year?:number){
 const normalized=query.trim().toLocaleLowerCase();
 return events.filter(event=>{
  const end=event.end||event.start;
  const monthMatch=event.source==='history'||year===undefined?event.start.month===month:
   Date.UTC(event.start.year,event.start.month-1,1)<=Date.UTC(year,month,0)&&Date.UTC(end.year,end.month-1,end.day||daysInMonth(end.year,end.month))>=Date.UTC(year,month-1,1);
  const dayMatch=!day||(event.source==='history'?event.start.day&&dateKeyFromParts(event.start.month,event.start.day)===day:recordOnDay(event,year??event.start.year,month,Number(day.slice(3))));
  return monthMatch&&(!tag||event.tags.includes(tag))&&dayMatch&&(!normalized||[event.title,recordSummary(event),...event.tags,...recordSources(event).map(s=>s.label)].join(' ').toLocaleLowerCase().includes(normalized));
 })
  .sort((a,b)=>(a.start.day??0)-(b.start.day??0)||a.start.year-b.start.year||a.title.localeCompare(b.title,'zh'));
}
