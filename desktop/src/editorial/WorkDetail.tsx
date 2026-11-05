import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import {writableSectionsForSite,sectionsForSite} from '../../../contracts/site-sections.mjs';
import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {invoke} from '../lib/nativeCore';
import PrivateHtmlPreview from './PreviewInternalNotes';
import ArticleReviewNotes from './ArticleReviewNotes';
import {openUrl} from '@tauri-apps/plugin-opener';
import EditorialBoard from './EditorialBoard';
import WechatPreview from './WechatPreview';
import NoteCardsPreview from './NoteCardsPreview';
import EditorialIcon from './EditorialIcon';
import PopoverDetails from '../components/PopoverDetails';
import ConfirmDialog from '../components/ConfirmDialog';
import {useToastMessage} from '../hooks/useToastMessage';
import WebsitePublisher from '../publications/WebsitePublisher';
import PublicationReader from '../publications/PublicationReader';
import {SYNC_LABELS,type WebsiteDraftDetail} from '../publications/websitePublishing';
import {WRITING_TYPES} from '../../scripts/agent/notebook.mjs';
import {PUBLICATION_LABELS,LOCATION_LABELS,localDraftDate,workActions,type Work} from './contentLibrary';

import { tr, trKey } from "../uiText";
const call=<T,>(method:string,params:object={})=>invoke<T>('website_publish_call',{method,params});
type Cloud={id:string;title:string;html:string;version:number;publishedVersion:number|null;publicationState?:'published'|'withdrawn'|'unpublished';url:string;metadata:{category:string;date:string};structure?:{kind:string|null;sections:string[];unnumbered:string[]}};
type Action='publish'|'withdraw'|'delete';
type Receipt={action:Action;status:string;requestKey:string;error?:string;job?:{id:string;status:string;error?:string};deleted?:boolean;publicReadback?:boolean;withdrawnReadback?:boolean;cleanupError?:string;readbackError?:string;localReleased?:boolean;awaitingDelivery?:boolean};
// Editing a cloud article keeps its remote identity and published version intact.
type CloudIntent=Action|'retrieve';
const ACTION_LABELS={publish:trKey('公开到官网'),withdraw:trKey('取消公开'),delete:trKey('删除云端作品'),retrieve:trKey('取回编辑')};
const actionVerified=(receipt:Receipt)=>receipt.action==='publish'?receipt.publicReadback===true:receipt.action==='withdraw'?receipt.withdrawnReadback===true:true;
const actionFinished=(receipt:Receipt)=>receipt.status==='success'&&actionVerified(receipt)&&!receipt.cleanupError&&!receipt.readbackError&&!receipt.awaitingDelivery;
export type EditorContext={context:string;dirty:boolean;busy?:boolean};
import type {CreationRecord} from './creationHistory';
type Props={editInPlace?:boolean;onDiscarded?:()=>void;relatedConversations?:CreationRecord[];conversationsLoading?:boolean;onOpenConversation?:(id:string)=>void|Promise<void>;editNonce?:number;readOnly?:boolean;onDelivered?:()=>Promise<void>;initialSource?:'local'|'cloud';workflow?:boolean;actionHost?:HTMLElement|null;onOpenPublish?:(id:string)=>void;requestedView?:'work'|'publish';work:Work;browserViewId?:string;agentBusy?:boolean;active:boolean;obscured?:boolean;refreshToken:number;onChanged:()=>void;onCloudChanged:()=>Promise<void>;onEditorContext:(value:EditorContext)=>void;onLocalView:(value:boolean)=>void;onOpenLocal:(id:string)=>void};

export default function WorkDetail({editInPlace=false,onDiscarded,work:w,relatedConversations=[],conversationsLoading=false,onOpenConversation,editNonce,readOnly=false,onDelivered,onOpenPublish,requestedView,initialSource,workflow=false,actionHost,browserViewId,agentBusy=false,active,obscured=false,refreshToken,onChanged,onCloudChanged,onEditorContext,onLocalView,onOpenLocal}:Props){
  const [view,setView]=useState<'local'|'cloud'|'external'|'publish'>(initialSource&&w.locations.includes(initialSource)?initialSource:w.local?'local':w.cloud?'cloud':'external');
  const [request,setRequest]=useState({id:w.id,nonce:Date.now(),mode:'preview' as 'preview'|'edit'});
  useEffect(()=>{if(editNonce&&w.local&&!readOnly)setRequest({id:w.id,nonce:editNonce,mode:'edit'});},[editNonce]);
  const [error,setError]=useToastMessage(),[,setNotice]=useToastMessage('default');
  const [cloud,setCloud]=useState<Cloud|null>(null),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[editorBusy,setEditorBusy]=useState(false);
  const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
  const exportRunning=useRef(false);
  const [confirmation,setConfirmation]=useState<{target:'local';fingerprint:string}|{target:'cloud';action:CloudIntent;version:number;publishedVersion:number|null}|null>(null);
  // A cloud work has the same two previews as a local one: the site view carries the cloud controls, the WeChat view the copy.
  const [cloudPane,setCloudPane]=useState<'site'|'wechat'|'notes'>('site'),[wechatHost,setWechatHost]=useState<HTMLElement|null>(null);
  const [discard,setDiscard]=useState<{fingerprint:string}|null>(null);
  const [receipt,setReceipt]=useState<Receipt|null>(null),[externalId,setExternalId]=useState(w.external[0]?.id||''),[pullPending,setPullPending]=useState(false);
  const receiptRef=useRef(receipt),polling=useRef(false);receiptRef.current=receipt;
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(readOnly&&view==='publish')setView(w.local?'local':'cloud');},[readOnly,view]);
  const locked=readOnly||busy||dirty||editorBusy||!!confirmation||!!discard;
  const context=useCallback((value:EditorContext)=>{setDirty(value.dirty);setEditorBusy(!!value.busy);},[]);
  const publisherBusy=useCallback((value:boolean)=>setEditorBusy(value),[]);
  useEffect(()=>{onLocalView(view==='local'&&!!w.local);onEditorContext({context:w.title+(w.local?' · '+w.local.canonicalPath:''),dirty,busy:busy||editorBusy||!!confirmation});},[view,w.local?.id,w.local?.canonicalPath,w.title,busy,editorBusy,confirmation,dirty,onLocalView,onEditorContext]);
  useEffect(()=>{let cancelled=false;void call<Receipt|null>('cloud_action_cached',{id:w.id}).then(x=>{if(!cancelled)setReceipt(x);}).catch(()=>{});return()=>{cancelled=true;};},[w.id,refreshToken]);
  useEffect(()=>{if((view==='local'||view==='publish')&&!w.local)setView(w.cloud?'cloud':'external');},[view,w.local,w.cloud]);
  useEffect(()=>{if(view==='cloud'&&!w.cloud){setCloud(null);setView(w.local?'local':'external');}},[view,w.local,w.cloud]);
  useEffect(()=>{
    if(!active||view!=='cloud'||!w.cloud)return;let cancelled=false;setError('');
    void call<Cloud>('cloud',{id:w.cloud.articleId,cache:true,notes:cloudPane==='notes'}).then(x=>{if(!cancelled)setCloud(x);}).catch(e=>{if(!cancelled)setError(String(e));});
    return()=>{cancelled=true;};
  },[active,view,w.cloud?.articleId,w.cloud?.version,refreshToken,cloudPane==='notes']);
  async function queryAction(){
    if(polling.current)return;polling.current=true;
    try{const result=await call<Receipt|null>('cloud_action_status',{id:w.id});if(!mounted.current)return;setReceipt(result);setError('');
      if(result?.status==='success'&&JSON.stringify(result)!==JSON.stringify(receiptRef.current)){if(actionFinished(result))setNotice(result.action==='withdraw'?tr("已取消公开，官网页面已撤下；稿件仍在云端"):result.action==='delete'?tr("云端作品已移除"):tr("已公开到官网"));await onChanged();await onCloudChanged();}
    }catch(e){if(mounted.current)setError(String(e));}finally{polling.current=false;}
  }
  useEffect(()=>{if(!receipt||!(['queued','running'].includes(receipt.status)||receipt.status==='success'&&!actionVerified(receipt)))return;const timer=setInterval(()=>void queryAction(),5000);return()=>clearInterval(timer);},[receipt?.status,receipt?.publicReadback,receipt?.withdrawnReadback]);
  const pending=!!receipt&&(['unknown','queued','running'].includes(receipt.status)||receipt.status==='success'&&!actionVerified(receipt));
  async function beginCloud(action:CloudIntent){if(locked||!w.cloud)return;setBusy(true);setError('');try{const next=await call<Cloud>('cloud',{id:w.cloud.articleId});setCloud(next);setView('cloud');setConfirmation({target:'cloud',action,version:next.version,publishedVersion:next.publishedVersion});}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function editCloud(){
    if(locked||pending||!w.cloud)return;
    if(w.local){setView('local');setRequest({id:w.id,nonce:Date.now(),mode:'edit'});return;}
    setBusy(true);setError('');
    try{const pulled=await call<{id:string;conflict:boolean;message?:string;editCopy?:boolean}>('pull',{id:w.cloud.articleId,source:'cloud'});setNotice(pulled.conflict?(pulled.message||tr("本地修改已保留，请比较取回的版本")):tr("已载入编辑副本，云端版本保持不变"));setPullPending(pulled.id===w.id);await onChanged();
      // Works edits its own copy in this tab; other copies still open in Drafts.
      if(!(editInPlace&&pulled.editCopy&&!pulled.conflict&&pulled.id===w.id))onOpenLocal(pulled.id);}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function exportCloud(){
    if(exportRunning.current||!w.cloud)return;
    exportRunning.current=true;setExporting(true);setExportError('');
    try{await invoke('editorial_export_cloud',{id:w.cloud.articleId});}
    catch(e){if(mounted.current)setExportError(String(e));}
    finally{exportRunning.current=false;if(mounted.current)setExporting(false);}
  }
  // A pulled editing copy can be dropped at any time; the cloud version never changes.
  async function beginDiscard(){if(busy||editorBusy||pending||!w.local?.editCopy)return;setBusy(true);setError('');try{const detail=await call<WebsiteDraftDetail>('inspect',{id:w.local.id});if(!detail.sync?.fingerprint)throw Error(tr('稿件文件不完整，请先检查后再取消'));if(dirty||detail.sync.state!=='synced')setDiscard({fingerprint:detail.sync.fingerprint});else await discardCopy(detail.sync.fingerprint,false);}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function discardCopy(fingerprint:string,discardChanges:boolean){const id=w.local?.id||w.id;setBusy(true);setError('');try{await call('local_action',{id,action:'discard_pull',confirmed:true,expectedFingerprint:fingerprint,discardChanges});setDiscard(null);setDirty(false);setEditorBusy(false);if(w.cloud)setView('cloud');setNotice(tr("已取消编辑，云端版本保持不变"));onDiscarded?.();await onChanged();await onCloudChanged();}catch(e){setError(String(e));setDiscard(null);}finally{setBusy(false);}}
  const saveEditor=useRef<(()=>Promise<boolean>)|null>(null);
  async function saveDraft(){if(busy||editorBusy||!w.cloud)return;setBusy(true);setError('');try{if(!await(saveEditor.current?.()??Promise.resolve(true)))return;setDirty(false);setView('cloud');setNotice(tr("草稿已保存，可随时继续编辑"));await onChanged();}finally{setBusy(false);}}
  async function beginDeleteLocal(){if(locked||!w.local)return;setBusy(true);setError('');try{const detail=await call<WebsiteDraftDetail>('inspect',{id:w.local.id});if(!detail.sync?.fingerprint)throw Error(tr('稿件文件不完整，请先检查后再删除'));setConfirmation({target:'local',fingerprint:detail.sync.fingerprint});}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function confirm(){if(!confirmation||busy)return;const captured=confirmation;setBusy(true);setError('');
    try{
      if(captured.target==='local'){await call('local_action',{id:w.id,action:'delete',confirmed:true,expectedFingerprint:captured.fingerprint});setNotice(tr("本地稿件已移入可恢复备份；云端和外部记录保留"));setConfirmation(null);onChanged();}
      else if(captured.action==='retrieve'){
        // Pull a versioned editing copy without deleting the remote article.
        const pulled=await call<{id:string;conflict:boolean;message?:string}>('pull',{id:w.cloud!.articleId,source:'cloud',expectedFingerprint:w.local?.sync?.fingerprint});
        if(pulled.conflict){setNotice(pulled.message||tr("本地已有不同修改，已生成对照稿；云端作品未移除"));setConfirmation(null);onOpenLocal(pulled.id);return;}
        setConfirmation(null);setNotice(tr("已取回本地，可直接编辑并推送更新；云端版本保留"));setPullPending(pulled.id===w.id);await onChanged();await onCloudChanged();onOpenLocal(pulled.id);
      }
      else{const next=await call<Receipt>('cloud_action',{id:w.id,action:captured.action,confirmed:true,expectedVersion:captured.version,expectedPublishedVersion:captured.publishedVersion});setReceipt(next);setConfirmation(null);if(next.status==='success'){await onChanged();await onCloudChanged();}}
    }catch(e){setError(String(e));if(captured.target==='cloud')setReceipt(await call<Receipt|null>('cloud_action_cached',{id:w.id}).catch(()=>null));setConfirmation(null);}finally{setBusy(false);}
  }
  async function category(value:string){if(locked||!w.local)return;setBusy(true);setError('');try{await call('local_action',{id:w.id,action:'category',sectionId:value,expectedFingerprint:w.local.sync?.fingerprint});onChanged();}catch(e){setError(String(e));}finally{setBusy(false);}}
  useEffect(()=>{if(pullPending&&w.local){setView('local');setRequest({id:w.id,nonce:Date.now(),mode:'edit'});setPullPending(false);}},[pullPending,w.local,w.id]);
  const lastRequestedView=useRef<string|undefined>(undefined);
  useEffect(()=>{if(!requestedView||!active||dirty||lastRequestedView.current===requestedView)return;lastRequestedView.current=requestedView;setView(requestedView==='publish'?'publish':w.local?'local':w.cloud?'cloud':'external');},[requestedView,active,dirty]);
  function switchView(next:typeof view){if(locked)return;if(next==='publish'&&onOpenPublish){onOpenPublish(w.id);return;}setConfirmation(null);setView(next);setError('');}
  const external=w.external.find(x=>x.id===externalId)||w.external[0];
  const actions=workActions(w);
  const date=localDraftDate(w.local)||w.cloud?.dateLabel||cloud?.metadata.date;
  const actionControls=<div className="work-action-controls">{!readOnly&&<>
    {!workflow&&w.local?.editCopy&&(view==='local'||view==='publish')&&<button className="work-cancel-edit" disabled={busy||editorBusy||pending} title={tr("放弃本地编辑副本，云端及已公开版本保持不变")} onClick={()=>void beginDiscard()}>{tr("取消编辑")}</button>}
    {!workflow&&w.local?.editCopy&&w.cloud&&view==='local'&&<button className="work-save-draft" disabled={busy||editorBusy||pending} title={tr("保存修改并回到云端正文，稍后可继续编辑")} onClick={()=>void saveDraft()}>{tr("保存草稿")}</button>}
    {!workflow&&w.local&&!w.local.editCopy&&(view==='local'||view==='publish')&&<button className="work-danger" disabled={locked||pending} onClick={()=>void beginDeleteLocal()}>{tr("删除本地")}</button>}
    {workflow&&w.local&&view==='local'&&<button className="work-publish-primary" disabled={locked} onClick={()=>switchView('publish')}>{tr("发布")}</button>}
    {view==='cloud'&&cloudPane==='site'&&w.cloud&&<button role="switch" className="work-public-switch" aria-checked={actions.canWithdraw} aria-label={tr("公开到官网")} title={actions.canWithdraw?tr("已公开，点击取消公开"):tr("未公开，点击公开到官网")} disabled={locked||pending} onClick={()=>void beginCloud(actions.canWithdraw?'withdraw':'publish')}><i aria-hidden="true"/><span>{actions.canWithdraw?tr("已公开"):tr("未公开")}</span></button>}
    {view==='cloud'&&cloudPane==='site'&&actions.canWithdraw&&actions.canPublish&&<button disabled={locked||pending} title={tr("云端有比官网更新的版本")} onClick={()=>void beginCloud('publish')}>{tr("公开新版")}</button>}
    {view==='cloud'&&cloudPane==='site'&&w.cloud&&!w.local?.editCopy&&<button disabled={locked||pending} title={tr("取回本地编辑，保留云端及已公开版本")} onClick={()=>void editCloud()}>{tr("编辑")}</button>}
    {view==='external'&&<PopoverDetails className="work-more library-popover">
      <summary aria-label={tr("更多作品操作")} title={tr("更多作品操作")}><EditorialIcon name="more"/></summary>
      <div className="library-popover-body">
        {w.local&&<><small>{tr("本地稿件")}</small><button disabled={locked} onClick={()=>{switchView('local');setRequest({id:w.id,nonce:Date.now(),mode:'edit'});}}>{tr("编辑")}</button>{workflow&&<button disabled={locked} onClick={()=>switchView('publish')}>{tr("发布")}</button>}<button disabled={busy} onClick={()=>void invoke('editorial_open_directory',{path:w.local!.canonicalPath.slice(0,w.local!.canonicalPath.lastIndexOf('/')),target:'cursor'}).catch(e=>setError(String(e)))}>{tr("用 Cursor 打开")}</button><label className="work-category-setting">{tr("栏目")}<select aria-label={tr("发布栏目")} disabled={locked} value={w.sectionId||''} onChange={e=>void category(e.target.value)}><option value="">{tr("暂不归栏")}</option>{w.sectionId&&!writableSectionsForSite(ACTIVE_SITE).some(x=>x.id===w.sectionId)&&<option value={w.sectionId} disabled>{sectionsForSite(ACTIVE_SITE).find(x=>x.id===w.sectionId)?.name||w.category}{tr('（已停用）')}</option>}{writableSectionsForSite(ACTIVE_SITE).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><button disabled={locked||pending} className="work-danger" onClick={()=>void beginDeleteLocal()}>{tr("删除本地")}</button></>}
        {w.cloud&&<><small>{tr("云端作品")}</small>{<button disabled={locked||pending} onClick={()=>void beginCloud(actions.canWithdraw?'withdraw':'publish')}>{actions.canWithdraw?tr("取消公开"):tr("公开到官网")}</button>}{<button disabled={locked||pending} onClick={()=>void beginCloud('retrieve')}>{tr("撤回到本地")}</button>}<button disabled={locked||pending} className="work-danger" onClick={()=>void beginCloud('delete')}>{tr("删除云端")}</button></>}
        {!w.local&&!w.cloud&&<small>{tr("外部记录只读，请前往目标平台管理。")}</small>}
      </div>
    </PopoverDetails>}</>}
    {view==='cloud'&&w.cloud&&<button className="work-export-button" disabled={exporting} aria-busy={exporting} title={tr("导出云端正文与配图，不创建本地编辑副本")} onClick={()=>void exportCloud()}>{exporting?tr("正在导出…"):tr("导出")}</button>}
  </div>;
  return <section className="work-detail" inert={agentBusy} aria-label={tr("作品详情")}>
    {discard&&createPortal(<ConfirmDialog title={tr("放弃修改并取消编辑")} message={tr("《{{title}}》的本地修改尚未推送。取消编辑后，编辑副本移入本机可恢复备份，云端和官网保持当前版本。",{title:w.title})} confirmLabel={tr("放弃修改")} danger onConfirm={()=>void discardCopy(discard.fingerprint,true)} onClose={()=>setDiscard(null)}/>,document.body)}
    {exportError&&createPortal(<ConfirmDialog title={tr("导出失败")} message={exportError} confirmLabel={tr("知道了")} danger={false} hideCancel onConfirm={()=>setExportError('')} onClose={()=>setExportError('')}/>,document.body)}
    <header className="work-detail-heading" data-tauri-drag-region="deep"><h2 title={w.title}>{w.title}</h2>{onOpenConversation&&<PopoverDetails className="work-creation-history library-popover"><summary aria-label={tr("创作记录")} title={tr("回看相关创作对话")}>{tr("创作记录")}{relatedConversations.length>0&&<small>{relatedConversations.length}</small>}</summary><div className="library-popover-body" role="group" aria-label={tr("相关创作对话")}>{conversationsLoading?<p role="status">{tr("正在读取创作记录…")}</p>:relatedConversations.length?relatedConversations.map(record=><button key={record.id} onClick={()=>void onOpenConversation(record.id)}><span>{record.title||tr("创作对话")}</span><small>{record.completedAt?tr("已完成"):tr("进行中")}{record.updatedAt&&<> · <time>{record.updatedAt.slice(0,10)}</time></>}</small></button>):<p>{tr("暂无关联的创作对话")}</p>}</div></PopoverDetails>}<PopoverDetails className="work-info library-popover"><summary aria-label={tr("作品信息")} title={tr("作品标签、日期与文件信息")}><EditorialIcon name="info"/></summary><div className="library-popover-body"><strong>{w.title}</strong><div className="work-tags">{view==='cloud'&&w.status&&<span className={w.status==='public'?'is-published':''}>{tr(PUBLICATION_LABELS[w.status])}</span>}{w.locations.map(x=><span key={x}>{tr(LOCATION_LABELS[x])}</span>)}{(w.types||[w.type]).map(type=><span key={type} title={tr("内容类型")}>{WRITING_TYPES[type]?.name||type}</span>)}<span title={tr("栏目")}>{w.category}</span></div>{date&&<p>{tr("日期")} <time>{date}</time></p>}{w.local&&<><p>{tr(SYNC_LABELS[w.local.sync?.state||'unknown'])}</p><p className="work-file-path">{w.local.canonicalPath}</p></>}{receipt&&actionFinished(receipt)&&<p>{tr("{{action}} · 已完成", {action: tr(ACTION_LABELS[receipt.action])})}</p>}</div></PopoverDetails></header>
    {!workflow&&w.external.length>0&&<div className="work-published-on" role="group" aria-label={tr("已发布到")}><span>{tr("已发布到")}</span>{w.external.map(r=><button key={r.id} aria-pressed={view==='external'&&external?.id===r.id} disabled={locked} title={[r.title,r.status,r.account].filter(Boolean).join(' · ')} onClick={()=>{setExternalId(r.id);switchView('external');}}>{r.platform}{r.status&&<small>{r.status}</small>}</button>)}</div>}
    {!workflow&&view!=='local'&&view!=='publish'&&<div className="work-view-toolbar">{view==='cloud'?<div className="editorial-mode-picker work-cloud-panes" role="group" aria-label={tr("云端显示模式")}><button aria-pressed={cloudPane==='site'} onClick={()=>setCloudPane('site')}>{tr("官网预览")}</button><button aria-pressed={cloudPane==='wechat'} onClick={()=>setCloudPane('wechat')}>{tr("公众号预览")}</button><button aria-pressed={cloudPane==='notes'} onClick={()=>setCloudPane('notes')}>{tr("图文笔记预览")}</button></div>:<span className="work-view-label">{tr("只读")}</span>}<div className="wechat-controls-slot" ref={setWechatHost}/>{actionControls}</div>}
    {!workflow&&!readOnly&&view==='cloud'&&w.cloud&&w.local?.editCopy&&<div className="work-notice work-editing-notice" role="status"><strong>{tr("编辑中")}</strong><span>{w.local.sync?.state==='synced'?tr("尚未修改，关闭标签页时自动放弃"):tr("有未推送的修改，云端仍是原版本")}</span><button className="work-continue-edit" disabled={locked||pending} title={tr("回到未推送的编辑副本")} onClick={()=>void editCloud()}>{tr("继续编辑")}</button><button className="work-cancel-edit" disabled={busy||editorBusy||pending} title={tr("放弃本地编辑副本，云端及已公开版本保持不变")} onClick={()=>void beginDiscard()}>{tr("取消编辑")}</button></div>}
    {receipt&&!actionFinished(receipt)&&<div className="work-notice" role="status">{tr(ACTION_LABELS[receipt.action])} · {receipt.status==='success'?(receipt.cleanupError?tr("官网已发布，本地清理未完成"):receipt.awaitingDelivery?tr("官网已发布，等待交稿完成后移出本地"):tr("正在核验官网页面")):tr(({unknown:'提交结果待查询',queued:'服务器排队中',running:'正在更新官网页面',failed:'失败',rejected:'请求未通过',not_submitted:'服务器未收到请求'} as Record<string,string>)[receipt.status]||receipt.status)}{receipt.readbackError||receipt.cleanupError||receipt.job?.error||receipt.error?<span> · {receipt.readbackError||receipt.cleanupError||receipt.job?.error||receipt.error}</span>:null}{(pending||receipt.status==='success')&&<button onClick={()=>void queryAction()}>{tr("查询原任务")}</button>}</div>}
    {confirmation&&<div className="work-confirm" role="alertdialog" aria-label={tr("确认作品操作")}><strong>{confirmation.target==='local'?tr("删除本地稿件"):tr(ACTION_LABELS[confirmation.action])}《{w.title}》</strong><p>{confirmation.target==='local'?tr("稿件目录及图片移入本机可恢复备份；保留云端作品和外部记录。"):tr("操作云端 v{{version}}。{{value}}", {version: confirmation.version, value: tr(confirmation.action==='publish'?'下方正文将公开到官网。':confirmation.action==='withdraw'?'官网页面将撤下；稿件仍保留在云端，状态变为未公开。':confirmation.action==='retrieve'?'稿件将取回本地编辑，云端和官网保留当前版本；修改后点击推送更新。':'官网页面将撤下，作品从云端列表移除，服务器保留历史备份；不会取回本地。')})}</p><button disabled={busy} onClick={()=>void confirm()}>{busy?tr("正在提交…"):tr("确认操作")}</button><button disabled={busy} onClick={()=>setConfirmation(null)}>{tr("取消")}</button></div>}
    {(w.local||w.cloud)&&view!=='external'&&<ArticleReviewNotes articleId={w.id} version={String(w.local?.sync?.fingerprint||cloud?.version||w.cloud?.version||'')+':'+refreshToken} cloudRevision={view==='cloud'?(cloud?.version||w.cloud?.version):undefined}/>}
    <div className="work-viewer">
      {view==='local'&&w.local&&(workflow||readOnly)&&<EditorialBoard embedded readOnly={readOnly} active={active} openRequest={request} refreshToken={refreshToken} onSelection={context} onChanged={onChanged} wechat wechatCategory={w.category} toolbarEnd={workflow?undefined:actionControls}/>}
      {!readOnly&&(view==='publish'||view==='local'&&!workflow)&&w.local&&<WebsitePublisher saveRef={saveEditor} embedded editable={!workflow} retireLocal={!workflow&&!onDelivered} editorTools={actionControls} actionHost={actionHost} active={active} refreshToken={refreshToken} openRequest={request} onBusy={publisherBusy} onDirty={setDirty} onChanged={onChanged} onPublished={async()=>{await onDelivered?.();await onCloudChanged();}} onOpenDraft={id=>id===w.id?switchView('local'):onOpenLocal(id)}/>}
      {view==='cloud'&&cloud&&cloudPane==='notes'&&<NoteCardsPreview key={w.id} articleId={w.id} html={cloud.html} baseUrl={cloud.url}/>}
      {view==='cloud'&&cloud&&cloudPane==='wechat'&&<WechatPreview toolbarHost={wechatHost} articleId={w.id} html={cloud.html} baseUrl={cloud.url} category={w.category} unnumbered={cloud.structure?.unnumbered}/>}
      {view==='cloud'&&(cloud?cloudPane!=='site'?null:<div className="editorial-preview" onClick={e=>{const a=(e.target as Element).closest('a');if(a){e.preventDefault();const href=a.getAttribute('href')||'';if(/^https?:\/\//.test(href))void openUrl(href);}}}><article className="editorial-prose"><p className="work-cloud-meta">v{cloud.version} · {cloud.publishedVersion===null?tr("未公开"):tr("已公开 v{{publishedVersion}}", {publishedVersion: cloud.publishedVersion})}  · {cloud.metadata.date}{cloud.publishedVersion!==null&&<button onClick={()=>void openUrl(cloud.url)}>{tr("打开官网 ↗")}</button>}</p><PrivateHtmlPreview articleId={w.id} html={cloud.html} cloudRevision={w.local?undefined:cloud.version}/></article></div>:<div className="work-empty">{error?tr("正文暂不可用"):tr("正在按需读取云端正文…")}</div>)}
      {view==='external'&&<div className="work-external"><div className="work-external-records"><p>{tr("外部发布记录只读。修改和撤回需前往目标平台。")}</p>{w.external.map(r=><button key={r.id} aria-pressed={external?.id===r.id} onClick={()=>setExternalId(r.id)}><strong>{r.platform}</strong><span>{r.status}</span><small>{r.account}</small></button>)}</div>{external?.url?<PublicationReader viewId={browserViewId} active={active} obscured={obscured} url={external.url} title={external.title}/>:<div className="work-empty">{tr("这条记录暂未提供作品链接")}</div>}</div>}
    </div>
    {dirty&&workflow&&<footer className="work-detail-foot" role="status">{tr("有未保存修改，保存后可提交或关闭稿件")}</footer>}
  </section>;
}
