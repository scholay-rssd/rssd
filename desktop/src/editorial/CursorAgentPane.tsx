import {openAgentSettings} from '../agents/client';
import NotebookConversation from './NotebookConversation';
import FlowStepRail,{type FlowStepItem} from './FlowStepRail';
import PaneToolbar from "../components/PaneToolbar";
import {memo,useEffect,useRef,useState,useMemo,useCallback,type ReactNode} from 'react';
import {invoke} from '../lib/nativeCore';
import {listen} from '@tauri-apps/api/event';
import {openUrl} from '@tauri-apps/plugin-opener';
import {renderMarkdown} from '../lib/markdown';
import {useHtmlMarkup} from '../lib/htmlMarkup';
import {lineDiff} from './agent-view';
import './cursor-agent.css';
import {agentProgress,executionRecords} from './executionRecords';
import {useAgentScroll} from './useAgentScroll';

import { tr, trKey } from "../uiText";
import { useTranslation } from "react-i18next";
type Change={articleId:string;path:string;oldText:string|null;newText:string;sha256:string;reviewed?:string};
type ToolContent={type:string;path?:string;oldText?:string;newText?:string;content?:{type:string;text?:string}};
export type Message={notebookTurnId?:string;stageLabel?:string;id:string;role:string;text:string;createdAt?:number;finished?:boolean;turnId?:string;startedAt?:number;finishedAt?:number;status?:string;attachments?:{name:string;type:string}[];tool?:{workbench?:boolean;title?:string;status?:string;kind?:string;content?:ToolContent[];rawInput?:unknown;rawOutput?:unknown;locations?:{path:string}[]};entries?:{content:string;status:string}[];change?:Change};
type Request={requestId:string;kind:string;title:string;detail?:string;html?:string;options?:{optionId:string;kind:string;name:string}[];questions?:{id:string;prompt:string;allowMultiple?:boolean;options:{id:string;label:string}[]}[]};
type State={connected:boolean;busy:boolean;status:string;root?:string;sessionId?:string;history:Message[];pending:Request[];capabilities?:{promptCapabilities?:{image?:boolean}};currentTurn?:{id:string;startedAt:number;usage?:{used:number;size:number}}};
const initial:State={connected:false,busy:false,status:trKey('尚未连接'),history:[],pending:[]};
function Icon({name}:{name:string}){const paths:Record<string,string>={panel:'M3 4h18v16H3zM9 4v16',plus:'M12 5v14M5 12h14',history:'M3 12a9 9 0 1 0 3-6M3 4v5h5M12 7v5l3 2',more:'M5 12h.01M12 12h.01M19 12h.01',copy:'M9 8h11v13H9zM5 16H3V3h11v2',retry:'M4 9h10a6 6 0 0 1 0 12M4 9l5-5M4 9l5 5',attach:'m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9',arrow:'M12 19V5M6 11l6-6 6 6',down:'m7 9 5 5 5-5',close:'m6 6 12 12M6 18 18 6',check:'m5 12 4 4L19 6',file:'M14 2H5v20h14V7zM14 2v6h5',stop:'M6 6h12v12H6z'};return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.file}/></svg>;}
const Markdown=memo(function Markdown({text}:{text:string}){const html=useMemo(()=>renderMarkdown(text),[text]);return <div className="agent-markdown" dangerouslySetInnerHTML={{__html:html}} onClick={e=>{const a=(e.target as Element).closest('a');if(a){e.preventDefault();const href=a.getAttribute('href')||'';if(/^https?:\/\//i.test(href))void openUrl(href).catch(()=>{});}}}/>;});
const Diff=memo(function Diff({path,oldText,newText}:{path:string;oldText:string;newText:string}){useTranslation();const lines=useMemo(()=>lineDiff(oldText,newText),[oldText,newText]);return <details className="cursor-diff"><summary><Icon name="file"/><span title={path}>{path.split('/').at(-1)||tr("文件修改")}</span><b className="diff-added">+{lines.filter(l=>l.kind==='add').length}</b><b className="diff-removed">−{lines.filter(l=>l.kind==='remove').length}</b></summary><div className="cursor-diff-path">{path}</div><pre>{lines.map((line,i)=><div className={'diff-'+line.kind} key={i}><span>{line.newLine||line.oldLine}</span><i>{line.kind==='add'?'+':line.kind==='remove'?'−':' '}</i>{line.text||' '}</div>)}</pre></details>;});
const AgentMessage=memo(function AgentMessage({message:m}:{message:Message}){useTranslation();
 if(m.role==='tool')return <details className={'cursor-tool is-'+m.tool?.status}><summary><span className={m.tool?.status==='in_progress'?'cursor-spinner':''}>{m.tool?.status==='completed'?'✓':m.tool?.status==='failed'?'!':'◇'}</span><span title={m.tool?.title}>{m.tool?.title||tr("工具调用")}</span><small>{({completed:tr('完成'),failed:tr('失败'),in_progress:tr('执行中'),pending:tr('等待中'),cancelled:tr('已停止'),interrupted:tr('已中断')} as Record<string,string>)[m.tool?.status||'']||''}</small></summary>{m.tool?.title&&<pre className="cursor-tool-command">{m.tool.title}</pre>}{m.tool?.locations?.map((l,i)=><p className="cursor-tool-path" key={i}>{l.path}</p>)}{m.tool?.content?.map((c,i)=>c.type==='diff'?<Diff key={i} path={c.path||''} oldText={c.oldText||''} newText={c.newText||''}/>:c.content?.text?<pre key={i}>{c.content.text}</pre>:null)}{!m.tool?.content?.length&&m.tool?.rawOutput!=null&&<pre>{typeof m.tool.rawOutput==='string'?m.tool.rawOutput:JSON.stringify(m.tool.rawOutput,null,2)}</pre>}</details>;
 if(m.role==='thought')return <details className="cursor-thought"><summary>{m.finished?tr("思考过程"):tr("思考中…")}</summary><Markdown text={m.text}/></details>;
 if(m.role==='plan')return <details className="cursor-plan" open={!m.finished}><summary>{tr("任务计划")}</summary><ol>{m.entries?.map((p,i)=><li key={i} data-status={p.status}><span>{p.status==='completed'?'✓':p.status==='in_progress'?'◉':'○'}</span>{p.content}</li>)}</ol></details>;
 if(m.role==='turn')return <div className="cursor-turn">{tr("{{status}} · 用时 {{seconds}} 秒", {status: tr(m.status||'已完成'), seconds: Math.max(1,Math.round(((m.finishedAt||0)-(m.startedAt||m.finishedAt||0))/1000))})}</div>;
 if(m.role==='change'&&m.change)return <Diff path={m.change.path} oldText={m.change.oldText||''} newText={m.change.newText}/>;
 return <ClampedMessage message={m}/>;
});
// Long assistant replies show their first lines; the rest is one click away, so a run stays scannable.
function ClampedMessage({message:m}:{message:Message}){const [open,setOpen]=useState(false),long=m.text.length>360||m.text.split('\n').length>8;return <div className={'agent-message is-'+m.role+(long&&!open?' is-clamped':'')}><Markdown text={m.text}/>{long&&<button className="agent-clamp-toggle" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?tr("收起"):tr("展开全文")}</button>}</div>;}
// Consecutive tool calls are one row ("5 个步骤"); each call inside still opens to its command, path and output.
function ToolBatch({tools}:{tools:Message[]}){
 const [open,setOpen]=useState(false),running=tools.find(t=>t.tool?.status==='in_progress'),failed=tools.filter(t=>t.tool?.status==='failed').length;
 if(tools.length===1)return <AgentMessage message={tools[0]}/>;
 return <div className={'flow-tool-batch'+(running?' is-running':'')+(failed?' has-failed':'')}><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}><span className={running?'cursor-spinner':''}>{running?'':failed?'!':'✓'}</span><strong title={running?.tool?.title}>{running?tr("正在执行：{{value}}", {value: (running.tool?.title||tr('工具调用'))}):tr("{{tools}} 个步骤", {tools: tools.length})}</strong><small>{running?tr("{{tools}} 步", {tools: tools.length}):failed?tr("{{failed}} 个失败", {failed}):tr("完成")}</small><em aria-hidden="true">{open?'▾':'▸'}</em></button>{open&&<div className="flow-tool-list">{tools.map(t=><AgentMessage key={t.id} message={t}/>)}</div>}</div>;
}
function ExecutionGroup({group}:{group:ReturnType<typeof executionRecords<Message>>[number]}){
 const [open,setOpen]=useState(group.active);
 useEffect(()=>{setOpen(group.active);},[group.active]);
 const rows:({kind:'tools';id:string;tools:Message[]}|{kind:'message';message:Message})[]=[];
 for(const m of group.messages){if(m.role==='user')continue;const last=rows.at(-1);if(m.role==='tool'){if(last?.kind==='tools')last.tools.push(m);else rows.push({kind:'tools',id:m.id,tools:[m]});}else rows.push({kind:'message',message:m});}
 const brief=[group.tools?tr('{{count}} 个步骤',{count:group.tools}):'',group.changes?tr('{{count}} 处修改',{count:group.changes}):'',group.preview].filter(Boolean).join(' · ');
 return <section className={'flow-run-group is-'+group.tone+(open?' is-open':'')}><button className="flow-run-summary" aria-expanded={open} title={group.label} onClick={()=>setOpen(v=>!v)}><span>{open?'▾':'▸'}</span><strong>{tr(group.label)||tr("执行记录")}</strong><small className="flow-run-status">{tr(group.status)}</small>{!open&&brief&&<em className="flow-run-brief">{brief}</em>}</button>{open&&<div className="flow-run-body">{rows.map(r=>r.kind==='tools'?<div className="flow-event event-tool" key={r.id}><ToolBatch tools={r.tools}/></div>:<div className={'flow-event event-'+r.message.role} key={r.message.id}><AgentMessage message={r.message}/></div>)}</div>}</section>;
}
function Decision({request:r,onRespond}:{request:Request;onRespond:(v:object)=>void}){
  const [answers,setAnswers]=useState<Record<string,string[]>>({});
  const allow=r.options?.find(x=>x.kind==='allow_once'),preview=useHtmlMarkup(r.html||'');
  return <section className="agent-request" aria-label={r.title}><strong>{r.title}</strong>{r.detail&&(r.kind==='permission'?<details><summary>{tr("查看工具参数")}</summary><pre>{r.detail}</pre></details>:<p>{r.detail}</p>)}
    {r.html&&<details><summary>{tr("查看将提交的正文与图片")}</summary><div className="agent-approval-preview editorial-prose" onClick={e=>{if((e.target as Element).closest('a'))e.preventDefault();}} dangerouslySetInnerHTML={preview}/></details>}
    {r.questions?.map(q=><fieldset key={q.id}><legend>{q.prompt}</legend>{q.options.map(o=><label key={o.id}><input type={q.allowMultiple?'checkbox':'radio'} name={r.requestId+q.id} checked={(answers[q.id]||[]).includes(o.id)} onChange={()=>setAnswers(a=>({...a,[q.id]:q.allowMultiple?((a[q.id]||[]).includes(o.id)?a[q.id].filter(x=>x!==o.id):[...(a[q.id]||[]),o.id]):[o.id]}))}/>{o.label}</label>)}</fieldset>)}
    <button disabled={r.kind==='permission'&&!allow||r.kind==='question'&&r.questions?.some(q=>!answers[q.id]?.length)} onClick={()=>onRespond({allow:true,optionId:allow?.optionId,answers:r.questions?.map(q=>({questionId:q.id,selectedOptionIds:answers[q.id]||[]}))})}>{r.kind==='permission'?tr("允许这一次"):r.kind==='question'?tr("提交回答"):tr("确认执行")}</button><button onClick={()=>onRespond({allow:false})}>{tr("取消")}</button>
  </section>;
}
export default function CursorAgentPane({active,onChanged,taskId,initialUi,onUiChange,readOnly=false,workflowRail,conversation}:{conversation?:{header:ReactNode;composer:ReactNode;welcome?:ReactNode;after?:ReactNode;afterHistory?:(messages:Message[])=>ReactNode;renderAfter?:(m:Message)=>ReactNode;tools?:ReactNode;compact?:boolean;view?:'config'|'chat'};active:boolean;onChanged:(cloud?:boolean)=>void;taskId:string;initialUi?:{scrollTop?:number;follow?:boolean};onUiChange?:(ui:{scrollTop:number;follow:boolean})=>void;readOnly?:boolean;workflowRail:{collapsed:boolean;onToggle:()=>void;steps?:FlowStepItem[]}}){
 const call=useCallback(<T,>(method:string,params:object={})=>invoke<T>('cursor_agent_call',{method,params:{...params,taskId}}),[taskId]);
 const [state,setState]=useState(initial),[error,setError]=useState(''),[auth,setAuth]=useState(''),[progress,setProgress]=useState(''),[working,setWorking]=useState(false);
 const callbacks=useRef({onChanged});callbacks.current={onChanged};
 const records=useMemo(()=>executionRecords(state.history,state.busy,state.currentTurn?.id),[state.history,state.busy,state.currentTurn?.id]);
 const run=useMemo(()=>agentProgress(state.history,state.busy,state.currentTurn?.id),[state.history,state.busy,state.currentTurn?.id]);
 const revision=useMemo(()=>({history:state.history,pending:state.pending,progress}),[state.history,state.pending,progress]);
 const {scroll,content,follow,jump,onScroll,pause}=useAgentScroll(active&&(!conversation?.compact||conversation.view==='chat'),state.sessionId,revision);
 useEffect(()=>{let disposed=false,unlisten:(()=>void)|undefined;
  let chunkTimer:ReturnType<typeof setTimeout>|undefined;let chunks=new Map<string,string>();
  function flush(){clearTimeout(chunkTimer);chunkTimer=undefined;if(!chunks.size)return;const pending=chunks;chunks=new Map();setState(s=>({...s,history:s.history.map(m=>pending.has(m.id)?{...m,text:m.text+pending.get(m.id)}:m)}));}
  void listen<Record<string,unknown>>('cursor-agent-event',({payload:e})=>{
   if(disposed||(taskId&&e.taskId!==taskId))return;
   window.dispatchEvent(new CustomEvent('today:agent-event',{detail:e}));
   if(e.type==='chunk'){const id=String(e.id);chunks.set(id,(chunks.get(id)||'')+String(e.text));if(!chunkTimer)chunkTimer=setTimeout(flush,32);return;}
   // Flush before full snapshots or tool updates to preserve protocol order.
   flush();
   if(e.type==='state')setState(e as unknown as State);
   if(e.type==='task_state')setState(s=>({...s,busy:(e.state as any).busy,status:(e.state as any).status}));
   if(e.type==='turn')setState(s=>({...s,currentTurn:e.turn as State['currentTurn']}));
   if(e.type==='message')setState(s=>({...s,history:[...s.history,e.message as Message]}));
   if(e.type==='entry')setState(s=>({...s,history:s.history.map(m=>m.id===(e.entry as Message).id?e.entry as Message:m)}));
   if(e.type==='request')setState(s=>({...s,pending:[...s.pending,e.request as Request]}));
   if(e.type==='resolved')setState(s=>({...s,pending:s.pending.filter(r=>r.requestId!==e.requestId)}));
   if(e.type==='error')setError(String(e.text));
   if(e.type==='progress')setProgress(String(e.text));
   if(e.type==='auth')setAuth(String(e.url));
   if(e.type==='changed'){callbacks.current.onChanged(e.cloud===true);}
  }).then(fn=>{if(disposed){fn();return;}unlisten=fn;void call<State>('status').then(v=>{if(!disposed){setState(v);}}).catch(e=>{if(!disposed)setError(String(e));});}).catch(e=>setError(String(e)));
  return()=>{disposed=true;clearTimeout(chunkTimer);unlisten?.();};
 },[taskId]);
 async function action(method:string,params:object={}){setError('');setWorking(true);try{const result=await call<State>(method,params);void result;}catch(e){setError(String(e));}finally{setWorking(false);}}
 const savedUi=useRef({scrollTop:0,follow:true});const onUi=useRef(onUiChange);onUi.current=onUiChange;
 savedUi.current={scrollTop:scroll.current?.scrollTop||0,follow};
 useEffect(()=>{const timer=setTimeout(()=>onUi.current?.(savedUi.current),500);return()=>clearTimeout(timer);},[follow]);
 useEffect(()=>{const flush=()=>onUi.current?.(savedUi.current);window.addEventListener('scholay-workbench-flush',flush);return()=>{window.removeEventListener('scholay-workbench-flush',flush);flush();};},[]);
 const restored=useRef(false);useEffect(()=>{if(restored.current||!state.history.length)return;restored.current=true;if(initialUi?.follow===false){pause();requestAnimationFrame(()=>{if(scroll.current)scroll.current.scrollTop=initialUi.scrollTop||0;});}},[state.history.length]);

  const collapsed=!!workflowRail?.collapsed;
  const railBusy=!readOnly&&state.busy&&!/已停止|已完成|中断|失败|异常/.test(state.status);
  const railState=state.pending.length?'waiting':railBusy?'running':/完成/.test(state.status)||readOnly?'complete':/失败|异常/.test(state.status)?'error':'idle';
  const stateText=tr({waiting:'等待你确认',running:'执行中',complete:'已完成',error:'出错',idle:'空闲'}[railState]),stage=tr((records.find(g=>g.active)||records.at(-1))?.label||''),percent=run.determinate&&run.total?Math.round(run.done/run.total*100):0;
  // Step lights: one per plan step (or per finished tool step), capped so the rail stays compact.
  const LIGHTS=12,lit=run.determinate?(run.total>LIGHTS?Math.round(run.done/run.total*LIGHTS):run.done):Math.min(run.done,LIGHTS),count=run.determinate?Math.min(run.total,LIGHTS):Math.min(run.done+(railBusy?1:0),LIGHTS);
  const lights=Array.from({length:count},(_,j)=>j<lit?'done':j===lit&&railBusy?'current':'idle');
  const detail=[stateText,stage,run.determinate?tr('{{done}}/{{total}} 步',{done:run.done,total:run.total}):run.done?tr('已完成 {{count}} 步',{count:run.done}):'',progress||run.label].filter(Boolean).join(' · ');
  if(conversation?.compact)return <aside className="notebook-conversation is-structured" aria-label={tr("写作助手")}>
   {conversation.header}<div className="notebook-tool-content" role="region" id="assistant-panel-config" aria-label={tr("文章配置")} hidden={conversation.view==='chat'}>{conversation.tools}</div>
   <div className="notebook-messages" role="region" id="assistant-panel-chat" aria-label={tr("文章对话")} hidden={conversation.view!=='chat'} ref={scroll} onScroll={onScroll} onWheel={e=>{if(e.deltaY<0)pause();}} onClickCapture={e=>{if((e.target as Element).closest('summary,button'))pause();}}><div ref={content}>
    {!state.history.length&&(conversation.welcome||<div className="notebook-welcome"><strong>{tr("从这里开始对话")}</strong></div>)}
    <NotebookConversation renderAfter={conversation?.renderAfter} messages={state.history} renderText={text=><Markdown text={text}/>} renderOther={m=><AgentMessage message={m}/>}/>
    {conversation.afterHistory?.(state.history)}{conversation.after}
   </div></div>{conversation.view==='chat'&&state.history.length>0&&!follow&&<button className="notebook-jump" onClick={jump}><Icon name="down"/>{tr("回到最新消息")}</button>}
   <div className="notebook-agent-status">
    {error&&<p role="alert">{error}</p>}{auth&&<button onClick={()=>void openUrl(auth)}>{tr("打开官方授权页面")}</button>}
    {!state.connected&&/登录|授权|失败|断开|异常/i.test(state.status)&&<button disabled={working} onClick={openAgentSettings}>{tr("管理智能体授权")}</button>}
    {!readOnly&&state.pending.map(r=><Decision key={r.requestId} request={r} onRespond={v=>void action('respond',{requestId:r.requestId,...v})}/>)}
    {state.busy&&<div className="notebook-agent-running" role="status"><span className="cursor-spinner"/><span>{state.pending.length?tr("等待你补充信息"):progress||tr("正在生成本轮候选…")}</span><button disabled={working} onClick={()=>void action('cancel')}><Icon name="stop"/>{tr("停止")}</button></div>}
   </div>{conversation.composer}
  </aside>;
  if(conversation)return <aside className="notebook-conversation" aria-label={tr("写作对话")}>
   {conversation.header}
   <div className="notebook-messages" ref={scroll} onClickCapture={e=>{if((e.target as Element).closest('summary,button'))pause();}} onScroll={onScroll} onWheel={e=>{if(e.deltaY<0)pause();}}><div ref={content}>
    {!state.history.length&&<div className="notebook-welcome"><strong>{tr("一起把想法写成文章")}</strong><p>{tr("告诉我主题，或从右侧添加素材。")}<br/>{tr("我会协助查找资料、补全内容；你随时可以直接修改。")}</p><div className="notebook-welcome-steps"><span>{tr("选择素材")}</span><i>→</i><span>{tr("逐行完善")}</span><i>→</i><span>{tr("保存成稿")}</span></div></div>}
    <NotebookConversation renderAfter={conversation?.renderAfter} messages={state.history} renderText={text=><Markdown text={text}/>} renderOther={m=><AgentMessage message={m}/>}/>
    {error&&<p role="alert">{error}</p>}
    {auth&&<button onClick={()=>void openUrl(auth)}>{tr("打开官方授权页面")}</button>}
    {!state.connected&&/登录|授权|失败|断开|异常/i.test(state.status)&&<button disabled={working} onClick={openAgentSettings}>{tr("管理智能体授权")}</button>}
    {!readOnly&&state.pending.map(r=><Decision key={r.requestId} request={r} onRespond={v=>void action('respond',{requestId:r.requestId,...v})}/>)}
   </div></div>{!follow&&<button className="notebook-jump" onClick={jump}><Icon name="down"/>{tr("回到最新消息")}</button>}{state.busy&&<div className="notebook-agent-running" role="status"><span className="cursor-spinner"/><span>{state.pending.length?tr("等待你确认"):progress||tr("正在处理…")}</span><button disabled={working} onClick={()=>void action('cancel')}><Icon name="stop"/>{tr("停止")}</button></div>}{conversation.composer}
  </aside>;
  return <aside className={'flow-runtime'+(collapsed?' is-collapsed':'')} aria-label={tr("AI 执行流程")}>
   <PaneToolbar active={active}><header className="flow-runtime-heading"><button title={collapsed?tr("展开执行记录"):tr("收起执行记录")} aria-label={collapsed?tr("展开执行记录"):tr("收起执行记录")} aria-expanded={!collapsed} onClick={workflowRail?.onToggle}><Icon name="panel"/>{!collapsed&&<span>{tr("执行记录")}</span>}</button>{collapsed&&(state.pending.length>0||error||auth)&&<button className="flow-rail-alert" aria-label={tr("展开待处理事项")} onClick={workflowRail?.onToggle}>!</button>}</header></PaneToolbar>
   {collapsed&&<button className={'flow-progress-rail is-'+railState} onClick={workflowRail.onToggle} title={detail} aria-label={tr("展开执行记录")}><span className="flow-lamp" aria-hidden="true"/><FlowStepRail compact steps={workflowRail.steps||[]}/><span className="flow-step-lights" role="progressbar" aria-label={tr("任务执行进度")} aria-valuemin={run.determinate?0:undefined} aria-valuemax={run.determinate?run.total:undefined} aria-valuenow={run.determinate?run.done:undefined} aria-valuetext={detail}>{lights.map((kind,j)=><i key={j} className={'is-'+kind}/>)}</span></button>}
   <div className="flow-runtime-body" style={collapsed?{display:'none'}:undefined}>
    <FlowStepRail steps={workflowRail.steps||[]}/>
    <section className={'flow-status-card is-'+railState} aria-label={tr("执行状态")}><span className="flow-lamp" aria-hidden="true"/><div className="flow-status-text"><strong>{stateText}</strong><small title={progress||run.label||stage}>{progress||run.label||stage||tr("暂无任务")}</small></div>{!readOnly&&state.busy&&<button disabled={working} onClick={()=>void action('cancel')}>{tr("停止")}</button>}{(run.determinate||run.done>0)&&<div className="flow-status-progress"><div className="flow-status-bar" role="progressbar" aria-label={tr("执行进度")} aria-valuemin={0} aria-valuemax={run.determinate?run.total:undefined} aria-valuenow={run.done}><i className={run.determinate?'':'is-open'} style={run.determinate?{width:percent+'%'}:undefined}/></div><small>{run.determinate?tr("{{done}}/{{total}} 步", {done: run.done, total: run.total}):tr("已完成 {{done}} 步", {done: run.done})}</small></div>}</section>
    {!readOnly&&auth&&<button onClick={()=>void openUrl(auth).catch(e=>setError(String(e)))}>{tr("打开官方授权页面")}</button>}
    {!readOnly&&(error||(!state.connected&&/登录|授权|失败|断开|中断|超时|异常|error/i.test(state.status)))&&<p className="agent-error" role="alert">{error||tr(state.status)}<button disabled={working} onClick={openAgentSettings}>{tr("管理智能体授权")}</button></p>}
    <div className="flow-event-scroll" ref={scroll} tabIndex={0} aria-label={tr("实时执行记录")} onScroll={()=>{onScroll();savedUi.current={scrollTop:scroll.current?.scrollTop||0,follow};}} onWheel={e=>{if(e.deltaY<0)pause();}} onTouchMove={pause} onKeyDown={e=>{if(['ArrowUp','PageUp','Home'].includes(e.key))pause();}}><div ref={content}>
     {!records.length&&<p className="flow-runtime-empty">{tr("暂无执行记录")}</p>}
     {records.map(group=><ExecutionGroup key={group.id} group={group}/>)}
     {!readOnly&&state.busy&&<div className="flow-live-cursor" role="status"><i/><span>{progress||tr("正在接收执行过程…")}</span></div>}
    </div></div>
    {!readOnly&&!!state.pending.length&&<div className="flow-pending">{state.pending.map(r=><Decision key={r.requestId} request={r} onRespond={v=>void action('respond',{requestId:r.requestId,...v})}/>)}</div>}

   </div>
  </aside>;
}
