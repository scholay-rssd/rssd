// @vitest-environment jsdom
import {readFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {Editor} from "@tiptap/core";
import {marked} from "marked";
import {describe, expect, it} from "vitest";
import {createEditorialImageStore, editorialImageReferences, editorialRichExtensions, richMarkdownIssue} from "../editorial/editorialRichMarkdown";

function editor(markdown: string) {return new Editor({extensions: editorialRichExtensions(), content: markdown, contentType: "markdown"});}
function meaning(markdown: string) {
  const dom = document.createElement("div");
  dom.innerHTML = marked.parse(markdown) as string;
  const text = (node: Element) => node.textContent?.replace(/\s+/g, " ").trim();
  const url = (value: string | null) => {try {return decodeURIComponent(value || "");} catch {return value;}};
  return {
    text: text(dom),
    headings: [...dom.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(node => [node.tagName, text(node)]),
    emphasis: [...dom.querySelectorAll("strong,em,del,mark")].map(node => [node.tagName, text(node)]),
    images: [...dom.querySelectorAll("img")].map(node => [url(node.getAttribute("src")), node.alt, node.title]),
    links: [...dom.querySelectorAll("a")].map(node => [url(node.getAttribute("href")), text(node), node.title]),
    code: [...dom.querySelectorAll("code")].map(node => [node.textContent, node.className]),
    lists: [...dom.querySelectorAll("ul,ol")].map(node => [node.tagName, node.getAttribute("start"), text(node)]),
    quotes: [...dom.querySelectorAll("blockquote")].map(text),
    breaks: dom.querySelectorAll("br").length,
    rules: dom.querySelectorAll("hr").length,
    tables: [...dom.querySelectorAll("th,td")].map(node => [node.tagName, text(node)]),
  };
}

const editorialRoot = resolve(import.meta.dirname, "../../../editorial");
const indexPath = resolve(editorialRoot, "_ops/inventory/article-index.json");
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {articles:{}};
describe.skipIf(!existsSync(indexPath))("canonical manuscripts keep local rich Markdown or a content-free cloud registration (read only)", () => {
  it("registers every manuscript in exactly one storage location", () => {
    const localIds=Object.keys(index.articles),cloudIds=Object.keys(index.cloudArticles||{});
    expect(localIds.length+cloudIds.length).toBeGreaterThan(0);
    expect(new Set([...localIds,...cloudIds]).size).toBe(localIds.length+cloudIds.length);
  });
  for (const [id, entry] of Object.entries(index.articles) as [string, {canonicalPath: string}][]) {
    it(id, () => {
      const markdown = readFileSync(resolve(editorialRoot, entry.canonicalPath), "utf8");
      expect(richMarkdownIssue(markdown)).toBeNull();
      const instance = editor(markdown);
      try {
        const serialized = instance.getMarkdown();
        expect(meaning(serialized)).toEqual(meaning(markdown));
        const again = editor(serialized);
        try {expect(again.getJSON()).toEqual(instance.getJSON());} finally {again.destroy();}
      } finally {instance.destroy();}
    });
  }
  for (const [id,entry] of Object.entries(index.cloudArticles||{}) as [string,{canonicalPath:string;cloud:{version:number;publishedVersion:number|null;sourceSha256:string;archiveId:string;archiveSha256:string;releasedAt:string}}][]) {
    it(`${id} retains its verified cloud marker without local manuscript content`, () => {
      expect(index.articles).not.toHaveProperty(id);
      expect(entry.canonicalPath).toMatch(/^articles\/.+\/正文\.md$/);
      expect(entry.canonicalPath.split('/')).not.toContain('..');
      expect(existsSync(resolve(editorialRoot,entry.canonicalPath))).toBe(false);
      for(const key of ['markdown','body','html','assets','data'])expect(entry).not.toHaveProperty(key);
      expect(Number.isSafeInteger(entry.cloud.version)&&entry.cloud.version>0).toBe(true);
      expect(entry.cloud.publishedVersion===null||(Number.isSafeInteger(entry.cloud.publishedVersion)&&entry.cloud.publishedVersion>0&&entry.cloud.publishedVersion<=entry.cloud.version)).toBe(true);
      expect(entry.cloud.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.cloud.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.cloud.archiveId).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/);
      expect(Number.isFinite(Date.parse(entry.cloud.releasedAt))).toBe(true);
    });
  }
});

it("roundtrips tables, task lists, nested lists, links, fenced code and relative images", () => {
  const markdown = '# Title\n\n**Bold**, *italic*, ~~strike~~ and [link](https://example.org/a?q=1).\n\n- [x] Done\n- [ ] Todo\n  - Nested\n\n| Name | Value |\n| --- | --- |\n| A | `code` |\n\n```js\nconst a = "<tag>";\n```\n\n![Diagram](assets/figure.png "Caption")\n\n<mark>Highlighted</mark>\n';
  const instance = editor(markdown);
  try {expect(meaning(instance.getMarkdown())).toEqual(meaning(markdown));} finally {instance.destroy();}
});

it("keeps image bytes only in the node view and preserves canonical sources while editing", () => {
  const images = createEditorialImageStore();
  images.sources = {"assets/图.png": "data:image/png;base64,iVBORw0KGgo="};
  const instance = new Editor({extensions: editorialRichExtensions(images), content: "![图](assets/图.png)\n\n正文", contentType: "markdown"});
  try {
    const img = instance.view.dom.querySelector("img");
    expect(img?.getAttribute("src")).toBe(images.sources["assets/图.png"]);
    instance.commands.insertContentAt(instance.state.doc.content.size - 1, "修改");
    expect(instance.getMarkdown()).toContain("![图](assets/图.png)");
    expect(instance.getMarkdown()).not.toContain("base64");
    expect(editorialImageReferences(instance.getMarkdown())).toEqual(["assets/图.png"]);
  } finally {instance.destroy();}
});

it("guards unsupported syntax instead of silently deleting it", () => {
  for (const markdown of ['正文\n\n<!-- keep this -->', '<div data-special="yes">正文</div>', '正文[^a]\n\n[^a]: Footnote', '---\ntitle: Keep\n---\n\n正文', '$$\nx^2\n$$', '<mark>before **bold** and ![pic](assets/x.png)</mark>']) {
    expect(richMarkdownIssue(markdown)).not.toBeNull();
  }
  expect(richMarkdownIssue('`<div>`\n\n```html\n<!-- code sample -->\n```')).toBeNull();
});

it("preserves inline LaTeX delimiters and escaped image metadata across repeated edits", () => {
  const formula = '\\((-2.7 \\pm 4.7) \\times 10^{-7}\\)';
  const source = `Result ${formula}.\n\n![a \\[label\\]](<assets/a b(1).png> "A \\\"title\\\"")`;
  const instance = editor(source);
  try {
    const first = instance.getMarkdown();
    expect(first).toContain(formula);
    const again = editor(first);
    try {expect(again.getJSON()).toEqual(instance.getJSON());expect(meaning(again.getMarkdown())).toEqual(meaning(source));} finally {again.destroy();}
  } finally {instance.destroy();}
});
