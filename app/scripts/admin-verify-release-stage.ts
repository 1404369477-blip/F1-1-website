import { resolve } from "node:path";

import { ConfigError } from "../src/server/config/env.ts";
import {
  ADMIN_RELEASE_MANIFEST_PATH,
  readVerifiedAdminReleaseManifest
} from "../src/server/admin-service/release-manifest.ts";
import { assertNoAdditionalCliArguments, runSafeCli } from "../src/server/security/cli.ts";
import { appRoot } from "../src/server/runtime-config.ts";

await runSafeCli(() => {
  process.umask(0o077);
  assertNoAdditionalCliArguments(process.argv.slice(2));
  const expectedSha256 = process.env.ADMIN_EXPECTED_RELEASE_MANIFEST_SHA256;
  if (!expectedSha256 || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new ConfigError("RELEASE_MANIFEST_ANCHOR", "ADMIN_EXPECTED_RELEASE_MANIFEST_SHA256 is required");
  }
  const manifest = readVerifiedAdminReleaseManifest(
    appRoot,
    resolve(appRoot, ADMIN_RELEASE_MANIFEST_PATH),
    expectedSha256
  );
  process.stdout.write(`${JSON.stringify({
    command: "admin:verify-release-stage",
    status: "release-verified",
    gitCommit: manifest.gitCommit,
    gitTree: manifest.gitTree,
    contentRootSha256: manifest.contentRootSha256,
    releaseRootSha256: manifest.releaseRootSha256,
    nextFileCount: manifest.nextBuild.files.length,
    nextBytes: manifest.nextBuild.totalBytes,
    nextRootSha256: manifest.nextBuild.contentRootSha256,
    packageCount: manifest.productionDependencies.packages.length,
    externalCalls: 0
  })}\n`);
});
