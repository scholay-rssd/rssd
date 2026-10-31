import {useEffect,useMemo,useState} from 'react';
import {calendarProvenance,calendarProvenanceLabel} from './adapters';
import {historyMonthGrid,monthGrid,shanghaiToday,WEEKDAY_LABELS} from './helpers';
import {loadAcademicRecords,recordDateLabel,recordEnrichmentTemplate,recordGaps,recordOnDay,recordSources,recordSummary,recordsForMonth,type AcademicMode} from './academicRecords';
import type {CalendarEvent} from './types';
import {sourceKey,sourceUsable,type TopicSource} from '../editorial/topicSources';
import './academic-record-shelf.css';

import { tr } from "../uiText";
type Props={mode:AcademicMode;busy:boolean;usedUrls:string[];chosen:TopicSource|null;onChoose:(value:TopicSource|null)=>void;onDrag:(value:TopicSource|null)=>void;onOpenUrl?:(url:string,title:string)=>void};
export default function AcademicRecordShelf({mode,busy,usedUrls,chosen,onChoose,onDrag,onOpenUrl}:Props){
 const today=useMemo(()=>shanghaiToday(),[]);
 const [year,setYear]=useState(today.year),[month,setMonth]=useState(today.month),[day,setDay]=useState<string|null>(null),[tag,setTag]=useState(''),[query,setQuery]=useState(''),[needs,setNeeds]=useState(false);
 const [events,setEvents]=useState<CalendarEvent[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0),[page,setPage]=useState(0);
 useEffect(()=>{let live=true;setLoading(true);setError('');void loadAcademicRecords(mode,year).then(result=>{if(live){setEvents(result.events);setNotice(result.notice||'');}}).catch(e=>{if(live){setEvents([]);setError(String(e));}}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[mode,year,retry]);
 const tags=useMemo(()=>[...new Set(events.flatMap(event=>event.tags))].sort((a,b)=>a.localeCompare(b,'zh')),[events]);
 const monthly=useMemo(()=>recordsForMonth(events,month,query,tag,null,mode==='calendar'?year:undefined),[events,month,query,tag,mode,year]);
 const filtered=useMemo(()=>recordsForMonth(monthly,month,'','',day,mode==='calendar'?year:undefined).filter(event=>!needs||recordGaps(event).some(gap=>!gap.startsWith('原文的新版本'))),[monthly,month,day,needs,mode,year]);
 const rows=filtered.slice(page*20,(page+1)*20);
 const reset=()=>{setPage(0);onChoose(null);setError('');};
 function enrich(event:CalendarEvent){if(busy)return;try{const source:TopicSource={kind:'template',template:recordEnrichmentTemplate(event)};onChoose(chosen&&sourceKey(chosen)===sourceKey(source)?null:source);setError('');}catch(e){setError(String(e));}}
 function dragEnrichment(event:CalendarEvent,e:React.DragEvent){e.stopPropagation();if(busy){e.preventDefault();return;}try{const source:TopicSource={kind:'template',template:recordEnrichmentTemplate(event)};onChoose(source);onDrag(source);e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('text/plain',sourceKey(source));setError('');}catch(error){e.preventDefault();setError(String(error));}}
 function dragRecord(event:CalendarEvent,e:React.DragEvent){const source:TopicSource={kind:'record',event};if(busy||!sourceUsable(source,usedUrls)){e.preventDefault();return;}onChoose(source);onDrag(source);e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('text/plain',sourceKey(source));}
 return <div className="academic-record-shelf" aria-label={mode==='history'?tr("历史史料增补"):tr("学术日历增补")}>
  <div className="academic-record-switch" role="tablist" aria-label={tr("资料核验范围")}><button role="tab" aria-selected={!needs} onClick={()=>{setNeeds(false);reset();}}>{tr("已有记录")}</button><button role="tab" aria-selected={needs} onClick={()=>{setNeeds(true);reset();}}>{tr("待增补")}</button></div>
  <input aria-label={tr("搜索已有记录")} placeholder={tr("搜索标题、来源、分类")} value={query} onChange={e=>{setQuery(e.target.value);setDay(null);reset();}}/>
  <div className="academic-record-filter"><select aria-label={tr("已有记录分类")} value={tag} onChange={e=>{setTag(e.target.value);setDay(null);reset();}}><option value="">{tr("全部分类")}</option>{tags.map(value=><option key={value}>{value}</option>)}</select>{mode==='calendar'&&<input type="number" aria-label={tr("资料年份")} value={year} min={1900} max={2200} onChange={e=>{const value=Number(e.target.value);if(Number.isInteger(value)&&value>=1900&&value<=2200){setYear(value);setDay(null);reset();}}}/>}</div>
  <section className="academic-mini-calendar" aria-label={tr("日期索引")}><header><button aria-label={tr("上个月")} onClick={()=>{if(month===1){setMonth(12);if(mode==='calendar')setYear(y=>y-1);}else setMonth(m=>m-1);setDay(null);reset();}}>‹</button><button aria-label={tr("显示本月全部记录")} aria-pressed={!day} onClick={()=>{setDay(null);reset();}}>{mode==='calendar'?year+' · ':''}{tr('{{month}} 月',{month})}</button><button aria-label={tr("下个月")} onClick={()=>{if(month===12){setMonth(1);if(mode==='calendar')setYear(y=>y+1);}else setMonth(m=>m+1);setDay(null);reset();}}>›</button></header><div className="academic-mini-grid">{WEEKDAY_LABELS.map(label=><small key={label}>{label.slice(0,1)}</small>)}{(mode==='history'?historyMonthGrid(year,month):monthGrid(year,month)).map(cell=>{const count=cell.inMonth?monthly.filter(event=>recordOnDay(event,year,month,cell.day)).length:0;return <button key={cell.year+'-'+cell.dateKey} disabled={!cell.inMonth} aria-pressed={day===cell.dateKey} aria-label={tr("{{month}} 月 {{day}} 日，{{count}} 条记录", {month: cell.month, day: cell.day, count})} className={(cell.inMonth?'':'is-out ')+(count?'has-record':'')} onClick={()=>{setDay(day===cell.dateKey?null:cell.dateKey);reset();}}>{cell.day}{count>0&&<i/>}</button>;})}</div></section>
  {notice&&<p className="academic-record-notice" role="status">{notice}<button onClick={()=>setRetry(v=>v+1)}>{tr("重试")}</button></p>}
  {error&&<p role="alert" className="academic-record-notice">{error}<button onClick={()=>setRetry(v=>v+1)}>{tr("重试")}</button></p>}
  <div className="academic-record-list" role="tabpanel" aria-label={needs?tr("待增补记录"):tr("已有史料与公告")}>{loading?<p role="status">{tr("读取资料…")}</p>:!rows.length?<p>{tr("这个范围没有记录。可切换日期或使用 AI 模板增补。")}</p>:rows.map(event=>{const source:TopicSource={kind:'record',event},usable=sourceUsable(source,usedUrls),selected=chosen&&sourceKey(chosen)===sourceKey(source),links=recordSources(event),enrichment=chosen?.kind==='template'&&chosen.template.id==='record-enrichment:'+event.id;return <article key={event.id} className={'academic-record-card'+(selected?' is-selected':'')} draggable={!busy&&usable} onDragStart={e=>dragRecord(event,e)} onDragEnd={()=>onDrag(null)}>
   <div className="academic-record-date"><time>{recordDateLabel(event)}</time><small>{event.tags.join(' · ')}</small></div>
   <button className="academic-record-select" disabled={busy||!usable} aria-pressed={!!selected} aria-label={tr("选用已有记录：{{title}}", {title: event.title})} onClick={()=>onChoose(selected?null:source)} title={usable?tr("拖入右侧，或点选后点击空槽位"):links.length?tr("原文已加入当前素材板"):tr("先增补原始来源")}><strong>{event.title}</strong><p>{recordSummary(event)}</p></button>
   {event.source==='year'&&<small className="academic-record-provenance">{calendarProvenanceLabel(calendarProvenance(event))}</small>}
   <small className="academic-record-gaps">{recordGaps(event).join('；')}</small>
   <footer>{links[0]&&<button disabled={!onOpenUrl} onClick={()=>onOpenUrl?.(links[0].url,event.title)} title={links[0].url}>{tr("来源 ↗")}</button>}<button disabled={busy} draggable={!busy} onDragStart={e=>dragEnrichment(event,e)} onDragEnd={()=>onDrag(null)} aria-pressed={!!enrichment} aria-label={tr("增补已有记录：{{title}}", {title: event.title})} onClick={()=>enrich(event)}>{tr("增补信息")}</button></footer>
  </article>;})}</div>
  <div className="academic-record-pages"><button disabled={page===0||loading} onClick={()=>setPage(p=>p-1)}>{tr("上一页")}</button><span>{tr("{{filtered}} 条 · {{value}}", {filtered: filtered.length, value: page+1})}</span><button disabled={(page+1)*20>=filtered.length||loading} onClick={()=>setPage(p=>p+1)}>{tr("下一页")}</button></div>
 </div>;
}
