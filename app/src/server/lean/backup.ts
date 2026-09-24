import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { LEAN_BACKUP_DIR, LEAN_OFFSITE_BACKUP_DIR } from "./config.ts";
import type { LeanStore } from "./store.ts";

const KEEP_HOURLY = 48;
const KEEP_DAILY_OFFSITE = 30;

export type BackupDirs = { local: string; offsite: string };
export type BackupReport = { hourly: string | null; offsite: string | null; items: number | null; error: string | null };

function verifiedItemCount(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const check = db.prepare("PRAGMA quick_check").get() as { quick_check: string };
    if (check.quick_check !== "ok") throw new Error(`BACKUP_CORRUPT: ${check.quick_check}`);
    return Number((db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n);
  } finally {
    db.close();
  }
}

function prune(directory: string, prefix: string, keep: number): void {
  const files = readdirSync(directory).filter((name) => name.startsWith(prefix) && name.endsWith(".sqlite")).sort().reverse();
  for (const name of files.slice(keep)) rmSync(join(directory, name), { force: true });
}

function writeOnce(target: string, write: (temp: string) => void): boolean {
  if (existsSync(target)) return false;
  const temp = `${target}.${process.pid}.tmp`;
  rmSync(temp, { force: true });
  try {
    write(temp);
    renameSync(temp, target);
  } finally {
    rmSync(temp, { force: true });
  }
  return true;
}

/**
 * One verified copy per UTC hour on this machine, plus one per day in iCloud Drive.
 * Failures are reported, never thrown: a missed backup must not stop publishing.
 */
export function backupStoreIfDue(store: LeanStore, now: Date, dirs: BackupDirs = { local: LEAN_BACKUP_DIR, offsite: LEAN_OFFSITE_BACKUP_DIR }): BackupReport {
  const report: BackupReport = { hourly: null, offsite: null, items: null, error: null };
  try {
    const hour = now.toISOString().slice(0, 13).replace(/[-T]/g, "");
    mkdirSync(dirs.local, { recursive: true, mode: 0o700 });
    const hourly = join(dirs.local, `store-${hour}.sqlite`);
    if (writeOnce(hourly, (temp) => { store.backupTo(temp); verifiedItemCount(temp); })) report.hourly = hourly;
    report.items = verifiedItemCount(hourly);
    prune(dirs.local, "store-", KEEP_HOURLY);

    if (existsSync(dirname(dirs.offsite))) {
      mkdirSync(dirs.offsite, { recursive: true, mode: 0o700 });
      const daily = join(dirs.offsite, `lean-store-${hour.slice(0, 8)}.sqlite`);
      if (writeOnce(daily, (temp) => copyFileSync(hourly, temp))) report.offsite = daily;
      prune(dirs.offsite, "lean-store-", KEEP_DAILY_OFFSITE);
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN";
  }
  return report;
}
