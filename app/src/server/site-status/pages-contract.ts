import { fetchPublicFeed, PublicApiClientError } from "../../features/stories/public-api";
import { PublicStaticIndexSchema, PublicStaticPointerSchema } from "../../features/stories/public-static-schema";

/** Bundled at release construction, so the operator runtime needs no node_modules. */
export function parsePagesPointer(value: unknown) { return PublicStaticPointerSchema.parse(value); }
export function parsePagesIndex(value: unknown) { return PublicStaticIndexSchema.parse(value); }

export type PagesFeedVersion = "public-read-v0.1" | "public-read-bilingual-v2";
export async function validatePagesFeed(value: unknown, status: number, version: PagesFeedVersion): Promise<{ fallback: boolean; visibleItems: number }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PAGES_INVALID");
  const item = value as Record<string, unknown>;
  const allowedFallback = version === "public-read-bilingual-v2" && item.status === status
    && ((status === 406 && item.reasonCode === "PUBLIC_MEDIA_VERSION_UNSUPPORTED") || (status === 503 && item.reasonCode === "PUBLIC_READ_INTEGRITY_FAILED"));
  if (status !== 200 && !allowedFallback) throw new Error("PAGES_INVALID");
  if (status === 200 && (item.schemaVersion !== version || !Array.isArray(item.items) || item.items.length > 12
    || (version === "public-read-bilingual-v2" && (item.page as Record<string, unknown> | null)?.limit !== 12))) throw new Error("PAGES_INVALID");
  try {
    // Reuse the public client's closed DTO/problem schemas. This in-memory adapter never performs I/O.
    const validated = await fetchPublicFeed({ fetchImpl: async () => new Response(JSON.stringify(value), { status }) });
    if (status !== 200) throw new Error("PAGES_INVALID");
    return { fallback: false, visibleItems: validated.stories.length };
  } catch (error) {
    if (allowedFallback && error instanceof PublicApiClientError && error.status === status && error.reasonCode === item.reasonCode) {
      return { fallback: true, visibleItems: 0 };
    }
    throw new Error("PAGES_INVALID");
  }
}
