// Settings › Subscriptions › AI search. Subscription-source discovery runs on the same board engine as the
// content workbench, but it is a service of the subscription list rather than a production task: the agent
// verifies feed addresses, and nothing is subscribed until the user presses the button on a result.
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {listen} from '@tauri-apps/api/event';
import {openUrl} from '@tauri-apps/plugin-opener';
import {useQueryClient} from '@tanstack/react-query';
import * as api from '../api';
import type {Feed} from '../types';
import {taskCall,type WorkbenchTask,type TaskRunState,type TopicBoard} from '../editorial/taskWorkbench';
import {defaultTemplates,templatePrompt,type TopicTemplate} from '../editorial/topicTemplates';
import './ai-feed-search.css';

import { tr, trKey } from "../uiText";
export const MAX_DIRECTIONS=5;
const normalize=(url:string)=>url.trim().replace(/\/$/,'').toLowerCase();
const customPrompt=(query:string)=>`寻找与「${query}」相关的真实 RSS 或 Atom 订阅入口；核验地址可访问、包含条目与原文链接，说明覆盖范围与更新频率，不以普通网页冒充订阅源，不自动订阅。`;
/** The board one search starts with: a single column whose AI slots are the chosen directions. */
export function discoveryBoard(directions:{name:string;prompt:string}[]):TopicBoard{
 const slots=directions.slice(0,MAX_DIRECTIONS).map((d,i,all)=>({id:crypto.randomUUID(),mode:'smart' as const,templateName:d.name.slice(0,80),prompt:templatePrompt({id:'discovery',name:d.name,kind:'material',mode:'rss',prompt:d.prompt} as TopicTemplate,i,all.length)}));
 return {titles:[],sections:[{id:crypto.randomUUID(),title:tr("订阅源"),slotCount:slots.length,slots,items:[]}],targetSections:1,targetPerSection:slots.length};
}
const STATUS={queued:trKey('排队中'),searching:trKey('正在检索'),missing:trKey('未找到'),complete:trKey('已完成')} as const;

export default function AiFeedSearch({feeds,onToast}:{feeds:Feed[];onToast:(message:string)=>void}){
 const qc=useQueryClient();
 const presets=useMemo(()=>defaultTemplates('rss').filter(t=>t.kind==='material'),[]);
 const [tasks,setTasks]=useState<WorkbenchTask[]>([]),[currentId,setCurrentId]=useState(''),[runs,setRuns]=useState<Record<string,TaskRunState>>({});
 const [query,setQuery]=useState(''),[picked,setPicked]=useState<string[]>([]),[starting,setStarting]=useState(false),[error,setError]=useState(''),[adding,setAdding]=useState<Record<string,boolean>>({}),[failed,setFailed]=useState<Record<string,string>>({});
 const currentRef=useRef(currentId);currentRef.current=currentId;
 const accept=useCallback((t:WorkbenchTask)=>setTasks(all=>all.some(x=>x.id===t.id)?all.map(x=>x.id===t.id?t:x):[t,...all]),[]);
 useEffect(()=>{
  let disposed=false,off:(()=>void)|undefined;
  void Promise.all([taskCall<WorkbenchTask[]>('task_list',{query:''}),taskCall<Record<string,TaskRunState>>('task_states')]).then(([all,states])=>{
   if(disposed)return;const found=all.filter(t=>t.mode==='rss'&&!t.deleted);setTasks(found);setRuns(states);setCurrentId(id=>id||found[0]?.id||'');
  }).catch(e=>{if(!disposed)setError(String(e));});
  void listen<{type?:string;taskId?:string;state?:TaskRunState}>('cursor-agent-event',({payload:e})=>{
   if(disposed||!e.taskId)return;
   if(e.type==='task_state'&&e.state)setRuns(s=>({...s,[e.taskId!]:e.state!}));
   if((e.type==='task_changed'||e.type==='changed')&&e.taskId===currentRef.current)void taskCall<WorkbenchTask>('task_get',{taskId:e.taskId}).then(t=>{if(!disposed&&t.mode==='rss')accept(t);}).catch(()=>{});
  }).then(fn=>{if(disposed)fn();else off=fn;});
  return()=>{disposed=true;off?.();};
 },[accept]);
 const task=tasks.find(t=>t.id===currentId),run=task?{...task.runtime,...runs[task.id]}:undefined,busy=starting||!!run?.busy||!!run?.queued;
 // When a run settles, read the board once more: the last save can land just before the final state event.
 const wasBusy=useRef(false);
 useEffect(()=>{if(wasBusy.current&&!busy&&currentId)void taskCall<WorkbenchTask>('task_get',{taskId:currentId}).then(accept).catch(()=>{});wasBusy.current=busy;},[busy,currentId,accept]);
 const directions=[...presets.filter(t=>picked.includes(t.id)).map(t=>({name:t.name,prompt:t.prompt})),...(query.trim()?[{name:query.trim().slice(0,40),prompt:customPrompt(query.trim().slice(0,200))}]:[])];
 async function start(){
  if(busy||!directions.length)return;
  if(directions.length>MAX_DIRECTIONS){setError(tr("一次最多 {{MAX_DIRECTIONS}} 个方向", {MAX_DIRECTIONS}));return;}
  setStarting(true);setError('');
  try{
   let t=await taskCall<WorkbenchTask>('task_create',{mode:'rss',title:('AI 搜索：'+directions.map(d=>d.name).join('、')).slice(0,120),brief:query.trim(),days:30});
   accept(t);setCurrentId(t.id);
   t=await taskCall<WorkbenchTask>('task_update',{taskId:t.id,patch:{board:discoveryBoard(directions)},expectedRevision:t.revision});
   t=await taskCall<WorkbenchTask>('task_workflow',{taskId:t.id,action:'configure',sources:'combined',authorized:true,expectedRevision:t.revision});accept(t);
   await taskCall('task_run',{taskId:t.id,action:'topic'});
   setQuery('');setPicked([]);
  }catch(e){setError(String(e));}finally{setStarting(false);}
 }
 async function stop(){if(!task)return;try{await taskCall('cancel',{taskId:task.id});}catch(e){setError(String(e));}}
 async function subscribe(id:string,url:string,title:string){
  if(adding[id])return;setAdding(v=>({...v,[id]:true}));setFailed(v=>{const next={...v};delete next[id];return next;});
  try{await api.addFeed(url,null);await qc.invalidateQueries({queryKey:['feeds']});onToast(tr("已订阅：{{title}}", {title}));}
  catch(e){setFailed(v=>({...v,[id]:String(e)}));}
  finally{setAdding(v=>{const next={...v};delete next[id];return next;});}
 }
 const subscribed=useMemo(()=>new Set(feeds.map(f=>normalize(f.feedUrl))),[feeds]);
 const section=task?.board.sections[0],items=task?.board.sections.flatMap(s=>s.items)||[];
 const waiting=(section?.slots||[]).filter(slot=>slot.mode==='smart'&&!items.some(i=>i.id===slot.id));
 const gaps=task?.board.gaps?(Array.isArray(task.board.gaps)?task.board.gaps.join('；'):String(task.board.gaps)):'';
 return <div className="settings-group ai-feed-search" style={{marginBottom:18}}>
  <h3 className="settings-group-title">{tr("AI 搜索")}</h3>
  <p className="settings-group-desc">{tr("让 AI 按方向寻找并核验真实可访问的 RSS 或 Atom 订阅地址。结果不会自动订阅，由你逐条决定。")}</p>
  <div className="ai-feed-presets" role="group" aria-label={tr("搜索方向")}>{presets.map(t=><button key={t.id} type="button" title={t.prompt} aria-pressed={picked.includes(t.id)} disabled={busy} onClick={()=>setPicked(v=>v.includes(t.id)?v.filter(x=>x!==t.id):[...v,t.id])}>{t.name}</button>)}</div>
  <form className="ai-feed-query" onSubmit={e=>{e.preventDefault();void start();}}>
   <input aria-label={tr("自定义搜索方向")} placeholder={tr("或描述想找的订阅源，例如：计算语言学期刊")} value={query} maxLength={200} disabled={busy} onChange={e=>setQuery(e.target.value)}/>
   {busy&&!starting?<button type="button" className="s-btn" onClick={()=>void stop()}>{tr("停止")}</button>:<button type="submit" className="s-btn primary" disabled={busy||!directions.length}>{starting?tr("正在启动…"):tr("开始搜索")}</button>}
  </form>
  {error&&<p className="ai-feed-error" role="alert">{error}</p>}
  {tasks.length>1&&<label className="ai-feed-history">{tr("搜索记录")}<select aria-label={tr("搜索记录")} value={currentId} onChange={e=>setCurrentId(e.target.value)}>{tasks.map(t=><option key={t.id} value={t.id}>{t.updatedAt.slice(0,10)} · {t.title.replace(/^AI 搜索：/,'')}</option>)}</select></label>}
  {task&&<div className="ai-feed-results" aria-label={tr("搜索结果")} aria-busy={busy}>
   {run?.status&&<p className="ai-feed-status" role="status">{busy&&<i aria-hidden="true"/>}{run.status}</p>}
   {items.map(item=>{const done=subscribed.has(normalize(item.url));return <div key={item.id} className="ai-feed-row">
    <div className="ai-feed-row-text"><strong title={item.title}>{item.title}</strong><span>{item.publisher}{item.date?tr(" · 核验于 {{date}}", {date: item.date}):''}</span><p>{item.summary}</p><button type="button" className="ai-feed-link" title={tr("在浏览器中打开")} onClick={()=>void openUrl(item.url)}>{item.url}</button>{failed[item.id]&&<p className="ai-feed-error" role="alert">{tr("订阅失败：{{failed}}", {failed: failed[item.id]})}</p>}</div>
    <button type="button" className={'s-btn'+(done?'':' primary')} disabled={done||!!adding[item.id]} onClick={()=>void subscribe(item.id,item.url,item.title)}>{done?tr("已订阅"):adding[item.id]?tr("订阅中…"):tr("订阅")}</button>
   </div>;})}
   {waiting.map(slot=>{const state=run?.collection?.[slot.id];return <div key={slot.id} className="ai-feed-row is-waiting"><div className="ai-feed-row-text"><strong>{slot.templateName||tr("搜索方向")}</strong><span>{state?tr(STATUS[state.status]):busy?tr("等待中"):tr("未完成")}{state?.detail?' · '+state.detail:''}</span></div></div>;})}
   {gaps&&<p className="ai-feed-gaps">{tr("检索说明：{{gaps}}", {gaps})}</p>}
   {!items.length&&!waiting.length&&<p className="ai-feed-status">{tr("这次搜索没有结果")}</p>}
  </div>}
 </div>;
}
