import {Extension, Mark, Node, type Extensions} from "@tiptap/core";
import {Plugin, PluginKey} from "@tiptap/pm/state";
import {Decoration, DecorationSet} from "@tiptap/pm/view";
import type {Node as ProseMirrorNode} from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import {TableKit} from "@tiptap/extension-table";
import {TaskItem, TaskList} from "@tiptap/extension-list";
import {Markdown} from "@tiptap/markdown";
import {marked} from "marked";
import { tr } from "../uiText";

export type EditorialImageStore = {
  sources: Record<string, string | null>;
  listeners: Set<() => void>;
};
export const createEditorialImageStore = (): EditorialImageStore => ({sources: {}, listeners: new Set()});

const Highlight = Mark.create({
  name: "editorialHighlight",
  parseHTML: () => [{tag: "mark"}],
  renderHTML: () => ["mark", 0],
  renderMarkdown: (node, helpers) => `<mark>${helpers.renderChildren(node)}</mark>`,
});

const InlineFormula = Node.create({
  name: "editorialFormula", group: "inline", inline: true, atom: true,
  addAttributes: () => ({source: {default: ""}}),
  parseHTML: () => [{tag: "span[data-editorial-formula]", getAttrs: element => ({source: (element as HTMLElement).dataset.editorialFormula})}],
  renderHTML: ({node}) => ["span", {"data-editorial-formula": node.attrs.source, class: "editorial-rich-formula", title: tr("公式原文；可在 Markdown 模式编辑")}, node.attrs.source],
  markdownTokenizer: {
    name: "editorialFormula", level: "inline", start: source => source.indexOf("\\("),
    tokenize(source) {const match = /^\\\([^\n]*?\\\)/.exec(source);return match ? {type: "editorialFormula", raw: match[0], text: match[0]} : undefined;},
  },
  parseMarkdown: (token, helpers) => helpers.createNode("editorialFormula", {source: token.raw}),
  renderMarkdown: node => String(node.attrs?.source || ""),
});

export function safeEditorialImageSource(source: string, images: EditorialImageStore): string | null {
  if (/^https?:\/\//i.test(source)) return source;
  let decoded = source;
  try {decoded = decodeURIComponent(source);} catch {return null;}
  const resolved = images.sources[source] ?? images.sources[decoded];
  return resolved && /^data:image\/(png|jpeg|webp);base64,/i.test(resolved) ? resolved : null;
}

function manuscriptImage(images: EditorialImageStore) {
  return Image.extend({
    renderMarkdown: node => {
      const source = String(node.attrs?.src || "");
      const alt = String(node.attrs?.alt || "").replace(/[\\\[\]]/g, "\\$&");
      const title = String(node.attrs?.title || "").replace(/[\\"]/g, "\\$&");
      const destination = /[\s()]/.test(source) ? `<${source.replace(/>/g, "%3E")}>` : source;
      return `![${alt}](${destination}${title ? ` "${title}"` : ""})`;
    },
    // Keep source references in document attributes. Embedded preview bytes live
    // only in the DOM node view, and can never enter getMarkdown().
    addNodeView() {
      return ({node: initialNode}) => {
        let node = initialNode;
        const dom = document.createElement("span");
        dom.className = "editorial-rich-image";
        dom.contentEditable = "false";
        const image = document.createElement("img");
        image.draggable = false;
        const message = document.createElement("span");
        message.className = "editorial-rich-image-message";
        dom.append(image, message);
        const update = () => {
          const source = String(node.attrs.src || "");
          const resolved = safeEditorialImageSource(source, images);
          image.alt = String(node.attrs.alt || "");
          image.title = String(node.attrs.title || node.attrs.alt || "");
          dom.dataset.imageSource = source;
          if (resolved) {
            if (image.getAttribute("src") !== resolved) image.src = resolved;
            image.hidden = false;
            message.hidden = true;
          } else {
            image.removeAttribute("src");
            image.hidden = true;
            message.hidden = false;
            message.textContent = tr("图片：{{name}}（预览待加载或文件不可用）", {name: node.attrs.alt || source});
          }
        };
        image.onerror = () => {message.hidden = false;message.textContent = tr("图片无法显示：{{name}}", {name: node.attrs.alt || node.attrs.src});};
        images.listeners.add(update);
        update();
        return {dom, update(next) {if (next.type !== node.type) return false;node = next;update();return true;},
          ignoreMutation: () => true, destroy() {images.listeners.delete(update);}};
      };
    },
  }).configure({inline: true});
}

const lockedIn = (doc: ProseMirrorNode, labels: Set<string>) => {
  const found: string[] = [];
  doc.descendants(node => { if (node.type.name === "heading" && node.attrs.level === 2 && labels.has(node.textContent)) found.push(node.textContent); });
  return found;
};
/** A structured record's "## 标题" sections map to fields, so in rich text they cannot be renamed,
 *  removed, reordered or duplicated. A missing one may still be typed back in to repair a record.
 *  Programmatic loads (setContent without an update) pass through untouched. */
export function lockedHeadings(labels: string[], onBlocked: (label: string) => void) {
  const set = new Set(labels);
  return Extension.create({
    name: "lockedHeadings",
    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey("lockedHeadings"),
        filterTransaction(transaction, state) {
          if (!transaction.docChanged || transaction.getMeta("preventUpdate")) return true;
          const before = lockedIn(state.doc, set), after = lockedIn(transaction.doc, set);
          if (after.filter(label => before.includes(label)).join("\n") === before.join("\n")) return true;
          onBlocked(before.find(label => !after.includes(label)) || after.find((label, index) => after.indexOf(label) !== index) || before[0] || labels[0]);
          return false;
        },
        props: {
          decorations(state) {
            const marks: Decoration[] = [];
            state.doc.descendants((node, position) => {
              if (node.type.name === "heading" && node.attrs.level === 2 && set.has(node.textContent)) marks.push(Decoration.node(position, position + node.nodeSize, {class: "is-locked-heading", title: tr("固定章节：对应官网字段，不能改名或删除")}));
            });
            return DecorationSet.create(state.doc, marks);
          },
        },
      })];
    },
  });
}
export function editorialRichExtensions(images = createEditorialImageStore()): Extensions {
  return [
    StarterKit.configure({underline: false, trailingNode: false, link: {openOnClick: false, autolink: false}}),
    manuscriptImage(images), TableKit, TaskList, TaskItem.configure({nested: true}), Highlight, InlineFormula,
    Markdown.configure({markedOptions: {gfm: true, breaks: false}}),
  ];
}

export function editorialImageReferences(markdown: string): string[] {
  const sources = new Set<string>();
  marked.walkTokens(marked.lexer(markdown), token => {if (token.type === "image") sources.add(token.href);});
  return [...sources].sort();
}

// Unknown rich-text syntax must never be silently dropped on the first edit.
// Markdown mode remains fully editable for these documents.
export function richMarkdownIssue(markdown: string): string | null {
  if (/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(markdown)) return tr("这篇稿件含 YAML 元数据，请使用 Markdown 编辑以保留原格式。");
  if (/^\s*\[\^[^\]]+\]:/m.test(markdown)) return tr("这篇稿件含脚注，请使用 Markdown 编辑以保留脚注。");
  if ([...markdown.matchAll(/<mark>([\s\S]*?)<\/mark>/gi)].some(match => /[\\*_`\[\]<>]/.test(match[1]))) return tr("这篇稿件的高亮片段含嵌套格式，请使用 Markdown 编辑以保留原格式。");
  let unsupported = false, formula = false;
  marked.walkTokens(marked.lexer(markdown), token => {
    if (token.type === "html" && !/^<\/?mark>$/i.test(token.raw.trim())) unsupported = true;
    if (["paragraph", "text", "heading"].includes(token.type) && /(^|\n)\s*\$\$|^\s*\\\[\s*$/m.test(token.raw)) formula = true;
  });
  if (formula) return tr("这篇稿件含数学公式，请使用 Markdown 编辑以保留公式。");
  return unsupported ? tr("这篇稿件含 HTML 或注释，请使用 Markdown 编辑以完整保留这些内容。") : null;
}
