import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readAdminDeploymentManifest } from "../src/server/admin-service/deployment.ts";
import { openReviewAdminDatabase } from "../src/server/admin-service/runtime.ts";
import { ProjectionHttpTransport, ProjectionSender } from "../src/server/review-real/sender.ts";
import { runSafeCli } from "../src/server/security/cli.ts";

await runSafeCli(async () => {
  process.umask(0o077);
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 3 || arguments_[0] !== "--manifest" || !arguments_[1].startsWith("/") || arguments_[2] !== "--once") {
    throw new Error("CLI_ARGUMENTS_FORBIDDEN");
  }
  const manifest = readAdminDeploymentManifest(resolve(arguments_[1]));
  const runtime = openReviewAdminDatabase({
    targetReleaseAppRoot: manifest.targetReleaseAppRoot,
    reviewDatabasePath: manifest.reviewDatabasePath,
    reviewDatabaseIdentity: manifest.reviewDatabaseIdentity
  });
  try {
    const sender = new ProjectionSender({
      repository: runtime.repository,
      transport: new ProjectionHttpTransport({
        endpoint: manifest.projectionInternalEndpoint,
        serviceIdentity: manifest.projectionSenderServiceIdentity
      }),
      signingKeyId: manifest.projectionSigningKeyId,
      privateKey: createPrivateKey(readFileSync(manifest.projectionSigningPrivateKeyPath, "utf8")),
      actorRef: manifest.projectionSenderServiceIdentity
    });
    process.stdout.write(`${JSON.stringify({
      command: "projection:sender-once",
      ...(await sender.tick()),
      externalCalls: 0,
      loopbackCallsMaximum: 1
    })}\n`);
  } finally {
    runtime.database.close();
  }
});
