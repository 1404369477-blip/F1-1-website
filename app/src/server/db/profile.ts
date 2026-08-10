import { basename } from "node:path";

import type { AppConfig } from "../config/env.ts";
import type { SqliteDatabase } from "./database.ts";

export const M3_PROFILE_ID = "m3-shadow" as const;
export const PUBLIC_PROFILE_ID = "public-synthetic" as const;
export const PUBLIC_MULTIMEDIA_PROFILE_ID = "public-multimedia-synthetic" as const;
export const SOURCE_MANAGEMENT_PROFILE_ID = "source-management-synthetic" as const;
export const M3_SQLITE_PATH = ".local/f1plus1.sqlite" as const;
export const PUBLIC_SQLITE_PATH = ".local/f1plus1-public-synthetic.sqlite" as const;
export const PUBLIC_MULTIMEDIA_SQLITE_PATH = ".local/f1plus1-public-multimedia-synthetic.sqlite" as const;
export const SOURCE_MANAGEMENT_SQLITE_PATH = ".local/f1plus1-source-management-synthetic.sqlite" as const;

export const M3_PROFILE_COUNTS = Object.freeze({
  sources: 59,
  captured_items: 0,
  contents: 0,
  summaries: 0,
  media_candidates: 0,
  release_bundles: 0,
  review_decisions: 0,
  publications: 0,
  published_projections: 0
});

export const PUBLIC_PROFILE_COUNTS = Object.freeze({
  sources: 1,
  captured_items: 12,
  contents: 12,
  summaries: 12,
  media_candidates: 10,
  release_bundles: 12,
  review_decisions: 12,
  publications: 12,
  published_projections: 12
});

export const PUBLIC_MULTIMEDIA_PROFILE_COUNTS = Object.freeze({
  sources: 1,
  captured_items: 24,
  contents: 24,
  events: 0,
  summaries: 24,
  media_candidates: 40,
  release_bundles: 24,
  review_decisions: 24,
  publications: 24,
  outbox_jobs: 0,
  published_projections: 24
});

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("PROFILE_JSON: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new Error("PROFILE_JSON: unsupported value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function assertSingleDatabase(database: SqliteDatabase): void {
  const databases = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  const unexpected = databases.filter((row) => String(row.name) !== "main" && String(row.name) !== "temp");
  if (unexpected.length > 0) throw new Error("PROFILE_ATTACH: attached databases are forbidden");
}

export function assertDatabaseProfile(database: SqliteDatabase, config: AppConfig): void {
  const expectedPaths: Record<AppConfig["dataProfile"], string> = {
    [M3_PROFILE_ID]: M3_SQLITE_PATH,
    [PUBLIC_PROFILE_ID]: PUBLIC_SQLITE_PATH,
    [PUBLIC_MULTIMEDIA_PROFILE_ID]: PUBLIC_MULTIMEDIA_SQLITE_PATH,
    [SOURCE_MANAGEMENT_PROFILE_ID]: SOURCE_MANAGEMENT_SQLITE_PATH
  };
  const expectedPath = expectedPaths[config.dataProfile];
  const databaseLocation = database.location();
  if (
    databaseLocation === null ||
    config.dbPath !== expectedPath ||
    basename(databaseLocation) !== basename(expectedPath)
  ) {
    throw new Error("PROFILE_PATH_MIX: database file does not match the selected canonical profile");
  }
  assertSingleDatabase(database);
  const ledgers = database.prepare("SELECT profile_id FROM fixture_profile_ledger").all() as Array<Record<string, unknown>>;
  if (ledgers.some((row) => row.profile_id !== config.dataProfile)) {
    throw new Error("PROFILE_LEDGER_MIX: database contains a different fixture profile");
  }
}

export function countTable(database: SqliteDatabase, table: string): number {
  return Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Record<string, unknown>).count);
}

export function assertPublicTablesEmpty(database: SqliteDatabase): void {
  for (const table of [
    "public_captured_item",
    "public_content",
    "public_summary",
    "public_media_candidate",
    "public_release_bundle",
    "public_review_decision",
    "public_publication",
    "published_projection"
  ]) {
    if (countTable(database, table) !== 0) throw new Error("PROFILE_GRAPH_MIX: M3 database contains public graph rows");
  }
}

export const M3_LEDGER_VALUES = Object.freeze({
  profileId: M3_PROFILE_ID,
  sqlitePath: "app/.local/f1plus1.sqlite",
  contractVersion: "mvp-local-v0.3",
  fixtureSet: "m3-shadow-59-v0.3",
  fixtureManifestHash: "d4da9fc24c792c0471bcd24c525a46dcef1e521b36a870fd111e7310243888b2",
  fixtureGraphHash: "e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17",
  rowCountsJson: canonicalJson(M3_PROFILE_COUNTS),
  recordedAt: "2026-08-04T00:00:00Z"
});

export function insertM3ProfileLedger(database: SqliteDatabase): void {
  database.prepare(
    "INSERT INTO fixture_profile_ledger (profile_id, sqlite_path, contract_version, fixture_set, fixture_manifest_hash, fixture_graph_hash, row_counts_json, synthetic_only, external_calls, writes_to_base, real_content_imported, manifest_root_sha256, profile_ledger_root_sha256, generator_root_sha256, validator_root_sha256, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, NULL, NULL, NULL, ?)"
  ).run(
    M3_LEDGER_VALUES.profileId,
    M3_LEDGER_VALUES.sqlitePath,
    M3_LEDGER_VALUES.contractVersion,
    M3_LEDGER_VALUES.fixtureSet,
    M3_LEDGER_VALUES.fixtureManifestHash,
    M3_LEDGER_VALUES.fixtureGraphHash,
    M3_LEDGER_VALUES.rowCountsJson,
    M3_LEDGER_VALUES.recordedAt
  );
}

export function assertM3ProfileLedger(database: SqliteDatabase): void {
  const ledger = database.prepare("SELECT * FROM fixture_profile_ledger").get() as Record<string, unknown> | undefined;
  if (!ledger) throw new Error("PROFILE_LEDGER_MISSING: M3 fixture profile ledger is missing");
  if (
    ledger.profile_id !== M3_LEDGER_VALUES.profileId ||
    ledger.sqlite_path !== M3_LEDGER_VALUES.sqlitePath ||
    ledger.contract_version !== M3_LEDGER_VALUES.contractVersion ||
    ledger.fixture_set !== M3_LEDGER_VALUES.fixtureSet ||
    ledger.fixture_manifest_hash !== M3_LEDGER_VALUES.fixtureManifestHash ||
    ledger.fixture_graph_hash !== M3_LEDGER_VALUES.fixtureGraphHash ||
    ledger.row_counts_json !== M3_LEDGER_VALUES.rowCountsJson ||
    Number(ledger.synthetic_only) !== 0 ||
    Number(ledger.external_calls) !== 0 ||
    Number(ledger.writes_to_base) !== 0 ||
    Number(ledger.real_content_imported) !== 0 ||
    ledger.manifest_root_sha256 !== null ||
    ledger.profile_ledger_root_sha256 !== null ||
    ledger.generator_root_sha256 !== null ||
    ledger.validator_root_sha256 !== null
  ) {
    throw new Error("PROFILE_LEDGER_DRIFT: M3 ledger does not match the frozen profile");
  }
  assertPublicTablesEmpty(database);
}
