import { createHash } from "node:crypto";

import { normalizePublicStaticRequestKey } from "../../features/stories/public-static-schema.ts";
import { LEAN_CONTENT_TYPES, PAGES_URL, type LeanContentType } from "./config.ts";
import { isBoilerplateParagraph } from "./article.ts";
import { isAgencyImage } from "./feed.ts";
import type { LocalImage, LocalMedia } from "./media.ts";
import type { StoredItem } from "./store.ts";

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
}>;

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

function timelineAt(item: StoredItem): string {
  return item.sourcePublishedAt ?? item.publishedAt ?? item.firstSeenAt;
}

/** Only site-hosted copies are referenced; a picture without one is left out rather than hot-linked. */
function localImage(item: StoredItem, localMedia: LocalMedia): LocalImage | undefined {
  return item.image === null || isAgencyImage(item.image.url) ? undefined : localMedia.get(item.image.url);
}

/** `media_missing` makes the UI omit the picture area; `ready` without media would draw a synthetic placeholder. */
function feedItemWith(item: StoredItem, localMedia: LocalMedia, fullTextDenied: ReadonlySet<string>): Record<string, unknown> {
  const local = localImage(item, localMedia);
  const media = local === undefined ? null : {
    kind: "source_image",
    assetRef: new URL(local.sitePath, PAGES_URL).toString(),
    mimeType: "image/webp",
    declaredBytes: local.bytes,
    altZh: item.titleZh
  };
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
    originalTitle: item.title,
    summaryEn: item.summaryEn,
    detailZh: showFull ? cleanParagraphs(item.detailZh) : undefined,
    detailEn: showFull ? cleanParagraphs(item.detailEn) : undefined,
    keyPointsZh: item.keyPointsZh.length > 0 ? item.keyPointsZh : undefined,
    keyPointsEn: item.keyPointsEn.length > 0 ? item.keyPointsEn : undefined
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

/** Builds the static `/api/public/*` responses the published UI reads. `items` must be ready items. */
export function buildSiteBundle(readyItems: readonly StoredItem[], generatedAt: string, localMedia: LocalMedia = new Map(), fullTextDenied: ReadonlySet<string> = new Set()): SiteBundle {
  const items = [...readyItems].sort((a, b) => timelineAt(b).localeCompare(timelineAt(a)) || b.publicId.localeCompare(a.publicId));
  const feedItem = (item: StoredItem) => feedItemWith(item, localMedia, fullTextDenied);
  const mediaFiles = new Map<string, string>();
  for (const item of items) {
    const local = localImage(item, localMedia);
    if (local !== undefined) mediaFiles.set(local.sitePath, local.file);
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

  for (const item of items) {
    const summary = item.summaryZh ?? "";
    add(`/api/public/stories/${item.publicId}?v=1`, 200, {
      schemaVersion: "public-read-v0.1",
      story: { ...feedItem(item), leadZh: summary, bodyZh: [summary], keyPointsZh: item.keyPointsZh },
      relatedItems: relatedFor(item, items).map(feedItem)
    }, true);
  }

  const sortedResponses = Object.fromEntries(Object.entries(responses).sort(([a], [b]) => a.localeCompare(b)));
  const sitemap = sitemapXml(items);
  const rss = rssXml(items);
  const robots = Buffer.from("User-agent: *\nAllow: /\nSitemap: https://f1plus1.com/sitemap.xml\n");
  const contentFingerprint = sha256(JSON.stringify([
    Object.entries(sortedResponses).map(([key, ref]) => [key, ref.sha256]),
    sha256(sitemap),
    sha256(rss),
    sha256(robots)
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
  return { bundleId, contentFingerprint, files, mediaFiles, itemCount: items.length };
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function storyUrl(publicId: string): string {
  return new URL(`/stories/?${new URLSearchParams({ publicId }).toString()}`, PAGES_URL).toString();
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
