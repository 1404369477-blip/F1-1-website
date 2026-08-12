import { randomUUID } from "node:crypto";

import { decodePublicCursor, isCanonicalUtc, isPublicContentType, isPublicId, isSourceId } from "./cursor.ts";
import { asPublicReadError, PublicReadError } from "./error.ts";
import type {
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
  ): PublicFeedResponseV1 | PublicFeedResponseV2;
  getDetail(
    publicId: string,
    version?: PublicReadVersion
  ): PublicStoryDetailResponseV1 | PublicStoryDetailResponseV2 | null;
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

export function selectPublicReadVersion(request: Request): PublicReadVersion {
  const accept = request.headers.get("accept");
  if (accept === null) return "public-read-v0.1";
  const value = accept.trim();
  if (value === "*/*" || value === "application/json") return "public-read-v0.1";
  if (value === PUBLIC_V2_MEDIA_TYPE) return "public-read-v0.2";
  throw new PublicReadError("PUBLIC_MEDIA_VERSION_UNSUPPORTED");
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

export function publicProblem(reasonCode: PublicReasonCodeV1, instance: string): Response {
  const meta = PROBLEM_META[reasonCode];
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
  if (reasonCode === "PUBLIC_DB_BUSY") headers.set("Retry-After", "1");
  return new Response(JSON.stringify(problem), { status: meta.status, headers });
}

function parseFeedQuery(request: Request): PublicFeedQuery {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new PublicReadError("PUBLIC_QUERY_INVALID");
  }
  const allowed = new Set(["cursorAt", "cursorId", "source", "contentType"]);
  const counts = new Map<string, number>();
  for (const [key, value] of url.searchParams.entries()) {
    if (!allowed.has(key) || value.length === 0) throw new PublicReadError("PUBLIC_QUERY_INVALID");
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if ((counts.get(key) ?? 0) > 1) throw new PublicReadError("PUBLIC_QUERY_INVALID");
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
  if (cursor.publishedAt !== cursorAt) throw new PublicReadError("PUBLIC_CURSOR_INVALID");
  if (cursor.source !== source || cursor.contentType !== contentTypeValue) {
    throw new PublicReadError("PUBLIC_CURSOR_SCOPE_MISMATCH");
  }
  return { source, contentType: contentTypeValue, cursor };
}

export function handlePublicFeed(request: Request, repository: PublicStoryReader): Response {
  try {
    const query = parseFeedQuery(request);
    return jsonResponse(repository.getFeed(query, selectPublicReadVersion(request)));
  } catch (error) {
    return publicProblem(asPublicReadError(error).reasonCode, "/api/public/feed");
  }
}

export function handlePublicStory(publicId: string, repository: PublicStoryReader, request?: Request): Response {
  try {
    if (!isPublicId(publicId)) throw new PublicReadError("PUBLIC_ID_INVALID");
    const version = request ? selectPublicReadVersion(request) : "public-read-v0.1";
    const detail = repository.getDetail(publicId, version);
    return detail ? jsonResponse(detail) : publicProblem("PUBLIC_STORY_NOT_FOUND", "/api/public/stories");
  } catch (error) {
    return publicProblem(asPublicReadError(error).reasonCode, "/api/public/stories");
  }
}
