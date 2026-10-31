// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PublicationReader from "../publications/PublicationReader";
import { publicationSourceHtml } from "../publications/publicationSource";
import type { HotPageViewState } from "../hot/hotPageViewState";

const invoke = vi.hoisted(() => vi.fn());
const openUrl = vi.hoisted(() => vi.fn());
const browser = vi.hoisted(() => ({ loading: false, currentUrl: "", props: null as null | {viewId: string; active: boolean; url: string} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("../hot/HotPageView", () => ({ default: (props: {viewId: string; active: boolean; url: string; onStateChange: (state: HotPageViewState | null) => void}) => {
  browser.props = props;
  useEffect(() => {
    props.onStateChange(props.active ? { requestId: `request:${props.url}`, originalUrl: props.url, currentUrl: browser.currentUrl || props.url, created: true, loading: browser.loading, waiting: false, error: null, downloadUrl: null } : null);
  }, [props.active, props.url, props.onStateChange]);
  return createElement("div", { "data-browser": props.viewId, "data-active": String(props.active) }, browser.currentUrl || props.url);
} }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockReset();openUrl.mockReset().mockResolvedValue(undefined);
  browser.loading = false;browser.currentUrl = "";browser.props = null;
  host = document.createElement("div");document.body.append(host);root = createRoot(host);
});
afterEach(() => { act(() => root.unmount());host.remove();vi.unstubAllGlobals(); });
const source = (url = "https://platform.example/post/one") => ({ url, title: "Published title", html: '<h1>Published title</h1><p>Published body</p><img src="https://images.example/a.png" alt="Source picture">', text: "Published body", capturedAt: "2026-10-02T10:00:00Z", truncated: false, bodyFallback: false, hasMedia: true });
const render = (url: string | null = "https://platform.example/post/one", active = true) => act(async () => root.render(createElement(PublicationReader, { active, url, title: "Published title" })));
const button = (label: string) => Array.from(host.querySelectorAll("button")).find(element => element.textContent?.includes(label))!;

it("uses its own native view and reads only on explicit source-mode selection", async () => {
  invoke.mockResolvedValue(source());
  await render();
  expect(browser.props).toMatchObject({ viewId: "publication-page", active: true });
  expect(invoke).not.toHaveBeenCalled();
  await act(async () => button("源格式").click());
  expect(invoke).toHaveBeenCalledWith("capture_publication_page", { viewId:"publication-page", requestId: "request:https://platform.example/post/one", url: "https://platform.example/post/one" });
  expect(host.querySelector("[data-browser]")).toBeNull();
  expect(host.querySelector("article")?.textContent).toContain("Published body");
  expect(host.querySelector("article img")?.getAttribute("src")).toBe("https://images.example/a.png");
  await act(async () => button("网页").click());
  expect(host.querySelector("article")).toBeNull();
  expect(host.querySelector("[data-browser]")).not.toBeNull();
});

it("keeps the native page alive until capture resolves and shows the captured navigation URL", async () => {
  let resolve!: (value: ReturnType<typeof source>) => void;
  invoke.mockImplementation(() => new Promise(done => { resolve = done; }));
  browser.currentUrl = "https://platform.example/post/redirect";
  await render();
  await act(async () => button("源格式").click());
  expect(host.querySelector("[data-browser]")).not.toBeNull();
  expect(button("读取中").disabled).toBe(true);
  await act(async () => resolve(source(browser.currentUrl)));
  expect(host.querySelector(".pub-source-bar")?.textContent).toContain(browser.currentUrl);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="在系统浏览器打开目标链接"]')!.click());
  expect(openUrl).toHaveBeenCalledWith(browser.currentUrl);
  await act(async () => button("网页").click());
  expect(browser.props?.url).toBe(browser.currentUrl);
  expect(host.querySelector(".pub-reader-heading")?.getAttribute("title")).toContain("原始作品链接：https://platform.example/post/one");
  await act(async () => button("源格式").click());
  expect(invoke).toHaveBeenLastCalledWith("capture_publication_page", { viewId:"publication-page", requestId: `request:${browser.currentUrl}`, url: browser.currentUrl });
  await act(async () => resolve(source(browser.currentUrl)));
});

it("drops late captures when the selected publication changes", async () => {
  let resolve!: (value: ReturnType<typeof source>) => void;
  invoke.mockImplementation(() => new Promise(done => { resolve = done; }));
  await render();
  await act(async () => button("源格式").click());
  await render("https://other.example/post/two");
  await act(async () => resolve(source()));
  expect(host.querySelector("article")).toBeNull();
  expect(browser.props?.url).toBe("https://other.example/post/two");
  expect(host.textContent).not.toContain("Published body");
});

it("hides its browser and ignores a pending capture after leaving publication center", async () => {
  let resolve!: (value: ReturnType<typeof source>) => void;
  invoke.mockImplementation(() => new Promise(done => { resolve = done; }));
  await render();
  await act(async () => button("源格式").click());
  await render(undefined, false);
  expect(browser.props?.active).toBe(false);
  await act(async () => resolve(source()));
  expect(host.querySelector("article")).toBeNull();
});

it("does not create a page for missing or unsafe links and waits for a loaded page", async () => {
  await render("file:///private/secret");
  expect(browser.props).toBeNull();
  expect(button("源格式").disabled).toBe(true);
  browser.loading = true;
  await render();
  expect(button("源格式").disabled).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps the browser available when a platform cannot supply readable source", async () => {
  invoke.mockRejectedValue(new Error("login required"));
  await render();
  await act(async () => button("源格式").click());
  expect(host.querySelector("[data-browser]")).not.toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("暂时无法读取");
  expect(host.textContent).not.toContain("login required");
});

it("rebuilds untrusted source as inert formatting and valid image links", () => {
  const html = publicationSourceHtml({ url: "https://platform.example/post/one", html: '<script>bad()</script><h2 onclick="bad()" style="color:red">Heading</h2><form>private<input value="secret"></form><p><a href="javascript:bad()">bad</a><a href="/safe" target="_self">safe</a></p><img src="/photo.png" onerror="bad()" srcset="file:///secret"><img src="data:image/svg+xml,unsafe"><img src="https://user:password@example.com/a"><iframe src="https://evil.example"></iframe><table><tr><td colspan="2">cell</td></tr></table>', text: "fallback" });
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector("script,form,input,iframe,[onclick],[onerror],[style],[srcset]")).toBeNull();
  expect(doc.body.textContent).not.toContain("private");
  expect(doc.querySelectorAll("img")).toHaveLength(1);
  expect(doc.querySelector("img")?.getAttribute("src")).toBe("https://platform.example/photo.png");
  expect(doc.querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(doc.querySelectorAll("a[href]")).toHaveLength(1);
  expect(doc.querySelector("a[href]")?.getAttribute("href")).toBe("https://platform.example/safe");
  expect(doc.querySelector("td")?.getAttribute("colspan")).toBe("2");
});

it("falls back to escaped plain text when native markup is empty", () => {
  const html = publicationSourceHtml({ url: "https://platform.example/post", html: "", text: "A <script>plain example</script>" });
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
});
