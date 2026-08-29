import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, lstatSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ConfigError } from "../src/server/config/env.ts";
import {
  ADMIN_RELEASE_MANIFEST_PATH,
  adminBuildInputRoot,
  buildAdminReleaseManifest,
  canonicalAdminReleaseJson,
  buildDependencyClosure,
  deriveAdminBuildInputRecords,
  normalizeAdminNextBuildPermissions,
  resolveAdminReleaseGitIdentity
} from "../src/server/admin-service/release-manifest.ts";
import {
  ADMIN_BUILD_PROCESS_ENV_ALLOWLIST,
  deriveAdminBuildClosure
} from "../src/server/release/build-closure.ts";
import { readStableRegularFile } from "../src/server/release/local-closure.ts";
import { assertNoAdditionalCliArguments, runSafeCli } from "../src/server/security/cli.ts";
import { appRoot, projectRoot } from "../src/server/runtime-config.ts";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function npmVersion(environment: NodeJS.ProcessEnv): string {
  const npmPath = resolve(dirname(process.execPath), "npm");
  const result = spawnSync(npmPath, ["--version"], { encoding: "utf8", shell: false, env: environment });
  if (result.error || result.status !== 0) throw new ConfigError("RELEASE_TOOLCHAIN", "npm version could not be determined");
  return result.stdout.trim();
}

function assertExactNpm(environment: NodeJS.ProcessEnv): "11.16.0" {
  const version = npmVersion(environment);
  if (version !== "11.16.0") throw new ConfigError("RELEASE_TOOLCHAIN", `npm 11.16.0 is required; found ${version}`);
  return "11.16.0";
}

function npmPath(): string { return resolve(dirname(process.execPath), "npm"); }

function pathDirectoryRootSha256(): string {
  const directory = dirname(process.execPath);
  const entries = readdirSync(directory).sort().map((name) => {
    const absolute = resolve(directory, name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const target = resolve(directory, name);
      return `${name}\0symlink\0${readFileSync(target).toString("base64")}`;
    }
    if (!stat.isFile()) return `${name}\0non-regular`;
    return `${name}\0${readFileSync(absolute).toString("base64")}`;
  }).join("\n");
  return sha256(entries);
}

function cleanNpmCi(environment: NodeJS.ProcessEnv): void {
  const dependencyRoot = resolve(appRoot, "node_modules");
  if (existsSync(dependencyRoot)) {
    throw new ConfigError("RELEASE_TOOLCHAIN", "clean causal build requires an absent node_modules root; pre-existing dependencies are untrusted");
  }
  // NODE_ENV=production is required for Next, but npm would interpret it as
  // --omit=dev. Explicitly include dev packages so TypeScript, Next config
  // types, SWC and every build helper are present in the sealed build stage.
  const install = spawnSync(npmPath(), ["ci", "--include=dev", "--offline", "--ignore-scripts"], {
    cwd: appRoot,
    env: environment,
    shell: false,
    stdio: "inherit"
  });
  if (install.error || install.status !== 0) {
    if (existsSync(dependencyRoot)) removeOwnedGeneratedTree(dependencyRoot);
    throw new ConfigError("RELEASE_TOOLCHAIN", `clean npm ci failed with exit ${String(install.status)}; offline cache absence is a release BLOCKED state`);
  }
  if (!existsSync(dependencyRoot)) throw new ConfigError("RELEASE_TOOLCHAIN", "npm ci completed without node_modules");
}

function removeOwnedGeneratedTree(path: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ConfigError("RELEASE_CLEANUP", `generated release path is not a removable owned directory: ${path}`);
  rmSync(path, { recursive: true, force: false });
}

function controlledBuildEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PATH: dirname(process.execPath)
  };
  const keys = Object.keys(environment).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...ADMIN_BUILD_PROCESS_ENV_ALLOWLIST].sort())) {
    throw new ConfigError("RELEASE_ENV", "controlled Next build environment does not match the frozen allowlist");
  }
  return environment;
}

let dependencyStageCreated = false;
let nextStageCreated = false;

await runSafeCli(() => {
  process.umask(0o077);
  try {
    assertNoAdditionalCliArguments(process.argv.slice(2));
    const targetNodePath = process.env.ADMIN_TARGET_NODE_PATH;
    if (!targetNodePath) throw new ConfigError("RELEASE_NODE", "ADMIN_TARGET_NODE_PATH is required");
    const environment = controlledBuildEnvironment();
    const npm = assertExactNpm(environment);
    const nextRoot = resolve(appRoot, ".next");
    if (existsSync(nextRoot)) {
      throw new ConfigError("RELEASE_NEXT_BUILD", "refusing to use an existing .next; remove it and rerun the causal release build");
    }

  // Install from the frozen lock in a clean stage. A pre-existing
  // node_modules tree is never accepted as causal build input.
  cleanNpmCi(environment);
  dependencyStageCreated = true;
  const dependencyBefore = buildDependencyClosure(appRoot);
  const packageLockSha256 = sha256(readFileSync(resolve(appRoot, "package-lock.json")));
  const pathDirectoryRootBefore = pathDirectoryRootSha256();

  // Seal the source/build inputs before the child process starts. A later
  // manifest is green only if these exact bytes still exist after next build.
  const gitIdentity = resolveAdminReleaseGitIdentity(appRoot, projectRoot);
  const sealedRecords = deriveAdminBuildInputRecords(appRoot, projectRoot, gitIdentity.gitCommit);
  const sealedRoot = adminBuildInputRoot(sealedRecords);
  const closure = deriveAdminBuildClosure(appRoot);
  const valuesSha256 = Object.fromEntries(
    Object.entries(environment).sort().map(([key, value]) => [key, sha256(String(value))])
  );

  const nextBin = resolve(appRoot, "node_modules/next/dist/bin/next");
  const nextBinSha256 = sha256(readStableRegularFile(appRoot, "node_modules/next/dist/bin/next").bytes);
  nextStageCreated = true;
  const build = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: appRoot,
    env: environment,
    shell: false,
    stdio: "inherit"
  });
  if (build.error || build.status !== 0) {
    throw new ConfigError("RELEASE_NEXT_BUILD", `causal next build failed with exit ${String(build.status)}`);
  }

  const afterRecords = deriveAdminBuildInputRecords(appRoot, projectRoot, gitIdentity.gitCommit);
  if (adminBuildInputRoot(afterRecords) !== sealedRoot) {
    throw new ConfigError("RELEASE_BUILD_INPUT", "sealed build inputs changed while next build was running");
  }
  const dependencyAfter = buildDependencyClosure(appRoot);
  if (canonicalAdminReleaseJson(dependencyAfter) !== canonicalAdminReleaseJson(dependencyBefore)) {
    throw new ConfigError("RELEASE_BUILD_INPUT", "sealed npm dependency closure changed while next build was running");
  }
  if (sha256(readStableRegularFile(appRoot, "node_modules/next/dist/bin/next").bytes) !== nextBinSha256) {
    throw new ConfigError("RELEASE_BUILD_INPUT", "Next executable bytes changed while next build was running");
  }
  if (pathDirectoryRootSha256() !== pathDirectoryRootBefore) {
    throw new ConfigError("RELEASE_BUILD_INPUT", "PATH executable directory bytes changed while next build was running");
  }
  const nodeSha256 = sha256(readFileSync(process.execPath));
  const receipt = Object.freeze({
    schemaVersion: "f1plus1-admin-build-causal-receipt-v1" as const,
    status: "success" as const,
    command: "release:build-and-manifest" as const,
    buildCommand: "next build" as const,
    nextWasAbsentBeforeBuild: true as const,
    toolchain: Object.freeze({
      nodePath: process.execPath,
      npmPath: resolve(dirname(process.execPath), "npm"),
      nodeVersion: "24.18.0" as const,
      nodeSha256,
      npmVersion: npm,
      npmLauncherSha256: sha256(readFileSync(npmPath())),
      pathDirectory: dirname(process.execPath),
      pathDirectoryRootSha256: pathDirectoryRootBefore
    }),
    buildDependencyClosure: Object.freeze({
      install: "npm-ci-clean-stage" as const,
      packageLockSha256,
      fileCount: dependencyBefore.fileCount,
      contentRootSha256: dependencyBefore.contentRootSha256
    }),
    environment: Object.freeze({
      allowedEnvFiles: closure.allowedEnvFiles,
      processEnvAllowlist: closure.processEnvAllowlist,
      valuesSha256: Object.freeze(valuesSha256)
    }),
    sealedBuildInputRootSha256: sealedRoot
  });
  normalizeAdminNextBuildPermissions(appRoot);
  const manifest = buildAdminReleaseManifest(appRoot, projectRoot, targetNodePath, process.execPath, receipt);
  const output = resolve(appRoot, ADMIN_RELEASE_MANIFEST_PATH);
  const outputBytes = `${canonicalAdminReleaseJson(manifest)}\n`;
  const outputDirectory = dirname(output);
  // The manifest builder owns the final private-directory policy; keeping the
  // write here in the same process binds the build receipt and .next identity.
  mkdirSync(outputDirectory, { mode: 0o700, recursive: true });
  const descriptor = openSync(output, "w", 0o600);
  try { writeFileSync(descriptor, outputBytes, "utf8"); }
  finally { closeSync(descriptor); }
    process.stdout.write(`${JSON.stringify({
    command: "release:build-and-manifest",
    status: "built-and-manifested-in-one-controlled-process",
    gitCommit: manifest.gitCommit,
    gitTree: manifest.gitTree,
    sealedBuildInputRootSha256: sealedRoot,
    nextRootSha256: manifest.nextBuild.contentRootSha256,
    releaseRootSha256: manifest.releaseRootSha256,
    manifestSha256: sha256(outputBytes),
    toolchain: receipt.toolchain,
    environment: receipt.environment,
    externalCalls: 0
    })}\n`);
  } catch (error) {
    // The process owns both trees: a failed causal build must not leave a
    // partial .next or an untrusted pre-installed dependency stage that a
    // later invocation could accidentally read.
    if (nextStageCreated) removeOwnedGeneratedTree(resolve(appRoot, ".next"));
    if (dependencyStageCreated) removeOwnedGeneratedTree(resolve(appRoot, "node_modules"));
    throw error;
  }
});
