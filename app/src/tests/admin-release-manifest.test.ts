import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ADMIN_RELEASE_MANIFEST_PATH,
  ADMIN_RELEASE_NEXT_EXCLUDED_PATHS,
  ADMIN_RELEASE_RUNTIME_FILES,
  buildAdminReleaseManifest,
  canonicalAdminReleaseJson,
  normalizeAdminNextBuildPermissions,
  readVerifiedAdminReleaseManifest,
  resolveAdminReleaseGitIdentity
} from "../server/admin-service/release-manifest.ts";

const projectRoot = resolve(import.meta.dirname, "../../..");
const appRoot = resolve(projectRoot, "app");
const targetNodePath = "/Users/f1admin/.local/node-v24.18.0-darwin-arm64/bin/node";
const temporaryRoots: string[] = [];
const gitEnvironment = Object.freeze({
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Release Test",
  GIT_AUTHOR_EMAIL: "release-test@example.invalid",
  GIT_COMMITTER_NAME: "Release Test",
  GIT_COMMITTER_EMAIL: "release-test@example.invalid"
});

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function git(arguments_: readonly string[], cwd: string, environment?: NodeJS.ProcessEnv): string {
  const result = spawnSync("/usr/bin/git", ["-C", cwd, ...arguments_], {
    encoding: "utf8",
    shell: false,
    env: environment
  });
  if (result.error || result.status !== 0) throw new Error(result.stderr || "git fixture failed");
  return result.stdout.trim();
}

function copyTreeContents(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(source)) {
    cpSync(join(source, name), join(destination, name), {
      recursive: true,
      preserveTimestamps: false,
      verbatimSymlinks: true
    });
  }
}

function productionPackageNames(): readonly string[] {
  const lock = JSON.parse(readFileSync(join(appRoot, "package-lock.json"), "utf8")) as {
    packages?: Record<string, {
      dependencies?: Record<string, unknown>;
      optionalDependencies?: Record<string, unknown>;
    }>;
  };
  if (!lock.packages) throw new Error("package-lock packages are missing");
  const names = new Set<string>();
  const visit = (name: string, includeOptional: boolean = false): void => {
    if (names.has(name)) return;
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry) throw new Error(`package-lock identity is missing for ${name}`);
    names.add(name);
    for (const dependency of Object.keys(entry.dependencies ?? {}).sort()) visit(dependency);
    if (includeOptional) {
      for (const dependency of Object.keys(entry.optionalDependencies ?? {}).sort()) {
        if (["@next/swc-darwin-arm64", "sharp"].includes(dependency)) {
          visit(dependency, dependency === "sharp");
        }
      }
    }
  };
  for (const root of ["@simplewebauthn/server", "fast-xml-parser", "next", "react", "react-dom", "zod"] as const) {
    visit(root, root === "next");
  }
  for (const platformPackage of [
    "@next/swc-darwin-arm64",
    "@img/sharp-darwin-arm64",
    "@img/sharp-libvips-darwin-arm64"
  ] as const) visit(platformPackage, true);
  return Object.freeze([...names].sort());
}

function makeCleanGitFixture(includeRuntimeAssets: boolean = false): Readonly<{ root: string; appRoot: string }> {
  const requestedRoot = join(tmpdir(), `f1plus1-admin-release-git-${process.pid}-${temporaryRoots.length}`);
  mkdirSync(requestedRoot, { mode: 0o700 });
  const root = realpathSync(requestedRoot);
  temporaryRoots.push(root);
  const fixtureAppRoot = join(root, "app");
  mkdirSync(fixtureAppRoot, { recursive: true, mode: 0o700 });
  for (const path of ADMIN_RELEASE_RUNTIME_FILES) {
    const destination = join(fixtureAppRoot, path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(join(appRoot, path), destination);
  }
  if (includeRuntimeAssets) {
    copyTreeContents(join(appRoot, ".next"), join(fixtureAppRoot, ".next"));
    const excludedNextPaths = new Set<string>(ADMIN_RELEASE_NEXT_EXCLUDED_PATHS);
    const normalizeTreePermissions = (directory: string, relativeDirectory: string): void => {
      const excludedDirectory = excludedNextPaths.has(relativeDirectory);
      if (!excludedDirectory) chmodSync(directory, 0o755);
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        const relativePath = relativeDirectory === "" ? name : `${relativeDirectory}/${name}`;
        const stat = lstatSync(path);
        if (stat.isDirectory()) normalizeTreePermissions(path, relativePath);
        else if (stat.isFile() && !excludedNextPaths.has(relativePath)) chmodSync(path, 0o644);
      }
    };
    normalizeTreePermissions(join(fixtureAppRoot, ".next"), "");
    mkdirSync(join(fixtureAppRoot, "node_modules"), { recursive: true, mode: 0o700 });
    for (const packageName of productionPackageNames()) {
      const source = join(appRoot, "node_modules", packageName);
      copyTreeContents(source, join(fixtureAppRoot, "node_modules", packageName));
    }
  }
  git(["init", "-q"], root, gitEnvironment);
  writeFileSync(join(root, "parent.txt"), "parent\n");
  git(["add", "--", "parent.txt"], root, gitEnvironment);
  git(["commit", "-qm", "parent"], root, gitEnvironment);
  git(["add", "-f", "--", ...ADMIN_RELEASE_RUNTIME_FILES.map((path) => `app/${path}`)], root, gitEnvironment);
  git(["commit", "-qm", "runtime"], root, gitEnvironment);
  return Object.freeze({ root, appRoot: fixtureAppRoot });
}

function stage(sourceAppRoot: string, manifest: ReturnType<typeof buildAdminReleaseManifest>, manifestJson: string): string {
  const requestedRoot = join(tmpdir(), `f1plus1-admin-release-stage-${process.pid}-${temporaryRoots.length}`);
  mkdirSync(requestedRoot, { mode: 0o700 });
  const root = realpathSync(requestedRoot);
  temporaryRoots.push(root);
  const runtimeModes = new Map(manifest.runtimeFiles.map((entry) => [entry.path, entry.mode]));
  for (const path of ADMIN_RELEASE_RUNTIME_FILES) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(join(sourceAppRoot, path), destination);
    chmodSync(destination, runtimeModes.get(path) ?? 0o600);
  }
  for (const entry of manifest.nextBuild.files) {
    const destination = join(root, ".next", entry.path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(join(sourceAppRoot, ".next", entry.path), destination);
    chmodSync(destination, entry.mode);
  }
  const nextDirectories = new Set<string>([join(root, ".next")]);
  for (const entry of manifest.nextBuild.files) {
    let directory = dirname(join(root, ".next", entry.path));
    while (directory.startsWith(join(root, ".next"))) {
      nextDirectories.add(directory);
      if (directory === join(root, ".next")) break;
      directory = dirname(directory);
    }
  }
  for (const directory of nextDirectories) chmodSync(directory, 0o755);
  const manifestPath = join(root, ADMIN_RELEASE_MANIFEST_PATH);
  mkdirSync(dirname(manifestPath), { recursive: true, mode: 0o700 });
  writeFileSync(manifestPath, manifestJson, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);
  for (const packageName of manifest.productionDependencies.packages.map((entry) => entry.name)) {
    copyTreeContents(join(sourceAppRoot, "node_modules", packageName), join(root, "node_modules", packageName));
  }
  return root;
}

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

describe("Admin exact release manifest", () => {
  it("builds only from a clean single-parent Git fixture and keeps target verification externally anchored", () => {
    const fixture = makeCleanGitFixture(true);
    const normalized = normalizeAdminNextBuildPermissions(fixture.appRoot);
    expect(normalized.fileCount).toBeGreaterThan(100);
    expect(normalized.directoryCount).toBeGreaterThan(10);
    const manifest = buildAdminReleaseManifest(fixture.appRoot, fixture.root, targetNodePath, process.execPath);
    expect(manifest.gitCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.gitTree).toBe(git(["rev-parse", "HEAD^{tree}"], fixture.root));
    expect(manifest.gitParent).toBe(git(["rev-parse", "HEAD^"], fixture.root));
    expect(manifest.runtimeFiles.map((entry) => entry.path)).toEqual(ADMIN_RELEASE_RUNTIME_FILES);
    expect(ADMIN_RELEASE_RUNTIME_FILES).toHaveLength(96);
    expect(manifest.nextBuild.excludedPaths).toEqual(ADMIN_RELEASE_NEXT_EXCLUDED_PATHS);
    expect(manifest.nextBuild.files.some((entry) => entry.path === "BUILD_ID")).toBe(true);
    expect(manifest.nextBuild.files.length).toBeGreaterThan(100);
    expect(new Set(manifest.nextBuild.files.map((entry) => entry.mode))).toEqual(new Set([0o644]));
    expect(manifest.node.sha256).toBe(sha256File(process.execPath));
    expect(manifest.productionDependencies.packages.length).toBeGreaterThan(22);
    expect(manifest.productionDependencies.packages.map((entry) => entry.name)).toContain("fast-xml-parser");
    const manifestJson = `${canonicalAdminReleaseJson(manifest)}\n`;
    const root = stage(fixture.appRoot, manifest, manifestJson);
    const manifestPath = join(root, ADMIN_RELEASE_MANIFEST_PATH);
    expect(readVerifiedAdminReleaseManifest(
      root, manifestPath, sha256File(manifestPath), targetNodePath, process.execPath
    )).toEqual(manifest);
    const manifestBytes = readFileSync(manifestPath, "utf8");
    expect(() => readVerifiedAdminReleaseManifest(
      root, manifestPath, "0".repeat(64), targetNodePath, process.execPath
    )).toThrow(/external expected SHA/);
    writeFileSync(manifestPath, manifestBytes.replace(
      `"gitCommit":"${manifest.gitCommit}"`, '"gitCommit":"not-a-git-object-id"'
    ), { mode: 0o600 });
    expect(() => readVerifiedAdminReleaseManifest(
      root, manifestPath, sha256File(manifestPath), targetNodePath, process.execPath
    )).toThrow(/Git or Node identity/);
    writeFileSync(manifestPath, manifestBytes.replace(
      `"gitCommit":"${manifest.gitCommit}"`, `"gitCommit":"${"1".repeat(40)}"`
    ), { mode: 0o600 });
    expect(() => readVerifiedAdminReleaseManifest(
      root, manifestPath, sha256File(manifestPath), targetNodePath, process.execPath
    )).toThrow(/deterministic roots changed/);
    writeFileSync(manifestPath, manifestBytes, { mode: 0o600 });
    const changed = join(root, ".next", manifest.nextBuild.files.find((entry) => entry.path !== "BUILD_ID")!.path);
    writeFileSync(changed, Buffer.concat([readFileSync(changed), Buffer.from("drift")]));
    expect(() => readVerifiedAdminReleaseManifest(
      root, manifestPath, sha256File(manifestPath), targetNodePath, process.execPath
    )).toThrow(/release content closure|Next build/);
  }, 60_000);

  it("rejects representative missing, modified, staged, intent-to-add, rename and merge Git states", () => {
    const modified = makeCleanGitFixture();
    writeFileSync(join(modified.appRoot, ADMIN_RELEASE_RUNTIME_FILES[0]), "runtime drift\n");
    expect(() => resolveAdminReleaseGitIdentity(modified.appRoot, modified.root)).toThrow(/must be clean/);

    const deleted = makeCleanGitFixture();
    unlinkSync(join(deleted.appRoot, ADMIN_RELEASE_RUNTIME_FILES[0]));
    expect(() => resolveAdminReleaseGitIdentity(deleted.appRoot, deleted.root)).toThrow(/required release runtime file|must be clean/);

    const staged = makeCleanGitFixture();
    writeFileSync(join(staged.appRoot, ADMIN_RELEASE_RUNTIME_FILES[0]), "staged drift\n");
    git(["add", "--", `app/${ADMIN_RELEASE_RUNTIME_FILES[0]}`], staged.root, gitEnvironment);
    expect(() => resolveAdminReleaseGitIdentity(staged.appRoot, staged.root)).toThrow(/must be clean/);

    const intent = makeCleanGitFixture();
    const runtimeIntentRelativePath = ADMIN_RELEASE_RUNTIME_FILES[0];
    git(["rm", "-q", "--", `app/${runtimeIntentRelativePath}`], intent.root, gitEnvironment);
    writeFileSync(join(intent.appRoot, runtimeIntentRelativePath), "intent runtime\n");
    git(["add", "-N", "--", `app/${runtimeIntentRelativePath}`], intent.root, gitEnvironment);
    expect(() => resolveAdminReleaseGitIdentity(intent.appRoot, intent.root)).toThrow(/must be clean/);

    const renamed = makeCleanGitFixture();
    git([
      "mv", "--", `app/${ADMIN_RELEASE_RUNTIME_FILES[0]}`, `app/${ADMIN_RELEASE_RUNTIME_FILES[0]}.renamed`
    ], renamed.root, gitEnvironment);
    expect(() => resolveAdminReleaseGitIdentity(renamed.appRoot, renamed.root)).toThrow(/required release runtime file|must be clean/);

    const untrackedReplacement = makeCleanGitFixture();
    const replacementRelativePath = ADMIN_RELEASE_RUNTIME_FILES[0];
    git(["rm", "--cached", "-q", "--", `app/${replacementRelativePath}`], untrackedReplacement.root, gitEnvironment);
    expect(() => resolveAdminReleaseGitIdentity(untrackedReplacement.appRoot, untrackedReplacement.root)).toThrow(/must be clean/);

    const merge = makeCleanGitFixture();
    git(["checkout", "-qb", "side", "HEAD^"], merge.root, gitEnvironment);
    writeFileSync(join(merge.root, "side.txt"), "side\n");
    git(["add", "--", "side.txt"], merge.root, gitEnvironment);
    git(["commit", "-qm", "side"], merge.root, gitEnvironment);
    git(["checkout", "-q", "master"], merge.root, gitEnvironment);
    git(["merge", "--no-ff", "-qm", "merge", "side"], merge.root, gitEnvironment);
    expect(() => resolveAdminReleaseGitIdentity(merge.appRoot, merge.root)).toThrow(/exactly one parent/);

    const missingTracked = makeCleanGitFixture();
    const missingPath = ADMIN_RELEASE_RUNTIME_FILES[0];
    git(["rm", "-q", "--", `app/${missingPath}`], missingTracked.root, gitEnvironment);
    git(["commit", "-qm", "remove runtime"], missingTracked.root, gitEnvironment);
    writeFileSync(join(missingTracked.appRoot, missingPath), readFileSync(join(appRoot, missingPath)));
    expect(() => resolveAdminReleaseGitIdentity(missingTracked.appRoot, missingTracked.root)).toThrow(/must be clean|Git release identity command failed/);
  }, 30_000);
});
