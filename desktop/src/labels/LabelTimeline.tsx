import Icon from "../components/Icon";
import { editionDay, editionHours, editionTitle, type LabelEdition } from "./editions";

import { tr } from "../uiText";
export default function LabelTimeline({ editions, selection, loading, loadingMore, hasMore, error, onSelect, onMore }: {
  editions: LabelEdition[]; selection: string; loading: boolean; loadingMore: boolean; hasMore: boolean; error: string;
  onSelect: (id: string) => void; onMore: () => void;
}) {
  const latest = editions[0], historical = editions.slice(1);
  let previousDay = "";
  const meta = (edition: LabelEdition) => {
    const count = edition.captures.reduce((sum, capture) => sum + capture.rows.length, 0);
    return tr("{{platforms}} 个平台 · {{count}} 条标签", {platforms: edition.captures.length, count});
  };
  return <section className="hot-ranking label-timeline" aria-label={tr("每八小时标签快照")}>
    <div className="hot-ranking-header"><div><h1>{tr("标签快照")}</h1><p>{tr("每天 3 份 · 每份 8 小时")}</p></div><Icon name="clock" size={16}/></div>
    <div className="label-latest-pinned">
      <button className={"label-time-choice " + (selection === "latest" ? "is-active" : "")} aria-pressed={selection === "latest"} onClick={() => onSelect("latest")}>
        <Icon name="clock" size={16}/><span><strong>{tr("最新一期")}</strong><small>{latest ? editionTitle(latest.start) : loading ? tr("正在读取…") : tr("还没有采集记录")}</small>{latest && <small>{meta(latest)}</small>}</span>
      </button>
    </div>
    <div className="label-timeline-caption"><span>{tr("历史记录")}</span><small>{tr("北京时间")}</small></div>
    <div className="hot-ranking-scroll label-history-scroll" aria-label={tr("滚动历史记录")} aria-busy={loading || loadingMore} onScroll={event => {
      const node = event.currentTarget;
      if (node.scrollHeight - node.scrollTop - node.clientHeight < 160 && hasMore && !loading && !loadingMore) onMore();
    }}>
      {error && <p className="label-history-error" role="alert">{error}</p>}
      {historical.map(edition => {
        const day = editionDay(edition.start), showDay = day !== previousDay; previousDay = day;
        return <div key={edition.start}>{showDay && <div className="label-timeline-day">{day}</div>}<button className={"label-snapshot " + (selection === String(edition.start) ? "is-active" : "")} aria-pressed={selection === String(edition.start)} onClick={() => onSelect(String(edition.start))}><span className="label-timeline-dot"/><span><strong>{editionHours(edition.start)}</strong><small>{meta(edition)}</small></span><Icon name="chevron-right" size={12}/></button></div>;
      })}
      {!loading && !error && historical.length === 0 && <div className="hot-empty"><p>{tr("还没有历史记录")}</p><small>{tr("下一时段采集成功后，本期会移到这里。")}</small></div>}
      {hasMore && <button className="label-load-history" disabled={loadingMore || loading} onClick={onMore}>{loadingMore ? tr("读取中…") : tr("更早的记录")}</button>}
    </div>
    <footer className="label-history-foot">{tr("00–08 / 08–16 / 16–24 点")}<br/>{tr("未采集时段不补造记录。")}</footer>
  </section>;
}
