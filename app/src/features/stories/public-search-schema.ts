import { z } from "zod";

import { isPublicStaticId } from "./public-static-schema.ts";

export const PUBLIC_SEARCH_PATH = "/api/public/search?v=1";
export const PUBLIC_SEARCH_PAGE_SIZE = 12;
export const PUBLIC_SEARCH_MAX_QUERY_LENGTH = 200;
export const PUBLIC_SEARCH_TEXT_LIMITS = {
  titleZh: 600, summaryZh: 2000, titleEn: 2000, summaryEn: 20_000, sourceName: 200, originalUrl: 4096
} as const;

const timestamp = z.string().datetime({ offset: false }).refine((value) => new Date(value).toISOString() === value);
const publicSourceUrl = z.string().max(PUBLIC_SEARCH_TEXT_LIMITS.originalUrl).url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
});
export const PublicSearchItemSchema = z.object({
  publicId: z.string().refine(isPublicStaticId),
  contentType: z.enum(["race_news", "driver_social", "legends_history", "paddock_fun"]),
  platform: z.enum(["rss", "x"]),
  titleZh: z.string().min(1).max(PUBLIC_SEARCH_TEXT_LIMITS.titleZh),
  summaryZh: z.string().max(PUBLIC_SEARCH_TEXT_LIMITS.summaryZh),
  titleEn: z.string().max(PUBLIC_SEARCH_TEXT_LIMITS.titleEn).nullable(),
  summaryEn: z.string().max(PUBLIC_SEARCH_TEXT_LIMITS.summaryEn).nullable(),
  sourceName: z.string().min(1).max(PUBLIC_SEARCH_TEXT_LIMITS.sourceName),
  originalUrl: publicSourceUrl.nullable(),
  publishedAt: timestamp
}).strict();

export const PublicSearchIndexSchema = z.object({
  schemaVersion: z.literal("public-search-v1"),
  generatedAt: timestamp,
  items: z.array(PublicSearchItemSchema).max(100_000)
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  for (const item of value.items) {
    if (ids.has(item.publicId)) {
      context.addIssue({ code: "custom", message: "duplicate public search id" });
      break;
    }
    ids.add(item.publicId);
  }
});

export type PublicSearchItem = z.infer<typeof PublicSearchItemSchema>;
export type PublicSearchIndex = z.infer<typeof PublicSearchIndexSchema>;
export type LoadedPublicSearchIndex = PublicSearchIndex & { bundleId: string };

export function normalizePublicSearchQuery(query: string): string {
  return query.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ").slice(0, PUBLIC_SEARCH_MAX_QUERY_LENGTH);
}

/** Every word may match either language, source or date; all words must match the same story. */
export function matchPublicSearchItems(items: readonly PublicSearchItem[], query: string, contentType: PublicSearchItem["contentType"] | null = null): PublicSearchItem[] {
  const words = normalizePublicSearchQuery(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  return items.filter((item) => {
    if (contentType !== null && item.contentType !== contentType) return false;
    const text = [item.titleZh, item.summaryZh, item.titleEn, item.summaryEn, item.sourceName, item.publishedAt]
      .filter((part) => part !== null).join(" ").normalize("NFKC").toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
