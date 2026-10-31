import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listFolders } from "../api";
import { AGENT_PRESET_TASKS, mcpHandoffText } from "../lib/agentPrompts";
import * as integration from "../lib/integrations";
import { descendantIds, folderAncestors, orderedFolders } from "../lib/folderTree";
import { errorText } from "../lib/errors";
import Icon from "./Icon";
import ConfirmDialog from "./ConfirmDialog";
import "./integration-settings.css";

import { tr, trKey, trNative } from "../uiText";
const labels: Record<string, string> = { unconfigured: trKey("未配置"), configured: trKey("已配置 · 待验证"), verified: trKey("在线验证通过"), expired: trKey("授权已失效"), unknown: trKey("暂时无法验证"), authorizing: trKey("正在授权"), challenge: trKey("平台要求验证") };

export function PlatformSettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["platform-status"], queryFn: async () => {
    const next = await integration.platformStatus();
    const previous = qc.getQueryData<integration.PlatformStatus[]>(["platform-status"]);
    // A configuration-only poll must not erase an explicit successful probe.
    // Keep its visible timestamp for five minutes; expiry/logout still wins.
    return next.map((p) => {
      const old = previous?.find((item) => item.id === p.id);
      return p.status === "configured" && p.service === "available" && old?.status === "verified" && old.lastVerifiedAt && Date.now() - Date.parse(old.lastVerifiedAt) < 300000
        ? { ...p, status: old.status, lastVerifiedAt: old.lastVerifiedAt } : p;
    });
  }, refetchInterval: 15000 });
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const [editing, setEditing] = useState(false), [secret, setSecret] = useState("");
  const [logout, setLogout] = useState(false);
  async function action(platform: string, action: string) {
    if (busy) return; setBusy(platform); setError("");
    try {
      const result = await integration.platformAction(platform, action, action === "save" ? secret : null);
      setSecret("");
      if (action === "save") setEditing(false);
      if (result.id) qc.setQueryData<integration.PlatformStatus[]>(["platform-status"], (old) => old?.map((p) => p.id === result.id ? result : p));
      else await query.refetch();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(null); setSecret(""); }
  }
  return <div className="integration-settings">
    <p className="settings-group-desc">{tr("统一管理订阅平台的授权。网页账号登录、接口授权与抓取状态分别检查；私人邮件不在这里接入。")}</p>
    {query.isLoading && <p role="status">{tr("正在检查本机连接器…")}</p>}
    {query.isError && <p role="alert">{tr("无法检查平台状态，请稍后重试。")}</p>}
    {query.data?.map((p) => <section className="integration-card" key={p.id}>
      <header><div><h3>{p.name}</h3><small>{p.method}</small></div><span className={`integration-status ${p.status === "verified" ? "verified" : ""}`}>{tr(labels[p.status] ?? p.status)}</span></header>
      <p>{trNative(p.detail)}</p>
      <div className="integration-facts"><span>{tr("连接器：{{value}}", {value: tr(p.service === "available" ? "可用" : p.service === "offline" ? "离线" : "待检查")})}</span>{p.lastVerifiedAt && <span>{tr("最近验证：{{toLocaleString}}", {toLocaleString: new Date(p.lastVerifiedAt).toLocaleString()})}</span>}{!!p.lastSyncAt && <span>{tr("最近抓取：{{toLocaleString}} · {{lastSyncStatus}}", {toLocaleString: new Date(p.lastSyncAt * 1000).toLocaleString(), lastSyncStatus: p.lastSyncStatus})}</span>}</div>
      <div className="integration-actions">
        <button disabled={!!busy} onClick={() => p.id === "zhihu" ? setEditing(!editing) : void action(p.id, "authorize")}><Icon name="globe" size={14}/>{p.id === "zhihu" ? tr("配置 / 更换授权") : tr("扫码 / 管理授权")}</button>
        <button disabled={!!busy} onClick={() => void action(p.id, "verify")}><Icon name="refresh" size={14}/>{busy === p.id ? tr("正在处理…") : p.id === "zhihu" ? tr("在线验证") : tr("检查连接与抓取")}</button>
        {p.id === "zhihu" && p.status !== "unconfigured" && <button disabled={!!busy} onClick={() => setLogout(true)}>{tr("解除授权")}</button>}
      </div>
      {p.id === "zhihu" && editing && <form className="integration-secret" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void action("zhihu", "save"); }}><label>Access Secret<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" spellCheck={false} maxLength={4096} placeholder={tr("只保存到系统凭证库，不写入订阅数据库")}/></label><button disabled={!!busy || !secret.trim()}>{tr("验证并保存")}</button></form>}
    </section>)}
    <section className="integration-card"><h3>{tr("普通 RSS 与 AI 服务")}</h3><p>{tr("普通 RSS 无需统一登录。AI 模型、接口地址和密钥继续在「高级」中配置；本次新增图文导出不依赖 AI。")}</p></section>
    {error && <p className="integration-error" role="alert">{error}</p>}
    {logout && <ConfirmDialog title={tr("解除知乎授权")} message={tr("仅移除本机知乎 CLI 的授权。已有订阅和缓存文章保留，新的知乎内容将无法继续抓取。")} confirmLabel={tr("解除授权")} onConfirm={() => { setLogout(false); void action("zhihu", "logout"); }} onClose={() => setLogout(false)}/>}
  </div>;
}

const permissions = (s: integration.LibraryStatus): integration.McpPermissions =>
  ({ enabled: s.enabled, writable: s.writable, articles: s.articles, articleClean: s.articleClean, editorial: s.editorial ?? false });

export function AgentSettings({ onToast }: { onToast: (message: string) => void }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["library-status"], queryFn: integration.libraryStatus });
  const folderQuery = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const folders = orderedFolders(folderQuery.data ?? []);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const s = query.data;
  async function run(work: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError("");
    try { await work(); await Promise.all([query.refetch(), qc.invalidateQueries({ queryKey: ["folders"] })]); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="integration-settings">
    <section className="integration-card"><h3>{tr("本机 MCP 服务")}</h3><p>{tr("智能体通过 stdio 连接正在运行的 today。仅本机访问，不开放网络端口，不暴露密钥或任意命令执行。")}</p>
      {s ? <><label className="integration-toggle"><span>{tr("启用 MCP")}</span><input type="checkbox" checked={s.enabled} disabled={busy} onChange={(e) => void run(() => integration.libraryPermissions({ ...permissions(s), enabled: e.target.checked }))}/></label><label className="integration-toggle"><span>{tr("允许修改订阅和目录")}</span><input type="checkbox" checked={s.writable} disabled={busy || !s.enabled} onChange={(e) => void run(() => integration.libraryPermissions({ ...permissions(s), writable: e.target.checked }))}/></label><label className="integration-toggle"><span>{tr("允许读取文章正文、清洗结果与浏览器页面")}</span><input type="checkbox" checked={s.articles} disabled={busy || !s.enabled} onChange={(e) => void run(() => integration.libraryPermissions({ ...permissions(s), articles: e.target.checked }))}/></label><label className="integration-toggle"><span>{tr("允许原文读取与预处理（包括已打开的浏览器页面）")}</span><input type="checkbox" checked={s.articleClean} disabled={busy || !s.articles} onChange={(e) => void run(() => integration.libraryPermissions({ ...permissions(s), articleClean: e.target.checked }))}/></label>
      <label className="integration-toggle"><span>{tr("允许读取和编辑本地母稿（不授予发布权限）")}</span><input type="checkbox" checked={s.editorial ?? false} disabled={busy || !s.enabled} onChange={(e) => void run(() => integration.libraryPermissions({ ...permissions(s), editorial: e.target.checked }))}/></label>
      <small>{tr("移除订阅只会隐藏并停止抓取，文章保留；彻底清空资料不向 MCP 开放。预处理由应用读取原文或已打开的浏览器页面；文章批处理单次最多 200 篇，不下载图片，也不改变已读和收藏状态。")}</small>
      <details className="integration-config" open><summary>{tr("连接配置 · 复制时带上预设任务")}</summary><pre>{JSON.stringify(s.configuration, null, 2)}</pre><div className="integration-actions"><button onClick={() => void navigator.clipboard.writeText(mcpHandoffText(s.configuration)).then(() => onToast(tr("配置和预设任务已复制"))).catch(() => setError(tr("无法写入剪贴板")))}><Icon name="copy" size={14}/>{tr("复制配置和预设任务")}</button><button onClick={() => void navigator.clipboard.writeText(JSON.stringify(s.configuration, null, 2)).then(() => onToast(tr("MCP 配置已复制"))).catch(() => setError(tr("无法写入剪贴板")))}>{tr("只复制 JSON")}</button></div></details>
      <div className="integration-prompts"><h4>{tr("预设任务 · {{AGENT_PRESET_TASKS}} 件", {AGENT_PRESET_TASKS: AGENT_PRESET_TASKS.length})}</h4><p>{tr("通用智能体连上之后，一次做一件。会改订阅或会抓取网页的步骤，先给你看预览。")}</p>{AGENT_PRESET_TASKS.map((task) => <div className="integration-prompt" key={task.id}><div><strong>{task.title}</strong><p>{task.summary}</p></div><button onClick={() => void navigator.clipboard.writeText(task.prompt).then(() => onToast(tr("已复制「{{title}}」", {title: task.title}))).catch(() => setError(tr("无法写入剪贴板")))}><Icon name="copy" size={14}/>{tr("复制任务")}</button></div>)}</div></> : <p role="status">{query.isError ? tr("无法读取本机服务状态") : tr("正在读取…")}</p>}
    </section>
    <section className="integration-card"><h3>{tr("目录层级")}</h3><p>{tr("选择上级目录即可移动，文章和订阅 ID 不变。当前目录名称在整个资料库中保持唯一。")}</p>
      <div className="integration-folder-list">{folders.map((f) => {const descendants = descendantIds(f.id, folders); return <label className="integration-folder" key={f.id}><span title={f.name} style={{ paddingLeft: Math.min(folderAncestors(f.id, folders).length, 5) * 10 }}>{f.name}</span><select aria-label={tr("{{name}}的上级目录", {name: f.name})} value={f.parentId ?? ""} disabled={busy} onChange={(e) => void run(() => integration.libraryApply([{ action: "move_folder", id: f.id, parent_id: e.target.value ? Number(e.target.value) : null }], false, s?.revision ?? null))}><option value="">{tr("顶层目录")}</option>{folders.filter((p) => !descendants.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>;})}</div>
    </section>
    <section className="integration-card"><h3>{tr("已移除的订阅")} <small>{s?.archived.length ?? 0}</small></h3><p>{tr("这里的订阅不再刷新。恢复后仍使用原来的文章、收藏和阅读记录。")}</p>{s?.archived.map((f) => <div className="integration-folder" key={f.id}><span>{f.title}<small>  {tr("· {{articles}} 篇", {articles: f.articles})}</small></span><button disabled={busy} onClick={() => void run(() => integration.libraryApply([{ action: "restore_feed", id: f.id }]))}>{tr("恢复订阅")}</button></div>)}</section>
    <section className="integration-card"><h3>{tr("最近操作")}</h3>{s?.history.length ? <ol className="integration-history">{s.history.map((h) => <li key={h.id}><span>{h.actor === "mcp" ? tr("智能体") : h.actor === "desktop" ? tr("桌面") : h.actor} · {h.actions.map((a) => a.action).join("、")}</span><small>{h.createdAt} UTC</small></li>)}</ol> : <p>{tr("暂时没有目录操作记录。")}</p>}</section>
    {error && <p className="integration-error" role="alert">{error}</p>}
  </div>;
}
