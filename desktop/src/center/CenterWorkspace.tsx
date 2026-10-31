import {tr} from '../uiText';
import {useCallback,useEffect,useRef,useState} from 'react';
import {invoke} from '../lib/nativeCore';
import './center.css';
type Row=Record<string,any>;
const call=(method:string,params:Row={},token?:string)=>invoke<any>('rssd_center_call',{method,params,token});
const states:Record<string,string>={queued:'待处理',claimed:'已认领',blocked:'待处理',completed:'已交稿',published:'已发布',accepted:'中心已接收',pending:'等待提交',needs_attention:'需要核对',dispatching:'正在发布',superseded:'已有新版',idle:'等待需求',working:'正在生产',stopped:'已停止',interrupted:'已中断',starting:'正在启动'};
const label=(value:string)=>tr(states[value]||value);
export default function CenterWorkspace({active}:{active:boolean}){
 const [status,setStatus]=useState<Row>({}),[spaces,setSpaces]=useState<Row[]>([]),[space,setSpace]=useState(''),[section,setSection]=useState(''),[agent,setAgent]=useState('');
 const [tab,setTab]=useState('demands'),[rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [work,setWork]=useState<Row|null>(null),[locale,setLocale]=useState('zh-CN'),[title,setTitle]=useState(''),[body,setBody]=useState('');
 const [draftStatus,setDraftStatus]=useState('');
 const latestDraft=useRef<Row|null>(null),draftTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 latestDraft.current=work?{work,locale,title,body}:null;
 const persist=useCallback(async()=>{clearTimeout(draftTimer.current);const value=latestDraft.current;if(value)await call('save_local',value);},[]);
 const current=spaces.find(s=>s.id===space),running=['starting','working','idle','stopping'].includes(status.worker?.state);
 const local=useCallback(async()=>{const value=await call('status');setStatus(value);setAgent(old=>old||value.agents?.find((a:Row)=>a.available&&a.enabled)?.id||'');},[]);
 const registry=useCallback(async()=>{const r=await call('registry');setSpaces(r.workspaces);setSpace(old=>r.workspaces.some((w:Row)=>w.id===old)?old:r.workspaces[0]?.id||'');if(r.offline)setNotice(tr("中心暂不可用，正在使用本机保存的工作空间配置。"));},[]);
 const refresh=useCallback(async()=>{if(!space)return;setRows(await call(tab,{workspaceId:space}));},[space,tab]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 useEffect(()=>{if(!active)return;local().catch(e=>setError(String(e)));const timer=setInterval(()=>void local().catch(()=>{}),5000);return()=>clearInterval(timer);},[active,local]);
 useEffect(()=>{if(active&&status.configured)registry().catch(e=>setError(String(e)));},[active,status.configured,registry]);
 useEffect(()=>{if(active&&space)refresh().catch(e=>setError(String(e)));},[active,refresh,space]);
 useEffect(()=>{setSection('');setWork(null);},[space]);
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
  if(!work)return;const old=work.editions.find((e:Row)=>e.locale===locale);
  const packet={requestId:crypto.randomUUID(),workId:work.id,workspaceId:work.workspaceId,sectionId:work.sectionId,baseRevisions:{[locale]:old?.revision||0},editions:[{...(old?.payload||{}),locale,title,bodyMarkdown:body}]};
  const result=await call('submit',{packet});await local();
  if(result.state==='accepted'){setNotice(tr("中心已接收，发布结果请查看发布记录。"));await open(await call('work',{workId:work.id}),locale,false);}
  else setNotice(tr("稿件和原请求已保存在本机。")+(result.error?.message||tr("等待中心恢复后提交。")));
 };
 return <main className="rssd-desktop-center"><header><div><span className="rssd-center-kicker">RSSD</span><h1>{tr("生产中心")}</h1><p>{tr("选择范围与智能体，领取需求；本机保留稿件与提交回执。")}</p></div><button disabled={busy} onClick={()=>void run(async()=>{await local();if(status.configured){await registry();await refresh();}})}>{tr("刷新")}</button></header>
  {error&&<p className="rssd-center-error" role="alert">{error}</p>}{notice&&<p className="rssd-center-notice" role="status">{notice}</p>}
  <details open={!status.configured} className="rssd-center-connection"><summary>{status.configured?tr("已连接：")+status.origin:tr("连接 RSSD 中心")}</summary><form onSubmit={e=>{e.preventDefault();const v=new FormData(e.currentTarget),form=e.currentTarget;void run(async()=>{await call('connect',{origin:v.get('origin')},String(v.get('token')));form.reset();await local();await registry();setNotice(tr("连接已验证，设备凭据已存入系统凭据库。"));});}}>
   <label>{tr("中心网址")}<input name="origin" type="url" required defaultValue={status.origin} placeholder="https://center.example.org"/></label><label>{tr("设备连接凭据")}<input name="token" type="password" required autoComplete="new-password"/></label><button disabled={busy||running}>{tr("验证并连接")}</button>
  </form></details>
  {status.configured&&<><section className="rssd-center-production" aria-label={tr("工作模式")}><div className="rssd-center-controls">
   <label>{tr("工作空间")}<select value={space} disabled={busy||running} onChange={e=>{const next=e.target.value;void run(async()=>{await persist();setSpace(next);});}}>{spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>{tr("栏目")}<select value={section} disabled={busy||running} onChange={e=>setSection(e.target.value)}><option value="">{tr("全部栏目")}</option>{current?.sections.map((s:Row)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>{tr("本机智能体")}<select value={agent} disabled={busy||running} onChange={e=>setAgent(e.target.value)}><option value="">{tr("选择智能体")}</option>{status.agents?.filter((a:Row)=>a.enabled).map((a:Row)=><option key={a.id} value={a.id} disabled={!a.available}>{a.name}{!a.available?tr(" · 尚不可用"):''}</option>)}</select></label>
   <button className="rssd-center-primary" disabled={busy||running||!space||!agent} onClick={()=>void run(async()=>{await call('start',{agentId:agent,workspaceIds:[space],sectionIds:section?[section]:[],resume:status.worker?.state==='blocked'||status.worker?.state==='interrupted'});setNotice(tr("工作实例正在启动，任务与运行状态会保留在本机。"));await local();})}>{tr("开启工作模式")}</button>
   {running&&<button disabled={busy} onClick={()=>void run(async()=>{await call('stop');setNotice(tr("当前需求完成后停止领取。"));})}>{tr("本单完成后停止")}</button>}
  </div><p role="status">{status.worker?`${label(status.worker.state)} · ${status.worker.message||''}`:tr("工作模式尚未开启")}</p></section>
  {status.drafts?.length>0&&<details className="rssd-center-connection"><summary>{tr("本机草稿 ·")}{status.drafts.length}</summary>{status.drafts.map((d:Row)=><p key={d.workId+':'+d.locale}><button onClick={()=>void run(async()=>{const saved=await call('local_draft',{workId:d.workId,locale:d.locale});setTab('works');setWork(saved.work);setLocale(saved.locale);setTitle(saved.title);setBody(saved.body);setNotice(tr("已恢复本机草稿，提交时仍校验原基础版本。"));})}>{d.title||tr("未命名草稿")} · {d.locale}</button></p>)}</details>}
  <nav className="rssd-center-tabs" aria-label={tr("中心内容")}>{[['demands',tr("需求池")],['works',tr("作品库")],['publications',tr("发布记录")]].map(([id,name])=><button key={id} aria-pressed={tab===id} onClick={()=>void run(async()=>{await persist();setTab(id);setWork(null);})}>{name}</button>)}<button disabled={busy||!space} onClick={()=>void run(refresh)}>{tr("更新列表")}</button>{tab==='works'&&<button disabled={!space||busy} onClick={()=>open({id:crypto.randomUUID(),workspaceId:space,sectionId:section||current?.sections[0]?.id,editions:[]},'zh-CN')}>{tr("自主创作")}</button>}</nav>
  {work?<section className="rssd-center-editor"><div><button onClick={()=>void run(async()=>{await persist();setWork(null);})}>{tr("返回作品库")}</button><label>{tr("语言")}<select value={locale} onChange={e=>{const old=work.editions.find((x:Row)=>x.locale===locale);if((title!==(old?.payload.title||'')||body!==(old?.payload.bodyMarkdown||''))&&!confirm(tr("当前语言有未提交修改，确定切换吗？")))return;const lang=e.target.value;void run(async()=>{await persist();await open(work,lang);});}}><option value="zh-CN">{tr("中文")}</option><option value="en">English</option></select></label><span>{tr("基于版本")}{work.editions.find((e:Row)=>e.locale===locale)?.revision||0}</span><button className="rssd-center-primary" disabled={busy||!title.trim()||!body.trim()} onClick={()=>void run(save)}>{tr("提交中心")}</button></div><label>{tr("标题")}<input value={title} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label><label>{tr("完整正文（Markdown）")}<textarea value={body} disabled={busy} onChange={e=>setBody(e.target.value)} rows={22}/></label></section>:<div className="rssd-center-list">{rows.length?rows.map(row=><article key={row.id}><div><h2>{row.title||row.editions?.[0]?.title||row.workId}</h2><p>{tab==='demands'?row.payload?.brief:tab==='works'?row.editions.map((e:Row)=>e.locale+' · v'+e.revision).join(' / '):row.locale+' · v'+row.revision+' → '+row.destinationId}</p>{row.error&&<p className="rssd-center-error">{row.error}</p>}</div><span>{label(row.state)}</span>{tab==='works'&&<button disabled={busy} onClick={()=>void run(async()=>open(await call('work',{workId:row.id})))}>{tr("打开")}</button>}{tab==='demands'&&row.state==='queued'&&<button disabled={busy||running||!agent} onClick={()=>void run(async()=>{await call('start',{agentId:agent,workspaceIds:[space],demandId:row.id,once:true});setNotice(tr("正在认领这条需求。"));await local();})}>{tr("处理这条")}</button>}</article>):<p className="rssd-center-empty">{tr("此工作空间暂时没有记录。")}</p>}</div>}
  {work&&<p role="status">{draftStatus}</p>}
  {status.outbox?.some((r:Row)=>r.state!=='accepted')&&<section className="rssd-center-outbox"><h2>{tr("本机待处理稿件")}</h2>{status.outbox.filter((r:Row)=>r.state!=='accepted').map((r:Row)=><article key={r.requestId}><div>{r.workId}<p>{label(r.state)} · {r.error?.message}</p></div><button disabled={busy} onClick={()=>void run(async()=>{await call('recover',{requestId:r.requestId});await local();setNotice(tr("已查询原请求，结果已更新。"));})}>{tr("查询并恢复")}</button></article>)}</section>}
  </>}
 </main>;
}
