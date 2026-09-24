import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  rmdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { canonicalJson } from "../db/profile.ts";
import type { DatabaseSync } from "node:sqlite";
import { reviewRealSchemaFingerprint } from "../review-real/migration.ts";

export const RECOVERY_FENCE_SCHEMA_VERSION = "admin-recovery-fence-v1" as const;

/**
 * Clock-trust window for recovery-fence.json.
 *
 * clockTrusted is a skew check, not a freshness check. Freshness is
 * assertRecoveryFence's 15-minute lastSuccessfulRecoveryPointAt window.
 * A trusted clock means none of the compared timestamps sit more than
 * CLOCK_SKEW_MAX_MS in the future relative to the writer clock. Past
 * SNAP recovery_point_at values are allowed (old packages stay registerable).
 */
export const CLOCK_SKEW_MAX_MS = 120_000;

export type RecoveryFenceV1 = Readonly<{
  schemaVersion: typeof RECOVERY_FENCE_SCHEMA_VERSION;
  clockTrusted: boolean;
  writerReady: boolean;
  lastSuccessfulRecoveryPointAt: number | null;
}>;

export type RecoveryFenceWriteReceipt = Readonly<{
  schemaVersion: "recovery-fence-write-receipt-v1";
  pathSha256: string;
  before: RecoveryFenceV1 | null;
  after: RecoveryFenceV1;
  clockTrustedReason: string;
}>;

function fail(code: string): never { throw new Error(code); }
function assert(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function assertWritableFenceParent(path: string): void {
  const stat = lstatSync(path);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o022) === 0, "RECOVERY_FENCE_PARENT_INVALID");
}

function parseFence(raw: string): RecoveryFenceV1 {
  const value = JSON.parse(raw) as unknown;
  assert(value !== null && typeof value === "object", "RECOVERY_FENCE_INVALID");
  const record = value as Record<string, unknown>;
  assert(record.schemaVersion === RECOVERY_FENCE_SCHEMA_VERSION, "RECOVERY_FENCE_SCHEMA_INVALID");
  assert(typeof record.clockTrusted === "boolean" && typeof record.writerReady === "boolean", "RECOVERY_FENCE_INVALID");
  const last = record.lastSuccessfulRecoveryPointAt;
  assert(last === null || (typeof last === "number" && Number.isSafeInteger(last) && last >= 0), "RECOVERY_FENCE_LAST_AT_INVALID");
  const fence: RecoveryFenceV1 = Object.freeze({
    schemaVersion: RECOVERY_FENCE_SCHEMA_VERSION,
    clockTrusted: record.clockTrusted,
    writerReady: record.writerReady,
    lastSuccessfulRecoveryPointAt: last === null ? null : last
  });
  assert(canonicalJson(fence) === raw, "RECOVERY_FENCE_CANONICAL_MISMATCH");
  return fence;
}

export function evaluateClockTrusted(input: Readonly<{
  nowMs: number;
  recoveryPointAtMs: number;
  completedAtMs: number;
  controlUpdatedAtMs: number;
}>): { clockTrusted: boolean; reason: string } {
  const futureSkew = Math.max(
    input.recoveryPointAtMs - input.nowMs,
    input.completedAtMs - input.nowMs,
    input.controlUpdatedAtMs - input.nowMs
  );
  if (futureSkew > CLOCK_SKEW_MAX_MS) {
    return Object.freeze({
      clockTrusted: false,
      reason: `future-skew ${futureSkew}ms exceeds ${CLOCK_SKEW_MAX_MS}ms against SNAP recovery_point_at / completed_at / internal_control.updated_at`
    });
  }
  return Object.freeze({
    clockTrusted: true,
    reason: `no compared timestamp is more than ${CLOCK_SKEW_MAX_MS}ms ahead of the writer clock`
  });
}

/** Every runtime and deployment writer of this file must share this lock. Never auto-break it. */
export function withRecoveryFenceWriterLock<T>(fencePath: string, action: () => T): T {
  assert(isAbsolute(fencePath), "RECOVERY_FENCE_PATH_MUST_BE_ABSOLUTE");
  const parent = dirname(resolve(fencePath));
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertWritableFenceParent(parent);
  const lock = `${resolve(fencePath)}.writer-lock`;
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("RECOVERY_FENCE_WRITER_BUSY");
    throw error;
  }
  try { return action(); } finally { rmdirSync(lock); }
}

export function writeRecoveryFenceAfterRegistration(input: Readonly<{
  database: DatabaseSync; fencePath: string; recoveryPointId: string; recoveryPointAt: string; completedAt: string;
  expectedWriterEpoch: number; expectedRecoveryEpoch: number; expectedWriterAuthority: string;
  schemaSha256: string; now?: () => Date;
}>): RecoveryFenceWriteReceipt {
  return withRecoveryFenceWriterLock(input.fencePath, () => {
    // SQLite's reserved writer lock protects against every control writer, including
    // other connections/processes; the file mutex covers deployment and recovery writers.
    input.database.exec("BEGIN IMMEDIATE");
    try {
      const result = writeLocked(input);
      input.database.exec("COMMIT");
      return result;
    } catch (error) {
      input.database.exec("ROLLBACK");
      throw error;
    }
  });
}

function writeLocked(input: Parameters<typeof writeRecoveryFenceAfterRegistration>[0]): RecoveryFenceWriteReceipt {
  const fencePath = resolve(input.fencePath);
  const parent = dirname(fencePath);
  assert(existsSync(fencePath), "RECOVERY_FENCE_MISSING_REQUIRES_ACTIVATION");
  const stat = lstatSync(fencePath);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, "RECOVERY_FENCE_NOT_REGULAR");
  const before = parseFence(readFileSync(fencePath, "utf8"));
  assert(before.writerReady, "RECOVERY_FENCE_WRITER_NOT_READY");
  const row = input.database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown> | undefined;
  assert(row && Number(row.writer_epoch) === input.expectedWriterEpoch && Number(row.recovery_epoch) === input.expectedRecoveryEpoch && row.writer_authority_receipt_sha256 === input.expectedWriterAuthority, "RECOVERY_FENCE_IDENTITY_CHANGED");
  assert(reviewRealSchemaFingerprint(input.database) === input.schemaSha256, "RECOVERY_FENCE_SCHEMA_CHANGED");
  assert(row.recovery_state === "ready", "RECOVERY_FENCE_CONTROL_NOT_READY");
  const point = input.database.prepare("SELECT * FROM valid_backup_recovery_point_v1 WHERE recovery_point_id=?").get(input.recoveryPointId) as Record<string, unknown> | undefined;
  assert(point && point.recovery_point_at === input.recoveryPointAt && point.completed_at === input.completedAt &&
    Number(point.writer_epoch) === input.expectedWriterEpoch && Number(point.recovery_epoch) === input.expectedRecoveryEpoch &&
    point.writer_authority_receipt_sha256 === input.expectedWriterAuthority && point.database_schema_sha256 === input.schemaSha256,
    "RECOVERY_FENCE_REGISTERED_POINT_MISMATCH");
  const nowMs = (input.now ?? (() => new Date()))().getTime();
  const recoveryPointAtMs = Date.parse(input.recoveryPointAt);
  const completedAtMs = Date.parse(input.completedAt);
  const controlUpdatedAtMs = Date.parse(String(row.updated_at));
  assert(Number.isFinite(nowMs) && Number.isFinite(recoveryPointAtMs) && Number.isFinite(completedAtMs) && Number.isFinite(controlUpdatedAtMs), "RECOVERY_FENCE_TIMESTAMP_INVALID");
  assert(recoveryPointAtMs <= nowMs && nowMs - recoveryPointAtMs <= 900_000 && completedAtMs <= nowMs, "RECOVERY_FENCE_RPO_BREACH");
  const trust = evaluateClockTrusted({ nowMs, recoveryPointAtMs, completedAtMs, controlUpdatedAtMs });
  assert(trust.clockTrusted, "RECOVERY_FENCE_CLOCK_UNTRUSTED");
  const after: RecoveryFenceV1 = Object.freeze({
    schemaVersion: RECOVERY_FENCE_SCHEMA_VERSION,
    clockTrusted: trust.clockTrusted,
    writerReady: before.writerReady,
    lastSuccessfulRecoveryPointAt: Math.max(before.lastSuccessfulRecoveryPointAt ?? 0, recoveryPointAtMs)
  });
  const encoded = canonicalJson(after);
  const temporary = `${fencePath}.stage-${randomUUID()}`;
  try {
    const descriptor = openSync(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    try { writeFileSync(descriptor, encoded, { encoding: "utf8" }); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    chmodSync(temporary, 0o600);
    renameSync(temporary, fencePath);
    fsyncDirectory(parent);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return Object.freeze({ schemaVersion: "recovery-fence-write-receipt-v1", pathSha256: sha256Text(fencePath), before, after, clockTrustedReason: trust.reason });
}
