import { describe, expect, it } from "vitest";
import { currentRssQuery, parseRssLibrarySection } from "./rssLibrary";

describe("RSS material library compatibility", () => {
  it("opens starred articles by default and restores each explicit library", () => {
    expect(parseRssLibrarySection(null)).toBe("articles");
    expect(parseRssLibrarySection("invalid")).toBe("articles");
    expect(parseRssLibrarySection("hot")).toBe("hot");
    expect(parseRssLibrarySection("labels")).toBe("labels");
    expect(parseRssLibrarySection("calendar")).toBe("calendar");
    expect(parseRssLibrarySection("history")).toBe("history");
  });
  it("moves old hot and labels entrances into RSS without losing selection", () => {
    expect(parseRssLibrarySection("articles", "hot")).toBe("hot");
    expect(parseRssLibrarySection(null, "hotboard")).toBe("hot");
    expect(parseRssLibrarySection("hot", "labels")).toBe("labels");
    expect(parseRssLibrarySection("labels", "rss")).toBe("labels");
    expect(parseRssLibrarySection("articles", "year")).toBe("calendar");
    expect(parseRssLibrarySection("articles", "calendar")).toBe("calendar");
    expect(parseRssLibrarySection("calendar", "history")).toBe("history");
  });
  it("retains saved subscriptions, folders, tags and formatted groups", () => {
    for (const kind of ["unread", "readLater"] as const) expect(currentRssQuery({ kind })).toEqual({ kind: "starred" });
    for (const query of [{ kind: "all" }, { kind: "feed", value: 7 }, { kind: "folder", value: 2 }, { kind: "tag", value: 5 }, { kind: "agented" }, { kind: "starred" }] as const) expect(currentRssQuery(query)).toBe(query);
  });
});
