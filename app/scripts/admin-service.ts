import { resolve } from "node:path";

import { readAdminDeploymentManifest } from "../src/server/admin-service/deployment.ts";
import { runReviewAdminRuntime } from "../src/server/admin-service/runtime.ts";
import { runSafeCli } from "../src/server/security/cli.ts";

await runSafeCli(async () => {
  process.umask(0o077);
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 2 || arguments_[0] !== "--manifest" || !arguments_[1].startsWith("/")) {
    throw new Error("CLI_ARGUMENTS_FORBIDDEN");
  }
  const manifest = readAdminDeploymentManifest(resolve(arguments_[1]));
  await runReviewAdminRuntime({
    targetReleaseAppRoot: manifest.targetReleaseAppRoot,
    reviewDatabasePath: manifest.reviewDatabasePath,
    reviewDatabaseIdentity: manifest.reviewDatabaseIdentity,
    dataRoot: manifest.dataRoot,
    staticRoot: manifest.staticRoot,
    canonicalOrigin: manifest.canonicalOrigin,
    rpName: manifest.rpName,
    operatorRef: manifest.operatorRef,
    tailscaleAppCapabilityId: manifest.tailscaleAppCapabilityId,
    trustedIdentities: manifest.trustedIdentities,
    sessionHashKeyPath: manifest.sessionHashKeyPath,
    recoveryFencePath: manifest.recoveryFencePath,
    projectionSigningKeyId: manifest.projectionSigningKeyId,
    projectionSigningPrivateKeyPath: manifest.projectionSigningPrivateKeyPath,
    projectionInternalEndpoint: manifest.projectionInternalEndpoint,
    projectionSenderServiceIdentity: manifest.projectionSenderServiceIdentity
  });
});
