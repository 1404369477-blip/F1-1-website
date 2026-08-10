import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";

import { canonicalSourceJson } from "../providers/source-fixture.ts";
import { AdminError, type CommandIdentity } from "./types.ts";

export type RandomBytes = (size: number) => Buffer;

const COMMAND_OPERATION = /^op-cmd-[a-f0-9]{64}$/;
const COMMAND_KEY = /^cmd-key:[a-f0-9]{64}$/;
const BUSINESS_OPERATION = /^op-srcact-[a-f0-9]{64}$/;
const BUSINESS_KEY = /^srcact-key:[a-f0-9]{64}$/;
const JOB_ID = /^job-srcact-[a-f0-9]{64}$/;
const TASK_ID = /^task-srcact-[a-f0-9]{64}$/;
const LIVE_LEASE = /^synthetic:lease:[a-f0-9]{32}$/;
export const SEED_LEASE = "synthetic:lease:00000000000000000000000000000000";

export type BusinessIdentity = Readonly<{
  businessOperationId: string;
  businessIdempotencyKey: string;
  jobId: string;
  taskId: string;
}>;

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalHash(value: unknown): string {
  return sha256(canonicalSourceJson(value));
}

export function assertCommandIdentity(identity: CommandIdentity): void {
  if (!COMMAND_OPERATION.test(identity.command_operation_id) || !COMMAND_KEY.test(identity.command_idempotency_key)) {
    throw new AdminError("ADMIN_COMMAND_IDENTITY_INVALID", 422);
  }
}

export function assertBusinessIdentity(identity: BusinessIdentity): void {
  if (
    !BUSINESS_OPERATION.test(identity.businessOperationId) ||
    !BUSINESS_KEY.test(identity.businessIdempotencyKey) ||
    !JOB_ID.test(identity.jobId) ||
    !TASK_ID.test(identity.taskId)
  ) {
    throw new AdminError("ADMIN_BUSINESS_IDENTITY_INTEGRITY_FAILURE", 409);
  }
}

export function assertLiveLease(value: string): void {
  if (!LIVE_LEASE.test(value) || value === SEED_LEASE) {
    throw new AdminError("ADMIN_BUSINESS_IDENTITY_INTEGRITY_FAILURE", 409);
  }
}

export function generateBusinessIdentity(
  exists: (candidate: BusinessIdentity) => boolean,
  randomBytes: RandomBytes = nodeRandomBytes
): BusinessIdentity {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let candidate: BusinessIdentity;
    try {
      candidate = {
        businessOperationId: `op-srcact-${randomBytes(32).toString("hex")}`,
        businessIdempotencyKey: `srcact-key:${randomBytes(32).toString("hex")}`,
        jobId: `job-srcact-${randomBytes(32).toString("hex")}`,
        taskId: `task-srcact-${randomBytes(32).toString("hex")}`
      };
    } catch {
      throw new AdminError("ADMIN_BUSINESS_IDENTITY_GENERATION_FAILED", 500);
    }
    assertBusinessIdentity(candidate);
    if (!exists(candidate)) return candidate;
  }
  throw new AdminError("ADMIN_BUSINESS_IDENTITY_GENERATION_FAILED", 500);
}

export function generateLiveLease(
  exists: (candidate: string) => boolean,
  randomBytes: RandomBytes = nodeRandomBytes
): string {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let candidate: string;
    try {
      candidate = `synthetic:lease:${randomBytes(16).toString("hex")}`;
    } catch {
      throw new AdminError("ADMIN_LEASE_IDENTITY_GENERATION_FAILED", 500);
    }
    assertLiveLease(candidate);
    if (!exists(candidate)) return candidate;
  }
  throw new AdminError("ADMIN_LEASE_IDENTITY_GENERATION_FAILED", 500);
}

export function sourceIdentity(platform: string, rawUrl: string): {
  sourceId: string;
  fullIdentityHash: string;
} {
  const fullIdentityHash = sha256(canonicalSourceJson({ platform, raw_url: rawUrl }));
  return { sourceId: `src-local-${fullIdentityHash.slice(0, 24)}`, fullIdentityHash };
}

export const IDENTITY_TEST_VECTORS = Object.freeze({
  commandOperation: `op-cmd-${Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString("hex")}`,
  commandKey: `cmd-key:${Buffer.from(Array.from({ length: 32 }, (_, index) => index + 0x20)).toString("hex")}`,
  businessOperation: `op-srcact-${Buffer.from(Array.from({ length: 32 }, (_, index) => index + 0x40)).toString("hex")}`,
  businessKey: `srcact-key:${Buffer.from(Array.from({ length: 32 }, (_, index) => index + 0x60)).toString("hex")}`,
  taskId: `task-srcact-${Buffer.from(Array.from({ length: 32 }, (_, index) => index + 0x80)).toString("hex")}`,
  jobId: `job-srcact-${Buffer.from(Array.from({ length: 32 }, (_, index) => index + 0xa0)).toString("hex")}`,
  liveLease: `synthetic:lease:${Buffer.from(Array.from({ length: 16 }, (_, index) => index + 0xc0)).toString("hex")}`
});
