import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, openSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { inspectExistingPrivateDatabase, openExistingSafeDatabase } from "../src/server/db/database.ts";
import { canonicalJson } from "../src/server/db/profile.ts";
import type { OwnerSupervisorHandoff } from "../src/server/internal-operation/gateway.ts";
import { persistOwnerSupervisorHandoff } from "../src/server/internal-operation/owner-supervisor.ts";

const DB_PATH = "/Users/chanai/F1-1-website/app/.local/f1plus1-rss-real-private.sqlite";
const RECEIPT_PATH = "/Users/chanai/Library/Application Support/F1Plus1/Admin/v10-cutover/owner-handoff-21441514.receipt.json";
const NODE_PATH = "/Users/chanai/.local/node-v24.18.0-darwin-arm64/bin/node";
const RELEASE_SHA256 = "2144151406ba1c4755136470d8b81e256782e68efef1a9ef532b3d19fd39df56";
const MANIFEST_SHA256 = "ec36a18e03ba7cfce384065895614ab1bc2f044537e9a045764d9d835e9045a7";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

if (
  process.version !== "v24.18.0" || process.execPath !== NODE_PATH ||
  process.env.F1_USER_DEPLOY_AUTHORIZED !== "1" ||
  process.env.F1_OWNER_HANDOFF_RELEASE_SHA256 !== RELEASE_SHA256 ||
  process.env.F1_OWNER_HANDOFF_MANIFEST_SHA256 !== MANIFEST_SHA256
) throw new Error("OWNER_HANDOFF_BOOTSTRAP_INPUT_INVALID");

process.umask(0o077);
const now = Date.now();
const verifiedAt = new Date(now).toISOString();
const expiresAt = new Date(now + 30 * 60_000).toISOString();
const core = Object.freeze({
  schemaVersion: "owner-supervisor-handoff-v1" as const,
  handoffId: `admin-bootstrap-${now}`,
  ownerProcess: "admin_http" as const,
  issuer: "f1plus1-owner-supervisor-v1" as const,
  oneTimeNonce: randomBytes(32).toString("base64url"),
  releaseSha256: RELEASE_SHA256,
  manifestSha256: MANIFEST_SHA256,
  verifiedAt,
  expiresAt,
  authorizationSource: "user-explicit-production-deployment"
});
const receiptSha256 = sha256(canonicalJson(core));
const handoff: OwnerSupervisorHandoff = Object.freeze({
  schemaVersion: core.schemaVersion,
  handoffId: core.handoffId,
  ownerProcess: core.ownerProcess,
  issuer: core.issuer,
  oneTimeNonce: core.oneTimeNonce,
  releaseSha256: core.releaseSha256,
  manifestSha256: core.manifestSha256,
  receiptSha256,
  verifiedAt: core.verifiedAt,
  expiresAt: core.expiresAt
});

const identity = inspectExistingPrivateDatabase(DB_PATH, "f1plus1-rss-real-private.sqlite");
const database: DatabaseSync = openExistingSafeDatabase(DB_PATH, "f1plus1-rss-real-private.sqlite", identity, [10]);
try {
  persistOwnerSupervisorHandoff(database, handoff, (candidate) =>
    candidate.handoffId === core.handoffId &&
    candidate.ownerProcess === core.ownerProcess &&
    candidate.issuer === core.issuer &&
    candidate.oneTimeNonce === core.oneTimeNonce &&
    candidate.releaseSha256 === core.releaseSha256 &&
    candidate.manifestSha256 === core.manifestSha256 &&
    candidate.verifiedAt === core.verifiedAt &&
    candidate.expiresAt === core.expiresAt &&
    candidate.receiptSha256 === receiptSha256
  );
} finally {
  database.close();
}

const descriptor = openSync(RECEIPT_PATH, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
try {
  writeFileSync(descriptor, canonicalJson({ ...core, receiptSha256, productionDatabaseWrites: 1, externalCalls: 0 }));
  fsyncSync(descriptor);
} finally {
  closeSync(descriptor);
}
process.stdout.write(`${JSON.stringify({ status: "OWNER_HANDOFF_BOOTSTRAPPED", handoffId: handoff.handoffId, expiresAt, receiptSha256 })}\n`);
