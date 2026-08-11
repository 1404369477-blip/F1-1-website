import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { ConfigError } from "../src/server/config/env.ts";
import {
  applyRssMigration,
  openRssDatabase
} from "../src/server/rss/repository.ts";
import {
  assertPrivateRegularFile,
  assertRssDeploymentHost,
  atomicWritePrivateFile,
  createRssDeploymentManifest,
  prepareRssDeploymentDirectories,
  readVerifiedRssDeploymentManifest,
  renderRssCollectorPlist,
  rssDeploymentPaths,
  sha256File,
  writeRssDeploymentManifest
} from "../src/server/rss/deployment.ts";
import { readVerifiedRssReleaseManifest } from "../src/server/rss/release-manifest.ts";
import { runSafeCli } from "../src/server/security/cli.ts";
import { appRoot } from "../src/server/runtime-config.ts";

type InstallMode = Readonly<{ kind: "prepare" }> | Readonly<{ kind: "render"; output: string }>;

function parseMode(arguments_: readonly string[]): InstallMode {
  if (arguments_.length === 0) return { kind: "prepare" };
  if (arguments_.length === 2 && arguments_[0] === "--render-plist") {
    const temporaryRoot = realpathSync(tmpdir());
    const requested = resolve(arguments_[1]);
    const parent = realpathSync(dirname(requested));
    const output = resolve(parent, basename(requested));
    const path = relative(temporaryRoot, output);
    if (
      basename(output) !== "com.f1plus1.rss-collector.plist" ||
      path === ".." || path.startsWith(`..${sep}`)
    ) {
      throw new ConfigError("RELEASE_RENDER_PATH", "plist render target must be the fixed filename under a temporary directory");
    }
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
      throw new ConfigError("RELEASE_RENDER_PATH", "plist render parent must be a private real directory");
    }
    if (existsSync(output)) throw new ConfigError("RELEASE_RENDER_PATH", "plist render target already exists");
    return { kind: "render", output };
  }
  throw new ConfigError("CLI_ARGUMENTS_FORBIDDEN", "installer accepts no arguments or --render-plist <temporary-path>");
}

await runSafeCli(() => {
  process.umask(0o077);
  const mode = parseMode(process.argv.slice(2));
  const paths = rssDeploymentPaths(appRoot, homedir());
  assertRssDeploymentHost(paths);

  if (mode.kind === "render") {
    atomicWritePrivateFile(
      mode.output,
      renderRssCollectorPlist(paths, process.env.RSS_RELEASE_MANIFEST_SHA256 ?? "")
    );
    process.stdout.write(`${JSON.stringify({
      command: "rss:render-plist",
      status: "rendered-not-installed",
      label: "com.f1plus1.rss-collector",
      plistSha256: sha256File(mode.output),
      externalCalls: 0
    })}\n`);
    return;
  }

  const expectedReleaseManifestSha256 = process.env.RSS_EXPECTED_RELEASE_MANIFEST_SHA256;
  const releaseManifest = readVerifiedRssReleaseManifest(
    appRoot,
    paths.releaseManifest,
    expectedReleaseManifestSha256
  );
  const releaseManifestSha256 = sha256File(paths.releaseManifest);
  prepareRssDeploymentDirectories(paths);
  for (const logPath of [paths.stdoutLog, paths.stderrLog]) {
    if (existsSync(logPath)) assertPrivateRegularFile(logPath, "RSS collector log");
    else atomicWritePrivateFile(logPath, "");
  }
  const database = openRssDatabase(appRoot);
  try {
    applyRssMigration(database, readFileSync(paths.migration, "utf8"));
  } finally {
    database.close();
  }
  assertPrivateRegularFile(paths.database, "RSS private database");
  atomicWritePrivateFile(paths.plist, renderRssCollectorPlist(paths, releaseManifestSha256));
  const manifest = createRssDeploymentManifest(paths, releaseManifest, releaseManifestSha256);
  const manifestSha256 = writeRssDeploymentManifest(paths, manifest);
  readVerifiedRssDeploymentManifest(paths, releaseManifest, releaseManifestSha256);

  process.stdout.write(`${JSON.stringify({
    command: "rss:install-macos",
    status: "prepared-no-bootstrap-called",
    label: manifest.label,
    scheduleSeconds: manifest.scheduleSeconds,
    manifestSha256,
    plistSha256: manifest.artifacts.plist.sha256,
    externalCalls: 0
  })}\n`);
});
