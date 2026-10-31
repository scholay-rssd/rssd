import {useEffect,useMemo,useRef,useState} from 'react';
import {listen} from '@tauri-apps/api/event';
import {openUrl} from '@tauri-apps/plugin-opener';
import {renderMarkdown} from '../lib/markdown';
import {useHtmlMarkup} from '../lib/htmlMarkup';
import {taskCall,type WorkbenchTask} from './taskWorkbench';
import AgentSelector,{DraftAgentSelector} from '../agents/AgentSelector';
import {openAgentSettings} from '../agents/client';
import {useAgentScroll} from './useAgentScroll';
import {CURRENT_DOMAIN as ACADEMIC} from '../../scripts/agent/domain-pack.mjs';
import {GalleryCard,type GalleryImage} from './ImageGallery';

import { tr, trKey } from "../uiText";
type Message={id:string;role:string;text:string;finished?:boolean;status?:string;attachments?:{name:string;type:string}[];tool?:{title?:string;status?:string}};
type Request={requestId:string;kind:string;title:string;detail?:string;options?:{optionId:string;kind:string;name:string}[];questions?:{id:string;prompt:string;allowMultiple?:boolean;options:{id:string;label:string}[]}[]};
type ChatState={agentName?:string;connected:boolean;busy:boolean;status:string;sessionId?:string;history:Message[];pending:Request[]};
const emptyState:ChatState={connected:false,busy:false,status:trKey('尚未开始'),history:[],pending:[]};
const PRESETS=ACADEMIC.galleryPresets;

function Markdown({text}:{text:string}){
 const markup=useHtmlMarkup(useMemo(()=>renderMarkdown(text),[text]));
 return <div className="gallery-chat-markdown" dangerouslySetInnerHTML={markup} onClick={e=>{const a=(e.target as Element).closest('a');if(!a)return;e.preventDefault();const href=a.getAttribute('href')||'';if(/^https?:\/\//i.test(href))void openUrl(href);}}/>;
}
function Permission({request,onRespond}:{request:Request;onRespond:(p:object)=>void}){
 const [answers,setAnswers]=useState<Record<string,string[]>>({});
 const allow=request.options?.find(o=>o.kind==='allow_once');
 return <section className="gallery-chat-request"><strong>{request.title}</strong>{request.detail&&<details><summary>{tr("查看详情")}</summary><pre>{request.detail}</pre></details>}{request.questions?.map(q=><fieldset key={q.id}><legend>{q.prompt}</legend>{q.options.map(o=><label key={o.id}><input type={q.allowMultiple?'checkbox':'radio'} name={request.requestId+q.id} checked={(answers[q.id]||[]).includes(o.id)} onChange={()=>setAnswers(a=>({...a,[q.id]:q.allowMultiple?(a[q.id]||[]).includes(o.id)?a[q.id].filter(x=>x!==o.id):[...(a[q.id]||[]),o.id]:[o.id]}))}/>{o.label}</label>)}</fieldset>)}<div><button disabled={request.kind==='permission'&&!allow||request.kind==='question'&&request.questions?.some(q=>!answers[q.id]?.length)} onClick={()=>onRespond({allow:true,optionId:allow?.optionId,answers:request.questions?.map(q=>({questionId:q.id,selectedOptionIds:answers[q.id]||[]}))})}>{request.kind==='question'?tr("提交回答"):tr("允许这一次")}</button><button onClick={()=>onRespond({allow:false})}>{tr("取消")}</button></div></section>;
}

export default function GalleryConversation({active,task,draft,onDraft,onTask,onChanged,onError}:{active:boolean;task?:WorkbenchTask;draft:string;onDraft:(v:string)=>void;onTask:(t:WorkbenchTask)=>void;onChanged:()=>void;onError?:(message:string)=>void}){
 const [state,setState]=useState<ChatState>(emptyState),[text,setText]=useState(task?.ui.composer||draft),[working,setWorking]=useState(false),[error,setError]=useState(''),[auth,setAuth]=useState(''),[progress,setProgress]=useState(''),[draftAgent,setDraftAgent]=useState('');
 const sendLock=useRef(false),draftRef=useRef(text),taskRef=useRef(task),callbacks=useRef({onTask,onChanged,onDraft});
 taskRef.current=task;draftRef.current=text;callbacks.current={onTask,onChanged,onDraft};
 const revision=useMemo(()=>({history:state.history,pending:state.pending,progress}),[state.history,state.pending,progress]);
 const {scroll,content,follow,jump,onScroll,pause}=useAgentScroll(active,state.sessionId,revision);
 const finished=!!task?.completedAt,busy=working||state.busy;
 const assets:GalleryImage[]=(task?.assets||[]).map(a=>({...a,taskId:task!.id,key:task!.id+':'+a.id,taskTitle:task!.title}));
 useEffect(()=>{if(!task)setText(draft);},[draft,task?.id]);
 useEffect(()=>{
  if(!task)return;
  let disposed=false,unlisten:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined;const chunks=new Map<string,string>();
  const flush=()=>{clearTimeout(timer);timer=undefined;if(!chunks.size)return;const pending=new Map(chunks);chunks.clear();setState(s=>({...s,history:s.history.map(m=>pending.has(m.id)?{...m,text:m.text+pending.get(m.id)}:m)}));};
  const reload=()=>void taskCall<WorkbenchTask>('task_get',{taskId:task.id}).then(t=>{if(!disposed)callbacks.current.onTask(t);}).catch(e=>{if(!disposed)setError(String(e));});
  void listen<Record<string,unknown>>('cursor-agent-event',({payload:e})=>{
   if(disposed||e.taskId!==task.id)return;
   window.dispatchEvent(new CustomEvent('today:agent-event',{detail:e}));
   if(e.type==='chunk'){const id=String(e.id);chunks.set(id,(chunks.get(id)||'')+String(e.text));if(!timer)timer=setTimeout(flush,32);return;}
   flush();
   if(e.type==='state'){setState(e as unknown as ChatState);if(!e.busy)reload();}
   if(e.type==='task_state')setState(s=>({...s,busy:!!(e.state as ChatState).busy,status:(e.state as ChatState).status}));
   if(e.type==='message')setState(s=>({...s,history:[...s.history,e.message as Message]}));
   if(e.type==='entry')setState(s=>({...s,history:s.history.map(m=>m.id===(e.entry as Message).id?e.entry as Message:m)}));
   if(e.type==='request')setState(s=>({...s,pending:[...s.pending,e.request as Request]}));
   if(e.type==='resolved')setState(s=>({...s,pending:s.pending.filter(r=>r.requestId!==e.requestId)}));
   if(e.type==='error')setError(String(e.text));
   if(e.type==='auth')setAuth(String(e.url));
   if(e.type==='progress')setProgress(String(e.text));
   if(e.type==='task_changed'||e.type==='changed'){reload();callbacks.current.onChanged();}
  }).then(fn=>{if(disposed){fn();return;}unlisten=fn;void taskCall<ChatState>('status',{taskId:task.id}).then(s=>{if(!disposed)setState({...emptyState,...s});}).catch(e=>{if(!disposed)setError(String(e));});}).catch(e=>setError(String(e)));
  return()=>{disposed=true;clearTimeout(timer);unlisten?.();};
 },[task?.id]);
 // The draft belongs to this conversation and survives switching away or exiting.
 useEffect(()=>{
  if(!task||finished)return;
  const id=task.id,timer=setTimeout(()=>void taskCall<WorkbenchTask>('task_update',{taskId:id,patch:{ui:{composer:draftRef.current}}}).catch(e=>setError(String(e))),300);
  return()=>clearTimeout(timer);
 },[text,task?.id,finished]);
 useEffect(()=>{
  const flush=(event?:Event)=>{
   const t=taskRef.current;if(!t||t.completedAt)return;
   const save=taskCall('task_update',{taskId:t.id,patch:{ui:{composer:draftRef.current,scrollTop:scroll.current?.scrollTop||0,follow}}});
   const promises=(event as CustomEvent<{promises?:Promise<unknown>[]}>|undefined)?.detail?.promises;
   if(Array.isArray(promises))promises.push(save);else void save.catch(()=>{});
  };
  window.addEventListener('scholay-workbench-flush',flush);return()=>{window.removeEventListener('scholay-workbench-flush',flush);flush();};
 },[follow]);
 const restored=useRef(false);useEffect(()=>{if(restored.current||!state.history.length)return;restored.current=true;if(task?.ui.follow===false){pause();requestAnimationFrame(()=>{if(scroll.current)scroll.current.scrollTop=task.ui.scrollTop||0;});}},[state.history.length]);
 async function send(){
  const message=text.trim();if(!message||busy||finished||sendLock.current)return;sendLock.current=true;setWorking(true);setError('');
  try{let t=task;if(!t)t=await taskCall<WorkbenchTask>('task_create',{mode:'image',title:message.slice(0,60),brief:message,...(draftAgent?{agentId:draftAgent}:{})});
   try{await taskCall('gallery_prompt',{taskId:t.id,text:message});}catch(e){await taskCall('task_update',{taskId:t.id,patch:{ui:{composer:message}}}).catch(()=>{});callbacks.current.onTask({...t,ui:{...t.ui,composer:message}});throw e;}
   setText('');callbacks.current.onDraft('');await taskCall('task_update',{taskId:t.id,patch:{ui:{composer:''}}});callbacks.current.onTask({...t,ui:{...t.ui,composer:''}});
  }catch(e){setError(String(e));onError?.(String(e));}finally{sendLock.current=false;setWorking(false);}
 }
 async function action(method:string,params:object={}){if(!task)return;setWorking(true);setError('');try{const result=await taskCall<WorkbenchTask>(method,{...params,taskId:task.id});if(method==='task_finish')onTask(result);}catch(e){setError(String(e));}finally{setWorking(false);}}
 return <section className="gallery-conversation" aria-label={tr("图库图片对话")}><header className="gallery-chat-toolbar"><strong title={task?.title}>{task?.title||tr("新建图片对话")}</strong><div>{state.busy?<button disabled={working} onClick={()=>void action('cancel')}>{tr("停止")}</button>:task&&!finished&&<button disabled={busy} onClick={()=>void action('task_finish')}>{tr("结束对话")}</button>}</div></header><div className="gallery-chat-panels"><section className="gallery-chat-main"><div className="gallery-chat-scroll" ref={scroll} onScroll={onScroll} onWheel={e=>{if(e.deltaY<0)pause();}} onTouchMove={pause} tabIndex={0} aria-label={tr("图片对话记录")}><div ref={content}>{!state.history.length&&<div className="gallery-chat-start"><h2>{tr("在图库创作图片")}</h2><div>{PRESETS.map(p=><button key={p} disabled={finished||busy} onClick={()=>{setText(p);onDraft(p);}}>{p}</button>)}</div></div>}{state.history.map(m=>m.role==='user'||m.role==='assistant'?<article key={m.id} className={'gallery-chat-message is-'+m.role}><small>{m.role==='user'?tr("你"):state.agentName||tr("智能体")}</small><Markdown text={m.text}/>{m.attachments?.map((a,i)=><small key={i}>{a.name}</small>)}</article>:m.role==='tool'?<details className="gallery-chat-tool" key={m.id}><summary><span className={state.busy&&m.tool?.status==='in_progress'?'cursor-spinner':''}>{m.tool?.status==='completed'?'✓':m.tool?.status==='failed'?'!':'◇'}</span>{m.tool?.title||tr("执行记录")}</summary></details>:m.role==='thought'?<details className="gallery-chat-tool" key={m.id}><summary>{tr("思考过程")}</summary><Markdown text={m.text}/></details>:m.role==='turn'?<p className="gallery-chat-turn" key={m.id}>{m.status||tr("已完成")}</p>:null)}{state.busy&&<p className="gallery-chat-running" role="status"><i className="cursor-spinner"/>{progress||tr(state.status)||tr("正在生成图片…")}</p>}</div></div>{!follow&&<button className="gallery-chat-follow" onClick={jump}>{tr("回到最新消息")}</button>}{state.pending.map(r=><Permission key={r.requestId} request={r} onRespond={p=>void action('respond',{requestId:r.requestId,...p})}/>)}{error&&<p className="gallery-chat-error" role="alert">{error}</p>}{auth&&!finished&&<button className="gallery-chat-auth" onClick={()=>void openUrl(auth)}>{tr("打开官方授权页面")}</button>}{!state.connected&&!finished&&/登录|授权|失败|断开|中断|超时|异常|error/i.test(state.status)&&<button className="gallery-chat-auth" disabled={working} onClick={openAgentSettings}>{tr("管理智能体授权")}</button>}{finished?<div className="gallery-chat-finished">{tr("此对话已结束；可以新建图片对话。")}</div>:<form className="gallery-chat-composer" onSubmit={e=>{e.preventDefault();void send();}}><textarea aria-label={tr("图片生成要求")} placeholder={tr("描述图片内容、风格和比例，也可以继续调整上一张图片")} value={text} disabled={busy} onChange={e=>{setText(e.target.value);onDraft(e.target.value);}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div><span title={tr("图片生成取决于所选智能体的能力")}>{task?<AgentSelector taskId={task.id} disabled={busy}/>:<DraftAgentSelector value={draftAgent} onChange={setDraftAgent} disabled={busy}/>}</span><button type="submit" disabled={busy||!text.trim()} aria-label={tr("发送图片要求")}>{tr("发送")}</button></div></form>}</section><aside className="gallery-chat-results" aria-label={tr("当前对话图片")}><header>{tr("生成结果")}</header>{assets.length?<div className="gallery-grid">{assets.map(item=><GalleryCard key={item.key} item={item}/>)}</div>:<div className="gallery-chat-no-images">{state.busy?tr("正在生成；完成后的图片会显示在这里"):tr("本次对话的图片会显示在这里")}</div>}</aside></div></section>;
}
