import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { backupLayout, canonicalJson, packageIdFor, parseManifest, runSnapshotOnce } from "../server/backup-snapshot/core.ts";
import { xPageBackupFixture } from "./helpers/x-page-backup.ts";

afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); });

async function sharedXObjectFixture() {
  const e = await xPageBackupFixture();
  try {
    const capture = e.captures(); e.admit("x_f1", capture.capture); e.live(); e.importCapture(capture.capture);
    const source = await e.snapshot(), projectionRoot = join(e.root, "synthetic-projection"), outputDir = join(e.root, "encrypted");
    mkdirSync(join(projectionRoot, "generations"), { recursive: true, mode: 0o700 });
    // Synthetic projection bytes isolate archive authentication; no live Public or REGISTER claim.
    const hash = "1".repeat(64);
    writeFileSync(join(projectionRoot, "active.json"), JSON.stringify({ snapshotManifestHash: hash }), { mode: 0o600 });
    writeFileSync(join(projectionRoot, "generations", hash + ".json"), "{}", { mode: 0o600 });
    const input = { sourceDbPath: source.path, projectionRoot, outputDir, key: crypto.randomBytes(32), retain: 24,
      xPageRuntimeTrust: e.runtimeTrust, now: e.now };
    const first = runSnapshotOnce(input), layout = backupLayout(outputDir);
    const manifest = parseManifest(readFileSync(join(layout.packagesDir, first.packageId!, "manifest.json"), "utf8"));
    expect(manifest.schemaVersion).toBe("backup-snapshot-manifest-v2");
    for (let n = 1; n <= 2; n++) {
      const copy = { ...manifest, recovery_point_at: new Date(Date.parse(manifest.recovery_point_at) + n * 1000).toISOString() };
      const path = join(layout.packagesDir, packageIdFor(copy.recovery_point_at, copy.contentHash));
      mkdirSync(path, { mode: 0o700 }); writeFileSync(join(path, "manifest.json"), canonicalJson(copy), { mode: 0o600 });
    }
    e.advanceNow(3000);
    return { e, input, layout, object: join(layout.objectsDir, readdirSync(layout.objectsDir)[0]) };
  } catch (error) { e.close(); throw error; }
}

test("X aliases still authenticate every complete archive on both passes and never use the v1 cache", async () => {
  const f = await sharedXObjectFixture();
  try {
    const calls = vi.spyOn(crypto, "createDecipheriv"); syncBuiltinESMExports();
    const report = runSnapshotOnce(f.input);
    // Three retained aliases, one new object, then four retention packages.
    expect(calls).toHaveBeenCalledTimes(8);
    expect(report.verification).toMatchObject({ objectsAuthenticated: 8, cacheHits: 0 });
    expect(readdirSync(f.layout.packagesDir)).toHaveLength(4);
    expect(existsSync(f.layout.lockPath)).toBe(false);
  } finally { f.e.close(); }
});

test("X ciphertext damaged after the first pass is reauthenticated and blocks retention deletion", async () => {
  const f = await sharedXObjectFixture(), prior = readdirSync(f.layout.packagesDir);
  try {
    expect(() => runSnapshotOnce({ ...f.input, retain: 1, testOnlyAfterDatabaseSnapshot: () => {
      const bytes = readFileSync(f.object); bytes[bytes.length - 1] ^= 1; writeFileSync(f.object, bytes);
    } })).toThrow("DECRYPT_FAILED");
    for (const packageId of prior) expect(existsSync(join(f.layout.packagesDir, packageId))).toBe(true);
    expect(existsSync(f.layout.lockPath)).toBe(false);
  } finally { f.e.close(); }
});
