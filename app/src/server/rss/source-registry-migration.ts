import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { X_MANUAL_SOURCE_REGISTRY_SET_SHA256 } from "../tweet-inbox/repository.ts";

export const SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256 = "d3a8e3de9ade121766af72e648b1cc5986bfd93556c091563ae66e58b0eedebd";
export const SOURCE_REGISTRY_SOURCE_0009_CANONICAL_SHA256 = "1b6a3814c0ac6ec65cb46eaec5b39a415848f2acc5226d69ac940e995796b273";
export const SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256 = "d2460592cb4c6aaec099155ff483224e33706dc6efaafb7a17dc1b22e86121f4";
export const SOURCE_REGISTRY_MIGRATION_SHA256 = "83c1aa4e350bc32fee594ffa4bec9caa85201ae120c29e21834c32463e36bb7a";
export const SOURCE_REGISTRY_MIGRATION_CANONICAL_SHA256 = "0421148d7cbe5fb39218f01495d2bd514e61764bc1d20c09051866ac7058cfe3";
export const SOURCE_REGISTRY_SCHEMA10_SHA256 = "e802727799654dd3e02f1b8abe6ce071dc7c96a09d9a6110c52be080d13dda4f";

export const SOURCE_REGISTRY_TABLES = Object.freeze([
  "quick_launch_authority_v2",
  "quick_launch_authority_permit_v2",
  "quick_launch_authority_audit_v2",
  "source_registry_v1",
  "source_registry_rss_config_v1",
  "source_registry_health_v1",
  "source_registry_history_v1",
  "source_registry_outbox_v1",
  "source_registry_mutation_permit_v1",
  "source_registry_migration_identity_v1"
] as const);

export type RssRegistryManifestEntry = Readonly<{
  sourceId: string;
  displayName: string;
  feedUrl: string;
  siteUrl: string;
  scheduleSeconds: number;
  routeId: string;
  routeIdentitySha256: string;
  routeReleaseSha256: string;
  routeManifestSha256: string;
  rightsStatus: "clear" | "blocked" | "unknown";
  mediaPolicy: "allowlisted" | "zero_media" | "blocked" | "unknown";
  authorizationExpiresAt: string;
  authorizationReceiptSha256: string;
  sourcePolicySha256: string;
}>;

export type SourceRegistryMigrationManifest = Readonly<{
  schemaVersion: "source-registry-migration-manifest-v1";
  migratedAt: string;
  rss: readonly RssRegistryManifestEntry[];
}>;

export type SourceRegistryMigrationErrorCode =
  | "APPLY_DISABLED"
  | "MIGRATION_HASH"
  | "MIGRATION_CANONICAL_HASH"
  | "VERSION_DRIFT"
  | "SCHEMA9_DRIFT"
  | "SCHEMA10_DRIFT"
  | "DATABASE_ATTACH"
  | "TEMP_SCHEMA_DIRTY"
  | "MANIFEST_INVALID"
  | "MIGRATION_FAILED";

export type QuickLaunchAuthorityCapability = "bilingual_auto_refine" | "bilingual_manual_mutation" | "source_registry_management";
export type AuthorityActivationTruth = Readonly<{
  operation: boolean;
  handoff: boolean;
  permit: boolean;
  audit: boolean;
  state: boolean;
}>;
export type AuthorityActivationVerification = Readonly<{
  valid: boolean;
  capabilityId: QuickLaunchAuthorityCapability;
  operationId: string;
  receiptSha256: string;
  truth: AuthorityActivationTruth;
}>;

export class SourceRegistryMigrationError extends Error {
  readonly code: SourceRegistryMigrationErrorCode;

  constructor(code: SourceRegistryMigrationErrorCode, message: string = code) {
    super(message);
    this.name = "SourceRegistryMigrationError";
    this.code = code;
  }
}

/**
 * Read-only five-truth verifier for an authority activation receipt.  It binds
 * the terminal operation, consumed owner handoff, one-time permit, immutable
 * audit and current capability state.  Bilingual state additionally requires
 * both v2 capabilities and the schema-9 v1 bridge to be enabled.
 */
export function verifyAuthorityActivationReceipt(
  database: DatabaseSync,
  input: Readonly<{ capabilityId: QuickLaunchAuthorityCapability; operationId: string; receiptSha256: string }>
): AuthorityActivationVerification {
  if (!/^[0-9a-f]{64}$/u.test(input.receiptSha256) || input.operationId.length < 1) {
    return Object.freeze({ valid: false, ...input, truth: Object.freeze({ operation: false, handoff: false, permit: false, audit: false, state: false }) });
  }
  const operation = database.prepare(`SELECT op.state,op.phase,op.egress_class,op.result_hash,op.expected_schema_sha256,
      op.operation_kind,op.owner_process,op.capability_class,op.policy_id,op.control_action,
      op.source_config_epoch,op.source_safety_epoch,op.authorization_version,op.policy_epoch,op.recovery_epoch,op.expected_writer_epoch,
      op.global_stop_state,op.emergency_stop_state,op.recovery_state,op.deletion_fence_state,op.publication_fence_state
    FROM internal_operation op WHERE op.operation_id=?`).get(input.operationId) as Record<string, unknown> | undefined;
  const operationTruth = operation !== undefined && operation.state === "succeeded" && operation.phase === "disabled"
    && operation.egress_class === "none" && operation.result_hash === input.receiptSha256
    && operation.expected_schema_sha256 === SOURCE_REGISTRY_SCHEMA10_SHA256
    && operation.operation_kind === "phase_control" && operation.owner_process === "admin_http"
    && operation.capability_class === "control" && operation.policy_id === "p-phase-control-disabled"
    && operation.control_action === "fence_update"
    && operation.global_stop_state === "stopped" && operation.emergency_stop_state === "clear" && operation.recovery_state === "fenced"
    && Number.isSafeInteger(Number(operation.source_config_epoch)) && Number(operation.source_config_epoch) >= 1
    && Number.isSafeInteger(Number(operation.source_safety_epoch)) && Number(operation.source_safety_epoch) >= 1
    && Number.isSafeInteger(Number(operation.authorization_version)) && Number(operation.authorization_version) >= 1
    && Number.isSafeInteger(Number(operation.policy_epoch)) && Number(operation.policy_epoch) >= 1
    && Number.isSafeInteger(Number(operation.recovery_epoch)) && Number(operation.recovery_epoch) >= 1
    && Number.isSafeInteger(Number(operation.expected_writer_epoch)) && Number(operation.expected_writer_epoch) >= 1;
  const handoffTruth = database.prepare(`SELECT 1 FROM owner_authorization_handoff h JOIN internal_operation op ON op.authorization_handoff_id=h.handoff_id
    WHERE op.operation_id=? AND h.owner_process='admin_http' AND h.consumed_by_operation_id=op.operation_id
      AND h.verified_at<=op.updated_at AND h.expires_at>op.created_at`).get(input.operationId) !== undefined;
  const permitTruth = database.prepare(`SELECT 1 FROM quick_launch_authority_permit_v2 WHERE operation_id=? AND capability_id=?
    AND action='enable' AND authority_receipt_sha256=? AND consumed_at IS NOT NULL`).get(input.operationId, input.capabilityId, input.receiptSha256) !== undefined;
  const auditTruth = database.prepare(`SELECT 1 FROM quick_launch_authority_audit_v2 WHERE operation_id=? AND capability_id=?
    AND to_state='enabled' AND receipt_sha256=?`).get(input.operationId, input.capabilityId, input.receiptSha256) !== undefined
    && database.prepare("SELECT 1 FROM internal_operation_audit WHERE operation_id=? AND event_type='operation_succeeded'").get(input.operationId) !== undefined;
  const authority = database.prepare("SELECT state,authority_receipt_sha256 FROM quick_launch_authority_v2 WHERE capability_id=?").get(input.capabilityId) as Record<string, unknown> | undefined;
  let stateTruth = authority?.state === "enabled" && authority.authority_receipt_sha256 === input.receiptSha256;
  if (input.capabilityId !== "source_registry_management") {
    const bridge = database.prepare(`SELECT a.enabled,a.status,a.extension_sha256 FROM bilingual_authority_capability_v1 a
      JOIN bilingual_authority_bridge_marker_v1 m ON m.operation_id=a.updated_by_operation_id AND m.consumed_at=a.updated_at
      JOIN bilingual_authority_audit_v1 v1a ON v1a.operation_id=a.updated_by_operation_id AND v1a.to_version=a.version AND v1a.to_state=a.status
      WHERE a.capability_id='bilingual-v1' AND m.action='enable'
      AND EXISTS(SELECT 1 FROM quick_launch_authority_v2 WHERE capability_id='bilingual_auto_refine' AND state='enabled')
      AND EXISTS(SELECT 1 FROM quick_launch_authority_v2 WHERE capability_id='bilingual_manual_mutation' AND state='enabled')`).get() as Record<string, unknown> | undefined;
    stateTruth = stateTruth && bridge?.enabled === 1 && bridge.status === "enabled" && bridge.extension_sha256 === SOURCE_REGISTRY_SCHEMA10_SHA256;
  }
  const truth = Object.freeze({ operation: operationTruth, handoff: handoffTruth, permit: permitTruth, audit: auditTruth, state: stateTruth });
  return Object.freeze({ valid: Object.values(truth).every(Boolean), ...input, truth });
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new SourceRegistryMigrationError("MANIFEST_INVALID");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

type SchemaEntry = Readonly<{ type: string; name: string; tbl_name: string; sql: string }>;

export function sourceRegistrySchemaManifest(database: DatabaseSync): readonly SchemaEntry[] {
  const rows = database.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' ORDER BY type,name,tbl_name,sql").all() as Array<Record<string, unknown>>;
  return Object.freeze(rows.map((row) => {
    if (typeof row.type !== "string" || typeof row.name !== "string" || typeof row.tbl_name !== "string" || typeof row.sql !== "string") {
      throw new SourceRegistryMigrationError("SCHEMA10_DRIFT");
    }
    return Object.freeze({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql });
  }));
}

export function sourceRegistrySchemaFingerprint(database: DatabaseSync): string {
  return sha256(canonicalJson(sourceRegistrySchemaManifest(database)));
}

export function canonicalSourceRegistryMigrationSha256(sql: string): string {
  return sha256(sql.replace(/MIGRATION_CANONICAL_SHA256=[0-9a-f]{64}/gu, `MIGRATION_CANONICAL_SHA256=${"0".repeat(64)}`));
}

export function readSourceRegistryMigrationSql(): string {
  return readFileSync(new URL("../../../migrations/rss-real/0010_source_registry.sql", import.meta.url), "utf8");
}

function assertClosedConnection(database: DatabaseSync): void {
  const attached = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (attached.some((row) => row.name !== "main" && row.name !== "temp")) throw new SourceRegistryMigrationError("DATABASE_ATTACH");
  if (database.prepare("SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1").get() !== undefined) {
    throw new SourceRegistryMigrationError("TEMP_SCHEMA_DIRTY");
  }
}

function assertTimestamp(value: string, code: SourceRegistryMigrationErrorCode = "MANIFEST_INVALID"): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    throw new SourceRegistryMigrationError(code);
  }
}

function assertHttps(value: string): void {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new SourceRegistryMigrationError("MANIFEST_INVALID"); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "" || (parsed.port !== "" && parsed.port !== "443")) {
    throw new SourceRegistryMigrationError("MANIFEST_INVALID");
  }
  if (parsed.href !== value) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
  for (const key of parsed.searchParams.keys()) {
    if (/token|secret|key|auth|password|signature|cookie/iu.test(key)) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
  }
}

function validatedXRows(database: DatabaseSync): Array<Record<string, unknown>> {
  const rows = database.prepare("SELECT source_id,handle,canonical_url,inventory_sha256 FROM x_manual_source_registry ORDER BY source_id").all() as Array<Record<string, unknown>>;
  if (rows.length !== 59 || rows.some((row) => String(row.inventory_sha256) !== "bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b")) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
  const setValue = rows.map((row) => `${String(row.source_id)}\n${String(row.handle)}\n${String(row.canonical_url)}`).join("\n");
  if (sha256(setValue) !== X_MANUAL_SOURCE_REGISTRY_SET_SHA256) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
  return rows;
}

function assertReplayBinding(database: DatabaseSync, manifestSha256: string, rss: readonly (RssRegistryManifestEntry & Readonly<{ identitySha256: string }>)[], xRows: readonly Record<string, unknown>[]): void {
  const identity = database.prepare("SELECT manifest_sha256,x_inventory_set_sha256 FROM source_registry_migration_identity_v1 WHERE singleton_id=1").get() as Record<string, unknown> | undefined;
  if (identity === undefined || identity.manifest_sha256 !== manifestSha256 || identity.x_inventory_set_sha256 !== X_MANUAL_SOURCE_REGISTRY_SET_SHA256) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
  for (const entry of rss) {
    const row = database.prepare(`SELECT r.display_name,r.canonical_feed_url,r.site_url,r.identity_sha256,c.schedule_seconds,c.route_id,
      c.route_identity_sha256,c.route_release_sha256,c.route_manifest_sha256,c.rights_status,c.media_policy,
      c.authorization_receipt_sha256,c.source_policy_sha256
      FROM source_registry_v1 r JOIN source_registry_rss_config_v1 c ON c.source_id=r.source_id WHERE r.source_id=?`).get(entry.sourceId) as Record<string, unknown> | undefined;
    const expected = [entry.displayName, entry.feedUrl, entry.siteUrl, entry.identitySha256, entry.scheduleSeconds, entry.routeId, entry.routeIdentitySha256, entry.routeReleaseSha256, entry.routeManifestSha256, entry.rightsStatus, entry.mediaPolicy, entry.authorizationReceiptSha256, entry.sourcePolicySha256];
    if (row === undefined || Object.values(row).some((value, index) => value !== expected[index])) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
  }
  for (const row of xRows) {
    const target = database.prepare("SELECT display_name,site_url,source_kind,collection_mode,enabled,lifecycle_status FROM source_registry_v1 WHERE source_id=?").get(String(row.source_id)) as Record<string, unknown> | undefined;
    if (target === undefined || target.display_name !== row.handle || target.site_url !== row.canonical_url || target.source_kind !== "x_manual" || target.collection_mode !== "manual_url" || target.enabled !== 0 || target.lifecycle_status !== "proposed") throw new SourceRegistryMigrationError("MANIFEST_INVALID");
  }
}

const EXPECTED_RSS = Object.freeze(new Map([
  ["motorsport-f1-news", "https://www.motorsport.com/rss/f1/news/"],
  ["autosport-f1-news", "https://www.autosport.com/rss/f1/news/"],
  ["racefans-f1-news", "https://www.racefans.net/category/formula-1/feed/"],
  ["the-race-f1-news", "https://www.the-race.com/category/formula-1/rss/"]
]));

function assertHash(value: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
}

function validateManifest(manifest: SourceRegistryMigrationManifest): readonly (RssRegistryManifestEntry & Readonly<{ identitySha256: string; sourceConfigEpoch: number; sourceSafetyEpoch: number }>)[] {
  if (manifest.schemaVersion !== "source-registry-migration-manifest-v1" || manifest.rss.length !== 4) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
  assertTimestamp(manifest.migratedAt);
  const seen = new Set<string>();
  const entries = manifest.rss.map((entry) => {
    if (seen.has(entry.sourceId) || EXPECTED_RSS.get(entry.sourceId) !== entry.feedUrl) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
    seen.add(entry.sourceId);
    if (entry.displayName.trim().length < 1 || entry.displayName.length > 200 || entry.routeId.trim().length < 1 || entry.routeId.length > 128) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
    assertHttps(entry.feedUrl); assertHttps(entry.siteUrl); assertTimestamp(entry.authorizationExpiresAt);
    if (Date.parse(entry.authorizationExpiresAt) <= Date.parse(manifest.migratedAt)) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
    if (!Number.isSafeInteger(entry.scheduleSeconds) || entry.scheduleSeconds < 60 || entry.scheduleSeconds > 86_400) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
    [entry.routeIdentitySha256, entry.routeReleaseSha256, entry.routeManifestSha256, entry.authorizationReceiptSha256, entry.sourcePolicySha256].forEach(assertHash);
    const identity = { sourceId: entry.sourceId, canonicalFeedUrl: entry.feedUrl, siteUrl: entry.siteUrl, sourceKind: "rss", collectionMode: "rss" };
    return Object.freeze({ ...entry, identitySha256: sha256(canonicalJson(identity)), sourceConfigEpoch: 1, sourceSafetyEpoch: 1 });
  });
  if (seen.size !== EXPECTED_RSS.size) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
  return Object.freeze(entries);
}

function assertSchema10(database: DatabaseSync, expected = SOURCE_REGISTRY_SCHEMA10_SHA256): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version !== 10) throw new SourceRegistryMigrationError("VERSION_DRIFT");
  assertClosedConnection(database);
  const foreignKeys = Number((database.prepare("PRAGMA foreign_keys").get() as Record<string, unknown>).foreign_keys);
  const recursiveTriggers = Number((database.prepare("PRAGMA recursive_triggers").get() as Record<string, unknown>).recursive_triggers);
  if (foreignKeys !== 1 || recursiveTriggers !== 1) throw new SourceRegistryMigrationError("SCHEMA10_DRIFT");
  for (const table of SOURCE_REGISTRY_TABLES) {
    if (database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table) === undefined) throw new SourceRegistryMigrationError("SCHEMA10_DRIFT");
  }
  if (database.prepare("PRAGMA foreign_key_check").get() !== undefined) throw new SourceRegistryMigrationError("SCHEMA10_DRIFT");
  const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
  if (integrity.integrity_check !== "ok") throw new SourceRegistryMigrationError("SCHEMA10_DRIFT");
  if (expected !== "__SOURCE_REGISTRY_SCHEMA10_SHA256__" && sourceRegistrySchemaFingerprint(database) !== expected) throw new SourceRegistryMigrationError("SCHEMA10_DRIFT");
}

export function applySourceRegistryMigration(
  database: DatabaseSync,
  sql: string,
  manifest: SourceRegistryMigrationManifest,
  options: Readonly<{ applyEnabled?: boolean }> = {}
): Readonly<{ applied: boolean; replay: boolean; schemaFingerprintSha256: string }> {
  if (options.applyEnabled !== true) throw new SourceRegistryMigrationError("APPLY_DISABLED");
  if (sha256(sql) !== SOURCE_REGISTRY_MIGRATION_SHA256) throw new SourceRegistryMigrationError("MIGRATION_HASH");
  if (canonicalSourceRegistryMigrationSha256(sql) !== SOURCE_REGISTRY_MIGRATION_CANONICAL_SHA256) throw new SourceRegistryMigrationError("MIGRATION_CANONICAL_HASH");
  const rssManifest = validateManifest(manifest);
  const manifestSha256 = sha256(canonicalJson(manifest));
  database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  const xRows = validatedXRows(database);
  if (version === 10) {
    assertSchema10(database);
    assertReplayBinding(database, manifestSha256, rssManifest, xRows);
    return Object.freeze({ applied: false, replay: true, schemaFingerprintSha256: sourceRegistrySchemaFingerprint(database) });
  }
  if (version !== 9) throw new SourceRegistryMigrationError("VERSION_DRIFT");
  assertClosedConnection(database);
  if (sourceRegistrySchemaFingerprint(database) !== SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256) throw new SourceRegistryMigrationError("SCHEMA9_DRIFT");

  try {
    database.exec("CREATE TEMP TABLE migration_0010_preflight(source_user_version INTEGER NOT NULL,source_schema_sha256 TEXT NOT NULL,source_0009_raw_sha256 TEXT NOT NULL,source_0009_canonical_sha256 TEXT NOT NULL,target_schema_sha256 TEXT NOT NULL,migration_0010_canonical_sha256 TEXT NOT NULL,manifest_sha256 TEXT NOT NULL,apply_enabled INTEGER NOT NULL CHECK(apply_enabled IN(0,1)),migrated_at TEXT NOT NULL) STRICT");
    database.prepare("INSERT INTO migration_0010_preflight VALUES(?,?,?,?,?,?,?,?,?)").run(9, SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256, SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256, SOURCE_REGISTRY_SOURCE_0009_CANONICAL_SHA256, SOURCE_REGISTRY_SCHEMA10_SHA256, SOURCE_REGISTRY_MIGRATION_CANONICAL_SHA256, manifestSha256, 1, manifest.migratedAt);
    database.exec("CREATE TEMP TABLE migration_0010_rss_manifest(source_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,feed_url TEXT NOT NULL UNIQUE,site_url TEXT NOT NULL UNIQUE,schedule_seconds INTEGER NOT NULL,route_id TEXT NOT NULL,route_identity_sha256 TEXT NOT NULL,route_release_sha256 TEXT NOT NULL,route_manifest_sha256 TEXT NOT NULL,rights_status TEXT NOT NULL,media_policy TEXT NOT NULL,authorization_expires_at TEXT NOT NULL,authorization_receipt_sha256 TEXT NOT NULL,source_policy_sha256 TEXT NOT NULL,identity_sha256 TEXT NOT NULL UNIQUE,source_config_epoch INTEGER NOT NULL,source_safety_epoch INTEGER NOT NULL) STRICT");
    const insertRss = database.prepare("INSERT INTO migration_0010_rss_manifest VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const sourceEpochs = new Map((database.prepare("SELECT source_id,stop_epoch FROM source").all() as Array<Record<string, unknown>>).map((row) => [String(row.source_id), Number(row.stop_epoch)]));
    for (const entry of rssManifest) {
      const epoch = sourceEpochs.get(entry.sourceId);
      if (!Number.isSafeInteger(epoch) || epoch === undefined || epoch < 1) throw new SourceRegistryMigrationError("MANIFEST_INVALID");
      insertRss.run(entry.sourceId, entry.displayName, entry.feedUrl, entry.siteUrl, entry.scheduleSeconds, entry.routeId, entry.routeIdentitySha256, entry.routeReleaseSha256, entry.routeManifestSha256, entry.rightsStatus, entry.mediaPolicy, entry.authorizationExpiresAt, entry.authorizationReceiptSha256, entry.sourcePolicySha256, entry.identitySha256, epoch, epoch);
    }
    database.exec("CREATE TEMP TABLE migration_0010_x_identity(source_id TEXT PRIMARY KEY,handle TEXT NOT NULL,canonical_url TEXT NOT NULL UNIQUE,inventory_sha256 TEXT NOT NULL,identity_sha256 TEXT NOT NULL UNIQUE) STRICT");
    const insertX = database.prepare("INSERT INTO migration_0010_x_identity VALUES(?,?,?,?,?)");
    for (const row of xRows) {
      const sourceId = String(row.source_id); const handle = String(row.handle); const canonicalUrl = String(row.canonical_url); const inventorySha256 = String(row.inventory_sha256);
      const identitySha256 = sha256(canonicalJson({ sourceId, canonicalFeedUrl: null, siteUrl: canonicalUrl, sourceKind: "x_manual", collectionMode: "manual_url" }));
      insertX.run(sourceId, handle, canonicalUrl, inventorySha256, identitySha256);
    }
    database.exec(sql);
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* migration owns its transaction */ }
    for (const table of ["migration_0010_preflight", "migration_0010_rss_manifest", "migration_0010_x_identity"]) {
      try { database.exec(`DROP TABLE IF EXISTS temp.${table}`); } catch { /* cleanup only */ }
    }
    if (error instanceof SourceRegistryMigrationError) throw error;
    throw new SourceRegistryMigrationError("MIGRATION_FAILED", error instanceof Error ? error.message : String(error));
  }
  for (const table of ["migration_0010_preflight", "migration_0010_rss_manifest", "migration_0010_x_identity"]) {
    try { database.exec(`DROP TABLE IF EXISTS temp.${table}`); } catch { /* cleanup only */ }
  }
  assertSchema10(database);
  return Object.freeze({ applied: true, replay: false, schemaFingerprintSha256: sourceRegistrySchemaFingerprint(database) });
}

export function assertSourceRegistrySchema(database: DatabaseSync): void {
  assertSchema10(database);
}
