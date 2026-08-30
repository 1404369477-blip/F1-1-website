import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { canonicalJson } from "../db/profile.ts";

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

export function writeRecoveryFenceAfterRegistration(input: Readonly<{
  fencePath: string;
  recoveryPointAt: string;
  completedAt: string;
  controlUpdatedAt: string;
  now?: () => Date;
}>): RecoveryFenceWriteReceipt {
  assert(isAbsolute(input.fencePath), "RECOVERY_FENCE_PATH_MUST_BE_ABSOLUTE");
  const fencePath = resolve(input.fencePath);
  const parent = dirname(fencePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertWritableFenceParent(parent);
  const nowMs = (input.now ?? (() => new Date()))().getTime();
  const recoveryPointAtMs = Date.parse(input.recoveryPointAt);
  const completedAtMs = Date.parse(input.completedAt);
  const controlUpdatedAtMs = Date.parse(input.controlUpdatedAt);
  assert(Number.isFinite(recoveryPointAtMs) && Number.isFinite(completedAtMs) && Number.isFinite(controlUpdatedAtMs), "RECOVERY_FENCE_TIMESTAMP_INVALID");
  const trust = evaluateClockTrusted({ nowMs, recoveryPointAtMs, completedAtMs, controlUpdatedAtMs });
  const after: RecoveryFenceV1 = Object.freeze({
    schemaVersion: RECOVERY_FENCE_SCHEMA_VERSION,
    clockTrusted: trust.clockTrusted,
    writerReady: true,
    lastSuccessfulRecoveryPointAt: recoveryPointAtMs
  });
  let before: RecoveryFenceV1 | null = null;
  if (existsSync(fencePath)) {
    const stat = lstatSync(fencePath);
    assert(stat.isFile() && !stat.isSymbolicLink(), "RECOVERY_FENCE_NOT_REGULAR");
    before = parseFence(readFileSync(fencePath, "utf8"));
  }
  const encoded = canonicalJson(after);
  const temporary = `${fencePath}.stage-${randomUUID()}`;
  try {
    const descriptor = openSync(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      0o600
    );
    try {
      writeFileSync(descriptor, encoded, { encoding: "utf8" });
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    chmodSync(temporary, 0o600);
    renameSync(temporary, fencePath);
    chmodSync(fencePath, 0o600);
    fsyncDirectory(parent);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return Object.freeze({
    schemaVersion: "recovery-fence-write-receipt-v1",
    pathSha256: sha256Text(fencePath),
    before,
    after,
    clockTrustedReason: trust.reason
  });
}
