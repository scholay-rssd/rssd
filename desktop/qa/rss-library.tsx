// Synthetic fixture. All native calls are intercepted; unknown requests fail.
// No production RSS, credentials, remote pages, files, subscriptions or writes.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LABEL_SOURCES, LABEL_UI_KEY } from "../src/labels/helpers";
import {providers} from '../src/connections/client';
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/newsreader";
import "../src/styles.css";
import "../src/workspace.css";
const qs = new URLSearchParams(location.search);
localStorage.setItem("palette", "paper"); localStorage.setItem("mode", qs.get("theme") === "light" ? "light" : "dark");
localStorage.setItem("language", "zh"); localStorage.setItem("pref.startupView", "starred");
if (qs.get("restore") !== "1") {
  localStorage.setItem("papr.workspace.v2", qs.get("legacy") || "rss");
  if (qs.has("legacy")) localStorage.removeItem("scholay.rss.library.v1");
  else localStorage.setItem("scholay.rss.library.v1", qs.get("section") || "articles");
}
const date = "2026-10-05T10:00:00Z";
const articles = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, feedId: i % 2 ? 9 : 10, feedTitle: i % 2 ? "研究机构 RSS" : "开放科学 RSS", title: ["研究团队发布共享数据工具", "科研资助计划更新申请规则", "学術资源支持跨学科协作"][i % 3], snippet: "用于检验 RSS 资料库导航与面板布局的合成资讯。所有界面数据都来自隔离 fixture。", url: `https://example.invalid/rss/${i + 1}`, publishedAt: date, sourceType: "rss", author: "隔离验收", isRead: true, isStarred: true, readLater: false, imageUrl: null, tags: [] }));
const feeds = [{ id: 9, title: "研究机构 RSS", folderId: 7, unreadCount: 2, articleCount: 6, fetchError: null, faviconUrl: null, url: "https://example.invalid/feed.xml" }, { id: 10, title: "开放科学 RSS", folderId: null, unreadCount: 1, articleCount: 6, fetchError: null, faviconUrl: null, url: "https://example.invalid/open.xml" }];
const sources = [{ id: "fixture", name: "科研动态", region: "global", category: "tech", kind: "hot", homepage: "https://example.invalid", description: "合成热榜来源", project: "Fixture", project_url: "https://example.invalid", refresh_secs: 600, auth_kind: null, auth_url: null }];
// Isolated cloud-cache response. No provider token, paid call, native login,
// real history, or production database is used by this visual fixture.
const cloudSnapshot = (source: typeof LABEL_SOURCES[number], index = 0) => ({
  id: `fixture:${source.id}:${index}`, platformId: source.id, provider: "tikhub", endpointId: `fixture-${source.id}`,
  observedAt: new Date(Date.parse(date) - index * 15000000).toISOString(), period: "合成云端验收数据",
  rows: ["学术研究", "开放科学"].map((term, i) => ({id:`${source.id}:${i}`,term,kind:"合成话题",rank:i+1,metric:source.id === "zhihu" ? null : {label:"演示指标",value:10000-i*1000,unit:""},url:null})),
});
const labelCloud = {schemaVersion:1,source:"scholay-cloud-labels",generatedAt:date,
  budget:{month:"2026-10",currency:"USD",limitMicros:5000000,spentMicros:33000,reservedMicros:0,remainingMicros:4967000,blocked:false},
  platforms:LABEL_SOURCES.map(source=>({id:source.id,name:source.name,status:"ready",message:"",lastObservedAt:date,nextDueAt:"2026-10-05T14:00:00Z"})),
  latest:LABEL_SOURCES.map(source=>cloudSnapshot(source)),history:LABEL_SOURCES.flatMap(source=>[cloudSnapshot(source),cloudSnapshot(source,1)]),
};
if (qs.get("restore") !== "1") localStorage.setItem(LABEL_UI_KEY, JSON.stringify({ sourceId: qs.get("labelSource") || "all" }));
const callbacks = new Map<number, (event: unknown) => void>(); let seq = 0;
const listeners = new Map<number, { event: string; handler: number }>();
const emit = (event: string, payload: unknown) => { for (const [id, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload }); };
const calls: string[] = []; const settings: Record<string, string> = {};
Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", { configurable: true, value: { unregisterListener: () => {} } });
Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  transformCallback: (callback: (event: unknown) => void) => { const id = ++seq; callbacks.set(id, callback); return id; }, unregisterCallback: (id: number) => callbacks.delete(id),
  invoke: async (command: string, args: any = {}) => {
    calls.push(command);
    if (command === "connection_center" && args.method === "list") return {spaceId:'design-fixture',spaceName:'设计空间 · 测试数据',vault:'隔离测试',connections:providers.map(p=>({provider:p.id,configured:p.id==='github',enabled:p.id==='github',status:p.id==='github'?'verified':'unconfigured',target:''}))};
    if (command === "list_folders") return [{ id: 7, name: "科研资讯", position: 0, parentId: null }];
    if (command === "list_feeds") return feeds;
    if (command === "list_tags") return [{ id: 3, name: "开放科学", articleCount: 12, color: null }];
    if (command === "list_calendar_events") return [];
    if (command === "smart_counts") return { all: 12, unread: 3, starred: 12, agented: 0 };
    if (command === "list_articles") return articles.filter(row => (!args.search || row.title.includes(args.search)) && (args.query?.kind !== "feed" || args.query.value === row.feedId)).slice(args.offset || 0, (args.offset || 0) + (args.limit || 60));
    if (command === "get_article") return { ...articles.find(row => row.id === args.id), contentHtml: "<p>隔离合成正文。</p>", extractedHtml: null, aiSummary: null, translatedHtml: null, translatedLang: null, enclosures: [] };
    if (command === "list_hot_sources") return sources;
    if (command === "get_hot_snapshot") return { source_id: "fixture", items: articles.slice(0, 5).map((row, i) => ({ id: String(row.id), title: row.title, url: row.url, description: row.snippet, heat: "合成榜单", rank: i + 1, published_at: date })), fetched_at: date, last_attempt_at: date, status: "ok", error: null, stale: false, cached: true };
    if (command === "get_hot_auth_status") return { configured: false, supported: true };
    if (command === "pull_label_cloud") return labelCloud;
    if (command === "get_setting") return settings[args.key] ?? null;
    if (command === "set_setting") { settings[args.key] = args.value; return; }
    if (command === "plugin:event|listen") { const id = ++seq; listeners.set(id, { event: args.event, handler: args.handler }); return id; }
    if (command === "plugin:event|unlisten") { listeners.delete(args.eventId); return; }
    if (command === "plugin:updater|check" || command === "take_pending_deep_link") return null;
    if (["set_page_view_theme", "set_native_backing", "set_workspace_shortcuts", "set_reader_shortcuts", "plugin:window|set_background_color", "plugin:webview|set_webview_background_color"].includes(command)) return;
    throw Error("隔离验收不执行：" + command);
  },
} });
const { default: WorkspaceApp } = await import("../src/WorkspaceApp");
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={qc}><WorkspaceApp/></QueryClientProvider>);
Object.assign(window, { __rssFixtureCalls: calls });
