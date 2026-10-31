import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { invoke } from "../lib/nativeCore";
import { openUrl } from "@tauri-apps/plugin-opener";
import Icon from "../components/Icon";
import HotPageView from "../hot/HotPageView";
import type { HotPageViewState } from "../hot/hotPageViewState";
import { safePageViewUrl } from "../lib/pageViewState";
import { publicationSourceHtml, type PublicationSource } from "./publicationSource";
import "./publication-reader.css";

import { tr } from "../uiText";
import { useHtmlMarkup } from "../lib/htmlMarkup";
export interface PublicationReaderProps {
  active: boolean;
  initialView?: {url?:string;mode?:"web"|"source";scrollTop?:number};
  onViewChange?: (view:{url?:string;mode?:"web"|"source";scrollTop?:number})=>void;
  viewId?: string;
  obscured?: boolean;
  url?: string | null;
  title?: string;
  emptyMessage?: string;
}

const VIEW_ID = "publication-page";

/** Each selected link owns a fresh session. A late capture from a previous
 * record cannot populate the newly selected record's pane. */
export default function PublicationReader({ url, ...props }: PublicationReaderProps) {
  const safeUrl = safePageViewUrl(url);
  return <PublicationReaderSession key={safeUrl ?? "empty"} {...props} url={safeUrl}/>;
}

function PublicationReaderSession({ initialView,onViewChange,viewId = VIEW_ID, active, obscured = false, url, title, emptyMessage }: PublicationReaderProps) {
  const [sessionUrl, setSessionUrl] = useState(safePageViewUrl(initialView?.url)||url);
  const [mode, setMode] = useState<"web" | "source">("web");
  const [page, setPage] = useState<HotPageViewState | null>(null);
  const [source, setSource] = useState<PublicationSource | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lifecycle = useRef(0);
  const viewCallback=useRef(onViewChange),restoreSource=useRef(initialView?.mode==="source");viewCallback.current=onViewChange;
  const sourceScroller=useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!active) { lifecycle.current++; setPending(false); }
    return () => { lifecycle.current++; };
  }, [active]);
  const onPageState = useCallback((state: HotPageViewState | null) => {setPage(state);if(state?.currentUrl)viewCallback.current?.({url:state.currentUrl});}, []);
  const html = useMemo(() => source ? publicationSourceHtml(source) : "", [source]);
  const htmlMarkup = useHtmlMarkup(html);
  const ready = Boolean(active && sessionUrl && page?.originalUrl === sessionUrl && page?.created && !page.loading && !page.error);
  const externalUrl = safePageViewUrl(mode === "source" ? source?.url : page?.currentUrl) ?? safePageViewUrl(url);

  const showWeb = () => {
    lifecycle.current++;
    setPending(false);
    setError("");
    if (mode === "source" && source) {
      // Returning from source keeps the actual page the user was reading,
      // including a platform redirect or an in-page navigation.
      setSessionUrl(source.url);
      setPage(null);
    }
    setMode("web");viewCallback.current?.({mode:"web"});
  };
  const showSource = async () => {
    if (!ready || !page || !sessionUrl || pending || mode === "source") return;
    const generation = ++lifecycle.current;
    setPending(true);
    setError("");
    try {
      // Native capture is bound to this isolated page ID, URL and navigation epoch.
      const captured = await invoke<PublicationSource>("capture_publication_page", { requestId: page.requestId, url: sessionUrl, viewId });
      if (lifecycle.current !== generation || !activeRef.current) return;
      if (!safePageViewUrl(captured.url)) throw new Error("Invalid source URL");
      setSource(captured);
      setMode("source");viewCallback.current?.({mode:"source",url:captured.url});
    } catch {
      if (lifecycle.current === generation && activeRef.current) setError(tr("暂时无法读取该页面正文。可在网页中完成加载或验证后重试。"));
    } finally {
      if (lifecycle.current === generation) setPending(false);
    }
  };
  useEffect(()=>{if(restoreSource.current&&ready){restoreSource.current=false;void showSource();}},[ready]);
  useEffect(()=>{if(mode==="source"&&sourceScroller.current)sourceScroller.current.scrollTop=initialView?.scrollTop||0;},[mode]);
  const open = (value: string | null) => {
    const safe = safePageViewUrl(value);
    if (activeRef.current && safe) void openUrl(safe).catch(() => setError(tr("系统浏览器未能打开此链接。")));
  };
  const sourceLink = (event: MouseEvent<HTMLElement>) => {
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!anchor) return;
    event.preventDefault();
    open(anchor.getAttribute("href"));
  };

  return <section className="pub-reader" aria-label={tr("目标平台内容")}>
    <header className="pub-reader-header" data-tauri-drag-region="deep">
      <span className="pub-reader-heading" title={(title || tr("目标平台内容")) + (url ? tr("\n原始作品链接：{{url}}", {url}) : "")}>{title || tr("目标平台内容")}</span>
      <div className="pub-reader-modes" role="tablist" aria-label={tr("目标内容展示方式")}>
        <button type="button" role="tab" aria-selected={mode === "web"} onClick={showWeb} disabled={!active || !url}><Icon name="globe" size={14}/>{tr("网页")}</button>
        <button type="button" role="tab" aria-selected={mode === "source"} onClick={() => void showSource()} disabled={!active || !url || pending || (mode !== "source" && !ready)} title={ready || mode === "source" ? tr("阅读目标网页的正文与图片") : tr("等待目标网页加载完成")}><Icon name="text" size={14}/>{pending ? tr("读取中…") : tr("源格式")}</button>
      </div>
    </header>
    {!url ? <div className="pub-reader-empty"><Icon name="globe" size={28}/><h3>{tr("目标平台内容")}</h3><p>{emptyMessage || tr("选择一条作品链接，在这里查看目标平台的页面。")}</p></div> : <>
      {error && <div className="pub-reader-notice" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")} aria-label={tr("关闭提示")}><Icon name="x" size={14}/></button></div>}
      {mode === "web" ? <HotPageView viewId={viewId} url={sessionUrl || url} active={active} obscured={obscured} onStateChange={onPageState}/> : source && <>
        <div className="pub-source-bar"><span aria-label={tr("当前页面地址")} title={source.url}>{source.url}</span><button type="button" disabled={!active} onClick={() => open(externalUrl)} title={tr("在系统浏览器打开")} aria-label={tr("在系统浏览器打开目标链接")}><Icon name="open" size={14}/></button></div>
        {(source.bodyFallback || source.truncated) && <div className="pub-reader-notice" role="status">{source.truncated ? tr("内容较长，此处显示已读取的部分；完整内容请切回网页查看。") : tr("此站未单独标明正文，页面中可能仍包含少量辅助内容。")}</div>}
        <div className="pub-source-scroll" ref={sourceScroller} onScroll={e=>viewCallback.current?.({scrollTop:e.currentTarget.scrollTop})}><article className="pub-source-article" aria-label={tr("目标网页正文")} onClick={sourceLink} dangerouslySetInnerHTML={htmlMarkup}/></div>
      </>}
    </>}
  </section>;
}
