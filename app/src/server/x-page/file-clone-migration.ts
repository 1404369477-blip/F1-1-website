import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { sourceRegistrySchemaFingerprint } from "../rss/source-registry-migration.ts";
import { X_PAGE_HANDLES, X_PAGE_SELECTION } from "./normalize.ts";
import { X_PAGE_FILE_CLONE_PREDECESSOR_SHA256, X_PAGE_FILE_CLONE_MIGRATION_SHA256, X_PAGE_FILE_CLONE_SCHEMA_SHA256 } from "./file-clone-schema-identity.ts";

const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const ManifestSchema = z.object({
  schemaVersion: z.literal("x-page-file-clone-manifest-v1"),
  evidenceClass: z.literal("file_clone_structure_only"),
  migrationId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/u),
  appliedAt: z.iso.datetime({ precision: 3 }),
  selectionSha256: z.literal(X_PAGE_SELECTION.sha256),
  source: z.object({ path: z.string(), sha256: digest, device: z.number().int(), inode: z.number().int().positive(), size: z.number().int().positive() }).strict()
}).strict();
export type XPageFileCloneManifest = z.infer<typeof ManifestSchema>;
type Row = Record<string, unknown>;
type Snapshot = Record<string, string>;
const selectedIds = new Set<string>(X_PAGE_HANDLES.map(handle => `x_${handle}`));
const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
function assert(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
function canonical(value: unknown): string {
  if (value instanceof Uint8Array) return JSON.stringify({ binaryBase64: Buffer.from(value).toString("base64") });
  if (typeof value === "bigint") return JSON.stringify({ integerDecimal: value.toString() });
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Row)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
function rows(database: DatabaseSync, table: string): Row[] {
  const statement = database.prepare(`SELECT * FROM ${quote(table)}`); statement.setReadBigInts(true);
  return statement.all();
}
function tableSnapshot(database: DatabaseSync, names: string[], successor: boolean): Snapshot {
  return Object.fromEntries(names.map(name => {
    let values = rows(database, name);
    if (name === "source_registry_v1") values = values.filter(row => !selectedIds.has(String(row.source_id)));
    if (name === "source" && successor) values = values.filter(row => row.source_kind === "rss").map(row => { const copy = { ...row }; delete copy.source_kind; return copy; });
    return [name, hash(values.map(canonical).sort().join("\n"))];
  }));
}
function objects(database: DatabaseSync): Row[] { return database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all(); }
function privatePath(path: string, directory: boolean, receiptLink = false): NonNullable<ReturnType<typeof lstatSync>> {
  assert(isAbsolute(path) && resolve(path) === path, "X_FILE_PATH_NONCANONICAL");
  let cursor = parse(path).root;
  for (const part of path.slice(cursor.length).split("/").filter(Boolean)) {
    cursor = join(cursor, part); assert(!lstatSync(cursor).isSymbolicLink(), "X_FILE_PATH_SYMLINK");
  }
  const stat = lstatSync(path);
  assert(directory ? stat.isDirectory() : stat.isFile(), "X_FILE_PATH_KIND");
  assert(stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, "X_FILE_PATH_NOT_PRIVATE");
  if (!directory) assert(stat.nlink === 1 || (receiptLink && stat.nlink === 2), "X_FILE_PATH_HARDLINK");
  return stat;
}
function noSidecars(path: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"]) assert(!existsSync(`${path}${suffix}`), "X_FILE_SOURCE_NOT_QUIESCENT");
}
function checkDatabase(database: DatabaseSync, expected: string, version: number): void {
  assert(Number(database.prepare("PRAGMA user_version").get()!.user_version) === version && sourceRegistrySchemaFingerprint(database) === expected, "X_FILE_SCHEMA_DRIFT");
  assert(database.prepare("PRAGMA integrity_check").all().every(row => row.integrity_check === "ok"), "X_FILE_INTEGRITY");
  assert(database.prepare("PRAGMA foreign_key_check").all().length === 0, "X_FILE_FOREIGN_KEY");
  const control = database.prepare("SELECT phase,global_stop_state FROM internal_control WHERE singleton_id=1").get();
  assert(control && ["disabled", "paused"].includes(String(control.phase)) && control.global_stop_state === "stopped", "X_FILE_CONTROL_NOT_CLOSED");
}
function readPinnedBytes(fd: number): Buffer {
  const before = fstatSync(fd), bytes = Buffer.alloc(before.size); let offset = 0;
  while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); assert(count > 0, "X_FILE_SOURCE_BYTES_DRIFT"); offset += count; }
  const after = fstatSync(fd);
  assert(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, "X_FILE_SOURCE_BYTES_DRIFT");
  return bytes;
}
function sourceUnchanged(manifest: XPageFileCloneManifest, fd: number): void {
  noSidecars(manifest.source.path);
  const stat = privatePath(manifest.source.path, false), held = fstatSync(fd);
  assert(stat.dev === manifest.source.device && stat.ino === manifest.source.inode && stat.size === manifest.source.size && stat.dev === held.dev && stat.ino === held.ino, "X_FILE_SOURCE_IDENTITY_DRIFT");
  assert(hash(readPinnedBytes(fd)) === manifest.source.sha256, "X_FILE_SOURCE_BYTES_DRIFT");
}
function selectedIdentity(sourceId: string, handle: string): string {
  return hash(canonical({ sourceId, canonicalPageUrl: `https://x.com/${handle}`, sourceKind: "x_page", collectionMode: "browser_visible_dom", selectionSha256: X_PAGE_SELECTION.sha256 }));
}
function assertSelected(database: DatabaseSync, before: Row[], manifest: XPageFileCloneManifest): void {
  const after = database.prepare("SELECT * FROM source_registry_v1 ORDER BY source_id").all();
  const expected = before.map(row => selectedIds.has(String(row.source_id)) ? { ...row, source_kind: "x_page", collection_mode: "browser_visible_dom", revision: Number(row.revision) + 1,
    canonical_url_valid: 0, normalization_status: "pending", dedup_status: "pending", identity_status: "unknown", relevance_status: "unknown", monitorability: "unknown",
    adapter_status: "unchecked", adapter_authorization_status: "unknown", platform_allowed: "unknown", authorization_expires_at: null, lifecycle_status: "proposed", collection_onboarding_status: "validating", enabled: 0,
    identity_sha256: selectedIdentity(String(row.source_id), String(row.source_id).slice(2)), updated_at: manifest.appliedAt } : row);
  assert(canonical(after) === canonical(expected), "X_FILE_SELECTED_HISTORY_DRIFT");
  const expectedSources = before.filter(row => selectedIds.has(String(row.source_id))).map(row => ({ source_id: row.source_id, feed_url: null, source_kind: "x_page", enabled: 0,
    stop_epoch: row.source_safety_epoch, etag: null, last_modified: null, last_attempt_at: null, last_success_at: null, next_eligible_at: null, last_reason_code: "X_PAGE_ADMISSION_REQUIRED" }));
  assert(canonical(database.prepare("SELECT * FROM source WHERE source_kind='x_page' ORDER BY source_id").all()) === canonical(expectedSources), "X_FILE_SOURCE_DEFAULT_DRIFT");
  const expectedConfigs = before.filter(row => selectedIds.has(String(row.source_id))).map(row => ({ source_id: row.source_id, source_revision: Number(row.revision) + 1,
    canonical_handle: String(row.source_id).slice(2), canonical_page_url: `https://x.com/${String(row.source_id).slice(2)}`,
    identity_sha256: selectedIdentity(String(row.source_id), String(row.source_id).slice(2)), selection_sha256: manifest.selectionSha256, schedule_seconds: 900, concurrency: 1,
    adapter_sha256: null, authorization_receipt_sha256: null, authorization_expires_at: null, source_policy_sha256: null, rights_status: "unknown", media_policy: "blocked", evidence_class: "file_clone_structure_only" }));
  assert(canonical(database.prepare("SELECT * FROM x_page_source_config_v1 ORDER BY source_id").all()) === canonical(expectedConfigs), "X_FILE_CONFIG_DEFAULT_DRIFT");
  assert(database.prepare("SELECT 1 FROM x_page_candidate_capture_v1 LIMIT 1").get() === undefined, "X_FILE_CAPTURE_NOT_EMPTY");
}
function assertPreserved(database: DatabaseSync, before: Snapshot, oldObjects: Row[], registry: Row[], manifest: XPageFileCloneManifest): void {
  assert(canonical(tableSnapshot(database, Object.keys(before), true)) === canonical(before), "X_FILE_HISTORY_DRIFT");
  const current = new Map(objects(database).map(row => [row.name, row]));
  for (const old of oldObjects) if (!(old.type === "table" && ["source", "source_registry_v1"].includes(String(old.name)))) {
    assert(canonical(current.get(old.name)) === canonical(old), "X_FILE_SECURITY_OBJECT_DRIFT");
  }
  for (const row of objects(database)) if (row.type === "view") database.prepare(`SELECT * FROM ${quote(String(row.name))} LIMIT 0`).all();
  assertSelected(database, registry, manifest);
}
function syncWriteExclusive(path: string, content: string | Buffer): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); }
  catch (error) {
    // Only remove the incomplete file this call exclusively created, never a replacement.
    const held = fstatSync(fd); try { const named = lstatSync(path); if (held.dev === named.dev && held.ino === named.ino) unlinkSync(path); } catch { /* Original error wins. */ }
    throw error;
  } finally { closeSync(fd); }
}

function privateOutputFile(name: string, receiptLink = false): NonNullable<ReturnType<typeof lstatSync>> {
  assert(!name.includes("/") && name !== "." && name !== "..", "X_FILE_OUTPUT_NAME");
  const stat = lstatSync(name);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, "X_FILE_OUTPUT_FILE_INVALID");
  assert(stat.nlink === 1 || (receiptLink && stat.nlink === 2), "X_FILE_PATH_HARDLINK");
  return stat;
}
function receiptTemporaryName(name: string, manifestSha256: string): boolean {
  return new RegExp(`^\\.receipt-${manifestSha256}-[0-9a-f]{32}\\.tmp$`, "u").test(name);
}
function writeCommittedReceipt(output: string, receiptPath: string, receipt: string, manifestSha256: string): void {
  const verifyExisting = (): void => {
    const stat = privateOutputFile(receiptPath, true); assert(stat.size === Buffer.byteLength(receipt), "X_FILE_RECEIPT_CONFLICT");
    const fd = openSync(receiptPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd); assert(opened.dev === stat.dev && opened.ino === stat.ino && readPinnedBytes(fd).toString("utf8") === receipt, "X_FILE_RECEIPT_CONFLICT");
    } finally { closeSync(fd); }
    if (stat.nlink === 2) {
      // A crash between exclusive link publication and unlink can retain our second
      // name. Require an exact in-directory inode pair before removing that name.
      const linked = readdirSync(output).filter(name => receiptTemporaryName(name, manifestSha256)).filter(name => {
        const other = lstatSync(join(output, name)); return other.isFile() && other.dev === stat.dev && other.ino === stat.ino;
      });
      assert(linked.length === 1, "X_FILE_RECEIPT_CONFLICT"); unlinkSync(join(output, linked[0]));
    }
    privateOutputFile(receiptPath);
  };
  if (existsSync(receiptPath)) { verifyExisting(); return; }
  const temporary = join(output, `.receipt-${manifestSha256}-${randomBytes(16).toString("hex")}.tmp`);
  syncWriteExclusive(temporary, receipt);
  const own = lstatSync(temporary);
  try {
    try { linkSync(temporary, receiptPath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    verifyExisting();
  } finally {
    // Never follow or delete a replacement. Pre-publication crash remnants from
    // older calls are preserved and do not prevent an exact-manifest replay.
    try { const named = lstatSync(temporary); if (named.dev === own.dev && named.ino === own.ino) unlinkSync(temporary); } catch { /* Original result wins. */ }
  }
}

/** Writes only a newly created private file clone. A successful structural receipt
 * grants no producer, runtime, backup, source-validation or production authority. */
export function applyXPageFileCloneMigration(input: Readonly<{ manifest: unknown; outputDirectory: string }>): Readonly<{ databasePath: string; receiptPath: string; databaseCommitted: true; replay: boolean; receiptWritten: boolean; receiptFailureReasonCode: string | null; schemaSha256: string }> {
  const manifest = ManifestSchema.parse(input.manifest), manifestJson = canonical(manifest);
  const sourcePath = manifest.source.path, output = input.outputDirectory;
  privatePath(dirname(sourcePath), true); privatePath(sourcePath, false); noSidecars(sourcePath);
  const outputParent = dirname(output), outputName = basename(output), parentIdentity = privatePath(outputParent, true);
  assert(isAbsolute(output) && resolve(output) === output && output !== dirname(sourcePath) && !sourcePath.startsWith(`${output}/`), "X_FILE_OUTPUT_OVERLAP");
  const sql = readFileSync(new URL("../../../migrations/rss-real/0015_x_page_file_clone.sql", import.meta.url), "utf8");
  assert(hash(sql) === X_PAGE_FILE_CLONE_MIGRATION_SHA256, "X_FILE_MIGRATION_HASH");
  const sourceFd = openSync(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let source: DatabaseSync | undefined, target: DatabaseSync | undefined, targetFd: number | undefined;
  let created = false, committed: boolean | null = false, commitAttempted = false, cwdChanged = false, outputAnchored = false;
  const previousCwd = process.cwd(); let directoryIdentity: NonNullable<ReturnType<typeof lstatSync>> | undefined;
  const databasePath = join(output, "x-page-structure.sqlite"), receiptPath = join(output, "receipt.json");
  try {
    sourceUnchanged(manifest, sourceFd);
    const sourceHeader = Buffer.alloc(20); assert(readSync(sourceFd, sourceHeader, 0, 20, 0) === 20 && sourceHeader.subarray(0, 16).toString("binary") === "SQLite format 3\0", "X_FILE_SOURCE_FORMAT");
    // SQLite may create sidecars when opening a WAL-mode file even read-only.
    // Require an already exported rollback-journal snapshot before opening it.
    assert(sourceHeader[18] === 1 && sourceHeader[19] === 1, "X_FILE_SOURCE_WAL_MODE");
    // SQLite reads the already pinned descriptor, never reopens the mutable source
    // pathname. Immutable mode additionally prevents read-only WAL sidecar creation;
    // it does not replace any byte/schema/identity verification below.
    source = new DatabaseSync(`${pathToFileURL(`/dev/fd/${sourceFd}`).href}?mode=ro&immutable=1`, { readOnly: true }); source.exec("BEGIN");
    checkDatabase(source, X_PAGE_FILE_CLONE_PREDECESSOR_SHA256, 10);
    const oldObjects = objects(source), tableNames = oldObjects.filter(row => row.type === "table").map(row => String(row.name));
    const before = tableSnapshot(source, tableNames, false), historySha256 = hash(canonical(before));
    const registry = source.prepare("SELECT * FROM source_registry_v1 ORDER BY source_id").all();
    for (const handle of X_PAGE_HANDLES) {
      const row = registry.find(row => row.source_id === `x_${handle}`);
      assert(row?.source_kind === "x_manual" && row.enabled === 0 && String(row.site_url).toLowerCase() === `https://x.com/${handle}`, "X_FILE_SELECTION_DRIFT");
    }
    assert(Number(source.prepare("SELECT count(*) n FROM x_manual_source_registry").get()!.n) === 59, "X_FILE_MANUAL_HISTORY_DRIFT");
    sourceUnchanged(manifest, sourceFd);
    // Anchor the parent before mkdir too: checking its pathname and later using
    // absolute mkdir would still permit a replacement parent to redirect a write.
    process.chdir(outputParent); cwdChanged = true;
    const heldParent = lstatSync("."); assert(heldParent.dev === parentIdentity.dev && heldParent.ino === parentIdentity.ino, "X_FILE_OUTPUT_PARENT_IDENTITY_DRIFT");
    try { mkdirSync(outputName, { mode: 0o700 }); created = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    directoryIdentity = lstatSync(outputName);
    assert(directoryIdentity.isDirectory() && !directoryIdentity.isSymbolicLink() && directoryIdentity.uid === process.getuid?.() && (directoryIdentity.mode & 0o077) === 0, "X_FILE_OUTPUT_DIRECTORY_INVALID");
    // This synchronous offline entrypoint uses the process cwd as an inode anchor:
    // macOS Node has no openat and /dev/fd/<directory>/name is unavailable. No output
    // operation below follows the caller's absolute directory path after this point.
    process.chdir(outputName);
    const anchored = lstatSync("."); assert(anchored.dev === directoryIdentity.dev && anchored.ino === directoryIdentity.ino, "X_FILE_OUTPUT_IDENTITY_DRIFT"); outputAnchored = true;
    const checkOutput = (): void => {
      const held = lstatSync("."), named = privatePath(output, true);
      assert(held.dev === directoryIdentity!.dev && held.ino === directoryIdentity!.ino && named.dev === held.dev && named.ino === held.ino, "X_FILE_OUTPUT_IDENTITY_DRIFT");
    };
    if (created) {
      syncWriteExclusive("x-page-structure.sqlite", readPinnedBytes(sourceFd)); sourceUnchanged(manifest, sourceFd);
      assert(hash(readFileSync("x-page-structure.sqlite")) === manifest.source.sha256, "X_FILE_COPY_DRIFT");
    } else {
      assert(readdirSync(".").every(name => ["x-page-structure.sqlite", "receipt.json", "failure.json"].includes(name) || receiptTemporaryName(name, hash(manifestJson))), "X_FILE_OUTPUT_EXISTS");
    }
    checkOutput(); const targetIdentity = privateOutputFile("x-page-structure.sqlite"); noSidecars("x-page-structure.sqlite");
    targetFd = openSync("x-page-structure.sqlite", (created ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NOFOLLOW);
    const heldTarget = fstatSync(targetFd); assert(heldTarget.dev === targetIdentity.dev && heldTarget.ino === targetIdentity.ino, "X_FILE_TARGET_IDENTITY_DRIFT");
    target = new DatabaseSync("x-page-structure.sqlite", { readOnly: !created });
    assert(target.prepare("PRAGMA database_list").all().every(row => row.name === "main" && row.file === resolve("x-page-structure.sqlite")), "X_FILE_TARGET_PATH_DRIFT");
    const namedTarget = privateOutputFile("x-page-structure.sqlite"); assert(namedTarget.dev === heldTarget.dev && namedTarget.ino === heldTarget.ino, "X_FILE_TARGET_IDENTITY_DRIFT");
    if (created) {
      checkDatabase(target, X_PAGE_FILE_CLONE_PREDECESSOR_SHA256, 10);
      // The disposable clone uses an in-memory rollback journal so SQLite cannot
      // create/delete a journal through a renamed absolute directory path. A crash
      // during migration can invalidate this clone; the unchanged source is recovery.
      target.exec("PRAGMA journal_mode=MEMORY; PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE");
      try {
        target.exec("CREATE TEMP TABLE migration_0015_manifest(applied_at TEXT,selection_sha256 TEXT,manifest_json TEXT,source_sha256 TEXT,predecessor_schema_sha256 TEXT,migration_sha256 TEXT,target_schema_sha256 TEXT,preserved_history_sha256 TEXT); CREATE TEMP TABLE migration_0015_source(source_id TEXT PRIMARY KEY,canonical_handle TEXT,identity_sha256 TEXT)");
        target.prepare("INSERT INTO migration_0015_manifest VALUES(?,?,?,?,?,?,?,?)").run(manifest.appliedAt, manifest.selectionSha256, manifestJson, manifest.source.sha256, X_PAGE_FILE_CLONE_PREDECESSOR_SHA256, X_PAGE_FILE_CLONE_MIGRATION_SHA256, X_PAGE_FILE_CLONE_SCHEMA_SHA256, historySha256);
        for (const handle of X_PAGE_HANDLES) target.prepare("INSERT INTO migration_0015_source VALUES(?,?,?)").run(`x_${handle}`, handle, selectedIdentity(`x_${handle}`, handle));
        target.exec(sql);
        checkDatabase(target, X_PAGE_FILE_CLONE_SCHEMA_SHA256, 11); assertPreserved(target, before, oldObjects, registry, manifest);
        sourceUnchanged(manifest, sourceFd); checkOutput();
        target.exec("DROP TABLE migration_0015_manifest; DROP TABLE migration_0015_source"); commitAttempted = true;
        target.exec("COMMIT"); committed = true;
      } catch (error) {
        if (commitAttempted) committed = null;
        if (target.isTransaction) {
          try { target.exec("ROLLBACK"); } catch { committed = null; throw new Error("X_FILE_COMMIT_RESULT_UNKNOWN", { cause: error }); }
        }
        if (commitAttempted) {
          committed = null;
          try {
            const observedSchema = sourceRegistrySchemaFingerprint(target), observedVersion = Number(target.prepare("PRAGMA user_version").get()!.user_version);
            if (observedVersion === 11 && observedSchema === X_PAGE_FILE_CLONE_SCHEMA_SHA256) {
              const identity = target.prepare("SELECT manifest_json FROM x_page_file_clone_identity_v1 WHERE singleton_id=1").get();
              if (identity?.manifest_json === manifestJson) {
                committed = true; checkDatabase(target, X_PAGE_FILE_CLONE_SCHEMA_SHA256, 11); assertPreserved(target, before, oldObjects, registry, manifest);
              }
            } else if (observedVersion === 10 && observedSchema === X_PAGE_FILE_CLONE_PREDECESSOR_SHA256 && canonical(tableSnapshot(target, Object.keys(before), false)) === canonical(before) && canonical(target.prepare("SELECT * FROM source_registry_v1 ORDER BY source_id").all()) === canonical(registry)) committed = false;
          } catch { /* Preserve the observed committed flag; unreadable outcome stays unknown. */ }
        }
        throw error;
      }
    } else {
      checkDatabase(target, X_PAGE_FILE_CLONE_SCHEMA_SHA256, 11); assertPreserved(target, before, oldObjects, registry, manifest);
      const identity = target.prepare("SELECT * FROM x_page_file_clone_identity_v1").all();
      assert(identity.length === 1 && identity[0].manifest_json === manifestJson && identity[0].source_sha256 === manifest.source.sha256 && identity[0].migration_sha256 === X_PAGE_FILE_CLONE_MIGRATION_SHA256 && identity[0].predecessor_schema_sha256 === X_PAGE_FILE_CLONE_PREDECESSOR_SHA256 && identity[0].target_schema_sha256 === X_PAGE_FILE_CLONE_SCHEMA_SHA256 && identity[0].preserved_history_sha256 === historySha256 && identity[0].selection_sha256 === manifest.selectionSha256 && identity[0].applied_at === manifest.appliedAt && identity[0].evidence_class === manifest.evidenceClass, "X_FILE_REPLAY_IDENTITY_DRIFT"); committed = true;
    }
    if (existsSync("failure.json")) {
      assert(privateOutputFile("failure.json").size <= 64 * 1024, "X_FILE_FAILURE_RECEIPT_CONFLICT");
      const priorFailure = JSON.parse(readFileSync("failure.json", "utf8"));
      assert(priorFailure.manifestSha256 === hash(manifestJson) && [true, false, null].includes(priorFailure.databaseCommitted) && typeof priorFailure.reason === "string", "X_FILE_FAILURE_RECEIPT_CONFLICT");
    }
    target.close(); target = undefined;
    fsyncSync(targetFd);
    source.exec("ROLLBACK"); source.close(); source = undefined; sourceUnchanged(manifest, sourceFd); checkOutput();
    const receipt = canonical({ schemaVersion: "x-page-file-clone-receipt-v1", databaseCommitted: true, evidenceClass: manifest.evidenceClass, manifestSha256: hash(manifestJson), sourceSha256: manifest.source.sha256,
      predecessorSchemaSha256: X_PAGE_FILE_CLONE_PREDECESSOR_SHA256, migrationSha256: X_PAGE_FILE_CLONE_MIGRATION_SHA256, schemaSha256: X_PAGE_FILE_CLONE_SCHEMA_SHA256, selectionSha256: manifest.selectionSha256, preservedHistorySha256: historySha256, databasePath, appliedAt: manifest.appliedAt });
    let receiptWritten = false, receiptFailureReasonCode: string | null = null;
    try {
      writeCommittedReceipt(".", "receipt.json", receipt, hash(manifestJson));
      const fd = openSync(".", constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); }
      receiptWritten = true;
    } catch (error) { receiptFailureReasonCode = error instanceof Error && error.message === "X_FILE_RECEIPT_CONFLICT" ? error.message : "X_FILE_RECEIPT_WRITE_FAILED"; /* The committed immutable DB identity is the recoverable receipt. */ }
    checkOutput();
    return Object.freeze({ databasePath, receiptPath, databaseCommitted: true, replay: !created, receiptWritten, receiptFailureReasonCode, schemaSha256: X_PAGE_FILE_CLONE_SCHEMA_SHA256 });
  } catch (error) {
    // Failure records are also relative to the verified output inode. A replaced
    // caller pathname never redirects clone, journal, receipt or cleanup writes.
    if (created && outputAnchored) {
      try {
        const held = lstatSync("."); assert(held.dev === directoryIdentity!.dev && held.ino === directoryIdentity!.ino, "X_FILE_OUTPUT_IDENTITY_DRIFT");
        syncWriteExclusive("failure.json", canonical({ databaseCommitted: committed, reason: error instanceof Error ? error.message : "X_FILE_FAILED", manifestSha256: hash(manifestJson) }));
      } catch { /* Preserve original failure and never overwrite existing evidence. */ }
    }
    if (committed === true) throw new Error("X_FILE_COMMITTED_POSTCHECK_FAILED", { cause: error });
    if (committed === null) throw new Error("X_FILE_COMMIT_RESULT_UNKNOWN", { cause: error });
    throw error;
  } finally {
    try { if (target?.isOpen) target.close(); if (source?.isOpen) source.close(); if (targetFd !== undefined) closeSync(targetFd); closeSync(sourceFd); }
    finally { if (cwdChanged) process.chdir(previousCwd); }
  }
}
