import { resolve } from "node:path";

import { readAdminDeploymentManifestWithIdentity } from "../src/server/admin-service/deployment.ts";
import { adminRuntimeConfigFromDeployment, runReviewAdminRuntime, runXPageCaptureImport } from "../src/server/admin-service/runtime.ts";
import { runSafeCli } from "../src/server/security/cli.ts";

await runSafeCli(async () => {
  process.umask(0o077);
  const arguments_ = process.argv.slice(2);
  const importing = arguments_.length === 4 && arguments_[2] === "--x-page-import" && /^[0-9a-f]{64}$/u.test(arguments_[3]);
  if ((!importing && arguments_.length !== 2) || arguments_[0] !== "--manifest" || !arguments_[1]?.startsWith("/")) {
    throw new Error("CLI_ARGUMENTS_FORBIDDEN");
  }
  const deployment = readAdminDeploymentManifestWithIdentity(resolve(arguments_[1]));
  const config = adminRuntimeConfigFromDeployment(deployment.manifest, { expectedDeploymentManifestSha256: deployment.sha256 });
  if (importing) {
    process.stdout.write(`${JSON.stringify(runXPageCaptureImport(config, arguments_[3]))}\n`);
    return;
  }
  await runReviewAdminRuntime(config);
});
