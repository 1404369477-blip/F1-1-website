import fs from "node:fs";
import crypto from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backupLayout, runRestoreDrill, runSnapshotOnce, type SnapshotInput } from "../server/backup-snapshot/core.ts";
import { runBackupSnapshotCli } from "../../scripts/backup-snapshot-once.ts";
import { setupBenchmarkBoundary } from "./helpers/backup-benchmark-boundary.ts";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(realpathSync(tmpdir()), "confirmed-backup-cache-")); roots.push(root); const f = setupBenchmarkBoundary(root); f.database.close(); return f; }
function input(f: ReturnType<typeof fixture>): SnapshotInput { return { sourceDbPath: f.databasePath, projectionRoot: f.projectionRoot, outputDir: f.backupRoot, key: f.key, retain: 24, projectionBoundary: "confirmed-delivery-v1" }; }
function cliArgs(f: ReturnType<typeof fixture>): string[] { const keyPath = join(f.root, "synthetic.key"); writeFileSync(keyPath,f.key,{mode:0o600}); return ["--source-db",f.databasePath,"--projection-root",f.projectionRoot,"--output-dir",f.backupRoot,"--key-file",keyPath,"--retain","24"]; }

describe("production confirmed-delivery boundary with authenticated reuse", () => {
  it("restores a confirmed projection and independently decrypts again after snapshot cache completion", () => {
    const f = fixture(), snapshot = runSnapshotOnce(input(f)), calls = vi.spyOn(crypto,"createDecipheriv"); syncBuiltinESMExports();
    const result = runRestoreDrill({ backupRoot:f.backupRoot,restoreRoot:join(f.root,"restored"),key:f.key,packageId:snapshot.packageId,expectedUserVersion:10 });
    expect(result.ok).toBe(true); expect(result.checks?.quick_check).toBe("ok"); expect(result.checks?.drill_public_pointer_verified).toBe("1");
    expect(calls).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(f.root,"restored/projection/active.json"))).toEqual(readFileSync(join(f.projectionRoot,"active.json")));
  });

  it("retains the actual cleanup failure stage while still releasing its own exact lock", () => {
    const f = fixture(), original = fs.rmSync;
    vi.spyOn(fs,"rmSync").mockImplementation((path, options) => {
      if (String(path).includes("/.staging/")) throw Object.assign(new Error("private path must not be logged"),{code:"EACCES"});
      return original(path,options);
    });
    syncBuiltinESMExports();
    const stderr = vi.spyOn(process.stderr,"write").mockImplementation(() => true);
    const result = runBackupSnapshotCli(cliArgs(f), { NODE_ENV: "test" });
    expect(result).toMatchObject({ok:false,code:"SNAPSHOT_CLEANUP_FAILED",stage:"CLEANUP"});
    expect(existsSync(backupLayout(f.backupRoot).lockPath)).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private path");
    expect(stderr.mock.calls.map(c=>String(c[0])).join("")).not.toContain("private path");
  });

  it("keeps a malformed confirmed receipt as a pre-publication failure with its precise work stage", () => {
    const f = fixture(); const generation = join(f.projectionRoot,"generations");
    mkdirSync(join(generation,"extra")); // Unrelated path remains an ordinary generation directory.
    writeFileSync(join(f.projectionRoot,"active.json"),"{}",{mode:0o600});
    vi.spyOn(process.stderr,"write").mockImplementation(() => true);
    const result = runBackupSnapshotCli(cliArgs(f), { NODE_ENV: "test" });
    expect(result.ok).toBe(false); expect(result.stage).toBe("FREEZE_PROJECTION");
    expect(existsSync(backupLayout(f.backupRoot).latestPath)).toBe(false); expect(existsSync(backupLayout(f.backupRoot).lockPath)).toBe(false);
  });
});
