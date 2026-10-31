import type { ArticleQuery } from "../types";

export type RssLibrarySection = "articles" | "hot" | "labels" | "calendar" | "history";
export const RSS_LIBRARY_KEY = "scholay.rss.library.v1";

/** Retired main entrances keep their selected material library on first launch. */
export function parseRssLibrarySection(raw: string | null, legacyWorkspace?: string | null): RssLibrarySection {
  if (legacyWorkspace === "hot" || legacyWorkspace === "hotboard") return "hot";
  if (legacyWorkspace === "labels") return "labels";
  if (legacyWorkspace === "year" || legacyWorkspace === "calendar") return "calendar";
  if (legacyWorkspace === "history") return "history";
  return raw === "hot" || raw === "labels" || raw === "calendar" || raw === "history" ? raw : "articles";
}

export function currentRssQuery(query: ArticleQuery): ArticleQuery {
  return ["unread", "readLater"].includes(query.kind) ? { kind: "starred" } : query;
}
