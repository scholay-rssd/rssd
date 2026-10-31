import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import PlatformIcon from "../components/PlatformIcon";
import { LABEL_CLOUD_PLATFORMS, labelCloudTime, type LabelCloudRow, type LabelCloudSnapshot } from "./cloud";

import { tr } from "../uiText";
type Entry = { row: LabelCloudRow; snapshot: LabelCloudSnapshot };
export default function LabelCloudInsights({ snapshots, scope, search, group, loading, onCopy, onOriginal }: {
  snapshots: LabelCloudSnapshot[]; scope: string; search: string; group: string; loading: boolean; onCopy: (term: string) => void; onOriginal: (url: string) => void;
}) {
  const [limit, setLimit] = useState(60);
  useEffect(() => setLimit(60), [scope, search, group]);
  const entries = useMemo(() => {
    const result = new Map<string, Entry[]>();
    const query = search.trim().toLocaleLowerCase();
    for (const snapshot of snapshots) for (const row of snapshot.rows) {
      if ((group !== "全部" && row.kind !== group) || (query && !`${row.term} ${row.kind}`.toLocaleLowerCase().includes(query))) continue;
      const key = JSON.stringify([snapshot.platformId, row.kind]);
      if (!result.has(key)) result.set(key, []);
      result.get(key)!.push({ row, snapshot });
    }
    const groups = [...result.values()].map(rows => rows.every(entry => entry.row.rank !== null) ? rows.sort((a, b) => a.row.rank! - b.row.rank!) : rows);
    // Show a turn from each platform/type, retaining each board's own order.
    // Different platforms' heat metrics never determine a shared ranking.
    const entries: Entry[] = [];
    for (let index = 0; groups.some(rows => index < rows.length); index++) for (const rows of groups) if (rows[index]) entries.push(rows[index]);
    return entries;
  }, [snapshots, search, group]);
  return <div className="label-insights label-cloud-insights" aria-busy={loading}>
    <div className="label-tag-grid">{entries.slice(0, limit).map(({ row, snapshot }) => {
      const platform = LABEL_CLOUD_PLATFORMS.find(value => value.id === snapshot.platformId)!;
      return <article className="label-tag-card" key={`${snapshot.id}/${row.id}`} aria-label={`${platform.name} · ${row.term}`}>
        <header><PlatformIcon platformId={snapshot.platformId}/><span>{platform.name}</span>{row.rank !== null && <small className={`label-tag-rank ${row.rank <= 3 ? "is-top" : ""}`}>{tr("榜单第 {{rank}}", {rank: row.rank})}</small>}</header>
        <h2 className="label-tag-name" title={row.term}><span className="label-tag-token"><Icon name="tag" size={15}/>{row.term}</span></h2>
        <div className="label-tag-meta"><span title={row.kind}>{row.kind}</span>{snapshot.period && !row.kind.includes(snapshot.period) && <span title={snapshot.period}>{snapshot.period}</span>}{row.metric && <span className="label-tag-metric" title={`${row.metric.label} ${row.metric.value}${row.metric.unit}`}>{row.metric.label} {row.metric.value}{row.metric.unit}</span>}</div>
        <footer><time dateTime={snapshot.observedAt} title={tr("更新于 {{labelCloudTime}}", {labelCloudTime: labelCloudTime(snapshot.observedAt)})}>{labelCloudTime(snapshot.observedAt).replace(/^\d{4}\//, "").replace(/:\d{2}$/, "")}</time><div>{row.url && <button className="label-tag-source" onClick={() => onOriginal(row.url!)} aria-label={tr("查看标签来源：{{term}}", {term: row.term})} title={tr("查看来源")}><Icon name="open" size={13}/></button>}<button className="label-tag-copy" onClick={() => onCopy(row.term)} aria-label={tr("复制标签：{{term}}", {term: row.term})}><Icon name="copy" size={13}/>{tr("复制标签")}</button></div></footer>
      </article>;
    })}</div>
    {entries.length > limit && <button className="label-load-history" onClick={() => setLimit(value => value + 60)}>{tr("显示更多（{{limit}} / {{entries}}）", {limit, entries: entries.length})}</button>}
    {!entries.length && <div className="hot-empty"><Icon name="tag" size={28}/><p>{loading && !snapshots.length ? tr("正在获取标签…") : search || group !== "全部" ? tr("没有匹配的标签") : tr("尚未更新")}</p></div>}
  </div>;
}
