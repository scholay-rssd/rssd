import PaneToolbar from "./PaneToolbar";
import WorkspaceHomeTab from "./WorkspaceHomeTab";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "../lib/nativeCore";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useReaderTabs } from "../lib/readerTabs";
import { useFormatJobs } from "../lib/formatJobs";
import { useUi } from "../store";
import { hasBlockingOverlay, useBlockingOverlay } from "../lib/useBlockingOverlay";
import { activateReadingTab, activeReadingId, closeReadingTabs, cycleReadingTabs, READING_GROUP_LABELS, reopenReadingTab, tabCloseTargets, useReadingGroups, type GroupedTab, type ReadingGroup } from "../lib/readingGroups";
import * as api from "../api";
import FeedAvatar from "./FeedAvatar";
import Icon from "./Icon";
import ContextMenu, { type MenuEntry } from "./ContextMenu";
import "./reader-tabs.css";
import { isMac } from "../lib/platform";

import { tr } from "../uiText";
/** A single presentation / interaction implementation, placed in each board's
 * reading column. Only the visible board installs the native/DOM shortcuts. */
export default function WorkspaceReadingTabs({ group, active, home }: { group: ReadingGroup; active: boolean; home?: {label:string;active:boolean;onSelect:()=>void;panelId?:string} }) {
  const { t } = useTranslation();
  const rss = useReaderTabs(s => s.tabs);
  const rssId = useReaderTabs(s => s.activeId);
  const capture = useReaderTabs(s => s.captureTabId);
  const extra = useReadingGroups(s => s.tabs);
  const ids = useReadingGroups(s => s.active);
  const loading = useReadingGroups(s => s.loading);
  const jobs = useFormatJobs(s => s.jobs);
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: api.listFeeds, enabled: active && group === "rss" && rss.length > 0 });
  const modal = useUi(s => s.modalOpen);
  const menu = useUi(s => s.menuOpen);
  const ai = useUi(s => s.aiOpen);
  const overlay = useBlockingOverlay();
  const strip = useRef<HTMLDivElement>(null);
  const homeRef = useRef(home);
  homeRef.current = home;
  const [context, setContext] = useState<{ x: number; y: number; id?: string } | null>(null);
  const tabs: GroupedTab[] = group === "rss" ? rss.map(tab => ({ ...tab, group: "rss" })) : extra.filter(tab => tab.group === group);
  const selectedId = group === "rss" ? rssId : ids[group];
  const tabElementId = (id: string) => `reading-tab-${group}-${id}`;
  useEffect(() => {
    if (!active) { setContext(null); return; }
    const revealCurrent = () => {
      const current = strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement;
      current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };
    revealCurrent();
    if (!strip.current || typeof ResizeObserver === "undefined") return;
    const resize = new ResizeObserver(revealCurrent);
    resize.observe(strip.current);
    return () => resize.disconnect();
  }, [active, selectedId, tabs.length]);
  useEffect(() => {
    if (!active) return;
    const enabled = !modal && !menu && !ai && !overlay && !capture;
    void invoke("set_reader_shortcuts", { enabled }).catch(() => {});
    const run = (action: string) => {
      const ui = useUi.getState();
      if (!enabled || ui.modalOpen || ui.menuOpen || ui.aiOpen || hasBlockingOverlay() || useReaderTabs.getState().captureTabId) return;
      if (action === "close" && !homeRef.current?.active) { const id = activeReadingId(group); if (id) closeReadingTabs([id]); }
      if (action === "reopen") reopenReadingTab(group);
      if (action === "next" || action === "previous") {
        const fixed = homeRef.current;
        if (!fixed) { cycleReadingTabs(group, action === "next" ? 1 : -1); return; }
        const pages = group === "rss" ? useReaderTabs.getState().tabs : useReadingGroups.getState().tabs.filter(tab => tab.group === group);
        const index = fixed.active ? 0 : pages.findIndex(tab => tab.id === activeReadingId(group)) + 1;
        const next = (index + (action === "next" ? 1 : -1) + pages.length + 1) % (pages.length + 1);
        if (!next) fixed.onSelect(); else activateReadingTab(pages[next - 1].id);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (!enabled || event.defaultPrevented || event.isComposing || event.altKey || hasBlockingOverlay()) return;
      const mod = event.ctrlKey || event.metaKey;
      const action = mod && !event.shiftKey && event.key.toLowerCase() === "w" ? "close"
        : mod && event.shiftKey && event.key.toLowerCase() === "t" ? "reopen"
        : event.ctrlKey && event.key === "Tab" ? event.shiftKey ? "previous" : "next" : null;
      if (action) { event.preventDefault(); event.stopPropagation(); run(action); }
    };
    const pending = listen<string>("reader-tab-shortcut", event => run(event.payload));
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      void pending.then(stop => stop()).catch(() => {});
      void invoke("set_reader_shortcuts", { enabled: false }).catch(() => {});
    };
  }, [active, group, modal, menu, ai, overlay, capture]);

  const activateWithFocus = (id: string) => {
    if (id === "home" && home) {
      home.onSelect();
      requestAnimationFrame(() => document.getElementById(`reading-home-${group}`)?.focus());
      return;
    }
    const target = tabs.find(tab => tab.id === id);
    if (!target) return;
    activateReadingTab(id);
    requestAnimationFrame(() => document.getElementById(tabElementId(id))?.focus());
  };
  const onTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const ids = [...(home ? ["home"] : []), ...tabs.map(tab => tab.id)];
    const index = ids.indexOf(id);
    const next = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length;
    activateWithFocus(ids[next]);
  };
  const contextItems = (): MenuEntry[] => {
    if (context?.id) return [
      { label: t("readerTabs.close"), onClick: () => closeReadingTabs(tabCloseTargets(context.id!, "close")) },
      { label: t("readerTabs.closeOthers"), onClick: () => closeReadingTabs(tabCloseTargets(context.id!, "others")) },
      { label: t("readerTabs.closeRight"), onClick: () => closeReadingTabs(tabCloseTargets(context.id!, "right")) },
      { separator: true },
      { label: t("readerTabs.closeAll"), onClick: () => closeReadingTabs(tabCloseTargets(context.id!, "all")) },
    ];
    return [...(home ? [{label:`${home.active ? "✓ " : ""}${home.label}`,onClick:home.onSelect}] : []), ...tabs.map(tab => ({ label: `${tab.id === selectedId && !home?.active ? "✓ " : ""}${tab.title || t("common.loading")}`, onClick: () => activateReadingTab(tab.id) }))];
  };
  return <>
    <PaneToolbar active={active} placement="tabs"><div className="reader-tabbar workspace-reader-tabbar" {...(isMac && { "data-tauri-drag-region": "deep" })} aria-label={tr("{{READING_GROUP_LABELS}}阅读标签", {READING_GROUP_LABELS: tr(READING_GROUP_LABELS[group])})} role="tablist">
      {home && <WorkspaceHomeTab {...home} id={`reading-home-${group}`} onKeyDown={event => onTabKey(event,"home")}/>}
      <div className="reader-tabs" ref={strip}>
        {tabs.map(tab => {
              const feed = tab.group === "rss" ? feeds.data?.find(item => item.id === tab.feedId) : undefined;
              const busy = loading[tab.id] || tab.group === "rss" && ["opening", "capturing", "formatting"].includes(jobs[tab.articleId]?.phase);
              return <div key={tab.id} className={`reader-tab${tab.id === selectedId && !home?.active ? " is-active" : ""}`}
                onAuxClick={event => { if (event.button === 1) { event.preventDefault(); closeReadingTabs([tab.id]); } }}
                onContextMenu={event => { event.preventDefault(); if (!capture) setContext({ x: event.clientX, y: event.clientY, id: tab.id }); }}>
                <button type="button" role="tab" id={tabElementId(tab.id)} aria-selected={tab.id === selectedId && !home?.active} aria-controls={`reading-panel-${group}`} tabIndex={!home?.active && (tab.id === selectedId || (!selectedId && tab.id === tabs[0]?.id)) ? 0 : -1} disabled={!!capture} title={tab.title} onClick={() => activateReadingTab(tab.id)}
                  onKeyDown={event => onTabKey(event,tab.id)}>
                  {busy ? <span className="reader-web-spinner" aria-label={t("common.loading")}/> : tab.group === "rss" ? <FeedAvatar title={feed?.title ?? tab.title} faviconUrl={feed?.faviconUrl} seed={tab.feedId ?? tab.articleId} style={{ width: 17, height: 17, fontSize: 10 }}/>
                    : <Icon name={tab.group === "files" ? "file" : "globe"} size={15}/>}
                  <span>{tab.title || t("common.loading")}</span>
                </button>
                <button type="button" className="reader-tab-close" disabled={capture === tab.id} aria-label={`${t("readerTabs.close")} ${tab.title}`} title={t("readerTabs.close")} onClick={() => closeReadingTabs([tab.id])}><Icon name="x" size={12}/></button>
              </div>;
        })}
      </div>
      <button type="button" className="reader-tabs-overflow" disabled={!!capture || (!tabs.length && !home)} aria-label={t("readerTabs.allTabs")} title={t("readerTabs.allTabs")} aria-haspopup="menu" onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setContext({ x: rect.right - 260, y: rect.bottom }); }}><Icon name="list" size={15}/></button>
    </div></PaneToolbar>
    {context && active && <ContextMenu x={context.x} y={context.y} items={contextItems()} onClose={() => setContext(null)}/>}
  </>;
}
