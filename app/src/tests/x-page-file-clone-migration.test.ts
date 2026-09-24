import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { xPageSchema12 } from "./helpers/x-page-database.ts";
import { seedRssAutomaticBackup, withRssSyntheticSeed } from "./helpers/rss-automatic-backup.ts";
import { applyRssAutomaticMigration } from "../server/rss-automatic/migration.ts";
import { sourceRegistrySchemaFingerprint } from "../server/rss/source-registry-migration.ts";
import { applyXPageFileCloneMigration, type XPageFileCloneManifest } from "../server/x-page/file-clone-migration.ts";
import { X_PAGE_FILE_CLONE_SCHEMA_SHA256 } from "../server/x-page/file-clone-schema-identity.ts";
import { X_PAGE_SELECTION } from "../server/x-page/normalize.ts";
import { applyXPageCloneMigration } from "../server/x-page/migration.ts";

const faults = vi.hoisted(() => ({ receipt: false, partialReceipt: false, receiptFd: -1, sqlTamper: false, beforeCloneOpen: null as (() => void) | null, beforeOutputMkdir: null as (() => void) | null, afterSourceHeader: null as (() => void) | null }));
vi.mock("node:fs", async original => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readSync: (...args: Parameters<typeof fs.readSync>) => {
    const count = fs.readSync(...args), values: unknown[] = args;
    if (values[3] === 20 && values[4] === 0 && faults.afterSourceHeader) { const callback = faults.afterSourceHeader; faults.afterSourceHeader = null; callback(); }
    return count;
  }, mkdirSync: (...args: Parameters<typeof fs.mkdirSync>) => {
    if (String(args[0]) === "result" && faults.beforeOutputMkdir) { const callback = faults.beforeOutputMkdir; faults.beforeOutputMkdir = null; callback(); }
    return fs.mkdirSync(...args);
  }, readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
    const value = fs.readFileSync(...args);
    return faults.sqlTamper && String(args[0]).endsWith("0015_x_page_file_clone.sql") ? String(value) + "\n-- tampered" : value;
  }, openSync: (...args: Parameters<typeof fs.openSync>) => {
    if (String(args[0]) === "x-page-structure.sqlite" && faults.beforeCloneOpen) { const callback = faults.beforeCloneOpen; faults.beforeCloneOpen = null; callback(); }
    if (faults.receipt && (String(args[0]).endsWith("receipt.json") || String(args[0]).includes(".receipt-"))) throw new Error("INJECTED_RECEIPT_FAILURE");
    const fd = fs.openSync(...args); if ((String(args[0]).endsWith("receipt.json") || String(args[0]).includes(".receipt-"))) faults.receiptFd = fd; return fd;
  }, writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
    if (faults.partialReceipt && args[0] === faults.receiptFd) { fs.writeFileSync(args[0], "partial"); throw new Error("INJECTED_PARTIAL_WRITE"); }
    return fs.writeFileSync(...args);
  } };
});
const roots: string[] = [];
const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const at = "2026-09-07T00:00:00.000Z";
async function fixture(change?: (db: DatabaseSync) => void, beforeRss = false) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "x-file-clone-test-")); roots.push(root);
  const sourcePath = join(root, "source.sqlite"), outputDirectory = join(root, "result");
  const db = xPageSchema12(true);
  if (!beforeRss) applyRssAutomaticMigration(db, { applyEnabled: true });
  const seeded = seedRssAutomaticBackup(db, { releaseSha256: "a".repeat(64), manifestSha256: "b".repeat(64), nowIso: at });
  withRssSyntheticSeed(db, () => {
    db.prepare("INSERT INTO x_manual_operation VALUES(?,'x_submit','xsub_fixture',0,?,?)").run(seeded.operationId, "c".repeat(64), at);
    db.prepare(`INSERT INTO x_manual_submission(submission_id,submitted_url,canonical_url,status_id,dedupe_key,state,source_id,retention_expires_at,submit_operation_id,created_at,updated_at) VALUES('xsub_fixture','https://x.com/f1/status/1234567890123456789','https://x.com/f1/status/1234567890123456789','1234567890123456789',?,'submitted','x_f1','2027-09-07T00:00:00.000Z',?,?,?)`).run("d".repeat(64), seeded.operationId, at, at);
    db.prepare("INSERT INTO x_manual_audit(event_id,operation_id,event_kind,payload_hash,created_at) VALUES('xevt_fixture',?,'submitted',?,?)").run(seeded.operationId, "e".repeat(64), at);
    db.prepare("INSERT INTO internal_operation_audit(event_id,operation_id,event_type,actor_ref,event_json,event_hash,created_at) VALUES('fixture-audit',?,'operation_succeeded','synthetic','{}',?,?)").run(seeded.operationId, "f".repeat(64), at);
  });
  change?.(db);
  await backup(db, sourcePath); db.close(); chmodSync(sourcePath, 0o600);
  const stat = lstatSync(sourcePath);
  const manifest: XPageFileCloneManifest = { schemaVersion: "x-page-file-clone-manifest-v1", evidenceClass: "file_clone_structure_only", migrationId: "x-0015-test", appliedAt: at, selectionSha256: X_PAGE_SELECTION.sha256,
    source: { path: sourcePath, sha256: hash(readFileSync(sourcePath)), device: stat.dev, inode: stat.ino, size: stat.size } };
  return { root, sourcePath, outputDirectory, manifest, apply: () => applyXPageFileCloneMigration({ manifest, outputDirectory }) };
}
afterEach(() => { faults.receipt = false; faults.partialReceipt = false; faults.receiptFd = -1; faults.sqlTamper = false; faults.beforeCloneOpen = null; faults.beforeOutputMkdir = null; faults.afterSourceHeader = null; vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("0015 file clone structure successor", () => {
  it("preserves nonempty RSS/manual/backup/audit histories, exact safety SQL, source bytes and inode", async () => {
    const f = await fixture(), result = f.apply();
    expect(result).toMatchObject({ databaseCommitted: true, receiptWritten: true, replay: false, schemaSha256: X_PAGE_FILE_CLONE_SCHEMA_SHA256 });
    const original = new DatabaseSync(f.sourcePath, { readOnly: true }), target = new DatabaseSync(result.databasePath, { readOnly: true });
    try {
      expect(sourceRegistrySchemaFingerprint(target)).toBe(X_PAGE_FILE_CLONE_SCHEMA_SHA256);
      for (const table of ["pending_review_candidate", "review_bundle", "review_decision", "publication", "projection_outbox", "x_manual_submission", "x_manual_operation", "x_manual_audit", "backup_recovery_point", "internal_operation", "internal_operation_audit", "quick_launch_authority_v2", "internal_control"]) {
        const old = original.prepare(`SELECT * FROM ${table}`).all(); expect(old.length, table).toBeGreaterThan(0);
        expect(target.prepare(`SELECT * FROM ${table}`).all(), table).toEqual(old);
      }
      const oldObjects = original.prepare("SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL").all();
      for (const row of oldObjects) if (!(row.type === "table" && ["source", "source_registry_v1"].includes(String(row.name)))) expect(target.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(String(row.name))!.sql, String(row.name)).toBe(row.sql);
      expect(target.prepare("SELECT count(*) n FROM source WHERE source_kind='x_page' AND enabled=0").get()!.n).toBe(27);
      expect(target.prepare("SELECT count(*) n FROM source_registry_v1 WHERE source_kind='x_page' AND enabled=0 AND identity_status='unknown' AND adapter_status='unchecked' AND adapter_authorization_status='unknown' AND platform_allowed='unknown'").get()!.n).toBe(27);
      expect(target.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { original.close(); target.close(); }
    expect(hash(readFileSync(f.sourcePath))).toBe(f.manifest.source.sha256); expect(lstatSync(f.sourcePath).ino).toBe(f.manifest.source.inode);
  });
  it("replays the same immutable manifest and rejects a changed manifest", async () => {
    const f = await fixture(); const first = f.apply(); const receipt = readFileSync(first.receiptPath, "utf8");
    expect(f.apply()).toMatchObject({ replay: true, receiptWritten: true }); expect(readFileSync(first.receiptPath, "utf8")).toBe(receipt);
    expect(() => applyXPageFileCloneMigration({ outputDirectory: f.outputDirectory, manifest: { ...f.manifest, migrationId: "different" } })).toThrow("X_FILE_REPLAY_IDENTITY_DRIFT");
  });
  it("reports an already committed database truthfully when receipt I/O fails and repairs on replay", async () => {
    const f = await fixture(); faults.receipt = true;
    const result = f.apply(); expect(result).toMatchObject({ databaseCommitted: true, receiptWritten: false });
    expect(existsSync(result.receiptPath)).toBe(false); faults.receipt = false;
    expect(f.apply()).toMatchObject({ replay: true, receiptWritten: true });
  });
  it("removes only its own partial receipt after I/O failure and recovers on replay", async () => {
    const f = await fixture(); faults.partialReceipt = true;
    expect(f.apply()).toMatchObject({ databaseCommitted: true, receiptWritten: false, receiptFailureReasonCode: "X_FILE_RECEIPT_WRITE_FAILED" });
    expect(existsSync(join(f.outputDirectory, "receipt.json"))).toBe(false); faults.partialReceipt = false;
    expect(f.apply()).toMatchObject({ replay: true, receiptWritten: true });
  });
  it("recovers committed state after a process died during temporary receipt writing", async () => {
    const f = await fixture(), first = f.apply(), receipt = JSON.parse(readFileSync(first.receiptPath, "utf8"));
    rmSync(first.receiptPath); const partial = join(f.outputDirectory, `.receipt-${receipt.manifestSha256}-${"1".repeat(32)}.tmp`);
    writeFileSync(partial, "partial pre-publication crash", { mode: 0o600 });
    expect(f.apply()).toMatchObject({ replay: true, receiptWritten: true }); expect(readFileSync(partial, "utf8")).toBe("partial pre-publication crash");
  });
  it("recovers its exact two-name inode after a process died following atomic receipt publication", async () => {
    const f = await fixture(), first = f.apply(), receipt = JSON.parse(readFileSync(first.receiptPath, "utf8"));
    const temporary = join(f.outputDirectory, `.receipt-${receipt.manifestSha256}-${"2".repeat(32)}.tmp`); linkSync(first.receiptPath, temporary);
    expect(lstatSync(first.receiptPath).nlink).toBe(2); expect(f.apply()).toMatchObject({ replay: true, receiptWritten: true });
    expect(existsSync(temporary)).toBe(false); expect(lstatSync(first.receiptPath).nlink).toBe(1);
  });
  it("does not overwrite an unknown conflicting receipt or unlink an unrelated hardlink", async () => {
    const f = await fixture(), first = f.apply(), originalReceipt = readFileSync(first.receiptPath, "utf8"); writeFileSync(first.receiptPath, "unknown receipt", { mode: 0o600 });
    expect(f.apply()).toMatchObject({ databaseCommitted: true, receiptWritten: false, receiptFailureReasonCode: "X_FILE_RECEIPT_CONFLICT" });
    expect(readFileSync(first.receiptPath, "utf8")).toBe("unknown receipt");
    writeFileSync(first.receiptPath, originalReceipt); const unrelated = join(f.root, "unrelated-receipt-link"); linkSync(first.receiptPath, unrelated);
    expect(f.apply()).toMatchObject({ receiptWritten: false, receiptFailureReasonCode: "X_FILE_RECEIPT_CONFLICT" }); expect(existsSync(unrelated)).toBe(true); expect(lstatSync(first.receiptPath).nlink).toBe(2);
  });
  it.each([false, true])("rejects the synthetic 0013 predecessor with RSS extension=%s", async combined => {
    const f = await fixture(db => {
      applyXPageCloneMigration(db, { schemaVersion: "x-page-clone-migration-v1", evidenceClass: "synthetic_clone", appliedAt: at,
        authorizationExpiresAt: "2027-09-07T00:00:00.000Z", selectionSha256: X_PAGE_SELECTION.sha256,
        adapterSha256: "a".repeat(64), authorizationReceiptSha256: "b".repeat(64), sourcePolicySha256: "c".repeat(64) });
      if (combined) applyRssAutomaticMigration(db, { applyEnabled: true });
    }, true);
    expect(() => f.apply()).toThrow("X_FILE_SCHEMA_DRIFT"); expect(existsSync(f.outputDirectory)).toBe(false);
  });
  it("detects external source-file mutation before committing the new clone", async () => {
    const f = await fixture(), original = DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql: string) {
      original.call(this, sql); if (sql.startsWith("-- File-clone structure only.")) appendFileSync(f.sourcePath, "external mutation");
    });
    expect(() => f.apply()).toThrow("X_FILE_SOURCE_IDENTITY_DRIFT");
    const target = new DatabaseSync(join(f.outputDirectory, "x-page-structure.sqlite"), { readOnly: true });
    try { expect(target.prepare("PRAGMA user_version").get()!.user_version).toBe(10); } finally { target.close(); }
  });
  it("rejects edited selected config on replay even when its original immutable guard is restored", async () => {
    const f = await fixture(), first = f.apply(), target = new DatabaseSync(first.databasePath);
    withRssSyntheticSeed(target, () => target.exec("UPDATE x_page_source_config_v1 SET schedule_seconds=1800 WHERE source_id='x_f1'")); target.close();
    expect(() => f.apply()).toThrow("X_FILE_CONFIG_DEFAULT_DRIFT");
  });
  it.each(["old0012", "extra-object", "live", "clear-stop"])("rejects %s without creating output", async mode => {
    const f = await fixture(db => {
      if (mode === "extra-object") db.exec("CREATE TABLE unknown_extension(n TEXT)");
      if (mode === "live" || mode === "clear-stop") withRssSyntheticSeed(db, () => db.exec(mode === "live" ? "UPDATE internal_control SET phase='live',recovery_state='ready',deletion_fence_state='clear',publication_fence_state='clear'" : "UPDATE internal_control SET global_stop_state='clear'"));
    }, mode === "old0012");
    expect(() => f.apply()).toThrow(mode === "live" || mode === "clear-stop" ? "X_FILE_CONTROL_NOT_CLOSED" : "X_FILE_SCHEMA_DRIFT"); expect(existsSync(f.outputDirectory)).toBe(false);
  });
  it("rejects modified raw migration bytes before output creation", async () => {
    const f = await fixture(); faults.sqlTamper = true; expect(() => f.apply()).toThrow("X_FILE_MIGRATION_HASH"); expect(existsSync(f.outputDirectory)).toBe(false);
  });
  it("rejects a clean WAL-mode source before a read-only SQLite open can create sidecars", async () => {
    const f = await fixture(), source = new DatabaseSync(f.sourcePath); source.exec("PRAGMA journal_mode=WAL"); source.close();
    expect(existsSync(f.sourcePath + "-wal")).toBe(false); expect(existsSync(f.sourcePath + "-shm")).toBe(false);
    f.manifest.source.sha256 = hash(readFileSync(f.sourcePath));
    expect(() => f.apply()).toThrow("X_FILE_SOURCE_WAL_MODE");
    expect(existsSync(f.sourcePath + "-wal")).toBe(false); expect(existsSync(f.sourcePath + "-shm")).toBe(false);
  });
  it("uses the pinned immutable descriptor when the original source pathname is replaced by a WAL symlink", async () => {
    const f = await fixture(), outside = join(f.root, "outside"), preserved = join(f.root, "original-source.sqlite"); mkdirSync(outside, { mode: 0o700 });
    const walPath = join(outside, "source.sqlite"); writeFileSync(walPath, readFileSync(f.sourcePath), { mode: 0o600 });
    const wal = new DatabaseSync(walPath); wal.exec("PRAGMA journal_mode=WAL"); wal.close();
    faults.afterSourceHeader = () => { renameSync(f.sourcePath, preserved); symlinkSync(walPath, f.sourcePath); };
    expect(() => f.apply()).toThrow("X_FILE_PATH_SYMLINK"); expect(existsSync(f.outputDirectory)).toBe(false);
    expect(existsSync(walPath + "-wal")).toBe(false); expect(existsSync(walPath + "-shm")).toBe(false);
    expect(hash(readFileSync(preserved))).toBe(f.manifest.source.sha256); expect(lstatSync(preserved).ino).toBe(f.manifest.source.inode);
  });
  it.each(["sha256", "inode", "selection"])("rejects changed manifest %s", async field => {
    const f = await fixture();
    const manifest = field === "selection" ? { ...f.manifest, selectionSha256: "0".repeat(64) } : { ...f.manifest, source: { ...f.manifest.source, [field]: field === "inode" ? f.manifest.source.inode + 1 : "0".repeat(64) } };
    expect(() => applyXPageFileCloneMigration({ manifest, outputDirectory: f.outputDirectory })).toThrow(); expect(existsSync(f.outputDirectory)).toBe(false);
  });
  it.each(["-wal", "-shm", "-journal"])("rejects source %s sidecar", async suffix => { const f = await fixture(); writeFileSync(f.sourcePath + suffix, "active", { mode: 0o600 }); expect(() => f.apply()).toThrow("X_FILE_SOURCE_NOT_QUIESCENT"); });
  it.each(["symlink", "hardlink", "public-file", "public-parent", "overlap", "unknown-output"])("rejects unsafe %s", async mode => {
    const f = await fixture(); let manifest = f.manifest, outputDirectory = f.outputDirectory;
    if (mode === "symlink") { const alias = join(f.root, "alias.sqlite"); symlinkSync(f.sourcePath, alias); manifest = { ...manifest, source: { ...manifest.source, path: alias } }; }
    if (mode === "hardlink") linkSync(f.sourcePath, join(f.root, "alias.sqlite"));
    if (mode === "public-file") chmodSync(f.sourcePath, 0o644);
    if (mode === "public-parent") chmodSync(f.root, 0o755);
    if (mode === "overlap") outputDirectory = f.root;
    if (mode === "unknown-output") { mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(join(outputDirectory, "keep.txt"), "keep", { mode: 0o600 }); }
    expect(() => applyXPageFileCloneMigration({ manifest, outputDirectory })).toThrow(); expect(hash(readFileSync(f.sourcePath))).toBe(f.manifest.source.sha256);
    if (mode === "unknown-output") expect(readFileSync(join(outputDirectory, "keep.txt"), "utf8")).toBe("keep");
  });
  it("anchors clone and failure writes to the created directory inode during a pathname substitution", async () => {
    const f = await fixture(), cwd = process.cwd(), moved = join(f.root, "owned-moved"), outside = join(f.root, "outside");
    mkdirSync(outside, { mode: 0o700 }); writeFileSync(join(outside, "keep.txt"), "keep", { mode: 0o600 });
    faults.beforeCloneOpen = () => { renameSync(f.outputDirectory, moved); symlinkSync(outside, f.outputDirectory); };
    expect(() => f.apply()).toThrow("X_FILE_PATH_SYMLINK"); expect(process.cwd()).toBe(cwd);
    expect(existsSync(join(outside, "x-page-structure.sqlite"))).toBe(false); expect(existsSync(join(outside, "failure.json"))).toBe(false);
    expect(readFileSync(join(outside, "keep.txt"), "utf8")).toBe("keep"); expect(existsSync(join(moved, "x-page-structure.sqlite"))).toBe(true);
    expect(hash(readFileSync(f.sourcePath))).toBe(f.manifest.source.sha256);
  });
  it("anchors the output parent before mkdir so replacing its pathname cannot create outside directories", async () => {
    const f = await fixture(), cwd = process.cwd(), parent = join(f.root, "parent"), moved = join(f.root, "owned-parent-moved"), outside = join(f.root, "outside");
    mkdirSync(parent, { mode: 0o700 }); mkdirSync(outside, { mode: 0o700 }); writeFileSync(join(outside, "keep.txt"), "keep", { mode: 0o600 });
    faults.beforeOutputMkdir = () => { renameSync(parent, moved); symlinkSync(outside, parent); };
    expect(() => applyXPageFileCloneMigration({ manifest: f.manifest, outputDirectory: join(parent, "result") })).toThrow("X_FILE_PATH_SYMLINK");
    expect(process.cwd()).toBe(cwd); expect(existsSync(join(outside, "result"))).toBe(false); expect(existsSync(join(moved, "result"))).toBe(true);
    expect(readFileSync(join(outside, "keep.txt"), "utf8")).toBe("keep"); expect(hash(readFileSync(f.sourcePath))).toBe(f.manifest.source.sha256);
  });
  it("keeps SQLite rollback and failure I/O on the owned inode after a directory move during SQL", async () => {
    const f = await fixture(), cwd = process.cwd(), moved = join(f.root, "owned-moved"), outside = join(f.root, "outside"), original = DatabaseSync.prototype.exec;
    mkdirSync(outside, { mode: 0o700 }); const journalMarker = join(outside, "x-page-structure.sqlite-journal"); writeFileSync(journalMarker, "unrelated journal", { mode: 0o600 });
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql: string) {
      if (sql.startsWith("-- File-clone structure only.")) { expect(this.prepare("PRAGMA journal_mode").get()!.journal_mode).toBe("memory"); renameSync(f.outputDirectory, moved); symlinkSync(outside, f.outputDirectory); }
      original.call(this, sql);
    });
    expect(() => f.apply()).toThrow("X_FILE_PATH_SYMLINK"); expect(process.cwd()).toBe(cwd);
    expect(readFileSync(journalMarker, "utf8")).toBe("unrelated journal"); expect(existsSync(join(outside, "failure.json"))).toBe(false); expect(existsSync(join(outside, "x-page-structure.sqlite"))).toBe(false);
    const target = new DatabaseSync(join(moved, "x-page-structure.sqlite"), { readOnly: true }); try { expect(target.prepare("PRAGMA user_version").get()!.user_version).toBe(10); } finally { target.close(); }
    expect(hash(readFileSync(f.sourcePath))).toBe(f.manifest.source.sha256);
  });
  it.each(["before", "after", "unknown"])("records the actual COMMIT %s error outcome and restores caller cwd", async mode => {
    const f = await fixture(), cwd = process.cwd(), originalExec = DatabaseSync.prototype.exec, originalPrepare = DatabaseSync.prototype.prepare; let unreadable = false;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
      if (unreadable) throw new Error("INJECTED_IO_ERROR"); return originalPrepare.call(this, sql);
    });
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql: string) {
      if (sql === "COMMIT" && mode === "before") throw new Error("INJECTED_BEFORE_COMMIT");
      originalExec.call(this, sql);
      if (sql === "COMMIT") { unreadable = mode === "unknown"; throw new Error("INJECTED_AFTER_COMMIT"); }
    });
    expect(() => f.apply()).toThrow(mode === "before" ? "INJECTED_BEFORE_COMMIT" : mode === "after" ? "X_FILE_COMMITTED_POSTCHECK_FAILED" : "X_FILE_COMMIT_RESULT_UNKNOWN");
    expect(process.cwd()).toBe(cwd); unreadable = false;
    const failure = JSON.parse(readFileSync(join(f.outputDirectory, "failure.json"), "utf8")); expect(failure.databaseCommitted).toBe(mode === "before" ? false : mode === "after" ? true : null);
    const target = new DatabaseSync(join(f.outputDirectory, "x-page-structure.sqlite"), { readOnly: true });
    try { expect(target.prepare("PRAGMA user_version").get()!.user_version).toBe(mode === "before" ? 10 : 11); } finally { target.close(); }
    if (mode !== "before") { expect(f.apply()).toMatchObject({ replay: true, databaseCommitted: true, receiptWritten: true }); expect(JSON.parse(readFileSync(join(f.outputDirectory, "failure.json"), "utf8"))).toEqual(failure); }
    expect(process.cwd()).toBe(cwd); expect(hash(readFileSync(f.sourcePath))).toBe(f.manifest.source.sha256);
  });
  it.each(["sql-failure", "schema-failure", "history-failure"])("rolls back %s and leaves a truthful failure receipt", async mode => {
    const f = await fixture(), original = DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql: string) {
      original.call(this, sql);
      if (sql.startsWith("-- File-clone structure only.")) {
        if (mode === "sql-failure") throw new Error("INJECTED_MIGRATION_FAILURE");
        if (mode === "schema-failure") original.call(this, "CREATE TABLE unexpected(n TEXT)");
        if (mode === "history-failure") withRssSyntheticSeed(this, () => original.call(this, "UPDATE internal_control SET version=version+1"));
      }
    });
    expect(() => f.apply()).toThrow(mode === "sql-failure" ? "INJECTED_MIGRATION_FAILURE" : mode === "schema-failure" ? "X_FILE_SCHEMA_DRIFT" : "X_FILE_HISTORY_DRIFT");
    const target = new DatabaseSync(join(f.outputDirectory, "x-page-structure.sqlite"), { readOnly: true });
    try { expect(target.prepare("PRAGMA user_version").get()!.user_version).toBe(10); expect(target.prepare("SELECT name FROM sqlite_schema WHERE name='x_page_file_clone_identity_v1'").get()).toBeUndefined(); } finally { target.close(); }
    expect(JSON.parse(readFileSync(join(f.outputDirectory, "failure.json"), "utf8")).databaseCommitted).toBe(false); expect(hash(readFileSync(f.sourcePath))).toBe(f.manifest.source.sha256);
  });
  it("blocks unadmitted X source mutations, config validation and candidate import; old synthetic entrypoint rejects the file", async () => {
    const f = await fixture(), result = f.apply(), db = new DatabaseSync(result.databasePath);
    try {
      for (const sql of ["DELETE FROM source WHERE source_id='x_f1'", "UPDATE source SET enabled=1 WHERE source_id='x_f1'", "UPDATE source_registry_v1 SET identity_status='verified' WHERE source_id='x_f1'", "UPDATE x_page_source_config_v1 SET adapter_sha256='ready' WHERE source_id='x_f1'", "DELETE FROM x_page_file_clone_identity_v1", "INSERT INTO pending_review_candidate(candidate_id,source_id) VALUES('x-test','x_f1')", "INSERT INTO x_page_candidate_capture_v1(capture_id) VALUES('capture')"]) expect(() => db.exec(sql)).toThrow("X_PAGE_ADMISSION_REQUIRED");
      expect(() => applyXPageCloneMigration(db, { schemaVersion: "x-page-clone-migration-v1", evidenceClass: "synthetic_clone", appliedAt: at, authorizationExpiresAt: "2027-09-07T00:00:00.000Z", selectionSha256: X_PAGE_SELECTION.sha256, adapterSha256: "a".repeat(64), authorizationReceiptSha256: "b".repeat(64), sourcePolicySha256: "c".repeat(64) })).toThrow("X_PAGE_MIGRATION_CLONE_ONLY");
    } finally { db.close(); }
  });
});
