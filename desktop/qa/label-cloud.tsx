// Isolated UI fixture: synthetic cloud data only. No remote provider/API,
// personal files, credentials, legacy DOM store, or production database.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LABEL_CLOUD_CACHE_KEY, LABEL_CLOUD_PLATFORMS, LABEL_CLOUD_UI_KEY } from "../src/labels/cloud";
import "@fontsource-variable/inter-tight";
import "../src/styles.css";
import "../src/workspace.css";
const query = new URLSearchParams(location.search);
document.documentElement.dataset.mode = query.get("theme") === "light" ? "light" : "dark";
localStorage.setItem("language", "zh"); localStorage.setItem("mode", document.documentElement.dataset.mode);
localStorage.setItem(LABEL_CLOUD_UI_KEY, JSON.stringify({ sourceId: query.get("platform") || "all" }));
const generatedAt = "2026-10-05T09:17:42Z";
const snapshot = (n: number) => {
  const platform = LABEL_CLOUD_PLATFORMS[n % 7];
  const recommendation = platform.id === "xiaohongshu";
  return { id: `fixture-${n}`, platformId: platform.id, provider: "tikhub", endpointId: `${platform.id}-fixture`, observedAt: new Date(Date.parse(generatedAt) - n * 6781000).toISOString(), period: recommendation ? null : "演示实时榜",
    rows: ["新研究帮助我们认识宇宙", "开放科学工具支持科研协作", "大学里有哪些科研新发现", "从博物馆发现新的研究方向", "跟随数据走近学术新闻"].map((term, i) => ({ id: `word-${i}`, term, kind: i < 3 ? recommendation ? "搜索推荐词" : "热门话题" : "上升话题", rank: recommendation ? null : i + 1, metric: recommendation ? null : { value: 23000 - i * 2000, label: "演示热度", unit: "" }, url: "https://example.invalid/public/" + i })) };
};
const empty = query.has("empty"), configured = !query.has("unconfigured");
const value = { schemaVersion: 1, source: "scholay-cloud-labels", generatedAt, collection: { configured, lastWorkerAt: configured ? generatedAt : null, message: "" },
  budget: { month: "2026-10", currency: "USD", limitMicros: 5000000, spentMicros: query.has("blocked") ? 4999000 : 123000, reservedMicros: 0, remainingMicros: query.has("blocked") ? 1000 : 4877000, blocked: query.has("blocked") },
  platforms: LABEL_CLOUD_PLATFORMS.map(item => ({ id: item.id, name: item.name, status: empty ? "pending" : "ready", message: "", lastObservedAt: empty ? null : generatedAt, nextDueAt: configured ? "2026-10-05T13:17:42Z" : null })), latest: empty ? [] : Array.from({ length: 7 }, (_, n) => snapshot(n)), history: empty ? [] : Array.from({ length: 60 }, (_, n) => snapshot(n)) };
if (query.has("offline")) localStorage.setItem(LABEL_CLOUD_CACHE_KEY, JSON.stringify(value)); else localStorage.removeItem(LABEL_CLOUD_CACHE_KEY);
const calls: string[] = [], blocked: string[] = [];
Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke: async (command: string) => {
  calls.push(command);
  if (command === "pull_label_cloud") { if (query.has("offline")) throw Error("无法拉取云端标签，已保留本机缓存"); return value; }
  if (["set_setting", "refresh_tray", "set_native_backing", "set_page_view_theme"].includes(command)) return;
  if (command === "get_setting") return null;
  blocked.push(command); throw Error("隔离预览禁止执行：" + command);
} } });
const { default: LabelBoard } = await import("../src/labels/LabelBoard");
function Fixture() {
  const [active, setActive] = useState(true);
  return <><header style={{ display: "flex", gap: 12, alignItems: "center", height: 34, font: "11px var(--ui)", padding: "0 12px", color: "var(--muted)" }}>云端标签布局预览 · 合成数据<button onClick={() => { document.documentElement.dataset.mode = document.documentElement.dataset.mode === "dark" ? "light" : "dark"; }}>切换明暗</button><button onClick={() => setActive(!active)}>{active ? "暂停页面" : "激活页面"}</button></header><div style={{ height: "calc(100vh - 34px)" }}><LabelBoard active={active}/></div></>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
Object.assign(window, { __labelCloudFixture: { calls, blocked } });
