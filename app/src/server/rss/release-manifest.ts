import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { assertNodeVersion, ConfigError } from "../config/env.ts";

export const RSS_RELEASE_MANIFEST_SCHEMA = "rss-real-release-manifest-v1" as const;
export const RSS_RELEASE_MANIFEST_PATH = ".local/release/rss-real-release-manifest.json" as const;

export const RSS_RELEASE_RUNTIME_FILES = [
  "migrations/rss-real/0001_rss_real.sql",
  "package-lock.json",
  "package.json",
  "scripts/rss-build-release-manifest.ts",
  "scripts/rss-collect-once.ts",
  "scripts/rss-control.ts",
  "scripts/rss-install-macos.ts",
  "scripts/rss-scheduled-run.ts",
  "src/server/config/env.ts",
  "src/server/db/database.ts",
  "src/server/rss/deployment.ts",
  "src/server/rss/parser.ts",
  "src/server/rss/release-manifest.ts",
  "src/server/rss/repository.ts",
  "src/server/rss/transport.ts",
  "src/server/rss/types.ts",
  "src/server/runtime-config.ts",
  "src/server/security/cli.ts",
  "src/server/security/log.ts"
] as const;

type FileRecord = Readonly<{
  path: string;
  mode: number;
  size: number;
  sha256: string;
}>;

type DependencyRecord = Readonly<{
  name: string;
  version: string;
  integrity: string;
  files: readonly FileRecord[];
  contentRootSha256: string;
}>;

export type RssReleaseManifest = Readonly<{
  schemaVersion: typeof RSS_RELEASE_MANIFEST_SCHEMA;
  gitCommit: string;
  runtimeFiles: readonly FileRecord[];
  productionDependencies: Readonly<{
    root: "fast-xml-parser";
    packages: readonly DependencyRecord[];
    contentRootSha256: string;
  }>;
  node: Readonly<{
    targetPath: string;
    version: "24.18.0";
    sha256: string;
  }>;
  contentRootSha256: string;
  releaseSha256: string;
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

export function canonicalReleaseJson(value: unknown): string {
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
    (stat.mode & 0o022) !== 0 || realpathSync(absolute) !== absolute
  ) {
    throw new ConfigError("RELEASE_IDENTITY", `${path} is not an owner-controlled single-link release file`);
  }
  const bytes = readFileSync(absolute);
  return { path, mode: stat.mode & 0o777, size: stat.size, sha256: sha256(bytes) };
}

function runtimeFiles(appRoot: string): readonly FileRecord[] {
  return RSS_RELEASE_RUNTIME_FILES.map((path) => fileRecord(appRoot, path));
}

function dependencyFiles(packageRoot: string): readonly FileRecord[] {
  const records: FileRecord[] = [];
  const walk = (directory: string): void => {
    const directoryStat = lstatSync(directory);
    if (
      !directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== currentUid() ||
      (directoryStat.mode & 0o022) !== 0
    ) {
      throw new ConfigError("RELEASE_DEPENDENCY", "dependency directory is not owner-controlled");
    }
    for (const name of readdirSync(directory).sort()) {
      const absolute = resolve(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new ConfigError("RELEASE_DEPENDENCY", "dependency tree contains a symlink");
      if (stat.isDirectory()) {
        walk(absolute);
      } else if (stat.isFile()) {
        const path = relative(packageRoot, absolute).split(sep).join("/");
        records.push(fileRecord(packageRoot, path));
      } else {
        throw new ConfigError("RELEASE_DEPENDENCY", "dependency tree contains a special file");
      }
    }
  };
  walk(packageRoot);
  return records.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

type LockPackage = Readonly<{
  version?: unknown;
  integrity?: unknown;
  dependencies?: Record<string, unknown>;
}>;

function productionDependencies(appRoot: string): RssReleaseManifest["productionDependencies"] {
  const lock = JSON.parse(readFileSync(resolve(appRoot, "package-lock.json"), "utf8")) as {
    packages?: Record<string, LockPackage>;
  };
  if (!lock.packages) throw new ConfigError("RELEASE_DEPENDENCY", "package-lock packages are missing");
  const names = new Set<string>();
  const visit = (name: string): void => {
    if (names.has(name)) return;
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry || typeof entry.version !== "string" || typeof entry.integrity !== "string") {
      throw new ConfigError("RELEASE_DEPENDENCY", `package-lock identity is missing for ${name}`);
    }
    names.add(name);
    for (const dependency of Object.keys(entry.dependencies ?? {}).sort()) visit(dependency);
  };
  visit("fast-xml-parser");
  const packages = [...names].sort().map((name): DependencyRecord => {
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry || typeof entry.version !== "string" || typeof entry.integrity !== "string") {
      throw new ConfigError("RELEASE_DEPENDENCY", `package-lock identity is missing for ${name}`);
    }
    const files = dependencyFiles(resolve(appRoot, "node_modules", name));
    return {
      name,
      version: entry.version,
      integrity: entry.integrity,
      files,
      contentRootSha256: sha256(canonicalReleaseJson(files))
    };
  });
  return {
    root: "fast-xml-parser",
    packages,
    contentRootSha256: sha256(canonicalReleaseJson(packages.map(({ files: _files, ...identity }) => identity)))
  };
}

function assertTargetNodePath(value: string): void {
  if (
    !isAbsolute(value) || value.includes("\0") ||
    !value.endsWith("/.local/node-v24.18.0-darwin-arm64/bin/node")
  ) {
    throw new ConfigError("RELEASE_NODE", "target Node path must be the fixed absolute Node 24 arm64 path");
  }
}

function roots(input: Readonly<{
  gitCommit: string;
  runtimeFiles: readonly FileRecord[];
  productionDependencies: RssReleaseManifest["productionDependencies"];
  node: RssReleaseManifest["node"];
}>): Readonly<{ contentRootSha256: string; releaseSha256: string }> {
  const contentRootSha256 = sha256(canonicalReleaseJson({
    runtimeFiles: input.runtimeFiles,
    productionDependencies: input.productionDependencies,
    node: input.node
  }));
  return {
    contentRootSha256,
    releaseSha256: sha256(canonicalReleaseJson({ gitCommit: input.gitCommit, contentRootSha256 }))
  };
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

function cleanGitCommit(appRoot: string, projectRoot: string): string {
  const gitPaths = RSS_RELEASE_RUNTIME_FILES.map((path) => `app/${path}`);
  const commit = gitOutput(projectRoot, ["rev-parse", "--verify", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new ConfigError("RELEASE_GIT", "Git HEAD is not one exact commit");
  gitOutput(projectRoot, ["ls-files", "--error-unmatch", "--", ...gitPaths]);
  if (gitOutput(projectRoot, ["status", "--porcelain=v1", "--untracked-files=all", "--", ...gitPaths]) !== "") {
    throw new ConfigError("RELEASE_GIT", "release runtime closure is dirty or untracked");
  }
  if (realpathSync(resolve(projectRoot, "app")) !== realpathSync(appRoot)) {
    throw new ConfigError("RELEASE_GIT", "app root does not match the Git release root");
  }
  return commit;
}

export function buildRssReleaseManifest(appRoot: string, projectRoot: string, targetNodePath: string): RssReleaseManifest {
  assertNodeVersion();
  assertTargetNodePath(targetNodePath);
  const node = {
    targetPath: targetNodePath,
    version: "24.18.0" as const,
    sha256: sha256(readFileSync(process.execPath))
  };
  const input = {
    gitCommit: cleanGitCommit(appRoot, projectRoot),
    runtimeFiles: runtimeFiles(appRoot),
    productionDependencies: productionDependencies(appRoot),
    node
  };
  return { schemaVersion: RSS_RELEASE_MANIFEST_SCHEMA, ...input, ...roots(input) };
}

export function readVerifiedRssReleaseManifest(
  appRoot: string,
  manifestPath: string,
  expectedManifestSha256: string | undefined
): RssReleaseManifest {
  assertNodeVersion();
  if (!expectedManifestSha256 || !/^[0-9a-f]{64}$/.test(expectedManifestSha256)) {
    throw new ConfigError("RELEASE_MANIFEST_ANCHOR", "RSS_EXPECTED_RELEASE_MANIFEST_SHA256 must be one lowercase SHA-256");
  }
  const stat = lstatSync(manifestPath);
  if (
    !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== currentUid() ||
    (stat.mode & 0o777) !== 0o600 || realpathSync(manifestPath) !== manifestPath
  ) {
    throw new ConfigError("RELEASE_MANIFEST", "release manifest must be one owner-only single-link file");
  }
  const bytes = readFileSync(manifestPath);
  if (sha256(bytes) !== expectedManifestSha256) {
    throw new ConfigError("RELEASE_MANIFEST_ANCHOR", "release manifest bytes do not match the external expected SHA");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ConfigError("RELEASE_MANIFEST", "release manifest is invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError("RELEASE_MANIFEST", "release manifest root is invalid");
  }
  const candidate = parsed as Partial<RssReleaseManifest>;
  const node = candidate.node;
  if (
    candidate.schemaVersion !== RSS_RELEASE_MANIFEST_SCHEMA ||
    typeof candidate.gitCommit !== "string" || !/^[0-9a-f]{40}$/.test(candidate.gitCommit) ||
    !node || node.targetPath !== process.execPath || node.version !== "24.18.0" ||
    node.sha256 !== sha256(readFileSync(process.execPath))
  ) {
    throw new ConfigError("RELEASE_MANIFEST", "release manifest Node or commit identity is invalid");
  }
  assertTargetNodePath(node.targetPath);
  const input = {
    gitCommit: candidate.gitCommit,
    runtimeFiles: runtimeFiles(appRoot),
    productionDependencies: productionDependencies(appRoot),
    node
  };
  const expected: RssReleaseManifest = {
    schemaVersion: RSS_RELEASE_MANIFEST_SCHEMA,
    ...input,
    ...roots(input)
  };
  if (`${canonicalReleaseJson(expected)}\n` !== bytes.toString("utf8")) {
    throw new ConfigError("RELEASE_MANIFEST", "release content closure or deterministic roots changed");
  }
  return expected;
}
