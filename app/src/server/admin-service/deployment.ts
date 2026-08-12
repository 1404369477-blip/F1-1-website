import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import { assertPrivateDirectory, assertPrivateFile, BootstrapTokenStore } from "./storage.ts";
import { ADMIN_BIND_HOST, ADMIN_BIND_PORT } from "./server.ts";

export const ADMIN_SERVICE_LABEL = "com.f1plus1.admin-service" as const;

const TrustedIdentitySchema = z.object({
  login: z.string().min(3).max(320),
  operatorRef: z.string().min(1).max(256),
  deviceRefs: z.array(z.string().min(1).max(256)).min(1).max(8)
}).strict();

export const AdminDeploymentManifestSchema = z.object({
  schemaVersion: z.literal("admin-service-deployment-v1"),
  label: z.literal(ADMIN_SERVICE_LABEL),
  bindHost: z.literal(ADMIN_BIND_HOST),
  bindPort: z.literal(ADMIN_BIND_PORT),
  canonicalOrigin: z.string().url(),
  rpName: z.string().min(1).max(128),
  operatorRef: z.string().min(1).max(256),
  trustedIdentities: z.array(TrustedIdentitySchema).min(1).max(8),
  appRoot: z.string().min(1),
  dataRoot: z.string().min(1),
  staticRoot: z.string().min(1),
  sessionHashKeyPath: z.string().min(1),
  recoveryFencePath: z.string().min(1),
  projectionRoot: z.string().min(1),
  projectionSigningKeyId: z.string().min(1).max(256),
  projectionVerifyKeyPath: z.string().min(1),
  projectionBootstrapGeneration: z.number().int().positive().safe(),
  projectionBootstrapHash: z.string().regex(/^[0-9a-f]{64}$/),
  preparedAt: z.string().datetime({ offset: true }),
  serviceState: z.literal("disabled")
}).strict();

export type AdminDeploymentManifest = z.infer<typeof AdminDeploymentManifestSchema>;

export type AdminDeploymentPaths = Readonly<{
  dataRoot: string;
  projectionRoot: string;
  manifest: string;
  sessionHashKey: string;
  recoveryFence: string;
  plist: string;
  stdoutLog: string;
  stderrLog: string;
}>;

export function adminDeploymentPaths(home: string): AdminDeploymentPaths {
  const dataRoot = resolve(home, "Library/Application Support/F1Plus1/Admin");
  return Object.freeze({
    dataRoot,
    projectionRoot: join(dataRoot, "projection"),
    manifest: join(dataRoot, "deployment.json"),
    sessionHashKey: join(dataRoot, "session-hash-key"),
    recoveryFence: join(dataRoot, "recovery-fence.json"),
    plist: join(dataRoot, `${ADMIN_SERVICE_LABEL}.plist`),
    stdoutLog: join(dataRoot, "admin-service.stdout.log"),
    stderrLog: join(dataRoot, "admin-service.stderr.log")
  });
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function atomicPrivateWrite(path: string, value: string): void {
  const parent = dirname(path);
  assertPrivateDirectory(parent);
  if (existsSync(path)) throw new Error("ADMIN_DEPLOYMENT_TARGET_EXISTS");
  const temporary = `${path}.stage-${randomUUID()}`;
  const descriptor = openSync(
    temporary,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
    0o600
  );
  try {
    writeFileSync(descriptor, value, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  fsyncDirectory(parent);
}

function ensurePrivateDirectory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700, recursive: true });
  assertPrivateDirectory(path);
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderAdminServicePlist(input: Readonly<{
  nodePath: string;
  appRoot: string;
  manifestPath: string;
  stdoutLog: string;
  stderrLog: string;
}>): string {
  for (const value of Object.values(input)) {
    if (!value.startsWith("/") || /[\u0000\r\n]/.test(value)) throw new Error("ADMIN_PLIST_INPUT_INVALID");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${ADMIN_SERVICE_LABEL}</string>
<key>ProgramArguments</key><array>
<string>${xml(input.nodePath)}</string>
<string>--experimental-strip-types</string>
<string>${xml(join(input.appRoot, "scripts/admin-service.ts"))}</string>
<string>--manifest</string><string>${xml(input.manifestPath)}</string>
</array>
<key>WorkingDirectory</key><string>${xml(input.appRoot)}</string>
<key>RunAtLoad</key><false/>
<key>KeepAlive</key><false/>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(input.stdoutLog)}</string>
<key>StandardErrorPath</key><string>${xml(input.stderrLog)}</string>
<key>Umask</key><integer>63</integer>
</dict></plist>
`;
}

export function prepareAdminDeployment(input: Readonly<{
  home: string;
  appRoot: string;
  nodePath: string;
  canonicalOrigin: string;
  rpName: string;
  operatorRef: string;
  trustedIdentities: readonly z.infer<typeof TrustedIdentitySchema>[];
  projectionSigningKeyId: string;
  projectionVerifyKeyPath: string;
  projectionBootstrapGeneration: number;
  projectionBootstrapHash: string;
  now?: number;
}>): Readonly<{
  manifestSha256: string;
  plistSha256: string;
  bootstrapTokenPath: string;
  bootstrapExpiresAt: number;
}> {
  process.umask(0o077);
  const paths = adminDeploymentPaths(input.home);
  ensurePrivateDirectory(paths.dataRoot);
  ensurePrivateDirectory(paths.projectionRoot);
  if (existsSync(paths.manifest) || existsSync(paths.plist)) throw new Error("ADMIN_DEPLOYMENT_ALREADY_PREPARED");
  assertPrivateFile(input.projectionVerifyKeyPath);
  const sessionKey = randomBytes(32).toString("base64url");
  atomicPrivateWrite(paths.sessionHashKey, sessionKey);
  atomicPrivateWrite(paths.recoveryFence, canonicalJson({
    schemaVersion: "admin-recovery-fence-v1",
    clockTrusted: false,
    writerReady: false,
    lastSuccessfulRecoveryPointAt: null
  }));
  atomicPrivateWrite(paths.stdoutLog, "");
  atomicPrivateWrite(paths.stderrLog, "");
  const now = input.now ?? Date.now();
  const bootstrap = new BootstrapTokenStore(paths.dataRoot).prepare(now);
  const origin = new URL(input.canonicalOrigin);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("ADMIN_CANONICAL_ORIGIN_INVALID");
  }
  const manifest = AdminDeploymentManifestSchema.parse({
    schemaVersion: "admin-service-deployment-v1",
    label: ADMIN_SERVICE_LABEL,
    bindHost: ADMIN_BIND_HOST,
    bindPort: ADMIN_BIND_PORT,
    canonicalOrigin: origin.origin,
    rpName: input.rpName,
    operatorRef: input.operatorRef,
    trustedIdentities: input.trustedIdentities,
    appRoot: resolve(input.appRoot),
    dataRoot: paths.dataRoot,
    staticRoot: resolve(input.appRoot, "src/admin-ui"),
    sessionHashKeyPath: paths.sessionHashKey,
    recoveryFencePath: paths.recoveryFence,
    projectionRoot: paths.projectionRoot,
    projectionSigningKeyId: input.projectionSigningKeyId,
    projectionVerifyKeyPath: resolve(input.projectionVerifyKeyPath),
    projectionBootstrapGeneration: input.projectionBootstrapGeneration,
    projectionBootstrapHash: input.projectionBootstrapHash,
    preparedAt: new Date(now).toISOString(),
    serviceState: "disabled"
  });
  const manifestJson = canonicalJson(manifest);
  atomicPrivateWrite(paths.manifest, manifestJson);
  const plist = renderAdminServicePlist({
    nodePath: resolve(input.nodePath),
    appRoot: resolve(input.appRoot),
    manifestPath: paths.manifest,
    stdoutLog: paths.stdoutLog,
    stderrLog: paths.stderrLog
  });
  atomicPrivateWrite(paths.plist, plist);
  return {
    manifestSha256: sha256(manifestJson),
    plistSha256: sha256(plist),
    bootstrapTokenPath: bootstrap.tokenPath,
    bootstrapExpiresAt: bootstrap.expiresAt
  };
}

export function readAdminDeploymentManifest(path: string): AdminDeploymentManifest {
  assertPrivateFile(path);
  const raw = readFileSync(path, "utf8");
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { throw new Error("ADMIN_DEPLOYMENT_MANIFEST_INVALID"); }
  const parsed = AdminDeploymentManifestSchema.safeParse(value);
  if (!parsed.success || canonicalJson(parsed.data) !== raw) throw new Error("ADMIN_DEPLOYMENT_MANIFEST_INVALID");
  if (parsed.data.bindHost !== ADMIN_BIND_HOST || parsed.data.bindPort !== ADMIN_BIND_PORT) {
    throw new Error("ADMIN_DEPLOYMENT_LISTENER_INVALID");
  }
  return parsed.data;
}

export function adminDeploymentStatus(path: string): Readonly<{
  status: "prepared-disabled";
  label: typeof ADMIN_SERVICE_LABEL;
  manifestSha256: string;
  bindHost: typeof ADMIN_BIND_HOST;
  bindPort: typeof ADMIN_BIND_PORT;
}> {
  const manifest = readAdminDeploymentManifest(path);
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new Error("ADMIN_DEPLOYMENT_MANIFEST_INVALID");
  return {
    status: "prepared-disabled",
    label: manifest.label,
    manifestSha256: sha256(readFileSync(path)),
    bindHost: ADMIN_BIND_HOST,
    bindPort: ADMIN_BIND_PORT
  };
}
