import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { DEFAULT_EDITORIAL_DOMAINS, leanPath, leanSources, REFINE_BATCH_LIMIT, SITE_MAX_AGE_DAYS, SITE_MAX_ITEMS, type LeanSource } from "./config.ts";
import { isDenseWindow, needsWinnerRefresh, type F1Calendar } from "../../features/calendar/race-strip-model.ts";
import { importEditorInbox, markInboxPublished, type EditorInboxSettings, type InboxReport } from "./editor-inbox.ts";
import { backupStoreIfDue, type BackupReport } from "./backup.ts";
import { fetchArticleParagraphs } from "./article.ts";
import { fetchFeed } from "./feed.ts";
import { localizeImages, type LocalMedia, type MediaReport } from "./media.ts";
import { publishBundle, stageSite } from "./pages-publish.ts";
import { refineItem, resolveModel } from "./refine.ts";
import { buildSiteBundle } from "./site-bundle.ts";
import { LeanStore, type StoredItem } from "./store.ts";
import { isNearDuplicateTweet, tweetSkipReason, type TweetSkipReason } from "./x-filter.ts";
import { contentTypeForTeamPost } from "./x-category.ts";

/** Entries older than this on first sight are history, not news; they are not summarized. */
const MAX_NEW_ENTRY_AGE_MS = 3 * 24 * 3600 * 1000;
/** Six parallel X fetches through the local RSSHub exceeded the 20s fetch timeout. */
const FETCH_CONCURRENCY = 3;
/** Outside a race window, each X account is fetched at most twice an hour. */
const X_QUIET_INTERVAL_MS = 30 * 60 * 1000;
const X_PAUSE_MS = 2 * 60 * 60 * 1000;
const CALENDAR_QUIET_MS = 6 * 60 * 60 * 1000;
const REFINE_CONCURRENCY = 4;

type LeanState = { lastPublishedFingerprint: string | null; lastPublishedAt: string | null; lastCommit: string | null };
type LeanSettings = {
  xHandles: string[] | "all";
  publish: boolean;
  editorialDomains?: string[];
  editorInbox?: Partial<EditorInboxSettings>;
  /** Preferred refine model. `glm-5.3-flash` is used when this is absent. */
  LEAN_REFINE_MODEL?: string;
  /** Domain → whether full text may be shown. Missing domains stay allowed. */
  fullTextAllowed?: Record<string, boolean>;
};

export type CycleReport = {
  startedAt: string;
  finishedAt: string;
  inbox: InboxReport & { error: string | null };
  sources: { ok: number; failed: { sourceId: string; error: string }[] };
  newEntries: number;
  /** X posts taken out this cycle (new ones before the model sees them, public ones on the next publish). */
  xFiltered: Record<TweetSkipReason | "reinstated" | "duplicate", number>;
  refined: { ready: number; skipped: number; failed: number; errors: { publicId: string; error: string }[] };
  backup: BackupReport;
  media: MediaReport & { error: string | null };
  site: { items: number; published: boolean; commit: string | null; reason: string };
  warnings: string[];
  calendar: { action: "拉取" | "跳过" | "失败回退"; reason: string | null };
  xFetch: { dense: boolean; skipped: number; paused: string[] };
  counts: Record<string, number>;
};

type XBackoff = Record<string, { consecutiveTimeouts: number; pausedUntil: string | null }>;

function readCalendar(): F1Calendar | null {
  const calendar = readJson<F1Calendar | null>(leanPath("f1-calendar.json"), null);
  return calendar && Array.isArray(calendar.races) ? calendar : null;
}

/** Pulls the season file inside a session window, otherwise at most every six hours. */
function refreshCalendar(now: Date): CycleReport["calendar"] {
  const calendar = readCalendar();
  const meta = readJson<{ fetchedAt?: string }>(leanPath("f1-calendar-meta.json"), {});
  const fetchedAt = meta.fetchedAt ? Date.parse(meta.fetchedAt) : Number.NaN;
  const dense = calendar ? isDenseWindow(calendar, now) || needsWinnerRefresh(calendar, now) : false;
  const fresh = !Number.isNaN(fetchedAt) && now.getTime() - fetchedAt < CALENDAR_QUIET_MS;
  if (calendar && !dense && fresh) return { action: "跳过", reason: null };
  const script = resolve(process.cwd(), "scripts/fetch-f1-calendar.mjs");
  const dataRoot = resolve(process.cwd(), "data");
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    timeout: 20_000,
    env: {
      ...process.env,
      F1_CALENDAR_OUTPUT: leanPath("f1-calendar.json"),
      F1_CALENDAR_META: leanPath("f1-calendar-meta.json"),
      F1_CALENDAR_FALLBACK: resolve(dataRoot, "f1-calendar-2026.json"),
      F1_CALENDAR_OVERRIDES: resolve(dataRoot, "f1-calendar-overrides.json"),
      F1_CALENDAR_NAMES: resolve(dataRoot, "f1-names-zh.json")
    }
  });
  const line = (result.stdout ?? "").trim().split("\n").at(-1) ?? "";
  try {
    const parsed = JSON.parse(line) as { action?: string; reason?: string };
    if (parsed.action === "拉取" || parsed.action === "失败回退") return { action: parsed.action, reason: parsed.reason ?? null };
  } catch { /* the script prints one JSON line when it can */ }
  return { action: "失败回退", reason: (result.stderr || result.error?.message || "CALENDAR_SCRIPT_FAILED").slice(0, 160) };
}

function calendarToken(): string {
  const path = leanPath("f1-calendar.json");
  if (!existsSync(path)) return "none";
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
}

function isTimeout(message: string): boolean {
  return /timeout|aborted|timed out/i.test(message);
}

export function xAccountDecision(options: { now: number; lastAttemptAt: number | null; dense: boolean; pausedUntil: number | null }): "fetch" | "quiet" | "paused" {
  if (options.pausedUntil !== null && options.pausedUntil > options.now) return "paused";
  if (options.dense) return "fetch";
  if (options.lastAttemptAt !== null && options.now - options.lastAttemptAt < X_QUIET_INTERVAL_MS) return "quiet";
  return "fetch";
}

export function xBackoffAfterAttempt(consecutiveTimeouts: number, timedOut: boolean, now: number): { consecutiveTimeouts: number; pausedUntil: string | null; justPaused: boolean } {
  if (!timedOut) return { consecutiveTimeouts: 0, pausedUntil: null, justPaused: false };
  const next = consecutiveTimeouts + 1;
  if (next >= 3) return { consecutiveTimeouts: 0, pausedUntil: new Date(now + X_PAUSE_MS).toISOString(), justPaused: true };
  return { consecutiveTimeouts: next, pausedUntil: null, justPaused: false };
}

/** X accounts follow the race window. Three timeouts in a row pause that account for two hours. */
function xSourcesDue(sources: readonly LeanSource[], now: Date, dense: boolean, lastAttempt: (sourceId: string) => string | null): { due: LeanSource[]; skipped: number; paused: string[] } {
  const backoff = readJson<XBackoff>(leanPath("x-backoff.json"), {});
  const paused: string[] = [];
  let skipped = 0;
  const due = sources.filter((source) => {
    if (source.platform !== "x") return true;
    const state = backoff[source.sourceId];
    const decision = xAccountDecision({
      now: now.getTime(),
      lastAttemptAt: lastAttempt(source.sourceId) === null ? null : Date.parse(lastAttempt(source.sourceId)!),
      dense,
      pausedUntil: state?.pausedUntil ? Date.parse(state.pausedUntil) : null
    });
    if (decision === "paused") {
      paused.push(source.sourceId);
      return false;
    }
    if (decision === "quiet") {
      skipped += 1;
      return false;
    }
    return true;
  });
  return { due, skipped, paused };
}

function rememberXResult(sourceId: string, error: string | null, now: Date): boolean {
  const backoff = readJson<XBackoff>(leanPath("x-backoff.json"), {});
  const current = backoff[sourceId] ?? { consecutiveTimeouts: 0, pausedUntil: null };
  const next = xBackoffAfterAttempt(current.consecutiveTimeouts, error !== null && isTimeout(error), now.getTime());
  backoff[sourceId] = { consecutiveTimeouts: next.consecutiveTimeouts, pausedUntil: next.pausedUntil };
  writeJsonAtomic(leanPath("x-backoff.json"), backoff);
  return next.justPaused;
}

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

async function collect(store: LeanStore, sources: readonly LeanSource[], now: Date): Promise<Pick<CycleReport, "sources" | "newEntries"> & { pausedNow: string[] }> {
  const failed: { sourceId: string; error: string }[] = [];
  const pausedNow: string[] = [];
  let newEntries = 0;
  const cutoff = now.getTime() - MAX_NEW_ENTRY_AGE_MS;
  const outcomes: { sourceId: string; platform: LeanSource["platform"]; error: string | null }[] = [];
  await mapLimit(sources, FETCH_CONCURRENCY, async (source) => {
    try {
      const entries = (await fetchFeed(source)).filter((entry) => entry.sourcePublishedAt === null || Date.parse(entry.sourcePublishedAt) >= cutoff);
      newEntries += store.addEntries(source, entries, now.toISOString());
      store.recordSourceRun(source.sourceId, now.toISOString(), null);
      outcomes.push({ sourceId: source.sourceId, platform: source.platform, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN";
      failed.push({ sourceId: source.sourceId, error: message });
      store.recordSourceRun(source.sourceId, now.toISOString(), message);
      outcomes.push({ sourceId: source.sourceId, platform: source.platform, error: message });
    }
  });
  for (const outcome of outcomes) {
    if (outcome.platform === "x" && rememberXResult(outcome.sourceId, outcome.error, now)) pausedNow.push(outcome.sourceId);
  }
  return { sources: { ok: sources.length - failed.length, failed }, newEntries, pausedNow };
}

/** Re-checked every cycle: a tightened rule removes public posts, a loosened one brings them back. */
function retireFilteredPosts(store: LeanStore): CycleReport["xFiltered"] {
  const counts: CycleReport["xFiltered"] = { retweet: 0, promotion: 0, too_short: 0, reinstated: 0, duplicate: 0 };
  for (const post of store.activeXPosts()) {
    const reason = tweetSkipReason(post);
    if (reason === null) continue;
    store.retire(post.publicId);
    counts[reason]++;
  }
  for (const post of store.retiredXPosts()) {
    if (tweetSkipReason(post) !== null) continue;
    store.reinstate(post.publicId);
    counts.reinstated++;
  }
  const ready = store.activeXPosts().filter((post) => post.status === "ready");
  const groups = new Map<string, typeof ready>();
  for (const post of ready) {
    const list = groups.get(post.sourceId) ?? [];
    list.push(post);
    groups.set(post.sourceId, list);
  }
  for (const list of groups.values()) {
    const ordered = [...list].sort((a, b) => (a.sourcePublishedAt ?? a.firstSeenAt).localeCompare(b.sourcePublishedAt ?? b.firstSeenAt));
    const kept: typeof ordered = [];
    for (const post of ordered) {
      const text = `${post.title}\n${post.text}`;
      const earlier = kept.find((prev) => {
        const gap = Math.abs(Date.parse(post.sourcePublishedAt ?? post.firstSeenAt) - Date.parse(prev.sourcePublishedAt ?? prev.firstSeenAt));
        return Number.isFinite(gap) && gap <= 6 * 3600 * 1000 && isNearDuplicateTweet(text, `${prev.title}\n${prev.text}`);
      });
      if (earlier) {
        store.retire(post.publicId);
        counts.duplicate++;
      } else kept.push(post);
    }
  }
  return counts;
}

/** Moves already stored team posts that are not race reporting into paddock features. */
function retagTeamDaily(store: LeanStore): void {
  for (const post of store.activeXPosts()) {
    const next = contentTypeForTeamPost(post.sourceId, post.contentType, `${post.title}\n${post.titleZh ?? ""}`, `${post.text}\n${post.summaryZh ?? ""}`);
    if (next !== post.contentType) store.setContentType(post.publicId, next);
  }
}

async function refinePending(store: LeanStore, preferredModel?: string): Promise<CycleReport["refined"]> {
  const pending = store.pending(REFINE_BATCH_LIMIT);
  const refined: CycleReport["refined"] = { ready: 0, skipped: 0, failed: 0, errors: [] };
  if (pending.length === 0) return refined;
  let model;
  try {
    model = resolveModel(preferredModel);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN";
    for (const item of pending) refined.errors.push({ publicId: item.publicId, error: message });
    refined.failed = pending.length;
    return refined;
  }
  await mapLimit(pending, REFINE_CONCURRENCY, async (item) => {
    try {
      const paragraphs = item.platform === "x"
        ? (item.text.trim() ? [item.text.trim().slice(0, 4000)] : null)
        : await fetchArticleParagraphs(item.link);
      const result = await refineItem(item, model, fetch, paragraphs);
      if (result.kind === "irrelevant") {
        store.markSkipped(item.publicId);
        refined.skipped++;
      } else {
        const detailEn = item.platform === "x" ? (item.text.trim() ? [item.text.trim()] : null) : paragraphs;
        store.markReady(item.publicId, result.titleZh, result.summaryZh, result.keyPointsZh, new Date().toISOString(), {
          summaryEn: item.platform === "x" ? (item.text.trim() || null) : result.summaryEn,
          keyPointsEn: result.keyPointsEn,
          detailEn,
          detailZh: result.detailZh
        });
        refined.ready++;
      }
    } catch (error) {
      store.markAttemptFailed(item.publicId);
      refined.failed++;
      refined.errors.push({ publicId: item.publicId, error: error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN" });
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

/** A missing `publish` key must not be treated as an intentional off switch. */
export function resolvePublishSetting(raw: object | null): { publish: boolean; warning: string | null } {
  if (raw === null || !("publish" in raw)) return { publish: raw === null ? false : true, warning: raw === null ? null : "PUBLISH_SETTING_MISSING" };
  return { publish: (raw as { publish?: unknown }).publish === true, warning: null };
}

export async function runCycle(now: Date = new Date()): Promise<CycleReport | null> {
  mkdirSync(leanPath(), { recursive: true, mode: 0o700 });
  const release = acquireLock(leanPath("cycle.lock"));
  if (release === null) return null;
  const store = new LeanStore(leanPath("store.sqlite"));
  try {
    const settingsPath = leanPath("settings.json");
    const rawSettings = existsSync(settingsPath) ? readJson<Partial<LeanSettings> & object>(settingsPath, {}) : null;
    const publishSetting = resolvePublishSetting(rawSettings);
    const settings: LeanSettings = {
      xHandles: [],
      ...(rawSettings ?? {}),
      publish: publishSetting.publish
    };
    const warnings = publishSetting.warning ? [publishSetting.warning] : [];
    const state = readJson<LeanState>(leanPath("state.json"), { lastPublishedFingerprint: null, lastPublishedAt: null, lastCommit: null });
    const inboxRoot = leanPath("editor-inbox");
    const inbox = importInbox(store, inboxRoot, settings, now);
    const calendar = refreshCalendar(now);
    const schedule = readCalendar();
    const dense = schedule ? isDenseWindow(schedule, now) : false;
    const xPlan = xSourcesDue(leanSources(settings.xHandles), now, dense, (sourceId) => store.lastAttemptAt(sourceId));
    const collected = await collect(store, xPlan.due, now);
    const { pausedNow, ...collectedReport } = collected;
    const xFiltered = retireFilteredPosts(store);
    retagTeamDaily(store);
    const refined = await refinePending(store, settings.LEAN_REFINE_MODEL);
    const backup = backupStoreIfDue(store, now);

    const minTimelineAt = new Date(now.getTime() - SITE_MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();
    const readyItems = store.ready(SITE_MAX_ITEMS, minTimelineAt);
    const heldItems = store.held();
    const denied = new Set(Object.entries(settings.fullTextAllowed ?? {}).filter(([, allowed]) => allowed === false).map(([domain]) => domain));
    const localized = await localizeMedia([...heldItems, ...readyItems], now);
    const bundle = buildSiteBundle(readyItems, now.toISOString(), localized.media, denied);
    if (!settings.publish || heldItems.length > 0) {
      stageSite(leanPath("preview"), heldItems.length > 0 ? buildSiteBundle([...heldItems, ...readyItems], now.toISOString(), localized.media, denied) : bundle);
    }
    let site: CycleReport["site"] = { items: bundle.itemCount, published: false, commit: null, reason: "UNCHANGED" };
    if (localized.report.error !== null) {
      // Publishing now would strip every picture from the live site.
      site = { ...site, reason: "MEDIA_FAILED" };
    } else if (!settings.publish) {
      site = { ...site, reason: "PUBLISH_DISABLED" };
    } else if (`${bundle.contentFingerprint}:${calendarToken()}` !== state.lastPublishedFingerprint) {
      try {
        const commit = publishBundle(leanPath("pages-checkout"), bundle);
        writeJsonAtomic(leanPath("state.json"), { lastPublishedFingerprint: `${bundle.contentFingerprint}:${calendarToken()}`, lastPublishedAt: now.toISOString(), lastCommit: commit });
        site = { items: bundle.itemCount, published: true, commit, reason: "PUBLISHED" };
      } catch (error) {
        site = { ...site, reason: `PUBLISH_FAILED: ${error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN"}` };
      }
    }
    const liveCommit = site.published ? site.commit : site.reason === "UNCHANGED" ? state.lastCommit : null;
    if (liveCommit !== null && inbox.enabled) markInboxPublished(inboxRoot, liveCommit, now.toISOString());
    const report: CycleReport = { startedAt: now.toISOString(), finishedAt: new Date().toISOString(), inbox, ...collectedReport, xFiltered, refined, backup, media: localized.report, site, calendar, xFetch: { dense, skipped: xPlan.skipped, paused: [...xPlan.paused, ...pausedNow] }, warnings, counts: store.counts() };
    writeJsonAtomic(leanPath("last-cycle.json"), report);
    return report;
  } finally {
    store.close();
    release();
  }
}
