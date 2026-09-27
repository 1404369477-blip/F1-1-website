import { z } from "zod";

import { IS_PUBLIC_STATIC_SITE } from "./public-site-config";
import { createPublicStaticFetch, PublicStaticGenerationChangedError } from "./public-static-transport";

import type {
  PublicBilingualFeedResponseV2,
  PublicBilingualStoryCardV2,
  PublicBilingualStoryDetailResponseV2,
  PublicBilingualLanguage,
  PublicContentType,
  PublicFeedItemV1,
  PublicFeedResponseV1,
  PublicProblemV1,
  PublicReasonCodeV1,
  PublicStoryDetailResponseV1
} from "../../server/public/types";

const contentTypeSchema = z.enum(["race_news", "driver_social", "legends_history", "paddock_fun"]);
const publicStateSchema = z.enum(["available", "restricted", "media_missing", "ready"]);
const publicReasonCodeSchema = z.enum([
  "PUBLIC_QUERY_INVALID",
  "PUBLIC_CURSOR_PAIR_REQUIRED",
  "PUBLIC_CURSOR_INVALID",
  "PUBLIC_CURSOR_SCOPE_MISMATCH",
  "PUBLIC_ID_INVALID",
  "PUBLIC_STORY_NOT_FOUND",
  "PUBLIC_READ_INCOMPLETE_CHAIN",
  "PUBLIC_READ_INTEGRITY_FAILED",
  "PUBLIC_DB_BUSY",
  "PUBLIC_PROFILE_UNAVAILABLE",
  "PUBLIC_MEDIA_VERSION_UNSUPPORTED"
]);

const originalLinkSchema = z.discriminatedUnion("enabled", [
  z.object({
    enabled: z.literal(false),
    url: z.null(),
    reason: z.enum(["synthetic_only", "source_restricted"])
  }).strict(),
  z.object({
    enabled: z.literal(true),
    url: z.string().url(),
    reason: z.null()
  }).strict()
]);

const hostedImageSchema = z.object({
  kind: z.enum(["source_image", "video_poster"]),
  assetRef: z.string().url(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif"]),
  declaredBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  altZh: z.string().min(1)
}).strict();
const syntheticMediaSchema = z.object({
  kind: z.literal("synthetic_placeholder"),
  assetRef: z.string().min(1),
  altZh: z.string().min(1),
  captionZh: z.string().nullable(),
  creditDisplay: z.string().nullable(),
  tone: z.enum(["night", "blue", "amber", "violet", "slate"])
}).strict();

const publicFeedItemSchema = z.object({
  publicId: z.string().min(1),
  contentType: contentTypeSchema,
  state: publicStateSchema,
  titleZh: z.string().min(1),
  summaryZh: z.string().min(1),
  publishedAt: z.string().min(1),
  sourcePublishedAt: z.string().nullable(),
  sourceTimeStatus: z.enum(["known", "unknown"]),
  source: z.object({
    sourceId: z.string().min(1),
    platform: z.enum(["x", "instagram", "reddit", "website", "rss"]),
    displayName: z.string().min(1),
    byline: z.string().min(1),
    accessStatus: z.enum(["available", "restricted"])
  }).strict(),
  media: z.preprocess((value) => {
    if (value && typeof value === "object" && !Array.isArray(value) && (value as { kind?: string }).kind === "source_image") return [value];
    return value;
  }, z.union([syntheticMediaSchema, z.array(hostedImageSchema).max(4), z.null()])),
  originalLink: originalLinkSchema,
  originalTitle: z.string().min(1).optional(),
  summaryEn: z.string().min(1).nullable().optional(),
  detailZh: z.array(z.string().min(1)).max(80).optional(),
  detailEn: z.array(z.string().min(1)).max(80).optional(),
  keyPointsZh: z.array(z.string().min(1)).max(3).optional(),
  keyPointsEn: z.array(z.string().min(1)).max(3).optional(),
  relatedSources: z.array(z.object({
    publicId: z.string().min(1),
    sourceId: z.string().min(1),
    displayName: z.string().min(1),
    originalUrl: z.string().url().nullable()
  }).strict()).min(1).optional()
}).strict();

const publicFeedResponseSchema = z.object({
  schemaVersion: z.literal("public-read-v0.1"),
  items: z.array(publicFeedItemSchema),
  page: z.object({
    pageSize: z.literal(12),
    hasMore: z.boolean(),
    nextCursor: z.object({ cursorAt: z.string().min(1), cursorId: z.string().min(1) }).strict().nullable()
  }).strict()
}).strict();

const publicStoryDetailResponseSchema = z.object({
  schemaVersion: z.literal("public-read-v0.1"),
  story: publicFeedItemSchema.extend({
    leadZh: z.string().min(1),
    bodyZh: z.array(z.string().min(1)).min(1),
    keyPointsZh: z.array(z.string().min(1))
  }).strict(),
  relatedItems: z.array(publicFeedItemSchema).max(3)
}).strict();

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const localizedV2Schema = z.object({
  title: z.string().min(1).max(200), summary: z.string().min(1).max(600), lead: z.string().min(1).max(600),
  body: z.string().min(1).max(12_000), keyPoints: z.array(z.string().min(1).max(240)).min(1).max(8), contentHash: hashSchema
}).strict();
const bilingualCardSchema = z.object({
  publicId: z.string().min(1).max(256), category: z.string().min(1).max(80), defaultLanguage: z.literal("zh-CN"),
  availableLanguages: z.tuple([z.literal("zh-CN"), z.literal("en")]), localized: z.object({ "zh-CN": localizedV2Schema, en: localizedV2Schema }).strict(),
  source: z.object({ name: z.string().min(1).max(200), author: z.string().min(1).max(200).nullable(), publishedAt: z.string().nullable(), canonicalUrl: z.string().url() }).strict(),
  publishedAt: z.string().min(1), updatedAt: z.string().min(1),
  media: z.array(z.object({ kind: z.literal("image"), url: z.string().url(), alt: z.string().min(1).max(300), width: z.number().int().positive(), height: z.number().int().positive(), rightsPolicyId: z.string().min(1), mediaHash: hashSchema }).strict()).max(4)
}).strict();
const bilingualFeedResponseSchema = z.object({
  schemaVersion: z.literal("public-read-bilingual-v2"), items: z.array(bilingualCardSchema).max(50),
  page: z.object({ limit: z.number().int().min(1).max(50), nextCursor: z.string().min(1).max(2048).nullable(), asOf: z.string().min(1) }).strict(),
  generationId: z.string().min(1).max(256), generationHash: hashSchema
}).strict();
const bilingualDetailResponseSchema = z.object({
  schemaVersion: z.literal("public-read-bilingual-v2"), story: bilingualCardSchema, relatedItems: z.array(bilingualCardSchema).max(12),
  generationId: z.string().min(1).max(256), generationHash: hashSchema
}).strict();
const publicFeedAnySchema = z.union([bilingualFeedResponseSchema, publicFeedResponseSchema]);
const publicDetailAnySchema = z.union([bilingualDetailResponseSchema, publicStoryDetailResponseSchema]);

const publicProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.string(),
  reasonCode: publicReasonCodeSchema,
  traceId: z.string()
}).strict();

export const STORY_CATEGORY_OPTIONS = [
  { label: "赛事新闻", contentType: "race_news" },
  { label: "车手近况", contentType: "driver_social" },
  { label: "名宿历史", contentType: "legends_history" },
  { label: "围场趣闻", contentType: "paddock_fun" }
] as const satisfies ReadonlyArray<{ label: string; contentType: PublicContentType }>;

export type StoryCategory = (typeof STORY_CATEGORY_OPTIONS)[number]["label"];
export type StoryState = "available" | "restricted" | "media-missing";
export type StoryMediaTone = "night" | "blue" | "amber" | "violet" | "slate";

/** 前端展示用图片(全部为本地 data-URI 合成占位,M4 media display-only,零外联)。 */
export type PublicStoryImage = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  kind?: "source_image" | "video_poster";
};

export type PublicStoryCardViewModel = {
  publicId: string;
  category: StoryCategory;
  state: StoryState;
  mediaTone: StoryMediaTone;
  mediaDescription: string;
  mediaLabel: string;
  images: PublicStoryImage[];
  title: string;
  summary: string;
  sourceName: string;
  author: string;
  publishedAt: string;
  publishedAtIso: string;
  platform: PublicFeedItemV1["source"]["platform"];
  originalReason: PublicFeedItemV1["originalLink"]["reason"];
  originalUrl: PublicFeedItemV1["originalLink"]["url"];
  relatedSources: Array<{
    publicId: string;
    displayName: string;
    originalUrl: string | null;
  }>;
  defaultLanguage: PublicBilingualLanguage;
  availableLanguages: PublicBilingualLanguage[];
  localized: Record<PublicBilingualLanguage, null | { title: string; summary: string; lead: string; body: string[]; keyPoints: string[] }>;
  sourceNotice: string;
};

export type PublicStoryDetailViewModel = PublicStoryCardViewModel & {
  lead: string;
  body: string[];
  keyPoints: string[];
};

export type PublicFeedViewModel = {
  stories: PublicStoryCardViewModel[];
  page: PublicFeedResponseV1["page"];
  staticBundleId?: string;
};

export type PublicStoryDetailPageViewModel = {
  story: PublicStoryDetailViewModel;
  relatedStories: PublicStoryCardViewModel[];
};

export type PublicApiFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class PublicApiClientError extends Error {
  readonly status: number;
  readonly reasonCode: PublicReasonCodeV1 | null;

  constructor(status: number, reasonCode: PublicReasonCodeV1 | null) {
    super("PUBLIC_API_REQUEST_FAILED");
    this.name = "PublicApiClientError";
    this.status = status;
    this.reasonCode = reasonCode;
  }
}

const categoryByContentType: Record<PublicContentType, StoryCategory> = {
  race_news: "赛事新闻",
  driver_social: "车手近况",
  legends_history: "名宿历史",
  paddock_fun: "围场趣闻"
};

const timestampFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Shanghai"
});

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "时间未知" : timestampFormatter.format(timestamp);
}

export function contentTypeForCategory(category: StoryCategory | "全部"): PublicContentType | null {
  return STORY_CATEGORY_OPTIONS.find((option) => option.label === category)?.contentType ?? null;
}

export function buildPublicFeedPath({
  contentType,
  cursor
}: {
  contentType: PublicContentType | null;
  cursor?: PublicFeedResponseV1["page"]["nextCursor"];
}): string {
  const search = new URLSearchParams();
  search.set("v", "2");
  search.set("limit", "12");
  if (contentType) search.set("category", contentType);
  if (cursor) {
    if (cursor.cursorId.startsWith("bilingual:")) search.set("cursor", cursor.cursorId.slice("bilingual:".length));
    else {
      search.delete("v"); search.delete("limit"); search.delete("category");
      if (contentType) search.set("contentType", contentType);
      search.set("cursorAt", cursor.cursorAt); search.set("cursorId", cursor.cursorId);
    }
  }
  const query = search.toString();
  return `/api/public/feed${query ? `?${query}` : ""}`;
}

function isSyntheticVersionUnavailable(error: unknown): boolean {
  return error instanceof PublicApiClientError
    && error.status === 406
    && error.reasonCode === "PUBLIC_MEDIA_VERSION_UNSUPPORTED";
}

/**
 * The signed bilingual V2 snapshot is an independent fail-closed artifact.
 * When it is absent or corrupt, the already-published Chinese V1 payload can
 * still be rendered; every unrelated V2 error remains explicit.
 */
function isBilingualIntegrityUnavailable(error: unknown): boolean {
  return error instanceof PublicApiClientError
    && error.status === 503
    && error.reasonCode === "PUBLIC_READ_INTEGRITY_FAILED";
}

/**
 * Synthetic mode has no signed bilingual generation. The server reports that
 * condition with the closed problem DTO; this one-time negotiation switches to
 * the legacy V1 route. Every other API error stays on its explicit caller path.
 */
function buildSyntheticFallbackFeedPath({
  contentType,
  cursor
}: {
  contentType?: PublicContentType | null;
  cursor?: PublicFeedResponseV1["page"]["nextCursor"];
} = {}): string {
  const search = new URLSearchParams();
  if (contentType) search.set("contentType", contentType);
  if (cursor) {
    search.set("cursorAt", cursor.cursorAt);
    search.set("cursorId", cursor.cursorId);
  }
  const query = search.toString();
  return `/api/public/feed${query ? `?${query}` : ""}`;
}

function formatSourceName(item: PublicFeedItemV1): string {
  const names = [item.source.displayName, ...(item.relatedSources ?? []).map((source) => source.displayName)];
  return [...new Set(names)].join(" · ");
}

function hostedPictures(media: unknown): PublicStoryImage[] {
  const list = Array.isArray(media)
    ? media
    : (media && typeof media === "object" && (media as { kind?: string }).kind === "source_image" ? [media] : []);
  return list.flatMap((picture) => {
    if (!picture || typeof picture !== "object" || !("assetRef" in picture)) return [];
    const image = picture as { assetRef?: string; altZh?: string; width?: number; height?: number; kind?: "source_image" | "video_poster" };
    if (!image.assetRef || !image.altZh) return [];
    return [{
      src: image.assetRef,
      alt: image.altZh,
      ...(image.width ? { width: image.width } : {}),
      ...(image.height ? { height: image.height } : {}),
      ...(image.kind ? { kind: image.kind } : {})
    }];
  });
}

function mapFeedItem(item: PublicFeedItemV1): PublicStoryCardViewModel {
  const sourceTimestamp = item.sourceTimeStatus === "known" && item.sourcePublishedAt
    ? item.sourcePublishedAt
    : item.publishedAt;
  const placeholder = item.media && !Array.isArray(item.media) && item.media.kind === "synthetic_placeholder" ? item.media : null;
  const pictures = hostedPictures(item.media);
  const mediaTone = placeholder?.tone ?? "slate";
  const mediaDescription = pictures[0]?.alt ?? placeholder?.altZh ?? "当前公开内容没有可展示的媒体。";
  const mediaLabel = placeholder ? placeholder.captionZh ?? "公开合成示意" : "来源配图";
  return {
    publicId: item.publicId,
    category: categoryByContentType[item.contentType],
    state: item.state === "media_missing" ? "media-missing" : item.state === "ready" ? "available" : item.state,
    mediaTone,
    mediaDescription,
    mediaLabel,
    images: pictures,
    title: item.titleZh,
    summary: item.summaryZh,
    sourceName: formatSourceName(item),
    author: item.source.byline,
    publishedAt: `${formatTimestamp(sourceTimestamp)}${item.sourceTimeStatus === "unknown" ? "（公开时间）" : ""}`,
    publishedAtIso: sourceTimestamp,
    platform: item.source.platform,
    originalReason: item.originalLink.reason,
    originalUrl: item.originalLink.url,
    relatedSources: (item.relatedSources ?? []).map((source) => ({
      publicId: source.publicId,
      displayName: source.displayName,
      originalUrl: source.originalUrl
    })),
    defaultLanguage: "zh-CN",
    availableLanguages: item.summaryEn || item.detailEn?.length ? ["zh-CN", "en"] : ["zh-CN"],
    localized: {
      "zh-CN": { title: item.titleZh, summary: item.summaryZh, lead: item.summaryZh, body: item.detailZh ?? [], keyPoints: item.keyPointsZh ?? [] },
      en: item.summaryEn || item.detailEn?.length
        ? {
            title: item.source.platform === "x" ? (item.detailEn?.[0] || item.originalTitle || item.titleZh) : (item.originalTitle || item.titleZh),
            summary: item.source.platform === "x" ? "" : (item.summaryEn || ""),
            lead: item.source.platform === "x" ? "" : (item.summaryEn || ""),
            body: item.detailEn ?? [],
            keyPoints: item.keyPointsEn ?? []
          }
        : null
    },
    sourceNotice: item.originalLink.enabled ? "本站仅展示原创提炼；完整原文请前往来源网站。" : "来源链接当前不可公开；本站保留已验证的中文提炼。"
  };
}

function mapBilingualItem(item: PublicBilingualStoryCardV2): PublicStoryCardViewModel {
  const category = categoryByContentType[item.category as PublicContentType] ?? "赛事新闻";
  const images = item.media.map((media) => ({ src: media.url, alt: media.alt }));
  return {
    publicId: item.publicId, category, state: images.length > 0 ? "available" : "media-missing", mediaTone: "slate",
    mediaDescription: images[0]?.alt ?? "当前公开内容没有已获许可的媒体。", mediaLabel: images.length > 0 ? "来源配图" : "零媒体发布",
    images, title: item.localized["zh-CN"].title, summary: item.localized["zh-CN"].summary,
    sourceName: item.source.name, author: item.source.author ?? "", publishedAt: formatTimestamp(item.source.publishedAt ?? item.publishedAt),
    publishedAtIso: item.source.publishedAt ?? item.publishedAt, platform: "rss", originalReason: null, originalUrl: item.source.canonicalUrl,
    relatedSources: [], defaultLanguage: "zh-CN", availableLanguages: [...item.availableLanguages],
    localized: {
      "zh-CN": { title: item.localized["zh-CN"].title, summary: item.localized["zh-CN"].summary, lead: item.localized["zh-CN"].lead, body: item.localized["zh-CN"].body.split("\n").filter(Boolean), keyPoints: item.localized["zh-CN"].keyPoints },
      en: { title: item.localized.en.title, summary: item.localized.en.summary, lead: item.localized.en.lead, body: item.localized.en.body.split("\n").filter(Boolean), keyPoints: item.localized.en.keyPoints }
    },
    sourceNotice: "本站展示经审核的中文与英文原创提炼；英文内容为独立提炼，不代表原文或官方翻译，完整原文请前往来源网站。"
  };
}

async function requestClosedJson<T>({
  path,
  schema,
  fetchImpl,
  signal
}: {
  path: string;
  schema: z.ZodType<T>;
  fetchImpl: PublicApiFetch;
  signal?: AbortSignal;
}): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof PublicStaticGenerationChangedError) throw error;
    throw new PublicApiClientError(0, null);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PublicApiClientError(response.status, null);
  }

  if (!response.ok) {
    const problem = publicProblemSchema.safeParse(payload);
    throw new PublicApiClientError(response.status, problem.success ? problem.data.reasonCode : null);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new PublicApiClientError(502, null);
  return parsed.data;
}

export async function fetchPublicFeed({
  contentType = null,
  cursor = null,
  signal,
  fetchImpl,
  staticBundleId
}: {
  contentType?: PublicContentType | null;
  cursor?: PublicFeedResponseV1["page"]["nextCursor"];
  signal?: AbortSignal;
  fetchImpl?: PublicApiFetch;
  staticBundleId?: string;
} = {}): Promise<PublicFeedViewModel> {
  const staticRequest = !fetchImpl && IS_PUBLIC_STATIC_SITE ? createPublicStaticFetch({ expectedBundleId: staticBundleId }) : null;
  const requestFetch = fetchImpl ?? staticRequest?.fetch ?? globalThis.fetch;
  if (IS_PUBLIC_STATIC_SITE) {
    const response = await requestClosedJson<PublicFeedResponseV1>({
      path: buildSyntheticFallbackFeedPath({ contentType, cursor }),
      schema: publicFeedResponseSchema as z.ZodType<PublicFeedResponseV1>,
      fetchImpl: requestFetch,
      signal
    });
    const bundle = staticRequest?.getBundleId();
    return { stories: response.items.map(mapFeedItem), page: response.page, ...(bundle ? { staticBundleId: bundle } : {}) };
  }
  let response: PublicFeedResponseV1 | PublicBilingualFeedResponseV2;
  try {
    response = await requestClosedJson<PublicFeedResponseV1 | PublicBilingualFeedResponseV2>({
      path: buildPublicFeedPath({ contentType, cursor }),
      schema: publicFeedAnySchema as z.ZodType<PublicFeedResponseV1 | PublicBilingualFeedResponseV2>,
      fetchImpl: requestFetch,
      signal
    });
  } catch (error) {
    if (!isSyntheticVersionUnavailable(error) && !isBilingualIntegrityUnavailable(error)) throw error;
    response = await requestClosedJson<PublicFeedResponseV1>({
      path: buildSyntheticFallbackFeedPath({ contentType, cursor }),
      schema: publicFeedResponseSchema as z.ZodType<PublicFeedResponseV1>,
      fetchImpl: requestFetch,
      signal
    });
  }
  const bundle = staticRequest?.getBundleId();
  const staticIdentity = bundle ? { staticBundleId: bundle } : {};
  if (response.schemaVersion === "public-read-bilingual-v2") {
    return { stories: response.items.map(mapBilingualItem), page: { pageSize: 12, hasMore: response.page.nextCursor !== null, nextCursor: response.page.nextCursor ? { cursorAt: response.page.asOf, cursorId: `bilingual:${response.page.nextCursor}` } : null }, ...staticIdentity };
  }
  return { stories: response.items.map(mapFeedItem), page: response.page, ...staticIdentity };
}

export async function fetchPublicStory({
  publicId,
  signal,
  fetchImpl,
  staticBundleId
}: {
  publicId: string;
  signal?: AbortSignal;
  fetchImpl?: PublicApiFetch;
  staticBundleId?: string;
}): Promise<PublicStoryDetailPageViewModel> {
  const staticRequest = !fetchImpl && IS_PUBLIC_STATIC_SITE ? createPublicStaticFetch({ expectedBundleId: staticBundleId }) : null;
  const requestFetch = fetchImpl ?? staticRequest?.fetch ?? globalThis.fetch;
  let response: PublicStoryDetailResponseV1 | PublicBilingualStoryDetailResponseV2;
  if (IS_PUBLIC_STATIC_SITE) {
    response = await requestClosedJson<PublicStoryDetailResponseV1>({
      path: `/api/public/stories/${encodeURIComponent(publicId)}`,
      schema: publicStoryDetailResponseSchema as z.ZodType<PublicStoryDetailResponseV1>,
      fetchImpl: requestFetch,
      signal
    });
  } else {
  try {
    response = await requestClosedJson<PublicStoryDetailResponseV1 | PublicBilingualStoryDetailResponseV2>({
      path: `/api/public/stories/${encodeURIComponent(publicId)}?v=2`,
      schema: publicDetailAnySchema as z.ZodType<PublicStoryDetailResponseV1 | PublicBilingualStoryDetailResponseV2>,
      fetchImpl: requestFetch,
      signal
    });
  } catch (error) {
    if (!isSyntheticVersionUnavailable(error) && !isBilingualIntegrityUnavailable(error)) throw error;
    response = await requestClosedJson<PublicStoryDetailResponseV1>({
      path: `/api/public/stories/${encodeURIComponent(publicId)}`,
      schema: publicStoryDetailResponseSchema as z.ZodType<PublicStoryDetailResponseV1>,
      fetchImpl: requestFetch,
      signal
    });
  }
  }
  if (response.schemaVersion === "public-read-bilingual-v2") {
    const story = mapBilingualItem(response.story);
    const zh = story.localized["zh-CN"]!;
    return { story: { ...story, lead: zh.lead, body: zh.body, keyPoints: zh.keyPoints }, relatedStories: response.relatedItems.map(mapBilingualItem) };
  }
  const base = mapFeedItem(response.story);
  return {
    story: {
      ...base,
      lead: response.story.leadZh,
      body: response.story.bodyZh,
      keyPoints: response.story.keyPointsZh,
      localized: {
        "zh-CN": {
          title: response.story.titleZh,
          summary: response.story.summaryZh,
          lead: response.story.leadZh,
          body: response.story.bodyZh,
          keyPoints: response.story.keyPointsZh
        },
        en: base.localized.en
          ? { ...base.localized.en, body: [], keyPoints: base.localized.en.keyPoints }
          : null
      }
    },
    relatedStories: response.relatedItems.map(mapFeedItem)
  };
}

export function isPublicStoryNotFound(error: unknown): boolean {
  return error instanceof PublicApiClientError
    && error.status === 404
    && error.reasonCode === "PUBLIC_STORY_NOT_FOUND";
}

export type { PublicContentType, PublicProblemV1 };
