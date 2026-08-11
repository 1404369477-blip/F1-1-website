import { appRoot, projectRoot } from "./runtime-config.ts";
import {
  CLOSED_RECEIPT_PATHS,
  generateClosedReceipt,
  type ClosedProfileId
} from "../src/server/db/closed-receipt.ts";
import { M3_PROFILE_ID, PUBLIC_PROFILE_ID } from "../src/server/db/profile.ts";
import { ConfigError } from "../src/server/config/env.ts";
import { runReceiptIntegrityBoundary, runSafeCli } from "../src/server/security/cli.ts";

await runSafeCli(() => {
  const [profile, ...additional] = process.argv.slice(2);
  if (additional.length > 0 || (profile !== M3_PROFILE_ID && profile !== PUBLIC_PROFILE_ID)) {
    throw new ConfigError("CLI_ARGUMENTS_FORBIDDEN", "expected exactly one legacy closed profile id");
  }
  const profileId = profile as ClosedProfileId;
  const result = runReceiptIntegrityBoundary(() => generateClosedReceipt(profileId, { appRoot, projectRoot }));
  const receiptPaths = profileId === M3_PROFILE_ID
    ? [CLOSED_RECEIPT_PATHS.m3, CLOSED_RECEIPT_PATHS.m3ValidatorMarker]
    : [CLOSED_RECEIPT_PATHS.public, CLOSED_RECEIPT_PATHS.publicData, CLOSED_RECEIPT_PATHS.publicValidatorMarker];
  process.stdout.write(`${JSON.stringify({
    command: "profile:closed-receipt",
    profileId,
    restoredM3: result.restoredM3,
    receiptPaths,
    closedDbSha256: result.dbReceipt.closedDbSha256,
    logicalContentRootSha256: result.dbReceipt.logicalContentRootSha256,
    receiptSha256: result.dbReceipt.receiptSha256,
    externalCalls: 0
  })}\n`);
});
