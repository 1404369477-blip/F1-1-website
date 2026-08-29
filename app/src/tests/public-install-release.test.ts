import { generateKeyPairSync, createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  PUBLIC_APP_LABEL,
  PUBLIC_QUICK_TUNNEL_LABEL,
  preparePublicMacAgents
} from "../../scripts/install-macos-public-beta-core.ts";
import {
  buildAdminReleaseManifest,
  canonicalAdminReleaseJson,
  adminBuildInputRoot,
  buildDependencyClosure,
  deriveAdminBuildInputRecords,
  normalizeAdminNextBuildPermissions,
  resolveAdminReleaseGitIdentity
} from "../server/admin-service/release-manifest.ts";
import { deriveAdminBuildClosure } from "../server/release/build-closure.ts";
import {
  publicProjectionDeploymentPaths,
  PUBLIC_PROJECTION_SERVICE_LABEL
} from "../server/public/deployment.ts";

const projectRoot = resolve(import.meta.dirname, "../../..");
const appRoot = resolve(projectRoot, "app");
const targetNodePath = "/Users/f1admin/.local/node-v24.18.0-darwin-arm64/bin/node";
const temporaryRoots: string[] = [];

type CleanReleaseFixture = Readonly<{ root: string; appRoot: string }>;

function runFixtureGit(root: string, args: readonly string[]): void {
  const result = spawnSync("/usr/bin/git", ["-C", root, ...args], {
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Public release test",
      GIT_AUTHOR_EMAIL: "public-release-test@example.invalid",
      GIT_COMMITTER_NAME: "Public release test",
      GIT_COMMITTER_EMAIL: "public-release-test@example.invalid"
    }
  });
  if (result.error || result.status !== 0) throw new Error(result.stderr || "public release fixture git failed");
}

function makeCleanReleaseFixture(): CleanReleaseFixture {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "f1-public-release-fixture-")));
  temporaryRoots.push(root);
  const cleanAppRoot = join(root, "app");
  cpSync(appRoot, cleanAppRoot, {
    recursive: true,
    filter: (source) => {
      const relativePath = relative(appRoot, source);
      return relativePath !== ".env" && relativePath !== ".local" && !relativePath.startsWith(".local/");
    }
  });
  const asset = "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json";
  const assetDestination = join(root, asset);
  mkdirSync(dirname(assetDestination), { recursive: true, mode: 0o700 });
  cpSync(join(projectRoot, asset), assetDestination);
  runFixtureGit(root, ["init", "-q"]);
  writeFileSync(join(root, "parent.txt"), "parent\n", { mode: 0o600 });
  runFixtureGit(root, ["add", "--", "parent.txt"]);
  runFixtureGit(root, ["commit", "-qm", "public release fixture parent"]);
  runFixtureGit(root, ["add", "--", "app", asset]);
  runFixtureGit(root, ["commit", "-qm", "public release fixture"]);
  return Object.freeze({ root, appRoot: cleanAppRoot });
}

const releaseFixtureRoot = makeCleanReleaseFixture();
normalizeAdminNextBuildPermissions(releaseFixtureRoot.appRoot);

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixtureBuildProvenance(): Parameters<typeof buildAdminReleaseManifest>[4] {
  const identity = resolveAdminReleaseGitIdentity(releaseFixtureRoot.appRoot, releaseFixtureRoot.root);
  const records = deriveAdminBuildInputRecords(releaseFixtureRoot.appRoot, releaseFixtureRoot.root, identity.gitCommit);
  const closure = deriveAdminBuildClosure(releaseFixtureRoot.appRoot);
  const environment = { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", PATH: dirname(process.execPath) };
  return Object.freeze({
    schemaVersion: "f1plus1-admin-build-causal-receipt-v1" as const,
    status: "success" as const,
    command: "release:build-and-manifest" as const,
    buildCommand: "next build" as const,
    nextWasAbsentBeforeBuild: true as const,
    toolchain: Object.freeze({
      nodePath: process.execPath,
      npmPath: resolve(dirname(process.execPath), "npm"),
      nodeVersion: "24.18.0" as const,
      nodeSha256: sha256(readFileSync(process.execPath)),
      npmVersion: "11.16.0" as const,
      npmLauncherSha256: sha256(readFileSync(resolve(dirname(process.execPath), "npm"))),
      pathDirectory: dirname(process.execPath),
      pathDirectoryRootSha256: "0".repeat(64)
    }),
    environment: Object.freeze({
      allowedEnvFiles: closure.allowedEnvFiles,
      processEnvAllowlist: closure.processEnvAllowlist,
      valuesSha256: Object.freeze(Object.fromEntries(Object.entries(environment).map(([key, value]) => [key, sha256(value)])))
    }),
    buildDependencyClosure: Object.freeze({
      install: "npm-ci-clean-stage" as const,
      packageLockSha256: sha256(readFileSync(resolve(releaseFixtureRoot.appRoot, "package-lock.json"))),
      ...buildDependencyClosure(releaseFixtureRoot.appRoot)
    }),
    sealedBuildInputRootSha256: adminBuildInputRoot(records)
  });
}

// The release bytes are immutable for this test file. Build them once at module
// initialization; each test still creates a fresh home, rollback app, key and
// manifest file so prepare/rollback state never crosses test boundaries.
const fixtureRelease = Object.freeze((() => {
  const buildProvenance = fixtureBuildProvenance();
  const manifest = buildAdminReleaseManifest(releaseFixtureRoot.appRoot, releaseFixtureRoot.root, targetNodePath, process.execPath, buildProvenance);
  const bytes = `${canonicalAdminReleaseJson(manifest)}\n`;
  return Object.freeze({ buildProvenance, manifest, bytes, appRoot: releaseFixtureRoot.appRoot, projectRoot: releaseFixtureRoot.root });
})());

function fixture(): Readonly<{
  home: string;
  rollbackRoot: string;
  environment: Record<string, string>;
  livePlists: readonly string[];
  oldBytes: readonly Buffer[];
}> {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "TASK-20260812-0E594C-public-prepare-"));
  chmodSync(home, 0o700);
  temporaryRoots.push(home);
  const publicPaths = publicProjectionDeploymentPaths(home);
  const verifyKeyPath = join(publicPaths.root, "verify.pem");
  mkdirSync(dirname(verifyKeyPath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(verifyKeyPath), 0o700);
  const keys = generateKeyPairSync("ed25519");
  writeFileSync(verifyKeyPath, keys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  chmodSync(verifyKeyPath, 0o600);
  const manifestRoot = join(home, "release");
  mkdirSync(manifestRoot, { mode: 0o700 });
  chmodSync(manifestRoot, 0o700);
  const manifestPath = join(manifestRoot, "manifest.json");
  const manifestBytes = fixtureRelease.bytes;
  writeFileSync(manifestPath, manifestBytes, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);
  const rollbackRoot = join(home, "synthetic-rollback-app");
  mkdirSync(join(rollbackRoot, ".next"), { recursive: true, mode: 0o700 });
  mkdirSync(join(rollbackRoot, ".local"), { recursive: true, mode: 0o700 });
  chmodSync(rollbackRoot, 0o700);
  chmodSync(join(rollbackRoot, ".next"), 0o700);
  chmodSync(join(rollbackRoot, ".local"), 0o700);
  writeFileSync(join(rollbackRoot, ".next/BUILD_ID"), readFileSync(join(appRoot, ".next/BUILD_ID")), { mode: 0o600 });
  writeFileSync(
    join(rollbackRoot, ".local/f1plus1-public-multimedia-synthetic.sqlite"),
    readFileSync(join(appRoot, ".local/f1plus1-public-multimedia-synthetic.sqlite")),
    { mode: 0o600 }
  );
  const livePlists = [
    join(home, "Library/LaunchAgents", `${PUBLIC_APP_LABEL}.plist`),
    join(home, "Library/LaunchAgents", `${PUBLIC_QUICK_TUNNEL_LABEL}.plist`),
    publicPaths.plist
  ] as const;
  const oldBytes = livePlists.map((path, index) => Buffer.from(`old-plist-${index}\n`));
  for (let index = 0; index < livePlists.length; index += 1) {
    mkdirSync(dirname(livePlists[index]), { recursive: true, mode: 0o700 });
    chmodSync(dirname(livePlists[index]), 0o700);
    writeFileSync(livePlists[index], oldBytes[index], { mode: 0o600 });
    chmodSync(livePlists[index], 0o600);
  }
  return Object.freeze({
    home,
    environment: {
      F1_RELEASE_MANIFEST_PATH: manifestPath,
      F1_RELEASE_MANIFEST_SHA256: sha256(manifestBytes),
      F1_PUBLIC_READ_MODE: "public-real-snapshot",
      F1_PUBLIC_SIGNING_KEY_ID: "f1plus1-test-key",
      F1_PUBLIC_VERIFY_KEY_PATH: verifyKeyPath,
      F1_PUBLIC_PROJECTION_SENDER_SERVICE_IDENTITY: "sender-test",
      F1_PUBLIC_PROJECTION_RECEIVER_SERVICE_IDENTITY: "receiver-test",
      F1_PUBLIC_SYNTHETIC_ROLLBACK_APP_ROOT: rollbackRoot,
      F1_PUBLIC_SYNTHETIC_ROLLBACK_RELEASE: readFileSync(join(rollbackRoot, ".next/BUILD_ID"), "utf8").trim(),
      F1_PUBLIC_SYNTHETIC_ROLLBACK_HASH: sha256(readFileSync(join(rollbackRoot, ".local/f1plus1-public-multimedia-synthetic.sqlite")))
    },
    rollbackRoot,
    livePlists,
    oldBytes: Object.freeze(oldBytes)
  });
}

function prepare(value: ReturnType<typeof fixture>, hooks: Readonly<{
  beforeCommit?: () => void;
  afterCommit?: (index: number) => void;
}> = {}) {
  return preparePublicMacAgents({
    appRoot: fixtureRelease.appRoot,
    projectRoot: fixtureRelease.projectRoot,
    home: value.home,
    nodePath: targetNodePath,
    localNodePath: process.execPath,
    environment: value.environment,
    ...hooks
  });
}

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

describe("public prepare release anchor and atomic disabled plists", () => {
  it("rejects an incorrect external SHA before touching live plists", () => {
    const value = fixture();
    value.environment.F1_RELEASE_MANIFEST_SHA256 = "0".repeat(64);
    expect(() => prepare(value)).toThrow(/external expected SHA/);
    value.livePlists.forEach((path, index) => expect(readFileSync(path)).toEqual(value.oldBytes[index]));
  }, 30_000);

  it("leaves all live plists byte-identical when full staging fails", () => {
    const value = fixture();
    expect(() => prepare(value, { beforeCommit: () => { throw new Error("STAGE_FAIL"); } })).toThrow("STAGE_FAIL");
    value.livePlists.forEach((path, index) => expect(readFileSync(path)).toEqual(value.oldBytes[index]));
  }, 30_000);

  it("rejects a rollback anchor mismatch before touching live plists", () => {
    const value = fixture();
    value.environment.F1_PUBLIC_SYNTHETIC_ROLLBACK_HASH = "0".repeat(64);
    expect(() => prepare(value)).toThrow(/PUBLIC_ROLLBACK_ANCHOR/);
    value.livePlists.forEach((path, index) => expect(readFileSync(path)).toEqual(value.oldBytes[index]));
  }, 30_000);

  it("restores every old plist when the commit is interrupted", () => {
    const value = fixture();
    expect(() => prepare(value, { afterCommit: (index) => { if (index === 4) throw new Error("COMMIT_FAIL"); } })).toThrow("COMMIT_FAIL");
    value.livePlists.forEach((path, index) => expect(readFileSync(path)).toEqual(value.oldBytes[index]));
  }, 30_000);

  it("prepares exactly three disabled plists without launchctl", () => {
    const value = fixture();
    const result = prepare(value);
    expect(result.plistPaths).toEqual(value.livePlists);
    expect(result.plistPaths.map((path) => path.endsWith(`${PUBLIC_PROJECTION_SERVICE_LABEL}.plist`))).toEqual([false, false, true]);
    for (const path of result.plistPaths) {
      const plist = readFileSync(path, "utf8");
      expect(plist).toContain("<key>RunAtLoad</key><false/>");
      expect(plist).toContain("<key>KeepAlive</key><false/>");
      expect(plist).not.toContain("launchctl");
      expect(plist).toContain(fixtureRelease.appRoot);
      expect(plist).not.toContain(value.rollbackRoot);
      expect(existsSync(path)).toBe(true);
    }
    const publicPaths = publicProjectionDeploymentPaths(value.home);
    const manifest = JSON.parse(readFileSync(publicPaths.manifest, "utf8")) as Record<string, unknown>;
    expect(manifest.schemaVersion).toBe("public-projection-deployment-v3");
    expect(manifest.targetReleaseManifestSha256).toBe(value.environment.F1_RELEASE_MANIFEST_SHA256);
    expect(manifest.targetReleaseAppRoot).toBe(fixtureRelease.appRoot);
    expect(manifest.syntheticRollbackAppRoot).toBe(value.rollbackRoot);
    expect(manifest.publicDataRoot).toBe(publicPaths.root);
    expect(readFileSync(value.livePlists[0], "utf8")).toContain(resolve(publicPaths.root, "logs"));
  }, 30_000);
});
