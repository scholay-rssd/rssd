import ArticleImages from './ArticleImages';
import {useToastMessage} from '../hooks/useToastMessage';
import { lazy, Suspense, useEffect, useRef, useState,type ReactNode } from "react";
import { invoke } from "../lib/nativeCore";
import PrivateHtmlPreview from "./PreviewInternalNotes";
import "./editorial.css";
import {openUrl} from "@tauri-apps/plugin-opener";
import EditorialTree from "./EditorialTree";
import EditorialIcon from "./EditorialIcon";
import { isMac } from "../lib/platform";
import WechatPreview from "./WechatPreview";
import NoteCardsPreview from "./NoteCardsPreview";
import {SYNC_LABELS,type DraftSync,type WebsiteDraftDetail,type WebsitePublishingSnapshot} from '../publications/websitePublishing';
import { tr, uiLocale } from "../uiText";
const EditorialRichEditor=lazy(()=>import("./EditorialRichEditor"));
type Entry={id:string;shortTitle:string;canonicalPath:string;batchDate:string|null;sync?:DraftSync};
type Structure={kind:string|null;sections:string[];unnumbered:string[]};
type Draft=Entry&{markdown:string;sha256:string;structure?:Structure;structureIssue?:string|null};
const call=<T,>(method:string,params:object={})=>invoke<T>("editorial_call",{method,params});
export default function EditorialBoard({active,openRequest,onPublishWebsite,sidebarHeader,directoryAction,directoryDetails,refreshToken=0,onSelection,embedded=false,onChanged,toolbarStart,toolbarEnd,wechat=false,wechatCategory,readOnly=false}:{readOnly?:boolean;wechat?:boolean;wechatCategory?:string;active:boolean;openRequest?:{id:string;nonce:number;mode?:'preview'|'edit'};onPublishWebsite?:(id:string)=>void;sidebarHeader?:ReactNode;directoryAction?:ReactNode;directoryDetails?:ReactNode;refreshToken?:number;onSelection?:(value:{context:string;dirty:boolean;busy?:boolean})=>void;embedded?:boolean;onChanged?:()=>void;toolbarStart?:ReactNode;toolbarEnd?:ReactNode}){
  const [entries,setEntries]=useState<Entry[]>([]),[draft,setDraft]=useState<Draft|null>(null),[text,setText]=useState("");
  const [,setError]=useToastMessage();
  const [q,setQ]=useState(""),[busy,setBusy]=useState(false),[mode,setMode]=useState<"preview"|"edit"|"wechat"|"notes">("preview"),[html,setHtml]=useState(""),[external,setExternal]=useState<Draft|null>(null),[receipt,setReceipt]=useState("");
  const [loadingDraft,setLoadingDraft]=useState(false);
  const [wechatHost,setWechatHost]=useState<HTMLElement|null>(null);
  const [newTitle,setNewTitle]=useState<string|null>(null),[pendingEntry,setPendingEntry]=useState<Entry|null>(null);
  const [onlyPending,setOnlyPending]=useState(false),[checkedAt,setCheckedAt]=useState<string|null>(null),[syncDetail,setSyncDetail]=useState<WebsiteDraftDetail|null>(null),[checking,setChecking]=useState(false);
  const stamp=useRef(''),polling=useRef(false);
  const current=useRef({draft,text,busy});current.current={draft,text,busy};
  const dirty=!!draft&&text!==draft.markdown;
  useEffect(()=>{if(readOnly)setMode('preview');},[readOnly]);
  const handledRequest=useRef<number|undefined>(undefined);
  useEffect(()=>{onSelection?.({context:draft?`${draft.shortTitle} · ${draft.canonicalPath}`:tr('本地稿件工作区'),dirty,busy:busy&&!loadingDraft});},[draft?.id,draft?.shortTitle,draft?.canonicalPath,dirty,busy,loadingDraft,onSelection]);
  async function refresh(){
    const local=await call<{articles:Entry[]}>('draft_list');setEntries(local.articles.slice().reverse());
    try{const result=await invoke<WebsitePublishingSnapshot>('website_publish_call',{method:'snapshot',params:{}});if(Array.isArray(result.articles)){setEntries(result.articles);setCheckedAt(result.checkedAt||null);}}
    catch(e){setError(tr("同步状态暂不可用：{{e}}", {e: String(e)}));}
  }
  async function checkWebsite(){if(checking)return;setChecking(true);setError('');try{const value=await invoke<WebsitePublishingSnapshot>('website_publish_call',{method:'refresh',params:{}});setEntries(value.articles);setCheckedAt(value.checkedAt||null);}catch(e){setError(tr("{{e}} · 保留上次官网状态", {e: String(e)}));}finally{setChecking(false);}}
  async function preview(id:string){const result=await call<{html:string}>("draft_preview",{id,embedImages:true});setHtml(result.html);}
  async function load(entry:Entry,discard=false){
    if(!discard&&current.current.draft&&current.current.text!==current.current.draft.markdown){setPendingEntry(entry);return;}
    setPendingEntry(null);
    setLoadingDraft(true);setBusy(true);setError("");setHtml("");setReceipt("");
    try{const d=await call<Draft>("draft_read",{id:entry.id});setDraft(d);setText(d.markdown);setExternal(null);await preview(entry.id);
      const r=await call<{job?:{status:string};status?:string;url?:string}>("publication_status",{id:entry.id});setReceipt(r.job?.status ? tr("官网回执：{{status}}（本地记录）", {status: r.job.status}) : tr("本地工作副本"));
      setSyncDetail(await invoke<WebsiteDraftDetail>('website_publish_call',{method:'inspect',params:{id:entry.id}}));
    }catch(e){setError(String(e));}finally{setBusy(false);setLoadingDraft(false);}
  }
  useEffect(()=>{if(active)void refresh().catch(e=>setError(String(e)));},[active,refreshToken]);
  useEffect(()=>{if(!active||!draft)return;let cancelled=false;void invoke<WebsiteDraftDetail>('website_publish_call',{method:'inspect',params:{id:draft.id}}).then(value=>{if(!cancelled)setSyncDetail(value);}).catch(e=>setError(String(e)));return()=>{cancelled=true;};},[active,draft?.id,refreshToken]);
  useEffect(()=>{if(!active||embedded)return;const timer=setInterval(()=>{if(polling.current||document.hidden)return;polling.current=true;void call<{stamp:string}>('workspace_stamp').then(async value=>{if(value.stamp!==stamp.current){stamp.current=value.stamp;await refresh();}}).catch(e=>setError(String(e))).finally(()=>{polling.current=false;});},5000);return()=>clearInterval(timer);},[active,embedded]);
  useEffect(()=>{
    if(!active||!openRequest||busy||handledRequest.current===openRequest.nonce)return;
    handledRequest.current=openRequest.nonce;
    if(openRequest.mode)setMode(openRequest.mode);
    if(current.current.draft?.id!==openRequest.id)void load({id:openRequest.id,shortTitle:"",canonicalPath:"",batchDate:null});
  },[active,openRequest,busy]);
  useEffect(()=>{
    if(!active)return;
    const timer=setInterval(()=>{
      const before=current.current;if(!before.draft||before.busy||document.hidden)return;
      void call<Draft>("draft_read",{id:before.draft.id}).then(d=>{
        const now=current.current;if(now.draft?.id!==d.id||now.busy)return;
        if(d.sha256===now.draft.sha256){
          if(d.shortTitle!==now.draft.shortTitle||d.canonicalPath!==now.draft.canonicalPath||d.batchDate!==now.draft.batchDate)setDraft(d);
          return;
        }
        if(now.text!==now.draft.markdown)setExternal(d);
        else{setDraft(d);setText(d.markdown);void preview(d.id).catch(e=>setError(String(e)));}
      }).catch(e=>setError(String(e)));
    },3000);return()=>clearInterval(timer);
  },[active]);
  async function save(){if(readOnly||!draft)return false;setBusy(true);setError("");try{const d=await call<Draft>("draft_save",{id:draft.id,markdown:text,expectedSha256:draft.sha256});setDraft(d);setText(d.markdown);setExternal(null);await preview(d.id);await refresh();setSyncDetail(await invoke<WebsiteDraftDetail>('website_publish_call',{method:'inspect',params:{id:d.id}}));onChanged?.();return true;}catch(e){setError(String(e));return false;}finally{setBusy(false);}}
  // Picture previews use the in-memory draft without saving it. Other transitions retain their save behavior.
  async function switchMode(next:typeof mode){if(next===mode||busy)return;if(next!=="notes"&&mode==="edit"&&dirty&&!await save())return;setMode(next);}
  async function acceptMerge(){if(!draft||!syncDetail?.incoming||dirty)return;setBusy(true);try{const result=await invoke<WebsiteDraftDetail>('website_publish_call',{method:'accept_merge',params:{id:draft.id,revision:syncDetail.incoming.revision,expectedFingerprint:syncDetail.sync?.fingerprint}});setSyncDetail(result);await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function create(){const title=newTitle?.trim();if(!title)return;setBusy(true);setError("");try{const id="draft-"+crypto.randomUUID();const d=await call<Draft>("draft_create",{id,title,column:"新闻聚合",markdown:"# "+title+"\n\n"+"在这里写正文。\n"});await refresh();setNewTitle(null);await load(d);setMode("edit");}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function openDirectory(path:string,target:"finder"|"cursor"){
    setError("");
    try{await invoke("editorial_open_directory",{path,target});}catch(e){setError(String(e));}
  }
  function openPreviewLink(event:React.MouseEvent<HTMLDivElement>){
    const link=(event.target as Element).closest("a");if(!link)return;
    event.preventDefault();const href=link.getAttribute("href")||"";
    if(/^https?:\/\//i.test(href))void openUrl(href).catch(e=>setError(String(e)));
  }

  return <div className={`editorial-workspace${embedded?' editorial-embedded':''}`}>
    {!embedded&&<aside className="editorial-list">
      {isMac && <div className="titlebar" data-tauri-drag-region />}
      {sidebarHeader}
      <header className="editorial-library-header"><strong>{tr("稿件")} <small>{entries.length}</small></strong><div className="editorial-directory-actions">{directoryAction}<button className="editorial-icon-button" disabled={busy||checking} aria-label={tr("刷新稿件和官网状态")} title={tr("刷新稿件和官网状态")} onClick={()=>void refresh().then(checkWebsite).catch(e=>setError(String(e)))}><EditorialIcon name="refresh"/></button><button className="editorial-icon-button" disabled={busy||dirty} aria-label={tr("新建稿件")} title={tr("新建稿件")} onClick={()=>setNewTitle("")}><EditorialIcon name="plus"/></button></div></header>
      {directoryDetails}
      {newTitle!==null&&<form className="editorial-create" onSubmit={e=>{e.preventDefault();void create();}}><input autoFocus aria-label={tr("新稿标题")} placeholder={tr("新稿标题")} maxLength={120} value={newTitle} onChange={e=>setNewTitle(e.target.value)}/><div><button type="submit" disabled={busy||!newTitle.trim()}>{tr("创建稿件")}</button><button type="button" onClick={()=>setNewTitle(null)}>{tr("取消")}</button></div></form>}
      <div className="editorial-search-row"><input aria-label={tr("搜索稿件")} placeholder={tr("搜索稿件")} value={q} onChange={e=>setQ(e.target.value)}/><button className="editorial-icon-button" aria-label={tr("只看待处理")} title={onlyPending?tr("正在只看待处理，点击显示全部"):tr("只看待处理")} aria-pressed={onlyPending} onClick={()=>setOnlyPending(x=>!x)}><EditorialIcon name="filter"/></button></div>
      <EditorialTree entries={entries.filter(x=>!onlyPending||x.sync?.state!=='synced')} selectedId={draft?.id} query={q} disabled={busy||!active} dirty={dirty} onSelect={entry=>void load(entry)} onOpenDirectory={openDirectory}/>
      <footer title={checkedAt?tr("官网状态：{{toLocaleString}}", {toLocaleString: new Date(checkedAt).toLocaleString(uiLocale())}):tr("尚未查询官网状态")}>{tr("{{value}} · 已同步 {{length}}", {value: onlyPending?tr('待处理 {{count}} 篇',{count:entries.filter(x=>x.sync?.state!=='synced').length}):tr('共 {{count}} 篇',{count:entries.length}), length: entries.filter(x=>x.sync?.state==='synced').length})}<span>{checking?tr("正在查询官网…"):checkedAt?tr("已读取官网状态"):tr("尚未查询官网")}</span></footer>
    </aside>}
    <section className="editorial-main"><header {...(isMac && { "data-tauri-drag-region": "deep" })}><strong>{draft?.shortTitle||tr("稿件工作区")}{dirty?tr(" · 未保存"):""}</strong><div className="editorial-toolbar-main">{toolbarStart}<div className="editorial-mode-picker" role="group" aria-label={tr("稿件显示模式")}>{!readOnly&&<button disabled={!draft||busy} aria-pressed={mode==="edit"} onClick={()=>void switchMode("edit")}>{tr("编辑")}</button>}<button disabled={!draft||busy} aria-pressed={mode==="preview"} onClick={()=>void switchMode("preview")}>{mode==="edit"&&dirty?tr("保存"):tr("官网预览")}</button>{wechat&&<button disabled={!draft||busy} aria-pressed={mode==="wechat"} onClick={()=>void switchMode("wechat")}>{tr("公众号预览")}</button>}{wechat&&<button disabled={!draft||busy} aria-pressed={mode==="notes"} onClick={()=>void switchMode("notes")}>{tr("图文笔记预览")}</button>}</div>{embedded&&<select className="editorial-mode-select" aria-label={tr("稿件显示模式")} disabled={!draft||busy} value={mode} onChange={e=>void switchMode(e.target.value as typeof mode)}>{!readOnly&&<option value="edit">{tr("编辑")}</option>}<option value="preview">{mode==="edit"&&dirty?tr("保存"):tr("官网预览")}</option>{wechat&&<option value="wechat">{tr("公众号预览")}</option>}{wechat&&<option value="notes">{tr("图文笔记预览")}</option>}</select>}{draft&&<span className="website-local-actions"><button disabled={busy} title={tr("导出为独立目录：正文与全部图片")} onClick={()=>{setError("");void invoke("editorial_export_directory",{path:draft.canonicalPath.slice(0,draft.canonicalPath.lastIndexOf("/"))}).catch(e=>setError(String(e)));}}>{tr("导出")}</button><button disabled={busy} title={tr("用 Cursor 打开稿件目录并定位到正文")} onClick={()=>{setError("");void invoke("editorial_open_directory",{path:draft.canonicalPath.slice(0,draft.canonicalPath.lastIndexOf("/")),target:"cursor",file:draft.canonicalPath}).catch(e=>setError(String(e)));}}>{tr("用 Cursor 打开")}</button></span>}<div className="wechat-controls-slot" ref={setWechatHost}/>{!readOnly&&onPublishWebsite&&<button disabled={!draft||dirty||busy||!active} title={dirty?tr("请先保存本地稿件"):tr("进入官网发布，先预览再推送")} onClick={()=>{if(draft&&!dirty)onPublishWebsite(draft.id);}}>{tr("发布到官网")}</button>}</div>{toolbarEnd}</header>
      {pendingEntry&&<div className="editorial-message" role="alert">{tr("当前稿件有未保存修改。")}<button onClick={()=>void load(pendingEntry,true)}>{tr("放弃修改并切换")}</button><button onClick={()=>setPendingEntry(null)}>{tr("继续编辑")}</button></div>}
      {draft&&<div className="editorial-sync-summary"><span>{tr(SYNC_LABELS[entries.find(x=>x.id===draft.id)?.sync?.state||'unknown'])}</span>{syncDetail?.sync?.baseRevision&&<span>{tr("上次同步 v{{baseRevision}}", {baseRevision: syncDetail.sync.baseRevision})}</span>}</div>}
      {syncDetail?.id===draft?.id&&syncDetail?.incoming&&<details className="editorial-merge"><summary>{tr("官网 v{{revision}} 对照稿 · 本地修改已保留", {revision: syncDetail.incoming.revision})}</summary><p>{tr("先在编辑器中合并并保存，再确认已核对；确认后仍需预览推送，才会更新官网。")}</p><textarea readOnly aria-label={tr("官网对照 Markdown")} value={syncDetail.incoming.markdown}/><button disabled={readOnly||dirty||busy} onClick={()=>void acceptMerge()}>{tr("我已核对并保存合并结果")}</button></details>}
      {external&&<div className="editorial-message" role="alert">{tr("文件已被其他编辑器更新，当前输入已保留。")}<button onClick={()=>{void navigator.clipboard.writeText(text).then(()=>setError(tr("当前输入已复制，可在重载后手动合并"))).catch(()=>setError(tr("复制失败，请手动复制编辑区内容")));}}>{tr("复制我的输入")}</button><button onClick={()=>{setDraft(external);setText(external.markdown);setExternal(null);void preview(external.id);}}>{tr("舍弃当前输入并载入磁盘版本")}</button></div>}
      {draft&&!readOnly&&<ArticleImages key={draft.id} active={active} articleId={draft.id} disabled={dirty||busy} onBusy={setBusy} onChanged={async()=>{await load(draft,true);onChanged?.();}}/>}
      {draft?<>{!embedded&&<p className="editorial-path" title={draft.canonicalPath}>{draft.canonicalPath} · {receipt}</p>}{draft.structureIssue&&<p className="editorial-message" role="alert">{tr("稿件结构需要修复：{{structureIssue}}", {structureIssue: draft.structureIssue})}</p>}{mode==="notes"?<NoteCardsPreview key={draft.id} articleId={draft.id} text={text}/>:mode==="wechat"?<WechatPreview toolbarHost={wechatHost} articleId={draft.id} text={text} category={wechatCategory} unnumbered={draft.structure?.unnumbered}/>:mode==="edit"?<Suspense fallback={<p className="editorial-message">{tr("正在加载富文本编辑器…")}</p>}><EditorialRichEditor key={draft.id} articleId={draft.id} text={text} disabled={readOnly||busy} lockedHeadings={draft.structure?.sections} onChange={setText} onError={setError}/></Suspense>:<>{dirty&&<p className="editorial-message">{tr("预览显示已保存版本；保存后更新预览。")}</p>}<div className="editorial-preview" role="region" aria-label={tr("稿件阅读预览")} onClick={openPreviewLink}><PrivateHtmlPreview className="editorial-prose" articleId={draft.id} html={html}/></div></>}</>:<div className="editorial-empty"><h2>{tr("选择一篇稿件")}</h2><p>{tr("按月份或栏目浏览，点击标题即可阅读和编辑。稿件菜单可用 Finder 或 Cursor 打开所在目录。")}</p></div>}
    </section>
  </div>;
}
