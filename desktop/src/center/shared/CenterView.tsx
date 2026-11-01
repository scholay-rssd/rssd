// SPDX-License-Identifier: MIT
// Canonical RSSD center presentation. The server consumes the versioned copy.
import type {ReactNode} from 'react';
import './center-view.css';

export type CenterTab = 'demands'|'works'|'publications'|'workers'|'destinations'|'settings'|'health'|'guestbooks'|'labels';
export type Translate = (text:string)=>string;
export const centerTabs:ReadonlyArray<readonly [CenterTab,string]> = [
  ['demands','需求池'],['works','作品库'],['publications','发布记录'],
  ['workers','执行设备'],['destinations','发布渠道'],['settings','工作空间'],
  ['health','运行状况'],['guestbooks','留言审核'],['labels','流量标签'],
];
export const centerStates:Record<string,string> = {
  queued:'待领取',claimed:'进行中',blocked:'待处理',completed:'已交稿',cancelled:'已取消',
  published:'已发布',legacy_published:'原系统已发布',accepted:'已接收',submitted:'已提交',
  verified:'已发布',failed:'失败',unknown:'待核实',draft_saved:'已存草稿',
  pending:'等待提交',needs_attention:'需要核对',dispatching:'正在分发',superseded:'已被新版替代',
  idle:'空闲',running:'工作中',working:'工作中',paused:'已暂停',revoked:'已撤销',
  stopped:'已停止',stopping:'本单完成后停止',interrupted:'已中断',starting:'正在启动',
};
const identity:Translate=text=>text;
export function stateLabel(state:string,t:Translate=identity){return t(centerStates[state]||state||'');}
export function CenterHeader({spaces,space,onSpace,refresh,disabled=false,loading=false,t=identity}:{
  spaces:{id:string;name:string}[];space:string;onSpace:(value:string)=>void;refresh:()=>void;
  disabled?:boolean;loading?:boolean;t?:Translate;
}){
  return <header className="center-view-header"><div><div className="center-view-overline">RSSD / {t('内容生产')}</div><h1>{t('工作中心')}</h1></div>
    <div className="center-view-header-actions"><label><span className="center-view-sr-only">{t('工作空间')}</span>
      <select aria-label={t('工作空间')} value={space} disabled={disabled} onChange={e=>onSpace(e.target.value)}>
        <option value="">{t('全部工作空间')}</option>{spaces.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}
      </select></label><button disabled={loading} onClick={refresh}>{t('刷新')}</button></div>
  </header>;
}
export function CenterNavigation({tab,onTab,disabled=false,external=[],t=identity}:{tab:CenterTab;onTab:(tab:CenterTab)=>void;disabled?:boolean;external?:readonly CenterTab[];t?:Translate}){
  return <nav className="center-view-tabs" aria-label={t('中心功能')}>{centerTabs.map(([id,name])=>
    <button key={id} disabled={disabled} aria-current={tab===id?'page':undefined} title={external.includes(id)?t('在网页中心打开'):undefined} onClick={()=>onTab(id)}>{t(name)}{external.includes(id)&&<span aria-hidden="true" className="center-view-external"> ↗</span>}</button>)}</nav>;
}
export function CenterToolbar({tab,search,onSearch,onSearchSubmit,disabled=false,actions,t=identity}:{
  tab:CenterTab;search:string;onSearch:(value:string)=>void;onSearchSubmit?:()=>void;disabled?:boolean;actions?:ReactNode;t?:Translate;
}){
  const searchable=tab==='works'||tab==='demands';
  return <div className="center-view-toolbar"><form onSubmit={e=>{e.preventDefault();onSearchSubmit?.();}} className="center-view-search">
    <label><span>{t('查找')}</span><input type="search" aria-label={t('查找作品或需求')} maxLength={500} value={search}
      placeholder={t(tab==='works'?'作品标题或正文':'需求标题或写作要求')} disabled={disabled||!searchable} onChange={e=>onSearch(e.target.value)}/></label>
    {onSearchSubmit&&searchable&&<button disabled={disabled}>{t('查找')}</button>}</form><div className="center-view-actions">{actions}</div></div>;
}
export type CenterRow = {id:string;title?:string;name?:string;workId?:string;state?:string;locale?:string;revision?:number;
  destinationId?:string;workspaceIds?:string[];sectionId?:string;updatedAt?:string;createdAt?:string;heartbeatAt?:string;error?:string;
  editions?:{title?:string;locale:string;revision:number}[];details?:{message?:string};payload?:{brief?:string};};
export function CenterList({tab,rows,loading,sections=[],openWork,actions,disabled=false,t=identity}:{
  tab:CenterTab;rows:CenterRow[];loading:boolean;sections?:{id:string;name:string}[];openWork?:(row:CenterRow)=>void;
  actions?:(row:CenterRow)=>ReactNode;disabled?:boolean;t?:Translate;
}){
  const title=(row:CenterRow)=>row.title||row.editions?.[0]?.title||row.name||row.workId||t('未命名作品');
  const detail=(row:CenterRow)=>tab==='demands'?(sections.find(s=>s.id===row.sectionId)?.name||row.sectionId||''):
    tab==='works'?row.editions?.map(e=>`${e.locale} · v${e.revision}`).join(' / '):
    tab==='workers'?(row.details?.message||row.workspaceIds?.join(' · ')):`${row.locale||''} · v${row.revision||0} → ${row.destinationId||''}`;
  const empty:Partial<Record<CenterTab,string>>={demands:'需求池里还没有任务',works:'还没有作品',workers:'尚未连接执行设备',publications:'暂无发布记录'};
  return <div className="center-view-list rssd-center-list" aria-busy={loading}>{rows.length?rows.map(row=>{
    const timestamp=row.heartbeatAt||row.updatedAt||row.createdAt;
    const date=timestamp?new Date(timestamp):null;
    return <article className="center-view-row" key={row.id}><div className="center-view-row-main"><h2>{tab==='works'&&openWork?
      <button className="center-view-work-link" disabled={disabled} onClick={()=>openWork(row)}>{title(row)}</button>:title(row)}</h2>
      <p>{detail(row)}</p>{row.error&&<p className="center-view-error">{row.error}</p>}</div>
      {row.state&&<span className={'center-view-state center-view-state-'+row.state}>{stateLabel(row.state,t)}</span>}
      {date&&!Number.isNaN(date.valueOf())&&<time dateTime={timestamp}>{date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>}
      {actions?.(row)}</article>;
  }):<div className="center-view-empty"><h2>{t(loading?'正在读取…':empty[tab]||'此工作空间暂时没有记录。')}</h2>
    <p>{t(tab==='demands'?'添加选题后，在 PC 或无头版开启工作模式。':tab==='works'?'作品可以从生产设备提交，也可以在这里创建。':tab==='workers'?'连接凭据按工作空间授权，智能体账号留在设备上。':'提交作品后，各个目的地的结果会分别记录在这里。')}</p></div>}</div>;
}
export function CenterPagination({page,hasNext,onPage,disabled=false,t=identity}:{page:number;hasNext:boolean;onPage:(page:number)=>void;disabled?:boolean;t?:Translate}){
  return <nav className="center-view-pages" aria-label={t('中心列表分页')}><button disabled={disabled||page===0} onClick={()=>onPage(page-1)}>{t('上一页')}</button>
    <span>{t('第 {{page}} 页').replace('{{page}}',String(page+1))}</span><button disabled={disabled||!hasNext} onClick={()=>onPage(page+1)}>{t('下一页')}</button></nav>;
}
