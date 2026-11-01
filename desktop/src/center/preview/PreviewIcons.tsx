import AppIcon from "../../components/Icon";
import type { PreviewTab } from "./model";
import academic from "../../../../sites/branding/academic.png";
import facebook from "./assets/facebook.svg";
import linkedin from "./assets/linkedin.svg";
import x from "./assets/x.svg";
import telegram from "./assets/telegram.svg";
import discourse from "./assets/discourse.svg";

// Static local assets only; no connector or workspace runtime imports.
const siteImages = import.meta.glob("../../../../sites/branding/*-bw-v8.webp", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const platformImages: Record<string, string> = {
  Facebook: facebook,
  LinkedIn: linkedin,
  X: x,
  Telegram: telegram,
  Discourse: discourse,
};

export function WorkspaceIcon({
  workspaceId,
  size = 28,
}: {
  workspaceId: string;
  size?: number;
}) {
  const src =
    workspaceId === "academic"
      ? academic
      : siteImages["../../../../sites/branding/" + workspaceId + "-bw-v8.webp"];
  return (
    <span
      className="cp-brand cp-workspace-brand"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <AppIcon name="globe" size={size - 8} />
      )}
    </span>
  );
}

export function DestinationIcon({
  name,
  workspaceId,
  size = 30,
}: {
  name: string;
  workspaceId?: string;
  size?: number;
}) {
  const src = platformImages[name];
  if (!src && workspaceId)
    return <WorkspaceIcon workspaceId={workspaceId} size={size} />;
  return (
    <span
      className="cp-brand cp-platform-brand"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <AppIcon name="globe" size={size - 8} />
      )}
    </span>
  );
}

export function NavigationIcon({ tab }: { tab: PreviewTab }) {
  if (tab === "calendar")
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="5" width="18" height="16" rx="2.5" />
        <path d="M7 3v4m10-4v4M3 11h18M7 15h2m6 0h2M7 18h2" />
      </svg>
    );
  return (
    <AppIcon
      name={
        {
          overview: "grid",
          demands: "inbox",
          channels: "send",
          assistant: "sparkle",
        }[tab] as "grid" | "inbox" | "send" | "sparkle"
      }
      size={18}
    />
  );
}
