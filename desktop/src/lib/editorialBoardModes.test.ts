// @vitest-environment jsdom
import {act, createElement} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import EditorialBoard from "../editorial/EditorialBoard";

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@tauri-apps/api/core", () => ({invoke}));
vi.mock("@tauri-apps/plugin-opener", () => ({openUrl: vi.fn()}));
vi.mock("../editorial/NoteCardsPreview", () => ({default: ({text}:{text:string}) => createElement('div',{'data-note-draft':text})}));
vi.mock("../i18n", () => ({default: {t: (key: string) => key, language: "zh"}}));
vi.mock("../editorial/EditorialRichEditor", () => ({default: ({text, onChange}: {text: string; onChange: (value: string) => void}) =>
  createElement("textarea", {"aria-label": "Rich editor fixture", value: text, onChange: (event: {target: {value: string}}) => onChange(event.target.value)})}));

let host: HTMLDivElement;
let root: Root;
const entry = {id: "draft-one", shortTitle: "One", canonicalPath: "articles/2026-10/01_One/正文.md", batchDate: null};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  invoke.mockReset().mockImplementation(async (command: string, payload: {method?: string}) => {
    if (command === "editorial_open_directory") return {};
    if (payload.method === "draft_list") return {articles: [entry]};
    if (payload.method === "draft_read") return {...entry, markdown: "# original", sha256: "first"};
    if (payload.method === "draft_preview") return {html: "<h1>Original</h1>"};
    return {};
  });
  host = document.createElement("div");document.body.append(host);root = createRoot(host);
});
afterEach(() => {act(() => root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
function button(label: string) {
  const match = Array.from(host.querySelectorAll("button")).find(element => element.textContent === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}
async function start() {await act(async () => root.render(createElement(EditorialBoard, {active: true, openRequest: {id: entry.id, nonce: 1}})));}
async function type(textarea: HTMLTextAreaElement, text: string) {
  await act(async () => {Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);textarea.dispatchEvent(new Event("input", {bubbles: true}));});
}

it("has two states: editing keeps the unsaved buffer, and leaving the editor saves before showing the preview", async () => {
  await start();
  expect(host.querySelector(".editorial-mode-picker")!.textContent).toBe("编辑官网预览");
  await act(async () => button("编辑").click());
  await type(host.querySelector("textarea")!, "# unsaved\n\n![picture](assets/example.png)");
  expect(button("保存").disabled).toBe(false);expect(host.querySelector(".editorial-mode-picker")!.textContent).toBe("编辑保存");
  expect(invoke.mock.calls.some(([, payload]) => payload.method === "draft_save")).toBe(false);
  await act(async () => button("保存").click());
  expect(invoke.mock.calls.filter(([, payload]) => payload.method === "draft_save")).toHaveLength(1);
  expect(host.querySelector("textarea")).toBeNull();expect(button("官网预览").getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector(".editorial-main header")!.textContent).not.toContain("打开方式");
});

it("opens the manuscript folder from the left tree without saving or discarding current input", async () => {
  await start();
  await act(async () => button("编辑").click());
  const textarea=host.querySelector("textarea")!;
  await type(textarea,"# unsaved directory test");
  const folder=host.querySelector<HTMLButtonElement>('[aria-label="打开目录：One"]')!;
  await act(async () => folder.click());
  expect(document.querySelector('[role="menu"]')!.textContent).toContain("当前未保存输入会保留");
  const open=Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(item=>item.textContent?.includes("用 Cursor"))!;
  await act(async () => open.click());
  expect(invoke).toHaveBeenCalledWith("editorial_open_directory",{path:"articles/2026-10/01_One",target:"cursor"});
  expect(textarea.value).toBe("# unsaved directory test");
  expect(button("保存").disabled).toBe(false);
  expect(invoke.mock.calls.some(([, payload]) => payload.method === "draft_save")).toBe(false);
});

it('opens picture notes from the unsaved buffer without saving and returns to the same editor text',async()=>{
  await act(async()=>root.render(createElement(EditorialBoard,{active:true,wechat:true,openRequest:{id:entry.id,nonce:1}})));
  await act(async()=>button('编辑').click());await type(host.querySelector('textarea')!,'# 未保存图文\n\n新增内容');
  await act(async()=>button('图文笔记预览').click());
  expect(host.querySelector('[data-note-draft]')?.getAttribute('data-note-draft')).toBe('# 未保存图文\n\n新增内容');
  expect(invoke.mock.calls.some(([,args])=>['draft_save','publish','save_cloud','prepare'].includes(args.method))).toBe(false);
  await act(async()=>button('编辑').click());expect(host.querySelector('textarea')?.value).toBe('# 未保存图文\n\n新增内容');
});

it("reflects index title changes while retaining unsaved editor text", async () => {
  await start();
  await act(async () => button('编辑').click());
  await type(host.querySelector('textarea')!, '# unsaved text');
  invoke.mockImplementation(async (_command: string, payload: {method: string}) => {
    if(payload.method==='draft_read')return {...entry,shortTitle:'New indexed title',markdown:'# original',sha256:'first'};
    return {};
  });
  await act(async () => {await vi.advanceTimersByTimeAsync(3000);});
  expect(host.querySelector('.editorial-main header strong')?.textContent).toContain('New indexed title');
  expect(host.querySelector('textarea')!.value).toBe('# unsaved text');
  expect(button('保存').disabled).toBe(false);
  expect(host.textContent).not.toContain('文件已被其他编辑器更新');
});
