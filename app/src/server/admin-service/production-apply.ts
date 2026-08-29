import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../db/profile.ts";
import {
  backupQuiescedLiveForPromotion,
  isQuiescedLive,
  QuiesceError,
  type LiveBase,
  type QuiescedSchema6,
  type QuiescedLive
} from "./quiesce-fence.ts";
import {
  applyIndependentRssSourcesMigration,
  applyInternalOperationMigration,
  applySecondRssAutosportMigration
} from "../review-real/migration.ts";
import {
  applyBilingualMigration,
  readBilingualMigrationSql
} from "../rss/bilingual-migration.ts";
import {
  applySourceRegistryMigration,
  readSourceRegistryMigrationSql,
  sourceRegistrySchemaFingerprint,
  SOURCE_REGISTRY_MIGRATION_SHA256,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  type SourceRegistryMigrationManifest
} from "../rss/source-registry-migration.ts";
import { applyXManualInboxMigration } from "../tweet-inbox/repository.ts";

export const ADMIN_APPLY_STAGE_SCHEMA_VERSION = "f1plus1-admin-apply-stage-v1" as const;
export const ADMIN_APPLY_PROMOTION_SCHEMA_VERSION = "f1plus1-admin-apply-promotion-v1" as const;

type EntryIdentity = Readonly<{ path: string; dev: number; ino: number; nlink: number; uid: number; mode: number }>;

export type StageIdentity = Readonly<{
  path: string;
  pathSha256: string;
  dev: number;
  ino: number;
  nlink: number;
  uid: number;
  mode: number;
  sha256: string;
  userVersion: number;
  schemaFingerprintSha256: string;
  integrityCheck: string;
  foreignKeyCheckOk: boolean;
  phase: string;
  globalStop: string;
  recovery: string;
  automaticReviewerOperations: number;
  automaticPublisherOperations: number;
  automaticOutboxOperations: number;
  sourceRegistryCount: number;
  rssSourceCount: number;
  xManualSourceCount: number;
  sourceRssConfigCount: number;
}>;

export type StageProductionInput = Readonly<{
  stageRoot: string;
  migrationRoot: string;
  sourceRegistryManifest: SourceRegistryMigrationManifest;
  quiescedLive: QuiescedLive;
}>;

/** The explicit production path for the current schema-6 live database. */
export type StageSchema6To10Input = Readonly<{
  stageRoot: string;
  migrationRoot: string;
  sourceRegistryManifest: SourceRegistryMigrationManifest;
  quiescedLive: QuiescedSchema6;
}>;

export type StageTestHooks = Readonly<{
  beforeMigrate?: (stageDbPath: string) => void;
  failAfterVersion?: 7 | 8 | 9 | 10;
  clock?: () => number;
}>;

export type StageResult = Readonly<{
  live: LiveBase;
  stage: StageIdentity;
  migrationsApplied: readonly number[];
  migrationSqlSha256: Readonly<Record<number, string>>;
  sourceRegistryManifestSha256: string;
  sourceSnapshotSha256: string;
  quiesceReceiptSha256: string;
  quiesceId: string;
}>;

export type PromotionReceipt = Readonly<{
  schemaVersion: typeof ADMIN_APPLY_PROMOTION_SCHEMA_VERSION;
  state: "promoted";
  promotedAt: string;
  livePath: string;
  backupPath: string;
  quiesceId: string;
  quiesceReceiptSha256: string;
  old: Readonly<{
    path: string;
    dev: number;
    ino: number;
    nlink: number;
    uid: number;
    mode: number;
    sha256: string;
    userVersion: number;
  }>;
  new: Readonly<{
    path: string;
    dev: number;
    ino: number;
    nlink: number;
    uid: number;
    mode: number;
    sha256: string;
    userVersion: number;
    schemaFingerprintSha256: string;
  }>;
}>;

export type PromotionResult = Readonly<{
  receipt: PromotionReceipt;
  receiptSha256: string;
  backupPath: string;
}>;

export type PromoteStagedProductionInput = Readonly<{
  stageResult: StageResult;
  quiescedLive: QuiescedSchema6;
  backupPath?: string;
}>;

export type RollbackPromotionInput = Readonly<{
  promotion: PromotionResult | PromotionReceipt;
}>;

export class StageApplyError extends Error {
  readonly code: string;
  readonly residue?: readonly string[];
  constructor(code: string, message?: string, residue?: readonly string[]) {
    super(message ? `${code}: ${message}` : code);
    this.name = "StageApplyError";
    this.code = code;
    this.residue = residue;
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code: string, message?: string): never {
  throw new StageApplyError(code, message);
}

function userVersion(database: DatabaseSync): number {
  return Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
}

function assertSameUid(uid: number, code: string): void {
  let current: number | undefined;
  try {
    current = typeof process.getuid === "function" ? process.getuid() : undefined;
  } catch {
    current = undefined;
  }
  if (typeof current !== "number") fail(code, "uid unavailable");
  if (uid !== current) fail(code, `uid=${uid},current=${current}`);
}

function assertRegularPrivateFile(path: string, code: string): EntryIdentity {
  const lstat = lstatSync(path);
  if (!lstat.isFile() || lstat.isSymbolicLink()) fail(code, `${path} not regular file`);
  if (lstat.nlink !== 1) fail(code, `${path} nlink!=1`);
  if ((lstat.mode & 0o077) !== 0) fail(code, `${path} not owner-private`);
  assertSameUid(lstat.uid, code);
  return {
    path: realpathSync(path),
    dev: lstat.dev,
    ino: lstat.ino,
    nlink: lstat.nlink,
    uid: lstat.uid,
    mode: lstat.mode & 0o7777
  };
}

function assertRegularPlainFile(path: string, code: string): void {
  const lstat = lstatSync(path);
  if (!lstat.isFile() || lstat.isSymbolicLink()) fail(code, `${path} not regular file`);
  if (lstat.nlink !== 1) fail(code, `${path} nlink!=1`);
  assertSameUid(lstat.uid, code);
}

function assertOwnedDir(path: string, code: string): EntryIdentity {
  const lstat = lstatSync(path);
  if (!lstat.isDirectory() || lstat.isSymbolicLink()) fail(code, `${path} not directory`);
  if ((lstat.mode & 0o077) !== 0) fail(code, `${path} not owner-private`);
  assertSameUid(lstat.uid, code);
  return {
    path: realpathSync(path),
    dev: lstat.dev,
    ino: lstat.ino,
    nlink: lstat.nlink,
    uid: lstat.uid,
    mode: lstat.mode & 0o7777
  };
}

export function assertSameVolume(liveDev: number, stageDev: number): void {
  if (liveDev !== stageDev) fail("STAGE_DIFFERENT_VOLUME");
}

function assertMigrationRoot(migrationRoot: string): string {
  // The repository's frozen migration directory is source-controlled and
  // intentionally readable (the migration bytes are protected by the exact
  // hashes below).  Keep ownership/regular-directory checks here while leaving
  // the owner-private requirement to the live/stage/backup data paths.
  const resolved = resolve(migrationRoot);
  const lstat = lstatSync(resolved);
  if (!lstat.isDirectory() || lstat.isSymbolicLink()) fail("MIGRATION_ROOT_INVALID", `${resolved} not directory`);
  assertSameUid(lstat.uid, "MIGRATION_ROOT_INVALID");
  const canonical = realpathSync(resolved);
  for (const file of [
    "0005_second_rss_autosport.sql",
    "0006_independent_rss_racefans_the_race.sql",
    "0007_internal_operation_recovery_phase.sql",
    "0008_x_manual_inbox.sql"
  ]) {
    assertRegularPlainFile(join(canonical, file), "MIGRATION_FILE_INVALID");
  }
  return canonical;
}

function createDedicatedStageDir(stageRoot: string, live: LiveBase): { dir: string; identity: EntryIdentity; rootIdentity: EntryIdentity } {
  const root = assertOwnedDir(stageRoot, "STAGE_ROOT_INVALID").path;
  const rootIdentity = assertOwnedDir(root, "STAGE_ROOT_INVALID");
  assertSameVolume(live.dev, rootIdentity.dev);
  const name = `apply-stage-${randomBytes(16).toString("hex")}`;
  const dir = join(root, name);
  if (existsSync(dir)) fail("STAGE_DIR_NOT_FRESH");
  mkdirSync(dir, { mode: 0o700, recursive: false });
  const identity = assertOwnedDir(dir, "STAGE_DIR_INVALID");
  return { dir, identity, rootIdentity };
}

function assertStageLocationUnchanged(stage: { dir: string; identity: EntryIdentity; rootIdentity: EntryIdentity }): void {
  const identity = assertOwnedDir(stage.dir, "STAGE_DIR_MUTATED");
  if (identity.dev !== stage.identity.dev || identity.ino !== stage.identity.ino) fail("STAGE_DIR_MUTATED");
  const rootIdentity = assertOwnedDir(stage.rootIdentity.path, "STAGE_ROOT_MUTATED");
  if (rootIdentity.dev !== stage.rootIdentity.dev || rootIdentity.ino !== stage.rootIdentity.ino) fail("STAGE_ROOT_MUTATED");
}

function assertStageFileIdentity(stageDbPath: string): EntryIdentity {
  const identity = assertRegularPrivateFile(stageDbPath, "STAGE_FILE_INVALID");
  if (basename(identity.path) !== basename(stageDbPath)) fail("STAGE_FILE_SYMLINK");
  return identity;
}

function assertStageFileUnchanged(identity: EntryIdentity): void {
  const current = assertRegularPrivateFile(identity.path, "STAGE_FILE_INVALID");
  if (current.dev !== identity.dev || current.ino !== identity.ino || current.nlink !== identity.nlink ||
      current.uid !== identity.uid || current.mode !== identity.mode || current.path !== identity.path) {
    fail("STAGE_FILE_MUTATED");
  }
}

function chmodStageFile(stageDbPath: string): void {
  const before = lstatSync(stageDbPath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail("STAGE_FILE_INVALID");
  const dev = before.dev;
  const ino = before.ino;
  chmodSync(stageDbPath, 0o600);
  const after = lstatSync(stageDbPath);
  if (after.dev !== dev || after.ino !== ino) fail("STAGE_FILE_MUTATED");
}

function cleanupDedicatedStage(stage: { dir: string }): void {
  const expectedNames = [
    "stage.sqlite",
    "stage.sqlite-wal",
    "stage.sqlite-shm",
    "stage.sqlite-journal",
    "stage.sqlite.backup",
    "stage.sqlite.journal"
  ];
  const residue: string[] = [];
  for (const name of expectedNames) {
    const path = join(stage.dir, name);
    if (existsSync(path)) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        residue.push(path);
      }
    }
  }
  let remaining: string[] = [];
  try {
    remaining = existsSync(stage.dir) ? readdirSync(stage.dir) : [];
  } catch {
    throw new StageApplyError("STAGE_CLEANUP_FAILED", "readdir of stage failed");
  }
  for (const name of remaining) residue.push(join(stage.dir, name));
  if (residue.length > 0) {
    throw new StageApplyError("STAGE_CLEANUP_FAILED", `residue=[${residue.join(", ")}]`, residue);
  }
  if (existsSync(stage.dir)) {
    try {
      rmdirSync(stage.dir);
    } catch {
      throw new StageApplyError("STAGE_CLEANUP_FAILED", `rmdir of stage failed: ${stage.dir}`);
    }
  }
}

function assertStageSchema(stageDbPath: string, expectedVersion: number, errorCode: string): void {
  const database = new DatabaseSync(stageDbPath, { readOnly: true });
  try {
    if (userVersion(database) !== expectedVersion) fail(errorCode, `user_version=${userVersion(database)}`);
    const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
    if (integrity.integrity_check !== "ok") fail("STAGE_BACKUP_INTEGRITY");
    if (database.prepare("PRAGMA foreign_key_check").get() !== undefined) fail("STAGE_BACKUP_FK");
  } finally {
    database.close();
  }
}

function assertStageSchema4(stageDbPath: string): void {
  assertStageSchema(stageDbPath, 4, "STAGE_BACKUP_NOT_SCHEMA4");
}

function assertBackupSchema6(backupPath: string): void {
  assertStageSchema(backupPath, 6, "PROMOTION_BACKUP_NOT_SCHEMA6");
}

function assertMigrationVersion(database: DatabaseSync, version: number): void {
  if (userVersion(database) !== version) fail("MIGRATION_VERSION_DRIFT", `expected=${version}`);
}

type StageApplyInput = StageProductionInput | StageSchema6To10Input;

function migrateStage(stageDbPath: string, input: StageApplyInput, sourceVersion: 4 | 6, failAfter: 7 | 8 | 9 | 10 | null): { applied: readonly number[]; sqlSha256: Readonly<Record<number, string>> } {
  const database = new DatabaseSync(stageDbPath);
  const applied: number[] = [];
  const sqlSha256: Record<number, string> = {};
  const readMigration = (file: string, version: number): string => {
    const path = join(input.migrationRoot, file);
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail("MIGRATION_FILE_INVALID", file);
    const bytes = readFileSync(path);
    const after = lstatSync(path);
    if (after.dev !== before.dev || after.ino !== before.ino || after.nlink !== before.nlink ||
        after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      fail("MIGRATION_SWAP", file);
    }
    sqlSha256[version] = sha256(bytes);
    return bytes.toString("utf8");
  };
  const step = (version: number, file: string, apply: (sql: string) => void): void => {
    apply(readMigration(file, version));
    assertMigrationVersion(database, version);
    applied.push(version);
    if (failAfter === version) fail("TEST_FAIL_AFTER_VERSION", `version=${version}`);
  };
  try {
    if (sourceVersion === 4) {
      step(5, "0005_second_rss_autosport.sql", (sql) => applySecondRssAutosportMigration(database, sql));
      step(6, "0006_independent_rss_racefans_the_race.sql", (sql) => applyIndependentRssSourcesMigration(database, sql));
    } else if (userVersion(database) !== 6) {
      fail("STAGE_SOURCE_NOT_SCHEMA6", `user_version=${userVersion(database)}`);
    }
    step(7, "0007_internal_operation_recovery_phase.sql", (sql) => applyInternalOperationMigration(database, sql));
    step(8, "0008_x_manual_inbox.sql", (sql) => applyXManualInboxMigration(database, sql));
    const sql9 = readBilingualMigrationSql();
    sqlSha256[9] = sha256(sql9);
    applyBilingualMigration(database, sql9, { applyEnabled: true });
    assertMigrationVersion(database, 9);
    applied.push(9);
    if (failAfter === 9) fail("TEST_FAIL_AFTER_VERSION", "version=9");
    const sql10 = readSourceRegistryMigrationSql();
    const sha10 = sha256(sql10);
    if (sha10 !== SOURCE_REGISTRY_MIGRATION_SHA256) fail("MIGRATION_SQL_HASH_MISMATCH", `schema10=${sha10}`);
    sqlSha256[10] = sha10;
    applySourceRegistryMigration(database, sql10, input.sourceRegistryManifest, { applyEnabled: true });
    assertMigrationVersion(database, 10);
    applied.push(10);
    if (failAfter === 10) fail("TEST_FAIL_AFTER_VERSION", "version=10");
    database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch (error) {
    try {
      database.close();
    } catch {
      // already closed
    }
    throw error;
  }
  database.close();
  return { applied, sqlSha256 };
}

function assertNoAttachedOrTemp(database: DatabaseSync): void {
  const databases = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (databases.some((row) => row.name !== "main" && row.name !== "temp")) fail("STAGE_ATTACHED_DATABASE");
  if (database.prepare("SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1").get() !== undefined) fail("STAGE_TEMP_SCHEMA");
}

export function validateStageSchema10(stageDbPath: string): StageIdentity {
  const database = new DatabaseSync(stageDbPath, { readOnly: true });
  try {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
    if (userVersion(database) !== 10) fail("STAGE_NOT_SCHEMA10");
    const fingerprint = sourceRegistrySchemaFingerprint(database);
    if (fingerprint !== SOURCE_REGISTRY_SCHEMA10_SHA256) fail("STAGE_SCHEMA10_DRIFT");
    const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
    if (integrity.integrity_check !== "ok") fail("STAGE_INTEGRITY");
    if (database.prepare("PRAGMA foreign_key_check").get() !== undefined) fail("STAGE_FK");
    assertNoAttachedOrTemp(database);
    const controlRows = database.prepare("SELECT phase,global_stop_state,recovery_state FROM internal_control WHERE singleton_id=1").all() as Array<Record<string, unknown>>;
    if (controlRows.length !== 1) fail("STAGE_CONTROL_ROWS", `rows=${controlRows.length}`);
    const control = controlRows[0];
    if (control.phase !== "disabled" || control.global_stop_state !== "stopped" || control.recovery_state !== "fenced") fail("STAGE_CONTROL_STATE");
    const reviewerOps = Number((database.prepare("SELECT count(*) AS count FROM internal_operation WHERE owner_process='automatic_reviewer'").get() as Record<string, unknown>).count);
    const publisherOps = Number((database.prepare("SELECT count(*) AS count FROM internal_operation WHERE owner_process='automatic_publisher'").get() as Record<string, unknown>).count);
    if (reviewerOps !== 0 || publisherOps !== 0) fail("STAGE_AUTO_OPERATION_NOT_ZERO", `reviewer=${reviewerOps},publisher=${publisherOps}`);
    const autoOutbox = Number((database.prepare("SELECT count(*) AS count FROM internal_operation_outbox WHERE operation_id IN (SELECT operation_id FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher'))").get() as Record<string, unknown>).count);
    if (autoOutbox !== 0) fail("STAGE_AUTO_OUTBOX_NOT_ZERO");
    const sourceCount = Number((database.prepare("SELECT count(*) AS count FROM source_registry_v1").get() as Record<string, unknown>).count);
    const rssCount = Number((database.prepare("SELECT count(*) AS count FROM source_registry_v1 WHERE source_kind='rss'").get() as Record<string, unknown>).count);
    const xCount = Number((database.prepare("SELECT count(*) AS count FROM source_registry_v1 WHERE source_kind='x_manual'").get() as Record<string, unknown>).count);
    const configCount = Number((database.prepare("SELECT count(*) AS count FROM source_registry_rss_config_v1").get() as Record<string, unknown>).count);
    if (sourceCount !== 63 || rssCount !== 4 || xCount !== 59 || configCount !== 4) fail("STAGE_SOURCE_COUNTS", `total=${sourceCount},rss=${rssCount},x=${xCount},config=${configCount}`);
  } finally {
    database.close();
  }
  const entity = assertRegularPrivateFile(stageDbPath, "STAGE_FILE_INVALID");
  return Object.freeze({
    path: entity.path,
    pathSha256: sha256(entity.path),
    dev: entity.dev,
    ino: entity.ino,
    nlink: entity.nlink,
    uid: entity.uid,
    mode: entity.mode,
    sha256: sha256(readFileSync(stageDbPath)),
    userVersion: 10,
    schemaFingerprintSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
    integrityCheck: "ok",
    foreignKeyCheckOk: true,
    phase: "disabled",
    globalStop: "stopped",
    recovery: "fenced",
    automaticReviewerOperations: 0,
    automaticPublisherOperations: 0,
    automaticOutboxOperations: 0,
    sourceRegistryCount: 63,
    rssSourceCount: 4,
    xManualSourceCount: 59,
    sourceRssConfigCount: 4
  });
}

function reflect(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

function encodeValue(value: unknown): [string, string | null] {
  if (value === null || value === undefined) return ["null", null];
  if (typeof value === "boolean") return ["bool", String(value)];
  if (typeof value === "bigint") return ["int", String(value)];
  if (typeof value === "number") return Number.isInteger(value) ? ["int", String(value)] : ["real", String(value)];
  if (typeof value === "string") return ["text", Buffer.from(value, "utf8").toString("base64")];
  if (value instanceof Uint8Array) return ["blob", Buffer.from(value).toString("hex")];
  throw new Error("unhandled provenance value");
}

function snapshotFingerprint(dbPath: string): string {
  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const userVersion = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
    const schema = database.prepare(
      "SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name,tbl_name,sql"
    ).all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>;
    const state: Record<string, unknown> = {};
    const tableNames = schema.filter((entry) => entry.type === "table").map((entry) => entry.name);
    for (const name of tableNames) {
      const columns = database.prepare(`PRAGMA table_info(${reflect(name)})`).all() as Array<{ name: string; pk: number }>;
      const pkColumns = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
      const orderBy = pkColumns.length > 0 ? pkColumns.map((column) => reflect(column)).join(",") : "rowid";
      const rows = database.prepare(`SELECT * FROM ${reflect(name)} ORDER BY ${orderBy}`).all() as Array<Record<string, unknown>>;
      state[name] = {
        columns: columns.map((column) => column.name),
        rows: rows.map((row) => columns.map((column) => encodeValue(row[column.name])))
      };
    }
    return sha256(canonicalJson({
      schemaVersion: "f1plus1-provenance-v2",
      userVersion,
      schema: schema.map((entry) => ({ type: entry.type, name: entry.name, tbl_name: entry.tbl_name, sql: entry.sql })),
      tables: state
    }));
  } finally {
    database.close();
  }
}

async function stageProductionApplyInternal(input: StageApplyInput, hooks: StageTestHooks | null, sourceVersion: 4 | 6): Promise<StageResult> {
  if (!isQuiescedLive(input.quiescedLive)) fail("QUIESCE_HANDLE_INVALID");
  if (input.quiescedLive.base.userVersion !== sourceVersion) {
    fail(sourceVersion === 4 ? "QUIESCE_LIVE_NOT_SCHEMA4" : "QUIESCE_LIVE_NOT_SCHEMA6", `user_version=${input.quiescedLive.base.userVersion}`);
  }
  const live = input.quiescedLive.base;
  const migrationRoot = assertMigrationRoot(input.migrationRoot);
  let stage: ReturnType<typeof createDedicatedStageDir> | null = null;
  let stageDbPath = "";
  try {
    stage = createDedicatedStageDir(input.stageRoot, live);
    stageDbPath = join(stage.dir, "stage.sqlite");
    await input.quiescedLive.backupTo(stageDbPath);
    chmodStageFile(stageDbPath);
    const stageFile = assertStageFileIdentity(stageDbPath);
    assertStageLocationUnchanged(stage);
    if (sourceVersion === 4) assertStageSchema4(stageDbPath);
    else assertStageSchema(stageDbPath, 6, "STAGE_BACKUP_NOT_SCHEMA6");
    const sourceSnapshotSha256 = snapshotFingerprint(live.path);
    const stageSnapshotSha256 = snapshotFingerprint(stageDbPath);
    if (sourceSnapshotSha256 !== stageSnapshotSha256) fail("STAGE_PROVENANCE_MISMATCH");
    hooks?.beforeMigrate?.(stageDbPath);
    assertStageFileUnchanged(stageFile);
    const migrated = migrateStage(stageDbPath, input, sourceVersion, hooks?.failAfterVersion ?? null);
    assertStageFileUnchanged(stageFile);
    assertStageLocationUnchanged(stage);
    const stageIdentity = validateStageSchema10(stageDbPath);
    assertStageFileUnchanged(stageFile);
    if (sha256(readFileSync(stageDbPath)) !== stageIdentity.sha256) fail("STAGE_SHA_MISMATCH");
    return Object.freeze({
      live,
      stage: stageIdentity,
      migrationsApplied: migrated.applied,
      migrationSqlSha256: migrated.sqlSha256,
      sourceRegistryManifestSha256: sha256(canonicalJson(input.sourceRegistryManifest)),
      sourceSnapshotSha256,
      quiesceReceiptSha256: input.quiescedLive.receiptSha256,
      quiesceId: input.quiescedLive.quiesceId
    });
  } catch (error) {
    let cleanupError: unknown;
    if (stage) {
      try {
        cleanupDedicatedStage(stage);
      } catch (cleanupFailure) {
        cleanupError = cleanupFailure;
      }
    }
    let releaseError: unknown;
    try {
      input.quiescedLive.abortAndRelease();
    } catch (abortFailure) {
      releaseError = abortFailure;
    }
    if (releaseError) {
      const original = error instanceof Error ? error.message : String(error);
      const releaseMessage = releaseError instanceof Error ? releaseError.message : String(releaseError);
      throw new StageApplyError("QUIESCE_RELEASE_FAILED", `original=[${original}] release=[${releaseMessage}]`);
    }
    if (cleanupError instanceof StageApplyError) {
      const original = error instanceof Error ? error.message : String(error);
      if (cleanupError.code === "STAGE_CLEANUP_FAILED") {
        throw new StageApplyError("STAGE_CLEANUP_FAILED", `original=[${original}] residue=[${(cleanupError.residue ?? []).join(", ")}]`, cleanupError.residue);
      }
    }
    if (cleanupError) throw cleanupError;
    if (error instanceof QuiesceError) throw new StageApplyError(error.code, error.message);
    if (error instanceof StageApplyError) throw error;
    throw error;
  }
}

export async function stageProductionApply(input: StageProductionInput): Promise<StageResult> {
  return stageProductionApplyInternal(input, null, 4);
}

export async function stageProductionApplyForTest(input: StageProductionInput, hooks: StageTestHooks): Promise<StageResult> {
  if (process.env.NODE_ENV !== "test") throw new StageApplyError("TEST_HOOKS_FORBIDDEN");
  return stageProductionApplyInternal(input, hooks, 4);
}

export async function stageSchema6To10(input: StageSchema6To10Input): Promise<StageResult> {
  return stageProductionApplyInternal(input, null, 6);
}

export async function stageSchema6To10ForTest(input: StageSchema6To10Input, hooks: StageTestHooks): Promise<StageResult> {
  if (process.env.NODE_ENV !== "test") throw new StageApplyError("TEST_HOOKS_FORBIDDEN");
  return stageProductionApplyInternal(input, hooks, 6);
}

// Descriptive aliases keep the public entry point discoverable without
// changing the original schema-4 function names used by existing callers.
export const stageProductionApplyFromSchema6 = stageSchema6To10;
export const stageProductionApplyFromSchema6ForTest = stageSchema6To10ForTest;

function fsyncDirectory(dirPath: string): void {
  const fd = openSync(dirPath, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertLiveStillMatches(livePath: string, expected: LiveBase): EntryIdentity {
  const current = assertRegularPrivateFile(livePath, "PROMOTION_LIVE_NOT_REGULAR");
  if (current.path !== expected.path || current.dev !== expected.dev || current.ino !== expected.ino ||
      current.nlink !== expected.nlink || current.uid !== expected.uid || current.mode !== expected.mode) {
    fail("PROMOTION_LIVE_MUTATED");
  }
  if (sha256(readFileSync(current.path)) !== expected.sha256) fail("PROMOTION_LIVE_MUTATED");
  const database = new DatabaseSync(current.path, { readOnly: true });
  try {
    if (userVersion(database) !== expected.userVersion) fail("PROMOTION_LIVE_MUTATED");
  } finally {
    database.close();
  }
  return current;
}

function assertStageResultMatches(result: StageResult, handle: QuiescedSchema6): StageIdentity {
  if (result.quiesceId !== handle.quiesceId || result.quiesceReceiptSha256 !== handle.receiptSha256) {
    fail("PROMOTION_QUIESCE_MISMATCH");
  }
  if (result.live.path !== handle.base.path || result.live.dev !== handle.base.dev || result.live.ino !== handle.base.ino ||
      result.live.nlink !== handle.base.nlink || result.live.uid !== handle.base.uid || result.live.mode !== handle.base.mode ||
      result.live.sha256 !== handle.base.sha256 || result.live.userVersion !== 6) {
    fail("PROMOTION_LIVE_MISMATCH");
  }
  if (result.migrationsApplied.length !== 4 || result.migrationsApplied.some((version, index) => version !== [7, 8, 9, 10][index])) {
    fail("PROMOTION_MIGRATION_SET");
  }
  const stage = validateStageSchema10(result.stage.path);
  for (const field of ["path", "dev", "ino", "nlink", "uid", "mode", "sha256"] as const) {
    if (stage[field] !== result.stage[field]) fail("PROMOTION_STAGE_MUTATED", field);
  }
  if (stage.path === handle.base.path || stage.dev !== handle.base.dev || stage.nlink !== 1 || stage.mode & 0o077) {
    fail("PROMOTION_STAGE_INVALID");
  }
  const stageParent = assertOwnedDir(dirname(stage.path), "PROMOTION_STAGE_PARENT_INVALID");
  assertSameVolume(handle.base.dev, stageParent.dev);
  if (stage.userVersion !== 10 || stage.schemaFingerprintSha256 !== SOURCE_REGISTRY_SCHEMA10_SHA256) {
    fail("PROMOTION_STAGE_INVALID");
  }
  return stage;
}

function defaultPromotionBackupPath(livePath: string, quiesceId: string): string {
  return join(dirname(livePath), `.${basename(livePath)}.${quiesceId}.schema6.backup`);
}

function assertBackupDestination(livePath: string, backupPath: string, liveDev: number): string {
  const canonicalLive = realpathSync(livePath);
  const resolved = resolve(backupPath);
  if (resolved === canonicalLive || pathExists(resolved)) fail("PROMOTION_BACKUP_EXISTS", resolved);
  const parent = assertOwnedDir(dirname(resolved), "PROMOTION_BACKUP_PARENT_INVALID");
  if (parent.path !== dirname(canonicalLive)) fail("PROMOTION_BACKUP_NOT_SAME_DIR");
  assertSameVolume(liveDev, parent.dev);
  return resolved;
}

function removeOwnedFile(path: string): void {
  try {
    const current = lstatSync(path);
    if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || (current.mode & 0o077) !== 0) return;
    unlinkSync(path);
    fsyncDirectory(dirname(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Atomically promote a validated schema-10 stage over a held schema-6 live
 * database.  All checks and the rollback backup happen before rename; after
 * rename the caller can use rollbackProductionPromotion if a later deployment
 * step cannot update its pointer/configuration.
 */
export async function promoteStagedProduction(input: PromoteStagedProductionInput): Promise<PromotionResult> {
  const handle = input.quiescedLive;
  if (!isQuiescedLive(handle)) {
    fail("PROMOTION_QUIESCE_INVALID");
  }
  let backupCreated = false;
  let renamed = false;
  let backupPath = "";
  let backupIdentity: EntryIdentity | null = null;
  try {
    if (handle.base.userVersion !== 6 || handle.schemaVersion !== "f1plus1-admin-quiesce-schema6-v1") {
      fail("PROMOTION_QUIESCE_INVALID");
    }
    const livePath = realpathSync(handle.base.path);
    const liveParent = assertOwnedDir(dirname(livePath), "PROMOTION_LIVE_PARENT_INVALID");
    const stage = assertStageResultMatches(input.stageResult, handle);
    assertLiveStillMatches(livePath, handle.base);
    backupPath = assertBackupDestination(livePath, input.backupPath ?? defaultPromotionBackupPath(livePath, handle.quiesceId), handle.base.dev);
    await backupQuiescedLiveForPromotion(handle, backupPath);
    backupCreated = true;
    backupIdentity = assertRegularPrivateFile(backupPath, "PROMOTION_BACKUP_INVALID");
    assertSameVolume(handle.base.dev, backupIdentity.dev);
    assertBackupSchema6(backupPath);
    fsyncDirectory(liveParent.path);

    // Re-read both identities after the potentially asynchronous backup and
    // immediately before the only irreversible filesystem operation.
    assertLiveStillMatches(livePath, handle.base);
    const stageBeforeRename = validateStageSchema10(stage.path);
    if (stageBeforeRename.path !== stage.path || stageBeforeRename.dev !== stage.dev || stageBeforeRename.ino !== stage.ino ||
        stageBeforeRename.nlink !== stage.nlink || stageBeforeRename.uid !== stage.uid || stageBeforeRename.mode !== stage.mode ||
        stageBeforeRename.sha256 !== stage.sha256) {
      fail("PROMOTION_STAGE_MUTATED");
    }

    renameSync(stage.path, livePath);
    renamed = true;
    fsyncDirectory(liveParent.path);
    const promoted = assertRegularPrivateFile(livePath, "PROMOTION_NEW_INVALID");
    const promotedDatabase = new DatabaseSync(livePath, { readOnly: true });
    let promotedVersion: number;
    try {
      promotedVersion = userVersion(promotedDatabase);
    } finally {
      promotedDatabase.close();
    }
    if (promotedVersion !== 10) fail("PROMOTION_NEW_NOT_SCHEMA10");
    const receipt: PromotionReceipt = Object.freeze({
      schemaVersion: ADMIN_APPLY_PROMOTION_SCHEMA_VERSION,
      state: "promoted",
      promotedAt: new Date().toISOString(),
      livePath,
      backupPath,
      quiesceId: handle.quiesceId,
      quiesceReceiptSha256: handle.receiptSha256,
      old: Object.freeze({
        path: livePath,
        dev: handle.base.dev,
        ino: handle.base.ino,
        nlink: handle.base.nlink,
        uid: handle.base.uid,
        mode: handle.base.mode,
        sha256: handle.base.sha256,
        userVersion: handle.base.userVersion
      }),
      new: Object.freeze({
        path: promoted.path,
        dev: promoted.dev,
        ino: promoted.ino,
        nlink: promoted.nlink,
        uid: promoted.uid,
        mode: promoted.mode,
        sha256: sha256(readFileSync(livePath)),
        userVersion: promotedVersion,
        schemaFingerprintSha256: SOURCE_REGISTRY_SCHEMA10_SHA256
      })
    });
    const receiptSha256 = sha256(canonicalJson(receipt));
    handle.consumeAndRelease();
    return Object.freeze({ receipt, receiptSha256, backupPath });
  } catch (error) {
    if (!renamed) {
      if (backupCreated) {
        try {
          if (backupIdentity) {
            const current = lstatSync(backupPath);
            if (current.dev === backupIdentity.dev && current.ino === backupIdentity.ino && current.nlink === backupIdentity.nlink) {
              removeOwnedFile(backupPath);
            }
          }
        } catch {
          // Keep the original pre-rename failure; a leftover private backup is
          // recoverable and must never cause deletion of a replacement path.
        }
      }
      try {
        handle.abortAndRelease();
      } catch (releaseError) {
        throw new StageApplyError("QUIESCE_RELEASE_FAILED", `original=[${error instanceof Error ? error.message : String(error)}] release=[${releaseError instanceof Error ? releaseError.message : String(releaseError)}]`);
      }
      if (error instanceof QuiesceError) throw new StageApplyError(error.code, error.message);
      if (error instanceof StageApplyError) throw error;
      throw new StageApplyError("PROMOTION_PRE_RENAME_FAILED", error instanceof Error ? error.message : String(error));
    }
    // The new inode is live at this point.  Leave the handle/backup available
    // for the caller's explicit rollback and surface the post-rename failure.
    if (error instanceof StageApplyError) throw error;
    throw new StageApplyError("PROMOTION_POST_RENAME_FAILED", error instanceof Error ? error.message : String(error));
  }
}

export const promoteProduction = promoteStagedProduction;
export const promoteSchema6To10 = promoteStagedProduction;

export type RollbackReceipt = Readonly<{
  schemaVersion: "f1plus1-admin-apply-rollback-v1";
  state: "rolled_back";
  rolledBackAt: string;
  livePath: string;
  backupPath: string;
  restored: Readonly<{ dev: number; ino: number; nlink: number; uid: number; mode: number; sha256: string; userVersion: number }>;
  replaced: Readonly<{ dev: number; ino: number; nlink: number; uid: number; mode: number; sha256: string; userVersion: number }>;
}>;

/** Restore the same-directory schema-6 backup over the promoted live inode. */
export function rollbackProductionPromotion(input: RollbackPromotionInput): RollbackReceipt {
  const promotion = "receipt" in input.promotion ? input.promotion.receipt : input.promotion;
  if (promotion.schemaVersion !== ADMIN_APPLY_PROMOTION_SCHEMA_VERSION || promotion.state !== "promoted") {
    fail("ROLLBACK_RECEIPT_INVALID");
  }
  const live = assertRegularPrivateFile(promotion.livePath, "ROLLBACK_LIVE_INVALID");
  const currentSha = sha256(readFileSync(live.path));
  const database = new DatabaseSync(live.path, { readOnly: true });
  let currentVersion: number;
  try {
    currentVersion = userVersion(database);
  } finally {
    database.close();
  }
  if (live.dev !== promotion.new.dev || live.ino !== promotion.new.ino || live.nlink !== promotion.new.nlink ||
      live.uid !== promotion.new.uid || live.mode !== promotion.new.mode || currentSha !== promotion.new.sha256 || currentVersion !== 10) {
    fail("ROLLBACK_LIVE_MISMATCH");
  }
  const backup = assertRegularPrivateFile(promotion.backupPath, "ROLLBACK_BACKUP_INVALID");
  if (backup.dev !== live.dev || dirname(backup.path) !== dirname(live.path)) fail("ROLLBACK_BACKUP_INVALID");
  assertBackupSchema6(backup.path);
  const replaced = Object.freeze({ dev: live.dev, ino: live.ino, nlink: live.nlink, uid: live.uid, mode: live.mode, sha256: currentSha, userVersion: currentVersion });
  try {
    renameSync(backup.path, live.path);
    fsyncDirectory(dirname(live.path));
  } catch (error) {
    throw new StageApplyError("ROLLBACK_RENAME_FAILED", error instanceof Error ? error.message : String(error));
  }
  const restored = assertRegularPrivateFile(live.path, "ROLLBACK_RESTORED_INVALID");
  const restoredDatabase = new DatabaseSync(live.path, { readOnly: true });
  let restoredVersion: number;
  try {
    restoredVersion = userVersion(restoredDatabase);
  } finally {
    restoredDatabase.close();
  }
  if (restoredVersion !== 6) fail("ROLLBACK_RESTORED_NOT_SCHEMA6");
  return Object.freeze({
    schemaVersion: "f1plus1-admin-apply-rollback-v1",
    state: "rolled_back",
    rolledBackAt: new Date().toISOString(),
    livePath: live.path,
    backupPath: promotion.backupPath,
    restored: Object.freeze({ dev: restored.dev, ino: restored.ino, nlink: restored.nlink, uid: restored.uid, mode: restored.mode, sha256: sha256(readFileSync(live.path)), userVersion: restoredVersion }),
    replaced
  });
}

export const rollbackPromotedProduction = rollbackProductionPromotion;
