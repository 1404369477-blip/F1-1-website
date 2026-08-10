import { createHash, randomBytes } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

import { ConfigError, type AppConfig } from "../config/env.ts";
import {
  SOURCE_BRIDGE_SHA256,
  SOURCE_PROJECTION_SHA256,
  SOURCE_REQUIRED_FIELDS,
  SOURCE_SCHEMA_SHA256,
  readSourceFixture,
  sourceProjectionHash,
  sourceRowHash,
  validateSourceRow,
  type SourceRow
} from "../providers/source-fixture.ts";
import {
  assertOrderedMigrationState,
  closeDatabase,
  migrateOrderedDatabase,
  openSafeDatabase,
  readDatabaseSchemaFingerprint,
  readOrderedMigrations,
  readSqliteRuntime,
  withImmediateTransaction,
  type MigrationResult,
  type OrderedMigrationContract,
  type SqliteDatabase
} from "./database.ts";
import {
  SOURCE_MANAGEMENT_PROFILE_ID,
  SOURCE_MANAGEMENT_SQLITE_PATH,
  assertDatabaseProfile,
  assertSingleDatabase,
  canonicalJson
} from "./profile.ts";

export const SOURCE_MANAGEMENT_CONTRACT_SHA256 = "90ee4ed30d325b7b2833582cc0ac8134aefc7fbc2dcd43ec9d20c0f726b2f1fe";
export const SOURCE_MANAGEMENT_DATA_CONTRACT_SHA256 = "4498eea95e8d2461bd3c4bbb1e3ff67de2247a65c0da99951a194b2b9e9d3d95";
export const SOURCE_MANAGEMENT_SECURITY_REPORT_SHA256 = "495bcf8a670cf275c88a67056370e62ec238fc5b38e3a3165dfbb82f3c8ebc6d";
export const SOURCE_MANAGEMENT_SCHEMA_FINGERPRINT_SHA256 = "f6f56bad5a93a486b27eafcae661f79d70ca93b7a04d5cd55c5917ce8aae377d";
export const SOURCE_MANAGEMENT_VALIDATOR_SHA256 = "7f758f9bd907939d4be29dd61d3d195522a6a58e5bb47b8de1dd917858b78ff9";
export const SOURCE_MANAGEMENT_RECORDED_AT = "2026-08-09T00:00:00.000Z";
export const SOURCE_MANAGEMENT_MAX_TASK_WINDOW_SECONDS = 900;

const MIGRATION_FILES = [
  "migrations/0001_local_foundation.sql",
  "migrations/0002_source_fixture.sql",
  "migrations/profiles/source-management-synthetic/0003_source_management_runtime.sql"
] as const;

const OBJECT_MANIFEST: Readonly<Record<number, readonly string[]>> = Object.freeze({
  1: ["migration_ledger", "fixture_seed_ledger"],
  2: [
    "source_config_fixture",
    "source_config_fixture_canonical_unique",
    "source_config_fixture_status_idx",
    "source_config_fixture_lifecycle_idx",
    "source_config_fixture_epoch_idx",
    "source_seed_ledger"
  ],
  3: [
    "fixture_profile_ledger",
    "source_overlay_lineage",
    "source_runtime_fence",
    "operation_receipt",
    "operation_receipt_source_idx",
    "outbox_job",
    "source_management_outbox_due_idx",
    "inbox",
    "task_attempt",
    "source_management_attempt_lease_idx",
    "dead_letter",
    "audit_event",
    "source_management_audit_no_update",
    "source_management_audit_no_delete"
  ]
});

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sqlInput(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  throw new ConfigError("SQLITE_FAILURE", "non-scalar value cannot be bound to source-management SQLite");
}

export function sourceManagementMigrationContract(appRoot: string): OrderedMigrationContract {
  const migrations = readOrderedMigrations(MIGRATION_FILES.map((path) => resolve(appRoot, path.replace(/^migrations\//, "migrations/"))));
  return {
    migrations,
    objectManifest: OBJECT_MANIFEST,
    schemaFingerprints: {
      1: "512ac36dd348860362380372bb3c1ae3001272fe68d64a9233068493a1b36f5e",
      2: "f1beab525006000a5877327fefde6981f05798439ab246319c3a5a63629f2f1a",
      3: SOURCE_MANAGEMENT_SCHEMA_FINGERPRINT_SHA256
    }
  };
}

export function sourceManagementMigrationSelectorRoot(appRoot: string): string {
  const contract = sourceManagementMigrationContract(appRoot);
  return sha256(canonicalJson({
    ordered: contract.migrations.map((migration, index) => ({
      relative_path: MIGRATION_FILES[index],
      sha256: migration.hash
    }))
  }));
}

function tableCount(database: SqliteDatabase, table: string): number {
  return Number((database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as Record<string, unknown>).count);
}

function assertLocalSourceRows(
  database: SqliteDatabase,
  baseline: readonly SourceRow[],
  appRoot: string,
  projectRoot: string
): { rows: SourceRow[]; effectiveRoot: string } {
  const baselineIds = new Set(baseline.map((row) => String(row.source_id)));
  const baselineUrls = new Set(baseline.map((row) => String(row.canonical_url)));
  const rawRows = database.prepare("SELECT * FROM source_config_fixture ORDER BY source_id").all() as Array<Record<string, unknown>>;
  const rows = rawRows.map((raw) => {
    const normalized = Object.fromEntries(SOURCE_REQUIRED_FIELDS.map((field) => {
      const value = raw[field];
      return [field, ["canonical_url_valid", "enabled"].includes(field) ? Number(value) === 1 : value];
    }));
    const row = validateSourceRow(normalized, appRoot, projectRoot);
    if (baselineIds.has(String(row.source_id)) || baselineUrls.has(String(row.canonical_url))) {
      throw new ConfigError("PROFILE_GRAPH_MIX", "local Source collides with the frozen baseline");
    }
    if (!String(row.raw_url).startsWith("https://synthetic.invalid/") || !String(row.canonical_url).startsWith("https://synthetic.invalid/")) {
      throw new ConfigError("SOURCE_VALUE", "local Source is not synthetic-only");
    }
    const lineage = database.prepare("SELECT * FROM source_overlay_lineage WHERE source_id = ?").get(String(row.source_id)) as Record<string, unknown> | undefined;
    const fence = database.prepare("SELECT * FROM source_runtime_fence WHERE source_id = ?").get(String(row.source_id)) as Record<string, unknown> | undefined;
    const fullIdentityHash = sha256(canonicalJson({ platform: row.platform, raw_url: row.raw_url }));
    if (
      !lineage || !fence || lineage.origin !== "local_synthetic" ||
      lineage.baseline_projection_hash !== SOURCE_PROJECTION_SHA256 ||
      lineage.effective_source_hash !== sourceRowHash(row) ||
      row.source_id !== `src-local-${fullIdentityHash.slice(0, 24)}` || lineage.full_identity_hash !== fullIdentityHash ||
      Number(lineage.source_version) < 1 ||
      Number(fence.authorization_version) < 1 || Number(fence.policy_epoch) < 1 || Number(fence.recovery_epoch) < 1
    ) {
      throw new ConfigError("PROFILE_GRAPH_MIX", "local Source lineage or runtime fence is incomplete");
    }
    return row;
  });
  if (tableCount(database, "source_overlay_lineage") !== rows.length || tableCount(database, "source_runtime_fence") !== rows.length) {
    throw new ConfigError("PROFILE_GRAPH_MIX", "orphan source-management rows exist");
  }
  const effectiveRows = [...baseline, ...rows].sort((left, right) => String(left.source_id).localeCompare(String(right.source_id)));
  return {
    rows,
    effectiveRoot: sha256(canonicalJson({
      fields: SOURCE_REQUIRED_FIELDS,
      baseline_projection_hash: SOURCE_PROJECTION_SHA256,
      rows: effectiveRows
    }))
  };
}

function expectedLedger(appRoot: string): Record<string, unknown> {
  return {
    profile_id: SOURCE_MANAGEMENT_PROFILE_ID,
    sqlite_path: `app/${SOURCE_MANAGEMENT_SQLITE_PATH}`,
    contract_version: "source-management-local-v0.3",
    baseline_file_sha256: SOURCE_BRIDGE_SHA256,
    baseline_projection_sha256: SOURCE_PROJECTION_SHA256,
    baseline_row_count: 59,
    source_field_count: 39,
    baseline_enabled_false_count: 59,
    source_schema_sha256: SOURCE_SCHEMA_SHA256,
    migration_selector_root_sha256: sourceManagementMigrationSelectorRoot(appRoot),
    schema_fingerprint_sha256: SOURCE_MANAGEMENT_SCHEMA_FINGERPRINT_SHA256,
    validator_sha256: SOURCE_MANAGEMENT_VALIDATOR_SHA256,
    row_count_contract_json: canonicalJson({ baseline: 59, local_initial: 0 }),
    synthetic_only: 1,
    external_calls: 0,
    writes_to_base: 0,
    real_content_imported: 0,
    recorded_at: SOURCE_MANAGEMENT_RECORDED_AT
  };
}

function assertLedger(database: SqliteDatabase, appRoot: string): void {
  const rows = database.prepare("SELECT * FROM fixture_profile_ledger").all() as Array<Record<string, unknown>>;
  if (rows.length !== 1 || canonicalJson(rows[0]) !== canonicalJson(expectedLedger(appRoot))) {
    throw new ConfigError("PROFILE_LEDGER_DRIFT", "source-management profile ledger drifted");
  }
}

export function initializeSourceManagementProfile(
  database: SqliteDatabase,
  config: AppConfig,
  appRoot: string,
  projectRoot: string
): { inserted: boolean; baselineRows: 59; localRows: number; effectiveRoot: string } {
  if (config.dataProfile !== SOURCE_MANAGEMENT_PROFILE_ID) throw new ConfigError("DATA_PROFILE", "source-management profile required");
  assertDatabaseProfile(database, config);
  assertOrderedMigrationState(database, sourceManagementMigrationContract(appRoot));
  const baseline = readSourceFixture(config, appRoot, projectRoot);
  const existing = tableCount(database, "fixture_profile_ledger");
  if (existing === 0) {
    if (tableCount(database, "source_config_fixture") !== 0) {
      throw new ConfigError("SEED_POLICY", "source-management local rows exist before profile ledger initialization");
    }
    const ledger = expectedLedger(appRoot);
    withImmediateTransaction(database, () => {
      const columns = Object.keys(ledger);
      database.prepare(
        `INSERT INTO fixture_profile_ledger (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`
      ).run(...columns.map((column) => sqlInput(ledger[column])));
    });
  }
  assertLedger(database, appRoot);
  const graph = assertLocalSourceRows(database, baseline.rows, appRoot, projectRoot);
  return { inserted: existing === 0, baselineRows: 59, localRows: graph.rows.length, effectiveRoot: graph.effectiveRoot };
}

export function migrateSourceManagementDatabase(database: SqliteDatabase, appRoot: string): MigrationResult {
  return migrateOrderedDatabase(database, sourceManagementMigrationContract(appRoot));
}

export function assertSourceManagementReady(
  database: SqliteDatabase,
  config: AppConfig,
  appRoot: string,
  projectRoot: string
): { sqliteVersion: string; localRows: number; effectiveRoot: string } {
  if (config.dataProfile !== SOURCE_MANAGEMENT_PROFILE_ID) throw new ConfigError("DATA_PROFILE", "source-management profile required");
  assertSingleDatabase(database);
  assertDatabaseProfile(database, config);
  assertOrderedMigrationState(database, sourceManagementMigrationContract(appRoot));
  if (readDatabaseSchemaFingerprint(database) !== SOURCE_MANAGEMENT_SCHEMA_FINGERPRINT_SHA256) {
    throw new ConfigError("MIGRATION_SCHEMA", "source-management schema fingerprint drifted");
  }
  assertLedger(database, appRoot);
  const baseline = readSourceFixture(config, appRoot, projectRoot);
  if (baseline.projectionHash !== SOURCE_PROJECTION_SHA256 || sourceProjectionHash(baseline.rows) !== SOURCE_PROJECTION_SHA256) {
    throw new ConfigError("SOURCE_PROJECTION_HASH", "source-management baseline drifted");
  }
  const graph = assertLocalSourceRows(database, baseline.rows, appRoot, projectRoot);
  const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
  const integrity = database.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
  if (foreignKeys.length !== 0 || integrity.length !== 1 || String(Object.values(integrity[0])[0]).toLowerCase() !== "ok") {
    throw new ConfigError("SQLITE_INTEGRITY", "source-management database integrity failed");
  }
  return { sqliteVersion: readSqliteRuntime(database).sqliteVersion, localRows: graph.rows.length, effectiveRoot: graph.effectiveRoot };
}

type RuntimeLock = { release(): void };

export function acquireSourceManagementProfileLock(appRoot: string): RuntimeLock {
  const root = resolve(appRoot, ".local");
  if (!existsSync(root)) mkdirSync(root, { mode: 0o700 });
  chmodSync(root, 0o700);
  const lockPath = resolve(root, "f1plus1-source-management-synthetic.lock");
  let fd: number;
  try {
    fd = openSync(lockPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
  } catch {
    throw new ConfigError("LOCK_CONTENTION", "source-management profile already has an owner");
  }
  writeFileSync(fd, `${process.pid}\n`, { encoding: "utf8" });
  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      closeSync(fd);
      const stat = lstatSync(lockPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) {
        throw new ConfigError("DB_PATH", "source-management profile lock changed identity");
      }
      unlinkSync(lockPath);
    }
  };
}

function databaseLogicalRoot(database: SqliteDatabase): string {
  const tables = [
    "fixture_profile_ledger", "source_config_fixture", "source_overlay_lineage", "source_runtime_fence",
    "operation_receipt", "outbox_job", "inbox", "task_attempt", "dead_letter", "audit_event"
  ].map((table) => ({
    table,
    rows: (database.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>)
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
  }));
  return sha256(canonicalJson({ tables }));
}

function secureFileSha256(path: string): string {
  const stat = lstatSync(path);
  const uid = process.getuid?.();
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || uid === undefined || stat.uid !== uid) {
    throw new ConfigError("DB_PATH", "closed source-management database is not a private regular file");
  }
  return sha256(readFileSync(path));
}

export type SourceManagementClosedReceipt = Readonly<{
  schemaVersion: "f1plus1-source-management-closed-receipt-v1";
  profileId: typeof SOURCE_MANAGEMENT_PROFILE_ID;
  dbRelativePath: string;
  closedDbSha256: string;
  schemaFingerprintSha256: string;
  migrationSelectorRootSha256: string;
  baselineFileSha256: string;
  baselineProjectionSha256: string;
  logicalContentRootSha256: string;
  effectiveRootSha256: string;
  localSourceCount: number;
  checkpoint: { busy: 0; log: 0; checkpointed: 0 };
  walPresent: false;
  shmPresent: false;
  externalCalls: 0;
  receiptSha256: string;
}>;

export function generateSourceManagementClosedReceipt(
  config: AppConfig,
  appRoot: string,
  projectRoot: string
): { receipt: SourceManagementClosedReceipt; relativePath: string } {
  const lock = acquireSourceManagementProfileLock(appRoot);
  const dbPath = resolve(appRoot, config.dbPath);
  let database: SqliteDatabase | undefined;
  let logicalContentRootSha256: string;
  let ready: ReturnType<typeof assertSourceManagementReady>;
  try {
    database = openSafeDatabase(config.dbPath, { appRoot });
    ready = assertSourceManagementReady(database, config, appRoot, projectRoot);
    logicalContentRootSha256 = databaseLogicalRoot(database);
    const checkpoint = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as Record<string, unknown>;
    if (Number(checkpoint.busy) !== 0 || Number(checkpoint.log) !== 0 || Number(checkpoint.checkpointed) !== 0) {
      throw new ConfigError("SQLITE_FAILURE", "source-management checkpoint did not close at zero frames");
    }
  } finally {
    if (database) closeDatabase(database);
    lock.release();
  }
  if (existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`)) {
    throw new ConfigError("SQLITE_FAILURE", "source-management database retained WAL sidecars after close");
  }
  const core = {
    schemaVersion: "f1plus1-source-management-closed-receipt-v1" as const,
    profileId: SOURCE_MANAGEMENT_PROFILE_ID,
    dbRelativePath: `app/${SOURCE_MANAGEMENT_SQLITE_PATH}`,
    closedDbSha256: secureFileSha256(dbPath),
    schemaFingerprintSha256: SOURCE_MANAGEMENT_SCHEMA_FINGERPRINT_SHA256,
    migrationSelectorRootSha256: sourceManagementMigrationSelectorRoot(appRoot),
    baselineFileSha256: SOURCE_BRIDGE_SHA256,
    baselineProjectionSha256: SOURCE_PROJECTION_SHA256,
    logicalContentRootSha256,
    effectiveRootSha256: ready.effectiveRoot,
    localSourceCount: ready.localRows,
    checkpoint: { busy: 0 as const, log: 0 as const, checkpointed: 0 as const },
    walPresent: false as const,
    shmPresent: false as const,
    externalCalls: 0 as const
  };
  const receipt: SourceManagementClosedReceipt = { ...core, receiptSha256: sha256(canonicalJson(core)) };
  const receiptDirectory = resolve(appRoot, ".local/receipts");
  if (!existsSync(receiptDirectory)) mkdirSync(receiptDirectory, { mode: 0o700 });
  chmodSync(receiptDirectory, 0o700);
  const target = resolve(receiptDirectory, "source-management-synthetic.closed.json");
  const temporary = resolve(receiptDirectory, `.source-management-${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
  try {
    writeFileSync(fd, `${canonicalJson(receipt)}\n`, { encoding: "utf8" });
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, target);
  chmodSync(target, 0o600);
  return { receipt, relativePath: relative(projectRoot, target).replaceAll("\\", "/") };
}

export function openSourceManagementDatabase(
  config: AppConfig,
  appRoot: string,
  projectRoot: string
): { database: SqliteDatabase; close(): void } {
  const lock = acquireSourceManagementProfileLock(appRoot);
  let database: SqliteDatabase | undefined;
  try {
    database = openSafeDatabase(config.dbPath, { appRoot });
    assertSourceManagementReady(database, config, appRoot, projectRoot);
    return {
      database,
      close(): void {
        if (!database) return;
        closeDatabase(database);
        database = undefined;
        lock.release();
      }
    };
  } catch (error) {
    if (database) closeDatabase(database);
    lock.release();
    throw error;
  }
}
