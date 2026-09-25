import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { PublicStaticIndexSchema, PublicStaticPointerSchema } from "../features/stories/public-static-schema.ts";
import { backupStoreIfDue } from "../server/lean/backup.ts";
import { DEFAULT_EDITORIAL_DOMAINS, type LeanSource } from "../server/lean/config.ts";
import { importEditorInbox, markInboxPublished, parseSubmission, type InboxEntry } from "../server/lean/editor-inbox.ts";
import { isAgencyImage, largeTwimgUrl, parseFeed } from "../server/lean/feed.ts";
import { localizeImages, mediaKey } from "../server/lean/media.ts";
import { parseRefineOutput } from "../server/lean/refine.ts";
import { buildSiteBundle } from "../server/lean/site-bundle.ts";
import { LeanStore, linkKey, type StoredItem } from "../server/lean/store.ts";
import { tweetSkipReason } from "../server/lean/x-filter.ts";

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

  it("recognizes photo-agency pictures by file name or credit", () => {
    expect(isAgencyImage("https://storage.ghost.io/c/content/images/2026/09/XPB_1438331_HiRes.jpg")).toBe(true);
    expect(isAgencyImage("https://cdn.example.com/GettyImages-2231.jpg")).toBe(true);
    expect(isAgencyImage("https://e1.365dm.com/26/09/1920x1080/skysports-f1-lando-norris_7360408.jpg", "Getty Images")).toBe(true);
    expect(isAgencyImage("https://cdn-8.motorsport.com/images/amp/2wlKQEbY/s6/carlos-sainz-williams.jpg")).toBe(false);
    expect(isAgencyImage("https://e1.365dm.com/26/09/1920x1080/skysports-f1-lando-norris_7360408.jpg")).toBe(false);
  });

  it("parses Atom entries; an X post without media has no picture", () => {
    const [entry] = parseFeed(xSource, ATOM_XML);
    expect(entry.link).toBe("https://x.com/F1/status/123");
    expect(entry.text).toBe("Lights out");
    expect(entry.image).toBeNull();
  });

  it("takes the first tweet photo, or the video poster, in its large rendition", () => {
    const [photo, video, legacy] = parseFeed(xSource, X_RSS_XML);
    expect(photo.image).toEqual({ url: "https://pbs.twimg.com/media/HS_v3nJXcAAb1pH?format=jpg&name=large", mimeType: "image/jpeg", declaredBytes: 1 });
    expect(photo.text).toContain("qualifying start times");
    expect(video.image?.url).toBe("https://pbs.twimg.com/amplify_video_thumb/2103152891858968581/img/VlIidEDQVmuq59JJ?format=jpg&name=large");
    expect(legacy.image?.url).toBe("https://pbs.twimg.com/media/ABC?format=png&name=large");
    expect(largeTwimgUrl("https://pbs.twimg.com/profile_images/1/a.jpg")).toBeNull();
    expect(largeTwimgUrl("https://example.com/media/a.jpg")).toBeNull();
  });
});

const X_RSS_XML = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Qualifying start times</title><link>https://x.com/F1/status/2103203313621844118</link><pubDate>Fri, 25 Sep 2026 01:00:00 GMT</pubDate>
<description>Don&amp;#39;t miss the battle for pole ⚔️&lt;br&gt;&lt;br&gt;Check the qualifying start times 🌍&lt;br&gt;&lt;img width="960" height="1200" style="" src="https://pbs.twimg.com/media/HS_v3nJXcAAb1pH?format=jpg&amp;amp;name=orig" referrerpolicy="no-referrer"&gt;&lt;br&gt;&lt;img src="https://pbs.twimg.com/media/SECOND?format=jpg&amp;amp;name=orig"&gt;</description></item>
<item><title>Baku bridge</title><link>https://x.com/F1/status/2103211618280604081</link><pubDate>Fri, 25 Sep 2026 01:10:00 GMT</pubDate>
<description>There are trackside views... and then there is Baku's bridge&lt;br&gt;&lt;video width="1080" height="1920" src="https://video.twimg.com/amplify_video/2103152891858968581/vid/avc1/1080x1920/8EjnKxr_oCKFLGy-.mp4?tag=29" controls="controls" poster="https://pbs.twimg.com/amplify_video_thumb/2103152891858968581/img/VlIidEDQVmuq59JJ.jpg"&gt;&lt;/video&gt;</description></item>
<item><title>Legacy</title><link>https://x.com/F1/status/3</link><description>Old style photo of the grid today&lt;img src="https://pbs.twimg.com/profile_images/9/me.jpg"&gt;&lt;img src="https://pbs.twimg.com/media/ABC.png"&gt;</description></item>
</channel></rss>`;

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

  it("fills in a picture for a stored post that had none, without touching other fields", () => {
    directory = mkdtempSync(join(tmpdir(), "lean-store-"));
    const store = new LeanStore(join(directory, "store.sqlite"));
    const [photo] = parseFeed(xSource, X_RSS_XML);
    store.addEntries(xSource, [{ ...photo, image: null }], "2026-09-25T01:00:00.000Z");
    expect(store.addEntries(xSource, [{ ...photo, title: "changed" }], "2026-09-25T01:30:00.000Z")).toBe(0);
    const [item] = store.pending(10);
    expect(item).toMatchObject({ title: photo.title, image: photo.image, firstSeenAt: "2026-09-25T01:00:00.000Z" });
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

describe("lean editor inbox", () => {
  const DOMAINS = ["www.formula1.com"];
  const submission = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    schemaVersion: "editor-submission-v1",
    idempotencyKey: "20260924-f1com-fp2-russell",
    originalUrl: "https://www.formula1.com/en/latest/article/fp2-russell-leads.37CqNf2uaAyxvDPmvbt3Iw",
    sourceName: "Formula1.com",
    sourceDomain: "www.formula1.com",
    originalTitle: "FP2: Russell leads Antonelli and Verstappen",
    sourcePublishedAt: "2026-09-24T13:05:00.000Z",
    contentType: "race_news",
    credibility: "official",
    titleZh: "阿塞拜疆二练：拉塞尔再夺头名",
    summaryZh: "乔治·拉塞尔在巴库二练以 1:43.347 最快。",
    keyPointsZh: ["拉塞尔包揽 FP1/FP2 头名", "梅赛德斯 1–2", "红旗", "第四条被截掉"],
    ...overrides
  });

  function setup() {
    directory = mkdtempSync(join(tmpdir(), "lean-inbox-"));
    const inbox = join(directory, "editor-inbox");
    mkdirSync(inbox);
    return { store: new LeanStore(join(directory, "store.sqlite")), inbox };
  }
  const status = (inbox: string) => JSON.parse(readFileSync(join(inbox, "status.json"), "utf8")) as { entries: InboxEntry[] };

  it("imports a valid submission as ready without the model and rejects bad or duplicate ones", () => {
    const { store, inbox } = setup();
    writeFileSync(join(inbox, "a-good.json"), submission());
    writeFileSync(join(inbox, "b-domain.json"), submission({ idempotencyKey: "k2", sourceDomain: "www.getty.com", originalUrl: "https://www.getty.com/x" }));
    writeFileSync(join(inbox, "c-missing.json"), submission({ idempotencyKey: "k3", titleZh: undefined }));
    writeFileSync(join(inbox, "d-dup.json"), submission({ idempotencyKey: "k4", originalUrl: "https://www.formula1.com/en/latest/article/fp2-russell-leads.37CqNf2uaAyxvDPmvbt3Iw?utm=x" }));

    const report = importEditorInbox(store, inbox, { enabled: true, publishMode: "auto" }, DOMAINS, "2026-09-24T15:00:00.000Z");
    expect(report).toMatchObject({ imported: 1, held: 0, rejected: 3 });
    const [item] = store.ready(10, "2026-01-01T00:00:00.000Z");
    expect(item).toMatchObject({ sourceId: "editor-www-formula1-com", displayName: "Formula1.com", titleZh: "阿塞拜疆二练：拉塞尔再夺头名", attempts: 0 });
    expect(item.keyPointsZh).toHaveLength(3);
    expect(readdirSync(join(inbox, "done")).sort()).toEqual(["a-good.json", "a-good.receipt.json"]);
    expect(readFileSync(join(inbox, "rejected", "b-domain.reason.txt"), "utf8").trim()).toBe("DOMAIN_NOT_ALLOWED");
    expect(readFileSync(join(inbox, "rejected", "c-missing.reason.txt"), "utf8")).toContain("INVALID_FIELD: titleZh");
    expect(readFileSync(join(inbox, "rejected", "d-dup.reason.txt"), "utf8").trim()).toBe("DUPLICATE");
    expect(status(inbox).entries.find((entry) => entry.file === "a-good.json")).toMatchObject({ state: "done", publicId: item.publicId, publishedHint: "awaiting_publish" });

    markInboxPublished(inbox, "abc123", "2026-09-24T15:10:00.000Z");
    expect(status(inbox).entries.find((entry) => entry.file === "a-good.json")).toMatchObject({ publishedHint: "published", commit: "abc123" });
    store.close();
  });

  it("holds submissions out of the public set until the mode is switched back to auto", () => {
    const { store, inbox } = setup();
    writeFileSync(join(inbox, "held.json"), submission());
    expect(importEditorInbox(store, inbox, { enabled: true, publishMode: "hold" }, DOMAINS, "2026-09-24T15:00:00.000Z")).toMatchObject({ held: 1 });
    expect(store.ready(10, "2026-01-01T00:00:00.000Z")).toHaveLength(0);
    expect(store.held()).toHaveLength(1);
    expect(status(inbox).entries[0]).toMatchObject({ state: "held", publishedHint: "held_preview_only" });

    expect(importEditorInbox(store, inbox, { enabled: true, publishMode: "auto" }, DOMAINS, "2026-09-24T15:10:00.000Z")).toMatchObject({ released: 1 });
    expect(store.ready(10, "2026-01-01T00:00:00.000Z")).toHaveLength(1);
    expect(status(inbox).entries[0]).toMatchObject({ state: "done", publishedHint: "awaiting_publish" });
    store.close();
  });

  it("accepts tweets from the default allow-list", () => {
    const tweet = submission({ originalUrl: "https://x.com/F1/status/2103211618280604081", sourceDomain: "x.com", sourceName: "@F1" });
    expect(parseSubmission(tweet, DEFAULT_EDITORIAL_DOMAINS, "ready", "2026-09-24T15:00:00.000Z").item.sourceId).toBe("editor-x-com");
    const legacy = submission({ originalUrl: "https://twitter.com/F1/status/1", sourceDomain: "twitter.com" });
    expect(parseSubmission(legacy, DEFAULT_EDITORIAL_DOMAINS, "ready", "2026-09-24T15:00:00.000Z").item.sourceId).toBe("editor-twitter-com");
  });

  it("stores an allow-listed imageUrl and rejects other picture hosts", () => {
    const parse = (imageUrl: string) => parseSubmission(submission({ imageUrl }), DOMAINS, "ready", "2026-09-24T15:00:00.000Z").item.image;
    expect(parse("https://media.formula1.com/image/upload/c_lfill,w_1320/q_auto/v1740000000/fom-website/2026/Azerbaijan/russell-fp2.webp"))
      .toMatchObject({ url: expect.stringContaining("media.formula1.com"), mimeType: "image/webp" });
    expect(parse("https://i.ytimg.com/vi/abc123/maxresdefault.jpg")).toEqual({ url: "https://i.ytimg.com/vi/abc123/maxresdefault.jpg", mimeType: "image/jpeg", declaredBytes: 1 });
    expect(parse("https://pbs.twimg.com/media/HS_v3nJXcAAb1pH?format=jpg&name=orig")?.url).toBe("https://pbs.twimg.com/media/HS_v3nJXcAAb1pH?format=jpg&name=large");
    expect(() => parse("https://cdn.example.com/a.jpg")).toThrow("IMAGE_DOMAIN_NOT_ALLOWED");
    expect(() => parse("https://media.formula1.com/image/upload/GettyImages-2231.jpg")).toThrow("IMAGE_AGENCY_NOT_ALLOWED");

    const { store, inbox } = setup();
    writeFileSync(join(inbox, "a.json"), submission({ imageUrl: "https://i.ytimg.com/vi/abc123/maxresdefault.jpg" }));
    importEditorInbox(store, inbox, { enabled: true, publishMode: "auto" }, DOMAINS, "2026-09-24T15:00:00.000Z");
    expect(store.ready(10, "2026-01-01T00:00:00.000Z")[0].image?.url).toBe("https://i.ytimg.com/vi/abc123/maxresdefault.jpg");
    store.close();
  });

  it("leaves the inbox untouched when disabled", () => {
    const { store, inbox } = setup();
    writeFileSync(join(inbox, "a.json"), submission());
    expect(importEditorInbox(store, inbox, { enabled: false, publishMode: "auto" }, DOMAINS, "2026-09-24T15:00:00.000Z")).toMatchObject({ enabled: false, imported: 0 });
    expect(readdirSync(inbox)).toEqual(["a.json"]);
    store.close();
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

  it("references only site-hosted pictures and marks the rest media_missing so no placeholder is drawn", () => {
    const image = { url: "https://cdn.motorsport.com/a.jpg", mimeType: "image/jpeg" as const, declaredBytes: 1 };
    const agency = { ...image, url: "https://cdn.example.com/GettyImages-1.jpg" };
    const notLocalized = { ...image, url: "https://pbs.twimg.com/media/X?format=jpg&name=large" };
    const items = [readyItem(1), readyItem(2, { image }), readyItem(3, { image: agency }), readyItem(4, { image: notLocalized })];
    const localMedia = new Map([
      [image.url, { sitePath: "media/aaa.webp", file: "/cache/aaa.webp", bytes: 4321 }],
      [agency.url, { sitePath: "media/bbb.webp", file: "/cache/bbb.webp", bytes: 1 }]
    ]);
    const bundle = buildSiteBundle(items, "2026-09-24T14:00:00.000Z", localMedia);
    const read = (path: string): unknown => JSON.parse(bundle.files.get(path)!.toString());
    const pointer = PublicStaticPointerSchema.parse(read("_public/current.json"));
    const index = PublicStaticIndexSchema.parse(read(pointer.indexPath));
    const feed = read(`_public/generations/${pointer.bundleId}/${index.responses["/api/public/feed"].path}`) as { items: { publicId: string; state: string; media: unknown }[] };
    const byId = new Map(feed.items.map((item) => [item.publicId, item]));
    expect(byId.get(items[0].publicId)).toMatchObject({ state: "media_missing", media: null });
    expect(byId.get(items[1].publicId)).toMatchObject({ state: "ready", media: {
      kind: "source_image", assetRef: "https://1404369477-blip.github.io/f1plus1/media/aaa.webp", mimeType: "image/webp", declaredBytes: 4321 } });
    expect(byId.get(items[2].publicId)).toMatchObject({ state: "media_missing", media: null });
    expect(byId.get(items[3].publicId)).toMatchObject({ state: "media_missing", media: null });
    expect([...bundle.mediaFiles]).toEqual([["media/aaa.webp", "/cache/aaa.webp"]]);
  });
});

describe("lean X post filter", () => {
  const reason = (text: string) => tweetSkipReason({ title: text.slice(0, 80), text });
  it("skips promotions, retweets and captions without substance", () => {
    expect(reason("Haven't entered yet? Last chance to enter our ultimate Las Vegas competition - enter via the link 👉 https://t.co/x")).toBe("promotion");
    expect(reason("WIN a signed cap! Follow and retweet for your chance #Giveaway")).toBe("promotion");
    expect(reason("A once-in-a-lifetime trip awaits 🇺🇸 Tap here for your chance to be our VIP in Las Vegas: https://bit.ly/4xYLmN9")).toBe("promotion");
    expect(reason("Tickets for the 2027 season are on sale now, grab yours today")).toBe("promotion");
    expect(reason("The new team collection has landed, shop now at the store today")).toBe("promotion");
    expect(reason("转发抽奖：送出三顶车队签名帽，快来参与我们的活动吧")).toBe("promotion");
    expect(reason("RT @F1: Lights out and away we go in Baku for the race")).toBe("retweet");
    expect(reason("Hello FP2 👋")).toBe("too_short");
    expect(reason("🤩🤩🤩")).toBe("too_short");
    expect(reason("Golden hour glow. #AzerbaijanGP")).toBe("too_short");
    expect(reason("Helmet ⬇️ #F1 #VCARB #AzerbaijanGP https://t.co/abc")).toBe("too_short");
  });

  it("keeps race news, including a bare 'win'", () => {
    expect(reason("Can Leclerc win in Baku? The Ferrari driver was fastest in FP2 on Friday")).toBeNull();
    expect(reason("Kimi knows how to make a fans day 🥹")).toBeNull();
    expect(reason("Drivers 44 and 16 ready for racing 🏎️🇦🇿")).toBeNull();
  });

  it("takes filtered posts off the site, including ones already public", () => {
    directory = mkdtempSync(join(tmpdir(), "lean-xfilter-"));
    const store = new LeanStore(join(directory, "store.sqlite"));
    store.importReady(readyItem(1, { platform: "x", sourceId: "x-f1", link: "https://x.com/F1/status/1", text: "Last chance to enter our competition via the link" }));
    store.importReady(readyItem(2, { platform: "x", sourceId: "x-f1", link: "https://x.com/F1/status/2", text: "Kimi knows how to make a fans day 🥹" }));
    for (const post of store.activeXPosts()) if (tweetSkipReason(post)) store.retire(post.publicId);
    expect(store.ready(10, "2026-01-01T00:00:00.000Z").map((item) => item.link)).toEqual(["https://x.com/F1/status/2"]);
    expect(store.counts()).toMatchObject({ ready: 1, skipped: 1 });
    store.close();
  });
});

describe("lean media localization", () => {
  it("stores a WebP copy at most 1200 wide, skips agency pictures and retries failures later", async () => {
    directory = mkdtempSync(join(tmpdir(), "lean-media-"));
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#e10600" } }).png().toBuffer();
    const good = "https://pbs.twimg.com/media/GOOD?format=jpg&name=large";
    const missing = "https://cdn.motorsport.com/missing.jpg";
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      return url === good ? new Response(png, { headers: { "content-type": "image/png" } }) : new Response("no", { status: 404 });
    }) as unknown as typeof fetch;
    const image = (url: string) => ({ url, mimeType: "image/jpeg" as const, declaredBytes: 1 });
    const items = [readyItem(1, { image: image(good) }), readyItem(2, { image: image(missing) }), readyItem(3, { image: image("https://x.test/GettyImages-9.jpg") }), readyItem(4)];

    const first = await localizeImages(items, directory, new Date("2026-09-25T02:00:00Z"), { fetcher });
    expect(first.report).toEqual({ cached: 0, downloaded: 1, failed: 1, deferred: 0 });
    const local = first.media.get(good)!;
    expect(local.sitePath).toBe(`media/${mediaKey(good)}.webp`);
    const meta = await sharp(readFileSync(local.file)).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 1200, height: 600 });
    expect(calls.sort()).toEqual([missing, good].sort());

    const second = await localizeImages(items, directory, new Date("2026-09-25T02:10:00Z"), { fetcher });
    expect(second.report).toEqual({ cached: 1, downloaded: 0, failed: 0, deferred: 0 });
    expect(calls).toHaveLength(2);
    const third = await localizeImages(items, directory, new Date("2026-09-25T03:10:00Z"), { fetcher });
    expect(third.report.failed).toBe(1);
    expect(JSON.parse(readFileSync(join(directory, "failures.json"), "utf8"))[mediaKey(missing)]).toMatchObject({ attempts: 2, error: "IMAGE_HTTP_404" });
  });
});
