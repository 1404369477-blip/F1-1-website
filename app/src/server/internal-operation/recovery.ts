import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJsonV1 } from "./gateway.ts";
import { reviewRealSchemaFingerprint } from "../review-real/migration.ts";

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HASH_FIELDS = [
  "backupManifestSha256", "databaseSnapshotSha256", "databaseSchemaSha256",
  "sourceDbWalShmIdentitySha256", "fileManifestSha256", "releaseSha256",
  "deploymentManifestSha256", "writerAuthorityReceiptSha256", "commonCheckpointSha256",
  "remoteReceiptSha256"
] as const;

export type RecoveryPointReceipt = Readonly<{
  recoveryPointId: string;
  backupSetId: string;
  backupManifestSha256: string;
  databaseSnapshotSha256: string;
  databaseSchemaSha256: string;
  sqliteSnapshotMethod: "online_backup_api" | "vacuum_into_verified";
  sourceDbWalShmIdentitySha256: string;
  fileManifestSha256: string;
  totalBytes: number;
  releaseSha256: string;
  deploymentManifestSha256: string;
  projectionGeneration: number;
  projectionManifestSha256: string | null;
  projectionPointerSha256: string | null;
  writerEpoch: number;
  recoveryEpoch: number;
  writerAuthorityReceiptSha256: string;
  commonCheckpointSha256: string;
  recoveryPointAt: string;
  completedAt: string;
  rpoSeconds: number;
  offHostVerified: true;
  remoteReceiptSha256: string;
  encrypted: true;
  encryptionKeyVersion: string;
  retentionPolicyId: string;
  restoreDrillState: "verified" | "failed";
  restoreDurationSeconds: number | null;
  drillIsolated: 0 | 1;
  drillDecryptionVerified: 0 | 1;
  drillHashVerified: 0 | 1;
  drillIntegrityVerified: 0 | 1;
  drillFkVerified: 0 | 1;
  drillSchemaVerified: 0 | 1;
  drillBootable: 0 | 1;
  drillBusinessPointVerified: 0 | 1;
  drillPublicPointerVerified: 0 | 1;
  incidentDeclaredAt: string;
  adminAvailableAt: string;
  publicAvailableAt: string;
  operationId: string;
}>;

export type RecoveryIdentity = Readonly<{
  databaseIdentitySha256: string;
  schemaSha256: string;
  auditHeadSha256: string;
  outboxHeadSha256: string;
  publicGeneration: number;
  publicManifestSha256: string | null;
  publicPointerSha256: string | null;
  activePointerSha256: string | null;
  writerAuthorityReceiptSha256: string;
  writerEpoch: number;
  recoveryEpoch: number;
  commonCheckpointSha256: string;
  remoteReceiptSha256: string;
}>;

export type RecoveryValidationOptions = Readonly<{
  now?: number;
  expectedSchemaSha256?: string;
  expectedReleaseSha256?: string;
  expectedManifestSha256?: string;
  expectedWriterEpoch?: number;
  expectedRecoveryEpoch?: number;
}>;

function fail(code: string): never { throw new Error(code); }
function assert(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }
function hash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function validateHash(value: string, code = "RECOVERY_HASH_INVALID"): void { assert(HASH.test(value), code); }
function validateId(value: string, code = "RECOVERY_ID_INVALID"): void { assert(ID.test(value), code); }
function timestamp(value: string, code = "RECOVERY_TIMESTAMP_INVALID"): number {
  assert(UTC.test(value), code);
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), code);
  // Date.parse alone normalises impossible calendar dates in some runtimes.
  assert(new Date(parsed).toISOString() === value, code);
  return parsed;
}
function binary(value: number, code: string): 0 | 1 { assert(value === 0 || value === 1, code); return value; }

export function validateRecoveryPointReceipt(receipt: RecoveryPointReceipt, options: RecoveryValidationOptions = {}): RecoveryPointReceipt {
  assert(receipt !== null && typeof receipt === "object", "RECOVERY_POINT_INVALID");
  validateId(receipt.recoveryPointId); validateId(receipt.backupSetId); validateId(receipt.encryptionKeyVersion); validateId(receipt.retentionPolicyId); validateId(receipt.operationId);
  for (const field of HASH_FIELDS) validateHash(receipt[field]);
  assert(receipt.sqliteSnapshotMethod === "online_backup_api" || receipt.sqliteSnapshotMethod === "vacuum_into_verified", "RECOVERY_SNAPSHOT_METHOD_INVALID");
  assert(Number.isSafeInteger(receipt.totalBytes) && receipt.totalBytes > 0, "RECOVERY_TOTAL_BYTES_INVALID");
  assert(Number.isSafeInteger(receipt.projectionGeneration) && receipt.projectionGeneration >= 0, "RECOVERY_PROJECTION_GENERATION_INVALID");
  if (receipt.projectionGeneration === 0) assert(receipt.projectionManifestSha256 === null && receipt.projectionPointerSha256 === null, "RECOVERY_PROJECTION_PAIR_INVALID");
  else { assert(receipt.projectionManifestSha256 !== null && receipt.projectionPointerSha256 !== null, "RECOVERY_PROJECTION_PAIR_MISSING"); validateHash(receipt.projectionManifestSha256); validateHash(receipt.projectionPointerSha256); }
  for (const value of [receipt.writerEpoch, receipt.recoveryEpoch]) assert(Number.isSafeInteger(value) && value >= 1, "RECOVERY_EPOCH_INVALID");
  assert(Number.isSafeInteger(receipt.rpoSeconds) && receipt.rpoSeconds >= 0 && receipt.rpoSeconds <= 900, "RECOVERY_RPO_BREACH");
  assert(receipt.offHostVerified === true && receipt.encrypted === true, "RECOVERY_OFF_HOST_OR_ENCRYPTION_INVALID");
  const recoveryPointAt = timestamp(receipt.recoveryPointAt); const completedAt = timestamp(receipt.completedAt);
  assert(completedAt >= recoveryPointAt, "RECOVERY_COMPLETION_ORDER_INVALID");
  for (const value of [receipt.incidentDeclaredAt, receipt.adminAvailableAt, receipt.publicAvailableAt]) timestamp(value);
  assert(receipt.restoreDrillState === "verified" || receipt.restoreDrillState === "failed", "RECOVERY_DRILL_STATE_INVALID");
  if (receipt.restoreDrillState === "verified") {
    const restoreDurationSeconds = receipt.restoreDurationSeconds;
    assert(typeof restoreDurationSeconds === "number" && Number.isSafeInteger(restoreDurationSeconds) && restoreDurationSeconds >= 0 && restoreDurationSeconds <= 14400, "RECOVERY_RTO_BREACH");
    for (const [value, code] of [
      [receipt.drillIsolated, "RECOVERY_DRILL_ISOLATION_INVALID"],
      [receipt.drillDecryptionVerified, "RECOVERY_DRILL_DECRYPTION_INVALID"],
      [receipt.drillHashVerified, "RECOVERY_DRILL_HASH_INVALID"],
      [receipt.drillIntegrityVerified, "RECOVERY_DRILL_INTEGRITY_INVALID"],
      [receipt.drillFkVerified, "RECOVERY_DRILL_FK_INVALID"],
      [receipt.drillSchemaVerified, "RECOVERY_DRILL_SCHEMA_INVALID"],
      [receipt.drillBootable, "RECOVERY_DRILL_BOOT_INVALID"],
      [receipt.drillBusinessPointVerified, "RECOVERY_DRILL_BUSINESS_POINT_INVALID"],
      [receipt.drillPublicPointerVerified, "RECOVERY_DRILL_PUBLIC_POINTER_INVALID"]
    ] as const) assert(binary(value, code) === 1, code);
    const incident = Date.parse(receipt.incidentDeclaredAt);
    assert(Math.max(Date.parse(receipt.adminAvailableAt), Date.parse(receipt.publicAvailableAt)) - incident <= 14400000, "RECOVERY_RTO_BREACH");
  } else {
    // A failed drill is retained for audit but cannot be a valid recovery
    // point.  This explicit failure keeps callers from treating a row as
    // eligible merely because its hash fields are present.
    fail("RECOVERY_DRILL_FAILED");
  }
  if (options.now !== undefined) assert(completedAt <= options.now, "RECOVERY_COMPLETION_IN_FUTURE");
  if (options.expectedSchemaSha256 !== undefined) assert(receipt.databaseSchemaSha256 === options.expectedSchemaSha256, "RECOVERY_SCHEMA_MISMATCH");
  if (options.expectedReleaseSha256 !== undefined) assert(receipt.releaseSha256 === options.expectedReleaseSha256, "RECOVERY_RELEASE_MISMATCH");
  if (options.expectedManifestSha256 !== undefined) assert(receipt.deploymentManifestSha256 === options.expectedManifestSha256, "RECOVERY_MANIFEST_MISMATCH");
  if (options.expectedWriterEpoch !== undefined) assert(receipt.writerEpoch === options.expectedWriterEpoch, "RECOVERY_WRITER_EPOCH_MISMATCH");
  if (options.expectedRecoveryEpoch !== undefined) assert(receipt.recoveryEpoch === options.expectedRecoveryEpoch, "RECOVERY_EPOCH_MISMATCH");
  return receipt;
}

export function recoveryPointIdentityHash(receipt: RecoveryPointReceipt): string {
  validateRecoveryPointReceipt(receipt);
  return hash(`f1plus1-recovery-point-v1\n${canonicalJsonV1(receipt)}`);
}

function requiredHashRow(row: Record<string, unknown>, key: string): string { const value = row[key]; assert(typeof value === "string", `RECOVERY_${key.toUpperCase()}_MISSING`); validateHash(value, `RECOVERY_${key.toUpperCase()}_INVALID`); return value; }
function requiredIntRow(row: Record<string, unknown>, key: string): number { const value = Number(row[key]); assert(Number.isSafeInteger(value) && value >= 0, `RECOVERY_${key.toUpperCase()}_INVALID`); return value; }

/** Strictly bind a recovery point to the current DB/control/public pointer. */
export function assertRecoveryPointBinding(database: DatabaseSync, receipt: RecoveryPointReceipt, expected: RecoveryValidationOptions = {}): RecoveryIdentity {
  validateRecoveryPointReceipt(receipt, expected);
  assert(reviewRealSchemaFingerprint(database) === receipt.databaseSchemaSha256, "RECOVERY_SCHEMA_FINGERPRINT_MISMATCH");
  const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown> | undefined;
  assert(control !== undefined, "RECOVERY_CONTROL_MISSING");
  const anchor = database.prepare("SELECT * FROM projection_recovery_anchor WHERE singleton_id=1").get() as Record<string, unknown> | undefined;
  assert(anchor !== undefined, "RECOVERY_POINTER_ANCHOR_MISSING");
  const audit = database.prepare("SELECT event_hash FROM internal_operation_audit ORDER BY audit_seq DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  const outbox = database.prepare("SELECT outbox_id,payload_hash,state,version FROM internal_operation_outbox ORDER BY outbox_id DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  assert(audit !== undefined && typeof audit.event_hash === "string", "RECOVERY_AUDIT_HEAD_MISSING");
  assert(outbox !== undefined && typeof outbox.payload_hash === "string", "RECOVERY_OUTBOX_HEAD_MISSING");
  validateHash(String(audit.event_hash)); validateHash(String(outbox.payload_hash));
  const writerEpoch = requiredIntRow(control, "writer_epoch"); const recoveryEpoch = requiredIntRow(control, "recovery_epoch");
  assert(receipt.writerEpoch === writerEpoch && receipt.recoveryEpoch === recoveryEpoch, "RECOVERY_CONTROL_EPOCH_MISMATCH");
  assert(receipt.writerAuthorityReceiptSha256 === requiredHashRow(control, "writer_authority_receipt_sha256"), "RECOVERY_WRITER_RECEIPT_MISMATCH");
  assert(receipt.commonCheckpointSha256 === requiredHashRow(anchor, "common_checkpoint_sha256"), "RECOVERY_CHECKPOINT_MISMATCH");
  const publicGeneration = requiredIntRow(anchor, "active_generation");
  assert(receipt.projectionGeneration === publicGeneration, "RECOVERY_PUBLIC_GENERATION_MISMATCH");
  assert(receipt.projectionManifestSha256 === (anchor.active_manifest_sha256 as string | null), "RECOVERY_PUBLIC_MANIFEST_MISMATCH");
  assert(receipt.projectionPointerSha256 === (anchor.active_pointer_sha256 as string | null), "RECOVERY_PUBLIC_POINTER_MISMATCH");
  assert(receipt.remoteReceiptSha256 === requiredHashRow(receipt as unknown as Record<string, unknown>, "remoteReceiptSha256"), "RECOVERY_REMOTE_RECEIPT_MISSING");
  return Object.freeze({
    databaseIdentitySha256: receipt.databaseSnapshotSha256,
    schemaSha256: receipt.databaseSchemaSha256,
    auditHeadSha256: String(audit.event_hash),
    outboxHeadSha256: String(outbox.payload_hash),
    publicGeneration,
    publicManifestSha256: anchor.active_manifest_sha256 as string | null,
    publicPointerSha256: anchor.active_pointer_sha256 as string | null,
    activePointerSha256: anchor.active_pointer_sha256 as string | null,
    writerAuthorityReceiptSha256: requiredHashRow(control, "writer_authority_receipt_sha256"),
    writerEpoch,
    recoveryEpoch,
    commonCheckpointSha256: requiredHashRow(anchor, "common_checkpoint_sha256"),
    remoteReceiptSha256: receipt.remoteReceiptSha256
  });
}
