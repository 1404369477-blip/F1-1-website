import { createHash, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { verifyApplicationDrillReceipt } from "../backup-snapshot/application-drill-receipt.ts";
import type { DatabaseSync } from "node:sqlite";
import type { BackupReport } from "../backup-snapshot/core.ts";
import { canonicalJson } from "../db/profile.ts";
import { reviewRealSchemaFingerprint } from "../review-real/migration.ts";
import { SOURCE_REGISTRY_SCHEMA10_SHA256 } from "../rss/source-registry-migration.ts";
import { canonicalJsonV1, SqliteInternalOperationGateway, type OwnerProcess, type OwnerSupervisorHandoff, type Phase } from "./gateway.ts";
import { persistOwnerSupervisorHandoff } from "./owner-supervisor.ts";
import { verifyBackupPackageBinding } from "./backup-package-binding.ts";
import { writeRecoveryFenceAfterRegistration, type RecoveryFenceWriteReceipt } from "./recovery-fence-write.ts";
import { backupCheckpointHash, validateRecoveryPointReceipt, type RecoveryPointReceipt } from "./recovery.ts";
export { readSnapLatestAndManifest } from "./backup-package-binding.ts";

const ZERO_HASH = "0".repeat(64);
const HASH = /^[0-9a-f]{64}$/;
const HANDOFF_SCHEMA_VERSION = "owner-supervisor-handoff-v1" as const;
const HANDOFF_ISSUER = "f1plus1-owner-supervisor-v1" as const;
const HANDOFF_TTL_MS = 15 * 60_000;
const RECEIPT_SCHEMA = "backup-recovery-point-register-receipt-v2" as const;
type ControlRow = Record<string, unknown>;
function assert(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }
function domainHash(domain: string, value: unknown): string { return createHash("sha256").update(`${domain}\n${canonicalJsonV1(value)}`).digest("hex"); }

export type BackupRecoveryPointRegisterInput = Readonly<{
  database: DatabaseSync; backupRoot: string; drillReport: BackupReport; restoreRoot: string;
  snapshotKey: Buffer; projectionSigningKeyId: string; projectionPublicKeyPem: string;
  offHostReceipt: unknown; offHostPublicKeyPem: string;
  applicationDrill: unknown; applicationDrillPublicKeyPem: string;
  releaseSha256: string; manifestSha256: string; schemaSha256?: string; budgetAccountId: string;
  retentionPolicyId?: string; fencePath?: string; now?: () => Date;
}>;
export type BackupRecoveryPointRegisterReceipt = Readonly<{
  schemaVersion: typeof RECEIPT_SCHEMA; decision: "SUCCESS" | "REGISTERED_FENCE_NOT_REFRESHED";
  recoveryPointId: string; backupSetId: string; operationId: string; reused: boolean;
  validBackupRecoveryPoint: true; backupBindingPassed: true; activationApplied: false;
  checkpointAlgorithm: "f1plus1-backup-checkpoint-v2" | "f1plus1-common-checkpoint-v1";
  checkpointSha256: string; applicationDrillReceiptSha256: string; recoveryPointAt: string; writerEpoch: number; recoveryEpoch: number;
  fence: RecoveryFenceWriteReceipt | null; fenceReasonCode: string | null;
}>;

function verifyGeneratedReceipt(expected: OwnerSupervisorHandoff): (candidate: OwnerSupervisorHandoff) => boolean {
  return (candidate) => candidate === expected || (
    candidate.schemaVersion === expected.schemaVersion &&
    candidate.handoffId === expected.handoffId &&
    candidate.ownerProcess === expected.ownerProcess &&
    candidate.issuer === expected.issuer &&
    candidate.oneTimeNonce === expected.oneTimeNonce &&
    candidate.releaseSha256 === expected.releaseSha256 &&
    candidate.manifestSha256 === expected.manifestSha256 &&
    candidate.receiptSha256 === expected.receiptSha256 &&
    candidate.verifiedAt === expected.verifiedAt &&
    candidate.expiresAt === expected.expiresAt
  );
}

export function createOwnerSupervisorHandoff(
  database: DatabaseSync,
  ownerProcess: OwnerProcess,
  releaseSha256: string,
  manifestSha256: string,
  nowMs: number
): OwnerSupervisorHandoff {
  const verifiedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + HANDOFF_TTL_MS).toISOString();
  const core = Object.freeze({
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    handoffId: `register-${ownerProcess}-${nowMs}-${randomBytes(8).toString("hex")}`,
    ownerProcess,
    issuer: HANDOFF_ISSUER,
    oneTimeNonce: randomBytes(32).toString("base64url"),
    releaseSha256,
    manifestSha256,
    verifiedAt,
    expiresAt
  });
  const handoff: OwnerSupervisorHandoff = Object.freeze({
    ...core,
    receiptSha256: createHash("sha256").update(canonicalJson(core)).digest("hex")
  });
  persistOwnerSupervisorHandoff(database, handoff, verifyGeneratedReceipt(handoff));
  return handoff;
}

function control(database: DatabaseSync): ControlRow {
  const row = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get();
  assert(row !== null && typeof row === "object", "REGISTER_CONTROL_MISSING");
  return row as ControlRow;
}

function integer(row: ControlRow, field: string): number {
  const parsed = Number(row[field]);
  assert(Number.isSafeInteger(parsed) && parsed >= 0, "REGISTER_CONTROL_FIELD_INVALID");
  return parsed;
}

function expected(row: ControlRow, releaseSha256: string, manifestSha256: string, schemaSha256: string) {
  return Object.freeze({
    controlVersion: integer(row, "version"),
    entityVersion: null,
    entityHash: ZERO_HASH,
    schemaSha256,
    releaseSha256,
    manifestSha256,
    sourceStopEpoch: null,
    writerEpoch: integer(row, "writer_epoch"),
    epochs: Object.freeze({
      sourceConfig: integer(row, "source_config_epoch"),
      sourceSafety: integer(row, "source_safety_epoch"),
      authorization: integer(row, "authorization_version"),
      policy: integer(row, "policy_epoch"),
      recovery: integer(row, "recovery_epoch")
    })
  });
}

function backupPolicy(phase: Phase): string {
  const policies: Record<Phase, string> = {
    disabled: "p-backup-disabled",
    backlog: "p-backup-backlog",
    live: "p-backup-live",
    paused: "p-backup-paused"
  };
  return policies[phase];
}


const FIELDS = [
  ["recoveryPointId","recovery_point_id"], ["backupSetId","backup_set_id"], ["backupManifestSha256","backup_manifest_sha256"],
  ["databaseSnapshotSha256","database_snapshot_sha256"], ["databaseSchemaSha256","database_schema_sha256"],
  ["sqliteSnapshotMethod","sqlite_snapshot_method"], ["sourceDbWalShmIdentitySha256","source_db_wal_shm_identity_sha256"],
  ["fileManifestSha256","file_manifest_sha256"], ["totalBytes","total_bytes"], ["releaseSha256","release_sha256"],
  ["deploymentManifestSha256","deployment_manifest_sha256"], ["projectionGeneration","projection_generation"],
  ["projectionManifestSha256","projection_manifest_sha256"], ["projectionPointerSha256","projection_pointer_sha256"],
  ["writerEpoch","writer_epoch"], ["recoveryEpoch","recovery_epoch"], ["writerAuthorityReceiptSha256","writer_authority_receipt_sha256"],
  ["commonCheckpointSha256","common_checkpoint_sha256"], ["recoveryPointAt","recovery_point_at"], ["completedAt","completed_at"],
  ["rpoSeconds","rpo_seconds"], ["offHostVerified","off_host_verified"], ["remoteReceiptSha256","remote_receipt_sha256"],
  ["encrypted","encrypted"], ["encryptionKeyVersion","encryption_key_version"], ["retentionPolicyId","retention_policy_id"],
  ["restoreDrillState","restore_drill_state"], ["restoreDurationSeconds","restore_duration_seconds"],
  ["drillIsolated","drill_isolated"], ["drillDecryptionVerified","drill_decryption_verified"], ["drillHashVerified","drill_hash_verified"],
  ["drillIntegrityVerified","drill_integrity_verified"], ["drillFkVerified","drill_fk_verified"], ["drillSchemaVerified","drill_schema_verified"],
  ["drillBootable","drill_bootable"], ["drillBusinessPointVerified","drill_business_point_verified"],
  ["drillPublicPointerVerified","drill_public_pointer_verified"], ["incidentDeclaredAt","incident_declared_at"],
  ["adminAvailableAt","admin_available_at"], ["publicAvailableAt","public_available_at"], ["operationId","operation_id"]
] as const;

export function readStoredBackupRecoveryPoint(database: DatabaseSync, recoveryPointId: string): RecoveryPointReceipt | null {
  const row = database.prepare("SELECT * FROM backup_recovery_point WHERE recovery_point_id=?").get(recoveryPointId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return Object.freeze(Object.fromEntries(FIELDS.map(([key, column]) => [key, key === "encrypted" || key === "offHostVerified" ? row[column] === 1 : row[column]]))) as RecoveryPointReceipt;
}

export function runBackupRecoveryPointRegister(input: BackupRecoveryPointRegisterInput): BackupRecoveryPointRegisterReceipt {
  const schemaSha256 = input.schemaSha256 ?? SOURCE_REGISTRY_SCHEMA10_SHA256;
  for (const value of [input.releaseSha256, input.manifestSha256, schemaSha256]) assert(HASH.test(value), "REGISTER_RUNTIME_HASH_INVALID");
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  assert(input.applicationDrill !== undefined && input.applicationDrill !== null, "APPLICATION_DRILL_REQUIRED");
  const verified = verifyBackupPackageBinding({ ...input, now: startedAt });
  const { snap } = verified;
  const application = verifyApplicationDrillReceipt({ receipt: input.applicationDrill, publicKeyPem: input.applicationDrillPublicKeyPem, now: now(), expected: {
    packageId: snap.latest.packageId, contentHash: snap.manifest.contentHash, manifestSha256: snap.manifestSha256,
    databaseSnapshotSha256: snap.manifest.members.find(member => member.relativePath === "db/snapshot.sqlite")!.sha256,
    restoreRootSha256: createHash("sha256").update(realpathSync(input.restoreRoot), "utf8").digest("hex"),
    releaseSha256: input.releaseSha256, deploymentManifestSha256: input.manifestSha256, schemaSha256: verified.schemaSha256,
    projectionGeneration: verified.generation, projectionManifestSha256: verified.projectionManifestSha256
  } });
  const evidenceHash = domainHash("f1plus1-backup-registration-evidence-v2", {
    applicationDrillReceiptSha256: application.receiptSha256, offHostReceiptSha256: verified.remoteReceiptSha256,
    backupManifestSha256: snap.manifestSha256
  });
  const packageControl = verified.control;
  const writerEpoch = integer(packageControl, "writer_epoch");
  const recoveryEpoch = integer(packageControl, "recovery_epoch");
  const writerAuthority = String(packageControl.writer_authority_receipt_sha256);
  assert(HASH.test(writerAuthority), "WRITER_AUTHORITY_INVALID");
  function currentIdentity(): ControlRow {
    const row = control(input.database);
    assert(reviewRealSchemaFingerprint(input.database) === verified.schemaSha256 && verified.schemaSha256 === schemaSha256, "BACKUP_CURRENT_SCHEMA_MISMATCH");
    assert(integer(row, "writer_epoch") === writerEpoch && integer(row, "recovery_epoch") === recoveryEpoch && row.writer_authority_receipt_sha256 === writerAuthority, "BACKUP_CURRENT_WRITER_MISMATCH");
    return row;
  }
  const preflightControl = currentIdentity();
  const recoveryPointAt = new Date(snap.manifest.recovery_point_at).toISOString();
  const recoveryPointId = `rp-${snap.latest.packageId}`;
  const existing = readStoredBackupRecoveryPoint(input.database, recoveryPointId);
  const operationId = existing?.operationId ?? `register-backup-v2-${startedAt.getTime()}-${randomBytes(6).toString("hex")}`;
  const completedAt = now().toISOString();
  assert(Date.parse(application.completedAt) <= Date.parse(completedAt), "APPLICATION_DRILL_COMPLETION_IN_FUTURE");
  const restoreDurationSeconds = Math.ceil(Math.max(verified.durationMs, application.elapsedMs) / 1000);
  const receiptBase = {
    recoveryPointId, backupSetId: snap.latest.packageId, backupManifestSha256: snap.manifestSha256,
    databaseSnapshotSha256: snap.manifest.members.find(member => member.relativePath === "db/snapshot.sqlite")!.sha256,
    databaseSchemaSha256: verified.schemaSha256, sqliteSnapshotMethod: "vacuum_into_verified" as const,
    sourceDbWalShmIdentitySha256: domainHash("f1plus1-vacuum-wal-shm-identity-v1", { method: "vacuum_into_verified", contentHash: snap.manifest.contentHash }),
    fileManifestSha256: domainHash("f1plus1-snap-file-manifest-v1", snap.manifest.members),
    totalBytes: snap.manifest.members.reduce((sum, member) => sum + member.bytes, 0),
    releaseSha256: input.releaseSha256, deploymentManifestSha256: input.manifestSha256,
    projectionGeneration: verified.generation, projectionManifestSha256: verified.projectionManifestSha256,
    projectionPointerSha256: verified.projectionPointerSha256, writerEpoch, recoveryEpoch,
    writerAuthorityReceiptSha256: writerAuthority, recoveryPointAt,
    completedAt: existing?.completedAt ?? completedAt, rpoSeconds: 900,
    offHostVerified: true as const, remoteReceiptSha256: verified.remoteReceiptSha256, encrypted: true as const,
    encryptionKeyVersion: snap.manifest.keyId, retentionPolicyId: input.retentionPolicyId ?? "snap-cycle-v1",
    restoreDrillState: "verified" as const, restoreDurationSeconds: existing?.restoreDurationSeconds ?? restoreDurationSeconds,
    drillIsolated: 1 as const, drillDecryptionVerified: 1 as const, drillHashVerified: 1 as const,
    drillIntegrityVerified: 1 as const, drillFkVerified: 1 as const, drillSchemaVerified: 1 as const,
    drillBootable: application.bootable ? 1 as const : 0 as const,
    drillBusinessPointVerified: application.businessPointVerified ? 1 as const : 0 as const, drillPublicPointerVerified: 1 as const,
    incidentDeclaredAt: existing?.incidentDeclaredAt ?? application.incidentDeclaredAt,
    adminAvailableAt: existing?.adminAvailableAt ?? application.adminAvailableAt,
    publicAvailableAt: existing?.publicAvailableAt ?? application.publicAvailableAt,
    operationId
  };
  const checkpoint = backupCheckpointHash(receiptBase, snap.manifest.contentHash);
  const receipt: RecoveryPointReceipt = Object.freeze({ ...receiptBase, commonCheckpointSha256: checkpoint.hash });
  const validationOptions = { now: now().getTime(), expectedSchemaSha256: schemaSha256, expectedReleaseSha256: input.releaseSha256,
    expectedManifestSha256: input.manifestSha256, expectedWriterEpoch: writerEpoch, expectedRecoveryEpoch: recoveryEpoch };
  validateRecoveryPointReceipt(receipt, validationOptions);
  if (existing) {
    assert(canonicalJsonV1(existing) === canonicalJsonV1(receipt), "BACKUP_REPLAY_IDENTITY_CONFLICT");
    const operation = input.database.prepare("SELECT state,request_hash FROM internal_operation WHERE operation_id=?").get(operationId) as { state?: string; request_hash?: string } | undefined;
    assert(operation?.state === "succeeded", "BACKUP_REPLAY_OPERATION_INCOMPLETE");
    assert(operation.request_hash === evidenceHash, "BACKUP_REPLAY_EVIDENCE_CONFLICT");
  } else {
    assert(input.database.prepare("SELECT account_id FROM budget_account WHERE account_id=?").get(input.budgetAccountId), "BUDGET_ACCOUNT_MISSING");
    const handoff = createOwnerSupervisorHandoff(input.database, "backup_worker", input.releaseSha256, input.manifestSha256, now().getTime());
    const gateway = new SqliteInternalOperationGateway({ database: input.database, releaseSha256: input.releaseSha256, manifestSha256: input.manifestSha256, schemaSha256, now });
    try {
      gateway.runAtomicAdmission(() => {
      const capability = gateway.request(handoff, {
        schemaVersion: "operation-request-v1", operationId, idempotencyKey: operationId, operationKind: "backup", ownerProcess: "backup_worker",
        capabilityClass: "backup", policyId: backupPolicy(String(preflightControl.phase) as Phase), authorizationHandoffId: handoff.handoffId,
        controlAction: null, identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
        entitySet: [{ entityKind: "backup", entityId: recoveryPointId, identitySelector: "bound_child", expectedVersion: null, expectedHash: ZERO_HASH }],
        requiredFenceSet: [], expected: expected(preflightControl, input.releaseSha256, input.manifestSha256, schemaSha256),
        phase: String(preflightControl.phase) as Phase, egressClass: "backup_private",
        budgetRequest: { reservationId: `budget-${operationId}`, accountId: input.budgetAccountId, units: 1 },
        modelRouteRef: null, requestHash: evidenceHash, requestFingerprint: evidenceHash
      });
      const authorized = gateway.authorize(capability);
      gateway.runMutationTransaction(authorized, mutate => {
        const row = currentIdentity();
        assert(row.version === preflightControl.version, "BACKUP_CONTROL_CHANGED");
        validateRecoveryPointReceipt(receipt, { ...validationOptions, now: now().getTime() });
        mutate({ entityKind: "backup", entityId: recoveryPointId, mutationKind: "insert", expectedVersion: null, expectedHash: ZERO_HASH,
          statement: `INSERT INTO backup_recovery_point (${FIELDS.map(([, column]) => column).join(",")}) VALUES(${FIELDS.map(() => "?").join(",")})`,
          parameters: FIELDS.map(([key]) => typeof receipt[key] === "boolean" ? Number(receipt[key]) : receipt[key]) });
      });
      });
    } finally { gateway.close(); }
  }
  assert(input.database.prepare("SELECT recovery_point_id FROM valid_backup_recovery_point_v1 WHERE recovery_point_id=?").get(recoveryPointId), "VALID_BACKUP_RECOVERY_POINT_MISSING");
  let fence: RecoveryFenceWriteReceipt | null = null;
  let fenceReasonCode: string | null = null;
  if (input.fencePath) {
    try {
      fence = writeRecoveryFenceAfterRegistration({ database: input.database, fencePath: input.fencePath, recoveryPointId, recoveryPointAt,
        completedAt: receipt.completedAt, expectedWriterEpoch: writerEpoch, expectedRecoveryEpoch: recoveryEpoch,
        expectedWriterAuthority: writerAuthority, schemaSha256, now });
    } catch (error) { fenceReasonCode = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "RECOVERY_FENCE_WRITE_FAILED"; }
  }
  return Object.freeze({ schemaVersion: RECEIPT_SCHEMA, decision: fenceReasonCode ? "REGISTERED_FENCE_NOT_REFRESHED" : "SUCCESS",
    recoveryPointId, backupSetId: snap.latest.packageId, operationId, reused: existing !== null,
    validBackupRecoveryPoint: true, backupBindingPassed: true, activationApplied: false,
    checkpointAlgorithm: checkpoint.algorithm, checkpointSha256: checkpoint.hash, applicationDrillReceiptSha256: application.receiptSha256,
    recoveryPointAt, writerEpoch, recoveryEpoch, fence, fenceReasonCode });
}
