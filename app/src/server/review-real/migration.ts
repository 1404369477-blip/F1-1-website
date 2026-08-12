import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "../db/database.ts";
import { canonicalJson } from "../db/profile.ts";
import { ReviewRealError } from "./error.ts";

export const REVIEW_REAL_ADMIN_MIGRATION_SHA256 = "1d373f90cf881a58a15966ffe12ed01c3a651380d5f4f5aa9de468d79a798263";
export const REVIEW_REAL_FINAL_SCHEMA_SHA256 = "46a714035b59e1d608065922593895cd72c0748ac5ddbef660ae16e99e7f638e";

export type ReviewRealSchemaManifestEntry = Readonly<{
  type: "index" | "table" | "trigger" | "view";
  name: string;
  tbl_name: string;
  sql: string;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
