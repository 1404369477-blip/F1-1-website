import { homedir } from "node:os";
import { resolve } from "node:path";

import { readAdminDeploymentManifest } from "../src/server/admin-service/deployment.ts";
import { adminRuntimeConfigFromDeployment, openReviewAdminDatabase } from "../src/server/admin-service/runtime.ts";
import { refineOneCandidate } from "../src/server/rss/refinement.ts";

const adminRoot = resolve(
  homedir(),
  "Library/Application Support/F1Plus1/Admin",
);
const deploymentPath = resolve(adminRoot, "deployment.json");
const apiKeyPath = resolve(adminRoot, "private/deepseek-api-key");

async function main(): Promise<void> {
  process.umask(0o077);
  if (process.argv.length !== 2) throw new Error("CLI_ARGUMENTS_FORBIDDEN");
  const deployment = readAdminDeploymentManifest(deploymentPath);
  const config = adminRuntimeConfigFromDeployment(deployment);
  await config.releaseGate!.run("model_network", async () => {
    const opened = openReviewAdminDatabase({
      targetReleaseAppRoot: deployment.targetReleaseAppRoot,
      reviewDatabasePath: deployment.reviewDatabasePath,
      reviewDatabaseIdentity: deployment.reviewDatabaseIdentity,
      requiredSchemaVersion: 10,
      ownerProcess: "rss_refiner",
      releaseGate: config.releaseGate
    });
    try {
      for (let index = 0; index < 20; index += 1) {
        const receipt = await refineOneCandidate({
          database: opened.database,
          apiKeyPath,
          mutationPort: opened.mutationPort ?? undefined,
        });
        process.stdout.write(`${JSON.stringify(receipt)}\n`);
        if (receipt.status === "idle") break;
      }
    } finally {
      opened.gateway?.close();
      opened.database.close();
    }
  });
}

try {
  await main();
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: "rss-refinement-receipt-v1",
      status: "failed",
      reasonCode: error instanceof Error ? error.message : "REFINEMENT_FAILED",
      externalCalls: 0,
    })}\n`,
  );
  process.exitCode = 1;
}
