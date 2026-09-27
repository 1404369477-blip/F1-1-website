import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

import { leanPath } from "../src/server/lean/config.ts";
import { formatCleanupLog, runCleanup, type CleanupReport } from "../src/server/lean/cleanup.ts";
import { LeanStore } from "../src/server/lean/store.ts";

/** Same lock file as the publishing cycle. A live holder means this run is skipped. */
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

function writeReport(report: CleanupReport): void {
  mkdirSync(leanPath(), { recursive: true, mode: 0o700 });
  appendFileSync(leanPath("cleanup.log"), formatCleanupLog(report));
}

const skipped: CleanupReport = {
  at: new Date().toISOString(),
  dryRun: true,
  skipped: "LOCK_HELD",
  mediaFiles: 0,
  mediaBytes: 0,
  previewFiles: 0,
  previewBytes: 0,
  sourceRuns: 0,
  vacuum: false,
  gitGc: false
};

const release = acquireLock(leanPath("cycle.lock"));
if (release === null) {
  writeReport(skipped);
  process.exit(0);
}

const store = new LeanStore(leanPath("store.sqlite"));
try {
  writeReport(runCleanup({ store }));
} finally {
  store.close();
  release();
}
