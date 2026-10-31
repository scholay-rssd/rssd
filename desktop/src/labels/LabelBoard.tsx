import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "../lib/nativeCore";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SidebarTitle } from "../components/PaneToolbar";
import { isMac } from "../lib/platform";
import Icon from "../components/Icon";
import PlatformIcon from "../components/PlatformIcon";
import BoardResizeHandles from "../components/BoardResizeHandles";
import { useBoardPanes } from "../hooks/useBoardPanes";
import LabelCloudInsights from "./LabelCloudInsights";
import { LABEL_CLOUD_CACHE_KEY, LABEL_CLOUD_UI_KEY, LABEL_CLOUD_PLATFORMS, LABEL_CLOUD_POLL_MS, labelCloudReadError, labelCloudTime, mergeLabelCloud, parseLabelCloud, readLabelCloud, saveLabelCloud } from "./cloud";
import "../hot/hot.css";
import "./labels.css";

import { tr } from "../uiText";
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
function selectedPlatform(): string {
  try { const value = JSON.parse(read(LABEL_CLOUD_UI_KEY) ?? read("scholay.labels.ui.v1") ?? "null"); return LABEL_CLOUD_PLATFORMS.some(item => item.id === value?.sourceId) ? value.sourceId : "all"; } catch { return "all"; }
}
/** Read-only cloud cache: this surface never collects from platform pages. */
export default function LabelBoard({ active, sidebarHost, embedded = false }: { active: boolean; sidebarHost?: HTMLElement | null; embedded?: boolean }) {
  const panes = useBoardPanes("labels", false, active, embedded);
  const [cloud, setCloud] = useState(() => readLabelCloud(read(LABEL_CLOUD_CACHE_KEY)));
  const [sourceId, setSourceId] = useState(selectedPlatform);
  const [search, setSearch] = useState(""), [group, setGroup] = useState("全部");
  const [loading, setLoading] = useState(false), [offline, setOffline] = useState(!!cloud);
  const [readError, setReadError] = useState("");
  const cached = useRef(cloud); cached.current = cloud;
  const [notice, setNotice] = useState(""), [refresh, setRefresh] = useState(0);
  const owner = useRef(0);
  useEffect(() => { try { localStorage.setItem(LABEL_CLOUD_UI_KEY, JSON.stringify({ sourceId })); } catch { /* The selected platform still works. */ } }, [sourceId]);
  useEffect(() => {
    const revision = ++owner.current;
    let cancelled = false, pulling = false;
    const current = () => !cancelled && active && revision === owner.current;
    setLoading(false);
    if (!active) return () => { cancelled = true; };
    const pull = async () => {
      if (!current() || pulling) return;
      pulling = true; setLoading(true);
      try {
        const value = parseLabelCloud(await invoke<unknown>("pull_label_cloud"));
        if (!current()) return;
        if (!value) throw new Error(tr("云端标签格式错误"));
        const next = mergeLabelCloud(cached.current, value);
        cached.current = next; setCloud(next);
        if (!saveLabelCloud(next)) setNotice(tr("云端数据已读取，本机缓存暂未保存。"));
        setOffline(false); setReadError("");
      } catch (error) { if (current()) { setOffline(true); setReadError(labelCloudReadError(error)); } }
      finally { pulling = false; if (current()) setLoading(false); }
    };
    void pull();
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void pull(); }, LABEL_CLOUD_POLL_MS);
    const wake = () => { if (document.visibilityState !== "hidden") void pull(); };
    document.addEventListener("visibilitychange", wake);
    const libraryRefresh = () => void pull();
    window.addEventListener("scholay-rss-library-refresh", libraryRefresh);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", wake); window.removeEventListener("scholay-rss-library-refresh", libraryRefresh); };
  }, [active, refresh]);
  const latest = useMemo(() => (cloud?.latest ?? []).filter(item => sourceId === "all" || item.platformId === sourceId), [cloud, sourceId]);
  const kinds = useMemo(() => [...new Set(latest.flatMap(item => item.rows.map(row => row.kind)))], [latest]);
  useEffect(() => { if (group !== "全部" && !kinds.includes(group)) setGroup("全部"); }, [group, kinds]);
  const updatedAt = latest.reduce<string | null>((newest, item) => !newest || Date.parse(item.observedAt) > Date.parse(newest) ? item.observedAt : newest, null);
  const source = LABEL_CLOUD_PLATFORMS.find(item => item.id === sourceId);
  const platformState = cloud?.platforms.find(item => item.id === sourceId);
  const resetFilters = () => { setSearch(""); setGroup("全部"); setNotice(""); };
  const choose = (id: string) => { setSourceId(id); resetFilters(); };
  const copy = async (term: string) => { try { await navigator.clipboard.writeText(term); setNotice(tr("已复制标签文字")); } catch { setNotice(tr("复制未完成，请重试")); } };
  const original = async (url: string) => { try { await openUrl(url); } catch { setNotice(tr("系统浏览器未能打开来源页面")); } };
  const librarySources = <><div className="label-sidebar-heading"><Icon name="tag" size={15}/><strong>{tr("平台")}</strong></div>
    <nav className="hot-source-nav" aria-label={tr("标签平台")}><button className={sourceId === "all" ? "is-active" : ""} onClick={() => choose("all")}><Icon name="list" size={17}/><span>{tr("全部平台")}</span><small>{cloud?.latest.reduce((sum, item) => sum + item.rows.length, 0) || ""}</small></button>
      {LABEL_CLOUD_PLATFORMS.map(item => {
        const count = cloud?.latest.filter(value => value.platformId === item.id).reduce((sum, value) => sum + value.rows.length, 0) ?? 0;
        return <button key={item.id} className={item.id === sourceId ? "is-active" : ""} aria-current={item.id === sourceId ? "page" : undefined} onClick={() => choose(item.id)}><PlatformIcon platformId={item.id}/><span>{item.name}</span><small>{count || tr("尚未更新")}</small></button>;
      })}
    </nav></>;
  return <section ref={panes.hostRef} style={panes.style} className={`hot-workspace label-workspace ${embedded ? "is-rss-library" : ""}`} aria-label={tr("流量标签")}>
    {embedded ? active && sidebarHost && createPortal(<div className="rss-library-sources" aria-label={tr("流量标签来源")}>{librarySources}</div>, sidebarHost) : <aside className="hot-sidebar" aria-label={tr("流量标签来源")}>{isMac && <div className="titlebar" data-tauri-drag-region/>}<SidebarTitle>{tr("流量标签")}</SidebarTitle>{librarySources}</aside>}
    <section className="hot-detail label-detail" aria-label={tr("平台标签")}>
      <header className="label-content-tools" aria-label={tr("流量标签内容操作")}><div className="hot-breadcrumb"><strong>{source?.name ?? tr("全部平台")}</strong></div><span className={`label-auth-state ${offline ? "is-offline" : ""}`} role="status">{loading ? tr("更新中…") : offline ? tr("暂未更新") : updatedAt ? <time dateTime={updatedAt}>{tr("更新于 {{replace}}", {replace: labelCloudTime(updatedAt).replace(/:\d{2}$/, "")})}</time> : tr("尚未更新")}</span><button className="hot-icon-button" disabled={!active || loading} onClick={() => setRefresh(value => value + 1)} aria-label={tr("刷新标签")} title={tr("刷新标签")}><Icon name="refresh" size={14}/></button></header>
      <div className="label-cloud-filters"><label className="hot-search"><Icon name="search" size={14}/><input aria-label={tr("搜索标签")} placeholder={tr("搜索标签")} value={search} onChange={event => setSearch(event.target.value)}/></label>{kinds.length > 1 && <div className="hot-filters" aria-label={tr("标签类型")}><button className={group === "全部" ? "is-active" : ""} aria-pressed={group === "全部"} onClick={() => setGroup("全部")}>{tr("全部")}</button>{kinds.map(kind => <button key={kind} className={group === kind ? "is-active" : ""} aria-pressed={group === kind} onClick={() => setGroup(kind)}>{kind}</button>)}</div>}</div>
      <div className="label-native-detail">{readError && <p className="label-history-error" role="alert">{readError}</p>}{notice && <p className="label-notice" role="status">{notice}</p>}{!readError && source && platformState?.status === "error" && <p className="label-history-error" role="alert">{tr(latest.length ? "本次更新未完成，仍显示上次的标签。" : "本次更新未完成，请稍后再试。")}</p>}<LabelCloudInsights snapshots={latest} scope={sourceId} search={search} group={group} loading={loading} onCopy={term => void copy(term)} onOriginal={url => void original(url)}/></div>
    </section>
    {active && <BoardResizeHandles panes={panes} hasList={false} label={tr("标签")}/>}
  </section>;
}
