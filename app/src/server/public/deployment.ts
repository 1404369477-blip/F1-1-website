import { createHash, createPublicKey, randomUUID } from "node:crypto";
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
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";

export const PUBLIC_PROJECTION_SERVICE_LABEL = "com.f1plus1.public-projection" as const;
export const PUBLIC_PROJECTION_INTERNAL_ENDPOINT = "http://127.0.0.1:3102/internal/projections" as const;

const IdentitySchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const AbsolutePathSchema = z.string().min(1).refine(isAbsolute);
const FileIdentitySchema = z.object({
  dev: z.number().int().nonnegative().safe(),
  ino: z.number().int().nonnegative().safe(),
  uid: z.number().int().nonnegative().safe(),
  nlink: z.literal(1)
}).strict();

export const PublicProjectionDeploymentManifestSchema = z.object({
  schemaVersion: z.literal("public-projection-deployment-v2"),
  label: z.literal(PUBLIC_PROJECTION_SERVICE_LABEL),
  targetReleaseAppRoot: AbsolutePathSchema,
  syntheticRollbackAppRoot: AbsolutePathSchema,
  publicDataRoot: AbsolutePathSchema,
  publicProjectionRoot: AbsolutePathSchema,
  projectionSigningKeyId: IdentitySchema,
  projectionVerifyKeyPath: AbsolutePathSchema,
  projectionInternalEndpoint: z.literal(PUBLIC_PROJECTION_INTERNAL_ENDPOINT),
  publicReadMode: z.enum(["public-multimedia-synthetic", "public-real-snapshot"]),
  syntheticRollbackRelease: z.string().min(1).max(256),
  syntheticRollbackHash: z.string().regex(/^[0-9a-f]{64}$/),
  syntheticRollbackDatabaseIdentity: FileIdentitySchema,
  projectionSenderServiceIdentity: IdentitySchema,
  projectionReceiverServiceIdentity: IdentitySchema,
  preparedAt: z.string().datetime({ offset: true }),
  serviceState: z.literal("disabled")
}).strict();

export type PublicProjectionDeploymentManifest = z.infer<typeof PublicProjectionDeploymentManifestSchema>;

function currentUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("PUBLIC_DEPLOYMENT_OWNER_INVALID");
  return uid;
}

function assertPrivateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== currentUid() || (stat.mode & 0o077) !== 0) {
    throw new Error("PUBLIC_DEPLOYMENT_PATH_INVALID");
  }
}

function assertPrivateFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== currentUid() || (stat.mode & 0o077) !== 0) {
    throw new Error("PUBLIC_DEPLOYMENT_PATH_INVALID");
  }
}

function ensurePrivateDirectory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  assertPrivateDirectory(path);
}

function isWithin(parent: string, candidate: string): boolean {
  const delta = relative(resolve(parent), resolve(candidate));
  return delta === "" || (delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta));
}

function assertPublicOnlyBoundary(root: string, projectionRoot: string, verifyKeyPath: string): void {
  if (!isWithin(root, projectionRoot) || isWithin(projectionRoot, verifyKeyPath) || !isWithin(root, verifyKeyPath)) {
    throw new Error("PUBLIC_DEPLOYMENT_RESOURCE_BOUNDARY_INVALID");
  }
}

function assertDeploymentRoots(input: Readonly<{
  targetReleaseAppRoot: string;
  syntheticRollbackAppRoot: string;
  publicDataRoot: string;
}>): void {
  if (
    input.targetReleaseAppRoot === input.syntheticRollbackAppRoot ||
    isWithin(input.targetReleaseAppRoot, input.publicDataRoot) ||
    isWithin(input.syntheticRollbackAppRoot, input.publicDataRoot) ||
    isWithin(input.publicDataRoot, input.targetReleaseAppRoot) ||
    isWithin(input.publicDataRoot, input.syntheticRollbackAppRoot)
  ) throw new Error("PUBLIC_DEPLOYMENT_RESOURCE_BOUNDARY_INVALID");
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function atomicPrivateWrite(path: string, value: string): void {
  if (existsSync(path)) throw new Error("PUBLIC_DEPLOYMENT_ALREADY_PREPARED");
  const parent = dirname(path);
  assertPrivateDirectory(parent);
  const temporary = `${path}.stage-${randomUUID()}`;
  const descriptor = openSync(
    temporary,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
    0o600
  );
  try {
    writeFileSync(descriptor, value, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  fsyncDirectory(parent);
}

export function publicProjectionDeploymentPaths(home: string): Readonly<{
  root: string;
  projectionRoot: string;
  manifest: string;
  plist: string;
  stdoutLog: string;
  stderrLog: string;
}> {
  const root = resolve(home, "Library/Application Support/F1Plus1/Public");
  return Object.freeze({
    root,
    projectionRoot: join(root, "projection"),
    manifest: join(root, "projection-deployment.json"),
    plist: join(root, `${PUBLIC_PROJECTION_SERVICE_LABEL}.plist`),
    stdoutLog: join(root, "public-projection.stdout.log"),
    stderrLog: join(root, "public-projection.stderr.log")
  });
}

export function publicProjectionRootForHome(home: string): string {
  return publicProjectionDeploymentPaths(home).projectionRoot;
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function renderPublicProjectionPlist(input: Readonly<{
  nodePath: string;
  targetReleaseAppRoot: string;
  manifestPath: string;
  stdoutLog: string;
  stderrLog: string;
}>): string {
  for (const value of Object.values(input)) {
    if (!isAbsolute(value) || /[\u0000\r\n]/.test(value)) throw new Error("PUBLIC_PLIST_INPUT_INVALID");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${PUBLIC_PROJECTION_SERVICE_LABEL}</string>
<key>ProgramArguments</key><array>
<string>${xml(input.nodePath)}</string>
<string>--experimental-strip-types</string>
<string>${xml(join(input.targetReleaseAppRoot, "scripts/public-projection-runtime.ts"))}</string>
<string>--manifest</string><string>${xml(input.manifestPath)}</string>
</array>
<key>WorkingDirectory</key><string>${xml(input.targetReleaseAppRoot)}</string>
<key>RunAtLoad</key><false/>
<key>KeepAlive</key><false/>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(input.stdoutLog)}</string>
<key>StandardErrorPath</key><string>${xml(input.stderrLog)}</string>
<key>Umask</key><integer>63</integer>
</dict></plist>
`;
}

export function preparePublicProjectionDeployment(input: Readonly<{
  home: string;
  targetReleaseAppRoot: string;
  syntheticRollbackAppRoot: string;
  syntheticRollbackDatabaseIdentity: z.infer<typeof FileIdentitySchema>;
  nodePath: string;
  projectionSigningKeyId: string;
  projectionVerifyKeyPath: string;
  publicReadMode: "public-multimedia-synthetic" | "public-real-snapshot";
  syntheticRollbackRelease: string;
  syntheticRollbackHash: string;
  projectionSenderServiceIdentity: string;
  projectionReceiverServiceIdentity: string;
  outputRoot?: string;
  now?: number;
}>): Readonly<{ manifestPath: string; manifestSha256: string; plistPath: string; plistSha256: string }> {
  const canonicalPaths = publicProjectionDeploymentPaths(input.home);
  const paths = input.outputRoot === undefined ? canonicalPaths : Object.freeze({
    ...canonicalPaths,
    root: resolve(input.outputRoot),
    projectionRoot: resolve(input.outputRoot, "projection"),
    manifest: resolve(input.outputRoot, "projection-deployment.json"),
    plist: resolve(input.outputRoot, `${PUBLIC_PROJECTION_SERVICE_LABEL}.plist`),
    stdoutLog: resolve(input.outputRoot, "public-projection.stdout.log"),
    stderrLog: resolve(input.outputRoot, "public-projection.stderr.log")
  });
  const verifyKeyPath = resolve(input.projectionVerifyKeyPath);
  const targetReleaseAppRoot = resolve(input.targetReleaseAppRoot);
  const syntheticRollbackAppRoot = resolve(input.syntheticRollbackAppRoot);
  assertPublicOnlyBoundary(canonicalPaths.root, canonicalPaths.projectionRoot, verifyKeyPath);
  assertDeploymentRoots({ targetReleaseAppRoot, syntheticRollbackAppRoot, publicDataRoot: canonicalPaths.root });
  assertPrivateFile(verifyKeyPath);
  let publicKey;
  try { publicKey = createPublicKey(readFileSync(verifyKeyPath)); }
  catch { throw new Error("PUBLIC_VERIFY_KEY_INVALID"); }
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("PUBLIC_VERIFY_KEY_INVALID");
  if (input.projectionSenderServiceIdentity === input.projectionReceiverServiceIdentity) {
    throw new Error("PUBLIC_SERVICE_IDENTITY_INVALID");
  }
  if (
    existsSync(paths.manifest) || existsSync(paths.plist) ||
    existsSync(paths.stdoutLog) || existsSync(paths.stderrLog)
  ) throw new Error("PUBLIC_DEPLOYMENT_ALREADY_PREPARED");
  const manifest = PublicProjectionDeploymentManifestSchema.parse({
    schemaVersion: "public-projection-deployment-v2",
    label: PUBLIC_PROJECTION_SERVICE_LABEL,
    targetReleaseAppRoot,
    syntheticRollbackAppRoot,
    publicDataRoot: canonicalPaths.root,
    publicProjectionRoot: canonicalPaths.projectionRoot,
    projectionSigningKeyId: input.projectionSigningKeyId,
    projectionVerifyKeyPath: verifyKeyPath,
    projectionInternalEndpoint: PUBLIC_PROJECTION_INTERNAL_ENDPOINT,
    publicReadMode: input.publicReadMode,
    syntheticRollbackRelease: input.syntheticRollbackRelease,
    syntheticRollbackHash: input.syntheticRollbackHash,
    syntheticRollbackDatabaseIdentity: input.syntheticRollbackDatabaseIdentity,
    projectionSenderServiceIdentity: input.projectionSenderServiceIdentity,
    projectionReceiverServiceIdentity: input.projectionReceiverServiceIdentity,
    preparedAt: new Date(input.now ?? Date.now()).toISOString(),
    serviceState: "disabled"
  });
  const plist = renderPublicProjectionPlist({
    nodePath: resolve(input.nodePath),
    targetReleaseAppRoot,
    manifestPath: canonicalPaths.manifest,
    stdoutLog: canonicalPaths.stdoutLog,
    stderrLog: canonicalPaths.stderrLog
  });
  ensurePrivateDirectory(paths.root);
  ensurePrivateDirectory(paths.projectionRoot);
  const manifestJson = canonicalJson(manifest);
  atomicPrivateWrite(paths.manifest, manifestJson);
  atomicPrivateWrite(paths.stdoutLog, "");
  atomicPrivateWrite(paths.stderrLog, "");
  atomicPrivateWrite(paths.plist, plist);
  return {
    manifestPath: paths.manifest,
    manifestSha256: createHash("sha256").update(manifestJson).digest("hex"),
    plistPath: paths.plist,
    plistSha256: createHash("sha256").update(plist).digest("hex")
  };
}

export function readPublicProjectionDeploymentManifest(path: string): PublicProjectionDeploymentManifest {
  assertPrivateFile(path);
  const raw = readFileSync(path, "utf8");
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { throw new Error("PUBLIC_DEPLOYMENT_MANIFEST_INVALID"); }
  const parsed = PublicProjectionDeploymentManifestSchema.safeParse(value);
  if (!parsed.success || raw !== canonicalJson(parsed.data)) throw new Error("PUBLIC_DEPLOYMENT_MANIFEST_INVALID");
  const root = resolve(dirname(parsed.data.publicProjectionRoot));
  if (parsed.data.publicDataRoot !== root) throw new Error("PUBLIC_DEPLOYMENT_RESOURCE_BOUNDARY_INVALID");
  assertDeploymentRoots(parsed.data);
  assertPublicOnlyBoundary(root, parsed.data.publicProjectionRoot, parsed.data.projectionVerifyKeyPath);
  assertPrivateDirectory(parsed.data.publicProjectionRoot);
  assertPrivateFile(parsed.data.projectionVerifyKeyPath);
  return parsed.data;
}
