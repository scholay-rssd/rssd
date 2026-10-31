import { check, type Update } from "@tauri-apps/plugin-updater";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast, useToasts } from "../toast";
import { waitForSpacePreparation } from "./spaceTransition";
import { tr } from "../uiText";

const preference = "today.updates.autoDownload";
let checking: Promise<void> | undefined, pending: Update | undefined, downloaded = false, installing = false;
export function autoDownloadUpdates(): boolean { try { return localStorage.getItem(preference) !== "false"; } catch { return true; } }
export function setAutoDownloadUpdates(enabled: boolean): void { localStorage.setItem(preference, String(enabled)); }
async function prepareRestart() {
  // Reuse the existing dirty-editor/running-task guard and UI flush contract.
  const promises: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent("scholay-space-will-switch", { detail: { promises } }));
  await waitForSpacePreparation(() => Promise.all(promises), tr("保存尚未完成，更新未安装，请稍后重试。"));
}
async function install() {
  if (!pending || installing) return;
  installing = true;
  try {
    if (!await ask(tr("安装 today {{version}} 并重新启动？请先保存正在编辑的内容。", { version: pending.version }), { title: tr("today 更新"), kind: "info", okLabel: tr("安装并重启"), cancelLabel: tr("稍后") })) return;
    await prepareRestart();
    if (!downloaded) { toast.show(tr("正在下载并验证更新…")); await pending.download(); downloaded = true; }
    await prepareRestart();
    await pending.install();
    await relaunch();
  } catch (error) { toast.error(tr("暂未安装更新：{{error}}", { error: String(error) })); }
  finally { installing = false; }
}
function notify() {
  useToasts.getState().push({ text: tr(downloaded ? "更新已下载：today {{version}}" : "发现新版本：today {{version}}", { version: pending!.version }), tone: "default", duration: 60000, action: { label: tr("安装更新"), run: () => { void install(); } } });
}
export async function checkForUpdates({ silent }: { silent: boolean }): Promise<void> {
  if (checking) return checking;
  checking = (async () => {
    try {
      if (!pending) pending = await check({ timeout: 15000 }) ?? undefined;
      if (!pending) { if (!silent) toast.show(tr("当前已是最新版本。")); return; }
      if (silent) {
        if (autoDownloadUpdates() && !downloaded) { await pending.download(); downloaded = true; }
        notify();
      } else await install();
    } catch (error) { if (!silent) toast.error(tr("检查更新失败：{{error}}", { error: String(error) })); }
  })().finally(() => { checking = undefined; });
  return checking;
}
