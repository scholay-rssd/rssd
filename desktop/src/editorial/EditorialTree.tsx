import {useEffect, useId, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import "./editorial-tree.css";
import {SYNC_LABELS,type DraftSync} from '../publications/websitePublishing';

import { tr } from "../uiText";
export type EditorialTreeEntry = {id: string; shortTitle: string; canonicalPath: string; batchDate: string | null; sync?:DraftSync};
export type EditorialDirectoryTarget = "finder" | "cursor";
export type EditorialTreeNode = {
  path: string; name: string; parentPath: string | null; depth: number;
  children: EditorialTreeNode[]; entry?: EditorialTreeEntry; count: number;
};

/** The index supplies paths relative to editorial/, retaining the on-disk hierarchy. */
export function buildEditorialTree(entries: EditorialTreeEntry[]): EditorialTreeNode {
  const root: EditorialTreeNode = {path: "articles", name: "articles", parentPath: null, depth: 1, children: [], count: 0};
  const folders = new Map([[root.path, root]]);
  for (const entry of entries) {
    const parts = entry.canonicalPath.split("/");
    if (parts[0] !== "articles" || parts.length < 3 || parts.some(part => !part || part === "." || part === ".." || part.includes("\\"))) continue;
    let parent = root;
    root.count++;
    for (let index = 1; index < parts.length - 1; index++) {
      const path = parts.slice(0, index + 1).join("/");
      let folder = folders.get(path);
      if (!folder) {
        folder = {path, name: parts[index], parentPath: parent.path, depth: index + 1, children: [], count: 0};
        folders.set(path, folder);
        parent.children.push(folder);
      }
      folder.count++;
      parent = folder;
    }
    parent.children.push({path: entry.canonicalPath, name: parts.at(-1)!, parentPath: parent.path, depth: parts.length, children: [], count: 1, entry});
  }
  const sort = (node: EditorialTreeNode) => {
    node.children.sort((a, b) => {
      if (!!a.entry !== !!b.entry) return a.entry ? 1 : -1;
      if (/^\d{4}-\d{2}/.test(a.name) && /^\d{4}-\d{2}/.test(b.name)) return b.name.localeCompare(a.name, "zh-CN", {numeric: true});
      return a.name.localeCompare(b.name, "zh-CN", {numeric: true});
    });
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

/** The index owns manuscript identity/title; folders only provide grouping and open paths. */
export function compactEditorialTree(root: EditorialTreeNode): EditorialTreeNode {
  const compact = (node: EditorialTreeNode, parentPath: string | null, depth: number): EditorialTreeNode => {
    if (!node.entry && node.children.length === 1 && node.children[0].entry) {
      return compact(node.children[0], parentPath, depth);
    }
    return {...node, name: node.entry?.shortTitle || node.name, parentPath, depth,
      children: node.children.map(child => compact(child, node.path, depth + 1))};
  };
  const groups = root.children.flatMap(node => node.path === 'articles/annex' ? node.children : [node]);
  return {...root, depth: 0, children: groups.map(node => compact(node, null, 1))};
}

function ancestors(path: string) {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

function folderPaths(node: EditorialTreeNode): string[] {
  return node.entry ? [] : [node.path, ...node.children.flatMap(folderPaths)];
}

function Icon({file, expanded}: {file?: boolean; expanded?: boolean}) {
  return <svg className="editorial-tree-icon" viewBox="0 0 20 20" aria-hidden="true">
    {file ? <><path d="M5 2.5h6l4 4v11H5z"/><path d="M11 2.5v4h4M8 10h4m-4 3h4"/></> : <path d={expanded ? "M2.5 7V4h5l2 2h8v2M2.5 7h15l-2 9h-12z" : "M2.5 5h5l2 2h8v9h-15z"}/>}
  </svg>;
}

type MenuState = {node: EditorialTreeNode; trigger: HTMLElement; left: number; top: number};
export default function EditorialTree({entries, selectedId, query, disabled = false, dirty = false, onSelect, onOpenDirectory}: {
  entries: EditorialTreeEntry[]; selectedId?: string; query: string; disabled?: boolean; dirty?: boolean;
  onSelect: (entry: EditorialTreeEntry) => void;
  onOpenDirectory: (path: string, target: EditorialDirectoryTarget) => void | Promise<void>;
}) {
  const search = query.trim().toLocaleLowerCase();
  const matches = useMemo(() => entries.filter(entry => !search || `${entry.shortTitle} ${entry.canonicalPath}`.toLocaleLowerCase().includes(search)), [entries, search]);
  const root = useMemo(() => compactEditorialTree(buildEditorialTree(matches)), [matches]);
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [focused, setFocused] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const tree = useRef<HTMLDivElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  const didExpandInitial = useRef(false);
  const lastRevealed = useRef<string | undefined>(undefined);
  const menuId = useId();
  const selected = entries.find(entry => entry.id === selectedId);

  useEffect(() => {
    if (search) setExpanded(new Set(folderPaths(root)));
    else if (!didExpandInitial.current && root.children.length) {
      didExpandInitial.current = true;
      setExpanded(previous => new Set([...previous, root.children[0].path]));
    }
  }, [root, search]);
  useEffect(() => {
    if (!selected) return;
    setExpanded(previous => new Set([...previous, ...ancestors(selected.canonicalPath)]));
    setFocused(selected.canonicalPath);
  }, [selected?.canonicalPath, root]);
  useEffect(() => {
    if (!selected || lastRevealed.current === selected.canonicalPath) return;
    const row = Array.from(tree.current?.querySelectorAll<HTMLElement>("[role=treeitem]") || []).find(item => item.dataset.path === selected.canonicalPath);
    if (row) {row.scrollIntoView?.({block: "nearest"}); lastRevealed.current = selected.canonicalPath;}
  }, [selected?.canonicalPath, expanded]);
  useEffect(() => {if (disabled) setMenu(null);}, [disabled]);
  useEffect(() => {
    if (!menu) return;
    menuPanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!menuPanel.current?.contains(event.target as Node) && !menu.trigger.contains(event.target as Node)) setMenu(null);
    };
    const close = () => setMenu(null);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", close);
    tree.current?.addEventListener("scroll", close);
    const element = tree.current;
    return () => {document.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", close); element?.removeEventListener("scroll", close);};
  }, [menu]);

  const rows: {node: EditorialTreeNode; position: number; size: number}[] = [];
  const visit = (node: EditorialTreeNode, position: number, size: number) => {
    rows.push({node, position, size});
    if (expanded.has(node.path)) node.children.forEach((child, index) => visit(child, index + 1, node.children.length));
  };
  root.children.forEach((node, index) => visit(node, index + 1, root.children.length));
  const tabStop = rows.some(({node}) => node.path === focused) ? focused : rows[0]?.node.path;
  function focus(path: string) {
    setFocused(path);
    tree.current?.querySelectorAll<HTMLElement>("[role=treeitem]").forEach(row => {if (row.dataset.path === path) row.focus();});
  }
  function toggle(path: string) {
    setExpanded(previous => {const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next;});
  }
  function showMenu(node: EditorialTreeNode, trigger: HTMLElement) {
    if (disabled || opening) return;
    const rect = trigger.getBoundingClientRect();
    setOpenError("");
    setMenu({node, trigger, left: Math.max(8, Math.min(rect.left, window.innerWidth - 264)), top: Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - (dirty ? 224 : 172)))});
  }
  async function open(target: EditorialDirectoryTarget) {
    if (!menu || disabled || opening) return;
    const {node, trigger} = menu;
    setMenu(null); setOpening(true); setOpenError(""); trigger.focus();
    const path = node.entry ? node.entry.canonicalPath.split('/').slice(0, -1).join('/') : node.path;
    try {await onOpenDirectory(path, target);} catch (error) {setOpenError(String(error));} finally {setOpening(false);}
  }
  const fileManager = tr(document.documentElement.dataset.platform === "mac" ? "用 Finder 打开目录" : "用文件管理器打开目录");

  return <div className="editorial-directory-tree">
    <div ref={tree} className="editorial-tree-scroll" role="tree" aria-label={tr("稿件目录")} aria-busy={opening}>
      {rows.map(({node, position, size}) => <div key={node.path} className={`editorial-tree-row${node.entry ? " is-file" : " is-directory"}`}
        role="treeitem" tabIndex={disabled ? -1 : node.path === tabStop ? 0 : -1} data-path={node.path}
        aria-level={node.depth} aria-posinset={position} aria-setsize={size} aria-expanded={node.entry ? undefined : expanded.has(node.path)}
        aria-selected={node.entry ? node.entry.id === selectedId : undefined} aria-disabled={disabled || undefined}
        aria-label={node.entry ? `${node.name}${node.entry.sync?'，'+tr(SYNC_LABELS[node.entry.sync.state]):''}` : node.name}
        style={{paddingLeft: `${8 + (node.depth - 1) * 11}px`}}
        title={node.entry ? `${node.entry.shortTitle}\neditorial/${node.path}` : `editorial/${node.path}`}
        onFocus={event => {if (event.target === event.currentTarget) setFocused(node.path);}}
        onClick={event => {
          if (disabled || (event.target as Element).closest("button")) return;
          focus(node.path); if (node.entry) onSelect(node.entry); else toggle(node.path);
        }}
        onContextMenu={event => {event.preventDefault(); showMenu(node, event.currentTarget);}}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || disabled) return;
          const index = rows.findIndex(row => row.node.path === node.path);
          if (event.key === "ArrowDown") {event.preventDefault(); focus(rows[Math.min(index + 1, rows.length - 1)].node.path);}
          else if (event.key === "ArrowUp") {event.preventDefault(); focus(rows[Math.max(index - 1, 0)].node.path);}
          else if (event.key === "Home") {event.preventDefault(); focus(rows[0].node.path);}
          else if (event.key === "End") {event.preventDefault(); focus(rows.at(-1)!.node.path);}
          else if (event.key === "ArrowRight" && !node.entry) {event.preventDefault(); if (!expanded.has(node.path)) toggle(node.path); else if (node.children[0]) focus(node.children[0].path);}
          else if (event.key === "ArrowLeft") {event.preventDefault(); if (!node.entry && expanded.has(node.path)) toggle(node.path); else if (node.parentPath) focus(node.parentPath);}
          else if (event.key === "Enter" || event.key === " ") {event.preventDefault(); if (node.entry) onSelect(node.entry); else toggle(node.path);}
          else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {event.preventDefault(); showMenu(node, event.currentTarget);}
        }}>
        <span className="editorial-tree-chevron" aria-hidden="true">{node.entry ? "" : expanded.has(node.path) ? "⌄" : "›"}</span>
        <Icon file={!!node.entry} expanded={expanded.has(node.path)}/>
        <span className={`editorial-tree-name ${node.entry?.sync?.state==='synced'?'is-synced':''}`}>{node.name}</span>
        {node.entry?.sync&&<span className={'editorial-sync-dot is-'+node.entry.sync.state} title={node.entry.sync.error||tr(SYNC_LABELS[node.entry.sync.state])} aria-hidden="true">{node.entry.sync.state==='synced'?'✓':['conflict','invalid'].includes(node.entry.sync.state)?'!':'●'}</span>}
        {!node.entry && <span className="editorial-tree-count" aria-hidden="true">{node.count}</span>}<button type="button" className="editorial-tree-open"
          disabled={disabled || opening} aria-label={tr("打开目录：{{name}}", {name: node.name})} title={tr("打开 editorial/{{value}}", {value: node.entry ? node.entry.canonicalPath.split('/').slice(0, -1).join('/') : node.path})}
          aria-haspopup="menu" aria-expanded={menu?.node.path === node.path} aria-controls={menu?.node.path === node.path ? menuId : undefined}
          onClick={event => {event.stopPropagation(); if (menu?.node.path === node.path) setMenu(null); else showMenu(node, event.currentTarget);}}>···</button>
      </div>)}
      {search && !matches.length && <p className="editorial-tree-empty">{tr("没有匹配的稿件")}</p>}
    </div>
    {openError && <p className="editorial-tree-error" role="alert">{openError}</p>}
    {menu && createPortal(<div ref={menuPanel} id={menuId} className="editorial-directory-menu" role="menu" aria-label={tr("打开目录 {{name}}", {name: menu.node.name})}
      style={{left: menu.left, top: menu.top}}
      onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget)) setMenu(null);}}
      onKeyDown={event => {
        const buttons = Array.from(menuPanel.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") || []);
        if (event.key === "Escape") {event.preventDefault(); setMenu(null); menu.trigger.focus();}
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {event.preventDefault(); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();}
      }}>
      <p className="editorial-directory-menu-path" title={`editorial/${menu.node.path}`}>{menu.node.name}</p>
      <button type="button" role="menuitem" onClick={() => void open("finder")}><Icon expanded/>{fileManager}</button>
      <button type="button" role="menuitem" onClick={() => void open("cursor")}><span className="editorial-directory-code" aria-hidden="true">⌘</span>{tr("用 Cursor 打开目录")}</button>
      {dirty && <p className="editorial-directory-menu-note">{tr("当前未保存输入会保留；外部编辑器读取磁盘上的文件。")}</p>}
    </div>, document.body)}
  </div>;
}
