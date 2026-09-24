import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { LEAN_CONTENT_TYPES } from "./config.ts";
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
  keyPointsZh: z.array(z.string()).optional()
});

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

  const keyPointsZh = (submission.keyPointsZh ?? []).map((point) => point.trim()).filter((point) => point !== "").slice(0, MAX_KEY_POINTS);
  const item: StoredItem = {
    publicId: publicIdFor("rss", linkKey(submission.originalUrl)),
    sourceId: `editor-${submission.sourceDomain.replace(/[^a-z0-9]+/g, "-")}`,
    platform: "rss",
    displayName: submission.sourceName,
    contentType: submission.contentType,
    requireRelevance: false,
    link: submission.originalUrl,
    title: submission.originalTitle,
    text: submission.summaryZh,
    sourcePublishedAt: new Date(submission.sourcePublishedAt).toISOString(),
    firstSeenAt: now,
    image: null,
    status,
    attempts: 0,
    titleZh: submission.titleZh,
    summaryZh: submission.summaryZh,
    keyPointsZh,
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
      if (store.addEditorial(item, idempotencyKey) === "duplicate") throw new Rejection("DUPLICATE");
      const target = moveInto(source, paths.done, file, now);
      writeFileSync(`${target.replace(/\.json$/, "")}.receipt.json`,
        `${JSON.stringify({ publicId: item.publicId, contentType: item.contentType, link: item.link, status, importedAt: now }, null, 2)}\n`);
      entries.push({ file, state: status === "ready" ? "done" : "held", at: now, publicId: item.publicId,
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

/** Marks every accepted submission still awaiting publication as live in `commit`. */
export function markInboxPublished(root: string, commit: string, now: string): void {
  const path = inboxPaths(root).status;
  const entries = readStatus(path);
  if (!entries.some((entry) => entry.publishedHint === "awaiting_publish")) return;
  writeStatus(path, entries.map((entry) => entry.publishedHint === "awaiting_publish" ? { ...entry, publishedHint: "published" as const, commit } : entry), now);
}
