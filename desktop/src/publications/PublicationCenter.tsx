import {useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {ACTIVE_SITE,onActiveSiteChange} from '../../../scripts/site-profile.mjs';
import {invoke} from "../lib/nativeCore";
import {openUrl} from "@tauri-apps/plugin-opener";
import Icon from "../components/Icon";
import PublicationReader from "./PublicationReader";
import WebsiteRecordPreview from "./WebsiteRecordPreview";
import ResizeHandle from "../components/ResizeHandle";
import {usePublicationSplit} from "./usePublicationSplit";
import {safePageViewUrl} from "../lib/pageViewState";
import {EMPTY,STATUS_LABELS,dateText,feishuLink,groupRecords,recordMatches,matchesStatus,type Snapshot,type FeishuSnapshot,type WebsiteSnapshot,type StatusFilter,type WebsiteItem,type Publication,type PublicationSection} from "./model";
import "./publications.css";

import { tr, trNative } from "../uiText";
const call=<T,>(method:string)=>invoke<T>("publications_call",{method});
type Tab=PublicationSection;
const buildArchiveLabels=()=>({digest:ACTIVE_SITE.columns[0],observation:ACTIVE_SITE.columns[1],history:ACTIVE_SITE.columns[4],year:ACTIVE_SITE.columns[3],openSource:ACTIVE_SITE.columns[2]});
let ARCHIVE_LABELS=buildArchiveLabels();
type ArchiveKind=keyof typeof ARCHIVE_LABELS;
// Mirror the public archive's editorial category routing; storage kind stays
// unchanged so an open-source article is still edited through its original ID.
const buildCategoryKind=()=>({...(ACTIVE_SITE.legacy?{'新闻聚合':'digest' as const,'学术新闻':'digest' as const}:{}),[ACTIVE_SITE.columns[0]]:'digest',[ACTIVE_SITE.columns[1]]:'observation',[ACTIVE_SITE.columns[4]]:'history',[ACTIVE_SITE.columns[3]]:'year',[ACTIVE_SITE.columns[2]]:'openSource'});
let CATEGORY_KIND:Record<string,ArchiveKind>=buildCategoryKind();
const archiveKind=(item:WebsiteItem):ArchiveKind=>item.kind==='news'?(CATEGORY_KIND[item.category]||'observation'):item.kind;
const INITIAL={q:"",platform:"",status:"all" as StatusFilter,kind:"" as ArchiveKind|"",selected:""};

type Props={section:PublicationSection;active:boolean;onOpenDraft:(id:string)=>void;sidebarHeader?:ReactNode};
export default function PublicationCenter(props:Props){
  return <PublicationWorkspace key={props.section} {...props}/>;
}
function PublicationWorkspace({section:tab,active,onOpenDraft,sidebarHeader}:Props){
  const split=usePublicationSplit(active,tab);
  const [snapshot,setSnapshot]=useState<Snapshot>(EMPTY),[loaded,setLoaded]=useState(false);
  const [filters,setFilters]=useState({platforms:{...INITIAL},website:{...INITIAL}});
  const [busy,setBusy]=useState<Tab|null>(null),[errors,setErrors]=useState<Record<Tab,string>>({platforms:"",website:""});
  const [notice,setNotice]=useState(""),[limit,setLimit]=useState(80);
  const [reading,setReading]=useState({scope:"",recordId:""});
  const [collapsed,setCollapsed]=useState("");
  const started=useRef(false),refreshing=useRef(false);
  const f=filters[tab],feishu=snapshot.feishu,website=snapshot.website;
  function update(patch:Partial<typeof INITIAL>){setFilters(prev=>({...prev,[tab]:{...prev[tab],...patch}}));if(Object.keys(patch).some(key=>key!=="selected"))setLimit(80);}
  useEffect(()=>{
    if(!active||started.current)return;started.current=true;
    void call<Snapshot>("snapshot").then(x=>{setSnapshot(x);setLoaded(true);}).catch(e=>{setErrors({platforms:String(e),website:String(e)});setLoaded(true);started.current=false;});
  },[active]);
  async function refresh(){
    if(refreshing.current)return;refreshing.current=true;const target=tab;setBusy(target);setErrors(prev=>({...prev,[target]:""}));setNotice("");
    try{
      if(target==="platforms"){const value=await call<FeishuSnapshot>("refresh_feishu");setSnapshot(prev=>({...prev,feishu:value}));}
      else{const value=await call<WebsiteSnapshot>("refresh_website");setSnapshot(prev=>({...prev,website:value}));}
      // Only local metadata is reread here; this never triggers another network request.
      const value=await call<Snapshot>("snapshot");setSnapshot(value);
      setNotice(target==="platforms"?tr("飞书台账已刷新"):tr("官网目录已刷新"));
    }catch(e){setErrors(prev=>({...prev,[target]:String(e)}));}
    finally{refreshing.current=false;setBusy(null);}
  }
  async function open(url:string){if(!/^https?:\/\//i.test(url))return;try{await openUrl(url);}catch{setNotice(tr("链接未能打开，请复制后在浏览器查看。"));}}
  async function copy(url:string){try{await navigator.clipboard.writeText(url);setNotice(tr("链接已复制"));}catch{setNotice(tr("复制失败，请从详情中选择链接复制。"));}}
  const allGroups=useMemo(()=>groupRecords(feishu.records),[feishu.records]);
  const groups=useMemo(()=>groupRecords(feishu.records.filter(r=>recordMatches(r,f.q,f.platform,f.status))),[feishu.records,f.q,f.platform,f.status]);
  const selected=groups.find(x=>x.key===f.selected)||groups[0];
  const fullGroup=allGroups.find(x=>x.key===selected?.key);
  const platforms=useMemo(()=>[...new Set(feishu.records.map(r=>r.platform))].sort((a,b)=>a.localeCompare(b,"zh")),[feishu.records]);
  const siteItems=useMemo(()=>website.items.filter(x=>(!f.kind||archiveKind(x)===f.kind)&&[x.title,x.summary,x.category].join(" ").toLowerCase().includes(f.q.trim().toLowerCase())).sort((a,b)=>(b.lastmod||"").localeCompare(a.lastmod||"")||a.title.localeCompare(b.title,"zh")),[website.items,f.kind,f.q]);
  const site=siteItems.find(x=>x.key===f.selected)||siteItems[0];
  function selectItem(key:string){
    const current=tab==="platforms"?selected?.key:site?.key;
    const scope=tab+":"+key;
    setCollapsed(value=>current===key&&value!==scope?scope:"");
    update({selected:key});
  }
  const total=tab==="platforms"?groups.length:siteItems.length;
  const updated=tab==="platforms"?feishu.updatedAt:website.updatedAt;
  const draftId=tab==="platforms"?fullGroup?.sourceId:site?.articleId;
  const draft=snapshot.drafts.find(x=>x.id===draftId||Boolean(draftId&&x.sourceIds?.includes(draftId)));
  const records=fullGroup?.records.slice().sort((a,b)=>a.platform.localeCompare(b.platform,"zh"))||[];
  // A reader selection belongs to this article and filter; never leak a previous
  // article's URL into the next article, including records without a work link.
  const readingScope=JSON.stringify([fullGroup?.key,f.q,f.platform,f.status]);
  const matching=records.filter(r=>recordMatches(r,f.q,f.platform,f.status));
  const readingRecord=(reading.scope===readingScope?records.find(r=>r.id===reading.recordId):undefined)
    ||matching.find(r=>safePageViewUrl(r.url))||matching[0];
  const targetUrl=tab==="platforms"?safePageViewUrl(readingRecord?.url):safePageViewUrl(site?.url);
  const targetTitle=tab==="platforms"?(readingRecord?`${readingRecord.platform} · ${readingRecord.title}`:""):site?.title;
  function readRecord(record:Publication){setReading({scope:readingScope,recordId:record.id});}
  const platformDetails=fullGroup&&<div className="pub-inline-detail" aria-label={tr("文章的发布去向")}>
    <div className="pub-group-actions"><span className="pub-muted">{tr("{{records}} 条记录 · 状态来自飞书台账", {records: records.length})}</span><div className="pub-actions">
      {draft?<button onClick={()=>onOpenDraft(draft.id)}><Icon name="file" size={14}/>{tr("打开母稿")}</button>:<span className="pub-muted">{fullGroup.sourceId?tr("本地未找到对应母稿"):tr("台账未填写源稿编号")}</span>}
      {feishuLink(feishu)&&<button onClick={()=>void open(feishuLink(feishu))}>{tr("飞书台账 ↗")}</button>}
    </div></div>
    {records.map(r=><article className={`pub-record ${recordMatches(r,f.q,f.platform,f.status)?"":"is-outside-filter"} ${readingRecord?.id===r.id?"is-reading":""}`} key={r.id}>
      <button className="pub-record-select" aria-pressed={readingRecord?.id===r.id} aria-label={tr("查看{{platform}}作品：{{title}}", {platform: r.platform, title: r.title})} onClick={()=>readRecord(r)}>
        <span><strong>{r.platform}</strong><small>{[r.account,r.language,r.version].filter(Boolean).join(" · ")||tr("账号未标注")}</small></span>
        <span className={`pub-tag ${r.status==="已发布"?"is-ok":matchesStatus(r,"action")?"is-attention":""}`}>{r.status}</span>
      </button>
      {!recordMatches(r,f.q,f.platform,f.status)&&<p className="pub-muted">{tr("同篇文章的其他平台记录")}</p>}
      {r.issue&&<p className="pub-record-note pub-attention">{r.issue}</p>}{r.next&&<p className="pub-record-note">{tr("下一步：{{next}}", {next: r.next})}</p>}
      <div className="pub-actions">
        {safePageViewUrl(r.url)?<><button className={readingRecord?.id===r.id?"pub-primary":""} onClick={()=>readRecord(r)}><Icon name="globe" size={13}/>{readingRecord?.id===r.id?tr("正在右侧查看"):tr("查看作品")}</button><button aria-label={tr("复制{{platform}}作品链接", {platform: r.platform})} title={tr("复制作品链接")} onClick={()=>void copy(r.url)}><Icon name="copy" size={13}/></button></>:<span className="pub-muted">{r.url?tr("作品链接格式无效"):tr("暂无作品链接")}</span>}
        {r.managerUrl&&<button onClick={()=>void open(r.managerUrl!)}>{tr("平台后台 ↗")}</button>}
        {feishuLink(feishu,r.id)&&<button onClick={()=>void open(feishuLink(feishu,r.id))}>{tr("飞书记录 ↗")}</button>}
      </div>
      <details><summary>{tr("发布与核验详情{{value}}", {value: r.publishedAt?` · ${dateText(r.publishedAt)}`:""})}</summary>
        <dl><div><dt>{tr("发布时间")}</dt><dd>{r.publishedAt?dateText(r.publishedAt):tr("未记录")}</dd></div><div><dt>{tr("最近核查")}</dt><dd>{r.checkedAt?dateText(r.checkedAt):tr("未记录")}</dd></div>{r.linkAttributes&&<div className="pub-wide"><dt>{tr("链接属性")}</dt><dd>{r.linkAttributes}</dd></div>}{r.indexStatus&&<div><dt>{tr("台账收录状态")}</dt><dd>{r.indexStatus}</dd></div>}</dl>
        {r.url&&<p className="pub-url">{r.url}</p>}{r.evidence&&<p>{r.evidence}</p>}{r.linkType&&<p>{tr("外链方式：{{linkType}}", {linkType: r.linkType})}</p>}{r.blueLink&&<p>{tr("蓝链结果：{{blueLink}}", {blueLink: r.blueLink})}</p>}{r.domainResult&&<p>{tr("域名结果：{{domainResult}}", {domainResult: r.domainResult})}</p>}{r.evidenceUrl&&<button onClick={()=>void open(r.evidenceUrl!)}>{tr("查看核验依据 ↗")}</button>}
      </details>
    </article>)}
  </div>;
  const websiteDetails=site&&<div className="pub-inline-detail" aria-label={tr("官网内容详情")}>
    <div className="pub-actions"><button onClick={()=>void copy(site.url)}><Icon name="copy" size={13}/>{tr("复制链接")}</button>{draft&&<button onClick={()=>onOpenDraft(draft.id)}><Icon name="file" size={13}/>{tr("打开母稿")}</button>}</div>
    <p className="pub-site-summary">{site.summary||tr("该条目暂无摘要，可在右侧查看官网正文。")}</p>
    <details className="pub-site-status"><summary>{tr("公开展示与来源")}</summary><dl><div><dt>{tr("官网展示")}</dt><dd><span className="pub-tag is-ok">{tr("已公开")}</span></dd></div><div><dt>{tr("独立详情页")}</dt><dd>{site.detailPage?tr("已生成"):tr("通过日历查看")}</dd></div><div><dt>{tr("搜索引擎收录")}</dt><dd>{tr("未在此核验")}</dd></div><div><dt>{tr("详情页内容更新")}</dt><dd>{site.lastmod?dateText(site.lastmod):tr("暂无独立详情页记录")}</dd></div></dl><p className="pub-url">{site.url}</p>
    {site.sourceUrls.length>0&&<section className="pub-sources"><h3>{tr("原始来源")}</h3>{site.sourceUrls.map((x,i)=><button key={i} onClick={()=>void open(x.url)}>{x.label} ↗<span>{x.url}</span></button>)}</section>}</details>
  </div>;
  return <div className="publication-center" data-publication-section={tab}>
    <aside className="pub-sidebar">
      <div className="pub-drag" data-tauri-drag-region/>
      {sidebarHeader}
      <div className="pub-filter-scroll">
        {tab==="platforms"?<>
          <p className="pub-label">{tr("发布状态")}</p>
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map(key=><button className="pub-filter" key={key} aria-pressed={f.status===key} onClick={()=>update({status:key,selected:""})}><span>{tr(STATUS_LABELS[key])}</span><small>{groupRecords(feishu.records.filter(r=>recordMatches(r,f.q,f.platform,key))).length}</small></button>)}
          <p className="pub-label pub-label-spaced">{tr("发布平台")}</p>
          <button className="pub-filter" aria-pressed={!f.platform} onClick={()=>update({platform:"",selected:""})}><span>{tr("全部平台")}</span><small>{groupRecords(feishu.records.filter(r=>recordMatches(r,f.q,"",f.status))).length}</small></button>
          {platforms.map(platform=><button className="pub-filter" key={platform} aria-pressed={f.platform===platform} onClick={()=>update({platform,selected:""})}><span>{platform}</span><small>{groupRecords(feishu.records.filter(r=>recordMatches(r,f.q,platform,f.status))).length}</small></button>)}
        </>:<>
          <p className="pub-label">{tr("官网栏目")}</p>
          <button className="pub-filter" aria-pressed={!f.kind} onClick={()=>update({kind:"",selected:""})}><span>{tr("全部内容")}</span><small>{website.items.filter(x=>[x.title,x.summary,x.category].join(" ").toLowerCase().includes(f.q.trim().toLowerCase())).length}</small></button>
          {(Object.keys(ARCHIVE_LABELS) as ArchiveKind[]).map(kind=><button className="pub-filter" key={kind} aria-pressed={f.kind===kind} onClick={()=>update({kind,selected:""})}><span>{ARCHIVE_LABELS[kind]}</span><small>{website.items.filter(x=>archiveKind(x)===kind&&[x.title,x.summary,x.category].join(" ").toLowerCase().includes(f.q.trim().toLowerCase())).length}</small></button>)}
          <div className="pub-side-note">{tr("来源：官网数据库的已发布记录。")}<br/>{tr("点选读取正文，刷新更新目录。")}</div>
        </>}
      </div>
      <footer><span className={`pub-cache-dot ${updated?"is-ready":""}`}/>{updated?tr("已保存到本机"):tr("尚无本机快照")}<span>{tr("手动刷新")}</span></footer>
    </aside>
    <section className="pub-content" aria-label={tab==="platforms"?tr("平台发布"):tr("官网内容")}>
      <header className="pub-toolbar" data-tauri-drag-region="deep">
        <div><h1>{tab==="platforms"?tr("平台发布"):tr("官网内容")}</h1><p>{tab==="platforms"?tr("{{allGroups}} 篇文章 · {{records}} 条平台记录", {allGroups: allGroups.length, records: feishu.records.length}):tr("{{items}} 条公开内容 · {{length}} 个独立详情页", {items: website.items.length, length: website.items.filter(x=>x.detailPage).length})}</p></div>
        <div className="pub-refresh"><span title={updated||undefined}>{updated?tr("上次读取 {{dateText}}", {dateText: dateText(updated)}):tr("点击刷新读取数据")}</span><button disabled={!!busy||!loaded} onClick={()=>void refresh()}><Icon name="refresh" size={14}/>{busy===tab?tr("正在读取…"):tr("刷新")}</button></div>
      </header>
      {errors[tab]&&<div className="pub-message pub-error" role="alert">{errors[tab]}{updated&&tr(" · 当前仍显示上次缓存")}</div>}
      {tab==="platforms"&&feishu.warning&&<div className="pub-message">{trNative(feishu.warning)}</div>}
      {notice&&<div className="pub-message" role="status">{notice}</div>}
      <div className="pub-columns" ref={split.hostRef} style={split.style}>
        <section className="pub-list" aria-label={tr("内容列表")}>
          <label className="pub-search"><Icon name="search" size={15}/><input aria-label={tr("搜索发布内容")} placeholder={tab==="platforms"?tr("搜索文章、账号或平台"):tr("搜索官网标题、摘要")} value={f.q} onChange={e=>update({q:e.target.value,selected:""})}/></label>
          <div className="pub-list-caption"><span>{tab==="platforms"?tr("{{total}} 篇匹配文章", {total}):tr("{{total}} 条匹配内容", {total})}</span>{(f.q||f.platform||f.kind||f.status!=="all")&&<button onClick={()=>update({...INITIAL})}>{tr("清除筛选")}</button>}</div>
          <div className="pub-list-scroll">
            {tab==="platforms"?groups.slice(0,limit).map(g=><article className="pub-article" key={g.key}>
              <button className="pub-list-item" aria-expanded={selected?.key===g.key&&collapsed!==tab+":"+g.key} aria-current={selected?.key===g.key?"true":undefined} onClick={()=>selectItem(g.key)}>
                <span className="pub-item-meta"><span>{tr("{{records}} 条匹配记录", {records: g.records.length})}</span><time>{g.latest?dateText(g.latest):""}</time></span>
                <strong>{g.title}</strong><span className="pub-item-platforms">{[...new Set(g.records.map(r=>r.platform))].join(" · ")}</span>
                <span className="pub-item-states">{g.records.some(r=>matchesStatus(r,"published"))&&<span className="pub-tag is-ok">{tr("已发布 {{length}}", {length: g.records.filter(r=>matchesStatus(r,"published")).length})}</span>}{g.records.some(r=>matchesStatus(r,"review"))&&<span className="pub-tag">{tr("待审核 {{length}}", {length: g.records.filter(r=>matchesStatus(r,"review")).length})}</span>}{g.records.some(r=>matchesStatus(r,"action"))&&<span className="pub-tag is-attention">{tr("需处理 {{length}}", {length: g.records.filter(r=>matchesStatus(r,"action")).length})}</span>}</span>
              </button>{selected?.key===g.key&&collapsed!==tab+":"+g.key&&platformDetails}
            </article>):siteItems.slice(0,limit).map(x=><article className="pub-article" key={x.key}>
              <button className="pub-list-item" aria-expanded={site?.key===x.key&&collapsed!==tab+":"+x.key} aria-current={site?.key===x.key?"true":undefined} onClick={()=>selectItem(x.key)}>
                <span className="pub-item-meta">{ARCHIVE_LABELS[archiveKind(x)]}<span>{x.detailPage?tr("独立详情页"):tr("日历展示")}</span></span><strong>{x.title}</strong><span className="pub-item-platforms">{x.dateLabel}</span>
              </button>{site?.key===x.key&&collapsed!==tab+":"+x.key&&websiteDetails}
            </article>)}
            {!total&&<div className="pub-empty"><Icon name={tab==="platforms"?"send":"globe"} size={26}/><h3>{!loaded?tr("正在读取本机快照…"):updated?tr("没有匹配内容"):tr("先读取一份快照")}</h3><p>{updated?tr("调整左侧分类或搜索词。"):tab==="platforms"?(feishu.configured?tr("点击右上角刷新，读取已绑定的飞书发布台账。"):tr("本机还未绑定飞书发布台账，请按项目维护文档完成配置。")):tr("点击右上角刷新，查看网站当前公开内容。")}</p></div>}
            {total>limit&&<button className="pub-load-more" onClick={()=>setLimit(n=>n+80)}>{tr("继续显示（还有 {{value}} 条）", {value: total-limit})}</button>}
          </div>
        </section>
        <div className="pub-resize-track">{active&&split.available>0&&<ResizeHandle visible width={split.width} side="right" min={Math.round(split.min)} max={split.max} scale={split.scale} onResize={split.resize} onDragChange={split.setDragging} onReset={split.reset} label={tr("调整发布列表与阅读区宽度")}/>}</div>
        {tab==='website'?<WebsiteRecordPreview id={site?.articleId} revision={site?.revision} active={active} obscured={split.dragging} url={targetUrl} title={targetTitle} onEdit={onOpenDraft}/>:<PublicationReader key={tab+":"+`${fullGroup?.key}:${readingRecord?.id}`} active={active} obscured={split.dragging} url={targetUrl} title={targetTitle} emptyMessage={readingRecord?tr("{{platform}}暂无可查看的作品链接，可在中间栏选择其他平台。", {platform: readingRecord.platform}):tr("从中间栏选择文章，查看目标平台页面。")}/>}
      </div>
    </section>
  </div>;
}

onActiveSiteChange(()=>{ARCHIVE_LABELS=buildArchiveLabels();CATEGORY_KIND=buildCategoryKind();});
