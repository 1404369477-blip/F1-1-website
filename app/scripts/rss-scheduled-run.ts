import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";

import { ConfigError } from "../src/server/config/env.ts";
import {
  assertRssDeploymentHost,
  readVerifiedRssDeploymentManifest,
  rssDeploymentPaths
} from "../src/server/rss/deployment.ts";
import { readVerifiedRssReleaseManifest } from "../src/server/rss/release-manifest.ts";
import { assertRssSchema } from "../src/server/rss/repository.ts";
import {
  assertNoAdditionalCliArguments,
  runSafeCli
} from "../src/server/security/cli.ts";
import { appRoot } from "../src/server/runtime-config.ts";

await runSafeCli(async () => {
  process.umask(0o077);
  assertNoAdditionalCliArguments(process.argv.slice(2));
  const releaseManifestSha256 = process.env.RSS_RELEASE_MANIFEST_SHA256;
  if (!releaseManifestSha256 || !/^[0-9a-f]{64}$/.test(releaseManifestSha256)) {
    throw new ConfigError("RELEASE_MANIFEST_ANCHOR", "RSS_RELEASE_MANIFEST_SHA256 must be one lowercase SHA-256");
  }

  const paths = rssDeploymentPaths(appRoot, homedir());
  assertRssDeploymentHost(paths);
  const releaseManifest = readVerifiedRssReleaseManifest(
    appRoot,
    paths.releaseManifest,
    releaseManifestSha256
  );
  readVerifiedRssDeploymentManifest(paths, releaseManifest, releaseManifestSha256);

  const database = new DatabaseSync(paths.database, { readOnly: true });
  try {
    assertRssSchema(database);
  } finally {
    database.close();
  }

  await import("./rss-collect-once.ts");
});
