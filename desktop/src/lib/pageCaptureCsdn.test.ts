import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../src-tauri/src/page_view.rs", import.meta.url), "utf8");
const script = source.split('const CAPTURE_SCRIPT: &str = r#"')[1].split('"#;')[0];
const target = "https://blog.csdn.net/author/article/details/166988392";
const title = "人从众挤爆门店！华为 Mate 90 发售！";

function capture(options: { body?: string; url?: string; titleInside?: boolean } = {}) {
  const heading = `<h1 id="articleContentId" class="title-article">${title}</h1>`;
  const content = options.body ?? `<div id="article_content"><div id="content_views"><p>公开作品的正文事实与来源。</p><p><img src="https://img.example.org/original.png?size=1200" alt="原图" onerror="alert(1)"></p><p>图片之后的正文段落。</p></div><div class="recommend-box"><p>文章容器外的相关推荐</p></div></div>`;
  const recommendations = Array.from({ length: 20 }, (_, n) => `<p>无关推荐第 ${n} 条</p>`).join("");
  const dom = new JSDOM(`<title>${title} - CSDN博客</title><nav>导航菜单</nav><main>
    ${options.titleInside ? "" : heading}<article>${options.titleInside ? heading : ""}${content}</article>
    <section class="recommend-box">${recommendations}</section><div id="main-footer"><p>网站页尾备案信息</p></div>
    </main><aside>侧栏排行榜</aside><footer>网站导航页尾</footer>`, { url: options.url ?? target, runScripts: "outside-only" });
  dom.window.Element.prototype.getClientRects = function () { return [{}] as unknown as DOMRectList; };
  const result = JSON.parse(dom.window.eval(script));
  return { result, dom };
}

describe("CSDN rendered source capture", () => {
  it("keeps the post title, complete body and original image without main-column recommendations or footer", () => {
    const { result, dom } = capture();
    expect(result.bodyFallback).toBe(false);
    expect(result.text).toContain(title);
    expect(result.text).toContain("公开作品的正文事实与来源。");
    expect(result.text).toContain("图片之后的正文段落。");
    expect(result.text).not.toMatch(/推荐|页尾|导航|排行榜/);
    expect(result.html).toContain(`<h1>${title}</h1>`);
    expect(result.html).toContain('src="https://img.example.org/original.png?size=1200"');
    expect(result.html).not.toMatch(/推荐|页尾|onerror|alert\(/);
    expect(dom.window.document.querySelectorAll(".recommend-box p")).toHaveLength(21);
    expect(dom.window.document.querySelector("img")?.getAttribute("onerror")).toBe("alert(1)");
  });

  it.each([
    ['<div id="article_content"><p>备用正文容器。</p></div>', "备用正文容器。"],
    ['<p>语义 article 中的正文。</p>', "语义 article 中的正文。"],
    ['<div id="content_views" hidden><p>隐藏的模板正文</p></div><div id="article_content"><p>可见正文容器。</p></div>', "可见正文容器。"],
  ])("falls back to a visible body or article before the surrounding main (%s)", (body, expected) => {
    const { result } = capture({ body });
    expect(result.text).toContain(expected);
    expect(result.text).toContain(title);
    expect(result.text).not.toMatch(/推荐|页尾|隐藏的模板正文/);
  });

  it("does not duplicate a title already inside the selected article", () => {
    const { result } = capture({ body: "<p>没有专用 div 的正文。</p>", titleInside: true });
    expect(result.text.split(title)).toHaveLength(2);
    expect(result.html.match(/<h1>/g)).toHaveLength(1);
  });

  it.each(["https://blog.csdn.net.evil.example/author/article/details/123", "https://example.org/author/article/details/123", "https://blog.csdn.net/author"])("leaves unrelated site/listing root selection unchanged (%s)", url => {
    const { result } = capture({ url });
    // These synthetic pages intentionally have a larger main column, which
    // remains the existing generic policy outside the scoped article rule.
    expect(result.text).toContain("无关推荐第 19 条");
  });
});
