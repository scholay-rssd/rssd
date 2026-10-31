import AgentSelector from '../agents/AgentSelector';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {invoke} from '../lib/nativeCore';
import TaskCanvas from './TaskCanvas';
import CursorAgentPane from './CursorAgentPane';
import {type FlowStepItem} from './FlowStepRail';
import WorkDetail,{type EditorContext} from './WorkDetail';
import {type Work} from './contentLibrary';
import {TASK_MODES,taskCall,type WorkbenchTask,type WorkflowStep,type WorkflowAction,type WorkflowCheck,type TaskRunState,type TaskUi,type CanvasDraft} from './taskWorkbench';
import {defaultDays} from '../../scripts/agent/task-types.mjs';
import {CURRENT_DESTINATION as SCHOLAY_TODAY,useOptions} from '../../scripts/agent/destinations.mjs';
import {DraftPreview,EmptyPreview} from './ArticlePreview';
import {pendingRunPhase,pendingStageMessage,workflowArtifactReady,workflowSlotLayout,workflowStageGate} from './workflowLifecycle';
import './structured-workflow.css';

import { tr, trKey } from "../uiText";
const noLocal=()=>{};
const STEPS:[WorkflowStep,string][]=[['topic',trKey('选题')],['outline',trKey('生成')],['draft',trKey('编辑')],['deliver',trKey('交稿')]];
export type Props={extensionHost?:HTMLElement|null;task:WorkbenchTask;active:boolean;run:TaskRunState;work?:Work;refreshToken:number;obscured:boolean;agentBusy:boolean;onAccept:(t:WorkbenchTask)=>void;onUi:(p:Partial<TaskUi>)=>void;onSave:(p:object,revision?:number)=>Promise<void>;onDraft:(kind:'board'|'outline',draft:CanvasDraft|null)=>void;onRefresh:()=>void;onChanged:()=>void;onCloudChanged:()=>Promise<void>;onOpenUrl:(url:string,title:string)=>void;onEditorContext:(v:EditorContext)=>void;onOpenLocal:(id:string)=>void};
export function WorkflowSkeleton({step}:{step:WorkflowStep}){return <div className={'flow-skeleton skeleton-'+step} role="status" aria-label={tr("正在准备内容")} aria-busy="true"><span className="flow-skeleton-label">{step==='topic'?tr("正在整理素材卡片"):step==='outline'?tr("正在编排内容块"):step==='draft'?tr("正在生成正文与配图占位"):tr("正在检查正文与来源")}…</span><div className="flow-skeleton-cards" aria-hidden="true">{Array.from({length:step==='topic'?3:step==='outline'?4:2},(_,i)=><div className="flow-skeleton-card" key={i}>{step==='draft'&&<div className="skeleton-image"/>}<i/><i/><i/><small/></div>)}</div></div>;}
function WorkflowPlaceholder({task,step,loading,blocked,onGenerate}:{task:WorkbenchTask;step:WorkflowStep;loading:boolean;blocked:boolean;onGenerate:(kind:'outline'|'draft')=>void}){
 const gate=workflowStageGate(task,step,loading),layout=workflowSlotLayout(task.mode,step),primary=gate.primary,generate=primary?.generate&&!loading&&!blocked&&!primary.disabled?primary.generate:undefined;
 const hint=tr(loading?'AI 正在生成…':generate?'点击由 AI 生成':primary?.generate?'等待授权':step==='deliver'?'有正文后在此预览':'上一步确认后由 AI 生成');
 // Every blank is one slot; while AI can fill it, clicking the slot starts that generation.
 const slot=(label:string,key:string|number,tall=false)=>{const body=<><span>{tr(label)}</span><small>{hint}</small></>,cls='gate-slot'+(tall?' is-tall':'')+(loading?' is-loading':'');return generate?<button key={key} className={cls} type="button" onClick={()=>onGenerate(generate)}>{body}</button>:<div key={key} className={cls}>{body}</div>;};
 const banner=<header className="flow-gate-banner"><div><h3>{tr(gate.title)}{loading&&<i className="flow-gate-spinner" aria-hidden="true"/>}</h3><p>{tr(gate.detail)}</p><ul className="flow-gate-checks">{gate.checks.map(c=><li key={c.label} data-ok={c.ok}><span aria-hidden="true">{c.ok?'✓':'○'}</span>{tr(c.label)}</li>)}</ul></div>{primary?.generate&&!loading&&<button className="task-primary" disabled={blocked||!!primary.disabled} onClick={()=>onGenerate(primary.generate!)}>{'AI '+tr(primary.label)}</button>}</header>;
 return <section className={'flow-stage-placeholder flow-stage-gate is-'+step} aria-label={tr("{{value}}内容占位", {value: tr(STEPS.find(([key])=>key===step)?.[1]??'')})} aria-busy={loading} role={loading?'status':undefined}>
  {banner}
  {step==='outline'&&<section className="gate-outline">
   <ul className="gate-titles">{Array.from({length:layout.titles},(_,i)=><li key={i}>{slot(tr('标题候选 {{n}}',{n:i+1}),i)}</li>)}</ul>
   {layout.blocks.map((label,i)=><article className="gate-block" key={i}><header><span>{i+1} · {tr(label)}</span></header>{slot(label,'b'+i,true)}</article>)}
  </section>}
  {(step==='draft'||step==='review')&&<section className="gate-columns">
   {layout.columns.map(label=><article className="gate-pane" key={label}><h4>{tr(label)}</h4>{slot(label,label,true)}{label==='预览'&&Array.from({length:layout.images},(_,i)=>slot(tr('配图 {{n}}',{n:i+1}),'img'+i))}</article>)}
  </section>}
 </section>;
}
function flowSteps(task:WorkbenchTask,step:WorkflowStep,generating:boolean,pending:{action:string}|null|undefined,work?:Work):FlowStepItem[]{
 const steps=STEPS,current=steps.findIndex(([k])=>k===step);
 const cards=task.board.sections.reduce((n,x)=>n+x.items.length,0);
 const detail=(key:WorkflowStep,state:string)=>{
  if(state==='todo')return '';
  const live=generating&&state==='active';
  if(key==='topic')return state==='done'?(cards?tr('{{count}} 张素材卡片 · 已确认',{count:cards}):tr('已确认')):tr(live?'AI 正在收集素材…':'核对素材后确认');
  if(key==='outline')return state==='done'?tr('{{count}} 个内容块 · 已确认',{count:task.outline.blocks.length}):tr(live||pending?.action==='outline'?'AI 正在生成大纲…':'核对大纲后确认');
  if(key==='draft')return tr(state==='done'?'正文已确认':live||pending?.action==='draft'?'AI 正在生成正文…':work?'编辑正文，确认后交稿':'等待生成正文');
  return tr(task.delivery?.destination==='cloud'?'已公开到官网':'已保存到本地');
 };
 return steps.map(([key,label],i)=>{const state=(task.completedAt&&(key==='deliver'||i<current)||i<current?'done':i===current?(task.completedAt?'done':'active'):'todo') as FlowStepItem['state'];return {key,label:tr(label),state,text:detail(key,state)};});
}
const ASK:Record<'topic'|'outline'|'deliver',[string,string]>={topic:[trKey('确认选题'),trKey('确认后进入「生成」，选题将锁定，不能返回修改。')],outline:[trKey('确认大纲'),trKey('确认后将生成正文，大纲将锁定，不能返回修改。')],deliver:[trKey('确认交稿'),trKey('确认后正文自动保存到本地，任务随即结束，不能再修改。')]};
export default function StructuredWorkflow(p:Props){
 const {task,run,work,active}=p;
 // One-way flow: the step follows what has been confirmed; it is never chosen by hand.
 const step:WorkflowStep=task.completedAt&&work?'deliver':task.workIds.length||task.outlineConfirmed?'draft':task.topicConfirmed?'outline':'topic';
 const brief=task.ui.flowDraft?.brief??task.brief,days=task.ui.flowDraft?.days??task.days??defaultDays(task.mode),sources=task.ui.flowDraft?.sources??task.workflow?.sources??'combined';
 const [working,setWorking]=useState(false),[error,setError]=useState(''),[check,setCheck]=useState<WorkflowCheck|null>(null),[checking,setChecking]=useState(false),[dirty,setDirty]=useState(false),[editorBusy,setEditorBusy]=useState(false),[querying,setQuerying]=useState(false),[ask,setAsk]=useState<{stage:'topic'|'outline'|'deliver';revision:number;done:()=>void}|null>(null),[actionHost,setActionHost]=useState<HTMLDivElement|null>(null);
 const cloudDirty=false,cloudBusy=false,cloudPending=false;
 const checkEpoch=useRef(0),commandLock=useRef(false),topicRun=useRef<{id:string;at:number}|null>(null);
 const [slotQueue,setSlotQueue]=useState<string[]>([]),[queueTick,setQueueTick]=useState(0);
 const pending=task.ui.flowPending;
 // The preview is a permanent pane; which side it sits on is the user's preference.
 const [previewHost,setPreviewHost]=useState<HTMLDivElement|null>(null),[previewSide,setPreviewSide]=useState<'left'|'right'>(()=>{try{return localStorage.getItem('scholay.workbench.previewSide')==='left'?'left':'right';}catch{return 'right';}});
 const swapPreview=()=>setPreviewSide(side=>{const next=side==='right'?'left':'right';try{localStorage.setItem('scholay.workbench.previewSide',next);}catch{/* keep the in-memory side */}return next;});
 // Where the finished post is used is decided at delivery, not while it is produced.
 const uses=useMemo(()=>useOptions(task.mode),[task.mode]),[use,setUse]=useState('');
 const finishing=useRef(false),startedRun=useRef<string|null>(null),stepRef=useRef(step);stepRef.current=step;
 const contextRef=useRef('');
 const editorContext=useCallback((v:EditorContext)=>{contextRef.current=v.context;setDirty(v.dirty);setEditorBusy(!!v.busy);},[]);
 useEffect(()=>{p.onEditorContext({context:contextRef.current||work?.title||task.title,dirty:dirty||cloudDirty,busy:editorBusy||cloudBusy||working});},[dirty,cloudDirty,editorBusy,cloudBusy,cloudPending,working,work?.title,task.title,p.onEditorContext]);
 const blocked=!!task.completedAt||working||!!run.busy||!!run.queued||!!pending||!!task.archived||!!task.deleted;
 const hasPendingCloud=cloudPending||!!check?.pendingCloudRequest;
 const editingLocked=dirty||editorBusy||cloudDirty||cloudBusy||hasPendingCloud;
 async function inspect(){const epoch=++checkEpoch.current;setChecking(true);try{const result=await taskCall<WorkflowCheck>('task_check',{taskId:task.id});if(epoch===checkEpoch.current)setCheck(result);return result;}finally{if(epoch===checkEpoch.current)setChecking(false);}}
 useEffect(()=>{if(active&&work&&!task.completedAt&&!run.busy&&!pending)void inspect().catch(e=>setError(String(e)));},[active,step,task.revision,task.draftStale,p.refreshToken,run.busy,pending]);
 async function startGeneration(t:WorkbenchTask,kind:'outline'|'draft',source:WorkflowStep){
  const started=await taskCall<{runId:string}>('task_run',{taskId:t.id,action:kind});
  if(!started.runId)throw Error(tr('未收到任务运行编号，请重新读取任务状态'));
  startedRun.current=started.runId;
  p.onUi({flowPending:{runId:started.runId,previousRunId:run.runId||t.runtime?.runId,action:kind,source,target:kind,revision:t.revision,confirmation:(kind==='outline'?t.topicConfirmed:t.outlineConfirmed)||undefined,generatedAt:t.generated?.at}});
 }
 async function action(kind:WorkflowAction,target?:string){if(blocked||editingLocked||commandLock.current)return;commandLock.current=true;setWorking(true);setError('');try{if(kind==='outline'||kind==='draft')await startGeneration(task,kind,step);else await taskCall('task_run',{taskId:task.id,action:kind,target});}catch(e){setError(String(e));}finally{commandLock.current=false;setWorking(false);}}
 async function authorize(slot?:string){if(blocked||editingLocked||commandLock.current)return;commandLock.current=true;setWorking(true);setError('');try{
  let t=task;if(brief!==t.brief||days!==t.days)t=await taskCall<WorkbenchTask>('task_update',{taskId:task.id,patch:{brief,days},expectedRevision:task.revision});
  t=await taskCall<WorkbenchTask>('task_workflow',{taskId:task.id,action:'configure',sources,authorized:true,expectedRevision:t.revision});p.onAccept(t);p.onUi({flowDraft:null});
  const started=await taskCall<{runId?:string}|undefined>('task_run',{taskId:task.id,action:'topic',...(slot?{target:slot}:{})});
  topicRun.current=started?.runId?{id:started.runId,at:Date.now()}:null;
 }catch(e){setError(String(e));}finally{commandLock.current=false;setWorking(false);}}
 // Per-card retrieval runs one slot at a time: extra clicks queue here and start only after the previous run has finished,
 // so two runs never save the board concurrently or repeat the same event.
 function collectSlot(slotId:string){
  if(task.completedAt||task.archived||task.deleted||slotQueue.includes(slotId))return;
  if(!task.board.sections.some(s=>s.slots?.some(x=>x.id===slotId&&x.mode==='smart'&&!s.items.some(i=>i.id===slotId))))return;
  if(blocked||commandLock.current||slotQueue.length){setSlotQueue(q=>q.includes(slotId)?q:[...q,slotId]);return;}
  void authorize(slotId);
 }
 async function confirm(stage:string,revision=task.revision){
  if(editingLocked||blocked||commandLock.current)throw Error(tr('请先保存并等待当前操作完成'));
  commandLock.current=true;setWorking(true);setError('');
  try{let t=await taskCall<WorkbenchTask>('task_confirm',{taskId:task.id,stage,expectedRevision:revision});if(!t.workflow?.authorized)t=await taskCall<WorkbenchTask>('task_workflow',{taskId:task.id,action:'configure',sources,authorized:true,expectedRevision:t.revision});p.onAccept(t);const source=stage==='topic'?'topic':'outline';p.onUi({flowStep:source});await startGeneration(t,stage==='topic'?'outline':'draft',source);}catch(e){setError(String(e));throw e;}finally{commandLock.current=false;setWorking(false);}
 }
 async function finishLocal(){
  if(editingLocked||blocked||commandLock.current)return;
  commandLock.current=true;setWorking(true);setError('');
  try{
   const result=await inspect();
   if(result.pendingCloudRequest)throw Error(tr('云端原请求结果尚未确认，请先查询原请求'));
   if(!result.draftReady||!result.sha256)throw Error(tr('请先保存正文并处理稿件检查项'));
   // The use chosen at delivery is applied through the library's own column action, so a structured record keeps its bound column.
   if(work?.local&&use&&use!==work.category)await invoke('website_publish_call',{method:'local_action',params:{id:work.id,action:'category',category:use,expectedFingerprint:work.local.sync?.fingerprint}});
   const t=await taskCall<WorkbenchTask>('task_finish',{taskId:task.id,destination:'local',expectedRevision:task.revision,expectedSha256:result.sha256,expectedFingerprint:result.fingerprint});
   p.onAccept(t);p.onChanged();
  }catch(e){setError(String(e));}finally{commandLock.current=false;setWorking(false);}
 }
 // Every step is confirmed twice (button, then this dialog) and cannot be reopened afterwards.
 function askConfirm(stage:string,revision=task.revision){return new Promise<void>(resolve=>setAsk({stage:stage as 'topic'|'outline',revision,done:resolve}));}
 async function proceed(){const a=ask;if(!a)return;setAsk(null);try{if(a.stage==='deliver')await finishLocal();else await confirm(a.stage,a.revision);}catch(e){setError(String(e));}finally{a.done();}}
 function cancelAsk(){ask?.done();setAsk(null);}
 async function queryOriginalRequest(){
  if(!check?.pendingCloudRequest||querying||commandLock.current)return;
  setQuerying(true);setError('');
  try{const result=await invoke<{stage?:string}>('website_publish_call',{method:check.pendingCloudRequest.kind==='action'?'cloud_action_status':'status',params:{id:task.articleId}});if(['published','cleanup'].includes(result?.stage||''))await finishCloud();else{await inspect();p.onChanged();await p.onCloudChanged();}}catch(e){setError(String(e));}finally{setQuerying(false);}
 }
 async function finishCloud(){
  if(commandLock.current)return;
  commandLock.current=true;setWorking(true);setError('');
  try{
   const recovering=task.delivery?.destination==='cloud'&&['retiring','cleanup_blocked'].includes(task.delivery.phase||'');
   const result=recovering?task.delivery:await taskCall<WorkflowCheck>('task_check',{taskId:task.id});
   if(!recovering&&!(result as WorkflowCheck).draftReady)throw Error(tr('稿件内容已变化，请保存并重新检查'));
   const t=await taskCall<WorkbenchTask>('task_finish',{taskId:task.id,destination:'cloud',delivered:true,expectedRevision:task.revision,expectedSha256:recovering?task.delivery?.sha256:(result as WorkflowCheck).sha256,expectedFingerprint:result?.fingerprint});
   p.onAccept(t);
  }catch(e){setError(String(e));p.onAccept(await taskCall<WorkbenchTask>('task_get',{taskId:task.id}).catch(()=>task));throw e;}
  finally{try{p.onChanged();await p.onCloudChanged();}finally{commandLock.current=false;setWorking(false);}}
 }

 useEffect(()=>{
  if(!pending||working||finishing.current)return;
  if(task.completedAt){p.onUi({flowPending:null});return;}
  const currentRun=run.runId===pending.runId?run:(!run.runId||run.runId===pending.previousRunId)&&task.runtime?.runId===pending.runId?task.runtime:run.runId?run:task.runtime||run;
  const phase=pendingRunPhase(pending,currentRun,startedRun.current===pending.runId);
  if(currentRun.runId===pending.runId)startedRun.current=null;
  if(phase==='waiting')return;
  startedRun.current=null;
  if(phase==='failed'||phase==='replaced'){p.onUi({flowPending:null});setError(pendingStageMessage(pending));return;}
  let cancelled=false;finishing.current=true;
  void (async()=>{
   const t=await taskCall<WorkbenchTask>('task_get',{taskId:task.id});
   const result=pending.action==='draft'?await taskCall<WorkflowCheck>('task_check',{taskId:task.id}):undefined;
   if(cancelled)return;
   if(!workflowArtifactReady(pending,t,result))throw Error(pendingStageMessage(pending,true));
   p.onAccept(t);if(result)setCheck(result);p.onChanged();
   p.onUi({flowPending:null,...(stepRef.current===pending.source?{flowStep:pending.target}:{})});
  })().catch(e=>{if(!cancelled){p.onUi({flowPending:null});setError(String(e));}}).finally(()=>{finishing.current=false;});
  return()=>{cancelled=true;finishing.current=false;};
 },[pending,run.runId,run.busy,run.queued,run.status,run.lastRunStatus,task.runtime?.runId,task.runtime?.busy,task.runtime?.queued,task.runtime?.status,task.runtime?.lastRunStatus,working,task.id,task.completedAt]);
 useEffect(()=>{
  if(!slotQueue.length||!active||step!=='topic'||blocked||editingLocked||commandLock.current)return;
  const started=topicRun.current;
  if(started&&run.runId!==started.id&&Date.now()-started.at<20000){const timer=setTimeout(()=>setQueueTick(v=>v+1),2000);return()=>clearTimeout(timer);}
  topicRun.current=null;const [next,...rest]=slotQueue;setSlotQueue(rest);
  if(task.board.sections.some(s=>s.slots?.some(x=>x.id===next&&x.mode==='smart'&&!s.items.some(i=>i.id===next))))void authorize(next);
 },[slotQueue,active,step,blocked,editingLocked,run.runId,queueTick,task.board]);
 const workVisible=step==='draft'||step==='deliver';
 const generating=!task.completedAt&&(!!run.busy||!!run.queued||working||!!pending);
 const stageAction=pending?.action||run.lastAction?.action;
 const loadingHere=generating&&(step==='topic'&&(!stageAction||['topic','section','append','item'].includes(stageAction))||step==='outline'&&(!stageAction||['outline','block'].includes(stageAction))||step==='draft'&&(!stageAction||['draft','image'].includes(stageAction)));
 const canvas=(kind:'board'|'outline'|'images')=><TaskCanvas key={kind} task={task} kind={kind} loading={loadingHere} actionHost={actionHost} busy={blocked||editingLocked} preparing={!!pending&&(kind==='board'?pending.action==='outline'&&pending.source==='topic':pending.action==='draft'&&pending.source==='outline')} onCollect={()=>void authorize()} onCollectSlot={collectSlot} queuedSlots={slotQueue} canQueue={!task.completedAt&&!task.archived&&!task.deleted&&!editingLocked&&!working&&!pending} onSave={p.onSave} onDraft={p.onDraft} onConfirm={askConfirm} onPrompt={()=>{}} onAction={(a,t)=>void action(a,t)} onOpenUrl={p.onOpenUrl} onRefresh={p.onRefresh} previewHost={previewHost}/>;
 return <section className="structured-workflow" aria-label={tr("{{TASK_MODES}}创作流程", {TASK_MODES: TASK_MODES[task.mode]})}>
  {ask&&<div className="flow-confirm-scrim"><div className="flow-confirm-dialog" role="alertdialog" aria-label={tr(ASK[ask.stage][0])}><strong>{tr(ASK[ask.stage][0])}</strong><p>{tr(ASK[ask.stage][1])}</p>{ask.stage==='deliver'&&uses.length>0&&<label className="flow-confirm-use">{tr("用途")}<select aria-label={tr("稿件用途")} value={use||work?.category||uses[0]} disabled={uses.length<2} onChange={e=>setUse(e.target.value)}>{uses.map(x=><option key={x} value={x}>{SCHOLAY_TODAY.name} · {x}</option>)}</select><small>{uses.length<2?tr("这类内容带有结构化字段，用途由内容类型决定。"):tr("按内容类型推荐，可在此改为其他用途；之后也能在作品库中调整。")}</small></label>}<div><button onClick={cancelAsk}>{tr("再看看")}</button><button className="task-primary" onClick={()=>void proceed()}>{tr("确认")}</button></div></div></div>}

  {error&&<div className="work-notice is-error" role="alert">{error}<button onClick={()=>setError('')}>{tr("收起")}</button></div>}
  <div className="flow-panels">

   <section className="flow-content-panel" aria-label={tr("流程内容")}>
    {!task.completedAt&&<div className="flow-navigation"><h2 className="flow-current-step">{STEPS.find(([k])=>k===step)?.[1]}</h2>
   <div className="flow-nav-actions" aria-label={tr("当前步骤操作")}>
    <AgentSelector taskId={task.id} disabled={generating||working}/>
    {!task.completedAt&&step==='outline'&&<button disabled={blocked||!task.workflow?.authorized||!task.topicConfirmed} onClick={()=>void action('outline')}>{task.outline.blocks.length?tr("重新生成"):tr("生成大纲")}</button>}
    {!task.completedAt&&step==='draft'&&<>{!work&&<button disabled={blocked||!task.workflow?.authorized||!task.outlineConfirmed} onClick={()=>void action('draft')}>{tr("生成正文")}</button>}<button className="task-primary" disabled={blocked||editingLocked||!work||checking||!check?.draftReady} title={check&&!check.draftReady?check.checks.filter(c=>!c.ok).map(c=>c.label).join('、'):undefined} onClick={()=>setAsk({stage:'deliver',revision:task.revision,done:()=>{}})}>{tr("确认交稿")}</button></>}
    {pending&&<span className="flow-stage-status" role="status">{pending.action==='outline'?tr("正在生成大纲"):tr("正在生成正文")}…</span>}<div className="flow-nav-slot" ref={setActionHost}/>{task.completedAt&&<span className="task-completed-label">{tr("已结束")}</span>}
   </div>
  </div>}
    <div className="flow-split" data-preview-side={previewSide}>
    <div className="flow-station">
    <div className="flow-stage" inert={!!task.completedAt} style={workVisible&&work?{flex:'0 0 auto'}:undefined}>
     {!task.completedAt&&check?.pendingCloudRequest&&<div className="flow-delivery-pending" role="status"><span>{tr("云端原请求待查询")}</span><button disabled={querying||cloudBusy} onClick={()=>void queryOriginalRequest()}>{querying?tr("正在查询…"):tr("查询原请求")}</button></div>}
     {!task.completedAt&&task.delivery?.destination==='cloud'&&['retiring','cleanup_blocked'].includes(task.delivery.phase||'')&&<div className="flow-delivery-pending" role="status"><span>{working?tr("正在核验归档并回收本地副本…"):tr("官网已公开，本地副本回收未完成")}{task.delivery.error&&<small>{task.delivery.error}</small>}</span><button disabled={working||cloudBusy||querying} onClick={()=>void finishCloud().catch(()=>{})}>{tr("继续回收本地副本")}</button></div>}
     {step==='topic'&&canvas('board')}
     {step==='outline'&&(task.outline.blocks.length?canvas('outline'):<WorkflowPlaceholder task={task} step={step} loading={loadingHere} blocked={blocked||editingLocked} onGenerate={k=>void action(k)}/>)}
     {workVisible&&!work&&<WorkflowPlaceholder task={task} step={step} loading={loadingHere} blocked={blocked||editingLocked} onGenerate={k=>void action(k)}/>}
     {workVisible&&work&&task.draftStale&&<p className="work-notice">{tr("素材或生成结构已改变，请核对正文。")}</p>}
    </div>
    {work&&<div className="flow-work-editor" inert={!!task.completedAt} style={workVisible?undefined:{display:'none'}}>
     <WorkDetail workflow readOnly={!!task.completedAt} work={work} active={active&&workVisible} requestedView="work" onOpenPublish={noLocal} browserViewId={'flow-'+task.id} agentBusy={p.agentBusy||generating||cloudBusy||hasPendingCloud} obscured={p.obscured} refreshToken={p.refreshToken} onChanged={p.onChanged} onCloudChanged={p.onCloudChanged} onEditorContext={editorContext} onLocalView={noLocal} onOpenLocal={p.onOpenLocal}/>
    </div>}
    </div>
    {/* Every type ends in an article, so its preview is always present; the station beside it is what differs. */}
    <aside className="flow-preview" aria-label={tr("文章预览")}><header><span>{tr("文章预览")}</span><button type="button" aria-label={tr("交换编排区与预览区的位置")} title={tr("交换左右位置")} onClick={swapPreview}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h13l-3-3M17 13H4l3 3"/></svg></button></header>
     {workVisible?<div className="flow-preview-scroll">{work?<DraftPreview articleId={work.id} version={[p.refreshToken,task.generated?.sha,dirty,task.revision].join(':')} onOpenUrl={p.onOpenUrl}/>:<EmptyPreview loading={loadingHere} text={tr(loadingHere?'正在生成正文…':'生成正文后，文章会出现在这里。')}/>}</div>
      :step==='outline'&&!task.outline.blocks.length?<div className="flow-preview-scroll"><EmptyPreview loading={loadingHere} text={tr(loadingHere?'正在编排内容块…':'生成大纲后，文章结构会出现在这里。')}/></div>
      :<div className="flow-preview-scroll" ref={setPreviewHost}/>}
    </aside>
    </div>

   {task.completedAt&&<div className="flow-done-scrim"><div className="flow-done-card" role="status"><span className="flow-done-eyebrow"><i aria-hidden="true">✓</i>{tr("任务已完成")}</span><h3>{work?.title||task.title}</h3><p>{task.delivery?.destination==='cloud'?tr("稿件已公开到官网"):work?tr("稿件已保存到本地"):tr("任务已结束")}{work?.category&&<> · {work.category}</>}</p>{work?.local&&<button className="task-primary" onClick={()=>window.dispatchEvent(new CustomEvent('scholay-open-manuscripts',{detail:{id:work.id}}))}>{tr("在稿件中查看")}<span aria-hidden="true">→</span></button>}</div></div>}
   </section>
   <CursorAgentPane readOnly={!!task.completedAt} initialUi={{scrollTop:task.ui.flowLogScroll,follow:task.ui.flowLogFollow}} onUiChange={v=>p.onUi({flowLogScroll:v.scrollTop,flowLogFollow:v.follow})} workflowRail={{collapsed:task.ui.flowCollapsed!==false,onToggle:()=>p.onUi({flowCollapsed:task.ui.flowCollapsed===false}),steps:flowSteps(task,step,generating,pending,work)}} active={active} taskId={task.id} onChanged={p.onChanged}/>
  </div>
 </section>;
}
