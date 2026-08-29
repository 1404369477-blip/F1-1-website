import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "../db/database.ts";
import {
  getInstalledSqliteAuthorizer,
  installSqliteAuthorizer
} from "./authorizer.ts";
import type { OwnerProcess, OwnerSupervisorHandoff } from "./gateway.ts";

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function fail(code: string): never { throw new Error(code); }
function assert(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }

function validateHash(value: string): void { assert(HASH.test(value), "HANDOFF_HASH_INVALID"); }
function validateTimestamp(value: string): number {
  assert(UTC.test(value), "HANDOFF_TIMESTAMP_INVALID");
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), "HANDOFF_TIMESTAMP_INVALID");
  return parsed;
}

/**
 * Validate the DB-external owner-supervisor receipt before it is persisted.
 * The receipt is deliberately closed: no arbitrary JSON or self-selected
 * capability fields are accepted at the gateway boundary.
 */
export function validateOwnerSupervisorHandoff(handoff: OwnerSupervisorHandoff, now = Date.now()): OwnerSupervisorHandoff {
  assert(handoff !== null && typeof handoff === "object", "HANDOFF_INVALID");
  assert(ID.test(handoff.handoffId), "HANDOFF_ID_INVALID");
  assert(typeof handoff.ownerProcess === "string" && handoff.ownerProcess.length > 0, "HANDOFF_OWNER_INVALID");
  assert(handoff.issuer === "f1plus1-owner-supervisor-v1", "HANDOFF_ISSUER_INVALID");
  assert(NONCE.test(handoff.oneTimeNonce), "HANDOFF_NONCE_INVALID");
  validateHash(handoff.releaseSha256); validateHash(handoff.manifestSha256); validateHash(handoff.receiptSha256);
  const verifiedAt = validateTimestamp(handoff.verifiedAt);
  const expiresAt = validateTimestamp(handoff.expiresAt);
  assert(expiresAt > verifiedAt && expiresAt > now, "HANDOFF_EXPIRED");
  return handoff;
}

export type OwnerSupervisorReceiptVerifier = (handoff: OwnerSupervisorHandoff) => boolean;

/**
 * Persist a supervisor-issued handoff before a gateway is installed.  The
 * verifier is mandatory so a caller cannot manufacture a capability merely by
 * supplying matching release hashes.  This function performs only local
 * SQLite I/O; it never contacts a provider or a filesystem path.
 */
export function persistOwnerSupervisorHandoff(
  database: DatabaseSync,
  handoff: OwnerSupervisorHandoff,
  verifyReceipt: OwnerSupervisorReceiptVerifier
): void {
  validateOwnerSupervisorHandoff(handoff);
  assert(verifyReceipt(handoff) === true, "HANDOFF_RECEIPT_UNVERIFIED");
  const existing = getInstalledSqliteAuthorizer(database);
  assert(existing === null || existing.profile === "worker_or_repository", "HANDOFF_GATEWAY_ALREADY_INSTALLED");
  if (existing) existing.uninstall();
  const authorizer = installSqliteAuthorizer(database, "owner_supervisor_writer");
  try {
    withImmediateTransaction(database, () => {
      const duplicate = database.prepare("SELECT handoff_id FROM owner_authorization_handoff WHERE handoff_id=? OR one_time_nonce=? OR receipt_sha256=?").get(handoff.handoffId, handoff.oneTimeNonce, handoff.receiptSha256);
      assert(duplicate === undefined, "HANDOFF_ALREADY_EXISTS");
      database.prepare("INSERT INTO owner_authorization_handoff(handoff_id,owner_process,issuer,one_time_nonce,release_sha256,manifest_sha256,receipt_sha256,verified_at,expires_at,consumed_by_operation_id) VALUES(?,?,?,?,?,?,?,?,?,NULL)")
        .run(handoff.handoffId, handoff.ownerProcess, handoff.issuer, handoff.oneTimeNonce, handoff.releaseSha256, handoff.manifestSha256, handoff.receiptSha256, handoff.verifiedAt, handoff.expiresAt);
    });
  } finally {
    authorizer.uninstall();
    if (existing) installSqliteAuthorizer(database, "worker_or_repository");
  }
}

export function assertOwnerProcess(value: string): asserts value is OwnerProcess {
  const owners: readonly OwnerProcess[] = [
    "rss_collector", "rss_refiner", "automatic_reviewer", "automatic_publisher",
    "projection_sender", "projection_receiver", "x_official_adapter", "bilingual_refiner",
    "admin_http", "admin_telemetry_producer", "backup_worker", "restore_operator",
    "system_supervisor", "reconciler"
  ];
  assert(owners.includes(value as OwnerProcess), "HANDOFF_OWNER_INVALID");
}
