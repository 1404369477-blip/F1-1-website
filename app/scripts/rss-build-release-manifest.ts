import { homedir } from "node:os";

import { ConfigError } from "../src/server/config/env.ts";
import {
  atomicWritePrivateFile,
  ensurePrivateDirectory,
  rssDeploymentPaths,
  sha256File
} from "../src/server/rss/deployment.ts";
import {
  buildRssReleaseManifest,
  canonicalReleaseJson
} from "../src/server/rss/release-manifest.ts";
import { runSafeCli } from "../src/server/security/cli.ts";
import { appRoot, projectRoot } from "../src/server/runtime-config.ts";

await runSafeCli(() => {
  process.umask(0o077);
  if (process.argv.length !== 2) throw new ConfigError("CLI_ARGUMENTS_FORBIDDEN", "release manifest builder accepts no arguments");
  const targetNodePath = process.env.RSS_TARGET_NODE_PATH;
  if (!targetNodePath) throw new ConfigError("RELEASE_NODE", "RSS_TARGET_NODE_PATH is required");
  const paths = rssDeploymentPaths(appRoot, homedir());
  ensurePrivateDirectory(paths.localRoot, paths.appRoot, "RSS local root");
  ensurePrivateDirectory(paths.releaseRoot, paths.appRoot, "RSS release manifest root");
  const manifest = buildRssReleaseManifest(appRoot, projectRoot, targetNodePath);
  atomicWritePrivateFile(paths.releaseManifest, `${canonicalReleaseJson(manifest)}\n`);
  process.stdout.write(`${JSON.stringify({
    command: "rss:build-release-manifest",
    status: "built-from-clean-git-head",
    gitCommit: manifest.gitCommit,
    releaseSha256: manifest.releaseSha256,
    contentRootSha256: manifest.contentRootSha256,
    manifestSha256: sha256File(paths.releaseManifest),
    externalCalls: 0
  })}\n`);
});
