import { safePageViewUrl } from "../lib/pageViewState";

export interface PublicationSource {
  url: string;
  title: string;
  html: string;
  text: string;
  capturedAt: string;
  truncated: boolean;
  bodyFallback: boolean;
  hasMedia: boolean;
}

const KEEP = new Set("p br hr div span section article main h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tfoot tr td th blockquote pre code strong b em i u s del mark sub sup figure figcaption a img".split(" "));
const DROP = new Set("script style iframe frame object embed noscript template link meta base form input textarea select button svg math canvas video audio nav aside footer".split(" "));

/** A native capture is untrusted page content, not trusted application markup.
 * Rebuild its structural markup without scripts, styling, event handlers,
 * embedded documents or local/executable links. Images keep their source URL. */
export function publicationSourceHtml(source: Pick<PublicationSource, "url" | "html" | "text">): string {
  const doc = new DOMParser().parseFromString(source.html, "text/html");
  const output = document.implementation.createHTMLDocument("");
  const resolve = (value: string | null) => {
    if (!value) return null;
    try { return safePageViewUrl(new URL(value, source.url).href); } catch { return null; }
  };
  const copy = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(output.createTextNode(node.textContent ?? "")); return; }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    if (DROP.has(tag)) return;
    if (!KEEP.has(tag)) { for (const child of Array.from(node.childNodes)) copy(child, parent); return; }
    const element = output.createElement(tag);
    if (tag === "img") {
      const src = resolve(node.getAttribute("src"));
      if (!src) return;
      element.setAttribute("src", src);
      element.setAttribute("alt", node.getAttribute("alt") ?? "");
      element.setAttribute("loading", "lazy");
      element.setAttribute("decoding", "async");
      element.setAttribute("referrerpolicy", "no-referrer");
    }
    if (tag === "a") {
      const href = resolve(node.getAttribute("href"));
      if (href) element.setAttribute("href", href);
      element.setAttribute("rel", "noopener noreferrer nofollow");
    }
    if (tag === "ol") {
      const start = node.getAttribute("start");
      if (start && /^-?\d{1,6}$/.test(start)) element.setAttribute("start", start);
    }
    if (tag === "td" || tag === "th") {
      for (const attribute of ["colspan", "rowspan"]) {
        const value = node.getAttribute(attribute);
        if (value && /^[1-9]\d?$/.test(value)) element.setAttribute(attribute, value);
      }
    }
    parent.appendChild(element);
    for (const child of Array.from(node.childNodes)) copy(child, element);
  };
  for (const node of Array.from(doc.body.childNodes)) copy(node, output.body);
  if (!output.body.textContent?.trim() && !output.body.querySelector("img")) {
    const fallback = output.createElement("pre");
    fallback.className = "pub-source-text";
    fallback.textContent = source.text;
    output.body.appendChild(fallback);
  }
  return output.body.innerHTML;
}
