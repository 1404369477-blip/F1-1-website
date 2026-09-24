import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readAdminDeploymentManifestWithIdentity } from "../src/server/admin-service/deployment.ts";
import { adminRuntimeConfigFromDeployment } from "../src/server/admin-service/runtime.ts";
import { createRssCollectorRuntime } from "../src/server/rss-automatic/collector.ts";

async function main(): Promise<void> {
  process.umask(0o077);
  if (process.argv.length !== 2 || process.env.RSS_REAL_IO !== "true") throw new Error("RSS_COLLECTOR_CLI_CLOSED");
  const deployment = readAdminDeploymentManifestWithIdentity(resolve(homedir(), "Library/Application Support/F1Plus1/Admin/deployment.json"));
  const config = adminRuntimeConfigFromDeployment(deployment.manifest, { expectedDeploymentManifestSha256: deployment.sha256 });
  const runtime = createRssCollectorRuntime(config);
  try {
    const receipt = await runtime.collect();
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (receipt.status === "failed") process.exitCode = 1;
  } finally { await runtime.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write(`${JSON.stringify({ schemaVersion: "rss-automatic-collector-v1", status: "failed", reasonCode: "RSS_COLLECTOR_START_OR_RUN_FAILED" })}\n`);
    process.exitCode = 1;
  });
}
