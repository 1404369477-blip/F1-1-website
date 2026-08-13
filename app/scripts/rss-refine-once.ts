import { homedir } from "node:os";
import { resolve } from "node:path";

import { readAdminDeploymentManifest } from "../src/server/admin-service/deployment.ts";
import { openReviewAdminDatabase } from "../src/server/admin-service/runtime.ts";
import { refineOneCandidate } from "../src/server/rss/refinement.ts";

const adminRoot = resolve(homedir(), "Library/Application Support/F1Plus1/Admin");
const deploymentPath = resolve(adminRoot, "deployment.json");
const apiKeyPath = resolve(adminRoot, "private/deepseek-api-key");

async function main(): Promise<void> {
  process.umask(0o077);
  if (process.argv.length !== 2) throw new Error("CLI_ARGUMENTS_FORBIDDEN");
  const deployment = readAdminDeploymentManifest(deploymentPath);
  const opened = openReviewAdminDatabase({
    targetReleaseAppRoot: deployment.targetReleaseAppRoot,
    reviewDatabasePath: deployment.reviewDatabasePath,
    reviewDatabaseIdentity: deployment.reviewDatabaseIdentity
  });
  try {
    process.stdout.write(`${JSON.stringify(await refineOneCandidate({
      database: opened.database,
      apiKeyPath
    }))}\n`);
  } finally {
    opened.database.close();
  }
}

try {
  await main();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "rss-refinement-receipt-v1",
    status: "failed",
    reasonCode: error instanceof Error ? error.message : "REFINEMENT_FAILED",
    externalCalls: 0
  })}\n`);
  process.exitCode = 1;
}
