import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

import { leanPath, leanSources, REFINE_BATCH_LIMIT, SITE_MAX_AGE_DAYS, SITE_MAX_ITEMS, type LeanSource } from "./config.ts";
import { backupStoreIfDue, type BackupReport } from "./backup.ts";
import { fetchFeed } from "./feed.ts";
import { publishBundle, stageSite } from "./pages-publish.ts";
import { refineItem, resolveModel } from "./refine.ts";
import { buildSiteBundle } from "./site-bundle.ts";
import { LeanStore } from "./store.ts";

/** Entries older than this on first sight are history, not news; they are not summarized. */
const MAX_NEW_ENTRY_AGE_MS = 3 * 24 * 3600 * 1000;
const FETCH_CONCURRENCY = 6;
const REFINE_CONCURRENCY = 4;

type LeanState = { lastPublishedFingerprint: string | null; lastPublishedAt: string | null; lastCommit: string | null };
type LeanSettings = { xHandles: string[] | "all"; publish: boolean };

export type CycleReport = {
  startedAt: string;
  finishedAt: string;
  sources: { ok: number; failed: { sourceId: string; error: string }[] };
  newEntries: number;
  refined: { ready: number; skipped: number; failed: number };
  backup: BackupReport;
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

export async function runCycle(now: Date = new Date()): Promise<CycleReport | null> {
  mkdirSync(leanPath(), { recursive: true, mode: 0o700 });
  const release = acquireLock(leanPath("cycle.lock"));
  if (release === null) return null;
  const store = new LeanStore(leanPath("store.sqlite"));
  try {
    const settings = readJson<LeanSettings>(leanPath("settings.json"), { xHandles: [], publish: false });
    const state = readJson<LeanState>(leanPath("state.json"), { lastPublishedFingerprint: null, lastPublishedAt: null, lastCommit: null });
    const collected = await collect(store, leanSources(settings.xHandles), now);
    const refined = await refinePending(store);
    const backup = backupStoreIfDue(store, now);

    const minTimelineAt = new Date(now.getTime() - SITE_MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();
    const bundle = buildSiteBundle(store.ready(SITE_MAX_ITEMS, minTimelineAt), now.toISOString());
    let site: CycleReport["site"] = { items: bundle.itemCount, published: false, commit: null, reason: "UNCHANGED" };
    if (!settings.publish) {
      stageSite(leanPath("preview"), bundle);
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
    const report: CycleReport = { startedAt: now.toISOString(), finishedAt: new Date().toISOString(), ...collected, refined, backup, site, counts: store.counts() };
    writeJsonAtomic(leanPath("last-cycle.json"), report);
    return report;
  } finally {
    store.close();
    release();
  }
}
