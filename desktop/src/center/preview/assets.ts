// Where the scheduling view's brand images come from. This is the desktop
// (Vite) lookup; the online Center ships its own file with the same exports.
// Static local assets only; no connector or workspace runtime imports.
import academic from "../../../../sites/branding/academic.png";
import facebook from "./assets/facebook.svg";
import linkedin from "./assets/linkedin.svg";
import x from "./assets/x.svg";
import telegram from "./assets/telegram.svg";
import discourse from "./assets/discourse.svg";

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

export const siteImage = (workspaceId: string): string | undefined =>
  workspaceId === "academic"
    ? academic
    : siteImages["../../../../sites/branding/" + workspaceId + "-bw-v8.webp"];
export const platformImage = (name: string): string | undefined =>
  platformImages[name];
