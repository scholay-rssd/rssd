// @vitest-environment jsdom
import {act, createElement} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import EditorialTree, {buildEditorialTree, compactEditorialTree, type EditorialTreeEntry} from "../editorial/EditorialTree";

const entries: EditorialTreeEntry[] = [
  {id: "article-one", shortTitle: "学术情报", canonicalPath: "articles/annex/新闻聚合/01_学术情报/正文.md", batchDate: null},
  {id: "article-two", shortTitle: "有用的论文", canonicalPath: "articles/2026-09/2026-09-30_03_有用的论文/正文.md", batchDate: "2026-09-30"},
  {id: "article-three", shortTitle: "华为新机", canonicalPath: "articles/2026-10/2026-10-02_01_华为新机/正文.md", batchDate: "2026-10-02"},
];

describe("manuscript directory tree", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onSelect = vi.fn();
  const onOpenDirectory = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    document.documentElement.dataset.platform = "mac";
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    onSelect.mockReset(); onOpenDirectory.mockReset();
  });
  afterEach(() => {act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();});
  const render = async (extra: object = {}) => {await act(async () => root.render(createElement(EditorialTree, {entries, query: "", onSelect, onOpenDirectory, ...extra})));};
  const row = (path: string) => Array.from(host.querySelectorAll<HTMLElement>("[role=treeitem]")).find(item => item.dataset.path === path)!;
  const key = async (element: HTMLElement, value: string) => {await act(async () => element.dispatchEvent(new KeyboardEvent("keydown", {key: value, bubbles: true})));};

  it("preserves month and annex directory hierarchy with recent month first", () => {
    const tree = buildEditorialTree(entries);
    expect(tree.children.map(node => node.name)).toEqual(["2026-10", "2026-09", "annex"]);
    expect(tree.count).toBe(3);
    const annex = tree.children[2];
    expect(annex.children[0].path).toBe("articles/annex/新闻聚合");
    expect(annex.children[0].children[0].children[0].entry?.id).toBe("article-one");
    expect(buildEditorialTree([{...entries[0], canonicalPath: "articles/../secret/正文.md"}]).count).toBe(0);
  });

  it("shows indexed titles directly within groups while preserving canonical paths", async () => {
    await render({selectedId: "article-one"});
    expect(row("articles")).toBeUndefined();
    expect(row("articles/annex")).toBeUndefined();
    expect(row("articles/annex/新闻聚合/01_学术情报")).toBeUndefined();
    expect(row("articles/annex/新闻聚合").getAttribute("aria-expanded")).toBe("true");
    const manuscript = row(entries[0].canonicalPath);
    expect(manuscript.getAttribute("aria-selected")).toBe("true");
    expect(manuscript.querySelector('.editorial-tree-name')?.textContent).toBe("学术情报");
    expect(manuscript.getAttribute('title')).toContain(entries[0].canonicalPath);
    expect(manuscript.getAttribute('aria-level')).toBe('2');
    await act(async () => manuscript.click());
    expect(onSelect).toHaveBeenCalledWith(entries[0]);
  });

  it("search retains matching ancestors and clears to the complete tree", async () => {
    await render({query: "学术情报"});
    expect(row(entries[0].canonicalPath)).toBeTruthy();
    expect(row("articles/2026-09")).toBeUndefined();
    expect(row("articles/annex/新闻聚合")).toBeTruthy();
    await render({query: "no result"});
    expect(host.textContent).toContain("没有匹配的稿件");
    await render();
    expect(row("articles/2026-10")).toBeTruthy();
  });

  it("opens groups and actual manuscript directories, preserving the dirty draft", async () => {
    await render({dirty: true, selectedId: "article-one"});
    const folder = row("articles/annex/新闻聚合");
    await act(async () => folder.querySelector<HTMLButtonElement>("button")!.click());
    expect(document.querySelector("[role=menu]")?.textContent).toContain("当前未保存输入会保留");
    const cursor = Array.from(document.querySelectorAll<HTMLButtonElement>("[role=menuitem]")).find(button => button.textContent?.includes("Cursor"))!;
    await act(async () => cursor.click());
    expect(onOpenDirectory).toHaveBeenCalledWith("articles/annex/新闻聚合", "cursor");
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => row(entries[0].canonicalPath).querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[role=menuitem]")!.click());
    expect(onOpenDirectory).toHaveBeenLastCalledWith("articles/annex/新闻聚合/01_学术情报", "finder");
  });

  it("supports tree keyboard navigation and menu dismissal without selecting a manuscript", async () => {
    await render();
    await act(async () => row("articles/2026-10").focus());
    await key(row("articles/2026-10"), "ArrowRight");
    const folder = row("articles/2026-10");
    expect(document.activeElement).toBe(row(entries[2].canonicalPath));
    await key(row(entries[2].canonicalPath), "Enter");
    expect(onSelect).toHaveBeenCalledWith(entries[2]);
    await key(row(entries[2].canonicalPath), "ArrowLeft");
    expect(document.activeElement).toBe(folder);
    await key(folder, "ContextMenu");
    const menu = document.querySelector<HTMLElement>("[role=menu]")!;
    expect(menu).not.toBeNull();
    await key(menu, "Escape");
    expect(document.querySelector("[role=menu]")).toBeNull();
    expect(document.activeElement).toBe(folder);
  });

  it("reports opening failures and prevents opening while disabled", async () => {
    onOpenDirectory.mockRejectedValueOnce(new Error("Cursor 未安装"));
    await render();
    await act(async () => row("articles/2026-10").querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[role=menuitem]")!.click());
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Cursor 未安装");
    await render({disabled: true});
    expect(row("articles/2026-10").querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    await key(row("articles/2026-10"), "ContextMenu");
    expect(document.querySelector("[role=menu]")).toBeNull();
    expect(onOpenDirectory).toHaveBeenCalledTimes(1);
  });

  it("never merges separate indexed manuscripts that share a folder", () => {
    const first={...entries[0],canonicalPath:'articles/annex/新闻聚合/共用/甲.md'};
    const second={...entries[1],canonicalPath:'articles/annex/新闻聚合/共用/乙.md'};
    const tree=compactEditorialTree(buildEditorialTree([first,second]));
    const shared=tree.children[0].children[0];
    expect(shared.entry).toBeUndefined();
    expect(shared.children.map(x=>x.entry?.id).sort()).toEqual(['article-one','article-two']);
    expect(shared.children.every(x=>x.parentPath===shared.path)).toBe(true);
  });
});
