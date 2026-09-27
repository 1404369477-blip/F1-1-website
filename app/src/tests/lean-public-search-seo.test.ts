import { describe, expect, it } from "vitest";

import { PublicSearchIndexSchema } from "../features/stories/public-search-schema.ts";
import { publicStoryIdFromLocation } from "../features/stories/public-site-config";
import { buildSiteBundle, renderPermanentStoryPage, type SiteBundle } from "../server/lean/site-bundle.ts";
import type { StoredItem } from "../server/lean/store.ts";

const now = "2026-09-28T00:00:00.000Z";
function item(id: string, overrides: Partial<StoredItem> = {}): StoredItem {
  return {
    publicId: `public-${id}`, sourceId: "news", platform: "rss", displayName: "Source News",
    contentType: "race_news", requireRelevance: false, link: `https://www.formula1.com/news/${id}`,
    title: `Race update ${id}`, text: "Source excerpt", sourcePublishedAt: now, firstSeenAt: now,
    image: null, images: [], status: "ready", attempts: 1, titleZh: `赛车新闻${id}`, summaryZh: "车队发布赛车升级。",
    summaryEn: "The team updates its car.", keyPointsZh: [], keyPointsEn: [], detailZh: ["这是完整的中文正文。"],
    detailEn: ["This is the full English body."], publishedAt: now, ...overrides
  };
}

function response(bundle: SiteBundle, key: string): unknown {
  const index = JSON.parse(bundle.files.get(`_public/generations/${bundle.bundleId}/index.json`)!.toString());
  const ref = index.responses[key];
  return JSON.parse(bundle.files.get(`_public/generations/${bundle.bundleId}/${ref.path}`)!.toString());
}

const template = '<!doctype html><html><head><title>F1+1</title><meta name="description" content="generic"/><meta property="og:title" content="generic"/><link rel="stylesheet" href="/_next/site.css"/></head><body><div id="public-story-document"><!--F1_PUBLIC_STORY_DOCUMENT--></div><div id="public-story-enhancement" hidden></div><script src="/_next/reader.js" async></script></body></html>';

describe("lean public search and permanent documents", () => {
  it("indexes the whole ready archive, including results beyond the first 12, without indexing body or images", () => {
    const recent = Array.from({ length: 25 }, (_, index) => item(`recent-${index}`));
    const archived = item("archived", { sourcePublishedAt: "2025-01-01T00:00:00.000Z", summaryZh: "历史规则变更", detailZh: ["仅存在于正文的特别字串"] });
    const bundle = buildSiteBundle(recent, now, new Map(), new Set(), [archived]);
    const index = PublicSearchIndexSchema.parse(response(bundle, "/api/public/search?v=1"));
    expect(index.items).toHaveLength(26);
    expect(index.items.some((entry) => entry.publicId === archived.publicId)).toBe(true);
    expect(JSON.stringify(index)).not.toContain("仅存在于正文的特别字串");
    expect(bundle.storyPages?.has("stories/public-archived/index.html")).toBe(true);
    expect(response(bundle, "/api/public/stories/public-archived")).toMatchObject({ story: { publicId: archived.publicId } });
  });

  it.each([2000, 2001, 3510, 4000])("does not let a %i-character X title block publication or truncate the public detail", (length) => {
    const title = `${"A".repeat(length - 9)} tailword`;
    const story = item("long-x", { platform: "x", link: "https://x.com/F1/status/123", title, summaryEn: title, detailEn: [title] });
    const bundle = buildSiteBundle([story], now);
    const index = PublicSearchIndexSchema.parse(response(bundle, "/api/public/search?v=1"));
    expect(index.items[0].titleEn).toBe(title.slice(0, 2000));
    expect(index.items[0].summaryEn).toBe(title);
    expect(response(bundle, "/api/public/stories/public-long-x?v=1")).toMatchObject({ story: { originalTitle: title, summaryEn: title, detailEn: [title] } });
    expect(bundle.storyPages!.get("stories/public-long-x/index.html")!.bodyHtml).toContain(title);
  });

  it("bounds only the search projection of overlong legacy fields without splitting emoji or changing a source URL", () => {
    const title = `${"A".repeat(1999)}🏎${"B".repeat(1200)}`;
    const story = item("legacy", { title, titleZh: "中".repeat(601), summaryZh: "摘要".repeat(1500), summaryEn: "S".repeat(20_001), displayName: "N".repeat(201), link: `https://www.formula1.com/${"a".repeat(4100)}` });
    const bundle = buildSiteBundle([story], now);
    const row = PublicSearchIndexSchema.parse(response(bundle, "/api/public/search?v=1")).items[0];
    expect(row).toMatchObject({ titleZh: "中".repeat(600), summaryZh: "摘要".repeat(1000), titleEn: "A".repeat(1999), summaryEn: "S".repeat(20_000), sourceName: "N".repeat(200), originalUrl: null });
    expect(response(bundle, "/api/public/stories/public-legacy?v=1")).toMatchObject({ story: { titleZh: story.titleZh, summaryZh: story.summaryZh, originalTitle: title, summaryEn: story.summaryEn, originalLink: { url: story.link } } });
  });

  it("keeps held/skipped stories out of search, permanent pages and the public bundle, even in a private preview", () => {
    const held = item("held", { status: "held", titleZh: "尚未公开的秘密稿" });
    const skipped = item("skipped", { status: "skipped", titleZh: "被撤回的秘密稿" });
    const bundle = buildSiteBundle([item("ready"), held], now, new Map(), new Set(), [skipped, held]);
    expect([...bundle.files.values()].map(String).join("")).not.toMatch(/秘密稿|public-held|public-skipped/);
    expect(bundle.storyPages?.size).toBe(1);
    const preview = buildSiteBundle([item("ready"), held], now, new Map(), new Set(), [], { preview: true });
    expect(response(preview, "/api/public/stories/public-held")).toMatchObject({ story: { publicId: held.publicId } });
    expect(PublicSearchIndexSchema.parse(response(preview, "/api/public/search?v=1")).items).toHaveLength(1);
    expect(preview.storyPages?.has("stories/public-held/index.html")).toBe(false);
  });

  it("does not expose denied full text in HTML, JSON, search, metadata or related responses", () => {
    const denied = item("denied", { detailZh: ["禁止正文独有字串"], detailEn: ["DENIED_BODY_ONLY_MARKER"] });
    const bundle = buildSiteBundle([denied, item("other")], now, new Map(), new Set(["formula1.com"]));
    const all = [...bundle.files.values()].map(String).join("") + [...bundle.storyPages!.values()].map((page) => renderPermanentStoryPage(template, page)).join("");
    expect(all).not.toMatch(/禁止正文独有字串|DENIED_BODY_ONLY_MARKER/);
    expect(all).toContain("车队发布赛车升级");
  });

  it("also withholds the original X post stored in summaryEn when its source disallows full text", () => {
    const originalPost = "DENIED_ORIGINAL_POST_ONLY_MARKER";
    const denied = item("denied-x", { platform: "x", link: "https://x.com/F1/status/123", title: originalPost, summaryEn: originalPost, detailEn: [originalPost] });
    const bundle = buildSiteBundle([denied, item("other")], now, new Map(), new Set(["x.com"]));
    const all = [...bundle.files.values()].map(String).join("") + [...bundle.storyPages!.values()].map((page) => renderPermanentStoryPage(template, page)).join("");
    expect(all).not.toContain(originalPost);
    expect(PublicSearchIndexSchema.parse(response(bundle, "/api/public/search?v=1")).items.find((entry) => entry.publicId === denied.publicId)?.summaryEn).toBeNull();
    expect(all).toContain("车队发布赛车升级");
  });

  it("renders an independent document with escaped metadata, readable no-JS body, canonical and the existing reader runtime", () => {
    const title = '标题 </title><script>alert("x")</script> & $&';
    const body = '正文 </script><img src=x onerror="alert(1)">';
    const bundle = buildSiteBundle([item("safe", { titleZh: title, summaryZh: title, detailZh: [body] })], now);
    const page = bundle.storyPages!.get("stories/public-safe/index.html")!;
    const html = renderPermanentStoryPage(template, page);
    expect(html).toContain('<link rel="canonical" href="https://f1plus1.com/stories/public-safe/"/>');
    expect(html).toContain('<meta property="og:url" content="https://f1plus1.com/stories/public-safe/"/>');
    expect(html).toContain('id="permanent-story-title"');
    expect(html).toContain("正文 &lt;/script&gt;&lt;img");
    expect(html).toContain('/_next/reader.js');
    expect(html).toContain('/_next/site.css');
    expect(html).not.toContain("<!--F1_PUBLIC_STORY_DOCUMENT-->");
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html.match(/<title>/g)).toHaveLength(1);
    const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1];
    expect(JSON.parse(jsonLd).headline).toBe(title);
    expect(jsonLd).not.toContain("</script>");
  });

  it("rejects unsafe or duplicate public IDs before emitting paths and fails closed on an obsolete detail shell", () => {
    for (const id of ["../../private", "public-a/b", 'public-a\" onerror=1', "public-<script>"]) {
      expect(() => buildSiteBundle([item("a", { publicId: id })], now)).toThrow("PUBLIC_ITEM_ID_INVALID");
    }
    expect(() => buildSiteBundle([item("a"), item("a")], now)).toThrow("PUBLIC_ITEM_ID_INVALID");
    const page = buildSiteBundle([item("a")], now).storyPages!.values().next().value!;
    expect(() => renderPermanentStoryPage("<html><head></head><body></body></html>", page)).toThrow("PUBLIC_STORY_TEMPLATE_INVALID");
  });

  it("uses permanent URLs in sitemap/RSS and retains strict compatibility for previously shared query URLs", () => {
    const bundle = buildSiteBundle([item("example")], now);
    expect(bundle.files.get("sitemap.xml")?.toString()).toContain("https://f1plus1.com/stories/public-example/");
    expect(bundle.files.get("rss.xml")?.toString()).toContain("https://f1plus1.com/stories/public-example/");
    expect(publicStoryIdFromLocation("/stories/public-example/", "")).toBe("public-example");
    expect(publicStoryIdFromLocation("/stories/public-example/index.html", "")).toBe("public-example");
    expect(publicStoryIdFromLocation("/stories/", "?publicId=public-example")).toBe("public-example");
    for (const [path, query] of [["/stories/", "?publicId=public-example&publicId=public-other"], ["/stories/public-example/", "?publicId=public-other"], ["/stories/%2e%2e/", ""], ["/stories/", "?publicId=public-a%2Fb"]]) {
      expect(publicStoryIdFromLocation(path, query)).toBeNull();
    }
  });

  it("publishes changed archive/SEO content but does not republish just because search generatedAt changes", () => {
    const first = buildSiteBundle([item("a")], now, new Map(), new Set(), [item("old")]);
    const later = buildSiteBundle([item("a")], "2026-09-28T00:10:00.000Z", new Map(), new Set(), [item("old")]);
    expect(later.bundleId).not.toBe(first.bundleId);
    expect(later.contentFingerprint).toBe(first.contentFingerprint);
    const edited = buildSiteBundle([item("a")], now, new Map(), new Set(), [item("old", { detailZh: ["归档正文已更正"] })]);
    expect(edited.contentFingerprint).not.toBe(first.contentFingerprint);
  });
});
