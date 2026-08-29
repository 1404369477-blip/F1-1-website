import { canonicalJsonV1 } from "../src/server/internal-operation/gateway.ts";
import {
  parseQuickLaunchProcessingPreflightCli,
  runQuickLaunchProcessingPreflightFromManifest,
} from "../src/server/internal-operation/quick-launch-processing.ts";

const cli = parseQuickLaunchProcessingPreflightCli(process.argv.slice(2));
try {
  const receipt = await runQuickLaunchProcessingPreflightFromManifest({
    manifestPath: cli.manifestPath,
    limit: cli.limit,
  });
  process.stdout.write(`${canonicalJsonV1({
    schemaVersion: "quick-launch-processing-preflight-cli-v1",
    decision: "PASS",
    releaseId: receipt.releaseId,
    releaseSha256: receipt.sourcePreimageSha256,
    manifestSha256: receipt.manifestSha256,
    preflight: receipt.preflight,
  })}\n`);
} catch (error) {
  process.stdout.write(`${canonicalJsonV1({
    schemaVersion: "quick-launch-processing-preflight-cli-v1",
    decision: "FAIL",
    reasonCode: error instanceof Error ? error.message : "QUICK_LAUNCH_PROCESSING_FAILED",
  })}\n`);
  process.exitCode = 1;
}
