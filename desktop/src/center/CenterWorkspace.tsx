import {tr} from '../uiText';
import {useCallback,useEffect,useRef,useState} from 'react';
import {invoke} from '../lib/nativeCore';
import './center.css';
import {CenterConnection} from './CenterConnection';
import {openUrl} from '@tauri-apps/plugin-opener';
import {CenterHeader,CenterNavigation,CenterToolbar,CenterList,CenterPagination,stateLabel,type CenterTab} from './shared/CenterView';
import {centerUrl,managementCenterTabs,localCenterTabs} from './shared/navigation';
import LiveCenter from './LiveCenter';
type Row=Record<string,any>;
const call=(method:string,params:Row={},token?:string)=>invoke<any>('rssd_center_call',{method,params,token});
const PAGE_SIZE=50;
const label=(value:string)=>stateLabel(value,tr);
export default function CenterWorkspace({active}:{active:boolean}){
 const [preview,setPreview]=useState(()=>localStorage.getItem('rssd-center-live')==='1');
 useEffect(()=>{localStorage.setItem('rssd-center-live',preview?'1':'0');},[preview]);
 const [status,setStatus]=useState<Row>({}),[spaces,setSpaces]=useState<Row[]>([]),[space,setSpace]=useState(''),[section,setSection]=useState(''),[agent,setAgent]=useState('');
 const [tab,setTab]=useState<CenterTab>('demands'),[listing,setListing]=useState<{key:string;rows:Row[];hasNext:boolean}>({key:'',rows:[],hasNext:false}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [page,setPage]=useState(0),[search,setSearch]=useState(''),[searchInput,setSearchInput]=useState('');
 const generation=useRef(0),actionBusy=useRef(false),registryLoaded=useRef(false);
 const listKey=JSON.stringify([space,tab,page,search]),rows=listing.key===listKey?listing.rows:[];
 const listLoading=listing.key!==listKey;
 const [work,setWork]=useState<Row|null>(null),[locale,setLocale]=useState('zh-CN'),[title,setTitle]=useState(''),[body,setBody]=useState('');
 const [draftStatus,setDraftStatus]=useState('');
 const latestDraft=useRef<Row|null>(null),draftTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 latestDraft.current=work?{work,locale,title,body}:null;
 const persist=useCallback(async()=>{clearTimeout(draftTimer.current);const value=latestDraft.current;if(value)await call('save_local',value);},[]);
 const current=spaces.find(s=>s.id===space),running=['starting','working','idle','stopping'].includes(status.worker?.state);
 const writable=current?.writable!==false,editorWritable=spaces.find(s=>s.id===work?.workspaceId)?.writable!==false;
 const local=useCallback(async()=>{const value=await call('status');setStatus(value);setAgent(old=>old||value.agents?.find((a:Row)=>a.available&&a.enabled)?.id||'');},[]);
 const registry=useCallback(async()=>{const r=await call('registry');setSpaces(r.workspaces);setSpace(old=>{if(!registryLoaded.current){registryLoaded.current=true;return r.workspaces[0]?.id||'';}return !old||r.workspaces.some((w:Row)=>w.id===old)?old:r.workspaces[0]?.id||'';});if(r.offline)setNotice(tr("中心暂不可用，正在使用本机保存的工作空间配置。"));},[]);
 const refresh=useCallback(async()=>{if(!status.configured)return;const request=++generation.current;try{const result=await call(tab,{workspaceId:space||undefined,limit:PAGE_SIZE+1,offset:page*PAGE_SIZE,...(tab!=='publications'&&search?{search}:{})});if(request===generation.current)setListing({key:listKey,rows:result.slice(0,PAGE_SIZE),hasNext:result.length>PAGE_SIZE});}catch(e){if(request===generation.current){setListing({key:listKey,rows:[],hasNext:false});setError(String(e));}}},[space,tab,page,search,listKey,status.configured]);
 const run=async(fn:()=>Promise<void>)=>{if(actionBusy.current)return;actionBusy.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{actionBusy.current=false;setBusy(false);}};
 useEffect(()=>{if(!active||preview)return;local().catch(e=>setError(String(e)));const timer=setInterval(()=>void local().catch(()=>{}),5000);return()=>clearInterval(timer);},[active,preview,local]);
 useEffect(()=>{if(active&&!preview&&status.configured)registry().catch(e=>setError(String(e)));},[active,preview,status.configured,registry]);
 useEffect(()=>{if(active&&!preview&&status.configured)void refresh();return()=>{generation.current++;};},[active,preview,refresh,status.configured]);
 useEffect(()=>{setSection('');setWork(null);setPage(0);setSearch('');setSearchInput('');},[space]);
 useEffect(()=>{if(!work)return;setDraftStatus(tr("正在保存本机草稿…"));draftTimer.current=setTimeout(()=>{void persist().then(()=>setDraftStatus(tr("本机草稿已保存"))).catch(e=>{setDraftStatus(tr("本机草稿保存失败"));setError(String(e));});},500);return()=>clearTimeout(draftTimer.current);},[work,locale,title,body,persist]);
 useEffect(()=>{const guard=(event:Event)=>{(event as CustomEvent).detail.promises.push(persist());};window.addEventListener('scholay-space-will-switch',guard);return()=>{window.removeEventListener('scholay-space-will-switch',guard);void persist().catch(()=>{});};},[persist]);
 useEffect(()=>{if(!active)void persist().catch(e=>setError(String(e)));},[active,persist]);
 const open=async(item:Row,language?:string,preferLocal=true)=>{const e=item.editions?.find((x:Row)=>x.locale===(language||locale))||(!language?item.editions?.[0]:undefined),lang=language||e?.locale||'zh-CN';
  try{if(preferLocal)await persist();const draft=preferLocal?await call('local_draft',{workId:item.id,locale:lang}):null;
   if(draft){setWork(draft.work);setLocale(draft.locale);setTitle(draft.title);setBody(draft.body);setNotice(tr("已恢复未提交的本机草稿；其基础版本保持不变。"));return;}
   setWork(item);setLocale(lang);setTitle(e?.payload.title||'');setBody(e?.payload.bodyMarkdown||'');
  }catch(error){setError(String(error));}
 };
 const save=async()=>{
  if(!work)return;await persist();if(!editorWritable)throw Error(tr("此工作空间正在迁移，请在交接完成后提交。"));const old=work.editions.find((e:Row)=>e.locale===locale);
  const packet={requestId:crypto.randomUUID(),workId:work.id,workspaceId:work.workspaceId,sectionId:work.sectionId,baseRevisions:{[locale]:old?.revision||0},editions:[{...(old?.payload||{}),locale,title,bodyMarkdown:body}]};
  const result=await call('submit',{packet});await local();
  if(result.state==='accepted'){
   const received=result.receipt.editions.find((e:Row)=>e.locale===locale);
   const updated={...work,editions:[...work.editions.filter((e:Row)=>e.locale!==locale),{locale,revision:received.revision,payload:packet.editions[0]}]};
   // Commit the accepted base locally before returning control to the editor.
   // A later network failure must not restore a stale pre-submit draft.
   await call('save_local',{work:updated,locale,title,body});setWork(updated);
   setNotice(tr("中心已接收，发布结果请查看发布记录。"));
  }
  else setNotice(tr("稿件和原请求已保存在本机。")+(result.error?.message||tr("等待中心恢复后提交。")));
 };
 const selectTab=(next:CenterTab)=>void run(async()=>{
  await persist();
  if(!(localCenterTabs as readonly string[]).includes(next)){
   await openUrl(centerUrl(status.origin,next,space));setNotice(tr('已在浏览器打开线上中心。'));return;
  }
  setTab(next);setPage(0);setSearch('');setSearchInput('');setWork(null);
 });
 if(preview)return <LiveCenter onExit={()=>setPreview(false)}/>;
 return <main className="center-view rssd-desktop-center"><div className="rssd-center-preview-entry"><button disabled={busy} onClick={()=>void run(async()=>{await persist();setPreview(true);})}>{tr('打开新版调度中心')} ↗</button></div><CenterHeader spaces={spaces.map(s=>({id:s.id,name:s.name}))} space={space} disabled={busy||running} loading={busy} t={tr}
  onSpace={next=>void run(async()=>{await persist();setSpace(next);})} refresh={()=>void run(async()=>{await local();if(status.configured){await registry();await refresh();}})}/>
  {error&&<p className="rssd-center-error" role="alert">{error}</p>}{notice&&<p className="rssd-center-notice" role="status">{notice}</p>}
  <CenterConnection status={status} disabled={busy||running} beforeChange={persist} onChanged={async()=>{latestDraft.current=null;setWork(null);setSpaces([]);registryLoaded.current=false;setSpace('');setListing({key:'',rows:[],hasNext:false});await local();if((await call('status')).configured)await registry();}}/>
  {status.configured&&status.activeClaim&&!running&&<p className="rssd-center-notice">{tr('本机仍保留未完成的认领。')} {status.activeClaim.title||status.activeClaim.id} <button disabled={busy} onClick={()=>{if(confirm(tr('释放认领后其他设备可以接续，本机稿件和原请求仍保留。确定释放？')))void run(async()=>{await persist();await call('release');await local();});}}>{tr('释放当前认领')}</button></p>}
  {status.configured&&<><CenterNavigation tab={tab} onTab={selectTab} disabled={busy} external={managementCenterTabs} t={tr}/>
  <details className="rssd-center-device"><summary>{tr('本机执行')} · {status.worker?label(status.worker.state):tr('工作模式尚未开启')}</summary><section className="rssd-center-production" aria-label={tr('工作模式')}><div className="rssd-center-controls">
   <label>{tr("栏目")}<select value={section} disabled={busy||running} onChange={e=>setSection(e.target.value)}><option value="">{tr("全部栏目")}</option>{current?.sections.map((s:Row)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>{tr("本机智能体")}<select value={agent} disabled={busy||running} onChange={e=>setAgent(e.target.value)}><option value="">{tr("选择智能体")}</option>{status.agents?.filter((a:Row)=>a.enabled).map((a:Row)=><option key={a.id} value={a.id} disabled={!a.available}>{a.name}{!a.available?tr(" · 尚不可用"):''}</option>)}</select></label>
   <button className="rssd-center-primary" disabled={busy||running||!space||!agent||!writable} onClick={()=>void run(async()=>{await call('start',{agentId:agent,workspaceIds:[space],sectionIds:section?[section]:[],resume:status.worker?.state==='blocked'||status.worker?.state==='interrupted'});setNotice(tr("工作实例正在启动，任务与运行状态会保留在本机。"));await local();})}>{tr("开启工作模式")}</button>
   {running&&<button disabled={busy} onClick={()=>void run(async()=>{await call('stop');setNotice(tr("当前需求完成后停止领取。"));})}>{tr("本单完成后停止")}</button>}
  </div><p role="status">{status.worker?`${label(status.worker.state)} · ${status.worker.message||''}`:tr("工作模式尚未开启")}</p></section></details>
  {!writable&&<p className="rssd-center-notice" role="status">{tr("此工作空间正在迁移，暂不能领取需求或提交中心；仍可查看作品并保存本机草稿。")}</p>}
  {status.drafts?.length>0&&<details className="rssd-center-connection"><summary>{tr("本机草稿 ·")}{status.drafts.length}</summary>{status.drafts.map((d:Row)=><p key={d.workId+':'+d.locale}><button disabled={busy} onClick={()=>void run(async()=>{await persist();const saved=await call('local_draft',{workId:d.workId,locale:d.locale});setTab('works');setWork(saved.work);setLocale(saved.locale);setTitle(saved.title);setBody(saved.body);setNotice(tr("已恢复本机草稿，提交时仍校验原基础版本。"));})}>{d.title||tr("未命名草稿")} · {d.locale}</button></p>)}</details>}

  {!work&&<CenterToolbar tab={tab} search={searchInput} onSearch={setSearchInput} onSearchSubmit={()=>{setPage(0);setSearch(searchInput.trim());}} disabled={busy} t={tr}
   actions={<><button disabled={busy} onClick={()=>void run(async()=>{await registry();await refresh();})}>{tr('更新列表')}</button>{tab==='demands'&&<button className="center-view-primary" disabled={busy||!space||!writable} onClick={()=>void run(async()=>{await persist();await openUrl(centerUrl(status.origin,'demands',space));})}>{tr('新建需求')} ↗</button>}{tab==='works'&&<button className="center-view-primary" disabled={!space||busy} onClick={()=>void run(async()=>open({id:crypto.randomUUID(),workspaceId:space,sectionId:section||current?.sections[0]?.id,editions:[]},'zh-CN'))}>{tr('新建作品')}</button>}</>}/>}
  {work?<section className="rssd-center-editor"><div><button disabled={busy} onClick={()=>void run(async()=>{await persist();setWork(null);})}>{tr("返回作品库")}</button><label>{tr("语言")}<select value={locale} disabled={busy} onChange={e=>{const old=work.editions.find((x:Row)=>x.locale===locale);if((title!==(old?.payload.title||'')||body!==(old?.payload.bodyMarkdown||''))&&!confirm(tr("当前语言有未提交修改，确定切换吗？")))return;const lang=e.target.value;void run(async()=>{await persist();await open(work,lang);});}}><option value="zh-CN">{tr("中文")}</option><option value="en">English</option></select></label><span>{tr("基于版本")}{work.editions.find((e:Row)=>e.locale===locale)?.revision||0}</span><button className="rssd-center-primary" disabled={busy||!title.trim()||!body.trim()||!editorWritable} onClick={()=>void run(save)}>{tr("提交中心")}</button></div><label>{tr("标题")}<input value={title} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label><label>{tr("完整正文（Markdown）")}<textarea value={body} disabled={busy} onChange={e=>setBody(e.target.value)} rows={22}/></label></section>:<CenterList tab={tab} rows={rows as any} loading={listLoading} sections={current?.sections||[]} disabled={busy} t={tr}
    openWork={row=>void run(async()=>open(await call('work',{workId:row.id})))}
    actions={row=>tab==='demands'&&row.state==='queued'?<button disabled={busy||running||!space||!agent||!writable} onClick={()=>void run(async()=>{await call('start',{agentId:agent,workspaceIds:space?[space]:spaces.map(s=>s.id),demandId:row.id,once:true});setNotice(tr('正在认领这条需求。'));await local();})}>{tr('处理这条')}</button>:null}/>}
  {!work&&<CenterPagination page={page} hasNext={listing.hasNext} onPage={setPage} disabled={busy||listLoading} t={tr}/>}
  {work&&<p role="status">{draftStatus}</p>}
  {status.outbox?.some((r:Row)=>r.state!=='accepted')&&<section className="rssd-center-outbox"><h2>{tr("本机待处理稿件")}</h2>{status.outbox.filter((r:Row)=>r.state!=='accepted').map((r:Row)=><article key={r.requestId}><div>{r.workId}<p>{label(r.state)} · {r.error?.message}</p></div><button disabled={busy} onClick={()=>void run(async()=>{await call('recover',{requestId:r.requestId});await local();setNotice(tr("已查询原请求，结果已更新。"));})}>{tr("查询并恢复")}</button></article>)}</section>}
  </>}
 </main>;
}
