import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { backupStoreIfDue, verifyBackupFile } from "../server/lean/backup";
import { LeanStore } from "../server/lean/store";

let directory: string;
let store: LeanStore;
afterEach(() => { store?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  directory = mkdtempSync(join(tmpdir(), "lean-backup-verification-"));
  store = new LeanStore(join(directory, "live.sqlite"));
  return { local: join(directory, "local"), offsite: join(directory, "cloud", "copies") };
}

describe("lean backup health", () => {
  it("reports a missing cloud root while keeping a verified local recovery point", () => {
    const dirs = fixture();
    const report = backupStoreIfDue(store, new Date("2026-09-28T01:00Z"), dirs);
    expect(report.error).toBe("BACKUP_OFFSITE_UNAVAILABLE");
    expect(report.localVerified?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.cloudReadback).toBe("not_checked");
  });

  it("verifies both new copies and detects a corrupted existing daily copy", () => {
    const dirs = fixture();
    mkdirSync(join(directory, "cloud"));
    const report = backupStoreIfDue(store, new Date("2026-09-28T01:00Z"), dirs);
    expect(report.error).toBeNull();
    expect(report.offsiteLocalVerified?.sha256).toBe(report.localVerified?.sha256);
    expect(verifyBackupFile(report.hourly!).items).toBe(0);
    writeFileSync(report.offsite!, "corrupted");
    const next = backupStoreIfDue(store, new Date("2026-09-28T02:00Z"), dirs);
    expect(next.localVerified).not.toBeNull();
    expect(next.offsiteLocalVerified).toBeNull();
    expect(next.error).toBe("BACKUP_VERIFICATION_FAILED");
  });
});
