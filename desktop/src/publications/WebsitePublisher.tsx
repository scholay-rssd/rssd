import {createPortal} from 'react-dom';
import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import {writableSectionsForSite,sectionsForSite} from '../../../contracts/site-sections.mjs';
import {lazy,memo,Suspense,useEffect,useLayoutEffect,useRef,useState,type ReactNode,type MouseEvent,type MutableRefObject} from 'react';
import {invoke} from '../lib/nativeCore';
import {openUrl} from '@tauri-apps/plugin-opener';
import Icon from '../components/Icon';
import ConfirmDialog from '../components/ConfirmDialog';
import ResizeHandle from '../components/ResizeHandle';
import PublicationReader from './PublicationReader';
import WechatPreview from '../editorial/WechatPreview';
import NoteCardsPreview from '../editorial/NoteCardsPreview';
import PrivateHtmlPreview from '../editorial/PreviewInternalNotes';
import {usePublicationSplit} from './usePublicationSplit';
import {WEBSITE_STAGES,SYNC_LABELS,englishStatus,duplicateRecordOf,type WebsiteStage,type WebsiteMetadata,type WebsiteDraftDetail,type WebsitePublishingSnapshot} from './websitePublishing';
import './publications.css';
import './website-publisher.css';

import { tr, trKey, uiLocale } from "../uiText";
const loadRichEditor=()=>import('../editorial/EditorialRichEditor');
const RichEditor=lazy(loadRichEditor);
const editorial=<T,>(method:string,params:Record<string,unknown>={})=>invoke<T>('editorial_call',{method,params});
type Source={markdown:string;sha256:string;structure?:{kind:string|null;sections:string[];unnumbered:string[]};structureIssue?:string|null};
const call=<T,>(method:string,params:Record<string,unknown>={})=>invoke<T>('website_publish_call',{method,params});
const INITIAL:WebsitePublishingSnapshot={connection:{configured:false,origin:'https://today.scholay.com'},articles:[]};
const FILTERS=[['all',trKey('全部稿件')],['local',trKey('本地待推送')],['queue',trKey('推送任务')],['published',trKey('已公开回读')],['attention',trKey('需要处理')]] as const;
function matches(stage:WebsiteStage,filter:string){return filter==='all'||(filter==='local'?['local','prepared'].includes(stage):filter==='queue'?['queued','running','verify','unknown'].includes(stage):filter==='published'?stage==='published':['cleanup','failed','rejected'].includes(stage));}

const PreviewHtml=memo(function PreviewHtml({html,articleId}:{html:string;articleId:string}){return <PrivateHtmlPreview className="website-preview-html" articleId={articleId} html={html}/>;});

export default function WebsitePublisher({active,onOpenDraft,openRequest,navigation,embedded=false,editable=false,retireLocal=false,controlsOnly=false,submissionBlocked=false,refreshToken=0,onPending,onChanged,onBusy,onPublished,onDirty,actionHost,editorTools,saveRef}:{saveRef?:MutableRefObject<(()=>Promise<boolean>)|null>;editorTools?:ReactNode;actionHost?:HTMLElement|null;active:boolean;onOpenDraft:(id:string)=>void;openRequest?:{id:string;nonce:number;mode?:'edit'|'preview'};navigation?:ReactNode;embedded?:boolean;editable?:boolean;retireLocal?:boolean;controlsOnly?:boolean;submissionBlocked?:boolean;refreshToken?:number;onPending?:(pending:boolean)=>void;onChanged?:()=>void|Promise<void>;onBusy?:(busy:boolean)=>void;onPublished?:()=>Promise<void>;onDirty?:(dirty:boolean)=>void}){
  const [snapshot,setSnapshot]=useState(INITIAL),[selected,setSelected]=useState(''),[detail,setDetail]=useState<WebsiteDraftDetail|null>(null);
  const [error,setError]=useState('');
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[busy,setBusy]=useState(''),[loaded,setLoaded]=useState(false);
  const [edits,setEdits]=useState<Record<string,WebsiteMetadata>>({}),[confirm,setConfirm]=useState(false),[intent,setIntent]=useState<'publish'|'draft'>('publish'),[previewMode,setPreviewMode]=useState<'local'|'website'>('local'),[infoOpen,setInfoOpen]=useState(false);
  const [source,setSource]=useState<Source|null>(null),[text,setText]=useState(''),[liveHtml,setLiveHtml]=useState(''),[liveError,setLiveError]=useState(''),[pane,setPane]=useState<'edit'|'preview'|'wechat'|'notes'>('preview'),[wechatHost,setWechatHost]=useState<HTMLElement|null>(null);
  const [editorVisited,setEditorVisited]=useState(false);
  useEffect(()=>{if(pane==='edit')setEditorVisited(true);},[pane]);
  const editorScroll=useRef<HTMLDivElement>(null),previewScroll=useRef<HTMLDivElement>(null),scrollPositions=useRef({edit:0,preview:0});
  function selectPane(next:typeof pane){
    if(pane==='edit')scrollPositions.current.edit=editorScroll.current?.scrollTop||0;
    if(pane==='preview')scrollPositions.current.preview=previewScroll.current?.scrollTop||0;
    setPane(next);
  }
  useLayoutEffect(()=>{const host=pane==='edit'?editorScroll.current:pane==='preview'?previewScroll.current:null;if(host)host.scrollTop=scrollPositions.current[pane as 'edit'|'preview'];},[pane]);
  const bodyDirty=!!source&&text!==source.markdown;
  const sourceId=useRef(''),sourceEpoch=useRef(0),conflictSha=useRef(''),sourceRef=useRef(source);sourceRef.current=source;
  const bodyDirtyRef=useRef(bodyDirty);bodyDirtyRef.current=bodyDirty;
  useEffect(()=>{if(!editable||!active||!selected)return;let obsolete=false,reading=false;
    const read=async()=>{if(reading)return;reading=true;const generation=sourceEpoch.current;try{
      const next=await editorial<Source>('draft_read',{id:selected});if(obsolete||generation!==sourceEpoch.current)return;
      if(sourceRef.current?.sha256===next.sha256)return;
      if(bodyDirtyRef.current){if(conflictSha.current!==next.sha256){conflictSha.current=next.sha256;setError(tr("稿件已在其他编辑器修改，请先保留当前修改后重新打开。"));}return;}
      conflictSha.current='';
      sourceRef.current=next;setSource(next);setText(next.markdown);
    }finally{reading=false;}};
    if(sourceId.current!==selected){sourceId.current=selected;sourceEpoch.current++;bodyDirtyRef.current=false;sourceRef.current=null;setSource(null);setText('');setLiveHtml('');}
    void read().catch(e=>!obsolete&&setError(String(e)));
    const timer=setInterval(()=>{if(!busyRef.current&&!document.hidden)void read().catch(()=>{});},3000);
    return()=>{obsolete=true;clearInterval(timer);};
  },[editable,active,selected]);
  // Render on demand. Revisiting unchanged content reuses the preview, while
  // editing and hidden tabs do no image embedding or preview work.
  const previewCache=useRef<{id:string;text:string;html:string}|null>(null);
  useEffect(()=>{if(!editable||!active||!source||!['preview','wechat'].includes(pane))return;
    const cached=previewCache.current;if(cached?.id===selected&&cached.text===text)return;
    let obsolete=false;setLiveError('');
    void editorial<{html:string}>('draft_preview',{id:selected,markdown:text,embedImages:true}).then(x=>{
      if(!obsolete){previewCache.current={id:selected,text,html:x.html};setLiveHtml(x.html);}
    }).catch(e=>{if(!obsolete)setLiveError(String(e));});
    return()=>{obsolete=true;};
  },[editable,active,selected,text,!!source,pane]);
  const confirmationRef=useRef<HTMLElement>(null);
  const pollError=useRef('');
  const busyRef=useRef(false),activeRef=useRef(active),selectedRef=useRef(selected),epoch=useRef(0);activeRef.current=active;selectedRef.current=selected;
  const split=usePublicationSplit(active&&!(editable&&embedded&&!controlsOnly),'platforms','scholay.website.publisher.split.v1');
  useEffect(()=>{if(confirm)confirmationRef.current?.scrollIntoView?.({block:'nearest'});},[confirm]);
  const onBusyRef=useRef(onBusy);onBusyRef.current=onBusy;
  useEffect(()=>{onBusyRef.current?.(!!busy);},[busy]);
  useEffect(()=>()=>onBusyRef.current?.(false),[]);
  const visible=snapshot.articles.filter(x=>(!embedded||x.id===openRequest?.id)&&matches(x.stage,filter)&&[x.shortTitle,x.canonicalPath].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  async function refresh(){const data=await call<WebsitePublishingSnapshot>('snapshot');setSnapshot(data);setLoaded(true);return data;}
  useEffect(()=>{if(active)void refresh().catch(e=>{setError(String(e));setLoaded(true);});},[active,refreshToken]);
  const appliedRequest=useRef('');
  useEffect(()=>{if(!active||!openRequest)return;const key=openRequest.id+':'+openRequest.nonce;if(appliedRequest.current===key)return;appliedRequest.current=key;setFilter('all');setQuery('');setSelected(openRequest.id);setPane(openRequest.mode||'preview');},[active,openRequest?.id,openRequest?.nonce,openRequest?.mode]);
  useEffect(()=>{if(active&&loaded&&!selected&&visible[0])setSelected(current=>current||visible[0].id);},[active,loaded,selected,visible[0]?.id]);
  // A background refresh re-reads the same article in place; only a different article clears the pane.
  const loadedId=useRef('');
  async function load(id:string){const generation=++epoch.current,same=loadedId.current===id;loadedId.current=id;if(!same){setDetail(null);setError('');setConfirm(false);setPreviewMode('local');}try{const d=await call<WebsiteDraftDetail>('inspect',{id});if(epoch.current===generation){setDetail(previous=>JSON.stringify(previous)===JSON.stringify(d)?previous:d);}}catch(e){if(epoch.current===generation)setError(String(e));}}
  useEffect(()=>{if(active&&selected)void load(selected);return()=>{epoch.current++;};},[active,selected,refreshToken]);
  const metadata=detail?(edits[detail.id]||detail.metadata):null;
  const metadataDirty=Boolean(detail&&metadata&&JSON.stringify(metadata)!==JSON.stringify(detail.metadata));
  const onDirtyRef=useRef(onDirty);onDirtyRef.current=onDirty;
  useEffect(()=>{onDirtyRef.current?.(metadataDirty||bodyDirty);},[metadataDirty,bodyDirty]);
  useEffect(()=>()=>onDirtyRef.current?.(false),[]);
  const prepared=detail?.prepared;
  const pending=!!detail&&['unknown','queued','running','verify'].includes(detail.stage);
  const onPendingRef=useRef(onPending);onPendingRef.current=onPending;
  useEffect(()=>{onPendingRef.current?.(pending);},[pending]);
  useEffect(()=>()=>onPendingRef.current?.(false),[]);
  const canPrepare=Boolean(active&&!submissionBlocked&&detail&&metadata?.date&&metadata.summary.trim()&&(snapshot.connection.configured||snapshot.connection.requiresCheck)&&!['queued','running','unknown','verify'].includes(detail.stage));
  const canPublish=Boolean(active&&!submissionBlocked&&prepared&&detail&&!detail.stale&&!metadataDirty&&!bodyDirty&&['prepared','unknown'].includes(detail.stage)&&(prepared?.intent||'publish')===intent);
  const publicUrl=Boolean(detail?.receipt?.url&&/^\/(news|calendar|history|open-source)\//.test(detail.receipt.url))?snapshot.connection.origin+detail!.receipt!.url:null;
  function select(id:string){if(busyRef.current)return;setSelected(id);setConfirm(false);}
  function edit(key:keyof WebsiteMetadata,value:string){if(!detail||!metadata)return;setConfirm(false);setEdits(prev=>({...prev,[detail.id]:{...metadata,[key]:value,...(key==='sectionId'?{category:sectionsForSite(ACTIVE_SITE).find(s=>s.id===value)?.name||'未归栏'}:{})}}));}
  async function action(method:'prepare'|'publish'|'status',thenConfirm=false,want:'publish'|'draft'=intent,direct=false,background=false){
    if((method!=='status'&&!activeRef.current)||busyRef.current||!detail)return;
    if(method==='publish'&&(!direct&&!confirm||!prepared||detail.stale||bodyDirty||metadataDirty||submissionBlocked||!['prepared','unknown'].includes(detail.stage)))return;
    busyRef.current=true;if(!background){setBusy(method);setError('');}const id=detail.id;
    try{
      let expectedSourceSha256=detail.sourceSha256;
      if(method==='prepare'&&editable){
        if(!source)throw Error(tr('正文尚未载入'));
        expectedSourceSha256=source.sha256;
        if(bodyDirty){sourceEpoch.current++;const saved=await editorial<Source>('draft_save',{id,markdown:text,expectedSha256:source.sha256});sourceRef.current=saved;setSource(saved);setText(saved.markdown);bodyDirtyRef.current=false;expectedSourceSha256=saved.sha256;}
      }
      const params=method==='prepare'?{id,intent:want,releaseLocal:retireLocal,metadata,expectedSourceSha256,expectedMetadataSha256:detail.metadataSha256}:method==='publish'?{id,confirmed:true,packetSha256:prepared?.packetSha256,retry:detail.stage==='unknown'}:{id};
      let result=await call<WebsiteDraftDetail>(method==='publish'&&prepared?.intent==='draft'?'save_cloud':method,params);
      if(method==='prepare'&&direct){
        if(result.stage!=='prepared'||result.stale||!result.prepared||result.prepared.intent!==want)throw Error(tr('稿件检查未完成，请重试。'));
        setBusy('publish');
        result=await call<WebsiteDraftDetail>(want==='draft'?'save_cloud':'publish',{id,confirmed:true,packetSha256:result.prepared.packetSha256,retry:false});
      }
      if(method==='publish'||method==='prepare'&&direct)window.dispatchEvent(new Event('scholay-background-queue-changed'));
      if(selectedRef.current===id){setDetail(previous=>JSON.stringify(previous)===JSON.stringify(result)?previous:result);if(method==='prepare'){setEdits(prev=>{const next={...prev};delete next[id];return next;});setPreviewMode('local');}setConfirm(thenConfirm&&method==='prepare'&&result.stage==='prepared');}
      if(result.localReleased){bodyDirtyRef.current=false;onDirty?.(false);}
      // Pending status reads do not rebuild the library or interrupt the editor.
      if(method!=='status'||!['queued','running','verify'].includes(result.stage)){await Promise.all([refresh(),onChanged?.()]);}
      if(['published','draft_saved'].includes(result.stage)&&!result.cleanupError&&(result.localReleased||!retireLocal))await onPublished?.();
      pollError.current='';
    }catch(e){let message=String(e);setConfirm(false);try{
      const result=await call<WebsiteDraftDetail>('inspect',{id});
      if(selectedRef.current===id){setDetail(result);if(method==='status'&&['published','draft_saved'].includes(result.stage)&&!result.cleanupError)message='';}
      await refresh();
    }catch{/* Keep the original error when recovery also fails. */}
      if(message&&(!background||pollError.current!==message)){setError(message);if(background)pollError.current=message;}
    }
    finally{busyRef.current=false;if(!background)setBusy('');}
  }
  async function saveBody(){
    if(!source||(!bodyDirty&&!metadataDirty)||busyRef.current)return false;busyRef.current=true;setBusy('save');setError('');sourceEpoch.current++;
    try{let saved=source;if(bodyDirty){saved=await editorial<Source>('draft_save',{id:selected,markdown:text,expectedSha256:source.sha256});setSource(saved);setText(saved.markdown);bodyDirtyRef.current=false;}
      if(metadataDirty){setDetail(await call<WebsiteDraftDetail>('local_action',{id:selected,action:'metadata',metadata,expectedSourceSha256:saved.sha256,expectedMetadataSha256:detail?.metadataSha256}));setEdits(prev=>{const next={...prev};delete next[selected];return next;});}
      else setDetail(current=>current?{...current,sourceSha256:saved.sha256,stale:!!current.prepared}:current);onChanged?.();return true;}
    catch(e){setError(String(e));return false;}finally{busyRef.current=false;setBusy('');}
  }
  // Lets the host save before leaving edit mode; nothing to save counts as saved.
  if(saveRef)saveRef.current=async()=>!bodyDirtyRef.current&&!metadataDirty?true:await saveBody();
  // Submitted requests keep being observed while their mounted tab is hidden.
  // Status queries never prepare or submit another request.
  useEffect(()=>{if(!active||!detail||!['queued','running','verify'].includes(detail.stage))return;const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void action('status',false,intent,false,true);},15000);return()=>clearInterval(timer);},[active,detail]);
  function previewLink(event:MouseEvent<HTMLElement>){const a=(event.target as Element).closest('a');if(a){event.preventDefault();const url=a.getAttribute('href')||'';if(/^https?:\/\//.test(url))void openUrl(url).catch(e=>setError(String(e)));}}
  const compact=embedded&&!controlsOnly;
  const hasSubmission=pending||!!detail?.receipt&&(!!detail.receipt.job||['published','failed','rejected'].includes(detail.stage));
  // A local manuscript can leave the app two ways: exported as a self-contained folder, or opened in Cursor at its file.
  const folderOf=(path:string)=>path.slice(0,path.lastIndexOf('/'));
  async function exportFolder(){if(!detail)return;setError('');try{await invoke('editorial_export_directory',{path:folderOf(detail.canonicalPath)});}catch(e){setError(String(e));}}
  async function openInCursor(){if(!detail)return;setError('');try{await invoke('editorial_open_directory',{path:folderOf(detail.canonicalPath),target:'cursor',file:detail.canonicalPath});}catch(e){setError(String(e));}}
  // Preview is a view of current text, independent of saving or publishing.
  function showPreview(next:'preview'|'wechat'|'notes'='preview'){selectPane(next);}
  useEffect(()=>{if(confirm)setPane('preview');},[confirm]);
  // The visible switch chooses visibility; pushing saves, prepares and submits that intent.
  const oneClick=editable&&compact,stage=detail?.stage||'';
  useEffect(()=>{if(oneClick&&pending&&prepared)setIntent(prepared.intent==='draft'?'draft':'publish');},[oneClick,pending,prepared?.intent]);
  // Push keeps the article's current visibility: only a public article starts
  // with 公开 on. Making a private article public is always a deliberate switch.
  useEffect(()=>{if(oneClick&&!pending)setIntent(detail?.sync?.publishedRevision!=null?'publish':'draft');},[oneClick,detail?.id,detail?.sync?.publishedRevision!=null]);
  const notice=oneClick?[
    loaded&&!snapshot.connection.configured&&!snapshot.connection.requiresCheck?(snapshot.connection.message||tr('请在设置 → 账号与连接中绑定官网凭证。')):'',
    source?.structureIssue?tr('稿件结构需要修复：{{issue}}',{issue:source.structureIssue}):'',
    detail?.cleanupError?tr('云端已保存，本地清理未完成：{{error}}',{error:detail.cleanupError}):'',
    stage==='unknown'?tr('提交结果尚未确认。请查询原任务；重试会沿用原请求，不会重复发布。'):'',
    ['failed','rejected'].includes(stage)?tr('推送未完成：{{error}}',{error:detail?.receipt?.job?.error||detail?.receipt?.error||tr('请稍后重试。')}):'',
    liveError?tr('预览暂未更新：{{error}}',{error:liveError}):'',...(detail?.warnings||[])
  ].filter(Boolean).join('\n'):'';
  useEffect(()=>{if(notice)setError(notice);},[notice,selected]);
  const previewUpdating=editable&&!!source&&['preview','wechat'].includes(pane)&&(previewCache.current?.id!==selected||previewCache.current.text!==text);
  // English follows the Chinese page quietly; it never changes the push result.
  const english=['published','cleanup'].includes(stage)?englishStatus(detail?.receipt):null;
  const duplicateOf=duplicateRecordOf(detail?.receipt,error);
  // One resource link has one record: an update goes to that record's local copy.
  async function openExisting(id:string){
    if(busyRef.current)return;busyRef.current=true;setBusy('pull');setError('');
    try{const pulled=await call<{id:string;conflict:boolean;message?:string}>('pull',{id,source:'cloud'});await refresh();onOpenDraft(pulled.id);}
    catch(e){setError(String(e));}finally{busyRef.current=false;setBusy('');}
  }
  const friendlyStage=oneClick?tr(({queued:'正在推送',running:'正在推送',verify:'正在推送',unknown:'结果待确认',draft_saved:'推送完成',published:'推送完成',cleanup:'正在整理本地稿件',failed:'推送失败',rejected:'未通过'} as Record<string,string>)[stage]||''):'';
  function push(want:'publish'|'draft'='publish'){
    if(!detail||!metadata||busyRef.current)return;
    setIntent(want);
    if(!metadata.date||!metadata.summary.trim()){setPane('edit');setInfoOpen(true);setError(tr("请先填写文章日期和摘要，再推送。"));return;}
    if(detail.stage==='unknown'){void action('publish',false,want,true);return;}
    void action('prepare',false,want,true);
  }
  const prepareButton=<button className={compact?'pub-primary':undefined} disabled={!!busy||!canPrepare} onClick={()=>void action('prepare')}>{busy==='prepare'?tr("正在保存并检查…"):editable&&bodyDirty?tr("保存修改并检查"):prepared?(controlsOnly?tr("重新检查"):tr("重新生成预览")):(controlsOnly?tr("检查稿件"):compact?tr("生成预览"):tr("生成官网预览"))}</button>;
  const submitButton=canPublish&&<button className="pub-primary" disabled={!!busy} onClick={()=>{setPreviewMode('local');setConfirm(true);}}>{detail?.stage==='unknown'?tr("重试原请求"):tr("推送到官网")}</button>;
  const queryButton=hasSubmission&&<button className={compact&&pending?'pub-primary':undefined} disabled={!!busy} onClick={()=>void action('status')}>{busy==='status'?tr("正在查询…"):compact?tr("查询原任务"):tr("查询服务器状态")}</button>;
  const submitActions=<div className="pub-actions website-submit-actions">{compact&&!actionHost?<>{pending?queryButton:canPublish?submitButton:prepareButton}</>:<>{prepareButton}{submitButton}{queryButton}{!controlsOnly&&publicUrl&&<button disabled={!!busy} onClick={()=>setPreviewMode('website')}>{tr("查看官网页面")}</button>}</>}</div>;
  const pushLabel=tr(busy==='save'?'正在保存…':busy==='prepare'?'正在检查…':busy==='publish'?'正在提交…':busy==='status'?'正在查询…':intent==='publish'?'推送并公开':'推送更新');
  const pushButton=oneClick&&<div className="website-push-primary"><button type="button" className="website-visibility-toggle" role="switch" aria-label={tr("公开")} aria-checked={intent==='publish'} title={intent==='publish'?tr("推送后公开到官网"):tr("推送后仅保存到云端")} disabled={!!busy||pending} onClick={()=>setIntent(value=>value==='publish'?'draft':'publish')}><span>{tr("公开")}</span><i className="website-switch-track" aria-hidden="true"><i/></i></button><button className="pub-primary website-push-button" disabled={!!busy||!active||submissionBlocked||(!snapshot.connection.configured&&!snapshot.connection.requiresCheck)||(pending&&stage!=='unknown')} onClick={()=>push(stage==='unknown'?(prepared?.intent==='draft'?'draft':'publish'):intent)}>{pushLabel}</button></div>;
  const pushControls=oneClick&&<div className="website-push-controls"><span className="pub-tag website-push-status" role="status">{friendlyStage||(previewUpdating?tr("正在更新预览…"):'')}</span>{english&&<span className={'pub-tag website-english-status '+english.tone} title={english.url}>{tr(english.label)}</span>}{stage==='unknown'&&queryButton}{publicUrl&&stage!=='unknown'&&<button disabled={!!busy} onClick={()=>setPreviewMode('website')}>{tr("查看官网页面")}</button>}<div className="wechat-controls-slot" ref={setWechatHost}/>{editorTools}{pushButton}</div>;
  const confirmationActions=<div className="pub-actions"><button className="pub-primary" disabled={!!busy||!canPublish} onClick={()=>void action('publish')}>{prepared?.intent==='draft'?(busy==='publish'?tr("正在保存…"):tr("确认存到云端")):(busy==='publish'?tr("正在推送…"):tr("确认推送到官网"))}</button><button disabled={!!busy} onClick={()=>setConfirm(false)}>{tr("取消")}</button></div>;
  const confirmation=confirm&&<section ref={confirmationRef} className="website-confirm" aria-label={tr("确认官网推送")}><strong>{prepared?.intent==='draft'?tr("存到云端"):tr("确认公开")}《{prepared?.title}》</strong><p>{prepared?.intent==='draft'?tr("正文及图片保存到 {{origin}} 的云端，不公开到官网。保存核验完成后，本地工作副本移入云端。已有官网公开版本不会被这次私稿保存改动。", {origin: snapshot.connection.origin}):oneClick&&!retireLocal?tr("将当前正文及图片公开到 {{origin}}。", {origin: snapshot.connection.origin}):tr("将预览中的正文及图片公开到 {{origin}}。公开核验与原稿归档完成后，清理本地工作副本。", {origin: snapshot.connection.origin})}</p>{actionHost&&!oneClick?createPortal(confirmationActions,actionHost):confirmationActions}</section>;
  const metadataFields=metadata&&<><label>{tr("文章日期")}<input type="date" aria-label={tr("文章日期")} value={metadata.date} disabled={!!busy||pending} onChange={e=>edit('date',e.target.value)}/></label><label>{tr("署名")}<input aria-label={tr("官网署名")} maxLength={100} value={metadata.author} disabled={!!busy||pending} onChange={e=>edit('author',e.target.value)}/></label><label>{tr("栏目")}<select aria-label={tr("发布栏目")} value={metadata.sectionId||''} disabled={!!busy||pending} onChange={e=>{const id=e.target.value;edit('sectionId',id);}}><option value="">{tr("暂不归栏")}</option>{metadata.sectionId&&!writableSectionsForSite(ACTIVE_SITE).some(s=>s.id===metadata.sectionId)&&<option value={metadata.sectionId} disabled>{sectionsForSite(ACTIVE_SITE).find(s=>s.id===metadata.sectionId)?.name||metadata.category} · {tr("已停用")}</option>}{writableSectionsForSite(ACTIVE_SITE).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label></>;
  const summaryField=metadata&&<label className="website-summary">{compact?tr("摘要"):tr("公开摘要")}<textarea aria-label={tr("官网公开摘要")} rows={compact?4:3} maxLength={4000} value={metadata.summary} disabled={!!busy||pending} onChange={e=>edit('summary',e.target.value)}/></label>;
  const receiptInfo=detail?.receipt&&<div className="website-receipt">{english&&<p>{tr(english.label)}</p>}{detail.receipt.job&&<p>{tr("服务器任务：{{id}}", {id: detail.receipt.job.id})}</p>}{detail.receipt.revision&&<p>{tr("云端版本：{{revision}}", {revision: detail.receipt.revision})}</p>}{detail.receipt.job?.error&&<p>{detail.receipt.job.error}</p>}{detail.receipt.error&&<p>{detail.receipt.error}</p>}{detail.receipt.readbackError&&<p>{detail.receipt.readbackError}</p>}{detail.receipt.checkedAt&&<p>{tr("最近查询：{{toLocaleString}}", {toLocaleString: new Date(detail.receipt.checkedAt).toLocaleString(uiLocale())})}</p>}</div>;
  const step=!prepared?0:['local','prepared','rejected'].includes(detail?.stage||'')?1:['unknown','queued','running','failed'].includes(detail?.stage||'')?2:3;
  const composeHeading=detail&&metadata&&<div className="website-compose-heading">{editable?<div className="website-editor-modes" aria-label={tr("编辑方式")}><button aria-pressed={pane==='edit'} onPointerEnter={()=>void loadRichEditor()} onFocus={()=>void loadRichEditor()} onClick={()=>selectPane('edit')}>{tr("编辑")}</button><button aria-pressed={pane==='preview'} onClick={()=>void showPreview('preview')}>{tr("官网预览")}</button><button aria-pressed={pane==='wechat'} onClick={()=>void showPreview('wechat')}>{tr("公众号预览")}</button><button aria-pressed={pane==='notes'} onClick={()=>void showPreview('notes')}>{tr("图文笔记预览")}</button><span className="website-local-actions">{<button disabled={!bodyDirty&&!metadataDirty||!!busy||pending} onClick={()=>void saveBody()}>{busy==='save'?tr("正在保存…"):tr("保存")}</button>}<button disabled={!!busy} title={tr("导出为独立目录：正文与全部图片")} onClick={()=>void exportFolder()}>{tr("导出")}</button><button disabled={!!busy} title={tr("用 Cursor 打开稿件目录并定位到正文")} onClick={()=>void openInCursor()}>{tr("用 Cursor 打开")}</button></span></div>:<button disabled={!!busy||metadataDirty} onClick={()=>onOpenDraft(selected)}><Icon name="file" size={13}/>{compact?tr("返回编辑"):tr("打开本地稿件")}</button>}{oneClick?pushControls:<>{editable&&editorTools}<span className="pub-tag">{compact&&detail.stage==='prepared'?tr("待确认公开"):tr(WEBSITE_STAGES[detail.stage])}</span></>}</div>;
  return <div className={`publication-center website-publisher${embedded?' publisher-embedded':''}${controlsOnly?' publisher-controls-only':''}${editable?' publisher-editable':''}${oneClick?' publisher-single is-'+pane:''}`}>
    {error&&createPortal(duplicateOf?<ConfirmDialog title={tr("该资源已有记录")} message={error} confirmLabel={tr("取回已有记录")} danger={false} onConfirm={()=>void openExisting(duplicateOf)} onClose={()=>setError('')}/>:<ConfirmDialog title={tr("提示")} message={error} confirmLabel={tr("知道了")} danger={false} hideCancel onConfirm={()=>setError('')} onClose={()=>setError('')}/>,document.body)}
    {!embedded&&<aside className="pub-sidebar"><div className="pub-drag" data-tauri-drag-region/>{navigation}<div className="pub-filter-scroll"><p className="pub-label">{tr("本地稿件 → 官网")}</p>
      {FILTERS.map(([key,label])=><button key={key} className="pub-filter" aria-pressed={filter===key} disabled={!!busy} onClick={()=>{setFilter(key);setSelected('');}}><span>{tr(label)}</span><small>{snapshot.articles.filter(x=>matches(x.stage,key)).length}</small></button>)}
      <p className="pub-side-note">{tr("从本机保存的稿件与图片生成预览，确认后直接推送到官网服务器。")}<br/>{tr("目标栏目：学术档案")}</p>
      <p className="pub-side-note">{snapshot.connection.configured?tr("本机已绑定官网发布凭证"):snapshot.connection.message||tr("正在检查本机连接…")}</p>
    </div><footer><span className={`pub-cache-dot ${snapshot.connection.configured?'is-ready':''}`}/><span>{tr("本地保存 · 按需推送")}</span></footer></aside>}
    <section className="pub-content" aria-label={tr("本地推送官网")}><header className="pub-toolbar" data-tauri-drag-region="deep"><div><h1>{tr("官网发布")}</h1><p>{tr("本地稿件 → 预览确认 → 服务器队列 → 公开回读")}</p></div><div className="pub-refresh"><button disabled={!!busy} onClick={()=>{void refresh().then(()=>{if(selected)void load(selected);}).catch(e=>setError(String(e)));}}><Icon name="refresh" size={14}/>{tr("读取本地状态")}</button></div></header>
      {!oneClick&&embedded&&loaded&&!snapshot.connection.configured&&!snapshot.connection.requiresCheck&&<div className="pub-message" role="status">{tr("{{value}} 绑定后重新进入交稿页。", {value: snapshot.connection.message||tr('请在设置 → 账号与连接中绑定官网凭证。')})}</div>}
      {oneClick&&detail&&metadata&&<div className="website-mode-bar">{composeHeading}</div>}
      <div className="pub-columns" ref={split.hostRef} style={oneClick?undefined:split.style}><section className="pub-list" hidden={oneClick&&pane!=='edit'} aria-label={tr("本地推送稿件")}><label className="pub-search"><Icon name="search" size={14}/><input aria-label={tr("搜索官网待推送稿件")} placeholder={tr("搜索本地标题、目录")} disabled={!!busy} value={query} onChange={e=>{setQuery(e.target.value);setSelected('');}}/></label><div className="pub-list-caption">{tr("{{visible}} 篇本地稿件", {visible: visible.length})}</div><div className="pub-list-scroll" ref={editorScroll}>
        {visible.map(item=><div key={item.id}><button className="pub-list-item" disabled={!!busy} aria-current={selected===item.id?'true':undefined} onClick={()=>select(item.id)}><span className="pub-item-meta"><span>{item.batchDate||tr("探索稿")}</span><span>{item.sync?tr(SYNC_LABELS[item.sync.state]):tr(WEBSITE_STAGES[item.stage])}</span></span><strong>{item.shortTitle}</strong><span className="website-draft-path">{item.canonicalPath}</span></button>
          {selected===item.id&&detail?.id===item.id&&metadata&&<div className="pub-inline-detail website-compose">{!oneClick&&composeHeading}

            {!oneClick&&editable&&source?.structureIssue&&<p className="website-note" role="alert">{tr("稿件结构需要修复：{{structureIssue}}", {structureIssue: source.structureIssue})}</p>}
            {editable&&(pane==='edit'||oneClick&&editorVisited)&&<div className="website-body-editor" aria-label={tr("稿件编辑")}>{source?<Suspense fallback={<p>{tr("正在载入编辑器…")}</p>}><RichEditor key={item.id} articleId={item.id} text={text} disabled={!!busy||pending} lockedHeadings={source.structure?.sections} onChange={value=>{setText(value);setConfirm(false);setPreviewMode('local');}} onError={setError}/></Suspense>:<p>{tr("正在读取正文…")}</p>}</div>}
            {editable&&!oneClick&&(bodyDirty||metadataDirty)&&<button disabled={!!busy||pending} onClick={()=>void saveBody()}>{busy==='save'?tr("正在保存…"):tr("保存修改")}</button>}
            {oneClick&&pane!=='edit'?null:compact?<><details className="website-more-info" open={infoOpen} onToggle={e=>setInfoOpen(e.currentTarget.open)}><summary>{tr("摘要与稿件信息")}</summary><div className="website-metadata website-main-metadata">{summaryField}{metadataFields}</div></details>{!oneClick&&!metadata.date&&<p className="website-note">{tr("请在稿件信息中填写文章日期。")}</p>}</>:<div className="website-metadata">{metadataFields}{summaryField}</div>}
            {!oneClick&&prepared?.intent==='draft'&&<p className="website-note">{tr("这是旧版云端保存请求。查询原结果后，重新生成预览即可公开。")}</p>}
            {!oneClick&&detail.stale&&<p className="website-note">{tr("本地正文、图片或发布信息已变化，请重新生成预览。{{validation}}", {validation: detail.validation})}</p>}
            {!oneClick&&metadataDirty&&<p className="website-note">{tr("发布信息尚未写入预览，生成预览后保存到本机。")}<button disabled={!!busy} onClick={()=>setEdits(prev=>{const next={...prev};delete next[detail.id];return next;})}>{tr("放弃信息修改")}</button></p>}
            {compact?<>{!oneClick&&(prepared||detail.receipt)&&<details className="website-submission-details"><summary>{tr("提交详情")}</summary>{prepared&&<p className="website-note">{tr("{{assetCount}} 张图片 · 基线版本 {{expectedVersion}}", {assetCount: prepared.assetCount, expectedVersion: prepared.expectedVersion})}<br/>{tr("请求编号：{{requestKey}}", {requestKey: prepared.requestKey})}</p>}{receiptInfo}{hasSubmission&&!pending&&queryButton}{detail.stage==='unknown'&&submitButton}{publicUrl&&<button disabled={!!busy} onClick={()=>setPreviewMode('website')}>{tr("查看官网页面")}</button>}</details>}</>:<>{prepared&&<p className="website-note">{controlsOnly?tr("待确认稿件"):tr("已冻结预览")} · {prepared.assetCount}  {tr("张本地图片")}{!controlsOnly&&<>  {tr("· 官网基线版本 {{expectedVersion}}", {expectedVersion: prepared.expectedVersion})}<br/>{tr("请求编号：{{requestKey}}", {requestKey: prepared.requestKey})}</>}</p>}{receiptInfo}</>}
            {!oneClick&&detail.cleanupError&&<p className="website-note" role="status">{tr("官网已公开，本地清理未完成：{{cleanupError}}", {cleanupError: detail.cleanupError})}</p>}
            {!oneClick&&detail.stage==='unknown'&&<p className="website-note">{oneClick?tr("提交结果尚未确认。可先查询状态；重试不会重复发布。"):tr("提交结果尚未确认。先查询原任务；重试将沿用同一请求编号。")}</p>}

            {!oneClick&&!confirm&&(actionHost?createPortal(submitActions,actionHost):submitActions)}
            {!oneClick&&confirmation}
          </div>}</div>)}
        {!visible.length&&<div className="pub-empty"><h3>{loaded?tr("没有匹配稿件"):tr("正在读取本机稿件…")}</h3><p>{tr("可在“稿件”中编辑并保存正文，再到这里生成发布预览。")}</p></div>}
      </div></section><div className="pub-resize-track">{!oneClick&&active&&split.available>0&&<ResizeHandle visible width={split.width} side="right" min={Math.round(split.min)} max={split.max} scale={split.scale} onResize={split.resize} onReset={split.reset} onDragChange={split.setDragging} label={tr("调整推送稿件与预览宽度")}/>}</div>
        {oneClick&&pane==='notes'&&detail&&<section className="website-preview website-notes-preview" aria-label={tr("图文笔记预览区域")}><NoteCardsPreview key={detail.id} articleId={detail.id} text={text}/></section>}
        {oneClick&&pane==='wechat'&&detail&&<section className="website-preview website-wechat-preview" aria-label={tr("公众号预览")}><WechatPreview toolbarHost={wechatHost} articleId={detail.id} text={text} html={liveHtml||detail.html} loading={previewCache.current?.id!==selected||previewCache.current.text!==text} category={metadata?.category} unnumbered={source?.structure?.unnumbered}/></section>}
        {!controlsOnly&&<section className="website-preview" hidden={oneClick&&pane!=='preview'} aria-busy={previewUpdating} aria-label={tr("官网推送预览")}><header className="website-preview-heading">{compact?<><strong>{tr("稿件预览")}</strong><span>{oneClick?(bodyDirty?tr("尚未保存"):''):editable&&bodyDirty?tr("实时预览 · 尚未保存"):metadataDirty||detail?.stale?tr("修改后需更新预览"):prepared?tr("已生成预览"):tr("已保存正文")}</span></>:<div className="website-progress" aria-label={tr("发布进度")}>{[trKey('本地稿件'),trKey('预览确认'),trKey('推送队列'),trKey('公开回读与清理')].map((x,i)=><span key={x} aria-current={step===i?'step':undefined} className={i<=step?'is-reached':''}>{i+1} {tr(x)}</span>)}</div>}{previewMode==='website'&&<button onClick={()=>setPreviewMode('local')}>{tr("返回本地预览")}</button>}</header>
          {previewMode==='website'&&publicUrl?<PublicationReader active={active} obscured={split.dragging} url={publicUrl} title={detail?.prepared?.title||detail?.title}/>:<>{detail?<>{!compact&&<p className="website-preview-caption">{prepared?tr("官网发布预览 · 确认推送时使用此版本"):tr("本地已保存稿件 · 尚未生成发布预览")}</p>}<div className="website-preview-scroll" ref={previewScroll} onClick={previewLink}><article className="website-preview-article">{!oneClick&&prepared&&!bodyDirty&&<div className="website-preview-meta"><p>{prepared.metadata.author} · {prepared.metadata.date} · {prepared.metadata.category}</p><p>{prepared.metadata.summary}</p></div>}{!oneClick&&detail.warnings.map((x,i)=><p className="website-note" key={i}>{x}</p>)}{!oneClick&&liveError&&<p role="alert">{tr("预览暂未更新：{{liveError}}", {liveError})}</p>}<PreviewHtml articleId={detail.id} html={editable&&!confirm?(liveHtml||detail.html):detail.html}/></article></div></>:<div className="pub-empty"><Icon name="send" size={28}/><h2>{tr("从本地推送到官网")}</h2><p>{tr("选择左侧稿件，先预览，再确认公开。")}</p></div>}</>}
        </section>}
      </div>
    </section>
  </div>;
}
