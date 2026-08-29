import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "../db/database.ts";
import { canonicalJson } from "../db/profile.ts";
import { ReviewRealError } from "./error.ts";

export const REVIEW_REAL_ADMIN_MIGRATION_SHA256 = "1d373f90cf881a58a15966ffe12ed01c3a651380d5f4f5aa9de468d79a798263";
export const REVIEW_REAL_FINAL_SCHEMA_SHA256 = "46a714035b59e1d608065922593895cd72c0748ac5ddbef660ae16e99e7f638e";
export const PROJECTION_DELIVERY_RUNTIME_MIGRATION_SHA256 = "0f9d3908b62006158bf6dab60a4969c0bf65b95787d483b4e365f36199a86848";
export const PROJECTION_DELIVERY_RUNTIME_SCHEMA_SHA256 = "5d3316653750c8eaafefda7a0d5e3a154ab647a7e77329c048b91ce516a8b84f";
export const RSS_MEDIA_REFINEMENT_MIGRATION_SHA256 = "070dcd5778c88db85259f083f7272c42d562d30e8c8b2c74bb16d4e36205aeda";
export const RSS_MEDIA_REFINEMENT_SCHEMA_SHA256 = "40b1b59c8a8dab3413dfe85311b72cb735e3523071dbd70b0c3a42b0b7eb3b7c";
export const SECOND_RSS_AUTOSPORT_MIGRATION_SHA256 = "719d68015073e13f881806d7c6117657037de96fd888ded2d24c5f4031096e84";
export const SECOND_RSS_AUTOSPORT_SCHEMA_SHA256 = "45c3a15f2c6369d85a18b29853f15b00e06639a70caad16c5c31c563e21c3601";
export const INDEPENDENT_RSS_SOURCES_MIGRATION_SHA256 = "8239f0376148324326ce080fcaee245fbe3a3cd5b6b3c00d5307f2bb3b349daf";
export const INDEPENDENT_RSS_SOURCES_SCHEMA_SHA256 = "396af1d629a1bed95ec846770aaf26a3483d58b4ff28ce9d9f2c876a9987f8a9";
export const INTERNAL_OPERATION_MIGRATION_SHA256 = "ab32bb74fb404656bbdf6f84cc8a6967e18f8ed797f59ec27125291e5c26a163";
export const INTERNAL_OPERATION_MIGRATION_CANONICAL_SHA256 = "d651a156ad1264562962be13fb1742d2e41bd85d1523284e056f2458a4c44797";
export const INTERNAL_OPERATION_SCHEMA_SHA256 = "f3c0c049575b3121cccc8e66438481c70931df461cd941b95aaa54100844ad60";

export type ReviewRealSchemaManifestEntry = Readonly<{
  type: "index" | "table" | "trigger" | "view";
  name: string;
  tbl_name: string;
  sql: string;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function internalOperationCanonicalMigrationSha256(migrationSql: string): string {
  const zeros = "0".repeat(64);
  return sha256(migrationSql
    .replace(/MIGRATION_CANONICAL_SHA256=[0-9a-f]{64}/g, `MIGRATION_CANONICAL_SHA256=${zeros}`)
    .replace(/migration_sha256='[0-9a-f]{64}'/g, `migration_sha256='${zeros}'`));
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function compareManifestEntries(left: ReviewRealSchemaManifestEntry, right: ReviewRealSchemaManifestEntry): number {
  for (const field of ["type", "name", "tbl_name", "sql"] as const) {
    const difference = compareUnicodeCodePoints(left[field], right[field]);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function buildReviewRealSchemaManifest(database: DatabaseSync): readonly ReviewRealSchemaManifestEntry[] {
  const rows = database.prepare(
    "SELECT type, name, tbl_name, sql FROM main.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*'"
  ).all() as Array<Record<string, unknown>>;
  const manifest = rows.map((row): ReviewRealSchemaManifestEntry => {
    if (
      typeof row.type !== "string" ||
      !["index", "table", "trigger", "view"].includes(row.type) ||
      typeof row.name !== "string" ||
      typeof row.tbl_name !== "string" ||
      typeof row.sql !== "string"
    ) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    return Object.freeze({
      type: row.type as ReviewRealSchemaManifestEntry["type"],
      name: row.name,
      tbl_name: row.tbl_name,
      sql: row.sql
    });
  });
  manifest.sort(compareManifestEntries);
  return Object.freeze(manifest);
}

export function reviewRealSchemaFingerprint(database: DatabaseSync): string {
  return sha256(canonicalJson(buildReviewRealSchemaManifest(database)));
}

export function assertReviewRealSchema(database: DatabaseSync): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version !== 2) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  const foreignKeys = Number((database.prepare("PRAGMA foreign_keys").get() as Record<string, unknown>).foreign_keys);
  const recursiveTriggers = Number((database.prepare("PRAGMA recursive_triggers").get() as Record<string, unknown>).recursive_triggers);
  if (foreignKeys !== 1 || recursiveTriggers !== 1) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const databases = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (databases.some((row) => row.name !== "main" && row.name !== "temp")) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare(
    "SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1"
  ).get() !== undefined) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (reviewRealSchemaFingerprint(database) !== REVIEW_REAL_FINAL_SCHEMA_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare("PRAGMA foreign_key_check").get() !== undefined) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
  if (integrity.integrity_check !== "ok") throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
}

export function applyReviewRealAdminMigration(database: DatabaseSync, migrationSql: string): void {
  if (sha256(migrationSql) !== REVIEW_REAL_ADMIN_MIGRATION_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version === 1) {
    withImmediateTransaction(database, () => database.exec(migrationSql));
  } else if (version !== 2) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  assertReviewRealSchema(database);
}

export function assertProjectionDeliveryRuntimeSchema(database: DatabaseSync): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version !== 3) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  const foreignKeys = Number((database.prepare("PRAGMA foreign_keys").get() as Record<string, unknown>).foreign_keys);
  const recursiveTriggers = Number((database.prepare("PRAGMA recursive_triggers").get() as Record<string, unknown>).recursive_triggers);
  if (foreignKeys !== 1 || recursiveTriggers !== 1) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  if (reviewRealSchemaFingerprint(database) !== PROJECTION_DELIVERY_RUNTIME_SCHEMA_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare("PRAGMA foreign_key_check").get() !== undefined) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const databases = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (databases.some((row) => row.name !== "main" && row.name !== "temp")) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare(
    "SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1"
  ).get() !== undefined) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
  if (integrity.integrity_check !== "ok") throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
}

export function applyProjectionDeliveryRuntimeMigration(database: DatabaseSync, migrationSql: string): void {
  if (sha256(migrationSql) !== PROJECTION_DELIVERY_RUNTIME_MIGRATION_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version === 2) {
    withImmediateTransaction(database, () => database.exec(migrationSql));
  } else if (version !== 3) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  assertProjectionDeliveryRuntimeSchema(database);
}

export function assertRssMediaRefinementSchema(database: DatabaseSync): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version !== 4) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  const foreignKeys = Number((database.prepare("PRAGMA foreign_keys").get() as Record<string, unknown>).foreign_keys);
  const recursiveTriggers = Number((database.prepare("PRAGMA recursive_triggers").get() as Record<string, unknown>).recursive_triggers);
  if (foreignKeys !== 1 || recursiveTriggers !== 1) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  if (reviewRealSchemaFingerprint(database) !== RSS_MEDIA_REFINEMENT_SCHEMA_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare("PRAGMA foreign_key_check").get() !== undefined) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const databases = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (databases.some((row) => row.name !== "main" && row.name !== "temp")) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare(
    "SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1"
  ).get() !== undefined) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
  if (integrity.integrity_check !== "ok") throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
}

export function applyRssMediaRefinementMigration(database: DatabaseSync, migrationSql: string): void {
  if (sha256(migrationSql) !== RSS_MEDIA_REFINEMENT_MIGRATION_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version === 3) {
    withImmediateTransaction(database, () => database.exec(migrationSql));
  } else if (version !== 4) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  assertRssMediaRefinementSchema(database);
}

export function assertSecondRssAutosportSchema(database: DatabaseSync): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version !== 5) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  const foreignKeys = Number((database.prepare("PRAGMA foreign_keys").get() as Record<string, unknown>).foreign_keys);
  const recursiveTriggers = Number((database.prepare("PRAGMA recursive_triggers").get() as Record<string, unknown>).recursive_triggers);
  if (foreignKeys !== 1 || recursiveTriggers !== 1) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  if (reviewRealSchemaFingerprint(database) !== SECOND_RSS_AUTOSPORT_SCHEMA_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare("PRAGMA foreign_key_check").get() !== undefined) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const databases = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (databases.some((row) => row.name !== "main" && row.name !== "temp")) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare(
    "SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1"
  ).get() !== undefined) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
  if (integrity.integrity_check !== "ok") throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
}

export function applySecondRssAutosportMigration(database: DatabaseSync, migrationSql: string): void {
  if (sha256(migrationSql) !== SECOND_RSS_AUTOSPORT_MIGRATION_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version === 4) {
    // SQLite ignores foreign_keys changes inside a transaction, so turn them
    // off at connection scope before rebuilding source/ingest_run.
    database.exec("PRAGMA foreign_keys=OFF; PRAGMA recursive_triggers=ON;");
    try {
      withImmediateTransaction(database, () => database.exec(migrationSql));
    } finally {
      database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
    }
  } else if (version !== 5) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  } else {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
  }
  assertSecondRssAutosportSchema(database);
}

export function assertIndependentRssSourcesSchema(database: DatabaseSync): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version !== 6) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  const foreignKeys = Number((database.prepare("PRAGMA foreign_keys").get() as Record<string, unknown>).foreign_keys);
  const recursiveTriggers = Number((database.prepare("PRAGMA recursive_triggers").get() as Record<string, unknown>).recursive_triggers);
  if (foreignKeys !== 1 || recursiveTriggers !== 1) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  if (reviewRealSchemaFingerprint(database) !== INDEPENDENT_RSS_SOURCES_SCHEMA_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare("PRAGMA foreign_key_check").get() !== undefined) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const databases = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (databases.some((row) => row.name !== "main" && row.name !== "temp")) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare(
    "SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1"
  ).get() !== undefined) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
  if (integrity.integrity_check !== "ok") throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
}

export function applyIndependentRssSourcesMigration(database: DatabaseSync, migrationSql: string): void {
  if (sha256(migrationSql) !== INDEPENDENT_RSS_SOURCES_MIGRATION_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version === 5) {
    database.exec("PRAGMA foreign_keys=OFF; PRAGMA recursive_triggers=ON;");
    try {
      withImmediateTransaction(database, () => database.exec(migrationSql));
    } finally {
      database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
    }
  } else if (version !== 6) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  } else {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
  }
  assertIndependentRssSourcesSchema(database);
}

/**
 * Apply the byte-pinned 0007 migration to a disposable or separately
 * authorised review database. The SQL owns its single BEGIN IMMEDIATE, so a
 * failed preflight or DDL statement cannot leave a partial schema behind.
 * This helper never opens a database, creates an owner handoff, enables a
 * phase, or performs external I/O.
 */
export function applyInternalOperationMigration(database: DatabaseSync, migrationSql: string): void {
  if (sha256(migrationSql) !== INTERNAL_OPERATION_MIGRATION_SHA256 ||
      internalOperationCanonicalMigrationSha256(migrationSql) !== INTERNAL_OPERATION_MIGRATION_CANONICAL_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version === 7) {
    assertInternalOperationSchema(database);
    return;
  }
  if (version !== 6 || reviewRealSchemaFingerprint(database) !== INDEPENDENT_RSS_SOURCES_SCHEMA_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const databases = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (databases.some((row) => row.name !== "main" && row.name !== "temp")) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare("SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1").get() !== undefined) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  try {
    database.exec(
      "CREATE TEMP TABLE migration_0007_preflight(source_user_version INTEGER NOT NULL, source_schema_sha256 TEXT NOT NULL, migration_sha256 TEXT NOT NULL, apply_enabled INTEGER NOT NULL CHECK(apply_enabled IN (0,1))) STRICT"
    );
    database.prepare("INSERT INTO migration_0007_preflight VALUES(?,?,?,1)").run(
      6,
      INDEPENDENT_RSS_SOURCES_SCHEMA_SHA256,
      INTERNAL_OPERATION_MIGRATION_CANONICAL_SHA256
    );
    database.exec(migrationSql);
  } catch (error) {
    try { database.exec("DROP TABLE IF EXISTS temp.migration_0007_preflight;"); } catch { /* preserve original failure */ }
    throw error;
  }
  try { database.exec("DROP TABLE IF EXISTS temp.migration_0007_preflight;"); } catch { /* cleanup only */ }
  assertInternalOperationSchema(database);
}

export function assertInternalOperationSchema(database: DatabaseSync): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  const foreignKeys = Number((database.prepare("PRAGMA foreign_keys").get() as Record<string, unknown>).foreign_keys);
  const recursiveTriggers = Number((database.prepare("PRAGMA recursive_triggers").get() as Record<string, unknown>).recursive_triggers);
  if (version !== 7 || foreignKeys !== 1 || recursiveTriggers !== 1) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const databases = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (databases.some((row) => row.name !== "main" && row.name !== "temp")) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare("SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1").get() !== undefined ||
      reviewRealSchemaFingerprint(database) !== INTERNAL_OPERATION_SCHEMA_SHA256) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (database.prepare("PRAGMA foreign_key_check").get() !== undefined) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
  if (integrity.integrity_check !== "ok") throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
}
