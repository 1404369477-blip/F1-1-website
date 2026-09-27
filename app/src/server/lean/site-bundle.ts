import { createHash } from "node:crypto";

import { isPublicStaticId, normalizePublicStaticRequestKey } from "../../features/stories/public-static-schema.ts";
import { PUBLIC_SEARCH_PATH, PUBLIC_SEARCH_TEXT_LIMITS, PublicSearchIndexSchema } from "../../features/stories/public-search-schema.ts";
import { LEAN_CONTENT_TYPES, PAGES_URL, type LeanContentType } from "./config.ts";
import { englishOriginalTitle, isBoilerplateParagraph } from "./article.ts";
import { isAgencyImage } from "./feed.ts";
import type { LocalImage, LocalMedia } from "./media.ts";
import type { StoredItem } from "./store.ts";
import type { FeedImage } from "./feed.ts";

const PAGE_SIZE = 12;
const CONTENT_TYPES: readonly LeanContentType[] = LEAN_CONTENT_TYPES;
const JSON_TYPE = "application/json; charset=utf-8";
const PROBLEM_TYPE = "application/problem+json; charset=utf-8";

type ResponseRef = { status: 200 | 503; contentType: string; path: string; sha256: string };

export type SiteBundle = Readonly<{
  bundleId: string;
  /** Hash of all response bodies; unchanged content yields the same fingerprint. */
  contentFingerprint: string;
  /** Site-relative path → file bytes, including `_public/current.json`. */
  files: ReadonlyMap<string, Buffer>;
  /** Site-relative path → cached picture file to copy there. */
  mediaFiles: ReadonlyMap<string, string>;
  itemCount: number;
  /** Applied to the one prebuilt Next detail shell by stageSite; no per-story Next build. */
  storyPages?: ReadonlyMap<string, PermanentStoryPage>;
}>;

export type PermanentStoryPage = Readonly<{
  publicId: string;
  title: string;
  description: string;
  canonicalUrl: string;
  publishedAt: string;
  sourceName: string;
  bodyHtml: string;
  ogImage: string | null;
}>;

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

function timelineAt(item: StoredItem): string {
  return item.sourcePublishedAt ?? item.publishedAt ?? item.firstSeenAt;
}

/** Only site-hosted copies are referenced; a picture without one is left out rather than hot-linked. */
function localImages(item: StoredItem, localMedia: LocalMedia): { image: FeedImage; local: LocalImage }[] {
  const sources = item.images.length > 0 ? item.images : (item.image ? [item.image] : []);
  return sources.filter((image) => !isAgencyImage(image.url)).flatMap((image) => {
    const local = localMedia.get(image.url);
    return local ? [{ image, local }] : [];
  }).slice(0, 4);
}

/** `media_missing` makes the UI omit the picture area; `ready` without media would draw a synthetic placeholder. */
function feedItemWith(item: StoredItem, localMedia: LocalMedia, fullTextDenied: ReadonlySet<string>): Record<string, unknown> {
  const pictures = localImages(item, localMedia);
  const title = item.titleZh ?? item.title;
  const media = pictures.length === 0 ? null : pictures.map(({ image, local }, index) => ({
    kind: image.kind === "video_poster" ? "video_poster" : "source_image",
    assetRef: new URL(local.sitePath, PAGES_URL).toString(),
    mimeType: "image/webp",
    declaredBytes: local.bytes,
    ...(image.width ? { width: image.width } : {}),
    ...(image.height ? { height: image.height } : {}),
    altZh: `${title} · 第 ${index + 1} 张`
  }));
  const showFull = fullTextAllowed(item.link, fullTextDenied);
  return {
    publicId: item.publicId,
    contentType: item.contentType,
    state: media === null ? "media_missing" : "ready",
    titleZh: item.titleZh,
    summaryZh: item.summaryZh,
    publishedAt: item.publishedAt,
    sourcePublishedAt: item.sourcePublishedAt,
    sourceTimeStatus: item.sourcePublishedAt === null ? "unknown" : "known",
    source: { sourceId: item.sourceId, platform: item.platform, displayName: item.displayName, byline: item.displayName, accessStatus: "available" },
    media,
    originalLink: { enabled: true, url: item.link, reason: null },
    ...(englishOriginalTitle(item.title) && (showFull || item.platform !== "x") ? { originalTitle: item.title } : {}),
    // X stores the original post in summaryEn; a full-text denial applies to that copy too.
    summaryEn: showFull || item.platform !== "x" ? item.summaryEn : null,
    detailZh: showFull ? cleanParagraphs(item.detailZh) : undefined,
    detailEn: showFull ? cleanParagraphs(item.detailEn) : undefined,
    keyPointsZh: item.platform === "x" || item.keyPointsZh.length === 0 ? undefined : item.keyPointsZh,
    keyPointsEn: item.platform === "x" || item.keyPointsEn.length === 0 ? undefined : item.keyPointsEn,
  };
}

function cursorId(item: StoredItem, contentType: string | null, source: string | null): string {
  return Buffer.from(JSON.stringify({ contentType, publicId: item.publicId, source, timelineAt: timelineAt(item), v: 2 })).toString("base64url");
}

function feedPath(params: Record<string, string | null>): string {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== null));
  const text = query.toString();
  return `/api/public/feed${text ? `?${text}` : ""}`;
}

function relatedFor(item: StoredItem, items: readonly StoredItem[]): StoredItem[] {
  const others = items.filter((other) => other.publicId !== item.publicId);
  const sameSource = others.filter((other) => other.sourceId === item.sourceId);
  return [...sameSource, ...others.filter((other) => other.sourceId !== item.sourceId)].slice(0, 3);
}

function cleanParagraphs(paragraphs: string[] | null): string[] | undefined {
  if (!paragraphs) return undefined;
  const kept = paragraphs.map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length > 0 && !isBoilerplateParagraph(paragraph));
  return kept.length > 0 ? kept : undefined;
}

function fullTextAllowed(link: string, denied: ReadonlySet<string>): boolean {
  try {
    const host = new URL(link).hostname.replace(/^www\./, "").toLowerCase();
    for (const domain of denied) {
      const normalized = domain.replace(/^www\./, "").toLowerCase();
      if (host === normalized || host.endsWith(`.${normalized}`)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** The lightweight index is a bounded projection; legacy public DTOs keep their complete copy. */
function searchExcerpt(value: string, maximum: number): string {
  const prefix = value.slice(0, maximum);
  return /[\uD800-\uDBFF]$/u.test(prefix) ? prefix.slice(0, -1) : prefix;
}

/** Builds the static `/api/public/*` responses the published UI reads. `items` must be ready items inside the public window. Older ready items stay reachable from the archive page and their detail URLs. */
export function buildSiteBundle(readyItems: readonly StoredItem[], generatedAt: string, localMedia: LocalMedia = new Map(), fullTextDenied: ReadonlySet<string> = new Set(), archivedItems: readonly StoredItem[] = [], options: { preview?: boolean } = {}): SiteBundle {
  const order = (a: StoredItem, b: StoredItem) => timelineAt(b).localeCompare(timelineAt(a)) || b.publicId.localeCompare(a.publicId);
  const items = [...readyItems].filter((item) => item.status === "ready" || (options.preview && item.status === "held")).sort(order);
  const recentIds = new Set(items.map((item) => item.publicId));
  const archived = [...archivedItems].filter((item) => item.status === "ready" && !recentIds.has(item.publicId)).sort(order);
  const allItems = [...items, ...archived];
  const seenIds = new Set<string>();
  for (const item of allItems) {
    if (!isPublicStaticId(item.publicId) || seenIds.has(item.publicId)) throw new Error("PUBLIC_ITEM_ID_INVALID");
    seenIds.add(item.publicId);
  }
  const publicItems = allItems.filter((item) => item.status === "ready").sort(order);
  const feedItem = (item: StoredItem) => feedItemWith(item, localMedia, fullTextDenied);
  const mediaFiles = new Map<string, string>();
  for (const item of allItems) {
    for (const picture of localImages(item, localMedia)) mediaFiles.set(picture.local.sitePath, picture.local.file);
  }
  const responses: Record<string, ResponseRef> = {};
  const bodies = new Map<string, Buffer>();

  const add = (rawPath: string, status: 200 | 503, body: unknown, aliasWithoutVersion: boolean): void => {
    const bytes = Buffer.from(JSON.stringify(body));
    const hash = sha256(bytes);
    const ref: ResponseRef = { status, contentType: status === 200 ? JSON_TYPE : PROBLEM_TYPE, path: `responses/${hash}.json`, sha256: hash };
    bodies.set(hash, bytes);
    responses[normalizePublicStaticRequestKey(rawPath)] = ref;
    if (aliasWithoutVersion) {
      const alias = new URL(rawPath, "https://public.invalid");
      alias.searchParams.delete("v");
      responses[normalizePublicStaticRequestKey(`${alias.pathname}${alias.search}`)] = ref;
    }
  };

  for (const contentType of [null, ...CONTENT_TYPES]) {
    const scoped = items.filter((item) => contentType === null || item.contentType === contentType);
    let cursor: { cursorAt: string; cursorId: string } | null = null;
    let offset = 0;
    do {
      const page = scoped.slice(offset, offset + PAGE_SIZE);
      const hasMore = offset + PAGE_SIZE < scoped.length;
      const last = page.at(-1);
      const nextCursor = hasMore && last ? { cursorAt: timelineAt(last), cursorId: cursorId(last, contentType, null) } : null;
      add(feedPath({ v: "1", contentType, source: null, ...(cursor ?? {}) }), 200, {
        schemaVersion: "public-read-v0.1",
        items: page.map(feedItem),
        page: { pageSize: PAGE_SIZE, hasMore, nextCursor }
      }, true);
      cursor = nextCursor;
      offset += PAGE_SIZE;
    } while (cursor !== null);
  }

  for (const item of allItems) {
    const summary = item.summaryZh ?? "";
    add(`/api/public/stories/${item.publicId}?v=1`, 200, {
      schemaVersion: "public-read-v0.1",
      story: { ...feedItem(item), leadZh: summary || item.titleZh || item.title, bodyZh: [summary || item.titleZh || item.title], keyPointsZh: item.platform === "x" ? [] : item.keyPointsZh },
      relatedItems: relatedFor(item, items).map(feedItem)
    }, true);
  }

  const searchIndex = PublicSearchIndexSchema.parse({
    schemaVersion: "public-search-v1",
    generatedAt,
    items: publicItems.map((item) => {
      const showOriginal = fullTextAllowed(item.link, fullTextDenied) || item.platform !== "x";
      const originalUrl = safeOriginalUrl(item.link);
      return {
        publicId: item.publicId,
        contentType: item.contentType,
        platform: item.platform,
        titleZh: searchExcerpt(item.titleZh ?? item.title, PUBLIC_SEARCH_TEXT_LIMITS.titleZh),
        summaryZh: searchExcerpt(item.summaryZh ?? "", PUBLIC_SEARCH_TEXT_LIMITS.summaryZh),
        titleEn: englishOriginalTitle(item.title) && showOriginal ? searchExcerpt(item.title, PUBLIC_SEARCH_TEXT_LIMITS.titleEn) : null,
        summaryEn: showOriginal && item.summaryEn !== null ? searchExcerpt(item.summaryEn, PUBLIC_SEARCH_TEXT_LIMITS.summaryEn) : null,
        sourceName: searchExcerpt(item.displayName, PUBLIC_SEARCH_TEXT_LIMITS.sourceName),
        // An overlong URL is omitted, never cut into a different destination.
        originalUrl: originalUrl && originalUrl.length <= PUBLIC_SEARCH_TEXT_LIMITS.originalUrl ? originalUrl : null,
        publishedAt: timelineAt(item)
      };
    })
  });
  add(PUBLIC_SEARCH_PATH, 200, searchIndex, false);

  const storyPages = new Map<string, PermanentStoryPage>();
  for (const item of publicItems) {
    storyPages.set(`stories/${item.publicId}/index.html`, permanentStoryPage(item, localMedia, fullTextDenied));
  }

  const sortedResponses = Object.fromEntries(Object.entries(responses).sort(([a], [b]) => a.localeCompare(b)));
  const sitemap = sitemapXml(publicItems);
  const rss = rssXml(items.filter((item) => item.status === "ready"));
  const robots = Buffer.from("User-agent: *\nAllow: /\nSitemap: https://f1plus1.com/sitemap.xml\n");
  const contentFingerprint = sha256(JSON.stringify([
    Object.entries(sortedResponses).map(([key, ref]) => [key, key === PUBLIC_SEARCH_PATH ? sha256(JSON.stringify(searchIndex.items)) : ref.sha256]),
    sha256(sitemap),
    sha256(rss),
    sha256(robots),
    [...storyPages.entries()].map(([path, page]) => [path, sha256(JSON.stringify(page))])
  ]));
  const indexBytes = Buffer.from(JSON.stringify({ schemaVersion: "public-static-index-v1", generatedAt, responses: sortedResponses }));
  const bundleId = sha256(indexBytes);
  const generation = `_public/generations/${bundleId}`;
  const files = new Map<string, Buffer>();
  for (const [hash, bytes] of bodies) files.set(`${generation}/responses/${hash}.json`, bytes);
  files.set(`${generation}/index.json`, indexBytes);
  files.set("_public/current.json", Buffer.from(JSON.stringify({
    schemaVersion: "public-static-pointer-v1",
    bundleId,
    generatedAt,
    indexPath: `${generation}/index.json`,
    indexSha256: bundleId
  })));
  files.set("sitemap.xml", sitemap);
  files.set("rss.xml", rss);
  files.set("robots.txt", robots);
  files.set("archive.json", Buffer.from(JSON.stringify(archiveIndex(archived))));
  return { bundleId, contentFingerprint, files, mediaFiles, itemCount: items.length, storyPages };
}

export type ArchiveMonth = { id: string; label: string; items: { publicId: string; title: string; publishedAt: string }[] };

export function archiveIndex(items: readonly StoredItem[]): { schemaVersion: "archive-index-v1"; months: ArchiveMonth[] } {
  const months = new Map<string, ArchiveMonth>();
  for (const item of items) {
    const at = timelineAt(item);
    const id = at.slice(0, 7);
    const [year, month] = id.split("-");
    const bucket = months.get(id) ?? { id, label: `${year}年${Number(month)}月`, items: [] };
    bucket.items.push({ publicId: item.publicId, title: item.titleZh ?? item.title, publishedAt: at });
    months.set(id, bucket);
  }
  return { schemaVersion: "archive-index-v1", months: [...months.values()] };
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function storyUrl(publicId: string): string {
  if (!isPublicStaticId(publicId)) throw new Error("PUBLIC_ID_INVALID");
  return new URL(`/stories/${publicId}/`, PAGES_URL).toString();
}

const CATEGORY_LABELS: Record<LeanContentType, string> = {
  race_news: "赛事新闻", driver_social: "车手近况", legends_history: "名宿历史", paddock_fun: "围场趣闻"
};

function safeOriginalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function permanentStoryPage(item: StoredItem, media: LocalMedia, denied: ReadonlySet<string>): PermanentStoryPage {
  const title = item.titleZh ?? item.title;
  const summary = item.summaryZh ?? "";
  const description = (summary || title).replace(/\s+/gu, " ").slice(0, 200);
  const canonicalUrl = storyUrl(item.publicId);
  const publishedAt = timelineAt(item);
  const shown = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short", hour12: false }).format(new Date(publishedAt));
  const paragraphs = fullTextAllowed(item.link, denied) ? cleanParagraphs(item.detailZh) ?? [] : [];
  const english = fullTextAllowed(item.link, denied) ? cleanParagraphs(item.detailEn) ?? [] : [];
  const pictures = localImages(item, media).filter(({ local }) => /^media\/[a-zA-Z0-9_-]+\.webp$/u.test(local.sitePath));
  const ogImage = pictures[0] ? new URL(pictures[0].local.sitePath, PAGES_URL).toString() : null;
  const sourceUrl = safeOriginalUrl(item.link);
  const image = ogImage ? `<img class="ph-main" src="${xmlEscape(ogImage)}" alt="${xmlEscape(title)}" loading="eager" decoding="async"/>` : "";
  const body = paragraphs.filter((paragraph) => paragraph !== summary).map((paragraph) => `<p class="tl-zh">${xmlEscape(paragraph)}</p>`).join("");
  const englishBody = english.length > 0 ? `<section lang="en" aria-label="英文原文"><h2 class="tl-zh-label">英文原文</h2>${english.map((paragraph) => `<p class="tl-zh">${xmlEscape(paragraph)}</p>`).join("")}</section>` : "";
  const bodyHtml = `<main class="app timeline-detail-page" id="permanent-story-content"><div class="shell"><section class="timeline" aria-label="F1+1 公开内容详情">
<a class="detail-back-link" href="/">← 返回资讯流</a><p class="timeline-kicker">F1 中英提炼 · 公开详情</p>
<ol class="tl detail-timeline"><li class="tl-item is-open"><article class="tl-entry" aria-labelledby="permanent-story-title">
<header class="timeline-detail-summary"><span class="tl-head"><span class="tl-cat">${CATEGORY_LABELS[item.contentType]}</span></span><h1 class="tl-title" id="permanent-story-title">${xmlEscape(title)}</h1>${summary ? `<p class="tl-lead">${xmlEscape(summary)}</p>` : ""}</header>
${image}<section class="tl-detail timeline-detail-body">${body}${englishBody}</section>
<p class="tl-ev">${xmlEscape(item.displayName)} · <time datetime="${xmlEscape(publishedAt)}">${xmlEscape(shown)}（北京时间）</time></p>
${sourceUrl ? `<p class="timeline-detail-original"><a class="timeline-detail-original-link" href="${xmlEscape(sourceUrl)}" target="_blank" rel="noopener noreferrer">查看${item.platform === "x" ? "原帖" : "原文"} →</a></p>` : ""}
<p class="tl-source-notice">内容来自公开信源，聚合内容版权归原作者与来源所有。</p></article></li></ol></section></div></main>`;
  return { publicId: item.publicId, title, description, canonicalUrl, publishedAt, sourceName: item.displayName, bodyHtml, ogImage };
}

/** The placeholder is an intentionally opaque SSR island, replaced by the existing interactive reader after hydration. */
export function renderPermanentStoryPage(template: string, story: PermanentStoryPage): string {
  const marker = "<!--F1_PUBLIC_STORY_DOCUMENT-->";
  if (!isPublicStaticId(story.publicId) || story.canonicalUrl !== storyUrl(story.publicId)) throw new Error("PUBLIC_STORY_PAGE_INVALID");
  if (!template.includes(marker) || !/<\/head>/i.test(template)) throw new Error("PUBLIC_STORY_TEMPLATE_INVALID");
  const structured = JSON.stringify({
    "@context": "https://schema.org", "@type": "NewsArticle", headline: story.title,
    description: story.description, url: story.canonicalUrl, mainEntityOfPage: story.canonicalUrl,
    datePublished: story.publishedAt, inLanguage: "zh-CN",
    ...(story.ogImage ? { image: [story.ogImage] } : {}),
    publisher: { "@type": "Organization", name: "F1+1" }
  }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const metadata = `<title>${xmlEscape(story.title)} · F1+1</title>
<meta name="description" content="${xmlEscape(story.description)}"/>
<link rel="canonical" href="${xmlEscape(story.canonicalUrl)}"/>
<meta property="og:type" content="article"/><meta property="og:site_name" content="F1+1"/>
<meta property="og:title" content="${xmlEscape(story.title)}"/><meta property="og:description" content="${xmlEscape(story.description)}"/>
<meta property="og:url" content="${xmlEscape(story.canonicalUrl)}"/><meta property="article:published_time" content="${xmlEscape(story.publishedAt)}"/>
${story.ogImage ? `<meta property="og:image" content="${xmlEscape(story.ogImage)}"/>` : ""}
<meta name="twitter:card" content="${story.ogImage ? "summary_large_image" : "summary"}"/>
<script type="application/ld+json">${structured}</script>`;
  // Remove generic shell metadata, retaining its CSS, runtime and React payload unchanged.
  return template.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\b[^>]*(?:name|property)=["'](?:description|og:[^"']+|twitter:[^"']+|article:published_time)["'][^>]*>/gi, "")
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, "")
    .replace(/<\/head>/i, () => `${metadata}</head>`)
    .replace(marker, () => story.bodyHtml);
}

function sitemapXml(items: readonly StoredItem[]): Buffer {
  const urls = [PAGES_URL, ...items.map((item) => storyUrl(item.publicId))];
  const body = urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join("\n");
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
}

function rssDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toUTCString();
}

function rssXml(items: readonly StoredItem[]): Buffer {
  const newest = items[0] ? rssDate(timelineAt(items[0])) : "";
  const entries = items.slice(0, 50).map((item) => `    <item>
      <title>${xmlEscape(item.titleZh ?? item.title)}</title>
      <link>${xmlEscape(storyUrl(item.publicId))}</link>
      <guid>${xmlEscape(storyUrl(item.publicId))}</guid>
      <pubDate>${xmlEscape(rssDate(timelineAt(item)))}</pubDate>
      <description>${xmlEscape(item.summaryZh ?? "")}</description>
    </item>`).join("\n");
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>F1+1</title>
    <link>${xmlEscape(PAGES_URL)}</link>
    <description>F1 中文资讯</description>
    <lastBuildDate>${xmlEscape(newest)}</lastBuildDate>
${entries}
  </channel>
</rss>
`);
}
