import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PublicStaticIndexSchema, PublicStaticPointerSchema } from "../features/stories/public-static-schema.ts";
import { backupStoreIfDue } from "../server/lean/backup.ts";
import type { LeanSource } from "../server/lean/config.ts";
import { parseFeed } from "../server/lean/feed.ts";
import { parseRefineOutput } from "../server/lean/refine.ts";
import { buildSiteBundle } from "../server/lean/site-bundle.ts";
import { LeanStore, linkKey, type StoredItem } from "../server/lean/store.ts";

const rssSource: LeanSource = { sourceId: "motorsport-f1-news", platform: "rss", displayName: "Motorsport.com", feedUrl: "https://example.test/rss", contentType: "race_news", requireRelevance: false };
const xSource: LeanSource = { sourceId: "x-f1", platform: "x", displayName: "@F1", feedUrl: "http://127.0.0.1:1200/twitter/user/F1", contentType: "race_news", requireRelevance: false };

const RSS_XML = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<item><title>Verstappen wins &amp; leads</title><link>https://www.motorsport.com/f1/news/a/1/?utm_source=RSS&amp;utm_medium=x</link>
<description><![CDATA[<p>Max won the race.</p>]]></description><pubDate>Thu, 24 Sep 2026 12:23:20 GMT</pubDate>
<enclosure url="https://cdn.motorsport.com/a.jpg" type="image/jpeg" length="1234"/></item>
<item><title>No link item</title></item>
<item><title>Sky item</title><link>https://www.skysports.com/f1/news/12433/1/sky</link><pubDate>Thu, 24 Sep 2026 14:10:00 BST</pubDate></item>
</channel></rss>`;

const ATOM_XML = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Race day</title><link rel="alternate" href="https://x.com/F1/status/123"/><content type="html">&lt;p&gt;Lights out&lt;/p&gt;</content><updated>2026-09-24T10:00:00Z</updated></entry>
</feed>`;

let directory: string | null = null;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = null; });

function readyItem(index: number, overrides: Partial<StoredItem> = {}): StoredItem {
  return {
    publicId: `public-rss-${String(index).padStart(64, "0")}`,
    sourceId: "motorsport-f1-news", platform: "rss", displayName: "Motorsport.com", contentType: "race_news", requireRelevance: false,
    link: `https://www.motorsport.com/f1/news/${index}/`, title: `t${index}`, text: `x${index}`,
    sourcePublishedAt: new Date(Date.UTC(2026, 8, 24, 0, index)).toISOString(), firstSeenAt: "2026-09-24T00:00:00.000Z",
    image: null, status: "ready", attempts: 1, titleZh: `标题${index}`, summaryZh: `摘要${index}`, keyPointsZh: [`要点${index}`],
    publishedAt: "2026-09-24T01:00:00.000Z", ...overrides
  };
}

describe("lean feed parsing", () => {
  it("normalizes RSS items and drops entries without an https link", () => {
    const [entry, sky, ...rest] = parseFeed(rssSource, RSS_XML);
    expect(rest).toHaveLength(0);
    expect(sky.sourcePublishedAt).toBe("2026-09-24T13:10:00.000Z");
    expect(entry.title).toBe("Verstappen wins & leads");
    expect(entry.text).toBe("Max won the race.");
    expect(entry.sourcePublishedAt).toBe("2026-09-24T12:23:20.000Z");
    expect(entry.image).toEqual({ url: "https://cdn.motorsport.com/a.jpg", mimeType: "image/jpeg", declaredBytes: 1234 });
  });

  it("parses Atom entries and never attaches images to X posts", () => {
    const [entry] = parseFeed(xSource, ATOM_XML);
    expect(entry.link).toBe("https://x.com/F1/status/123");
    expect(entry.text).toBe("Lights out");
    expect(entry.image).toBeNull();
  });
});

describe("lean store", () => {
  it("treats tracking-parameter and HTML-escaped variants of a link as the same story", () => {
    expect(linkKey("https://www.motorsport.com/f1/news/a/1/?utm_source=RSS&amp;utm_medium=x"))
      .toBe(linkKey("https://motorsport.com/f1/news/a/1?utm_source=other"));
    directory = mkdtempSync(join(tmpdir(), "lean-store-"));
    const store = new LeanStore(join(directory, "store.sqlite"));
    const entries = parseFeed(rssSource, RSS_XML);
    expect(store.addEntries(rssSource, entries, "2026-09-24T13:00:00.000Z")).toBe(2);
    expect(store.addEntries(rssSource, entries, "2026-09-24T13:15:00.000Z")).toBe(0);
    const [pending] = store.pending(10);
    store.markReady(pending.publicId, "标题", "摘要", ["要点"], "2026-09-24T13:16:00.000Z");
    expect(store.counts()).toMatchObject({ pending: 1, ready: 1 });
    store.close();
  });

  it("writes one verified backup per hour locally and one per day off-site", () => {
    directory = mkdtempSync(join(tmpdir(), "lean-backup-"));
    const store = new LeanStore(join(directory, "store.sqlite"));
    store.importReady(readyItem(1));
    const dirs = { local: join(directory, "local"), offsite: join(directory, "offsite") };

    const first = backupStoreIfDue(store, new Date("2026-09-24T13:05:00Z"), dirs);
    expect(first).toMatchObject({ items: 1, error: null });
    expect(first.hourly).toBe(join(dirs.local, "store-2026092413.sqlite"));
    expect(first.offsite).toBe(join(dirs.offsite, "lean-store-20260924.sqlite"));
    expect(backupStoreIfDue(store, new Date("2026-09-24T13:55:00Z"), dirs)).toMatchObject({ hourly: null, offsite: null, items: 1 });
    expect(backupStoreIfDue(store, new Date("2026-09-24T14:00:00Z"), dirs).hourly).toBe(join(dirs.local, "store-2026092414.sqlite"));
    expect(readdirSync(dirs.local).sort()).toEqual(["store-2026092413.sqlite", "store-2026092414.sqlite"]);
    store.close();
  });
});

describe("lean model output", () => {
  it("accepts Chinese output and rejects missing Chinese text", () => {
    expect(parseRefineOutput(JSON.stringify({ relevant: true, titleZh: "维斯塔潘夺冠", summaryZh: "维斯塔潘赢得比赛。", keyPointsZh: ["夺冠", ""] }), false))
      .toEqual({ kind: "ready", titleZh: "维斯塔潘夺冠", summaryZh: "维斯塔潘赢得比赛。", keyPointsZh: ["夺冠"] });
    expect(() => parseRefineOutput(JSON.stringify({ titleZh: "Win", summaryZh: "Max won." }), false)).toThrow("MODEL_OUTPUT_INVALID");
  });

  it("skips irrelevant posts only for sources that require relevance", () => {
    const raw = JSON.stringify({ relevant: false, titleZh: "新车评测", summaryZh: "一辆公路车的评测。", keyPointsZh: [] });
    expect(parseRefineOutput(raw, true)).toEqual({ kind: "irrelevant" });
    expect(parseRefineOutput(raw, false).kind).toBe("ready");
  });
});

describe("lean site bundle", () => {
  it("produces a valid pointer, index and a complete cursor chain", () => {
    const items = Array.from({ length: 30 }, (_, index) => readyItem(index));
    items.push(readyItem(99, { publicId: `public-x-${"f".repeat(64)}`, sourceId: "x-f1", platform: "x", displayName: "@F1", contentType: "driver_social", link: "https://x.com/F1/status/1" }));
    const bundle = buildSiteBundle(items, "2026-09-24T14:00:00.000Z");
    const read = (path: string): unknown => JSON.parse(bundle.files.get(path)!.toString());
    const pointer = PublicStaticPointerSchema.parse(read("_public/current.json"));
    const index = PublicStaticIndexSchema.parse(read(pointer.indexPath));
    const body = (key: string): { items: { publicId: string }[]; page: { hasMore: boolean; nextCursor: { cursorAt: string; cursorId: string } | null } } =>
      read(`_public/generations/${pointer.bundleId}/${index.responses[key].path}`) as never;

    const seen: string[] = [];
    let key = "/api/public/feed";
    for (;;) {
      const page = body(key);
      seen.push(...page.items.map((item) => item.publicId));
      if (!page.page.nextCursor) break;
      const query = new URLSearchParams({ cursorAt: page.page.nextCursor.cursorAt, cursorId: page.page.nextCursor.cursorId });
      query.sort();
      key = `/api/public/feed?${query}`;
    }
    expect(seen).toHaveLength(31);
    expect(new Set(seen).size).toBe(31);
    expect(body("/api/public/feed?contentType=driver_social").items.map((item) => item.publicId)).toEqual([`public-x-${"f".repeat(64)}`]);
    expect(index.responses[`/api/public/stories/${items[0].publicId}`].status).toBe(200);
    expect(index.responses["/api/public/feed?limit=12&v=2"].status).toBe(503);
    expect(buildSiteBundle(items, "2026-09-24T15:00:00.000Z").contentFingerprint).toBe(bundle.contentFingerprint);
  });
});
