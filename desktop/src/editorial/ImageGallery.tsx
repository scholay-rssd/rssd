import './image-gallery.css';
import {useEffect,useRef,useState} from 'react';
import {listen} from '@tauri-apps/api/event';
import PaneToolbar from '../components/PaneToolbar';
import WorkspaceHomeTab from '../components/WorkspaceHomeTab';
import Icon from '../components/Icon';
import useWorkspaceTabShortcuts from '../lib/useWorkspaceTabShortcuts';
import {taskCall,type TaskAsset,type TaskRunState,type WorkbenchTask} from './taskWorkbench';
import GalleryConversation from './GalleryConversation';
import { tr, trKey, uiLocale } from "../uiText";
export type GalleryImage=TaskAsset&{taskId:string;key:string;taskTitle?:string;storage?:string;origin?:'generated'|'imported';createdAt?:string};
export function GalleryCard({item,onPick}:{item:GalleryImage;onPick?:(item:GalleryImage)=>void}){
 const [src,setSrc]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let alive=true;void taskCall<{src:string}>('gallery_read',{taskId:item.taskId,assetId:item.id}).then(v=>{if(alive)setSrc(v.src);}).catch(e=>{if(alive)setError(String(e));});return()=>{alive=false;};},[item.taskId,item.id]);
 return <article className="gallery-card">{src?<img src={src} alt={item.name}/>:<div className="gallery-image-wait">{error||tr("正在读取图片…")}</div>}<strong title={item.name}>{item.name}</strong><small>{item.origin==='imported'?tr("本地导入"):item.taskTitle||tr("AI 配图")}{item.createdAt?' · '+new Date(item.createdAt).toLocaleDateString(uiLocale()):''}</small>{onPick&&<button onClick={()=>onPick(item)}>{tr("使用这张图片")}</button>}</article>;
}
export type GalleryCompose={key?:number;taskId?:string;prompt?:string;articleId?:string;slotPath?:string};
export default function ImageGallery({active,compose,initialTaskId}:{active:boolean;compose?:GalleryCompose;initialTaskId?:string}){
 const [items,setItems]=useState<GalleryImage[]>([]),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[error,setError]=useState(''),[loading,setLoading]=useState(false),[limit,setLimit]=useState(36),[tasks,setTasks]=useState<WorkbenchTask[]>([]),[runs,setRuns]=useState<Record<string,TaskRunState>>({}),[view,setView]=useState<'images'|'chat'>('images'),[selected,setSelected]=useState<string|null>(null),[draft,setDraft]=useState(''),[draftKey,setDraftKey]=useState(0);
 const [chatTabs,setChatTabs]=useState<string[]>([]),[draftOpen,setDraftOpen]=useState(false);
 const closed=useRef<({kind:'task';id:string}|{kind:'draft';draft:string;key:number})[]>([]),tabStrip=useRef<HTMLDivElement>(null);
 const alive=useRef(true),loadLock=useRef(false),openEpoch=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function load(){if(loadLock.current)return;loadLock.current=true;setLoading(true);try{const [images,all,states]=await Promise.all([taskCall<GalleryImage[]>('gallery_list'),taskCall<WorkbenchTask[]>('task_list'),taskCall<Record<string,TaskRunState>>('task_states')]);if(alive.current){setItems(images);setTasks(all.filter(t=>t.mode==='image'));setRuns(states);setError('');}}catch(e){if(alive.current)setError(String(e));}finally{loadLock.current=false;if(alive.current)setLoading(false);}}
 function accept(task:WorkbenchTask){setTasks(all=>[task,...all.filter(t=>t.id!==task.id)]);}
 function home(){openEpoch.current++;setView('images');}
 function open(detail:GalleryCompose={}){const epoch=++openEpoch.current;setView('chat');setSelected(detail.taskId||null);if(detail.taskId)setChatTabs(tabs=>tabs.includes(detail.taskId!)?tabs:[...tabs,detail.taskId!]);else{setDraftOpen(true);setDraft(detail.prompt||'');setDraftKey(k=>k+1);}if(detail.taskId)void taskCall<WorkbenchTask>('task_get',{taskId:detail.taskId}).then(t=>{if(alive.current)accept(t);}).catch(e=>{if(alive.current&&epoch===openEpoch.current){setSelected(null);setError(String(e));}});}
 useEffect(()=>{if(!active)return;void load();const timer=setInterval(()=>{if(!document.hidden)void load();},10000);return()=>clearInterval(timer);},[active]);
 useEffect(()=>{let disposed=false,unlisten:(()=>void)|undefined;void listen<Record<string,unknown>>('cursor-agent-event',({payload:e})=>{if(disposed)return;if(e.type==='task_state')setRuns(s=>({...s,[String(e.taskId)]:e.state as TaskRunState}));if(e.type==='task_changed'||e.type==='changed')void load();}).then(fn=>{if(disposed)fn();else unlisten=fn;});return()=>{disposed=true;unlisten?.();};},[]);
 useEffect(()=>{const handler=(e:Event)=>open((e as CustomEvent<GalleryCompose>).detail);window.addEventListener('scholay-gallery-compose',handler);return()=>window.removeEventListener('scholay-gallery-compose',handler);},[]);
 useEffect(()=>{if(compose)open(compose);},[compose?.key]);
 useEffect(()=>{if(initialTaskId)open({taskId:initialTaskId});},[initialTaskId]);
 const visible=items.filter(i=>(filter==='all'||(filter==='generated'&&i.storage==='gallery'&&i.origin!=='imported')||(filter==='imported'&&i.storage==='gallery'&&i.origin==='imported')||(filter==='article'&&i.storage!=='gallery'))&&[i.name,i.taskTitle].join(' ').toLowerCase().includes(query.toLowerCase()));
 const task=tasks.find(t=>t.id===selected),displayEpoch=openEpoch.current;
 function showDraft(){openEpoch.current++;setSelected(null);setView('chat');}
 function closeChat(id:string|null){if(id){if(!chatTabs.includes(id))return;closed.current=[{kind:'task' as const,id},...closed.current.filter(t=>t.kind!=='task'||t.id!==id)].slice(0,20);setChatTabs(tabs=>tabs.filter(tab=>tab!==id));}else{if(!draftOpen)return;closed.current=[{kind:'draft' as const,draft,key:draftKey},...closed.current].slice(0,20);setDraftOpen(false);setDraft('');}if(view==='chat'&&selected===id)home();}
 function reopen(){const last=closed.current[0];if(!last)return;if(last.kind==='task'){closed.current.shift();open({taskId:last.id});return;}if(draftOpen&&draftKey!==last.key){setError(tr("请先完成或关闭当前图片草稿，再恢复已关闭草稿"));return;}closed.current.shift();setError('');setDraft(last.draft);setDraftKey(k=>Math.max(k+1,last.key+1));setDraftOpen(true);showDraft();}
 function cycle(direction:1|-1){const pages=['home',...chatTabs,...(draftOpen?['draft']:[])],current=view==='images'?'home':selected||'draft',index=Math.max(0,pages.indexOf(current)),next=pages[(index+direction+pages.length)%pages.length];if(next==='home')home();else if(next==='draft')showDraft();else open({taskId:next});}
 useWorkspaceTabShortcuts({active,onCycle:cycle,onClose:()=>{if(view==='chat')closeChat(selected);},onReopen:reopen});
 useEffect(()=>{if(active)tabStrip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});},[active,view,selected,chatTabs.length,draftOpen]);
 return <section className="local-gallery" aria-label={tr("本地图库")}>
  <aside className="gallery-sidebar"><button className="gallery-new-chat" onClick={()=>open()}>{tr("＋ 新建图片对话")}</button>
   <nav aria-label={tr("图片分类")}>{[['all',trKey('全部图片')],['generated',trKey('AI 生成')],['imported',trKey('本地导入')],['article',trKey('文章配图')]].map(([id,label])=><button key={id} aria-pressed={view==='images'&&filter===id} onClick={()=>{setFilter(id);home();}}>{tr(label)}</button>)}</nav>
   <h3>{tr("图片对话")}</h3><div className="gallery-chat-list">{tasks.map(t=>{const run=runs[t.id],status=t.completedAt?trKey('结束'):run?.pending?trKey('等你确认'):run?.queued?trKey('排队中'):run?.busy?trKey('执行中'):run?.status||t.runtime?.lastRunStatus||t.runtime?.status||trKey('尚未开始');return <button key={t.id} aria-pressed={view==='chat'&&selected===t.id} title={t.title+' · '+tr(status)} onClick={()=>open({taskId:t.id})}><span className={'gallery-chat-state'+(run?.busy&&!run.queued&&!run.pending?' is-running':'')} data-status={status} role="img" aria-label={tr(status)}>{run?.busy&&!run.queued&&!run.pending?'◌':/完成|结束/.test(status)?'✓':run?.queued?'◷':/失败|异常|中断|超时/.test(status)?'!':'○'}</span><span>{t.title}</span></button>;})}</div>
  </aside>
  <main>
   <PaneToolbar placement="tabs" active={active}><div className="gallery-tabs" role="tablist" aria-label={tr("图库标签页")} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const options=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')],index=options.indexOf(e.target as HTMLButtonElement);if(index<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowRight'?1:-1)+options.length)%options.length;options[next].focus();options[next].click();}}><WorkspaceHomeTab label={tr("图片列表")} active={view==='images'} panelId="gallery-images" onSelect={home}/><div className="gallery-tabstrip" ref={tabStrip}>{chatTabs.map(id=>{const chat=tasks.find(t=>t.id===id);return <div key={id} className={view==='chat'&&selected===id?'is-selected':''}><button role="tab" aria-selected={view==='chat'&&selected===id} aria-controls="gallery-conversation" title={chat?.title||tr("图片对话")} onClick={()=>open({taskId:id})}>{chat?.title||tr("图片对话")}</button><button aria-label={tr("关闭 {{value}}", {value: (chat?.title||tr('图片对话'))})} onClick={()=>closeChat(id)}><Icon name="x" size={12}/></button></div>;})}{draftOpen&&<div className={view==='chat'&&!selected?'is-selected':''}><button role="tab" aria-selected={view==='chat'&&!selected} aria-controls="gallery-conversation" onClick={showDraft}>{tr("新建图片对话")}</button><button aria-label={tr("关闭 新建图片对话")} onClick={()=>closeChat(null)}><Icon name="x" size={12}/></button></div>}</div></div></PaneToolbar>
   {error&&<p className="gallery-chat-error" role="alert">{error}</p>}
   {view==='chat'?<section id="gallery-conversation" role="tabpanel" className="gallery-conversation-panel" aria-label={task?.title||tr("新建图片对话")}>{selected&&!task?<div className="gallery-empty">{tr("正在读取图片对话…")}</div>:<GalleryConversation key={selected||'new:'+draftKey} active={active} task={task} draft={draft} onDraft={v=>{if(!selected)setDraft(v);}} onTask={t=>{accept(t);setChatTabs(tabs=>tabs.includes(t.id)?tabs:[...tabs,t.id]);if(openEpoch.current===displayEpoch){setSelected(t.id);if(!selected)setDraftOpen(false);}}} onChanged={()=>void load()} onError={setError}/>}</section>:<section id="gallery-images" role="tabpanel" aria-label={tr("图片列表")} className="gallery-images-panel">
    <div className="gallery-toolbar"><strong>{tr("本地图库 · {{visible}}", {visible: visible.length})}</strong><input aria-label={tr("搜索本地图片")} placeholder={tr("搜索图片")} value={query} onChange={e=>setQuery(e.target.value)}/><button disabled={loading} aria-label={tr("刷新本地图片")} title={tr("刷新")} onClick={()=>void load()}><Icon name="refresh"/></button></div>
    <div className="gallery-grid">{visible.slice(0,limit).map(item=><GalleryCard key={item.key} item={item}/>)}</div>{visible.length>limit&&<button className="gallery-more" onClick={()=>setLimit(n=>n+36)}>{tr("显示更多")}</button>}{!visible.length&&<div className="gallery-empty">{loading?tr("正在读取图片…"):<><span>{tr("生成的图片和文章配图会保存在这里")}</span><button onClick={()=>open()}>{tr("新建图片对话")}</button></>}</div>}
   </section>}
  </main>
 </section>;
}
