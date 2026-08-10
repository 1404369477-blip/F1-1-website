import type { AppConfig } from "../config/env.ts";
import type { SQLInputValue } from "node:sqlite";
import { resolve } from "node:path";
import {
  M3_EXPECTED_ROW_COUNT,
  M3_EXPECTED_SHA256,
  M3_FIELD_COUNT
} from "../providers/fixture.ts";
import {
  SOURCE_BRIDGE_SHA256,
  SOURCE_CONTRACT_VERSION,
  SOURCE_MAPPING_VERSION,
  SOURCE_PROJECTION_SHA256,
  SOURCE_REQUIRED_FIELDS,
  readSourceFixture,
  sourceProjectionHash,
  type SourceRow
} from "../providers/source-fixture.ts";
import { assertMigrationState, withImmediateTransaction, type SqliteDatabase } from "./database.ts";
import {
  assertDatabaseProfile,
  assertM3ProfileLedger,
  assertPublicTablesEmpty,
  insertM3ProfileLedger
} from "./profile.ts";

const SOURCE_TABLE = "source_config_fixture";
const SOURCE_SEED_ID = "m3-shadow-seed";
const SOURCE_SEED_TIMESTAMP = "2026-08-02T00:00:00Z";

const BOOLEAN_FIELDS = new Set(["canonical_url_valid", "enabled"]);

export type SourceSeedResult = {
  seedId: typeof SOURCE_SEED_ID;
  dataGate: "accepted-local-fixture";
  contractVersion: typeof SOURCE_CONTRACT_VERSION;
  mappingVersion: typeof SOURCE_MAPPING_VERSION;
  fieldCount: 39;
  rowCount: 59;
  enabledFalseCount: 59;
  writesToBase: false;
  externalCalls: 0;
  inserted: boolean;
  legacyGate: "legacy-reject";
  sourceArtifactHash: string;
  projectionHash: typeof SOURCE_PROJECTION_SHA256;
};

function hasTable(database: SqliteDatabase, table: string): boolean {
  const row = database.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table) as Record<string, unknown> | undefined;
  return row?.present === 1;
}

function assertSeedSchema(database: SqliteDatabase, appRoot: string): void {
  assertMigrationState(database, resolve(appRoot, "migrations"), 3);
  if (!hasTable(database, SOURCE_TABLE) || !hasTable(database, "source_seed_ledger")) {
    throw new Error("MIGRATION_LEDGER: Source migration or seed ledger is missing");
  }
}

function assertLegacyGate(database: SqliteDatabase): void {
  if (!hasTable(database, "fixture_seed_ledger")) return;
  const rows = database.prepare("SELECT * FROM fixture_seed_ledger WHERE seed_id = ?").all(SOURCE_SEED_ID) as Array<Record<string, unknown>>;
  if (rows.length === 0) return;
  if (rows.length !== 1) throw new Error("LEGACY_GATE_DRIFT: duplicate legacy M3 gate records");
  const row = rows[0];
  const valid =
    row.contract_version === SOURCE_CONTRACT_VERSION &&
    row.source_artifact_sha256 === M3_EXPECTED_SHA256 &&
    Number(row.field_count) === M3_FIELD_COUNT &&
    Number(row.row_count) === M3_EXPECTED_ROW_COUNT &&
    Number(row.enabled_false_count) === M3_EXPECTED_ROW_COUNT &&
    Number(row.writes_to_base) === 0 &&
    row.data_gate === "blocked-by-data";
  if (!valid) throw new Error("LEGACY_GATE_DRIFT: the old 33-column gate is not a recognized legacy record");
}

function asSqlValue(field: string, value: unknown): SQLInputValue {
  if (BOOLEAN_FIELDS.has(field)) {
    if (value === true) return 1;
    if (value === false) return 0;
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  throw new Error(`SOURCE_VALUE: ${field} is not a scalar SQL value`);
}

function fromSqlValue(field: string, value: unknown): unknown {
  if (BOOLEAN_FIELDS.has(field)) return Number(value) === 1;
  return value;
}

function readStoredRows(database: SqliteDatabase): SourceRow[] {
  const fields = SOURCE_REQUIRED_FIELDS.join(", ");
  const rows = database.prepare(`SELECT ${fields} FROM ${SOURCE_TABLE} ORDER BY source_id`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => Object.fromEntries(SOURCE_REQUIRED_FIELDS.map((field) => [field, fromSqlValue(field, row[field])])) as SourceRow);
}

function assertStoredProjection(database: SqliteDatabase, expectedRows: number, expectedHash: string): void {
  const rows = readStoredRows(database);
  if (rows.length !== expectedRows) throw new Error(`SEED_DRIFT: expected ${expectedRows} Source rows, found ${rows.length}`);
  if (rows.some((row) => row.enabled !== false)) throw new Error("SEED_POLICY: every M3 Source row must remain disabled");
  const actualHash = sourceProjectionHash(rows);
  if (actualHash !== expectedHash) throw new Error(`SEED_DRIFT: Source projection hash ${actualHash} does not match the accepted receipt`);
}

function readLedger(database: SqliteDatabase): Record<string, unknown> | undefined {
  return database.prepare("SELECT * FROM source_seed_ledger WHERE seed_id = ?").get(SOURCE_SEED_ID) as Record<string, unknown> | undefined;
}

function assertLedgerMatches(ledger: Record<string, unknown>, sourceArtifactHash: string, projectionHash: string): void {
  const matches =
    ledger.contract_version === SOURCE_CONTRACT_VERSION &&
    ledger.mapping_version === SOURCE_MAPPING_VERSION &&
    ledger.source_artifact_sha256 === sourceArtifactHash &&
    ledger.projection_sha256 === projectionHash &&
    Number(ledger.field_count) === 39 &&
    Number(ledger.row_count) === 59 &&
    Number(ledger.enabled_false_count) === 59 &&
    Number(ledger.writes_to_base) === 0 &&
    ledger.data_gate === "accepted-local-fixture" &&
    ledger.legacy_gate_status === "legacy-reject";
  if (!matches) throw new Error("SEED_LEDGER_DRIFT: source seed ledger does not match the accepted bridge");
}

function acceptedSeedResult(sourceArtifactHash: string, inserted: boolean): SourceSeedResult {
  return {
    seedId: SOURCE_SEED_ID,
    dataGate: "accepted-local-fixture",
    contractVersion: SOURCE_CONTRACT_VERSION,
    mappingVersion: SOURCE_MAPPING_VERSION,
    fieldCount: 39,
    rowCount: 59,
    enabledFalseCount: 59,
    writesToBase: false,
    externalCalls: 0,
    inserted,
    legacyGate: "legacy-reject",
    sourceArtifactHash,
    projectionHash: SOURCE_PROJECTION_SHA256
  };
}

export function assertSourceFixtureSeeded(
  database: SqliteDatabase,
  config: AppConfig,
  appRoot: string,
  projectRoot: string
): SourceSeedResult {
  if (config.dataProfile !== "m3-shadow") throw new Error("PROFILE_MIX: Source seed requires m3-shadow");
  assertSeedSchema(database, appRoot);
  assertDatabaseProfile(database, config);
  assertLegacyGate(database);
  const bridge = readSourceFixture(config, appRoot, projectRoot);
  const ledger = readLedger(database);
  if (!ledger) throw new Error("SEED_LEDGER_MISSING: accepted Source seed ledger is missing");
  assertLedgerMatches(ledger, bridge.bridgeHash, bridge.projectionHash);
  assertStoredProjection(database, bridge.rowCount, bridge.projectionHash);
  assertM3ProfileLedger(database);
  return acceptedSeedResult(bridge.bridgeHash, false);
}

export function seedSourceFixture(
  database: SqliteDatabase,
  config: AppConfig,
  appRoot: string,
  projectRoot: string
): SourceSeedResult {
  if (config.dataProfile !== "m3-shadow") throw new Error("PROFILE_MIX: Source seed requires m3-shadow");
  assertSeedSchema(database, appRoot);
  assertDatabaseProfile(database, config);
  assertLegacyGate(database);
  const bridge = readSourceFixture(config, appRoot, projectRoot);
  const existingLedger = readLedger(database);
  if (existingLedger) {
    assertLedgerMatches(existingLedger, bridge.bridgeHash, bridge.projectionHash);
    assertStoredProjection(database, bridge.rowCount, bridge.projectionHash);
    const profileCount = Number((database.prepare("SELECT COUNT(*) AS count FROM fixture_profile_ledger").get() as Record<string, unknown>).count);
    if (profileCount === 0) {
      withImmediateTransaction(database, () => insertM3ProfileLedger(database));
    }
    assertM3ProfileLedger(database);
    return acceptedSeedResult(bridge.bridgeHash, false);
  }

  const existingCount = Number((database.prepare(`SELECT COUNT(*) AS count FROM ${SOURCE_TABLE}`).get() as Record<string, unknown>).count);
  if (existingCount !== 0) {
    throw new Error("SEED_LEDGER_MISSING: Source rows exist without a matching source seed ledger");
  }
  assertPublicTablesEmpty(database);

  const fields = SOURCE_REQUIRED_FIELDS.join(", ");
  const placeholders = SOURCE_REQUIRED_FIELDS.map(() => "?").join(", ");
  const insert = database.prepare(`INSERT INTO ${SOURCE_TABLE} (${fields}) VALUES (${placeholders})`);
  withImmediateTransaction(database, () => {
    for (const row of bridge.rows) {
      insert.run(...SOURCE_REQUIRED_FIELDS.map((field) => asSqlValue(field, row[field])));
    }
    const count = Number((database.prepare(`SELECT COUNT(*) AS count FROM ${SOURCE_TABLE}`).get() as Record<string, unknown>).count);
    if (count !== bridge.rowCount) throw new Error(`SEED_INSERT: expected ${bridge.rowCount} inserted rows, found ${count}`);
    database.prepare(
      "INSERT INTO source_seed_ledger (seed_id, contract_version, mapping_version, source_artifact_sha256, projection_sha256, field_count, row_count, enabled_false_count, writes_to_base, data_gate, legacy_gate_status, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      SOURCE_SEED_ID,
      SOURCE_CONTRACT_VERSION,
      SOURCE_MAPPING_VERSION,
      bridge.bridgeHash,
      bridge.projectionHash,
      39,
      59,
      59,
      0,
      "accepted-local-fixture",
      "legacy-reject",
      SOURCE_SEED_TIMESTAMP
    );
    insertM3ProfileLedger(database);
  });
  assertStoredProjection(database, bridge.rowCount, bridge.projectionHash);
  assertM3ProfileLedger(database);
  return acceptedSeedResult(bridge.bridgeHash, true);
}
