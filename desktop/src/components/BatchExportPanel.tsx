import { useQuery } from "@tanstack/react-query";
import { invoke } from "../lib/nativeCore";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { previewLabel, runBatchExport, useBatchExport, type ExportPreview } from "../lib/batchExport";
import { errorText } from "../lib/errors";
import Icon from "./Icon";
import "./batch-export.css";

import { tr } from "../uiText";
export default function BatchExportPanel() {
  const state = useBatchExport();
  const ids = state.targets.map(a => a.id);
  const preview = useQuery({ queryKey: ["batch-export-preview", ids], queryFn: () => invoke<ExportPreview[]>("preview_article_bundles", { articleIds: ids }), enabled: state.open && ids.length > 0 && !state.running && !state.result, staleTime: 0 });
  const details = new Map(preview.data?.map(row => [row.articleId, row]));
  if (!state.open) {
    if (!state.progress && !state.result && !state.error) return null;
    return <div className="batch-export-status" role="status"><span>{state.running ? tr("正在导出 {{value}}/{{value2}} 篇", {value: state.progress?.done ?? 0, value2: state.progress?.total ?? ids.length}) : state.error ? tr("批量导出未完成") : tr("资料包已保存 · {{value}} 篇", {value: state.result?.successful ?? 0})}</span><button onClick={() => state.setOpen(true)}>{tr("查看导出")}</button></div>;
  }
  const missing = preview.data?.filter(row => row.needsFetch || row.empty).length ?? 0;
  const empty = preview.data?.filter(row => row.empty).length ?? 0;
  const canExport = preview.data?.some(row => !row.error && (state.options.fetchMissing || !row.empty)) ?? false;
  return <section className="batch-export-panel" aria-label={tr("批量导出图文资料包")} aria-busy={state.running}>
    <header><div><h2>{tr("导出所选文章")}</h2><p>{tr("{{value}} 篇文章 · 图文资料包", {value: state.running || state.result ? state.progress?.total ?? ids.length : ids.length})}</p></div><button className="batch-icon-button" aria-label={tr("关闭批量导出面板")} title={tr("关闭后，导出仍在后台继续")} onClick={() => state.setOpen(false)}><Icon name="x" size={17}/></button></header>
    {!state.result && !state.running && <div className="batch-export-columns">
      <ol className="batch-export-articles" aria-label={tr("待导出文章")}>{state.targets.map(a => <li key={a.id}><span className="batch-export-article-title">{a.title}</span><small className={details.get(a.id)?.error ? "batch-error" : ""}>{preview.isError ? tr("无法检查缓存") : previewLabel(details.get(a.id))}</small></li>)}</ol>
      <div className="batch-export-options"><h3>{tr("导出格式与内容")}</h3><label><input type="checkbox" checked readOnly aria-label={tr("Markdown 与 JSON（必选）")}/>Markdown + JSON</label><label><input type="checkbox" checked={state.options.includeImages} onChange={e => useBatchExport.setState({ options: { ...state.options, includeImages: e.target.checked } })}/>{tr("保存图片到本地")}</label><label><input type="checkbox" checked={state.options.fetchMissing} onChange={e => useBatchExport.setState({ options: { ...state.options, fetchMissing: e.target.checked } })}/>{tr("补抓取缺失全文")}</label>
        <p>{tr("默认使用已有缓存，不调用 AI。已有 Markdown 整理稿随包附带；没有则直接从原文生成 Markdown。")}</p>
        {state.options.fetchMissing && <p>{tr("仅抓取公开网页；需登录或依赖脚本的页面，请先在网页视图中打开。失败时保留 RSS 缓存并注明。")}</p>}
        {!state.options.fetchMissing && missing > 0 && <p>{missing}  {tr("篇尚无网页正文，将使用已有 RSS 内容。")}{empty > 0 && tr("其中 {{empty}} 篇只有标题，请勾选“补抓取缺失全文”，否则这些文章无法导出正文。", {empty})}</p>}
        {!state.options.includeImages && <p>{tr("图片保留网络链接，离线时可能无法显示。")}</p>}
        <h3>{tr("导出目标")}</h3><p>{tr("一个 ZIP · 每篇独立文件夹 · 含目录索引")}<br/>{tr("保存到下载目录 / today")}</p>
      </div>
    </div>}
    {preview.isError && !state.result && <p role="alert" className="batch-error">{tr("缓存检查失败：{{errorText}}", {errorText: errorText(preview.error)})} <button onClick={() => void preview.refetch()}>{tr("重新检查")}</button></p>}
    {state.running && <div className="batch-export-progress" role="status"><p>{tr("正在整理 {{value}}/{{value2}} 篇 · {{title}}", {value: state.progress?.done ?? 0, value2: state.progress?.total ?? ids.length, title: tr(state.progress?.title ?? "")})}</p><progress value={state.progress?.done ?? 0} max={state.progress?.total ?? ids.length}/><p>{tr("可关闭面板继续阅读。每篇图片最多等待 80 秒，整个包的图片上限为 256 MB。")}</p></div>}
    {state.error && <p className="batch-error" role="alert">{state.error}</p>}
    {state.result && !state.running && <div className="batch-export-result" role="status"><h3>{tr("已保存 {{successful}}/{{total}} 篇", {successful: state.result.successful, total: state.result.total})}</h3><p>{state.result.retryIds.length ? tr("{{retryIds}} 篇存在失败或未保存的图片，可仅重试这些文章，另存补充资料包；原资料包保留。", {retryIds: state.result.retryIds.length}) : tr("Markdown、JSON、图片和目录索引已打包。")}</p>
      <button onClick={() => revealItemInDir(state.result!.path).catch(e => useBatchExport.setState({ error: errorText(e) }))}><Icon name="folder" size={14}/>{tr("打开文件位置")}</button>
      {state.result.retryIds.length > 0 && <button onClick={() => void runBatchExport(state.options, true)}>{tr("仅重试未完成的 {{retryIds}} 篇", {retryIds: state.result.retryIds.length})}</button>}
      <details><summary>{tr("查看逐篇结果")}</summary><ul>{state.result.items.map(item => <li key={item.articleId}><strong>{item.title}</strong><small>{item.error ?? tr("{{images}} 张图片已保存{{value}}", {images: item.images, value: item.missingImages ? tr(" · {{count}} 张未保存", {count: item.missingImages}) : ""})}</small>{item.warnings.map((w, i) => <small key={i}>{w}</small>)}</li>)}</ul></details>
    </div>}
    <footer>{!state.result && !state.running && <button className="batch-primary" disabled={preview.isPending || preview.isError || !ids.length || !canExport} onClick={() => void runBatchExport(state.options)}><Icon name="arrow-down" size={14}/>{state.error ? tr("重新导出") : tr("开始导出 {{ids}} 篇", {ids: ids.length})}</button>}<span>{state.running ? tr("导出期间请勿退出应用") : tr("可在后台继续阅读")}</span>{state.running && <button onClick={() => state.setOpen(false)}>{tr("后台继续")}</button>}</footer>
  </section>;
}
