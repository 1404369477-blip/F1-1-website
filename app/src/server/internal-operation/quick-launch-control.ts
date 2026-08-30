import { SqliteInternalOperationGateway, type EntityKind, type OwnerSupervisorHandoff } from "./gateway.ts";

const ZERO_HASH = "0".repeat(64);
export const QUICK_LAUNCH_CONTROL_SCHEMA_VERSION = "quick-launch-control-sequence-v1" as const;
export type QuickLaunchSingletonFence = "deletion" | "publication";
export type QuickLaunchControlStepId =
  | "clear-deletion-fence" | "clear-publication-fence" | "recovery-restoring" | "recovery-verifying"
  | "writer-epoch-bump" | "recovery-complete" | "clear-global-stop" | "enter-backlog" | "enter-live";
export type QuickLaunchControlHandoffSet = Readonly<Record<QuickLaunchControlStepId, OwnerSupervisorHandoff>>;
export type QuickLaunchControlReceipt = Readonly<{
  schemaVersion: typeof QUICK_LAUNCH_CONTROL_SCHEMA_VERSION;
  operationId: string; controlAction: string; ownerProcess: string;
  expectedControlVersion: number; resultingControlVersion: number; succeededAt: string;
}>;
export type QuickLaunchControlUntil = "ready" | "live";
export type QuickLaunchControlResult = Readonly<{
  until: QuickLaunchControlUntil;
  phase: "disabled" | "backlog" | "live";
  globalStopState: "stopped" | "clear";
  emergencyStopState: "clear";
  recoveryState: "ready";
  deletionFenceState: "clear"; publicationFenceState: "clear"; writerEpoch: number; recoveryEpoch: number;
  controlVersion: number; receipts: readonly QuickLaunchControlReceipt[];
  automaticReviewOperations: 0; automaticPublishOperations: 0;
}>;

type ControlRow = Record<string, unknown>;
type DatabaseLike = { prepare(sql: string): { get(...values: unknown[]): unknown; all(...values: unknown[]): unknown } };

function assert(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }
function control(database: DatabaseLike): ControlRow {
  const row = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get();
  assert(row !== null && typeof row === "object", "QUICK_LAUNCH_CONTROL_MISSING");
  return row as ControlRow;
}
function integer(row: ControlRow, field: string): number {
  const parsed = Number(row[field]);
  assert(Number.isSafeInteger(parsed) && parsed >= 0, "QUICK_LAUNCH_CONTROL_FIELD_INVALID");
  return parsed;
}
function validateHash(value: string): void {
  assert(/^[0-9a-f]{64}$/.test(value), "QUICK_LAUNCH_HASH_INVALID");
}
function validateHandoff(handoff: OwnerSupervisorHandoff, releaseSha256: string, manifestSha256: string): void {
  assert(handoff.schemaVersion === "owner-supervisor-handoff-v1", "QUICK_LAUNCH_HANDOFF_SCHEMA_INVALID");
  assert(handoff.issuer === "f1plus1-owner-supervisor-v1", "QUICK_LAUNCH_HANDOFF_ISSUER_INVALID");
  validateHash(handoff.receiptSha256);
  assert(handoff.releaseSha256 === releaseSha256, "QUICK_LAUNCH_HANDOFF_RELEASE_MISMATCH");
  assert(handoff.manifestSha256 === manifestSha256, "QUICK_LAUNCH_HANDOFF_MANIFEST_MISMATCH");
}
function validateWriterAuthority(value: string): string {
  validateHash(value);
  return value;
}
function receipt(operationId: string, action: string, owner: string, expectedVersion: number, after: ControlRow): QuickLaunchControlReceipt {
  return Object.freeze({
    schemaVersion: QUICK_LAUNCH_CONTROL_SCHEMA_VERSION, operationId, controlAction: action, ownerProcess: owner,
    expectedControlVersion: expectedVersion, resultingControlVersion: integer(after, "version"),
    succeededAt: String(after.updated_at)
  });
}
function expected(database: DatabaseLike, releaseSha256: string, manifestSha256: string, schemaSha256: string) {
  const row = control(database);
  return Object.freeze({
    controlVersion: integer(row, "version"), entityVersion: null, entityHash: ZERO_HASH,
    schemaSha256, releaseSha256, manifestSha256, sourceStopEpoch: null, writerEpoch: integer(row, "writer_epoch"),
    epochs: Object.freeze({
      sourceConfig: integer(row, "source_config_epoch"), sourceSafety: integer(row, "source_safety_epoch"),
      authorization: integer(row, "authorization_version"), policy: integer(row, "policy_epoch"), recovery: integer(row, "recovery_epoch")
    })
  });
}
const CONTROL_BINDING = Object.freeze({ entityKind: "internal_control" as const, entityId: "1", identitySelector: "control_singleton" as const, expectedVersion: null, expectedHash: ZERO_HASH });
const WRITE_INPUT = Object.freeze({ entityKind: "internal_control" as EntityKind, entityId: "1", mutationKind: "update" as const, expectedVersion: null, expectedHash: ZERO_HASH });

function nowIso(now: (() => Date) | undefined): string {
  const value = (now ?? (() => new Date()))().toISOString();
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), "QUICK_LAUNCH_TIMESTAMP_INVALID");
  return value;
}
function readControlOnlyStatement(statement: string, expectedVersion: number): string {
  assert(statement.startsWith("UPDATE internal_control SET ") && statement.endsWith(" WHERE singleton_id=1 AND version=?"), "QUICK_LAUNCH_STATEMENT_NOT_CLOSED");
  assert(statement.includes("version=version+1") && !statement.includes(";"), "QUICK_LAUNCH_STATEMENT_NOT_CLOSED");
  assert(Number.isSafeInteger(expectedVersion) && expectedVersion >= 1, "QUICK_LAUNCH_CONTROL_VERSION_INVALID");
  return statement;
}

function runControlStep(input: Readonly<{
  database: DatabaseLike; gateway: SqliteInternalOperationGateway; handoff: OwnerSupervisorHandoff;
  operationId: string; controlAction: "recovery_advance" | "writer_epoch_bump" | "recovery_complete" | "clear_global_stop" | "enter_backlog" | "enter_live";
  statement: string; releaseSha256: string; manifestSha256: string; schemaSha256: string; now?: () => Date;
}>): QuickLaunchControlReceipt {
  const before = control(input.database);
  const expectedControlVersion = integer(before, "version");
  const phase = String(before.phase);
  const isRestore = input.controlAction !== "clear_global_stop" && input.controlAction !== "enter_backlog" && input.controlAction !== "enter_live";
  assert(input.controlAction !== "enter_backlog" || phase === "disabled", "QUICK_LAUNCH_PHASE_NOT_DISABLED");
  assert(input.controlAction !== "enter_live" || phase === "backlog", "QUICK_LAUNCH_PHASE_NOT_BACKLOG");
  const capability = input.gateway.request(input.handoff, {
    schemaVersion: "operation-request-v1", operationId: input.operationId, idempotencyKey: input.operationId,
    operationKind: isRestore ? "restore" : "phase_control", ownerProcess: input.handoff.ownerProcess,
    capabilityClass: isRestore ? "restore" : "control",
    policyId: input.handoff.ownerProcess === "restore_operator" ? "p-restore-control-disabled"
      : input.handoff.ownerProcess === "system_supervisor" ? "p-supervisor-restore-disabled"
      : phase === "disabled" ? "p-phase-control-disabled" : phase === "backlog" ? "p-phase-control-backlog" : "p-phase-control-live",
    authorizationHandoffId: input.handoff.handoffId, controlAction: input.controlAction,
    identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
    entitySet: [CONTROL_BINDING], requiredFenceSet: [], expected: expected(input.database, input.releaseSha256, input.manifestSha256, input.schemaSha256),
    phase: phase as "disabled" | "backlog", egressClass: "none", budgetRequest: null, modelRouteRef: null,
    requestHash: ZERO_HASH, requestFingerprint: ZERO_HASH
  });
  const authorized = input.gateway.authorize(capability);
  const permit = input.gateway.authorizeWrite(authorized, WRITE_INPUT);
  input.gateway.mutate(permit, {
    ...WRITE_INPUT,
    statement: readControlOnlyStatement(input.statement, expectedControlVersion),
    parameters: [nowIso(input.now), input.operationId, expectedControlVersion]
  });
  input.gateway.postcheckFenceSet(authorized);
  const after = control(input.database);
  assert(integer(after, "version") === expectedControlVersion + 1, "QUICK_LAUNCH_CONTROL_CAS_FAILED");
  assert(String(after.updated_by_operation_id) === input.operationId, "QUICK_LAUNCH_OWNER_ATTRIBUTION_FAILED");
  return receipt(input.operationId, input.controlAction, input.handoff.ownerProcess, expectedControlVersion, after);
}
function clearSingletonFence(input: Readonly<{
  database: DatabaseLike; gateway: SqliteInternalOperationGateway; handoff: OwnerSupervisorHandoff;
  operationId: string; fence: QuickLaunchSingletonFence; releaseSha256: string; manifestSha256: string;
  schemaSha256: string; now?: () => Date;
}>): QuickLaunchControlReceipt {
  const before = control(input.database);
  const expectedControlVersion = integer(before, "version");
  const column = input.fence === "deletion" ? "deletion_fence_state" : "publication_fence_state";
  const previous = String(before[column]);
  assert(previous === "unknown" || previous === "blocked", "QUICK_LAUNCH_FENCE_ALREADY_CLEAR");
  const capability = input.gateway.request(input.handoff, {
    schemaVersion: "operation-request-v1", operationId: input.operationId, idempotencyKey: input.operationId,
    operationKind: "phase_control", ownerProcess: "admin_http", capabilityClass: "control",
    policyId: "p-phase-control-disabled", authorizationHandoffId: input.handoff.handoffId, controlAction: "fence_update",
    identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
    entitySet: [CONTROL_BINDING], requiredFenceSet: [],
    expected: expected(input.database, input.releaseSha256, input.manifestSha256, input.schemaSha256),
    phase: "disabled", egressClass: "none", budgetRequest: null, modelRouteRef: null,
    requestHash: ZERO_HASH, requestFingerprint: ZERO_HASH
  });
  const authorized = input.gateway.authorize(capability);
  const permit = input.gateway.authorizeWrite(authorized, WRITE_INPUT);
  input.gateway.mutate(permit, {
    ...WRITE_INPUT,
    statement: `UPDATE internal_control SET ${column}='clear',updated_at=?,updated_by_operation_id=?,version=version+1 WHERE singleton_id=1 AND version=?`,
    parameters: [nowIso(input.now), input.operationId, expectedControlVersion]
  });
  input.gateway.postcheckFenceSet(authorized);
  const after = control(input.database);
  assert(String(after[column]) === "clear", "QUICK_LAUNCH_FENCE_NOT_CLEARED");
  return receipt(input.operationId, `clear_${input.fence}_singleton_fence`, "admin_http", expectedControlVersion, after);
}
export function runQuickLaunchControlSequence(input: Readonly<{
  database: DatabaseLike; gateway: SqliteInternalOperationGateway; handoffs: QuickLaunchControlHandoffSet;
  releaseSha256: string; manifestSha256: string; schemaSha256: string; now?: () => Date;
  until?: QuickLaunchControlUntil;
}>): QuickLaunchControlResult {
  for (const handoff of Object.values(input.handoffs)) validateHandoff(handoff, input.releaseSha256, input.manifestSha256);
  const before = control(input.database);
  assert(before.phase === "disabled", "QUICK_LAUNCH_NOT_DISABLED");
  assert(before.global_stop_state === "stopped", "QUICK_LAUNCH_GLOBAL_STOP_NOT_SET");
  assert(before.emergency_stop_state === "clear", "QUICK_LAUNCH_EMERGENCY_STOP_NOT_CLEAR");
  assert(before.recovery_state === "fenced", "QUICK_LAUNCH_RECOVERY_NOT_FENCED");
  const now = input.now;
  const ownerFor: Readonly<Record<QuickLaunchControlStepId, string>> = Object.freeze({
    "clear-deletion-fence": "admin_http", "clear-publication-fence": "admin_http",
    "recovery-restoring": "restore_operator", "recovery-verifying": "restore_operator",
    "writer-epoch-bump": "system_supervisor", "recovery-complete": "system_supervisor",
    "clear-global-stop": "admin_http", "enter-backlog": "admin_http", "enter-live": "admin_http"
  });
  for (const [step, owner] of Object.entries(ownerFor) as Array<[QuickLaunchControlStepId, string]>) {
    assert(input.handoffs[step].ownerProcess === owner, "QUICK_LAUNCH_HANDOFF_OWNER_MISMATCH");
  }
  const handoff = (step: QuickLaunchControlStepId) => input.handoffs[step];
  const receipts: Array<QuickLaunchControlReceipt> = [];
  const add = (value: QuickLaunchControlReceipt) => receipts.push(value);
  if (String(before.deletion_fence_state) !== "clear") add(clearSingletonFence({
    database: input.database, gateway: input.gateway, handoff: handoff("clear-deletion-fence"),
    operationId: "quick-launch-clear-deletion-fence", fence: "deletion",
    releaseSha256: input.releaseSha256, manifestSha256: input.manifestSha256,
    schemaSha256: input.schemaSha256, now
  }));
  if (String(before.publication_fence_state) !== "clear") add(clearSingletonFence({
    database: input.database, gateway: input.gateway, handoff: handoff("clear-publication-fence"),
    operationId: "quick-launch-clear-publication-fence", fence: "publication",
    releaseSha256: input.releaseSha256, manifestSha256: input.manifestSha256,
    schemaSha256: input.schemaSha256, now
  }));
  const sequence: ReadonlyArray<Readonly<{ step: Exclude<QuickLaunchControlStepId, "clear-deletion-fence" | "clear-publication-fence">; action: Parameters<typeof runControlStep>[0]["controlAction"]; statement: string }>> = [
    { step: "recovery-restoring", action: "recovery_advance", statement: "UPDATE internal_control SET recovery_state='restoring',updated_at=?,updated_by_operation_id=?,version=version+1 WHERE singleton_id=1 AND version=?" },
    { step: "recovery-verifying", action: "recovery_advance", statement: "UPDATE internal_control SET recovery_state='verifying',updated_at=?,updated_by_operation_id=?,version=version+1 WHERE singleton_id=1 AND version=?" },
    { step: "writer-epoch-bump", action: "writer_epoch_bump", statement: `UPDATE internal_control SET recovery_epoch=recovery_epoch+1,writer_epoch=writer_epoch+1,writer_authority_receipt_sha256='${validateWriterAuthority(input.handoffs["writer-epoch-bump"].receiptSha256)}',updated_at=?,updated_by_operation_id=?,version=version+1 WHERE singleton_id=1 AND version=?` },
    { step: "recovery-complete", action: "recovery_complete", statement: "UPDATE internal_control SET recovery_state='ready',updated_at=?,updated_by_operation_id=?,version=version+1 WHERE singleton_id=1 AND version=?" },
    { step: "clear-global-stop", action: "clear_global_stop", statement: "UPDATE internal_control SET global_stop_state='clear',emergency_stop_state='clear',updated_at=?,updated_by_operation_id=?,version=version+1 WHERE singleton_id=1 AND version=?" },
    { step: "enter-backlog", action: "enter_backlog", statement: "UPDATE internal_control SET phase='backlog',updated_at=?,updated_by_operation_id=?,version=version+1 WHERE singleton_id=1 AND version=?" },
    { step: "enter-live", action: "enter_live", statement: "UPDATE internal_control SET phase='live',updated_at=?,updated_by_operation_id=?,version=version+1 WHERE singleton_id=1 AND version=?" }
  ];
  const until = input.until ?? "live";
  const readyStop = new Set<string>(["recovery-restoring", "recovery-verifying", "writer-epoch-bump", "recovery-complete"]);
  for (const item of sequence) {
    if (until === "ready" && !readyStop.has(item.step)) continue;
    add(runControlStep({
      database: input.database, gateway: input.gateway, handoff: handoff(item.step),
      operationId: `quick-launch-${item.step}`, controlAction: item.action, statement: item.statement,
      releaseSha256: input.releaseSha256, manifestSha256: input.manifestSha256, schemaSha256: input.schemaSha256, now
    }));
  }
  const after = control(input.database);
  if (until === "ready") {
    assert(after.phase === "disabled" && after.global_stop_state === "stopped" && after.emergency_stop_state === "clear"
      && after.recovery_state === "ready" && after.deletion_fence_state === "clear" && after.publication_fence_state === "clear", "QUICK_LAUNCH_READY_STATE_INVALID");
  } else {
    assert(after.phase === "live" && after.global_stop_state === "clear" && after.emergency_stop_state === "clear"
      && after.recovery_state === "ready" && after.deletion_fence_state === "clear" && after.publication_fence_state === "clear", "QUICK_LAUNCH_FINAL_STATE_INVALID");
  }
  const automation = input.database.prepare("SELECT count(*) AS count FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher')").get() as ControlRow;
  assert(Number(automation.count) === 0, "QUICK_LAUNCH_AUTOMATION_PRESENT");
  return Object.freeze({
    until,
    phase: after.phase as QuickLaunchControlResult["phase"],
    globalStopState: after.global_stop_state as QuickLaunchControlResult["globalStopState"],
    emergencyStopState: "clear", recoveryState: "ready",
    deletionFenceState: "clear", publicationFenceState: "clear", writerEpoch: integer(after, "writer_epoch"),
    recoveryEpoch: integer(after, "recovery_epoch"), controlVersion: integer(after, "version"),
    receipts: Object.freeze(receipts), automaticReviewOperations: 0, automaticPublishOperations: 0
  });
}
