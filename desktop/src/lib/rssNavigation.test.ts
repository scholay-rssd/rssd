// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WorkspaceApp from "../WorkspaceApp";
import { useUi } from "../store";
import { RSS_LIBRARY_KEY } from "./rssLibrary";

const bus = vi.hoisted(() => new Map<string, Set<(event: { payload: string }) => void>>());
const mounting = vi.hoisted(() => ({ rss: 0, calendar: 0 }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri:()=>false, invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name: string, fn: (event: {payload: string})=>void) => {
  if (!bus.has(name)) bus.set(name, new Set()); bus.get(name)!.add(fn); return () => bus.get(name)!.delete(fn);
}) }));
vi.mock("../i18n", () => ({ default: { t: (key: string) => key, language: "en" } }));
vi.mock("./useBlockingOverlay", () => ({ useBlockingOverlay: () => false, hasBlockingOverlay: () => false }));
vi.mock("../App", async () => {
  const { createElement: h, useState } = await import("react");
  return { default: (props: any) => {
    const [instance] = useState(() => ++mounting.rss);
    return h("section", { "data-rss-active": String(props.active), "data-library-section": props.librarySection, "data-rss-instance": instance },
      h("nav", null, ...["articles", "hot", "labels", "calendar", "history"].map(section => h("button", { key: section, "data-library-button": section, onClick: () => props.onLibraryChange(section) }, section)),
      h("button", { "data-capture": true, onClick: () => props.onCaptureBusyChange(true) }, "capture")),
      h("div", { ref: props.onLibraryHostChange, "data-library-host": true }), props.libraryContent);
  } };
});
vi.mock("../hot/TrendsWorkspace", () => ({ default: (props: any) => createElement("div", { "data-trends-active": String(props.active), "data-trends-section": props.section, "data-embedded": String(props.embedded) }) }));
vi.mock("../calendar/CalendarBoard", async () => {
  const { createElement: h, useState } = await import("react");
  const { createPortal } = await import("react-dom");
  const { useQueryClient } = await import("@tanstack/react-query");
  return { default: (props: any) => {
    useQueryClient();
    const [instance] = useState(() => ++mounting.calendar), [selected, setSelected] = useState("全部");
    return h("section", { "data-calendar-active": String(props.active), "data-calendar-view": props.view, "data-calendar-instance": instance, "data-selected-tag": selected, "data-embedded": String(props.embedded) },
      props.active && props.sidebarHost && createPortal(h("button", { "data-calendar-tag": props.view, onClick: () => setSelected("学术会议") }, "学术会议"), props.sidebarHost));
  } };
});
vi.mock("../editorial/ContentWorkspace", () => ({ default: (props: any) => createElement("div", { "data-content-active": String(props.active), "data-management": String(props.view==='works'), "data-view":props.view }) }));
vi.mock("../editorial/ImageGallery", () => ({ default: (props: any) => createElement("div", { "data-gallery-active": String(props.active) }) }));
vi.mock("../connections/ConnectionCenter", () => ({default: (props: any) => createElement("div", {"data-connections-active": String(props.active), "data-compact": String(props.compact)})}));
let host: HTMLDivElement, root: Root;
const click = async (selector: string) => act(() => host.querySelector<HTMLButtonElement>(selector)!.click());
const enter = (workspace: string) => click(`[data-workspace="${workspace}"]`);
const discover = (index: number) => act(() => host.querySelectorAll<HTMLButtonElement>('.discovery-navigation button')[index].click());
const section = () => host.querySelector<HTMLElement>('[data-library-section]')!;
const activePanel = () => [...host.querySelectorAll<HTMLElement>('.workspace-panels > .workspace-panel')].find(panel => !panel.hasAttribute("inert"))?.id;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); bus.clear(); mounting.rss = 0; mounting.calendar = 0;
  useUi.setState({ modalOpen: false, menuOpen: false, focusMode: false });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async () => act(() => root.render(createElement(WorkspaceApp)));

it("restores the former manuscript tab as its own destination and remembers it after reopening", async () => {
  localStorage.setItem('papr.workspace.v2','editorial');
  localStorage.setItem('scholay.creation.tab','manuscripts');
  await render();
  expect(host.querySelector('[data-workspace="manuscripts"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('[data-content-active="true"]')?.getAttribute('data-view')).toBe('manuscripts');
  expect(localStorage.getItem('scholay.creation.tab')).toBeNull();
  await act(() => window.dispatchEvent(new Event('scholay-open-creation')));
  expect(host.querySelector('[data-content-active="true"]')?.getAttribute('data-view')).toBe('conversations');
  await act(() => window.dispatchEvent(new Event('scholay-open-manuscripts')));
  await act(() => root.unmount()); root=createRoot(host); await render();
  expect(host.querySelector('[data-content-active="true"]')?.getAttribute('data-view')).toBe('manuscripts');
  expect(localStorage.getItem('papr.workspace.v2')).toBe('manuscripts');
});

it("opens works by default and preserves reading and discovery independently across history", async () => {
  await render(); const instance = section().dataset.rssInstance;
  expect(activePanel()).toBe("workspace-editorial-panel");
  expect(host.querySelector('[data-management="true"][data-content-active="true"]')).not.toBeNull();
  expect(host.querySelector('[data-connections-active]')).toBeNull();
  await enter('discover'); await discover(1);
  expect(host.querySelector('[data-trends-active="true"]')?.getAttribute('data-trends-section')).toBe("labels");
  expect(section().dataset.librarySection).toBe("articles");
  await enter('rss');
  expect(activePanel()).toBe("workspace-rss-panel");
  expect(host.querySelector('[data-trends-active="true"]')).toBeNull();
  expect(localStorage.getItem(RSS_LIBRARY_KEY)).toBe("articles");
  await click('[aria-label="后退"]');
  expect(activePanel()).toBe("workspace-discover-panel");
  expect(host.querySelector('[data-trends-active="true"]')?.getAttribute('data-trends-section')).toBe("labels");
  await click('[aria-label="前进"]'); expect(activePanel()).toBe("workspace-rss-panel");
  await enter('discover');
  expect(host.querySelector('[data-trends-active="true"]')?.getAttribute('data-trends-section')).toBe("labels");
  expect(section().dataset.rssInstance).toBe(instance); expect(mounting.rss).toBe(1);
});
it.each(["hot", "hotboard", "labels"])("restores retired %s into discovery without discarding preferences", async legacy => {
  localStorage.setItem("papr.workspace.v2", legacy); localStorage.setItem('scholay.history.panes.v1', '{"sidebarWidth":320}');
  await render(); expect(activePanel()).toBe("workspace-discover-panel");
  expect(host.querySelector('[data-trends-active="true"]')?.getAttribute('data-trends-section')).toBe(legacy === "labels" ? "labels" : "hot");
  expect(localStorage.getItem("papr.workspace.v2")).toBe("discover"); expect(localStorage.getItem('scholay.history.panes.v1')).toBe('{"sidebarWidth":320}');
});
it.each(["year", "history", "calendar"])("restores retired %s into discovery without creating a task", async legacy => {
  localStorage.setItem("papr.workspace.v2", legacy); await render();
  expect(activePanel()).toBe("workspace-discover-panel");
  expect(host.querySelector('[data-calendar-active="true"]')?.getAttribute("data-calendar-view")).toBe(legacy === "history" ? "history" : "year");
  expect(host.querySelector('[data-content-active="true"]')).toBeNull();
  expect(localStorage.getItem("papr.workspace.v2")).toBe("discover");
});
it("migrates the mixed RSS labels route and restores it after another mount", async () => {
  localStorage.setItem("papr.workspace.v2", 'rss'); localStorage.setItem(RSS_LIBRARY_KEY, 'labels');
  await render(); expect(activePanel()).toBe("workspace-discover-panel");
  await enter('rss');
  await act(() => root.unmount()); root=createRoot(host); await render();
  expect(activePanel()).toBe("workspace-rss-panel"); await enter('discover');
  expect(host.querySelector('[data-trends-active="true"]')?.getAttribute('data-trends-section')).toBe('labels');
});
it("preserves each calendar view while only the active discovery view owns sidebar controls", async () => {
  await render(); const rssInstance = section().dataset.rssInstance;
  await enter('discover'); await discover(1); await discover(2);
  const calendar = host.querySelector<HTMLElement>('[data-calendar-view="year"]')!, instance = calendar.dataset.calendarInstance;
  expect(host.querySelector('[data-trends-active="true"]')).toBeNull();
  await click('[data-calendar-tag="year"]'); expect(calendar.dataset.selectedTag).toBe("学术会议");
  await discover(3);
  expect(host.querySelector('.discovery-sources')?.querySelectorAll('[data-calendar-tag]')).toHaveLength(1);
  expect(host.querySelector('[data-calendar-tag="year"]')).toBeNull();
  await click('[data-calendar-tag="history"]'); await click('[aria-label="后退"]');
  expect(host.querySelectorAll('[data-calendar-active="true"]')).toHaveLength(1);
  expect(calendar.dataset.calendarInstance).toBe(instance); expect(calendar.dataset.selectedTag).toBe("学术会议");
  await click('[aria-label="前进"]');
  expect(host.querySelector('[data-calendar-active="true"]')?.getAttribute("data-selected-tag")).toBe("学术会议");
  await enter('rss');
  expect(host.querySelector('[data-calendar-active="true"]')).toBeNull(); expect(host.querySelector('[data-calendar-tag]')).toBeNull();
  expect(host.querySelector('#workspace-discover-panel')?.hasAttribute('inert')).toBe(true);
  await enter('discover');
  expect(host.querySelector('[data-calendar-active="true"]')?.getAttribute('data-calendar-view')).toBe('history');
  expect(section().dataset.rssInstance).toBe(rssInstance); expect(mounting.rss).toBe(1); expect(mounting.calendar).toBe(2);
  await discover(1); expect(host.querySelector('[data-calendar-tag]')).toBeNull();
  expect(host.querySelector('[data-trends-active="true"]')?.getAttribute("data-trends-section")).toBe("labels");
});
it("keeps existing native/DOM shortcut slots, adds discovery/connections, and blocks them during capture", async () => {
  await render();
  const press = async (key: string) => act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true, cancelable: true })));
  const native = async (payload: string) => act(() => { for (const fn of bus.get("workspace-shortcut") ?? []) fn({ payload }); });
  for (const [slot, workspace] of ['rss','editorial','library','gallery','discover','connections','manuscripts'].entries()) {
    await press(String(slot+1));
    expect(host.querySelector('[data-workspace][aria-pressed="true"]')?.getAttribute('data-workspace')).toBe(workspace);
    await enter('rss'); await native(String(slot+1));
    expect(host.querySelector('[data-workspace][aria-pressed="true"]')?.getAttribute('data-workspace')).toBe(workspace);
  }
  await enter('rss'); await click('[data-capture]');
  for (let slot=1;slot<=6;slot++) { await press(String(slot)); await native(String(slot)); }
  expect(activePanel()).toBe("workspace-rss-panel");
  expect(host.querySelectorAll('[data-workspace]:disabled')).toHaveLength(8);
  expect(host.querySelector('.space-entrance')?.hasAttribute('disabled')).toBe(true);
});
it("opens the simple connections page from the settings shortcut", async () => {
  await render(); await act(() => window.dispatchEvent(new Event('rssd-open-connections')));
  expect(activePanel()).toBe('workspace-connections-panel');
  expect(host.querySelector('[data-connections-active="true"]')?.getAttribute('data-compact')).toBe('true');
  await enter('library'); expect(host.querySelector('[data-connections-active="true"]')).toBeNull();
});
