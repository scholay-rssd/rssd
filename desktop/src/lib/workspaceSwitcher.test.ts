// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceSwitcher, { parseWorkspace, type Workspace } from "../components/WorkspaceSwitcher";

let host: HTMLDivElement;
let root: Root;
const change = vi.fn();
const openSettings = vi.fn();
const render = (workspace: Workspace = "rss", captureBusy = false) => act(() => root.render(createElement(WorkspaceSwitcher, {
  workspace, captureBusy, onChange: change, onOpenSettings: openSettings,
})));
const rail = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".workspace-rail button[data-workspace]"));
const settings = () => host.querySelector<HTMLButtonElement>(".workspace-rail-settings");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.dataset.platform = "mac";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  change.mockClear();
  openSettings.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("activity rail and feature title", () => {
  it("shows named features with works first and the current space at the top", () => {
    render("hot");
    expect(rail().map(item => item.textContent)).toEqual(["作品", "稿件", "创作", "阅读", "发现", "素材", "连接", "中心"]);
    expect(host.querySelector(".workspace-sidebar-toggle")).toBeNull();
    expect(host.querySelector(".app-brand-name")).toBeNull();
    expect(host.querySelector(".workspace-tabs")).toBeNull();
    expect(host.querySelector(".workspace-rail button")).toBe(host.querySelector(".space-entrance"));
    expect(host.querySelector(".space-current-name")?.textContent).toBeTruthy();
    expect(rail()[0].querySelector("img")).toBeNull();
    for (const item of rail()) expect(item.querySelector("svg")).not.toBeNull();
    const foot = host.querySelector(".workspace-rail-foot")!;
    expect(Array.from(foot.querySelectorAll("button"))).toEqual([rail()[6], rail()[7], settings()]);
    expect(host.querySelector(".space-entrance img")?.getAttribute("src")).toMatch(/academic.*png/);
    expect(host.querySelector(".space-switch-indicator")).not.toBeNull();
    expect(settings()?.querySelector("svg")).not.toBeNull();
    expect(rail().map(item => item.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "false", "true", "false", "false", "false"]);
    expect(host.querySelector(".workspace-title-brand")?.textContent).toBe("发现");
  });
  it("opens Home and other features directly without opening the space picker", () => {
    render();
    const values: Workspace[] = ["library", "manuscripts", "editorial", "rss", "discover", "gallery", "connections", "center"];
    const panels = ["workspace-editorial-panel", "workspace-editorial-panel", "workspace-editorial-panel", "workspace-rss-panel", "workspace-discover-panel", "workspace-gallery-panel", "workspace-connections-panel", "workspace-center-panel"];
    for (const [index, workspace] of values.entries()) {
      change.mockClear();
      expect(rail()[index].getAttribute("aria-controls")).toBe(panels[index]);
      act(() => rail()[index].click());
      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(change).toHaveBeenCalledExactlyOnceWith(workspace);
    }
  });
  it("keeps the current feature when selecting the current space", () => {
    render("editorial");
    act(() => host.querySelector<HTMLButtonElement>('.space-entrance')!.click());
    act(() => host.querySelector<HTMLButtonElement>('[role="menuitem"][aria-current="true"]')!.click());
    expect(change).not.toHaveBeenCalled();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(rail()[2].getAttribute("aria-pressed")).toBe("true");
  });
  it("follows host selection without maintaining stale local state", () => {
    render(); render("history");
    expect(rail().map(item => item.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "false", "true", "false", "false", "false"]);
    expect(host.querySelector(".workspace-title-brand")?.textContent).toBe("发现");
    expect(change).not.toHaveBeenCalled();
  });
  it("names the current feature in the title strip across all workspaces", () => {
    const labels = ["作品", "稿件", "创作", "阅读", "发现", "素材", "连接", "中心"] as const;
    for (const [index, workspace] of (["library", "manuscripts", "editorial", "rss", "discover", "gallery", "connections", "center"] as const).entries()) {
      render(workspace);
      expect(host.querySelector(".workspace-title-brand")?.textContent).toBe((workspace === "editorial" || workspace === "library" || workspace === "manuscripts") ? undefined : labels[index]);
      expect(host.querySelector(".workspace-purpose")).toBeNull();
      expect(rail()).toHaveLength(8);
    }
    render("rss");
    expect(host.querySelector(".workspace-title-brand svg")).not.toBeNull();
  });
  it("locks workspace switching during capture but keeps settings available", () => {
    render("rss", true);
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    for (const item of rail()) { expect(item.disabled).toBe(true); act(() => item.click()); }
    expect(host.querySelector<HTMLButtonElement>('.space-entrance')!.disabled).toBe(true);
    expect(change).not.toHaveBeenCalled();
    expect(settings()?.disabled).toBe(false);
    act(() => settings()?.click());
    expect(openSettings).toHaveBeenCalledOnce();
    render("rss");
    expect(rail().every(item => !item.disabled)).toBe(true);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
  it("retains platform-specific shortcut hints and native button keyboard activation", () => {
    render();
    expect(rail().map(item => item.dataset.tooltip)).toEqual(["作品 · ⌘3", "稿件 · ⌘7", "创作 · ⌘2", "阅读 · ⌘1", "发现 · ⌘5", "素材 · ⌘4", "连接 · ⌘6", "中心 · ⌘8"]);
    expect(host.querySelectorAll(".space-entrance")).toHaveLength(1);
    expect(settings()?.dataset.tooltip).toBe("设置 · ⌘,");
    expect(host.querySelector(".workspace-rail [title]")).toBeNull();
    expect(rail()[0].getAttribute("aria-description")).toBe("快捷键 ⌘3");
    expect(rail().every(item => item.tabIndex === 0 && item.type === "button")).toBe(true);
    document.documentElement.dataset.platform = "other";
    render("history");
    expect(rail()[2].dataset.tooltip).toBe("创作 · Ctrl+2");
    expect(settings()?.dataset.tooltip).toBe("设置 · Ctrl+,");
  });
  it("migrates the retired workspace names", () => {
    expect(parseWorkspace("hotboard")).toBe("discover");
    expect(parseWorkspace("calendar")).toBe("discover");
    expect(parseWorkspace("home")).toBe("library");
    expect(parseWorkspace("publications")).toBe("editorial");
    expect(parseWorkspace("website")).toBe("editorial");
    expect(parseWorkspace("labels")).toBe("discover");
    expect(parseWorkspace("year")).toBe("discover");
    expect(parseWorkspace("history")).toBe("discover");
    expect(parseWorkspace("files")).toBe("library");
    expect(parseWorkspace("unknown")).toBe("library");
    expect(parseWorkspace(null)).toBe("library");
    expect(parseWorkspace("rss", "labels")).toBe("discover");
    expect(parseWorkspace("rss", "articles")).toBe("rss");
  });
});
