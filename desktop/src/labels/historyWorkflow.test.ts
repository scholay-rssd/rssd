// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import LabelBoard from "./LabelBoard";
import { WindowChromeContext } from "../components/PaneToolbar";
import { LABEL_CACHE_KEY, LABEL_UI_KEY } from "./helpers";
import { labelHistoryStats, makeCapture, saveLabelCaptures } from "./history";
import { LABEL_CLOUD_CACHE_KEY, LABEL_CLOUD_UI_KEY, LABEL_CLOUD_POLL_MS, readLabelCloud } from "./cloud";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
let host: HTMLDivElement, root: Root;
const clipboardWrite = vi.fn();
const row = { id: "keyword", term: "科研话题", kind: "热门话题", metric: { value: 100, label: "热度", unit: "万" }, rank: 1, url: null };
const snapshot = (id = "cloud-new", observedAt = "2026-10-05T02:47:19Z", term = "科研话题") => ({ id, platformId: "douyin", provider: "tikhub", endpointId: "douyin-hot", observedAt, period: "实时榜", rows: [{ ...row, term }] });
const payload = () => ({ schemaVersion: 1, source: "scholay-cloud-labels", collection: { configured: true, lastWorkerAt: "2026-10-05T03:00:00Z", message: "" }, generatedAt: "2026-10-05T03:00:00Z", budget: { month: "2026-10", currency: "USD", limitMicros: 5000000, spentMicros: 125000, reservedMicros: 100000, remainingMicros: 4775000, blocked: false }, platforms: [{ id: "douyin", name: "抖音", status: "ok", message: "", lastObservedAt: "2026-10-05T02:47:19Z", nextDueAt: null }], latest: [snapshot()], history: [snapshot(), snapshot("cloud-old", "2026-10-05T02:31:07Z", "科研旧词")] });
const legacy = JSON.stringify({ douyin: { rows: [{ term: "旧 DOM 数据", kind: "抖音实时热点", rank: 1, metric: "100万", metricLabel: "热点指数" }], period: "旧榜单", capturedAt: "2026-10-05T02:00:00Z" } });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  clipboardWrite.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.create(navigator, { clipboard: { value: { writeText: clipboardWrite }, configurable: true } }));
  localStorage.clear(); localStorage.setItem(LABEL_UI_KEY, '{"sourceId":"douyin"}'); localStorage.setItem(LABEL_CACHE_KEY, legacy);
  localStorage.setItem(LABEL_CLOUD_UI_KEY, '{"sourceId":"douyin"}');
  vi.mocked(invoke).mockReset().mockImplementation(async command => { if (command === "pull_label_cloud") return payload(); throw Error(`Unexpected ${command}`); });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = (active = true) => act(async () => root.render(createElement(LabelBoard, { active })));
const click = (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());

it("keeps seven platform choices in the RSS sidebar and lets current labels fill the content area", async () => {
  const sidebar = document.createElement("aside"), chrome = document.createElement("div"); document.body.append(sidebar, chrome);
  const embedded = (active: boolean) => act(async () => root.render(createElement(WindowChromeContext.Provider, { value: { host: chrome, workspace: "rss", collapsed: false, toggle: () => {} } }, createElement(LabelBoard, { active, embedded: true, sidebarHost: sidebar }))));
  try {
    await embedded(true);
    expect(host.querySelectorAll('.label-tag-card')).toHaveLength(1);
    expect(host.querySelector('.hot-sidebar')).toBeNull(); expect(chrome.children).toHaveLength(0);
    const nav = sidebar.querySelector('[aria-label="标签平台"]')!;
    expect(nav.querySelectorAll('button')).toHaveLength(8);
    for (const name of ["哔哩哔哩", "抖音", "快手", "小红书", "微博", "今日头条", "知乎"]) expect(nav.textContent).toContain(name);
    expect(nav.textContent).not.toMatch(/待适配|Cookie|授权/);
    expect(host.querySelector('.label-content-tools')?.textContent).toContain('抖音');
    expect(host.querySelector('[aria-label="刷新标签"]')).not.toBeNull();
    expect(host.querySelector('.label-auth-state time')?.getAttribute('dateTime')).toBe('2026-10-05T02:47:19Z');
    expect(host.querySelector('[aria-label="流量标签"]')?.getAttribute('style')).toContain('--hot-list-width: 0px');
    expect(host.querySelectorAll('[role="separator"]')).toHaveLength(0);
    expect(host.querySelector('.label-timeline')).toBeNull();
    expect(host.textContent).not.toMatch(/月预算|预留|成功更新记录|最近云端检查|计划每|云端统一更新/);
    await embedded(false); expect(sidebar.querySelector('.rss-library-sources')).toBeNull();
    expect(host.querySelectorAll('.label-tag-card')).toHaveLength(1);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="刷新标签"]')?.disabled).toBe(true);
    await embedded(true); expect(sidebar.querySelectorAll('.rss-library-sources')).toHaveLength(1);
    expect(vi.mocked(invoke).mock.calls.every(([command]) => command === "pull_label_cloud")).toBe(true);
  } finally { sidebar.remove(); chrome.remove(); }
});

it("shows latest labels with their observation time, supports search and preserves historical storage", async () => {
  await saveLabelCaptures([makeCapture("douyin", JSON.parse(legacy).douyin)!]);
  await render();
  expect(host.querySelectorAll('.label-tag-card')).toHaveLength(1);
  expect(host.querySelector('.label-insights')?.textContent).toContain('科研话题');
  expect(host.querySelector('.label-insights')?.textContent).not.toContain('科研旧词');
  expect(host.querySelector('.label-tag-rank')?.textContent).toBe('榜单第 1');
  expect(host.querySelector('.label-tag-metric')?.textContent).toBe('热度 100万');
  expect(host.querySelector('.label-tag-card time')?.getAttribute('dateTime')).toBe('2026-10-05T02:47:19Z');
  expect(host.querySelector('[aria-label="云端更新历史"]')).toBeNull();
  const input = host.querySelector<HTMLInputElement>('[aria-label="搜索标签"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '不存在'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(host.querySelector('.label-insights')?.textContent).toContain('没有匹配的标签');
  expect(localStorage.getItem(LABEL_CACHE_KEY)).toBe(legacy); expect(localStorage.getItem(LABEL_UI_KEY)).toBe('{"sourceId":"douyin"}'); expect((await labelHistoryStats("douyin")).count).toBe(1);
  expect(readLabelCloud(localStorage.getItem(LABEL_CLOUD_CACHE_KEY))?.history).toHaveLength(2);
});

it("keeps expanded labels after a cache refresh and resets them when changing platforms", async () => {
  const value = payload();
  value.latest[0].rows = Array.from({ length: 125 }, (_, index) => ({ ...row, id: `keyword-${index + 1}`, term: `标签${index + 1}`, rank: index + 1 }));
  vi.mocked(invoke).mockResolvedValue(value);
  await render();
  expect(host.querySelectorAll('.label-tag-card')).toHaveLength(60);
  await click('.label-load-history');
  expect(host.querySelectorAll('.label-tag-card')).toHaveLength(120);
  await click('[aria-label="刷新标签"]');
  expect(host.querySelectorAll('.label-tag-card')).toHaveLength(120);
  expect(host.querySelectorAll('.label-tag-name')[119].textContent).toContain('标签120');
  const choose = (name: string) => act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="标签平台"] button')).find(button => button.textContent?.includes(name))!.click());
  await choose('哔哩哔哩');
  expect(host.querySelectorAll('.label-tag-card')).toHaveLength(0);
  await choose('抖音');
  expect(host.querySelectorAll('.label-tag-card')).toHaveLength(60);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("copies a visible tag without opening details or requesting another update", async () => {
  await render(); const before = vi.mocked(invoke).mock.calls.length;
  expect(host.querySelector('.label-tag-card details')).toBeNull();
  await click('[aria-label="复制标签：科研话题"]');
  expect(clipboardWrite).toHaveBeenCalledExactlyOnceWith('科研话题');
  expect(host.querySelector('.label-notice')?.textContent).toContain('已复制');
  expect(invoke).toHaveBeenCalledTimes(before);
});

it("replays the same successful cloud records without duplication and restores offline cache after remount", async () => {
  await render(); await click('[aria-label="刷新标签"]');
  expect(host.querySelectorAll('.label-tag-card')).toHaveLength(1);
  expect(readLabelCloud(localStorage.getItem(LABEL_CLOUD_CACHE_KEY))?.history).toHaveLength(2);
  await act(async () => root.unmount()); root = createRoot(host);
  vi.mocked(invoke).mockRejectedValue(Error("offline")); await render();
  expect(host.querySelector('.label-auth-state')?.textContent).toContain('暂未更新');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('已保留本机缓存');
  expect(host.querySelector('.label-insights')?.textContent).toContain('科研话题');
  expect(host.querySelectorAll('.label-tag-card')).toHaveLength(1);
  expect(readLabelCloud(localStorage.getItem(LABEL_CLOUD_CACHE_KEY))?.history).toHaveLength(2);
  expect(localStorage.getItem(LABEL_CACHE_KEY)).toBe(legacy);
});

it("keeps previous observations after an invalid or failed cloud pull and never displays raw failure secrets", async () => {
  await render(); const before = localStorage.getItem(LABEL_CLOUD_CACHE_KEY);
  vi.mocked(invoke).mockResolvedValue({ ...payload(), source: "legacy-dom" }); await click('[aria-label="刷新标签"]');
  expect(host.querySelector('.label-auth-state')?.textContent).toContain('暂未更新'); expect(localStorage.getItem(LABEL_CLOUD_CACHE_KEY)).toBe(before);
  vi.mocked(invoke).mockRejectedValue(Error("Bearer PRIVATE_SECRET")); await click('[aria-label="刷新标签"]');
  expect(host.textContent).not.toContain('PRIVATE_SECRET'); expect(host.querySelector('.label-insights')?.textContent).toContain('科研话题');
});

it("only pulls every five minutes while active and discards late responses from an inactive owner", async () => {
  vi.useFakeTimers(); await render(false); expect(invoke).not.toHaveBeenCalled();
  let resolve!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await render(true); expect(invoke).toHaveBeenCalledTimes(1); await render(false);
  await act(async () => resolve(payload())); expect(localStorage.getItem(LABEL_CLOUD_CACHE_KEY)).toBeNull(); expect(host.querySelector('.label-insights')?.textContent).not.toContain('科研话题');
  vi.mocked(invoke).mockResolvedValue(payload()); await render(true); expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(LABEL_CLOUD_POLL_MS - 1); }); expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(invoke).toHaveBeenCalledTimes(3);
  await render(false); await act(async () => { await vi.advanceTimersByTimeAsync(LABEL_CLOUD_POLL_MS); }); expect(invoke).toHaveBeenCalledTimes(3);
});

it("shows an ordinary empty state without exposing collection or budget administration", async () => {
  const value = payload(); value.latest = []; value.history = []; value.budget = { ...value.budget, spentMicros: 5000000, reservedMicros: 0, remainingMicros: 0, blocked: true };
  vi.mocked(invoke).mockResolvedValue(value); await render();
  expect(host.querySelector('.label-auth-state')?.textContent).toBe('尚未更新');
  expect(host.querySelector('.label-insights')?.textContent).toContain('尚未更新');
  expect(host.querySelector('[aria-label="云端采集月预算"]')).toBeNull();
  expect(host.querySelector('.label-cloud-collection')).toBeNull();
  expect(host.textContent).not.toMatch(/月预算|预留|付费|已上线|在线|待适配|Cookie|授权管理/);
});

it("keeps recommendation order without invented metrics and reports only actionable read failures", async () => {
  const value: any = payload(); value.collection.configured = false; value.latest[0].period = null;
  value.latest[0].rows = [{ ...row, id: "first", term: "原始第一条", rank: null, metric: null }, { ...row, id: "second", term: "原始第二条", rank: null, metric: null }];
  vi.mocked(invoke).mockResolvedValue(value); await render();
  expect(host.querySelector('.label-cloud-collection')).toBeNull();
  expect(host.querySelectorAll('.label-tag-name')[0].textContent).toContain('原始第一条');
  expect(host.querySelectorAll('.label-tag-name')[1].textContent).toContain('原始第二条');
  expect(host.querySelectorAll('.label-tag-rank')).toHaveLength(0);
  expect(host.querySelectorAll('.label-tag-metric')).toHaveLength(0);
  expect(host.querySelectorAll('[aria-label^="复制标签："]')).toHaveLength(2);
  expect(host.textContent).not.toMatch(/平台未提供|配置 TikHub|云端采集尚未配置/);
  vi.mocked(invoke).mockRejectedValue('请先在设置中绑定官网，以读取云端标签'); await click('[aria-label="刷新标签"]');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('请先在设置中绑定官网');
  expect(host.querySelector('.label-insights')?.textContent).toContain('原始第一条');
});
