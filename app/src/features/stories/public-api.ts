import { z } from "zod";

import type {
  PublicContentType,
  PublicFeedItemV1,
  PublicFeedResponseV1,
  PublicProblemV1,
  PublicReasonCodeV1,
  PublicStoryDetailResponseV1
} from "../../server/public/types";

const contentTypeSchema = z.enum(["race_news", "driver_social", "legends_history", "paddock_fun"]);
const publicStateSchema = z.enum(["available", "restricted", "media_missing"]);
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
  media: z.object({
    kind: z.literal("synthetic_placeholder"),
    assetRef: z.string().min(1),
    altZh: z.string().min(1),
    captionZh: z.string().nullable(),
    creditDisplay: z.string().nullable(),
    tone: z.enum(["night", "blue", "amber", "violet", "slate"])
  }).strict().nullable(),
  originalLink: originalLinkSchema
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
  { label: "车手社交", contentType: "driver_social" },
  { label: "名宿历史", contentType: "legends_history" },
  { label: "赛场趣事", contentType: "paddock_fun" }
] as const satisfies ReadonlyArray<{ label: string; contentType: PublicContentType }>;

export type StoryCategory = (typeof STORY_CATEGORY_OPTIONS)[number]["label"];
export type StoryState = "available" | "restricted" | "media-missing";
export type StoryMediaTone = "night" | "blue" | "amber" | "violet" | "slate";

/** 前端展示用图片(全部为本地 data-URI 合成占位,M4 media display-only,零外联)。 */
export type PublicStoryImage = { src: string; alt: string };

const TONE_GRADIENTS: Record<StoryMediaTone, readonly [string, string]> = {
  night: ["#101a33", "#2f6fe4"],
  blue: ["#0f2737", "#78bde1"],
  amber: ["#3b2a16", "#f5c451"],
  violet: ["#291739", "#d8bbff"],
  slate: ["#20262b", "#b8c0cc"]
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function storyPlaceholderImages(tone: StoryMediaTone, label: string, altZh: string): PublicStoryImage[] {
  const [from, to] = TONE_GRADIENTS[tone] ?? TONE_GRADIENTS.slate;
  const safeLabel = escapeXml(label || "公开合成示意");
  const width = 1600;
  const height = 900;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/>` +
    `<rect x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.08)}" width="${Math.round(width * 0.88)}" height="${Math.round(height * 0.16)}" rx="${Math.round(height * 0.03)}" fill="rgba(0,0,0,0.28)"/>` +
    `<text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.2)}" fill="rgba(255,255,255,0.92)" font-family="sans-serif" font-size="${Math.round(height * 0.09)}" font-weight="600">${safeLabel}</text>` +
    `<text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.9)}" fill="rgba(255,255,255,0.55)" font-family="sans-serif" font-size="${Math.round(height * 0.05)}">synthetic · display only</text>` +
    `</svg>`;
  return [{ src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt: altZh }];
}

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
};

export type PublicStoryDetailViewModel = PublicStoryCardViewModel & {
  lead: string;
  body: string[];
  keyPoints: string[];
};

export type PublicFeedViewModel = {
  stories: PublicStoryCardViewModel[];
  page: PublicFeedResponseV1["page"];
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
  driver_social: "车手社交",
  legends_history: "名宿历史",
  paddock_fun: "赛场趣事"
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
  if (contentType) search.set("contentType", contentType);
  if (cursor) {
    search.set("cursorAt", cursor.cursorAt);
    search.set("cursorId", cursor.cursorId);
  }
  const query = search.toString();
  return `/api/public/feed${query ? `?${query}` : ""}`;
}

function mapFeedItem(item: PublicFeedItemV1): PublicStoryCardViewModel {
  const sourceTimestamp = item.sourceTimeStatus === "known" && item.sourcePublishedAt
    ? item.sourcePublishedAt
    : item.publishedAt;
  const mediaTone = item.media?.tone ?? "slate";
  const mediaDescription = item.media?.altZh ?? "当前公开内容没有可展示的媒体。";
  const mediaLabel = item.media?.captionZh ?? "公开合成示意";
  return {
    publicId: item.publicId,
    category: categoryByContentType[item.contentType],
    state: item.state === "media_missing" ? "media-missing" : item.state,
    mediaTone,
    mediaDescription,
    mediaLabel,
    images: item.state === "media_missing" ? [] : storyPlaceholderImages(mediaTone, mediaLabel, mediaDescription),
    title: item.titleZh,
    summary: item.summaryZh,
    sourceName: item.source.displayName,
    author: item.source.byline,
    publishedAt: `${formatTimestamp(sourceTimestamp)}${item.sourceTimeStatus === "unknown" ? "（公开时间）" : ""}`,
    publishedAtIso: sourceTimestamp,
    platform: item.source.platform,
    originalReason: item.originalLink.reason,
    originalUrl: item.originalLink.url
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
  fetchImpl = globalThis.fetch
}: {
  contentType?: PublicContentType | null;
  cursor?: PublicFeedResponseV1["page"]["nextCursor"];
  signal?: AbortSignal;
  fetchImpl?: PublicApiFetch;
} = {}): Promise<PublicFeedViewModel> {
  const response = await requestClosedJson<PublicFeedResponseV1>({
    path: buildPublicFeedPath({ contentType, cursor }),
    schema: publicFeedResponseSchema,
    fetchImpl,
    signal
  });
  return { stories: response.items.map(mapFeedItem), page: response.page };
}

export async function fetchPublicStory({
  publicId,
  signal,
  fetchImpl = globalThis.fetch
}: {
  publicId: string;
  signal?: AbortSignal;
  fetchImpl?: PublicApiFetch;
}): Promise<PublicStoryDetailPageViewModel> {
  const response = await requestClosedJson<PublicStoryDetailResponseV1>({
    path: `/api/public/stories/${encodeURIComponent(publicId)}`,
    schema: publicStoryDetailResponseSchema,
    fetchImpl,
    signal
  });
  return {
    story: {
      ...mapFeedItem(response.story),
      lead: response.story.leadZh,
      body: response.story.bodyZh,
      keyPoints: response.story.keyPointsZh
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
