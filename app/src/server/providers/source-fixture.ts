import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

import type { AppConfig, SecurePathInfo } from "../config/env.ts";
import { ConfigError, validateFixturePath } from "../config/env.ts";

export const SOURCE_REQUIRED_FIELDS = [
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
  "platform_allowed",
  "authorization_checked_at",
  "authorization_expires_at",
  "collection_onboarding_status",
  "onboarding_operation_id",
  "lifecycle_status",
  "enabled",
  "manual_disable_at",
  "source_stop_status",
  "source_safety_epoch",
  "source_config_epoch",
  "added_at",
  "evidence_url",
  "notes",
  "migration_batch_id",
  "change_reason",
  "created_at",
  "updated_at",
  "created_by_ref",
  "updated_by_ref"
] as const;

export type SourceField = (typeof SOURCE_REQUIRED_FIELDS)[number];
export type SourceRow = Readonly<Record<SourceField, unknown>>;

export const SOURCE_BRIDGE_RELATIVE_PATH = "../data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json";
export const SOURCE_BRIDGE_SHA256 = "d4da9fc24c792c0471bcd24c525a46dcef1e521b36a870fd111e7310243888b2";
export const SOURCE_MAPPING_RELATIVE_PATH = "../data/m4-vs0-seed-enrichment-v0/implementation-mapping.json";
export const SOURCE_MAPPING_SHA256 = "216018309d80cf946ed3cccfdeee2e61713e05ab9c6bfbd294a4ea6f4f8fe2a6";
export const SOURCE_SCHEMA_SHA256 = "de6c6c07a33589106ebb93496ad10ae3b06ab1c7845e4e0e91888ca0b17ae5a4";
export const SOURCE_PROJECTION_SHA256 = "e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17";
export const SOURCE_MAPPING_VERSION = "m4-vs0-seed-enrichment-v0.3";
export const SOURCE_CONTRACT_VERSION = "mvp-local-v0.3";

export type SourceFixtureSnapshot = {
  fixtureKind: "implementation_seed_fixture";
  contractVersion: typeof SOURCE_CONTRACT_VERSION;
  mappingVersion: typeof SOURCE_MAPPING_VERSION;
  fieldCount: 39;
  rowCount: 59;
  enabledFalseCount: 59;
  externalCalls: 0;
  writesToBase: false;
  bridgePath: SecurePathInfo;
  bridgeHash: string;
  projectionHash: typeof SOURCE_PROJECTION_SHA256;
  rows: SourceRow[];
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError("SOURCE_BRIDGE_SCHEMA", `${label} must be an object`);
  }
  return value as JsonRecord;
}

function readJson(pathInfo: SecurePathInfo, code: string): unknown {
  try {
    return JSON.parse(pathInfo.bytes.toString("utf8"));
  } catch {
    throw new ConfigError(code, "bridge JSON is invalid");
  }
}

function assertHash(pathInfo: SecurePathInfo, expected: string, code: string): void {
  if (pathInfo.sha256 !== expected) {
    throw new ConfigError(code, `artifact hash ${pathInfo.sha256} does not match the frozen bridge`);
  }
}

function assertExactKeys(record: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ConfigError("SOURCE_BRIDGE_SCHEMA", `${label} has unknown or missing fields`);
  }
}

export function canonicalSourceJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ConfigError("SOURCE_BRIDGE_SCHEMA", "non-finite number in canonical object");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalSourceJson).join(",")}]`;
  const record = asRecord(value, "canonical value");
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalSourceJson(record[key])}`).join(",")}}`;
}

export function sourceProjectionHash(rows: readonly SourceRow[]): string {
  return createHash("sha256").update(canonicalSourceJson({ fields: SOURCE_REQUIRED_FIELDS, rows })).digest("hex");
}

export function sourceRowHash(row: SourceRow): string {
  return createHash("sha256").update(canonicalSourceJson(row)).digest("hex");
}

function valueMatchesType(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return false;
}

function validateFormat(value: string, format: string | undefined, field: string): void {
  if (!format) return;
  if (format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConfigError("SOURCE_BRIDGE_SCHEMA", `${field} must use YYYY-MM-DD`);
  }
  if (format === "date-time" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new ConfigError("SOURCE_BRIDGE_SCHEMA", `${field} must use an explicit UTC date-time`);
  }
  if (format === "uri" && !/^https?:\/\//.test(value)) {
    throw new ConfigError("SOURCE_BRIDGE_SCHEMA", `${field} must be an HTTP(S) URI`);
  }
}

function validateProperty(value: unknown, spec: JsonRecord, field: string): void {
  const candidates = Array.isArray(spec.anyOf) ? spec.anyOf.map((item) => asRecord(item, `${field} schema`)) : [spec];
  const candidate = candidates.find((option) => valueMatchesType(value, String(option.type)));
  if (!candidate) throw new ConfigError("SOURCE_BRIDGE_SCHEMA", `${field} has the wrong type`);
  if (Array.isArray(candidate.enum) && !candidate.enum.includes(value)) {
    throw new ConfigError("SOURCE_BRIDGE_SCHEMA", `${field} has a value outside the frozen enum`);
  }
  if (typeof value === "string") {
    if (typeof candidate.minLength === "number" && value.length < candidate.minLength) throw new ConfigError("SOURCE_BRIDGE_SCHEMA", `${field} is too short`);
    if (typeof candidate.maxLength === "number" && value.length > candidate.maxLength) throw new ConfigError("SOURCE_BRIDGE_SCHEMA", `${field} is too long`);
    if (typeof candidate.pattern === "string" && !new RegExp(candidate.pattern).test(value)) throw new ConfigError("SOURCE_BRIDGE_SCHEMA", `${field} violates its frozen pattern`);
    validateFormat(value, typeof candidate.format === "string" ? candidate.format : undefined, field);
  }
  if (typeof value === "number" && typeof candidate.minimum === "number" && value < candidate.minimum) {
    throw new ConfigError("SOURCE_BRIDGE_SCHEMA", `${field} is below its frozen minimum`);
  }
}

function loadSourceDefinition(appRoot: string, projectRoot: string): { fields: readonly string[]; properties: JsonRecord } {
  const schemaPath = resolve(projectRoot, "data/mvp-contract-v0/schema.json");
  const schemaInfo = validateFixturePath(relative(appRoot, schemaPath), appRoot, projectRoot);
  assertHash(schemaInfo, SOURCE_SCHEMA_SHA256, "SOURCE_SCHEMA_HASH");
  const schema = asRecord(readJson(schemaInfo, "SOURCE_SCHEMA_JSON"), "frozen schema");
  const defs = asRecord(schema.$defs, "frozen schema definitions");
  const source = asRecord(defs.Source, "Source definition");
  const fields = source.required;
  const properties = asRecord(source.properties, "Source properties");
  if (!Array.isArray(fields) || fields.length !== SOURCE_REQUIRED_FIELDS.length || fields.some((field, index) => field !== SOURCE_REQUIRED_FIELDS[index])) {
    throw new ConfigError("SOURCE_SCHEMA", "Source.required does not match the accepted 39-field contract");
  }
  return { fields, properties };
}

export function validateSourceRow(value: unknown, appRoot: string, projectRoot: string): SourceRow {
  const definition = loadSourceDefinition(appRoot, projectRoot);
  const row = asRecord(value, "Source row");
  assertExactKeys(row, definition.fields, "Source row");
  for (const field of definition.fields) {
    validateProperty(row[field], asRecord(definition.properties[field], `${field} schema`), field);
  }
  return row as SourceRow;
}

export function readSourceFixture(config: AppConfig, appRoot: string, projectRoot: string): SourceFixtureSnapshot {
  const bridgePath = resolve(appRoot, SOURCE_BRIDGE_RELATIVE_PATH);
  const bridgeInfo = validateFixturePath(SOURCE_BRIDGE_RELATIVE_PATH, appRoot, projectRoot);
  if (bridgeInfo.absolutePath !== bridgePath) throw new ConfigError("SOURCE_BRIDGE_PATH", "bridge path canonicalization failed");
  assertHash(bridgeInfo, SOURCE_BRIDGE_SHA256, "SOURCE_BRIDGE_HASH");

  const mappingPath = resolve(appRoot, SOURCE_MAPPING_RELATIVE_PATH);
  const mappingInfo = validateFixturePath(SOURCE_MAPPING_RELATIVE_PATH, appRoot, projectRoot);
  if (mappingInfo.absolutePath !== mappingPath) throw new ConfigError("SOURCE_MAPPING_PATH", "mapping path canonicalization failed");
  assertHash(mappingInfo, SOURCE_MAPPING_SHA256, "SOURCE_MAPPING_HASH");
  const mapping = asRecord(readJson(mappingInfo, "SOURCE_MAPPING_JSON"), "implementation mapping");
  if (mapping.mapping_version !== SOURCE_MAPPING_VERSION || mapping.status !== "PASS" || mapping.non_authoritative !== true || mapping.second_domain_schema !== false || mapping.writes_to_base !== false || mapping.external_calls !== 0) {
    throw new ConfigError("SOURCE_MAPPING_POLICY", "implementation mapping is not the accepted local bridge");
  }
  const output = asRecord(mapping.output_projection, "mapping output projection");
  if (output.canonical_projection_hash !== SOURCE_PROJECTION_SHA256 || output.row_count !== 59 || output.field_count !== 39) {
    throw new ConfigError("SOURCE_MAPPING_HASH", "implementation mapping projection receipt is not the accepted bridge");
  }

  const definition = loadSourceDefinition(appRoot, projectRoot);
  const bridge = asRecord(readJson(bridgeInfo, "SOURCE_BRIDGE_JSON"), "source bridge");
  if (
    bridge.contract_version !== SOURCE_CONTRACT_VERSION ||
    bridge.mapping_version !== SOURCE_MAPPING_VERSION ||
    bridge.fixture_kind !== "implementation_seed_fixture" ||
    bridge.non_authoritative !== true ||
    bridge.external_calls !== 0 ||
    bridge.writes_to_base !== false
  ) {
    throw new ConfigError("SOURCE_BRIDGE_POLICY", "bridge policy markers are not fail-closed");
  }
  if (!Array.isArray(bridge.fields) || bridge.fields.length !== SOURCE_REQUIRED_FIELDS.length || bridge.fields.some((field, index) => field !== definition.fields[index])) {
    throw new ConfigError("SOURCE_BRIDGE_SCHEMA", "bridge field list does not match Source.required");
  }
  if (!Array.isArray(bridge.rows) || bridge.rows.length !== 59) throw new ConfigError("SOURCE_BRIDGE_SCHEMA", "bridge must contain exactly 59 rows");

  const rows = bridge.rows.map((value, rowIndex) => {
    const row = asRecord(value, `source row ${rowIndex}`);
    assertExactKeys(row, definition.fields, `source row ${rowIndex}`);
    for (const field of definition.fields) {
      validateProperty(row[field], asRecord(definition.properties[field], `${field} schema`), field);
    }
    if (row.enabled !== false || row.platform_allowed !== "unknown" || row.source_config_epoch !== 1 || row.source_safety_epoch !== 1) {
      throw new ConfigError("SOURCE_BRIDGE_POLICY", `source row ${rowIndex} violates disabled local fixture defaults`);
    }
    return row as SourceRow;
  });
  for (let index = 1; index < rows.length; index += 1) {
    if (String(rows[index - 1].source_id) >= String(rows[index].source_id)) {
      throw new ConfigError("SOURCE_BRIDGE_ORDER", "source rows are not sorted by source_id Unicode order");
    }
  }
  const projectionHash = sourceProjectionHash(rows);
  if (projectionHash !== SOURCE_PROJECTION_SHA256) throw new ConfigError("SOURCE_PROJECTION_HASH", `projection hash ${projectionHash} is not the accepted receipt`);
  return {
    fixtureKind: "implementation_seed_fixture",
    contractVersion: SOURCE_CONTRACT_VERSION,
    mappingVersion: SOURCE_MAPPING_VERSION,
    fieldCount: 39,
    rowCount: 59,
    enabledFalseCount: 59,
    externalCalls: 0,
    writesToBase: false,
    bridgePath: bridgeInfo,
    bridgeHash: bridgeInfo.sha256,
    projectionHash,
    rows
  };
}
