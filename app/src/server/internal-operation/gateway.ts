import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { withGuardedWriteTransaction } from "../db/database.ts";
import {
  acquireSingleWriter,
  assertSqliteAuthorizerReady,
  getInstalledSqliteAuthorizer,
  installSqliteAuthorizer,
  withSqliteAuthorizerContext,
  type GatewaySqlMethod
} from "./authorizer.ts";
import { validateOwnerSupervisorHandoff } from "./owner-supervisor.ts";

export const INTERNAL_OPERATION_SCHEMA_VERSION = 7 as const;
export const INTERNAL_OPERATION_SCHEMA_SHA256 = "f3c0c049575b3121cccc8e66438481c70931df461cd941b95aaa54100844ad60" as const;
export const INTERNAL_OPERATION_CANONICAL_JSON = "canonical-json-v1" as const;

export type Phase = "disabled" | "backlog" | "live" | "paused";
export type OperationKind = "collect" | "refine" | "review" | "publish" | "reconcile" | "projection" | "backfill" | "source_create" | "source_update" | "source_delete" | "system_producer" | "phase_control" | "backup" | "restore" | "withdraw";
export type OwnerProcess = "rss_collector" | "rss_refiner" | "automatic_reviewer" | "automatic_publisher" | "projection_sender" | "projection_receiver" | "x_official_adapter" | "bilingual_refiner" | "admin_http" | "admin_telemetry_producer" | "backup_worker" | "restore_operator" | "system_supervisor" | "reconciler";
export type CapabilityClass = "db_mutation" | "external_attempt" | "reconcile_readonly" | "control" | "backup" | "restore";
export type EgressClass = "none" | "rss_https" | "model_https" | "projection_private" | "x_official_https" | "backup_private";
export type ControlAction = "enter_backlog" | "enter_live" | "pause" | "disable" | "set_global_stop" | "clear_global_stop" | "set_emergency_stop" | "clear_emergency_stop" | "recovery_begin" | "recovery_advance" | "recovery_complete" | "recovery_abort" | "writer_epoch_bump" | "fence_update";
export type EntityKind = "source" | "ingest_run" | "candidate" | "rss_media" | "machine_draft" | "review_bundle" | "review_decision" | "publication" | "published_projection" | "projection_outbox" | "projection_receipt" | "legacy_admin_operation" | "legacy_audit" | "internal_control" | "telemetry_receipt" | "generic_fence" | "backup" | "projection_pointer";
export type MutationKind = "insert" | "update" | "delete" | "activate" | "consume";
export type FenceKind = "deletion" | "publication" | "completeness" | "rights" | "media";
export type FenceRequiredState = "clear" | "blocked_reconcile_readonly" | "clear_or_blocked_removal";

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EXTERNAL_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ENDPOINT_CLASSES = new Set(["rss_fetch", "model_refine", "projection_deliver", "x_read", "x_write", "x_reconcile", "backup_copy", "restore_read"]);
const HEADER_NAMES = new Set(["accept", "content-type", "idempotency-key", "if-match", "if-none-match", "x-request-id"]);
const OPERATION_KINDS = new Set<OperationKind>(["collect", "refine", "review", "publish", "reconcile", "projection", "backfill", "source_create", "source_update", "source_delete", "system_producer", "phase_control", "backup", "restore", "withdraw"]);
const OWNER_PROCESSES = new Set<OwnerProcess>(["rss_collector", "rss_refiner", "automatic_reviewer", "automatic_publisher", "projection_sender", "projection_receiver", "x_official_adapter", "bilingual_refiner", "admin_http", "admin_telemetry_producer", "backup_worker", "restore_operator", "system_supervisor", "reconciler"]);
const CAPABILITY_CLASSES = new Set<CapabilityClass>(["db_mutation", "external_attempt", "reconcile_readonly", "control", "backup", "restore"]);
const PHASES = new Set<Phase>(["disabled", "backlog", "live", "paused"]);
const EGRESS_CLASSES = new Set<EgressClass>(["none", "rss_https", "model_https", "projection_private", "x_official_https", "backup_private"]);
const CONTROL_ACTIONS = new Set<ControlAction>(["enter_backlog", "enter_live", "pause", "disable", "set_global_stop", "clear_global_stop", "set_emergency_stop", "clear_emergency_stop", "recovery_begin", "recovery_advance", "recovery_complete", "recovery_abort", "writer_epoch_bump", "fence_update"]);
const ENTITY_KINDS = new Set<EntityKind>(["source", "ingest_run", "candidate", "rss_media", "machine_draft", "review_bundle", "review_decision", "publication", "published_projection", "projection_outbox", "projection_receipt", "legacy_admin_operation", "legacy_audit", "internal_control", "telemetry_receipt", "generic_fence", "backup", "projection_pointer"]);
const MUTATION_KINDS = new Set<MutationKind>(["insert", "update", "delete", "activate", "consume"]);
const IDENTITY_SELECTORS = new Set<EntityBinding["identitySelector"]>(["source_id", "candidate_id", "publication_id", "public_id", "control_singleton", "bound_child"]);
const FENCE_SCOPES = new Set<FenceBinding["scopeKind"]>(["global", "source", "candidate", "publication"]);
const FENCE_KINDS = new Set<FenceKind>(["deletion", "publication", "completeness", "rights", "media"]);
const FENCE_REQUIRED_STATES = new Set<FenceRequiredState>(["clear", "blocked_reconcile_readonly", "clear_or_blocked_removal"]);

export type EntityBinding = Readonly<{
  entityKind: EntityKind;
  entityId: string;
  identitySelector: "source_id" | "candidate_id" | "publication_id" | "public_id" | "control_singleton" | "bound_child";
  expectedVersion: number | null;
  expectedHash: string;
}>;

export type FenceBinding = Readonly<{
  fenceReceiptId: string;
  receiptSha256: string;
  scopeKind: "global" | "source" | "candidate" | "publication";
  scopeId: string | null;
  fenceKind: FenceKind;
  requiredState: FenceRequiredState;
}>;

export type OwnerSupervisorHandoff = Readonly<{
  schemaVersion?: "owner-supervisor-handoff-v1";
  handoffId: string;
  ownerProcess: OwnerProcess;
  executableIdentitySha256?: string;
  issuer: "f1plus1-owner-supervisor-v1";
  oneTimeNonce: string;
  releaseSha256: string;
  manifestSha256: string;
  receiptSha256: string;
  verifiedAt: string;
  expiresAt: string;
}>;

export type OperationExpected = Readonly<{
  controlVersion: number;
  entityVersion: number | null;
  entityHash: string;
  schemaSha256: string;
  releaseSha256: string;
  manifestSha256: string;
  sourceStopEpoch: number | null;
  writerEpoch: number;
  epochs: Readonly<{ sourceConfig: number; sourceSafety: number; authorization: number; policy: number; recovery: number }>;
}>;

export type GatewayOperationRequest = Readonly<{
  /** Frozen DTO marker. Kept optional for the first in-process adapter while
   * the database trigger remains the final schema-7 authority. */
  schemaVersion?: "operation-request-v1";
  operationId: string;
  idempotencyKey: string;
  operationKind: OperationKind;
  ownerProcess: OwnerProcess;
  capabilityClass: CapabilityClass;
  policyId: string;
  authorizationHandoffId: string;
  controlAction: ControlAction | null;
  identity: Readonly<{ sourceId: string | null; candidateId: string | null; publicationId: string | null; publicId: string | null }>;
  entitySet: readonly EntityBinding[];
  entitySetHash?: string;
  requiredFenceSet: readonly FenceBinding[];
  requiredFenceSetHash?: string;
  expected: OperationExpected;
  phase: Phase;
  egressClass: EgressClass;
  budgetRequest: Readonly<{ reservationId?: string; ledgerRef?: string; accountId: string; units: number; unitKind?: string }> | null;
  modelRouteRef: string | null;
  requestHash: string;
  requestFingerprint: string;
  xManualAuthority?: Readonly<{
    semanticKind: "x_submit" | "x_retire";
    submissionId: string;
    expectedRevision: number;
  }>;
}>;

export type OperationCapability = Readonly<{ operationId: string; version: number; ownerProcess: OwnerProcess; operationKind: OperationKind; capabilitySecret: string }>;
export type WritePermit = Readonly<{ permitId: string; operationId: string; entityKind: EntityKind; entityId: string; mutationKind: MutationKind; expectedVersion: number | null; expectedHash: string; capabilitySecret: string }>;

export type ClosedExternalRequest = Readonly<{
  schemaVersion: "external-request-v1";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  endpointClass: string;
  providerResource: string;
  routeId: string;
  externalIdempotencyKey: string;
  reconcileKey: string;
  headers: readonly Readonly<{ name: string; valueSha256: string }>[];
  query: readonly Readonly<{ name: string; value: string }>[];
  bodySha256: string | null;
  attemptIdentity: Readonly<{ operationId: string; attemptNumber: number; attemptNonce: string }>;
  entityIdentity: Readonly<{ sourceId: string | null; candidateId: string | null; publicationId: string | null; publicId: string | null }>;
  expected: Readonly<{ schemaSha256: string; releaseSha256: string; manifestSha256: string; routeIdentitySha256: string }>;
  epochs: Readonly<{ sourceConfig: number; sourceSafety: number; authorization: number; policy: number; recovery: number; writer: number }>;
  sourceAuthority?: Readonly<{
    sourceRegistryRevision: number;
    sourceIdentitySha256: string;
    sourceConfigRevision: number;
    authorizationReceiptSha256: string;
    sourcePolicySha256: string;
    authorizationExpiresAt: string | null;
    sourceConfigEpoch: number;
    sourceSafetyEpoch: number;
    authorizationVersion: number;
    policyEpoch: number;
    recoveryEpoch: number;
    controlSourceConfigEpoch: number;
    controlSourceSafetyEpoch: number;
    controlAuthorizationVersion: number;
    controlPolicyEpoch: number;
    controlRecoveryEpoch: number;
    writerEpoch: number;
    normalizationStatus: "valid";
    dedupStatus: "unique" | "linked_existing";
    identityStatus: "unknown" | "verified" | "needs_review";
    relevanceStatus: "unknown" | "qualified" | "rejected";
    monitorability: "unknown" | "monitorable" | "restricted" | "unavailable";
    adapterStatus: "ready";
    adapterAuthorizationStatus: "valid";
    platformAllowed: "allowed";
    copyRiskStatus: "unknown" | "screen_passed" | "blocked";
    rightsStatus: "unknown" | "clear" | "blocked";
    deletionStatus: "unknown" | "clear" | "blocked";
    mediaStatus: "none" | "allowed" | "unknown" | "blocked";
  }>;
  fenceSetHash: string;
}>;

export type CommittedAttemptHandle = Readonly<{ attemptId: string; operationId: string; attemptNumber: number; attemptNonce: string; canonicalRequestSha256: string; requestFingerprintSha256: string; reconcileIdentitySha256: string; capabilitySecret: string }>;
export type StartedAttemptHandle = CommittedAttemptHandle & Readonly<{ startedAt: string }>;
export type ReconcileRequiredHandle = CommittedAttemptHandle & Readonly<{ reconcileAfter: string }>;
export type BilingualKnownResponseMaterialization = Readonly<{
  attemptId: string;
  operationId: string;
  attemptNumber: number;
  attemptState: "response_committed";
  operationState: "succeeded" | "terminal_failed";
  responseIdentitySha256: string;
  materializedAt: string;
}>;
export type BilingualUnknownMaterialization = Readonly<{
  attemptId: string;
  operationId: string;
  attemptNumber: number;
  attemptState: "reconcile_required";
  operationState: "reconcile_required";
  materializedAt: string;
}>;
export type BilingualAdmissionMaterialization = Readonly<{
  carrierOperationId: string;
  candidateId: string;
  publicId: string;
  sourceId: string;
  sourceRevision: number;
  inputContentHash: string;
  sourceFactSetHash: string;
  sourceReleaseHash: string;
  copyRiskStatus: "unknown" | "screen_passed" | "blocked";
  rightsStatus: "unknown" | "clear" | "blocked";
  deletionStatus: "unknown" | "clear" | "blocked";
  mediaStatus: "none" | "allowed" | "unknown" | "blocked";
  promptSchemaVersion: string;
  promptSha256: string;
  children: readonly Readonly<{ operationId: string; idempotencyKey: string; language: "zh-CN" | "en"; attemptNumber: number }>[];
}>;
export type BilingualSafetyAuthorization = Readonly<{
  actorRef: string;
  sessionDigest: string;
  csrfDigest: string;
  freshDigest: string;
  verifiedAt: string;
  freshAction: "BILINGUAL_SAFETY_DECISION";
  resourceHash: string;
  operationId: string;
  bodyHash: string;
}>;
export type BilingualSafetyDecisionInput = Readonly<{
  candidateId: string;
  sourceId: string;
  sourceRevision: number;
  inputContentHash: string;
  action: "clear" | "block" | "withdraw" | "expire";
  blockReason?: "COPY_RISK" | "RIGHTS_BLOCKED" | "DELETION_BLOCKED" | "MEDIA_BLOCKED";
  mediaClearance?: "none" | "allowed";
  expiresAt?: string;
  expectedDecisionSeq: number;
  supersedesDecisionId: string | null;
}>;
export type BilingualSafetyDecisionReceipt = Readonly<{
  decisionId: string;
  decisionSeq: number;
  operationId: string;
  resourceHash: string;
  decisionHash: string;
  decidedAt: string;
}>;

export type BilingualApprovalAuthorization = Readonly<{
  actorRef: string;
  sessionDigest: string;
  csrfDigest: string;
  operationId: string;
  bodyHash: string;
}>;
export type BilingualApprovalInput = Readonly<{
  candidateId: string;
  expectedBundleRevision: number;
  decision: "approved" | "rejected";
}>;
export type BilingualApprovalReceipt = Readonly<{
  approvalId: string;
  bundleId: string;
  bundleHash: string;
  decision: "approved" | "rejected";
  operationId: string;
  approvalHash: string;
  decidedAt: string;
}>;

export type BilingualPublicationAuthorization = Readonly<{
  actorRef: string;
  sessionDigest: string;
  csrfDigest: string;
  operationId: string;
  bodyHash: string;
}>;
export type BilingualWithdrawalAuthorization = BilingualPublicationAuthorization & Readonly<{
  freshDigest: string;
  verifiedAt: string;
  resourceHash: string;
}>;
export type BilingualProjectionArtifactInput = Readonly<{
  projectionId: string;
  generationId: string;
  generation: number;
  schemaVersion: "public-read-bilingual-v2";
  payloadJson: string;
  payloadHash: string;
  signature: string;
  releaseSha256: string;
  manifestSha256: string;
}>;
export type BilingualInitialPublicationInput = Readonly<{
  candidateId: string;
  expectedBundleRevision: number;
  publicationId: string;
  publicId: string;
  artifact: BilingualProjectionArtifactInput;
}>;
export type BilingualProjectionActivationInput = BilingualInitialPublicationInput & Readonly<{
  publicationOperationId: string;
}>;
export type BilingualWithdrawalInput = Readonly<{
  publicationId: string;
  expectedRevision: number;
  withdrawalPublicationId: string;
  publicId: string;
  artifact: BilingualProjectionArtifactInput;
}>;
export type BilingualPublicationReceipt = Readonly<{
  publicationId: string;
  projectionId: string;
  publicId: string;
  revision: number;
  generation: number;
  projectionHash: string;
  outboxDeliveryId: string | null;
  status: "staged" | "published" | "withdrawn";
}>;

export type BilingualSafetyMaterialization = Readonly<{
  candidateId: string;
  decisionId: string;
  decisionSeq: number;
  resourceHash: string;
  requestHash: string;
  authorityContextHash: string;
  expiresAt: string;
  materializedAt: string;
}>;
export type FencePrecheckReceipt = Readonly<{ operationId: string; operationVersion: number; fenceSetHash: string; consumedAt: string; count: number }>;

export type ClosedExternalResponse = Readonly<{
  providerResourceIdentity: string;
  providerStatus: string;
  responseBodySha256: string;
  responseHeaderHashes: readonly string[];
  outcome: "succeeded" | "known_failed";
  reasonCode: string | null;
}>;

export type ClosedMutation = Readonly<{
  entityKind: EntityKind;
  entityId: string;
  mutationKind: MutationKind;
  statement: string;
  parameters?: readonly unknown[];
}>;

/**
 * A mutation input used by the repository adapters.  The adapter never gets
 * a raw database writer: every statement is first bound to one operation
 * capability and one immutable write permit.
 */
export type GatewayWriteInput = Readonly<{
  entityKind: EntityKind;
  entityId: string;
  mutationKind: MutationKind;
  expectedVersion: number | null;
  expectedHash: string;
  statement: string;
  parameters?: readonly unknown[];
}>;

export type XManualGatewayMutation = Readonly<{
  semanticKind: "x_submit" | "x_retire";
  submissionId: string;
  expectedRevision: number;
  submittedUrl?: string;
  canonicalUrl?: string;
  statusId?: string;
  dedupeKey?: string;
  sourceId?: string | null;
  retentionExpiresAt?: string;
  nowIso: string;
}>;

export type XManualFailurePoint = "after_permit" | "after_mutation" | "after_permit_consumed";

export type QuickLaunchAuthorityCapability = "bilingual_auto_refine" | "bilingual_manual_mutation" | "source_registry_management";
export type QuickLaunchAuthorityTransition = Readonly<{
  operationId: string;
  idempotencyKey: string;
  capabilityId: QuickLaunchAuthorityCapability;
  action: "enable" | "close";
  expectedVersion: number;
  requestHash: string;
  authorityReceiptSha256: string;
}>;

export type SourceRegistryGatewayMutation = Readonly<{
  action: "disable" | "requeue" | "enable" | "retire";
  sourceId: string;
  expectedRevision: number;
  reasonCode: "OPERATOR_REQUEST" | "POLICY_CHANGE" | "CREDENTIAL_ROTATION" | "INCIDENT" | "RETIREMENT";
}>;

function fail(code: string): never { throw new Error(code); }
function assert(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }
function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const b = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      assert(next >= 0xdc00 && next <= 0xdfff, "CANONICAL_JSON_UNICODE_INVALID");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail("CANONICAL_JSON_UNICODE_INVALID");
    }
  }
}

/** Restricted canonical JSON used by operation, request, fence and receipt hashes. */
export function canonicalJsonV1(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") { assertUnicodeScalarString(value); return JSON.stringify(value); }
  if (typeof value === "number") {
    // The frozen canonical-json-v1 contract admits finite safe integers only;
    // explicitly reject -0 because JSON.stringify would otherwise erase the
    // distinction and let two non-identical DTOs share one hash.
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail("CANONICAL_JSON_NUMBER_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonV1).join(",")}]`;
  if (typeof value !== "object") fail("CANONICAL_JSON_TYPE_INVALID");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) assertUnicodeScalarString(key);
  const keys = Object.keys(record).sort(compareCodePoints);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonV1(record[key])}`).join(",")}}`;
}

function domainHash(domain: string, value: unknown): string { return hash(`${domain}\n${canonicalJsonV1(value)}`); }

export function bilingualSafetyResourceHash(input: BilingualSafetyDecisionInput): string {
  return domainHash("f1plus1-bilingual-safety-resource-v1", {
    candidateId: input.candidateId,
    sourceId: input.sourceId,
    sourceRevision: input.sourceRevision,
    inputContentHash: input.inputContentHash,
    action: input.action,
    blockReason: input.blockReason ?? null,
    mediaClearance: input.mediaClearance ?? null,
    expiresAt: input.expiresAt ?? null,
    expectedDecisionSeq: input.expectedDecisionSeq,
    supersedesDecisionId: input.supersedesDecisionId,
  });
}

export function bilingualWithdrawalResourceHash(input: Readonly<{ publicationId: string; expectedRevision: number }>): string {
  return hash(canonicalJsonV1({
    publicationId: input.publicationId,
    expectedRevision: input.expectedRevision,
    replacementBundleId: null,
    replacementApprovalId: null,
    correctionScope: "whole-bilingual-bundle",
  }));
}
function nowIso(clock: () => Date): string { const value = clock(); assert(value instanceof Date && Number.isFinite(value.getTime()), "CLOCK_INVALID"); return value.toISOString(); }
function parseRow(value: unknown): Record<string, unknown> { assert(value !== undefined && value !== null && typeof value === "object", "DB_ROW_MISSING"); return value as Record<string, unknown>; }
function valueString(value: unknown, code: string): string { assert(typeof value === "string", code); return value; }
function valueInt(value: unknown, code: string): number { assert(Number.isSafeInteger(Number(value)), code); return Number(value); }
function currentState(database: DatabaseSync): Record<string, unknown> { return parseRow(database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get()); }
function sqlValues(values: readonly unknown[]): any[] { return [...values]; }

function validateHash(value: string, code = "HASH_INVALID"): void { assert(HASH.test(value), code); }
function validateId(value: string, code = "ID_INVALID"): void { assert(ID.test(value), code); }
function validateUtc(value: string, code = "TIMESTAMP_INVALID"): void {
  assert(UTC.test(value) && Number.isFinite(Date.parse(value)), code);
  // Date.parse normalises impossible calendar dates on some runtimes.  The
  // frozen DTOs use canonical UTC milliseconds and must round-trip exactly.
  assert(new Date(Date.parse(value)).toISOString() === value, code);
}
function nonce(): string { return randomBytes(32).toString("base64url"); }

function validateEntitySet(set: readonly EntityBinding[]): void {
  const seen = new Set<string>();
  for (const binding of set) {
    assert(ENTITY_KINDS.has(binding.entityKind), "ENTITY_KIND_INVALID");
    assert(IDENTITY_SELECTORS.has(binding.identitySelector), "ENTITY_SELECTOR_INVALID");
    validateId(binding.entityId); validateHash(binding.expectedHash);
    assert(binding.expectedVersion === null || Number.isSafeInteger(binding.expectedVersion) && binding.expectedVersion >= 0, "ENTITY_VERSION_INVALID");
    const key = `${binding.entityKind}\0${binding.entityId}`;
    assert(!seen.has(key), "ENTITY_SET_DUPLICATE"); seen.add(key);
  }
}

function validateFenceSet(set: readonly FenceBinding[]): void {
  const seen = new Set<string>();
  for (const binding of set) {
    assert(FENCE_SCOPES.has(binding.scopeKind), "FENCE_SCOPE_INVALID");
    assert(FENCE_KINDS.has(binding.fenceKind), "FENCE_KIND_INVALID");
    assert(FENCE_REQUIRED_STATES.has(binding.requiredState), "FENCE_REQUIRED_STATE_INVALID");
    validateId(binding.fenceReceiptId); validateHash(binding.receiptSha256);
    if (binding.scopeKind === "global") assert(binding.scopeId === null, "FENCE_GLOBAL_SCOPE_INVALID");
    else { assert(typeof binding.scopeId === "string", "FENCE_SCOPE_MISSING"); validateId(binding.scopeId); }
    const key = `${binding.scopeKind}\0${binding.scopeId ?? ""}\0${binding.fenceKind}\0${binding.requiredState}`;
    assert(!seen.has(key), "FENCE_SET_DUPLICATE"); seen.add(key);
  }
}

function bindingJson(binding: EntityBinding): Record<string, unknown> {
  return { entityKind: binding.entityKind, entityId: binding.entityId, expectedVersion: binding.expectedVersion, expectedHash: binding.expectedHash };
}
function fenceJson(binding: FenceBinding): Record<string, unknown> {
  return { fenceReceiptId: binding.fenceReceiptId, receiptSha256: binding.receiptSha256, scopeKind: binding.scopeKind, scopeId: binding.scopeId, fenceKind: binding.fenceKind, requiredState: binding.requiredState };
}

function operationEntitySetHash(set: readonly EntityBinding[]): string {
  return domainHash("f1plus1-operation-entity-set-v1", set.map(bindingJson));
}

function operationFenceSetHash(set: readonly FenceBinding[]): string {
  return domainHash("f1plus1-operation-fence-set-v1", set.map(fenceJson));
}

function validateOperationShape(input: GatewayOperationRequest): void {
  if (input.schemaVersion !== undefined) assert(input.schemaVersion === "operation-request-v1", "OPERATION_SCHEMA_VERSION_INVALID");
  validateId(input.operationId); validateId(input.idempotencyKey); validateId(input.authorizationHandoffId);
  assert(OPERATION_KINDS.has(input.operationKind), "OPERATION_KIND_INVALID");
  assert(OWNER_PROCESSES.has(input.ownerProcess), "OWNER_PROCESS_INVALID");
  assert(CAPABILITY_CLASSES.has(input.capabilityClass), "CAPABILITY_CLASS_INVALID");
  assert(PHASES.has(input.phase), "PHASE_INVALID");
  assert(EGRESS_CLASSES.has(input.egressClass), "EGRESS_CLASS_INVALID");
  assert(input.controlAction === null || CONTROL_ACTIONS.has(input.controlAction), "CONTROL_ACTION_INVALID");
  for (const value of Object.values(input.identity)) assert(value === null || ID.test(value), "OPERATION_IDENTITY_INVALID");
  assert(Number.isSafeInteger(input.expected.controlVersion) && input.expected.controlVersion >= 1, "CONTROL_VERSION_INVALID");
  assert(input.expected.entityVersion === null || Number.isSafeInteger(input.expected.entityVersion) && input.expected.entityVersion >= 0, "EXPECTED_ENTITY_VERSION_INVALID");
  assert(Number.isSafeInteger(input.expected.writerEpoch) && input.expected.writerEpoch >= 1, "EXPECTED_WRITER_EPOCH_INVALID");
  for (const value of Object.values(input.expected.epochs)) assert(Number.isSafeInteger(value) && value >= 1, "EXPECTED_EPOCH_INVALID");
  if (input.egressClass === "none") assert(input.budgetRequest === null, "BUDGET_FOR_NO_EGRESS");
  else {
    assert(input.budgetRequest !== null, "BUDGET_REQUIRED");
    const reservationId = input.budgetRequest.reservationId ?? input.budgetRequest.ledgerRef;
    assert(typeof reservationId === "string", "BUDGET_RESERVATION_ID_INVALID");
    validateId(reservationId, "BUDGET_RESERVATION_ID_INVALID");
    validateId(input.budgetRequest.accountId, "BUDGET_ACCOUNT_ID_INVALID");
    assert(Number.isSafeInteger(input.budgetRequest.units) && input.budgetRequest.units > 0, "BUDGET_UNITS_INVALID");
    assert(input.budgetRequest.unitKind === undefined || (typeof input.budgetRequest.unitKind === "string" && input.budgetRequest.unitKind.length > 0 && input.budgetRequest.unitKind.length <= 128), "BUDGET_UNIT_KIND_INVALID");
  }
  const computedEntityHash = operationEntitySetHash(input.entitySet);
  const computedFenceHash = operationFenceSetHash(input.requiredFenceSet);
  if (input.entitySetHash !== undefined) { validateHash(input.entitySetHash, "ENTITY_SET_HASH_INVALID"); assert(input.entitySetHash === computedEntityHash, "ENTITY_SET_HASH_MISMATCH"); }
  if (input.requiredFenceSetHash !== undefined) { validateHash(input.requiredFenceSetHash, "FENCE_SET_HASH_INVALID"); assert(input.requiredFenceSetHash === computedFenceHash, "FENCE_SET_HASH_MISMATCH"); }
  if (input.xManualAuthority !== undefined) {
    const binding = input.xManualAuthority;
    assert(input.ownerProcess === "admin_http" && input.operationKind === "phase_control" && input.capabilityClass === "control", "X_MANUAL_AUTHORITY_INVALID");
    assert(input.phase === "disabled" && input.egressClass === "none" && input.policyId === "p-phase-control-disabled" && input.controlAction === "fence_update", "X_MANUAL_AUTHORITY_INVALID");
    assert(/^xsub_[a-z0-9]{8,64}$/.test(binding.submissionId), "X_MANUAL_SUBMISSION_ID_INVALID");
    assert(Number.isSafeInteger(binding.expectedRevision) && binding.expectedRevision >= 0, "X_MANUAL_REVISION_INVALID");
    assert(binding.semanticKind !== "x_submit" || binding.expectedRevision === 0, "X_MANUAL_REVISION_INVALID");
  }
}

function assertExactFenceTemplate(database: DatabaseSync, input: GatewayOperationRequest): void {
  const rows = database.prepare("SELECT scope_selector,fence_kind,required_state FROM internal_required_fence_policy WHERE policy_id=? ORDER BY scope_selector,fence_kind,required_state").all(input.policyId) as Array<Record<string, unknown>>;
  const expected = rows.map((row) => {
    const selector = valueString(row.scope_selector, "FENCE_POLICY_SELECTOR_INVALID");
    const scopeKind = selector === "global" ? "global" : selector === "source_id" ? "source" : selector === "candidate_id" ? "candidate" : selector === "publication_id" ? "publication" : fail("FENCE_POLICY_SELECTOR_INVALID");
    const scopeId = scopeKind === "global" ? null : scopeKind === "source" ? input.identity.sourceId : scopeKind === "candidate" ? input.identity.candidateId : input.identity.publicationId;
    assert(scopeId !== null, "FENCE_POLICY_IDENTITY_MISSING");
    return `${scopeKind}\0${scopeId ?? ""}\0${valueString(row.fence_kind, "FENCE_POLICY_KIND_INVALID")}\0${valueString(row.required_state, "FENCE_POLICY_STATE_INVALID")}`;
  }).sort();
  const actual = input.requiredFenceSet.map((binding) => `${binding.scopeKind}\0${binding.scopeId ?? ""}\0${binding.fenceKind}\0${binding.requiredState}`).sort();
  assert(expected.length === actual.length && expected.every((value, index) => value === actual[index]), "FENCE_SET_TEMPLATE_MISMATCH");
}

function mapAuthorizerMethod(kind: OperationKind, owner: OwnerProcess): GatewaySqlMethod {
  if (kind === "phase_control") return "phase_control";
  if (kind === "restore") return "recovery_control";
  if (kind === "backup") return "backup_insert";
  if (kind === "system_producer") return owner === "system_supervisor" ? "fence_issue" : "response";
  if (kind === "collect") return "legacy_collect";
  if (kind === "refine") return "legacy_refine";
  if (kind === "review") return "legacy_review";
  if (kind === "publish" || kind === "withdraw") return "legacy_publish";
  if (kind === "projection") return owner === "projection_receiver" ? "legacy_publish" : "legacy_projection";
  if (kind === "source_create" || kind === "source_update" || kind === "source_delete") return "legacy_source";
  return "response";
}

function operationAuditEvent(database: DatabaseSync, operationId: string, eventType: string, actorRef: string, payload: Record<string, unknown>, createdAt: string): void {
  const previous = database.prepare("SELECT event_hash FROM internal_operation_audit ORDER BY audit_seq DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  const previousEventHash = previous?.event_hash === undefined ? null : valueString(previous.event_hash, "AUDIT_PREVIOUS_HASH_INVALID");
  const eventId = `audit-${hash(`${operationId}\n${eventType}\n${createdAt}\n${canonicalJsonV1(payload)}`).slice(0, 48)}`;
  const eventHash = domainHash("f1plus1-operation-audit-v1", { eventId, operationId, eventType, actorRef, payload, previousEventHash, createdAt });
  database.prepare("INSERT INTO internal_operation_audit(event_id,operation_id,event_type,actor_ref,event_json,previous_event_hash,event_hash,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(eventId, operationId, eventType, actorRef, canonicalJsonV1(payload), previousEventHash, eventHash, createdAt);
}

function selectOperation(database: DatabaseSync, operationId: string): Record<string, unknown> {
  return parseRow(database.prepare("SELECT * FROM internal_operation WHERE operation_id=?").get(operationId));
}

export function validateClosedExternalRequest(request: ClosedExternalRequest): ClosedExternalRequest {
  assert(request !== null && typeof request === "object", "EXTERNAL_REQUEST_INVALID");
  assert(request.schemaVersion === "external-request-v1" && EXTERNAL_METHODS.has(request.method) && ENDPOINT_CLASSES.has(request.endpointClass), "EXTERNAL_REQUEST_INVALID");
  for (const value of [request.providerResource, request.routeId, request.externalIdempotencyKey, request.reconcileKey]) { assert(typeof value === "string" && value.length >= 1 && value.length <= 512, "EXTERNAL_REQUEST_ID_INVALID"); }
  assert(Array.isArray(request.headers) && Array.isArray(request.query), "EXTERNAL_REQUEST_ARRAY_INVALID");
  let lastHeader = "";
  const headers = new Set<string>();
  for (const header of request.headers) {
    assert(typeof header.name === "string" && HEADER_NAMES.has(header.name) && header.name === header.name.toLowerCase(), "EXTERNAL_HEADER_INVALID");
    validateHash(header.valueSha256, "EXTERNAL_HEADER_HASH_INVALID");
    assert(!headers.has(header.name) && compareCodePoints(lastHeader, header.name) <= 0, "EXTERNAL_HEADER_ORDER_INVALID");
    headers.add(header.name); lastHeader = header.name;
  }
  let lastQuery: Readonly<{ name: string; value: string }> | null = null;
  const queries = new Set<string>();
  for (const query of request.query) {
    assert(/^[A-Za-z0-9._~-]{1,128}$/.test(query.name) && typeof query.value === "string" && query.value.length <= 2048, "EXTERNAL_QUERY_INVALID");
    const key = `${query.name}\0${query.value}`; assert(!queries.has(key), "EXTERNAL_QUERY_DUPLICATE"); queries.add(key);
    if (lastQuery !== null) assert(compareCodePoints(lastQuery.name, query.name) < 0 || (lastQuery.name === query.name && compareCodePoints(lastQuery.value, query.value) <= 0), "EXTERNAL_QUERY_ORDER_INVALID");
    lastQuery = query;
  }
  if (request.bodySha256 !== null) validateHash(request.bodySha256, "EXTERNAL_BODY_HASH_INVALID");
  assert(ID.test(request.attemptIdentity.operationId) && Number.isSafeInteger(request.attemptIdentity.attemptNumber) && request.attemptIdentity.attemptNumber >= 1 && NONCE.test(request.attemptIdentity.attemptNonce), "EXTERNAL_ATTEMPT_IDENTITY_INVALID");
  for (const value of Object.values(request.entityIdentity)) assert(value === null || ID.test(value), "EXTERNAL_ENTITY_IDENTITY_INVALID");
  for (const value of Object.values(request.expected)) validateHash(value, "EXTERNAL_EXPECTED_HASH_INVALID");
  for (const value of Object.values(request.epochs)) assert(Number.isSafeInteger(value) && value >= 1, "EXTERNAL_EPOCH_INVALID");
  if (request.sourceAuthority !== undefined) {
    const authority = request.sourceAuthority;
    assert(Number.isSafeInteger(authority.sourceRegistryRevision) && authority.sourceRegistryRevision >= 1, "EXTERNAL_SOURCE_AUTHORITY_INVALID");
    assert(Number.isSafeInteger(authority.sourceConfigRevision) && authority.sourceConfigRevision >= 1, "EXTERNAL_SOURCE_AUTHORITY_INVALID");
    validateHash(authority.sourceIdentitySha256, "EXTERNAL_SOURCE_AUTHORITY_INVALID");
    validateHash(authority.authorizationReceiptSha256, "EXTERNAL_SOURCE_AUTHORITY_INVALID");
    validateHash(authority.sourcePolicySha256, "EXTERNAL_SOURCE_AUTHORITY_INVALID");
    if (authority.authorizationExpiresAt !== null) validateUtc(authority.authorizationExpiresAt, "EXTERNAL_SOURCE_AUTHORITY_INVALID");
    for (const value of [authority.sourceConfigEpoch, authority.sourceSafetyEpoch, authority.authorizationVersion, authority.policyEpoch, authority.recoveryEpoch,
      authority.controlSourceConfigEpoch, authority.controlSourceSafetyEpoch, authority.controlAuthorizationVersion, authority.controlPolicyEpoch,
      authority.controlRecoveryEpoch, authority.writerEpoch]) assert(Number.isSafeInteger(value) && value >= 1, "EXTERNAL_SOURCE_AUTHORITY_INVALID");
    assert(authority.normalizationStatus === "valid" && ["unique", "linked_existing"].includes(authority.dedupStatus)
      && ["unknown", "verified", "needs_review"].includes(authority.identityStatus)
      && ["unknown", "qualified", "rejected"].includes(authority.relevanceStatus)
      && ["unknown", "monitorable", "restricted", "unavailable"].includes(authority.monitorability)
      && authority.adapterStatus === "ready" && authority.adapterAuthorizationStatus === "valid" && authority.platformAllowed === "allowed", "EXTERNAL_SOURCE_AUTHORITY_INVALID");
    assert(["unknown", "screen_passed", "blocked"].includes(authority.copyRiskStatus), "EXTERNAL_SOURCE_AUTHORITY_INVALID");
    assert(["unknown", "clear", "blocked"].includes(authority.rightsStatus), "EXTERNAL_SOURCE_AUTHORITY_INVALID");
    assert(["unknown", "clear", "blocked"].includes(authority.deletionStatus), "EXTERNAL_SOURCE_AUTHORITY_INVALID");
    assert(["none", "allowed", "unknown", "blocked"].includes(authority.mediaStatus), "EXTERNAL_SOURCE_AUTHORITY_INVALID");
  }
  validateHash(request.fenceSetHash, "EXTERNAL_FENCE_SET_HASH_INVALID");
  return request;
}

export function validateClosedExternalResponse(response: ClosedExternalResponse): ClosedExternalResponse {
  assert(response !== null && typeof response === "object", "EXTERNAL_RESPONSE_INVALID");
  assert(typeof response.providerResourceIdentity === "string" && response.providerResourceIdentity.length >= 1 && response.providerResourceIdentity.length <= 512, "EXTERNAL_RESPONSE_RESOURCE_INVALID");
  assert(typeof response.providerStatus === "string" && response.providerStatus.length >= 1 && response.providerStatus.length <= 128, "EXTERNAL_RESPONSE_STATUS_INVALID");
  validateHash(response.responseBodySha256, "EXTERNAL_RESPONSE_BODY_HASH_INVALID");
  assert(Array.isArray(response.responseHeaderHashes) && response.responseHeaderHashes.length <= 64, "EXTERNAL_RESPONSE_HEADER_HASHES_INVALID");
  for (const value of response.responseHeaderHashes) validateHash(value, "EXTERNAL_RESPONSE_HEADER_HASH_INVALID");
  assert(response.outcome === "succeeded" || response.outcome === "known_failed", "EXTERNAL_RESPONSE_OUTCOME_INVALID");
  assert(response.reasonCode === null || (typeof response.reasonCode === "string" && /^[A-Z0-9_.:-]{1,128}$/.test(response.reasonCode)), "EXTERNAL_RESPONSE_REASON_INVALID");
  return response;
}

export function canonicalExternalRequestHash(request: ClosedExternalRequest): string {
  validateClosedExternalRequest(request);
  return domainHash("f1plus1-external-request-v1", request);
}
export function requestFingerprintHash(request: ClosedExternalRequest): string {
  const canonical = canonicalExternalRequestHash(request);
  return hash(`f1plus1-external-request-fingerprint-v1\n${canonical}\n${request.attemptIdentity.operationId}\n${request.attemptIdentity.attemptNumber}\n${request.attemptIdentity.attemptNonce}`);
}
export function reconcileIdentityHash(request: ClosedExternalRequest): string {
  return domainHash("f1plus1-external-reconcile-v1", {
    attemptIdentity: request.attemptIdentity,
    canonicalRequestSha256: canonicalExternalRequestHash(request),
    externalIdempotencyKey: request.externalIdempotencyKey,
    providerResource: request.providerResource,
    reconcileKey: request.reconcileKey
  });
}
export function responseIdentityHash(handle: Pick<CommittedAttemptHandle, "attemptId" | "canonicalRequestSha256">, response: ClosedExternalResponse): string {
  return domainHash("f1plus1-external-response-v1", {
    attemptId: handle.attemptId,
    canonicalRequestSha256: handle.canonicalRequestSha256,
    providerResourceIdentity: response.providerResourceIdentity,
    providerStatus: response.providerStatus,
    responseBodySha256: response.responseBodySha256,
    responseHeaderHashes: response.responseHeaderHashes
  });
}

export class SqliteInternalOperationGateway {
  private readonly database: DatabaseSync;
  private readonly releaseSha256: string;
  private readonly manifestSha256: string;
  private readonly schemaSha256: string;
  private readonly clock: () => Date;
  private readonly authorizer: ReturnType<typeof installSqliteAuthorizer>;
  private readonly releaseWriterLease: () => void;
  private readonly secrets = new Map<string, string>();
  private readonly xManualOperations = new Set<string>();
  private atomicAdmissionDepth = 0;
  private readonly xManualFailureInjector: ((point: XManualFailurePoint) => void) | null;

  public constructor(input: Readonly<{ database: DatabaseSync; releaseSha256: string; manifestSha256: string; schemaSha256?: string; now?: () => Date; xManualFailureInjector?: (point: XManualFailurePoint) => void }>) {
    validateHash(input.releaseSha256); validateHash(input.manifestSha256);
    this.database = input.database;
    this.releaseSha256 = input.releaseSha256;
    this.manifestSha256 = input.manifestSha256;
    this.schemaSha256 = input.schemaSha256 ?? INTERNAL_OPERATION_SCHEMA_SHA256;
    validateHash(this.schemaSha256);
    const version = valueInt((this.database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version, "SCHEMA_VERSION_INVALID");
    assert(version === INTERNAL_OPERATION_SCHEMA_VERSION || version === 8 || version === 9 || version === 10, "SCHEMA_VERSION_INVALID");
    this.releaseWriterLease = acquireSingleWriter(this.database);
    try {
      const existingAuthorizer = getInstalledSqliteAuthorizer(this.database);
      if (existingAuthorizer?.profile === "worker_or_repository") existingAuthorizer.uninstall();
      else if (existingAuthorizer) throw new Error("SQLITE_AUTHORIZER_ALREADY_INSTALLED");
      this.authorizer = installSqliteAuthorizer(this.database, "gateway_owner_writer");
    } catch (error) {
      this.releaseWriterLease();
      throw error;
    }
    this.clock = input.now ?? (() => new Date());
    this.xManualFailureInjector = input.xManualFailureInjector ?? null;
    try { assertSqliteAuthorizerReady(this.database); } catch (error) { this.releaseWriterLease(); this.authorizer.uninstall(); throw error; }
  }

  public close(): void { this.releaseWriterLease(); this.authorizer.uninstall(); this.secrets.clear(); this.xManualOperations.clear(); }

  public expectedSchemaSha256(): string { return this.schemaSha256; }

  /**
   * The only runtime path that transitions a schema-10 quick-launch
   * capability. It consumes one persisted Admin handoff, creates one v2
   * permit, and lets the schema triggers atomically consume/audit/bridge it.
   */
  public transitionQuickLaunchAuthority(
    handoff: OwnerSupervisorHandoff,
    input: QuickLaunchAuthorityTransition
  ): Readonly<{ operationId: string; capabilityId: QuickLaunchAuthorityCapability; state: "closed" | "enabled"; version: number; receiptSha256: string }> {
    validateId(input.operationId, "OPERATION_ID_INVALID");
    validateId(input.idempotencyKey, "IDEMPOTENCY_KEY_INVALID");
    validateHash(input.requestHash, "REQUEST_HASH_INVALID");
    validateHash(input.authorityReceiptSha256, "AUTHORITY_RECEIPT_INVALID");
    assert(["bilingual_auto_refine", "bilingual_manual_mutation", "source_registry_management"].includes(input.capabilityId), "AUTHORITY_CAPABILITY_INVALID");
    assert(input.action === "enable" || input.action === "close", "AUTHORITY_ACTION_INVALID");
    assert(Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 1, "AUTHORITY_VERSION_INVALID");
    const existing = this.database.prepare("SELECT operation_id,request_hash,state,result_hash FROM internal_operation WHERE idempotency_key=?").get(input.idempotencyKey) as Record<string, unknown> | undefined;
    if (existing?.state === "succeeded") {
      assert(existing.operation_id === input.operationId && existing.request_hash === input.requestHash && existing.result_hash === input.authorityReceiptSha256, "IDEMPOTENCY_CONFLICT");
      const current = parseRow(this.database.prepare("SELECT state,version,authority_receipt_sha256 FROM quick_launch_authority_v2 WHERE capability_id=?").get(input.capabilityId));
      assert(current.authority_receipt_sha256 === input.authorityReceiptSha256, "IDEMPOTENCY_CONFLICT");
      return Object.freeze({ operationId: input.operationId, capabilityId: input.capabilityId, state: current.state as "closed" | "enabled", version: Number(current.version), receiptSha256: input.authorityReceiptSha256 });
    }
    const control = currentState(this.database);
    assert(control.phase === "disabled" && control.global_stop_state === "stopped" && control.emergency_stop_state === "clear" && control.recovery_state === "fenced", "AUTHORITY_CONTROL_NOT_CLOSED");
    const authority = parseRow(this.database.prepare("SELECT state,version,schema_sha256 FROM quick_launch_authority_v2 WHERE capability_id=?").get(input.capabilityId));
    assert(Number(authority.version) === input.expectedVersion, "AUTHORITY_VERSION_CONFLICT");
    assert(authority.schema_sha256 === this.schemaSha256, "AUTHORITY_SCHEMA_MISMATCH");
    assert((input.action === "enable" && authority.state === "closed") || (input.action === "close" && authority.state === "enabled"), "AUTHORITY_STATE_CONFLICT");
    const requested = this.request(handoff, {
      schemaVersion: "operation-request-v1",
      operationId: input.operationId,
      idempotencyKey: input.idempotencyKey,
      operationKind: "phase_control",
      ownerProcess: "admin_http",
      capabilityClass: "control",
      policyId: "p-phase-control-disabled",
      authorizationHandoffId: handoff.handoffId,
      controlAction: "fence_update",
      identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
      entitySet: [],
      requiredFenceSet: [],
      expected: {
        controlVersion: Number(control.version), entityVersion: null, entityHash: "0".repeat(64),
        schemaSha256: this.schemaSha256, releaseSha256: this.releaseSha256, manifestSha256: this.manifestSha256,
        sourceStopEpoch: null, writerEpoch: Number(control.writer_epoch),
        epochs: { sourceConfig: Number(control.source_config_epoch), sourceSafety: Number(control.source_safety_epoch), authorization: Number(control.authorization_version), policy: Number(control.policy_epoch), recovery: Number(control.recovery_epoch) }
      },
      phase: "disabled", egressClass: "none", budgetRequest: null, modelRouteRef: null,
      requestHash: input.requestHash,
      requestFingerprint: hash(`f1plus1-authority-transition-v2\n${input.requestHash}\n${input.operationId}`)
    });
    const authorized = this.authorize(requested);
    assert(authorized.version === 2, "AUTHORITY_OPERATION_INVALID");
    const operation = selectOperation(this.database, input.operationId);
    const createdAt = valueString(operation.updated_at, "AUTHORITY_OPERATION_TIME_INVALID");
    const permitId = `authority-permit-${hash(`${input.operationId}\n${input.capabilityId}`).slice(0, 40)}`;
    this.tx("authority_v2", () => {
      this.database.prepare("INSERT INTO quick_launch_authority_permit_v2(permit_id,operation_id,capability_id,action,expected_version,one_time_nonce,request_hash,authority_receipt_sha256,created_at,consumed_at) VALUES(?,?,?,?,?,?,?,?,?,NULL)")
        .run(permitId, input.operationId, input.capabilityId, input.action, input.expectedVersion, nonce(), input.requestHash, input.authorityReceiptSha256, createdAt);
      const targetState = input.action === "enable" ? "enabled" : "closed";
      const changed = this.database.prepare("UPDATE quick_launch_authority_v2 SET state=?,version=version+1,updated_by_operation_id=?,authority_receipt_sha256=?,updated_at=? WHERE capability_id=? AND version=? AND state=?")
        .run(targetState, input.operationId, input.authorityReceiptSha256, createdAt, input.capabilityId, input.expectedVersion, String(authority.state)).changes;
      assert(changed === 1, "AUTHORITY_TRANSITION_CONFLICT");
    });
    this.secrets.delete(input.operationId);
    return Object.freeze({ operationId: input.operationId, capabilityId: input.capabilityId, state: input.action === "enable" ? "enabled" : "closed", version: input.expectedVersion + 1, receiptSha256: input.authorityReceiptSha256 });
  }

  /** Execute one schema-10 source transition. The migration trigger consumes
   * the permit, writes history/outbox, and completes the internal operation. */
  public runSourceRegistryMutation(capability: OperationCapability, input: SourceRegistryGatewayMutation): number {
    assert(this.secrets.get(capability.operationId) === capability.capabilitySecret, "CAPABILITY_INVALID");
    validateId(input.sourceId, "SOURCE_ID_INVALID");
    assert(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 1, "SOURCE_REVISION_INVALID");
    assert(["disable", "requeue", "enable", "retire"].includes(input.action), "SOURCE_ACTION_INVALID");
    const operation = selectOperation(this.database, capability.operationId);
    assert(operation.state === "authorized" && valueInt(operation.version, "OPERATION_VERSION_INVALID") === capability.version, "OPERATION_STATE_INVALID");
    assert(operation.owner_process === "admin_http" && operation.source_id === input.sourceId && operation.egress_class === "none", "SOURCE_AUTHORITY_INVALID");
    assert((input.action === "retire" ? operation.operation_kind === "source_delete" : operation.operation_kind === "source_update"), "SOURCE_AUTHORITY_INVALID");
    const at = valueString(operation.updated_at, "SOURCE_OPERATION_TIME_INVALID");
    const requestHash = valueString(operation.request_hash, "SOURCE_REQUEST_HASH_INVALID");
    const handoffId = valueString(operation.authorization_handoff_id, "SOURCE_HANDOFF_INVALID");
    const permitId = `source-permit-${hash(`${capability.operationId}\n${input.sourceId}\n${input.expectedRevision}`).slice(0, 40)}`;
    let changes = 0;
    this.tx("source_registry", () => {
      this.database.prepare("INSERT INTO source_registry_mutation_permit_v1(permit_id,operation_id,source_id,action,expected_revision,request_hash,reason_code,authorization_ref,one_time_nonce,created_at,consumed_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)")
        .run(permitId, capability.operationId, input.sourceId, input.action, input.expectedRevision, requestHash, input.reasonCode, handoffId, nonce(), at);
      const common = "revision=revision+1,current_operation_id=?,current_request_hash=?,updated_at=?,source_config_epoch=?,source_safety_epoch=?,authorization_version=?,policy_epoch=?,recovery_epoch=?";
      const edge = input.action === "disable"
        ? "enabled=0,lifecycle_status='paused',collection_onboarding_status='stopped',source_stop_status='manual'"
        : input.action === "requeue"
          ? "enabled=0,lifecycle_status=CASE WHEN lifecycle_status='proposed' THEN 'proposed' ELSE 'paused' END,collection_onboarding_status=CASE WHEN lifecycle_status='proposed' THEN 'validating' ELSE 'activation_pending' END,source_stop_status=CASE WHEN lifecycle_status='proposed' THEN source_stop_status ELSE 'clear' END"
          : input.action === "enable"
            ? "enabled=1,lifecycle_status='active',collection_onboarding_status='queued',source_stop_status='clear'"
            : "enabled=0,lifecycle_status='retired',collection_onboarding_status='cancelled',source_stop_status='manual'";
      changes = Number(this.database.prepare(`UPDATE source_registry_v1 SET ${common},${edge} WHERE source_id=? AND revision=?`)
        .run(capability.operationId, requestHash, at, Number(operation.source_config_epoch), Number(operation.source_safety_epoch), Number(operation.authorization_version), Number(operation.policy_epoch), Number(operation.recovery_epoch), input.sourceId, input.expectedRevision).changes);
      assert(changes === 1, "SOURCE_MUTATION_CONFLICT");
      const terminal = parseRow(this.database.prepare("SELECT state,result_hash FROM internal_operation WHERE operation_id=?").get(capability.operationId));
      assert(terminal.state === "succeeded" && terminal.result_hash === requestHash, "SOURCE_OPERATION_NOT_COMPLETED");
    });
    this.secrets.delete(capability.operationId);
    return changes;
  }

  /**
   * Groups request -> authorize -> attempt-intent sequences into one durable
   * admission commit. The callback remains synchronous, and every statement
   * still passes through the narrower method-specific authorizer context used
   * by the existing gateway methods. A rollback also drops capabilities that
   * were minted in memory for database rows which no longer exist.
   */
  public runAtomicAdmission<T>(callback: () => T): T {
    assert(this.atomicAdmissionDepth === 0, "ATOMIC_ADMISSION_NESTED");
    const secretKeysBefore = new Set(this.secrets.keys());
    const xManualBefore = new Set(this.xManualOperations);
    try {
      return withSqliteAuthorizerContext(this.database, "read_only", () =>
        withGuardedWriteTransaction(this.database, () => {
          this.atomicAdmissionDepth = 1;
          try { return callback(); }
          finally { this.atomicAdmissionDepth = 0; }
        }));
    } catch (error) {
      for (const operationId of this.secrets.keys()) if (!secretKeysBefore.has(operationId)) this.secrets.delete(operationId);
      for (const operationId of this.xManualOperations) if (!xManualBefore.has(operationId)) this.xManualOperations.delete(operationId);
      throw error;
    }
  }

  /**
   * Structured schema-9 admission materializer. It is callable only inside
   * runAtomicAdmission after every targeted real external operation has an
   * exact durable attempt intent. Callers cannot provide SQL.
   */
  public materializeBilingualAdmission(input: BilingualAdmissionMaterialization): Readonly<{ zhSlotId: string; enSlotId: string }> {
    assert(this.atomicAdmissionDepth === 1, "BILINGUAL_ADMISSION_TRANSACTION_REQUIRED");
    validateId(input.carrierOperationId); validateId(input.candidateId); validateId(input.publicId); validateId(input.sourceId);
    validateHash(input.inputContentHash); validateHash(input.sourceFactSetHash); validateHash(input.sourceReleaseHash); validateHash(input.promptSha256);
    assert(input.promptSchemaVersion.length >= 1 && input.promptSchemaVersion.length <= 80, "BILINGUAL_PROMPT_INVALID");
    assert(input.children.length >= 1 && input.children.length <= 2, "BILINGUAL_TARGET_SET_INVALID");
    const zh = input.children.find((child) => child.language === "zh-CN");
    const en = input.children.find((child) => child.language === "en");
    assert(new Set(input.children.map((child) => child.language)).size === input.children.length, "BILINGUAL_TARGET_SET_INVALID");
    assert(input.children.every((child) => child.attemptNumber >= 1 && child.attemptNumber <= 3), "BILINGUAL_ATTEMPT_INVALID");
    assert(zh === undefined || zh.operationId === input.carrierOperationId, "BILINGUAL_CARRIER_INVALID");
    assert(en === undefined || en.operationId !== input.carrierOperationId, "BILINGUAL_CARRIER_INVALID");
    const candidate = parseRow(this.database.prepare("SELECT source_id,source_revision,source_payload_hash FROM pending_review_candidate WHERE candidate_id=?").get(input.candidateId));
    assert(candidate.source_id === input.sourceId && Number(candidate.source_revision) === input.sourceRevision && candidate.source_payload_hash === input.inputContentHash, "BILINGUAL_CANDIDATE_STALE");
    for (const child of input.children) {
      const operation = selectOperation(this.database, child.operationId);
      assert(operation.state === "attempt_committed" && operation.owner_process === "bilingual_refiner" && operation.operation_kind === "refine" && operation.capability_class === "external_attempt" && operation.egress_class === "model_https", "BILINGUAL_OPERATION_INVALID");
      assert(operation.candidate_id === input.candidateId && operation.source_id === input.sourceId && Number(operation.expected_entity_version) === input.sourceRevision && operation.expected_entity_hash === input.inputContentHash, "BILINGUAL_OPERATION_BINDING_INVALID");
      assert(operation.budget_reservation_id !== null && operation.model_route_ref !== null && Number(operation.attempt) === child.attemptNumber, "BILINGUAL_OPERATION_BINDING_INVALID");
    }
    const zhSlotId = `slot-${hash(`${input.candidateId}\nzh-CN`).slice(0, 48)}`;
    const enSlotId = `slot-${hash(`${input.candidateId}\nen`).slice(0, 48)}`;
    withSqliteAuthorizerContext(this.database, "bilingual", () => {
      const carrier = selectOperation(this.database, input.carrierOperationId);
      const carrierAt = valueString(carrier.updated_at, "BILINGUAL_OPERATION_TIME_INVALID");
      const carrierRequestHash = valueString(carrier.request_hash, "BILINGUAL_OPERATION_REQUEST_INVALID");
      if (zh !== undefined) {
        this.database.prepare("INSERT INTO bilingual_operation_link_v1 VALUES(?,?,?,?,?,?,?,?,?,?)").run(`link-carrier-${zh.operationId}`, zh.operationId, null, input.candidateId, null, "refine_both", zh.attemptNumber, carrierRequestHash, `carrier-${zh.idempotencyKey}`, carrierAt);
        this.database.prepare("INSERT INTO bilingual_operation_link_v1 VALUES(?,?,?,?,?,?,?,?,?,?)").run(`link-bundle-${zh.operationId}`, zh.operationId, null, input.candidateId, null, "create_bundle", zh.attemptNumber, carrierRequestHash, `bundle-${zh.idempotencyKey}`, carrierAt);
      } else {
        const carrierLink = this.database.prepare("SELECT attempt_number FROM bilingual_operation_link_v1 WHERE operation_id=? AND candidate_id=? AND semantic_action='refine_both' AND parent_operation_id IS NULL AND language IS NULL").get(input.carrierOperationId, input.candidateId) as Record<string, unknown> | undefined;
        const carrierSlot = this.database.prepare("SELECT state,source_revision,input_content_hash,prompt_schema_version,prompt_sha256,operation_id FROM bilingual_language_slot_v1 WHERE candidate_id=? AND language='zh-CN'").get(input.candidateId) as Record<string, unknown> | undefined;
        assert(carrierLink !== undefined && carrier.state === "succeeded" && carrier.candidate_id === input.candidateId && Number(carrier.expected_entity_version) === input.sourceRevision && carrier.expected_entity_hash === input.inputContentHash, "BILINGUAL_CARRIER_INVALID");
        assert(carrierSlot !== undefined && carrierSlot.state === "complete" && carrierSlot.operation_id === input.carrierOperationId && Number(carrierSlot.source_revision) === input.sourceRevision && carrierSlot.input_content_hash === input.inputContentHash && carrierSlot.prompt_schema_version === input.promptSchemaVersion && carrierSlot.prompt_sha256 === input.promptSha256, "BILINGUAL_CARRIER_PROMPT_INVALID");
      }
      const existingLineage = this.database.prepare("SELECT source_revision,input_content_hash,source_fact_set_hash,source_release_hash FROM bilingual_candidate_lineage_v1 WHERE candidate_id=?").get(input.candidateId) as Record<string, unknown> | undefined;
      if (existingLineage === undefined) {
        assert(zh !== undefined && en !== undefined && zh.attemptNumber === 1 && en.attemptNumber === 1, "BILINGUAL_INITIAL_PAIR_REQUIRED");
        this.database.prepare("INSERT INTO bilingual_operation_link_v1 VALUES(?,?,?,?,?,?,?,?,?,?)").run(`link-lineage-${zh.operationId}`, zh.operationId, null, input.candidateId, null, "create_lineage", zh.attemptNumber, carrierRequestHash, `lineage-${zh.idempotencyKey}`, carrierAt);
        this.database.prepare("INSERT INTO bilingual_candidate_lineage_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(input.candidateId, input.publicId, input.sourceId, input.sourceRevision, input.inputContentHash, input.sourceFactSetHash, input.sourceReleaseHash, input.copyRiskStatus, input.rightsStatus, input.deletionStatus, input.mediaStatus, zh.operationId, carrierAt, carrierAt);
      } else {
        assert(Number(existingLineage.source_revision) === input.sourceRevision && existingLineage.input_content_hash === input.inputContentHash && existingLineage.source_fact_set_hash === input.sourceFactSetHash && existingLineage.source_release_hash === input.sourceReleaseHash, "BILINGUAL_LINEAGE_STALE");
      }
      for (const child of input.children) {
        const operation = selectOperation(this.database, child.operationId);
        const createdAt = valueString(operation.updated_at, "BILINGUAL_OPERATION_TIME_INVALID");
        const operationRequestHash = valueString(operation.request_hash, "BILINGUAL_OPERATION_REQUEST_INVALID");
        const parentOperationId = child.language === "zh-CN" ? null : input.carrierOperationId;
        const targetSlotId = child.language === "zh-CN" ? zhSlotId : enSlotId;
        const existingSlot = this.database.prepare("SELECT * FROM bilingual_language_slot_v1 WHERE slot_id=?").get(targetSlotId) as Record<string, unknown> | undefined;
        const expectedAttempt = Number((this.database.prepare("SELECT COALESCE(MAX(attempt_number),0)+1 AS attempt_number FROM bilingual_model_receipt_v1 WHERE slot_id=?").get(targetSlotId) as Record<string, unknown>).attempt_number);
        assert(child.attemptNumber === expectedAttempt, "BILINGUAL_ATTEMPT_SEQUENCE_INVALID");
        const semanticAction = existingSlot === undefined && child.attemptNumber === 1
          ? "refine_language"
          : ["failed", "blocked"].includes(String(existingSlot?.state)) ? "retry_language" : "rerun_language";
        this.database.prepare("INSERT INTO bilingual_operation_link_v1 VALUES(?,?,?,?,?,?,?,?,?,?)").run(`link-${child.language}-${child.operationId}`, child.operationId, parentOperationId, input.candidateId, child.language, semanticAction, child.attemptNumber, operationRequestHash, child.idempotencyKey, createdAt);
        if (existingSlot === undefined) {
          const slotAt = new Date(Date.parse(createdAt) - 1).toISOString();
          this.database.prepare("INSERT INTO bilingual_language_slot_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(targetSlotId, input.candidateId, child.language, 0, "queued", input.sourceRevision, input.inputContentHash, input.sourceFactSetHash, input.sourceReleaseHash, input.promptSchemaVersion, input.promptSha256, null, null, null, null, null, child.operationId, slotAt);
        } else {
          assert(["failed", "blocked", "stale", "complete"].includes(String(existingSlot.state)), "BILINGUAL_SLOT_RETRY_INVALID");
          if (["failed", "blocked"].includes(String(existingSlot.state))) {
            assert(Number(existingSlot.source_revision) === input.sourceRevision && existingSlot.input_content_hash === input.inputContentHash && existingSlot.source_fact_set_hash === input.sourceFactSetHash && existingSlot.source_release_hash === input.sourceReleaseHash && existingSlot.prompt_schema_version === input.promptSchemaVersion && existingSlot.prompt_sha256 === input.promptSha256, "BILINGUAL_RETRY_CONTRACT_DRIFT");
          }
          if (String(existingSlot.state) === "complete") {
            assert(Number(existingSlot.source_revision) === input.sourceRevision && existingSlot.input_content_hash === input.inputContentHash && existingSlot.source_fact_set_hash === input.sourceFactSetHash && existingSlot.source_release_hash === input.sourceReleaseHash, "BILINGUAL_RERUN_SOURCE_DRIFT");
          }
          const changed = this.database.prepare("UPDATE bilingual_language_slot_v1 SET revision=revision+1,state='queued',source_revision=?,input_content_hash=?,source_fact_set_hash=?,source_release_hash=?,prompt_schema_version=?,prompt_sha256=?,model_route_receipt_hash=NULL,draft_hash=NULL,current_attempt_id=NULL,current_attempt_operation_id=NULL,failure_reason=NULL,operation_id=?,updated_at=? WHERE slot_id=? AND revision=?").run(input.sourceRevision, input.inputContentHash, input.sourceFactSetHash, input.sourceReleaseHash, input.promptSchemaVersion, input.promptSha256, child.operationId, createdAt, targetSlotId, Number(existingSlot.revision)).changes;
          assert(changed === 1, "BILINGUAL_SLOT_RETRY_CONFLICT");
        }
      }
    });
    return Object.freeze({ zhSlotId, enSlotId });
  }

  /**
   * Commits one fresh-admin-authorized, append-only safety decision. The
   * caller selects an action; all hashes, authority bindings and projected
   * safety states are derived inside this gateway transaction.
   */
  public commitBilingualLineageSafetyDecision(
    capability: OperationCapability,
    authorization: BilingualSafetyAuthorization,
    input: BilingualSafetyDecisionInput,
  ): BilingualSafetyDecisionReceipt {
    assert(this.secrets.get(capability.operationId) === capability.capabilitySecret, "CAPABILITY_INVALID");
    validateId(input.candidateId); validateId(input.sourceId); validateHash(input.inputContentHash);
    validateHash(authorization.bodyHash); validateHash(authorization.freshDigest); validateHash(authorization.resourceHash); validateHash(authorization.sessionDigest); validateHash(authorization.csrfDigest); validateUtc(authorization.verifiedAt);
    assert(authorization.operationId === capability.operationId && authorization.freshAction === "BILINGUAL_SAFETY_DECISION" && authorization.freshDigest.length === 64 && authorization.actorRef.length > 0, "BILINGUAL_SAFETY_AUTHORIZATION_INVALID");
    assert(Number.isSafeInteger(input.sourceRevision) && input.sourceRevision >= 1 && Number.isSafeInteger(input.expectedDecisionSeq) && input.expectedDecisionSeq >= 1, "BILINGUAL_SAFETY_CAS_INVALID");
    assert(input.action !== "block" || input.blockReason !== undefined, "BILINGUAL_SAFETY_BLOCK_REASON_REQUIRED");
    assert(input.action === "block" || input.blockReason === undefined, "BILINGUAL_SAFETY_BLOCK_REASON_INVALID");
    assert(input.action === "clear" || input.mediaClearance === undefined, "BILINGUAL_SAFETY_MEDIA_INVALID");
    assert(input.action === "clear" ? typeof input.expiresAt === "string" : input.expiresAt === undefined, "BILINGUAL_SAFETY_EXPIRY_INVALID");
    if (input.expiresAt !== undefined) validateUtc(input.expiresAt);

    const resourceHash = bilingualSafetyResourceHash(input);
    assert(authorization.resourceHash === resourceHash, "BILINGUAL_SAFETY_RESOURCE_BINDING_INVALID");
    const existing = this.database.prepare("SELECT * FROM bilingual_lineage_safety_decision_v1 WHERE operation_id=?").get(capability.operationId) as Record<string, unknown> | undefined;
    if (existing !== undefined) {
      assert(existing.request_hash === authorization.bodyHash && existing.resource_hash === resourceHash && Number(existing.decision_seq) === input.expectedDecisionSeq, "IDEMPOTENCY_CONFLICT");
      const decisionHash = domainHash("f1plus1-bilingual-safety-decision-v1", existing);
      return Object.freeze({ decisionId: String(existing.decision_id), decisionSeq: Number(existing.decision_seq), operationId: capability.operationId, resourceHash, decisionHash, decidedAt: String(existing.decided_at) });
    }

    let receipt!: BilingualSafetyDecisionReceipt;
    this.tx("bilingual", () => {
      const operation = selectOperation(this.database, capability.operationId);
      assert(operation.state === "authorized" && Number(operation.version) === capability.version, "OPERATION_STATE_INVALID");
      assert(operation.owner_process === "admin_http" && operation.operation_kind === "review" && operation.capability_class === "db_mutation" && operation.egress_class === "none", "BILINGUAL_SAFETY_OPERATION_INVALID");
      assert(operation.policy_id === `p-review-admin-${operation.phase}` && operation.candidate_id === input.candidateId && operation.source_id === input.sourceId, "BILINGUAL_SAFETY_OPERATION_INVALID");
      assert(Number(operation.expected_entity_version) === input.sourceRevision && operation.expected_entity_hash === input.inputContentHash && operation.request_hash === authorization.bodyHash, "BILINGUAL_SAFETY_OPERATION_BINDING_INVALID");

      const current = this.database.prepare("SELECT decision_id,decision_seq FROM bilingual_lineage_safety_decision_v1 WHERE candidate_id=? ORDER BY decision_seq DESC LIMIT 1").get(input.candidateId) as Record<string, unknown> | undefined;
      assert((current === undefined && input.expectedDecisionSeq === 1 && input.supersedesDecisionId === null)
        || (current !== undefined && Number(current.decision_seq) + 1 === input.expectedDecisionSeq && current.decision_id === input.supersedesDecisionId), "BILINGUAL_SAFETY_CAS_INVALID");
      const lineage = parseRow(this.database.prepare("SELECT source_id,source_revision,input_content_hash FROM bilingual_candidate_lineage_v1 WHERE candidate_id=?").get(input.candidateId));
      assert(lineage.source_id === input.sourceId && Number(lineage.source_revision) === input.sourceRevision && lineage.input_content_hash === input.inputContentHash, "BILINGUAL_SAFETY_LINEAGE_STALE");
      const authority = parseRow(this.database.prepare(`SELECT registry.revision AS registry_revision,registry.identity_sha256,
        registry.authorization_expires_at,registry.source_config_epoch,registry.source_safety_epoch,registry.authorization_version,
        registry.policy_epoch,registry.recovery_epoch,config.source_revision AS config_revision,
        config.authorization_receipt_sha256,config.source_policy_sha256,control.writer_epoch,
        registry.enabled,registry.lifecycle_status,registry.source_kind,registry.collection_mode,registry.normalization_status,
        registry.dedup_status,registry.identity_status,registry.relevance_status,registry.monitorability,
        registry.adapter_status,registry.adapter_authorization_status,registry.platform_allowed,registry.source_stop_status,
        control.source_config_epoch AS control_source_config_epoch,control.source_safety_epoch AS control_source_safety_epoch,
        control.authorization_version AS control_authorization_version,control.policy_epoch AS control_policy_epoch,
        control.recovery_epoch AS control_recovery_epoch
        FROM source_registry_v1 registry JOIN source_registry_rss_config_v1 config ON config.source_id=registry.source_id
        JOIN internal_control control ON control.singleton_id=1 WHERE registry.source_id=?`).get(input.sourceId));
      const decidedAt = nowIso(this.clock);
      assert(Date.parse(authorization.verifiedAt) <= Date.parse(decidedAt) && Date.parse(decidedAt) - Date.parse(authorization.verifiedAt) <= 300_000, "BILINGUAL_SAFETY_FRESHNESS_INVALID");
      if (input.expiresAt !== undefined) assert(Date.parse(input.expiresAt) > Date.parse(decidedAt), "BILINGUAL_SAFETY_EXPIRY_INVALID");
      assert(authority.enabled === 1 && authority.lifecycle_status === "active" && authority.source_kind === "rss" && authority.collection_mode === "rss"
        && authority.normalization_status === "valid" && ["unique", "linked_existing"].includes(String(authority.dedup_status))
        && authority.adapter_status === "ready" && authority.adapter_authorization_status === "valid" && authority.platform_allowed === "allowed"
        && authority.source_stop_status === "clear"
        && (authority.authorization_expires_at === null || Date.parse(String(authority.authorization_expires_at)) > Date.parse(decidedAt)), "BILINGUAL_SAFETY_SOURCE_AUTHORITY_INVALID");
      const authorityContext = {
        sourceRegistryRevision: Number(authority.registry_revision), sourceIdentitySha256: String(authority.identity_sha256),
        sourceConfigRevision: Number(authority.config_revision), authorizationReceiptSha256: String(authority.authorization_receipt_sha256),
        sourcePolicySha256: String(authority.source_policy_sha256), sourceConfigEpoch: Number(authority.source_config_epoch),
        sourceSafetyEpoch: Number(authority.source_safety_epoch), authorizationVersion: Number(authority.authorization_version),
        policyEpoch: Number(authority.policy_epoch), recoveryEpoch: Number(authority.recovery_epoch),
        controlSourceConfigEpoch: Number(authority.control_source_config_epoch), controlSourceSafetyEpoch: Number(authority.control_source_safety_epoch),
        controlAuthorizationVersion: Number(authority.control_authorization_version), controlPolicyEpoch: Number(authority.control_policy_epoch),
        controlRecoveryEpoch: Number(authority.control_recovery_epoch), writerEpoch: Number(authority.writer_epoch),
        authorizationExpiresAt: authority.authorization_expires_at === null ? null : String(authority.authorization_expires_at),
      };
      for (const value of [authorityContext.sourceRegistryRevision, authorityContext.sourceConfigRevision, authorityContext.sourceConfigEpoch, authorityContext.sourceSafetyEpoch, authorityContext.authorizationVersion, authorityContext.policyEpoch, authorityContext.recoveryEpoch, authorityContext.controlSourceConfigEpoch, authorityContext.controlSourceSafetyEpoch, authorityContext.controlAuthorizationVersion, authorityContext.controlPolicyEpoch, authorityContext.controlRecoveryEpoch, authorityContext.writerEpoch]) assert(Number.isSafeInteger(value) && value >= 1, "BILINGUAL_SAFETY_SOURCE_AUTHORITY_INVALID");
      for (const value of [authorityContext.sourceIdentitySha256, authorityContext.authorizationReceiptSha256, authorityContext.sourcePolicySha256]) validateHash(value);
      const authorityContextHash = domainHash("f1plus1-bilingual-safety-source-authority-v1", authorityContext);
      const actorHash = hash(`f1plus1-bilingual-safety-actor-v1\n${authorization.actorRef}`);
      const statuses = input.action === "clear"
        ? { copy: "screen_passed", rights: "clear", deletion: "clear", media: input.mediaClearance ?? "none", reason: "MANUAL_CLEAR" }
        : input.action === "block"
          ? { copy: input.blockReason === "COPY_RISK" ? "blocked" : "unknown", rights: input.blockReason === "RIGHTS_BLOCKED" ? "blocked" : "unknown", deletion: input.blockReason === "DELETION_BLOCKED" ? "blocked" : "unknown", media: input.blockReason === "MEDIA_BLOCKED" ? "blocked" : "unknown", reason: input.blockReason! }
          : { copy: "unknown", rights: "unknown", deletion: "unknown", media: "unknown", reason: input.action === "withdraw" ? "OPERATOR_WITHDRAW" : "EXPIRED" };
      const decisionId = `bilingual-safety-${hash(`${capability.operationId}\n${resourceHash}`).slice(0, 40)}`;
      const permitId = `permit-${nonce()}`;
      withSqliteAuthorizerContext(this.database, "authorize_write", () => this.insertWritePermitInTransaction(capability, { entityKind: "candidate", entityId: input.candidateId, mutationKind: "update", expectedVersion: input.sourceRevision, expectedHash: input.inputContentHash }, permitId, decidedAt));
      this.database.prepare("INSERT INTO bilingual_operation_link_v1 VALUES(?,?,?,?,?,?,?,?,?,?)").run(`link-safety-${capability.operationId}`, capability.operationId, null, input.candidateId, null, "decide_safety", 0, authorization.bodyHash, `safety-${capability.operationId}`, decidedAt);
      assert(this.database.prepare(`SELECT 1 FROM internal_operation op
        JOIN bilingual_operation_link_v1 link ON link.operation_id=op.operation_id
        JOIN operation_entity_binding source_binding ON source_binding.operation_id=op.operation_id AND source_binding.entity_kind='source' AND source_binding.entity_id=? AND source_binding.identity_selector='source_id'
        JOIN operation_entity_binding candidate_binding ON candidate_binding.operation_id=op.operation_id AND candidate_binding.entity_kind='candidate' AND candidate_binding.entity_id=? AND candidate_binding.identity_selector='candidate_id'
        JOIN gateway_write_permit permit ON permit.operation_id=op.operation_id AND permit.entity_kind='candidate' AND permit.entity_id=? AND permit.mutation_kind='update' AND permit.expected_entity_version=? AND permit.expected_entity_hash=? AND permit.consumed_at IS NULL
        WHERE op.operation_id=? AND op.state='authorized' AND op.owner_process='admin_http' AND op.operation_kind='review' AND op.capability_class='db_mutation' AND op.egress_class='none'
          AND op.policy_id='p-review-admin-' || op.phase AND op.candidate_id=? AND op.source_id=? AND op.expected_entity_version=? AND op.expected_entity_hash=? AND op.request_hash=?
          AND link.candidate_id=? AND link.semantic_action='decide_safety' AND link.request_hash=?`).get(
        input.sourceId, input.candidateId, input.candidateId, input.sourceRevision, input.inputContentHash, capability.operationId,
        input.candidateId, input.sourceId, input.sourceRevision, input.inputContentHash, authorization.bodyHash, input.candidateId, authorization.bodyHash,
      ) !== undefined, "BILINGUAL_SAFETY_OPERATION_AUTHORITY_INVALID");
      this.database.prepare(`INSERT INTO bilingual_lineage_safety_decision_v1 VALUES(${Array.from({ length: 39 }, () => "?").join(",")})`).run(
        decisionId, input.expectedDecisionSeq, input.candidateId, input.sourceId, input.sourceRevision, input.inputContentHash,
        authorityContext.sourceRegistryRevision, authorityContext.sourceIdentitySha256, authorityContext.sourceConfigRevision,
        authorityContext.authorizationReceiptSha256, authorityContext.sourcePolicySha256, authorityContext.sourceConfigEpoch,
        authorityContext.sourceSafetyEpoch, authorityContext.authorizationVersion, authorityContext.policyEpoch,
        authorityContext.recoveryEpoch, authorityContext.controlSourceConfigEpoch, authorityContext.controlSourceSafetyEpoch,
        authorityContext.controlAuthorizationVersion, authorityContext.controlPolicyEpoch, authorityContext.controlRecoveryEpoch,
        authorityContext.writerEpoch, authorityContext.authorizationExpiresAt, authorityContextHash,
        input.action, statuses.copy, statuses.rights, statuses.deletion, statuses.media, statuses.reason,
        capability.operationId, actorHash, authorization.freshDigest, authorization.bodyHash, resourceHash,
        input.supersedesDecisionId, authorization.verifiedAt, decidedAt, input.action === "clear" ? input.expiresAt! : null,
      );
      const projected = parseRow(this.database.prepare("SELECT operation_id,updated_at FROM bilingual_candidate_lineage_v1 WHERE candidate_id=?").get(input.candidateId));
      assert(projected.operation_id === capability.operationId && projected.updated_at === decidedAt, "BILINGUAL_SAFETY_PROJECTION_FAILED");
      const consumed = parseRow(this.database.prepare("SELECT consumed_at FROM gateway_write_permit WHERE permit_id=?").get(permitId));
      assert(consumed.consumed_at === decidedAt, "BILINGUAL_SAFETY_PERMIT_NOT_CONSUMED");
      withSqliteAuthorizerContext(this.database, "response", () => {
        this.postcheckFencesAt(capability.operationId, decidedAt);
        const decisionRow = parseRow(this.database.prepare("SELECT * FROM bilingual_lineage_safety_decision_v1 WHERE decision_id=?").get(decisionId));
        const decisionHash = domainHash("f1plus1-bilingual-safety-decision-v1", decisionRow);
        const changed = this.database.prepare("UPDATE internal_operation SET state='succeeded',version=version+1,result_hash=?,updated_at=? WHERE operation_id=? AND state='authorized'").run(decisionHash, decidedAt, capability.operationId).changes;
        assert(changed === 1, "OPERATION_COMPLETE_CONFLICT");
        operationAuditEvent(this.database, capability.operationId, "write_permit_consumed", "gateway", { entityKind: "candidate", entityId: input.candidateId, mutationKind: "update", permitId }, decidedAt);
        operationAuditEvent(this.database, capability.operationId, "operation_succeeded", authorization.actorRef, { decisionId, decisionHash, resourceHash, actorHash, freshVerificationDigest: authorization.freshDigest }, decidedAt);
        receipt = Object.freeze({ decisionId, decisionSeq: input.expectedDecisionSeq, operationId: capability.operationId, resourceHash, decisionHash, decidedAt });
      });
    });
    return receipt;
  }

  /**
   * Opens one structured, idempotent domain-materialization transaction after
   * a successful manual safety decision. The callback receives only values
   * re-read from the immutable latest decision; callers cannot substitute a
   * stale decision or write through an arbitrary SQL capability.
   */
  public materializeBilingualBundleAfterSafetyDecision<T>(
    receipt: BilingualSafetyDecisionReceipt,
    materialize: (authority: BilingualSafetyMaterialization) => T,
  ): T {
    validateId(receipt.decisionId); validateId(receipt.operationId); validateHash(receipt.resourceHash); validateHash(receipt.decisionHash); validateUtc(receipt.decidedAt);
    assert(Number.isSafeInteger(receipt.decisionSeq) && receipt.decisionSeq >= 1, "BILINGUAL_SAFETY_CAS_INVALID");
    let result!: T;
    this.tx("bilingual", () => {
      const decision = parseRow(this.database.prepare("SELECT * FROM bilingual_lineage_safety_decision_v1 WHERE decision_id=?").get(receipt.decisionId));
      assert(decision.operation_id === receipt.operationId && Number(decision.decision_seq) === receipt.decisionSeq
        && decision.resource_hash === receipt.resourceHash && decision.decided_at === receipt.decidedAt
        && domainHash("f1plus1-bilingual-safety-decision-v1", decision) === receipt.decisionHash, "BILINGUAL_SAFETY_RECEIPT_INVALID");
      const at = nowIso(this.clock);
      const effective = parseRow(this.database.prepare(`SELECT candidate_id,decision_id,decision_seq,resource_hash,request_hash,authority_context_hash,expires_at
        FROM bilingual_lineage_effective_safety_v1 WHERE decision_id=? AND action='clear' AND expires_at>?
          AND (source_authorization_expires_at IS NULL OR source_authorization_expires_at>?)`).get(receipt.decisionId, at, at));
      result = materialize(Object.freeze({
        candidateId: String(effective.candidate_id), decisionId: String(effective.decision_id), decisionSeq: Number(effective.decision_seq),
        resourceHash: String(effective.resource_hash), requestHash: String(effective.request_hash), authorityContextHash: String(effective.authority_context_hash),
        expiresAt: String(effective.expires_at), materializedAt: at,
      }));
      withSqliteAuthorizerContext(this.database, "response", () => operationAuditEvent(this.database, receipt.operationId, "write_permit_consumed", "gateway", {
        semanticAction: "create_bundle", decisionId: receipt.decisionId, candidateId: effective.candidate_id,
      }, at));
    });
    return result;
  }

  /** Commit one manual approve/reject decision against the exact latest reviewable bundle. */
  public commitBilingualApproval(
    capability: OperationCapability,
    authorization: BilingualApprovalAuthorization,
    input: BilingualApprovalInput,
  ): BilingualApprovalReceipt {
    assert(this.secrets.get(capability.operationId) === capability.capabilitySecret, "CAPABILITY_INVALID");
    validateId(input.candidateId); validateHash(authorization.bodyHash); validateHash(authorization.sessionDigest); validateHash(authorization.csrfDigest);
    assert(authorization.actorRef.length > 0 && !authorization.actorRef.startsWith("system-") && authorization.operationId === capability.operationId, "BILINGUAL_APPROVAL_AUTHORIZATION_INVALID");
    assert(Number.isSafeInteger(input.expectedBundleRevision) && input.expectedBundleRevision >= 1, "BILINGUAL_APPROVAL_REVISION_INVALID");
    let receipt!: BilingualApprovalReceipt;
    this.tx("bilingual", () => {
      const operation = selectOperation(this.database, capability.operationId);
      assert(operation.state === "authorized" && operation.owner_process === "admin_http" && operation.operation_kind === "review" && operation.egress_class === "none", "BILINGUAL_APPROVAL_OPERATION_INVALID");
      assert(operation.candidate_id === input.candidateId && Number(operation.expected_entity_version) === input.expectedBundleRevision && operation.request_hash === authorization.bodyHash, "BILINGUAL_APPROVAL_OPERATION_BINDING_INVALID");
      const bundle = parseRow(this.database.prepare("SELECT bundle_id,bundle_hash,operation_id,state FROM bilingual_bundle_v1 WHERE candidate_id=? AND revision=?").get(input.candidateId, input.expectedBundleRevision));
      assert(bundle.state === "reviewable" && operation.expected_entity_hash === bundle.bundle_hash, "BILINGUAL_APPROVAL_BUNDLE_STALE");
      const existing = this.database.prepare("SELECT * FROM bilingual_approval_v1 WHERE operation_id=?").get(capability.operationId) as Record<string, unknown> | undefined;
      if (existing !== undefined) {
        assert(existing.bundle_id === bundle.bundle_id && existing.bundle_hash === bundle.bundle_hash && existing.decision === input.decision && existing.actor_ref === authorization.actorRef, "IDEMPOTENCY_CONFLICT");
        const approvalHash = domainHash("f1plus1-bilingual-approval-v1", existing);
        receipt = Object.freeze({ approvalId: String(existing.approval_id), bundleId: String(existing.bundle_id), bundleHash: String(existing.bundle_hash), decision: input.decision, operationId: capability.operationId, approvalHash, decidedAt: String(existing.decided_at) });
        return;
      }
      const decidedAt = nowIso(this.clock);
      const approvalId = `bilingual-approval-${hash(`${capability.operationId}\n${bundle.bundle_hash}\n${input.decision}`).slice(0, 40)}`;
      const permitId = `permit-${nonce()}`;
      withSqliteAuthorizerContext(this.database, "authorize_write", () => this.insertWritePermitInTransaction(capability, { entityKind: "candidate", entityId: input.candidateId, mutationKind: "update", expectedVersion: input.expectedBundleRevision, expectedHash: String(bundle.bundle_hash) }, permitId, decidedAt));
      this.database.prepare("INSERT INTO bilingual_operation_link_v1 VALUES(?,?,?,?,?,?,?,?,?,?)").run(`link-${input.decision}-${capability.operationId}`, capability.operationId, String(bundle.operation_id), input.candidateId, "zh-CN", input.decision === "approved" ? "approve" : "reject", 0, authorization.bodyHash, `approval-${capability.operationId}`, decidedAt);
      this.database.prepare("INSERT INTO bilingual_approval_v1 VALUES(?,?,?,?,?,?,?,?)").run(approvalId, String(bundle.bundle_id), String(bundle.bundle_hash), input.decision, authorization.actorRef, capability.operationId, decidedAt, null);
      const approvalRow = parseRow(this.database.prepare("SELECT * FROM bilingual_approval_v1 WHERE approval_id=?").get(approvalId));
      const approvalHash = domainHash("f1plus1-bilingual-approval-v1", approvalRow);
      withSqliteAuthorizerContext(this.database, "response", () => {
        const consumed = this.database.prepare("UPDATE gateway_write_permit SET consumed_at=? WHERE permit_id=? AND consumed_at IS NULL").run(decidedAt, permitId).changes;
        assert(consumed === 1, "BILINGUAL_APPROVAL_PERMIT_NOT_CONSUMED");
        this.postcheckFencesAt(capability.operationId, decidedAt);
        const changed = this.database.prepare("UPDATE internal_operation SET state='succeeded',version=version+1,result_hash=?,updated_at=? WHERE operation_id=? AND state='authorized'").run(approvalHash, decidedAt, capability.operationId).changes;
        assert(changed === 1, "OPERATION_COMPLETE_CONFLICT");
        operationAuditEvent(this.database, capability.operationId, "write_permit_consumed", "gateway", { entityKind: "candidate", entityId: input.candidateId, mutationKind: "update", permitId }, decidedAt);
        operationAuditEvent(this.database, capability.operationId, "operation_succeeded", authorization.actorRef, { approvalId, approvalHash, decision: input.decision }, decidedAt);
      });
      receipt = Object.freeze({ approvalId, bundleId: String(bundle.bundle_id), bundleHash: String(bundle.bundle_hash), decision: input.decision, operationId: capability.operationId, approvalHash, decidedAt });
    });
    return receipt;
  }

  public commitBilingualInitialPublication(
    capability: OperationCapability,
    authorization: BilingualPublicationAuthorization,
    input: BilingualInitialPublicationInput,
  ): BilingualPublicationReceipt {
    this.validateBilingualPublicationInput(capability, authorization, input);
    let receipt!: BilingualPublicationReceipt;
    this.tx("bilingual", () => {
      const operation = selectOperation(this.database, capability.operationId);
      assert(operation.state === "authorized" && Number(operation.version) === capability.version, "OPERATION_STATE_INVALID");
      assert(operation.owner_process === "admin_http" && operation.operation_kind === "publish" && operation.capability_class === "db_mutation" && operation.egress_class === "none", "BILINGUAL_PUBLICATION_OPERATION_INVALID");
      assert(operation.candidate_id === input.candidateId && operation.publication_id === input.publicationId && operation.public_id === input.publicId
        && operation.request_hash === authorization.bodyHash, "BILINGUAL_PUBLICATION_OPERATION_BINDING_INVALID");
      const bundle = parseRow(this.database.prepare(`SELECT bundle.*,lineage.source_id,lineage.public_id AS lineage_public_id,lineage.source_revision,lineage.input_content_hash
        FROM bilingual_bundle_v1 bundle JOIN bilingual_candidate_lineage_v1 lineage ON lineage.candidate_id=bundle.candidate_id
        WHERE bundle.candidate_id=? AND bundle.revision=?`).get(input.candidateId, input.expectedBundleRevision));
      assert(bundle.state === "reviewable" && bundle.lineage_public_id === input.publicId, "BILINGUAL_PUBLICATION_BUNDLE_STALE");
      assert(Number(operation.expected_entity_version) === input.expectedBundleRevision && operation.expected_entity_hash === bundle.bundle_hash, "BILINGUAL_PUBLICATION_OPERATION_BINDING_INVALID");
      const at = nowIso(this.clock);
      this.assertBilingualPublicationSourceAndSafety(String(bundle.source_id), input.candidateId, Number(bundle.source_revision), String(bundle.input_content_hash), at, true);
      this.assertBilingualPublicationBindings(capability.operationId, input, bundle, 0);
      const approval = parseRow(this.database.prepare(`SELECT * FROM bilingual_approval_v1
        WHERE bundle_id=? AND bundle_hash=? AND decision IN ('approved','manual_override')
        ORDER BY decided_at DESC,approval_id DESC LIMIT 1`).get(...sqlValues([bundle.bundle_id, bundle.bundle_hash])));
      assert(!String(approval.actor_ref).startsWith("system-"), "BILINGUAL_PUBLICATION_APPROVAL_INVALID");
      const approvalHash = domainHash("f1plus1-bilingual-approval-v1", approval);
      const permitId = `permit-${nonce()}`;
      withSqliteAuthorizerContext(this.database, "authorize_write", () => this.insertWritePermitInTransaction(capability, {
        entityKind: "candidate", entityId: input.candidateId, mutationKind: "update",
        expectedVersion: input.expectedBundleRevision, expectedHash: String(bundle.bundle_hash),
      }, permitId, at));
      const publishingAt = new Date(Date.parse(at) + 1).toISOString();
      const publishedAt = new Date(Date.parse(at) + 2).toISOString();
      const projectionAt = new Date(Date.parse(at) + 3).toISOString();
      this.database.prepare("INSERT INTO bilingual_operation_link_v1 VALUES(?,?,?,?,?,?,?,?,?,?)").run(...sqlValues([
        `link-publish-${capability.operationId}`, capability.operationId, bundle.operation_id, input.candidateId, "zh-CN", "publish", 0,
        authorization.bodyHash, `publish-${capability.operationId}`, at,
      ]));
      this.database.prepare("INSERT INTO bilingual_publication_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(...sqlValues([
        input.publicationId, input.publicId, 1, "initial", null, bundle.bundle_id, bundle.bundle_hash,
        approval.approval_id, approvalHash, "queued", input.artifact.payloadHash, null, capability.operationId, null, at, at,
      ]));
      this.database.prepare("UPDATE bilingual_publication_v1 SET status='publishing',updated_at=? WHERE publication_id=?").run(publishingAt, input.publicationId);
      this.database.prepare("UPDATE bilingual_publication_v1 SET status='published',published_at=?,updated_at=? WHERE publication_id=?").run(publishedAt, publishedAt, input.publicationId);
      this.database.prepare("INSERT INTO bilingual_operation_link_v1 VALUES(?,?,?,?,?,?,?,?,?,?)").run(...sqlValues([
        `link-projection-${capability.operationId}`, capability.operationId, bundle.operation_id, input.candidateId, "zh-CN", "create_projection", 0,
        authorization.bodyHash, `projection-${capability.operationId}`, projectionAt,
      ]));
      this.database.prepare("INSERT INTO bilingual_public_projection_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
        input.artifact.projectionId, input.publicationId, input.publicId, input.artifact.generationId, input.artifact.generation,
        input.artifact.schemaVersion, input.artifact.payloadJson, input.artifact.payloadHash, input.artifact.signature,
        input.artifact.releaseSha256, input.artifact.manifestSha256, "staged", 1, capability.operationId, projectionAt, projectionAt,
      );
      const resultHash = domainHash("f1plus1-bilingual-publication-staged-v1", { publicationId: input.publicationId, projectionId: input.artifact.projectionId, payloadHash: input.artifact.payloadHash });
      this.completeBilingualManualOperation(capability, permitId, authorization.actorRef, resultHash, projectionAt, { publicationId: input.publicationId, projectionId: input.artifact.projectionId });
      receipt = Object.freeze({ publicationId: input.publicationId, projectionId: input.artifact.projectionId, publicId: input.publicId, revision: 1, generation: input.artifact.generation, projectionHash: input.artifact.payloadHash, outboxDeliveryId: null, status: "staged" });
    });
    return receipt;
  }

  public activateBilingualProjection(
    capability: OperationCapability,
    authorization: BilingualPublicationAuthorization,
    input: BilingualProjectionActivationInput,
  ): BilingualPublicationReceipt {
    this.validateBilingualPublicationInput(capability, authorization, input);
    let receipt!: BilingualPublicationReceipt;
    this.tx("bilingual", () => {
      const operation = selectOperation(this.database, capability.operationId);
      assert(operation.state === "authorized" && Number(operation.version) === capability.version && operation.owner_process === "admin_http"
        && operation.operation_kind === "publish" && operation.capability_class === "db_mutation" && operation.egress_class === "none", "BILINGUAL_PUBLICATION_OPERATION_INVALID");
      assert(operation.candidate_id === input.candidateId && operation.publication_id === input.publicationId && operation.public_id === input.publicId
        && operation.request_hash === authorization.bodyHash, "BILINGUAL_PUBLICATION_OPERATION_BINDING_INVALID");
      const publication = parseRow(this.database.prepare(`SELECT publication.*,bundle.candidate_id,bundle.revision AS bundle_revision,bundle.operation_id AS bundle_operation_id,
        lineage.source_id,lineage.source_revision,lineage.input_content_hash
        FROM bilingual_publication_v1 publication JOIN bilingual_bundle_v1 bundle ON bundle.bundle_id=publication.bundle_id
        JOIN bilingual_candidate_lineage_v1 lineage ON lineage.candidate_id=bundle.candidate_id
        WHERE publication.publication_id=?`).get(input.publicationId));
      assert(publication.status === "published" && publication.change_kind === "initial" && publication.public_id === input.publicId
        && publication.candidate_id === input.candidateId && Number(publication.bundle_revision) === input.expectedBundleRevision
        && publication.payload_hash === input.artifact.payloadHash, "BILINGUAL_PUBLICATION_STALE");
      assert(Number(operation.expected_entity_version) === input.expectedBundleRevision && operation.expected_entity_hash === publication.bundle_hash, "BILINGUAL_PUBLICATION_OPERATION_BINDING_INVALID");
      const at = nowIso(this.clock);
      this.assertBilingualPublicationSourceAndSafety(String(publication.source_id), input.candidateId, Number(publication.source_revision), String(publication.input_content_hash), at, true);
      this.assertBilingualPublicationBindings(capability.operationId, input, publication, 1);
      const projection = parseRow(this.database.prepare("SELECT * FROM bilingual_public_projection_v1 WHERE projection_id=?").get(input.artifact.projectionId));
      assert(projection.publication_id === input.publicationId && projection.public_id === input.publicId && projection.status === "staged"
        && projection.payload_hash === input.artifact.payloadHash && projection.operation_id === input.publicationOperationId, "BILINGUAL_PROJECTION_STALE");
      const permitId = `permit-${nonce()}`;
      withSqliteAuthorizerContext(this.database, "authorize_write", () => this.insertWritePermitInTransaction(capability, {
        entityKind: "candidate", entityId: input.candidateId, mutationKind: "update",
        expectedVersion: input.expectedBundleRevision, expectedHash: String(publication.bundle_hash),
      }, permitId, at));
      this.database.prepare("INSERT INTO bilingual_operation_link_v1 VALUES(?,?,?,?,?,?,?,?,?,?)").run(...sqlValues([
        `link-activate-${capability.operationId}`, capability.operationId, publication.bundle_operation_id, input.candidateId, "zh-CN", "activate_projection", 0,
        authorization.bodyHash, `activate-${capability.operationId}`, at,
      ]));
      this.database.prepare("UPDATE bilingual_public_projection_v1 SET status='active',version=version+1,operation_id=?,updated_at=? WHERE projection_id=?").run(capability.operationId, at, input.artifact.projectionId);
      this.database.prepare("INSERT INTO bilingual_public_projection_active_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
        input.publicId, input.artifact.projectionId, input.artifact.generation, input.artifact.schemaVersion, input.artifact.releaseSha256,
        input.artifact.manifestSha256, input.artifact.payloadHash, 1, "active", capability.operationId, at,
      );
      this.database.prepare("INSERT INTO bilingual_operation_link_v1 VALUES(?,?,?,?,?,?,?,?,?,?)").run(...sqlValues([
        `link-enqueue-${capability.operationId}`, capability.operationId, publication.bundle_operation_id, input.candidateId, "zh-CN", "enqueue_delivery", 0,
        authorization.bodyHash, `enqueue-${capability.operationId}`, at,
      ]));
      const deliveryId = `delivery-${domainHash("f1plus1-bilingual-delivery-v1", { publicationId: input.publicationId, projectionId: input.artifact.projectionId, generation: input.artifact.generation }).slice(0, 48)}`;
      this.database.prepare("INSERT INTO bilingual_publication_outbox_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
        deliveryId, input.publicationId, input.artifact.projectionId, input.artifact.generation, input.artifact.payloadHash,
        `delivery-${deliveryId}`, `reconcile-${deliveryId}`, "pending", 1, 0, 3, null, null, null, null, capability.operationId, at, at,
      );
      const resultHash = domainHash("f1plus1-bilingual-publication-active-v1", { publicationId: input.publicationId, projectionId: input.artifact.projectionId, deliveryId });
      this.completeBilingualManualOperation(capability, permitId, authorization.actorRef, resultHash, at, { publicationId: input.publicationId, projectionId: input.artifact.projectionId, deliveryId });
      receipt = Object.freeze({ publicationId: input.publicationId, projectionId: input.artifact.projectionId, publicId: input.publicId, revision: 1, generation: input.artifact.generation, projectionHash: input.artifact.payloadHash, outboxDeliveryId: deliveryId, status: "published" });
    });
    return receipt;
  }

  public commitBilingualWithdrawal(
    capability: OperationCapability,
    authorization: BilingualWithdrawalAuthorization,
    input: BilingualWithdrawalInput,
  ): BilingualPublicationReceipt {
    this.validateBilingualProjectionArtifact(input.artifact);
    validateId(input.publicationId); validateId(input.withdrawalPublicationId); validateId(input.publicId);
    validateHash(authorization.bodyHash); validateHash(authorization.sessionDigest); validateHash(authorization.csrfDigest);
    validateHash(authorization.freshDigest); validateHash(authorization.resourceHash); validateUtc(authorization.verifiedAt);
    assert(authorization.operationId === capability.operationId && authorization.actorRef.length > 0 && !authorization.actorRef.startsWith("system-"), "BILINGUAL_WITHDRAWAL_AUTHORIZATION_INVALID");
    assert(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 1
      && authorization.resourceHash === bilingualWithdrawalResourceHash(input), "BILINGUAL_WITHDRAWAL_RESOURCE_BINDING_INVALID");
    let receipt!: BilingualPublicationReceipt;
    this.tx("bilingual", () => {
      const operation = selectOperation(this.database, capability.operationId);
      assert(operation.state === "authorized" && Number(operation.version) === capability.version && operation.owner_process === "admin_http"
        && operation.operation_kind === "withdraw" && operation.capability_class === "db_mutation" && operation.egress_class === "none"
        && operation.publication_id === input.publicationId && operation.public_id === input.publicId && operation.request_hash === authorization.bodyHash,
      "BILINGUAL_WITHDRAWAL_OPERATION_INVALID");
      const previous = parseRow(this.database.prepare(`SELECT publication.*,bundle.candidate_id,bundle.revision AS bundle_revision,bundle.operation_id AS bundle_operation_id,
        lineage.source_id,lineage.source_revision,lineage.input_content_hash
        FROM bilingual_publication_v1 publication JOIN bilingual_bundle_v1 bundle ON bundle.bundle_id=publication.bundle_id
        JOIN bilingual_candidate_lineage_v1 lineage ON lineage.candidate_id=bundle.candidate_id
        WHERE publication.publication_id=? AND publication.revision=?`).get(input.publicationId, input.expectedRevision));
      assert(previous.status === "published" && previous.public_id === input.publicId, "BILINGUAL_WITHDRAW_PUBLICATION_STALE");
      assert(Number(operation.expected_entity_version) === input.expectedRevision && operation.expected_entity_hash === previous.payload_hash, "BILINGUAL_WITHDRAWAL_OPERATION_BINDING_INVALID");
      const at = nowIso(this.clock);
      assert(Date.parse(authorization.verifiedAt) <= Date.parse(at) && Date.parse(at) - Date.parse(authorization.verifiedAt) <= 300_000, "BILINGUAL_WITHDRAWAL_FRESHNESS_INVALID");
      this.assertBilingualPublicationSourceAndSafety(String(previous.source_id), String(previous.candidate_id), Number(previous.source_revision), String(previous.input_content_hash), at, false);
      this.assertBilingualWithdrawalBindings(capability.operationId, input, previous);
      const active = parseRow(this.database.prepare("SELECT * FROM bilingual_public_projection_active_v1 WHERE public_id=? AND status='active'").get(input.publicId));
      const revision = input.expectedRevision + 1;
      const permitId = `permit-${nonce()}`;
      withSqliteAuthorizerContext(this.database, "authorize_write", () => this.insertWritePermitInTransaction(capability, {
        entityKind: "publication", entityId: input.publicationId, mutationKind: "update",
        expectedVersion: input.expectedRevision, expectedHash: String(previous.payload_hash),
      }, permitId, at));
      for (const semantic of ["withdraw", "create_projection", "activate_projection", "enqueue_delivery"] as const) {
        this.database.prepare("INSERT INTO bilingual_operation_link_v1 VALUES(?,?,?,?,?,?,?,?,?,?)").run(...sqlValues([
          `link-${semantic}-${capability.operationId}`, capability.operationId, previous.bundle_operation_id, previous.candidate_id, "zh-CN", semantic, 0,
          authorization.bodyHash, `${semantic}-${capability.operationId}`, at,
        ]));
      }
      this.database.prepare("INSERT INTO bilingual_publication_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(...sqlValues([
        input.withdrawalPublicationId, input.publicId, revision, "withdrawal", input.publicationId, previous.bundle_id, previous.bundle_hash,
        previous.approval_id, previous.approval_hash, "withdrawal_queued", input.artifact.payloadHash, "OPERATOR_WITHDRAW",
        capability.operationId, null, at, at,
      ]));
      const publishingAt = new Date(Date.parse(at) + 1).toISOString();
      const withdrawnAt = new Date(Date.parse(at) + 2).toISOString();
      this.database.prepare("UPDATE bilingual_publication_v1 SET status='publishing',updated_at=? WHERE publication_id=?").run(publishingAt, input.withdrawalPublicationId);
      this.database.prepare("UPDATE bilingual_publication_v1 SET status='withdrawn',updated_at=? WHERE publication_id=?").run(withdrawnAt, input.withdrawalPublicationId);
      this.database.prepare("INSERT INTO bilingual_public_projection_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
        input.artifact.projectionId, input.withdrawalPublicationId, input.publicId, input.artifact.generationId, input.artifact.generation,
        input.artifact.schemaVersion, input.artifact.payloadJson, input.artifact.payloadHash, input.artifact.signature,
        input.artifact.releaseSha256, input.artifact.manifestSha256, "withdrawn", 1, capability.operationId, withdrawnAt, withdrawnAt,
      );
      this.database.prepare(`UPDATE bilingual_public_projection_active_v1 SET projection_id=?,generation=?,projection_hash=?,pointer_version=pointer_version+1,
        status='withdrawn',operation_id=?,updated_at=? WHERE public_id=? AND projection_id=? AND pointer_version=? AND status='active'`).run(...sqlValues([
        input.artifact.projectionId, input.artifact.generation, input.artifact.payloadHash, capability.operationId, withdrawnAt,
        input.publicId, active.projection_id, active.pointer_version,
      ]));
      const deliveryId = `delivery-${domainHash("f1plus1-bilingual-delivery-v1", { publicationId: input.withdrawalPublicationId, projectionId: input.artifact.projectionId, generation: input.artifact.generation }).slice(0, 48)}`;
      this.database.prepare("INSERT INTO bilingual_publication_outbox_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
        deliveryId, input.withdrawalPublicationId, input.artifact.projectionId, input.artifact.generation, input.artifact.payloadHash,
        `delivery-${deliveryId}`, `reconcile-${deliveryId}`, "pending", 1, 0, 3, null, null, null, null, capability.operationId, withdrawnAt, withdrawnAt,
      );
      const resultHash = domainHash("f1plus1-bilingual-withdrawal-v1", { publicationId: input.withdrawalPublicationId, projectionId: input.artifact.projectionId, deliveryId });
      this.completeBilingualManualOperation(capability, permitId, authorization.actorRef, resultHash, withdrawnAt, { publicationId: input.withdrawalPublicationId, projectionId: input.artifact.projectionId, deliveryId, freshVerificationDigest: authorization.freshDigest });
      receipt = Object.freeze({ publicationId: input.withdrawalPublicationId, projectionId: input.artifact.projectionId, publicId: input.publicId, revision, generation: input.artifact.generation, projectionHash: input.artifact.payloadHash, outboxDeliveryId: deliveryId, status: "withdrawn" });
    });
    return receipt;
  }

  private validateBilingualProjectionArtifact(artifact: BilingualProjectionArtifactInput): void {
    validateId(artifact.projectionId); validateId(artifact.generationId); validateHash(artifact.payloadHash);
    validateHash(artifact.releaseSha256); validateHash(artifact.manifestSha256);
    assert(artifact.schemaVersion === "public-read-bilingual-v2" && Number.isSafeInteger(artifact.generation) && artifact.generation >= 1, "BILINGUAL_PROJECTION_ARTIFACT_INVALID");
    assert(hash(artifact.payloadJson) === artifact.payloadHash && artifact.payloadJson === canonicalJsonV1(JSON.parse(artifact.payloadJson)), "BILINGUAL_PROJECTION_PAYLOAD_INVALID");
    assert(/^[A-Za-z0-9_-]{80,128}$/.test(artifact.signature), "BILINGUAL_PROJECTION_SIGNATURE_INVALID");
  }

  private validateBilingualPublicationInput(capability: OperationCapability, authorization: BilingualPublicationAuthorization, input: BilingualInitialPublicationInput): void {
    validateId(input.candidateId); validateId(input.publicationId); validateId(input.publicId);
    validateHash(authorization.bodyHash); validateHash(authorization.sessionDigest); validateHash(authorization.csrfDigest);
    assert(authorization.operationId === capability.operationId && authorization.actorRef.length > 0 && !authorization.actorRef.startsWith("system-"), "BILINGUAL_PUBLICATION_AUTHORIZATION_INVALID");
    assert(Number.isSafeInteger(input.expectedBundleRevision) && input.expectedBundleRevision >= 1, "BILINGUAL_PUBLICATION_REVISION_INVALID");
    this.validateBilingualProjectionArtifact(input.artifact);
  }

  private assertBilingualPublicationSourceAndSafety(sourceId: string, candidateId: string, sourceRevision: number, inputContentHash: string, at: string, requireClear: boolean): void {
    const source = parseRow(this.database.prepare(`SELECT registry.*,config.source_revision AS config_revision,control.source_config_epoch AS control_source_config_epoch,
      control.source_safety_epoch AS control_source_safety_epoch,control.authorization_version AS control_authorization_version,
      control.policy_epoch AS control_policy_epoch,control.recovery_epoch AS control_recovery_epoch
      FROM source_registry_v1 registry JOIN source_registry_rss_config_v1 config ON config.source_id=registry.source_id
      JOIN internal_control control ON control.singleton_id=1 WHERE registry.source_id=?`).get(sourceId));
    assert(Number(source.revision) >= 1 && HASH.test(String(source.identity_sha256)) && Number(source.config_revision) >= 1, "BILINGUAL_PUBLICATION_SOURCE_AUTHORITY_INVALID");
    for (const value of [source.source_config_epoch, source.source_safety_epoch, source.authorization_version, source.policy_epoch, source.recovery_epoch,
      source.control_source_config_epoch, source.control_source_safety_epoch, source.control_authorization_version, source.control_policy_epoch, source.control_recovery_epoch]) {
      assert(Number.isSafeInteger(Number(value)) && Number(value) >= 1, "BILINGUAL_PUBLICATION_SOURCE_AUTHORITY_INVALID");
    }
    if (requireClear) {
      assert(source.enabled === 1 && source.lifecycle_status === "active" && source.source_kind === "rss" && source.collection_mode === "rss"
        && source.normalization_status === "valid" && ["unique", "linked_existing"].includes(String(source.dedup_status))
        && source.adapter_status === "ready" && source.adapter_authorization_status === "valid" && source.platform_allowed === "allowed"
        && source.source_stop_status === "clear" && (source.authorization_expires_at === null || Date.parse(String(source.authorization_expires_at)) > Date.parse(at)),
      "BILINGUAL_PUBLICATION_SOURCE_AUTHORITY_INVALID");
      const safety = parseRow(this.database.prepare(`SELECT * FROM bilingual_lineage_effective_safety_v1
        WHERE candidate_id=? AND source_id=? AND source_revision=? AND input_content_hash=? AND action='clear'
          AND expires_at>? AND (source_authorization_expires_at IS NULL OR source_authorization_expires_at>?)`).get(candidateId, sourceId, sourceRevision, inputContentHash, at, at));
      assert(Number(safety.decision_seq) >= 1, "BILINGUAL_PUBLICATION_SAFETY_INVALID");
    } else {
      const latest = parseRow(this.database.prepare(`SELECT * FROM bilingual_lineage_safety_decision_v1
        WHERE candidate_id=? AND source_id=? AND source_revision=? AND input_content_hash=? ORDER BY decision_seq DESC LIMIT 1`).get(candidateId, sourceId, sourceRevision, inputContentHash));
      assert(Number(latest.decision_seq) >= 1, "BILINGUAL_WITHDRAWAL_SAFETY_BINDING_INVALID");
    }
  }

  private assertBilingualPublicationBindings(operationId: string, input: BilingualInitialPublicationInput, bundle: Record<string, unknown>, publicationVersion: number): void {
    const source = parseRow(this.database.prepare("SELECT revision,identity_sha256 FROM source_registry_v1 WHERE source_id=?").get(String(bundle.source_id)));
    const expected = [
      ["candidate", input.candidateId, "candidate_id", input.expectedBundleRevision, bundle.bundle_hash],
      ["source", bundle.source_id, "source_id", Number(source.revision), source.identity_sha256],
      ["publication", input.publicationId, "publication_id", publicationVersion, input.artifact.payloadHash],
      ["published_projection", input.publicId, "public_id", publicationVersion, input.artifact.payloadHash],
    ];
    for (const binding of expected) assert(this.database.prepare(`SELECT 1 FROM operation_entity_binding WHERE operation_id=? AND entity_kind=? AND entity_id=?
      AND identity_selector=? AND expected_entity_version IS ? AND expected_entity_hash=?`).get(...sqlValues([operationId, ...binding])) !== undefined, "BILINGUAL_PUBLICATION_ENTITY_BINDING_INVALID");
  }

  private assertBilingualWithdrawalBindings(operationId: string, input: BilingualWithdrawalInput, previous: Record<string, unknown>): void {
    const source = parseRow(this.database.prepare("SELECT revision,identity_sha256 FROM source_registry_v1 WHERE source_id=?").get(String(previous.source_id)));
    const expected = [
      ["publication", input.publicationId, "publication_id", input.expectedRevision, previous.payload_hash],
      ["published_projection", input.publicId, "public_id", input.expectedRevision, previous.payload_hash],
      ["candidate", previous.candidate_id, "bound_child", Number(previous.bundle_revision), previous.bundle_hash],
      ["source", previous.source_id, "bound_child", Number(source.revision), source.identity_sha256],
    ];
    for (const binding of expected) assert(this.database.prepare(`SELECT 1 FROM operation_entity_binding WHERE operation_id=? AND entity_kind=? AND entity_id=?
      AND identity_selector=? AND expected_entity_version IS ? AND expected_entity_hash=?`).get(...sqlValues([operationId, ...binding])) !== undefined, "BILINGUAL_WITHDRAWAL_ENTITY_BINDING_INVALID");
  }

  private completeBilingualManualOperation(capability: OperationCapability, permitId: string, actorRef: string, resultHash: string, at: string, payload: Record<string, unknown>): void {
    withSqliteAuthorizerContext(this.database, "response", () => {
      const consumed = this.database.prepare("UPDATE gateway_write_permit SET consumed_at=? WHERE permit_id=? AND consumed_at IS NULL").run(at, permitId).changes;
      assert(consumed === 1, "BILINGUAL_PUBLICATION_PERMIT_NOT_CONSUMED");
      this.postcheckFencesAt(capability.operationId, at);
      const changed = this.database.prepare("UPDATE internal_operation SET state='succeeded',version=version+1,result_hash=?,updated_at=? WHERE operation_id=? AND state='authorized'").run(resultHash, at, capability.operationId).changes;
      assert(changed === 1, "OPERATION_COMPLETE_CONFLICT");
      operationAuditEvent(this.database, capability.operationId, "write_permit_consumed", "gateway", { permitId }, at);
      operationAuditEvent(this.database, capability.operationId, "operation_succeeded", actorRef, payload, at);
    });
  }

  private tx<T>(method: GatewaySqlMethod, callback: () => T): T {
    if (this.atomicAdmissionDepth === 1) return withSqliteAuthorizerContext(this.database, method, callback);
    return withSqliteAuthorizerContext(this.database, method, () => withGuardedWriteTransaction(this.database, callback));
  }

  public request(handoff: OwnerSupervisorHandoff, input: GatewayOperationRequest): OperationCapability {
    validateOperationShape(input);
    assert(input.authorizationHandoffId === handoff.handoffId, "HANDOFF_ID_MISMATCH");
    validateOwnerSupervisorHandoff(handoff, 0);
    assert(handoff.ownerProcess === input.ownerProcess, "HANDOFF_OWNER_MISMATCH");
    validateHash(input.expected.schemaSha256); validateHash(input.expected.releaseSha256); validateHash(input.expected.manifestSha256); validateHash(input.expected.entityHash);
    validateHash(input.requestHash); validateHash(input.requestFingerprint); validateEntitySet(input.entitySet); validateFenceSet(input.requiredFenceSet);
    assert(input.expected.schemaSha256 === this.schemaSha256 && input.expected.releaseSha256 === this.releaseSha256 && input.expected.manifestSha256 === this.manifestSha256, "RELEASE_IDENTITY_MISMATCH");
    assert(handoff.releaseSha256 === this.releaseSha256 && handoff.manifestSha256 === this.manifestSha256, "HANDOFF_RELEASE_IDENTITY_MISMATCH");
    const handoffRow = parseRow(this.database.prepare("SELECT * FROM owner_authorization_handoff WHERE handoff_id=?").get(handoff.handoffId));
    for (const field of ["owner_process", "issuer", "one_time_nonce", "release_sha256", "manifest_sha256", "receipt_sha256", "verified_at", "expires_at"] as const) {
      assert(handoffRow[field] === handoff[field === "owner_process" ? "ownerProcess" : field === "issuer" ? "issuer" : field === "one_time_nonce" ? "oneTimeNonce" : field === "release_sha256" ? "releaseSha256" : field === "manifest_sha256" ? "manifestSha256" : field === "receipt_sha256" ? "receiptSha256" : field === "verified_at" ? "verifiedAt" : "expiresAt"], "HANDOFF_RECEIPT_MISMATCH");
    }
    const existing = this.database.prepare("SELECT operation_id,version,state,request_hash,owner_process,operation_kind FROM internal_operation WHERE idempotency_key=?").get(input.idempotencyKey) as Record<string, unknown> | undefined;
    if (existing) {
      assert(existing.request_hash === input.requestHash, "IDEMPOTENCY_CONFLICT");
      const secret = this.secrets.get(String(existing.operation_id));
      assert(secret !== undefined, "CAPABILITY_NOT_RESTORABLE");
      return Object.freeze({ operationId: String(existing.operation_id), version: valueInt(existing.version, "OPERATION_VERSION_INVALID"), ownerProcess: String(existing.owner_process) as OwnerProcess, operationKind: String(existing.operation_kind) as OperationKind, capabilitySecret: secret });
    }
    const createdAt = nowIso(this.clock);
    validateUtc(createdAt);
    assert(Date.parse(handoff.verifiedAt) <= Date.parse(createdAt) && Date.parse(handoff.expiresAt) > Date.parse(createdAt), "HANDOFF_TIME_WINDOW_INVALID");
    assertExactFenceTemplate(this.database, input);
    const entityJson = input.entitySet.map(bindingJson);
    const fenceJsonValues = input.requiredFenceSet.map(fenceJson);
    const entitySetHash = operationEntitySetHash(input.entitySet);
    const fenceSetHash = operationFenceSetHash(input.requiredFenceSet);
    const control = currentState(this.database);
    const budgetId = input.budgetRequest === null ? null : (input.budgetRequest.reservationId ?? input.budgetRequest.ledgerRef ?? null);
    const secret = nonce();
    this.tx("request", () => {
      this.database.prepare(`INSERT INTO internal_operation(operation_id,idempotency_key,operation_kind,owner_process,capability_class,policy_id,authorization_handoff_id,control_action,state,version,candidate_id,source_id,publication_id,public_id,phase,attempt,budget_reservation_id,egress_class,model_route_ref,expected_schema_sha256,expected_release_sha256,expected_manifest_sha256,source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch,source_stop_epoch,global_stop_state,emergency_stop_state,recovery_state,deletion_fence_state,publication_fence_state,request_hash,request_fingerprint,expected_control_version,expected_entity_version,expected_entity_hash,entity_set_json,entity_set_hash,required_fence_set_json,required_fence_set_hash,expected_writer_epoch,result_hash,reason_code,created_at,updated_at) VALUES(${Array.from({ length: 47 }, () => "?").join(",")})`)
        .run(...sqlValues([input.operationId, input.idempotencyKey, input.operationKind, input.ownerProcess, input.capabilityClass, input.policyId, handoff.handoffId, input.controlAction, "requested", 1,
          input.identity.candidateId, input.identity.sourceId, input.identity.publicationId, input.identity.publicId, input.phase, 0, budgetId, input.egressClass, input.modelRouteRef,
          input.expected.schemaSha256, input.expected.releaseSha256, input.expected.manifestSha256, input.expected.epochs.sourceConfig, input.expected.epochs.sourceSafety, input.expected.epochs.authorization, input.expected.epochs.policy, input.expected.epochs.recovery,
          input.expected.sourceStopEpoch, control.global_stop_state, control.emergency_stop_state, control.recovery_state, control.deletion_fence_state, control.publication_fence_state,
          input.requestHash, input.requestFingerprint, input.expected.controlVersion, input.expected.entityVersion, input.expected.entityHash, canonicalJsonV1(entityJson), entitySetHash, canonicalJsonV1(fenceJsonValues), fenceSetHash,
          input.expected.writerEpoch, null, null, createdAt, createdAt]));
      for (const binding of input.entitySet) this.database.prepare("INSERT INTO operation_entity_binding(operation_id,entity_kind,entity_id,identity_selector,expected_entity_version,expected_entity_hash,entity_set_hash) VALUES(?,?,?,?,?,?,?)").run(...sqlValues([input.operationId, binding.entityKind, binding.entityId, binding.identitySelector, binding.expectedVersion, binding.expectedHash, entitySetHash]));
      for (const binding of input.requiredFenceSet) this.database.prepare("INSERT INTO operation_fence_binding(operation_id,fence_receipt_id,scope_kind,scope_id,fence_kind,required_state,receipt_sha256,fence_set_hash,policy_epoch,recovery_epoch,writer_epoch,one_time_nonce,prechecked_at,consumed_at,postchecked_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,1)").run(...sqlValues([input.operationId, binding.fenceReceiptId, binding.scopeKind, binding.scopeId, binding.fenceKind, binding.requiredState, binding.receiptSha256, fenceSetHash, input.expected.epochs.policy, input.expected.epochs.recovery, input.expected.writerEpoch, nonce()]));
      if (input.xManualAuthority !== undefined) {
        const x = input.xManualAuthority;
        this.database.prepare("INSERT INTO x_manual_operation(operation_id,semantic_kind,submission_id,expected_revision,request_hash,created_at) VALUES(?,?,?,?,?,?)")
          .run(input.operationId, x.semanticKind, x.submissionId, x.expectedRevision, input.requestHash, createdAt);
        this.insertXManualAudit(input.operationId, "requested", input.requestHash, null, createdAt);
      }
      if (input.budgetRequest) this.database.prepare("INSERT INTO budget_reservation(reservation_id,operation_id,account_id,units,state,version,attempt_id,created_at,consumed_at) VALUES(?,?,?,?, 'reserved',1,NULL,?,NULL)").run(...sqlValues([budgetId, input.operationId, input.budgetRequest.accountId, input.budgetRequest.units, createdAt]));
      const consumed = this.database.prepare("UPDATE owner_authorization_handoff SET consumed_by_operation_id=? WHERE handoff_id=? AND consumed_by_operation_id IS NULL").run(input.operationId, handoff.handoffId).changes;
      assert(consumed === 1, "HANDOFF_CONSUME_FAILED");
      const auditOperation = input.xManualAuthority === undefined
        ? { operationKind: input.operationKind }
        : { operationKind: input.xManualAuthority.semanticKind, authorityCarrier: { operationKind: input.operationKind, controlAction: input.controlAction, policyId: input.policyId } };
      operationAuditEvent(this.database, input.operationId, "operation_requested", input.ownerProcess, { ...auditOperation, phase: input.phase, entitySetHash, requiredFenceSetHash: fenceSetHash }, createdAt);
    });
    if (input.xManualAuthority !== undefined) this.xManualOperations.add(input.operationId);
    this.secrets.set(input.operationId, secret);
    return Object.freeze({ operationId: input.operationId, version: 1, ownerProcess: input.ownerProcess, operationKind: input.operationKind, capabilitySecret: secret });
  }

  public authorize(capability: OperationCapability): OperationCapability {
    const secret = this.secrets.get(capability.operationId); assert(secret === capability.capabilitySecret, "CAPABILITY_INVALID");
    const updatedAt = nowIso(this.clock);
    this.tx("authorize", () => {
      const op = selectOperation(this.database, capability.operationId);
      assert(op.state === "requested" && valueInt(op.version, "OPERATION_VERSION_INVALID") === capability.version, "OPERATION_STATE_INVALID");
      this.precheckFencesInTransaction(capability.operationId, updatedAt);
      const entityDiagnostics = parseRow(this.database.prepare(`SELECT
        json_array_length(op.entity_set_json) AS json_count,
        (SELECT count(*) FROM operation_entity_binding b WHERE b.operation_id=op.operation_id) AS binding_count,
        (SELECT count(*) FROM operation_entity_binding b WHERE b.operation_id=op.operation_id AND b.identity_selector='source_id' AND b.entity_id=op.source_id) AS source_binding_count,
        (SELECT count(*) FROM operation_entity_binding b WHERE b.operation_id=op.operation_id AND b.identity_selector='candidate_id' AND b.entity_id=op.candidate_id) AS candidate_binding_count,
        (SELECT count(*) FROM source s WHERE s.source_id=op.source_id AND s.stop_epoch=op.source_stop_epoch AND s.enabled=1) AS source_count
        FROM internal_operation op WHERE op.operation_id=?`).get(capability.operationId));
      assert(Number(entityDiagnostics.json_count) === Number(entityDiagnostics.binding_count), "OPERATION_ENTITY_SET_COUNT_INVALID");
      if (op.source_id !== null) assert(Number(entityDiagnostics.source_binding_count) === 1, "OPERATION_SOURCE_BINDING_INVALID");
      if (op.candidate_id !== null) assert(Number(entityDiagnostics.candidate_binding_count) === 1, "OPERATION_CANDIDATE_BINDING_INVALID");
      if (op.source_id !== null) assert(Number(entityDiagnostics.source_count) === 1, "OPERATION_SOURCE_STATE_INVALID");
      const changed = this.database.prepare("UPDATE internal_operation SET state='authorized',version=version+1,updated_at=? WHERE operation_id=? AND state='requested' AND version=?").run(updatedAt, capability.operationId, capability.version).changes;
      assert(changed === 1, "OPERATION_AUTHORIZE_CONFLICT");
      operationAuditEvent(this.database, capability.operationId, "operation_authorized", capability.ownerProcess, {}, updatedAt);
      if (this.xManualOperations.has(capability.operationId)) {
        const requestHash = valueString(op.request_hash, "X_MANUAL_REQUEST_HASH_INVALID");
        this.insertXManualAudit(capability.operationId, "authorized", requestHash, requestHash, updatedAt);
      }
    });
    return Object.freeze({ ...capability, version: capability.version + 1 });
  }

  private insertXManualAudit(
    operationId: string,
    eventKind: "requested" | "authorized" | "submitted" | "retired" | "succeeded" | "blocked",
    payloadHash: string,
    previousEventHash: string | null,
    createdAt: string,
  ): void {
    const eventId = `xevt_${hash(`${operationId}\n${eventKind}\n${createdAt}\n${payloadHash}`).slice(0, 40)}`;
    this.database.prepare("INSERT INTO x_manual_audit(event_id,operation_id,event_kind,payload_hash,previous_event_hash,created_at) VALUES(?,?,?,?,?,?)")
      .run(eventId, operationId, eventKind, payloadHash, previousEventHash, createdAt);
  }

  /** Closed schema-8 X mutation. Only a capability created with the additive
   * xManualAuthority binding can reach this authorizer method. */
  public runXManualMutation(capability: OperationCapability, input: XManualGatewayMutation): number {
    assert(this.secrets.get(capability.operationId) === capability.capabilitySecret, "CAPABILITY_INVALID");
    assert(this.xManualOperations.has(capability.operationId), "X_MANUAL_AUTHORITY_REQUIRED");
    validateUtc(input.nowIso, "TIMESTAMP_INVALID");
    const operation = selectOperation(this.database, capability.operationId);
    assert(operation.state === "authorized" && valueInt(operation.version, "OPERATION_VERSION_INVALID") === capability.version, "OPERATION_STATE_INVALID");
    const mapping = parseRow(this.database.prepare("SELECT * FROM x_manual_operation WHERE operation_id=?").get(capability.operationId));
    assert(mapping.semantic_kind === input.semanticKind && mapping.submission_id === input.submissionId && valueInt(mapping.expected_revision, "X_MANUAL_REVISION_INVALID") === input.expectedRevision, "X_MANUAL_AUTHORITY_MISMATCH");
    const permitId = `xpermit_${hash(`${capability.operationId}\n${input.semanticKind}`).slice(0, 40)}`;
    let changes = 0;
    try {
      this.tx("x_manual", () => {
        this.database.prepare("INSERT INTO x_manual_write_permit(permit_id,operation_id,submission_id,mutation_kind,expected_revision,consumed_at,created_at) VALUES(?,?,?,?,?,NULL,?)")
          .run(permitId, capability.operationId, input.submissionId, input.semanticKind === "x_submit" ? "insert" : "retire", input.expectedRevision, input.nowIso);
        this.xManualFailureInjector?.("after_permit");
        if (input.semanticKind === "x_submit") {
          assert(typeof input.submittedUrl === "string" && typeof input.canonicalUrl === "string" && typeof input.statusId === "string" && typeof input.dedupeKey === "string" && typeof input.retentionExpiresAt === "string", "X_MANUAL_SUBMIT_SHAPE_INVALID");
          changes = Number(this.database.prepare(`INSERT INTO x_manual_submission
            (submission_id,revision,submitted_url,canonical_url,status_id,dedupe_key,state,source_id,oembed_attempt_id,candidate_id,retention_expires_at,external_calls,media_publication_eligible,submit_operation_id,retire_operation_id,created_at,updated_at)
            VALUES(?,0,?,?,?,?,'submitted',?,NULL,NULL,?,0,0,?,NULL,?,?)`)
            .run(input.submissionId, input.submittedUrl, input.canonicalUrl, input.statusId, input.dedupeKey, input.sourceId ?? null, input.retentionExpiresAt, capability.operationId, input.nowIso, input.nowIso).changes);
        } else {
          changes = Number(this.database.prepare("UPDATE x_manual_submission SET state='retired',revision=revision+1,retire_operation_id=?,updated_at=? WHERE submission_id=? AND revision=? AND state IN ('submitted','validated')")
            .run(capability.operationId, input.nowIso, input.submissionId, input.expectedRevision).changes);
        }
        assert(changes === 1, "X_MANUAL_MUTATION_CONFLICT");
        this.xManualFailureInjector?.("after_mutation");
        const consumed = this.database.prepare("UPDATE x_manual_write_permit SET consumed_at=? WHERE permit_id=? AND consumed_at IS NULL").run(input.nowIso, permitId).changes;
        assert(consumed === 1, "X_MANUAL_PERMIT_CONSUME_FAILED");
        this.xManualFailureInjector?.("after_permit_consumed");
        const domainEvent = input.semanticKind === "x_submit" ? "submitted" : "retired";
        const resultHash = domainHash("f1plus1-x-manual-result-v1", { operationId: capability.operationId, semanticKind: input.semanticKind, submissionId: input.submissionId, revision: input.expectedRevision + (input.semanticKind === "x_retire" ? 1 : 0) });
        this.insertXManualAudit(capability.operationId, domainEvent, resultHash, valueString(mapping.request_hash, "X_MANUAL_REQUEST_HASH_INVALID"), input.nowIso);
        this.insertXManualAudit(capability.operationId, "succeeded", resultHash, resultHash, input.nowIso);
        this.postcheckFencesAt(capability.operationId, input.nowIso);
        const updated = this.database.prepare("UPDATE internal_operation SET state='succeeded',version=version+1,result_hash=?,updated_at=? WHERE operation_id=? AND state='authorized'").run(resultHash, input.nowIso, capability.operationId).changes;
        assert(updated === 1, "OPERATION_COMPLETE_CONFLICT");
        operationAuditEvent(this.database, capability.operationId, "write_permit_consumed", "gateway", { entityKind: "x_manual_submission", entityId: input.submissionId, mutationKind: input.semanticKind === "x_submit" ? "insert" : "retire", domainEvent }, input.nowIso);
        operationAuditEvent(this.database, capability.operationId, "operation_succeeded", capability.ownerProcess, { resultHash, domainEvent, semanticKind: input.semanticKind }, input.nowIso);
      });
    } catch (error) {
      this.cancelXManualOperation(capability.operationId, "X_MANUAL_MUTATION_ROLLED_BACK", input.nowIso, error);
      throw error;
    }
    return changes;
  }

  public cancelStaleXManualOperation(operationId: string, now: string): void {
    validateId(operationId);
    validateUtc(now, "TIMESTAMP_INVALID");
    this.cancelXManualOperation(operationId, "X_MANUAL_STALE_OPERATION_RECOVERED", now);
  }

  private cancelXManualOperation(operationId: string, reasonCode: string, at: string, error?: unknown): void {
    const mapping = parseRow(this.database.prepare("SELECT semantic_kind,submission_id,request_hash FROM x_manual_operation WHERE operation_id=?").get(operationId));
    const semanticKind = valueString(mapping.semantic_kind, "X_MANUAL_SEMANTIC_KIND_INVALID");
    const failureHash = domainHash("f1plus1-x-manual-failure-v1", { operationId, semanticKind, submissionId: mapping.submission_id, reasonCode });
    this.tx("x_manual", () => {
      const operation = selectOperation(this.database, operationId);
      assert(operation.owner_process === "admin_http" && operation.operation_kind === "phase_control" && operation.control_action === "fence_update", "X_MANUAL_AUTHORITY_INVALID");
      assert(operation.state === "requested" || operation.state === "authorized", "X_MANUAL_RECOVERY_STATE_INVALID");
      this.insertXManualAudit(operationId, "blocked", failureHash, valueString(mapping.request_hash, "X_MANUAL_REQUEST_HASH_INVALID"), at);
      const changed = this.database.prepare("UPDATE internal_operation SET state='cancelled',version=version+1,result_hash=?,reason_code=?,updated_at=? WHERE operation_id=? AND state IN ('requested','authorized')")
        .run(failureHash, reasonCode, at, operationId).changes;
      assert(changed === 1, "X_MANUAL_RECOVERY_CONFLICT");
      operationAuditEvent(this.database, operationId, "operation_cancelled", "gateway", { semanticKind, reasonCode, rollbackComplete: true, errorClass: error instanceof Error ? error.name : "unknown" }, at);
    });
    this.xManualOperations.delete(operationId);
    this.secrets.delete(operationId);
  }

  /**
   * Consume the exact policy-derived fence set at request time.  The frozen
   * API exposes this as a separate gate so callers can make the precheck
   * receipt explicit; `authorize` invokes the same transaction-local helper
   * when the caller uses the compact request→authorize path.
   */
  public precheckAndConsumeFenceSet(operationId: string, expectedOperationVersion: number): FencePrecheckReceipt {
    validateId(operationId);
    assert(this.secrets.has(operationId), "CAPABILITY_INVALID");
    const consumedAt = nowIso(this.clock);
    let receipt: FencePrecheckReceipt | undefined;
    this.tx("authorize", () => {
      const op = selectOperation(this.database, operationId);
      assert(op.state === "requested" && valueInt(op.version, "OPERATION_VERSION_INVALID") === expectedOperationVersion, "OPERATION_STATE_INVALID");
      const count = this.precheckFencesInTransaction(operationId, consumedAt);
      receipt = Object.freeze({ operationId, operationVersion: expectedOperationVersion, fenceSetHash: valueString(op.required_fence_set_hash, "FENCE_SET_HASH_INVALID"), consumedAt, count });
    });
    assert(receipt !== undefined, "FENCE_PRECHECK_MISSING");
    return receipt;
  }

  private precheckFencesInTransaction(operationId: string, at: string): number {
    const rows = this.database.prepare(
      "SELECT f.fence_receipt_id,f.prechecked_at,f.consumed_at,f.postchecked_at,r.state,r.receipt_sha256,r.policy_epoch,r.recovery_epoch,r.writer_epoch,r.expires_at FROM operation_fence_binding f JOIN generic_fence_receipt r ON r.fence_receipt_id=f.fence_receipt_id WHERE f.operation_id=? ORDER BY f.fence_receipt_id"
    ).all(operationId) as Array<Record<string, unknown>>;
    for (const row of rows) {
      validateHash(valueString(row.receipt_sha256, "FENCE_RECEIPT_HASH_INVALID"));
      assert(row.state !== "unknown", "OPERATION_FENCE_REREAD_INVALID");
      assert(Number(row.policy_epoch) >= 1 && Number(row.recovery_epoch) >= 1 && Number(row.writer_epoch) >= 1, "OPERATION_FENCE_EPOCH_INVALID");
      assert(typeof row.expires_at === "string" && Date.parse(row.expires_at) > Date.parse(at), "OPERATION_FENCE_REREAD_INVALID");
      if (row.prechecked_at === null) {
        const changed = this.database.prepare("UPDATE operation_fence_binding SET prechecked_at=?,consumed_at=?,version=version+1 WHERE operation_id=? AND fence_receipt_id=? AND prechecked_at IS NULL").run(...sqlValues([at, at, operationId, row.fence_receipt_id])).changes;
        assert(changed === 1, "OPERATION_FENCE_PRECHECK_CONFLICT");
      } else {
        assert(row.consumed_at === row.prechecked_at && row.postchecked_at === null, "OPERATION_FENCE_PRECHECK_CONFLICT");
      }
    }
    return rows.length;
  }

  public authorizeWrite(capability: OperationCapability, input: Readonly<{ entityKind: EntityKind; entityId: string; mutationKind: MutationKind; expectedVersion: number | null; expectedHash: string }>): WritePermit {
    const secret = this.secrets.get(capability.operationId); assert(secret === capability.capabilitySecret, "CAPABILITY_INVALID");
    assert(ENTITY_KINDS.has(input.entityKind), "ENTITY_KIND_INVALID"); assert(MUTATION_KINDS.has(input.mutationKind), "MUTATION_KIND_INVALID"); validateId(input.entityId); validateHash(input.expectedHash);
    assert(input.expectedVersion === null || Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 0, "ENTITY_VERSION_INVALID");
    const permitId = `permit-${nonce()}`; const createdAt = nowIso(this.clock);
    this.tx("authorize_write", () => {
      this.insertWritePermitInTransaction(capability, input, permitId, createdAt);
    });
    return Object.freeze({ permitId, operationId: capability.operationId, entityKind: input.entityKind, entityId: input.entityId, mutationKind: input.mutationKind, expectedVersion: input.expectedVersion, expectedHash: input.expectedHash, capabilitySecret: secret });
  }

  private insertWritePermitInTransaction(
    capability: OperationCapability,
    input: Readonly<{ entityKind: EntityKind; entityId: string; mutationKind: MutationKind; expectedVersion: number | null; expectedHash: string }>,
    permitId: string,
    createdAt: string
  ): WritePermit {
    const secret = this.secrets.get(capability.operationId);
    assert(secret === capability.capabilitySecret, "CAPABILITY_INVALID");
    assert(ENTITY_KINDS.has(input.entityKind), "ENTITY_KIND_INVALID");
    assert(MUTATION_KINDS.has(input.mutationKind), "MUTATION_KIND_INVALID");
    validateId(input.entityId);
    validateHash(input.expectedHash);
    assert(input.expectedVersion === null || Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 0, "ENTITY_VERSION_INVALID");
    const op = selectOperation(this.database, capability.operationId);
    assert(op.state === "authorized" && valueInt(op.version, "OPERATION_VERSION_INVALID") === capability.version, "OPERATION_STATE_INVALID");
    const declared = this.database.prepare(
      "SELECT expected_entity_version,expected_entity_hash FROM operation_entity_binding WHERE operation_id=? AND entity_kind=? AND entity_id=?",
    ).get(capability.operationId, input.entityKind, input.entityId) as Record<string, unknown> | undefined;
    assert(declared !== undefined, "MUTATION_ENTITY_NOT_DECLARED");
    assert(
      declared.expected_entity_version === input.expectedVersion &&
        declared.expected_entity_hash === input.expectedHash,
      "MUTATION_ENTITY_EXPECTATION_MISMATCH",
    );
    this.database.prepare("INSERT INTO gateway_write_permit(permit_id,operation_id,entity_kind,entity_id,mutation_kind,expected_entity_version,expected_entity_hash,consumed_at,created_at) VALUES(?,?,?,?,?,?,?,NULL,?)").run(permitId, capability.operationId, input.entityKind, input.entityId, input.mutationKind, input.expectedVersion, input.expectedHash, createdAt);
    return Object.freeze({ permitId, operationId: capability.operationId, entityKind: input.entityKind, entityId: input.entityId, mutationKind: input.mutationKind, expectedVersion: input.expectedVersion, expectedHash: input.expectedHash, capabilitySecret: secret });
  }

  private assertClosedMutation(permit: WritePermit, mutation: ClosedMutation): void {
    assert(mutation.entityKind === permit.entityKind && mutation.entityId === permit.entityId && mutation.mutationKind === permit.mutationKind, "PERMIT_ENTITY_MISMATCH");
    const tableMatch = /^(INSERT(?:\s+OR\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s|$)/i.exec(mutation.statement.trim());
    assert(tableMatch?.[1] !== undefined, "MUTATION_STATEMENT_NOT_CLOSED");
    assert(!mutation.statement.includes(";"), "MUTATION_STATEMENT_NOT_CLOSED");
    const tableName = tableMatch?.[2]?.toLowerCase();
    const expectedTable: Readonly<Record<EntityKind, string>> = {
      source: "source", ingest_run: "ingest_run", candidate: "pending_review_candidate", rss_media: "rss_media_candidate",
      machine_draft: "machine_summary_draft", review_bundle: "review_bundle", review_decision: "review_decision",
      publication: "publication", published_projection: "published_projection", projection_outbox: "projection_outbox",
      projection_receipt: "projection_delivery_receipt", legacy_admin_operation: "admin_operation", legacy_audit: "audit_event",
      internal_control: "internal_control", telemetry_receipt: "internal_operation_outbox", generic_fence: "generic_fence_receipt",
      backup: "backup_recovery_point", projection_pointer: "projection_recovery_anchor"
    };
    assert(tableName === expectedTable[permit.entityKind], "MUTATION_TABLE_MISMATCH");
    const verb = tableMatch?.[1]?.toUpperCase() ?? "";
    // 0007 projection_recovery_anchor_insert_guard allows the first singleton
    // row as INSERT under an activate permit (entity_id='active'). UPDATE is
    // the subsequent version-bump path. The closed-mutation verb must match
    // that pair; it must not invent an insert mutation kind the policy lacks.
    const activateInsert = permit.mutationKind === "activate" && verb.endsWith("INTO") && tableName === "projection_recovery_anchor";
    assert((permit.mutationKind === "insert" && verb.endsWith("INTO")) ||
      (permit.mutationKind === "update" && verb === "UPDATE") ||
      (permit.mutationKind === "delete" && verb === "DELETE FROM") ||
      (permit.mutationKind === "activate" && (verb === "UPDATE" || activateInsert)) ||
      (permit.mutationKind === "consume" && verb === "UPDATE"), "MUTATION_KIND_MISMATCH");
  }

  private consumeWritePermitInTransaction(permit: WritePermit, updatedAt: string): void {
    const consumed = this.database.prepare("UPDATE gateway_write_permit SET consumed_at=? WHERE permit_id=? AND consumed_at IS NULL").run(updatedAt, permit.permitId).changes;
    assert(consumed === 1, "PERMIT_CONSUME_FAILED");
    operationAuditEvent(this.database, permit.operationId, "write_permit_consumed", "gateway", { entityKind: permit.entityKind, entityId: permit.entityId, mutationKind: permit.mutationKind }, updatedAt);
  }

  private mutatePermitInTransaction(permit: WritePermit, mutation: ClosedMutation, method: GatewaySqlMethod): number {
    assert(permit.capabilitySecret === this.secrets.get(permit.operationId), "PERMIT_INVALID");
    this.assertClosedMutation(permit, mutation);
    const persistedPermit = parseRow(this.database.prepare("SELECT * FROM gateway_write_permit WHERE permit_id=?").get(permit.permitId));
    assert(persistedPermit.operation_id === permit.operationId && persistedPermit.entity_kind === permit.entityKind && persistedPermit.entity_id === permit.entityId && persistedPermit.mutation_kind === permit.mutationKind, "PERMIT_INVALID");
    assert(persistedPermit.expected_entity_version === permit.expectedVersion && persistedPermit.expected_entity_hash === permit.expectedHash && persistedPermit.consumed_at === null, "PERMIT_INVALID");
    const rowCount = withSqliteAuthorizerContext(this.database, method, () => this.database.prepare(mutation.statement).run(...sqlValues(mutation.parameters ?? [])).changes);
    assert(rowCount === 1 || (rowCount === 0 && /^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(mutation.statement.trim())), "MUTATION_ROW_COUNT_INVALID");
    const updatedAt = nowIso(this.clock);
    this.consumeWritePermitInTransaction(permit, updatedAt);
    return Number(rowCount);
  }

  /**
   * Execute a repository transaction under one authorized operation.  The
   * callback receives a permit-producing writer; it cannot obtain a database
   * handle and therefore cannot silently introduce a second writer path.
   */
  public runMutationTransaction<T>(
    capability: OperationCapability,
    callback: (mutate: (input: GatewayWriteInput) => number) => T
  ): T {
    assert(this.secrets.get(capability.operationId) === capability.capabilitySecret, "CAPABILITY_INVALID");
    const operation = selectOperation(this.database, capability.operationId);
    assert(operation.state === "authorized" && valueInt(operation.version, "OPERATION_VERSION_INVALID") === capability.version, "OPERATION_STATE_INVALID");
    const method = mapAuthorizerMethod(String(operation.operation_kind) as OperationKind, String(operation.owner_process) as OwnerProcess);
    let result!: T;
    this.tx(method, () => {
      const mutate = (input: GatewayWriteInput): number => {
        const permitId = `permit-${nonce()}`;
        const createdAt = nowIso(this.clock);
        const permit = withSqliteAuthorizerContext(this.database, "authorize_write", () =>
          this.insertWritePermitInTransaction(capability, input, permitId, createdAt));
        return this.mutatePermitInTransaction(permit, input, method);
      };
      result = callback(mutate);
      const at = nowIso(this.clock);
      withSqliteAuthorizerContext(this.database, "response", () => {
        this.postcheckFencesAt(capability.operationId, at);
        const resultHash = domainHash("f1plus1-operation-result-v1", { operationId: capability.operationId, at });
        const changed = this.database.prepare("UPDATE internal_operation SET state='succeeded',version=version+1,result_hash=?,updated_at=? WHERE operation_id=? AND state='authorized'").run(resultHash, at, capability.operationId).changes;
        assert(changed === 1, "OPERATION_COMPLETE_CONFLICT");
        operationAuditEvent(this.database, capability.operationId, "operation_succeeded", capability.ownerProcess, { resultHash }, at);
      });
    });
    return result;
  }

  public mutate<T>(permit: WritePermit, mutation: ClosedMutation, callback?: (database: DatabaseSync) => T): T | undefined {
    assert(permit.capabilitySecret === this.secrets.get(permit.operationId), "PERMIT_INVALID");
    assert(mutation.entityKind === permit.entityKind && mutation.entityId === permit.entityId && mutation.mutationKind === permit.mutationKind, "PERMIT_ENTITY_MISMATCH");
    const operation = selectOperation(this.database, permit.operationId);
    const method = mapAuthorizerMethod(String(operation.operation_kind) as OperationKind, String(operation.owner_process) as OwnerProcess);
    let result: T | undefined;
    this.tx(method, () => {
      const persistedPermit = parseRow(this.database.prepare("SELECT * FROM gateway_write_permit WHERE permit_id=?").get(permit.permitId));
      assert(persistedPermit.operation_id === permit.operationId && persistedPermit.entity_kind === permit.entityKind && persistedPermit.entity_id === permit.entityId && persistedPermit.mutation_kind === permit.mutationKind, "PERMIT_INVALID");
      assert(persistedPermit.expected_entity_version === permit.expectedVersion && persistedPermit.expected_entity_hash === permit.expectedHash && persistedPermit.consumed_at === null, "PERMIT_INVALID");
      this.assertClosedMutation(permit, mutation);
      const rowCount = this.database.prepare(mutation.statement).run(...sqlValues(mutation.parameters ?? [])).changes;
      assert(rowCount === 1 || (rowCount === 0 && /^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(mutation.statement.trim())), "MUTATION_ROW_COUNT_INVALID");
      if (callback) result = withSqliteAuthorizerContext(this.database, "read_only", () => callback(this.database));
      const updatedAt = nowIso(this.clock);
      const consumed = this.database.prepare("UPDATE gateway_write_permit SET consumed_at=? WHERE permit_id=? AND consumed_at IS NULL").run(updatedAt, permit.permitId).changes;
      assert(consumed === 1, "PERMIT_CONSUME_FAILED");
      operationAuditEvent(this.database, permit.operationId, "write_permit_consumed", "gateway", { entityKind: permit.entityKind, entityId: permit.entityId, mutationKind: permit.mutationKind }, updatedAt);
    });
    return result;
  }

  public postcheckFenceSet(capability: OperationCapability): void {
    assert(this.secrets.get(capability.operationId) === capability.capabilitySecret, "CAPABILITY_INVALID");
    const at = nowIso(this.clock);
    this.tx("response", () => {
      const op = selectOperation(this.database, capability.operationId);
      const rows = this.database.prepare("SELECT fence_receipt_id FROM operation_fence_binding WHERE operation_id=? AND postchecked_at IS NULL").all(capability.operationId) as Array<Record<string, unknown>>;
      for (const row of rows) this.database.prepare("UPDATE operation_fence_binding SET postchecked_at=?,version=version+1 WHERE operation_id=? AND fence_receipt_id=?").run(...sqlValues([at, capability.operationId, row.fence_receipt_id]));
      assert(op.state === "authorized", "OPERATION_STATE_INVALID");
      const resultHash = domainHash("f1plus1-operation-result-v1", { operationId: capability.operationId, at });
      this.database.prepare("UPDATE internal_operation SET state='succeeded',version=version+1,result_hash=?,updated_at=? WHERE operation_id=? AND state='authorized'").run(resultHash, at, capability.operationId);
      operationAuditEvent(this.database, capability.operationId, "operation_succeeded", capability.ownerProcess, { resultHash }, at);
    });
  }

  public commitAttemptIntent(capability: OperationCapability, request: ClosedExternalRequest): CommittedAttemptHandle {
    assert(this.secrets.get(capability.operationId) === capability.capabilitySecret, "CAPABILITY_INVALID");
    validateClosedExternalRequest(request); assert(request.attemptIdentity.operationId === capability.operationId, "ATTEMPT_OPERATION_MISMATCH");
    const canonicalRequestSha256 = canonicalExternalRequestHash(request); const requestFingerprintSha256 = requestFingerprintHash(request); const reconcileIdentitySha256 = reconcileIdentityHash(request);
    const attemptId = `attempt-${nonce()}`; const committedAt = nowIso(this.clock);
    this.tx("commit_attempt", () => {
      const op = selectOperation(this.database, capability.operationId); assert(op.state === "authorized" && valueInt(op.version, "OPERATION_VERSION_INVALID") === capability.version, "OPERATION_STATE_INVALID");
      assert(String(op.request_hash) === requestFingerprintSha256 || String(op.request_hash) === canonicalRequestSha256, "ATTEMPT_REQUEST_HASH_MISMATCH");
      const changed = this.database.prepare("UPDATE internal_operation SET state='attempt_committed',version=version+1,attempt=?,updated_at=? WHERE operation_id=? AND state='authorized' AND version=?").run(request.attemptIdentity.attemptNumber, committedAt, capability.operationId, capability.version).changes;
      assert(changed === 1, "ATTEMPT_COMMIT_CONFLICT");
      this.database.prepare("INSERT INTO internal_external_attempt(attempt_id,operation_id,attempt_number,attempt_nonce,state,route_id,endpoint_class,external_idempotency_key,reconcile_key,provider_resource_identity,canonical_request_json,canonical_request_hash,request_fingerprint,reconcile_identity_sha256,response_identity_sha256,response_hash,external_calls, outcome,started_at,committed_at,reason_code,reconcile_consumed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,0,'pending',NULL,?,NULL,NULL)").run(attemptId, capability.operationId, request.attemptIdentity.attemptNumber, request.attemptIdentity.attemptNonce, "intent_committed", request.routeId, request.endpointClass, request.externalIdempotencyKey, request.reconcileKey, request.providerResource, canonicalJsonV1(request), canonicalRequestSha256, requestFingerprintSha256, reconcileIdentitySha256, committedAt);
      operationAuditEvent(this.database, capability.operationId, "attempt_intent_committed", capability.ownerProcess, { attemptId, canonicalRequestSha256, requestFingerprintSha256, reconcileIdentitySha256 }, committedAt);
    });
    const handle = Object.freeze({ attemptId, operationId: capability.operationId, attemptNumber: request.attemptIdentity.attemptNumber, attemptNonce: request.attemptIdentity.attemptNonce, canonicalRequestSha256, requestFingerprintSha256, reconcileIdentitySha256, capabilitySecret: capability.capabilitySecret });
    return handle;
  }

  public markAttemptStarted(handle: CommittedAttemptHandle): StartedAttemptHandle {
    assert(this.secrets.get(handle.operationId) === handle.capabilitySecret, "ATTEMPT_HANDLE_INVALID"); const startedAt = nowIso(this.clock);
    this.tx("response", () => {
      const op = selectOperation(this.database, handle.operationId); assert(op.state === "attempt_committed", "ATTEMPT_STATE_INVALID");
      const operationChanged = this.database.prepare("UPDATE internal_operation SET state='in_flight',version=version+1,updated_at=? WHERE operation_id=? AND state='attempt_committed'").run(startedAt, handle.operationId).changes;
      assert(operationChanged === 1, "ATTEMPT_START_CONFLICT");
      const attemptChanged = this.database.prepare("UPDATE internal_external_attempt SET state='started',external_calls=1,started_at=? WHERE attempt_id=? AND state='intent_committed'").run(startedAt, handle.attemptId).changes;
      assert(attemptChanged === 1, "ATTEMPT_START_CONFLICT");
      operationAuditEvent(this.database, handle.operationId, "attempt_started", "gateway", { attemptId: handle.attemptId }, startedAt);
    });
    return Object.freeze({ ...handle, startedAt });
  }

  public commitKnownResponse(handle: StartedAttemptHandle, response: ClosedExternalResponse): void {
    this.commitKnownResponseWithBilingualMaterialization(handle, response, () => undefined);
  }

  /**
   * Commits a known external response and its schema-9 bilingual material in
   * one transaction. The callback runs under the bilingual-only authorizer;
   * it cannot mutate generic operations, attempts, budgets or other domains.
   */
  public commitKnownResponseWithBilingualMaterialization<T>(
    handle: StartedAttemptHandle,
    response: ClosedExternalResponse,
    materialize: (state: BilingualKnownResponseMaterialization) => T,
  ): T {
    assert(this.secrets.get(handle.operationId) === handle.capabilitySecret, "ATTEMPT_HANDLE_INVALID"); validateClosedExternalResponse(response);
    const responseHash = responseIdentityHash(handle, response); const at = nowIso(this.clock);
    let result!: T;
    this.tx("response", () => {
      const row = parseRow(this.database.prepare("SELECT * FROM internal_external_attempt WHERE attempt_id=?").get(handle.attemptId)); assert(row.state === "started", "ATTEMPT_STATE_INVALID");
      const op = selectOperation(this.database, handle.operationId); assert(op.state === "in_flight", "OPERATION_STATE_INVALID");
      const reservation = op.budget_reservation_id; if (reservation) this.database.prepare("UPDATE budget_reservation SET state=?,version=version+1,consumed_at=? WHERE reservation_id=? AND state='reserved'").run(...sqlValues([response.outcome === "succeeded" ? "consumed" : "released", response.outcome === "succeeded" ? at : null, reservation]));
      const attemptChanged = this.database.prepare("UPDATE internal_external_attempt SET state='response_committed',outcome=?,response_hash=?,response_identity_sha256=?,reason_code=? WHERE attempt_id=? AND state='started'").run(response.outcome, responseHash, responseHash, response.reasonCode, handle.attemptId).changes;
      assert(attemptChanged === 1, "ATTEMPT_RESPONSE_CONFLICT");
      this.postcheckFencesAt(handle.operationId, at);
      const resultHash = domainHash("f1plus1-operation-result-v1", { attemptId: handle.attemptId, responseHash });
      const terminalState = response.outcome === "succeeded" ? "succeeded" : "terminal_failed";
      const operationChanged = this.database.prepare("UPDATE internal_operation SET state=?,version=version+1,result_hash=?,updated_at=? WHERE operation_id=? AND state='in_flight'").run(...sqlValues([terminalState, resultHash, at, handle.operationId])).changes;
      assert(operationChanged === 1, "ATTEMPT_RESPONSE_CONFLICT");
      operationAuditEvent(this.database, handle.operationId, "attempt_response_committed", "gateway", { attemptId: handle.attemptId, responseHash }, at);
      operationAuditEvent(this.database, handle.operationId, terminalState === "succeeded" ? "operation_succeeded" : "operation_terminal_failed", "gateway", { resultHash }, at);
      result = withSqliteAuthorizerContext(this.database, "bilingual", () => materialize(Object.freeze({
        attemptId: handle.attemptId,
        operationId: handle.operationId,
        attemptNumber: handle.attemptNumber,
        attemptState: "response_committed",
        operationState: terminalState,
        responseIdentitySha256: responseHash,
        materializedAt: at,
      })));
    });
    return result;
  }

  public markUnknown(handle: StartedAttemptHandle): ReconcileRequiredHandle {
    return this.markUnknownWithBilingualMaterialization(handle, () => undefined);
  }

  /** Atomically records an unknown result and the matching bilingual receipt/slot state. */
  public markUnknownWithBilingualMaterialization<T>(
    handle: StartedAttemptHandle,
    materialize: (state: BilingualUnknownMaterialization) => T,
  ): ReconcileRequiredHandle {
    assert(this.secrets.get(handle.operationId) === handle.capabilitySecret, "ATTEMPT_HANDLE_INVALID"); const at = nowIso(this.clock);
    this.tx("response", () => {
      const op = selectOperation(this.database, handle.operationId); assert(op.state === "in_flight", "OPERATION_STATE_INVALID");
      const operationChanged = this.database.prepare("UPDATE internal_operation SET state='reconcile_required',version=version+1,reason_code='EXTERNAL_UNKNOWN',updated_at=? WHERE operation_id=? AND state='in_flight'").run(at, handle.operationId).changes;
      assert(operationChanged === 1, "ATTEMPT_UNKNOWN_CONFLICT");
      if (op.budget_reservation_id) this.database.prepare("UPDATE budget_reservation SET state='reconcile_required',version=version+1 WHERE reservation_id=? AND state='reserved'").run(sqlValues([op.budget_reservation_id])[0]);
      const attemptChanged = this.database.prepare("UPDATE internal_external_attempt SET state='reconcile_required',outcome='unknown',reason_code='EXTERNAL_UNKNOWN' WHERE attempt_id=? AND state='started'").run(handle.attemptId).changes;
      assert(attemptChanged === 1, "ATTEMPT_UNKNOWN_CONFLICT");
      operationAuditEvent(this.database, handle.operationId, "operation_reconcile_required", "gateway", { attemptId: handle.attemptId }, at);
      withSqliteAuthorizerContext(this.database, "bilingual", () => materialize(Object.freeze({
        attemptId: handle.attemptId,
        operationId: handle.operationId,
        attemptNumber: handle.attemptNumber,
        attemptState: "reconcile_required",
        operationState: "reconcile_required",
        materializedAt: at,
      })));
    });
    return Object.freeze({ ...handle, reconcileAfter: at });
  }

  public consumeOneTimeReconcile(handle: ReconcileRequiredHandle, receipt: Readonly<{ reconcileIdentitySha256: string; outcome: "succeeded" | "known_failed"; response?: ClosedExternalResponse }>): void {
    assert(this.secrets.get(handle.operationId) === handle.capabilitySecret, "ATTEMPT_HANDLE_INVALID"); assert(receipt.reconcileIdentitySha256 === handle.reconcileIdentitySha256, "RECONCILE_IDENTITY_MISMATCH"); const at = nowIso(this.clock);
    this.tx("reconcile", () => {
      const row = parseRow(this.database.prepare("SELECT * FROM internal_external_attempt WHERE attempt_id=?").get(handle.attemptId)); assert(row.state === "reconcile_required" && row.reconcile_consumed_at === null, "RECONCILE_ALREADY_CONSUMED");
      const op = selectOperation(this.database, handle.operationId); assert(op.state === "reconcile_required", "OPERATION_STATE_INVALID");
      const response = receipt.response;
      if (receipt.outcome === "succeeded") assert(response !== undefined, "RECONCILE_RESPONSE_REQUIRED");
      if (response) validateClosedExternalResponse(response);
      if (response) assert(response.outcome === receipt.outcome, "RECONCILE_OUTCOME_MISMATCH");
      const responseHash = response ? responseIdentityHash(handle, response) : null;
      if (op.budget_reservation_id) this.database.prepare("UPDATE budget_reservation SET state=?,version=version+1,consumed_at=? WHERE reservation_id=? AND state='reconcile_required'").run(...sqlValues([receipt.outcome === "succeeded" ? "consumed" : "released", receipt.outcome === "succeeded" ? at : null, op.budget_reservation_id]));
      const attemptChanged = this.database.prepare("UPDATE internal_external_attempt SET state=?,outcome=?,response_hash=?,response_identity_sha256=?,reconcile_consumed_at=?,reason_code=? WHERE attempt_id=? AND state='reconcile_required'").run(receipt.outcome === "succeeded" ? "response_committed" : "terminal_failed", receipt.outcome, responseHash, responseHash, at, response?.reasonCode ?? "RECONCILE_KNOWN_FAILED", handle.attemptId).changes;
      assert(attemptChanged === 1, "RECONCILE_CONSUME_CONFLICT");
      const resultHash = domainHash("f1plus1-operation-result-v1", { attemptId: handle.attemptId, responseHash, reconcileIdentitySha256: handle.reconcileIdentitySha256 });
      const operationChanged = this.database.prepare("UPDATE internal_operation SET state=?,version=version+1,result_hash=?,updated_at=? WHERE operation_id=? AND state='reconcile_required'").run(receipt.outcome === "succeeded" ? "succeeded" : "terminal_failed", resultHash, at, handle.operationId).changes;
      assert(operationChanged === 1, "RECONCILE_CONSUME_CONFLICT");
      operationAuditEvent(this.database, handle.operationId, receipt.outcome === "succeeded" ? "operation_succeeded" : "operation_terminal_failed", "reconciler", { attemptId: handle.attemptId, resultHash }, at);
    });
  }

  private postcheckFencesAt(operationId: string, at: string): void {
    const rows = this.database.prepare("SELECT fence_receipt_id FROM operation_fence_binding WHERE operation_id=? AND postchecked_at IS NULL").all(operationId) as Array<Record<string, unknown>>;
    for (const row of rows) this.database.prepare("UPDATE operation_fence_binding SET postchecked_at=?,version=version+1 WHERE operation_id=? AND fence_receipt_id=?").run(...sqlValues([at, operationId, row.fence_receipt_id]));
  }

  /**
   * The only supported external I/O adapter.  The intent and started markers
   * are durable before `port.execute` is entered; a lost/invalid response is
   * reconciled against the same attempt and never retried as a new request.
   */
  public async executeExternal(
    handle: CommittedAttemptHandle,
    port: EgressPort,
    onUnknown?: (handle: ReconcileRequiredHandle) => void,
  ): Promise<ClosedExternalResponse> {
    assert(this.secrets.get(handle.operationId) === handle.capabilitySecret, "ATTEMPT_HANDLE_INVALID");
    const operation = selectOperation(this.database, handle.operationId);
    const egress = String(operation.egress_class) as EgressClass;
    const { assertPhaseAllowsExternal, readPhaseSnapshot } = await import("./phase.ts");
    assertPhaseAllowsExternal(readPhaseSnapshot(this.database), egress);
    const started = this.markAttemptStarted(handle);
    try {
      const response = await port.execute(started);
      this.commitKnownResponse(started, response);
      return response;
    } catch (error) {
      const row = this.database.prepare("SELECT state FROM internal_operation WHERE operation_id=?").get(handle.operationId) as Record<string, unknown> | undefined;
      if (row?.state === "in_flight") onUnknown?.(this.markUnknown(started));
      throw error;
    }
  }

  /**
   * Reconcile the already-started attempt after response loss.  This path
   * performs no new attempt-intent or attempt counter increment: the adapter
   * receives the original handle and the one-time receipt is consumed against
   * that same durable attempt.
   */
  public async executeReconcileExternal(
    handle: ReconcileRequiredHandle,
    port: EgressPort,
  ): Promise<ClosedExternalResponse> {
    assert(this.secrets.get(handle.operationId) === handle.capabilitySecret, "ATTEMPT_HANDLE_INVALID");
    const operation = selectOperation(this.database, handle.operationId);
    assert(operation.state === "reconcile_required", "OPERATION_STATE_INVALID");
    const egress = String(operation.egress_class) as EgressClass;
    const { assertPhaseAllowsExternal, readPhaseSnapshot } = await import("./phase.ts");
    assertPhaseAllowsExternal(readPhaseSnapshot(this.database), egress);
    try {
      const response = await port.execute(handle);
      this.consumeOneTimeReconcile(handle, {
        reconcileIdentitySha256: handle.reconcileIdentitySha256,
        outcome: response.outcome,
        response,
      });
      return response;
    } catch (error) {
      const row = this.database
        .prepare("SELECT state FROM internal_operation WHERE operation_id=?")
        .get(handle.operationId) as Record<string, unknown> | undefined;
      // An adapter timeout/connection loss leaves the same attempt in
      // reconcile_required for the next bounded reconciliation window.
      if (row?.state !== "reconcile_required") throw error;
      throw error;
    }
  }
}

export type EgressPort = Readonly<{ execute(handle: CommittedAttemptHandle): Promise<ClosedExternalResponse> }>;
