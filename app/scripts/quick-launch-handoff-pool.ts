import { basename } from "node:path";

import { readAdminDeploymentManifest } from "../src/server/admin-service/deployment.ts";
import { readVerifiedAdminReleaseManifest } from "../src/server/admin-service/release-manifest.ts";
import { openExistingSafeDatabase } from "../src/server/db/database.ts";
import { loadReleaseRuntimeGate } from "../src/server/internal-operation/release.ts";
import {
  HANDOFF_POOL_MAX_PER_OWNER,
  topUpOwnerHandoffPool
} from "../src/server/internal-operation/handoff-pool.ts";

type Cli = Readonly<{
  manifestPath: string;
  ownerProcess: string;
  count: number;
}>;

function parseCli(arguments_: readonly string[]): Cli {
  if (arguments_.length !== 6) throw new Error("CLI_ARGUMENTS_FORBIDDEN");
  const required = ["--manifest", "--owner", "--count"];
  for (const name of required) {
    if (!arguments_.includes(name)) throw new Error("CLI_ARGUMENTS_FORBIDDEN");
  }
  if (arguments_[0] !== "--manifest" || arguments_[2] !== "--owner" || arguments_[4] !== "--count") {
    throw new Error("CLI_ARGUMENTS_FORBIDDEN");
  }
  const manifestPath = arguments_[1];
  const ownerProcess = arguments_[3];
  const count = Number(arguments_[5]);
  if (!manifestPath.startsWith("/") || !Number.isSafeInteger(count) || count < 1 || count > HANDOFF_POOL_MAX_PER_OWNER) {
    throw new Error("CLI_ARGUMENTS_FORBIDDEN");
  }
  return Object.freeze({ manifestPath, ownerProcess, count });
}

const cli = parseCli(process.argv.slice(2));
const manifest = readAdminDeploymentManifest(cli.manifestPath);
const official = readVerifiedAdminReleaseManifest(
  manifest.targetReleaseAppRoot,
  manifest.officialReleaseManifestPath,
  manifest.officialReleaseManifestSha256
);
const release = loadReleaseRuntimeGate({
  releaseRoot: manifest.targetReleaseAppRoot,
  fullManifestPath: manifest.fullReleaseManifestPath,
  fullManifestSha256: manifest.fullReleaseManifestSha256,
  fallbackManifestPath: manifest.fallbackReleaseManifestPath,
  fallbackManifestSha256: manifest.fallbackReleaseManifestSha256,
  pairReceiptPath: manifest.releasePairReceiptPath,
  pairReceiptSha256: manifest.releasePairReceiptSha256,
  expectedSourceCommitSha1: official.gitCommit,
  expectedSourceTreeSha1: official.gitTree,
  expectedPackageRootSha256: official.releaseRootSha256,
  activeRole: manifest.activeReleaseRole,
  activatedAt: new Date().toISOString(),
  previousActivationId: null
});
const database = openExistingSafeDatabase(
  manifest.reviewDatabasePath,
  basename(manifest.reviewDatabasePath),
  manifest.reviewDatabaseIdentity,
  [manifest.reviewSchemaTarget]
);

try {
  const result = topUpOwnerHandoffPool({
    database,
    ownerProcess: cli.ownerProcess,
    count: cli.count,
    releaseSha256: release.gate.receipt.sourcePreimageSha256,
    manifestSha256: release.gate.receipt.manifestSha256,
    now: Date.now()
  });
  process.stdout.write(`${JSON.stringify({
    status: "HANDOFF_POOL_TOPPED_UP",
    ownerProcess: result.ownerProcess,
    requested: result.requested,
    created: result.created,
    active: result.active,
    cap: result.cap,
    expiresAt: result.expiresAt,
    handoffIds: result.handoffIds
  })}\n`);
} finally {
  database.close();
}
