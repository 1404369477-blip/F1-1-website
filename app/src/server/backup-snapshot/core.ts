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

export const SNAPSHOT_KIND = "db-projection-snapshot" as const;
export const MANIFEST_SCHEMA_VERSION = "backup-snapshot-manifest-v1" as const;
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
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  kind: typeof SNAPSHOT_KIND;
  keyId: string;
  recovery_point_at: string;
  contentHash: string;
  userVersion: number;
  sqliteMasterSha256: string;
  members: readonly SnapshotMember[];
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
};

export type SnapshotInput = {
  sourceDbPath: string;
  projectionRoot: string;
  outputDir: string;
  key: Buffer;
  retain: number;
  now?: () => Date;
  testOnlyAfterObjectWrite?: (objectPath: string) => void;
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

  constructor(code: string, retentionSkipped = false) {
    super(code);
    this.name = "BackupError";
    this.code = code;
    this.retentionSkipped = retentionSkipped;
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
  const lock = acquireRunLock(layout.lockPath, input.now);
  let stagingRoot: string | null = null;
  try {
    stagingRoot = join(layout.stagingDir, randomUUID());
    ensurePrivateDir(layout.stagingDir);
    ensurePrivateDir(stagingRoot);
    const sourceDbPath = assertRegularFile(input.sourceDbPath);
    const projectionRoot = assertProjectionRoot(input.projectionRoot);
    assertDiskSpace(layout.root, statSync(sourceDbPath).size);
    const recoveryPointAt = utcNow(input.now);
    const vacuumPath = join(stagingRoot, `vacuum-${randomUUID()}.sqlite`);
    if (existsSync(vacuumPath)) throw new BackupError("VACUUM_TARGET_EXISTS");
    vacuumInto(sourceDbPath, vacuumPath);
    const fingerprint = readSchemaFingerprint(vacuumPath);
    const sourceFingerprint = readSchemaFingerprint(sourceDbPath);
    if (
      fingerprint.userVersion !== sourceFingerprint.userVersion ||
      fingerprint.sqliteMasterSha256 !== sourceFingerprint.sqliteMasterSha256
    ) {
      throw new BackupError("SCHEMA_FINGERPRINT_MISMATCH");
    }
    const members = collectMembers(vacuumPath, projectionRoot);
    const contentHash = sha256Text(canonicalJson(members));
    const archivePath = join(stagingRoot, "archive.bin");
    writeArchive(archivePath, members, vacuumPath, projectionRoot);
    const objectPath = assertInside(layout.objectsDir, objectFileName(SNAPSHOT_KIND, contentHash, keyId));
    let deduped = false;
    if (existsSync(objectPath)) {
      verifyEncryptedObject(objectPath, input.key, SNAPSHOT_KIND, contentHash, keyId, members);
      deduped = true;
    } else {
      encryptFileToObject(archivePath, objectPath, input.key, SNAPSHOT_KIND, contentHash, keyId);
      if (input.testOnlyAfterObjectWrite) input.testOnlyAfterObjectWrite(objectPath);
      try {
        verifyEncryptedObject(objectPath, input.key, SNAPSHOT_KIND, contentHash, keyId, members);
      } catch (error) {
        throw wrapRetentionFailure(error);
      }
    }
    unlinkIfExists(vacuumPath);
    unlinkIfExists(archivePath);
    const manifest: SnapshotManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      kind: SNAPSHOT_KIND,
      keyId,
      recovery_point_at: recoveryPointAt,
      contentHash,
      userVersion: fingerprint.userVersion,
      sqliteMasterSha256: fingerprint.sqliteMasterSha256,
      members
    };
    const packageId = packageIdFor(recoveryPointAt, contentHash);
    const packageDir = assertInside(layout.packagesDir, packageId);
    if (existsSync(packageDir)) throw new BackupError("PACKAGE_EXISTS");
    mkdirSync(packageDir, { mode: STAGING_MODE });
    chmodPrivateDir(packageDir);
    writeExclusiveFile(join(packageDir, "manifest.json"), `${canonicalJson(manifest)}\n`);
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
    const retainedCount = rotateValidatedPackages(layout, input.key, input.retain);
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
      userVersion: fingerprint.userVersion,
      sqliteMasterSha256: fingerprint.sqliteMasterSha256,
      elapsedMs: Date.now() - started
    };
  } finally {
    if (stagingRoot && existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
    releaseRunLock(layout.lockPath, lock.pid);
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
  if (!input.verifyOnly) {
    if (existsSync(restoreRoot) && readdirSync(restoreRoot).length > 0) throw new BackupError("RESTORE_ROOT_NOT_EMPTY");
    ensurePrivateDir(restoreRoot);
    const objectPath = assertInside(layout.objectsDir, objectFileName(manifest.kind, manifest.contentHash, manifest.keyId));
    const archive = decryptObject(objectPath, input.key, manifest.kind, manifest.contentHash, manifest.keyId);
    const extracted = parseArchive(archive);
    assertMembersMatch(extracted, manifest.members);
    landMembers(restoreRoot, extracted);
  } else if (!existsSync(restoreRoot)) {
    throw new BackupError("RESTORE_ROOT_MISSING");
  }
  const checks = verifyRestoredTree(restoreRoot, manifest, input.expectedUserVersion);
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
    checks
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
    const pointer = verifyProjectionPointer(projectionRoot);
    return {
      quick_check: "ok",
      foreign_key_check: "ok",
      user_version: String(version),
      sqlite_master_sha256: master,
      drill_public_pointer_verified: pointer
    };
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
  retain: number
): number {
  const packageIds = listPackageIds(layout.packagesDir);
  const validated: ValidatedPackage[] = [];
  for (const packageId of packageIds) {
    try {
      validated.push(validatePackage(layout, packageId, key));
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
  key: Buffer
): ValidatedPackage {
  const keyId = keyIdFromKey(key);
  const manifest = readManifestForPackage(layout, packageId);
  assertManifestBinding(packageId, manifest, keyId);
  const objectPath = assertInside(layout.objectsDir, objectFileName(manifest.kind, manifest.contentHash, manifest.keyId));
  verifyEncryptedObject(objectPath, key, manifest.kind, manifest.contentHash, manifest.keyId, manifest.members);
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
  if (record.schemaVersion !== MANIFEST_SCHEMA_VERSION) throw new BackupError("MANIFEST_INVALID");
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
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kind: SNAPSHOT_KIND,
    keyId: record.keyId,
    recovery_point_at: record.recovery_point_at,
    contentHash: record.contentHash,
    userVersion: record.userVersion as number,
    sqliteMasterSha256: record.sqliteMasterSha256,
    members
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

function collectMembers(vacuumPath: string, projectionRoot: string): SnapshotMember[] {
  const members: SnapshotMember[] = [fileMember("db/snapshot.sqlite", vacuumPath)];
  const generationsRoot = join(projectionRoot, "generations");
  for (const relativePath of listGenerationRelPaths(generationsRoot)) {
    members.push(fileMember(`projection/generations/${relativePath}`, join(generationsRoot, ...relativePath.split("/"))));
  }
  members.push(fileMember("projection/active.json", join(projectionRoot, "active.json")));
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
  projectionRoot: string
): void {
  const fd = openExclusive(archivePath);
  try {
    writeFully(fd, ARCHIVE_MAGIC);
    writeU32(fd, members.length);
    for (const member of members) {
      const absolute = memberAbsolute(member.relativePath, vacuumPath, projectionRoot);
      const pathBytes = Buffer.from(member.relativePath, "utf8");
      const data = readFileSync(absolute);
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
  if (archive.subarray(0, 4).compare(ARCHIVE_MAGIC) !== 0) throw new BackupError("ARCHIVE_INVALID");
  offset += 4;
  const count = archive.readUInt32LE(offset);
  offset += 4;
  const extracted = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    const pathLen = archive.readUInt32LE(offset);
    offset += 4;
    const relativePath = archive.subarray(offset, offset + pathLen).toString("utf8");
    offset += pathLen;
    const dataLen = archive.readUInt32LE(offset);
    offset += 4;
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
  assertRegularFile(objectPath);
  const blob = readFileSync(objectPath);
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
  const archive = decryptObject(objectPath, key, kind, contentHash, keyId);
  assertMembersMatch(parseArchive(archive), members);
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

function acquireRunLock(lockPath: string, now?: () => Date): { pid: number } {
  if (existsSync(lockPath)) classifyExistingLock(lockPath);
  const pid = process.pid;
  const body = `${canonicalJson({ pid, startedAt: utcNow(now) })}\n`;
  try {
    writeExclusiveFile(lockPath, body);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      classifyExistingLock(lockPath);
      throw new BackupError("LOCK_HELD");
    }
    throw new BackupError("LOCK_INVALID");
  }
  return { pid };
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

function releaseRunLock(lockPath: string, pid: number): void {
  if (!existsSync(lockPath)) return;
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
    if (parsed.pid === pid) unlinkSync(lockPath);
  } catch {
    // Leave the lock for the next run to classify as stale or held.
  }
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

function assertDiskSpace(dir: string, dbBytes: number): void {
  try {
    const stat = statfsSync(dir);
    const free = Number(stat.bavail) * Number(stat.bsize);
    if (Number.isFinite(free) && free < dbBytes * 3) throw new BackupError("DISK_SPACE_INSUFFICIENT");
  } catch (error) {
    if (error instanceof BackupError) throw error;
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
  const data = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  const fd = openExclusive(path);
  try {
    writeFully(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodPrivateFile(path);
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
