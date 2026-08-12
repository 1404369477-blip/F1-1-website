import { mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ConfigError } from "../src/server/config/env.ts";
import {
  ADMIN_RELEASE_MANIFEST_PATH,
  buildAdminReleaseManifest,
  canonicalAdminReleaseJson,
  normalizeAdminNextBuildPermissions
} from "../src/server/admin-service/release-manifest.ts";
import { assertNoAdditionalCliArguments, runSafeCli } from "../src/server/security/cli.ts";
import { appRoot, projectRoot } from "../src/server/runtime-config.ts";

await runSafeCli(() => {
  process.umask(0o077);
  assertNoAdditionalCliArguments(process.argv.slice(2));
  const targetNodePath = process.env.ADMIN_TARGET_NODE_PATH;
  if (!targetNodePath) throw new ConfigError("RELEASE_NODE", "ADMIN_TARGET_NODE_PATH is required");
  const output = resolve(appRoot, ADMIN_RELEASE_MANIFEST_PATH);
  mkdirSync(dirname(output), { mode: 0o700, recursive: true });
  const normalized = normalizeAdminNextBuildPermissions(appRoot);
  const manifest = buildAdminReleaseManifest(appRoot, projectRoot, targetNodePath);
  const descriptor = openSync(output, "w", 0o600);
  try { writeFileSync(descriptor, `${canonicalAdminReleaseJson(manifest)}\n`, "utf8"); }
  finally { closeSync(descriptor); }
  process.stdout.write(`${JSON.stringify({
    command: "admin:build-release-manifest",
    status: "built-from-fixed-git-identity",
    gitCommit: manifest.gitCommit,
    gitTree: manifest.gitTree,
    contentRootSha256: manifest.contentRootSha256,
    releaseRootSha256: manifest.releaseRootSha256,
    nextFileCount: manifest.nextBuild.files.length,
    nextBytes: manifest.nextBuild.totalBytes,
    nextRootSha256: manifest.nextBuild.contentRootSha256,
    nextModes: { files0644: normalized.fileCount, directories0755: normalized.directoryCount },
    packageCount: manifest.productionDependencies.packages.length,
    externalCalls: 0
  })}\n`);
});
