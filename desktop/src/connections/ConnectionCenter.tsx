import {useEffect,useRef,useState} from 'react';
import {openUrl} from '@tauri-apps/plugin-opener';
import Icon from '../components/Icon';
import ProviderIcon from './ProviderIcon';
import {categories,connectionService,connectionEnabled,filterProviders,providers,safeResourceUrl,statusLabels,type CenterState,type Connection,type ConnectionService,type Provider,type ResourcePage} from './client';
import './connections.css';

import { tr } from "../uiText";
export default function ConnectionCenter({service=connectionService,onPlatforms,compact=false,active=true}:{service?:ConnectionService;onPlatforms?:()=>void;compact?:boolean;active?:boolean}){
 const [state,setState]=useState<CenterState>(),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[connectedOnly,setConnectedOnly]=useState(false);
 const [selected,setSelected]=useState<Provider>(),[secret,setSecret]=useState(''),[target,setTarget]=useState(''),[busy,setBusy]=useState(''),[message,setMessage]=useState('');
 const [page,setPage]=useState<ResourcePage>(),[confirmDisconnect,setConfirmDisconnect]=useState(false);
 const alive=useRef(true),operation=useRef(false),detailHeading=useRef<HTMLHeadingElement>(null),lastProvider=useRef('');
 const [reload,setReload]=useState(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!active){setSecret('');return;}let current=true;setLoading(true);setError('');void service.list().then(v=>{if(current)setState(v);}).catch(()=>{if(current){setState(undefined);setError(tr("无法读取连接状态，请重试。"));}}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[service,reload,active]);
 useEffect(()=>{if(selected)detailHeading.current?.focus();else if(lastProvider.current)document.getElementById(`connection-${lastProvider.current}`)?.focus();},[selected]);
 const connections=state?.connections||[];
 const current=connections.find(c=>c.provider===selected?.id);
 const connected=connections.filter(c=>c.configured);
 const enabled=connections.filter(connectionEnabled);
 const visible=filterProviders(query,compact?'all':category,compact?false:connectedOnly,connections).filter(p=>!compact||!connectedOnly||enabled.some(c=>c.provider===p.id));
 const dirty=!!selected&&(!!secret.trim()||target!==(current?.target||''));
 function update(next:Connection){setState(s=>s?{...s,connections:[...s.connections.filter(c=>c.provider!==next.provider),next]}:s);window.dispatchEvent(new CustomEvent('today:connections-changed',{detail:{spaceId:state?.spaceId}}));}
 function select(p:Provider){lastProvider.current=p.id;setSelected(p);setTarget(connections.find(c=>c.provider===p.id)?.target||'');setSecret('');setPage(undefined);setMessage('');setError('');setConfirmDisconnect(false);}
 function back(){setSelected(undefined);setSecret('');setPage(undefined);setError('');setMessage('');setConfirmDisconnect(false);}
 async function run(name:string,work:()=>Promise<void>){if(operation.current)return;operation.current=true;setBusy(name);setError('');setMessage('');setConfirmDisconnect(false);try{await work();}catch(e){if(alive.current)setError(typeof e==='string'?e:e instanceof Error?e.message:tr("操作失败，请重试。"));}finally{operation.current=false;if(alive.current){setBusy('');if(name==='save'||name==='disconnect')setSecret('');}}}
 async function toggle(c:Connection){if(!state)return;await run('enable',async()=>{const next=await service.setEnabled(c.provider,!connectionEnabled(c),state.spaceId);if(alive.current)update(next);});}
 async function save(){if(!selected)return;await run('save',async()=>{const result=await service.save(selected.id,secret,target);if(!alive.current)return;update(result);setTarget(result.target);setPage(undefined);setMessage(tr("连接已验证，设置已保存。"));if(compact)back();});}
 async function verify(){if(!selected)return;await run('verify',async()=>{const result=await service.verify(selected.id);if(!alive.current)return;update(result);setMessage(result.status==='verified'?tr("连接正常。"):result.message||tr(statusLabels[result.status]));if(result.status!=='verified')setPage(undefined);});}
 async function browse(more=false){if(!selected)return;await run('browse',async()=>{try{const result=await service.browse(selected.id,more?page?.nextCursor:undefined);if(alive.current){setPage(p=>more&&p?{...result,items:[...p.items,...result.items.filter(item=>!p.items.some(old=>old.id===item.id))]}:result);}}finally{const next=await service.list();if(alive.current)setState(next);}});}
 async function disconnect(){if(!selected)return;await run('disconnect',async()=>{const result=await service.disconnect(selected.id);if(!alive.current)return;update(result);setTarget('');setPage(undefined);setMessage(tr("已解除此空间的连接。"));});}
 async function enter(value:string){if(!selected)return;await run('enter',async()=>{const result=await service.save(selected.id,'',value);if(!alive.current)return;update(result);setTarget(result.target);setPage(undefined);setMessage(tr("已切换资料范围，点击「预览资料」读取。"));});}
 const launch=(url:string)=>void run('open',()=>openUrl(url));
 return <div className={'connection-center'+(compact?' is-compact':'')} aria-busy={!!busy||loading}>
  {!selected?<>
   {compact?<>
    <p className="connection-space-name">{state?.spaceName||tr('正在读取连接状态…')}</p>
    <div className="connection-view-switch" role="group" aria-label={tr('连接器视图')}>
      <button type="button" aria-pressed={!connectedOnly} onClick={()=>setConnectedOnly(false)}>{tr('全部连接器')}</button>
      <button type="button" aria-pressed={connectedOnly} onClick={()=>setConnectedOnly(true)}>{tr('当前空间已开启')}<span>{loading?'—':enabled.length}</span></button>
    </div>
   </>:<>
   <div className="connection-toolbar"><p>{tr("连接你的资料，让不同来源汇入创作。")}</p><button className={`connection-count ${connectedOnly?'is-active':''}`} aria-pressed={connectedOnly} onClick={()=>setConnectedOnly(!connectedOnly)} disabled={loading||!state}><span className="connection-mini-icons">{connected.slice(0,3).map(c=><ProviderIcon key={c.provider} name={providers.find(p=>p.id===c.provider)?.icon||''}/>)}</span>{tr("已连接 {{connected}} 个", {connected: connected.length})}<Icon name="chevron-right" size={14}/></button></div>
   <div className="connection-search"><Icon name="search" size={19}/><input aria-label={tr("搜索连接来源")} placeholder={tr("搜索应用和来源")} value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label={tr("清空搜索")} onClick={()=>setQuery('')}><Icon name="x"/></button>}</div>
   <div className="connection-categories" role="group" aria-label={tr("来源分类")}>{categories.map(c=><button key={c.id} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}>{tr(c.name)}</button>)}</div>
   <div className="connection-section-label"><h3>{connectedOnly?tr("已连接的来源"):categories.find(c=>c.id===category)?.name==='全部'?tr("可连接的来源"):tr(categories.find(c=>c.id===category)?.name||'')}</h3><span>{state?.spaceName?tr("{{spaceName}} · 当前空间", {spaceName: state.spaceName}):''}</span></div>
   </>}
   {state&&error&&<p role="alert" className="connection-feedback is-error">{error}</p>}
   {loading?<div className="connection-empty" role="status">{tr("正在读取连接状态…")}</div>:!state?<div className="connection-empty"><p role="alert">{error}</p><button onClick={()=>setReload(v=>v+1)}>{tr("重新读取")}</button></div>:visible.length?<div className="connection-list">{visible.map(p=>{const c=connections.find(x=>x.provider===p.id);return <div key={p.id} className="connection-entry"><button id={`connection-${p.id}`} className="connection-row" disabled={!!busy} onClick={()=>select(p)}><ProviderIcon name={p.icon}/><span className="connection-row-body"><strong>{p.name}</strong><span>{p.description}</span>{compact?<small>{tr(connectionEnabled(c)?"已开启":"未开启")}{c?.configured&&["expired","limited","unavailable"].includes(c.status)?" · "+tr(statusLabels[c.status]):""}</small>:c?.configured&&<small data-status={connectionEnabled(c)?c.status:'disabled'}>{!connectionEnabled(c)&&tr("已停用 · ")}{tr(statusLabels[c.status])}</small>}</span>{!compact&&!c?.configured&&<span className="connection-row-action">{tr("连接")}</span>}</button>{(compact||c?.configured)&&<button className="connection-enable" role="switch" aria-label={tr("在当前空间启用 {{name}}", {name: p.name})} aria-checked={connectionEnabled(c)} disabled={!!busy} title={tr(connectionEnabled(c)?"在当前空间关闭":"在当前空间开启")} onClick={()=>{if(c?.configured)void toggle(c);else select(p);}}><span/></button>}</div>;})}</div>:<div className="connection-empty"><Icon name="search" size={24}/><p>{compact&&connectedOnly?tr("当前空间尚未开启连接器。"):connectedOnly?tr("没有符合条件的已连接来源。"):tr("没有找到匹配的来源。")}</p><button onClick={()=>{setQuery('');setCategory('all');setConnectedOnly(false);}}>{tr("查看全部来源")}</button></div>}
   <footer className="connection-footer"><span><Icon name="folder" size={14}/>{tr("连接及启用状态按工作空间保存")}</span>{onPlatforms&&<button onClick={onPlatforms}>{tr("微信公众号、知乎等平台授权")}<Icon name="chevron-right" size={13}/></button>}</footer>
  </>:<>
   <button className="connection-back" onClick={back} disabled={!!busy}><Icon name="chevron-right" size={14}/>{tr("全部来源")}</button>
   <header className="connection-detail-heading"><ProviderIcon name={selected.icon}/><div><h3 ref={detailHeading} tabIndex={-1}>{selected.name}</h3><p>{selected.description}</p></div><span className="connection-state" data-status={current?.status||'unconfigured'}>{tr(statusLabels[current?.status||'unconfigured'])}</span></header>
   <div className="connection-capabilities">{selected.capabilities.map(c=><span key={c}><Icon name="check" size={13}/>{c}</span>)}</div>
   <p className="connection-requirement">{selected.requirement}</p>
   <div className="connection-links"><button disabled={!!busy} onClick={()=>launch(selected.setupUrl)}>{tr("获取凭证")}<Icon name="open" size={13}/></button><button disabled={!!busy} onClick={()=>launch(selected.docsUrl)}>{tr("官方接入说明")}<Icon name="open" size={13}/></button></div>
   <form className="connection-form" autoComplete="off" onSubmit={e=>{e.preventDefault();void save();}}>
    <label htmlFor="connection-secret">{selected.secretLabel}{current?.configured&&<small>{tr("已保存 · 留空保留原凭证")}</small>}</label>
    <input id="connection-secret" type="password" autoComplete="new-password" spellCheck={false} maxLength={2400} value={secret} disabled={!!busy} onChange={e=>setSecret(e.target.value)} placeholder={current?.configured?tr("如需更换，请粘贴新的凭证"):tr("粘贴访问令牌或 API Key")} required={!current?.configured}/>
    <label htmlFor="connection-target">{selected.targetLabel}</label>
    <input id="connection-target" type="text" autoComplete="off" spellCheck={false} maxLength={2048} value={target} disabled={!!busy} onChange={e=>setTarget(e.target.value)} placeholder={selected.targetPlaceholder} required={selected.targetRequired} aria-describedby="connection-target-help"/>
    <p id="connection-target-help" className="connection-field-help">{selected.targetHelp}</p>
    <div className="connection-form-actions"><button className="connection-primary" disabled={!!busy||(!current?.configured&&!secret.trim())||(selected.targetRequired&&!target.trim())} type="submit">{busy==='save'?tr("正在验证…"):current?.configured?tr("验证并保存"):tr("验证并连接")}</button>{current?.configured&&<><button type="button" disabled={!!busy||dirty} onClick={()=>void verify()}>{busy==='verify'?tr("正在检查…"):tr("检查连接")}</button>{!compact&&<button type="button" disabled={!!busy||dirty||!connectionEnabled(current)} onClick={()=>void browse()}>{busy==='browse'?tr("正在读取…"):tr("预览资料")}</button>}</>}</div>
    {current?.configured&&!connectionEnabled(current)&&<p className="connection-field-help">{tr("此来源已在当前空间停用，返回全部来源可重新启用。")}</p>}
   </form>
   {busy&&<p role="status" className="connection-feedback">{tr("正在处理，请稍候…")}</p>}{error&&<p role="alert" className="connection-feedback is-error">{error}</p>}{message&&<p role="status" className="connection-feedback">{message}</p>}
   {!compact&&page&&<section className="connection-resources" aria-label={tr("来源资料预览")}><header><h4>{tr("资料预览")}</h4><span>{tr("{{items}} 项", {items: page.items.length})}</span></header>{page.notice&&<p className="connection-field-help">{page.notice}</p>}{!page.items.length?<p className="connection-empty">{tr("当前范围没有资料。连接有效，可调整范围后重试。")}</p>:<ul>{page.items.map(item=><li key={item.id}><Icon name={item.target?'folder':'file'} size={17}/><div><strong>{item.title}</strong><small>{item.kind}</small>{item.detail&&<p>{item.detail}</p>}</div><div className="connection-resource-actions">{item.target&&<button disabled={!!busy||dirty} onClick={()=>void enter(item.target!)}>{tr("查看")}</button>}{safeResourceUrl(item.url)&&<button disabled={!!busy} aria-label={tr("打开 {{title}}", {title: item.title})} onClick={()=>launch(safeResourceUrl(item.url)!)}><Icon name="open" size={15}/></button>}<button disabled={!!busy} aria-label={tr("复制 {{title}} 的来源", {title: item.title})} onClick={()=>void run('copy',async()=>{await navigator.clipboard.writeText(`${item.title}\n${safeResourceUrl(item.url)||item.id}`);if(alive.current)setMessage(tr("来源引用已复制。"));})}><Icon name="copy" size={15}/></button></div></li>)}</ul>}{page.nextCursor&&<button disabled={!!busy||dirty} onClick={()=>void browse(true)}>{tr("加载更多")}</button>}{current?.target&&selected.id!=='figma'&&<button className="connection-reset-target" disabled={!!busy||dirty} onClick={()=>void enter('')}>{tr("返回全部目录")}</button>}</section>}
   <div className="connection-detail-footer"><p>{state?.spaceName} · {state?.vault}{current?.checkedAt&&<><br/>{tr("最近检查：{{toLocaleString}}", {toLocaleString: new Date(current.checkedAt).toLocaleString()})}</>}</p>{current?.configured&&(confirmDisconnect?<div className="connection-disconnect-confirm"><p>{tr("解除当前空间的连接，已保存的文章和素材保留。")}</p><button disabled={!!busy} onClick={()=>void disconnect()}>{tr("确认解除")}</button><button onClick={()=>setConfirmDisconnect(false)}>{tr("取消")}</button></div>:<button disabled={!!busy} onClick={()=>setConfirmDisconnect(true)}>{tr("解除连接")}</button>)}</div>
  </>}
 </div>;
}
