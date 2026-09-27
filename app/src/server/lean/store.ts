import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type { LeanContentType, LeanSource } from "./config.ts";
import type { FeedEntry, FeedImage } from "./feed.ts";
import { contentTypeForTeamPost } from "./x-category.ts";

/** `held`: an editor submission waiting for release; it never reaches the public site, only the local preview. */
export type ItemStatus = "pending" | "ready" | "held" | "skipped" | "failed";

export type StoredItem = Readonly<{
  publicId: string;
  sourceId: string;
  platform: "rss" | "x";
  displayName: string;
  contentType: LeanContentType;
  requireRelevance: boolean;
  link: string;
  title: string;
  text: string;
  sourcePublishedAt: string | null;
  firstSeenAt: string;
  image: FeedImage | null;
  images: FeedImage[];
  status: ItemStatus;
  attempts: number;
  titleZh: string | null;
  summaryZh: string | null;
  summaryEn: string | null;
  keyPointsZh: string[];
  keyPointsEn: string[];
  detailEn: string[] | null;
  detailZh: string[] | null;
  publishedAt: string | null;
}>;

const MAX_REFINE_ATTEMPTS = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  public_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  link_key TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  display_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  require_relevance INTEGER NOT NULL,
  link TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  source_published_at TEXT,
  first_seen_at TEXT NOT NULL,
  image_json TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  title_zh TEXT,
  summary_zh TEXT,
  key_points_json TEXT NOT NULL DEFAULT '[]',
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS items_status ON items (status);
CREATE TABLE IF NOT EXISTS source_runs (
  source_id TEXT PRIMARY KEY,
  last_attempt_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS editor_submissions (
  idempotency_key TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
`;

type Row = Record<string, string | number | null>;

/** Tracking parameters and HTML-escaped variants of the same article map to one key. */
export function linkKey(link: string): string {
  const url = new URL(link.replace(/&amp;/g, "&"));
  return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

export function publicIdFor(platform: "rss" | "x", key: string): string {
  return `public-${platform}-${createHash("sha256").update(key).digest("hex")}`;
}

function imagesFrom(row: Row): FeedImage[] {
  if (row.images_json != null && row.images_json !== "") {
    const parsed = JSON.parse(String(row.images_json)) as unknown;
    if (Array.isArray(parsed)) return parsed as FeedImage[];
  }
  return row.image_json === null ? [] : [JSON.parse(String(row.image_json)) as FeedImage];
}

function toItem(row: Row): StoredItem {
  const images = imagesFrom(row);
  return {
    publicId: String(row.public_id),
    sourceId: String(row.source_id),
    platform: row.platform === "x" ? "x" : "rss",
    displayName: String(row.display_name),
    contentType: String(row.content_type) as LeanContentType,
    requireRelevance: row.require_relevance === 1,
    link: String(row.link),
    title: String(row.title),
    text: String(row.text),
    sourcePublishedAt: row.source_published_at === null ? null : String(row.source_published_at),
    firstSeenAt: String(row.first_seen_at),
    image: images[0] ?? null,
    images,
    status: String(row.status) as ItemStatus,
    attempts: Number(row.attempts),
    titleZh: row.title_zh === null ? null : String(row.title_zh),
    summaryZh: row.summary_zh === null ? null : String(row.summary_zh),
    summaryEn: row.summary_en == null || row.summary_en === "" ? null : String(row.summary_en),
    keyPointsZh: JSON.parse(String(row.key_points_json)) as string[],
    keyPointsEn: row.key_points_en_json == null ? [] : JSON.parse(String(row.key_points_en_json)) as string[],
    detailEn: row.detail_en_json == null ? null : JSON.parse(String(row.detail_en_json)) as string[],
    detailZh: row.detail_zh_json == null ? null : JSON.parse(String(row.detail_zh_json)) as string[],
    publishedAt: row.published_at === null ? null : String(row.published_at)
  };
}

export class LeanStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    for (const statement of [
      "ALTER TABLE items ADD COLUMN summary_en TEXT",
      "ALTER TABLE items ADD COLUMN detail_en_json TEXT",
      "ALTER TABLE items ADD COLUMN detail_zh_json TEXT",
      "ALTER TABLE items ADD COLUMN key_points_en_json TEXT",
      "ALTER TABLE items ADD COLUMN images_json TEXT"
    ]) {
      try { this.db.exec(statement); } catch { /* column already exists */ }
    }
    this.db.exec(`UPDATE items SET images_json = CASE WHEN image_json IS NULL THEN '[]' ELSE json_array(json(image_json)) END WHERE images_json IS NULL`);
  }

  close(): void {
    this.db.close();
  }

  /** Consistent point-in-time copy; safe while other connections write. */
  backupTo(path: string): void {
    this.db.prepare("VACUUM INTO ?").run(path);
  }

  /** Inserts unseen entries as pending; returns how many were new. Existing rows only gain a picture they lacked. */
  addEntries(source: LeanSource, entries: readonly FeedEntry[], now: string): number {
    const insert = this.db.prepare(`INSERT OR IGNORE INTO items
      (public_id, source_id, link_key, platform, display_name, content_type, require_relevance, link, title, text, source_published_at, first_seen_at, image_json, images_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`);
    const fillImages = this.db.prepare(`UPDATE items SET images_json = ?, image_json = ?
      WHERE link_key = ? AND (
        images_json IS NULL OR images_json = '[]' OR IFNULL(json_array_length(images_json), 0) < json_array_length(?)
      )`);
    let added = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) {
        const key = linkKey(entry.link);
        const images = entry.images.length > 0 ? entry.images : (entry.image ? [entry.image] : []);
        const imageJson = images[0] ? JSON.stringify(images[0]) : null;
        const imagesJson = JSON.stringify(images);
        const contentType = source.platform === "x"
          ? contentTypeForTeamPost(source.sourceId, source.contentType, entry.title, entry.text)
          : source.contentType;
        const result = insert.run(publicIdFor(source.platform, key), source.sourceId, key, source.platform,
          source.displayName, contentType, source.requireRelevance ? 1 : 0, entry.link, entry.title, entry.text,
          entry.sourcePublishedAt, now, imageJson, imagesJson);
        added += Number(result.changes);
        if (Number(result.changes) === 0 && images.length > 0) fillImages.run(imagesJson, imageJson, key, imagesJson);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return added;
  }

  replaceImages(link: string, images: readonly FeedImage[]): boolean {
    if (images.length === 0) return false;
    const json = JSON.stringify(images.slice(0, 4));
    const result = this.db.prepare(`UPDATE items SET images_json = ?, image_json = ?
      WHERE link_key = ? AND platform = 'x' AND (
        images_json IS NULL OR images_json = '[]' OR IFNULL(json_array_length(images_json), 0) < json_array_length(?)
      )`).run(json, JSON.stringify(images[0]), linkKey(link), json);
    return Number(result.changes) === 1;
  }

  /** Imports an already-published item verbatim (used once to carry over the current site). */
  importReady(item: StoredItem): void {
    this.db.prepare(`INSERT OR IGNORE INTO items
      (public_id, source_id, link_key, platform, display_name, content_type, require_relevance, link, title, text, source_published_at, first_seen_at, image_json, status, title_zh, summary_zh, key_points_json, published_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`)
      .run(item.publicId, item.sourceId, linkKey(item.link), item.platform, item.displayName, item.contentType, item.link, item.title, item.text,
        item.sourcePublishedAt, item.firstSeenAt, item.image === null ? null : JSON.stringify(item.image), item.titleZh, item.summaryZh,
        JSON.stringify(item.keyPointsZh), item.publishedAt);
  }

  /**
   * Stores an editor-written story as `ready` or `held`, bypassing the model.
   * Returns "duplicate" when its idempotency key or link is already known.
   */
  addEditorial(item: StoredItem, idempotencyKey: string): "added" | "duplicate" {
    const key = linkKey(item.link);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const known = this.db.prepare("SELECT 1 FROM editor_submissions WHERE idempotency_key = ?").get(idempotencyKey);
      const inserted = known ? 0 : Number(this.db.prepare(`INSERT OR IGNORE INTO items
        (public_id, source_id, link_key, platform, display_name, content_type, require_relevance, link, title, text, source_published_at, first_seen_at, image_json, status, title_zh, summary_zh, key_points_json, published_at, detail_en_json, detail_zh_json)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(item.publicId, item.sourceId, key, item.platform, item.displayName, item.contentType, item.link, item.title, item.text,
          item.sourcePublishedAt, item.firstSeenAt, item.image === null ? null : JSON.stringify(item.image), item.status, item.titleZh, item.summaryZh, JSON.stringify(item.keyPointsZh), item.publishedAt,
          item.detailEn == null ? null : JSON.stringify(item.detailEn), item.detailZh == null ? null : JSON.stringify(item.detailZh)).changes);
      if (inserted === 1) {
        this.db.prepare("INSERT INTO editor_submissions (idempotency_key, public_id, imported_at) VALUES (?, ?, ?)").run(idempotencyKey, item.publicId, item.firstSeenAt);
      }
      this.db.exec("COMMIT");
      return inserted === 1 ? "added" : "duplicate";
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Moves every held editor story to ready; returns how many were released. */
  releaseHeld(): number {
    return Number(this.db.prepare("UPDATE items SET status = 'ready' WHERE status = 'held'").run().changes);
  }

  held(): StoredItem[] {
    return (this.db.prepare("SELECT * FROM items WHERE status = 'held' ORDER BY COALESCE(source_published_at, published_at) DESC").all() as Row[]).map(toItem);
  }

  pending(limit: number): StoredItem[] {
    return (this.db.prepare(`SELECT * FROM items WHERE status = 'pending' AND attempts < ?
      ORDER BY COALESCE(source_published_at, first_seen_at) DESC LIMIT ?`).all(MAX_REFINE_ATTEMPTS, limit) as Row[]).map(toItem);
  }

  markReady(publicId: string, titleZh: string, summaryZh: string, keyPointsZh: readonly string[], now: string,
    extras: { summaryEn?: string | null; keyPointsEn?: readonly string[]; detailEn?: string[] | null; detailZh?: string[] | null } = {}): void {
    this.db.prepare(`UPDATE items SET status = 'ready', title_zh = ?, summary_zh = ?, summary_en = ?, key_points_json = ?, key_points_en_json = ?,
      detail_en_json = ?, detail_zh_json = ?, published_at = ?, attempts = attempts + 1
      WHERE public_id = ? AND status = 'pending'`).run(
      titleZh, summaryZh, extras.summaryEn ?? null, JSON.stringify(keyPointsZh), JSON.stringify(extras.keyPointsEn ?? []),
      extras.detailEn == null ? null : JSON.stringify(extras.detailEn),
      extras.detailZh == null ? null : JSON.stringify(extras.detailZh),
      now, publicId);
  }

  /** Rewrites the Chinese and English copy of an already published story. */
  rewriteReady(publicId: string, copy: { titleZh: string; summaryZh: string; summaryEn: string | null; keyPointsZh: readonly string[]; keyPointsEn: readonly string[]; detailEn: string[] | null; detailZh: string[] | null }): void {
    this.db.prepare(`UPDATE items SET title_zh = ?, summary_zh = ?, summary_en = ?, key_points_json = ?, key_points_en_json = ?, detail_en_json = ?, detail_zh_json = ?
      WHERE public_id = ? AND status = 'ready'`).run(
      copy.titleZh, copy.summaryZh, copy.summaryEn, JSON.stringify(copy.keyPointsZh), JSON.stringify(copy.keyPointsEn),
      copy.detailEn == null ? null : JSON.stringify(copy.detailEn),
      copy.detailZh == null ? null : JSON.stringify(copy.detailZh),
      publicId);
  }

  allReadyRss(): StoredItem[] {
    return (this.db.prepare("SELECT * FROM items WHERE status = 'ready' AND platform = 'rss'").all() as Row[]).map(toItem);
  }

  readyItems(): StoredItem[] {
    return (this.db.prepare("SELECT * FROM items WHERE status = 'ready'").all() as Row[]).map(toItem);
  }
  rssToRepair(): StoredItem[] {
    return (this.db.prepare(`SELECT * FROM items WHERE status = 'ready' AND platform = 'rss' AND (
        detail_zh_json IS NULL
        OR (key_points_json != '[]' AND (key_points_en_json IS NULL OR key_points_en_json = '[]'))
        OR (summary_en IS NOT NULL AND length(summary_en) >= 230 AND substr(rtrim(summary_en), -1) NOT IN ('.', '!', '?', '"'))
      ) ORDER BY COALESCE(source_published_at, published_at) DESC`).all() as Row[]).map(toItem);
  }

  /** Ready stories from the last `days` that still have no full text. */
  readyWithoutDetail(days: number, now: Date): StoredItem[] {
    const since = new Date(now.getTime() - days * 24 * 3600 * 1000).toISOString();
    return (this.db.prepare(`SELECT * FROM items WHERE status = 'ready' AND detail_zh_json IS NULL
      AND COALESCE(source_published_at, published_at) >= ? ORDER BY COALESCE(source_published_at, published_at) DESC`).all(since) as Row[]).map(toItem);
  }

  markSkipped(publicId: string): void {
    this.db.prepare("UPDATE items SET status = 'skipped', attempts = attempts + 1 WHERE public_id = ? AND status = 'pending'").run(publicId);
  }

  /** X posts that are waiting for the model or already public. */
  activeXPosts(): StoredItem[] {
    return (this.db.prepare("SELECT * FROM items WHERE platform = 'x' AND status IN ('pending', 'ready')").all() as Row[]).map(toItem);
  }

  /** Summarized X posts later taken off the site; the model's own skips never have a Chinese title. */
  retiredXPosts(): StoredItem[] {
    return (this.db.prepare("SELECT * FROM items WHERE platform = 'x' AND status = 'skipped' AND title_zh IS NOT NULL").all() as Row[]).map(toItem);
  }

  /** Takes a pending or public story out of the site; the row stays so it is never collected again. */
  retire(publicId: string): void {
    this.db.prepare("UPDATE items SET status = 'skipped' WHERE public_id = ? AND status IN ('pending', 'ready')").run(publicId);
  }

  setContentType(publicId: string, contentType: LeanContentType): void {
    this.db.prepare("UPDATE items SET content_type = ? WHERE public_id = ? AND status IN ('pending', 'ready')").run(contentType, publicId);
  }

  reinstate(publicId: string): void {
    this.db.prepare("UPDATE items SET status = 'ready' WHERE public_id = ? AND status = 'skipped' AND title_zh IS NOT NULL").run(publicId);
  }

  markAttemptFailed(publicId: string): void {
    this.db.prepare(`UPDATE items SET attempts = attempts + 1,
      status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE status END WHERE public_id = ? AND status = 'pending'`).run(MAX_REFINE_ATTEMPTS, publicId);
  }

  ready(maxItems: number, minTimelineAt: string): StoredItem[] {
    return (this.db.prepare(`SELECT * FROM items WHERE status = 'ready' AND COALESCE(source_published_at, published_at) >= ?
      ORDER BY COALESCE(source_published_at, published_at) DESC, public_id DESC LIMIT ?`).all(minTimelineAt, maxItems) as Row[]).map(toItem);
  }

  lastAttemptAt(sourceId: string): string | null {
    const row = this.db.prepare("SELECT last_attempt_at FROM source_runs WHERE source_id = ?").get(sourceId) as Row | undefined;
    return row ? String(row.last_attempt_at) : null;
  }

  recordSourceRun(sourceId: string, now: string, error: string | null): void {
    this.db.prepare(`INSERT INTO source_runs (source_id, last_attempt_at, last_success_at, last_error) VALUES (?, ?, ?, ?)
      ON CONFLICT (source_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
        last_success_at = COALESCE(excluded.last_success_at, source_runs.last_success_at), last_error = excluded.last_error`)
      .run(sourceId, now, error === null ? now : null, error);
  }

  counts(): Record<ItemStatus, number> {
    const result: Record<ItemStatus, number> = { pending: 0, ready: 0, held: 0, skipped: 0, failed: 0 };
    for (const row of this.db.prepare("SELECT status, COUNT(*) AS n FROM items GROUP BY status").all() as Row[]) {
      result[String(row.status) as ItemStatus] = Number(row.n);
    }
    return result;
  }
}
