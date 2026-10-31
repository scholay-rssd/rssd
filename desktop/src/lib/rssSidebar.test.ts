// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Sidebar from "../components/Sidebar";
import { useUi } from "../store";
import type { RssLibrarySection } from "./rssLibrary";
import { useReaderTabs } from "./readerTabs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("../i18n", () => ({ default: { t: (key: string) => key, language: "zh" } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => (({ "smart.all": "全部文章", "smart.starred": "星标文章", "sidebar.hotLibrary": "全网热榜", "sidebar.labelLibrary": "流量标签", "sidebar.calendarLibrary": "学术日历", "sidebar.historyLibrary": "昔日学术", "sidebar.library": "资料库" } as Record<string,string>)[key] ?? key) }) }));
let host: HTMLDivElement, root: Root, qc: QueryClient;
const libraryChange = vi.fn();
const rows = () => [...host.querySelectorAll<HTMLElement>('.sidebar-scroll > .sb-item')];
const render = async (librarySection: RssLibrarySection = "articles") => act(() => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sidebar, {
  librarySection, onLibraryChange: libraryChange,
  onAddFeed: vi.fn(), onExplore: vi.fn(), onSearchClick: vi.fn(), onRefresh: vi.fn(), refreshing: false, onToast: vi.fn(),
}))));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  useUi.setState({ query: { kind: "starred" }, queryLabel: "星标文章", focusMode: false, prefs: { ...useUi.getState().prefs, sidebarUnreadOnly: false, showSidebarCounts: false } });
  useReaderTabs.setState({ tabs: [], activeId: null, recent: [], closed: [], captureTabId: null });
  libraryChange.mockClear();
  qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, gcTime: Infinity } } });
  qc.setQueryData(["feeds"], [{ id: 7, title: "研究订阅", folderId: null, unreadCount: 3, faviconUrl: null, fetchError: null }]);
  qc.setQueryData(["folders"], [{ id: 2, name: "科研", parentId: null, unreadCount: 0 }]);
  qc.setQueryData(["tags"], []); qc.setQueryData(["counts"], { unread: 5, starred: 2 });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(() => root.unmount()); qc.clear(); host.remove(); vi.unstubAllGlobals(); });

it("keeps reading navigation focused on articles and subscriptions", async () => {
  await render();
  expect(rows().map(row => row.textContent)).toEqual(["全部文章", "星标文章"]);
  expect(rows().map(row => row.getAttribute("aria-current"))).toEqual([null, "true"]);
  expect(host.textContent).not.toContain("全网热榜");
  expect(host.textContent).not.toContain("流量标签");
  await act(() => rows()[0].click());
  expect(libraryChange).toHaveBeenLastCalledWith("articles");
  expect(useUi.getState().query).toEqual({kind:"all"});
  await render(); expect(rows()[0].getAttribute("aria-current")).toBe("true");
});

it("keeps source and folder selection available in reading", async () => {
  await render();
  const feed = [...host.querySelectorAll<HTMLElement>('.sb-item')].find(row => row.querySelector('.sb-label')?.textContent === "研究订阅")!;
  await act(() => feed.click()); expect(useUi.getState().query).toEqual({ kind: "feed", value: 7 });
  await render(); expect(feed.getAttribute("aria-current")).toBe("true");
  expect(rows().every(row => !row.hasAttribute("aria-current"))).toBe(true);
  const folder = host.querySelector<HTMLElement>('.sb-folder')!;
  await act(() => folder.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })));
  expect(useUi.getState().query).toEqual({ kind: "folder", value: 2 });
});

it.each(["feed", "folder", "all"] as const)("reveals the %s article list on repeated selection without changing reading tabs", async kind => {
  await render();
  useReaderTabs.getState().open(41, false, {title:"正在阅读的文章",feedId:7});
  const tab=useReaderTabs.getState().tabs[0];
  useReaderTabs.getState().update(tab.id,{mode:"web",webUrl:"https://example.org/article",rssScroll:120});
  const session={tabs:useReaderTabs.getState().tabs,activeId:useReaderTabs.getState().activeId,recent:useReaderTabs.getState().recent};
  const query=kind==="feed"?{kind,value:7}:kind==="folder"?{kind,value:2}:{kind};
  // Start with exactly this source already selected, underneath focus mode.
  await act(()=>useUi.setState({query,focusMode:true,listAnchor:60}));
  const target=kind==="feed"?[...host.querySelectorAll<HTMLElement>('.sb-item')].find(row=>row.querySelector('.sb-label')?.textContent==="研究订阅")!:kind==="folder"?host.querySelector<HTMLElement>('.sb-folder')!:rows()[0];
  await act(()=>target.click());
  expect(useUi.getState().focusMode).toBe(false);
  expect(useUi.getState().query).toEqual(query);expect(useUi.getState().listAnchor).toBe(0);
  expect(libraryChange).toHaveBeenLastCalledWith("articles");
  expect(useReaderTabs.getState()).toMatchObject(session);
});
