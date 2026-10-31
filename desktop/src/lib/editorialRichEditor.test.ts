// @vitest-environment jsdom
import {act, createElement} from "react";
import {createRoot, type Root} from "react-dom/client";
import type {Editor} from "@tiptap/core";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import EditorialRichEditor from "../editorial/EditorialRichEditor";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({invoke}));
let root: Root;
let host: HTMLDivElement;
const change = vi.fn();
// jsdom has no Range layout. Tiptap's deferred focus may request these after
// toolbar clicks; provide geometry rather than leaving a timing-dependent error.
const rangeRect = new DOMRect(0, 0, 100, 20);
Object.defineProperty(Range.prototype, "getBoundingClientRect", {configurable:true,value:()=>rangeRect});
Object.defineProperty(Range.prototype, "getClientRects", {configurable:true,value:()=>[rangeRect]});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockReset().mockResolvedValue({imageSources: {"assets/图.png": "data:image/png;base64,iVBORw0KGgo="}});
  change.mockReset();
  host = document.createElement("div");document.body.append(host);root = createRoot(host);
});
afterEach(() => {act(() => root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(text: string, disabled = false) {
  await act(async () => root.render(createElement(EditorialRichEditor, {articleId: "draft-one", text, disabled, onChange: change})));
}
const instance = () => (host.querySelector(".tiptap") as HTMLElement & {editor: Editor}).editor;

it("does not normalize or dirty the manuscript when entering or returning to rich mode", async () => {
  const original = "# 标题\n\n\n　正文。\n\n";
  await render(original);
  expect(change).not.toHaveBeenCalled();
  expect(instance().getText()).toContain("正文。");
  await act(async () => root.render(createElement("div")));
  await render(original);
  expect(change).not.toHaveBeenCalled();
});

it("sends Markdown changes immediately and parent echoes retain editor selection and undo history", async () => {
  await render("# 原稿\n\n正文");
  const editor = instance();
  await act(async () => {editor.commands.setTextSelection(3);editor.commands.insertContent("新增");});
  expect(change).toHaveBeenCalledTimes(1);
  const updated = change.mock.calls.at(-1)![0] as string;
  expect(updated).toContain("新增");
  const selection = editor.state.selection.from;
  expect(editor.can().undo()).toBe(true);
  await render(updated);
  expect(instance()).toBe(editor);
  expect(editor.state.selection.from).toBe(selection);
  expect(editor.can().undo()).toBe(true);
  expect(change).toHaveBeenCalledTimes(1);
  await act(async () => {editor.commands.undo();});
  expect(change.mock.calls.at(-1)![0]).not.toContain("新增");
});

it("loads genuinely changed external Markdown without firing onChange", async () => {
  await render("# 原稿");
  const editor = instance();
  await render("# 外部版本\n\n正文");
  expect(instance()).toBe(editor);
  expect(editor.getText()).toContain("外部版本");
  expect(change).not.toHaveBeenCalled();
});

it("resolves local image references once and never serializes preview bytes or saves files", async () => {
  await render("# 图文\n\n![图](assets/图.png)\n\n正文");
  expect(invoke.mock.calls.filter(([,args])=>args?.method==="draft_preview")).toHaveLength(1);
  expect(invoke).toHaveBeenCalledWith("editorial_call", {method: "draft_preview", params: {
    id: "draft-one", markdown: "![image](<assets/图.png>)", embedImages: true, includeImageSources: true,
  }});
  expect(host.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png/);
  const editor = instance();
  await act(async () => {editor.commands.insertContentAt(3, "新增");});
  const markdown = change.mock.calls.at(-1)![0];
  await render(markdown);
  expect(invoke.mock.calls.filter(([,args])=>args?.method==="draft_preview")).toHaveLength(1);
  expect(markdown).toContain("![图](assets/图.png)");
  expect(markdown).not.toContain("base64");
});

it("keeps an image attached with the same source while typing, selecting and echoing saved prose", async () => {
  await render("第一段正文\n\n![图](assets/图.png)\n\n图片后的正文");
  const editor = instance(), image = host.querySelector("img")!;
  const detached: MutationRecord[] = [], sources: MutationRecord[] = [];
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes" && record.target === image) sources.push(record);
      if ([...record.removedNodes].some(node => node === image || node.contains(image))) detached.push(record);
    }
  });
  observer.observe(host, {subtree: true, childList: true, attributes: true, attributeFilter: ["src"]});
  try {
    for (let i = 0; i < 3; i++) {
      await act(async () => {editor.commands.insertContentAt(2, "新增");});
      await render(change.mock.calls.at(-1)![0]);
      await act(async () => {editor.commands.setTextSelection({from: 2, to: 4});});
      await act(async () => {editor.commands.setTextSelection(4);});
    }
    expect(host.querySelector("img")).toBe(image);
    expect(detached).toHaveLength(0);
    expect(sources).toHaveLength(0);
    expect(invoke.mock.calls.filter(([,args])=>args?.method==="draft_preview")).toHaveLength(1);
  } finally {observer.disconnect();}
});

it("does not reconfigure the editor when background refreshes leave the manuscript unchanged", async () => {
  const text = "第一段正文\n\n![图](assets/图.png)\n\n图片后的正文";
  await render(text);
  const editor = instance(), update = vi.spyOn(editor.view, "updateState");
  try {
    for (let i = 0; i < 4; i++) await render(text);
    expect(update).not.toHaveBeenCalled();
    expect(invoke.mock.calls.filter(([,args])=>args?.method==="draft_preview")).toHaveLength(1);
  } finally {update.mockRestore();}
});

it("formatting the selection produces compatible Markdown and disabled mode stays readonly", async () => {
  await render("正文内容");
  await act(async () => {instance().commands.setTextSelection({from: 2, to: 4});(host.querySelector('[aria-label="加粗 ⌘B"]') as HTMLButtonElement).click();});
  expect(change.mock.calls.at(-1)![0]).toBe("**正文**内容");
  await render(change.mock.calls.at(-1)![0], true);
  expect(instance().isEditable).toBe(false);
  expect((host.querySelector('[aria-label="加粗 ⌘B"]') as HTMLButtonElement).disabled).toBe(true);
});

it("preserves unsupported source blocks alongside editable paragraphs", async () => {
  await render("正文\n\n<!-- important source note -->");
  expect(host.querySelector('[contenteditable="true"]')).not.toBeNull();
  const source=host.querySelector<HTMLTextAreaElement>('textarea[data-row-id]')!;
  expect(source.value).toBe("<!-- important source note -->");
  expect(change).not.toHaveBeenCalled();
  await act(async()=>{instance().commands.insertContentAt(2,"新增");});
  expect(change.mock.calls.at(-1)![0]).toContain("<!-- important source note -->");
});

it("locks a structured record's section headings while leaving the prose free, and lets a missing one be restored", async () => {
  const error = vi.fn();
  const record = "# 标题\n\n## 事实摘要\n\n甲\n\n## 学术意义\n\n乙\n";
  await act(async () => root.render(createElement(EditorialRichEditor, {articleId: "draft-one", text: record, disabled: false, onChange: change, onError: error, lockedHeadings: ["事实摘要", "学术意义"]})));
  const editor = instance();
  const headings = () => {const found: string[] = [];editor.state.doc.descendants(node => {if (node.type.name === "heading" && node.attrs.level === 2) found.push(node.textContent);});return found;};
  const at = (label: string) => {let position = -1;editor.state.doc.descendants((node, offset) => {if (["heading","paragraph"].includes(node.type.name) && node.textContent === label) position = offset;});return position;};
  expect(host.querySelectorAll("h2.is-locked-heading")).toHaveLength(2);
  // Renaming, deleting and duplicating a fixed section are all refused.
  await act(async () => {editor.commands.insertContentAt(at("事实摘要") + 1, "新");});
  expect(headings()).toEqual(["事实摘要", "学术意义"]);
  await act(async () => {const from = at("学术意义");editor.commands.deleteRange({from, to: from + editor.state.doc.nodeAt(from)!.nodeSize});});
  expect(headings()).toEqual(["事实摘要", "学术意义"]);
  await act(async () => {editor.commands.insertContentAt(editor.state.doc.content.size, {type:"notebookBlock",attrs:{note:{id:"duplicate",type:"heading",level:2,text:"事实摘要",state:"ready",sourceIds:[]}},content:[{type: "heading", attrs: {level: 2}, content: [{type: "text", text: "事实摘要"}]}]});});
  expect(headings()).toEqual(["事实摘要", "学术意义"]);
  await act(async () => {await Promise.resolve();});
  expect(error).toHaveBeenCalled();expect(String(error.mock.calls[0][0])).toContain("固定章节");
  expect(change).not.toHaveBeenCalled();
  // Prose inside a section is still editable.
  await act(async () => {editor.commands.insertContentAt(at("甲") + 1, "新增");});
  expect(editor.getText()).toContain("新增甲");expect(change).toHaveBeenCalled();
});

it("lets a broken record be repaired by typing a missing section heading back in", async () => {
  await act(async () => root.render(createElement(EditorialRichEditor, {articleId: "draft-one", text: "# 标题\n\n## 事实摘要\n\n甲\n", disabled: false, onChange: change, lockedHeadings: ["事实摘要", "学术意义"]})));
  const editor = instance();
  await act(async () => {editor.commands.insertContentAt(editor.state.doc.content.size, {type:"notebookBlock",attrs:{note:{id:"missing",type:"heading",level:2,text:"学术意义",state:"ready",sourceIds:[]}},content:[{type: "heading", attrs: {level: 2}, content: [{type: "text", text: "学术意义"}]}]});});
  const found: string[] = [];editor.state.doc.descendants(node => {if (node.type.name === "heading" && node.attrs.level === 2) found.push(node.textContent);});
  expect(found).toEqual(["事实摘要", "学术意义"]);
});

it('keeps Enter and Shift Enter editable through parent echoes without resetting the view',async()=>{
 await render('# 原稿\n\n正文');const editor=instance(),dom=editor.view.dom;
 for(const shiftKey of [false,false,true]){
  await act(async()=>{editor.commands.setTextSelection(editor.state.doc.content.size-2);dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey,bubbles:true,cancelable:true}));});
  const value=change.mock.calls.at(-1)![0],position=editor.state.selection.from;
  await render(value);expect(host.querySelector('.tiptap')).toBe(dom);expect(editor.isEditable).toBe(true);expect(editor.state.selection.from).toBe(position);
 }
 await act(async()=>editor.commands.insertContent('换行后的正文'));expect(change.mock.calls.at(-1)![0]).toContain('换行后的正文');
});

it('supports Cmd Z, Shift Cmd Z and visible history controls after parent save echoes',async()=>{
 await render('原文');const editor=instance();
 const undo=()=>host.querySelector<HTMLButtonElement>('[aria-label="撤销"]')!;
 const redo=()=>host.querySelector<HTMLButtonElement>('[aria-label="重做"]')!;
 expect(undo().disabled).toBe(true);expect(redo().disabled).toBe(true);
 await act(async()=>{editor.commands.insertContentAt(2,'新增');});
 await render(change.mock.calls.at(-1)![0]);expect(undo().disabled).toBe(false);
 const key=async(shiftKey=false)=>act(async()=>editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,shiftKey,bubbles:true,cancelable:true})));
 await key();expect(editor.getText()).not.toContain('新增');expect(redo().disabled).toBe(false);
 await key(true);expect(editor.getText()).toContain('新增');
 await act(async()=>undo().click());expect(editor.getText()).not.toContain('新增');
 await act(async()=>redo().click());expect(editor.getText()).toContain('新增');
 await render(change.mock.calls.at(-1)![0],true);expect(undo().disabled).toBe(true);expect(redo().disabled).toBe(true);
});

it('undoes and redoes insertion and deletion of whole blocks with keyboard history',async()=>{
 await render('第一段\n\n第二段');const editor=instance();
 const hostKeys=async(key:string,shiftKey=false)=>act(async()=>host.querySelector('[aria-label="内容块操作区"]')!.dispatchEvent(new KeyboardEvent('keydown',{key,metaKey:key==='z',shiftKey,bubbles:true,cancelable:true})));
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="选择或拖动内容块 1"]')!.click());
 await hostKeys('Backspace');expect(editor.getText()).not.toContain('第一段');
 await hostKeys('z');expect(editor.getText()).toContain('第一段');
 await hostKeys('z',true);expect(editor.getText()).not.toContain('第一段');
 await hostKeys('z');
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="在末尾插入内容块"]')!.click());
 expect(editor.state.doc.childCount).toBe(3);
 await hostKeys('z');expect(editor.state.doc.childCount).toBe(2);
 await hostKeys('z',true);expect(editor.state.doc.childCount).toBe(3);
});


it("shows saved private notes at their matching row without putting them in the document or clipboard",async()=>{
 invoke.mockImplementation(async(_command,args)=>args.method==='draft_private_notes'?{internalNotes:{writing:'TITLE_PRIVATE'},modelSignatures:[],blockNotes:{original:{notes:{verification:'ROW_PRIVATE'},anchor:{type:'paragraph',text:'对应正文'}}}}:{imageSources:{}});
 await render('# 标题\n\n对应正文\n\n无备注正文');
 const rows=host.querySelectorAll('.notebook-row');
 expect(rows[0].querySelector('.notebook-private-trigger')).not.toBeNull();expect(rows[1].querySelector('.notebook-private-trigger')).not.toBeNull();expect(rows[2].querySelector('.notebook-private-trigger')).toBeNull();
 expect(instance().getText()).not.toContain('PRIVATE');expect(instance().getHTML()).not.toContain('PRIVATE');
 await act(async()=>rows[1].querySelector<HTMLButtonElement>('button.notebook-private-trigger')!.focus());
 expect(document.querySelector('[role=dialog]')!.textContent).toContain('ROW_PRIVATE');expect(document.querySelector('[role=dialog]')!.textContent).not.toContain('TITLE_PRIVATE');
 expect(change).not.toHaveBeenCalled();
});
