import { homedir } from "node:os";

import { assertNodeVersion, ConfigError } from "../src/server/config/env.ts";
import { runSafeCli } from "../src/server/security/cli.ts";
import { appRoot, projectRoot } from "../src/server/runtime-config.ts";
import { preparePublicMacAgents } from "./install-macos-public-beta-core.ts";

await runSafeCli(() => {
  process.umask(0o077);
  assertNodeVersion();
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new ConfigError("RELEASE_HOST", "macOS arm64 is required for this beta service installer");
  }
  if (/Mobile Documents|CloudDocs/i.test(projectRoot)) {
    throw new ConfigError("RELEASE_PATH", "production checkout must not run from an iCloud-synced directory");
  }
  const prepared = preparePublicMacAgents({
    appRoot,
    projectRoot,
    home: homedir(),
    nodePath: process.execPath,
    environment: process.env
  });
  process.stdout.write(`${JSON.stringify({
    command: "release:install-macos-agents",
    status: "prepared-disabled-not-loaded",
    labels: prepared.plistPaths.map((path) => path.split("/").at(-1)?.replace(/\.plist$/, "")),
    releaseManifestSha256: prepared.manifestSha256,
    releaseRootSha256: prepared.release.releaseRootSha256,
    nextRootSha256: prepared.release.nextBuild.contentRootSha256,
    projectionManifestSha256: prepared.projectionManifestSha256,
    projectionPlistSha256: prepared.projectionPlistSha256,
    node: process.versions.node,
    externalCalls: 0
  })}\n`);
});
