import PaneToolbar from "../components/PaneToolbar";
import useWorkspaceTabShortcuts from "../lib/useWorkspaceTabShortcuts";
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {invoke} from '../lib/nativeCore';
import EditorialIcon from './EditorialIcon';
import ResizeHandle from '../components/ResizeHandle';
import CategoryIcon from './CategoryIcon';
import WorkDetail,{type EditorContext} from './WorkDetail';
import {EMPTY_FILTERS,PUBLICATION_LABELS,matchesWork,missingEnglish,tagCount,workSummary,type Filters,type Location,type Work} from './contentLibrary';
import type {LibrarySourceNames} from './librarySources';
import {sectionsForSite,activeSectionsForSite} from '../../../contracts/site-sections.mjs';
import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import './library-manager.css';
import {useToastMessage} from '../hooks/useToastMessage';

import { tr } from "../uiText";
import {libraryNavigationKey,readLibraryNavigation,type LibraryTab as Tab} from './libraryNavigation';
import {creationHistory} from './creationHistory';
import type {WorkbenchTask} from './taskWorkbench';
type Props={tasks?:WorkbenchTask[];tasksLoading?:boolean;onOpenConversation?:(id:string)=>void|Promise<void>;scope:Location;onOpenLocal:(id:string)=>void;openRequest?:{id:string;nonce:number};active:boolean;works:Work[];sourceNames:LibrarySourceNames;workspace:string;refreshToken:number;leases:Record<string,{owner:string}>;localLoading:boolean;onCloudLoad:(refresh?:'auto'|'manual')=>Promise<void>;onChanged:()=>void|Promise<void>;onCloudChanged:()=>Promise<void>;onExternalRefresh:()=>Promise<void>;canEdit:(id:string)=>boolean;onEditorContext:(id:string,context:EditorContext)=>void};
const noop=()=>{};
const cloudCall=<T,>(method:string,params:Record<string,unknown>)=>invoke<T>('website_publish_call',{method,params});
export default function LibraryManager(p:Props){
 const scope=p.scope,manuscripts=scope==='local',prefix=manuscripts?'manuscripts':'manager';
 const [restored]=useState(()=>readLibraryNavigation(localStorage,p.workspace,scope,p.works));
 const [,setError]=useToastMessage();
 const [filters,setFilters]=useState<Filters>(restored.filters),[limit,setLimit]=useState(restored.limit),[tabs,setTabs]=useState<Tab[]>(restored.tabs),[selected,setSelected]=useState(restored.selected),[refreshing,setRefreshing]=useState(false);
 const navigation=useRef({...restored,tabs,selected,filters,limit});navigation.current={...navigation.current,tabs,selected,filters,limit};
 const persist=()=>{try{if(p.workspace)localStorage.setItem(libraryNavigationKey(p.workspace,scope),JSON.stringify(navigation.current));}catch{/* optional navigation preference */}};
 const [newDraft,setNewDraft]=useState(false),[draftTitle,setDraftTitle]=useState(''),[creating,setCreating]=useState(false);
 async function createManuscript(){
  const title=draftTitle.trim();if(!title||creating)return;setCreating(true);p.onEditorContext('__new_manuscript__',{context:'',dirty:false,busy:true});setError('');
  try{const draft=await invoke<{id:string}>('editorial_call',{method:'draft_create',params:{id:'draft-'+crypto.randomUUID(),title,column:'未归栏',archiveCategory:'未归栏',type:'unskilled',writingSkills:[],markdown:'# '+title+'\n\n'}});setNewDraft(false);setDraftTitle('');await p.onChanged();p.onOpenLocal(draft.id);}catch(e){setError(String(e));}finally{setCreating(false);p.onEditorContext('__new_manuscript__',{context:'',dirty:false,busy:false});}
 }
 const contexts=useRef<Record<string,EditorContext>>({}),callbacks=useRef(new Map<string,(v:EditorContext)=>void>()),parent=useRef(p.onEditorContext),scroller=useRef<HTMLDivElement>(null);parent.current=p.onEditorContext;
 const [dirty,setDirty]=useState<Record<string,boolean>>({});
 // The list stays on the left; an open work is always shown in the expansion area on the right.
 useEffect(()=>{if(!selected&&tabs.length)setSelected(tabs[tabs.length-1].id);},[selected,tabs]);
 const closed=useRef<Tab[]>([]),tabStrip=useRef<HTMLDivElement>(null);
 // The expansion area can be folded away so the list uses the full width; the preview stays mounted.
 const [expansionOpen,setExpansionOpen]=useState(()=>{try{return localStorage.getItem('scholay.library.'+scope+'.expansion')!=='closed';}catch{return true;}});
 const expanded=tabs.length>0&&expansionOpen;
 const showExpansion=useCallback((open:boolean)=>{setExpansionOpen(open);try{localStorage.setItem('scholay.library.'+scope+'.expansion',open?'open':'closed');}catch{/* keep the in-memory state */}},[]);
 // The midline between list and preview is draggable; 0 keeps the default proportion.
 const collection=useRef<HTMLElement>(null),split=useRef<HTMLDivElement>(null);
 const [listWidth,setListWidth]=useState(()=>{const v=Number(localStorage.getItem('scholay.library.'+scope+'.split'));return Number.isFinite(v)&&v>0?v:0;});
 const resizeList=useCallback((v:number)=>{setListWidth(v);try{if(v)localStorage.setItem('scholay.library.'+scope+'.split',String(Math.round(v)));else localStorage.removeItem('scholay.library.'+scope+'.split');}catch{/* keep the in-memory width */}},[]);
 // Public section IDs are the navigation keys; names and order come from the
 // current space's synchronized catalog, including empty public sections.
 const categoryFilters:Filters={...EMPTY_FILTERS,location:filters.location};
 const sections=sectionsForSite(ACTIVE_SITE);
 const categories=[...activeSectionsForSite(ACTIVE_SITE),...sections.filter(s=>s.enabled===false&&tagCount(p.works,categoryFilters,'category',s.id)>0)];
 const unassignedCount=tagCount(p.works,categoryFilters,'category','__unassigned__');
 const englishGaps=manuscripts?0:p.works.filter(missingEnglish).length;
 useEffect(()=>{setFilters(f=>({...f,type:[],category:f.category.map(id=>sections.find(s=>s.id===id||s.name===id||s.aliases?.includes(id))?.id||id)}));},[ACTIVE_SITE.id,ACTIVE_SITE.sectionCatalog?.revision]);
 const visible=useMemo(()=>p.works.filter(w=>matchesWork(w,filters)),[p.works,filters]);
 useEffect(persist,[tabs,selected,filters,limit,p.workspace]);
 const restoreScroll=useRef(true);
 useEffect(()=>{if(restoreScroll.current&&p.active&&visible.length&&scroller.current){scroller.current.scrollTop=navigation.current.scrollTop;restoreScroll.current=false;}},[p.active,visible,limit]);
 const previousFilters=useRef(filters);useEffect(()=>{if(previousFilters.current===filters)return;previousFilters.current=filters;restoreScroll.current=false;setLimit(60);navigation.current.scrollTop=0;if(scroller.current)scroller.current.scrollTop=0;persist();},[filters]);
 const receive=useCallback((id:string,value:EditorContext)=>{contexts.current[id]=value;setDirty(v=>v[id]===value.dirty?v:{...v,[id]:value.dirty});parent.current(id,value);},[]);
 function callback(id:string){if(!callbacks.current.has(id))callbacks.current.set(id,v=>receive(id,v));return callbacks.current.get(id)!;}
 function open(work:Work){setError('');showExpansion(true);setTabs(all=>all.some(t=>t.id===work.id)?all:[...all,{id:work.id,title:work.title,source:filters.location[0]}]);setSelected(work.id);}
 function close(id:string){const closing=tabs.find(t=>t.id===id);if(!closing)return;const context=contexts.current[id];if(context?.dirty||context?.busy){setError(context.dirty?tr("请先保存此稿件，再关闭标签页"):tr("请等待当前作品操作完成"));return;}closed.current=[closing,...closed.current.filter(t=>t.id!==id)].slice(0,20);setTabs(all=>all.filter(t=>t.id!==id));if(selected===id)setSelected('');delete contexts.current[id];parent.current(id,{context:'',dirty:false,busy:false});void dropUnchangedCopy(id);}
 // Closing a Works tab drops an editing copy with nothing to lose. The service
 // refuses any copy whose files differ from the last pulled or pushed version.
 async function dropUnchangedCopy(id:string){
  const local=scope==='cloud'?p.works.find(w=>w.id===id)?.local:undefined;if(!local?.editCopy)return;
  try{const detail=await cloudCall<{sync?:{state:string;fingerprint?:string}}>('inspect',{id:local.id});if(!detail.sync?.fingerprint)return;
   await cloudCall('local_action',{id:local.id,action:'discard_pull',confirmed:true,expectedFingerprint:detail.sync.fingerprint});await p.onChanged();}
  catch{/* Changed copies stay as drafts; the card keeps showing 编辑中. */}
 }
 function reopen(){const last=closed.current.shift();if(!last)return;setError('');showExpansion(true);setTabs(all=>all.some(t=>t.id===last.id)?all:[...all,last]);setSelected(last.id);}
 function cycle(direction:1|-1){const pages=tabs.map(t=>t.id);if(!pages.length)return;const index=Math.max(0,pages.indexOf(selected));setError('');showExpansion(true);setSelected(pages[(index+direction+pages.length)%pages.length]);}
 useWorkspaceTabShortcuts({active:p.active,onCycle:cycle,onClose:()=>{if(selected)close(selected);},onReopen:reopen});
 const handledOpen=useRef(0);
 useEffect(()=>{const r=p.openRequest;if(!r||handledOpen.current===r.nonce)return;const work=p.works.find(w=>w.id===r.id);if(!work)return;handledOpen.current=r.nonce;open(work);},[p.openRequest,p.works]);
 useEffect(()=>{if(p.active)tabStrip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});},[p.active,selected,tabs.length]);
 async function refresh(kind:'local'|'cloud'|'external'){if(refreshing||cloudLoading)return;setRefreshing(true);setError('');try{if(kind==='cloud')await p.onCloudLoad('manual');else if(kind==='external')await p.onExternalRefresh();else await p.onChanged();}catch(e){setError(String(e));}finally{setRefreshing(false);}}
 const refreshLocation=scope;
 const [cloudLoading,setCloudLoading]=useState(false),cloudAttempt=useRef<number|null>(null);
 // Opening the cloud list is a read, not a publication or a retry of a write.
 // Re-entering within a minute reuses the result (including a failed attempt).
 useEffect(()=>{
  if(!p.active||!p.workspace||refreshLocation!=='cloud'||cloudAttempt.current!==null&&Date.now()-cloudAttempt.current<60_000)return;
  let disposed=false;cloudAttempt.current=Date.now();setCloudLoading(true);
  void p.onCloudLoad().catch(e=>{if(!disposed)setError(String(e));}).finally(()=>{cloudAttempt.current=Date.now();setCloudLoading(false);});
  return()=>{disposed=true;};
 },[p.active,p.workspace,refreshLocation,p.onCloudLoad]);
 const loading=refreshing||(refreshLocation==='cloud'?cloudLoading:p.localLoading);
 const refreshBusy=refreshing||cloudLoading||(refreshLocation==='local'&&p.localLoading);
 const refreshLabel=manuscripts?tr('刷新稿件'):tr('刷新{{source}}作品',{source:tr(p.sourceNames.cloud)});
 const hasFilters=!!filters.query.trim()||!!filters.category.length||!!filters.english;
 return <section className="library-manager" data-active={p.active} data-view={expanded?'split':'list'} data-scope={scope} aria-label={manuscripts?tr("本机稿件"):tr("云端作品")}>
  {newDraft&&<div className="task-modal-backdrop"><form className="task-new-dialog" role="dialog" aria-modal="true" aria-label={tr("新建稿件")} onSubmit={e=>{e.preventDefault();void createManuscript();}}><h2>{tr("新建稿件")}</h2><label>{tr("标题")}<input autoFocus maxLength={120} value={draftTitle} onChange={e=>setDraftTitle(e.target.value)} disabled={creating}/></label><div><button type="button" disabled={creating} onClick={()=>setNewDraft(false)}>{tr("取消")}</button><button type="submit" className="task-primary" disabled={!draftTitle.trim()||creating}>{creating?tr("正在创建…"):tr("创建")}</button></div></form></div>}
  <main className="manager-content">
   {tabs.length>0&&<PaneToolbar placement="toggle" active={p.active} alignTo={'#'+prefix+(expanded?'-expansion':'-collection')}><div className="task-extension-toggle"><button aria-label={expanded?tr("收起拓展区"):tr("展开拓展区")} title={expanded?tr("收起拓展区"):tr("展开拓展区")} aria-controls={prefix+'-expansion'} aria-expanded={expanded} onClick={()=>showExpansion(!expanded)}><EditorialIcon name="panel"/></button></div></PaneToolbar>}
   <PaneToolbar placement="tabs" active={p.active&&expanded} alignTo={'#'+prefix+'-expansion'} endInset={36}><div className="manager-tabs" role="tablist" aria-label={tr("作品标签页")} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const options=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')],index=options.indexOf(e.target as HTMLButtonElement);if(index<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowRight'?1:-1)+options.length)%options.length;options[next].focus();options[next].click();}}><div className="manager-tabstrip" ref={tabStrip}>{tabs.map(t=><div key={t.id} className={selected===t.id?'is-selected':''}><button role="tab" aria-selected={selected===t.id} aria-controls={prefix+'-work-'+t.id} title={t.title} onClick={()=>{setError('');setSelected(t.id);}}>{dirty[t.id]?'● ':''}{p.works.find(w=>w.id===t.id)?.title||t.title}</button><button aria-label={tr("关闭 {{title}}", {title: t.title})} onClick={()=>close(t.id)}>×</button></div>)}</div></div></PaneToolbar>
      <div className="manager-split" ref={split}>
   <section id={prefix+'-collection'} aria-label={tr("作品列表")} className="manager-collection" ref={collection} style={expanded&&listWidth?{flex:'0 0 '+listWidth+'px'}:undefined}>
    <aside className="manager-filters" aria-label={tr("作品筛选")}><div className="manager-source" title={p.sourceNames[scope]}><EditorialIcon name={scope}/><span title={p.sourceNames[scope]}>{manuscripts?tr("本机稿件"):tr("云端作品")}</span><small>{p.works.length}</small>{manuscripts&&<button className="manager-new-draft" onClick={()=>setNewDraft(true)}><EditorialIcon name="plus"/>{tr("新建稿件")}</button>}</div>
  <section className="manager-categories" aria-label={tr("栏目标签组")}><header>{tr("栏目")}</header><fieldset><button aria-pressed={!filters.category.length} onClick={()=>setFilters(f=>({...f,type:[],category:[]}))}><CategoryIcon category="all"/><span>{tr("全部栏目")}</span><small>{p.works.length}</small></button>{categories.map(section=><button key={section.id} aria-pressed={filters.category[0]===section.id} onClick={()=>setFilters(f=>({...f,type:[],category:[section.id]}))}><CategoryIcon category={section.name}/><span>{section.name}{section.enabled===false?' · '+tr('已停用'):''}</span><small>{tagCount(p.works,categoryFilters,'category',section.id)}</small></button>)}{(manuscripts||unassignedCount>0)&&<button aria-pressed={filters.category[0]==='__unassigned__'} onClick={()=>setFilters(f=>({...f,type:[],category:['__unassigned__']}))}><CategoryIcon category="all"/><span>{tr("未归栏")}</span><small>{unassignedCount}</small></button>}{(englishGaps>0||filters.english)&&<button className="manager-english-filter" aria-pressed={!!filters.english} title={tr("已公开但还没有英文页面")} onClick={()=>setFilters(f=>({...f,english:f.english?undefined:'missing'}))}><CategoryIcon category="all"/><span>{tr("缺少英文版")}</span><small>{englishGaps}</small></button>}</fieldset></section></aside>
    <div className="manager-search"><div className="manager-search-field"><input type="search" aria-label={manuscripts?tr("搜索稿件"):tr("搜索作品")} placeholder={tr("搜索标题、摘要、平台")} value={filters.query} onChange={e=>setFilters(f=>({...f,query:e.target.value}))}/></div><div className="manager-search-actions"><button className="manager-refresh" aria-label={refreshLabel} title={refreshBusy?tr("正在刷新…"):refreshLabel} aria-busy={refreshBusy} disabled={refreshBusy} onClick={()=>void refresh(refreshLocation)}><EditorialIcon name="refresh"/></button><button className="manager-refresh manager-refresh-published" aria-label={tr("刷新发布记录")} title={refreshBusy?tr("正在刷新…"):tr("刷新发布记录（飞书台账）")} disabled={refreshBusy} onClick={()=>void refresh('external')}><EditorialIcon name="external"/></button></div></div>
    <div className={'manager-card-scroll'+(!visible.length?' is-empty':'')} ref={scroller} onScroll={e=>{navigation.current.scrollTop=e.currentTarget.scrollTop;persist();}}>{visible.length>0&&<div className="manager-grid">{visible.slice(0,limit).map(w=><div className="manager-row" key={w.id}><button className="manager-card" aria-current={selected===w.id?'true':undefined} aria-label={w.title+' · '+w.category+(refreshLocation==='cloud'&&w.status?' · '+tr(PUBLICATION_LABELS[w.status]):'')+(!manuscripts&&missingEnglish(w)?' · '+tr('缺少英文版'):'')} onClick={()=>open(w)}><div className="manager-card-meta"><span className="manager-category-label"><CategoryIcon category={w.category}/>{w.category}</span>{refreshLocation==='cloud'&&w.status&&!w.cloud&&<span className={w.status==='public'?'is-public':''}>{tr(PUBLICATION_LABELS[w.status])}</span>}</div><strong title={w.title}>{w.local?.editCopy&&<span className="manager-editing" title={tr("有未推送的编辑副本")}>{tr("编辑中")}</span>}{!manuscripts&&missingEnglish(w)&&<span className="manager-english-missing" title={tr("已公开但还没有英文页面")}>{tr("无英文")}</span>}{w.title}</strong>{workSummary(w)&&<p>{workSummary(w)}</p>}<footer><time>{w.date.slice(0,10)||'—'}</time><span>{w.locations.map(loc=><i key={loc} aria-label={p.sourceNames[loc]} title={p.sourceNames[loc]}><EditorialIcon name={loc}/></i>)}</span></footer></button>{refreshLocation==='cloud'&&w.cloud&&w.status&&<span className={'manager-row-status'+(w.status==='public'?' is-public':'')} title={tr("在作品中打开后可公开或取消公开")}>{tr(PUBLICATION_LABELS[w.status])}</span>}</div>)}</div>}{!visible.length&&<div className="work-empty manager-empty" role="status"><p>{loading?(manuscripts?tr("正在读取稿件…"):tr("正在读取作品…")):hasFilters?(manuscripts?tr("没有匹配稿件"):tr("没有匹配作品")):(manuscripts?tr("暂无稿件"):tr("暂无云端作品"))}</p>{hasFilters&&<button onClick={()=>setFilters(f=>({...EMPTY_FILTERS,location:f.location}))}>{tr("清除筛选")}</button>}</div>}{visible.length>limit&&<button className="manager-load-more" onClick={()=>setLimit(n=>n+60)}>{tr("继续显示（{{value}}）", {value: visible.length-limit})}</button>}</div>
   </section>
   {expanded&&<div className="manager-divider"><ResizeHandle visible side="right" width={collection.current?.offsetWidth||listWidth||480} min={320} max={Math.max(320,(split.current?.clientWidth||1200)-380)} onResize={resizeList} onReset={()=>resizeList(0)} label={tr("调整作品列表与预览宽度")}/></div>}
   {tabs.length>0&&<div id={prefix+'-expansion'} className="manager-expansion" style={!expanded?{display:'none'}:undefined}>
   {tabs.map(t=>{const work=p.works.find(w=>w.id===t.id);if(!work)return selected===t.id?<div role="tabpanel" key={t.id} className="work-empty manager-empty"><p>{tr("作品暂不可用")}</p><button onClick={()=>close(t.id)}>{tr("关闭标签页")}</button></div>:null;const locked=!p.canEdit(t.id);return <div role="tabpanel" id={prefix+'-work-'+t.id} aria-label={work.title} className="manager-work" key={t.id} style={selected!==t.id?{display:'none'}:undefined}>{locked?<p className="work-notice">{tr("此稿件正在创作页编辑，请先保存后再操作。")}</p>:<WorkDetail editInPlace={scope==='cloud'} onDiscarded={scope==='cloud'?undefined:()=>{const id=t.id;receive(id,{context:contexts.current[id]?.context||"",dirty:false,busy:false});close(id);}} relatedConversations={creationHistory(work,p.tasks||[])} conversationsLoading={p.tasksLoading} onOpenConversation={p.onOpenConversation} work={work} initialSource={scope} editNonce={manuscripts&&p.openRequest?.id===t.id?p.openRequest.nonce:undefined} browserViewId={prefix+'-'+t.id.replace(/[^a-z0-9-]/gi,'_')} active={p.active&&selected===t.id} agentBusy={!!p.leases[t.id]&&!p.leases[t.id].owner.startsWith('editor-')} refreshToken={p.refreshToken} onChanged={p.onChanged} onCloudChanged={p.onCloudChanged} onEditorContext={callback(t.id)} onLocalView={noop} onOpenLocal={p.onOpenLocal}/>}</div>;})}
   </div>}
   </div>
  </main>
 </section>;
}
