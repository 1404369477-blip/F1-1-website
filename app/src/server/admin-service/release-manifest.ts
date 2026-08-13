import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { assertNodeVersion, ConfigError } from "../config/env.ts";

export const ADMIN_RELEASE_MANIFEST_SCHEMA = "f1plus1-runtime-release-manifest-v2" as const;
export const ADMIN_RELEASE_MANIFEST_PATH = ".local/release/admin-service-release-manifest.json" as const;

export const ADMIN_RELEASE_RUNTIME_FILES = [
  ".env.example",
  "migrations/rss-real/0001_rss_real.sql",
  "migrations/rss-real/0002_admin_review_publish.sql",
  "migrations/rss-real/0003_projection_delivery_runtime.sql",
  "migrations/rss-real/0004_rss_media_and_chinese_refinement.sql",
  "package-lock.json",
  "package.json",
  "scripts/admin-build-release-manifest.ts",
  "scripts/admin-install-macos.ts",
  "scripts/admin-service.ts",
  "scripts/admin-verify-release-stage.ts",
  "scripts/install-macos-public-beta-core.ts",
  "scripts/install-macos-public-beta.ts",
  "scripts/projection-sender.ts",
  "scripts/rss-collect-once.ts",
  "scripts/rss-refine-once.ts",
  "scripts/rss-scheduled-run.ts",
  "scripts/public-projection-runtime.ts",
  "scripts/public-release-refresh.ts",
  "scripts/serve.ts",
  "src/admin-ui/app.css",
  "src/admin-ui/app.js",
  "src/admin-ui/index.html",
  "src/app/api/health/route.ts",
  "src/app/api/public/feed/route.ts",
  "src/app/api/public/stories/[publicId]/route.ts",
  "src/app/globals.css",
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/stories/[publicId]/not-found.tsx",
  "src/app/stories/[publicId]/page.tsx",
  "src/components/f1/f1-page-shell.tsx",
  "src/components/f1/story-parts.tsx",
  "src/components/f1/theme-preference.ts",
  "src/features/stories/feed-experience.tsx",
  "src/features/stories/hash-params.ts",
  "src/features/stories/public-api.ts",
  "src/features/stories/story-detail-experience.tsx",
  "src/features/stories/timeline-search.ts",
  "src/server/admin-service/auth.ts",
  "src/server/admin-service/deployment.ts",
  "src/server/admin-service/release-manifest.ts",
  "src/server/admin-service/runtime.ts",
  "src/server/admin-service/server.ts",
  "src/server/admin-service/storage.ts",
  "src/server/admin-service/webauthn.ts",
  "src/server/config/capabilities.ts",
  "src/server/config/env.ts",
  "src/server/config/registry.ts",
  "src/server/db/closed-receipt.ts",
  "src/server/db/database.ts",
  "src/server/db/profile.ts",
  "src/server/db/public-multimedia-synthetic.ts",
  "src/server/db/public-synthetic.ts",
  "src/server/db/seed.ts",
  "src/server/db/source-management-synthetic.ts",
  "src/server/db/source.ts",
  "src/server/health.ts",
  "src/server/providers/fixture.ts",
  "src/server/providers/source-fixture.ts",
  "src/server/public/cursor.ts",
  "src/server/public/deployment.ts",
  "src/server/public/error.ts",
  "src/server/public/http.ts",
  "src/server/public/repository.ts",
  "src/server/public/runtime.ts",
  "src/server/public/snapshot-adapter.ts",
  "src/server/public/types.ts",
  "src/server/review-real/backend.ts",
  "src/server/review-real/error.ts",
  "src/server/review-real/mapping.ts",
  "src/server/review-real/migration.ts",
  "src/server/review-real/projection.ts",
  "src/server/review-real/receiver-http.ts",
  "src/server/review-real/repository.ts",
  "src/server/review-real/routes.ts",
  "src/server/review-real/schema.ts",
  "src/server/review-real/security.ts",
  "src/server/review-real/sender.ts",
  "src/server/rss/repository.ts",
  "src/server/rss/parser.ts",
  "src/server/rss/refinement.ts",
  "src/server/rss/transport.ts",
  "src/server/rss/types.ts",
  "src/server/runtime-config.ts",
  "src/server/security/cli.ts",
  "src/server/security/log.ts",
  "src/server/source-management/security.ts",
  "src/server/source-management/http.ts",
  "src/server/source-management/identity.ts",
  "src/server/source-management/raw-context.ts",
  "src/server/source-management/repository.ts",
  "src/server/source-management/runtime.ts",
  "src/server/source-management/server.ts",
  "src/server/source-management/types.ts",
  "src/server/vs1/no-egress.ts"
] as const;

if (new Set(ADMIN_RELEASE_RUNTIME_FILES).size !== ADMIN_RELEASE_RUNTIME_FILES.length) {
  throw new ConfigError("RELEASE_IDENTITY", "runtime file closure contains duplicate paths");
}

type FileRecord = Readonly<{
  path: string;
  mode: number;
  size: number;
  sha256: string;
}>;

export const ADMIN_RELEASE_NEXT_EXCLUDED_PATHS = [
  "cache/.previewinfo",
  "cache/.rscinfo",
  "cache/.tsbuildinfo",
  "diagnostics/build-diagnostics.json",
  "diagnostics/framework.json",
  "diagnostics/route-bundle-stats.json",
  "trace",
  "trace-build",
  "turbopack"
] as const;

export const ADMIN_RELEASE_NEXT_EXECUTABLE_FILES = [] as const;

type DependencyRecord = Readonly<{
  name: string;
  version: string;
  integrity: string;
  files: readonly FileRecord[];
  contentRootSha256: string;
}>;

export type AdminReleaseManifest = Readonly<{
  schemaVersion: typeof ADMIN_RELEASE_MANIFEST_SCHEMA;
  gitCommit: string;
  gitTree: string;
  gitParent: string;
  runtimeFiles: readonly FileRecord[];
  nextBuild: Readonly<{
    files: readonly FileRecord[];
    excludedPaths: typeof ADMIN_RELEASE_NEXT_EXCLUDED_PATHS;
    totalBytes: number;
    contentRootSha256: string;
  }>;
  productionDependencies: Readonly<{
    roots: readonly ["@simplewebauthn/server", "next", "react", "react-dom", "zod"];
    platformPackages: readonly ["@next/swc-darwin-arm64", "@img/sharp-darwin-arm64", "@img/sharp-libvips-darwin-arm64"];
    packages: readonly DependencyRecord[];
    contentRootSha256: string;
  }>;
  node: Readonly<{
    targetPath: string;
    version: "24.18.0";
    sha256: string;
  }>;
  contentRootSha256: string;
  releaseRootSha256: string;
}>;

type LockPackage = Readonly<{
  version?: unknown;
  integrity?: unknown;
  dependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
}>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonicalValue(entry)])
    );
  }
  return value;
}

export function canonicalAdminReleaseJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function currentUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new ConfigError("RELEASE_OWNER", "current uid is unavailable");
  return uid;
}

function fileRecord(root: string, path: string): FileRecord {
  const absolute = resolve(root, path);
  const stat = lstatSync(absolute);
  if (
    !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== currentUid() ||
    (stat.mode & 0o022) !== 0 || realpathSync(absolute) !== absolute ||
    relative(realpathSync(root), absolute).split(sep).includes("..")
  ) {
    throw new ConfigError("RELEASE_IDENTITY", `${path} is not an owner-controlled single-link release file`);
  }
  const bytes = readFileSync(absolute);
  return Object.freeze({ path, mode: stat.mode & 0o777, size: stat.size, sha256: sha256(bytes) });
}

function runtimeFiles(appRoot: string): readonly FileRecord[] {
  return Object.freeze(ADMIN_RELEASE_RUNTIME_FILES.map((path) => fileRecord(appRoot, path)));
}

type NextBuildIdentity = Readonly<{
  absolute: string;
  path: string;
  kind: "directory" | "file";
  dev: number;
  ino: number;
  mode: number;
  excluded: boolean;
}>;

function inspectNextBuild(appRoot: string): readonly NextBuildIdentity[] {
  const root = resolve(appRoot, ".next");
  const realRoot = realpathSync(root);
  if (realRoot !== root) throw new ConfigError("RELEASE_NEXT_BUILD", ".next root realpath changed");
  const excluded = new Set<string>(ADMIN_RELEASE_NEXT_EXCLUDED_PATHS);
  const entries: NextBuildIdentity[] = [];
  const walk = (absolute: string, path: string): void => {
    const stat = lstatSync(absolute);
    if (
      stat.isSymbolicLink() || stat.uid !== currentUid() || realpathSync(absolute) !== absolute ||
      relative(realRoot, absolute).split(sep).includes("..")
    ) throw new ConfigError("RELEASE_NEXT_BUILD", "Next build identity is not owner-controlled");
    const mode = stat.mode & 0o777;
    if (stat.isDirectory()) {
      if (mode !== 0o700 && mode !== 0o755) {
        throw new ConfigError("RELEASE_NEXT_BUILD", "Next build directory mode is not a permitted fresh-build mode");
      }
      entries.push(Object.freeze({ absolute, path, kind: "directory", dev: stat.dev, ino: stat.ino, mode, excluded: false }));
      for (const name of readdirSync(absolute).sort()) {
        walk(resolve(absolute, name), path === "" ? name : `${path}/${name}`);
      }
      return;
    }
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new ConfigError("RELEASE_NEXT_BUILD", "Next build contains a special or multi-link file");
    }
    if (mode !== 0o600 && mode !== 0o644 && mode !== 0o664) {
      throw new ConfigError("RELEASE_NEXT_BUILD", "Next build file mode is not a permitted non-executable fresh-build mode");
    }
    entries.push(Object.freeze({
      absolute,
      path,
      kind: "file",
      dev: stat.dev,
      ino: stat.ino,
      mode,
      excluded: excluded.has(path)
    }));
  };
  walk(root, "");
  return Object.freeze(entries);
}

export function normalizeAdminNextBuildPermissions(appRoot: string): Readonly<{
  fileCount: number;
  directoryCount: number;
  excludedFileCount: number;
}> {
  const entries = inspectNextBuild(appRoot);
  for (const entry of entries) {
    if (entry.kind === "file" && entry.excluded) continue;
    const descriptor = openSync(entry.absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      const before = fstatSync(descriptor);
      if (
        before.dev !== entry.dev || before.ino !== entry.ino || before.uid !== currentUid() ||
        (entry.kind === "file" && (!before.isFile() || before.nlink !== 1)) ||
        (entry.kind === "directory" && !before.isDirectory())
      ) throw new ConfigError("RELEASE_NEXT_BUILD", "Next build identity changed before permission normalization");
      const expectedMode = entry.kind === "directory" ? 0o755 : 0o644;
      fchmodSync(descriptor, expectedMode);
      if ((fstatSync(descriptor).mode & 0o777) !== expectedMode) {
        throw new ConfigError("RELEASE_NEXT_BUILD", "Next build permission normalization did not persist");
      }
    } finally {
      closeSync(descriptor);
    }
  }
  chmodSync(resolve(appRoot, ".next"), 0o755);
  return Object.freeze({
    fileCount: entries.filter((entry) => entry.kind === "file" && !entry.excluded).length,
    directoryCount: entries.filter((entry) => entry.kind === "directory").length,
    excludedFileCount: entries.filter((entry) => entry.kind === "file" && entry.excluded).length
  });
}

function nextBuild(appRoot: string): AdminReleaseManifest["nextBuild"] {
  const root = resolve(appRoot, ".next");
  const rootStat = lstatSync(root);
  if (
    !rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== currentUid() ||
    (rootStat.mode & 0o777) !== 0o755 || realpathSync(root) !== root
  ) throw new ConfigError("RELEASE_NEXT_BUILD", ".next root is not owner-controlled");
  const excluded = new Set<string>(ADMIN_RELEASE_NEXT_EXCLUDED_PATHS);
  const files: FileRecord[] = [];
  const walk = (directory: string): void => {
    const directoryStat = lstatSync(directory);
    if (
      !directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== currentUid() ||
      (directoryStat.mode & 0o777) !== 0o755 || realpathSync(directory) !== directory
    ) throw new ConfigError("RELEASE_NEXT_BUILD", "Next build directory is not owner-controlled");
    for (const name of readdirSync(directory).sort()) {
      const absolute = resolve(directory, name);
      const path = relative(root, absolute).split(sep).join("/");
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new ConfigError("RELEASE_NEXT_BUILD", "Next build contains a symlink");
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) {
        if (!excluded.has(path)) {
          const record = fileRecord(root, path);
          if (record.mode !== 0o644) {
            throw new ConfigError("RELEASE_NEXT_BUILD", "Next build file mode differs from the normalized non-executable mode");
          }
          files.push(record);
        }
      } else throw new ConfigError("RELEASE_NEXT_BUILD", "Next build contains a special file");
    }
  };
  walk(root);
  if (files.length === 0 || !files.some((entry) => entry.path === "BUILD_ID")) {
    throw new ConfigError("RELEASE_NEXT_BUILD", "Next build is empty or BUILD_ID is missing");
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const frozen = Object.freeze(files);
  return Object.freeze({
    files: frozen,
    excludedPaths: ADMIN_RELEASE_NEXT_EXCLUDED_PATHS,
    totalBytes: frozen.reduce((total, entry) => total + entry.size, 0),
    contentRootSha256: sha256(canonicalAdminReleaseJson(frozen))
  });
}

function dependencyFiles(packageRoot: string): readonly FileRecord[] {
  const records: FileRecord[] = [];
  const walk = (directory: string): void => {
    const directoryStat = lstatSync(directory);
    if (
      !directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== currentUid() ||
      (directoryStat.mode & 0o022) !== 0 || realpathSync(directory) !== directory
    ) {
      throw new ConfigError("RELEASE_DEPENDENCY", "dependency directory is not owner-controlled");
    }
    for (const name of readdirSync(directory).sort()) {
      const absolute = resolve(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        const packageRelative = relative(packageRoot, absolute).split(sep).join("/");
        if (!packageRelative.startsWith("node_modules/.bin/")) {
          throw new ConfigError("RELEASE_DEPENDENCY", "dependency tree contains a symlink");
        }
        continue;
      }
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) records.push(fileRecord(packageRoot, relative(packageRoot, absolute).split(sep).join("/")));
      else throw new ConfigError("RELEASE_DEPENDENCY", "dependency tree contains a special file");
    }
  };
  walk(packageRoot);
  records.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return Object.freeze(records);
}

function productionDependencies(appRoot: string): AdminReleaseManifest["productionDependencies"] {
  const lock = JSON.parse(readFileSync(resolve(appRoot, "package-lock.json"), "utf8")) as {
    packages?: Record<string, LockPackage>;
  };
  if (!lock.packages) throw new ConfigError("RELEASE_DEPENDENCY", "package-lock packages are missing");
  const names = new Set<string>();
  const visit = (name: string, includeOptional: boolean = false): void => {
    if (names.has(name)) return;
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry || typeof entry.version !== "string" || typeof entry.integrity !== "string") {
      throw new ConfigError("RELEASE_DEPENDENCY", `package-lock identity is missing for ${name}`);
    }
    names.add(name);
    for (const dependency of Object.keys(entry.dependencies ?? {}).sort()) visit(dependency);
    if (includeOptional) {
      for (const dependency of Object.keys(entry.optionalDependencies ?? {}).sort()) {
        if ([
          "@next/swc-darwin-arm64",
          "sharp"
        ].includes(dependency)) visit(dependency, dependency === "sharp");
      }
    }
  };
  const roots = ["@simplewebauthn/server", "next", "react", "react-dom", "zod"] as const;
  for (const root of roots) visit(root, root === "next");
  for (const platformPackage of [
    "@next/swc-darwin-arm64",
    "@img/sharp-darwin-arm64",
    "@img/sharp-libvips-darwin-arm64"
  ] as const) visit(platformPackage, true);
  const packages = [...names].sort().map((name): DependencyRecord => {
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry || typeof entry.version !== "string" || typeof entry.integrity !== "string") {
      throw new ConfigError("RELEASE_DEPENDENCY", `package-lock identity is missing for ${name}`);
    }
    const files = dependencyFiles(resolve(appRoot, "node_modules", name));
    return Object.freeze({
      name,
      version: entry.version,
      integrity: entry.integrity,
      files,
      contentRootSha256: sha256(canonicalAdminReleaseJson(files))
    });
  });
  const platformPackages = [
    "@next/swc-darwin-arm64",
    "@img/sharp-darwin-arm64",
    "@img/sharp-libvips-darwin-arm64"
  ] as const;
  for (const required of [...roots, ...platformPackages]) {
    if (!names.has(required)) throw new ConfigError("RELEASE_DEPENDENCY", `required runtime package is missing: ${required}`);
  }
  return Object.freeze({
    roots,
    platformPackages,
    packages: Object.freeze(packages),
    contentRootSha256: sha256(canonicalAdminReleaseJson(packages.map(({ files: _files, ...identity }) => identity)))
  });
}

function assertTargetNodePath(value: string): void {
  if (!isAbsolute(value) || value.includes("\0") || !value.endsWith("/.local/node-v24.18.0-darwin-arm64/bin/node")) {
    throw new ConfigError("RELEASE_NODE", "target Node path must be the fixed absolute Node 24 arm64 path");
  }
}

function assertLocalNodePath(value: string): string {
  const localNode = resolve(value);
  const localNodeStat = lstatSync(localNode);
  if (
    !localNodeStat.isFile() || localNodeStat.isSymbolicLink() || localNodeStat.nlink !== 1 ||
    localNodeStat.uid !== currentUid() || (localNodeStat.mode & 0o022) !== 0 ||
    realpathSync(localNode) !== localNode || localNode !== process.execPath
  ) {
    throw new ConfigError("RELEASE_NODE", "local Node bytes must come from the current fixed Node process");
  }
  return localNode;
}

function roots(input: Readonly<{
  gitCommit: string;
  gitTree: string;
  gitParent: string;
  runtimeFiles: readonly FileRecord[];
  nextBuild: AdminReleaseManifest["nextBuild"];
  productionDependencies: AdminReleaseManifest["productionDependencies"];
  node: AdminReleaseManifest["node"];
}>): Readonly<{ contentRootSha256: string; releaseRootSha256: string }> {
  const contentRootSha256 = sha256(canonicalAdminReleaseJson({
    runtimeFiles: input.runtimeFiles,
    nextBuild: input.nextBuild,
    productionDependencies: input.productionDependencies,
    node: input.node
  }));
  return Object.freeze({
    contentRootSha256,
    releaseRootSha256: sha256(canonicalAdminReleaseJson({
      gitCommit: input.gitCommit,
      gitTree: input.gitTree,
      gitParent: input.gitParent,
      contentRootSha256
    }))
  });
}

function gitOutput(projectRoot: string, arguments_: readonly string[]): string {
  const result = spawnSync("/usr/bin/git", ["-C", projectRoot, ...arguments_], {
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new ConfigError("RELEASE_GIT", "Git release identity command failed");
  return result.stdout.trim();
}

function gitBytes(projectRoot: string, arguments_: readonly string[]): string {
  const result = spawnSync("/usr/bin/git", ["-C", projectRoot, ...arguments_], {
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new ConfigError("RELEASE_GIT", "Git release identity command failed");
  return result.stdout;
}

const REQUIRED_RELEASE_SCRIPTS = Object.freeze({
  "admin:build-release-manifest": "node --experimental-strip-types scripts/admin-build-release-manifest.ts",
  "admin:verify-release-stage": "node --experimental-strip-types scripts/admin-verify-release-stage.ts",
  "projection:sender-once": "node --experimental-strip-types scripts/projection-sender.ts",
  "projection:public-runtime": "node --experimental-strip-types scripts/public-projection-runtime.ts",
  "release:build-and-manifest": "npm run build && npm run admin:build-release-manifest"
});

function assertRequiredReleaseScripts(appRoot: string): void {
  let packageJson: Record<string, unknown>;
  let lockRoot: Record<string, unknown>;
  try {
    packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")) as Record<string, unknown>;
    const packageLock = JSON.parse(readFileSync(resolve(appRoot, "package-lock.json"), "utf8")) as {
      packages?: Record<string, Record<string, unknown>>;
    };
    lockRoot = packageLock.packages?.[""] ?? {};
  } catch {
    throw new ConfigError("RELEASE_GIT", "package.json or package-lock.json is invalid JSON");
  }
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    throw new ConfigError("RELEASE_GIT", "package.json release scripts are missing");
  }
  for (const [name, command] of Object.entries(REQUIRED_RELEASE_SCRIPTS)) {
    if ((scripts as Record<string, unknown>)[name] !== command) {
      throw new ConfigError("RELEASE_GIT", `package.json release script is invalid: ${name}`);
    }
  }
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    if (canonicalAdminReleaseJson(packageJson[field] ?? {}) !== canonicalAdminReleaseJson(lockRoot[field] ?? {})) {
      throw new ConfigError("RELEASE_GIT", `package.json ${field} differs from the locked root`);
    }
  }
}

function assertRuntimeClosureDefinition(appRoot: string): void {
  const runtimePaths = new Set(ADMIN_RELEASE_RUNTIME_FILES);
  for (const relativePath of [
    "scripts/admin-build-release-manifest.ts",
    "scripts/admin-verify-release-stage.ts",
    "scripts/projection-sender.ts",
    "scripts/public-projection-runtime.ts"
  ] as const) {
    if (!runtimePaths.has(relativePath)) {
      throw new ConfigError("RELEASE_IDENTITY", `required release runtime file is absent: ${relativePath}`);
    }
    fileRecord(appRoot, relativePath);
  }
}

export type AdminReleaseGitIdentity = Readonly<{ gitCommit: string; gitTree: string; gitParent: string }>;

const GIT_OBJECT_ID_PATTERN = /^[0-9a-f]{40}$/;

function currentSingleParentGitIdentity(projectRoot: string): AdminReleaseGitIdentity {
  const parts = gitOutput(projectRoot, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ");
  if (parts.length !== 2 || parts.some((entry) => !GIT_OBJECT_ID_PATTERN.test(entry))) {
    throw new ConfigError("RELEASE_GIT", "Admin release HEAD must be one commit with exactly one parent");
  }
  const [gitCommit, gitParent] = parts;
  const gitTree = gitOutput(projectRoot, ["rev-parse", `${gitCommit}^{tree}`]);
  if (!GIT_OBJECT_ID_PATTERN.test(gitTree) || gitOutput(projectRoot, ["rev-parse", "--verify", "HEAD"]) !== gitCommit) {
    throw new ConfigError("RELEASE_GIT", "Admin release Git commit or tree identity is invalid");
  }
  return Object.freeze({ gitCommit, gitTree, gitParent });
}

function assertRuntimePathsTrackedAtHead(projectRoot: string, gitCommit: string, gitPaths: readonly string[]): void {
  gitOutput(projectRoot, ["ls-files", "--error-unmatch", "--", ...gitPaths]);
  for (const path of gitPaths) {
    const expectedBlob = gitOutput(projectRoot, ["rev-parse", `${gitCommit}:${path}`]);
    const actualBlob = gitOutput(projectRoot, ["hash-object", "--", path]);
    if (expectedBlob !== actualBlob) {
      throw new ConfigError("RELEASE_GIT", `${path} bytes differ from the current HEAD`);
    }
  }
}

export function resolveAdminReleaseGitIdentity(appRoot: string, projectRoot: string): AdminReleaseGitIdentity {
  const identity = currentSingleParentGitIdentity(projectRoot);
  if (
    realpathSync(resolve(projectRoot, "app")) !== realpathSync(appRoot)
  ) {
    throw new ConfigError("RELEASE_GIT", "Admin release app root differs from the Git project root");
  }
  assertRuntimeClosureDefinition(appRoot);
  assertRequiredReleaseScripts(appRoot);
  const runtimePaths = ADMIN_RELEASE_RUNTIME_FILES.map((path) => `app/${path}`);
  const runtimeStatus = gitBytes(projectRoot, [
    "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...runtimePaths
  ]);
  if (runtimeStatus !== "") {
    throw new ConfigError("RELEASE_GIT", "Admin runtime closure must be clean at the current HEAD");
  }
  assertRuntimePathsTrackedAtHead(projectRoot, identity.gitCommit, runtimePaths);
  return identity;
}

export function buildAdminReleaseManifest(
  appRoot: string,
  projectRoot: string,
  targetNodePath: string,
  localNodePath: string = process.execPath
): AdminReleaseManifest {
  assertNodeVersion();
  assertTargetNodePath(targetNodePath);
  const gitIdentity = resolveAdminReleaseGitIdentity(appRoot, projectRoot);
  const localNode = assertLocalNodePath(localNodePath);
  const node = Object.freeze({
    targetPath: targetNodePath,
    version: "24.18.0" as const,
    sha256: sha256(readFileSync(localNode))
  });
  const input = Object.freeze({
    ...gitIdentity,
    runtimeFiles: runtimeFiles(appRoot),
    nextBuild: nextBuild(appRoot),
    productionDependencies: productionDependencies(appRoot),
    node
  });
  return Object.freeze({ schemaVersion: ADMIN_RELEASE_MANIFEST_SCHEMA, ...input, ...roots(input) });
}

export function readVerifiedAdminReleaseManifest(
  appRoot: string,
  manifestPath: string,
  expectedManifestSha256: string | undefined,
  targetNodePath: string = process.execPath,
  localNodePath: string = process.execPath
): AdminReleaseManifest {
  assertNodeVersion();
  assertTargetNodePath(targetNodePath);
  const localNode = assertLocalNodePath(localNodePath);
  if (!expectedManifestSha256 || !/^[0-9a-f]{64}$/.test(expectedManifestSha256)) {
    throw new ConfigError("RELEASE_MANIFEST_ANCHOR", "ADMIN_EXPECTED_RELEASE_MANIFEST_SHA256 must be one lowercase SHA-256");
  }
  const absoluteManifestPath = resolve(manifestPath);
  const stat = lstatSync(absoluteManifestPath);
  if (
    !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== currentUid() ||
    (stat.mode & 0o777) !== 0o600 || realpathSync(absoluteManifestPath) !== absoluteManifestPath
  ) {
    throw new ConfigError("RELEASE_MANIFEST", "Admin release manifest must be one owner-only single-link file");
  }
  const bytes = readFileSync(absoluteManifestPath);
  if (sha256(bytes) !== expectedManifestSha256) {
    throw new ConfigError("RELEASE_MANIFEST_ANCHOR", "Admin release manifest bytes do not match the external expected SHA");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new ConfigError("RELEASE_MANIFEST", "Admin release manifest is invalid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError("RELEASE_MANIFEST", "Admin release manifest root is invalid");
  }
  const candidate = parsed as Partial<AdminReleaseManifest>;
  const node = candidate.node;
  if (
    candidate.schemaVersion !== ADMIN_RELEASE_MANIFEST_SCHEMA ||
    typeof candidate.gitCommit !== "string" || !GIT_OBJECT_ID_PATTERN.test(candidate.gitCommit) ||
    typeof candidate.gitTree !== "string" || !GIT_OBJECT_ID_PATTERN.test(candidate.gitTree) ||
    typeof candidate.gitParent !== "string" || !GIT_OBJECT_ID_PATTERN.test(candidate.gitParent) ||
    !node || node.targetPath !== targetNodePath || node.version !== "24.18.0" ||
    node.sha256 !== sha256(readFileSync(localNode))
  ) {
    throw new ConfigError("RELEASE_MANIFEST", "Admin release manifest Git or Node identity is invalid");
  }
  assertTargetNodePath(node.targetPath);
  const input = Object.freeze({
    gitCommit: candidate.gitCommit,
    gitTree: candidate.gitTree,
    gitParent: candidate.gitParent,
    runtimeFiles: runtimeFiles(appRoot),
    nextBuild: nextBuild(appRoot),
    productionDependencies: productionDependencies(appRoot),
    node
  });
  const expected: AdminReleaseManifest = Object.freeze({
    schemaVersion: ADMIN_RELEASE_MANIFEST_SCHEMA,
    ...input,
    ...roots(input)
  });
  if (`${canonicalAdminReleaseJson(expected)}\n` !== bytes.toString("utf8")) {
    throw new ConfigError("RELEASE_MANIFEST", "Admin release content closure or deterministic roots changed");
  }
  return expected;
}
