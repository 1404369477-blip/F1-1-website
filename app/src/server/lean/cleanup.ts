import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { isRaceWindow, type F1Calendar } from "../../features/calendar/race-strip-model.ts";
import { leanPath } from "./config.ts";
import { mediaKey } from "./media.ts";
import type { LeanStore, StoredItem } from "./store.ts";

export const MEDIA_UNREFERENCED_TTL_MS = 7 * 24 * 3600 * 1000;
export const PREVIEW_TTL_MS = 3 * 24 * 3600 * 1000;
export const SOURCE_RUN_TTL_MS = 30 * 24 * 3600 * 1000;

export type CleanupSkip = "LOCK_HELD" | "RACE_WINDOW" | "PUBLISH_FAILED";

export type CleanupReport = {
  at: string;
  dryRun: boolean;
  skipped: CleanupSkip | null;
  mediaFiles: number;
  mediaBytes: number;
  previewFiles: number;
  previewBytes: number;
  sourceRuns: number;
  vacuum: boolean;
  gitGc: boolean;
};

export function cleanupSkip(input: { lockHeld: boolean; raceWindow: boolean; publishFailed: boolean }): CleanupSkip | null {
  if (input.lockHeld) return "LOCK_HELD";
  if (input.raceWindow) return "RACE_WINDOW";
  if (input.publishFailed) return "PUBLISH_FAILED";
  return null;
}

export type AgedFile = { name: string; path: string; bytes: number; mtimeMs: number };

/** Files older than `ttlMs` whose names are not in `referenced`. */
export function expiredUnreferenced(files: readonly AgedFile[], referenced: ReadonlySet<string>, nowMs: number, ttlMs: number): AgedFile[] {
  return files.filter((file) => !referenced.has(file.name) && nowMs - file.mtimeMs > ttlMs);
}

export function formatCleanupLog(report: CleanupReport): string {
  if (report.skipped) return `${report.at} skipped ${report.skipped}\n`;
  return [
    `${report.at} ${report.dryRun ? "dry-run" : "apply"}`,
    `media ${report.mediaFiles} files ${report.mediaBytes} bytes`,
    `preview ${report.previewFiles} files ${report.previewBytes} bytes`,
    `source_runs ${report.sourceRuns}`,
    `vacuum ${report.vacuum ? "done" : "skipped"}`,
    `git_gc ${report.gitGc ? "done" : "skipped"}`,
    ""
  ].join("\n");
}

export function referencedMediaNames(items: readonly StoredItem[], generationText: readonly string[], publishedNames: readonly string[]): Set<string> {
  const names = new Set<string>(publishedNames);
  for (const item of items) {
    for (const image of item.images.length > 0 ? item.images : (item.image ? [item.image] : [])) {
      names.add(`${mediaKey(image.url)}.webp`);
    }
  }
  for (const text of generationText) {
    for (const match of text.matchAll(/media\/([0-9a-f]{32})\.webp/g)) {
      if (match[1]) names.add(`${match[1]}.webp`);
    }
  }
  return names;
}

export function readCleanupSettings(raw: object | null): { dryRun: boolean } {
  const cleanup = raw && "cleanup" in raw ? (raw as { cleanup?: { dryRun?: unknown } }).cleanup : undefined;
  return { dryRun: cleanup?.dryRun !== false };
}

export function publishFailed(report: { site?: { reason?: string } } | null): boolean {
  return (report?.site?.reason ?? "").startsWith("PUBLISH_FAILED");
}

export function listAgedFiles(directory: string): AgedFile[] {
  if (!existsSync(directory)) return [];
  const found: AgedFile[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else found.push({ name, path, bytes: stat.size, mtimeMs: stat.mtimeMs });
    }
  };
  walk(directory);
  return found;
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** `git gc --prune=now` in the pages checkout. A missing checkout is a no-op. */
export function gcPagesCheckout(checkout: string): boolean {
  if (!existsSync(join(checkout, ".git"))) return false;
  const result = spawnSync("git", ["gc", "--prune=now"], { cwd: checkout, encoding: "utf8", timeout: 600_000 });
  return result.status === 0;
}

export function runCleanup(options: {
  now?: Date;
  dryRun?: boolean;
  lockHeld?: boolean;
  raceWindow?: boolean;
  publishFailed?: boolean;
  dataRoot?: string;
  pagesCheckout?: string;
  store?: LeanStore | null;
  removeFile?: (path: string) => void;
}): CleanupReport {
  const now = options.now ?? new Date();
  const dataRoot = options.dataRoot ?? leanPath();
  const pagesCheckout = options.pagesCheckout ?? leanPath("pages-checkout");
  const settings = readCleanupSettings(readJson<object | null>(join(dataRoot, "settings.json"), null));
  const dryRun = options.dryRun ?? settings.dryRun;
  const calendar = readJson<F1Calendar | null>(join(dataRoot, "f1-calendar.json"), null);
  const raceWindow = options.raceWindow ?? (calendar ? isRaceWindow(calendar, now) : false);
  const failed = options.publishFailed ?? publishFailed(readJson<{ site?: { reason?: string } } | null>(join(dataRoot, "last-cycle.json"), null));
  const skipped = cleanupSkip({ lockHeld: options.lockHeld === true, raceWindow, publishFailed: failed });
  const empty: CleanupReport = {
    at: now.toISOString(), dryRun, skipped, mediaFiles: 0, mediaBytes: 0, previewFiles: 0, previewBytes: 0, sourceRuns: 0, vacuum: false, gitGc: false
  };
  if (skipped) return empty;

  const published = existsSync(join(pagesCheckout, "site", "media")) ? readdirSync(join(pagesCheckout, "site", "media")) : [];
  const items = options.store ? options.store.ready(100_000, "1970-01-01T00:00:00.000Z") : [];
  const referenced = referencedMediaNames(items, [], published);
  const generations = join(pagesCheckout, "site", "_public", "generations");
  if (existsSync(generations)) {
    const walk = (current: string): void => {
      for (const name of readdirSync(current)) {
        const path = join(current, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith(".json")) {
          for (const match of readFileSync(path, "utf8").matchAll(/media\/([0-9a-f]{32})\.webp/g)) {
            if (match[1]) referenced.add(`${match[1]}.webp`);
          }
        }
      }
    };
    walk(generations);
  }
  const mediaPlan = expiredUnreferenced(listAgedFiles(join(dataRoot, "media")).filter((file) => file.name.endsWith(".webp")), referenced, now.getTime(), MEDIA_UNREFERENCED_TTL_MS);
  const previewPlan = expiredUnreferenced(listAgedFiles(join(dataRoot, "preview")), new Set(), now.getTime(), PREVIEW_TTL_MS);
  const remove = options.removeFile ?? ((path: string) => { unlinkSync(path); });
  if (!dryRun) {
    for (const file of [...mediaPlan, ...previewPlan]) remove(file.path);
  }
  let sourceRuns = 0;
  if (options.store) {
    const before = new Date(now.getTime() - SOURCE_RUN_TTL_MS).toISOString();
    sourceRuns = options.store.countSourceRunsBefore(before);
    if (!dryRun) options.store.deleteSourceRunsBefore(before);
  }
  const sunday = now.getDay() === 0;
  let vacuum = false;
  if (sunday && !dryRun && options.store) {
    options.store.vacuumInto(join(dataRoot, `store-vacuum-${now.toISOString().slice(0, 10)}.sqlite`));
    vacuum = true;
  }
  const gitGc = !dryRun && gcPagesCheckout(pagesCheckout);
  return {
    at: now.toISOString(),
    dryRun,
    skipped: null,
    mediaFiles: mediaPlan.length,
    mediaBytes: mediaPlan.reduce((sum, file) => sum + file.bytes, 0),
    previewFiles: previewPlan.length,
    previewBytes: previewPlan.reduce((sum, file) => sum + file.bytes, 0),
    sourceRuns,
    vacuum,
    gitGc
  };
}
