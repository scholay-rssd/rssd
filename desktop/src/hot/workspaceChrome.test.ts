// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HotBoard from "./HotBoard";
import type { HotSnapshot, HotSource } from "./types";
import { HOT_UI_KEY } from "./helpers";
import { closeReadingTabs, emptyGroupSession, useReadingGroups } from "../lib/readingGroups";
import { useReaderTabs } from "../lib/readerTabs";
import { useUi } from "../store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../i18n", () => ({ default: { t: (key: string) => key, language: "zh" } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../lib/useBlockingOverlay", () => ({ hasBlockingOverlay: () => false, useBlockingOverlay: () => false }));
vi.mock("./HotTabReader", () => ({ default: ({ tab }: { tab: { id: string; title: string } }) => createElement("article", { "data-hot-reader": tab.id }, tab.title) }));
const source: HotSource = { id: "research", name: "科研动态", region: "china", category: "tech", kind: "hot", homepage: "https://example.invalid", description: "合成来源", project: "Fixture", project_url: "https://example.invalid/docs", refresh_secs: 600, auth_kind: null, auth_url: null };
const snapshot: HotSnapshot = { source_id: source.id, fetched_at: "2026-10-05T02:00:00Z", last_attempt_at: "2026-10-05T02:00:00Z", status: "ok", error: null, stale: false, cached: true, items: [1, 2].map(rank => ({ id: String(rank), title: `科研资讯 ${rank}`, url: `https://example.invalid/news/${rank}`, description: `合成摘要 ${rank}`, heat: "合成榜单", rank, published_at: null })) };
vi.mock("./api", () => ({ listHotSources: vi.fn(async () => [source]), getHotSnapshot: vi.fn(async () => snapshot) }));
let root: Root, host: HTMLDivElement, qc: QueryClient;
const click = async (selector: string) => { const target = host.querySelector<HTMLButtonElement>(selector); expect(target).not.toBeNull(); await act(() => target!.click()); };
async function render() {
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(HotBoard, { active: true }))); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  localStorage.clear();
  useReadingGroups.setState({ ...emptyGroupSession(), closed: [], loading: {} });
  useReaderTabs.setState({ tabs: [], activeId: null, recent: [], closed: [], captureTabId: null });
  useUi.setState({ modalOpen: false, menuOpen: false, aiOpen: false });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(["hot", "sources"], [source]); qc.setQueryData(["hot", "snapshot", source.id], snapshot);
});
afterEach(async () => { await act(() => root.unmount()); qc.clear(); host.remove(); vi.unstubAllGlobals(); });

it("starts at a fixed home matrix and keeps local actions in its content", async () => {
  await render();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("aria-label")).toBe("全网热榜");
  expect(host.querySelector('#reading-panel-hot .hot-cards')).not.toBeNull();
  expect(host.querySelectorAll('.reader-tab-close')).toHaveLength(0);
  expect(host.querySelector('.hot-content-toolbar input[aria-label="搜索热榜本地缓存"]')).not.toBeNull();
  expect(host.querySelector('.hot-content-toolbar button[aria-label="暂停热榜自动更新"]')).not.toBeNull();
  expect(host.querySelector('.hot-workspace-toolbar')).toBeNull();
  await click('.hot-content-toolbar button[aria-label="暂停热榜自动更新"]');
  expect(JSON.parse(localStorage.getItem(HOT_UI_KEY)!).paused).toBe(true);
});

it("opens an article with its source list, returns home without closing tabs, and reopens the tab", async () => {
  await render(); await click('.hot-card-items button');
  const articleId = useReadingGroups.getState().active.hot;
  expect(articleId).toBeTruthy();
  expect(host.querySelector('[data-hot-reader]')?.getAttribute('data-hot-reader')).toBe(articleId);
  expect(host.querySelector('.hot-ranking')).not.toBeNull();
  expect(host.querySelectorAll('.hot-workspace-toolbar button')).toHaveLength(1);
  expect(host.querySelector('.hot-workspace-toolbar input')).toBeNull();
  await click('.hot-main-nav button');
  expect(useReadingGroups.getState().active.hot).toBeNull();
  expect(useReadingGroups.getState().tabs).toHaveLength(1);
  expect(host.querySelector('#reading-panel-hot .hot-cards')).not.toBeNull();
  await click(`[id="reading-tab-hot-${articleId}"]`);
  expect(useReadingGroups.getState().active.hot).toBe(articleId);
  expect(host.querySelector('[data-hot-reader]')).not.toBeNull();
  await click('[aria-label="收起阅读区"]');
  expect(host.querySelector('#hot-reading-area')).toBeNull();
  expect(useReadingGroups.getState().active.hot).toBe(articleId);
  await click('[aria-label="展开阅读区"]');
  expect(host.querySelector('[data-hot-reader]')?.getAttribute('data-hot-reader')).toBe(articleId);
});

it("keeps the home tab when the final article closes and returns to the matrix", async () => {
  await render(); await click('.hot-card-items button');
  await act(() => closeReadingTabs([useReadingGroups.getState().active.hot!]));
  expect(useReadingGroups.getState().active.hot).toBeNull();
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
  expect(host.querySelector('[role="tab"]')?.getAttribute("aria-label")).toBe("全网热榜");
  expect(host.querySelector('.reader-tab-close')).toBeNull();
  expect(host.querySelector('#reading-panel-hot .hot-cards')).not.toBeNull();
  expect(host.querySelector('.hot-ranking')).toBeNull();
});
