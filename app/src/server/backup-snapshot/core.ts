import {
  type BigIntStats,
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ProjectionReceiptSchema, SignedProjectionPackageSchema } from "../review-real/projection.ts";
import { reviewRealSchemaFingerprint } from "../review-real/migration.ts";
import { X_PAGE_ADMISSION_SCHEMA_SHA256 } from "../x-page/admission-schema-identity.ts";
import { prepareXPageArtifactBackup, restoreXPageArtifactBackup, verifyRestoredXPageArtifactBackup, XPageArtifactBackupManifestSchema,
  type XPageArtifactRebindingProposal } from "../x-page/backup-artifacts.ts";
import type { LoadedXPageRuntimeTrust } from "../x-page/deployment-trust.ts";

export const SNAPSHOT_KIND = "db-projection-snapshot" as const;
export const MANIFEST_SCHEMA_VERSION = "backup-snapshot-manifest-v1" as const;
export const X_MANIFEST_SCHEMA_VERSION = "backup-snapshot-manifest-v2" as const;
const X_MANIFEST_PATH = "x-page-artifacts/manifest.json", X_MEMBER_PREFIX = "x-page-artifacts/files/";
export const LATEST_SCHEMA_VERSION = "backup-snapshot-latest-v1" as const;
export const ARCHIVE_MAGIC = Buffer.from("F1PK", "ascii");

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const KEY_ID_PATTERN = /^[0-9a-f]{16}$/;
const PACKAGE_ID_PATTERN = /^[0-9]{13}_[0-9a-f]{16}$/;
const CHUNK_SIZE = 1024 * 1024;
const AES_IV_LENGTH = 12;
const AES_TAG_LENGTH = 16;
const AES_KEY_LENGTH = 32;
const STAGING_MODE = 0o700;
const FILE_MODE = 0o600;

export type SnapshotMember = {
  relativePath: string;
  bytes: number;
  sha256: string;
};

export type SnapshotManifest = {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION | typeof X_MANIFEST_SCHEMA_VERSION;
  kind: typeof SNAPSHOT_KIND;
  keyId: string;
  recovery_point_at: string;
  contentHash: string;
  userVersion: number;
  sqliteMasterSha256: string;
  members: readonly SnapshotMember[];
  xArtifacts?: { manifestRelativePath: typeof X_MANIFEST_PATH; manifestSha256: string; databaseSha256: string;
    databaseSchemaSha256: typeof X_PAGE_ADMISSION_SCHEMA_SHA256 };
};

export type LatestPointer = {
  schemaVersion: typeof LATEST_SCHEMA_VERSION;
  packageId: string;
  recovery_point_at: string;
  contentHash: string;
  kind: typeof SNAPSHOT_KIND;
  keyId: string;
};

export type BackupReport = {
  ok: boolean;
  code: string;
  retentionSkipped: boolean;
  recoveryPointAt?: string;
  contentHash?: string;
  packageId?: string;
  keyId?: string;
  deduped?: boolean;
  retainedCount?: number;
  userVersion?: number;
  sqliteMasterSha256?: string;
  elapsedMs?: number;
  checks?: Record<string, string>;
  xArtifactRebinding?: XPageArtifactRebindingProposal;
  verification?: SnapshotVerificationCounts;
  stage?: SnapshotStage;
};

export type SnapshotStage =
  | "ACQUIRE_LOCK" | "VERIFY_RETAINED" | "CAPTURE_DATABASE" | "FREEZE_PROJECTION"
  | "BUILD_ARCHIVE" | "ENCRYPT_OBJECT" | "VERIFY_NEW_OBJECT" | "PUBLISH_PACKAGE"
  | "ROTATE_RETENTION" | "CLEANUP" | "RELEASE_LOCK";

export type SnapshotVerificationCounts = {
  objectsAuthenticated: number;
  encryptedBytesAuthenticated: number;
  cacheHits: number;
};

export type SnapshotDiagnostic = {
  code: "SNAPSHOT_STAGE";
  failure?: true;
  stage: SnapshotStage;
  at: string;
  elapsedMs: number;
  verification: SnapshotVerificationCounts;
};

export type SnapshotInput = {
  sourceDbPath: string;
  projectionRoot: string;
  outputDir: string;
  key: Buffer;
  retain: number;
  /** Production CLI always uses this boundary. Omission retains the generic
   * archive API for older isolated/non-delivery-schema callers. */
  projectionBoundary?: "confirmed-delivery-v1";
  xPageRuntimeTrust?: LoadedXPageRuntimeTrust;
  sourceDatabaseIdentity?: Readonly<{ dev: number; ino: number; uid: number; nlink: 1 }>;
  now?: () => Date;
  testOnlyAfterDatabaseSnapshot?: (snapshotPath: string) => void;
  testOnlyAfterObjectWrite?: (objectPath: string) => void;
  /** Diagnostics only: the production CLI emits bounded, closed fields to stderr. */
  onStage?: (diagnostic: SnapshotDiagnostic) => void;
};

export type RestoreInput = {
  backupRoot: string;
  restoreRoot: string;
  key: Buffer;
  packageId?: string;
  expectedUserVersion?: number;
  verifyOnly?: boolean;
};

export type ValidatedPackage = {
  packageId: string;
  recoveryPointAt: string;
  contentHash: string;
  keyId: string;
};

type SqliteMasterRow = {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
};

export class BackupError extends Error {
  readonly code: string;
  readonly retentionSkipped: boolean;
  readonly snapshotStage?: SnapshotStage;

  constructor(code: string, retentionSkipped = false, snapshotStage?: SnapshotStage) {
    super(code);
    this.name = "BackupError";
    this.code = code;
    this.retentionSkipped = retentionSkipped;
    this.snapshotStage = snapshotStage;
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (!value || typeof value !== "object") throw new BackupError("CANONICAL_VALUE_INVALID");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function sha256Bytes(value: Buffer | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function keyIdFromKey(key: Buffer): string {
  if (key.byteLength !== AES_KEY_LENGTH) throw new BackupError("KEY_FILE_INVALID");
  return sha256Bytes(key).slice(0, 16);
}

export function loadKeyFile(path: string): Buffer {
  assertRegularPrivateFile(path);
  const raw = readFileSync(path);
  if (raw.byteLength === AES_KEY_LENGTH) return Buffer.from(raw);
  const hex = raw.toString("utf8").trim();
  if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, "hex");
  throw new BackupError("KEY_FILE_INVALID");
}

export function objectFileName(kind: string, contentHash: string, keyId: string): string {
  if (kind !== SNAPSHOT_KIND || !HASH_PATTERN.test(contentHash) || !KEY_ID_PATTERN.test(keyId)) {
    throw new BackupError("OBJECT_IDENTITY_INVALID");
  }
  return `${kind}.${contentHash}.${keyId}`;
}

export function packageIdFor(recoveryPointAt: string, contentHash: string): string {
  const epoch = Date.parse(recoveryPointAt);
  if (!Number.isFinite(epoch) || !HASH_PATTERN.test(contentHash)) throw new BackupError("PACKAGE_IDENTITY_INVALID");
  return `${String(epoch).padStart(13, "0")}_${contentHash.slice(0, 16)}`;
}

export function backupLayout(outputDir: string): {
  root: string;
  lockPath: string;
  objectsDir: string;
  packagesDir: string;
  latestPath: string;
  stagingDir: string;
} {
  const root = resolve(outputDir);
  return {
    root,
    lockPath: join(root, "run.lock"),
    objectsDir: join(root, "objects"),
    packagesDir: join(root, "packages"),
    latestPath: join(root, "latest.json"),
    stagingDir: join(root, ".staging")
  };
}

export function runSnapshotOnce(input: SnapshotInput): BackupReport {
  const started = Date.now();
  const keyId = keyIdFromKey(input.key);
  if (!Number.isInteger(input.retain) || input.retain < 1 || input.retain > 10_000) {
    throw new BackupError("RETAIN_INVALID");
  }
  const layout = backupLayout(input.outputDir);
  ensurePrivateDir(layout.root);
  ensurePrivateDir(layout.objectsDir);
  ensurePrivateDir(layout.packagesDir);
  // This cache never escapes this invocation or its exclusively held run lock.
  const verification = createVerificationContext();
  let currentStage: SnapshotStage = "ACQUIRE_LOCK";
  const markStage = (stage: SnapshotStage, failure = false): void => {
    currentStage = stage;
    input.onStage?.({
      code: "SNAPSHOT_STAGE", stage, failure: failure ? true : undefined,
      at: new Date().toISOString(), elapsedMs: Date.now() - started,
      verification: { ...verification.counts }
    });
  };
  markStage("ACQUIRE_LOCK");
  const lock = acquireRunLock(layout.lockPath, input.now);
  let stagingRoot: string | null = null;
  let createdObject: string | null = null;
  let packagePublished = false;
  try {
    markStage("VERIFY_RETAINED");
    // A damaged retained package must not cause each retry to create another large orphan.
    for (const packageId of listPackageIds(layout.packagesDir)) {
      try { validatePackage(layout, packageId, input.key, verification); } catch (error) { throw wrapRetentionFailure(error); }
    }
    stagingRoot = join(layout.stagingDir, randomUUID());
    ensurePrivateDir(layout.stagingDir);
    ensurePrivateDir(stagingRoot);
    const sourceDbPath = assertRegularFile(input.sourceDbPath);
    const assertSourceIdentity = () => {
      if (!input.sourceDatabaseIdentity) return;
      const actual = lstatSync(sourceDbPath), expected = input.sourceDatabaseIdentity;
      if (realpathSync(sourceDbPath) !== sourceDbPath || !actual.isFile() || actual.isSymbolicLink() || actual.dev !== expected.dev
        || actual.ino !== expected.ino || actual.uid !== expected.uid || actual.nlink !== expected.nlink || (actual.mode & 0o077) !== 0) {
        throw new BackupError("X_BACKUP_DEPLOYMENT_DATABASE_IDENTITY_INVALID");
      }
    };
    assertSourceIdentity();
    const projectionRoot = assertProjectionRoot(input.projectionRoot);
    assertDiskSpace(layout.root, statSync(sourceDbPath).size, projectionBytes(projectionRoot));
    markStage("CAPTURE_DATABASE");
    const recoveryPointAt = utcNow(input.now);
    const vacuumPath = join(stagingRoot, `vacuum-${randomUUID()}.sqlite`);
    if (existsSync(vacuumPath)) throw new BackupError("VACUUM_TARGET_EXISTS");
    vacuumInto(sourceDbPath, vacuumPath);
    assertSourceIdentity();
    input.testOnlyAfterDatabaseSnapshot?.(vacuumPath);
    const fingerprint = readSchemaFingerprint(vacuumPath);
    const sourceFingerprint = readSchemaFingerprint(sourceDbPath);
    if (
      fingerprint.userVersion !== sourceFingerprint.userVersion ||
      fingerprint.sqliteMasterSha256 !== sourceFingerprint.sqliteMasterSha256
    ) {
      throw new BackupError("SCHEMA_FINGERPRINT_MISMATCH");
    }
    // Freeze the pointer once. A live receiver can advance independently of the
    // Admin acknowledgement transaction and must not choose the restore point.
    markStage("FREEZE_PROJECTION");
    const frozenActivePath = join(stagingRoot, "active.json"), frozenProjectionFiles = new Map<string, string>();
    const confirmed = input.projectionBoundary === "confirmed-delivery-v1" ? confirmedProjectionPointer(vacuumPath, projectionRoot) : null;
    const activeBytes = confirmed?.active ?? readFileSync(assertRegularFile(join(projectionRoot, "active.json")));
    writeExclusiveFile(frozenActivePath, activeBytes);
    frozenProjectionFiles.set("projection/active.json", frozenActivePath);
    if (confirmed) {
      const frozenGenerationPath = join(stagingRoot, "confirmed-generation.json");
      writeExclusiveFile(frozenGenerationPath, confirmed.generation.bytes);
      frozenProjectionFiles.set(confirmed.generation.relativePath, frozenGenerationPath);
    }
    markStage("BUILD_ARCHIVE");
    const members = collectMembers(vacuumPath, projectionRoot, frozenProjectionFiles);
    const cachedXBytes = new Map<string, Buffer>();
    let xArtifacts: SnapshotManifest["xArtifacts"];
    if (snapshotXSchemaIdentity(vacuumPath) === X_PAGE_ADMISSION_SCHEMA_SHA256) {
      if (fingerprint.userVersion !== 10 || !input.xPageRuntimeTrust) throw new BackupError("X_BACKUP_RUNTIME_TRUST_REQUIRED");
      const saved = prepareXPageArtifactBackup({ snapshot: { path: vacuumPath, expectedSha256: members[0].sha256 },
        runtimeTrust: input.xPageRuntimeTrust, now: new Date(recoveryPointAt) });
      cachedXBytes.set(X_MANIFEST_PATH, Buffer.from(saved.manifestJson, "utf8"));
      for (const member of saved.members) cachedXBytes.set(X_MEMBER_PREFIX + member.relativePath, Buffer.from(member.contentUtf8, "utf8"));
      for (const [relativePath, bytes] of cachedXBytes) members.push({ relativePath, bytes: bytes.length, sha256: sha256Bytes(bytes) });
      xArtifacts = { manifestRelativePath: X_MANIFEST_PATH, manifestSha256: saved.manifestSha256, databaseSha256: members[0].sha256,
        databaseSchemaSha256: X_PAGE_ADMISSION_SCHEMA_SHA256 };
      assertXMemberWhitelist(members);
      assertDiskSpace(layout.root, members[0].bytes, members.slice(1).reduce((sum, member) => sum + member.bytes, 0));
    } else if (input.xPageRuntimeTrust || snapshotHasXSchema(vacuumPath)) {
      throw new BackupError("X_BACKUP_SCHEMA_UNSUPPORTED");
    }
    const contentHash = sha256Text(canonicalJson(members));
    const archivePath = join(stagingRoot, "archive.bin");
    writeArchive(archivePath, members, vacuumPath, projectionRoot, frozenProjectionFiles, cachedXBytes);
    const objectPath = assertInside(layout.objectsDir, objectFileName(SNAPSHOT_KIND, contentHash, keyId));
    let deduped = false;
    if (existsSync(objectPath)) {
      markStage("VERIFY_NEW_OBJECT");
      verifyEncryptedObjectOnce(objectPath, input.key, SNAPSHOT_KIND, contentHash, keyId, members, verification);
      deduped = true;
    } else {
      markStage("ENCRYPT_OBJECT");
      encryptFileToObject(archivePath, objectPath, input.key, SNAPSHOT_KIND, contentHash, keyId);
      createdObject = objectPath;
      if (input.testOnlyAfterObjectWrite) input.testOnlyAfterObjectWrite(objectPath);
      try {
        markStage("VERIFY_NEW_OBJECT");
        verifyEncryptedObjectOnce(objectPath, input.key, SNAPSHOT_KIND, contentHash, keyId, members, verification);
      } catch (error) {
        throw wrapRetentionFailure(error);
      }
      fsyncDirectory(layout.objectsDir);
    }
    unlinkIfExists(vacuumPath);
    unlinkIfExists(archivePath);
    const manifest: SnapshotManifest = {
      schemaVersion: xArtifacts ? X_MANIFEST_SCHEMA_VERSION : MANIFEST_SCHEMA_VERSION,
      kind: SNAPSHOT_KIND,
      keyId,
      recovery_point_at: recoveryPointAt,
      contentHash,
      userVersion: fingerprint.userVersion,
      sqliteMasterSha256: fingerprint.sqliteMasterSha256,
      members,
      ...(xArtifacts ? { xArtifacts } : {})
    };
    const manifestJson = `${canonicalJson(manifest)}\n`;
    if (xArtifacts) parseManifest(manifestJson);
    markStage("PUBLISH_PACKAGE");
    const packageId = packageIdFor(recoveryPointAt, contentHash);
    const packageDir = assertInside(layout.packagesDir, packageId);
    if (existsSync(packageDir)) throw new BackupError("PACKAGE_EXISTS");
    const stagedPackage = join(stagingRoot, "complete-package");
    mkdirSync(stagedPackage, { mode: STAGING_MODE });
    writeExclusiveFile(join(stagedPackage, "manifest.json"), manifestJson);
    fsyncDirectory(stagedPackage);
    renameSync(stagedPackage, packageDir);
    packagePublished = true;
    fsyncDirectory(layout.packagesDir);
    replaceFile(
      layout.latestPath,
      `${canonicalJson({
        schemaVersion: LATEST_SCHEMA_VERSION,
        packageId,
        recovery_point_at: recoveryPointAt,
        contentHash,
        kind: SNAPSHOT_KIND,
        keyId
      } satisfies LatestPointer)}\n`
    );
    markStage("ROTATE_RETENTION");
    const retainedCount = rotateValidatedPackages(layout, input.key, input.retain, verification);
    return {
      ok: true,
      code: deduped ? "SNAPSHOT_DEDUPED" : "SNAPSHOT_OK",
      retentionSkipped: false,
      recoveryPointAt,
      contentHash,
      packageId,
      keyId,
      deduped,
      retainedCount,
      verification: { ...verification.counts },
      userVersion: fingerprint.userVersion,
      sqliteMasterSha256: fingerprint.sqliteMasterSha256,
      elapsedMs: Date.now() - started
    };
  } catch (error) {
    markStage(currentStage, true);
    throw error;
  } finally {
    // Always release our proven lock, even if cleanup itself fails. SIGKILL still needs lock recovery.
    try {
      try {
        markStage("CLEANUP");
        if (createdObject && !packagePublished && existsSync(createdObject)) unlinkSync(createdObject);
      } finally {
        if (stagingRoot && existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
      }
    } catch (error) {
      // Preserve cleanup as the failing stage even though lock release runs next.
      throw new BackupError(error instanceof BackupError ? error.code : "SNAPSHOT_CLEANUP_FAILED",
        error instanceof BackupError && error.retentionSkipped, "CLEANUP");
    } finally {
      // Diagnostic failures cannot bypass release of this invocation's exact lock.
      try { markStage("RELEASE_LOCK"); } finally { releaseRunLock(layout.lockPath, lock); }
    }
  }
}

export function runRestoreDrill(input: RestoreInput): BackupReport {
  const started = Date.now();
  const keyId = keyIdFromKey(input.key);
  const layout = backupLayout(input.backupRoot);
  const packageId = input.packageId ?? readLatestPointer(layout.latestPath).packageId;
  const manifest = readManifestForPackage(layout, packageId);
  assertManifestBinding(packageId, manifest, keyId);
  const restoreRoot = resolve(input.restoreRoot);
  let extracted: Map<string, Buffer> | undefined;
  if (!input.verifyOnly || manifest.xArtifacts) {
    const objectPath = assertInside(layout.objectsDir, objectFileName(manifest.kind, manifest.contentHash, manifest.keyId));
    extracted = parseArchive(decryptObject(objectPath, input.key, manifest.kind, manifest.contentHash, manifest.keyId));
    assertMembersMatch(extracted, manifest.members);
    if (manifest.xArtifacts) assertXArchiveBinding(manifest, extracted);
  }
  if (!input.verifyOnly) {
    if (existsSync(restoreRoot) && readdirSync(restoreRoot).length > 0) throw new BackupError("RESTORE_ROOT_NOT_EMPTY");
    ensurePrivateDir(restoreRoot);
    landMembers(restoreRoot, manifest.xArtifacts ? new Map([...extracted!].filter(([path]) => !path.startsWith(X_MEMBER_PREFIX))) : extracted!);
    if (manifest.xArtifacts) restoreXPageArtifactBackup({
      snapshot: { path: join(restoreRoot, "db/snapshot.sqlite"), expectedSha256: manifest.xArtifacts.databaseSha256 },
      manifestJson: decodeXUtf8(extracted!.get(X_MANIFEST_PATH)!), expectedManifestSha256: manifest.xArtifacts.manifestSha256,
      members: [...extracted!].filter(([path]) => path.startsWith(X_MEMBER_PREFIX)).map(([path, data]) => ({
        relativePath: path.slice(X_MEMBER_PREFIX.length), contentUtf8: decodeXUtf8(data) })),
      destinationRoot: join(restoreRoot, "x-page-artifacts/files"), now: new Date()
    });
  } else if (!existsSync(restoreRoot)) {
    throw new BackupError("RESTORE_ROOT_MISSING");
  }
  const { checks, xArtifactRebinding } = verifyRestoredTreeResult(restoreRoot, manifest, input.expectedUserVersion);
  return {
    ok: true,
    code: input.verifyOnly ? "RESTORE_VERIFY_OK" : "RESTORE_OK",
    retentionSkipped: false,
    recoveryPointAt: manifest.recovery_point_at,
    contentHash: manifest.contentHash,
    packageId,
    keyId,
    userVersion: manifest.userVersion,
    sqliteMasterSha256: manifest.sqliteMasterSha256,
    elapsedMs: Date.now() - started,
    checks,
    ...(xArtifactRebinding ? { xArtifactRebinding } : {})
  };
}

export function collectRetentionSet(outputDir: string, key: Buffer): readonly ValidatedPackage[] {
  const layout = backupLayout(outputDir);
  if (!existsSync(layout.packagesDir)) return [];
  const accepted: ValidatedPackage[] = [];
  for (const packageId of listPackageIds(layout.packagesDir)) {
    try {
      accepted.push(validatePackage(layout, packageId, key));
    } catch {
      // Orphan or incomplete claims are not part of the retention set.
    }
  }
  return accepted.sort((left, right) => right.recoveryPointAt.localeCompare(left.recoveryPointAt));
}

export function verifyRestoredTree(
  restoreRoot: string,
  manifest: SnapshotManifest,
  expectedUserVersion?: number
): Record<string, string> {
  return verifyRestoredTreeResult(restoreRoot, manifest, expectedUserVersion).checks;
}

function verifyRestoredTreeResult(restoreRoot: string, manifest: SnapshotManifest, expectedUserVersion?: number):
  { checks: Record<string, string>; xArtifactRebinding?: XPageArtifactRebindingProposal } {
  const dbPath = assertInside(restoreRoot, "db", "snapshot.sqlite");
  const projectionRoot = assertInside(restoreRoot, "projection");
  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    database.exec("PRAGMA query_only=ON");
    database.exec("PRAGMA foreign_keys=ON");
    const quick = database.prepare("PRAGMA quick_check").get() as { quick_check: string };
    if (quick.quick_check !== "ok") throw new BackupError("QUICK_CHECK_FAILED");
    const foreign = database.prepare("PRAGMA foreign_key_check").all();
    if (foreign.length !== 0) throw new BackupError("FOREIGN_KEY_CHECK_FAILED");
    const version = readUserVersion(database);
    const expected = expectedUserVersion ?? manifest.userVersion;
    if (version !== expected || version !== manifest.userVersion) throw new BackupError("USER_VERSION_MISMATCH");
    const master = sqliteMasterFingerprint(database);
    if (master !== manifest.sqliteMasterSha256) throw new BackupError("SCHEMA_FINGERPRINT_MISMATCH");
    const xSchema = database.prepare("SELECT 1 FROM sqlite_master WHERE name LIKE 'x_page_%' LIMIT 1").get()
      ? reviewRealSchemaFingerprint(database) : null;
    if (xSchema && !manifest.xArtifacts) throw new BackupError("X_BACKUP_COMPLETE_FORMAT_REQUIRED");
    if (xSchema !== X_PAGE_ADMISSION_SCHEMA_SHA256 && manifest.xArtifacts) throw new BackupError("X_BACKUP_SCHEMA_UNSUPPORTED");
    const pointer = verifyProjectionPointer(projectionRoot);
    const x = manifest.xArtifacts ? verifyRestoredXArtifacts(restoreRoot, manifest) : undefined;
    return { checks: {
      quick_check: "ok",
      foreign_key_check: "ok",
      user_version: String(version),
      sqlite_master_sha256: master,
      drill_public_pointer_verified: pointer,
      ...(x ? { x_artifact_manifest_sha256: x.proposal.artifactManifestSha256,
        x_artifact_database_sha256: x.proposal.databaseSha256, x_artifact_files_verified: String(x.proposal.memberCount),
        x_artifact_bytes_verified: String(x.proposal.totalBytes), x_artifact_rebinding_proposal_sha256: x.proposalSha256 } : {})
    }, ...(x ? { xArtifactRebinding: x.proposal } : {}) };
  } finally {
    database.close();
  }
}

export function reportFromError(error: unknown, elapsedMs: number): BackupReport {
  if (error instanceof BackupError) {
    return {
      ok: false,
      code: error.code,
      retentionSkipped: error.retentionSkipped,
      stage: error.snapshotStage,
      elapsedMs
    };
  }
  return {
    ok: false,
    code: "BACKUP_INTERNAL_FAILURE",
    retentionSkipped: false,
    elapsedMs
  };
}

function rotateValidatedPackages(
  layout: ReturnType<typeof backupLayout>,
  key: Buffer,
  retain: number,
  verification?: VerificationContext
): number {
  const packageIds = listPackageIds(layout.packagesDir);
  const validated: ValidatedPackage[] = [];
  for (const packageId of packageIds) {
    try {
      validated.push(validatePackage(layout, packageId, key, verification));
    } catch (error) {
      throw wrapRetentionFailure(error);
    }
  }
  validated.sort((left, right) => {
    const byTime = Date.parse(right.recoveryPointAt) - Date.parse(left.recoveryPointAt);
    return byTime !== 0 ? byTime : right.packageId.localeCompare(left.packageId);
  });
  const keep = new Set(validated.slice(0, retain).map((item) => item.packageId));
  const keepHashes = new Set(validated.slice(0, retain).map((item) => item.contentHash));
  for (const item of validated) {
    if (keep.has(item.packageId)) continue;
    rmSync(assertInside(layout.packagesDir, item.packageId), { recursive: true, force: false });
  }
  for (const name of existsSync(layout.objectsDir) ? readdirSync(layout.objectsDir) : []) {
    const match = /^db-projection-snapshot\.([0-9a-f]{64})\.[0-9a-f]{16}$/.exec(name);
    if (!match) continue;
    if (keepHashes.has(match[1])) continue;
    const objectPath = assertInside(layout.objectsDir, name);
    if (existsSync(objectPath)) unlinkSync(objectPath);
  }
  return Math.min(validated.length, retain);
}

function validatePackage(
  layout: ReturnType<typeof backupLayout>,
  packageId: string,
  key: Buffer,
  verification?: VerificationContext
): ValidatedPackage {
  const keyId = keyIdFromKey(key);
  // Every package is independently parsed/bound on every pass, including cache hits.
  const manifestPath = assertInside(layout.packagesDir, packageId, "manifest.json");
  const file = readStableRegularFile(manifestPath, "MANIFEST_IDENTITY_CHANGED");
  const manifest = parseManifest(file.bytes.toString("utf8"));
  assertManifestBinding(packageId, manifest, keyId);
  if (verification) {
    const prior = verification.packages.get(packageId), digest = sha256Bytes(file.bytes);
    if (prior && (!sameIdentity(prior.identity, file.identity) || prior.sha256 !== digest)) throw new BackupError("MANIFEST_IDENTITY_CHANGED");
    verification.packages.set(packageId, { identity: file.identity, sha256: digest });
  }
  const objectPath = assertInside(layout.objectsDir, objectFileName(manifest.kind, manifest.contentHash, manifest.keyId));
  if (manifest.xArtifacts) {
    // X archives retain complete authentication and cross-file binding on every pass.
    const before = verification ? regularIdentity(objectPath, "OBJECT_IDENTITY_CHANGED") : undefined;
    const extracted = parseArchive(decryptObject(objectPath, key, manifest.kind, manifest.contentHash, manifest.keyId));
    assertMembersMatch(extracted, manifest.members); assertXArchiveBinding(manifest, extracted);
    if (verification && before) {
      if (!sameIdentity(before, regularIdentity(objectPath, "OBJECT_IDENTITY_CHANGED"))) throw new BackupError("OBJECT_IDENTITY_CHANGED");
      verification.counts.objectsAuthenticated += 1;
      verification.counts.encryptedBytesAuthenticated += Number(before.size);
    }
  } else verifyEncryptedObjectOnce(objectPath, key, manifest.kind, manifest.contentHash, manifest.keyId, manifest.members, verification);
  return {
    packageId,
    recoveryPointAt: manifest.recovery_point_at,
    contentHash: manifest.contentHash,
    keyId: manifest.keyId
  };
}

function wrapRetentionFailure(error: unknown): BackupError {
  if (error instanceof BackupError) return new BackupError(error.code, true);
  return new BackupError("PACKAGE_VERIFY_FAILED", true);
}

function readManifestForPackage(layout: ReturnType<typeof backupLayout>, packageId: string): SnapshotManifest {
  if (!PACKAGE_ID_PATTERN.test(packageId)) throw new BackupError("PACKAGE_IDENTITY_INVALID");
  const manifestPath = assertInside(layout.packagesDir, packageId, "manifest.json");
  return parseManifest(readFileSync(manifestPath, "utf8"));
}

export function parseManifest(raw: string): SnapshotManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new BackupError("MANIFEST_INVALID");
  }
  if (!value || typeof value !== "object") throw new BackupError("MANIFEST_INVALID");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== MANIFEST_SCHEMA_VERSION && record.schemaVersion !== X_MANIFEST_SCHEMA_VERSION) throw new BackupError("MANIFEST_INVALID");
  const isX = record.schemaVersion === X_MANIFEST_SCHEMA_VERSION;
  if (isX && Buffer.byteLength(raw, "utf8") > 4 * 1024 * 1024) throw new BackupError("X_BACKUP_MANIFEST_LIMIT_EXCEEDED");
  if (record.kind !== SNAPSHOT_KIND) throw new BackupError("MANIFEST_INVALID");
  if (typeof record.keyId !== "string" || !KEY_ID_PATTERN.test(record.keyId)) throw new BackupError("MANIFEST_INVALID");
  if (typeof record.recovery_point_at !== "string" || !Number.isFinite(Date.parse(record.recovery_point_at))) {
    throw new BackupError("MANIFEST_INVALID");
  }
  if (typeof record.contentHash !== "string" || !HASH_PATTERN.test(record.contentHash)) throw new BackupError("MANIFEST_INVALID");
  if (!Number.isInteger(record.userVersion)) throw new BackupError("MANIFEST_INVALID");
  if (typeof record.sqliteMasterSha256 !== "string" || !HASH_PATTERN.test(record.sqliteMasterSha256)) {
    throw new BackupError("MANIFEST_INVALID");
  }
  if (!Array.isArray(record.members) || record.members.length < 2) throw new BackupError("MANIFEST_INVALID");
  const members: SnapshotMember[] = record.members.map((item) => {
    if (!item || typeof item !== "object") throw new BackupError("MANIFEST_INVALID");
    const member = item as Record<string, unknown>;
    if (isX && !exactKeys(member, ["relativePath", "bytes", "sha256"])) throw new BackupError("MANIFEST_INVALID");
    if (typeof member.relativePath !== "string" || typeof member.sha256 !== "string" || !Number.isInteger(member.bytes)) {
      throw new BackupError("MANIFEST_INVALID");
    }
    if (!HASH_PATTERN.test(member.sha256) || (member.bytes as number) < 0) throw new BackupError("MANIFEST_INVALID");
    assertRelativeMemberPath(member.relativePath);
    return {
      relativePath: member.relativePath,
      bytes: member.bytes as number,
      sha256: member.sha256
    };
  });
  if (sha256Text(canonicalJson(members)) !== record.contentHash) throw new BackupError("MANIFEST_CONTENT_HASH_MISMATCH");
  let xArtifacts: SnapshotManifest["xArtifacts"];
  if (isX) {
    if (!exactKeys(record, ["schemaVersion", "kind", "keyId", "recovery_point_at", "contentHash", "userVersion", "sqliteMasterSha256", "members", "xArtifacts"])
      || record.userVersion !== 10) throw new BackupError("X_BACKUP_SCHEMA_UNSUPPORTED");
    const x = record.xArtifacts as Record<string, unknown> | undefined;
    if (!x || !exactKeys(x, ["manifestRelativePath", "manifestSha256", "databaseSha256", "databaseSchemaSha256"]) || x.manifestRelativePath !== X_MANIFEST_PATH
      || x.databaseSchemaSha256 !== X_PAGE_ADMISSION_SCHEMA_SHA256
      || typeof x.manifestSha256 !== "string" || !HASH_PATTERN.test(x.manifestSha256)
      || typeof x.databaseSha256 !== "string" || !HASH_PATTERN.test(x.databaseSha256)) throw new BackupError("X_BACKUP_MANIFEST_INVALID");
    assertXMemberWhitelist(members);
    if (members.find(member => member.relativePath === X_MANIFEST_PATH)?.sha256 !== x.manifestSha256
      || members.find(member => member.relativePath === "db/snapshot.sqlite")?.sha256 !== x.databaseSha256) throw new BackupError("X_BACKUP_MANIFEST_BINDING_INVALID");
    xArtifacts = { manifestRelativePath: X_MANIFEST_PATH, manifestSha256: x.manifestSha256, databaseSha256: x.databaseSha256,
      databaseSchemaSha256: X_PAGE_ADMISSION_SCHEMA_SHA256 };
  } else if (record.sqliteMasterSha256 === X_PAGE_ADMISSION_SCHEMA_SHA256 || record.xArtifacts !== undefined
    || members.some(member => member.relativePath.startsWith("x-page-artifacts/"))) throw new BackupError("X_BACKUP_COMPLETE_FORMAT_REQUIRED");
  return {
    schemaVersion: record.schemaVersion,
    kind: SNAPSHOT_KIND,
    keyId: record.keyId,
    recovery_point_at: record.recovery_point_at,
    contentHash: record.contentHash,
    userVersion: record.userVersion as number,
    sqliteMasterSha256: record.sqliteMasterSha256,
    members,
    ...(xArtifacts ? { xArtifacts } : {})
  };
}

function assertManifestBinding(packageId: string, manifest: SnapshotManifest, keyId: string): void {
  if (packageIdFor(manifest.recovery_point_at, manifest.contentHash) !== packageId) {
    throw new BackupError("MANIFEST_REPLAY_REJECTED");
  }
  if (manifest.keyId !== keyId || manifest.kind !== SNAPSHOT_KIND) throw new BackupError("OBJECT_IDENTITY_INVALID");
}

function readLatestPointer(path: string): LatestPointer {
  if (!existsSync(path)) throw new BackupError("LATEST_POINTER_MISSING");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as LatestPointer;
  if (parsed.schemaVersion !== LATEST_SCHEMA_VERSION || !PACKAGE_ID_PATTERN.test(parsed.packageId)) {
    throw new BackupError("LATEST_POINTER_INVALID");
  }
  return parsed;
}

/** The snapshot contains pending/in-flight outbox work as well as delivered work.
 * Restore Public at the newest generation whose original active receipt was
 * committed in that exact SQLite snapshot. This changes only staged pointer
 * bytes; the live pointer, DB and original delivery history remain untouched.
 * Registration independently checks the signature and this same DB binding. */
function confirmedProjectionPointer(vacuumPath: string, projectionRoot: string): Readonly<{
  active: Buffer; generation: Readonly<{ relativePath: string; bytes: Buffer }>;
}> {
  const fail = (condition: unknown, code: string): void => { if (!condition) throw new BackupError(code); };
  fail(!existsSync(join(projectionRoot, "bilingual-active.json")), "BACKUP_BILINGUAL_BOUNDARY_UNSUPPORTED");
  const boundedJson = (path: string): { value: unknown; raw: string } => {
    const regular = assertRegularFile(path), stat = lstatSync(regular), parent = dirname(regular), parentStat = lstatSync(parent);
    const identity = (value: typeof stat) => [value.dev,value.ino,value.uid,value.mode,value.nlink,value.size,value.mtimeMs,value.ctimeMs].join(":");
    fail(stat.size > 0 && stat.size <= 2 * 1024 * 1024 && stat.nlink === 1 && stat.uid === process.getuid?.()
      && !(stat.mode & 0o077) && parentStat.isDirectory() && !parentStat.isSymbolicLink() && realpathSync(parent) === parent
      && parentStat.uid === process.getuid?.() && !(parentStat.mode & 0o077), "BACKUP_PROJECTION_FILE_INVALID");
    const fd = openSync(regular, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    try {
      fail(identity(fstatSync(fd)) === identity(stat), "BACKUP_PROJECTION_FILE_CHANGED");
      const bytes = Buffer.alloc(stat.size + 1); let length = 0;
      while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
      const finalParent = lstatSync(parent);
      fail(length === stat.size && identity(fstatSync(fd)) === identity(stat) && identity(lstatSync(regular)) === identity(stat)
        && realpathSync(parent) === parent && finalParent.dev === parentStat.dev && finalParent.ino === parentStat.ino
        && finalParent.mode === parentStat.mode && finalParent.uid === parentStat.uid, "BACKUP_PROJECTION_FILE_CHANGED");
      try { const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); return { value: JSON.parse(raw), raw }; }
      catch { throw new BackupError("BACKUP_PROJECTION_FILE_INVALID"); }
    } finally { closeSync(fd); }
  };
  const liveFile = boundedJson(join(projectionRoot, "active.json")), live = liveFile.value as Record<string, unknown>;
  fail(live?.schemaVersion === "projection-active-pointer-v1" && Number.isSafeInteger(live.snapshotGeneration)
    && Number(live.snapshotGeneration) > 0 && HASH_PATTERN.test(String(live.snapshotManifestHash)), "PROJECTION_POINTER_INVALID");
  fail(typeof live.activatedAt === "string" && Number.isFinite(Date.parse(live.activatedAt))
    && new Date(live.activatedAt).toISOString() === live.activatedAt && liveFile.raw === canonicalJson({
      schemaVersion: "projection-active-pointer-v1", snapshotGeneration: live.snapshotGeneration,
      snapshotManifestHash: live.snapshotManifestHash, activatedAt: live.activatedAt }), "PROJECTION_POINTER_INVALID");
  const database = new DatabaseSync(vacuumPath, { readOnly: true });
  try {
    database.exec("PRAGMA query_only=ON");
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projection_outbox','projection_delivery_receipt')").all();
    fail(tables.length === 2, "BACKUP_PROJECTION_DELIVERY_SCHEMA_MISSING");
    // Do not skip a broken newest success in favour of older data. An incomplete
    // or inconsistent acknowledgement is a visible failure before encryption.
    const outbox = database.prepare("SELECT * FROM projection_outbox WHERE status='succeeded' ORDER BY snapshot_generation DESC LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    fail(outbox, "BACKUP_PROJECTION_DELIVERY_MISSING");
    const row = outbox!;
    fail(Number.isSafeInteger(row.snapshot_generation) && Number(row.snapshot_generation) > 0
      && HASH_PATTERN.test(String(row.snapshot_manifest_hash)), "BACKUP_PROJECTION_OUTBOX_MISMATCH");
    fail(Number(row.snapshot_generation) <= Number(live.snapshotGeneration), "BACKUP_PROJECTION_LIVE_BEHIND_CONFIRMED");
    const receiptRow = database.prepare("SELECT * FROM projection_delivery_receipt WHERE delivery_id=?").get(String(row.delivery_id)) as Record<string, unknown> | undefined;
    fail(receiptRow, "BACKUP_PROJECTION_DELIVERY_MISSING");
    let receipt: ReturnType<typeof ProjectionReceiptSchema.parse>, signed: ReturnType<typeof SignedProjectionPackageSchema.parse>;
    const generationFile = boundedJson(assertInside(projectionRoot, "generations", `${row.snapshot_manifest_hash}.json`)),
      generation = generationFile.value as Record<string, unknown>;
    try {
      receipt = ProjectionReceiptSchema.parse(JSON.parse(String(receiptRow!.receipt_json)));
      signed = SignedProjectionPackageSchema.parse(generation?.package);
    } catch { throw new BackupError("BACKUP_PROJECTION_RECEIPT_INVALID"); }
    fail(generation.schemaVersion === "projection-committed-generation-v1" && generation.activatedAt === receipt.activatedAt
      && generation.receivedAt === receipt.receivedAt, "BACKUP_PROJECTION_GENERATION_MISMATCH");
    fail(generationFile.raw === canonicalJson({ schemaVersion: "projection-committed-generation-v1", package: signed,
      receivedAt: receipt.receivedAt, activatedAt: receipt.activatedAt }), "BACKUP_PROJECTION_GENERATION_INVALID");
    fail(canonicalJson(receipt) === receiptRow!.receipt_json && sha256Text(canonicalJson(receipt)) === receiptRow!.receipt_hash,
      "BACKUP_PROJECTION_RECEIPT_HASH_MISMATCH");
    fail(signed.taskEnvelopeHash === row.task_envelope_hash && canonicalJson(signed.taskEnvelope) === row.task_envelope_json
      && sha256Text(canonicalJson(signed.taskEnvelope)) === signed.taskEnvelopeHash
      && signed.taskEnvelope.deliveryId === row.delivery_id && signed.taskEnvelope.snapshot.snapshotGeneration === row.snapshot_generation
      && signed.taskEnvelope.snapshot.snapshotManifestHash === row.snapshot_manifest_hash, "BACKUP_PROJECTION_OUTBOX_MISMATCH");
    fail(receipt.deliveryId === row.delivery_id && receipt.snapshotGeneration === row.snapshot_generation
      && receipt.snapshotManifestHash === row.snapshot_manifest_hash && receipt.status === "active"
      && receipt.activeSnapshotGeneration === row.snapshot_generation && receipt.activeSnapshotManifestHash === row.snapshot_manifest_hash,
    "BACKUP_PROJECTION_RECEIPT_MISMATCH");
    // A same-number different live manifest indicates corruption, not normal
    // receiver-ahead-of-acknowledgement progress.
    fail(row.snapshot_generation !== live.snapshotGeneration || row.snapshot_manifest_hash === live.snapshotManifestHash
      && generation.activatedAt === live.activatedAt, "BACKUP_PROJECTION_LIVE_IDENTITY_MISMATCH");
    return { active: Buffer.from(canonicalJson({ schemaVersion: "projection-active-pointer-v1", snapshotGeneration: row.snapshot_generation,
      snapshotManifestHash: row.snapshot_manifest_hash, activatedAt: receipt.activatedAt }), "utf8"),
    generation: { relativePath: `projection/generations/${row.snapshot_manifest_hash}.json`, bytes: Buffer.from(generationFile.raw, "utf8") } };
  } finally { database.close(); }
}

function collectMembers(vacuumPath: string, projectionRoot: string, frozenProjectionFiles: ReadonlyMap<string, string>): SnapshotMember[] {
  const members: SnapshotMember[] = [fileMember("db/snapshot.sqlite", vacuumPath)];
  const generationsRoot = join(projectionRoot, "generations");
  const generations = new Set(listGenerationRelPaths(generationsRoot).map(relative => `projection/generations/${relative}`));
  for (const relative of frozenProjectionFiles.keys()) if (relative.startsWith("projection/generations/")) generations.add(relative);
  for (const relativePath of [...generations].sort()) {
    members.push(fileMember(relativePath, frozenProjectionFiles.get(relativePath) ?? memberAbsolute(relativePath, vacuumPath, projectionRoot)));
  }
  members.push(fileMember("projection/active.json", frozenProjectionFiles.get("projection/active.json")!));
  const bilingualNames = readdirSync(projectionRoot)
    .filter((name) => name.startsWith("bilingual-generation-"))
    .sort();
  for (const name of bilingualNames) {
    members.push(fileMember(`projection/${name}`, join(projectionRoot, name)));
  }
  const bilingualActive = join(projectionRoot, "bilingual-active.json");
  if (existsSync(bilingualActive)) members.push(fileMember("projection/bilingual-active.json", bilingualActive));
  return members;
}

function fileMember(relativePath: string, absolutePath: string): SnapshotMember {
  assertRelativeMemberPath(relativePath);
  const bytes = readFileSync(absolutePath);
  return { relativePath, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
}

function writeArchive(
  archivePath: string,
  members: readonly SnapshotMember[],
  vacuumPath: string,
  projectionRoot: string,
  frozenProjectionFiles: ReadonlyMap<string, string>,
  cachedBytes: ReadonlyMap<string, Buffer> = new Map()
): void {
  const fd = openExclusive(archivePath);
  try {
    writeFully(fd, ARCHIVE_MAGIC);
    writeU32(fd, members.length);
    for (const member of members) {
      const pathBytes = Buffer.from(member.relativePath, "utf8");
      const data = cachedBytes.get(member.relativePath)
        ?? readFileSync(frozenProjectionFiles.get(member.relativePath) ?? memberAbsolute(member.relativePath, vacuumPath, projectionRoot));
      if (data.byteLength !== member.bytes || sha256Bytes(data) !== member.sha256) {
        throw new BackupError("PACKAGE_VERIFY_FAILED");
      }
      writeU32(fd, pathBytes.byteLength);
      writeFully(fd, pathBytes);
      writeU32(fd, data.byteLength);
      writeFully(fd, data);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodPrivateFile(archivePath);
}

function memberAbsolute(relativePath: string, vacuumPath: string, projectionRoot: string): string {
  if (relativePath === "db/snapshot.sqlite") return vacuumPath;
  if (!relativePath.startsWith("projection/")) throw new BackupError("PATH_ESCAPE");
  return assertInside(projectionRoot, ...relativePath.slice("projection/".length).split("/"));
}

function parseArchive(archive: Buffer): Map<string, Buffer> {
  let offset = 0;
  if (archive.length < 8 || archive.subarray(0, 4).compare(ARCHIVE_MAGIC) !== 0) throw new BackupError("ARCHIVE_INVALID");
  offset += 4;
  const count = archive.readUInt32LE(offset);
  offset += 4;
  const extracted = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (offset + 4 > archive.length) throw new BackupError("ARCHIVE_INVALID");
    const pathLen = archive.readUInt32LE(offset);
    offset += 4;
    if (pathLen < 1 || pathLen > 4096 || offset + pathLen + 4 > archive.length) throw new BackupError("ARCHIVE_INVALID");
    const relativePath = archive.subarray(offset, offset + pathLen).toString("utf8");
    offset += pathLen;
    const dataLen = archive.readUInt32LE(offset);
    offset += 4;
    if (offset + dataLen > archive.length || extracted.has(relativePath)) throw new BackupError("ARCHIVE_INVALID");
    const data = Buffer.from(archive.subarray(offset, offset + dataLen));
    offset += dataLen;
    assertRelativeMemberPath(relativePath);
    extracted.set(relativePath, data);
  }
  if (offset !== archive.byteLength) throw new BackupError("ARCHIVE_INVALID");
  return extracted;
}

function assertMembersMatch(extracted: Map<string, Buffer>, members: readonly SnapshotMember[]): void {
  if (extracted.size !== members.length) throw new BackupError("PACKAGE_VERIFY_FAILED");
  for (const member of members) {
    const data = extracted.get(member.relativePath);
    if (!data || data.byteLength !== member.bytes || sha256Bytes(data) !== member.sha256) {
      throw new BackupError("PACKAGE_VERIFY_FAILED");
    }
  }
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  return canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function snapshotHasXSchema(path: string): boolean {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE name LIKE 'x_page_%' LIMIT 1").get()); }
  finally { database.close(); }
}
function snapshotXSchemaIdentity(path: string): string | null {
  if (!snapshotHasXSchema(path)) return null;
  const database = new DatabaseSync(path, { readOnly: true });
  try { return reviewRealSchemaFingerprint(database); } finally { database.close(); }
}
function assertXMemberWhitelist(members: readonly SnapshotMember[]): void {
  const seen = new Set<string>();
  if (members.length > 200_000) throw new BackupError("X_BACKUP_MEMBER_LIMIT_EXCEEDED");
  for (const member of members) {
    if (seen.has(member.relativePath) || !Number.isSafeInteger(member.bytes) || member.bytes < 1
      || !/^(db\/snapshot\.sqlite|projection\/active\.json|projection\/generations\/[0-9a-f]{64}\.json|x-page-artifacts\/manifest\.json|x-page-artifacts\/files\/(captures|tool-receipts|artifacts|raw-tool-output|verifier-receipts)\/[0-9a-f]{64}\.json)$/.test(member.relativePath)) {
      throw new BackupError("X_BACKUP_MEMBER_WHITELIST_REJECTED");
    }
    seen.add(member.relativePath);
  }
  if (!["db/snapshot.sqlite", "projection/active.json", X_MANIFEST_PATH].every(path => seen.has(path))) throw new BackupError("X_BACKUP_MEMBER_SET_INVALID");
}
function decodeXUtf8(bytes: Buffer): string {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new BackupError("X_BACKUP_MEMBER_ENCODING_INVALID"); }
}
function assertXArchiveBinding(manifest: SnapshotManifest, extracted: ReadonlyMap<string, Buffer>): void {
  const binding = manifest.xArtifacts;
  if (!binding) throw new BackupError("X_BACKUP_COMPLETE_FORMAT_REQUIRED");
  assertXMemberWhitelist(manifest.members);
  const raw = extracted.get(X_MANIFEST_PATH);
  if (!raw || raw.length > 64 * 1024 * 1024 || sha256Bytes(raw) !== binding.manifestSha256) throw new BackupError("X_BACKUP_MANIFEST_BINDING_INVALID");
  const text = decodeXUtf8(raw), inner = XPageArtifactBackupManifestSchema.parse(JSON.parse(text));
  const db = manifest.members.find(member => member.relativePath === "db/snapshot.sqlite")!;
  if (canonicalJson(inner) !== text || inner.database.sha256 !== binding.databaseSha256 || inner.database.sha256 !== db.sha256
    || inner.database.bytes !== db.bytes || inner.database.schemaSha256 !== binding.databaseSchemaSha256) throw new BackupError("X_BACKUP_DATABASE_BINDING_INVALID");
  const expected = inner.members.map(member => ({ ...member, relativePath: X_MEMBER_PREFIX + member.relativePath }));
  const actual = manifest.members.filter(member => member.relativePath.startsWith(X_MEMBER_PREFIX));
  if (canonicalJson(expected) !== canonicalJson(actual)) throw new BackupError("X_BACKUP_ARTIFACT_MEMBER_SET_MISMATCH");
  for (const member of expected) {
    const data = extracted.get(member.relativePath);
    if (!data || data.length !== member.bytes || sha256Bytes(data) !== member.sha256) throw new BackupError("X_BACKUP_ARTIFACT_MEMBER_MISMATCH");
  }
}
function verifyRestoredXArtifacts(restoreRoot: string, manifest: SnapshotManifest) {
  const binding = manifest.xArtifacts;
  if (!binding) throw new BackupError("X_BACKUP_COMPLETE_FORMAT_REQUIRED");
  const extracted = new Map<string, Buffer>();
  const expected = new Set(manifest.members.map(member => member.relativePath));
  for (const member of manifest.members) {
    const bytes = readFileSync(assertRegularFile(join(restoreRoot, member.relativePath)));
    if (bytes.length !== member.bytes || sha256Bytes(bytes) !== member.sha256) throw new BackupError("X_BACKUP_RESTORED_MEMBER_MISMATCH");
    extracted.set(member.relativePath, bytes);
  }
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!entry.isFile() || !expected.has(relative(restoreRoot, full))) throw new BackupError("X_BACKUP_UNEXPECTED_RESTORED_MEMBER");
    }
  };
  walk(restoreRoot); assertXArchiveBinding(manifest, extracted);
  return verifyRestoredXPageArtifactBackup({ snapshot: { path: join(restoreRoot, "db/snapshot.sqlite"), expectedSha256: binding.databaseSha256 },
    manifestJson: decodeXUtf8(extracted.get(X_MANIFEST_PATH)!), expectedManifestSha256: binding.manifestSha256,
    artifactRoot: join(restoreRoot, "x-page-artifacts/files"), now: new Date() });
}

function landMembers(restoreRoot: string, extracted: Map<string, Buffer>): void {
  const ordered = [...extracted.keys()].sort((left, right) => landRank(left) - landRank(right) || left.localeCompare(right));
  for (const relativePath of ordered) {
    const dest = landPath(restoreRoot, relativePath);
    ensurePrivateDir(dirname(dest));
    writeExclusiveFile(dest, extracted.get(relativePath)!);
  }
}

function landRank(relativePath: string): number {
  if (relativePath === "db/snapshot.sqlite") return 0;
  if (relativePath.startsWith("projection/generations/")) return 1;
  if (relativePath.startsWith("projection/bilingual-generation-")) return 2;
  if (relativePath === "projection/active.json") return 3;
  if (relativePath === "projection/bilingual-active.json") return 4;
  return 5;
}

function landPath(root: string, relativePath: string): string {
  assertRelativeMemberPath(relativePath);
  return assertInside(root, ...relativePath.split("/"));
}

function encryptFileToObject(
  plainPath: string,
  objectPath: string,
  key: Buffer,
  kind: string,
  contentHash: string,
  keyId: string
): void {
  const iv = randomBytes(AES_IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${kind}|${contentHash}|${keyId}`, "utf8"));
  const fd = openExclusive(objectPath);
  const inFd = openSync(plainPath, fsConstants.O_RDONLY | noFollow());
  try {
    writeFully(fd, iv);
    const buffer = Buffer.alloc(CHUNK_SIZE);
    let read = 0;
    while ((read = readSync(inFd, buffer, 0, buffer.length, null)) > 0) {
      const chunk = cipher.update(buffer.subarray(0, read));
      if (chunk.byteLength > 0) writeFully(fd, chunk);
    }
    const finalChunk = cipher.final();
    if (finalChunk.byteLength > 0) writeFully(fd, finalChunk);
    writeFully(fd, cipher.getAuthTag());
    fsyncSync(fd);
  } catch (error) {
    closeSync(inFd);
    closeSync(fd);
    unlinkIfExists(objectPath);
    throw error instanceof BackupError ? error : new BackupError("ENCRYPT_FAILED");
  }
  closeSync(inFd);
  closeSync(fd);
  chmodPrivateFile(objectPath);
}

function decryptObject(
  objectPath: string,
  key: Buffer,
  kind: string,
  contentHash: string,
  keyId: string
): Buffer {
  const blob = readStableRegularFile(objectPath, "OBJECT_IDENTITY_CHANGED").bytes;
  if (blob.byteLength < AES_IV_LENGTH + AES_TAG_LENGTH + 1) throw new BackupError("DECRYPT_FAILED");
  const iv = blob.subarray(0, AES_IV_LENGTH);
  const tag = blob.subarray(blob.byteLength - AES_TAG_LENGTH);
  const ciphertext = blob.subarray(AES_IV_LENGTH, blob.byteLength - AES_TAG_LENGTH);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(`${kind}|${contentHash}|${keyId}`, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new BackupError("DECRYPT_FAILED");
  }
}

function verifyEncryptedObject(
  objectPath: string,
  key: Buffer,
  kind: string,
  contentHash: string,
  keyId: string,
  members: readonly SnapshotMember[]
): void {
  const code = "OBJECT_IDENTITY_CHANGED";
  const before = regularIdentity(objectPath, code);
  const fd = openSync(objectPath, fsConstants.O_RDONLY | noFollow());
  const checkIdentity = (): void => {
    try {
      if (sameIdentity(before, identityFromStat(fstatSync(fd, { bigint: true }))) &&
          sameIdentity(before, regularIdentity(objectPath, code))) return;
    } catch { /* A detached or inaccessible pathname cannot establish identity. */ }
    throw new BackupError(code);
  };
  const readExact = (buffer: Buffer, length: number, position: number): void => {
    let offset = 0;
    while (offset < length) {
      const bytes = readSync(fd, buffer, offset, length - offset, position + offset);
      if (bytes === 0) throw new BackupError("DECRYPT_FAILED");
      offset += bytes;
    }
  };
  try {
    checkIdentity();
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER) || before.size < BigInt(AES_IV_LENGTH + AES_TAG_LENGTH + 1)) {
      throw new BackupError("DECRYPT_FAILED");
    }
    const size = Number(before.size), end = size - AES_TAG_LENGTH;
    const iv = Buffer.alloc(AES_IV_LENGTH), tag = Buffer.alloc(AES_TAG_LENGTH);
    readExact(iv, iv.length, 0);
    readExact(tag, tag.length, end);
    const archive = createStreamingArchiveVerifier(members);
    let archiveError: unknown;
    const consume = (chunk: Buffer): void => {
      if (archiveError) return;
      try { archive.update(chunk); } catch (error) { archiveError = error; }
    };
    // Plaintext is provisional: only hashes/structure are accumulated, nothing is
    // returned, restored, or cached until both GCM authentication and parsing pass.
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(`${kind}|${contentHash}|${keyId}`, "utf8"));
      decipher.setAuthTag(tag);
      const buffer = Buffer.alloc(CHUNK_SIZE);
      for (let position = AES_IV_LENGTH; position < end;) {
        const length = Math.min(buffer.length, end - position);
        const bytes = readSync(fd, buffer, 0, length, position);
        if (bytes === 0) throw new BackupError("DECRYPT_FAILED");
        consume(decipher.update(buffer.subarray(0, bytes)));
        position += bytes;
      }
      consume(decipher.final());
    } catch (error) {
      throw error instanceof BackupError ? error : new BackupError("DECRYPT_FAILED");
    }
    if (archiveError) throw archiveError;
    archive.finish();
  } finally {
    // Recheck even on authentication/parser failure so a read-time replacement
    // keeps the existing identity-error priority. Always close the held inode.
    try { checkIdentity(); } finally { closeSync(fd); }
  }
}

function createStreamingArchiveVerifier(members: readonly SnapshotMember[]): {
  update(chunk: Buffer): void; finish(): void;
} {
  type Stage = "header" | "pathLength" | "path" | "dataLength" | "data" | "done";
  const expected = new Map(members.map(member => [member.relativePath, member]));
  const seen = new Set<string>();
  // Only archive metadata enters this buffer; dataLen never controls allocation.
  const field = Buffer.alloc(4096);
  let stage: Stage = "header", needed = 8, used = 0, count = 0, complete = 0;
  let path = "", remaining = 0, member: SnapshotMember | undefined;
  let hasher: ReturnType<typeof createHash> | undefined;
  const next = (value: Stage, length: number): void => { stage = value; needed = length; used = 0; };
  const finishMember = (): void => {
    if (!member || hasher!.digest("hex") !== member.sha256) throw new BackupError("PACKAGE_VERIFY_FAILED");
    hasher = undefined;
    complete += 1;
    next(complete === count ? "done" : "pathLength", 4);
  };
  return {
    update(chunk: Buffer): void {
      let offset = 0;
      while (offset < chunk.length) {
        if (stage === "done") throw new BackupError("ARCHIVE_INVALID");
        if (stage === "data") {
          const length = Math.min(remaining, chunk.length - offset);
          hasher!.update(chunk.subarray(offset, offset + length));
          remaining -= length; offset += length;
          if (remaining === 0) finishMember();
          continue;
        }
        const length = Math.min(needed - used, chunk.length - offset);
        chunk.copy(field, used, offset, offset + length);
        used += length; offset += length;
        if (used !== needed) continue;
        switch (stage) {
          case "header":
            if (!field.subarray(0, 4).equals(ARCHIVE_MAGIC)) throw new BackupError("ARCHIVE_INVALID");
            count = field.readUInt32LE(4);
            if (count !== members.length || expected.size !== members.length) throw new BackupError("PACKAGE_VERIFY_FAILED");
            next(count === 0 ? "done" : "pathLength", 4);
            break;
          case "pathLength": {
            const pathLength = field.readUInt32LE(0);
            if (pathLength < 1 || pathLength > field.length) throw new BackupError("ARCHIVE_INVALID");
            next("path", pathLength);
            break;
          }
          case "path":
            path = field.subarray(0, needed).toString("utf8");
            assertRelativeMemberPath(path);
            if (seen.has(path)) throw new BackupError("ARCHIVE_INVALID");
            seen.add(path);
            member = expected.get(path);
            if (!member) throw new BackupError("PACKAGE_VERIFY_FAILED");
            next("dataLength", 4);
            break;
          case "dataLength":
            remaining = field.readUInt32LE(0);
            if (remaining !== member!.bytes) throw new BackupError("PACKAGE_VERIFY_FAILED");
            hasher = createHash("sha256");
            next("data", 0);
            if (remaining === 0) finishMember();
            break;
        }
      }
    },
    finish(): void {
      if (stage !== "done" || complete !== count) throw new BackupError("ARCHIVE_INVALID");
      if (seen.size !== members.length) throw new BackupError("PACKAGE_VERIFY_FAILED");
    }
  };
}

function vacuumInto(sourcePath: string, destPath: string): void {
  if (existsSync(destPath)) throw new BackupError("VACUUM_TARGET_EXISTS");
  const database = new DatabaseSync(sourcePath);
  try {
    database.exec("PRAGMA busy_timeout=120000");
    database.exec(`VACUUM INTO ${sqlQuote(destPath)}`);
  } catch (error) {
    unlinkIfExists(destPath);
    if (error instanceof BackupError) throw error;
    throw new BackupError("VACUUM_FAILED");
  } finally {
    database.close();
  }
  if (!existsSync(destPath)) throw new BackupError("VACUUM_FAILED");
  chmodPrivateFile(destPath);
}

function readSchemaFingerprint(dbPath: string): { userVersion: number; sqliteMasterSha256: string } {
  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return {
      userVersion: readUserVersion(database),
      sqliteMasterSha256: sqliteMasterFingerprint(database)
    };
  } finally {
    database.close();
  }
}

function readUserVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get() as { user_version: number };
  const value = Number(row.user_version);
  if (!Number.isInteger(value) || value < 0) throw new BackupError("USER_VERSION_MISMATCH");
  return value;
}

function sqliteMasterFingerprint(database: DatabaseSync): string {
  const rows = database.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name"
  ).all() as SqliteMasterRow[];
  return sha256Text(rows.map((row) => `${row.type}\x1f${row.name}\x1f${row.tbl_name}\x1f${row.sql ?? ""}`).join("\n"));
}

function verifyProjectionPointer(projectionRoot: string): string {
  const activePath = join(projectionRoot, "active.json");
  const active = JSON.parse(readFileSync(activePath, "utf8")) as { snapshotManifestHash?: unknown };
  const hash = active.snapshotManifestHash;
  if (typeof hash !== "string" || !HASH_PATTERN.test(hash)) throw new BackupError("PROJECTION_POINTER_UNVERIFIED");
  const generationPath = assertInside(projectionRoot, "generations", `${hash}.json`);
  if (!existsSync(generationPath)) throw new BackupError("PROJECTION_POINTER_UNVERIFIED");
  return "1";
}

function listGenerationRelPaths(generationsRoot: string): string[] {
  if (!existsSync(generationsRoot)) throw new BackupError("PROJECTION_TREE_INCOMPLETE");
  const files: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name === "." || name === "..") continue;
      const absolute = join(dir, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new BackupError("PATH_ESCAPE");
      const nextRel = rel ? `${rel}/${name}` : name;
      if (stat.isDirectory()) walk(absolute, nextRel);
      else if (stat.isFile()) files.push(nextRel);
      else throw new BackupError("PROJECTION_ENTRY_INVALID");
    }
  };
  walk(generationsRoot, "");
  if (files.length === 0) throw new BackupError("PROJECTION_TREE_INCOMPLETE");
  return files.sort();
}

function assertProjectionRoot(path: string): string {
  const root = assertDirectory(path);
  if (!existsSync(join(root, "active.json")) || !existsSync(join(root, "generations"))) {
    throw new BackupError("PROJECTION_TREE_INCOMPLETE");
  }
  return root;
}

type StableFileIdentity = {
  dev: bigint; ino: bigint; uid: bigint; gid: bigint; mode: bigint; nlink: bigint;
  size: bigint; mtimeNs: bigint; ctimeNs: bigint; birthtimeNs: bigint;
};

type RunLock = { pid: number; fd: number; identity: StableFileIdentity; contentSha256: string };

type VerificationContext = {
  objects: Map<string, { identity: StableFileIdentity; binding: string }>;
  packages: Map<string, { identity: StableFileIdentity; sha256: string }>;
  counts: SnapshotVerificationCounts;
};

function createVerificationContext(): VerificationContext {
  return { objects: new Map(), packages: new Map(), counts: { objectsAuthenticated: 0, encryptedBytesAuthenticated: 0, cacheHits: 0 } };
}

function sameIdentity(left: StableFileIdentity, right: StableFileIdentity): boolean {
  return (Object.keys(left) as (keyof StableFileIdentity)[]).every((key) => left[key] === right[key]);
}

function regularIdentity(file: string, code: string): StableFileIdentity {
  const absolute = resolve(file);
  if (realpathSync(absolute) !== absolute) throw new BackupError(code);
  const s = lstatSync(absolute, { bigint: true });
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== BigInt(1)) throw new BackupError(code);
  return identityFromStat(s);
}

function identityFromStat(b: BigIntStats): StableFileIdentity {
  // Nanosecond change times prevent rounded-millisecond cache/lock collisions.
  return { dev: b.dev, ino: b.ino, uid: b.uid, gid: b.gid, mode: b.mode, nlink: b.nlink,
    size: b.size, mtimeNs: b.mtimeNs, ctimeNs: b.ctimeNs, birthtimeNs: b.birthtimeNs };
}

function readStableRegularFile(file: string, code: string): { bytes: Buffer; identity: StableFileIdentity } {
  const before = regularIdentity(file, code);
  const fd = openSync(file, fsConstants.O_RDONLY | noFollow());
  try {
    if (!sameIdentity(before, identityFromStat(fstatSync(fd, { bigint: true })))) throw new BackupError(code);
    const bytes = readFileSync(fd);
    if (!sameIdentity(before, identityFromStat(fstatSync(fd, { bigint: true }))) ||
        !sameIdentity(before, regularIdentity(file, code))) throw new BackupError(code);
    return { bytes, identity: before };
  } finally { closeSync(fd); }
}

function verifyEncryptedObjectOnce(
  objectPath: string, key: Buffer, kind: string, contentHash: string, keyId: string,
  members: readonly SnapshotMember[], context?: VerificationContext
): void {
  if (!context) { verifyEncryptedObject(objectPath, key, kind, contentHash, keyId, members); return; }
  const before = regularIdentity(objectPath, "OBJECT_IDENTITY_CHANGED");
  const binding = sha256Text(canonicalJson({ kind, contentHash, keyId, members }));
  const cached = context.objects.get(objectPath);
  if (cached) {
    if (cached.binding !== binding || !sameIdentity(cached.identity, before)) throw new BackupError("OBJECT_IDENTITY_CHANGED");
    context.counts.cacheHits += 1;
    return;
  }
  verifyEncryptedObject(objectPath, key, kind, contentHash, keyId, members);
  if (!sameIdentity(before, regularIdentity(objectPath, "OBJECT_IDENTITY_CHANGED"))) throw new BackupError("OBJECT_IDENTITY_CHANGED");
  context.objects.set(objectPath, { identity: before, binding });
  context.counts.objectsAuthenticated += 1;
  context.counts.encryptedBytesAuthenticated += Number(before.size);
}

function acquireRunLock(lockPath: string, now?: () => Date): RunLock {
  if (existsSync(lockPath)) classifyExistingLock(lockPath);
  const pid = process.pid;
  const body = `${canonicalJson({ pid, startedAt: utcNow(now) })}\n`;
  let fd: number;
  try { fd = writeExclusiveFileAndHold(lockPath, body); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") { classifyExistingLock(lockPath); throw new BackupError("LOCK_HELD"); }
    throw new BackupError("LOCK_INVALID");
  }
  try {
    const identity = identityFromStat(fstatSync(fd, { bigint: true }));
    if (!sameIdentity(identity, regularIdentity(lockPath, "LOCK_IDENTITY_CHANGED"))) throw new BackupError("LOCK_IDENTITY_CHANGED");
    // Hold the original descriptor through release: its inode cannot be recycled.
    return { pid, fd, identity, contentSha256: sha256Text(body) };
  } catch (error) { closeSync(fd); throw error; }
}

function classifyExistingLock(lockPath: string): never {
  let parsed: { pid?: unknown; startedAt?: unknown };
  try {
    parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown; startedAt?: unknown };
  } catch {
    throw new BackupError("LOCK_INVALID");
  }
  const pid = parsed.pid;
  if (!Number.isInteger(pid) || (pid as number) <= 0 || typeof parsed.startedAt !== "string") {
    throw new BackupError("LOCK_INVALID");
  }
  if (isPidAlive(pid as number)) throw new BackupError("LOCK_HELD");
  throw new BackupError("STALE_LOCK");
}

function releaseRunLock(lockPath: string, lock: RunLock): void {
  try {
    const held = identityFromStat(fstatSync(lock.fd, { bigint: true }));
    const current = readStableRegularFile(lockPath, "LOCK_IDENTITY_CHANGED");
    // A metadata-only ctime change over a long hold is permitted only for locks:
    // the original fd still pins the inode, and the complete lock body is rehashed.
    // All current fd/path checks, and every object-cache comparison, include ctime.
    const originalStillHeld = (Object.keys(lock.identity) as (keyof StableFileIdentity)[])
      .every((key) => key === "ctimeNs" || lock.identity[key] === held[key]);
    if (!originalStillHeld || !sameIdentity(held, current.identity) || sha256Bytes(current.bytes) !== lock.contentSha256 ||
        !sameIdentity(held, regularIdentity(lockPath, "LOCK_IDENTITY_CHANGED"))) {
      throw new BackupError("LOCK_IDENTITY_CHANGED", false, "RELEASE_LOCK");
    }
    unlinkSync(lockPath);
  } catch {
    // External termination/replacement stays fail-closed for exact dead-PID/CAS recovery.
    throw new BackupError("LOCK_IDENTITY_CHANGED", false, "RELEASE_LOCK");
  } finally { closeSync(lock.fd); }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

function projectionBytes(root: string): number {
  const generations = join(root, "generations");
  const files = listGenerationRelPaths(generations).map((path) => join(generations, ...path.split("/")));
  files.push(join(root, "active.json"));
  for (const name of readdirSync(root)) if (name.startsWith("bilingual-generation-") || name === "bilingual-active.json") files.push(join(root, name));
  return files.reduce((total, path) => total + statSync(assertRegularFile(path)).size, 0);
}

function assertDiskSpace(dir: string, dbBytes: number, projectedBytes: number): void {
  try {
    const stat = statfsSync(dir);
    const free = Number(stat.bavail) * Number(stat.bsize);
    // Vacuum + plaintext archive + ciphertext, including all projection members and 1 GiB headroom.
    if (!Number.isFinite(free) || free < dbBytes * 3 + projectedBytes * 2 + 1024 ** 3) throw new BackupError("DISK_SPACE_INSUFFICIENT");
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError("DISK_SPACE_UNAVAILABLE");
  }
}

function utcNow(now?: () => Date): string {
  return (now ? now() : new Date()).toISOString();
}

function sqlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function listPackageIds(packagesDir: string): string[] {
  return readdirSync(packagesDir)
    .filter((name) => {
      const stat = lstatSync(join(packagesDir, name));
      return stat.isDirectory() && !stat.isSymbolicLink();
    })
    .sort();
}

function assertRelativeMemberPath(relativePath: string): void {
  if (
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    relativePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new BackupError("PATH_ESCAPE");
  }
}

function assertInside(root: string, ...parts: string[]): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...parts);
  const rel = relative(resolvedRoot, target);
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) throw new BackupError("PATH_ESCAPE");
  return target;
}

function assertRegularFile(path: string): string {
  const absolute = resolve(path);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new BackupError("PATH_ESCAPE");
  return absolute;
}

function assertRegularPrivateFile(path: string): string {
  const absolute = assertRegularFile(path);
  const stat = lstatSync(absolute);
  if ((stat.mode & 0o077) !== 0) throw new BackupError("KEY_FILE_INVALID");
  return absolute;
}

function assertDirectory(path: string): string {
  const absolute = resolve(path);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new BackupError("PATH_ESCAPE");
  return realpathSync(absolute);
}

function ensurePrivateDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: STAGING_MODE });
  chmodPrivateDir(path);
}

function chmodPrivateDir(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new BackupError("PATH_ESCAPE");
  chmodSync(path, STAGING_MODE);
}

function chmodPrivateFile(path: string): void {
  chmodSync(path, FILE_MODE);
}

function replaceFile(path: string, body: string): void {
  const temporary = `${path}.stage-${randomUUID()}`;
  writeExclusiveFile(temporary, body);
  renameSync(temporary, path);
  chmodPrivateFile(path);
  fsyncDirectory(dirname(path));
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function openExclusive(path: string): number {
  try {
    return openSync(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow(), FILE_MODE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new BackupError("OBJECT_EXISTS");
    throw new BackupError("WRITE_FAILED");
  }
}

function writeExclusiveFile(path: string, body: string | Buffer): void {
  closeSync(writeExclusiveFileAndHold(path, body));
}

function writeExclusiveFileAndHold(path: string, body: string | Buffer): number {
  const data = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  const parent = dirname(path), directory = lstatSync(parent);
  if (realpathSync(parent) !== parent || !directory.isDirectory() || directory.isSymbolicLink()
    || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) throw new BackupError("WRITE_DIRECTORY_UNSAFE");
  const boundary = () => {
    const current = lstatSync(parent);
    if (realpathSync(parent) !== parent || current.dev !== directory.dev || current.ino !== directory.ino
      || current.uid !== directory.uid || current.mode !== directory.mode) throw new BackupError("WRITE_DIRECTORY_CHANGED");
  };
  const fd = openExclusive(path);
  try {
    const opened = fstatSync(fd), named = lstatSync(path);
    boundary();
    if (!opened.isFile() || opened.uid !== process.getuid?.() || opened.nlink !== 1 || opened.size !== 0 || (opened.mode & 0o077) !== 0
      || named.isSymbolicLink() || named.dev !== opened.dev || named.ino !== opened.ino || named.nlink !== 1) throw new BackupError("WRITE_FILE_CHANGED");
    writeFully(fd, data);
    fsyncSync(fd);
    const finished = fstatSync(fd), current = lstatSync(path); boundary();
    if (finished.dev !== opened.dev || finished.ino !== opened.ino || finished.nlink !== 1 || finished.size !== data.length
      || current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino) throw new BackupError("WRITE_FILE_CHANGED");
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function writeFully(fd: number, data: Buffer): void {
  let offset = 0;
  while (offset < data.byteLength) {
    const written = writeSync(fd, data, offset, data.byteLength - offset);
    if (written <= 0) throw new BackupError("WRITE_FAILED");
    offset += written;
  }
}

function writeU32(fd: number, value: number): void {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  writeFully(fd, buffer);
}

function noFollow(): number {
  return fsConstants.O_NOFOLLOW ?? 0;
}

function unlinkIfExists(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}
