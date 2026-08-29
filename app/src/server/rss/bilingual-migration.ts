import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

export const BILINGUAL_REFINEMENT_MIGRATION_SHA256 = "d3a8e3de9ade121766af72e648b1cc5986bfd93556c091563ae66e58b0eedebd";
export const BILINGUAL_REFINEMENT_MIGRATION_CANONICAL_SHA256 = "1b6a3814c0ac6ec65cb46eaec5b39a415848f2acc5226d69ac940e995796b273";
export const BILINGUAL_SOURCE_SCHEMA8_SHA256 = "db788b873d903f4a7224061a7c4628954244790d4d5794aa98ad07e746cabfc5";
export const BILINGUAL_SOURCE_0008_RAW_SHA256 = "f11756ac22bff56f7f42b640e816c36ffcf12a863eed42b17afc156907ac1246";
export const BILINGUAL_SOURCE_0008_CANONICAL_SHA256 = "f78b9f98227fcfb18de9bf7b09fef86cd62fd7c9282edb0bfb9fd1528fd2913a";

// Filled after the disposable replay has been computed. Keeping this value
// in the module makes a later opener compare the actual sqlite_schema bytes,
// instead of trusting a database self-report.
export const BILINGUAL_SCHEMA9_SHA256 = "d2460592cb4c6aaec099155ff483224e33706dc6efaafb7a17dc1b22e86121f4";

export type BilingualMigrationErrorCode =
  | "MIGRATION_HASH"
  | "MIGRATION_CANONICAL_HASH"
  | "SCHEMA8_DRIFT"
  | "SCHEMA9_DRIFT"
  | "VERSION_DRIFT"
  | "DATABASE_ATTACH"
  | "TEMP_SCHEMA_DIRTY"
  | "APPLY_DISABLED"
  | "MIGRATION_FAILED";

export class BilingualMigrationError extends Error {
  readonly code: BilingualMigrationErrorCode;

  constructor(code: BilingualMigrationErrorCode, message: string = code) {
    super(message);
    this.name = "BilingualMigrationError";
    this.code = code;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new BilingualMigrationError("SCHEMA9_DRIFT", "non-finite schema value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new BilingualMigrationError("SCHEMA9_DRIFT", "unsupported schema value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const b = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

type SchemaEntry = Readonly<{ type: string; name: string; tbl_name: string; sql: string }>;

export function readBilingualSchemaManifest(database: DatabaseSync): readonly SchemaEntry[] {
  const rows = database.prepare(
    "SELECT type, name, tbl_name, sql FROM main.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*'"
  ).all() as Array<Record<string, unknown>>;
  const entries = rows.map((row): SchemaEntry => {
    if (typeof row.type !== "string" || typeof row.name !== "string" || typeof row.tbl_name !== "string" || typeof row.sql !== "string") {
      throw new BilingualMigrationError("SCHEMA9_DRIFT", "invalid sqlite_schema row");
    }
    return Object.freeze({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql });
  });
  entries.sort((left, right) => {
    for (const field of ["type", "name", "tbl_name", "sql"] as const) {
      const result = compareCodePoints(left[field], right[field]);
      if (result !== 0) return result;
    }
    return 0;
  });
  return Object.freeze(entries);
}

export function bilingualSchemaFingerprint(database: DatabaseSync): string {
  return sha256(canonicalJson(readBilingualSchemaManifest(database)));
}

export function canonicalMigrationSha256(sql: string): string {
  return sha256(sql.replace(/MIGRATION_CANONICAL_SHA256=[0-9a-f]{64}/g, `MIGRATION_CANONICAL_SHA256=${"0".repeat(64)}`));
}

export function readBilingualMigrationSql(): string {
  return readFileSync(new URL("../../../migrations/rss-real/0009_bilingual_refinement.sql", import.meta.url), "utf8");
}

function assertNoAttachedDatabase(database: DatabaseSync): void {
  const rows = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (rows.some((row) => row.name !== "main" && row.name !== "temp")) {
    throw new BilingualMigrationError("DATABASE_ATTACH", "attached databases are forbidden");
  }
}

function assertNoTempSchema(database: DatabaseSync): void {
  const row = database.prepare(
    "SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1"
  ).get();
  if (row !== undefined) throw new BilingualMigrationError("TEMP_SCHEMA_DIRTY", "temporary schema is not clean");
}

function assertIntegrity(database: DatabaseSync): void {
  if (database.prepare("PRAGMA foreign_key_check").get() !== undefined) {
    throw new BilingualMigrationError("SCHEMA9_DRIFT", "foreign-key check failed");
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
  if (integrity.integrity_check !== "ok") throw new BilingualMigrationError("SCHEMA9_DRIFT", "integrity check failed");
}

export const BILINGUAL_TABLES = Object.freeze([
  "bilingual_authority_capability_v1",
  "bilingual_authority_permit_v1",
  "bilingual_authority_audit_v1",
  "bilingual_authority_bridge_marker_v1",
  "bilingual_candidate_lineage_v1",
  "bilingual_lineage_safety_decision_v1",
  "bilingual_operation_link_v1",
  "bilingual_language_slot_v1",
  "bilingual_model_receipt_v1",
  "bilingual_language_slot_draft_v1",
  "bilingual_bundle_v1",
  "bilingual_approval_v1",
  "bilingual_publication_v1",
  "bilingual_public_projection_v1",
  "bilingual_public_projection_active_v1",
  "bilingual_publication_outbox_v1"
] as const);

export function assertBilingualSchema(database: DatabaseSync, expectedFingerprint = BILINGUAL_SCHEMA9_SHA256): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version !== 9) throw new BilingualMigrationError("VERSION_DRIFT", `expected schema 9, got ${version}`);
  const foreignKeys = Number((database.prepare("PRAGMA foreign_keys").get() as Record<string, unknown>).foreign_keys);
  const recursiveTriggers = Number((database.prepare("PRAGMA recursive_triggers").get() as Record<string, unknown>).recursive_triggers);
  if (foreignKeys !== 1 || recursiveTriggers !== 1) throw new BilingualMigrationError("SCHEMA9_DRIFT", "sqlite safety pragmas are not enabled");
  assertNoAttachedDatabase(database);
  assertNoTempSchema(database);
  for (const table of BILINGUAL_TABLES) {
    if (database.prepare("SELECT 1 FROM main.sqlite_schema WHERE type = 'table' AND name = ?").get(table) === undefined) {
      throw new BilingualMigrationError("SCHEMA9_DRIFT", `missing table ${table}`);
    }
  }
  if (expectedFingerprint !== "__SCHEMA9_SHA256__" && bilingualSchemaFingerprint(database) !== expectedFingerprint) {
    throw new BilingualMigrationError("SCHEMA9_DRIFT", "schema fingerprint drifted");
  }
  assertIntegrity(database);
}

export type BilingualMigrationOptions = Readonly<{
  // Production is intentionally not an accepted mode in this slice. The
  // release owner must provide an independently reviewed successor that
  // enables the authority and its manifest before a real DB can move to 9.
  applyEnabled?: boolean;
}>;

/**
 * Apply 0009 only to a disposable exact schema-8 connection.  The SQL owns
 * BEGIN IMMEDIATE and COMMIT. Any statement error rolls back the whole
 * transaction and removes the connection-local preflight table.
 */
export function applyBilingualMigration(
  database: DatabaseSync,
  migrationSql: string,
  options: BilingualMigrationOptions = {}
): { applied: boolean; replay: boolean; schemaFingerprintSha256: string } {
  if (options.applyEnabled !== true) throw new BilingualMigrationError("APPLY_DISABLED", "0009 apply is closed");
  if (sha256(migrationSql) !== BILINGUAL_REFINEMENT_MIGRATION_SHA256) throw new BilingualMigrationError("MIGRATION_HASH");
  if (canonicalMigrationSha256(migrationSql) !== BILINGUAL_REFINEMENT_MIGRATION_CANONICAL_SHA256) throw new BilingualMigrationError("MIGRATION_CANONICAL_HASH");

  database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version === 9) {
    assertBilingualSchema(database);
    return { applied: false, replay: true, schemaFingerprintSha256: bilingualSchemaFingerprint(database) };
  }
  if (version !== 8) throw new BilingualMigrationError("VERSION_DRIFT", `expected schema 8, got ${version}`);
  assertNoAttachedDatabase(database);
  assertNoTempSchema(database);
  if (bilingualSchemaFingerprint(database) !== BILINGUAL_SOURCE_SCHEMA8_SHA256) throw new BilingualMigrationError("SCHEMA8_DRIFT");

  try {
    database.exec("CREATE TEMP TABLE migration_0009_preflight(source_user_version INTEGER NOT NULL, source_schema_sha256 TEXT NOT NULL, source_0008_raw_sha256 TEXT NOT NULL, source_0008_canonical_sha256 TEXT NOT NULL, target_schema_sha256 TEXT NOT NULL, apply_enabled INTEGER NOT NULL CHECK(apply_enabled IN (0,1))) STRICT");
    database.prepare("INSERT INTO migration_0009_preflight VALUES(?,?,?,?,?,?)").run(
      8,
      BILINGUAL_SOURCE_SCHEMA8_SHA256,
      BILINGUAL_SOURCE_0008_RAW_SHA256,
      BILINGUAL_SOURCE_0008_CANONICAL_SHA256,
      BILINGUAL_SCHEMA9_SHA256,
      1
    );
    database.exec(migrationSql);
  } catch (error) {
    try { database.exec("ROLLBACK;"); } catch { /* preserve original migration error */ }
    try { database.exec("DROP TABLE IF EXISTS temp.migration_0009_preflight;"); } catch { /* cleanup only */ }
    throw new BilingualMigrationError("MIGRATION_FAILED", error instanceof Error ? error.message : String(error));
  }
  try { database.exec("DROP TABLE IF EXISTS temp.migration_0009_preflight;"); } catch { /* cleanup only */ }
  assertBilingualSchema(database);
  return { applied: true, replay: false, schemaFingerprintSha256: bilingualSchemaFingerprint(database) };
}
