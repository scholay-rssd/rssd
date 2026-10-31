// Isolated geometry acceptance: real manuscript UI, synthetic in-memory content.
// No filesystem, personal manuscripts, database, external URL or native IPC.
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import "@fontsource-variable/inter-tight";
import "../src/styles.css";
import "../src/workspace.css";

type FrameApi = {runCase: (scale: number) => Promise<{failures: string[]; checks: number; sidebarWidth: number}>; blockedIpc: string[]};
const frameTick = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const params = new URLSearchParams(location.search);
const frameApi = (window: Window) => (window as unknown as {__SCHOLAY_DRAG_FRAME__?: FrameApi}).__SCHOLAY_DRAG_FRAME__;

// Mirrors the current Tauri 2.11.3 target rules, only to classify hit targets.
// Native drag/zoom must still be accepted in the installed desktop application.
function isDragTarget(target: Element | null): boolean {
  const clickable = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"]);
  const roles = new Set(["button", "link", "menuitem", "tab", "checkbox", "radio", "switch", "option"]);
  for (let element = target; element; element = element.parentElement) {
    if (!(element instanceof HTMLElement)) continue;
    const attr = element.getAttribute("data-tauri-drag-region");
    const interactive = clickable.has(element.tagName)
      || (element.hasAttribute("contenteditable") && element.getAttribute("contenteditable") !== "false")
      || (element.hasAttribute("tabindex") && element.getAttribute("tabindex") !== "-1")
      || roles.has(element.getAttribute("role") || "");
    if (interactive && attr === null) return false;
    if (attr === null) continue;
    if (attr === "false") return false;
    if (attr === "deep") return true;
    if (attr === "" || attr === "true") return element === target;
  }
  return false;
}

if (params.has("frame")) {
  document.documentElement.dataset.platform = "mac";
  document.documentElement.dataset.palette = "paper";
  document.documentElement.dataset.mode = "dark";
  Object.defineProperty(navigator, "platform", {configurable: true, value: "MacIntel"});
  const blockedIpc: string[] = [];
  const draft = {id: "synthetic-drag-article", shortTitle: "标题栏命中范围示例稿件", canonicalPath: "articles/2026-10/2026-10-02_01_示例稿件/正文.md", batchDate: "2026-10-02", markdown: "# 隔离验收稿件\n\n这里没有任何真实稿件。\n", sha256: "synthetic-source-hash"};
  Object.defineProperty(window, "__TAURI_INTERNALS__", {value: {invoke: async (command: string, args: {method?: string} = {}) => {
    if (command === "editorial_call") {
      if (args.method === "draft_list") return {articles: [draft]};
      if (args.method === "draft_read") return {...draft};
      if (args.method === "draft_preview") return {html: "<h1>隔离验收稿件</h1><p>这里没有任何真实稿件。</p>"};
      if (args.method === "publication_status") return {};
    }
    blockedIpc.push(`${command}/${args.method || ""}`);
    throw Error("Isolated drag QA blocked this operation");
  }}});
  const [{default: EditorialBoard}, {default: WorkspaceSwitcher}] = await Promise.all([
    import("../src/editorial/EditorialBoard"), import("../src/components/WorkspaceSwitcher"),
  ]);
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<div className="workspace-host">
    <WorkspaceSwitcher workspace="editorial" captureBusy={false} onChange={() => {}}/>
    <div className="workspace-panels"><EditorialBoard active openRequest={{id: draft.id, nonce: 1}}/></div>
  </div>));
  for (let tries = 0; tries < 120 && document.querySelector(".editorial-main > header strong")?.textContent !== draft.shortTitle; tries++) await frameTick();
  await document.fonts.ready;
  Object.assign(window, {__SCHOLAY_DRAG_FRAME__: {
    blockedIpc,
    async runCase(scale: number) {
      document.documentElement.style.zoom = String(scale);
      await frameTick();
      const failures: string[] = [];
      let checks = 0;
      const check = (ok: boolean, message: string) => {checks++; if (!ok) failures.push(message);};
      const hit = (x: number, y: number) => document.elementFromPoint(x, y);
      const sidebar = document.querySelector<HTMLElement>(".editorial-list")!;
      const bar = sidebar.querySelector<HTMLElement>(".titlebar");
      const sidebarRect = sidebar.getBoundingClientRect();
      check(!!bar, "manuscript sidebar has no title strip");
      if (bar) {
        const strip = bar.getBoundingClientRect();
        check(Math.abs(strip.left - sidebarRect.left) < 1 && Math.abs(strip.right - sidebarRect.right) < 2, "sidebar title strip does not span the actual sidebar width");
        check(Math.abs(strip.height - 38 * scale) < 1, "sidebar title strip height changed");
        for (let x = strip.left + 6 * scale; x < strip.right - 3 * scale; x += 17 * scale) {
          for (const y of [strip.top + 7 * scale, strip.top + 19 * scale, strip.bottom - 6 * scale]) {
            check(isDragTarget(hit(x, y)), `sidebar drag miss at ${Math.round(x)},${Math.round(y)}`);
          }
        }
      }
      const header = document.querySelector<HTMLElement>(".editorial-main > header")!;
      const heading = header.querySelector("strong")!.getBoundingClientRect();
      check(isDragTarget(hit(heading.left + Math.min(heading.width / 2, 12 * scale), heading.top + heading.height / 2)), "article title text is not draggable");
      const hr = header.getBoundingClientRect();
      for (const point of [[hr.left + 4 * scale, hr.top + 4 * scale], [hr.left + hr.width / 2, hr.top + 3 * scale], [hr.right - 4 * scale, hr.bottom - 3 * scale]]) {
        check(isDragTarget(hit(point[0], point[1])), "article header blank area is not draggable");
      }
      const controls = document.querySelectorAll<HTMLElement>(".editorial-main > header button, .editorial-list > header button, .editorial-list > input, .workspace-rail button");
      for (const control of controls) {
        const rect = control.getBoundingClientRect();
        const target = hit(rect.left + rect.width / 2, rect.top + rect.height / 2);
        check(!!target && control.contains(target), `control blocked: ${control.getAttribute("aria-label") || control.textContent}`);
        check(!isDragTarget(target), `control became a drag target: ${control.getAttribute("aria-label") || control.textContent}`);
      }
      const markdown = [...header.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Markdown")!;
      markdown.click();
      await frameTick();
      check(!!document.querySelector('textarea[aria-label="Markdown 正文"]'), "Markdown button no longer switches mode");
      [...header.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "预览")!.click();
      await frameTick();
      check(!!document.querySelector('[aria-label="稿件阅读预览"]'), "preview button no longer switches mode");
      check(blockedIpc.length === 0, "fixture attempted an unapproved IPC operation");
      return {failures, checks, sidebarWidth: sidebarRect.width / scale};
    },
  } satisfies FrameApi});
} else {
  document.body.style.cssText = "overflow:auto;background:#f7f5ef;color:#222;font:13px/1.5 system-ui;margin:16px;width:auto;height:auto";
  document.getElementById("root")!.innerHTML = '<h1>标题栏命中区域 · 隔离验收</h1><p>真实稿件组件与样式；内容和 IPC 完全由内存样例替代。此页验证几何与按钮命中，原生拖拽/双击由桌面实机另行验收。</p><pre id="results">运行中…</pre><iframe id="frame" src="./window-drag.html?frame" title="Synthetic manuscript workspace" style="display:block;width:920px;height:740px;border:1px solid #777"></iframe>';
  const iframe = document.getElementById("frame") as HTMLIFrameElement;
  for (let tries = 0; tries < 300 && !frameApi(iframe.contentWindow!); tries++) await frameTick();
  const api = frameApi(iframe.contentWindow!);
  const failures: string[] = [];
  const cases: {width: number; scale: number; checks: number; sidebarWidth: number}[] = [];
  if (!api) failures.push("fixture did not become ready");
  else for (const width of [920, 1440]) {
    iframe.style.width = `${width}px`;
    await frameTick();
    for (const scale of [0.9, 1, 1.25]) {
      const result = await api.runCase(scale);
      cases.push({width, scale, checks: result.checks, sidebarWidth: result.sidebarWidth});
      failures.push(...result.failures.map(message => `${width}px/${scale * 100}%: ${message}`));
    }
  }
  if (api) {iframe.style.width = "920px"; await frameTick(); await api.runCase(1);}
  const result = {passed: failures.length === 0, cases, failures, blockedIpc: api?.blockedIpc || []};
  Object.assign(window, {__SCHOLAY_WINDOW_DRAG_QA__: result});
  document.getElementById("results")!.textContent = JSON.stringify(result, null, 2);
  document.title = `${result.passed ? "PASS" : "FAIL"} — window drag hit regions`;
  document.documentElement.dataset.result = result.passed ? "pass" : "fail";
}
