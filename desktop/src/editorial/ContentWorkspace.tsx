import {ACTIVE_SITE,setActiveSite} from '../../../scripts/site-profile.mjs';
import PaneToolbar,{useWindowChrome} from "../components/PaneToolbar";
import Icon from "../components/Icon";
import useWorkspaceTabShortcuts from "../lib/useWorkspaceTabShortcuts";
import {SpaceSwitchBlockedError,spaceSwitchBlockReason} from '../lib/spaceTransition';
import {useCallback,useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {invoke} from '../lib/nativeCore';
import {listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import CursorAgentPane from './CursorAgentPane';
import {useUi} from '../store';
import ResizeHandle from '../components/ResizeHandle';
import EditorialIcon from './EditorialIcon';
import LibraryManager from './LibraryManager';
import WorkDetail,{type EditorContext} from './WorkDetail';
import PublicationReader from '../publications/PublicationReader';
import {EMPTY,type Snapshot} from '../publications/model';
import {type WebsitePublishingSnapshot} from '../publications/websitePublishing';
import {collectWorks} from './contentLibrary';
import {librarySourceNames} from './librarySources';
import UnifiedNotebook from './NotebookWorkflow';
import type {Props as WorkflowProps} from './StructuredWorkflow';
const NotebookWorkflow=(p:WorkflowProps)=>p.task.completedAt&&!p.task.notebook?<div className="completed-creation-history"><p className="creation-history-status">{tr('已完成 · 创作记录')}</p><CursorAgentPane active={p.active} taskId={p.task.id} readOnly conversation={{compact:true,view:'chat',header:null,composer:null}} workflowRail={{collapsed:false,onToggle:()=>{}}} onChanged={p.onChanged} initialUi={{scrollTop:p.task.ui.flowLogScroll,follow:p.task.ui.flowLogFollow}} onUiChange={v=>p.onUi({flowLogScroll:v.scrollTop,flowLogFollow:v.follow})}/></div>:<UnifiedNotebook {...p}/>;
import TaskHistoryList,{TaskActions} from './TaskHistoryList';
import {taskCall,tabFor,addTaskTab,removeTaskTab,type WorkbenchTask,type WorkbenchTab,type TaskUi,type TaskRunState,type CanvasDraft} from './taskWorkbench';
import './content-workspace.css';
import './content-library.css';
import './task-workbench.css';
import {useToastMessage} from '../hooks/useToastMessage';

import { tr } from "../uiText";
const initialLocal=():WebsitePublishingSnapshot=>({connection:{configured:false,origin:ACTIVE_SITE.origin},articles:[]});
// Image conversations live in the gallery and source discovery in Settings › Subscriptions; neither is a workbench task.
const inWorkbench=(t:WorkbenchTask)=>t.mode!=='image'&&t.mode!=='rss';
export default function ContentWorkspace({active,view='conversations',chromeHost}:{active:boolean;view?:'conversations'|'manuscripts'|'works';chromeHost?:HTMLElement|null}){
 const management=view==='works',conversationActive=active&&view==='conversations',manuscriptActive=active&&view==='manuscripts';
 const [manuscriptsVisited,setManuscriptsVisited]=useState(view==='manuscripts'),[manuscriptOpen,setManuscriptOpen]=useState<{id:string;nonce:number}|undefined>();
 useEffect(()=>{if(view==='manuscripts')setManuscriptsVisited(true);},[view]);
 const openManuscript=useCallback((id:string)=>{setManuscriptsVisited(true);setManuscriptOpen({id,nonce:Date.now()});window.dispatchEvent(new Event('scholay-open-manuscripts'));},[]);
 useEffect(()=>{const open=(e:Event)=>{const id=(e as CustomEvent).detail?.id;if(id){setManuscriptsVisited(true);setManuscriptOpen({id,nonce:Date.now()});}};window.addEventListener('scholay-open-manuscripts',open);return()=>window.removeEventListener('scholay-open-manuscripts',open);},[]);
 const zoom=Number(useUi(s=>s.uiScale))/100;
 const [,setError]=useToastMessage();
 const [tasks,setTasks]=useState<WorkbenchTask[]>([]),[selected,setSelected]=useState(''),[runs,setRuns]=useState<Record<string,TaskRunState>>({}),[loaded,setLoaded]=useState(false),[preferencesReady,setPreferencesReady]=useState(false);
 const [{snapshot,local},setWorksData]=useState({snapshot:EMPTY as Snapshot,local:initialLocal()}),[refresh,setRefresh]=useState(0),[location,setLocation]=useState(''),[computerName,setComputerName]=useState('');
 const [localLoading,setLocalLoading]=useState(true);
 const sourceNames=librarySourceNames(computerName,local.connection.origin);
 const [flowVisited,setFlowVisited]=useState<string[]>([]);
 const [query,setQuery]=useState(''),[manageId,setManageId]=useState(''),[newTask,setNewTask]=useState(false);
 const sharedChrome=useWindowChrome();
 const [taskOpen,setTaskOpen]=useState(()=>localStorage.getItem('scholay.workbench.sidebar')!=='closed'),[writing,setWriting]=useState(false),[dragging,setDragging]=useState(false),[exitConfirm,setExitConfirm]=useState(false);
 const [sizes,setSizes]=useState(()=>{try{return {...{tasks:220,library:280,expansion:580},...JSON.parse(localStorage.getItem('scholay.workbench.sizes')||'{}')};}catch{return {tasks:220,library:280,expansion:580};}}),[width,setWidth]=useState(1400),[leases,setLeases]=useState<Record<string,{owner:string}>>({});
 const [managerVisited,setManagerVisited]=useState(management),[editorRevision,setEditorRevision]=useState(0),[libraryOpen,setLibraryOpen]=useState<{id:string;nonce:number}|undefined>();
 useEffect(()=>{const open=(e:Event)=>{const id=(e as CustomEvent).detail?.id;if(id){setManagerVisited(true);setLibraryOpen({id,nonce:Date.now()});}};window.addEventListener('scholay-open-library-work',open);return()=>window.removeEventListener('scholay-open-library-work',open);},[]);
 const managerContexts=useRef<Record<string,EditorContext>>({});
 useEffect(()=>{if(management)setManagerVisited(true);},[management]);
 const receiveManager=useCallback((scope:string,id:string,v:EditorContext)=>{const key=scope+':'+id,prev=managerContexts.current[key];managerContexts.current[key]=v;if(prev?.dirty!==v.dirty||prev?.busy!==v.busy)setEditorRevision(n=>n+1);if(scope==='local'&&prev?.dirty!==v.dirty&&(v.dirty||prev?.dirty))void taskCall('task_lease',{editorId:'library',articleId:id,release:!v.dirty}).catch(e=>setError(String(e)));},[]);
 const cloudEditor=useCallback((id:string,v:EditorContext)=>receiveManager('cloud',id,v),[receiveManager]);
 const manuscriptEditor=useCallback((id:string,v:EditorContext)=>receiveManager('local',id,v),[receiveManager]);
 const managerBusy=(id:string,scope?:string)=>['local','cloud'].some(source=>source!==scope&&(managerContexts.current[source+':'+id]?.dirty||managerContexts.current[source+':'+id]?.busy));
 const host=useRef<HTMLDivElement>(null),tasksRef=useRef(tasks),selectedRef=useRef(selected),contexts=useRef<Record<string,EditorContext>>({}),uiTimers=useRef<Record<string,ReturnType<typeof setTimeout>>>({}),generation=useRef(0),quitting=useRef(false),activeRef=useRef(active),started=useRef(false);
 tasksRef.current=tasks;selectedRef.current=selected;activeRef.current=active;
 const removedTasks=useRef(new Set<string>());
 const latestUi=useRef<Record<string,Partial<TaskUi>>>({});
 const pendingUi=useRef<Record<string,Partial<TaskUi>>>({}),uiChains=useRef<Record<string,Promise<unknown>>>({}),leaseOwners=useRef<Record<string,string>>({});
 const requestedConversation=useRef(''),creating=useRef(false),closedTabs=useRef<Record<string,WorkbenchTab[]>>({}),tabStrip=useRef<HTMLDivElement>(null);
 const [notebookHost,setNotebookHost]=useState<HTMLDivElement|null>(null);
 const task=newTask?undefined:tasks.find(t=>t.id===selected),ui:TaskUi={tabs:[],...task?.ui},notebookTab:WorkbenchTab={id:'notebook',kind:'notebook',title:tr("子弹笔记")},extensionTabs:WorkbenchTab[]=[...(task&&task.mode!=='legacy'&&(!task.completedAt||task.notebook)?[notebookTab]:[]),...ui.tabs.filter(t=>t.kind!=='notebook'&&(task?.mode==='legacy'||!(t.kind==='board'||t.kind==='outline'||t.kind==='images'||t.workId===task?.articleId)))],tab=extensionTabs.find(t=>t.id===ui.activeTab)||extensionTabs[0],expanded=(ui.expansionOpen??!!task?.notebook?.blocks.some(b=>b.state==='ready'&&b.text.trim()))&&!!tab;
 useEffect(()=>{if((task&&task.mode!=='legacy'))setFlowVisited(ids=>ids.includes(task.id)?ids:[...ids,task.id]);},[task?.id,task?.mode]);
 const works=useMemo(()=>collectWorks(local.articles,snapshot,tasks),[local.articles,snapshot,tasks]);
 // A cloud work is edited in place: its pulled editing copy belongs to the
 // cloud entry in Works, not to the local manuscripts in Drafts.
 const cloudIds=useMemo(()=>new Set(snapshot.website.items.map(c=>c.articleId).filter(Boolean)),[snapshot]);
 const editCopies=useMemo(()=>local.articles.filter(d=>d.editCopy&&cloudIds.has(d.id)),[local.articles,cloudIds]);
 const cloudWorks=useMemo(()=>collectWorks(editCopies,snapshot,tasks).filter(w=>w.cloud),[editCopies,snapshot,tasks]);
 const manuscripts=useMemo(()=>collectWorks(local.articles.filter(d=>!editCopies.includes(d)),EMPTY,tasks),[local.articles,editCopies,tasks]);
 useEffect(()=>{if(sharedChrome&&conversationActive)setTaskOpen(!sharedChrome.collapsed);},[sharedChrome?.collapsed,conversationActive,management]);
 const minimumMain=expanded?908:(task&&task.mode!=='legacy')?620:420;
 const taskDrawer=width<minimumMain+sizes.tasks+8,fullExpansion=expanded&&width<908;
 const canvasMax=Math.max(480,width-428-(taskOpen&&!taskDrawer?sizes.tasks+8:0));
 useEffect(()=>{if(conversationActive&&taskDrawer){if(sharedChrome&&!sharedChrome.collapsed)sharedChrome.toggle();else setTaskOpen(false);}},[taskDrawer,conversationActive,management]);
 function closeTaskDrawer(){if(!taskDrawer)return;if(sharedChrome&&!sharedChrome.collapsed)sharedChrome.toggle();else setTaskOpen(false);}
 useEffect(()=>{if(conversationActive&&!taskDrawer)localStorage.setItem('scholay.workbench.sidebar',taskOpen?'open':'closed');},[taskOpen,taskDrawer,conversationActive,management]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(sharedChrome||!conversationActive||e.isComposing||e.altKey||e.shiftKey||!(e.metaKey||e.ctrlKey)||e.key.toLowerCase()!=='b'||(e.target as Element)?.closest('input,textarea,[contenteditable=true],[role=dialog]'))return;e.preventDefault();setTaskOpen(v=>!v);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[conversationActive,management]);
 const openWorks=useMemo(()=>[...new Set(tasks.flatMap(t=>(t.ui?.tabs||[]).filter(x=>x.kind==='work'||x.kind==='publish').map(x=>x.workId!)))].filter(id=>!tasks.some(t=>t.mode!=='legacy'&&t.articleId===id)),[tasks]);
 function reconcile(t:WorkbenchTask){return latestUi.current[t.id]?{...t,ui:{...t.ui,...latestUi.current[t.id]}}:t;}
 function accept(t:WorkbenchTask){if(removedTasks.current.has(t.id))return;t=reconcile(t);setTasks(all=>all.some(x=>x.id===t.id)?all.map(x=>x.id===t.id?t:x):[t,...all]);}
 const worksGeneration=useRef(0),worksEpoch=useRef(0),queryRef=useRef(query);queryRef.current=query;
 async function loadWorks(){
  const g=++worksGeneration.current;setLocalLoading(true);
  const failed=(e:unknown)=>{if(g===worksGeneration.current)setError(String(e));};
  // Each source can render independently; a slow or unavailable cache must not
  // hide local manuscripts. Failed reads retain that source's previous data.
  await Promise.all([
   invoke<Snapshot>('publications_call',{method:'snapshot'}).then(snapshot=>{if(g===worksGeneration.current)setWorksData(data=>({...data,snapshot}));}).catch(failed),
   invoke<WebsitePublishingSnapshot>('website_publish_call',{method:'snapshot',params:{}}).then(local=>{if(g===worksGeneration.current)setWorksData(data=>({...data,local}));}).catch(failed).finally(()=>{if(g===worksGeneration.current)setLocalLoading(false);}),
  ]);
 }
 useEffect(()=>()=>{worksGeneration.current++;worksEpoch.current++;started.current=false;cloudRequest.current=null;},[]);
 async function loadTasks(q=query){const g=++generation.current;const all=(await taskCall<WorkbenchTask[]>('task_list',{query:q})).map(reconcile);if(g!==generation.current)return;setTasks(previous=>q?[...all,...previous.filter(t=>!all.some(x=>x.id===t.id)).map(t=>({...t,searchHidden:true}))]:all);setSelected(id=>id||all.find(t=>inWorkbench(t)&&!t.archived&&!t.deleted)?.id||'');setLoaded(true);}
 async function refreshTask(id=selectedRef.current){if(!id||removedTasks.current.has(id))return;accept(await taskCall<WorkbenchTask>('task_get',{taskId:id}));}
 const cloudRefreshPending=useRef(false);
 const changed=useCallback(async()=>{await loadWorks();setRefresh(n=>n+1);},[]);
 const cloudRequest=useRef<Promise<void>|null>(null);
 const loadCloud=useCallback((refresh:'auto'|'manual'|'changed'='auto')=>{
  if(cloudRequest.current)return cloudRequest.current;
  const epoch=worksEpoch.current;
  const request=(async()=>{try{if(refresh==='manual'){const context=await invoke<{site:typeof ACTIVE_SITE}>('space_context');if(context?.site?.id===ACTIVE_SITE.id&&epoch===worksEpoch.current)setActiveSite(context.site);}const result=await invoke<{notice?:string}>('publications_call',{method:'refresh_website',params:{refresh}});if(result?.notice&&epoch===worksEpoch.current)setError(result.notice);}finally{if(epoch===worksEpoch.current){await loadWorks();if(epoch===worksEpoch.current)setRefresh(n=>n+1);}}})();
  cloudRequest.current=request;
  void request.then(()=>{if(cloudRequest.current===request)cloudRequest.current=null;},()=>{if(cloudRequest.current===request)cloudRequest.current=null;});
  return request;
 },[]);
 const cloudChanged=useCallback(async()=>{
  cloudRefreshPending.current=true;
  const epoch=worksEpoch.current;
  // A completed publication needs a read started after that change; an older
  // automatic read may still be in flight and must not satisfy this refresh.
  if(cloudRequest.current)await cloudRequest.current.catch(()=>{});
  if(epoch!==worksEpoch.current)return;
  await loadCloud('changed');if(epoch===worksEpoch.current)cloudRefreshPending.current=false;
 },[loadCloud]);
 useEffect(()=>{if(!active||started.current)return;started.current=true;void Promise.all([loadTasks(''),loadWorks(),taskCall<Record<string,TaskRunState>>('task_states').then(setRuns),taskCall<{parallelism:number;selectedTask?:string}>('task_settings').then(v=>{if(v.selectedTask&&!requestedConversation.current)setSelected(v.selectedTask);setPreferencesReady(true);}),invoke<{path:string}>('editorial_location',{method:'info',path:null}).then(v=>setLocation(v.path)),invoke<string>('workbench_device_name').then(setComputerName).catch(()=>{})]).catch(e=>setError(String(e)));},[active]);
 const publicationReconciling=useRef(false),reconcileWake=useRef<(()=>void)|null>(null);
 useEffect(()=>{
  let disposed=false;
  const reconcile=async()=>{if(!started.current||publicationReconciling.current)return;publicationReconciling.current=true;try{const result=await invoke<{changed:boolean;results:{id:string;stage:string;localReleased:boolean;cleanupError?:string}[]}>('website_publish_call',{method:'reconcile',params:{}});if(disposed)return;if(result.changed||cloudRefreshPending.current){await Promise.all([cloudChanged(),loadTasks(queryRef.current),taskCall<Record<string,TaskRunState>>('task_states').then(setRuns)]);}}catch(e){if(!disposed)setError(String(e));}finally{publicationReconciling.current=false;}};
  const focus=()=>{void reconcile();},visible=()=>{if(document.visibilityState==='visible')void reconcile();};reconcileWake.current=focus;
  void reconcile();const timer=setInterval(focus,5000);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;reconcileWake.current=null;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visible);};
 },[cloudChanged]);
 useEffect(()=>{if(active)reconcileWake.current?.();},[active]);
 useEffect(()=>{let disposed=false,off:(()=>void)|undefined;const timers=new Map<string,ReturnType<typeof setTimeout>>();void listen<any>('cursor-agent-event',({payload:e})=>{if(e.type==='task_state')setRuns(s=>({...s,[e.taskId]:e.state}));if(['changed','task_changed','asset'].includes(e.type)){clearTimeout(timers.get(e.taskId));timers.set(e.taskId,setTimeout(()=>{void refreshTask(e.taskId).catch(x=>setError(String(x)));changed();},150));}}).then(fn=>{if(disposed)fn();else off=fn;});return()=>{disposed=true;off?.();for(const t of timers.values())clearTimeout(t);};},[changed]);
 useEffect(()=>{if(!active)return;let loading=false;const timer=setInterval(()=>{if(loading||document.hidden)return;loading=true;void Promise.all([taskCall<Record<string,{owner:string}>>('task_leases').then(setLeases),invoke<{stamp:string}>('editorial_call',{method:'workspace_stamp',params:{}}).then(v=>{if(v.stamp!==stamp.current){stamp.current=v.stamp;changed();}})]).catch(()=>{}).finally(()=>loading=false);},3000);return()=>clearInterval(timer);},[active,changed]);const stamp=useRef('');
 useEffect(()=>{const timer=setTimeout(()=>{if(started.current)void loadTasks(query).catch(e=>setError(String(e)));},250);return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{const el=host.current;if(!el)return;const observer=new ResizeObserver(()=>{if(el.clientWidth)setWidth(el.clientWidth);});observer.observe(el);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(preferencesReady&&selected)void taskCall('task_settings',{selectedTask:selected}).catch(e=>setError(String(e)));},[selected,preferencesReady]);
 useEffect(()=>{localStorage.setItem('scholay.workbench.sizes',JSON.stringify(sizes));},[sizes]);
 useEffect(()=>{const reset=()=>{if([...Object.values(contexts.current),...Object.values(managerContexts.current)].some(c=>c.dirty||c.busy)){setError(tr("请先保存正在编辑的作品"));return;}worksGeneration.current++;worksEpoch.current++;cloudRequest.current=null;cloudRefreshPending.current=false;setWorksData({snapshot:EMPTY,local:initialLocal()});setLocalLoading(true);started.current=false;setSelected('');setTasks([]);setFlowVisited([]);initialBlank.current=false;setManagerVisited(management);managerContexts.current={};closedTabs.current={};for(const timer of Object.values(uiTimers.current))clearTimeout(timer);latestUi.current={};pendingUi.current={};void invoke<{path:string}>('editorial_location',{method:'info',path:null}).then(v=>{setLocation(v.path);return Promise.all([loadTasks(''),loadWorks()]);}).catch(e=>setError(String(e)));};window.addEventListener('scholay-workspace-changed',reset);return()=>window.removeEventListener('scholay-workspace-changed',reset);},[]);
 useEffect(()=>()=>{for(const timer of Object.values(uiTimers.current))clearTimeout(timer);void flushAllUi().catch(()=>{});},[]);
 const runRef=useRef(runs);runRef.current=runs;
 // A blocked attempt is temporary. Clear its notice when its real cause ends.
 useEffect(()=>{if(!spaceSwitchBlockReason([...Object.values(contexts.current),...Object.values(managerContexts.current)],Object.values(runs)))window.dispatchEvent(new Event('scholay-space-switch-unblocked'));},[editorRevision,runs]);
 useEffect(()=>{const check=(event:Event)=>{const detail=(event as CustomEvent<{promises:Promise<unknown>[]}>).detail;detail.promises.push((async()=>{
   const reason=spaceSwitchBlockReason([...Object.values(contexts.current),...Object.values(managerContexts.current)],Object.values(runRef.current));
   if(reason)throw new SpaceSwitchBlockedError(reason);
   // Background coordinators stay bound to their own workspace. Save only
   // the visible editors before switching; task_shutdown is for app quit.
   await flushAllUi();
 })());};window.addEventListener('scholay-space-will-switch',check);return()=>window.removeEventListener('scholay-space-will-switch',check);},[]);
 async function finishExit(){await flushAllUi();await taskCall('task_shutdown');quitting.current=true;await invoke('workbench_finish_exit');}
 function requestExit(){
  if(quitting.current)return;
  const editors=[...Object.values(contexts.current),...Object.values(managerContexts.current)];
  if(editors.some(c=>c.dirty)){setError(tr("有未保存的正文，请保存后退出。"));return;}
  if(editors.some(c=>c.busy)){setError(tr("当前有保存、官网操作或待确认事项，请完成或取消后退出。"));return;}
  if(Object.values(runRef.current).some(x=>x.busy||x.queued)){window.dispatchEvent(new Event('scholay-workbench-exit-focus'));setExitConfirm(true);return;}
  void finishExit().catch(e=>{quitting.current=false;setError(String(e));});
 }
 useEffect(()=>{
  let disposed=false;const offs:(()=>void)[]=[];
  void listen('workbench-exit-requested',requestExit).then(async off=>{if(disposed){off();return;}offs.push(off);await invoke('workbench_exit_guard',{enabled:true});}).catch(e=>setError(tr("退出保护未就绪：{{e}}", {e: String(e)})));
  try{void getCurrentWindow().onCloseRequested(e=>{if(quitting.current)return;e.preventDefault();requestExit();}).then(off=>{if(disposed)off();else offs.push(off);}).catch(()=>{});}catch{}
  return()=>{disposed=true;offs.forEach(off=>off());void invoke('workbench_exit_guard',{enabled:false}).catch(()=>{});};
 },[]);
 async function patch(p:object,id=selectedRef.current,revision?:number){const t=await taskCall<WorkbenchTask>('task_update',{taskId:id,patch:p,expectedRevision:revision});accept(t);}
 async function flushUi(id:string){clearTimeout(uiTimers.current[id]);const p=pendingUi.current[id];if(!p)return;delete pendingUi.current[id];const chain=(uiChains.current[id]||Promise.resolve()).catch(()=>{}).then(()=>taskCall('task_update',{taskId:id,patch:{ui:p}}));uiChains.current[id]=chain;try{await chain;}catch(e){pendingUi.current[id]={...p,...pendingUi.current[id]};throw e;}}
 async function flushAllUi(){const promises:Promise<unknown>[]=[];window.dispatchEvent(new CustomEvent('scholay-workbench-flush',{detail:{promises}}));await Promise.all([...promises,...Object.keys(pendingUi.current).map(flushUi)]);await Promise.all(Object.values(uiChains.current));}
 function saveUi(next:Partial<TaskUi>,id=selectedRef.current){if(!id||removedTasks.current.has(id))return;latestUi.current[id]={...latestUi.current[id],...next};pendingUi.current[id]={...pendingUi.current[id],...next};setTasks(all=>all.map(x=>x.id===id?{...x,ui:{...x.ui,...next}}:x));clearTimeout(uiTimers.current[id]);uiTimers.current[id]=setTimeout(()=>{void flushUi(id).catch(e=>setError(String(e)));},250);}
 function saveCanvasDraft(id:string,kind:'board'|'outline',draft:CanvasDraft|null){const t=tasksRef.current.find(t=>t.id===id);if(!t)return;const all={...(latestUi.current[id]?.canvasDrafts||t.ui.canvasDrafts)};if(draft)all[kind]=draft;else delete all[kind];saveUi({canvasDrafts:all},id);}
 function saveTabView(taskId:string,tabId:string,view:NonNullable<WorkbenchTab['view']>){const t=tasksRef.current.find(t=>t.id===taskId);if(t)saveUi({tabs:t.ui.tabs.map(x=>x.id===tabId?{...x,view:{...x.view,...view}}:x)},taskId);}
 function openTab(next:WorkbenchTab){if(next.kind==='publish'&&contexts.current[next.workId||'']?.dirty){setError(tr("请先保存正文，再交稿"));return;}const owner=tasksRef.current.find(t=>t.mode!=='legacy'&&t.articleId===next.workId);if(owner){setSelected(owner.id);saveUi({flowStep:next.kind==='publish'?'deliver':'draft',expansionOpen:false},owner.id);return;}if(!task){setError(tr("先新建或选择一个任务，再打开作品"));return;}saveUi(addTaskTab(ui,next));}
 function openWeb(url:string,name:string){openTab(tabFor('web',url,name,url));}
 async function startConversation(){
  if(creating.current)return;
  creating.current=true;setWriting(true);setNewTask(true);setError('');closeTaskDrawer();
  let created:WorkbenchTask|undefined;
  try{
   created=await taskCall<WorkbenchTask>('task_create',{mode:'observation',skill:'unskilled',title:tr("新的创作"),brief:''});
   created=await taskCall<WorkbenchTask>('notebook_open',{taskId:created.id,empty:true});
  }catch(e){setError(tr("未能打开写作助手：{{e}}", {e: String(e)}));}
  finally{
   if(created){accept(created);setSelected(created.id);setNewTask(false);setQuery('');}
   creating.current=false;setWriting(false);
  }
 }
 const initialBlank=useRef(false);
 useEffect(()=>{if(conversationActive&&loaded&&preferencesReady&&!task&&!initialBlank.current){initialBlank.current=true;void startConversation();}},[conversationActive,management,loaded,preferencesReady,!!task]);
 const emptyWorkspace=<div className="notebook-loading" role="status">{writing?tr("正在打开写作助手…"):<button onClick={()=>void startConversation()}>{tr("打开写作助手")}</button>}</div>;
 function toggleExpansion(){if(expanded){saveUi({expansionOpen:false});return;}const next=extensionTabs.find(t=>t.id===ui.activeTab)||extensionTabs[0];if(next)saveUi({expansionOpen:true,activeTab:next.id});}
 function closeTab(id:string){if(id==='notebook')return;const t=ui.tabs.find(x=>x.id===id);if(!t||!task)return;const context=t.workId?contexts.current[t.workId]:undefined;if(context?.dirty||context?.busy){setError(context.dirty?tr("请先保存此稿件，再关闭标签页"):tr("请等待当前作品操作完成"));return;}closedTabs.current[task.id]=[t,...(closedTabs.current[task.id]||[]).filter(t=>t.id!==id)].slice(0,20);saveUi(removeTaskTab(ui,id));}
 function selectExtension(id:string){const t=extensionTabs.find(t=>t.id===id);if(!t)return;if(t.kind==='publish'&&contexts.current[t.workId||'']?.dirty){setError(tr("请先保存正文，再检查发布"));return;}saveUi({activeTab:id,expansionOpen:true});}
 function cycleExtension(direction:1|-1){if(!extensionTabs.length)return;const index=extensionTabs.findIndex(t=>t.id===ui.activeTab),next=index<0?(direction===1?0:extensionTabs.length-1):(index+direction+extensionTabs.length)%extensionTabs.length;selectExtension(extensionTabs[next].id);}
 function reopenExtension(){if(!task)return;const last=closedTabs.current[task.id]?.[0];if(!last)return;if(last.kind==='publish'&&contexts.current[last.workId||'']?.dirty){setError(tr("请先保存正文，再检查发布"));return;}closedTabs.current[task.id].shift();saveUi(addTaskTab(ui,last));}
 useWorkspaceTabShortcuts({active:conversationActive,blocked:!!manageId||exitConfirm||dragging,onCycle:cycleExtension,onClose:()=>{if(expanded&&tab)closeTab(tab.id);},onReopen:reopenExtension});
 useEffect(()=>{if(conversationActive&&expanded)tabStrip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});},[conversationActive,management,expanded,tab?.id,extensionTabs.length]);
 async function deleteTask(id:string){
  const t=tasksRef.current.find(t=>t.id===id);
  if(t&&[t.articleId,...t.workIds].some(work=>contexts.current[work]?.dirty||contexts.current[work]?.busy))throw Error(tr('请先保存此任务的稿件'));
  await flushUi(id);await uiChains.current[id];
  await taskCall('task_delete',{taskId:id});removedTasks.current.add(id);
  delete closedTabs.current[id];clearTimeout(uiTimers.current[id]);delete pendingUi.current[id];delete latestUi.current[id];delete uiChains.current[id];
  setFlowVisited(ids=>ids.filter(x=>x!==id));setTasks(all=>all.filter(t=>t.id!==id));
  if(selectedRef.current===id)setSelected(tasksRef.current.find(t=>t.id!==id&&inWorkbench(t)&&!t.deleted)?.id||'');
 }
 const manageTask=tasks.find(t=>t.id===manageId);
 useEffect(()=>{if(task&&!inWorkbench(task)){setSelected(tasks.find(t=>inWorkbench(t)&&!t.deleted)?.id||'');}},[task?.mode,tasks]);
 const visibleTasks=tasks.filter(t=>inWorkbench(t)&&!(t as any).searchHidden&&!t.deleted);
 const onEditor=useCallback((id:string,v:EditorContext)=>{const before=contexts.current[id];contexts.current[id]=v;if(before?.dirty!==v.dirty||before?.busy!==v.busy)setEditorRevision(n=>n+1);if(before?.dirty!==v.dirty&&selectedRef.current){const owner=leaseOwners.current[id]||selectedRef.current;if(removedTasks.current.has(owner))return;if(v.dirty)leaseOwners.current[id]=owner;void taskCall('task_lease',{taskId:owner,articleId:id,release:!v.dirty}).then(()=>{if(!v.dirty)delete leaseOwners.current[id];}).catch(e=>setError(String(e)));}},[]);
 const workContexts=useRef(new Map<string,(v:EditorContext)=>void>());function editorCallback(id:string){if(!workContexts.current.has(id))workContexts.current.set(id,v=>onEditor(id,v));return workContexts.current.get(id)!;}
 const noLocal=useCallback(()=>{},[]),openLocal=useCallback((id:string)=>{void changed();openManuscript(id);},[changed,openManuscript]);
 async function openConversation(id:string){
  try{const target=await taskCall<WorkbenchTask>('task_get',{taskId:id});if(!inWorkbench(target)||target.deleted)throw Error(tr('这段创作对话已不可用'));requestedConversation.current=id;accept(target);setNewTask(false);setQuery('');setSelected(id);window.dispatchEvent(new Event('scholay-open-creation'));}catch(e){setError(String(e));}
 }
 const resize=(key:string,value:number)=>setSizes((s:any)=>({...s,[key]:value}));
 function handle(key:string,min:number,max:number,side:'left'|'right'='right'){return <div className="task-divider"><ResizeHandle visible scale={zoom} width={key==='expansion'?Math.min(sizes.expansion,canvasMax):sizes[key]} min={min} max={max} side={side} onResize={v=>resize(key,v)} onDragChange={setDragging} onReset={()=>resize(key,{tasks:220,library:280,expansion:580}[key as 'tasks'])} label={tr(({tasks:'调整任务会话宽度',library:'调整作品库宽度',expansion:'调整拓展区宽度'} as Record<string,string>)[key])}/></div>;}
 const windowHeader=<header className="task-global-header" data-tauri-drag-region="deep">{view==='conversations'&&<button title={tr("显示或隐藏任务会话")} aria-label={tr("显示或隐藏任务会话")} aria-controls="workbench-task-sidebar" aria-expanded={taskOpen} onClick={()=>setTaskOpen(v=>!v)}><EditorialIcon name="panel"/></button>}</header>;
 return <div className="task-workbench content-library" ref={host} style={{'--task-width':sizes.tasks+'px','--library-width':sizes.library+'px','--canvas-width':Math.min(sizes.expansion,canvasMax)+'px'} as CSSProperties}>
 {!sharedChrome&&(chromeHost?(active?createPortal(windowHeader,chromeHost):null):windowHeader)}

 <div id="creation-conversations" role="region" aria-label={tr("创作对话")} className="task-panes" style={view!=='conversations'?{display:'none'}:undefined}>
 {taskOpen&&<><aside className={'task-sidebar'+(taskDrawer?' is-drawer':'')} aria-label={tr("任务会话")} id="workbench-task-sidebar"><div className="task-sidebar-start"><button className="task-new-conversation" aria-pressed={newTask||!task} disabled={writing} onClick={startConversation}><EditorialIcon name="plus"/><span>{tr("新建对话")}</span></button></div><input placeholder={tr("搜索任务与执行记录")} aria-label={tr("搜索任务")} value={query} onChange={e=>setQuery(e.target.value)}/><div className="task-history-list" ref={el=>{if(el&&el.dataset.restored!==selected){el.scrollTop=ui.taskScroll||0;el.dataset.restored=selected;}}} onScroll={e=>saveUi({taskScroll:e.currentTarget.scrollTop})}><TaskHistoryList tasks={visibleTasks} runs={runs} selected={newTask?'':selected} onSelect={id=>{setNewTask(false);setSelected(id);closeTaskDrawer();}} onManage={setManageId}/>{loaded&&!visibleTasks.length&&<p className="work-empty">{tr("这里还没有任务")}</p>}</div></aside>{!taskDrawer&&handle('tasks',180,320)}</>}
 <main id="workbench-main-pane" className="task-chat" style={fullExpansion?{display:'none'}:undefined} onClickCapture={e=>{const a=(e.target as Element).closest('a');if(a&&/^https?:/.test(a.getAttribute('href')||'')){e.preventDefault();e.stopPropagation();openWeb(a.getAttribute('href')!,a.textContent||tr('来源网页'));}}}>
 {tasks.filter(t=>t.mode!=='legacy'&&inWorkbench(t)&&(t.id===selected||flowVisited.includes(t.id))).map(t=><div key={location+':flow:'+t.id} className="flow-main-host" style={!newTask&&t.id===selected?undefined:{display:'none'}}>{<NotebookWorkflow extensionHost={notebookHost} task={t} active={conversationActive&&!newTask&&t.id===selected} run={runs[t.id]||{}} work={works.find(w=>w.id===t.articleId)} refreshToken={refresh} obscured={dragging||newTask||!!manageId||exitConfirm||(taskDrawer&&taskOpen)} agentBusy={managerBusy(t.articleId)||!!leases[t.articleId]&&!leases[t.articleId].owner.startsWith('editor-')} onAccept={accept} onUi={v=>saveUi(v,t.id)} onSave={(v,revision)=>patch(v,t.id,revision??t.revision)} onDraft={(kind,draft)=>saveCanvasDraft(t.id,kind,draft)} onRefresh={()=>{void refreshTask(t.id);changed();}} onChanged={changed} onCloudChanged={cloudChanged} onOpenUrl={openWeb} onEditorContext={editorCallback(t.articleId)} onOpenLocal={openLocal}/>}</div>)}
 {task?.mode==='legacy'?<div className="task-legacy-view">{emptyWorkspace}<CursorAgentPane key={location+':'+task.id} active={conversationActive} taskId={task.id} readOnly onChanged={changed} initialUi={{scrollTop:ui.flowLogScroll,follow:ui.flowLogFollow}} onUiChange={v=>saveUi({flowLogScroll:v.scrollTop,flowLogFollow:v.follow},task.id)} workflowRail={{collapsed:ui.flowCollapsed!==false,onToggle:()=>saveUi({flowCollapsed:ui.flowCollapsed===false},task.id)}}/></div>:!task?emptyWorkspace:null}
 </main>
 {extensionTabs.length>0&&<PaneToolbar placement="toggle" active={conversationActive} alignTo={fullExpansion?'#workbench-extension-pane':'#workbench-main-pane'}><div className="task-extension-toggle"><button aria-label={expanded?tr("收起拓展区"):tr("展开拓展区")} title={expanded?tr("收起拓展区"):tr("展开拓展区")} aria-controls="workbench-extension-pane" aria-expanded={expanded} onClick={toggleExpansion}><EditorialIcon name="panel"/></button></div></PaneToolbar>}
 <section id="workbench-extension-pane" className={'task-expansion'+(fullExpansion?' is-full':'')} style={!expanded?{display:'none'}:undefined} aria-label={tr("拓展区")}>
 {expanded&&!fullExpansion&&handle('expansion',480,canvasMax,'left')}
 <PaneToolbar placement="tabs" active={conversationActive&&expanded} endInset={fullExpansion?36:0}><div className="task-tabs" ref={tabStrip} role="tablist" aria-label={tr("拓展区标签页")} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const options=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')],index=options.indexOf(e.target as HTMLButtonElement);if(index<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowRight'?1:-1)+options.length)%options.length;options[next].focus();options[next].click();}}>{extensionTabs.map(t=><div className={t.id===tab?.id?'is-selected':''} key={t.id}><button role="tab" aria-selected={t.id===tab?.id} title={t.title} onClick={()=>selectExtension(t.id)}>{t.title}</button>{t.kind!=='notebook'&&<button aria-label={tr("关闭 {{title}}", {title: t.title})} onClick={()=>closeTab(t.id)}><Icon name="x" size={12}/></button>}</div>)}</div></PaneToolbar>
 <div className="task-tab-body">
 <div ref={setNotebookHost} className="notebook-extension-host" style={{height:'100%',display:tab?.kind==='notebook'?undefined:'none'}}/>

 {openWorks.map(id=>{const w=works.find(x=>x.id===id),visible=expanded&&(tab?.kind==='work'||tab?.kind==='publish')&&tab.workId===id;if(!w)return visible?<div className="work-empty" key={id}>{tr("稿件生成后将在这里显示。")}<button onClick={changed}>{tr("刷新")}</button></div>:null;return <div className="task-work-panel" key={location+id} style={!visible?{display:'none'}:undefined}><WorkDetail readOnly={!!task?.completedAt} onDelivered={async()=>{if(task?.articleId===id)accept(await taskCall<WorkbenchTask>('task_finish',{taskId:task.id,delivered:true}));}} onOpenPublish={id=>openTab(tabFor('publish',id,tr('发布检查')))} requestedView={visible&&tab?.kind==='publish'?'publish':visible?'work':undefined} browserViewId={'work-article-'+smallHash(id)} work={w} active={conversationActive&&visible} agentBusy={managerBusy(id)||!!leases[id]&&!leases[id].owner.startsWith('editor-')} obscured={dragging||newTask||!!manageId||exitConfirm||(taskDrawer&&taskOpen)} refreshToken={refresh} onChanged={changed} onCloudChanged={cloudChanged} onEditorContext={editorCallback(id)} onLocalView={noLocal} onOpenLocal={openLocal}/></div>;})}
 {tasks.flatMap(owner=>(owner.ui?.tabs||[]).filter(t=>t.kind==='web').map(t=><div key={owner.id+t.id} style={owner.id===selected&&t.id===tab?.id?{height:'100%'}:{display:'none'}}><PublicationReader viewId={'work-'+owner.id+'-'+smallHash(t.id)} active={conversationActive&&expanded&&owner.id===selected&&t.id===tab?.id} obscured={dragging||newTask||!!manageId||exitConfirm||(taskDrawer&&taskOpen)} url={t.url} title={t.title} initialView={t.view} onViewChange={v=>saveTabView(owner.id,t.id,v)}/></div>))}
 </div></section>

 </div>
 {location&&managerVisited&&<div className="manager-host" style={!management?{display:'none'}:undefined}><LibraryManager key={'cloud:'+location} scope="cloud" tasks={tasks} tasksLoading={!loaded} onOpenConversation={openConversation} openRequest={libraryOpen} active={active&&management} workspace={location} works={cloudWorks} sourceNames={sourceNames} refreshToken={refresh} leases={leases} localLoading={localLoading} onCloudLoad={loadCloud} onChanged={changed} onCloudChanged={cloudChanged} onExternalRefresh={async()=>{await invoke('publications_call',{method:'refresh_feishu'});await changed();}} canEdit={id=>!contexts.current[id]?.dirty&&!contexts.current[id]?.busy&&!managerBusy(id,'cloud')} onEditorContext={cloudEditor} onOpenLocal={openManuscript}/></div>}
 {location&&manuscriptsVisited&&<div id="creation-manuscripts" role="region" aria-label={tr("稿件")} className="manager-host" style={!manuscriptActive?{display:'none'}:undefined}><LibraryManager key={'local:'+location} scope="local" tasks={tasks} tasksLoading={!loaded} onOpenConversation={openConversation} openRequest={manuscriptOpen} active={manuscriptActive} workspace={location} works={manuscripts} sourceNames={sourceNames} refreshToken={refresh} leases={leases} localLoading={localLoading} onCloudLoad={loadCloud} onChanged={changed} onCloudChanged={cloudChanged} onExternalRefresh={async()=>{await invoke('publications_call',{method:'refresh_feishu'});await changed();}} canEdit={id=>!contexts.current[id]?.dirty&&!contexts.current[id]?.busy&&!managerBusy(id,'local')} onEditorContext={manuscriptEditor} onOpenLocal={openManuscript}/></div>}


 {manageTask&&<TaskActions key={manageTask.id} task={manageTask} busy={!!runs[manageId]?.busy} onClose={()=>setManageId('')} onSave={p=>patch(p,manageId)} onDelete={()=>deleteTask(manageId)} onFinish={async()=>{const t=tasksRef.current.find(t=>t.id===manageId);if(t&&[t.articleId,...t.workIds].some(id=>contexts.current[id]?.dirty||contexts.current[id]?.busy))throw Error(tr('请先保存稿件'));accept(await taskCall<WorkbenchTask>('task_finish',{taskId:manageId}));}}/>}
 {exitConfirm&&<div className="task-modal-backdrop"><section className="task-new-dialog" role="alertdialog"><h2>{tr("仍有任务正在运行")}</h2><p>{tr("退出将停止本机执行，保存现有会话和稿件。已提交的官网任务可在重启后查询原回执。")}</p><button onClick={()=>setExitConfirm(false)}>{tr("继续工作")}</button><button onClick={()=>void finishExit().catch(e=>{quitting.current=false;setError(String(e));})}>{tr("停止并退出")}</button></section></div>}
 </div>;
}
function smallHash(s:string){let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))|0;return (h>>>0).toString(16);}
