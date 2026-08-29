import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  canonicalJsonV1,
  type OwnerSupervisorHandoff,
  type SqliteInternalOperationGateway
} from "./gateway.ts";

const ZERO_HASH = "0".repeat(64);
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type TrustedLocalSingletonFence = "deletion" | "publication";
export type TrustedLocalFenceState = "clear" | "blocked" | "unknown";

export type TrustedLocalFenceRequest = Readonly<{
  operationId: string;
  fence: TrustedLocalSingletonFence;
  expectedControlVersion: number;
  state?: Exclude<TrustedLocalFenceState, "unknown">;
}>;

export type TrustedLocalFenceReceipt = Readonly<{
  schemaVersion: "trusted-local-fence-receipt-v1";
  operationId: string;
  ownerProcess: "admin_http";
  operationKind: "phase_control";
  controlAction: "fence_update";
  fence: TrustedLocalSingletonFence;
  previousState: TrustedLocalFenceState;
  nextState: Exclude<TrustedLocalFenceState, "unknown">;
  expectedControlVersion: number;
  resultingControlVersion: number;
  phase: "disabled";
  globalStopState: "stopped" | "clear";
  recoveryState: "fenced" | "restoring" | "verifying" | "ready" | "failed";
}>;

export type TrustedLocalBootstrapInput = Readonly<{
  database: DatabaseSync;
  gateway: SqliteInternalOperationGateway;
  handoffProvider: () => OwnerSupervisorHandoff;
  requests: readonly TrustedLocalFenceRequest[];
  now?: () => Date;
}>;

export class TrustedLocalBootstrapError extends Error {
  readonly receipts: readonly TrustedLocalFenceReceipt[];

  constructor(message: string, receipts: readonly TrustedLocalFenceReceipt[]) {
    super(message);
    this.name = "TrustedLocalBootstrapError";
    this.receipts = receipts;
  }
}

function fail(code: string): never {
  throw new Error(code);
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) fail(code);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateId(value: string, code = "TRUSTED_LOCAL_ID_INVALID"): void {
  assert(ID.test(value), code);
}

function validateHash(value: string, code = "TRUSTED_LOCAL_HASH_INVALID"): void {
  assert(HASH.test(value), code);
}

function isoNow(now: () => Date): string {
  const value = now();
  assert(value instanceof Date && Number.isFinite(value.getTime()), "TRUSTED_LOCAL_CLOCK_INVALID");
  const iso = value.toISOString();
  assert(UTC.test(iso), "TRUSTED_LOCAL_CLOCK_INVALID");
  return iso;
}

function readControl(database: DatabaseSync): Record<string, unknown> {
  const row = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown> | undefined;
  assert(row !== undefined, "TRUSTED_LOCAL_CONTROL_MISSING");
  assert(row.phase === "disabled", "TRUSTED_LOCAL_PHASE_NOT_DISABLED");
  assert(row.global_stop_state === "stopped" || row.global_stop_state === "clear", "TRUSTED_LOCAL_GLOBAL_STOP_INVALID");
  assert(typeof row.recovery_state === "string", "TRUSTED_LOCAL_RECOVERY_STATE_INVALID");
  assert(Number.isSafeInteger(Number(row.version)) && Number(row.version) >= 1, "TRUSTED_LOCAL_CONTROL_VERSION_INVALID");
  assert(row.deletion_fence_state === "clear" || row.deletion_fence_state === "blocked" || row.deletion_fence_state === "unknown", "TRUSTED_LOCAL_DELETION_FENCE_INVALID");
  assert(row.publication_fence_state === "clear" || row.publication_fence_state === "blocked" || row.publication_fence_state === "unknown", "TRUSTED_LOCAL_PUBLICATION_FENCE_INVALID");
  return row;
}

function controlBinding() {
  return {
    entityKind: "internal_control" as const,
    entityId: "1",
    identitySelector: "control_singleton" as const,
    expectedVersion: null,
    expectedHash: ZERO_HASH
  };
}

function requestHashes(input: Readonly<{
  operationId: string;
  fence: TrustedLocalSingletonFence;
  expectedControlVersion: number;
  nextState: Exclude<TrustedLocalFenceState, "unknown">;
}>): Readonly<{ requestHash: string; requestFingerprint: string }> {
  const requestHash = sha256(`f1plus1-trusted-local-fence-v1\n${canonicalJsonV1(input)}`);
  return Object.freeze({
    requestHash,
    requestFingerprint: sha256(`f1plus1-trusted-local-fence-fingerprint-v1\n${requestHash}`)
  });
}

function issueFenceUpdate(
  input: TrustedLocalBootstrapInput,
  request: TrustedLocalFenceRequest,
  now: () => Date
): TrustedLocalFenceReceipt {
  validateId(request.operationId, "TRUSTED_LOCAL_OPERATION_ID_INVALID");
  assert(request.fence === "deletion" || request.fence === "publication", "TRUSTED_LOCAL_FENCE_KIND_INVALID");
  assert(Number.isSafeInteger(request.expectedControlVersion) && request.expectedControlVersion >= 1, "TRUSTED_LOCAL_EXPECTED_VERSION_INVALID");
  const nextState = request.state ?? "clear";
  assert(nextState === "clear" || nextState === "blocked", "TRUSTED_LOCAL_FENCE_STATE_INVALID");

  const before = readControl(input.database);
  const currentVersion = Number(before.version);
  assert(currentVersion === request.expectedControlVersion, "TRUSTED_LOCAL_FENCE_CAS_STALE");
  const previousState = before[`${request.fence}_fence_state`];
  assert(previousState === "clear" || previousState === "blocked" || previousState === "unknown", "TRUSTED_LOCAL_FENCE_STATE_INVALID");
  assert(previousState !== nextState, "TRUSTED_LOCAL_FENCE_NOOP");
  const observedAt = isoNow(now);
  const handoff = input.handoffProvider();
  assert(handoff.ownerProcess === "admin_http", "TRUSTED_LOCAL_HANDOFF_OWNER_INVALID");
  const hashes = requestHashes({ operationId: request.operationId, fence: request.fence, expectedControlVersion: currentVersion, nextState });
  const capability = input.gateway.request(handoff, {
    schemaVersion: "operation-request-v1",
    operationId: request.operationId,
    idempotencyKey: `trusted-local-${request.operationId}`,
    operationKind: "phase_control",
    ownerProcess: "admin_http",
    capabilityClass: "control",
    policyId: "p-phase-control-disabled",
    authorizationHandoffId: handoff.handoffId,
    controlAction: "fence_update",
    identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
    entitySet: [controlBinding()],
    requiredFenceSet: [],
    expected: {
      controlVersion: currentVersion,
      entityVersion: null,
      entityHash: ZERO_HASH,
      schemaSha256: "f3c0c049575b3121cccc8e66438481c70931df461cd941b95aaa54100844ad60",
      releaseSha256: handoff.releaseSha256,
      manifestSha256: handoff.manifestSha256,
      sourceStopEpoch: null,
      writerEpoch: Number(before.writer_epoch),
      epochs: {
        sourceConfig: Number(before.source_config_epoch),
        sourceSafety: Number(before.source_safety_epoch),
        authorization: Number(before.authorization_version),
        policy: Number(before.policy_epoch),
        recovery: Number(before.recovery_epoch)
      }
    },
    phase: "disabled",
    egressClass: "none",
    budgetRequest: null,
    modelRouteRef: null,
    requestHash: hashes.requestHash,
    requestFingerprint: hashes.requestFingerprint
  });
  const authorized = input.gateway.authorize(capability);
  const permit = input.gateway.authorizeWrite(authorized, {
    entityKind: "internal_control",
    entityId: "1",
    mutationKind: "update",
    expectedVersion: null,
    expectedHash: ZERO_HASH
  });
  const column = `${request.fence}_fence_state`;
  const statement = `UPDATE internal_control SET ${column}=?,updated_at=?,updated_by_operation_id=?,version=version+1 WHERE singleton_id=1 AND version=?`;
  input.gateway.mutate(permit, {
    entityKind: "internal_control",
    entityId: "1",
    mutationKind: "update",
    statement,
    parameters: [nextState, observedAt, request.operationId, currentVersion]
  });
  input.gateway.postcheckFenceSet(authorized);
  const after = readControl(input.database);
  assert(Number(after.version) === currentVersion + 1, "TRUSTED_LOCAL_FENCE_VERSION_NOT_ADVANCED");
  assert(after[`${request.fence}_fence_state`] === nextState, "TRUSTED_LOCAL_FENCE_STATE_NOT_APPLIED");
  assert(after.phase === before.phase && after.global_stop_state === before.global_stop_state && after.emergency_stop_state === before.emergency_stop_state && after.recovery_state === before.recovery_state && after.writer_epoch === before.writer_epoch && after.source_config_epoch === before.source_config_epoch && after.source_safety_epoch === before.source_safety_epoch && after.authorization_version === before.authorization_version && after.policy_epoch === before.policy_epoch && after.recovery_epoch === before.recovery_epoch, "TRUSTED_LOCAL_CONTROL_SCOPE_CHANGED");
  return Object.freeze({
    schemaVersion: "trusted-local-fence-receipt-v1",
    operationId: request.operationId,
    ownerProcess: "admin_http",
    operationKind: "phase_control",
    controlAction: "fence_update",
    fence: request.fence,
    previousState,
    nextState,
    expectedControlVersion: currentVersion,
    resultingControlVersion: Number(after.version),
    phase: "disabled",
    globalStopState: after.global_stop_state as TrustedLocalFenceReceipt["globalStopState"],
    recoveryState: after.recovery_state as TrustedLocalFenceReceipt["recoveryState"]
  });
}

/**
 * Bootstrap only the two singleton controls that the frozen Admin
 * phase_control/fence_update route is allowed to mutate.  The adapter never
 * receives a repository writer and rejects a request that tries to update two
 * fences in one operation.  Per-source/candidate/publication receipts remain
 * a separate gate and are intentionally not manufactured here.
 */
export function trustedLocalBootstrap(input: TrustedLocalBootstrapInput): readonly TrustedLocalFenceReceipt[] {
  assert(input.requests.length > 0, "TRUSTED_LOCAL_REQUESTS_EMPTY");
  const seenFences = new Set<TrustedLocalSingletonFence>();
  const operationFences = new Map<string, TrustedLocalSingletonFence>();
  for (const request of input.requests) {
    assert(!seenFences.has(request.fence), "TRUSTED_LOCAL_DUAL_FENCE_OPERATION");
    const priorFence = operationFences.get(request.operationId);
    assert(priorFence === undefined, "TRUSTED_LOCAL_DUAL_FENCE_OPERATION");
    seenFences.add(request.fence);
    operationFences.set(request.operationId, request.fence);
  }
  const now = input.now ?? (() => new Date());
  const receipts: TrustedLocalFenceReceipt[] = [];
  try {
    for (const request of input.requests) receipts.push(issueFenceUpdate(input, request, now));
    return Object.freeze(receipts);
  } catch (error) {
    // Each mutation has already committed atomically through the existing
    // Admin gateway.  Stop immediately on any CAS, policy or trigger failure;
    // callers must report the partial receipt set and must not invent 0011.
    throw new TrustedLocalBootstrapError(`TRUSTED_LOCAL_BOOTSTRAP_FAILED:${error instanceof Error ? error.message : "UNKNOWN"}`, Object.freeze(receipts));
  }
}

// The snake-case name is the frozen quick-launch route identifier; the
// camel-case export remains the TypeScript API used by callers.
export const trusted_local_bootstrap = trustedLocalBootstrap;

export function assertTrustedLocalFenceReceipt(receipt: TrustedLocalFenceReceipt): void {
  assert(receipt.schemaVersion === "trusted-local-fence-receipt-v1", "TRUSTED_LOCAL_RECEIPT_SCHEMA_INVALID");
  validateId(receipt.operationId, "TRUSTED_LOCAL_RECEIPT_OPERATION_INVALID");
  assert(receipt.ownerProcess === "admin_http" && receipt.operationKind === "phase_control" && receipt.controlAction === "fence_update", "TRUSTED_LOCAL_RECEIPT_ROUTE_INVALID");
  assert(receipt.fence === "deletion" || receipt.fence === "publication", "TRUSTED_LOCAL_RECEIPT_FENCE_INVALID");
  assert(receipt.previousState === "clear" || receipt.previousState === "blocked" || receipt.previousState === "unknown", "TRUSTED_LOCAL_RECEIPT_PREVIOUS_STATE_INVALID");
  assert(receipt.nextState === "clear" || receipt.nextState === "blocked", "TRUSTED_LOCAL_RECEIPT_NEXT_STATE_INVALID");
  assert(Number.isSafeInteger(receipt.expectedControlVersion) && receipt.expectedControlVersion >= 1, "TRUSTED_LOCAL_RECEIPT_EXPECTED_VERSION_INVALID");
  assert(Number.isSafeInteger(receipt.resultingControlVersion) && receipt.resultingControlVersion === receipt.expectedControlVersion + 1, "TRUSTED_LOCAL_RECEIPT_RESULT_VERSION_INVALID");
  assert(receipt.phase === "disabled", "TRUSTED_LOCAL_RECEIPT_PHASE_INVALID");
}
