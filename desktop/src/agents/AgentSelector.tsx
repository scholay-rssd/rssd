import {useEffect,useRef,useState} from 'react';
import {agentModelOptions,type AgentConfiguration} from '../../scripts/agent/agent-configuration.mjs';
import {agentCall,openAgentSettings,type AgentList} from './client';
import './agents.css';
import { tr } from "../uiText";
type State={agentId?:string;agentName?:string;connected?:boolean;busy?:boolean;history?:{role:string}[];configuration?:AgentConfiguration};
export default function AgentSelector({taskId,disabled=false}:{taskId:string;disabled?:boolean}){
 const [data,setData]=useState<AgentList>(),[state,setState]=useState<State>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const activeTask=useRef(taskId);activeTask.current=taskId;
 useEffect(()=>{let live=true;setState({});setBusy(false);setError('');setData(undefined);const refresh=()=>{void Promise.all([agentCall<AgentList>('agent_list'),agentCall<State>('status',{taskId})]).then(([a,s])=>{if(live){if(Array.isArray(a?.agents))setData(a);if(s)setState(s);}}).catch(e=>{if(live)setError(String(e));});};const incoming=(event:Event)=>{const e=(event as CustomEvent).detail;if(!live||e?.taskId!==taskId)return;if(e.type==='state')setState(e);if(e.type==='configuration')setState(s=>({...s,configuration:e.configuration}));};refresh();window.addEventListener('today:agents-changed',refresh);window.addEventListener('today:agent-event',incoming);return()=>{live=false;window.removeEventListener('today:agent-event',incoming);window.removeEventListener('today:agents-changed',refresh);};},[taskId]);
 const id=state.agentId||'cursor',model=state.connected?agentModelOptions(state.configuration):undefined,locked=!!state.history?.some(m=>m.role==='user');
 async function run(method:string,params:object={}){if(busy)return;const id=taskId;setBusy(true);setError('');try{await agentCall(method,{...params,taskId:id});const next=await agentCall<State>('status',{taskId:id});if(activeTask.current===id)setState(next);}catch(e){if(activeTask.current===id)setError(String(e));}finally{if(activeTask.current===id)setBusy(false);}}
 return <div className="agent-selector"><select aria-label={tr("会话智能体")} title={locked?tr("已有会话绑定此智能体，新建对话可重新选择"):tr("选择本次会话的智能体")} disabled={disabled||busy||state.busy||locked||!data} value={id} onChange={e=>void run('agent_select',{agentId:e.target.value})}>{!data?.agents.some(a=>a.id===id)&&<option value={id}>{state.agentName||id}</option>}{data?.agents.filter(a=>a.enabled||a.id===id).map(a=><option value={a.id} key={a.id} disabled={!a.available||!a.enabled}>{a.name}{!a.available?tr(" · 不可用"):''}</option>)}</select>{model?.options.length?<select aria-label={tr("会话模型")} disabled={disabled||busy||state.busy||!state.connected} value={model.currentValue||''} onChange={e=>void run('configure',{id:model.id,value:e.target.value})}>{!model.currentValue&&<option value="" disabled>{tr("选择模型")}</option>}{model.options.map(o=><option value={o.value} key={o.value}>{o.label}</option>)}</select>:<button type="button" title={tr("连接智能体并读取可用模型")} disabled={disabled||busy||state.busy} onClick={()=>void run('connect')}>{busy?tr("连接中"):tr("连接")}</button>}<button type="button" aria-label={tr("管理写作智能体")} title={tr("管理智能体与账号")} onClick={openAgentSettings}>⚙</button>{error&&<span className="agent-selector-error" role="alert" title={error}>{error}</span>}</div>;
}

// A gallery draft has no task until its first message. Choosing here must not
// create an empty task or change the workspace's default.
export function DraftAgentSelector({value,onChange,disabled=false}:{value?:string;onChange:(id:string)=>void;disabled?:boolean}){
 const [data,setData]=useState<AgentList>();
 useEffect(()=>{let live=true;void agentCall<AgentList>('agent_list').then(a=>{if(live&&Array.isArray(a?.agents))setData(a);}).catch(()=>{});return()=>{live=false;};},[]);
 return <div className="agent-selector"><select aria-label={tr("会话智能体")} disabled={disabled||!data} value={value||''} onChange={e=>onChange(e.target.value)}><option value="">{tr("空间默认{{value}}", {value: data?' · '+(data.agents.find(a=>a.id===data.defaultAgentId)?.name||data.defaultAgentId):''})}</option>{data?.agents.filter(a=>a.enabled).map(a=><option key={a.id} value={a.id} disabled={!a.available}>{a.name}{!a.available?tr(" · 不可用"):''}</option>)}</select><button type="button" aria-label={tr("管理写作智能体")} onClick={openAgentSettings}>⚙</button></div>;
}
