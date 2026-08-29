import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import {
  readVerifiedAdminReleaseManifest,
  type AdminReleaseManifest
} from "../src/server/admin-service/release-manifest.ts";
import {
  preparePublicProjectionDeployment,
  publicProjectionDeploymentPaths,
  publicProjectionRootForHome,
  PUBLIC_PROJECTION_SERVICE_LABEL
} from "../src/server/public/deployment.ts";
import { ConfigError } from "../src/server/config/env.ts";

export const PUBLIC_APP_LABEL = "com.f1plus1.public-beta" as const;
export const PUBLIC_QUICK_TUNNEL_LABEL = "com.f1plus1.quick-tunnel" as const;

type FileBackup = Readonly<{ path: string; existed: boolean; bytes: Buffer | null; mode: number | null }>;
type StagedFile = Readonly<{ source: string; target: string }>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertPrivateRegular(path: string): void {
  const stat = lstatSync(path);
  const uid = process.getuid?.();
  if (
    !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || uid === undefined || stat.uid !== uid ||
    (stat.mode & 0o077) !== 0 || realpathSync(path) !== path
  ) throw new ConfigError("PUBLIC_PREPARE_PATH", "file is not owner-only and single-link");
}

function assertOwnedRealDirectory(path: string): void {
  const stat = lstatSync(path);
  const uid = process.getuid?.();
  if (
    !stat.isDirectory() || stat.isSymbolicLink() || uid === undefined || stat.uid !== uid ||
    realpathSync(path) !== path
  ) throw new ConfigError("PUBLIC_PREPARE_PATH", "directory is not a real current-user root");
}

function assertRollbackBuildId(path: string): string {
  const buildIdPath = resolve(path, ".next/BUILD_ID");
  assertPrivateRegular(buildIdPath);
  const value = readFileSync(buildIdPath, "utf8").trim();
  if (!value || /[\u0000\r\n]/.test(value)) {
    throw new ConfigError("PUBLIC_ROLLBACK_ANCHOR", "synthetic rollback BUILD_ID is invalid");
  }
  return value;
}

function ensurePrivateDirectory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  const stat = lstatSync(path);
  const uid = process.getuid?.();
  if (!stat.isDirectory() || stat.isSymbolicLink() || uid === undefined || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
    throw new ConfigError("PUBLIC_PREPARE_PATH", "directory is not owner-only");
  }
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function xmlArray(values: readonly string[]): string {
  return ["  <array>", ...values.map((value) => `    <string>${xml(value)}</string>`), "  </array>"].join("\n");
}

function disabledPlist(input: Readonly<{
  label: string;
  programArguments: readonly string[];
  appRoot: string;
  stdout: string;
  stderr: string;
}>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(input.label)}</string>
  <key>ProgramArguments</key>${xmlArray(input.programArguments)}
  <key>WorkingDirectory</key><string>${xml(input.appRoot)}</string>
  <key>RunAtLoad</key><false/>
  <key>KeepAlive</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(input.stdout)}</string>
  <key>StandardErrorPath</key><string>${xml(input.stderr)}</string>
  <key>Umask</key><integer>63</integer>
</dict></plist>
`;
}

function backup(path: string): FileBackup {
  if (!existsSync(path)) return Object.freeze({ path, existed: false, bytes: null, mode: null });
  assertPrivateRegular(path);
  const stat = lstatSync(path);
  return Object.freeze({ path, existed: true, bytes: readFileSync(path), mode: stat.mode & 0o777 });
}

function atomicReplace(path: string, bytes: string | Buffer, mode = 0o600): void {
  ensurePrivateDirectory(dirname(path));
  const temporary = `${path}.stage-${randomUUID()}`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      mode
    );
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
    chmodSync(path, mode);
    const parentDescriptor = openSync(dirname(path), fsConstants.O_RDONLY);
    try { fsyncSync(parentDescriptor); } finally { closeSync(parentDescriptor); }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function restore(value: FileBackup): void {
  if (!value.existed) {
    if (existsSync(value.path)) unlinkSync(value.path);
    return;
  }
  atomicReplace(value.path, value.bytes!, value.mode!);
}

function required(input: Record<string, string | undefined>, name: string): string {
  const value = input[name];
  if (!value) throw new ConfigError("PUBLIC_PREPARE_INPUT_MISSING", `${name} is required`);
  return value;
}

export type PublicMacPrepareInput = Readonly<{
  appRoot: string;
  projectRoot: string;
  home: string;
  nodePath: string;
  localNodePath?: string;
  environment: Record<string, string | undefined>;
  beforeCommit?: () => void;
  afterCommit?: (index: number) => void;
}>;

export function preparePublicMacAgents(input: PublicMacPrepareInput): Readonly<{
  release: AdminReleaseManifest;
  manifestSha256: string;
  plistPaths: readonly string[];
  projectionManifestSha256: string;
  projectionPlistSha256: string;
}> {
  const manifestPath = resolve(required(input.environment, "F1_RELEASE_MANIFEST_PATH"));
  const manifestSha256 = required(input.environment, "F1_RELEASE_MANIFEST_SHA256");
  const release = readVerifiedAdminReleaseManifest(
    resolve(input.appRoot),
    manifestPath,
    manifestSha256,
    resolve(input.nodePath),
    resolve(input.localNodePath ?? input.nodePath)
  );
  const readMode = input.environment.F1_PUBLIC_READ_MODE ?? "public-multimedia-synthetic";
  if (readMode !== "public-multimedia-synthetic" && readMode !== "public-real-snapshot") {
    throw new ConfigError("PUBLIC_READ_MODE", "unknown public read mode");
  }
  const signingKeyId = required(input.environment, "F1_PUBLIC_SIGNING_KEY_ID");
  const verifyKeyPath = resolve(required(input.environment, "F1_PUBLIC_VERIFY_KEY_PATH"));
  const senderIdentity = required(input.environment, "F1_PUBLIC_PROJECTION_SENDER_SERVICE_IDENTITY");
  const receiverIdentity = required(input.environment, "F1_PUBLIC_PROJECTION_RECEIVER_SERVICE_IDENTITY");
  const rollbackRelease = required(input.environment, "F1_PUBLIC_SYNTHETIC_ROLLBACK_RELEASE");
  const rollbackHash = required(input.environment, "F1_PUBLIC_SYNTHETIC_ROLLBACK_HASH");
  const syntheticRollbackAppRoot = resolve(required(input.environment, "F1_PUBLIC_SYNTHETIC_ROLLBACK_APP_ROOT"));
  if (syntheticRollbackAppRoot === resolve(input.appRoot)) {
    throw new ConfigError("PUBLIC_ROLLBACK_ROOT", "target release and synthetic rollback roots must be distinct");
  }
  assertOwnedRealDirectory(syntheticRollbackAppRoot);
  const dbPath = resolve(syntheticRollbackAppRoot, ".local/f1plus1-public-multimedia-synthetic.sqlite");
  assertPrivateRegular(dbPath);
  const rollbackDatabaseStat = lstatSync(dbPath);
  const buildId = assertRollbackBuildId(syntheticRollbackAppRoot);
  if (rollbackRelease !== buildId || !/^[0-9a-f]{64}$/.test(rollbackHash) || rollbackHash !== sha256(readFileSync(dbPath))) {
    throw new ConfigError("PUBLIC_ROLLBACK_ANCHOR", "synthetic rollback release or hash does not match the external anchor");
  }

  const launchAgents = resolve(input.home, "Library/LaunchAgents");
  const publicPaths = publicProjectionDeploymentPaths(input.home);
  const logs = resolve(publicPaths.root, "logs");
  const temporaryRoot = realpathSync(tmpdir());
  const stageRoot = mkdtempSync(resolve(temporaryRoot, "f1plus1-public-prepare-"));
  chmodSync(stageRoot, 0o700);
  try {
    const cleanBase = [
      "/usr/bin/env", "-i", `HOME=${input.home}`, "TMPDIR=/tmp",
      `PATH=${dirname(input.nodePath)}:/usr/bin:/bin:/usr/sbin:/sbin`
    ];
    const canonicalEnvironment = [
      "APP_ENV=local", "APP_PORT=3000", "APP_BIND_HOST=127.0.0.1", "APP_PUBLIC_ORIGIN=http://127.0.0.1:3000",
      "F1_DATA_PROFILE=public-multimedia-synthetic", "F1_DB_PATH=.local/f1plus1-public-multimedia-synthetic.sqlite",
      `F1_PUBLIC_READ_MODE=${readMode}`,
      `F1_PUBLIC_DEPLOYMENT_MANIFEST_PATH=${publicPaths.manifest}`,
      ...(readMode === "public-real-snapshot" ? [
        `F1_PUBLIC_PROJECTION_ROOT=${publicProjectionRootForHome(input.home)}`,
        `F1_PUBLIC_VERIFY_KEY_PATH=${verifyKeyPath}`,
        `F1_PUBLIC_SIGNING_KEY_ID=${signingKeyId}`
      ] : []),
      "SOURCE_CONFIG_PROVIDER=fixture",
      "SOURCE_FIXTURE_PATH=../data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json",
      "ADAPTER_MODE=mock", "SUMMARY_MODE=fixture", "MEDIA_MODE=fixture", "PUBLISH_MODE=manual_only",
      "REAL_FEISHU_IO=false", "REAL_EXTERNAL_IO=false", "REAL_FORM_SUBMIT=false", "ADMIN_ACCESS_MODE=local_dev_only", "LOG_LEVEL=info"
    ];
    const appPlistBytes = disabledPlist({
      label: PUBLIC_APP_LABEL,
      programArguments: [
        ...cleanBase, ...canonicalEnvironment, input.nodePath, "--experimental-strip-types",
        resolve(input.appRoot, "scripts/serve.ts"), "start"
      ],
      appRoot: input.appRoot,
      stdout: resolve(logs, "public-beta.stdout.log"),
      stderr: resolve(logs, "public-beta.stderr.log")
    });
    const quickTunnelPlistBytes = disabledPlist({
      label: PUBLIC_QUICK_TUNNEL_LABEL,
      programArguments: ["/usr/bin/false"],
      appRoot: input.appRoot,
      stdout: resolve(logs, "quick-tunnel.stdout.log"),
      stderr: resolve(logs, "quick-tunnel.stderr.log")
    });
    const stagedProjectionRoot = resolve(stageRoot, "projection");
    const projection = preparePublicProjectionDeployment({
      home: input.home,
      targetReleaseAppRoot: input.appRoot,
      targetReleaseManifestPath: manifestPath,
      targetReleaseManifestSha256: manifestSha256,
      targetReleaseRootSha256: release.releaseRootSha256,
      targetNextBuildSha256: release.nextBuild.contentRootSha256,
      targetDependenciesSha256: release.productionDependencies.contentRootSha256,
      syntheticRollbackAppRoot,
      syntheticRollbackDatabaseIdentity: {
        dev: rollbackDatabaseStat.dev,
        ino: rollbackDatabaseStat.ino,
        uid: rollbackDatabaseStat.uid,
        nlink: 1
      },
      nodePath: input.nodePath,
      projectionSigningKeyId: signingKeyId,
      projectionVerifyKeyPath: verifyKeyPath,
      publicReadMode: readMode,
      syntheticRollbackRelease: rollbackRelease,
      syntheticRollbackHash: rollbackHash,
      projectionSenderServiceIdentity: senderIdentity,
      projectionReceiverServiceIdentity: receiverIdentity,
      outputRoot: stagedProjectionRoot
    });
    const canonicalProjection = publicPaths;
    const appStage = resolve(stageRoot, `${PUBLIC_APP_LABEL}.plist`);
    const tunnelStage = resolve(stageRoot, `${PUBLIC_QUICK_TUNNEL_LABEL}.plist`);
    atomicReplace(appStage, appPlistBytes);
    atomicReplace(tunnelStage, quickTunnelPlistBytes);
    input.beforeCommit?.();

    ensurePrivateDirectory(publicPaths.root);
    ensurePrivateDirectory(logs);

    const files: readonly StagedFile[] = Object.freeze([
      { source: resolve(stagedProjectionRoot, "projection-deployment.json"), target: canonicalProjection.manifest },
      { source: resolve(stagedProjectionRoot, "public-projection.stdout.log"), target: canonicalProjection.stdoutLog },
      { source: resolve(stagedProjectionRoot, "public-projection.stderr.log"), target: canonicalProjection.stderrLog },
      { source: appStage, target: resolve(launchAgents, `${PUBLIC_APP_LABEL}.plist`) },
      { source: tunnelStage, target: resolve(launchAgents, `${PUBLIC_QUICK_TUNNEL_LABEL}.plist`) },
      { source: resolve(stagedProjectionRoot, `${PUBLIC_PROJECTION_SERVICE_LABEL}.plist`), target: canonicalProjection.plist }
    ]);
    const backups = files.map(({ target }) => backup(target));
    try {
      for (let index = 0; index < files.length; index += 1) {
        atomicReplace(files[index].target, readFileSync(files[index].source));
        input.afterCommit?.(index);
      }
      ensurePrivateDirectory(canonicalProjection.projectionRoot);
    } catch (error) {
      for (const previous of [...backups].reverse()) restore(previous);
      throw error;
    }
    const plistPaths = Object.freeze(files.slice(3).map(({ target }) => target));
    return Object.freeze({
      release,
      manifestSha256,
      plistPaths,
      projectionManifestSha256: projection.manifestSha256,
      projectionPlistSha256: projection.plistSha256
    });
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}
