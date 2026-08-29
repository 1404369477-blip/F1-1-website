import { randomUUID } from "node:crypto";

import { decodePublicCursor, isCanonicalUtc, isPublicContentType, isPublicId, isSourceId } from "./cursor.ts";
import { asPublicReadError, PublicReadError } from "./error.ts";
import type {
  PublicBilingualFeedResponseV2,
  PublicBilingualStoryDetailResponseV2,
  PublicFeedQuery,
  PublicFeedResponseV1,
  PublicFeedResponseV2,
  PublicProblemV1,
  PublicReadVersion,
  PublicReasonCodeV1,
  PublicStoryDetailResponseV1,
  PublicStoryDetailResponseV2
} from "./types.ts";

export type PublicStoryReader = {
  getFeed(
    query: PublicFeedQuery,
    version?: PublicReadVersion
  ): PublicFeedResponseV1 | PublicFeedResponseV2 | PublicBilingualFeedResponseV2;
  getDetail(
    publicId: string,
    version?: PublicReadVersion
  ): PublicStoryDetailResponseV1 | PublicStoryDetailResponseV2 | PublicBilingualStoryDetailResponseV2 | null;
};

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8"
} as const;

const PROBLEM_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/problem+json; charset=utf-8"
} as const;

const PROBLEM_META: Record<PublicReasonCodeV1, { status: number; title: string; detail: string }> = {
  PUBLIC_QUERY_INVALID: { status: 400, title: "Invalid public query", detail: "The public feed query is invalid." },
  PUBLIC_CURSOR_PAIR_REQUIRED: { status: 400, title: "Cursor pair required", detail: "Both cursor fields are required." },
  PUBLIC_CURSOR_INVALID: { status: 400, title: "Invalid public cursor", detail: "The public feed cursor is invalid." },
  PUBLIC_CURSOR_SCOPE_MISMATCH: { status: 400, title: "Cursor scope mismatch", detail: "The public feed cursor does not match the filters." },
  PUBLIC_ID_INVALID: { status: 400, title: "Invalid public story id", detail: "The public story id is invalid." },
  PUBLIC_STORY_NOT_FOUND: { status: 404, title: "Public story not found", detail: "The public story is not available." },
  PUBLIC_READ_INCOMPLETE_CHAIN: { status: 500, title: "Public read unavailable", detail: "The public story chain is incomplete." },
  PUBLIC_READ_INTEGRITY_FAILED: { status: 500, title: "Public read unavailable", detail: "The public story integrity check failed." },
  PUBLIC_DB_BUSY: { status: 503, title: "Public read temporarily unavailable", detail: "The public database is temporarily busy." },
  PUBLIC_PROFILE_UNAVAILABLE: { status: 503, title: "Public profile unavailable", detail: "The public reading profile is unavailable." },
  PUBLIC_MEDIA_VERSION_UNSUPPORTED: { status: 406, title: "Public media version unsupported", detail: "The requested public media representation is unsupported." }
};

export const PUBLIC_V2_MEDIA_TYPE = "application/vnd.f1plus1.public-read-v0.2+json" as const;
export const PUBLIC_BILINGUAL_V2_MEDIA_TYPE = "application/vnd.f1plus1.public-read-bilingual-v2+json" as const;

export function selectPublicReadVersion(request: Request): PublicReadVersion {
  const url = new URL(request.url);
  const requested = url.searchParams.getAll("v");
  if (requested.length > 1) throw new PublicReadError("PUBLIC_QUERY_INVALID");
  if (requested[0] === "1") return "public-read-v0.1";
  if (requested[0] === "2") return "public-read-bilingual-v2";
  if (requested.length === 1) throw new PublicReadError("PUBLIC_QUERY_INVALID");
  const accept = request.headers.get("accept");
  if (accept === null) return "public-read-v0.1";
  const value = accept.trim();
  if (value === "*/*" || value === "application/json") return "public-read-v0.1";
  if (value === PUBLIC_V2_MEDIA_TYPE) return "public-read-v0.2";
  if (value === PUBLIC_BILINGUAL_V2_MEDIA_TYPE) return "public-read-bilingual-v2";
  throw new PublicReadError("PUBLIC_MEDIA_VERSION_UNSUPPORTED");
}

function jsonResponse(value: unknown, status = 200, cacheable = false): Response {
  const headers = new Headers(JSON_HEADERS);
  if (cacheable) {
    headers.set("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
    headers.set("Vary", "Accept");
  }
  return new Response(JSON.stringify(value), { status, headers });
}

export function publicProblem(reasonCode: PublicReasonCodeV1, instance: string, signedSnapshot = false): Response {
  const baseMeta = PROBLEM_META[reasonCode];
  const meta = signedSnapshot && reasonCode === "PUBLIC_READ_INTEGRITY_FAILED"
    ? { status: 503, title: "Public read unavailable", detail: "The signed public snapshot integrity check failed." }
    : baseMeta;
  const problem: PublicProblemV1 = {
    type: `urn:f1plus1:problem:${reasonCode}`,
    title: meta.title,
    status: meta.status,
    detail: meta.detail,
    instance,
    reasonCode,
    traceId: `trace-${randomUUID()}`
  };
  const headers = new Headers(PROBLEM_HEADERS);
  if (reasonCode === "PUBLIC_DB_BUSY" || reasonCode === "PUBLIC_READ_INTEGRITY_FAILED") headers.set("Retry-After", "1");
  return new Response(JSON.stringify(problem), { status: meta.status, headers });
}

function parseFeedQuery(request: Request, version: PublicReadVersion): PublicFeedQuery {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new PublicReadError("PUBLIC_QUERY_INVALID");
  }
  const allowed = version === "public-read-bilingual-v2"
    ? new Set(["v", "limit", "cursor", "category"])
    : new Set(["v", "cursorAt", "cursorId", "source", "contentType"]);
  const counts = new Map<string, number>();
  for (const [key, value] of url.searchParams.entries()) {
    if (!allowed.has(key) || value.length === 0) throw new PublicReadError("PUBLIC_QUERY_INVALID");
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if ((counts.get(key) ?? 0) > 1) throw new PublicReadError("PUBLIC_QUERY_INVALID");
  }
  if (version === "public-read-bilingual-v2") {
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw === null ? 12 : Number(limitRaw);
    const category = url.searchParams.get("category");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (category !== null && (category.length > 80 || /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(category)))) throw new PublicReadError("PUBLIC_QUERY_INVALID");
    return { source: null, contentType: null, cursor: null, limit, category, bilingualCursor: url.searchParams.get("cursor") };
  }
  const source = url.searchParams.get("source");
  if (source !== null && !isSourceId(source)) throw new PublicReadError("PUBLIC_QUERY_INVALID");
  const contentTypeValue = url.searchParams.get("contentType");
  if (contentTypeValue !== null && !isPublicContentType(contentTypeValue)) {
    throw new PublicReadError("PUBLIC_QUERY_INVALID");
  }
  const cursorAt = url.searchParams.get("cursorAt");
  const cursorId = url.searchParams.get("cursorId");
  if ((cursorAt === null) !== (cursorId === null)) throw new PublicReadError("PUBLIC_CURSOR_PAIR_REQUIRED");
  if (cursorAt === null || cursorId === null) {
    return { source, contentType: contentTypeValue, cursor: null };
  }
  if (!isCanonicalUtc(cursorAt)) throw new PublicReadError("PUBLIC_CURSOR_INVALID");
  const cursor = decodePublicCursor(cursorId);
  if (cursor.timelineAt !== cursorAt) throw new PublicReadError("PUBLIC_CURSOR_INVALID");
  if (cursor.source !== source || cursor.contentType !== contentTypeValue) {
    throw new PublicReadError("PUBLIC_CURSOR_SCOPE_MISMATCH");
  }
  return { source, contentType: contentTypeValue, cursor };
}

export function handlePublicFeed(request: Request, repository: PublicStoryReader): Response {
  let version: PublicReadVersion | null = null;
  try {
    version = selectPublicReadVersion(request);
    const query = parseFeedQuery(request, version);
    return jsonResponse(repository.getFeed(query, version), 200, version === "public-read-bilingual-v2");
  } catch (error) {
    return publicProblem(asPublicReadError(error).reasonCode, "/api/public/feed", version === "public-read-bilingual-v2");
  }
}

export function handlePublicStory(publicId: string, repository: PublicStoryReader, request?: Request): Response {
  let version: PublicReadVersion | null = null;
  try {
    if (!isPublicId(publicId)) throw new PublicReadError("PUBLIC_ID_INVALID");
    if (request) {
      const url = new URL(request.url);
      for (const key of url.searchParams.keys()) if (key !== "v") throw new PublicReadError("PUBLIC_QUERY_INVALID");
    }
    version = request ? selectPublicReadVersion(request) : "public-read-v0.1";
    const detail = repository.getDetail(publicId, version);
    return detail ? jsonResponse(detail, 200, version === "public-read-bilingual-v2") : publicProblem("PUBLIC_STORY_NOT_FOUND", "/api/public/stories");
  } catch (error) {
    return publicProblem(asPublicReadError(error).reasonCode, "/api/public/stories", version === "public-read-bilingual-v2");
  }
}
