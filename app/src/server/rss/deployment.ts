import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

import { assertNodeVersion, ConfigError } from "../config/env.ts";
import type { RssReleaseManifest } from "./release-manifest.ts";
import { RSS_RELEASE_MANIFEST_PATH } from "./release-manifest.ts";
import {
  RSS_DATABASE_PATH,
  RSS_MIGRATION_SHA256,
  RSS_SCHEMA_SHA256
} from "./repository.ts";
import { RSS_PROFILE_ID } from "./types.ts";

export const RSS_COLLECTOR_LABEL = "com.f1plus1.rss-collector" as const;
export const RSS_COLLECTOR_INTERVAL_SECONDS = 900 as const;
export const RSS_DEPLOYMENT_MANIFEST_SCHEMA = "rss-real-deployment-manifest-v1" as const;
export const RSS_DEPLOYMENT_MANIFEST_PATH = ".local/rss-real-deployment-manifest.json" as const;
export const RSS_FAST_XML_PARSER_VERSION = "5.10.1" as const;

export type RssDeploymentPaths = Readonly<{
  appRoot: string;
  home: string;
  localRoot: string;
  releaseRoot: string;
  logsRoot: string;
  tempRoot: string;
  stdoutLog: string;
  stderrLog: string;
  database: string;
  manifest: string;
  releaseManifest: string;
  plist: string;
  packageJson: string;
  packageLock: string;
  migration: string;
  collector: string;
  scheduled: string;
  installer: string;
  control: string;
  deploymentModule: string;
}>;

type ArtifactIdentity = Readonly<{ path: string; sha256: string }>;

export type RssDeploymentManifest = Readonly<{
  schemaVersion: typeof RSS_DEPLOYMENT_MANIFEST_SCHEMA;
  installationMode: "prepare-only";
  label: typeof RSS_COLLECTOR_LABEL;
  scheduleSeconds: typeof RSS_COLLECTOR_INTERVAL_SECONDS;
  runAtLoad: true;
  keepAlive: false;
  appRoot: string;
  launchAgentPath: string;
  node: Readonly<{ path: string; version: "24.18.0"; sha256: string }>;
  release: Readonly<{
    manifestPath: typeof RSS_RELEASE_MANIFEST_PATH;
    manifestSha256: string;
    gitCommit: string;
    contentRootSha256: string;
    releaseSha256: string;
  }>;
  package: Readonly<{
    packageJson: ArtifactIdentity;
    lock: ArtifactIdentity;
    fastXmlParserVersion: typeof RSS_FAST_XML_PARSER_VERSION;
  }>;
  database: Readonly<{
    profileId: typeof RSS_PROFILE_ID;
    path: typeof RSS_DATABASE_PATH;
    migration: ArtifactIdentity;
    schemaSha256: typeof RSS_SCHEMA_SHA256;
  }>;
  artifacts: Readonly<{
    collector: ArtifactIdentity;
    scheduled: ArtifactIdentity;
    installer: ArtifactIdentity;
    control: ArtifactIdentity;
    deploymentModule: ArtifactIdentity;
    plist: ArtifactIdentity;
  }>;
}>;

function sha256Bytes(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(path: string): string {
  return sha256Bytes(readFileSync(path));
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

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function currentUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new ConfigError("RELEASE_OWNER", "current uid is unavailable");
  return uid;
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function assertOwnedDirectory(path: string, label: string, privateMode: boolean): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== currentUid()) {
    throw new ConfigError("RELEASE_PATH", `${label} must be a real owner-controlled directory`);
  }
  if (privateMode && (stat.mode & 0o777) !== 0o700) {
    throw new ConfigError("RELEASE_PERMISSIONS", `${label} must be mode 700`);
  }
}

export function ensurePrivateDirectory(pathValue: string, anchorValue: string, label: string): void {
  const anchor = resolve(anchorValue);
  const path = resolve(pathValue);
  if (!isInside(anchor, path)) throw new ConfigError("RELEASE_PATH", `${label} escapes its security anchor`);
  assertOwnedDirectory(anchor, `${label} anchor`, false);
  let current = anchor;
  for (const part of relative(anchor, path).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== currentUid()) {
      throw new ConfigError("RELEASE_PATH", `${label} contains an unsafe directory component`);
    }
    if (current !== path && (stat.mode & 0o022) !== 0) {
      throw new ConfigError("RELEASE_PERMISSIONS", `${label} contains a writable directory component`);
    }
    if (current === path) chmodSync(current, 0o700);
  }
  assertOwnedDirectory(path, label, true);
}

export function assertPrivateRegularFile(path: string, label: string, expectedSha256?: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== currentUid() ||
    (stat.mode & 0o777) !== 0o600 || (expectedSha256 !== undefined && sha256File(path) !== expectedSha256)
  ) {
    throw new ConfigError("RELEASE_IDENTITY", `${label} must be an owner-only single-link regular file with the expected hash`);
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function atomicWritePrivateFile(path: string, contents: string): void {
  const parent = dirname(path);
  assertOwnedDirectory(parent, "atomic write parent", true);
  if (existsSync(path)) assertPrivateRegularFile(path, basename(path));
  const candidate = resolve(parent, `.${basename(path)}.candidate-${process.pid}`);
  try {
    writeFileSync(candidate, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(candidate, 0o600);
    const descriptor = openSync(candidate, fsConstants.O_RDONLY);
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    assertPrivateRegularFile(candidate, "atomic write candidate");
    renameSync(candidate, path);
    chmodSync(path, 0o600);
    fsyncDirectory(parent);
    assertPrivateRegularFile(path, basename(path));
  } finally {
    if (existsSync(candidate)) unlinkSync(candidate);
  }
}

export function rssDeploymentPaths(appRootValue: string, homeValue: string): RssDeploymentPaths {
  const appRoot = resolve(appRootValue);
  const home = resolve(homeValue);
  return {
    appRoot,
    home,
    localRoot: resolve(appRoot, ".local"),
    releaseRoot: resolve(appRoot, ".local/release"),
    logsRoot: resolve(appRoot, ".local/logs"),
    tempRoot: resolve(appRoot, ".local/tmp"),
    stdoutLog: resolve(appRoot, ".local/logs/rss-collector.stdout.log"),
    stderrLog: resolve(appRoot, ".local/logs/rss-collector.stderr.log"),
    database: resolve(appRoot, RSS_DATABASE_PATH),
    manifest: resolve(appRoot, RSS_DEPLOYMENT_MANIFEST_PATH),
    releaseManifest: resolve(appRoot, RSS_RELEASE_MANIFEST_PATH),
    plist: resolve(home, `Library/LaunchAgents/${RSS_COLLECTOR_LABEL}.plist`),
    packageJson: resolve(appRoot, "package.json"),
    packageLock: resolve(appRoot, "package-lock.json"),
    migration: resolve(appRoot, "migrations/rss-real/0001_rss_real.sql"),
    collector: resolve(appRoot, "scripts/rss-collect-once.ts"),
    scheduled: resolve(appRoot, "scripts/rss-scheduled-run.ts"),
    installer: resolve(appRoot, "scripts/rss-install-macos.ts"),
    control: resolve(appRoot, "scripts/rss-control.ts"),
    deploymentModule: resolve(appRoot, "src/server/rss/deployment.ts")
  };
}

export function assertRssDeploymentHost(paths: RssDeploymentPaths): void {
  assertNodeVersion();
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new ConfigError("RELEASE_HOST", "macOS arm64 is required for the RSS collector");
  }
  if (/Mobile Documents|CloudDocs/i.test(paths.appRoot)) {
    throw new ConfigError("RELEASE_PATH", "RSS collector app root must not be iCloud-synced");
  }
  if (realpathSync(paths.appRoot) !== paths.appRoot) {
    throw new ConfigError("RELEASE_PATH", "RSS collector app root must not be a symlink");
  }
  assertOwnedDirectory(paths.appRoot, "RSS collector app root", false);
  const nodeStat = lstatSync(process.execPath);
  if (!nodeStat.isFile() || nodeStat.isSymbolicLink() || nodeStat.uid !== currentUid()) {
    throw new ConfigError("RELEASE_NODE", "Node 24 executable must be an owner-controlled regular file");
  }
}

export function prepareRssDeploymentDirectories(paths: RssDeploymentPaths): void {
  ensurePrivateDirectory(paths.localRoot, paths.appRoot, "RSS local root");
  ensurePrivateDirectory(paths.releaseRoot, paths.appRoot, "RSS release manifest root");
  ensurePrivateDirectory(paths.logsRoot, paths.appRoot, "RSS log root");
  ensurePrivateDirectory(paths.tempRoot, paths.appRoot, "RSS temp root");
  ensurePrivateDirectory(dirname(paths.plist), paths.home, "LaunchAgents directory");
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function plistArray(values: readonly string[]): string {
  return ["  <array>", ...values.map((value) => `    <string>${xml(value)}</string>`), "  </array>"].join("\n");
}

export function renderRssCollectorPlist(
  paths: RssDeploymentPaths,
  releaseManifestSha256: string,
  nodePath: string = process.execPath
): string {
  if (!/^[0-9a-f]{64}$/.test(releaseManifestSha256)) {
    throw new ConfigError("RELEASE_MANIFEST_ANCHOR", "scheduled release manifest SHA must be one lowercase SHA-256");
  }
  const arguments_ = [
    "/usr/bin/env",
    "-i",
    `HOME=${paths.home}`,
    `TMPDIR=${paths.tempRoot}`,
    `PATH=${dirname(nodePath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    "RSS_REAL_IO=true",
    `RSS_RELEASE_MANIFEST_SHA256=${releaseManifestSha256}`,
    nodePath,
    "--experimental-strip-types",
    paths.scheduled
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${RSS_COLLECTOR_LABEL}</string>
  <key>ProgramArguments</key>
${plistArray(arguments_)}
  <key>WorkingDirectory</key>
  <string>${xml(paths.appRoot)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${RSS_COLLECTOR_INTERVAL_SECONDS}</integer>
  <key>Umask</key>
  <integer>63</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(paths.stdoutLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(paths.stderrLog)}</string>
</dict>
</plist>
`;
}

function artifact(path: string, relativePath: string): ArtifactIdentity {
  const stat = lstatSync(path);
  if (
    !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== currentUid() ||
    (stat.mode & 0o022) !== 0 || realpathSync(path) !== path
  ) {
    throw new ConfigError("RELEASE_IDENTITY", `${relativePath} must be an owner-controlled single-link release file`);
  }
  return { path: relativePath, sha256: sha256File(path) };
}

export function createRssDeploymentManifest(
  paths: RssDeploymentPaths,
  releaseManifest: RssReleaseManifest,
  releaseManifestSha256: string
): RssDeploymentManifest {
  if (!/^[0-9a-f]{64}$/.test(releaseManifestSha256)) {
    throw new ConfigError("RELEASE_MANIFEST_ANCHOR", "release manifest SHA is invalid");
  }
  const packageJson = JSON.parse(readFileSync(paths.packageJson, "utf8")) as {
    dependencies?: Record<string, unknown>;
  };
  if (packageJson.dependencies?.["fast-xml-parser"] !== RSS_FAST_XML_PARSER_VERSION) {
    throw new ConfigError("RELEASE_DEPENDENCY", "fast-xml-parser identity changed");
  }
  if (sha256File(paths.migration) !== RSS_MIGRATION_SHA256) {
    throw new ConfigError("RELEASE_MIGRATION", "RSS migration identity changed");
  }
  const plist = renderRssCollectorPlist(paths, releaseManifestSha256);
  return {
    schemaVersion: RSS_DEPLOYMENT_MANIFEST_SCHEMA,
    installationMode: "prepare-only",
    label: RSS_COLLECTOR_LABEL,
    scheduleSeconds: RSS_COLLECTOR_INTERVAL_SECONDS,
    runAtLoad: true,
    keepAlive: false,
    appRoot: paths.appRoot,
    launchAgentPath: `Library/LaunchAgents/${RSS_COLLECTOR_LABEL}.plist`,
    node: { path: process.execPath, version: "24.18.0", sha256: sha256File(process.execPath) },
    release: {
      manifestPath: RSS_RELEASE_MANIFEST_PATH,
      manifestSha256: releaseManifestSha256,
      gitCommit: releaseManifest.gitCommit,
      contentRootSha256: releaseManifest.contentRootSha256,
      releaseSha256: releaseManifest.releaseSha256
    },
    package: {
      packageJson: artifact(paths.packageJson, "package.json"),
      lock: artifact(paths.packageLock, "package-lock.json"),
      fastXmlParserVersion: RSS_FAST_XML_PARSER_VERSION
    },
    database: {
      profileId: RSS_PROFILE_ID,
      path: RSS_DATABASE_PATH,
      migration: artifact(paths.migration, "migrations/rss-real/0001_rss_real.sql"),
      schemaSha256: RSS_SCHEMA_SHA256
    },
    artifacts: {
      collector: artifact(paths.collector, "scripts/rss-collect-once.ts"),
      scheduled: artifact(paths.scheduled, "scripts/rss-scheduled-run.ts"),
      installer: artifact(paths.installer, "scripts/rss-install-macos.ts"),
      control: artifact(paths.control, "scripts/rss-control.ts"),
      deploymentModule: artifact(paths.deploymentModule, "src/server/rss/deployment.ts"),
      plist: { path: `Library/LaunchAgents/${RSS_COLLECTOR_LABEL}.plist`, sha256: sha256Bytes(plist) }
    }
  };
}

export function writeRssDeploymentManifest(paths: RssDeploymentPaths, manifest: RssDeploymentManifest): string {
  const bytes = `${canonicalJson(manifest)}\n`;
  atomicWritePrivateFile(paths.manifest, bytes);
  return sha256Bytes(bytes);
}

export function readVerifiedRssDeploymentManifest(
  paths: RssDeploymentPaths,
  releaseManifest: RssReleaseManifest,
  releaseManifestSha256: string
): RssDeploymentManifest {
  assertPrivateRegularFile(paths.manifest, "RSS deployment manifest");
  assertPrivateRegularFile(paths.plist, "RSS collector plist");
  assertPrivateRegularFile(paths.database, "RSS private database");
  assertPrivateRegularFile(paths.stdoutLog, "RSS collector stdout log");
  assertPrivateRegularFile(paths.stderrLog, "RSS collector stderr log");
  for (const suffix of ["-wal", "-shm", "-journal", ".journal"]) {
    const sidecar = `${paths.database}${suffix}`;
    if (existsSync(sidecar)) assertPrivateRegularFile(sidecar, `RSS database ${suffix} sidecar`);
  }
  const bytes = readFileSync(paths.manifest, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    throw new ConfigError("RELEASE_MANIFEST", "RSS deployment manifest is invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError("RELEASE_MANIFEST", "RSS deployment manifest root is invalid");
  }
  const expected = createRssDeploymentManifest(paths, releaseManifest, releaseManifestSha256);
  const expectedBytes = `${canonicalJson(expected)}\n`;
  if (bytes !== expectedBytes) throw new ConfigError("RELEASE_MANIFEST", "RSS deployment manifest identity changed");
  const plist = renderRssCollectorPlist(paths, releaseManifestSha256);
  if (readFileSync(paths.plist, "utf8") !== plist || sha256Bytes(plist) !== expected.artifacts.plist.sha256) {
    throw new ConfigError("RELEASE_PLIST", "RSS collector plist identity changed");
  }
  return expected;
}

const PRODUCTION_WRITE_PREFIXES = [
  join(homedir(), "F1-1-website"),
  join(homedir(), "Library", "Application Support", "F1Plus1"),
  join(homedir(), "Library", "LaunchAgents")
] as const;

function assertDisposableInstallTarget(pathValue: string, label: string): string {
  const path = resolve(pathValue);
  if (!isAbsolute(pathValue) || path !== resolve(pathValue)) {
    throw new ConfigError("RELEASE_PATH", `${label} must be an absolute real path`);
  }
  for (const prefix of PRODUCTION_WRITE_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}${sep}`)) {
      throw new ConfigError("RELEASE_PATH", `${label} must not write a production path`);
    }
  }
  if (path.includes(`${sep}Library${sep}LaunchAgents`) || path.endsWith(`${sep}Library${sep}LaunchAgents`)) {
    throw new ConfigError("RELEASE_PATH", `${label} must not target LaunchAgents`);
  }
  return path;
}

export type Schema10PlistInstallReceipt = Readonly<{
  status: "installed-not-loaded";
  label: typeof RSS_COLLECTOR_LABEL;
  scheduleSeconds: typeof RSS_COLLECTOR_INTERVAL_SECONDS;
  plistPath: string;
  plistSha256: string;
  stdoutLog: string;
  stderrLog: string;
  releaseManifestSha256: string;
  launchctlInvoked: false;
  databaseOpened: false;
}>;

/**
 * schema10 installed-not-loaded installer. Renders the collector plist and
 * writes it to a parameterized directory. It never opens a v1 RSS library,
 * never writes ~/Library/LaunchAgents, and never calls launchctl.
 */
export function installSchema10RssCollectorPlist(input: Readonly<{
  appRoot: string;
  plistDir: string;
  logDir: string;
  releaseManifestSha256: string;
  nodePath?: string;
}>): Schema10PlistInstallReceipt {
  if (!/^[0-9a-f]{64}$/.test(input.releaseManifestSha256)) {
    throw new ConfigError("RELEASE_MANIFEST_ANCHOR", "scheduled release manifest SHA must be one lowercase SHA-256");
  }
  const appRoot = resolve(input.appRoot);
  const plistDir = assertDisposableInstallTarget(input.plistDir, "schema10 plist directory");
  const logDir = assertDisposableInstallTarget(input.logDir, "schema10 log directory");
  for (const directory of [plistDir, logDir]) {
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  ensurePrivateDirectory(plistDir, plistDir, "schema10 plist directory");
  ensurePrivateDirectory(logDir, logDir, "schema10 log directory");
  const stdoutLog = join(logDir, "rss-collector.stdout.log");
  const stderrLog = join(logDir, "rss-collector.stderr.log");
  const plistPath = join(plistDir, `${RSS_COLLECTOR_LABEL}.plist`);
  const paths: RssDeploymentPaths = {
    ...rssDeploymentPaths(appRoot, plistDir),
    stdoutLog,
    stderrLog,
    plist: plistPath
  };
  const plist = renderRssCollectorPlist(paths, input.releaseManifestSha256, input.nodePath ?? process.execPath);
  if (existsSync(plistPath)) throw new ConfigError("RELEASE_RENDER_PATH", "schema10 plist target already exists");
  for (const logPath of [stdoutLog, stderrLog]) {
    if (!existsSync(logPath)) atomicWritePrivateFile(logPath, "");
    else assertPrivateRegularFile(logPath, "RSS collector log");
  }
  atomicWritePrivateFile(plistPath, plist);
  return Object.freeze({
    status: "installed-not-loaded",
    label: RSS_COLLECTOR_LABEL,
    scheduleSeconds: RSS_COLLECTOR_INTERVAL_SECONDS,
    plistPath,
    plistSha256: sha256Bytes(plist),
    stdoutLog,
    stderrLog,
    releaseManifestSha256: input.releaseManifestSha256,
    launchctlInvoked: false,
    databaseOpened: false
  });
}
