import { createHash } from "node:crypto";
import { z } from "zod";

/** Generated from selection=keep in this exact repository CSV; no runtime CSV input. */
export const X_PAGE_SELECTION = Object.freeze({
  path: "data/x-source-selection-v1.csv",
  sha256: "cc48b950d90b0595949cdfd0a950628f1bf9f013c0ff0dd77bef657aec940446"
});
export const X_PAGE_HANDLES = Object.freeze([
  "f1", "fia", "mclarenf1", "scuderiaferrari", "mercedesamgf1", "redbullracing",
  "williamsf1", "alpinef1team", "astonmartinf1", "haasf1team", "audif1_", "visacashapprb",
  "lewishamilton", "charles_leclerc", "landonorris", "max33verstappen", "georgerussell63",
  "pierregasly", "alex_albon", "alo_oficial", "chrismedlandf1", "tgruener", "zhouguanyu24",
  "nicorosberg", "richardhammond", "mrjamesmay", "jeremyclarkson"
] as const);
export const X_PAGE_MAX_TEXT_CODEPOINTS = 25_000;
const allowedHandles = new Set<string>(X_PAGE_HANDLES);

const SourceSchema = z.object({
  handle: z.string().max(15),
  enabled: z.boolean(),
  identityStatus: z.enum(["unknown", "verified", "needs_review"])
}).strict();
const MediaSchema = z.object({
  kind: z.enum(["image", "video", "animated_gif"]),
  url: z.string().max(2048),
  altText: z.string().max(2000)
}).strict();
const PagePostSchema = z.object({
  schemaVersion: z.literal("x-visible-post-v1"),
  source: SourceSchema,
  pageUrl: z.string().max(2048),
  observedAt: z.string().max(30),
  statusUrl: z.string().max(2048),
  authorHandle: z.string().max(15),
  authorDisplayName: z.string().min(1).max(200),
  publishedAt: z.string().max(30),
  text: z.string().max(100_000),
  textComplete: z.boolean(),
  relations: z.object({
    replyToStatusUrl: z.string().max(2048).nullable(),
    quotedStatusUrl: z.string().max(2048).nullable(),
    repostedByHandle: z.string().max(15).nullable()
  }).strict(),
  media: z.array(MediaSchema).max(4)
}).strict();

/** Captured public visible data, never HTML, browser credentials or a publish instruction. */
export type PagePost = z.infer<typeof PagePostSchema>;
export type XPageCandidate = Readonly<{
  schemaVersion: "x-page-candidate-v1";
  selectionSha256: string;
  identity: string;
  sourceVersionHash: string;
  observedAt: string;
  observedOnHandle: string;
  authorHandle: string;
  authorDisplayName: string;
  statusId: string;
  canonicalUrl: string;
  publishedAt: string;
  text: string;
  contentType: "text/plain";
  relations: Readonly<{
    replyToStatusUrl: string | null;
    quotedStatusUrl: string | null;
    repostedByHandle: string | null;
  }>;
  mediaReferences: readonly Readonly<z.infer<typeof MediaSchema>>[];
  reviewState: "pending";
}>;

export class XPageNormalizationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "XPageNormalizationError"; }
}
function assert(value: unknown, code: string): asserts value {
  if (!value) throw new XPageNormalizationError(code);
}
function handle(value: string): string {
  assert(/^[A-Za-z0-9_]{1,15}$/.test(value), "X_PAGE_HANDLE_INVALID");
  return value.toLowerCase();
}
function plainText(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").normalize("NFC");
  // Keep newline and emoji joiners; reject other controls, bidi overrides and invisible separators.
  // Check before trim so leading/trailing controls cannot disappear silently.
  assert(!/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b\u202a-\u202e\u2066-\u2069\ufeff]/u.test(normalized), "X_PAGE_TEXT_CONTROL");
  const text = normalized.trim();
  assert(text.length > 0, "X_PAGE_TEXT_EMPTY");
  assert(!/[\ud800-\udfff]/u.test(text), "X_PAGE_TEXT_INVALID_UNICODE");
  return text;
}
function timestamp(value: string): number {
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), "X_PAGE_TIME_INVALID");
  const ms = Date.parse(value);
  assert(Number.isFinite(ms) && new Date(ms).toISOString() === value.replace(/Z$/, value.includes(".") ? "Z" : ".000Z"), "X_PAGE_TIME_INVALID");
  return ms;
}
function status(value: string): { handle: string; id: string; url: string; time: number } {
  // Validate the original string before URL normalization can hide dot segments or escapes.
  const match = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/([1-9][0-9]{14,19})(?:\?(?:s=[0-9]{1,2}|t=[A-Za-z0-9_-]{1,128})(?:&(?:s=[0-9]{1,2}|t=[A-Za-z0-9_-]{1,128}))?)?$/.exec(value);
  assert(match, "X_PAGE_STATUS_URL_INVALID");
  const author = handle(match[1]);
  const number = BigInt(match[2]);
  assert(number <= BigInt("18446744073709551615"), "X_PAGE_STATUS_ID_INVALID");
  const time = Number((number >> BigInt(22)) + BigInt("1288834974657"));
  return { handle: author, id: match[2], url: `https://x.com/${author}/status/${match[2]}`, time };
}
function mediaReference(value: z.infer<typeof MediaSchema>): Readonly<z.infer<typeof MediaSchema>> {
  assert(/^https:\/\/(?:pbs|video)\.twimg\.com\/[A-Za-z0-9/_.-]+(?:\?[A-Za-z0-9_=&.-]+)?$/.test(value.url), "X_PAGE_MEDIA_URL_INVALID");
  const url = new URL(value.url);
  assert(!url.pathname.split("/").some(part => part === "." || part === "..") && url.href === value.url, "X_PAGE_MEDIA_URL_INVALID");
  assert(value.kind !== "image" || url.hostname === "pbs.twimg.com", "X_PAGE_MEDIA_KIND_INVALID");
  return Object.freeze({ kind: value.kind, url: value.url, altText: value.altText === "" ? "" : plainText(value.altText) });
}
function mediaContentReference(value: Readonly<z.infer<typeof MediaSchema>>): Readonly<z.infer<typeof MediaSchema>> {
  const url = new URL(value.url);
  const sizes = new Set(["thumb", "small", "medium", "large"]);
  // Only the documented modern photo format: base_url?format=<format>&name=<size>.
  // https://docs.x.com/x-api/enterprise-gnip-2.0/fundamentals/data-dictionary
  // Keep the raw observed URL in the DTO; this key is never used for downloading.
  const params = [...url.searchParams.entries()];
  if (value.kind === "image" && url.hostname === "pbs.twimg.com" && /^\/media\/[A-Za-z0-9_-]+$/.test(url.pathname)
    && params.length === 2 && url.searchParams.getAll("name").length === 1 && url.searchParams.getAll("format").length === 1
    && sizes.has(url.searchParams.get("name")!) && /^(jpg|jpeg|png|webp)$/.test(url.searchParams.get("format")!)) {
    return Object.freeze({ ...value, url: `${url.origin}${url.pathname}?format=${url.searchParams.get("format")}` });
  }
  // Unknown parameters, formats, sizes, thumbnails and video URLs retain exact identity.
  return value;
}
function hash(domain: string, value: unknown): string {
  return createHash("sha256").update(`${domain}\n${JSON.stringify(value)}`, "utf8").digest("hex");
}

/**
 * Pure capture-to-candidate normalization. Source flags are supplied by a future trusted registry
 * bridge; this function does not authenticate browser evidence or authorize review/publication.
 * Render text/alt with escaping (textContent/React text); never pass them to an HTML sink.
 */
export function normalizePagePost(input: unknown): XPageCandidate {
  const parsed = PagePostSchema.safeParse(input);
  assert(parsed.success, "X_PAGE_INPUT_INVALID");
  const post = parsed.data;
  const sourceHandle = handle(post.source.handle);
  assert(allowedHandles.has(sourceHandle), "X_PAGE_SOURCE_NOT_SELECTED");
  assert(post.source.enabled, "X_PAGE_SOURCE_DISABLED");
  assert(post.source.identityStatus === "verified", "X_PAGE_SOURCE_IDENTITY_UNVERIFIED");
  const pageHandle = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/?$/.exec(post.pageUrl)?.[1];
  assert(pageHandle && handle(pageHandle) === sourceHandle, "X_PAGE_SOURCE_PAGE_MISMATCH");
  const canonical = status(post.statusUrl);
  const authorHandle = handle(post.authorHandle);
  assert(canonical.handle === authorHandle, "X_PAGE_AUTHOR_MISMATCH");
  assert(allowedHandles.has(authorHandle), "X_PAGE_AUTHOR_NOT_SELECTED");
  const observedMs = timestamp(post.observedAt);
  const publishedMs = timestamp(post.publishedAt);
  assert(publishedMs <= observedMs, "X_PAGE_TIME_IN_FUTURE");
  // Visible X timestamps can have second precision; never invent time from the ID when absent.
  assert(Math.floor(publishedMs / 1000) === Math.floor(canonical.time / 1000), "X_PAGE_STATUS_TIME_MISMATCH");
  assert(post.textComplete, "X_PAGE_TEXT_INCOMPLETE");
  const text = plainText(post.text);
  assert([...text].length <= X_PAGE_MAX_TEXT_CODEPOINTS, "X_PAGE_TEXT_TOO_LONG");
  const authorDisplayName = plainText(post.authorDisplayName);
  const repostedByHandle = post.relations.repostedByHandle === null ? null : handle(post.relations.repostedByHandle);
  if (repostedByHandle === null) assert(authorHandle === sourceHandle, "X_PAGE_CROSS_ACCOUNT_POST");
  else assert(repostedByHandle === sourceHandle, "X_PAGE_REPOST_ACTOR_MISMATCH");
  function related(value: string | null): string | null {
    if (value === null) return null;
    const link = status(value);
    assert(link.id !== canonical.id, "X_PAGE_SELF_REFERENCE");
    assert(link.time <= canonical.time, "X_PAGE_RELATION_TIME_INVALID");
    return link.url;
  }
  const replyToStatusUrl = related(post.relations.replyToStatusUrl);
  const quotedStatusUrl = related(post.relations.quotedStatusUrl);
  const mediaReferences = Object.freeze(post.media.map(mediaReference));
  const contentMediaReferences = mediaReferences.map(mediaContentReference);
  assert(new Set(contentMediaReferences.map(item => item.url)).size === mediaReferences.length, "X_PAGE_MEDIA_DUPLICATE");
  const publishedAt = new Date(publishedMs).toISOString();
  // Timestamp display precision, observing account/time and repost badge never make an edit.
  const content = { version: 1, authorHandle, statusId: canonical.id, text, replyToStatusUrl, quotedStatusUrl, mediaReferences: contentMediaReferences };
  return Object.freeze({
    schemaVersion: "x-page-candidate-v1", selectionSha256: X_PAGE_SELECTION.sha256,
    identity: hash("f1plus1-x-page-identity-v1", { authorHandle, statusId: canonical.id }),
    sourceVersionHash: hash("f1plus1-x-page-source-version-v1", content),
    observedAt: new Date(observedMs).toISOString(), observedOnHandle: sourceHandle,
    authorHandle, authorDisplayName, statusId: canonical.id, canonicalUrl: canonical.url,
    publishedAt, text, contentType: "text/plain", relations: Object.freeze({ replyToStatusUrl, quotedStatusUrl, repostedByHandle }),
    mediaReferences, reviewState: "pending"
  });
}
