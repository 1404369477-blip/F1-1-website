import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

import { DEFAULT_EDITORIAL_DOMAINS, leanPath, leanSources, REFINE_BATCH_LIMIT, SITE_MAX_AGE_DAYS, SITE_MAX_ITEMS, type LeanSource } from "./config.ts";
import { importEditorInbox, markInboxPublished, type EditorInboxSettings, type InboxReport } from "./editor-inbox.ts";
import { backupStoreIfDue, type BackupReport } from "./backup.ts";
import { fetchFeed } from "./feed.ts";
import { localizeImages, type LocalMedia, type MediaReport } from "./media.ts";
import { publishBundle, stageSite } from "./pages-publish.ts";
import { refineItem, resolveModel } from "./refine.ts";
import { buildSiteBundle } from "./site-bundle.ts";
import { LeanStore, type StoredItem } from "./store.ts";
import { tweetSkipReason, type TweetSkipReason } from "./x-filter.ts";

/** Entries older than this on first sight are history, not news; they are not summarized. */
const MAX_NEW_ENTRY_AGE_MS = 3 * 24 * 3600 * 1000;
/** Six parallel X fetches through the local RSSHub exceeded the 20s fetch timeout. */
const FETCH_CONCURRENCY = 3;
/** One burner account serves every X source; polling each handle at most this often keeps it under X's rate limits. */
const X_MIN_INTERVAL_MS = 28 * 60 * 1000;
const REFINE_CONCURRENCY = 4;

type LeanState = { lastPublishedFingerprint: string | null; lastPublishedAt: string | null; lastCommit: string | null };
type LeanSettings = {
  xHandles: string[] | "all";
  publish: boolean;
  editorialDomains?: string[];
  editorInbox?: Partial<EditorInboxSettings>;
};

export type CycleReport = {
  startedAt: string;
  finishedAt: string;
  inbox: InboxReport & { error: string | null };
  sources: { ok: number; failed: { sourceId: string; error: string }[] };
  newEntries: number;
  /** X posts taken out this cycle (new ones before the model sees them, public ones on the next publish). */
  xFiltered: Record<TweetSkipReason, number>;
  refined: { ready: number; skipped: number; failed: number };
  backup: BackupReport;
  media: MediaReport & { error: string | null };
  site: { items: number; published: boolean; commit: string | null; reason: string };
  counts: Record<string, number>;
};

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as T : fallback;
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

async function mapLimit<T, R>(values: readonly T[], limit: number, run: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await run(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** A dead holder's lock is taken over; a live holder means another cycle is running. */
function acquireLock(path: string): (() => void) | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => { try { unlinkSync(path); } catch { /* already gone */ } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = Number(readFileSync(path, "utf8"));
      try {
        process.kill(holder, 0);
        return null;
      } catch {
        unlinkSync(path);
      }
    }
  }
  return null;
}

async function collect(store: LeanStore, sources: readonly LeanSource[], now: Date): Promise<Pick<CycleReport, "sources" | "newEntries">> {
  const failed: { sourceId: string; error: string }[] = [];
  let newEntries = 0;
  const cutoff = now.getTime() - MAX_NEW_ENTRY_AGE_MS;
  await mapLimit(sources, FETCH_CONCURRENCY, async (source) => {
    try {
      const entries = (await fetchFeed(source)).filter((entry) => entry.sourcePublishedAt === null || Date.parse(entry.sourcePublishedAt) >= cutoff);
      newEntries += store.addEntries(source, entries, now.toISOString());
      store.recordSourceRun(source.sourceId, now.toISOString(), null);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN";
      failed.push({ sourceId: source.sourceId, error: message });
      store.recordSourceRun(source.sourceId, now.toISOString(), message);
    }
  });
  return { sources: { ok: sources.length - failed.length, failed }, newEntries };
}

/** Re-checked every cycle, so a tightened rule also removes posts that are already public. */
function retireFilteredPosts(store: LeanStore): CycleReport["xFiltered"] {
  const counts: CycleReport["xFiltered"] = { retweet: 0, promotion: 0, too_short: 0 };
  for (const post of store.activeXPosts()) {
    const reason = tweetSkipReason(post);
    if (reason === null) continue;
    store.retire(post.publicId);
    counts[reason]++;
  }
  return counts;
}

async function refinePending(store: LeanStore): Promise<CycleReport["refined"]> {
  const pending = store.pending(REFINE_BATCH_LIMIT);
  const refined = { ready: 0, skipped: 0, failed: 0 };
  if (pending.length === 0) return refined;
  const model = resolveModel();
  await mapLimit(pending, REFINE_CONCURRENCY, async (item) => {
    try {
      const result = await refineItem(item, model);
      if (result.kind === "irrelevant") {
        store.markSkipped(item.publicId);
        refined.skipped++;
      } else {
        store.markReady(item.publicId, result.titleZh, result.summaryZh, result.keyPointsZh, new Date().toISOString());
        refined.ready++;
      }
    } catch {
      store.markAttemptFailed(item.publicId);
      refined.failed++;
    }
  });
  return refined;
}

/** An inbox fault (for example a full disk) is reported; it must not stop RSS collection or publishing. */
function importInbox(store: LeanStore, root: string, settings: LeanSettings, now: Date): CycleReport["inbox"] {
  const inboxSettings: EditorInboxSettings = { enabled: true, publishMode: "auto", ...settings.editorInbox };
  try {
    return { ...importEditorInbox(store, root, inboxSettings, settings.editorialDomains ?? DEFAULT_EDITORIAL_DOMAINS, now.toISOString()), error: null };
  } catch (error) {
    return { enabled: inboxSettings.enabled, imported: 0, held: 0, rejected: 0, released: 0, error: error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN" };
  }
}

async function localizeMedia(items: readonly StoredItem[], now: Date): Promise<{ media: LocalMedia; report: CycleReport["media"] }> {
  try {
    const { media, report } = await localizeImages(items, leanPath("media"), now);
    return { media, report: { ...report, error: null } };
  } catch (error) {
    return { media: new Map(), report: { cached: 0, downloaded: 0, failed: 0, deferred: 0, error: error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN" } };
  }
}

export async function runCycle(now: Date = new Date()): Promise<CycleReport | null> {
  mkdirSync(leanPath(), { recursive: true, mode: 0o700 });
  const release = acquireLock(leanPath("cycle.lock"));
  if (release === null) return null;
  const store = new LeanStore(leanPath("store.sqlite"));
  try {
    const settings = readJson<LeanSettings>(leanPath("settings.json"), { xHandles: [], publish: false });
    const state = readJson<LeanState>(leanPath("state.json"), { lastPublishedFingerprint: null, lastPublishedAt: null, lastCommit: null });
    const inboxRoot = leanPath("editor-inbox");
    const inbox = importInbox(store, inboxRoot, settings, now);
    const dueSources = leanSources(settings.xHandles).filter((source) => {
      if (source.platform !== "x") return true;
      const last = store.lastAttemptAt(source.sourceId);
      return last === null || now.getTime() - Date.parse(last) >= X_MIN_INTERVAL_MS;
    });
    const collected = await collect(store, dueSources, now);
    const xFiltered = retireFilteredPosts(store);
    const refined = await refinePending(store);
    const backup = backupStoreIfDue(store, now);

    const minTimelineAt = new Date(now.getTime() - SITE_MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();
    const readyItems = store.ready(SITE_MAX_ITEMS, minTimelineAt);
    const heldItems = store.held();
    const localized = await localizeMedia([...heldItems, ...readyItems], now);
    const bundle = buildSiteBundle(readyItems, now.toISOString(), localized.media);
    if (!settings.publish || heldItems.length > 0) {
      stageSite(leanPath("preview"), heldItems.length > 0 ? buildSiteBundle([...heldItems, ...readyItems], now.toISOString(), localized.media) : bundle);
    }
    let site: CycleReport["site"] = { items: bundle.itemCount, published: false, commit: null, reason: "UNCHANGED" };
    if (localized.report.error !== null) {
      // Publishing now would strip every picture from the live site.
      site = { ...site, reason: "MEDIA_FAILED" };
    } else if (!settings.publish) {
      site = { ...site, reason: "PUBLISH_DISABLED" };
    } else if (bundle.contentFingerprint !== state.lastPublishedFingerprint) {
      try {
        const commit = publishBundle(leanPath("pages-checkout"), bundle);
        writeJsonAtomic(leanPath("state.json"), { lastPublishedFingerprint: bundle.contentFingerprint, lastPublishedAt: now.toISOString(), lastCommit: commit });
        site = { items: bundle.itemCount, published: true, commit, reason: "PUBLISHED" };
      } catch (error) {
        site = { ...site, reason: `PUBLISH_FAILED: ${error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN"}` };
      }
    }
    const liveCommit = site.published ? site.commit : site.reason === "UNCHANGED" ? state.lastCommit : null;
    if (liveCommit !== null && inbox.enabled) markInboxPublished(inboxRoot, liveCommit, now.toISOString());
    const report: CycleReport = { startedAt: now.toISOString(), finishedAt: new Date().toISOString(), inbox, ...collected, xFiltered, refined, backup, media: localized.report, site, counts: store.counts() };
    writeJsonAtomic(leanPath("last-cycle.json"), report);
    return report;
  } finally {
    store.close();
    release();
  }
}
