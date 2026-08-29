import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ADMIN_RELEASE_MANIFEST_PATH,
  ADMIN_RELEASE_NEXT_EXCLUDED_PATHS,
  ADMIN_RELEASE_PROJECT_ASSET_FILES,
  ADMIN_RELEASE_RUNTIME_FILE_COUNT,
  ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
  ADMIN_RELEASE_RUNTIME_FILES,
  ADMIN_RUNTIME_CLOSURE_SPEC,
  adminBuildInputRoot,
  adminReleaseRuntimePathSetSha256,
  assertAdminReleaseRuntimePathContract,
  buildDependencyClosure,
  buildAdminReleaseManifest,
  canonicalAdminReleaseJson,
  deriveAdminBuildInputRecords,
  normalizeAdminNextBuildPermissions,
  readVerifiedAdminReleaseManifest,
  resolveAdminReleaseGitIdentity
} from "../server/admin-service/release-manifest.ts";
import { ADMIN_BUILD_ROOT_INPUTS, deriveAdminBuildClosure } from "../server/release/build-closure.ts";
import { readStableRegularFile } from "../server/release/local-closure.ts";

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

function sha256Value(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isWithin(parent: string, candidate: string): boolean {
  const delta = relative(resolve(parent), resolve(candidate));
  return delta === "" || (delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta));
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

function assertNativeCopyIdentity(source: string, destination: string): void {
  const hardlinkDestinations = new Map<string, string>();
  const verifyEntry = (sourcePath: string, destinationPath: string): void => {
    const sourceStat = lstatSync(sourcePath);
    const destinationStat = lstatSync(destinationPath);
    if (sourceStat.isDirectory()) {
      if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
        throw new Error(`native fixture copy changed a directory identity: ${sourcePath}`);
      }
      for (const name of readdirSync(sourcePath).sort()) {
        verifyEntry(join(sourcePath, name), join(destinationPath, name));
      }
      return;
    }
    if (sourceStat.isSymbolicLink()) {
      if (!destinationStat.isSymbolicLink() || readlinkSync(sourcePath) !== readlinkSync(destinationPath)) {
        throw new Error(`native fixture copy changed a symlink identity: ${sourcePath}`);
      }
      if (!isWithin(source, realpathSync(sourcePath)) || !isWithin(destination, realpathSync(destinationPath))) {
        throw new Error(`native fixture copy produced an escaping symlink: ${sourcePath}`);
      }
      return;
    }
    if (!sourceStat.isFile() || !destinationStat.isFile()) {
      throw new Error(`native fixture copy encountered an unsupported entry: ${sourcePath}`);
    }
    if (sourceStat.nlink > 1) {
      const key = `${sourceStat.dev}:${sourceStat.ino}`;
      const existingDestination = hardlinkDestinations.get(key);
      if (existingDestination !== undefined && lstatSync(existingDestination).ino !== destinationStat.ino) {
        throw new Error(`native fixture copy changed a hardlink inode: ${sourcePath}`);
      }
      hardlinkDestinations.set(key, destinationPath);
    }
  };
  for (const name of readdirSync(source).sort()) {
    verifyEntry(join(source, name), join(destination, name));
  }
}

function copyTreeContents(source: string, destination: string, options: Readonly<{ nativeVerified?: boolean }> = {}): void {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  if (options.nativeVerified) {
    // Node's native recursive copy avoids ARG_MAX and is only accepted after
    // an explicit inode/symlink identity audit. The small negative fixture
    // below uses the deterministic hardlink-preserving path instead.
    for (const name of readdirSync(source).sort()) {
      cpSync(join(source, name), join(destination, name), {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
        preserveTimestamps: false,
        verbatimSymlinks: true
      });
    }
    assertNativeCopyIdentity(source, destination);
    return;
  }
  const hardlinkDestinations = new Map<string, string>();
  const copyEntry = (sourcePath: string, destinationPath: string): void => {
    const sourceStat = lstatSync(sourcePath);
    if (sourceStat.isDirectory()) {
      mkdirSync(destinationPath, { recursive: true, mode: sourceStat.mode & 0o777 });
      for (const name of readdirSync(sourcePath).sort()) {
        copyEntry(join(sourcePath, name), join(destinationPath, name));
      }
      return;
    }
    if (sourceStat.isSymbolicLink()) {
      symlinkSync(readlinkSync(sourcePath), destinationPath);
      return;
    }
    if (!sourceStat.isFile()) throw new Error(`fixture copy encountered unsupported entry: ${sourcePath}`);
    const hardlinkKey = `${sourceStat.dev}:${sourceStat.ino}`;
    const existingDestination = hardlinkDestinations.get(hardlinkKey);
    if (existingDestination !== undefined) {
      linkSync(existingDestination, destinationPath);
      return;
    }
    copyFileSync(sourcePath, destinationPath);
    hardlinkDestinations.set(hardlinkKey, destinationPath);
  };
  for (const name of readdirSync(source).sort()) {
    copyEntry(join(source, name), join(destination, name));
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

function fixtureBuildReceipt(fixture: Readonly<{ root: string; appRoot: string }>): Parameters<typeof buildAdminReleaseManifest>[4] {
  const identity = resolveAdminReleaseGitIdentity(fixture.appRoot, fixture.root);
  const records = deriveAdminBuildInputRecords(fixture.appRoot, fixture.root, identity.gitCommit);
  const closure = deriveAdminBuildClosure(fixture.appRoot);
  const environment = Object.freeze({ NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", PATH: dirname(process.execPath) });
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
      nodeSha256: sha256File(process.execPath),
      npmVersion: "11.16.0" as const,
      npmLauncherSha256: sha256File(resolve(dirname(process.execPath), "npm")),
      pathDirectory: dirname(process.execPath),
      pathDirectoryRootSha256: "0".repeat(64)
    }),
    environment: Object.freeze({
      allowedEnvFiles: closure.allowedEnvFiles,
      processEnvAllowlist: closure.processEnvAllowlist,
      valuesSha256: Object.freeze(Object.fromEntries(
        Object.entries(environment).map(([key, value]) => [key, sha256Value(value)])
      ))
    }),
    buildDependencyClosure: Object.freeze({
      install: "npm-ci-clean-stage" as const,
      packageLockSha256: sha256File(join(fixture.appRoot, "package-lock.json")),
      ...buildDependencyClosure(fixture.appRoot)
    }),
    sealedBuildInputRootSha256: adminBuildInputRoot(records)
  });
}

function makeCleanBuildInputFixture(): Readonly<{ root: string; appRoot: string }> {
  const requestedRoot = join(tmpdir(), `f1plus1-admin-build-input-${process.pid}-${temporaryRoots.length}`);
  mkdirSync(requestedRoot, { mode: 0o700 });
  const root = realpathSync(requestedRoot);
  temporaryRoots.push(root);
  const cleanAppRoot = join(root, "app");
  mkdirSync(cleanAppRoot, { recursive: true, mode: 0o700 });

  // The build-closure probe must see the same source tree as the real app,
  // while the fixture deliberately excludes developer-only .env files. This
  // keeps the test independent of a developer's local environment without
  // weakening the production RELEASE_ENV policy.
  for (const path of ADMIN_BUILD_ROOT_INPUTS) {
    const source = join(appRoot, path);
    if (!existsSync(source)) continue;
    const destination = join(cleanAppRoot, path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(source, destination);
  }
  for (const directory of ["src", "app", "pages", "public"] as const) {
    const source = join(appRoot, directory);
    if (existsSync(source)) copyTreeContents(source, join(cleanAppRoot, directory));
  }
  for (const name of readdirSync(appRoot).sort()) {
    if (!/^(?:middleware|proxy|instrumentation)\.(?:[cm]?js|[cm]?ts|tsx)$/.test(name)) continue;
    copyFileSync(join(appRoot, name), join(cleanAppRoot, name));
  }
  return Object.freeze({ root, appRoot: cleanAppRoot });
}

function makeCleanGitFixture(includeRuntimeAssets: boolean = false): Readonly<{ root: string; appRoot: string }> {
  const requestedRoot = join(tmpdir(), `f1plus1-admin-release-git-${process.pid}-${temporaryRoots.length}`);
  mkdirSync(requestedRoot, { mode: 0o700 });
  const root = realpathSync(requestedRoot);
  temporaryRoots.push(root);
  const fixtureAppRoot = join(root, "app");
  mkdirSync(fixtureAppRoot, { recursive: true, mode: 0o700 });
  const cleanBuildInput = makeCleanBuildInputFixture();
  const sourcePaths = [...new Set([
    ...ADMIN_RELEASE_RUNTIME_FILES,
    ...deriveAdminBuildClosure(cleanBuildInput.appRoot).paths,
    ...ADMIN_RELEASE_PROJECT_ASSET_FILES
  ])].sort();
  for (const path of sourcePaths) {
    const sourceRoot = path.startsWith("data/") ? projectRoot : appRoot;
    const destination = path.startsWith("data/") ? join(root, path) : join(fixtureAppRoot, path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(join(sourceRoot, path), destination);
  }
  if (includeRuntimeAssets && existsSync(join(appRoot, ".next"))) {
    copyTreeContents(join(appRoot, ".next"), join(fixtureAppRoot, ".next"), { nativeVerified: true });
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
      copyTreeContents(source, join(fixtureAppRoot, "node_modules", packageName), { nativeVerified: true });
    }
  }
  git(["init", "-q"], root, gitEnvironment);
  writeFileSync(join(root, "parent.txt"), "parent\n");
  git(["add", "--", "parent.txt"], root, gitEnvironment);
  git(["commit", "-qm", "parent"], root, gitEnvironment);
  git(["add", "-f", "--", ...sourcePaths.map((path) => path.startsWith("data/") ? path : `app/${path}`)], root, gitEnvironment);
  git(["commit", "-qm", "runtime"], root, gitEnvironment);
  return Object.freeze({ root, appRoot: fixtureAppRoot });
}

function stage(sourceAppRoot: string, manifest: ReturnType<typeof buildAdminReleaseManifest>, manifestJson: string): string {
  const requestedRoot = join(tmpdir(), `f1plus1-admin-release-stage-${process.pid}-${temporaryRoots.length}`);
  mkdirSync(requestedRoot, { mode: 0o700 });
  const root = realpathSync(requestedRoot);
  const stagedAppRoot = join(root, "app");
  mkdirSync(stagedAppRoot, { mode: 0o700 });
  temporaryRoots.push(root);
  const runtimeModes = new Map(manifest.runtimeFiles.map((entry) => [entry.path, entry.mode]));
  const copied = new Set<string>();
  for (const path of ADMIN_RELEASE_RUNTIME_FILES) {
    const destination = join(stagedAppRoot, path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(join(sourceAppRoot, path), destination);
    chmodSync(destination, runtimeModes.get(path) ?? 0o600);
    copied.add(`app/${path}`);
  }
  for (const entry of manifest.buildInputs) {
    if (copied.has(entry.path)) continue;
    const sourceProjectRoot = resolve(sourceAppRoot, "..");
    const relativePath = entry.path.startsWith("app/") ? entry.path.slice("app/".length) : entry.path;
    const source = join(sourceProjectRoot, entry.path);
    const destination = entry.path.startsWith("app/")
      ? join(stagedAppRoot, relativePath)
      : join(root, entry.path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(source, destination);
    chmodSync(destination, entry.mode);
    copied.add(entry.path);
  }
  for (const entry of manifest.nextBuild.files) {
    const destination = join(stagedAppRoot, ".next", entry.path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(join(sourceAppRoot, ".next", entry.path), destination);
    chmodSync(destination, entry.mode);
  }
  const nextDirectories = new Set<string>([join(stagedAppRoot, ".next")]);
  for (const entry of manifest.nextBuild.files) {
    let directory = dirname(join(stagedAppRoot, ".next", entry.path));
    while (directory.startsWith(join(stagedAppRoot, ".next"))) {
      nextDirectories.add(directory);
      if (directory === join(stagedAppRoot, ".next")) break;
      directory = dirname(directory);
    }
  }
  for (const directory of nextDirectories) chmodSync(directory, 0o755);
  const manifestPath = join(stagedAppRoot, ADMIN_RELEASE_MANIFEST_PATH);
  mkdirSync(dirname(manifestPath), { recursive: true, mode: 0o700 });
  writeFileSync(manifestPath, manifestJson, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);
  for (const packageName of manifest.productionDependencies.packages.map((entry) => entry.name)) {
    copyTreeContents(join(sourceAppRoot, "node_modules", packageName), join(stagedAppRoot, "node_modules", packageName), { nativeVerified: true });
  }
  return stagedAppRoot;
}

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

describe("Admin exact release manifest", () => {
  it("freezes the QL1 target closure before any build artifact branch", () => {
    expect(ADMIN_RELEASE_RUNTIME_FILES).toHaveLength(ADMIN_RELEASE_RUNTIME_FILE_COUNT);
    expect(ADMIN_RELEASE_RUNTIME_FILES).toHaveLength(153);
    expect(adminReleaseRuntimePathSetSha256(ADMIN_RELEASE_RUNTIME_FILES)).toBe(ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256);
    expect(() => assertAdminReleaseRuntimePathContract(ADMIN_RELEASE_RUNTIME_FILES)).not.toThrow();
    expect(ADMIN_RELEASE_RUNTIME_FILES).not.toContain("scripts/public-release-bootstrap.ts");
    expect(ADMIN_RUNTIME_CLOSURE_SPEC.entrypoints).not.toContain("scripts/public-release-bootstrap.ts");
    expect(ADMIN_RUNTIME_CLOSURE_SPEC.requiredFiles).not.toContain("scripts/public-release-bootstrap.ts");
    for (const path of [
      "migrations/rss-real/0005_second_rss_autosport.sql",
      "migrations/rss-real/0006_independent_rss_racefans_the_race.sql",
      "src/server/rss/bilingual-gateway-port.ts",
      "src/server/admin-service/deployment.ts",
      "scripts/quick-launch-enter-live.ts",
      "scripts/quick-launch-handoff-pool.ts",
      "scripts/quick-launch-processing-preflight.ts",
      "src/server/internal-operation/release.ts",
      "src/server/internal-operation/handoff-pool.ts",
      "src/server/internal-operation/quick-launch-control.ts",
      "src/server/internal-operation/quick-launch-processing.ts",
      "next-env.d.ts",
      "next.config.ts",
      "package.json",
      "package-lock.json",
      "tsconfig.json"
    ]) {
      expect(ADMIN_RELEASE_RUNTIME_FILES).toContain(path);
    }

    const root = join(tmpdir(), `f1plus1-admin-release-copy-negative-${process.pid}-${temporaryRoots.length}`);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    temporaryRoots.push(root);
    const source = join(root, "source");
    const destination = join(root, "destination");
    const sourceDirectory = join(source, "sub");
    mkdirSync(sourceDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(join(sourceDirectory, "regular.txt"), "hardlink fixture\n", { mode: 0o600 });
    linkSync(join(sourceDirectory, "regular.txt"), join(sourceDirectory, "hardlink.txt"));
    symlinkSync("../../outside/outside.txt", join(sourceDirectory, "escape-link"));

    copyTreeContents(source, destination);

    const copiedRegular = lstatSync(join(destination, "sub/regular.txt"));
    const copiedHardlink = lstatSync(join(destination, "sub/hardlink.txt"));
    expect(copiedRegular.nlink).toBe(2);
    expect(copiedHardlink.nlink).toBe(2);
    expect(copiedRegular.ino).toBe(copiedHardlink.ino);
    expect(lstatSync(join(destination, "sub/escape-link")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(destination, "sub/escape-link"))).toBe("../../outside/outside.txt");

    expect(() => readStableRegularFile(destination, "sub/regular.txt")).toThrow();
    expect(() => readStableRegularFile(destination, "sub/hardlink.txt")).toThrow();
    expect(() => readStableRegularFile(destination, "sub/escape-link")).toThrow();
  });

  it("rejects same-length path substitutions, legacy bootstrap re-declaration, and missing critical inputs", () => {
    const replacement: string[] = [...ADMIN_RELEASE_RUNTIME_FILES];
    replacement[replacement.indexOf(".env.example")] = "src/replaced-runtime.ts";
    expect(replacement).toHaveLength(ADMIN_RELEASE_RUNTIME_FILES.length);
    expect(() => assertAdminReleaseRuntimePathContract(replacement)).toThrow(/canonical identity changed/);

    const bootstrapReplacement: string[] = [...ADMIN_RELEASE_RUNTIME_FILES];
    bootstrapReplacement[0] = "scripts/public-release-bootstrap.ts";
    expect(() => assertAdminReleaseRuntimePathContract(bootstrapReplacement)).toThrow(/legacy public release bootstrap/);

    const missingMigration = [
      ...ADMIN_RELEASE_RUNTIME_FILES.filter((path) => path !== "migrations/rss-real/0005_second_rss_autosport.sql"),
      "src/replaced-runtime.ts"
    ];
    expect(() => assertAdminReleaseRuntimePathContract(missingMigration)).toThrow(/critical release paths/);

    const missingBuildConfig = [
      ...ADMIN_RELEASE_RUNTIME_FILES.filter((path) => path !== "next.config.ts"),
      "src/replaced-runtime.ts"
    ];
    expect(() => assertAdminReleaseRuntimePathContract(missingBuildConfig)).toThrow(/critical release paths/);
  });

  it("builds only from a clean single-parent Git fixture and keeps target verification externally anchored", () => {
    const fixture = makeCleanGitFixture(true);
    if (!existsSync(join(appRoot, ".next"))) {
      expect(() => buildAdminReleaseManifest(
        fixture.appRoot,
        fixture.root,
        targetNodePath,
        process.execPath,
        fixtureBuildReceipt(fixture)
      )).toThrow(/\.next|ENOENT/);
      return;
    }
    const normalized = normalizeAdminNextBuildPermissions(fixture.appRoot);
    expect(normalized.fileCount).toBeGreaterThan(100);
    expect(normalized.directoryCount).toBeGreaterThan(10);
    const manifest = buildAdminReleaseManifest(
      fixture.appRoot,
      fixture.root,
      targetNodePath,
      process.execPath,
      fixtureBuildReceipt(fixture)
    );
    expect(manifest.gitCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.gitTree).toBe(git(["rev-parse", "HEAD^{tree}"], fixture.root));
    expect(manifest.gitParent).toBe(git(["rev-parse", "HEAD^"], fixture.root));
    expect(manifest.runtimeFiles.map((entry) => entry.path)).toEqual([...ADMIN_RELEASE_RUNTIME_FILES].sort());
    expect(ADMIN_RELEASE_RUNTIME_FILES).toHaveLength(ADMIN_RELEASE_RUNTIME_FILE_COUNT);
    expect(ADMIN_RELEASE_RUNTIME_FILES).toHaveLength(manifest.runtimeFiles.length);
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
    expect(readVerifiedAdminReleaseManifest(
      root, manifestPath, sha256File(manifestPath), undefined, process.execPath
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
    expect(() => resolveAdminReleaseGitIdentity(renamed.appRoot, renamed.root)).toThrow(/required release runtime file|must be clean|RELEASE_ENV/);

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
