import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  BackupError,
  backupLayout,
  collectRetentionSet,
  loadKeyFile,
  runRestoreDrill,
  runSnapshotOnce
} from "../server/backup-snapshot/core.ts";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  roots.push(root);
  return root;
}

function writeKey(dir: string): { path: string; key: Buffer } {
  const path = join(dir, "key");
  const key = randomBytes(32);
  writeFileSync(path, key);
  chmodSync(path, 0o600);
  return { path, key };
}

function writeFixtureDb(path: string, note = "alpha"): void {
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode=WAL");
  database.exec("CREATE TABLE parent(id INTEGER PRIMARY KEY, note TEXT NOT NULL)");
  database.exec(
    "CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id), note TEXT NOT NULL)"
  );
  database.exec("CREATE INDEX child_parent_idx ON child(parent_id)");
  database.exec("CREATE TRIGGER child_tr AFTER INSERT ON child BEGIN SELECT 1; END");
  database.prepare("INSERT INTO parent(id, note) VALUES (1, ?)").run(note);
  database.exec("INSERT INTO child(id, parent_id, note) VALUES (1, 1, 'beta')");
  database.exec("PRAGMA user_version=10");
  database.close();
}

function changeSourceNote(path: string, note: string): void {
  const database = new DatabaseSync(path);
  database.prepare("UPDATE parent SET note = ? WHERE id = 1").run(note);
  database.close();
}

function writeFixtureProjection(root: string, label: string): void {
  const generations = join(root, "generations");
  mkdirSync(generations, { recursive: true, mode: 0o700 });
  const first = Buffer.from(JSON.stringify({ fixture: label, n: 1 }), "utf8");
  const second = Buffer.from(JSON.stringify({ fixture: label, n: 2 }), "utf8");
  const firstHash = createHash("sha256").update(first).digest("hex");
  const secondHash = createHash("sha256").update(second).digest("hex");
  writeFileSync(join(generations, `${firstHash}.json`), first);
  writeFileSync(join(generations, `${secondHash}.json`), second);
  writeFileSync(
    join(root, "active.json"),
    `${JSON.stringify({
      schemaVersion: "projection-active-pointer-v1",
      snapshotGeneration: 1,
      snapshotManifestHash: firstHash,
      activatedAt: "2026-08-30T00:00:00.000Z"
    })}\n`
  );
}

function fixtureWorkspace(prefix: string): {
  root: string;
  sourceDbPath: string;
  projectionRoot: string;
  outputDir: string;
  key: Buffer;
  keyPath: string;
} {
  const root = scratch(prefix);
  const sourceDbPath = join(root, "source.sqlite");
  const projectionRoot = join(root, "projection");
  const outputDir = join(root, "backup");
  mkdirSync(projectionRoot, { mode: 0o700 });
  mkdirSync(outputDir, { mode: 0o700 });
  writeFixtureDb(sourceDbPath);
  writeFixtureProjection(projectionRoot, "g1");
  const key = writeKey(root);
  return { root, sourceDbPath, projectionRoot, outputDir, key: key.key, keyPath: key.path };
}

function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  if (child.pid === undefined) throw new Error("DEAD_PID_UNAVAILABLE");
  return child.pid;
}

describe("backup snapshot rotation", () => {
  it("completes one round and restores the full package", () => {
    const workspace = fixtureWorkspace("f1plus1-backup-ok-");
    const first = runSnapshotOnce({
      sourceDbPath: workspace.sourceDbPath,
      projectionRoot: workspace.projectionRoot,
      outputDir: workspace.outputDir,
      key: workspace.key,
      retain: 4,
      now: () => new Date("2026-08-30T01:00:00.000Z")
    });
    expect(first.ok).toBe(true);
    expect(first.code).toBe("SNAPSHOT_OK");
    expect(first.userVersion).toBe(10);
    expect(first.deduped).toBe(false);
    const restoreRoot = join(workspace.root, "restore");
    const restored = runRestoreDrill({
      backupRoot: workspace.outputDir,
      restoreRoot,
      key: workspace.key,
      expectedUserVersion: 10
    });
    expect(restored.ok).toBe(true);
    expect(restored.checks?.quick_check).toBe("ok");
    expect(restored.checks?.foreign_key_check).toBe("ok");
    expect(restored.checks?.user_version).toBe("10");
    expect(restored.checks?.sqlite_master_sha256).toBe(first.sqliteMasterSha256);
    expect(restored.checks?.drill_public_pointer_verified).toBe("1");
  });

  it("skips rotation and keeps every old package when one byte is tampered", () => {
    const workspace = fixtureWorkspace("f1plus1-backup-bad-");
    const first = runSnapshotOnce({
      sourceDbPath: workspace.sourceDbPath,
      projectionRoot: workspace.projectionRoot,
      outputDir: workspace.outputDir,
      key: workspace.key,
      retain: 2,
      now: () => new Date("2026-08-30T02:00:00.000Z")
    });
    changeSourceNote(workspace.sourceDbPath, "changed");
    const second = runSnapshotOnce({
      sourceDbPath: workspace.sourceDbPath,
      projectionRoot: workspace.projectionRoot,
      outputDir: workspace.outputDir,
      key: workspace.key,
      retain: 2,
      now: () => new Date("2026-08-30T02:15:00.000Z")
    });
    expect(first.ok && second.ok).toBe(true);
    const before = readdirSync(backupLayout(workspace.outputDir).packagesDir).sort();
    expect(before).toHaveLength(2);
    changeSourceNote(workspace.sourceDbPath, "third");
    expect(() =>
      runSnapshotOnce({
        sourceDbPath: workspace.sourceDbPath,
        projectionRoot: workspace.projectionRoot,
        outputDir: workspace.outputDir,
        key: workspace.key,
        retain: 2,
        now: () => new Date("2026-08-30T02:30:00.000Z"),
        testOnlyAfterObjectWrite: (objectPath) => {
          const bytes = readFileSync(objectPath);
          bytes[bytes.byteLength - 20] ^= 0xff;
          writeFileSync(objectPath, bytes);
        }
      })
    ).toThrow(BackupError);
    const after = readdirSync(backupLayout(workspace.outputDir).packagesDir).sort();
    expect(after).toEqual(before);
  });

  it("does not admit a truncated ciphertext object into the retention set", () => {
    const workspace = fixtureWorkspace("f1plus1-backup-trunc-");
    const first = runSnapshotOnce({
      sourceDbPath: workspace.sourceDbPath,
      projectionRoot: workspace.projectionRoot,
      outputDir: workspace.outputDir,
      key: workspace.key,
      retain: 4,
      now: () => new Date("2026-08-30T03:00:00.000Z")
    });
    expect(first.ok).toBe(true);
    const layout = backupLayout(workspace.outputDir);
    writeFileSync(
      join(layout.objectsDir, `db-projection-snapshot.${"ab".repeat(32)}.${first.keyId}`),
      Buffer.alloc(40, 7)
    );
    const retained = collectRetentionSet(workspace.outputDir, workspace.key);
    expect(retained.map((item) => item.packageId)).toEqual([first.packageId]);
    expect(retained).toHaveLength(1);
  });

  it("deduplicates identical content and only resigns the manifest", () => {
    const workspace = fixtureWorkspace("f1plus1-backup-dedup-");
    const first = runSnapshotOnce({
      sourceDbPath: workspace.sourceDbPath,
      projectionRoot: workspace.projectionRoot,
      outputDir: workspace.outputDir,
      key: workspace.key,
      retain: 4,
      now: () => new Date("2026-08-30T04:00:00.000Z")
    });
    const second = runSnapshotOnce({
      sourceDbPath: workspace.sourceDbPath,
      projectionRoot: workspace.projectionRoot,
      outputDir: workspace.outputDir,
      key: workspace.key,
      retain: 4,
      now: () => new Date("2026-08-30T04:15:00.000Z")
    });
    expect(second.ok).toBe(true);
    expect(second.code).toBe("SNAPSHOT_DEDUPED");
    expect(second.deduped).toBe(true);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.recoveryPointAt).toBe("2026-08-30T04:15:00.000Z");
    expect(second.packageId).not.toBe(first.packageId);
    expect(readdirSync(backupLayout(workspace.outputDir).objectsDir)).toHaveLength(1);
    expect(readdirSync(backupLayout(workspace.outputDir).packagesDir)).toHaveLength(2);
  });

  it("fails closed on a stale lock instead of staying silent", () => {
    const workspace = fixtureWorkspace("f1plus1-backup-lock-");
    writeFileSync(
      backupLayout(workspace.outputDir).lockPath,
      `${JSON.stringify({ pid: deadPid(), startedAt: "2026-08-30T05:00:00.000Z" })}\n`
    );
    try {
      runSnapshotOnce({
        sourceDbPath: workspace.sourceDbPath,
        projectionRoot: workspace.projectionRoot,
        outputDir: workspace.outputDir,
        key: workspace.key,
        retain: 4
      });
      throw new Error("expected stale lock to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BackupError);
      expect((error as BackupError).code).toBe("STALE_LOCK");
    }
    expect(loadKeyFile(workspace.keyPath).byteLength).toBe(32);
    expect(readdirSync(backupLayout(workspace.outputDir).packagesDir)).toHaveLength(0);
  });
});
