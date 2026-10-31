// Isolated synthetic fixture: no real platform requests, publications or DB writes.
import {useState,useSyncExternalStore} from "react";
import {createRoot} from "react-dom/client";
import {createPortal} from "react-dom";
import type {Workspace} from "../src/components/WorkspaceSwitcher";
import {EMPTY,type Snapshot,type Publication} from "../src/publications/model";
import type {WebsiteDraftDetail,WebsitePublishingSnapshot} from "../src/publications/websitePublishing";
import "@fontsource-variable/inter-tight";
import "../src/styles.css";
import "../src/workspace.css";
const storage=new Map<string,string>([["language","zh"],["mode","dark"]]);
Object.defineProperty(window,"localStorage",{configurable:true,value:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,String(value)),removeItem:(key:string)=>storage.delete(key),clear:()=>storage.clear(),key:(index:number)=>[...storage.keys()][index]??null,get length(){return storage.size;}}});
const date="2026-10-02T11:00:00+08:00";
const imageUrl=new URL("./publication-preview.svg",location.href).href;
const record=(id:string,platform:string,status:string):Publication=>({id,sourceId:"sample-research",taskId:id,title:"从开放数据到科研工具：本周值得关注的学术进展与平台观察",platform,status,url:status==="已发布"?`https://example.invalid/article/${id}`:"",account:"学术观察",language:"中文",version:"1",publishedAt:status==="已发布"?date:"",modifiedAt:date,checkedAt:date,evidence:"已查看作品页。示例数据，不代表实际发布。",issue:status==="失败"?"平台暂未接受提交，请检查任务日志。":"",linkAttributes:"正文含来源链接；搜索引擎收录未核验。"});
const data:Snapshot={...EMPTY,drafts:[{id:"sample-research",title:"学术观察"}],feishu:{configured:true,updatedAt:date,records:[record("a","今日头条","已发布"),record("b","知乎","已发布"),record("c","LOFTER","已提交待审核"),record("d","掘金","失败"),{...record("e","博客园","已发布"),sourceId:"sample-2",title:"研究工具开源观察：知识组织与文献处理的新进展"}]},website:{updatedAt:date,contentUpdatedAt:date,items:[{key:"news:sample",kind:"news",title:"本周学术情报：研究、数据与开放工具",summary:"从公开来源整理研究线索，保留事实与判断的边界。\n\n每一条信息都保留原始来源，方便进一步阅读。",category:"学术情报",dateLabel:"2026-10-02",detailPage:true,url:"https://example.invalid/news",lastmod:date,sourceUrls:[],articleId:"sample-research"},{key:"year:sample",kind:"year",title:"科研项目年度申报通知",summary:"示例日历事项。",category:"项目申报",dateLabel:"2026-10-01 — 2026-10-31",detailPage:false,url:"https://example.invalid/calendar",lastmod:null,sourceUrls:[]}]}};
type Page={requestId:string;instance:number;initialUrl:string;url:string;visible:boolean;loading:boolean;history:string[];index:number};
let sequence=0,revision=0,captureDelay=120;
const draftMeta={date:'2026-10-02',author:'Scholay 编辑部',category:'新闻聚合',summary:'从公开来源整理开放数据、研究工具与机构动态，保留事实依据和来源链接。'};
let localDraft:WebsiteDraftDetail={id:'sample-research',title:'本周学术情报：研究、数据与开放工具',canonicalPath:'articles/annex/新闻聚合/02_科研进展与平台观察/正文.md',sourceSha256:'fixture-source',metadata:draftMeta,metadataSha256:'fixture-meta',stage:'local',stale:false,validation:'',receipt:null,prepared:null,warnings:[],html:`<h1>本周学术情报：研究、数据与开放工具</h1><p>这是一篇隔离验收稿件。正文、图片和发布队列均为合成数据。</p><img src="${imageUrl}" alt="本地文章图片"><h2>从信息整理到公开展示</h2><p>本地桌面端完成选择、预览与确认。服务器接收固定版本，排队生成网页后返回回执。</p><p>每条报道保留来源与核验范围，便于持续修订。</p>`};
let mockJobReads=0;
const pushSnapshot=():WebsitePublishingSnapshot=>({connection:{configured:true,origin:'https://example.invalid'},articles:[{id:localDraft.id,shortTitle:localDraft.title,canonicalPath:localDraft.canonicalPath,batchDate:null,stage:localDraft.stage,receipt:localDraft.receipt,preparedAt:localDraft.prepared?.preparedAt||null}]});
const callbacks=new Map<number,(value:any)=>void>(),listeners=new Map<number,{event:string;handler:number}>(),pages=new Map<string,Page>(),subscribers=new Set<()=>void>(),calls:string[]=[],blocked:string[]=[];
const notify=()=>{revision++;for(const f of subscribers)f();};
const subscribe=(f:()=>void)=>{subscribers.add(f);return()=>{subscribers.delete(f);};};
const emit=(event:string,payload:any)=>{for(const[id,l]of listeners)if(l.event===event)callbacks.get(l.handler)?.({event,id,payload});};
const status=(p:Page)=>emit("page-view-status",{viewId:"publication-page",requestId:p.requestId,instance:p.instance,url:p.url,phase:p.loading?"loading":"loaded"});
const load=(p:Page,url:string)=>{p.url=url;p.loading=true;status(p);notify();setTimeout(()=>{if(pages.get("publication-page")===p){p.loading=false;status(p);notify();}},80);};
const source=(p:Page)=>({url:p.url,title:"开放数据与研究工具",html:`<h1>开放数据与研究工具</h1><p>这是目标平台正文的合成样例，没有访问真实平台。网页与源格式使用同一份内容。</p><figure><img src="${imageUrl}" alt="开放科学合成验收图"><figcaption>本地合成插图，用于检查图片显示。</figcaption></figure><h2>从信息到可追溯的内容</h2><p>研究线索需要保留原始来源、核查时间与适用范围。正文保留<strong>标题、强调、列表与图片</strong>。</p><ul><li>核对发布后的正文</li><li>检查图片与来源链接</li><li>保留各平台发布状态</li></ul><blockquote>仅用于界面验收，没有上传、修改或发布。</blockquote>`,text:"合成目标平台正文。仅用于界面验收，没有上传、修改或发布。",capturedAt:date,truncated:false,bodyFallback:false,hasMedia:true});
Object.defineProperty(window,"__TAURI_EVENT_PLUGIN_INTERNALS__",{configurable:true,value:{unregisterListener:(_:string,id:number)=>listeners.delete(id)}});
Object.defineProperty(window,"__TAURI_INTERNALS__",{configurable:true,value:{metadata:{currentWindow:{label:"main"},currentWebview:{label:"main"}},transformCallback:(f:(value:any)=>void)=>{const id=++sequence;callbacks.set(id,f);return id;},unregisterCallback:(id:number)=>callbacks.delete(id),invoke:async(command:string,args:any={})=>{
  calls.push(command);
  if(command==="plugin:event|listen"){const id=++sequence;listeners.set(id,{event:args.event,handler:args.handler});return id;}
  if(command==="plugin:event|unlisten"){listeners.delete(args.eventId);return;}
  if(["set_setting","refresh_tray","set_page_view_theme"].includes(command))return;
  if(command==="get_setting")return null;
  if(command==='website_publish_call'){
    if(args.method==='snapshot')return structuredClone(pushSnapshot());
    if(args.method==='prepare'){localDraft={...localDraft,stage:'prepared',metadata:{...args.params.metadata},prepared:{requestKey:'qa-request-'+(++sequence),packetSha256:'qa-packet-'+sequence,sourceSha256:'fixture-source',preparedAt:date,expectedVersion:0,title:localDraft.title,metadata:{...args.params.metadata},assetCount:1}};}
    if(args.method==='publish'){if(!args.params.confirmed)throw Error('模拟器也要求明确确认');mockJobReads=0;localDraft={...localDraft,stage:'queued',receipt:{requestKey:localDraft.prepared!.requestKey,url:'/news/sample-research/',revision:1,job:{id:'qa-job-only',status:'queued'}}};}
    if(args.method==='status'){mockJobReads++;localDraft={...localDraft,stage:mockJobReads>1?'published':'running',receipt:{...localDraft.receipt!,checkedAt:date,publicReadback:mockJobReads>1,job:{id:'qa-job-only',status:mockJobReads>1?'success':'running'}}};}
    if(['inspect','prepare','publish','status'].includes(args.method))return structuredClone(localDraft);
    throw Error('模拟器拒绝未知发布操作');
  }
  if(command==="publications_call"){
    if(args.method==="snapshot")return structuredClone(data);
    if(args.method==="refresh_feishu")throw Error("隔离测试：网络不可用，缓存保留");
    if(args.method==="refresh_website")return structuredClone(data.website);
  }
  if(command==="open_page_view"){
    if(args.viewId!=="publication-page"||!args.url.startsWith("https://example.invalid/"))throw Error("Fixture only permits simulated publication pages");
    const p:Page={requestId:args.requestId,instance:++sequence,initialUrl:args.url,url:args.url,visible:!!args.visible,loading:true,history:[args.url],index:0};pages.set(args.viewId,p);load(p,args.url);return false;
  }
  const p=pages.get("publication-page"),matching=p&&args.viewId==="publication-page"&&args.requestId===p.requestId;
  if(command==="set_page_view_bounds")return;
  if(command==="set_page_view_visible"){if(matching){p.visible=!!args.visible;status(p);notify();}return;}
  if(command==="close_page_view"){if(matching){pages.delete("publication-page");notify();}return;}
  if(command==="page_view_reload"){if(matching)load(p,p.url);return;}
  if(command==="page_view_navigate_history"){if(matching){p.index=Math.max(0,Math.min(p.history.length-1,p.index+(args.direction==="back"?-1:1)));load(p,p.history[p.index]);}return;}
  if(command==="set_page_view_zoom")return{viewId:args.viewId,requestId:args.requestId,instance:p?.instance,factor:1,mode:"fit"};
  if(command==="capture_publication_page"){
    if(!p||p.requestId!==args.requestId||p.initialUrl!==args.url||p.loading)throw Error("Simulated page not ready");
    const result=source(p);await new Promise(resolve=>setTimeout(resolve,captureDelay));if(pages.get("publication-page")!==p)throw Error("Simulated page retired");return result;
  }
  blocked.push(command);notify();throw Error("隔离验收阻止外部操作："+command);
}}});
const {default:i18n}=await import("../src/i18n");await i18n.changeLanguage("zh");
const {default:PublicationCenter}=await import("../src/publications/PublicationCenter");
const {default:WebsiteWorkspace}=await import("../src/publications/WebsiteWorkspace");
const {default:WorkspaceSwitcher}=await import("../src/components/WorkspaceSwitcher");
function MockPage(){useSyncExternalStore(subscribe,()=>revision);const p=pages.get("publication-page"),host=document.querySelector(".workspace-panel:not(.is-inactive) .website-workspace:not(.is-inactive) .pub-reader .reader-webview-host, .workspace-panel:not(.is-inactive) > .publication-center .pub-reader .reader-webview-host");if(!host||!p?.visible)return null;return createPortal(<div aria-label="模拟目标网页" style={{height:"100%",overflow:"auto",background:"var(--reader)",color:"var(--ink)"}}><div style={{padding:"9px 18px",borderBottom:"1px solid var(--hair)",color:"var(--accent)",fontSize:12}}>模拟网页 · 未访问真实目标平台</div><article style={{maxWidth:780,margin:"0 auto",padding:"28px 34px",fontSize:16,lineHeight:1.9}} dangerouslySetInnerHTML={{__html:source(p).html}}/><div style={{padding:"0 34px 32px"}}><button onClick={()=>{const url=`https://example.invalid/related/${p.instance}`;p.history=[...p.history.slice(0,p.index+1),url];p.index++;load(p,url);}}>模拟打开站内相关页面</button></div></div>,host);}
function Fixture(){const[dark,setDark]=useState(true),[narrow,setNarrow]=useState(false),[workspace,setWorkspace]=useState<Workspace>("website"),[message,setMessage]=useState("");return<>
  <style>{`.pub-reader [aria-label="模拟目标网页"] img{max-width:100%;height:auto;display:block;margin:20px auto}.pub-reader [aria-label="模拟目标网页"] h1{font-size:28px;margin:0 0 20px}.pub-reader [aria-label="模拟目标网页"] h2{font-size:22px;margin:24px 0 14px}.pub-reader [aria-label="模拟目标网页"] p{margin:0 0 18px}.pub-reader [aria-label="模拟目标网页"] figure{margin:24px 0}.pub-reader [aria-label="模拟目标网页"] figcaption{font-size:12px;color:var(--muted)}`}</style>
  <nav aria-label="隔离验收工具" style={{height:38,display:"flex",alignItems:"center",gap:12,padding:"0 16px",fontSize:12,whiteSpace:"nowrap",overflowX:"auto"}}><span>隔离验收 · 合成记录与模拟网页</span><button onClick={()=>{document.documentElement.dataset.mode=dark?"light":"dark";setDark(!dark);}}>切换明暗</button><button onClick={()=>setNarrow(!narrow)}>切换窄窗口</button><button onClick={()=>setWorkspace(workspace==="rss"?"publications":"rss")}>{workspace!=="rss"?"离开当前工作区":"回到平台发布"}</button><button onClick={()=>{captureDelay=captureDelay===120?2500:120;setMessage(`模拟读取延迟：${captureDelay}ms`);}}>切换慢速读取</button><span>{message}</span></nav>
  <div className="workspace-host" style={{height:"calc(100vh - 38px)",width:narrow?920:"100%",maxWidth:"100%",margin:"0 auto"}}><WorkspaceSwitcher workspace={workspace} captureBusy={false} onChange={setWorkspace}/><div className="workspace-panels">{(["platforms","website"] as const).map(section=>{const active=workspace===(section==="platforms"?"publications":"website");return <div key={section} className={`workspace-panel ${active?"":"is-inactive"}`} aria-hidden={!active} inert={!active}>{section==="website"?<WebsiteWorkspace active={active} onOpenDraft={id=>setMessage("打开本地稿件："+id)}/>:<PublicationCenter section={section} active={active} onOpenDraft={id=>setMessage("关联母稿："+id)}/> }</div>;})}{workspace!=="publications"&&workspace!=="website"&&<div style={{padding:60,color:"var(--muted)"}}><h2>模拟其他工作区</h2><p>目标网页已关闭，从左侧选择平台发布或官网发布继续。</p></div>}</div><MockPage/></div>
</>;}
Object.assign(window,{__PUBLICATION_FIXTURE__:{synthetic:true,status:()=>({nativeCount:pages.size,pages:[...pages].map(([viewId,p])=>({viewId,requestId:p.requestId,initialUrl:p.initialUrl,url:p.url,visible:p.visible,loading:p.loading})),blocked:[...blocked],calls:[...calls]})}});
createRoot(document.getElementById("root")!).render(<Fixture/>);
