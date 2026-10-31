import SpaceEntrances, {spaceLogo} from "./SpaceEntrances";
import {ACTIVE_SITE} from "../../../scripts/site-profile.mjs";
import { createPortal } from "react-dom";
import {useWindowChrome} from "./PaneToolbar";
import Icon, { type IconName } from "./Icon";

import { tr, trKey } from "../uiText";
export type Workspace = "center" | "manuscripts" | "gallery" | "rss" | "discover" | "connections" | "hot" | "labels" | "year" | "history" | "editorial" | "library" | "publications" | "website";

export interface WorkspaceChoice {
  value: Workspace;
  label: string;
  icon: IconName | "logo";
  panel: string;
  group: number;
  shortcut: number;
}

export const WORKSPACE_CHOICES: WorkspaceChoice[] = [
  { value: "library", label: trKey("作品"), icon: "home", panel: "workspace-editorial-panel", group: 0, shortcut: 3 },
  { value: "manuscripts", label: trKey("稿件"), icon: "folder", panel: "workspace-editorial-panel", group: 0, shortcut: 7 },
  { value: "editorial", label: trKey("创作"), icon: "file", panel: "workspace-editorial-panel", group: 0, shortcut: 2 },
  { value: "rss", label: trKey("阅读"), icon: "rss", panel: "workspace-rss-panel", group: 0, shortcut: 1 },
  { value: "discover", label: trKey("发现"), icon: "globe", panel: "workspace-discover-panel", group: 0, shortcut: 5 },
  { value: "gallery", label: trKey("素材"), icon: "image", panel: "workspace-gallery-panel", group: 0, shortcut: 4 },
  { value: "connections", label: trKey("连接"), icon: "link", panel: "workspace-connections-panel", group: 3, shortcut: 6 },
  { value: "center", label: trKey("中心"), icon: "globe", panel: "workspace-center-panel", group: 3, shortcut: 8 },
];

export const WORKSPACE_GROUPS = [0, 3].map((group) => WORKSPACE_CHOICES.filter((choice) => choice.group === group));
// Preserve existing shortcuts; manuscripts uses the next free slot.
export const workspaceShortcut = (slot: number) => WORKSPACE_CHOICES.find(choice => choice.shortcut === slot);

export function workspaceMeta(workspace: Workspace): WorkspaceChoice {
  const current = parseWorkspace(workspace);
  return WORKSPACE_CHOICES.find((choice) => choice.value === current)
    ?? WORKSPACE_CHOICES.find((choice) => choice.value === "rss")
    ?? WORKSPACE_CHOICES[0];
}

export function isTrendsWorkspace(workspace: Workspace): boolean {
  return workspace === "hot" || workspace === "labels";
}

export function isCalendarWorkspace(workspace: Workspace): boolean {
  return workspace === "year" || workspace === "history";
}

export function parseWorkspace(raw: string | null, section?: string | null): Workspace {
  if (raw === "publications" || raw === "website") return "editorial";
  if (["hotboard", "hot", "labels", "calendar", "year", "history"].includes(raw || "")) return "discover";
  if (raw === "rss" && ["hot", "labels", "calendar", "history"].includes(section || "")) return "discover";
  if (raw === "home") return "library";
  return WORKSPACE_CHOICES.some((choice) => choice.value === raw) ? raw as Workspace : "library";
}

function WorkspaceMark({ icon, size }: { icon: WorkspaceChoice["icon"]; size: number }) {
  if (icon === "logo") {
    const academic = ACTIVE_SITE.id === "scholay-today";
    return <img className={`workspace-logo${academic ? "" : " workspace-logo-site"}`} src={spaceLogo(ACTIVE_SITE.id) || "/scholay-logo.png"} alt="" width={size} height={academic ? Math.round(size * 25 / 24) : size} />;
  }
  return <Icon name={icon} size={size} />;
}

/** Host chrome: the current feature mark plus a Cursor-style activity rail. */
export default function WorkspaceSwitcher({ workspace, captureBusy, onChange, onOpenSettings, chromeHost }: {
  chromeHost?: HTMLElement | null;
  workspace: Workspace;
  captureBusy: boolean;
  onChange: (workspace: Workspace) => void;
  onOpenSettings?: () => void;
}) {
  const sharedChrome=useWindowChrome();
  const modifier = typeof document !== "undefined" && document.documentElement.dataset.platform === "mac" ? "⌘" : "Ctrl+";
  const current = workspaceMeta(workspace);
  const featureButton = (choice: WorkspaceChoice) => <button key={choice.value} type="button"
    className={choice.value === "library" ? "workspace-rail-home" : undefined}
    aria-label={tr(choice.label)} data-workspace={choice.value}
    aria-pressed={current.value === choice.value} aria-controls={choice.panel}
    disabled={captureBusy} data-tooltip={`${tr(choice.label)} · ${modifier}${choice.shortcut}`}
    aria-description={tr("快捷键 {{modifier}}{{index}}", {modifier, index: choice.shortcut})}
    onClick={() => onChange(choice.value)}>
    <WorkspaceMark icon={choice.icon} size={18}/><span className="workspace-feature-label">{tr(choice.label)}</span>
  </button>;
  const header = <header className="workspace-chrome task-global-header" data-tauri-drag-region="deep">
    <div className="workspace-title-brand" aria-label={tr(current.label)}>
      <span className="workspace-feature-mark"><WorkspaceMark icon={current.icon} size={16}/></span>
      <strong>{tr(current.label)}</strong>
    </div>
    {captureBusy && <span className="workspace-capture-status" role="status">{tr("正在捕获当前网页…")}</span>}
  </header>;
  return <>
    {!sharedChrome && current.value !== "editorial" && current.value !== "library" && current.value !== "manuscripts" && (chromeHost ? createPortal(header,chromeHost) : header)}
    <nav className="workspace-rail" aria-label={tr("工作区")}>
      <div className="workspace-rail-drag" data-tauri-drag-region />
      <SpaceEntrances disabled={captureBusy}/>
      <div className="workspace-rail-group">{WORKSPACE_CHOICES.filter(choice=>choice.group===0).map(featureButton)}</div>
      <div className="workspace-rail-foot">
        {WORKSPACE_CHOICES.filter(choice=>choice.group===3).map(featureButton)}
        <button type="button" className="workspace-rail-settings" data-tooltip={`${tr('设置')} · ${modifier},`}
          aria-label={tr("设置 · {{modifier}},", {modifier})} onClick={onOpenSettings}>
          <Icon name="settings" size={18}/>
          <span className="workspace-feature-label">{tr("设置")}</span>
        </button>
      </div>
    </nav>
  </>;
}
