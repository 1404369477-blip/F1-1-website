import { describe, expect, it } from "vitest";

import { RSS_SOURCE_CATALOG, liveRssSources, readyRssSources } from "../server/rss/catalog.ts";

describe("rss source catalog", () => {
  it("keeps four independent F1 RSS sources live and Formula1.com blocked", () => {
    expect(liveRssSources().map((entry) => entry.sourceId)).toEqual([
      "motorsport-f1-news",
      "autosport-f1-news",
      "racefans-f1-news",
      "the-race-f1-news"
    ]);
    expect(readyRssSources().map((entry) => entry.sourceId)).toEqual([
      "operator-manual"
    ]);
    expect(RSS_SOURCE_CATALOG.find((entry) => entry.sourceId === "formula1-latest-news")?.status).toBe("blocked");
    expect(RSS_SOURCE_CATALOG.find((entry) => entry.sourceId === "the-race-f1-news")?.feedUrl).toBe(
      "https://www.the-race.com/category/formula-1/rss/"
    );
    for (const entry of RSS_SOURCE_CATALOG) {
      if (entry.status !== "ready" || entry.sourceId === "operator-manual") continue;
      expect(entry.feedUrl.startsWith("https://")).toBe(true);
    }
  });
});
