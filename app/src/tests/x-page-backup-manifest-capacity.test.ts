import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { backupLayout, canonicalJson, parseManifest, runRestoreDrill, runSnapshotOnce, type SnapshotMember } from "../server/backup-snapshot/core.ts";
import { xPageBackupFixture } from "./helpers/x-page-backup.ts";

const FILE_LIMIT = 4 * 1024 * 1024;
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

test("writes and restores a 4 MiB manifest, then rejects a one-byte-larger saved file before publishing package or latest", async () => {
  const fixture = await xPageBackupFixture();
  try {
    const capture = fixture.captures({ text: "Synthetic source for the actual manifest writer capacity boundary." });
    fixture.admit("x_f1", capture.capture);
    fixture.live();
    fixture.importCapture(capture.capture);
    const source = await fixture.snapshot();
    const projectionRoot = join(fixture.root, "capacity-projection");
    const generationsRoot = join(projectionRoot, "generations");
    mkdirSync(generationsRoot, { recursive: true, mode: 0o700 });
    // A generic projection archive isolates serialization and persistence here.
    // Its unused generations do not claim signed application/Public evidence.
    const activeGeneration = JSON.stringify({ fixture: "capacity-active" });
    const activeHash = sha(activeGeneration);
    writeFileSync(join(generationsRoot, activeHash + ".json"), activeGeneration, { mode: 0o600 });
    writeFileSync(join(projectionRoot, "active.json"), JSON.stringify({ schemaVersion: "projection-active-pointer-v1",
      snapshotGeneration: 1, snapshotManifestHash: activeHash, activatedAt: fixture.now().toISOString() }), { mode: 0o600 });
    const outputDir = join(fixture.root, "capacity-encrypted");
    const input = { sourceDbPath: source.path, projectionRoot, outputDir, key: randomBytes(32), retain: 2,
      xPageRuntimeTrust: fixture.runtimeTrust, now: fixture.now };
    const initial = runSnapshotOnce(input);
    const layout = backupLayout(outputDir);
    const manifestPath = (packageId: string): string => join(layout.packagesDir, packageId, "manifest.json");
    const initialRaw = readFileSync(manifestPath(initial.packageId!), "utf8");
    const initialManifest = parseManifest(initialRaw);
    expect(initialManifest.schemaVersion).toBe("backup-snapshot-manifest-v2");

    const extra: { content: string; member: SnapshotMember }[] = [];
    const generation = (index: number, padded = false) => {
      let content = JSON.stringify({ index: index.toString().padStart(5, "0") });
      if (padded) content = content.padEnd(100, " ");
      const digest = sha(content);
      return { content, member: { relativePath: `projection/generations/${digest}.json`, bytes: Buffer.byteLength(content), sha256: digest } };
    };
    const memberCost = Buffer.byteLength(canonicalJson(generation(0).member)) + 1;
    const count = Math.floor((FILE_LIMIT - Buffer.byteLength(initialRaw)) / memberCost);
    for (let index = 0; index < count; index++) extra.push(generation(index));
    const predictedBytes = () => Buffer.byteLength(canonicalJson({ ...initialManifest,
      members: [...initialManifest.members, ...extra.map(value => value.member)] })) + 1;
    const gap = FILE_LIMIT - predictedBytes();
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(extra.length);
    // Increasing actual member content from 17 to 100 bytes adds exactly one
    // decimal digit in its manifest entry; filenames remain real SHA hashes.
    for (let index = 0; index < gap; index++) extra[index] = generation(index, true);
    expect(predictedBytes()).toBe(FILE_LIMIT);
    for (const value of extra) writeFileSync(join(generationsRoot, value.member.sha256 + ".json"), value.content, { mode: 0o600 });

    fixture.advanceNow(1000);
    const accepted = runSnapshotOnce(input);
    const savedRaw = readFileSync(manifestPath(accepted.packageId!));
    expect(savedRaw.byteLength).toBe(FILE_LIMIT);
    expect(savedRaw.at(-1)).toBe(10);
    const savedManifest = parseManifest(savedRaw.toString("utf8"));
    expect(savedManifest.members).toHaveLength(initialManifest.members.length + extra.length);
    const restoreRoot = join(fixture.root, "capacity-restored");
    expect(runRestoreDrill({ backupRoot: outputDir, restoreRoot, key: input.key }).ok).toBe(true);
    expect(readFileSync(join(restoreRoot, "projection/active.json"))).toEqual(readFileSync(join(projectionRoot, "active.json")));
    expect(readdirSync(join(restoreRoot, "projection/generations"))).toHaveLength(extra.length + 1);

    const prior = extra[gap];
    const overflow = generation(gap, true);
    unlinkSync(join(generationsRoot, prior.member.sha256 + ".json"));
    writeFileSync(join(generationsRoot, overflow.member.sha256 + ".json"), overflow.content, { mode: 0o600 });
    extra[gap] = overflow;
    expect(predictedBytes()).toBe(FILE_LIMIT + 1);
    const packagesBefore = readdirSync(layout.packagesDir).sort();
    const objectsBefore = readdirSync(layout.objectsDir).sort();
    const latestBefore = readFileSync(layout.latestPath);
    fixture.advanceNow(1000);
    expect(() => runSnapshotOnce(input)).toThrow("X_BACKUP_MANIFEST_LIMIT_EXCEEDED");
    expect(readdirSync(layout.packagesDir).sort()).toEqual(packagesBefore);
    expect(readdirSync(layout.objectsDir).sort()).toEqual(objectsBefore);
    expect(readFileSync(layout.latestPath)).toEqual(latestBefore);
    expect(readFileSync(manifestPath(accepted.packageId!))).toEqual(savedRaw);
    expect(readdirSync(layout.stagingDir)).toEqual([]);
    expect(existsSync(layout.lockPath)).toBe(false);
  } finally { fixture.close(); }
}, 300_000);
