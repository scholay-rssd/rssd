import { describe, expect, it, vi } from "vitest";
import { LABEL_CLOUD_CACHE_KEY, LABEL_CLOUD_HISTORY_LIMIT, labelCloudReadError, labelCloudStatus, labelCloudUSD, mergeLabelCloud, parseLabelCloud, publicLabelUrl, readLabelCloud, saveLabelCloud } from "./cloud";
const makeSnapshot = (n = 0) => ({ id: `snapshot-${n}`, platformId: "douyin", provider: "tikhub", endpointId: "douyin-hot", observedAt: new Date(Date.UTC(2026, 9, 5, 0, n, 23)).toISOString(), period: "实时榜", rows: [{ id: "row-1", term: "科研生活", kind: "实时热点", rank: 1, metric: { label: "热度", value: 123, unit: "万" }, url: "https://www.douyin.com/hot/123" }] });
const fixture = () => ({ schemaVersion: 1, source: "scholay-cloud-labels", collection: { configured: true, lastWorkerAt: "2026-10-05T03:00:00Z", message: "" }, generatedAt: "2026-10-05T03:00:00Z", budget: { month: "2026-10", currency: "USD", limitMicros: 5000000, spentMicros: 125000, reservedMicros: 0, remainingMicros: 4875000, blocked: false }, platforms: [{ id: "douyin", name: "抖音", status: "ok", message: "", lastObservedAt: "2026-10-05T00:00:23Z", nextDueAt: null }], latest: [makeSnapshot()], history: [makeSnapshot()] });

describe("independent cloud label cache", () => {
  it("projects only public schema fields, removes credential URLs and never relabels legacy snapshots", () => {
    const raw: any = fixture(); raw.apiKey = "SECRET"; raw.budget.token = "SECRET"; raw.platforms[0].cookie = "SECRET"; raw.latest[0].raw = { authorization: "SECRET" }; raw.latest[0].rows[0].token = "SECRET"; raw.latest[0].rows[0].metric.cookie = "SECRET"; raw.latest[0].rows[0].url = "https://www.douyin.com/hot?api_key=SECRET";
    const parsed = parseLabelCloud(raw)!;
    expect(parsed.latest[0].rows[0].url).toBeNull();
    expect(JSON.stringify(parsed)).not.toMatch(/SECRET|apiKey|cookie|authorization|token|raw/);
    expect(parseLabelCloud({ douyin: { capturedAt: "2026-10-05T00:00:00Z", rows: [] } })).toBeNull();
    expect(readLabelCloud('{"schemaVersion":1}')).toBeNull();
    for (const url of ["javascript:alert(1)", "http://example.org", "https://user:pass@example.org", "https://example.org?token=SECRET"]) expect(publicLabelUrl(url)).toBeNull();
    expect(publicLabelUrl("https://example.org/news?id=123")).toBe("https://example.org/news?id=123");
  });
  it("rejects invalid envelopes, identities, times and unsafe monetary values", () => {
    for (const patch of [{ schemaVersion: 2 }, { source: "dom-collector" }, { generatedAt: "yesterday" }, { generatedAt: "2026-02-30T00:00:00Z" }, { collection: { configured: "true", lastWorkerAt: null, message: "" } }, { platforms: [{ ...fixture().platforms[0], id: "unknown" }] }, { budget: { ...fixture().budget, spentMicros: 0.5 } }, { budget: { ...fixture().budget, spentMicros: Number.MAX_SAFE_INTEGER + 1 } }, { budget: { ...fixture().budget, remainingMicros: 5000000 } }, { budget: { ...fixture().budget, limitMicros: 6000000 } }]) expect(parseLabelCloud({ ...fixture(), ...patch })).toBeNull();
    const invalid: any = fixture(); invalid.latest[0].provider = "legacy"; invalid.history[0].observedAt = "08–16";
    expect(parseLabelCloud(invalid)?.latest).toEqual([]); expect(parseLabelCloud(invalid)?.history).toEqual([]);
    const noRows = { ...makeSnapshot(), rows: [{ ...makeSnapshot().rows[0], rank: -1 }] };
    expect(parseLabelCloud({ ...fixture(), latest: [noRows], history: [noRows] })?.history).toEqual([]);
  });
  it("bounds rows/history/latest before persisting and handles unavailable local storage", () => {
    const raw = { ...fixture(), history: Array.from({ length: 100 }, (_, n) => makeSnapshot(n)), latest: [makeSnapshot(99)] };
    const parsed = parseLabelCloud(raw)!;
    expect(parsed.history).toHaveLength(LABEL_CLOUD_HISTORY_LIMIT); expect(parsed.history[0].id).toBe("snapshot-99");
    const store = { setItem: vi.fn() };
    expect(saveLabelCloud(parsed, store)).toBe(true); expect(store.setItem.mock.calls[0][0]).toBe(LABEL_CLOUD_CACHE_KEY); expect(readLabelCloud(store.setItem.mock.calls[0][1])?.history).toHaveLength(60);
    expect(saveLabelCloud(parsed, { setItem() { throw Error("Quota"); } })).toBe(false);
    expect(readLabelCloud(" ".repeat(2_000_001))).toBeNull();
    const over = { ...makeSnapshot(), rows: Array.from({ length: 201 }, (_, n) => ({ ...makeSnapshot().rows[0], id: `row-${n}` })) };
    expect(parseLabelCloud({ ...fixture(), latest: [over], history: [over] })?.latest).toEqual([]);
  });
  it("replays immutable IDs without duplicate history, changing observation times or accepting stale pulls", () => {
    const first = parseLabelCloud(fixture())!;
    const replay = parseLabelCloud({ ...fixture(), generatedAt: "2026-10-05T04:00:00Z", latest: [{ ...makeSnapshot(), observedAt: "2026-10-05T02:00:00Z" }], history: [makeSnapshot(), makeSnapshot(), makeSnapshot(1)] })!;
    const merged = mergeLabelCloud(first, replay);
    expect(merged.history).toHaveLength(2); expect(merged.history.find(item => item.id === "snapshot-0")?.observedAt).toBe(first.history[0].observedAt);
    expect(merged.latest[0].observedAt).toBe(first.latest[0].observedAt);
    expect(mergeLabelCloud(merged, replay).history).toHaveLength(2);
    expect(mergeLabelCloud(merged, first)).toBe(merged);
  });
  it("preserves absent official ranks/periods and safely maps collection/read status", () => {
    const item = { ...makeSnapshot(), period: null, rows: [{ ...makeSnapshot().rows[0], rank: null, metric: null }] };
    const parsed = parseLabelCloud({ ...fixture(), latest: [item], history: [item] })!;
    expect(parsed.latest[0].period).toBeNull(); expect(parsed.latest[0].rows[0].rank).toBeNull();
    expect(labelCloudStatus("ready")).toBe("已更新"); expect(labelCloudStatus("stale")).toBe("等待云端更新"); expect(labelCloudStatus("collecting")).toBe("云端采集中");
    expect(labelCloudReadError("native stderr: 云端标签服务尚未上线，已保留本机缓存 SECRET")).toBe("云端标签服务尚未上线，已保留本机缓存");
    expect(labelCloudReadError(Error("请先在设置中绑定官网，以读取云端标签"))).toContain("设置中绑定官网");
    expect(labelCloudReadError("Bearer SECRET")).not.toContain("SECRET");
  });
  it("formats the fixed $5 monthly budget with integer arithmetic and validates exhausted budgets", () => {
    expect(labelCloudUSD(5000000)).toBe("$5.00"); expect(labelCloudUSD(125000)).toBe("$0.13"); expect(labelCloudUSD(999999)).toBe("$1.00");
    const exhausted = { ...fixture(), budget: { ...fixture().budget, spentMicros: 5000000, remainingMicros: 0, blocked: true } };
    expect(parseLabelCloud(exhausted)?.budget.blocked).toBe(true);
    expect(parseLabelCloud({ ...exhausted, budget: { ...exhausted.budget, blocked: false } })).toBeNull();
  });
});
