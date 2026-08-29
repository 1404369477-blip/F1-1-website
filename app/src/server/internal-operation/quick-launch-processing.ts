import { createHash, randomBytes } from "node:crypto";
import { basename, isAbsolute, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { readAdminDeploymentManifest } from "../admin-service/deployment.ts";
import { readVerifiedAdminReleaseManifest } from "../admin-service/release-manifest.ts";
import { openExistingSafeDatabase } from "../db/database.ts";
import { canonicalJsonV1, SqliteInternalOperationGateway, type OwnerProcess, type OwnerSupervisorHandoff } from "./gateway.ts";
import { loadReleaseRuntimeGate } from "./release.ts";
import { persistOwnerSupervisorHandoff } from "./owner-supervisor.ts";
import { SOURCE_REGISTRY_SCHEMA10_SHA256, SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256, verifyAuthorityActivationReceipt } from "../rss/source-registry-migration.ts";

export const QUICK_LAUNCH_PROCESSING_SCHEMA_VERSION = "quick-launch-processing-preflight-v1" as const;
export const QUICK_LAUNCH_PROCESSING_MAX_LIMIT = 50 as const;
export const QUICK_LAUNCH_PROCESSING_FENCE_TTL_MS = 900_000 as const;
export const QUICK_LAUNCH_PROCESSING_HANDOFF_TTL_MS = 900_000 as const;
const ZERO_HASH = "0".repeat(64);
const HASH = /^[0-9a-f]{64}$/u;
const FENCE_KINDS = Object.freeze(["publication", "completeness"] as const);
const AUTHORITY_CAPABILITIES = Object.freeze([
  "bilingual_auto_refine",
  "bilingual_manual_mutation",
  "source_registry_management",
] as const);

export type QuickLaunchProcessingFenceKind = typeof FENCE_KINDS[number];
export type QuickLaunchProcessingAuthorityCapability = typeof AUTHORITY_CAPABILITIES[number];

export type QuickLaunchProcessingCandidate = Readonly<{
  candidateId: string;
  sourceId: string;
  sourceRevision: number;
  inputContentHash: string;
  publicId: string | null;
  sourceRegistryRevision: number;
  sourceIdentitySha256: string;
  sourceConfigEpoch: number;
  sourceSafetyEpoch: number;
  authorizationVersion: number;
  policyEpoch: number;
  recoveryEpoch: number;
  writerEpoch: number;
  missingFenceKinds: readonly QuickLaunchProcessingFenceKind[];
}>;

export type QuickLaunchProcessingFenceJob = Readonly<{
  candidateId: string;
  fenceKind: QuickLaunchProcessingFenceKind;
  operationId: string;
  fenceReceiptId: string;
  expiresAt: string;
}>;

export type QuickLaunchProcessingPlan = Readonly<{
  schemaVersion: typeof QUICK_LAUNCH_PROCESSING_SCHEMA_VERSION;
  limit: number;
  authorityPending: Readonly<Record<QuickLaunchProcessingAuthorityCapability, boolean>>;
  automaticReviewOperations: 0;
  automaticPublishOperations: 0;
  automaticOperationOutbox: 0;
  candidates: readonly QuickLaunchProcessingCandidate[];
  fenceJobs: readonly QuickLaunchProcessingFenceJob[];
}>;

export type QuickLaunchProcessingHandoffSet = Readonly<{
  authority: Partial<Record<QuickLaunchProcessingAuthorityCapability, OwnerSupervisorHandoff>>;
  fence: Readonly<Record<string, OwnerSupervisorHandoff>>;
}>;

export type QuickLaunchProcessingFenceReceipt = Readonly<{
  operationId: string;
  fenceReceiptId: string;
  candidateId: string;
  fenceKind: QuickLaunchProcessingFenceKind;
  receiptSha256: string;
  expiresAt: string;
  state: "issued" | "reused";
}>;

export type QuickLaunchProcessingResult = Readonly<{
  schemaVersion: typeof QUICK_LAUNCH_PROCESSING_SCHEMA_VERSION;
  decision: "PASS";
  limit: number;
  authority: Readonly<Record<QuickLaunchProcessingAuthorityCapability, Readonly<{
    operationId: string;
    state: "enabled";
    version: number;
    receiptSha256: string;
    reused: boolean;
  }>>>;
  candidates: readonly QuickLaunchProcessingCandidate[];
  fences: readonly QuickLaunchProcessingFenceReceipt[];
  automaticReviewOperations: 0;
  automaticPublishOperations: 0;
  automaticOperationOutbox: 0;
}>;

type QuickLaunchProcessingAuthorityState = Readonly<{
  capabilityId: QuickLaunchProcessingAuthorityCapability;
  state: "closed" | "enabled";
  version: number;
  operationId: string | null;
  receiptSha256: string | null;
}>;

type QuickLaunchProcessingAuthorityStateMap = Readonly<Record<QuickLaunchProcessingAuthorityCapability, QuickLaunchProcessingAuthorityState>>;

function fail(code: string): never { throw new Error(code); }
function assert(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function validHash(value: unknown): value is string { return typeof value === "string" && HASH.test(value); }
function validId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u.test(value); }
function asInt(value: unknown, code: string): number {
  const parsed = Number(value);
  assert(Number.isSafeInteger(parsed), code);
  return parsed;
}
function asString(value: unknown, code: string): string { assert(typeof value === "string", code); return value; }
function row(value: unknown, code: string): Record<string, unknown> {
  assert(value !== null && value !== undefined && typeof value === "object", code);
  return value as Record<string, unknown>;
}
function utcAt(time: number): string {
  const value = new Date(time).toISOString();
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value), "QUICK_LAUNCH_PROCESSING_CLOCK_INVALID");
  return value;
}
function assertSchema10(database: DatabaseSync): void {
  const version = asInt(row(database.prepare("PRAGMA user_version").get(), "SCHEMA_READ_INVALID").user_version, "SCHEMA_READ_INVALID");
  assert(version === 10, "SCHEMA10_REQUIRED");
}
function assertNoProhibitedAutomation(database: DatabaseSync): void {
  const operations = asInt(row(database.prepare(
    "SELECT COUNT(*) AS count FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher')"
  ).get(), "AUTOMATION_COUNT_READ_INVALID").count, "AUTOMATION_COUNT_INVALID");
  const outbox = asInt(row(database.prepare(
    `SELECT COUNT(*) AS count FROM internal_operation_outbox o
     JOIN internal_operation op ON op.operation_id=o.operation_id
     WHERE op.owner_process IN ('automatic_reviewer','automatic_publisher')`
  ).get(), "AUTOMATION_OUTBOX_READ_INVALID").count, "AUTOMATION_OUTBOX_INVALID");
  assert(operations === 0 && outbox === 0, "AUTOMATIC_REVIEW_OR_PUBLISH_PRESENT");
}

function authorityRow(database: DatabaseSync, capabilityId: string): Record<string, unknown> {
  const value = database.prepare(
    "SELECT state,version,updated_by_operation_id,authority_receipt_sha256,schema_sha256 FROM quick_launch_authority_v2 WHERE capability_id=?"
  ).get(capabilityId);
  return row(value, "AUTHORITY_ROW_MISSING");
}

function readAuthority(database: DatabaseSync, capabilityId: QuickLaunchProcessingAuthorityCapability, schemaSha256: string): QuickLaunchProcessingAuthorityState {
  const authority = authorityRow(database, capabilityId);
  assert(authority.schema_sha256 === schemaSha256, "AUTHORITY_SCHEMA_MISMATCH");
  const version = asInt(authority.version, "AUTHORITY_VERSION_INVALID");
  if (authority.state === "closed") {
    assert(version === 1 && authority.updated_by_operation_id === null && authority.authority_receipt_sha256 === null,
      "AUTHORITY_CLOSED_STATE_INVALID");
    return Object.freeze({ capabilityId, state: "closed", version, operationId: null, receiptSha256: null });
  }
  assert(authority.state === "enabled" && version >= 2 && typeof authority.updated_by_operation_id === "string" &&
    validId(authority.updated_by_operation_id) && validHash(authority.authority_receipt_sha256), "AUTHORITY_ENABLED_STATE_INVALID");
  return Object.freeze({
    capabilityId,
    state: "enabled",
    version,
    operationId: authority.updated_by_operation_id,
    receiptSha256: authority.authority_receipt_sha256,
  });
}

function readAuthorities(database: DatabaseSync, schemaSha256: string, verifyEnabled = false): QuickLaunchProcessingAuthorityStateMap {
  const values = {} as Record<QuickLaunchProcessingAuthorityCapability, QuickLaunchProcessingAuthorityState>;
  let pendingSeen = false;
  for (const capabilityId of AUTHORITY_CAPABILITIES) {
    const value = readAuthority(database, capabilityId, schemaSha256);
    if (value.state === "closed") pendingSeen = true;
    else assert(!pendingSeen, "AUTHORITY_ORDER_INVALID");
    values[capabilityId] = value;
  }
  const result = Object.freeze(values) as QuickLaunchProcessingAuthorityStateMap;
  if (verifyEnabled) assertEnabledAuthorityReceipts(database, result, schemaSha256);
  return result;
}

function verifyAuthorityReceipt(database: DatabaseSync, authority: QuickLaunchProcessingAuthorityState): void {
  assert(authority.state === "enabled" && authority.operationId !== null && authority.receiptSha256 !== null,
    "AUTHORITY_ENABLED_STATE_INVALID");
  const verified = verifyAuthorityActivationReceipt(database, {
    capabilityId: authority.capabilityId,
    operationId: authority.operationId,
    receiptSha256: authority.receiptSha256,
  });
  assert(verified.valid && Object.values(verified.truth).every(Boolean), "AUTHORITY_RECEIPT_INVALID");
}

function assertEnabledAuthorityReceipts(database: DatabaseSync, authorities: QuickLaunchProcessingAuthorityStateMap, schemaSha256: string): void {
  const auto = authorities.bilingual_auto_refine;
  const manual = authorities.bilingual_manual_mutation;
  const source = authorities.source_registry_management;
  const bilingualReady = auto.state === "enabled" && manual.state === "enabled";
  if (bilingualReady) {
    const bridge = row(database.prepare(
      "SELECT schema_sha256,enabled,status,reason_code,extension_sha256 FROM bilingual_authority_capability_v1 WHERE capability_id='bilingual-v1'"
    ).get(), "BILINGUAL_BRIDGE_MISSING");
    assert(bridge.schema_sha256 === SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256 && Number(bridge.enabled) === 1 && bridge.status === "enabled" &&
      bridge.reason_code === "READY" && bridge.extension_sha256 === schemaSha256, "BILINGUAL_BRIDGE_NOT_READY");
    verifyAuthorityReceipt(database, auto);
    verifyAuthorityReceipt(database, manual);
  }
  if (source.state === "enabled") verifyAuthorityReceipt(database, source);
}

function assertClosedControl(database: DatabaseSync): Record<string, unknown> {
  const control = row(database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get(), "CONTROL_ROW_MISSING");
  assert(control.phase === "disabled" && control.global_stop_state === "stopped" &&
    control.emergency_stop_state === "clear" && control.recovery_state === "fenced" &&
    control.deletion_fence_state === "clear" && control.publication_fence_state === "clear",
    "QUICK_LAUNCH_CONTROL_NOT_PREFLIGHT_CLOSED");
  return control;
}

function validateCandidate(value: Record<string, unknown>, nowMs: number, releaseSha256: string, manifestSha256: string): QuickLaunchProcessingCandidate {
  const candidateId = asString(value.candidate_id, "CANDIDATE_ID_INVALID");
  const sourceId = asString(value.source_id, "CANDIDATE_ID_INVALID");
  const failClosed = (reason: string): never => fail(`QUICK_LAUNCH_PROCESSING_READINESS_FAILED:${candidateId}:${reason}`);
  function assertCandidate(condition: unknown, reason: string): asserts condition {
    assert(condition, `QUICK_LAUNCH_PROCESSING_READINESS_FAILED:${candidateId}:${reason}`);
  }
  const candidateInt = (input: unknown, reason: string): number => {
    const normalized = typeof input === "bigint" ? Number(input) : input;
    if (typeof normalized !== "number" || !Number.isSafeInteger(normalized) || normalized < 1) failClosed(reason);
    return normalized as number;
  };
  const candidateString = (input: unknown, reason: string): string => {
    if (typeof input !== "string") failClosed(reason);
    return input as string;
  };
  assert(validId(candidateId) && validId(sourceId), "QUICK_LAUNCH_PROCESSING_READINESS_FAILED:IDENTITY");
  const sourceRevision = candidateInt(value.source_revision, "SOURCE_REVISION");
  const inputContentHash = candidateString(value.source_payload_hash, "INPUT_HASH");
  assert(validHash(inputContentHash), "QUICK_LAUNCH_PROCESSING_READINESS_FAILED:INPUT_HASH");
  assertCandidate(value.has_lineage === 0 && value.slot_count === 0, "BILINGUAL_SLOT_OR_LINEAGE_PRESENT");
  assertCandidate(value.registry_revision !== null && value.config_revision !== null, "SOURCE_REGISTRY_MISSING");
  const registryRevision = candidateInt(value.registry_revision, "SOURCE_REGISTRY_REVISION");
  const configRevision = candidateInt(value.config_revision, "SOURCE_CONFIG_REVISION");
  assertCandidate(sourceRevision === configRevision && configRevision === registryRevision, "SOURCE_REVISION_DRIFT");
  assertCandidate(value.legacy_enabled === 1 && candidateInt(value.stop_epoch, "SOURCE_STOP_EPOCH") === candidateInt(value.registry_source_config_epoch, "SOURCE_STOP_EPOCH"), "LEGACY_SOURCE_DISABLED");
  assertCandidate(value.enabled === 1 && value.lifecycle_status === "active" && value.collection_onboarding_status === "active" &&
    value.source_kind === "rss" && value.collection_mode === "rss", "SOURCE_REGISTRY_NOT_ACTIVE_RSS");
  assertCandidate(value.normalization_status === "valid" && (value.dedup_status === "unique" || value.dedup_status === "linked_existing"), "NORMALIZATION_OR_DEDUPE");
  assertCandidate(value.identity_status === "unknown" || value.identity_status === "verified", "IDENTITY_STATUS");
  assertCandidate(value.relevance_status === "unknown" || value.relevance_status === "qualified", "RELEVANCE_STATUS");
  assertCandidate(value.monitorability === "monitorable", "MONITORABILITY");
  assertCandidate(value.adapter_status === "ready" && value.adapter_authorization_status === "valid" && value.platform_allowed === "allowed" && value.source_stop_status === "clear", "ADAPTER_OR_PLATFORM");
  assertCandidate(value.rights_status === "clear" && (value.media_policy === "allowlisted" || value.media_policy === "zero_media"), "RIGHTS_OR_MEDIA_POLICY");
  assertCandidate(value.current_operation_id === null, "SOURCE_MUTATION_OPEN");
  const authorizationExpiresAt = value.authorization_expires_at === null ? null : candidateString(value.authorization_expires_at, "AUTHORIZATION_EXPIRY");
  assertCandidate(authorizationExpiresAt !== null && Number.isFinite(Date.parse(authorizationExpiresAt)) && Date.parse(authorizationExpiresAt) > nowMs, "AUTHORIZATION_EXPIRED");
  assertCandidate(Number.isFinite(Date.parse(candidateString(value.latest_health_observed_at, "SOURCE_HEALTH"))), "SOURCE_HEALTH");
  assertCandidate(value.latest_health_state === "healthy" || value.latest_health_state === "degraded", "SOURCE_HEALTH");
  assertCandidate(validHash(candidateString(value.authorization_receipt_sha256, "SOURCE_AUTHORIZATION_HASH")), "SOURCE_AUTHORIZATION_HASH");
  assertCandidate(validHash(candidateString(value.source_policy_sha256, "SOURCE_POLICY_HASH")), "SOURCE_POLICY_HASH");
  assertCandidate(value.route_release_sha256 === releaseSha256 && value.route_manifest_sha256 === manifestSha256, "ROUTE_RELEASE_MISMATCH");
  const controlEpochs = {
    sourceConfig: candidateInt(value.control_source_config_epoch, "CONTROL_EPOCH"),
    sourceSafety: candidateInt(value.control_source_safety_epoch, "CONTROL_EPOCH"),
    authorization: candidateInt(value.control_authorization_version, "CONTROL_EPOCH"),
    policy: candidateInt(value.control_policy_epoch, "CONTROL_EPOCH"),
    recovery: candidateInt(value.control_recovery_epoch, "CONTROL_EPOCH"),
    writer: candidateInt(value.control_writer_epoch, "CONTROL_EPOCH"),
  };
  assertCandidate(candidateInt(value.registry_source_config_epoch, "REGISTRY_EPOCH") === controlEpochs.sourceConfig, "REGISTRY_EPOCH");
  assertCandidate(candidateInt(value.registry_source_safety_epoch, "REGISTRY_EPOCH") === controlEpochs.sourceSafety, "REGISTRY_EPOCH");
  assertCandidate(candidateInt(value.registry_authorization_version, "REGISTRY_EPOCH") === controlEpochs.authorization, "REGISTRY_EPOCH");
  assertCandidate(candidateInt(value.registry_policy_epoch, "REGISTRY_EPOCH") === controlEpochs.policy, "REGISTRY_EPOCH");
  assertCandidate(candidateInt(value.registry_recovery_epoch, "REGISTRY_EPOCH") === controlEpochs.recovery, "REGISTRY_EPOCH");
  return Object.freeze({
    candidateId,
    sourceId,
    sourceRevision,
    inputContentHash,
    publicId: value.public_id === null ? null : candidateString(value.public_id, "PUBLIC_ID"),
    sourceRegistryRevision: registryRevision,
    sourceIdentitySha256: candidateString(value.identity_sha256, "SOURCE_IDENTITY"),
    sourceConfigEpoch: controlEpochs.sourceConfig,
    sourceSafetyEpoch: controlEpochs.sourceSafety,
    authorizationVersion: controlEpochs.authorization,
    policyEpoch: controlEpochs.policy,
    recoveryEpoch: controlEpochs.recovery,
    writerEpoch: controlEpochs.writer,
    missingFenceKinds: Object.freeze([...FENCE_KINDS].filter((kind) => !validFence(value, candidateId, kind))),
  });
}

function validFence(candidate: Record<string, unknown>, candidateId: string, fenceKind: QuickLaunchProcessingFenceKind): boolean {
  return candidate[`${fenceKind}_valid`] === 1;
}

function fenceIdentifier(candidateId: string, fenceKind: QuickLaunchProcessingFenceKind, expiresAt: string): string {
  return `qlp-${sha256(`quick-launch-processing-preflight-fence-v1\n${canonicalJsonV1({
    candidateId,
    fenceKind,
    expiresAt,
  })}`).slice(0, 48)}`;
}

function fenceJob(candidateId: string, fenceKind: QuickLaunchProcessingFenceKind, expiresAt: string): QuickLaunchProcessingFenceJob {
  const identifier = fenceIdentifier(candidateId, fenceKind, expiresAt);
  return Object.freeze({ candidateId, fenceKind, operationId: identifier, fenceReceiptId: identifier, expiresAt });
}

function validExistingFence(database: DatabaseSync, input: Readonly<{ candidateId: string; fenceKind: QuickLaunchProcessingFenceKind; policyEpoch: number; recoveryEpoch: number; writerEpoch: number; nowMs: number; expiresAt?: string }>): boolean {
  const conditions = input.expiresAt === undefined
    ? "state='clear' AND reason_code='QUICK_LAUNCH_BILINGUAL_PREFLIGHT' AND issuer='f1plus1-system-supervisor-v1' AND expires_at>?"
    : "state='clear' AND reason_code='QUICK_LAUNCH_BILINGUAL_PREFLIGHT' AND issuer='f1plus1-system-supervisor-v1' AND expires_at=?";
  const row_ = database.prepare(
    `SELECT 1 FROM generic_fence_receipt WHERE scope_kind='candidate' AND scope_id=? AND fence_kind=?
     AND policy_epoch=? AND recovery_epoch=? AND writer_epoch=? AND ${conditions} LIMIT 1`
  ).get(input.candidateId, input.fenceKind, input.policyEpoch, input.recoveryEpoch, input.writerEpoch,
    input.expiresAt === undefined ? utcAt(input.nowMs) : input.expiresAt);
  return row_ !== undefined;
}

export function planQuickLaunchProcessingPreflight(input: Readonly<{
  database: DatabaseSync;
  releaseSha256: string;
  manifestSha256: string;
  schemaSha256?: string;
  limit: number;
  now?: () => Date;
}>): QuickLaunchProcessingPlan {
  assert(Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= QUICK_LAUNCH_PROCESSING_MAX_LIMIT, "QUICK_LAUNCH_PROCESSING_LIMIT_INVALID");
  assert(validHash(input.releaseSha256) && validHash(input.manifestSha256), "QUICK_LAUNCH_PROCESSING_RELEASE_IDENTITY_INVALID");
  const schemaSha256 = input.schemaSha256 ?? SOURCE_REGISTRY_SCHEMA10_SHA256;
  assert(schemaSha256 === SOURCE_REGISTRY_SCHEMA10_SHA256, "SCHEMA10_REQUIRED");
  const database = input.database;
  assertSchema10(database);
  assertNoProhibitedAutomation(database);
  const control = assertClosedControl(database);
  const authorities = readAuthorities(database, schemaSha256);
  assertEnabledAuthorityReceipts(database, authorities, schemaSha256);
  const authorityPending = Object.freeze(Object.fromEntries(
    AUTHORITY_CAPABILITIES.map((capabilityId) => [capabilityId, authorities[capabilityId].state === "closed"]),
  )) as Readonly<Record<QuickLaunchProcessingAuthorityCapability, boolean>>;
  const nowMs = (input.now ?? (() => new Date()))().getTime();
  assert(Number.isFinite(nowMs), "QUICK_LAUNCH_PROCESSING_CLOCK_INVALID");
  const nowAt = utcAt(nowMs);
  const expiresAt = utcAt(nowMs + QUICK_LAUNCH_PROCESSING_FENCE_TTL_MS);
  const rows = database.prepare(`
    SELECT c.candidate_id,c.source_id,c.source_revision,c.source_payload_hash,
           l.public_id,
           r.revision AS registry_revision,r.identity_sha256,r.enabled,r.lifecycle_status,r.collection_onboarding_status,
           r.source_kind,r.collection_mode,r.normalization_status,r.dedup_status,r.identity_status,r.relevance_status,
           r.monitorability,r.adapter_status,r.adapter_authorization_status,r.platform_allowed,r.source_stop_status,
           r.authorization_expires_at,r.current_operation_id,r.source_config_epoch AS registry_source_config_epoch,
           r.source_safety_epoch AS registry_source_safety_epoch,r.authorization_version AS registry_authorization_version,
           r.policy_epoch AS registry_policy_epoch,r.recovery_epoch AS registry_recovery_epoch,
           cfg.source_revision AS config_revision,cfg.rights_status,cfg.media_policy,cfg.authorization_receipt_sha256,
           cfg.source_policy_sha256,cfg.route_release_sha256,cfg.route_manifest_sha256,
           legacy.enabled AS legacy_enabled,legacy.stop_epoch,
           control.source_config_epoch AS control_source_config_epoch,control.source_safety_epoch AS control_source_safety_epoch,
           control.authorization_version AS control_authorization_version,control.policy_epoch AS control_policy_epoch,
           control.recovery_epoch AS control_recovery_epoch,control.writer_epoch AS control_writer_epoch,
           (SELECT COUNT(*) FROM bilingual_candidate_lineage_v1 lineage WHERE lineage.candidate_id=c.candidate_id) AS has_lineage,
           (SELECT COUNT(*) FROM bilingual_language_slot_v1 slot WHERE slot.candidate_id=c.candidate_id) AS slot_count,
           (SELECT CASE WHEN COUNT(*)=0 THEN 0 WHEN MAX(CASE WHEN g.fence_kind='publication' AND g.state='clear' AND g.reason_code='QUICK_LAUNCH_BILINGUAL_PREFLIGHT' AND g.issuer='f1plus1-system-supervisor-v1' AND g.policy_epoch=control.policy_epoch AND g.recovery_epoch=control.recovery_epoch AND g.writer_epoch=control.writer_epoch AND g.expires_at>? THEN 1 ELSE 0 END)=1 THEN 1 ELSE 0 END FROM generic_fence_receipt g WHERE g.scope_kind='candidate' AND g.scope_id=c.candidate_id AND g.fence_kind='publication') AS publication_valid,
           (SELECT CASE WHEN COUNT(*)=0 THEN 0 WHEN MAX(CASE WHEN g.fence_kind='completeness' AND g.state='clear' AND g.reason_code='QUICK_LAUNCH_BILINGUAL_PREFLIGHT' AND g.issuer='f1plus1-system-supervisor-v1' AND g.policy_epoch=control.policy_epoch AND g.recovery_epoch=control.recovery_epoch AND g.writer_epoch=control.writer_epoch AND g.expires_at>? THEN 1 ELSE 0 END)=1 THEN 1 ELSE 0 END FROM generic_fence_receipt g WHERE g.scope_kind='candidate' AND g.scope_id=c.candidate_id AND g.fence_kind='completeness') AS completeness_valid,
           (SELECT h.state FROM source_registry_health_v1 h WHERE h.source_id=c.source_id ORDER BY h.observed_at DESC,h.health_id DESC LIMIT 1) AS latest_health_state,
           (SELECT h.observed_at FROM source_registry_health_v1 h WHERE h.source_id=c.source_id ORDER BY h.observed_at DESC,h.health_id DESC LIMIT 1) AS latest_health_observed_at
      FROM pending_review_candidate c
      LEFT JOIN bilingual_candidate_lineage_v1 l ON l.candidate_id=c.candidate_id
      JOIN source legacy ON legacy.source_id=c.source_id
      LEFT JOIN source_registry_v1 r ON r.source_id=c.source_id
      LEFT JOIN source_registry_rss_config_v1 cfg ON cfg.source_id=c.source_id
      JOIN internal_control control ON control.singleton_id=1
     WHERE c.review_status='pending_review'
     ORDER BY c.published_at DESC,c.candidate_id ASC
     LIMIT ?`).all(nowAt, nowAt, input.limit) as Array<Record<string, unknown>>;
  const candidates = rows.map((value) => validateCandidate(value, nowMs, input.releaseSha256, input.manifestSha256));
  const fenceJobs = candidates.flatMap((candidate) => candidate.missingFenceKinds.map((fenceKind) => fenceJob(candidate.candidateId, fenceKind, expiresAt)));
  return Object.freeze({
    schemaVersion: QUICK_LAUNCH_PROCESSING_SCHEMA_VERSION,
    limit: input.limit,
    authorityPending,
    automaticReviewOperations: 0,
    automaticPublishOperations: 0,
    automaticOperationOutbox: 0,
    candidates,
    fenceJobs,
  }) satisfies QuickLaunchProcessingPlan;
}

function handoff(input: Readonly<{
  database: DatabaseSync;
  handoffId: string;
  ownerProcess: OwnerProcess;
  releaseSha256: string;
  manifestSha256: string;
  nowMs: number;
}>): OwnerSupervisorHandoff {
  assert(validId(input.handoffId), "QUICK_LAUNCH_HANDOFF_ID_INVALID");
  const verifiedAt = utcAt(input.nowMs);
  const expiresAt = utcAt(input.nowMs + QUICK_LAUNCH_PROCESSING_HANDOFF_TTL_MS);
  const oneTimeNonce = randomBytes(32).toString("base64url");
  const core = Object.freeze({
    schemaVersion: "owner-supervisor-handoff-v1" as const,
    handoffId: input.handoffId,
    ownerProcess: input.ownerProcess,
    issuer: "f1plus1-owner-supervisor-v1" as const,
    oneTimeNonce,
    releaseSha256: input.releaseSha256,
    manifestSha256: input.manifestSha256,
    verifiedAt,
    expiresAt,
  });
  const receiptSha256 = sha256(canonicalJsonV1(core));
  const value = Object.freeze({ ...core, receiptSha256 }) satisfies OwnerSupervisorHandoff;
  persistOwnerSupervisorHandoff(input.database, value, (candidate) => candidate === value);
  return value;
}

export function createQuickLaunchProcessingHandoffSet(input: Readonly<{
  database: DatabaseSync;
  plan: QuickLaunchProcessingPlan;
  releaseSha256: string;
  manifestSha256: string;
  now?: number;
}>): QuickLaunchProcessingHandoffSet {
  const nowMs = input.now ?? Date.now();
  assert(Number.isSafeInteger(nowMs) && nowMs <= Date.now(), "QUICK_LAUNCH_PROCESSING_CLOCK_INVALID");
  const fenceHandoffs: Record<string, OwnerSupervisorHandoff> = {};
  const authority: Partial<Record<QuickLaunchProcessingAuthorityCapability, OwnerSupervisorHandoff>> = {};
  for (const capabilityId of AUTHORITY_CAPABILITIES) {
    if (!input.plan.authorityPending[capabilityId]) continue;
    authority[capabilityId] = handoff({
      database: input.database,
      handoffId: `qlp-authority-${capabilityId}-${sha256(`quick-launch-processing-authority-v2\n${capabilityId}\n${input.releaseSha256}\n${input.manifestSha256}\n${nowMs}`).slice(0, 32)}`,
      ownerProcess: "admin_http",
      releaseSha256: input.releaseSha256,
      manifestSha256: input.manifestSha256,
      nowMs,
    });
  }
  for (const job of input.plan.fenceJobs) {
    fenceHandoffs[job.operationId] = handoff({
      database: input.database,
      handoffId: `qlp-fence-${sha256(`quick-launch-processing-fence-v1\n${job.operationId}\n${nowMs}`).slice(0, 40)}`,
      ownerProcess: "system_supervisor",
      releaseSha256: input.releaseSha256,
      manifestSha256: input.manifestSha256,
      nowMs,
    });
  }
  return Object.freeze({ authority: Object.freeze(authority), fence: Object.freeze(fenceHandoffs) });
}

function issueFence(input: Readonly<{
  database: DatabaseSync;
  gateway: SqliteInternalOperationGateway;
  job: QuickLaunchProcessingFenceJob;
  handoff: OwnerSupervisorHandoff;
  releaseSha256: string;
  manifestSha256: string;
  schemaSha256: string;
  nowMs: number;
}>): QuickLaunchProcessingFenceReceipt {
  const control = assertClosedControl(input.database);
  const policyEpoch = asInt(control.policy_epoch, "CONTROL_EPOCH_INVALID");
  const recoveryEpoch = asInt(control.recovery_epoch, "CONTROL_EPOCH_INVALID");
  const writerEpoch = asInt(control.writer_epoch, "CONTROL_EPOCH_INVALID");
  if (validExistingFence(input.database, {
    candidateId: input.job.candidateId,
    fenceKind: input.job.fenceKind,
    policyEpoch,
    recoveryEpoch,
    writerEpoch,
    nowMs: input.nowMs,
  })) {
    return Object.freeze({
      operationId: input.job.operationId,
      fenceReceiptId: input.job.fenceReceiptId,
      candidateId: input.job.candidateId,
      fenceKind: input.job.fenceKind,
      receiptSha256: "0".repeat(64),
      expiresAt: input.job.expiresAt,
      state: "reused",
    });
  }
  const requestedAt = utcAt(input.nowMs);
  const requestHash = sha256(`quick-launch-processing-fence-request-v1\n${canonicalJsonV1({
    operationId: input.job.operationId,
    candidateId: input.job.candidateId,
    fenceKind: input.job.fenceKind,
    policyEpoch,
    recoveryEpoch,
    writerEpoch,
    expiresAt: input.job.expiresAt,
    releaseSha256: input.releaseSha256,
    manifestSha256: input.manifestSha256,
    schemaSha256: input.schemaSha256,
  })}`);
  const receiptSha256 = sha256(`quick-launch-processing-fence-receipt-v1\n${canonicalJsonV1({
    operationId: input.job.operationId,
    candidateId: input.job.candidateId,
    fenceKind: input.job.fenceKind,
    policyEpoch,
    recoveryEpoch,
    writerEpoch,
    observedAt: requestedAt,
    expiresAt: input.job.expiresAt,
    releaseSha256: input.releaseSha256,
    manifestSha256: input.manifestSha256,
    schemaSha256: input.schemaSha256,
  })}`);
  const requested = input.gateway.request(input.handoff, {
    schemaVersion: "operation-request-v1",
    operationId: input.job.operationId,
    idempotencyKey: input.job.operationId,
    operationKind: "system_producer",
    ownerProcess: "system_supervisor",
    capabilityClass: "control",
    policyId: "p-supervisor-fence-disabled",
    authorizationHandoffId: input.handoff.handoffId,
    controlAction: "fence_update",
    identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
    entitySet: [{
      entityKind: "generic_fence",
      entityId: input.job.fenceReceiptId,
      identitySelector: "bound_child",
      expectedVersion: null,
      expectedHash: ZERO_HASH,
    }],
    requiredFenceSet: [],
    expected: {
      controlVersion: asInt(control.version, "CONTROL_VERSION_INVALID"),
      entityVersion: null,
      entityHash: ZERO_HASH,
      schemaSha256: input.schemaSha256,
      releaseSha256: input.releaseSha256,
      manifestSha256: input.manifestSha256,
      sourceStopEpoch: null,
      writerEpoch,
      epochs: {
        sourceConfig: asInt(control.source_config_epoch, "CONTROL_EPOCH_INVALID"),
        sourceSafety: asInt(control.source_safety_epoch, "CONTROL_EPOCH_INVALID"),
        authorization: asInt(control.authorization_version, "CONTROL_EPOCH_INVALID"),
        policy: policyEpoch,
        recovery: recoveryEpoch,
      },
    },
    phase: "disabled",
    egressClass: "none",
    budgetRequest: null,
    modelRouteRef: null,
    requestHash,
    requestFingerprint: sha256(`quick-launch-processing-fence-fingerprint-v1\n${requestHash}`),
  });
  const authorized = input.gateway.authorize(requested);
  const permit = input.gateway.authorizeWrite(authorized, {
    entityKind: "generic_fence",
    entityId: input.job.fenceReceiptId,
    mutationKind: "insert",
    expectedVersion: null,
    expectedHash: ZERO_HASH,
  });
  input.gateway.mutate(permit, {
    entityKind: "generic_fence",
    entityId: input.job.fenceReceiptId,
    mutationKind: "insert",
    statement: "INSERT INTO generic_fence_receipt VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    parameters: [
      input.job.fenceReceiptId,
      "candidate",
      input.job.candidateId,
      input.job.fenceKind,
      "clear",
      "QUICK_LAUNCH_BILINGUAL_PREFLIGHT",
      "f1plus1-system-supervisor-v1",
      input.job.operationId,
      sha256(`quick-launch-processing-fence-nonce-v1\n${input.job.operationId}`).slice(0, 43),
      receiptSha256,
      policyEpoch,
      recoveryEpoch,
      writerEpoch,
      requestedAt,
      input.job.expiresAt,
    ],
  });
  input.gateway.postcheckFenceSet(authorized);
  return Object.freeze({
    operationId: input.job.operationId,
    fenceReceiptId: input.job.fenceReceiptId,
    candidateId: input.job.candidateId,
    fenceKind: input.job.fenceKind,
    receiptSha256,
    expiresAt: input.job.expiresAt,
    state: "issued",
  });
}

function enableAuthority(input: Readonly<{
  gateway: SqliteInternalOperationGateway;
  handoff: OwnerSupervisorHandoff;
  capabilityId: QuickLaunchProcessingAuthorityCapability;
  expectedVersion: number;
  releaseSha256: string;
  manifestSha256: string;
  schemaSha256: string;
}>): QuickLaunchProcessingResult["authority"][QuickLaunchProcessingAuthorityCapability] {
  const operationId = `quick-launch-processing-enable-${input.capabilityId}-${sha256(`quick-launch-processing-authority-operation-v2\n${input.capabilityId}\n${input.expectedVersion}\n${input.releaseSha256}\n${input.manifestSha256}\n${input.schemaSha256}`).slice(0, 32)}`;
  const authorityBinding = canonicalJsonV1({
    action: "enable",
    capabilityId: input.capabilityId,
    expectedVersion: input.expectedVersion,
    manifestSha256: input.manifestSha256,
    operationId,
    releaseSha256: input.releaseSha256,
    schemaSha256: input.schemaSha256,
  });
  const requestHash = sha256(`quick-launch-processing-authority-request-v2\n${authorityBinding}`);
  const receiptSha256 = sha256(`quick-launch-processing-authority-receipt-v2\n${authorityBinding}`);
  const transition = input.gateway.transitionQuickLaunchAuthority(input.handoff, {
    operationId,
    idempotencyKey: operationId,
    capabilityId: input.capabilityId,
    action: "enable",
    expectedVersion: input.expectedVersion,
    requestHash,
    authorityReceiptSha256: receiptSha256,
  });
  assert(transition.state === "enabled" && transition.version === input.expectedVersion + 1 && transition.receiptSha256 === receiptSha256,
    "AUTHORITY_TRANSITION_FAILED");
  return Object.freeze({ operationId, state: "enabled", version: transition.version, receiptSha256, reused: false });
}

export function runQuickLaunchProcessingPreflight(input: Readonly<{
  database: DatabaseSync;
  gateway: SqliteInternalOperationGateway;
  plan: QuickLaunchProcessingPlan;
  handoffs: QuickLaunchProcessingHandoffSet;
  releaseSha256: string;
  manifestSha256: string;
  schemaSha256?: string;
  now?: () => Date;
}>): QuickLaunchProcessingResult {
  const schemaSha256 = input.schemaSha256 ?? SOURCE_REGISTRY_SCHEMA10_SHA256;
  assert(schemaSha256 === SOURCE_REGISTRY_SCHEMA10_SHA256, "SCHEMA10_REQUIRED");
  assert(input.gateway.expectedSchemaSha256() === schemaSha256, "GATEWAY_SCHEMA_MISMATCH");
  assertSchema10(input.database);
  assertNoProhibitedAutomation(input.database);
  assertClosedControl(input.database);
  const nowMs = (input.now ?? (() => new Date()))().getTime();
  const before = readAuthorities(input.database, schemaSha256);
  const authority = {} as Record<QuickLaunchProcessingAuthorityCapability, QuickLaunchProcessingResult["authority"][QuickLaunchProcessingAuthorityCapability]>;
  let pendingSeen = false;
  for (const capabilityId of AUTHORITY_CAPABILITIES) {
    const current = before[capabilityId];
    const pending = current.state === "closed";
    assert(input.plan.authorityPending[capabilityId] === pending, "QUICK_LAUNCH_PROCESSING_PLAN_STALE");
    if (pending) {
      pendingSeen = true;
      const handoff = input.handoffs.authority[capabilityId];
      assert(handoff !== undefined, "AUTHORITY_HANDOFF_MISSING");
      authority[capabilityId] = enableAuthority({
        gateway: input.gateway,
        handoff,
        capabilityId,
        expectedVersion: current.version,
        releaseSha256: input.releaseSha256,
        manifestSha256: input.manifestSha256,
        schemaSha256,
      });
    } else {
      assert(!pendingSeen, "AUTHORITY_ORDER_INVALID");
      assert(current.operationId !== null && current.receiptSha256 !== null, "AUTHORITY_ENABLED_STATE_INVALID");
      authority[capabilityId] = Object.freeze({
        operationId: current.operationId,
        state: "enabled",
        version: current.version,
        receiptSha256: current.receiptSha256,
        reused: true,
      });
    }
  }
  const control = assertClosedControl(input.database);
  const policyEpoch = asInt(control.policy_epoch, "CONTROL_EPOCH_INVALID");
  const recoveryEpoch = asInt(control.recovery_epoch, "CONTROL_EPOCH_INVALID");
  const writerEpoch = asInt(control.writer_epoch, "CONTROL_EPOCH_INVALID");
  const candidateIds = new Set(input.plan.candidates.map((candidate) => candidate.candidateId));
  const fences = input.plan.fenceJobs.map((job) => {
    assert(candidateIds.has(job.candidateId), "FENCE_JOB_PLAN_MISMATCH");
    const value = input.handoffs.fence[job.operationId];
    assert(value !== undefined, "FENCE_HANDOFF_MISSING");
    return issueFence({
      database: input.database,
      gateway: input.gateway,
      job,
      handoff: value,
      releaseSha256: input.releaseSha256,
      manifestSha256: input.manifestSha256,
      schemaSha256,
      nowMs,
    });
  });
  assertNoProhibitedAutomation(input.database);
  const finalAuthorities = readAuthorities(input.database, schemaSha256, true);
  for (const capabilityId of AUTHORITY_CAPABILITIES) {
    const final = finalAuthorities[capabilityId];
    const result = authority[capabilityId];
    assert(final.state === "enabled" && final.operationId === result.operationId && final.receiptSha256 === result.receiptSha256,
      "AUTHORITY_FINAL_STATE_INVALID");
  }
  assert(input.plan.candidates.every((candidate) => candidate.missingFenceKinds.every((fenceKind) =>
    validExistingFence(input.database, {
      candidateId: candidate.candidateId,
      fenceKind,
      policyEpoch,
      recoveryEpoch,
      writerEpoch,
      nowMs,
    }))), "FENCE_ISSUANCE_INCOMPLETE");
  return Object.freeze({
    schemaVersion: QUICK_LAUNCH_PROCESSING_SCHEMA_VERSION,
    decision: "PASS",
    limit: input.plan.limit,
    authority: Object.freeze(authority),
    candidates: input.plan.candidates,
    fences,
    automaticReviewOperations: 0,
    automaticPublishOperations: 0,
    automaticOperationOutbox: 0,
  });
}

export function parseQuickLaunchProcessingPreflightCli(arguments_: readonly string[]): Readonly<{ manifestPath: string; limit: number }> {
  assert(arguments_.length === 4, "CLI_ARGUMENTS_FORBIDDEN");
  assert(arguments_[0] === "--manifest" && arguments_[2] === "--limit", "CLI_ARGUMENTS_FORBIDDEN");
  const manifestPath = arguments_[1]!;
  const limitText = arguments_[3]!;
  const limit = Number(limitText);
  assert(isAbsolute(manifestPath), "CLI_ARGUMENT_PATH_MUST_BE_ABSOLUTE");
  assert(/^[0-9]{1,2}$/u.test(limitText) && String(limit) === limitText &&
    Number.isSafeInteger(limit) && limit >= 1 && limit <= QUICK_LAUNCH_PROCESSING_MAX_LIMIT, "CLI_ARGUMENTS_FORBIDDEN");
  return Object.freeze({ manifestPath, limit });
}

export async function runQuickLaunchProcessingPreflightFromManifest(input: Readonly<{ manifestPath: string; limit: number; now?: () => Date }>): Promise<Readonly<{
  preflight: QuickLaunchProcessingResult;
  releaseId: string;
  manifestSha256: string;
  sourcePreimageSha256: string;
}>> {
  const now = input.now ?? (() => new Date());
  const manifestPath = resolve(input.manifestPath);
  const deployment = readAdminDeploymentManifest(manifestPath);
  const official = readVerifiedAdminReleaseManifest(
    deployment.targetReleaseAppRoot,
    deployment.officialReleaseManifestPath,
    deployment.officialReleaseManifestSha256,
  );
  const release = loadReleaseRuntimeGate({
    releaseRoot: deployment.targetReleaseAppRoot,
    fullManifestPath: deployment.fullReleaseManifestPath,
    fullManifestSha256: deployment.fullReleaseManifestSha256,
    fallbackManifestPath: deployment.fallbackReleaseManifestPath,
    fallbackManifestSha256: deployment.fallbackReleaseManifestSha256,
    pairReceiptPath: deployment.releasePairReceiptPath,
    pairReceiptSha256: deployment.releasePairReceiptSha256,
    expectedSourceCommitSha1: official.gitCommit,
    expectedSourceTreeSha1: official.gitTree,
    expectedPackageRootSha256: official.releaseRootSha256,
    activeRole: deployment.activeReleaseRole,
    activatedAt: now().toISOString(),
    previousActivationId: null,
  });
  assert(deployment.activeReleaseRole === "full_v10", "QUICK_LAUNCH_PROCESSING_REQUIRES_FULL_V10");
  assert(release.gate.receipt.role === "full_v10" && release.gate.receipt.schemaVersion === "f1plus1-release-activation-v10" &&
    release.gate.receipt.schemaSha256 === deployment.reviewSchemaSha256, "QUICK_LAUNCH_PROCESSING_RELEASE_SCHEMA_INVALID");
  assert(release.gate.capabilities.automaticReview === false && release.gate.capabilities.automaticPublish === false, "AUTOMATION_CAPABILITY_PRESENT");
  const releaseSha256 = release.gate.receipt.sourcePreimageSha256;
  const manifestSha256 = release.gate.receipt.manifestSha256;
  const databasePath = resolve(deployment.reviewDatabasePath);
  const databaseBasename = basename(databasePath);
  const databaseIdentity = {
    ...deployment.reviewDatabaseIdentity,
    dev: Number(deployment.reviewDatabaseIdentity.dev),
    ino: Number(deployment.reviewDatabaseIdentity.ino),
  };
  const database = openExistingSafeDatabase(databasePath, databaseBasename, databaseIdentity, [10]);
  let gateway: SqliteInternalOperationGateway | null = null;
  try {
    const plan = release.gate.run("read", () => planQuickLaunchProcessingPreflight({
      database,
      releaseSha256,
      manifestSha256,
      schemaSha256: deployment.reviewSchemaSha256,
      limit: input.limit,
      now,
    }));
    const handoffs = release.gate.run("phase_enter", () => createQuickLaunchProcessingHandoffSet({
      database,
      plan,
      releaseSha256,
      manifestSha256,
      now: now().getTime(),
    }));
    const activeGateway = new SqliteInternalOperationGateway({
      database,
      releaseSha256,
      manifestSha256,
      schemaSha256: deployment.reviewSchemaSha256,
      now,
    });
    gateway = activeGateway;
    const preflight = release.gate.run("phase_enter", () => runQuickLaunchProcessingPreflight({
      database,
      gateway: activeGateway,
      plan,
      handoffs,
      releaseSha256,
      manifestSha256,
      schemaSha256: deployment.reviewSchemaSha256,
      now,
    }));
    return Object.freeze({
      preflight,
      releaseId: release.gate.receipt.releaseId,
      manifestSha256,
      sourcePreimageSha256: releaseSha256,
    });
  } finally {
    gateway?.close();
    database.close();
  }
}
