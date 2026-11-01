import {useCallback,useEffect,useRef,useState} from 'react';
import {openUrl} from '@tauri-apps/plugin-opener';
import {tr} from '../uiText';
import {invoke} from '../lib/nativeCore';
import CenterPreview from './preview/CenterPreview';
import {monday,dayKey,type PreviewData,type PreviewDemand} from './preview/model';
type Row=Record<string,any>;
const call=(method:string,params:Row={})=>invoke<any>('rssd_center_call',{method,params});
const empty=():PreviewData=>({spaces:[],demands:[],publications:[],destinations:[],weekStart:monday(dayKey(new Date()))});
export function mapLiveCenter(overview:Row,demands:Row[],calendar:Row,channels:Row):PreviewData{
 const spaces=overview.workspaces.map((w:Row)=>({id:w.id,name:w.name,initial:w.name.slice(0,1),sections:w.sections.map((s:Row)=>s.name),target:overview.goals.filter((g:Row)=>g.workspaceId===w.id).reduce((n:number,g:Row)=>n+g.payload.target,0),completed:overview.goals.filter((g:Row)=>g.workspaceId===w.id).reduce((n:number,g:Row)=>n+g.completed,0)}));
 const names=Object.fromEntries(overview.workspaces.map((w:Row)=>[w.id,w]));
 const events=calendar.items||[];
 if(events.some((r:Row)=>!r.workspaceId)||channels.channels.some((c:Row)=>!channels.destinations.some((d:Row)=>d.integrationId===c.id)))spaces.push({id:'__postiz__',name:'Postiz 外部渠道',initial:'P',sections:[],target:0,completed:0});
 const localDate=(value:string)=>{const d=new Date(value);return {date:dayKey(d),time:d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})};};
 return {demandCounts:overview.counts,spaces,weekStart:monday(dayKey(new Date())),demands:demands.filter(d=>d.state!=='cancelled').map(d=>({id:d.id,workspaceId:d.workspaceId,section:names[d.workspaceId]?.sections.find((s:Row)=>s.id===d.sectionId)?.name||d.sectionId,title:d.title,kind:d.kind==='translate'?'翻译':d.kind==='update'?'补充更新':'写作',state:d.state,priority:d.priority>0?'优先':'常规',due:d.payload.dueAt?dayKey(new Date(d.payload.dueAt)):'',languages:d.payload.requiredLocales,owner:d.workerId||undefined,angle:d.payload.brief||'',outline:[],requirements:d.payload.brief||'',sources:d.payload.source?[`${d.payload.source.workId} · ${d.payload.source.locale} · v${d.payload.source.revision}`]:[]})),
  publications:events.map((r:Row)=>({id:r.id,workId:r.workId||r.publicationId,workspaceId:r.workspaceId||'__postiz__',title:r.title||r.workId||r.publicationId,destination:r.destination||r.destinationId,locale:r.locale||'Postiz',...localDate(r.scheduledAt),state:['published','legacy_published','PUBLISHED'].includes(r.state)?'published':['blocked','ERROR','FAILED'].includes(r.state)?'blocked':r.state==='DRAFT'?'planned':r.source==='rssd'&&!r.hasSchedule?'ready':'scheduled'})),
  destinations:[...channels.destinations.map((d:Row)=>({name:d.name,platform:d.kind==='site'?'自家站点':d.kind==='discourse'?'Discourse':channels.channels.find((c:Row)=>c.id===d.integrationId)?.providerIdentifier||'Postiz',kind:d.kind==='site'?'owned':'external',account:d.origin||channels.channels.find((c:Row)=>c.id===d.integrationId)?.name||d.name,auth:d.kind==='site'?'站点接收服务':'中心渠道授权',state:!d.enabled?'not_connected':channels.channels.some((c:Row)=>c.id===d.integrationId&&(c.disabled||c.refreshNeeded))?'needs_attention':'connected',workspaceIds:d.workspaceIds})),...channels.channels.filter((c:Row)=>!channels.destinations.some((d:Row)=>d.integrationId===c.id)).map((c:Row)=>({name:c.name,platform:c.providerIdentifier,kind:'external',account:c.name,auth:'Postiz 原生授权',state:c.disabled||c.refreshNeeded?'needs_attention':'connected',workspaceIds:['__postiz__']}))] as PreviewData['destinations']};
}
export default function LiveCenter({onExit}:{onExit:()=>void}){
 const [data,setData]=useState<PreviewData>(empty),[loading,setLoading]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState<Row>({}),[agent,setAgent]=useState(''),[more,setMore]=useState(false),[calendarMore,setCalendarMore]=useState(false);
 const records=useRef<Row[]>([]),generation=useRef(0),pending=useRef<{fingerprint:string;requestId:string}|null>(null);
 const [limit,setLimit]=useState(200);
 const [range,setRange]=useState({from:new Date(Date.now()-31*86400000).toISOString(),to:new Date(Date.now()+62*86400000).toISOString()});
 const refresh=useCallback(async()=>{const seq=++generation.current;setLoading(true);setError('');try{
  const local=await call('status');if(!local.configured)throw Error('请先登录 RSSD 中心');
  const [overview,demands,calendar,channels]=await Promise.all([call('overview'),call('demands',{limit:200,offset:0}),call('calendar',{limit:200,...range}),call('channels')]);
  const all=[...demands];for(let offset=200;offset<limit&&all.length===offset;offset+=200)all.push(...await call('demands',{limit:200,offset}));
  if(seq!==generation.current)return;records.current=all;setStatus(local);setAgent(old=>old||local.agents?.find((a:Row)=>a.available&&a.enabled)?.id||'');setData(mapLiveCenter(overview,all,calendar,channels));setMore(all.length===limit);setCalendarMore(calendar.hasNext);
 }catch(e){if(seq===generation.current){setError(String(e));setData(empty());}}finally{if(seq===generation.current)setLoading(false);}},[limit,range]);
 useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh]);
 const manage=(tab:string,workspaceId?:string)=>{if(!status.origin){setError('中心连接尚未读取');return;}const url=new URL('/rssd',status.origin);url.searchParams.set('tab',tab);if(workspaceId&&workspaceId!=='__postiz__')url.searchParams.set('workspaceId',workspaceId);void openUrl(url.href).catch(e=>setError(String(e)));};
 const updateDemand=async(task:PreviewDemand)=>{
  const old=records.current.find(d=>d.id===task.id);if(!old)throw Error('请重新加载需求');
  const changes={title:task.title,brief:task.requirements,priority:task.priority===(old.priority>0?'优先':'常规')?old.priority:task.priority==='优先'?10:0,requiredLocales:task.languages,dueAt:task.due&&old.payload.dueAt&&task.due===dayKey(new Date(old.payload.dueAt))?old.payload.dueAt:task.due?new Date(task.due+'T23:59:59').toISOString():null};
  const fingerprint=JSON.stringify([task.id,old.generation,changes]);if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,requestId:crypto.randomUUID()};
  await call('edit_demand',{id:task.id,baseGeneration:old.generation,changes,requestId:pending.current.requestId});pending.current=null;await refresh();
 };
 const claim=async(task:PreviewDemand)=>{if(!agent)throw Error('请先在执行设置中选择可用智能体');await call('start',{agentId:agent,workspaceIds:[task.workspaceId],demandId:task.id,once:true});await refresh();};
 const assistant=<section className="cp-panel"><h2>{tr("中心助手连接")}</h2><p>{tr("在中心管理生产目标，选择本机智能体执行任务。退出桌面后，已启用的目标仍会继续维护。")}</p><p>{tr("本机助手对话将在后续客户端更新中提供。")}</p><label>{tr("本机执行智能体")}<select value={agent} onChange={e=>setAgent(e.target.value)}><option value="">{tr("选择智能体")}</option>{(status.agents||[]).map((a:Row)=><option key={a.id} value={a.id} disabled={!a.available||!a.enabled}>{a.name}{!a.available?tr(' · 未安装'):''}</option>)}</select></label><p>{status.worker?.message||tr('尚未开启本机工作模式')}</p><button onClick={()=>manage('goals')}>{tr("管理目标与常驻维护")}</button><button disabled={!status.origin} onClick={()=>void openUrl(new URL('/agents',status.origin).href).catch(e=>setError(String(e)))}>{tr("打开 Postiz 原生助手")}</button><p>{tr("目标和渠道管理使用浏览器账号；设备凭据不替代管理员权限。")}</p></section>;
 return <><CenterPreview onExit={onExit} live={{data,loading,error,refresh:()=>void refresh(),updateDemand,claim,manage,assistant,calendarRange:(from,to)=>setRange(old=>{const next={from:new Date(from+'T00:00:00').toISOString(),to:new Date(to+'T00:00:00').toISOString()};return old.from===next.from&&old.to===next.to?old:next;})}}/>
  {more&&<button disabled={loading} onClick={()=>setLimit(n=>n+200)}>{tr("加载更多需求（已读取 {{count}} 条）",{count:data.demands.length})}</button>}
  {calendarMore&&<p>{tr("当前显示前 200 条发布记录。")}<button onClick={()=>manage('calendar')}>{tr("打开中心分页查看全部")}</button></p>}
 </>;
}
