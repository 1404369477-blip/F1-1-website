import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { DEFAULT_EDITORIAL_DOMAINS, leanPath, leanSources, MEDIA_DOWNLOAD_MAX_AGE_DAYS, REFINE_BATCH_LIMIT, SITE_MAX_AGE_DAYS, SITE_MAX_ITEMS, type LeanSource } from "./config.ts";
import { isDenseWindow, needsWinnerRefresh, type F1Calendar } from "../../features/calendar/race-strip-model.ts";
import { importEditorInbox, markInboxPublished, refreshEditorTweets, type EditorInboxSettings, type InboxReport } from "./editor-inbox.ts";
import { gcPagesCheckout } from "./cleanup.ts";
import { backupStoreIfDue, type BackupReport } from "./backup.ts";
import { fetchArticleParagraphs } from "./article.ts";
import { fetchFeed } from "./feed.ts";
import { localizeImages, type LocalMedia, type MediaReport } from "./media.ts";
import { publicationArtifacts, publishBundle, prunePublicationRefs, retryPublishedBundle, siteShellFingerprint, stageSite } from "./pages-publish.ts";
import { classifyModelError, refineWithFallback, resolveModels } from "./refine.ts";
import { advancePublication, confirmPublication, publicationState, type PublicationArtifacts } from "./publication.ts";
import { buildSiteBundle } from "./site-bundle.ts";
import { LeanStore, type StoredItem } from "./store.ts";
import { isNearDuplicateTweet, tweetSkipReason, type TweetSkipReason } from "./x-filter.ts";
import { contentTypeForTeamPost } from "./x-category.ts";

/** Entries older than this on first sight are history, not news; they are not summarized. */
const MAX_NEW_ENTRY_AGE_MS = 3 * 24 * 3600 * 1000;
/** Parallel feed fetches: keep normal low; dense may go up to 3. */
const FETCH_CONCURRENCY_NORMAL = 2;
const FETCH_CONCURRENCY_DENSE = 3;
/** 常更层: tightened from 30m; outside dense, fetch at most every 20 minutes. */
const X_QUIET_FREQUENT_MS = 20 * 60 * 1000;
/** 稀更层: long quiet even inside a race window (dense must not max these out). */
const X_QUIET_SPARSE_MS = 3 * 60 * 60 * 1000;
const X_PAUSE_MS = 2 * 60 * 60 * 1000;
/** Soft per-cycle cap on X accounts actually fetched (frequent preferred). */
const X_FETCH_BUDGET_NORMAL = 12;
const X_FETCH_BUDGET_DENSE = 20;
const CALENDAR_QUIET_MS = 6 * 60 * 60 * 1000;
const REFINE_CONCURRENCY = 4;

type LeanSettings = {
  xHandles: string[] | "all";
  publish: boolean;
  editorialDomains?: string[];
  editorInbox?: Partial<EditorInboxSettings>;
  /** Preferred refine model. `glm-4-flash` is used when this is absent. */
  LEAN_REFINE_MODEL?: string;
  /** Domain → whether full text may be shown. Missing domains stay allowed. */
  fullTextAllowed?: Record<string, boolean>;
  /** Optional overrides for X fetch cadence / concurrency. */
  xFetch?: {
    frequentQuietMinutes?: number;
    sparseQuietMinutes?: number;
    concurrencyNormal?: number;
    concurrencyDense?: number;
    maxXPerCycleNormal?: number;
    maxXPerCycleDense?: number;
  };
  /** Only download missing pictures for items newer than this many days; cached files still serve older stories. */
  mediaDownloadMaxAgeDays?: number;
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

/** Timeouts plus hard feed denials from RSSHub / upstream. */
export function countsTowardXBackoff(message: string): boolean {
  return isTimeout(message) || message === "FEED_HTTP_503" || message === "FEED_HTTP_403";
}

function quietIntervalFor(tier: "frequent" | "sparse", settings?: LeanSettings["xFetch"]): number {
  if (tier === "sparse") {
    const minutes = settings?.sparseQuietMinutes;
    return typeof minutes === "number" && minutes > 0 ? minutes * 60 * 1000 : X_QUIET_SPARSE_MS;
  }
  const minutes = settings?.frequentQuietMinutes;
  return typeof minutes === "number" && minutes > 0 ? minutes * 60 * 1000 : X_QUIET_FREQUENT_MS;
}

export function xAccountDecision(options: {
  now: number;
  lastAttemptAt: number | null;
  dense: boolean;
  pausedUntil: number | null;
  fetchTier?: "frequent" | "sparse";
  quietIntervalMs?: number;
}): "fetch" | "quiet" | "paused" {
  if (options.pausedUntil !== null && options.pausedUntil > options.now) return "paused";
  const tier = options.fetchTier ?? "frequent";
  // Dense may intensify 常更层; 稀更层 always keeps its quiet interval.
  if (options.dense && tier !== "sparse") return "fetch";
  const quietMs = options.quietIntervalMs ?? (tier === "sparse" ? X_QUIET_SPARSE_MS : X_QUIET_FREQUENT_MS);
  if (options.lastAttemptAt !== null && options.now - options.lastAttemptAt < quietMs) return "quiet";
  return "fetch";
}

/** `consecutiveTimeouts` in x-backoff.json counts consecutive backoff-worthy failures (timeout / 503 / 403). */
export function xBackoffAfterAttempt(consecutiveTimeouts: number, failed: boolean, now: number): { consecutiveTimeouts: number; pausedUntil: string | null; justPaused: boolean } {
  if (!failed) return { consecutiveTimeouts: 0, pausedUntil: null, justPaused: false };
  const next = consecutiveTimeouts + 1;
  if (next >= 3) return { consecutiveTimeouts: 0, pausedUntil: new Date(now + X_PAUSE_MS).toISOString(), justPaused: true };
  return { consecutiveTimeouts: next, pausedUntil: null, justPaused: false };
}

function fetchConcurrency(dense: boolean, settings?: LeanSettings["xFetch"]): number {
  const raw = dense ? settings?.concurrencyDense : settings?.concurrencyNormal;
  const fallback = dense ? FETCH_CONCURRENCY_DENSE : FETCH_CONCURRENCY_NORMAL;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(dense ? FETCH_CONCURRENCY_DENSE : FETCH_CONCURRENCY_NORMAL, Math.floor(raw)));
}

function xFetchBudget(dense: boolean, settings?: LeanSettings["xFetch"]): number {
  const raw = dense ? settings?.maxXPerCycleDense : settings?.maxXPerCycleNormal;
  const fallback = dense ? X_FETCH_BUDGET_DENSE : X_FETCH_BUDGET_NORMAL;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.floor(raw));
}

/** Prefer 常更层, then accounts idle longest, then apply the per-cycle X budget. */
function applyXFetchBudget(due: LeanSource[], budget: number, lastAttempt: (sourceId: string) => string | null): { due: LeanSource[]; budgetSkipped: number } {
  const rss = due.filter((source) => source.platform !== "x");
  const x = due.filter((source) => source.platform === "x");
  if (x.length <= budget) return { due, budgetSkipped: 0 };
  const ranked = [...x].sort((a, b) => {
    const tierA = a.fetchTier === "sparse" ? 1 : 0;
    const tierB = b.fetchTier === "sparse" ? 1 : 0;
    if (tierA !== tierB) return tierA - tierB;
    const atA = lastAttempt(a.sourceId);
    const atB = lastAttempt(b.sourceId);
    const tA = atA === null ? 0 : Date.parse(atA);
    const tB = atB === null ? 0 : Date.parse(atB);
    return (Number.isFinite(tA) ? tA : 0) - (Number.isFinite(tB) ? tB : 0);
  });
  return { due: [...rss, ...ranked.slice(0, budget)], budgetSkipped: ranked.length - budget };
}

/** X accounts follow tier quiet rules. Three backoff-worthy failures in a row pause that account for two hours. */
function xSourcesDue(
  sources: readonly LeanSource[],
  now: Date,
  dense: boolean,
  lastAttempt: (sourceId: string) => string | null,
  xFetch?: LeanSettings["xFetch"]
): { due: LeanSource[]; skipped: number; paused: string[] } {
  const backoff = readJson<XBackoff>(leanPath("x-backoff.json"), {});
  const paused: string[] = [];
  let skipped = 0;
  const candidates = sources.filter((source) => {
    if (source.platform !== "x") return true;
    const state = backoff[source.sourceId];
    const tier = source.fetchTier === "sparse" ? "sparse" : "frequent";
    const decision = xAccountDecision({
      now: now.getTime(),
      lastAttemptAt: lastAttempt(source.sourceId) === null ? null : Date.parse(lastAttempt(source.sourceId)!),
      dense,
      pausedUntil: state?.pausedUntil ? Date.parse(state.pausedUntil) : null,
      fetchTier: tier,
      quietIntervalMs: quietIntervalFor(tier, xFetch)
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
  const budgeted = applyXFetchBudget(candidates, xFetchBudget(dense, xFetch), lastAttempt);
  return { due: budgeted.due, skipped: skipped + budgeted.budgetSkipped, paused };
}

function rememberXResult(sourceId: string, error: string | null, now: Date): boolean {
  const backoff = readJson<XBackoff>(leanPath("x-backoff.json"), {});
  const current = backoff[sourceId] ?? { consecutiveTimeouts: 0, pausedUntil: null };
  const next = xBackoffAfterAttempt(current.consecutiveTimeouts, error !== null && countsTowardXBackoff(error), now.getTime());
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

async function collect(store: LeanStore, sources: readonly LeanSource[], now: Date, concurrency: number): Promise<Pick<CycleReport, "sources" | "newEntries"> & { pausedNow: string[] }> {
  const failed: { sourceId: string; error: string }[] = [];
  const pausedNow: string[] = [];
  let newEntries = 0;
  const cutoff = now.getTime() - MAX_NEW_ENTRY_AGE_MS;
  const outcomes: { sourceId: string; platform: LeanSource["platform"]; error: string | null }[] = [];
  await mapLimit(sources, concurrency, async (source) => {
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

async function refinePending(store: LeanStore, preferredModel?: string, now: Date = new Date()): Promise<CycleReport["refined"]> {
  const pending = store.pending(REFINE_BATCH_LIMIT, now);
  const refined: CycleReport["refined"] = { ready: 0, skipped: 0, failed: 0, errors: [] };
  if (pending.length === 0) return refined;
  let models;
  try {
    models = resolveModels(preferredModel);
  } catch (error) {
    const message = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : "MODEL_CONFIGURATION_UNAVAILABLE";
    for (const item of pending) {
      // Missing configuration is recoverable after an operator fixes it; retain the queue with backoff.
      store.deferForConfiguration(item.publicId, new Date());
      refined.errors.push({ publicId: item.publicId, error: message });
    }
    refined.failed = pending.length;
    return refined;
  }
  await mapLimit(pending, REFINE_CONCURRENCY, async (item) => {
    try {
      const paragraphs = item.platform === "x"
        ? (item.text.trim() ? [item.text.trim().slice(0, 4000)] : null)
        : await fetchArticleParagraphs(item.link);
      const result = await refineWithFallback(item, models, fetch, paragraphs);
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
      const message = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : "REFINE_FAILED";
      store.markAttemptFailed(item.publicId, { kind: classifyModelError(error), code: message, now: new Date() });
      refined.failed++;
      refined.errors.push({ publicId: item.publicId, error: message });
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

function publishedMediaKeys(): string[] {
  const directory = leanPath("pages-checkout/site/media");
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith(".webp")).map((name) => name.slice(0, -".webp".length));
}

function mediaDownloadMaxAgeDays(settings: LeanSettings): number {
  const raw = settings.mediaDownloadMaxAgeDays;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : MEDIA_DOWNLOAD_MAX_AGE_DAYS;
}

async function localizeMedia(items: readonly StoredItem[], now: Date, maxAgeDays: number): Promise<{ media: LocalMedia; report: CycleReport["media"] }> {
  try {
    const downloadSince = now.getTime() - maxAgeDays * 24 * 3600 * 1000;
    const { media, report } = await localizeImages(items, leanPath("media"), now, { retainKeys: publishedMediaKeys(), downloadSince });
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
    const state = publicationState(readJson<unknown>(leanPath("state.json"), null));
    const inboxRoot = leanPath("editor-inbox");
    const inbox = importInbox(store, inboxRoot, settings, now);
    try {
      await refreshEditorTweets(store);
    } catch {
      warnings.push("EDITOR_TWEETS_FAILED");
    }
    const calendar = refreshCalendar(now);
    const schedule = readCalendar();
    const dense = schedule ? isDenseWindow(schedule, now) : false;
    const xPlan = xSourcesDue(leanSources(settings.xHandles), now, dense, (sourceId) => store.lastAttemptAt(sourceId), settings.xFetch);
    const collected = await collect(store, xPlan.due, now, fetchConcurrency(dense, settings.xFetch));
    const { pausedNow, ...collectedReport } = collected;
    const xFiltered = retireFilteredPosts(store);
    retagTeamDaily(store);
    const refined = await refinePending(store, settings.LEAN_REFINE_MODEL, new Date());
    const backup = backupStoreIfDue(store, now);

    const minTimelineAt = new Date(now.getTime() - SITE_MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();
    const readyItems = store.ready(SITE_MAX_ITEMS, minTimelineAt);
    const archivedItems = store.archivedOutside(readyItems);
    const heldItems = store.held();
    const denied = new Set(Object.entries(settings.fullTextAllowed ?? {}).filter(([, allowed]) => allowed === false).map(([domain]) => domain));
    const localized = await localizeMedia([...heldItems, ...readyItems, ...archivedItems], now, mediaDownloadMaxAgeDays(settings));
    const bundle = buildSiteBundle(readyItems, now.toISOString(), localized.media, denied, archivedItems);
    if (!settings.publish || heldItems.length > 0) {
      try {
        stageSite(leanPath("preview"), heldItems.length > 0 ? buildSiteBundle([...heldItems, ...readyItems], now.toISOString(), localized.media, denied, archivedItems, { preview: true }) : bundle);
      } catch {
        warnings.push("PREVIEW_STAGE_FAILED");
      }
    }
    let shellFingerprint: string | null = null;
    let artifacts: PublicationArtifacts | undefined;
    try {
      artifacts = publicationArtifacts(bundle);
      shellFingerprint = siteShellFingerprint();
    } catch { warnings.push("SITE_ASSETS_UNAVAILABLE"); }
    const fingerprint = `${bundle.contentFingerprint}:${calendarToken()}:${shellFingerprint ?? "unavailable"}`;
    const previouslyConfirmed = state.confirmed?.bundleId;
    const site = await advancePublication(state, {
      bundle, fingerprint, artifacts, publicIds: [...readyItems, ...archivedItems].map((item) => item.publicId), now: new Date(),
      allowPush: settings.publish && localized.report.error === null && shellFingerprint !== null
    }, {
      clock: () => new Date(),
      save: (next) => writeJsonAtomic(leanPath("state.json"), next),
      confirm: (target) => confirmPublication(target),
      push: (beforePush) => publishBundle(leanPath("pages-checkout"), bundle, beforePush),
      retry: (pending, beforePush) => retryPublishedBundle(leanPath("pages-checkout"), pending.target.bundleId, pending.pushAttempts, pending.commit!, beforePush)
    });
    if (localized.report.error !== null) warnings.push("MEDIA_FAILED");
    if (state.pending?.lastError) warnings.push(state.pending.lastError);
    try {
      prunePublicationRefs(leanPath("pages-checkout"), [state.pending?.commit, state.confirmed?.commit].filter((commit): commit is string => Boolean(commit)));
    } catch { warnings.push("PUBLICATION_REF_CLEANUP_FAILED"); }
    if (!state.pending && state.confirmed && state.confirmed.bundleId !== previouslyConfirmed && !gcPagesCheckout(leanPath("pages-checkout"))) warnings.push("GIT_GC_FAILED");
    // A previous generation can be confirmed while newer submissions already exist. Only its saved IDs are eligible.
    if (state.confirmed && inbox.enabled) markInboxPublished(inboxRoot, state.confirmed.commit, now.toISOString(), state.confirmed.publicIds);
    const report: CycleReport = { startedAt: now.toISOString(), finishedAt: new Date().toISOString(), inbox, ...collectedReport, xFiltered, refined, backup, media: localized.report, site, calendar, xFetch: { dense, skipped: xPlan.skipped, paused: [...xPlan.paused, ...pausedNow] }, warnings, counts: store.counts() };
    writeJsonAtomic(leanPath("last-cycle.json"), report);
    return report;
  } finally {
    store.close();
    release();
  }
}
