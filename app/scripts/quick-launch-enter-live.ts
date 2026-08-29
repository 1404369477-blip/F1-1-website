import { createHash, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename as databaseBasename, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadReleaseRuntimeGate } from "../src/server/internal-operation/release.ts";
import { canonicalJsonV1, SqliteInternalOperationGateway, type OwnerProcess, type OwnerSupervisorHandoff } from "../src/server/internal-operation/gateway.ts";
import { canonicalJson } from "../src/server/db/profile.ts";
import { openExistingSafeDatabase } from "../src/server/db/database.ts";
import { readAdminDeploymentManifest } from "../src/server/admin-service/deployment.ts";
import { readVerifiedAdminReleaseManifest } from "../src/server/admin-service/release-manifest.ts";
import { persistOwnerSupervisorHandoff } from "../src/server/internal-operation/owner-supervisor.ts";
import {
  runQuickLaunchControlSequence,
  type QuickLaunchControlHandoffSet, type QuickLaunchControlStepId
} from "../src/server/internal-operation/quick-launch-control.ts";

const HANDOFF_SCHEMA_VERSION = "owner-supervisor-handoff-v1" as const;
const HANDOFF_ISSUER = "f1plus1-owner-supervisor-v1" as const;
const HANDOFF_TTL_MS = 15 * 60_000;

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

function fail(code: string): never { throw new Error(code); }
function assert(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }
function parseCli(arguments_: readonly string[]): string {
  assert(arguments_.length === 2, "CLI_ARGUMENTS_INVALID");
  assert(arguments_[0] === "--manifest", "CLI_ARGUMENTS_INVALID");
  const manifestPath = arguments_[1]!;
  assert(isAbsolute(manifestPath), "CLI_ARGUMENT_PATH_MUST_BE_ABSOLUTE");
  return manifestPath;
}

const STEP_OWNERS = Object.freeze({
  "clear-deletion-fence": "admin_http",
  "clear-publication-fence": "admin_http",
  "recovery-restoring": "restore_operator",
  "recovery-verifying": "restore_operator",
  "writer-epoch-bump": "system_supervisor",
  "recovery-complete": "system_supervisor",
  "clear-global-stop": "admin_http",
  "enter-backlog": "admin_http",
  "enter-live": "admin_http"
} as const satisfies Readonly<Record<QuickLaunchControlStepId, OwnerProcess>>);

function createHandoffSet(
  database: DatabaseSync,
  releaseSha256: string,
  manifestSha256: string,
  nowMs: number
): QuickLaunchControlHandoffSet {
  assert(nowMs <= Date.now() && Number.isSafeInteger(nowMs), "QUICK_LAUNCH_CLOCK_INVALID");
  const verifiedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + HANDOFF_TTL_MS).toISOString();
  const handoffs = {} as Record<QuickLaunchControlStepId, OwnerSupervisorHandoff>;
  for (const [step, ownerProcess] of Object.entries(STEP_OWNERS) as [QuickLaunchControlStepId, OwnerProcess][]) {
    const handoffId = `quick-launch-${step}-${nowMs}-${randomBytes(12).toString("base64url")}`;
    const core = Object.freeze({
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      handoffId,
      ownerProcess,
      issuer: HANDOFF_ISSUER,
      oneTimeNonce: randomBytes(32).toString("base64url"),
      releaseSha256,
      manifestSha256,
      verifiedAt,
      expiresAt
    });
    const receiptSha256 = createHash("sha256").update(canonicalJson(core)).digest("hex");
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
    persistOwnerSupervisorHandoff(database, handoff, verifyGeneratedReceipt(handoff));
    handoffs[step] = handoff;
  }
  return Object.freeze(handoffs);
}

function main(): void {
  const manifestPath = parseCli(process.argv.slice(2));
  const deployment = readAdminDeploymentManifest(manifestPath);
  const official = readVerifiedAdminReleaseManifest(
    deployment.targetReleaseAppRoot,
    deployment.officialReleaseManifestPath,
    deployment.officialReleaseManifestSha256
  );
  const runtime = loadReleaseRuntimeGate({
    releaseRoot: deployment.targetReleaseAppRoot,
    fullManifestPath: deployment.fullReleaseManifestPath,
    fullManifestSha256: deployment.fullReleaseManifestSha256,
    fallbackManifestPath: deployment.fallbackReleaseManifestPath,
    fallbackManifestSha256: deployment.fallbackReleaseManifestSha256,
    pairReceiptPath: deployment.releasePairReceiptPath,
    pairReceiptSha256: deployment.releasePairReceiptSha256,
    expectedSourceCommitSha1: official.gitCommit,
    expectedSourceTreeSha1: official.gitTree,
    expectedPackageRootSha256: official.releaseRootSha256,
    activeRole: deployment.activeReleaseRole,
    activatedAt: new Date().toISOString(),
    previousActivationId: null
  });
  const activeManifest = deployment.activeReleaseRole === "full_v10" ? runtime.full : runtime.fallback;
  assert(
    activeManifest.schemaVersion === 10 &&
    activeManifest.schemaSha256 === deployment.reviewSchemaSha256 &&
    activeManifest.role === deployment.activeReleaseRole &&
    activeManifest.capabilities.automaticReview === false &&
    activeManifest.capabilities.automaticPublish === false,
    "QUICK_LAUNCH_AUTOMATION_CAPABILITY_PRESENT"
  );
  const releaseSha256 = runtime.gate.receipt.sourcePreimageSha256;
  const manifestSha256 = runtime.gate.receipt.manifestSha256;
  const databasePath = resolve(deployment.reviewDatabasePath);
  const databaseIdentity = {
    ...deployment.reviewDatabaseIdentity,
    dev: Number(deployment.reviewDatabaseIdentity.dev),
    ino: Number(deployment.reviewDatabaseIdentity.ino)
  };
  const nowMs = Date.now();
  const bootstrapDatabase = openExistingSafeDatabase(databasePath, databaseBasename(databasePath), databaseIdentity, [10]);
  let handoffs: QuickLaunchControlHandoffSet;
  try {
    handoffs = createHandoffSet(bootstrapDatabase, releaseSha256, manifestSha256, nowMs);
  } finally {
    bootstrapDatabase.close();
  }
  const database = openExistingSafeDatabase(databasePath, databaseBasename(databasePath), databaseIdentity, [10]);
  let gateway: SqliteInternalOperationGateway | null = null;
  try {
    gateway = new SqliteInternalOperationGateway({ database, releaseSha256, manifestSha256, schemaSha256: activeManifest.schemaSha256 });
    const result = runQuickLaunchControlSequence({ database, gateway, handoffs, releaseSha256, manifestSha256, schemaSha256: activeManifest.schemaSha256 });
    const receipt = Object.freeze({
      schemaVersion: "quick-launch-enter-live-receipt-v1",
      decision: "SUCCESS",
      database: {
        pathSha256: createHash("sha256").update(realpathSync(databasePath)).digest("hex"),
        device: Number(deployment.reviewDatabaseIdentity.dev),
        inode: Number(deployment.reviewDatabaseIdentity.ino),
        userVersion: 10,
        schemaSha256: deployment.reviewSchemaSha256
      },
      release: {
        releaseId: runtime.gate.receipt.releaseId,
        role: runtime.gate.receipt.role,
        sourcePreimageSha256: releaseSha256,
        manifestSha256
      },
      result
    });
    process.stdout.write(`${canonicalJsonV1(receipt)}\n`);
  } finally {
    gateway?.close();
    database.close();
  }
}
try {
  main();
} catch (error) {
  process.stdout.write(`${canonicalJsonV1({
    schemaVersion: "quick-launch-enter-live-receipt-v1",
    decision: "FAIL",
    reasonCode: error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "QUICK_LAUNCH_FAILED"
  })}\n`);
  process.exitCode = 1;
}
