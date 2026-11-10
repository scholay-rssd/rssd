import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {openUrl} from '@tauri-apps/plugin-opener';
import './center.css';
import {CenterConnection} from './CenterConnection';
import LocalCenterAssistant from './LocalCenterAssistant';
import {tr,uiLocale} from '../uiText';
import {invoke} from '../lib/nativeCore';
import CenterPreview from './preview/CenterPreview';
import {stateLabel} from './shared/CenterView';
import {monday,dayKey,type PreviewData,type PreviewDemand} from './preview/model';
type Row=Record<string,any>;
const call=(method:string,params:Row={})=>invoke<any>('rssd_center_call',{method,params});
const empty=():PreviewData=>({spaces:[],demands:[],publications:[],destinations:[],weekStart:monday(dayKey(new Date()))});
export function mapLiveCenter(overview:Row,demands:Row[],calendar:Row,channels:Row):PreviewData{
 const spaces=overview.workspaces.map((w:Row)=>({id:w.id,name:w.name,initial:w.name.slice(0,1),sections:w.sections.map((s:Row)=>s.name),target:overview.goals.filter((g:Row)=>g.workspaceId===w.id).reduce((n:number,g:Row)=>n+g.payload.target,0),completed:overview.goals.filter((g:Row)=>g.workspaceId===w.id).reduce((n:number,g:Row)=>n+g.completed,0)}));
 const names=Object.fromEntries(overview.workspaces.map((w:Row)=>[w.id,w]));
 const events=calendar.items||[];
 if(events.some((r:Row)=>!r.workspaceId)||channels.channels.some((c:Row)=>!channels.destinations.some((d:Row)=>d.integrationId===c.id)))spaces.push({id:'__postiz__',name:tr('Postiz 外部渠道'),initial:'P',sections:[],target:0,completed:0});
 const localDate=(value:string)=>{const d=new Date(value);return {date:dayKey(d),time:d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})};};
 return {demandCounts:overview.counts,spaces,weekStart:monday(dayKey(new Date())),demands:demands.filter(d=>d.state!=='cancelled').map(d=>({id:d.id,workspaceId:d.workspaceId,section:names[d.workspaceId]?.sections.find((s:Row)=>s.id===d.sectionId)?.name||d.sectionId,title:d.title,kind:d.kind==='translate'?'翻译':d.kind==='update'?'补充更新':'写作',state:d.state,priority:d.priority>0?'优先':'常规',due:d.payload.dueAt?dayKey(new Date(d.payload.dueAt)):'',languages:d.payload.requiredLocales,owner:d.workerId||undefined,angle:d.payload.brief||'',outline:[],requirements:d.payload.brief||'',sources:d.payload.source?[`${d.payload.source.workId} · ${d.payload.source.locale} · v${d.payload.source.revision}`]:[]})),
  publications:events.map((r:Row)=>({id:r.id,workId:r.workId||r.publicationId,workspaceId:r.workspaceId||'__postiz__',title:r.title||r.workId||r.publicationId,destination:r.destination||r.destinationId,locale:r.locale||'Postiz',...localDate(r.scheduledAt),state:['published','legacy_published','PUBLISHED'].includes(r.state)?'published':['blocked','ERROR','FAILED'].includes(r.state)?'blocked':r.state==='DRAFT'?'planned':r.source==='rssd'&&!r.hasSchedule?'ready':'scheduled'})),
  destinations:[...channels.destinations.map((d:Row)=>({name:d.name,platform:d.kind==='site'?'自家站点':d.kind==='discourse'?'Discourse':channels.channels.find((c:Row)=>c.id===d.integrationId)?.providerIdentifier||'Postiz',kind:d.kind==='site'?'owned':'external',account:d.origin||channels.channels.find((c:Row)=>c.id===d.integrationId)?.name||d.name,auth:d.kind==='site'?tr('站点接收服务'):tr('中心渠道授权'),state:!d.enabled?'not_connected':channels.channels.some((c:Row)=>c.id===d.integrationId&&(c.disabled||c.refreshNeeded))?'needs_attention':'connected',workspaceIds:d.workspaceIds})),...channels.channels.filter((c:Row)=>!channels.destinations.some((d:Row)=>d.integrationId===c.id)).map((c:Row)=>({name:c.name,platform:c.providerIdentifier,kind:'external',account:c.name,auth:tr('Postiz 原生授权'),state:c.disabled||c.refreshNeeded?'needs_attention':'connected',workspaceIds:['__postiz__']}))] as PreviewData['destinations']};
}
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
