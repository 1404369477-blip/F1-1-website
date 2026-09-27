import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { EDITORIAL_IMAGE_HOSTS, LEAN_CONTENT_TYPES, RSSHUB_ACCESS_KEY_PATH, RSSHUB_ORIGIN } from "./config.ts";
import { isAgencyImage, largeTwimgUrl, parseFeed, pickTweetImages, type FeedImage } from "./feed.ts";
import { linkKey, publicIdFor, type LeanStore, type StoredItem } from "./store.ts";

export const EDITOR_SUBMISSION_MAX_BYTES = 64 * 1024;
const STATUS_HISTORY_LIMIT = 200;
const MAX_KEY_POINTS = 3;
const HAN = /\p{Script=Han}/u;

export type EditorInboxSettings = { enabled: boolean; publishMode: "auto" | "hold" };

export type InboxEntry = {
  file: string;
  state: "done" | "held" | "rejected";
  at: string;
  publicId?: string;
  reason?: string;
  publishedHint?: "awaiting_publish" | "held_preview_only" | "published";
  commit?: string;
};

export type InboxReport = { enabled: boolean; imported: number; held: number; rejected: number; released: number };

const chinese = (max: number) => z.string().trim().min(1).max(max).refine((value) => HAN.test(value), "NOT_CHINESE");
const STATUS_URL = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/i;

/** An editor link that is one tweet, not a news article. */
export function xStatusFromUrl(url: string): { handle: string; id: string } | null {
  const match = STATUS_URL.exec(url);
  if (!match?.[1] || !match[2]) return null;
  return { handle: match[1], id: match[2] };
}

export function stripSourceFootnote(text: string): string {
  return text.replace(/[（(]来源：[^）)]{0,80}[）)]/g, "").replace(/\s{2,}/g, " ").trim();
}

const SubmissionSchema = z.object({
  schemaVersion: z.literal("editor-submission-v1"),
  idempotencyKey: z.string().trim().min(1).max(200),
  originalUrl: z.string().url().refine((value) => value.startsWith("https://"), "NOT_HTTPS"),
  sourceName: z.string().trim().min(1).max(80),
  sourceDomain: z.string().trim().toLowerCase().min(1).max(253),
  originalTitle: z.string().trim().min(1).max(400),
  sourcePublishedAt: z.string().datetime({ offset: true }),
  contentType: z.enum(LEAN_CONTENT_TYPES),
  credibility: z.string().trim().min(1).max(40),
  titleZh: chinese(120),
  summaryZh: chinese(600),
  keyPointsZh: z.array(z.string()).optional(),
  imageUrl: z.string().url().refine((value) => value.startsWith("https://"), "NOT_HTTPS").optional(),
  detailZh: z.string().max(5000).optional(),
  detailEn: z.string().max(8000).optional()
});

function submissionImage(imageUrl: string | undefined): FeedImage | null {
  if (imageUrl === undefined) return null;
  const url = new URL(imageUrl);
  if (!EDITORIAL_IMAGE_HOSTS.includes(url.hostname.toLowerCase())) throw new Rejection("IMAGE_DOMAIN_NOT_ALLOWED");
  if (isAgencyImage(imageUrl)) throw new Rejection("IMAGE_AGENCY_NOT_ALLOWED");
  if (url.hostname === "pbs.twimg.com") {
    const tweetImage = largeTwimgUrl(imageUrl);
    if (tweetImage === null) throw new Rejection("IMAGE_DOMAIN_NOT_ALLOWED");
    return { ...tweetImage, declaredBytes: 1 };
  }
  const extension = /\.(jpe?g|png|webp|avif)$/i.exec(url.pathname)?.[1]?.toLowerCase();
  const mimeType: FeedImage["mimeType"] = extension === "png" || extension === "webp" || extension === "avif" ? `image/${extension}` : "image/jpeg";
  return { url: url.toString(), mimeType, declaredBytes: 1 };
}

class Rejection extends Error {}

export function inboxPaths(root: string) {
  return { root, done: join(root, "done"), rejected: join(root, "rejected"), status: join(root, "status.json") };
}

/** Validates one submission; the returned item has not been stored yet. */
export function parseSubmission(raw: string, allowedDomains: readonly string[], status: "ready" | "held", now: string): { item: StoredItem; idempotencyKey: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Rejection("INVALID_JSON");
  }
  if (typeof json === "object" && json !== null && "schemaVersion" in json && json.schemaVersion !== "editor-submission-v1") {
    throw new Rejection("SCHEMA_VERSION_UNSUPPORTED");
  }
  const parsed = SubmissionSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Rejection(`INVALID_FIELD: ${issue?.path.join(".") || "(root)"} ${issue?.message ?? ""}`.trim());
  }
  const submission = parsed.data;
  const host = new URL(submission.originalUrl).hostname.toLowerCase();
  if (!allowedDomains.includes(submission.sourceDomain)) throw new Rejection("DOMAIN_NOT_ALLOWED");
  if (host !== submission.sourceDomain) throw new Rejection("URL_DOMAIN_MISMATCH");
  const image = submissionImage(submission.imageUrl);
  const detailZh = submission.detailZh?.trim() ? submission.detailZh.trim().split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean) : null;
  const detailEn = submission.detailEn?.trim() ? submission.detailEn.trim().split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean) : null;
  if ((detailZh === null) !== (detailEn === null)) throw new Rejection("INVALID_FIELD: detailZh detailEn must both be present or both be absent");
  if (detailZh && detailEn && detailZh.length !== detailEn.length) throw new Rejection("PARAGRAPH_COUNT_MISMATCH");

  const tweet = xStatusFromUrl(submission.originalUrl);
  const platform = tweet ? "x" as const : "rss" as const;
  const keyPointsZh = platform === "x" ? [] : (submission.keyPointsZh ?? []).map((point) => point.trim()).filter((point) => point !== "").slice(0, MAX_KEY_POINTS);
  const cleanDetail = (paragraphs: string[] | null) => paragraphs?.map((paragraph) => stripSourceFootnote(paragraph)).filter((paragraph) => paragraph.length > 0) ?? null;
  const item: StoredItem = {
    publicId: publicIdFor(platform, linkKey(submission.originalUrl)),
    sourceId: `editor-${submission.sourceDomain.replace(/[^a-z0-9]+/g, "-")}`,
    platform,
    displayName: tweet ? `@${tweet.handle}` : submission.sourceName,
    contentType: submission.contentType,
    requireRelevance: false,
    link: submission.originalUrl,
    title: submission.originalTitle,
    text: submission.summaryZh,
    sourcePublishedAt: new Date(submission.sourcePublishedAt).toISOString(),
    firstSeenAt: now,
    image,
    images: image ? [image] : [],
    status,
    attempts: 0,
    titleZh: stripSourceFootnote(submission.titleZh),
    summaryZh: stripSourceFootnote(submission.summaryZh),
    summaryEn: null,
    keyPointsZh,
    keyPointsEn: [],
    detailEn: platform === "x" ? cleanDetail(detailEn) : detailEn,
    detailZh: platform === "x" ? cleanDetail(detailZh) : detailZh,
    publishedAt: now
  };
  return { item, idempotencyKey: submission.idempotencyKey };
}

function readStatus(path: string): InboxEntry[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { entries?: InboxEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

function writeStatus(path: string, entries: readonly InboxEntry[], now: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ updatedAt: now, entries: entries.slice(0, STATUS_HISTORY_LIMIT) }, null, 2)}\n`);
  renameSync(temp, path);
}

/** Moves `file` into `directory` without overwriting an earlier file of the same name. */
function moveInto(source: string, directory: string, file: string, now: string): string {
  let target = join(directory, file);
  if (existsSync(target)) target = join(directory, `${now.replace(/[:.]/g, "-")}-${file}`);
  renameSync(source, target);
  return target;
}

/**
 * Imports every top-level `*.json` in the inbox. Accepted files go to `done/` with a receipt,
 * rejected ones to `rejected/` with a `.reason.txt`. Editor text is stored as written; the model is never called.
 */
export function importEditorInbox(store: LeanStore, root: string, settings: EditorInboxSettings, allowedDomains: readonly string[], now: string): InboxReport {
  const report: InboxReport = { enabled: settings.enabled, imported: 0, held: 0, rejected: 0, released: 0 };
  if (!settings.enabled) return report;
  const paths = inboxPaths(root);
  for (const directory of [paths.root, paths.done, paths.rejected]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (settings.publishMode === "auto") report.released = store.releaseHeld();

  const status = settings.publishMode === "auto" ? "ready" : "held";
  const files = readdirSync(paths.root).filter((name) => name.endsWith(".json") && name !== "status.json" && !name.startsWith(".")).sort();
  const entries: InboxEntry[] = [];
  for (const file of files) {
    const source = join(paths.root, file);
    const stat = lstatSync(source);
    if (!stat.isFile()) continue;
    try {
      if (stat.size > EDITOR_SUBMISSION_MAX_BYTES) throw new Rejection("FILE_TOO_LARGE");
      const { item, idempotencyKey } = parseSubmission(readFileSync(source, "utf8"), allowedDomains, status, now);
      const added = store.addEditorial(item, idempotencyKey);
      if (added.kind === "duplicate") throw new Rejection("DUPLICATE");
      const target = moveInto(source, paths.done, file, now);
      writeFileSync(`${target.replace(/\.json$/, "")}.receipt.json`,
        `${JSON.stringify({ publicId: added.publicId, contentType: item.contentType, link: item.link, status, importedAt: now }, null, 2)}\n`);
      entries.push({ file, state: status === "ready" ? "done" : "held", at: now, publicId: added.publicId,
        publishedHint: status === "ready" ? "awaiting_publish" : "held_preview_only" });
      if (status === "ready") report.imported++;
      else report.held++;
    } catch (error) {
      if (!(error instanceof Rejection)) throw error;
      const target = moveInto(source, paths.rejected, file, now);
      writeFileSync(`${target.replace(/\.json$/, "")}.reason.txt`, `${error.message}\n`);
      entries.push({ file, state: "rejected", at: now, reason: error.message });
      report.rejected++;
    }
  }
  const previous = readStatus(paths.status);
  const released = report.released > 0
    ? previous.map((entry) => entry.state === "held" ? { ...entry, state: "done" as const, publishedHint: "awaiting_publish" as const } : entry)
    : previous;
  if (entries.length > 0 || report.released > 0 || !existsSync(paths.status)) writeStatus(paths.status, [...entries.reverse(), ...released], now);
  return report;
}

/** Loads every picture on an editor-submitted tweet (at most four) and stores the post as an X item. */
export async function refreshEditorTweets(store: LeanStore, fetcher: typeof fetch = fetch): Promise<{ updated: number; images: number }> {
  let updated = 0;
  let images = 0;
  for (const item of store.editorStatusPosts()) {
    const tweet = xStatusFromUrl(item.link);
    if (!tweet) continue;
    const summaryZh = stripSourceFootnote(item.summaryZh ?? "");
    const titleZh = stripSourceFootnote(item.titleZh ?? summaryZh);
    const detailZh = item.detailZh?.map((paragraph) => stripSourceFootnote(paragraph)).filter((paragraph) => paragraph.length > 0) ?? null;
    const detailEn = item.detailEn?.map((paragraph) => stripSourceFootnote(paragraph)).filter((paragraph) => paragraph.length > 0) ?? null;
    const textChanged = item.platform !== "x" || item.displayName !== `@${tweet.handle}` || (item.summaryZh ?? "") !== summaryZh || item.keyPointsZh.length > 0;
    if (textChanged) {
      store.markEditorTweet(item.publicId, `@${tweet.handle}`, titleZh || summaryZh, summaryZh, detailZh && detailZh.length > 0 ? detailZh : null, detailEn && detailEn.length > 0 ? detailEn : null);
      updated += 1;
    }
    if (item.images.length < 4) {
      const pictures = await fetchStatusImages(tweet.handle, tweet.id, fetcher);
      if (pictures.length > 0 && store.replaceImages(item.link, pictures)) images += 1;
    }
  }
  return { updated, images };
}

async function fetchStatusImages(handle: string, id: string, fetcher: typeof fetch): Promise<FeedImage[]> {
  let key = "";
  try {
    key = readFileSync(RSSHUB_ACCESS_KEY_PATH, "utf8").trim();
  } catch {
    return [];
  }
  const query = key.length > 0 ? `?key=${encodeURIComponent(key)}` : "";
  for (const route of [`/twitter/tweet/${id}`, `/twitter/status/${id}`]) {
    try {
      const response = await fetcher(`${RSSHUB_ORIGIN}${route}${query}`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) continue;
      const images = pickTweetImages(await response.text());
      if (images.length > 0) return images.slice(0, 4);
    } catch {
      // The other route may still have the pictures.
    }
  }
  try {
    const response = await fetcher(`${RSSHUB_ORIGIN}/twitter/user/${encodeURIComponent(handle)}${query}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return [];
    const entries = parseFeed({
      sourceId: "editor-tweet",
      platform: "x",
      displayName: `@${handle}`,
      feedUrl: `${RSSHUB_ORIGIN}/twitter/user/${handle}`,
      contentType: "driver_social",
      requireRelevance: false
    }, await response.text());
    return entries.find((entry) => entry.link.includes(`/status/${id}`))?.images.slice(0, 4) ?? [];
  } catch {
    return [];
  }
}

/** Marks only submissions included in the confirmed generation as live in `commit`. */
export function markInboxPublished(root: string, commit: string, now: string, publicIds?: readonly string[]): void {
  const path = inboxPaths(root).status;
  const entries = readStatus(path);
  const included = publicIds ? new Set(publicIds) : null;
  const canMark = (entry: InboxEntry): boolean => entry.publishedHint === "awaiting_publish" && (included === null || (entry.publicId !== undefined && included.has(entry.publicId)));
  if (!entries.some(canMark)) return;
  writeStatus(path, entries.map((entry) => canMark(entry) ? { ...entry, publishedHint: "published" as const, commit } : entry), now);
}
