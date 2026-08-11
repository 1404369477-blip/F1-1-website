import { appRoot, loadRuntimeConfig, projectRoot } from "./runtime-config.ts";
import { ConfigError } from "../src/server/config/env.ts";
import { generateSourceManagementClosedReceipt } from "../src/server/db/source-management-synthetic.ts";
import { SOURCE_MANAGEMENT_PROFILE_ID } from "../src/server/db/profile.ts";
import { runReceiptIntegrityBoundary, runSafeCli } from "../src/server/security/cli.ts";

await runSafeCli(() => {
  const [profile, ...additional] = process.argv.slice(2);
  if (additional.length > 0 || profile !== SOURCE_MANAGEMENT_PROFILE_ID) {
    throw new ConfigError("CLI_ARGUMENTS_FORBIDDEN", "expected exactly the source-management closed profile id");
  }
  const result = runReceiptIntegrityBoundary(() =>
    generateSourceManagementClosedReceipt(loadRuntimeConfig(), appRoot, projectRoot)
  );
  process.stdout.write(`${JSON.stringify({
    command: "profile:source-management-closed-receipt",
    profileId: profile,
    receiptPaths: [result.relativePath],
    closedDbSha256: result.receipt.closedDbSha256,
    logicalContentRootSha256: result.receipt.logicalContentRootSha256,
    receiptSha256: result.receipt.receiptSha256,
    externalCalls: 0
  })}\n`);
});
