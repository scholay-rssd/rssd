import { tr, trKey, uiLocale } from "../uiText";
/** The desktop only pulls the server's paid-collection cache. Legacy DOM
 * observations remain in their own stores and are never relabelled here. */
export const LABEL_CLOUD_CACHE_KEY = "scholay.labels.cloud.v1";
export const LABEL_CLOUD_UI_KEY = "scholay.labels.cloud.ui.v1";
export const LABEL_CLOUD_POLL_MS = 5 * 60 * 1000;
export const LABEL_CLOUD_HISTORY_LIMIT = 60;
const MAX_LATEST = 64, MAX_ROWS = 200, MAX_RAW_SNAPSHOTS = 1000, MAX_CACHE_BYTES = 2_000_000;
export const LABEL_CLOUD_PLATFORMS = [
  { id: "bilibili", name: "哔哩哔哩", mark: "哔" },
  { id: "douyin", name: "抖音", mark: "抖" },
  { id: "kuaishou", name: "快手", mark: "快" },
  { id: "xiaohongshu", name: "小红书", mark: "红" },
  { id: "weibo", name: "微博", mark: "微" },
  { id: "toutiao", name: "今日头条", mark: "今" },
  { id: "zhihu", name: "知乎", mark: "知" },
] as const;
export type LabelCloudPlatformId = typeof LABEL_CLOUD_PLATFORMS[number]["id"];
export type LabelCloudRow = { id: string; term: string; kind: string; rank: number | null; metric: { label: string; value: number | string; unit: string } | null; url: string | null };
export type LabelCloudSnapshot = { id: string; platformId: LabelCloudPlatformId; provider: "tikhub"; endpointId: string; observedAt: string; period: string | null; rows: LabelCloudRow[] };
export type LabelCloudPlatform = { id: LabelCloudPlatformId; name: string; status: string; message: string; lastObservedAt: string | null; nextDueAt: string | null };
export type LabelCloudBudget = { month: string; currency: "USD"; limitMicros: 5000000; spentMicros: number; reservedMicros: number; remainingMicros: number; blocked: boolean };
export type LabelCloudCollection = { configured: boolean; lastWorkerAt: string | null; message: string };
export type LabelCloud = { collection?: LabelCloudCollection; schemaVersion: 1; source: "scholay-cloud-labels"; generatedAt: string; budget: LabelCloudBudget; platforms: LabelCloudPlatform[]; latest: LabelCloudSnapshot[]; history: LabelCloudSnapshot[] };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number, empty = false): value is string => typeof value === "string" && (empty || !!value.trim()) && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const id = (value: unknown): value is string => text(value, 160) && /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(value);
const platformId = (value: unknown): value is LabelCloudPlatformId => LABEL_CLOUD_PLATFORMS.some(item => item.id === value);
const time = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = value.match(/^\d{4}|\d{2}/g)!.slice(0, 6).map(Number);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && hour < 24 && minute < 60 && second < 60;
};
const optionalTime = (value: unknown): value is string | null => value === null || time(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export function publicLabelUrl(value: unknown): string | null {
  if (!text(value, 2048)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || /(?:token|cookie|authorization|api[_-]?key|secret|password|signature|credential)/i.test([...url.searchParams.keys()].join(" "))) return null;
    return url.href;
  } catch { return null; }
}
function metric(value: unknown): LabelCloudRow["metric"] | undefined {
  if (value === null) return null;
  if (!record(value) || !text(value.label, 60, true) || !text(value.unit, 24, true)) return undefined;
  if (typeof value.value === "number" ? !Number.isFinite(value.value) || value.value < 0 : !text(value.value, 48) || !/^[\d,.+\- ]+(?:万|亿|[KkMmWw%])?$/.test(value.value)) return undefined;
  return { label: value.label, value: value.value as string | number, unit: value.unit };
}
function snapshot(value: unknown): LabelCloudSnapshot | null {
  if (!record(value) || !id(value.id) || !platformId(value.platformId) || value.provider !== "tikhub" || !id(value.endpointId) || !time(value.observedAt) || !(value.period === null || text(value.period, 120, true)) || !Array.isArray(value.rows) || value.rows.length > MAX_ROWS) return null;
  const rows: LabelCloudRow[] = [], seen = new Set<string>();
  for (const row of value.rows) {
    if (!record(row) || !id(row.id) || seen.has(row.id) || !text(row.term, 400) || !text(row.kind, 80) || !(row.rank === null || integer(row.rank) && row.rank >= 1 && row.rank <= 10000) || !(row.url === null || typeof row.url === "string")) continue;
    const publicMetric = metric(row.metric);
    if (publicMetric === undefined) continue;
    seen.add(row.id);
    // Explicit field projection excludes provider credentials/raw responses.
    rows.push({ id: row.id, term: row.term, kind: row.kind, rank: row.rank as number | null, metric: publicMetric, url: publicLabelUrl(row.url) });
  }
  return rows.length ? { id: value.id, platformId: value.platformId, provider: "tikhub", endpointId: value.endpointId, observedAt: value.observedAt, period: value.period as string | null, rows } : null;
}
const newest = (a: LabelCloudSnapshot, b: LabelCloudSnapshot) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.id.localeCompare(b.id);
function uniqueSnapshots(values: LabelCloudSnapshot[]): LabelCloudSnapshot[] {
  const seen = new Set<string>();
  return values.filter(value => { if (seen.has(value.id)) return false; seen.add(value.id); return true; });
}
function latestSnapshots(values: LabelCloudSnapshot[]): LabelCloudSnapshot[] {
  const seen = new Set<string>();
  return uniqueSnapshots(values).sort(newest).filter(value => { const key = `${value.platformId}/${value.endpointId}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, MAX_LATEST);
}
export function parseLabelCloud(value: unknown): LabelCloud | null {
  if (!record(value) || value.schemaVersion !== 1 || value.source !== "scholay-cloud-labels" || !time(value.generatedAt) || !record(value.budget) || !Array.isArray(value.platforms) || value.platforms.length > LABEL_CLOUD_PLATFORMS.length || !Array.isArray(value.latest) || value.latest.length > MAX_RAW_SNAPSHOTS || !Array.isArray(value.history) || value.history.length > MAX_RAW_SNAPSHOTS) return null;
  const b = value.budget;
  let collection: LabelCloudCollection | undefined;
  if (value.collection !== undefined) {
    const item = value.collection;
    if (!record(item) || typeof item.configured !== "boolean" || !optionalTime(item.lastWorkerAt) || !text(item.message, 300, true)) return null;
    collection = { configured: item.configured, lastWorkerAt: item.lastWorkerAt, message: item.message };
  }
  if (typeof b.month !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(b.month) || b.currency !== "USD" || b.limitMicros !== 5000000 || !integer(b.spentMicros) || !integer(b.reservedMicros) || !integer(b.remainingMicros) || typeof b.blocked !== "boolean") return null;
  const available = BigInt(b.limitMicros) - BigInt(b.spentMicros) - BigInt(b.reservedMicros);
  if (BigInt(b.remainingMicros) !== (available > 0n ? available : 0n) || (available <= 0n && !b.blocked)) return null;
  const platforms: LabelCloudPlatform[] = [], seen = new Set<string>();
  for (const item of value.platforms) {
    if (!record(item) || !platformId(item.id) || seen.has(item.id) || !text(item.name, 40) || !text(item.status, 40) || !/^[a-z][a-z_\-]*$/.test(item.status) || !text(item.message, 300, true) || !optionalTime(item.lastObservedAt) || !optionalTime(item.nextDueAt)) return null;
    seen.add(item.id);
    platforms.push({ id: item.id, name: item.name, status: item.status, message: item.message, lastObservedAt: item.lastObservedAt, nextDueAt: item.nextDueAt });
  }
  const latest = value.latest.map(snapshot).filter((item): item is LabelCloudSnapshot => !!item);
  const history = value.history.map(snapshot).filter((item): item is LabelCloudSnapshot => !!item);
  const canonical = new Map(uniqueSnapshots([...latest, ...history]).map(item => [item.id, item]));
  return { ...(collection ? { collection } : {}), schemaVersion: 1, source: "scholay-cloud-labels", generatedAt: value.generatedAt, budget: { month: b.month, currency: "USD", limitMicros: 5000000, spentMicros: b.spentMicros, reservedMicros: b.reservedMicros, remainingMicros: b.remainingMicros, blocked: b.blocked }, platforms, latest: latestSnapshots(latest.map(item => canonical.get(item.id)!)), history: uniqueSnapshots(history.map(item => canonical.get(item.id)!)).sort(newest).slice(0, LABEL_CLOUD_HISTORY_LIMIT) };
}
export function readLabelCloud(raw: string | null): LabelCloud | null {
  if (!raw || raw.length > MAX_CACHE_BYTES) return null;
  try { return parseLabelCloud(JSON.parse(raw)); } catch { return null; }
}
export function mergeLabelCloud(previous: LabelCloud | null, incoming: LabelCloud): LabelCloud {
  if (!previous) return incoming;
  if (Date.parse(incoming.generatedAt) < Date.parse(previous.generatedAt)) return previous;
  const canonical = new Map<string, LabelCloudSnapshot>();
  for (const item of [...previous.latest, ...previous.history, ...incoming.latest, ...incoming.history]) if (!canonical.has(item.id)) canonical.set(item.id, item);
  const project = (values: LabelCloudSnapshot[]) => values.map(item => canonical.get(item.id)!);
  return { ...incoming, latest: latestSnapshots(project([...incoming.latest, ...previous.latest])), history: uniqueSnapshots(project([...incoming.history, ...previous.history])).sort(newest).slice(0, LABEL_CLOUD_HISTORY_LIMIT) };
}
export function saveLabelCloud(value: LabelCloud, storage: Pick<Storage, "setItem"> = localStorage): boolean {
  const safe = parseLabelCloud(value);
  if (!safe) return false;
  const raw = JSON.stringify(safe);
  if (raw.length > MAX_CACHE_BYTES) return false;
  try { storage.setItem(LABEL_CLOUD_CACHE_KEY, raw); return true; } catch { return false; }
}
export function labelCloudTime(value: string): string {
  return new Date(value).toLocaleString(uiLocale(), { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
export function labelCloudUSD(micros: number): string {
  const cents = (BigInt(micros) + 5000n) / 10000n;
  return `$${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
export function labelCloudStatus(status?: string): string {
  if (["ok", "ready", "updated", "success"].includes(status || "")) return tr("已更新");
  if (["budget_blocked", "budget_exhausted", "blocked"].includes(status || "")) return tr("预算已到上限");
  if (["error", "failed"].includes(status || "")) return tr("更新暂未完成");
  if (["pending", "queued", "stale"].includes(status || "")) return tr("等待云端更新");
  if (status === "collecting") return tr("云端采集中");
  return tr("尚未更新");
}

const SAFE_READ_ERRORS = [trKey("请先在设置中绑定官网，以读取云端标签"), trKey("官网凭证无读取权限，请检查设置中的官网绑定"), trKey("云端标签服务尚未上线，已保留本机缓存"), trKey("无法拉取云端标签，已保留本机缓存"), trKey("云端标签暂时不可用，已保留本机缓存"), trKey("云端标签数据过大"), trKey("云端标签格式错误"), trKey("云端标签响应为空"), trKey("云端标签传输中断，已保留本机缓存")];
/** Only reproduce known read-module messages, never native stderr/provider data. */
export function labelCloudReadError(error: unknown): string {
  const value = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return tr(value.length <= 1000 && SAFE_READ_ERRORS.find(message => value.includes(message)) || "无法拉取云端标签，已保留本机缓存");
}
