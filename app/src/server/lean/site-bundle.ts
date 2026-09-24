import { createHash } from "node:crypto";

import { normalizePublicStaticRequestKey } from "../../features/stories/public-static-schema.ts";
import type { LeanContentType } from "./config.ts";
import type { StoredItem } from "./store.ts";

const PAGE_SIZE = 12;
const CONTENT_TYPES: readonly LeanContentType[] = ["race_news", "driver_social", "legends_history", "paddock_fun"];
const JSON_TYPE = "application/json; charset=utf-8";
const PROBLEM_TYPE = "application/problem+json; charset=utf-8";

type ResponseRef = { status: 200 | 503; contentType: string; path: string; sha256: string };

export type SiteBundle = Readonly<{
  bundleId: string;
  /** Hash of all response bodies; unchanged content yields the same fingerprint. */
  contentFingerprint: string;
  /** Site-relative path → file bytes, including `_public/current.json`. */
  files: ReadonlyMap<string, Buffer>;
  itemCount: number;
}>;

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

function timelineAt(item: StoredItem): string {
  return item.sourcePublishedAt ?? item.publishedAt ?? item.firstSeenAt;
}

function feedItem(item: StoredItem): Record<string, unknown> {
  return {
    publicId: item.publicId,
    contentType: item.contentType,
    state: "ready",
    titleZh: item.titleZh,
    summaryZh: item.summaryZh,
    publishedAt: item.publishedAt,
    sourcePublishedAt: item.sourcePublishedAt,
    sourceTimeStatus: item.sourcePublishedAt === null ? "unknown" : "known",
    source: { sourceId: item.sourceId, platform: item.platform, displayName: item.displayName, byline: item.displayName, accessStatus: "available" },
    media: item.image === null ? null : {
      kind: "source_image",
      assetRef: item.image.url,
      mimeType: item.image.mimeType,
      declaredBytes: item.image.declaredBytes,
      altZh: item.titleZh
    },
    originalLink: { enabled: true, url: item.link, reason: null }
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

function problem(instance: string, key: string): Record<string, unknown> {
  return {
    type: "urn:f1plus1:problem:PUBLIC_READ_INTEGRITY_FAILED",
    title: "Public read unavailable",
    status: 503,
    detail: "The signed public snapshot integrity check failed.",
    instance,
    reasonCode: "PUBLIC_READ_INTEGRITY_FAILED",
    traceId: `trace-${sha256(key).slice(0, 32)}`
  };
}

function relatedFor(item: StoredItem, items: readonly StoredItem[]): StoredItem[] {
  const others = items.filter((other) => other.publicId !== item.publicId);
  const sameSource = others.filter((other) => other.sourceId === item.sourceId);
  return [...sameSource, ...others.filter((other) => other.sourceId !== item.sourceId)].slice(0, 3);
}

/** Builds the static `/api/public/*` responses the published UI reads. `items` must be ready items. */
export function buildSiteBundle(readyItems: readonly StoredItem[], generatedAt: string): SiteBundle {
  const items = [...readyItems].sort((a, b) => timelineAt(b).localeCompare(timelineAt(a)) || b.publicId.localeCompare(a.publicId));
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

  const sources = [...new Set(items.map((item) => item.sourceId))].sort();
  for (const contentType of [null, ...CONTENT_TYPES]) {
    for (const source of [null, ...sources]) {
      const scoped = items.filter((item) => (contentType === null || item.contentType === contentType) && (source === null || item.sourceId === source));
      let cursor: { cursorAt: string; cursorId: string } | null = null;
      let offset = 0;
      do {
        const page = scoped.slice(offset, offset + PAGE_SIZE);
        const hasMore = offset + PAGE_SIZE < scoped.length;
        const last = page.at(-1);
        const nextCursor = hasMore && last ? { cursorAt: timelineAt(last), cursorId: cursorId(last, contentType, source) } : null;
        add(feedPath({ v: "1", contentType, source, ...(cursor ?? {}) }), 200, {
          schemaVersion: "public-read-v0.1",
          items: page.map(feedItem),
          page: { pageSize: PAGE_SIZE, hasMore, nextCursor }
        }, true);
        cursor = nextCursor;
        offset += PAGE_SIZE;
      } while (cursor !== null);
    }
  }

  for (const item of items) {
    const summary = item.summaryZh ?? "";
    add(`/api/public/stories/${item.publicId}?v=1`, 200, {
      schemaVersion: "public-read-v0.1",
      story: { ...feedItem(item), leadZh: summary, bodyZh: [summary], keyPointsZh: item.keyPointsZh },
      relatedItems: relatedFor(item, items).map(feedItem)
    }, true);
    const v2Detail = `/api/public/stories/${item.publicId}?v=2`;
    add(v2Detail, 503, problem("/api/public/stories", v2Detail), false);
  }
  for (const category of [null, ...CONTENT_TYPES]) {
    const v2Feed = feedPath({ v: "2", limit: "12", category });
    add(v2Feed, 503, problem("/api/public/feed", v2Feed), false);
  }

  const sortedResponses = Object.fromEntries(Object.entries(responses).sort(([a], [b]) => a.localeCompare(b)));
  const contentFingerprint = sha256(JSON.stringify(Object.entries(sortedResponses).map(([key, ref]) => [key, ref.sha256])));
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
  return { bundleId, contentFingerprint, files, itemCount: items.length };
}
