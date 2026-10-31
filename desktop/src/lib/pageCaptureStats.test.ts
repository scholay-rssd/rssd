import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../src-tauri/src/page_view.rs", import.meta.url), "utf8");
const script = source.split('const CAPTURE_SCRIPT: &str = r#"')[1].split('"#;')[0];
function capture(html: string, url = "https://www.stats.gov.cn/sj/sjjd/202609/t20260930_1965450.html") {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  dom.window.Element.prototype.getClientRects = function () { return [{}] as unknown as DOMRectList; };
  const snapshot = JSON.parse(dom.window.eval(script));
  dom.window.close();
  return snapshot;
}

// The class/tag hierarchy and mixed-case PubDate are from the actual 2026-09-30
// statistics release read in installed-app QA. Text/media here are synthetic;
// desktop/mobile body visibility mirrors the original stylesheet.
function statsFixture(mobile = false, meta = true) {
  return `<title>中国采购经理指数 - 国家统计局</title>
    ${meta ? '<meta name="PubDate" content="2026/09/30 09:30">' : ""}
    <style>${mobile ? ".mhide" : ".pchide"}{display:none}</style>
    <div class="wrapper"><div class="wrapper-nav"><img src="/header-logo.png">网站导航</div>
    <div class="detail-content"><div class="detail-title"><h1>采购经理指数解读</h1>
      <div class="detail-title-des"><h2><p>2026/09/30 09:30</p><span>来源：国家统计局</span></h2>
        <h2><p class="ft">Aa</p><span>字体：</span><a>大</a><a>中</a><a>小</a></h2></div></div>
      <div class="detail-text-content mhide"><div class="txt-content"><p>桌面正文：采购经理指数为50.1，完整保留数据和图表。</p><img src="/chart-desktop.png" alt="统计图"></div></div>
      <div class="mobile-content pchide"><div class="mobile-news-content"><p>移动正文：采购经理指数为50.1，完整保留数据和图表。</p><img src="/chart-mobile.png" alt="统计图"></div></div>
      <div class="detail-text-xgfj—w"><div class="detail-text-xgfj"><ul><li><a href="/attachment.pdf">原始附件</a></li></ul></div></div>
    </div><div class="footer"><p>网站标识码bm36000002</p><img src="/footer-logo.png"></div></div>`;
}

describe("statistics release capture and explicit publication evidence", () => {
  it.each([false, true])("keeps the visible statistics body and attachments without headers/controls/footer (mobile=%s)", mobile => {
    const result = capture(statsFixture(mobile));
    expect(result.bodyFallback).toBe(false);
    expect(result.text).toContain(mobile ? "移动正文" : "桌面正文");
    expect(result.text).not.toContain(mobile ? "桌面正文" : "移动正文");
    expect(result.text).toContain("50.1");
    expect(result.text).toContain("采购经理指数解读");
    expect(result.text).toContain("2026/09/30 09:30");
    expect(result.text).toContain("原始附件");
    expect(result.html).toContain("attachment.pdf");
    expect(result.html).toContain(mobile ? "chart-mobile.png" : "chart-desktop.png");
    expect(result.html).not.toMatch(/header-logo|footer-logo|网站标识码|网站导航|字体|>Aa</);
    expect(result.publishedAt).toBe("2026/09/30 09:30");
    expect(result.dateBasis).toBe("publisher_meta");
  });
  it("uses the exact visible publisher date if the metadata is absent", () => {
    const result = capture(statsFixture(false, false));
    expect(result.publishedAt).toBe("2026/09/30 09:30");
    expect(result.dateBasis).toBe("visible_date_element");
  });
  it("does not apply statistics site selectors to lookalike hosts", () => {
    const result = capture(statsFixture(), "https://www.stats.gov.cn.evil.example/article");
    expect(result.bodyFallback).toBe(true);
  });
  it.each(["PubDate", "DC.Date.Issued", "DCTERMS.ISSUED", "Citation_Publication_Date"])("recognizes explicit %s metadata independent of casing", name => {
    const result = capture(`<meta name="${name}" content="2026-10-05T09:00:00Z"><article><p>原始发布信息与研究资料。</p></article>`, "https://example.org/news");
    expect(result.publishedAt).toBe("2026-10-05T09:00:00Z");
    expect(result.dateBasis).toBe("publisher_meta");
  });
  it("reads publisher header time but does not turn a paragraph deadline or URL date into publication time", () => {
    const published = capture('<article><header><h1>研究新闻</h1><time datetime="2026-10-05">发布于今日</time></header><p>申请截止<time datetime="2026-12-01">12月1日</time></p></article>', "https://example.org/news");
    expect(published.publishedAt).toBe("2026-10-05");
    const noPublisher = capture('<article><h1>活动介绍</h1><p>申请截止<time datetime="2026-12-01">12月1日</time></p></article>', "https://example.org/2026/10/05/news");
    expect(noPublisher.publishedAt).toBeNull();
    expect(noPublisher.dateBasis).toBe("not_provided");
  });
  it("ignores invalid publisher dates and retains explicit labelled publication evidence", () => {
    const result = capture('<meta name="PubDate" content="2026-13-35"><article><header><p class="publish-date">发布日期：2026年10月5日 09:30</p></header><p>原文事实。</p></article>', "https://example.org/news");
    expect(result.publishedAt).toBe("发布日期：2026年10月5日 09:30");
    expect(result.dateBasis).toBe("visible_date_element");
  });
  it("keeps PhilEvents event dates, speakers, details, supporting documents and registration without login/reminder controls", () => {
    const result = capture(`<title>Workshop</title><div>Site navigation and Login</div><div id="content"><div itemscope itemtype="http://schema.org/EducationEvent">
      <div class="rightFloat"><a href="/event/edit/149733">Edit this event</a><img src="/share.png">Share</div>
      <div><h1 itemprop="name">Workshop</h1><meta itemprop="startDate" content="2026-10-01"><meta itemprop="endDate" content="2026-10-02"></div>
      <div class="halfWide"><div class="timeInfo">October 1, 2026 - October 2, 2026</div><div class="locationInfo">University of Copenhagen</div><h2>Speakers:</h2><p>A confirmed speaker</p>
        <div><h2>Details</h2><div itemprop="description"><p>Workshop original research and programme details.</p></div></div>
        <div><h2>Supporting material</h2><a href="/event/files/149733">Add supporting material</a><a href="https://example.org/programme.pdf">Programme PDF</a></div></div>
      <div class="halfWide"><div><h2>Reminders</h2><a href="/calendar">Add to Outlook</a></div><div><h2>Registration</h2><p>Is registration required? No</p></div><div id="attendance"><h2>Who is attending?</h2><p>Account attendee list</p></div></div>
      <div id="contactDialog">Contact popup form</div></div></div><div>Site footer</div>`, "https://philevents.org/event/show/149733");
    expect(result.bodyFallback).toBe(false);
    expect(result.text).toContain("October 1, 2026 - October 2, 2026");
    expect(result.text).toContain("University of Copenhagen");
    expect(result.text).toContain("A confirmed speaker");
    expect(result.text).toContain("Programme PDF");
    expect(result.text).toContain("Is registration required? No");
    expect(result.text).not.toMatch(/Login|Site navigation|Site footer|Edit this event|Add supporting material|Add to Outlook|Account attendee|Contact popup/);
    expect(result.publishedAt).toBeNull();
    expect(result.dateBasis).toBe("not_provided");
  });
});
