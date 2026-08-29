import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../db/profile.ts";
import type { OwnerProcess, OwnerSupervisorHandoff } from "./gateway.ts";
import {
  persistOwnerSupervisorHandoff,
  type OwnerSupervisorReceiptVerifier
} from "./owner-supervisor.ts";

export const HANDOFF_POOL_OWNERS = [
  "rss_collector",
  "rss_refiner",
  "bilingual_refiner",
  "projection_sender"
] as const;

export type HandoffPoolOwner = (typeof HANDOFF_POOL_OWNERS)[number];

export const FORBIDDEN_AUTOMATIC_HANDOFF_OWNERS = [
  "automatic_reviewer",
  "automatic_publisher"
] as const;

export const HANDOFF_POOL_MAX_PER_OWNER = 4 as const;
export const HANDOFF_POOL_TTL_MS = 900_000 as const;
export const HANDOFF_POOL_SCHEMA_VERSION = "owner-supervisor-handoff-v1" as const;
export const HANDOFF_POOL_ISSUER = "f1plus1-owner-supervisor-v1" as const;

const HASH = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type HandoffPoolReceipt = Readonly<{
  handoffId: string;
  ownerProcess: HandoffPoolOwner;
  verifiedAt: string;
  expiresAt: string;
}>;

export type TopUpOwnerHandoffPoolInput = Readonly<{
  database: DatabaseSync;
  ownerProcess: string;
  count: number;
  releaseSha256: string;
  manifestSha256: string;
  now?: number;
  verifyReceipt?: OwnerSupervisorReceiptVerifier;
}>;

export type TopUpOwnerHandoffPoolResult = Readonly<{
  ownerProcess: HandoffPoolOwner;
  requested: number;
  created: number;
  active: number;
  cap: number;
  expiresAt: string;
  handoffIds: readonly string[];
}>;

function fail(code: string): never {
  throw new Error(code);
}

function assertPoolOwner(value: string): asserts value is HandoffPoolOwner {
  if ((FORBIDDEN_AUTOMATIC_HANDOFF_OWNERS as readonly string[]).includes(value)) {
    fail("HANDOFF_POOL_AUTOMATIC_OWNER_FORBIDDEN");
  }
  if (!(HANDOFF_POOL_OWNERS as readonly string[]).includes(value)) {
    fail("HANDOFF_POOL_OWNER_NOT_ALLOWLISTED");
  }
}

function validateHash(value: string): void {
  if (!HASH.test(value)) fail("HANDOFF_POOL_IDENTITY_HASH_INVALID");
}

function activeHandoffCount(database: DatabaseSync, ownerProcess: string, now: string): number {
  const row = database.prepare(
    "SELECT COUNT(*) AS count FROM owner_authorization_handoff WHERE owner_process=? AND consumed_by_operation_id IS NULL AND expires_at>?"
  ).get(ownerProcess, now) as Record<string, unknown>;
  const count = Number(row.count);
  if (!Number.isSafeInteger(count) || count < 0) fail("HANDOFF_POOL_COUNT_READ_INVALID");
  return count;
}

export function strictGeneratedReceiptVerifier(expected: OwnerSupervisorHandoff): OwnerSupervisorReceiptVerifier {
  return (candidate) => candidate === expected || (
    candidate.handoffId === expected.handoffId &&
    candidate.ownerProcess === expected.ownerProcess &&
    candidate.issuer === expected.issuer &&
    candidate.oneTimeNonce === expected.oneTimeNonce &&
    candidate.releaseSha256 === expected.releaseSha256 &&
    candidate.manifestSha256 === expected.manifestSha256 &&
    candidate.receiptSha256 === expected.receiptSha256 &&
    candidate.verifiedAt === expected.verifiedAt &&
    candidate.expiresAt === expected.expiresAt &&
    candidate.schemaVersion === expected.schemaVersion
  );
}

/**
 * Add a bounded number of one-time handoffs for one allowlisted owner.
 * Expired or consumed rows remain as history; they are never deleted here.
 */
export function topUpOwnerHandoffPool(input: TopUpOwnerHandoffPoolInput): TopUpOwnerHandoffPoolResult {
  assertPoolOwner(input.ownerProcess);
  validateHash(input.releaseSha256);
  validateHash(input.manifestSha256);
  if (!Number.isSafeInteger(input.count) || input.count < 1 || input.count > HANDOFF_POOL_MAX_PER_OWNER) {
    fail("HANDOFF_POOL_COUNT_INVALID");
  }
  const nowMs = input.now ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail("HANDOFF_POOL_CLOCK_INVALID");
  const verifiedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + HANDOFF_POOL_TTL_MS).toISOString();
  if (!UTC.test(verifiedAt) || !UTC.test(expiresAt)) fail("HANDOFF_POOL_TIMESTAMP_INVALID");

  const before = activeHandoffCount(input.database, input.ownerProcess, verifiedAt);
  const remaining = HANDOFF_POOL_MAX_PER_OWNER - before;
  const created = Math.min(input.count, remaining);
  if (created < 0) fail("HANDOFF_POOL_CAPACITY_INVALID");
  const handoffIds: string[] = [];

  for (let ordinal = 0; ordinal < created; ordinal += 1) {
    const handoffId = `handoff-pool-${nowMs}-${randomBytes(12).toString("base64url")}`;
    const core = Object.freeze({
      schemaVersion: HANDOFF_POOL_SCHEMA_VERSION,
      handoffId,
      ownerProcess: input.ownerProcess,
      issuer: HANDOFF_POOL_ISSUER,
      oneTimeNonce: randomBytes(32).toString("base64url"),
      releaseSha256: input.releaseSha256,
      manifestSha256: input.manifestSha256,
      verifiedAt,
      expiresAt
    });
    const receiptSha256 = createHash("sha256").update(canonicalJson(core)).digest("hex");
    const handoff: OwnerSupervisorHandoff = Object.freeze({
      schemaVersion: core.schemaVersion,
      handoffId: core.handoffId,
      ownerProcess: core.ownerProcess as OwnerProcess,
      issuer: core.issuer,
      oneTimeNonce: core.oneTimeNonce,
      releaseSha256: core.releaseSha256,
      manifestSha256: core.manifestSha256,
      receiptSha256,
      verifiedAt: core.verifiedAt,
      expiresAt: core.expiresAt
    });
    persistOwnerSupervisorHandoff(input.database, handoff, input.verifyReceipt ?? strictGeneratedReceiptVerifier(handoff));
    handoffIds.push(handoff.handoffId);
  }

  const active = activeHandoffCount(input.database, input.ownerProcess, verifiedAt);
  if (active > HANDOFF_POOL_MAX_PER_OWNER) fail("HANDOFF_POOL_CAPACITY_EXCEEDED");
  return Object.freeze({
    ownerProcess: input.ownerProcess,
    requested: input.count,
    created,
    active,
    cap: HANDOFF_POOL_MAX_PER_OWNER,
    expiresAt,
    handoffIds: Object.freeze(handoffIds)
  });
}
