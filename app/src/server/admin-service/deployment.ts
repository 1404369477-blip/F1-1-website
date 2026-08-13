import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
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
import { inspectExistingPrivateDatabase } from "../db/database.ts";
import { assertPrivateDirectory, assertPrivateFile, BootstrapTokenStore } from "./storage.ts";
import { ADMIN_BIND_HOST, ADMIN_BIND_PORT } from "./server.ts";

export const ADMIN_SERVICE_LABEL = "com.f1plus1.admin-service" as const;
export const PROJECTION_INTERNAL_ENDPOINT =
  "http://127.0.0.1:3102/internal/projections" as const;
export const ADMIN_REVIEW_DATABASE_PATH =
  "/Users/chanai/F1-1-website/app/.local/f1plus1-rss-real-private.sqlite" as const;

export const PublicReadModeSchema = z.enum([
  "public-multimedia-synthetic",
  "public-real-snapshot"
]);

const DeploymentIdentitySchema = z.string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const TAILSCALE_APP_CAP_SUFFIX = "/cap/f1-admin-device" as const;
const SOURCE_REF_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VISIBLE_ASCII_PATTERN = /^[\x21-\x7e]+$/;

function isUserControlledTailscaleCapabilityId(value: string): boolean {
  if (!value.endsWith(TAILSCALE_APP_CAP_SUFFIX)) return false;
  const domain = value.slice(0, -TAILSCALE_APP_CAP_SUFFIX.length);
  if (domain.length < 3 || domain.length > 253 || !domain.includes(".")) return false;
  if (
    domain === "tailscale.com" || domain.endsWith(".tailscale.com") ||
    domain === "tailscale.io" || domain.endsWith(".tailscale.io")
  ) return false;
  return domain.split(".").every((label) => (
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

export const TailscaleAppCapabilityIdSchema = z.string()
  .refine(isUserControlledTailscaleCapabilityId);

const ReleaseIdentitySchema = z.string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/);

const AbsolutePathSchema = z.string().min(1).refine(isAbsolute);

export const ReviewDatabaseIdentitySchema = z.object({
  dev: z.number().int().nonnegative().safe(),
  ino: z.number().int().nonnegative().safe(),
  uid: z.number().int().nonnegative().safe(),
  nlink: z.literal(1)
}).strict();

export type ReviewDatabaseIdentity = z.infer<typeof ReviewDatabaseIdentitySchema>;
const REVIEW_DATABASE_BASENAME = "f1plus1-rss-real-private.sqlite" as const;

export const AdminTrustedIdentityDeploymentSchema = z.object({
  login: z.string().min(3).max(320).regex(VISIBLE_ASCII_PATTERN),
  operatorRef: z.string().min(1).max(256),
  sourceRefs: z.array(z.string().regex(SOURCE_REF_PATTERN)).length(3)
    .refine((values) => new Set(values).size === values.length)
}).strict();

export const AdminDeploymentManifestSchema = z.object({
  schemaVersion: z.literal("admin-service-deployment-v3"),
  label: z.literal(ADMIN_SERVICE_LABEL),
  bindHost: z.literal(ADMIN_BIND_HOST),
  bindPort: z.literal(ADMIN_BIND_PORT),
  canonicalOrigin: z.string().url(),
  rpName: z.string().min(1).max(128),
  operatorRef: z.string().min(1).max(256),
  tailscaleAppCapabilityId: TailscaleAppCapabilityIdSchema,
  trustedIdentities: z.array(AdminTrustedIdentityDeploymentSchema).length(1),
  targetReleaseAppRoot: AbsolutePathSchema,
  reviewDatabasePath: z.literal(ADMIN_REVIEW_DATABASE_PATH),
  reviewDatabaseIdentity: ReviewDatabaseIdentitySchema,
  reviewSchemaTarget: z.literal(4),
  dataRoot: AbsolutePathSchema,
  staticRoot: AbsolutePathSchema,
  sessionHashKeyPath: AbsolutePathSchema,
  recoveryFencePath: AbsolutePathSchema,
  publicProjectionRoot: AbsolutePathSchema,
  projectionSigningKeyId: DeploymentIdentitySchema,
  projectionSigningPrivateKeyPath: AbsolutePathSchema,
  projectionVerifyKeyPath: AbsolutePathSchema,
  projectionInternalEndpoint: z.literal(PROJECTION_INTERNAL_ENDPOINT),
  publicReadMode: PublicReadModeSchema,
  syntheticRollbackRelease: ReleaseIdentitySchema,
  syntheticRollbackHash: z.string().regex(/^[0-9a-f]{64}$/),
  projectionSenderServiceIdentity: DeploymentIdentitySchema,
  projectionReceiverServiceIdentity: DeploymentIdentitySchema,
  preparedAt: z.string().datetime({ offset: true }),
  serviceState: z.literal("disabled")
}).strict().superRefine((manifest, context) => {
  if (manifest.trustedIdentities[0]?.operatorRef !== manifest.operatorRef) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["trustedIdentities", 0, "operatorRef"],
      message: "trusted identity operator must match manifest operator"
    });
  }
});

export type AdminDeploymentManifest = z.infer<typeof AdminDeploymentManifestSchema>;

export type AdminDeploymentPaths = Readonly<{
  dataRoot: string;
  publicProjectionRoot: string;
  manifest: string;
  sessionHashKey: string;
  recoveryFence: string;
  plist: string;
  stdoutLog: string;
  stderrLog: string;
}>;

export function adminDeploymentPaths(home: string): AdminDeploymentPaths {
  const dataRoot = resolve(home, "Library/Application Support/F1Plus1/Admin");
  const publicProjectionRoot = resolve(home, "Library/Application Support/F1Plus1/Public/projection");
  return Object.freeze({
    dataRoot,
    publicProjectionRoot,
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

function pathContains(parent: string, candidate: string): boolean {
  const delta = relative(resolve(parent), resolve(candidate));
  return delta === "" || (delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta));
}

function assertSeparatedResources(input: Readonly<{
  targetReleaseAppRoot: string;
  reviewDatabasePath: string;
  dataRoot: string;
  publicProjectionRoot: string;
  projectionSigningPrivateKeyPath: string;
  projectionVerifyKeyPath: string;
}>): void {
  const reviewDatabaseParent = dirname(input.reviewDatabasePath);
  if (
    pathContains(input.targetReleaseAppRoot, input.reviewDatabasePath) ||
    pathContains(reviewDatabaseParent, input.targetReleaseAppRoot) ||
    pathContains(input.dataRoot, input.reviewDatabasePath) ||
    pathContains(reviewDatabaseParent, input.dataRoot) ||
    pathContains(input.publicProjectionRoot, input.reviewDatabasePath) ||
    pathContains(reviewDatabaseParent, input.publicProjectionRoot) ||
    pathContains(input.dataRoot, input.publicProjectionRoot) ||
    pathContains(input.publicProjectionRoot, input.dataRoot) ||
    pathContains(input.publicProjectionRoot, input.projectionSigningPrivateKeyPath) ||
    pathContains(input.publicProjectionRoot, input.projectionVerifyKeyPath) ||
    pathContains(input.dataRoot, input.projectionVerifyKeyPath) ||
    pathContains(input.projectionVerifyKeyPath, input.projectionSigningPrivateKeyPath) ||
    pathContains(input.projectionSigningPrivateKeyPath, input.projectionVerifyKeyPath)
  ) {
    throw new Error("ADMIN_PROJECTION_RESOURCE_BOUNDARY_INVALID");
  }
}

export function inspectExistingReviewDatabase(path: string): ReviewDatabaseIdentity {
  return ReviewDatabaseIdentitySchema.parse(inspectExistingPrivateDatabase(path, REVIEW_DATABASE_BASENAME));
}

function sameReviewDatabaseIdentity(left: ReviewDatabaseIdentity, right: ReviewDatabaseIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.nlink === right.nlink;
}

function assertEd25519KeyPair(privateKeyPath: string, verifyKeyPath: string): void {
  assertPrivateFile(privateKeyPath);
  assertPrivateFile(verifyKeyPath);
  const privateKeyBytes = readFileSync(privateKeyPath);
  try {
    const privateKey = createPrivateKey(privateKeyBytes);
    const verifyKey = createPublicKey(readFileSync(verifyKeyPath));
    if (privateKey.asymmetricKeyType !== "ed25519" || verifyKey.asymmetricKeyType !== "ed25519") {
      throw new Error("ADMIN_PROJECTION_KEY_INVALID");
    }
    const derived = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    const provided = verifyKey.export({ format: "der", type: "spki" });
    if (derived.byteLength !== provided.byteLength || !timingSafeEqual(derived, provided)) {
      throw new Error("ADMIN_PROJECTION_KEY_MISMATCH");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ADMIN_PROJECTION_KEY_")) throw error;
    throw new Error("ADMIN_PROJECTION_KEY_INVALID");
  } finally {
    privateKeyBytes.fill(0);
  }
}

function assertManifestResourceBoundary(manifest: AdminDeploymentManifest): void {
  for (const path of [
    manifest.targetReleaseAppRoot,
    manifest.reviewDatabasePath,
    manifest.dataRoot,
    manifest.staticRoot,
    manifest.sessionHashKeyPath,
    manifest.recoveryFencePath,
    manifest.publicProjectionRoot,
    manifest.projectionSigningPrivateKeyPath,
    manifest.projectionVerifyKeyPath
  ]) {
    if (resolve(path) !== path) throw new Error("ADMIN_DEPLOYMENT_MANIFEST_INVALID");
  }
  if (manifest.projectionSenderServiceIdentity === manifest.projectionReceiverServiceIdentity) {
    throw new Error("ADMIN_PROJECTION_SERVICE_IDENTITY_INVALID");
  }
  const origin = new URL(manifest.canonicalOrigin);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("ADMIN_CANONICAL_ORIGIN_INVALID");
  }
  if (
    !pathContains(manifest.targetReleaseAppRoot, manifest.staticRoot) ||
    !pathContains(manifest.dataRoot, manifest.sessionHashKeyPath) ||
    !pathContains(manifest.dataRoot, manifest.recoveryFencePath)
  ) {
    throw new Error("ADMIN_DEPLOYMENT_RESOURCE_PATH_INVALID");
  }
  assertSeparatedResources(manifest);
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
  targetReleaseAppRoot: string;
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
<string>${xml(join(input.targetReleaseAppRoot, "scripts/admin-service.ts"))}</string>
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

export function prepareAdminDeployment(input: Readonly<{
  home: string;
  targetReleaseAppRoot: string;
  reviewDatabasePath: string;
  reviewDatabaseExpectedDev: number;
  reviewDatabaseExpectedIno: number;
  nodePath: string;
  canonicalOrigin: string;
  rpName: string;
  operatorRef: string;
  tailscaleAppCapabilityId: string;
  trustedIdentities: readonly z.infer<typeof AdminTrustedIdentityDeploymentSchema>[];
  projectionSigningKeyId: string;
  projectionSigningPrivateKeyPath: string;
  projectionVerifyKeyPath: string;
  publicReadMode: z.infer<typeof PublicReadModeSchema>;
  syntheticRollbackRelease: string;
  syntheticRollbackHash: string;
  projectionSenderServiceIdentity: string;
  projectionReceiverServiceIdentity: string;
  now?: number;
}>): Readonly<{
  manifestSha256: string;
  plistSha256: string;
  bootstrapTokenPath: string;
  bootstrapExpiresAt: number;
}> {
  process.umask(0o077);
  if (input.reviewDatabasePath !== ADMIN_REVIEW_DATABASE_PATH) {
    throw new Error("ADMIN_REVIEW_DATABASE_PATH_INVALID");
  }
  if (
    !Number.isSafeInteger(input.reviewDatabaseExpectedDev) || input.reviewDatabaseExpectedDev < 0 ||
    !Number.isSafeInteger(input.reviewDatabaseExpectedIno) || input.reviewDatabaseExpectedIno < 0
  ) throw new Error("ADMIN_REVIEW_DATABASE_RECEIPT_INVALID");
  if (resolve(input.targetReleaseAppRoot) !== input.targetReleaseAppRoot ||
      resolve(input.reviewDatabasePath) !== input.reviewDatabasePath) {
    throw new Error("ADMIN_DEPLOYMENT_INPUT_PATH_INVALID");
  }
  const paths = adminDeploymentPaths(input.home);
  const targetReleaseAppRoot = resolve(input.targetReleaseAppRoot);
  const reviewDatabasePath = resolve(input.reviewDatabasePath);
  const reviewDatabaseIdentity = inspectExistingReviewDatabase(reviewDatabasePath);
  if (
    reviewDatabaseIdentity.dev !== input.reviewDatabaseExpectedDev ||
    reviewDatabaseIdentity.ino !== input.reviewDatabaseExpectedIno
  ) throw new Error("ADMIN_REVIEW_DATABASE_RECEIPT_MISMATCH");
  const origin = new URL(input.canonicalOrigin);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("ADMIN_CANONICAL_ORIGIN_INVALID");
  }
  const projectionSigningPrivateKeyPath = resolve(input.projectionSigningPrivateKeyPath);
  const projectionVerifyKeyPath = resolve(input.projectionVerifyKeyPath);
  assertSeparatedResources({
    targetReleaseAppRoot,
    reviewDatabasePath,
    dataRoot: paths.dataRoot,
    publicProjectionRoot: paths.publicProjectionRoot,
    projectionSigningPrivateKeyPath,
    projectionVerifyKeyPath
  });
  if (input.projectionSenderServiceIdentity === input.projectionReceiverServiceIdentity) {
    throw new Error("ADMIN_PROJECTION_SERVICE_IDENTITY_INVALID");
  }
  assertEd25519KeyPair(projectionSigningPrivateKeyPath, projectionVerifyKeyPath);
  const now = input.now ?? Date.now();
  const manifest = AdminDeploymentManifestSchema.parse({
    schemaVersion: "admin-service-deployment-v3",
    label: ADMIN_SERVICE_LABEL,
    bindHost: ADMIN_BIND_HOST,
    bindPort: ADMIN_BIND_PORT,
    canonicalOrigin: origin.origin,
    rpName: input.rpName,
    operatorRef: input.operatorRef,
    tailscaleAppCapabilityId: input.tailscaleAppCapabilityId,
    trustedIdentities: input.trustedIdentities,
    targetReleaseAppRoot,
    reviewDatabasePath,
    reviewDatabaseIdentity,
    reviewSchemaTarget: 4,
    dataRoot: paths.dataRoot,
    staticRoot: resolve(targetReleaseAppRoot, "src/admin-ui"),
    sessionHashKeyPath: paths.sessionHashKey,
    recoveryFencePath: paths.recoveryFence,
    publicProjectionRoot: paths.publicProjectionRoot,
    projectionSigningKeyId: input.projectionSigningKeyId,
    projectionSigningPrivateKeyPath,
    projectionVerifyKeyPath,
    projectionInternalEndpoint: PROJECTION_INTERNAL_ENDPOINT,
    publicReadMode: input.publicReadMode,
    syntheticRollbackRelease: input.syntheticRollbackRelease,
    syntheticRollbackHash: input.syntheticRollbackHash,
    projectionSenderServiceIdentity: input.projectionSenderServiceIdentity,
    projectionReceiverServiceIdentity: input.projectionReceiverServiceIdentity,
    preparedAt: new Date(now).toISOString(),
    serviceState: "disabled"
  });
  assertManifestResourceBoundary(manifest);
  if (!existsSync(targetReleaseAppRoot) || !lstatSync(targetReleaseAppRoot).isDirectory()) {
    throw new Error("ADMIN_TARGET_RELEASE_ROOT_INVALID");
  }
  ensurePrivateDirectory(paths.dataRoot);
  ensurePrivateDirectory(paths.publicProjectionRoot);
  if (existsSync(paths.manifest) || existsSync(paths.plist)) throw new Error("ADMIN_DEPLOYMENT_ALREADY_PREPARED");
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
  const bootstrap = new BootstrapTokenStore(paths.dataRoot).prepare(now);
  const manifestJson = canonicalJson(manifest);
  atomicPrivateWrite(paths.manifest, manifestJson);
  const plist = renderAdminServicePlist({
    nodePath: resolve(input.nodePath),
    targetReleaseAppRoot,
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
  assertManifestResourceBoundary(parsed.data);
  const currentIdentity = inspectExistingReviewDatabase(parsed.data.reviewDatabasePath);
  if (!sameReviewDatabaseIdentity(currentIdentity, parsed.data.reviewDatabaseIdentity)) {
    throw new Error("ADMIN_REVIEW_DATABASE_RECEIPT_MISMATCH");
  }
  assertPrivateDirectory(parsed.data.dataRoot);
  assertPrivateDirectory(parsed.data.publicProjectionRoot);
  assertPrivateFile(parsed.data.sessionHashKeyPath);
  assertPrivateFile(parsed.data.recoveryFencePath);
  assertEd25519KeyPair(
    parsed.data.projectionSigningPrivateKeyPath,
    parsed.data.projectionVerifyKeyPath
  );
  return parsed.data;
}

export function adminDeploymentStatus(path: string): Readonly<{
  status: "prepared-disabled";
  label: typeof ADMIN_SERVICE_LABEL;
  manifestSha256: string;
  bindHost: typeof ADMIN_BIND_HOST;
  bindPort: typeof ADMIN_BIND_PORT;
  publicReadMode: z.infer<typeof PublicReadModeSchema>;
  projectionInternalEndpoint: typeof PROJECTION_INTERNAL_ENDPOINT;
}> {
  const manifest = readAdminDeploymentManifest(path);
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new Error("ADMIN_DEPLOYMENT_MANIFEST_INVALID");
  return {
    status: "prepared-disabled",
    label: manifest.label,
    manifestSha256: sha256(readFileSync(path)),
    bindHost: ADMIN_BIND_HOST,
    bindPort: ADMIN_BIND_PORT,
    publicReadMode: manifest.publicReadMode,
    projectionInternalEndpoint: manifest.projectionInternalEndpoint
  };
}
