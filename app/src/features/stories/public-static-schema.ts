import { z } from "zod";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const PUBLIC_ID_PATTERN = /^public-[a-z0-9-]{1,120}$/u;
const CONTENT_TYPES = ["race_news", "driver_social", "legends_history", "paddock_fun"] as const;
const TimestampSchema = z.string().datetime({ offset: false }).refine((value) => new Date(value).toISOString() === value);
const HashSchema = z.string().regex(HASH_PATTERN);

export type PublicStaticQueryReason = "PUBLIC_QUERY_INVALID" | "PUBLIC_ID_INVALID" | "PUBLIC_CURSOR_PAIR_REQUIRED" | "PUBLIC_CURSOR_INVALID";

export class PublicStaticQueryError extends Error {
  readonly reasonCode: PublicStaticQueryReason;

  constructor(reasonCode: PublicStaticQueryReason = "PUBLIC_QUERY_INVALID") {
    super(reasonCode);
    this.name = "PublicStaticQueryError";
    this.reasonCode = reasonCode;
  }
}

export function isPublicStaticId(value: string): boolean {
  return PUBLIC_ID_PATTERN.test(value);
}

/** The same canonical key is used by the exporter and the browser transport. */
export function normalizePublicStaticRequestKey(input: string): string {
  if (!input.startsWith("/api/public/") || input.includes("#") || input.includes("\\")) throw new PublicStaticQueryError();
  const url = new URL(input, "https://public.invalid");
  const isFeed = url.pathname === "/api/public/feed";
  if (!isFeed) {
    const match = /^\/api\/public\/stories\/([^/]+)$/u.exec(url.pathname);
    if (!match || !isPublicStaticId(match[1])) throw new PublicStaticQueryError("PUBLIC_ID_INVALID");
  }
  const version = url.searchParams.get("v");
  if (version !== null && version !== "1" && version !== "2") throw new PublicStaticQueryError();
  const allowed = !isFeed ? new Set(["v"]) : version === "2"
    ? new Set(["v", "limit", "cursor", "category"])
    : new Set(["v", "cursorAt", "cursorId", "source", "contentType"]);
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (!allowed.has(key) || seen.has(key) || value.length === 0 || value.length > 2048) throw new PublicStaticQueryError();
    seen.add(key);
  }
  if (isFeed && version === "2") {
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 12 : Number(rawLimit);
    const category = url.searchParams.get("category");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (category !== null && (category.length > 80 || /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(category)))) throw new PublicStaticQueryError();
  } else if (isFeed) {
    const contentType = url.searchParams.get("contentType");
    const source = url.searchParams.get("source");
    if ((contentType !== null && !(CONTENT_TYPES as readonly string[]).includes(contentType)) || (source !== null && !/^[a-z][a-z0-9_-]{0,127}$/u.test(source))) throw new PublicStaticQueryError();
    if (url.searchParams.has("cursorAt") !== url.searchParams.has("cursorId")) throw new PublicStaticQueryError("PUBLIC_CURSOR_PAIR_REQUIRED");
    const cursorId = url.searchParams.get("cursorId");
    if (cursorId !== null && (cursorId.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(cursorId))) throw new PublicStaticQueryError("PUBLIC_CURSOR_INVALID");
  }
  url.searchParams.sort();
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

export const PublicStaticResponseReferenceSchema = z.object({
  status: z.union([z.literal(200), z.literal(400), z.literal(404), z.literal(406), z.literal(500), z.literal(503)]),
  contentType: z.enum(["application/json", "application/json; charset=utf-8", "application/problem+json", "application/problem+json; charset=utf-8"]),
  path: z.string().regex(/^responses\/[0-9a-f]{64}\.json$/u),
  sha256: HashSchema
}).strict().refine((value) => value.path === `responses/${value.sha256}.json`, "response path must match hash")
  .refine((value) => value.status === 200 ? value.contentType.startsWith("application/json") : value.contentType.startsWith("application/problem+json"), "response content type must match status");

export const PublicStaticIndexSchema = z.object({
  schemaVersion: z.literal("public-static-index-v1"),
  generatedAt: TimestampSchema,
  responses: z.record(z.string(), PublicStaticResponseReferenceSchema)
}).strict().superRefine((value, context) => {
  const keys = Object.keys(value.responses);
  if (keys.length > 100_000) context.addIssue({ code: "custom", message: "too many response references" });
  for (const key of keys) {
    try {
      if (normalizePublicStaticRequestKey(key) !== key) throw new PublicStaticQueryError();
    } catch {
      context.addIssue({ code: "custom", message: "invalid canonical request key" });
      break;
    }
  }
});

export const PublicStaticPointerSchema = z.object({
  schemaVersion: z.literal("public-static-pointer-v1"),
  bundleId: HashSchema,
  generatedAt: TimestampSchema,
  indexPath: z.string().regex(/^_public\/generations\/[0-9a-f]{64}\/index\.json$/u),
  indexSha256: HashSchema
}).strict().refine((value) => value.bundleId === value.indexSha256 && value.indexPath === `_public/generations/${value.bundleId}/index.json`, "pointer identity mismatch");

export type PublicStaticPointer = z.infer<typeof PublicStaticPointerSchema>;
export type PublicStaticIndex = z.infer<typeof PublicStaticIndexSchema>;
export type PublicStaticResponseReference = z.infer<typeof PublicStaticResponseReferenceSchema>;
