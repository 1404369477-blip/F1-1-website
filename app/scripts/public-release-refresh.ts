import {
  generateClosedReceipt,
  type ClosedProfileId
} from "../src/server/db/closed-receipt.ts";
import { assertLegacyClosedReceipts } from "../src/server/db/public-multimedia-synthetic.ts";
import { M3_PROFILE_ID, PUBLIC_PROFILE_ID } from "../src/server/db/profile.ts";
import { runReceiptIntegrityBoundary, runSafeCli } from "../src/server/security/cli.ts";
import { appRoot, projectRoot } from "../src/server/runtime-config.ts";

function refresh(profileId: ClosedProfileId): ReturnType<typeof generateClosedReceipt> {
  return runReceiptIntegrityBoundary(() => generateClosedReceipt(profileId, { appRoot, projectRoot }));
}

await runSafeCli(() => {
  process.umask(0o077);
  const m3 = refresh(M3_PROFILE_ID);
  const publicSynthetic = refresh(PUBLIC_PROFILE_ID);
  assertLegacyClosedReceipts(projectRoot);
  process.stdout.write(`${JSON.stringify({
    command: "release:refresh-receipts",
    status: "fresh",
    profiles: [m3.profileId, publicSynthetic.profileId],
    validatedAt: {
      m3: m3.dbReceipt.validatedAt,
      publicSynthetic: publicSynthetic.dbReceipt.validatedAt
    },
    externalCalls: 0
  })}\n`);
});
