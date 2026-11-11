import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {openUrl} from '@tauri-apps/plugin-opener';
import './center.css';
import {CenterConnection} from './CenterConnection';
import LocalCenterAssistant from './LocalCenterAssistant';
import {tr,uiLocale} from '../uiText';
import {invoke} from '../lib/nativeCore';
import CenterPreview from './preview/CenterPreview';
import {stateLabel} from './shared/CenterView';
import {dayKey,type PreviewDemand} from './preview/model';
import {mapLiveCenter,emptyLiveCenter as empty} from './preview/mapLive';
export {mapLiveCenter};
type Row=Record<string,any>;
const call=(method:string,params:Row={})=>invoke<any>('rssd_center_call',{method,params});
const PAGE=200;
const RUNNING=['starting','working','idle','stopping'];
export type CenterShell={refresh:()=>void;status:(value:Row)=>void};
export default function LiveCenter({active=true,legacy}:{active?:boolean;legacy?:(shown:boolean,shell:CenterShell)=>ReactNode}){
 const [configured,setConfigured]=useState<boolean|null>(null),[status,setStatus]=useState<Row>({}),[agent,setAgent]=useState('');
 // Each kind of Center data loads on its own, so moving the calendar or searching does not re-read the rest.
 const [base,setBase]=useState<{overview:Row;channels:Row}|null>(null),[demands,setDemands]=useState<Row[]>([]),[calendar,setCalendar]=useState<Row>({items:[]});
 const [limit,setLimit]=useState(PAGE),[search,setSearch]=useState(''),[applied,setApplied]=useState(''),[more,setMore]=useState(false);
 const [range,setRange]=useState({from:new Date(Date.now()-31*86400000).toISOString(),to:new Date(Date.now()+62*86400000).toISOString()});
 const [busy,setBusy]=useState(0),[error,setError]=useState('');
 const seq=useRef({base:0,demands:0,calendar:0}),ready=useRef(false),legacyShown=useRef(false),pending=useRef<{fingerprint:string;requestId:string}|null>(null);
 const track=useCallback(async(work:()=>Promise<unknown>)=>{setBusy(n=>n+1);setError('');try{await work();}catch(e){setError(String(e));}finally{setBusy(n=>n-1);}},[]);
 const takeStatus=useCallback((local:Row)=>{setStatus(local);setAgent(old=>old||local.agents?.find((a:Row)=>a.available&&a.enabled)?.id||'');},[]);
 const loadBase=useCallback(async()=>{const id=++seq.current.base;
  try{
   const local=await call('status');if(id!==seq.current.base)return false;takeStatus(local);
   if(!local.configured){ready.current=false;setConfigured(false);setBase(null);setDemands([]);setCalendar({items:[]});return false;}
   const [overview,channels]=await Promise.all([call('overview'),call('channels')]);if(id!==seq.current.base)return false;
   setBase({overview,channels});setConfigured(true);ready.current=true;return true;
  }catch(e){if(id===seq.current.base){setBase(null);setDemands([]);setCalendar({items:[]});}throw e;}
 },[takeStatus]);
 const loadDemands=useCallback(async()=>{const id=++seq.current.demands,all:Row[]=[];let full=true;
  try{
   for(let offset=0;offset<limit&&full;offset+=PAGE){const page=await call('demands',{limit:PAGE,offset,...(search?{search}:{})});all.push(...page);full=page.length===PAGE;}
   if(id===seq.current.demands){setDemands(all);setMore(full);setApplied(search);}
  }catch(e){if(id===seq.current.demands){setDemands([]);setMore(false);}throw e;}
 },[limit,search]);
 const loadCalendar=useCallback(async()=>{const id=++seq.current.calendar;
  try{const result=await call('calendar',{limit:200,...range});if(id===seq.current.calendar)setCalendar(result);}
  catch(e){if(id===seq.current.calendar)setCalendar({items:[]});throw e;}
 },[range]);
 const latest=useRef({loadDemands,loadCalendar});latest.current={loadDemands,loadCalendar};
 const refresh=useCallback(()=>track(async()=>{if(await loadBase())await Promise.all([latest.current.loadDemands(),latest.current.loadCalendar()]);}),[track,loadBase]);
 useEffect(()=>{if(!active)return;void refresh();return()=>{seq.current.base++;seq.current.demands++;seq.current.calendar++;};},[active,refresh]);
 useEffect(()=>{if(active&&ready.current)void track(loadDemands);},[loadDemands]);
 useEffect(()=>{if(active&&ready.current)void track(loadCalendar);},[loadCalendar]);
 const running=RUNNING.includes(status.worker?.state),wasRunning=useRef(false);
 // The works tab reports local status itself while it is open; otherwise follow a running worker from here.
 useEffect(()=>{if(!active||!running)return;const timer=setInterval(()=>{if(!legacyShown.current)void call('status').then(takeStatus).catch(()=>{});},5000);return()=>clearInterval(timer);},[active,running,takeStatus]);
 useEffect(()=>{if(wasRunning.current&&!running&&active)void refresh();wasRunning.current=running;},[running]);
 const mapped=useMemo(()=>{if(!base)return {data:empty(),error:''};try{return {data:mapLiveCenter(base.overview,demands,calendar,base.channels),error:''};}catch(e){return {data:empty(),error:String(e)};}},[base,demands,calendar,uiLocale()]);
 const data=mapped.data,loading=busy>0,problem=error||mapped.error;
 const manage=(tab:string,workspaceId?:string)=>{if(!status.origin){setError(tr('中心连接尚未读取'));return;}const url=new URL('/rssd',status.origin);url.searchParams.set('tab',tab);if(workspaceId&&workspaceId!=='__postiz__')url.searchParams.set('workspaceId',workspaceId);void openUrl(url.href).catch(e=>setError(String(e)));};
 const updateDemand=async(task:PreviewDemand)=>{
  const old=demands.find(d=>d.id===task.id);if(!old)throw Error(tr('请重新加载需求'));
  const changes={title:task.title,brief:task.requirements,priority:task.priority===(old.priority>0?'优先':'常规')?old.priority:task.priority==='优先'?10:0,requiredLocales:task.languages,dueAt:task.due&&old.payload.dueAt&&task.due===dayKey(new Date(old.payload.dueAt))?old.payload.dueAt:task.due?new Date(task.due+'T23:59:59').toISOString():null};
  const fingerprint=JSON.stringify([task.id,old.generation,changes]);if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,requestId:crypto.randomUUID()};
  await call('edit_demand',{id:task.id,baseGeneration:old.generation,changes,requestId:pending.current.requestId});pending.current=null;await track(loadDemands);
 };
 const claim=async(task:PreviewDemand)=>{if(!agent)throw Error(tr('请先在执行设置中选择可用智能体'));await call('start',{agentId:agent,workspaceIds:[task.workspaceId],demandId:task.id,once:true});await refresh();};
 const assistant=(workspaceIds:string[])=><LocalCenterAssistant agents={status.agents||[]} workspaceIds={workspaceIds} defaultAgent={agent} onAgentChange={setAgent} manage={()=>manage('goals')} openNative={status.origin?()=>{void openUrl(new URL('/agents',status.origin).href).catch(e=>setError(String(e)));}:undefined}/>;
 const waiting=(status.outbox||[]).filter((r:Row)=>r.state!=='accepted').length;
 const execution={running,label:status.worker?stateLabel(status.worker.state,tr):tr('工作模式尚未开启'),notes:[
  !running&&status.activeClaim?tr('本机仍保留未完成的认领。'):'',
  waiting?tr('本机待处理稿件')+' · '+waiting:'',
  status.preparedReference&&!status.preparedReference.error?tr('待提交的本机参考文献修订：')+status.preparedReference.title:'',
 ].filter(Boolean)};
 const shell:CenterShell={refresh:()=>void refresh(),status:takeStatus};
 if(configured===false)return <main className="center-preview"><header className="cp-header"><div><div className="cp-eyebrow">{tr('RSSD / 内容生产')}</div><h1>{tr('工作中心')}</h1><p>{tr('登录 RSSD 中心后，可查看任务数量、发布日历和发布渠道。')}</p></div></header>
  {problem&&<p role="alert" className="cp-notice">{problem}</p>}
  <div className="center-view rssd-desktop-center"><CenterConnection status={status} disabled={loading} beforeChange={async()=>{}} onChanged={refresh}/></div></main>;
 return <CenterPreview live={{data,loading,error:problem,refresh:shell.refresh,updateDemand,claim,manage,assistant,
  legacy:legacy&&(shown=>{legacyShown.current=shown;return legacy(shown,shell);}),execution:legacy?execution:undefined,
  search:setSearch,appliedSearch:applied,loadMore:more?()=>setLimit(n=>n+PAGE):undefined,calendarTruncated:Boolean(calendar.hasNext),
  calendarRange:(from,to)=>setRange(old=>{const next={from:new Date(from+'T00:00:00').toISOString(),to:new Date(to+'T00:00:00').toISOString()};return old.from===next.from&&old.to===next.to?old:next;})}}/>;
}
