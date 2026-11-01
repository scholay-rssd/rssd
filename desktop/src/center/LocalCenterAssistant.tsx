import {useEffect,useMemo,useRef,useState} from 'react';
import {invoke} from '../lib/nativeCore';
import {tr} from '../uiText';
type Agent={id:string;name:string;available:boolean;enabled:boolean};
type Context={agentId:string;workspaceIds:string[]};
type Snapshot={state:string;message?:string;history:Array<{role:string;text:string;at:number}>};
const empty:Snapshot={state:'idle',history:[]};
export default function LocalCenterAssistant({agents,workspaceIds,manage}:{agents:Agent[];workspaceIds:string[];manage:()=>void}){
 const [agentId,setAgent]=useState(''),[text,setText]=useState(''),[snapshot,setSnapshot]=useState<Snapshot>(empty),[error,setError]=useState(''),[pending,setPending]=useState(false),[pinned,setPinned]=useState<Context|null>(null);
 const preferred=agentId||agents.find(a=>['codex','cursor'].includes(a.id)&&a.available&&a.enabled)?.id||'';
 const scopeKey=JSON.stringify(workspaceIds.filter(id=>id!=='__postiz__').sort());
 const context=useMemo(()=>pinned||{agentId:preferred,workspaceIds:JSON.parse(scopeKey)},[pinned,preferred,scopeKey]);
 const key=JSON.stringify(context),generation=useRef(0),log=useRef<HTMLDivElement>(null);
 const valid=Boolean(context.agentId&&context.workspaceIds.length),busy=pending||snapshot.state==='running';
 useEffect(()=>{
  const seq=++generation.current;setSnapshot(empty);setError('');if(!valid)return;
  const refresh=async()=>{try{const result=await invoke<Snapshot>('rssd_center_call',{method:'assistant_status',params:context});if(seq!==generation.current)return;setSnapshot(result);if(result.state!=='running')setPinned(null);}catch(e){if(seq===generation.current)setError(String(e));}};
  void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{generation.current++;clearInterval(timer);};
 },[key,valid]);
 useEffect(()=>{log.current?.scrollTo?.(0,log.current.scrollHeight);},[snapshot]);
 async function action(method:string){setPending(true);setError('');const current=context;
  try{await invoke('rssd_center_call',{method,params:{...current,...(method==='assistant_send'?{text}: {})}});if(method==='assistant_send'){setPinned(current);setSnapshot(old=>({...old,state:'running',message:tr('正在启动本机助手')}));setText('');}else if(method==='assistant_reset')setSnapshot(empty);}
  catch(e){setError(String(e));}finally{setPending(false);}
 }
 return <div className="cp-assistant cp-local-assistant"><section className="cp-conversation">
  <div className="cp-section-heading"><h2>{tr('本地中心助手')}</h2><span>{tr('通过 MCP 连接中心')}</span></div>
  <div className="cp-messages" ref={log} role="log" aria-label={tr('助手对话记录')}>
   {!snapshot.history.length&&<p>{tr('查看目标、检索已有作品、检查需求缺口，或调整尚未认领的需求。')}</p>}
   {snapshot.history.map((entry,i)=><div key={i} className={entry.role==='user'?'cp-user-message':'cp-agent-message'}><small>{entry.role==='user'?tr('你'):entry.role==='tool'?tr('中心工具'):preferred}</small><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{entry.text}</p></div>)}
  </div>
  <p role="status">{snapshot.message}</p>{error&&<p role="alert">{error}</p>}
  <form className="cp-composer" onSubmit={e=>{e.preventDefault();if(valid&&!busy&&text.trim())void action('assistant_send');}}>
   <label>{tr('本机智能体')}<select aria-label={tr('本机智能体')} disabled={busy} value={preferred} onChange={e=>setAgent(e.target.value)}><option value="">{tr('选择智能体')}</option>{agents.filter(a=>['codex','cursor'].includes(a.id)).map(a=><option key={a.id} value={a.id} disabled={!a.available||!a.enabled}>{a.name}{!a.available?tr(' · 未安装'):''}</option>)}</select></label>
   <label>{tr('给助手的指令')}<textarea aria-label={tr('给助手的指令')} value={text} onChange={e=>setText(e.target.value)} maxLength={20000} disabled={pending} rows={3}/></label>
   <div className="cp-composer-footer"><span>{tr('本轮范围')}：{context.workspaceIds.join('、')||tr('未选择工作空间')}</span><button className="cp-primary" disabled={!valid||busy||!text.trim()}>{tr('发送指令')}</button><button type="button" disabled={!valid||!busy||pending} onClick={()=>void action('assistant_cancel')}>{tr('停止助手')}</button><button type="button" disabled={!valid||busy} onClick={()=>void action('assistant_reset')}>{tr('新建对话')}</button></div>
  </form>
 </section><aside className="cp-assistant-context"><h3>{tr('当前上下文')}</h3><p>{tr('沿用本机智能体授权。对话和执行记录保留在本机；中断后可继续，或新建对话保留旧记录。')}</p><p>{tr('认领、写作和交稿使用需求池的生产执行器。目标与排期管理使用浏览器账号。')}</p><button onClick={manage}>{tr('管理目标与常驻维护')}</button></aside></div>;
}
