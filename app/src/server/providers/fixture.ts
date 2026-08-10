import { relative } from "node:path";
import { z } from "zod";

import type { AppConfig, SecurePathInfo } from "../config/env.ts";
import { ConfigError, validateFixturePath } from "../config/env.ts";

export const M3_SOURCE_FIELD_NAMES = [
  "source_id",
  "platform",
  "platform_account_id",
  "handle",
  "raw_url",
  "canonical_url",
  "canonical_url_valid",
  "normalizer_version",
  "normalization_status",
  "dedup_status",
  "entity_type",
  "content_focus",
  "priority",
  "verification_status",
  "identity_status",
  "relevance_status",
  "monitorability",
  "adapter_status",
  "adapter_authorization_status",
  "authorization_checked_at",
  "authorization_expires_at",
  "collection_onboarding_status",
  "onboarding_operation_id",
  "lifecycle_status",
  "enabled",
  "manual_disable_at",
  "source_stop_status",
  "source_safety_epoch",
  "added_at",
  "evidence_url",
  "notes",
  "migration_batch_id",
  "change_reason"
] as const;

export const M3_EXPECTED_SHA256 = "e73b8d6b8a9b1a018dc7d30c90bfe3111b10caeb6fee28486edf27f176a05de5";
export const M3_EXPECTED_ROW_COUNT = 59;
export const M3_FIELD_COUNT = 33;

export type M3FieldName = (typeof M3_SOURCE_FIELD_NAMES)[number];
export type M3ShadowRow = Readonly<Record<M3FieldName, unknown>>;

export type FixtureProviderSnapshot = {
  providerKind: "fixture";
  fixtureContract: "m3-shadow-33-column";
  dataGate: "blocked-by-data";
  fieldCount: 33;
  rowCount: 59;
  externalCalls: 0;
  writesToBase: false;
  artifactHash: string;
  rows: M3ShadowRow[];
};

const batchSchema = z
  .object({
    fields: z.array(z.string()),
    rows: z.array(z.array(z.unknown()))
  })
  .strict();

const m3TupleSchema = z.array(z.unknown()).length(M3_FIELD_COUNT);

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError("FIXTURE_SCHEMA", `${field} must be a non-empty string`);
  }
}

function mapRow(row: unknown[]): M3ShadowRow {
  const tuple = m3TupleSchema.parse(row);
  assertString(tuple[0], "source_id");
  assertString(tuple[1], "platform");
  assertString(tuple[3], "handle");
  assertString(tuple[4], "raw_url");
  assertString(tuple[5], "canonical_url");
  assertString(tuple[7], "normalizer_version");
  assertString(tuple[8], "normalization_status");
  assertString(tuple[9], "dedup_status");
  assertString(tuple[10], "entity_type");
  assertString(tuple[11], "content_focus");
  assertString(tuple[12], "priority");
  assertString(tuple[13], "verification_status");
  assertString(tuple[14], "identity_status");
  assertString(tuple[15], "relevance_status");
  assertString(tuple[16], "monitorability");
  assertString(tuple[17], "adapter_status");
  assertString(tuple[18], "adapter_authorization_status");
  assertString(tuple[21], "collection_onboarding_status");
  assertString(tuple[23], "lifecycle_status");
  assertString(tuple[28], "added_at");
  assertString(tuple[29], "evidence_url");
  assertString(tuple[30], "notes");
  assertString(tuple[31], "migration_batch_id");
  assertString(tuple[32], "change_reason");
  if (typeof tuple[6] !== "boolean") throw new ConfigError("FIXTURE_SCHEMA", "canonical_url_valid must be boolean");
  if (tuple[24] !== false) throw new ConfigError("FIXTURE_POLICY", "M3 shadow seed must keep every source disabled");
  if (typeof tuple[27] !== "number" || !Number.isInteger(tuple[27]) || tuple[27] < 1) {
    throw new ConfigError("FIXTURE_SCHEMA", "source_safety_epoch must be a positive integer");
  }
  if (tuple[2] !== null && typeof tuple[2] !== "string") throw new ConfigError("FIXTURE_SCHEMA", "platform_account_id must be string or null");
  for (const index of [19, 20, 22, 25]) {
    if (tuple[index] !== null && typeof tuple[index] !== "string") throw new ConfigError("FIXTURE_SCHEMA", `${M3_SOURCE_FIELD_NAMES[index]} must be string or null`);
  }
  return Object.fromEntries(M3_SOURCE_FIELD_NAMES.map((field, index) => [field, tuple[index]])) as M3ShadowRow;
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new ConfigError("FIXTURE_SCHEMA", `${label} must be unique`);
}

export function readM3Fixture(
  fixturePath: string,
  appRoot: string,
  projectRoot: string
): { pathInfo: SecurePathInfo; rows: M3ShadowRow[]; artifactHash: string } {
  const pathInfo = validateFixturePath(relative(appRoot, fixturePath), appRoot, projectRoot);
  if (pathInfo.sha256 !== M3_EXPECTED_SHA256) {
    throw new ConfigError("FIXTURE_HASH", `M3 fixture hash ${pathInfo.sha256} does not match frozen artifact`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(pathInfo.bytes.toString("utf8"));
  } catch {
    throw new ConfigError("FIXTURE_JSON", "M3 fixture is not valid JSON");
  }
  const batch = batchSchema.parse(parsed);
  if (
    batch.fields.length !== M3_FIELD_COUNT ||
    batch.fields.some((field, index) => field !== M3_SOURCE_FIELD_NAMES[index])
  ) {
    throw new ConfigError("FIXTURE_SCHEMA", "M3 fixture fields do not match frozen 33-field mapping");
  }
  if (batch.rows.length !== M3_EXPECTED_ROW_COUNT) {
    throw new ConfigError("FIXTURE_SCHEMA", `expected ${M3_EXPECTED_ROW_COUNT} M3 rows`);
  }
  const rows = batch.rows.map(mapRow);
  assertUnique(rows.map((row) => String(row.source_id)), "source_id");
  assertUnique(rows.map((row) => String(row.canonical_url)), "canonical_url");
  return { pathInfo, rows, artifactHash: pathInfo.sha256 };
}

/**
 * This provider intentionally exposes the frozen M3 tuple only. The accepted
 * 33-to-39 implementation projection is loaded separately by source-fixture.ts.
 */
export function readFixtureProvider(config: AppConfig, appRoot: string, projectRoot: string): FixtureProviderSnapshot {
  const fixture = readM3Fixture(config.fixturePath, appRoot, projectRoot);
  return {
    providerKind: "fixture",
    fixtureContract: "m3-shadow-33-column",
    dataGate: "blocked-by-data",
    fieldCount: M3_FIELD_COUNT,
    rowCount: M3_EXPECTED_ROW_COUNT,
    externalCalls: 0,
    writesToBase: false,
    artifactHash: fixture.artifactHash,
    rows: fixture.rows
  };
}
