import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { LEAN_BACKUP_DIR, LEAN_OFFSITE_BACKUP_DIR } from "./config.ts";
import type { LeanStore } from "./store.ts";

const KEEP_HOURLY = 48;
const KEEP_DAILY_OFFSITE = 30;

export type BackupDirs = { local: string; offsite: string };
export type BackupVerification = { sha256: string; items: number; bytes: number; snapshotAt: string };
export type BackupReport = {
  hourly: string | null;
  offsite: string | null;
  items: number | null;
  error: string | null;
  localVerified: BackupVerification | null;
  offsiteLocalVerified: BackupVerification | null;
  cloudReadback: "not_checked";
};

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

/** Local readability proves snapshot integrity; only a separate remote readback proves cloud delivery. */
export function verifyBackupFile(path: string): BackupVerification {
  const items = verifiedItemCount(path);
  const stat = statSync(path);
  return { items, bytes: stat.size, snapshotAt: stat.mtime.toISOString(), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
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
  const report: BackupReport = { hourly: null, offsite: null, items: null, error: null, localVerified: null, offsiteLocalVerified: null, cloudReadback: "not_checked" };
  try {
    const hour = now.toISOString().slice(0, 13).replace(/[-T]/g, "");
    mkdirSync(dirs.local, { recursive: true, mode: 0o700 });
    const hourly = join(dirs.local, `store-${hour}.sqlite`);
    if (writeOnce(hourly, (temp) => { store.backupTo(temp); verifiedItemCount(temp); })) report.hourly = hourly;
    report.localVerified = verifyBackupFile(hourly);
    report.items = report.localVerified.items;
    prune(dirs.local, "store-", KEEP_HOURLY);

    if (existsSync(dirname(dirs.offsite))) {
      mkdirSync(dirs.offsite, { recursive: true, mode: 0o700 });
      const daily = join(dirs.offsite, `lean-store-${hour.slice(0, 8)}.sqlite`);
      if (writeOnce(daily, (temp) => {
        copyFileSync(hourly, temp);
        if (verifyBackupFile(temp).sha256 !== report.localVerified!.sha256) throw new Error("BACKUP_COPY_MISMATCH");
      })) report.offsite = daily;
      report.offsiteLocalVerified = verifyBackupFile(daily);
      prune(dirs.offsite, "lean-store-", KEEP_DAILY_OFFSITE);
    } else {
      report.error = "BACKUP_OFFSITE_UNAVAILABLE";
    }
  } catch (error) {
    report.error = error instanceof Error && /^BACKUP_[A-Z_]+$/.test(error.message) ? error.message : "BACKUP_VERIFICATION_FAILED";
  }
  return report;
}
