import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fdatasyncSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError, loadAppConfig, type AppConfig, type EnvRecord } from "../config/env.ts";
import { SOURCE_BRIDGE_SHA256, SOURCE_PROJECTION_SHA256 } from "../providers/source-fixture.ts";
import {
  assertMigrationState,
  closeDatabase,
  migrateDatabase,
  openSafeDatabase,
  readDatabaseSchemaFingerprint,
  type SqliteDatabase
} from "./database.ts";
import {
  M3_PROFILE_COUNTS,
  M3_PROFILE_ID,
  M3_SQLITE_PATH,
  PUBLIC_PROFILE_COUNTS,
  PUBLIC_PROFILE_ID,
  PUBLIC_SQLITE_PATH,
  assertSingleDatabase,
  canonicalJson
} from "./profile.ts";
import {
  PUBLIC_FIXTURE_SHA256,
  PUBLIC_GRAPH_SHA256,
  PUBLIC_ROOT_HASHES,
  assertPublicSyntheticSeeded
} from "./public-synthetic.ts";
import { assertSourceFixtureSeeded, seedSourceFixture } from "./source.ts";

export type ClosedProfileId = typeof M3_PROFILE_ID | typeof PUBLIC_PROFILE_ID;

type JsonScalar = null | boolean | number | string;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

type ClosedReceiptCore = {
  schemaVersion: "f1plus1-profile-closed-receipt-v1";
  profileId: ClosedProfileId;
  dbRelativePath: string;
  closedDbSha256: string;
  schemaFingerprintSha256: string;
  migrationLedgerRootSha256: string;
  profileLedgerRootSha256: string;
  storedProfileLedgerSha256: string;
  logicalContentRootSha256: string;
  rowCounts: Readonly<Record<string, number>>;
  fixtureManifestSha256: string;
  fixtureGraphSha256: string;
  artifactRevision: string;
  validatorArtifactSha256: string;
  checkpoint: { busy: 0; log: 0; checkpointed: 0 };
  walPresent: false;
  shmPresent: false;
  externalCalls: 0;
  validatedAt: string;
};

export type ClosedProfileReceipt = ClosedReceiptCore & { receiptSha256: string };

type PublicDataReceiptCore = {
  schemaVersion: "f1plus1-public-data-closed-receipt-v1";
  profileId: typeof PUBLIC_PROFILE_ID;
  artifactRoot: "data/mvp-contract-v0.4-public-synthetic";
  artifactRevision: string;
  manifestSha256: string;
  fixtureSha256: string;
  graphSha256: string;
  profileLedgerSha256: string;
  generatorSha256: string;
  validatorSha256: string;
  receiptValidatorArtifactSha256: string;
  externalCalls: 0;
  validatedAt: string;
};

export type PublicDataReceipt = PublicDataReceiptCore & { receiptSha256: string };

export type ClosedReceiptResult = {
  profileId: ClosedProfileId;
  dbReceipt: ClosedProfileReceipt;
  dataReceipt?: PublicDataReceipt;
  restoredM3: boolean;
};

export type ClosedReceiptOptions = {
  appRoot: string;
  projectRoot: string;
  now?: () => Date;
};

const RECEIPT_DIRECTORY = "app/.local/receipts";
const M3_RECEIPT_PATH = `${RECEIPT_DIRECTORY}/m3-shadow.closed.json`;
const PUBLIC_RECEIPT_PATH = `${RECEIPT_DIRECTORY}/public-synthetic.closed.json`;
const PUBLIC_DATA_RECEIPT_PATH = `${RECEIPT_DIRECTORY}/public-synthetic.data.closed.json`;
const M3_ARTIFACT_REVISION = "m4-vs0-seed-enrichment-manifest-v0.3";
const PUBLIC_ARTIFACT_REVISION = "public-demo-12-v0.4-manifest-v2";
const EXPECTED_SCHEMA_FINGERPRINT = "ad2f86e03d9aa8727fe7555729e65a18e4c3986a572ca88cb52cc96245afd23b";
const RECEIPT_PATH_ALLOWLIST = new Set([M3_RECEIPT_PATH, PUBLIC_RECEIPT_PATH, PUBLIC_DATA_RECEIPT_PATH]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LOGICAL_TABLES = [
  "fixture_seed_ledger",
  "source_config_fixture",
  "source_seed_ledger",
  "fixture_profile_ledger",
  "public_captured_item",
  "public_content",
  "public_summary",
  "public_media_candidate",
  "public_release_bundle",
  "public_review_decision",
  "public_publication",
  "published_projection"
] as const;

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function assertCurrentOwner(uid: number, label: string): void {
  const currentUid = process.getuid?.();
  if (currentUid === undefined || uid !== currentUid) {
    throw new ConfigError("RECEIPT_OWNER", `${label} must be owned by the current local user`);
  }
}

function assertPrivateDirectory(path: string, label: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new ConfigError("RECEIPT_PATH", `${label} must be a real private directory`);
  }
  assertCurrentOwner(stat.uid, label);
}

function assertPrivateFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) {
    throw new ConfigError("RECEIPT_PATH", `${label} must be a private regular single-link file`);
  }
  assertCurrentOwner(stat.uid, label);
}

function assertRelativePath(path: string): void {
  if (
    !RECEIPT_PATH_ALLOWLIST.has(path) ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new ConfigError("RECEIPT_PATH", "receipt path is not the fixed project-relative path");
  }
}

function assertNoAbsoluteStrings(value: unknown): void {
  if (typeof value === "string") {
    if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
      throw new ConfigError("RECEIPT_PATH", "receipt contains an absolute path");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertNoAbsoluteStrings);
    return;
  }
  if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(assertNoAbsoluteStrings);
}

function normalizeSqlValue(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ConfigError("RECEIPT_ROOT", "database contains a non-finite number");
    return value;
  }
  if (typeof value === "bigint") return { type: "bigint", value: value.toString() };
  if (value instanceof Uint8Array) return { type: "bytes", value: Buffer.from(value).toString("hex") };
  throw new ConfigError("RECEIPT_ROOT", "database contains an unsupported SQLite value");
}

function normalizeRow(row: Record<string, unknown>, columns: readonly string[]): Record<string, JsonValue> {
  return Object.fromEntries(columns.map((column) => [column, normalizeSqlValue(row[column])])) as Record<string, JsonValue>;
}

function readTableRows(database: SqliteDatabase, table: string): { columns: string[]; rows: Record<string, JsonValue>[] } {
  const columns = (database.prepare(
    'SELECT name FROM pragma_table_xinfo(?) WHERE hidden = 0 ORDER BY cid'
  ).all(table) as Array<Record<string, unknown>>).map((row) => String(row.name));
  if (columns.length === 0) throw new ConfigError("RECEIPT_ROOT", `expected table ${table} is missing`);
  const quoted = columns.map((column) => `"${column.replaceAll('"', '""')}"`).join(", ");
  const rows = (database.prepare(`SELECT ${quoted} FROM "${table}"`).all() as Array<Record<string, unknown>>)
    .map((row) => normalizeRow(row, columns))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return { columns, rows };
}

function tableCount(database: SqliteDatabase, table: string): number {
  return Number((database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as Record<string, unknown>).count);
}

function readLogicalContentRoot(database: SqliteDatabase): string {
  const tables = LOGICAL_TABLES.map((table) => ({ table, ...readTableRows(database, table) }));
  return sha256(canonicalJson({ tables }));
}

function readMigrationLedgerRoot(database: SqliteDatabase): string {
  const ledger = readTableRows(database, "migration_ledger");
  return sha256(canonicalJson(ledger));
}

function readProfileLedgerRoots(database: SqliteDatabase, profileId: ClosedProfileId): {
  profileLedgerRootSha256: string;
  storedProfileLedgerSha256: string;
} {
  const ledger = readTableRows(database, "fixture_profile_ledger");
  if (ledger.rows.length !== 1) throw new ConfigError("PROFILE_LEDGER_DRIFT", "profile ledger must contain exactly one row");
  const storedProfileLedgerSha256 = sha256(canonicalJson(ledger));
  const row = ledger.rows[0];
  const acceptedRoot = row.profile_ledger_root_sha256;
  if (profileId === PUBLIC_PROFILE_ID) {
    if (acceptedRoot !== PUBLIC_ROOT_HASHES.ledger) {
      throw new ConfigError("PROFILE_LEDGER_DRIFT", "public profile ledger root does not match the frozen root");
    }
    return { profileLedgerRootSha256: PUBLIC_ROOT_HASHES.ledger, storedProfileLedgerSha256 };
  }
  if (acceptedRoot !== null) {
    throw new ConfigError("PROFILE_LEDGER_DRIFT", "M3 profile ledger must retain its accepted null external root");
  }
  return { profileLedgerRootSha256: storedProfileLedgerSha256, storedProfileLedgerSha256 };
}

function expectedCounts(profileId: ClosedProfileId): Readonly<Record<string, number>> {
  return profileId === M3_PROFILE_ID ? M3_PROFILE_COUNTS : PUBLIC_PROFILE_COUNTS;
}

function readCounts(database: SqliteDatabase, profileId: ClosedProfileId): Readonly<Record<string, number>> {
  const counts = {
    sources: tableCount(database, "source_config_fixture"),
    captured_items: tableCount(database, "public_captured_item"),
    contents: tableCount(database, "public_content"),
    summaries: tableCount(database, "public_summary"),
    media_candidates: tableCount(database, "public_media_candidate"),
    release_bundles: tableCount(database, "public_release_bundle"),
    review_decisions: tableCount(database, "public_review_decision"),
    publications: tableCount(database, "public_publication"),
    published_projections: tableCount(database, "published_projection")
  };
  if (canonicalJson(counts) !== canonicalJson(expectedCounts(profileId))) {
    throw new ConfigError("RECEIPT_COUNTS", `${profileId} row counts do not match the accepted profile`);
  }
  return counts;
}

function profileEnv(profileId: ClosedProfileId): EnvRecord {
  const publicProfile = profileId === PUBLIC_PROFILE_ID;
  return {
    APP_ENV: "test",
    APP_PORT: "3010",
    APP_BIND_HOST: "127.0.0.1",
    APP_PUBLIC_ORIGIN: "http://127.0.0.1:3010",
    F1_DATA_PROFILE: profileId,
    F1_DB_PATH: publicProfile ? PUBLIC_SQLITE_PATH : M3_SQLITE_PATH,
    SOURCE_CONFIG_PROVIDER: "fixture",
    SOURCE_FIXTURE_PATH: publicProfile
      ? "../data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json"
      : "../data/m3-base-shadow-import-v0/main-source-record-batch.json",
    ADAPTER_MODE: "mock",
    SUMMARY_MODE: "fixture",
    MEDIA_MODE: "fixture",
    PUBLISH_MODE: "manual_only",
    REAL_FEISHU_IO: "false",
    REAL_EXTERNAL_IO: "false",
    REAL_FORM_SUBMIT: "false",
    ADMIN_ACCESS_MODE: "local_dev_only",
    LOG_LEVEL: "info"
  };
}

function profileConfig(profileId: ClosedProfileId, options: ClosedReceiptOptions): AppConfig {
  return loadAppConfig(profileEnv(profileId), {
    appRoot: options.appRoot,
    projectRoot: options.projectRoot,
    strictKeys: true
  });
}

function profileReceiptPath(profileId: ClosedProfileId): string {
  return profileId === M3_PROFILE_ID ? M3_RECEIPT_PATH : PUBLIC_RECEIPT_PATH;
}

function profileDbRelativePath(profileId: ClosedProfileId): string {
  return `app/${profileId === M3_PROFILE_ID ? M3_SQLITE_PATH : PUBLIC_SQLITE_PATH}`;
}

function artifactRevision(profileId: ClosedProfileId): string {
  return profileId === M3_PROFILE_ID ? M3_ARTIFACT_REVISION : PUBLIC_ARTIFACT_REVISION;
}

function artifactPins(profileId: ClosedProfileId): { fixtureManifestSha256: string; fixtureGraphSha256: string } {
  return profileId === M3_PROFILE_ID
    ? { fixtureManifestSha256: SOURCE_BRIDGE_SHA256, fixtureGraphSha256: SOURCE_PROJECTION_SHA256 }
    : { fixtureManifestSha256: PUBLIC_ROOT_HASHES.manifest, fixtureGraphSha256: PUBLIC_GRAPH_SHA256 };
}

function readValidatorArtifactSha256(): string {
  const modulePath = fileURLToPath(import.meta.url);
  const projectRoot = resolve(dirname(modulePath), "../../../..");
  const scriptPath = resolve(projectRoot, "app/scripts/profile-closed-receipt.ts");
  const expectedModulePath = resolve(projectRoot, "app/src/server/db/closed-receipt.ts");
  if (modulePath !== expectedModulePath) {
    throw new ConfigError("RECEIPT_VALIDATOR", "validator module is outside its canonical project path");
  }
  const artifacts = [modulePath, scriptPath].map((path) => ({
    path: relative(projectRoot, path).replaceAll(sep, "/"),
    sha256: secureArtifactSha256(path, projectRoot)
  }));
  return sha256(canonicalJson(artifacts));
}

function assertNoSymlinkComponents(path: string, root: string): void {
  if (!isInside(root, path)) throw new ConfigError("RECEIPT_VALIDATOR", "validator artifact escaped the project root");
  let current = root;
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new ConfigError("RECEIPT_VALIDATOR", "project root is not a real directory");
  }
  assertCurrentOwner(rootStat.uid, "project root");
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new ConfigError("RECEIPT_VALIDATOR", "validator artifact path contains a symlink");
    assertCurrentOwner(stat.uid, "validator artifact path");
    if ((stat.mode & 0o022) !== 0) {
      throw new ConfigError("RECEIPT_VALIDATOR", "validator artifact path is group/world writable");
    }
  }
}

export function secureArtifactSha256(path: string, projectRoot: string): string {
  assertNoSymlinkComponents(path, projectRoot);
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.mode & 0o022) !== 0) {
    throw new ConfigError("RECEIPT_VALIDATOR", "validator artifact is not a stable regular file");
  }
  const noFollow = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
  if (typeof noFollow !== "number") throw new ConfigError("RECEIPT_VALIDATOR", "O_NOFOLLOW is unavailable");
  const descriptor = openSync(path, fsConstants.O_RDONLY | noFollow);
  try {
    const descriptorBefore = fstatSync(descriptor);
    const bytes = readFileSync(descriptor);
    const descriptorAfter = fstatSync(descriptor);
    const pathAfter = lstatSync(path);
    if (
      descriptorBefore.dev !== descriptorAfter.dev || descriptorBefore.ino !== descriptorAfter.ino ||
      descriptorBefore.size !== descriptorAfter.size || descriptorBefore.mtimeMs !== descriptorAfter.mtimeMs ||
      descriptorAfter.dev !== pathAfter.dev || descriptorAfter.ino !== pathAfter.ino || pathAfter.isSymbolicLink() ||
      pathAfter.nlink !== 1 || (pathAfter.mode & 0o022) !== 0
    ) {
      throw new ConfigError("RECEIPT_VALIDATOR", "validator artifact changed during secure hashing");
    }
    return sha256(bytes);
  } finally {
    closeSync(descriptor);
  }
}

function assertCanonicalTimestamp(value: string): void {
  if (!TIMESTAMP_PATTERN.test(value) || new Date(value).toISOString() !== value) {
    throw new ConfigError("RECEIPT_TIME", "validatedAt must be a canonical RFC3339 UTC timestamp");
  }
}

function withReceiptHash<T extends Record<string, unknown>>(core: T): T & { receiptSha256: string } {
  assertNoAbsoluteStrings(core);
  return { ...core, receiptSha256: sha256(canonicalJson(core)) };
}

function readJsonRecord(path: string): Record<string, unknown> {
  assertPrivateFile(path, "receipt");
  const bytes = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    throw new ConfigError("RECEIPT_TAMPER", "existing receipt is not canonical JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError("RECEIPT_TAMPER", "existing receipt is not an object");
  }
  const record = parsed as Record<string, unknown>;
  if (bytes !== `${canonicalJson(record)}\n`) {
    throw new ConfigError("RECEIPT_TAMPER", "existing receipt bytes are not the unique canonical encoding");
  }
  return record;
}

function verifyReceiptEnvelope(path: string, expectedSchema: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  const receipt = readJsonRecord(path);
  const { receiptSha256, ...core } = receipt;
  if (
    receipt.schemaVersion !== expectedSchema ||
    typeof receiptSha256 !== "string" ||
    !SHA256_PATTERN.test(receiptSha256) ||
    sha256(canonicalJson(core)) !== receiptSha256
  ) {
    throw new ConfigError("RECEIPT_TAMPER", "existing receipt hash or schema is invalid");
  }
  assertNoAbsoluteStrings(receipt);
  if (typeof receipt.validatedAt !== "string") throw new ConfigError("RECEIPT_TAMPER", "receipt validatedAt is missing");
  assertCanonicalTimestamp(receipt.validatedAt);
  return receipt;
}

function withoutVolatile(receipt: Record<string, unknown>): Record<string, unknown> {
  const { validatedAt: _validatedAt, receiptSha256: _receiptSha256, ...stable } = receipt;
  return stable;
}

function assertExistingReceiptMatches(existing: Record<string, unknown> | undefined, next: Record<string, unknown>): void {
  if (!existing) return;
  if (canonicalJson(withoutVolatile(existing)) !== canonicalJson(withoutVolatile(next))) {
    throw new ConfigError("RECEIPT_OLD_BYTE_DRIFT", "existing closed receipt no longer matches the validated profile");
  }
}

function ensureReceiptDirectory(projectRoot: string): string {
  const appLocal = resolve(projectRoot, "app/.local");
  const receiptDirectory = resolve(projectRoot, RECEIPT_DIRECTORY);
  if (!isInside(appLocal, receiptDirectory) || dirname(receiptDirectory) !== appLocal) {
    throw new ConfigError("RECEIPT_PATH", "receipt directory escaped app/.local");
  }
  assertPrivateDirectory(appLocal, "app local directory");
  if (!existsSync(receiptDirectory)) mkdirSync(receiptDirectory, { mode: 0o700 });
  const before = lstatSync(receiptDirectory);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new ConfigError("RECEIPT_PATH", "receipt directory must be a real directory");
  }
  assertCurrentOwner(before.uid, "receipt directory");
  chmodSync(receiptDirectory, 0o700);
  assertPrivateDirectory(receiptDirectory, "receipt directory");
  return receiptDirectory;
}

function directoryIdentity(path: string): { dev: number; ino: number } {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ConfigError("RECEIPT_PATH", "receipt directory identity is unsafe");
  }
  assertCurrentOwner(stat.uid, "receipt directory");
  return { dev: stat.dev, ino: stat.ino };
}

function prepareLocalRoot(appRoot: string): void {
  const localRoot = resolve(appRoot, ".local");
  if (!existsSync(localRoot)) mkdirSync(localRoot, { mode: 0o700 });
  const stat = lstatSync(localRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ConfigError("RECEIPT_PATH", "app local directory must be a real directory");
  }
  assertCurrentOwner(stat.uid, "app local directory");
  chmodSync(localRoot, 0o700);
  assertPrivateDirectory(localRoot, "app local directory");
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function atomicWriteReceipt(projectRoot: string, relativePath: string, receipt: Record<string, unknown>): void {
  assertRelativePath(relativePath);
  const directory = ensureReceiptDirectory(projectRoot);
  const localDirectory = dirname(directory);
  const localBefore = directoryIdentity(localDirectory);
  const directoryBefore = directoryIdentity(directory);
  const target = resolve(projectRoot, relativePath);
  if (dirname(target) !== directory) throw new ConfigError("RECEIPT_PATH", "receipt target escaped the receipt directory");
  const temp = join(directory, `.${basename(target)}.${randomBytes(8).toString("hex")}.tmp`);
  const noFollow = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
  if (typeof noFollow !== "number") throw new ConfigError("RECEIPT_PATH", "O_NOFOLLOW is unavailable");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow, 0o600);
    writeFileSync(descriptor, `${canonicalJson(receipt)}\n`, "utf8");
    fdatasyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (existsSync(target)) assertPrivateFile(target, "existing receipt");
    renameSync(temp, target);
    chmodSync(target, 0o600);
    assertPrivateFile(target, "receipt");
    const directoryAfter = directoryIdentity(directory);
    const localAfter = directoryIdentity(localDirectory);
    if (
      directoryBefore.dev !== directoryAfter.dev || directoryBefore.ino !== directoryAfter.ino ||
      localBefore.dev !== localAfter.dev || localBefore.ino !== localAfter.ino
    ) {
      throw new ConfigError("RECEIPT_PATH", "receipt directory changed during atomic write");
    }
    syncDirectory(directory);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function secureFileSha256(path: string, label: string): string {
  assertPrivateFile(path, label);
  const noFollow = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
  if (typeof noFollow !== "number") throw new ConfigError("RECEIPT_PATH", "O_NOFOLLOW is unavailable");
  const descriptor = openSync(path, fsConstants.O_RDONLY | noFollow);
  try {
    const before = fstatSync(descriptor);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const pathAfter = lstatSync(path);
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      after.dev !== pathAfter.dev || after.ino !== pathAfter.ino || pathAfter.isSymbolicLink() || pathAfter.nlink !== 1
    ) {
      throw new ConfigError("RECEIPT_PATH", `${label} changed during hashing`);
    }
    return sha256(bytes);
  } finally {
    closeSync(descriptor);
  }
}

function assertNoDatabaseSidecars(dbPath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal", ".journal"]) {
    if (existsSync(`${dbPath}${suffix}`)) {
      throw new ConfigError("RECEIPT_SIDECAR", "database is not closed without sidecars");
    }
  }
}

function assertRecoverableDatabaseSidecars(dbPath: string): void {
  for (const suffix of ["-journal", ".journal"]) {
    if (existsSync(`${dbPath}${suffix}`)) {
      throw new ConfigError("RECEIPT_SIDECAR", "database has an unknown rollback sidecar");
    }
  }
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  const walPresent = existsSync(walPath);
  const shmPresent = existsSync(shmPath);
  if (!walPresent && !shmPresent) return;
  if (!walPresent || !shmPresent) {
    throw new ConfigError("RECEIPT_SIDECAR", "database has an incomplete WAL sidecar pair");
  }
  assertPrivateFile(walPath, "database WAL");
  assertPrivateFile(shmPath, "database SHM");
  if (lstatSync(walPath).size !== 0 || lstatSync(shmPath).size !== 32_768) {
    throw new ConfigError("RECEIPT_SIDECAR", "database has WAL frames or an unknown SHM shape");
  }
}

function checkpoint(database: SqliteDatabase): { busy: 0; log: 0; checkpointed: 0 } {
  const row = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as Record<string, unknown> | undefined;
  if (!row || Number(row.busy) !== 0 || Number(row.log) !== 0 || Number(row.checkpointed) !== 0) {
    throw new ConfigError("RECEIPT_CHECKPOINT", "WAL checkpoint did not close at zero frames");
  }
  return { busy: 0, log: 0, checkpointed: 0 };
}

function validateOpenProfile(
  database: SqliteDatabase,
  profileId: ClosedProfileId,
  config: AppConfig,
  options: ClosedReceiptOptions
): Omit<ClosedReceiptCore, "closedDbSha256" | "validatorArtifactSha256" | "validatedAt" | "walPresent" | "shmPresent" | "externalCalls"> {
  assertSingleDatabase(database);
  assertMigrationState(database, resolve(options.appRoot, "migrations"), 3);
  if (profileId === M3_PROFILE_ID) {
    assertSourceFixtureSeeded(database, config, options.appRoot, options.projectRoot);
  } else {
    assertPublicSyntheticSeeded(database, config, options.appRoot, options.projectRoot);
  }
  const schemaFingerprintSha256 = readDatabaseSchemaFingerprint(database);
  if (schemaFingerprintSha256 !== EXPECTED_SCHEMA_FINGERPRINT) {
    throw new ConfigError("RECEIPT_SCHEMA", "profile schema fingerprint drifted");
  }
  const roots = readProfileLedgerRoots(database, profileId);
  const pins = artifactPins(profileId);
  return {
    schemaVersion: "f1plus1-profile-closed-receipt-v1",
    profileId,
    dbRelativePath: profileDbRelativePath(profileId),
    schemaFingerprintSha256,
    migrationLedgerRootSha256: readMigrationLedgerRoot(database),
    ...roots,
    logicalContentRootSha256: readLogicalContentRoot(database),
    rowCounts: readCounts(database, profileId),
    ...pins,
    artifactRevision: artifactRevision(profileId),
    checkpoint: checkpoint(database)
  };
}

function cleanupM3Candidate(directory: string): void {
  if (!existsSync(directory)) return;
  const allowed = new Set([
    basename(M3_SQLITE_PATH),
    `${basename(M3_SQLITE_PATH)}-wal`,
    `${basename(M3_SQLITE_PATH)}-shm`,
    `${basename(M3_SQLITE_PATH)}-journal`,
    `${basename(M3_SQLITE_PATH)}.journal`
  ]);
  for (const entry of readdirSync(directory)) {
    if (!allowed.has(entry)) throw new ConfigError("RECEIPT_TEMP", "M3 candidate directory contains an unknown artifact");
    const path = join(directory, entry);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ConfigError("RECEIPT_TEMP", "M3 candidate artifact is unsafe");
    unlinkSync(path);
  }
  rmdirSync(directory);
}

type RecoveryCandidate = { directory: string; database: string };

function privateFileIdentity(path: string, allowedLinks: readonly number[]): { dev: number; ino: number; nlink: number } {
  const stat = lstatSync(path);
  if (
    !stat.isFile() || stat.isSymbolicLink() || !allowedLinks.includes(stat.nlink) ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new ConfigError("RECEIPT_INSTALL", "M3 recovery file has an unsafe identity");
  }
  assertCurrentOwner(stat.uid, "M3 recovery file");
  return { dev: stat.dev, ino: stat.ino, nlink: stat.nlink };
}

function recoverM3Install(localRoot: string, canonicalPath: string): RecoveryCandidate | undefined {
  const candidates = readdirSync(localRoot, { withFileTypes: true })
    .filter((entry) => entry.name.startsWith(".m3-restore-"));
  if (candidates.length === 0) return undefined;
  if (candidates.length !== 1 || !/^\.m3-restore-[A-Za-z0-9]{6}$/.test(candidates[0].name) || !candidates[0].isDirectory()) {
    throw new ConfigError("RECEIPT_INSTALL", "M3 recovery state is ambiguous");
  }
  const directory = join(localRoot, candidates[0].name);
  assertPrivateDirectory(directory, "M3 recovery directory");
  const entries = readdirSync(directory);
  if (entries.length === 0) {
    if (existsSync(canonicalPath)) privateFileIdentity(canonicalPath, [1]);
    rmdirSync(directory);
    syncDirectory(localRoot);
    return undefined;
  }
  if (entries.length !== 1 || entries[0] !== basename(M3_SQLITE_PATH)) {
    throw new ConfigError("RECEIPT_INSTALL", "M3 recovery directory contains unknown artifacts");
  }
  const database = join(directory, entries[0]);
  const candidateIdentity = privateFileIdentity(database, [1, 2]);
  assertNoDatabaseSidecars(database);
  if (!existsSync(canonicalPath)) {
    if (candidateIdentity.nlink !== 1) throw new ConfigError("RECEIPT_INSTALL", "M3 unpublished candidate link count drifted");
    return { directory, database };
  }
  const canonicalIdentity = privateFileIdentity(canonicalPath, [2]);
  if (
    candidateIdentity.nlink !== 2 || candidateIdentity.dev !== canonicalIdentity.dev ||
    candidateIdentity.ino !== canonicalIdentity.ino
  ) {
    throw new ConfigError("RECEIPT_INSTALL", "M3 published recovery candidate does not match canonical bytes");
  }
  unlinkSync(database);
  rmdirSync(directory);
  syncDirectory(localRoot);
  privateFileIdentity(canonicalPath, [1]);
  return undefined;
}

function installM3Candidate(candidatePath: string, canonicalPath: string, candidateDirectory: string): void {
  if (existsSync(canonicalPath)) throw new ConfigError("RECEIPT_TARGET_EXISTS", "M3 canonical target appeared during restore");
  linkSync(candidatePath, canonicalPath);
  try {
    unlinkSync(candidatePath);
    rmdirSync(candidateDirectory);
    syncDirectory(dirname(canonicalPath));
    assertPrivateFile(canonicalPath, "M3 canonical database");
  } catch (error) {
    throw new ConfigError("RECEIPT_INSTALL", `M3 candidate install did not reach a closed single-link state: ${String(error)}`);
  }
}

function validateOrRestoreM3(
  config: AppConfig,
  options: ClosedReceiptOptions
): { core: ReturnType<typeof validateOpenProfile>; dbPath: string; restored: boolean } {
  const canonicalPath = resolve(options.appRoot, M3_SQLITE_PATH);
  const localRoot = resolve(options.appRoot, ".local");
  assertPrivateDirectory(localRoot, "app local directory");
  const recoveryCandidate = recoverM3Install(localRoot, canonicalPath);
  if (existsSync(canonicalPath)) {
    assertRecoverableDatabaseSidecars(canonicalPath);
    const database = openSafeDatabase(config.dbPath, { appRoot: options.appRoot });
    let core: ReturnType<typeof validateOpenProfile>;
    try {
      core = validateOpenProfile(database, M3_PROFILE_ID, config, options);
    } finally {
      closeDatabase(database);
    }
    assertNoDatabaseSidecars(canonicalPath);
    return { core, dbPath: canonicalPath, restored: false };
  }

  const candidateDirectory = recoveryCandidate?.directory ?? mkdtempSync(join(localRoot, ".m3-restore-"));
  chmodSync(candidateDirectory, 0o700);
  const candidatePath = recoveryCandidate?.database ?? join(candidateDirectory, basename(M3_SQLITE_PATH));
  let installed = false;
  try {
    const database = openSafeDatabase(candidatePath, { appRoot: options.appRoot, allowTestRoot: candidateDirectory });
    let core: ReturnType<typeof validateOpenProfile>;
    try {
      migrateDatabase(database, resolve(options.appRoot, "migrations"));
      seedSourceFixture(database, config, options.appRoot, options.projectRoot);
      core = validateOpenProfile(database, M3_PROFILE_ID, config, options);
    } finally {
      closeDatabase(database);
    }
    assertNoDatabaseSidecars(candidatePath);
    secureFileSha256(candidatePath, "M3 candidate database");
    installM3Candidate(candidatePath, canonicalPath, candidateDirectory);
    installed = true;
    return { core, dbPath: canonicalPath, restored: true };
  } finally {
    if (!installed) cleanupM3Candidate(candidateDirectory);
  }
}

function validatePublic(
  config: AppConfig,
  options: ClosedReceiptOptions
): { core: ReturnType<typeof validateOpenProfile>; dbPath: string; restored: false } {
  const dbPath = resolve(options.appRoot, PUBLIC_SQLITE_PATH);
  if (!existsSync(dbPath)) throw new ConfigError("RECEIPT_DB_MISSING", "public-synthetic canonical database is missing");
  assertRecoverableDatabaseSidecars(dbPath);
  const database = openSafeDatabase(config.dbPath, { appRoot: options.appRoot });
  let core: ReturnType<typeof validateOpenProfile>;
  try {
    core = validateOpenProfile(database, PUBLIC_PROFILE_ID, config, options);
  } finally {
    closeDatabase(database);
  }
  assertNoDatabaseSidecars(dbPath);
  return { core, dbPath, restored: false };
}

function buildDataReceipt(validatedAt: string, validatorArtifactSha256: string): PublicDataReceipt {
  return withReceiptHash({
    schemaVersion: "f1plus1-public-data-closed-receipt-v1" as const,
    profileId: PUBLIC_PROFILE_ID,
    artifactRoot: "data/mvp-contract-v0.4-public-synthetic" as const,
    artifactRevision: PUBLIC_ARTIFACT_REVISION,
    manifestSha256: PUBLIC_ROOT_HASHES.manifest,
    fixtureSha256: PUBLIC_FIXTURE_SHA256,
    graphSha256: PUBLIC_GRAPH_SHA256,
    profileLedgerSha256: PUBLIC_ROOT_HASHES.ledger,
    generatorSha256: PUBLIC_ROOT_HASHES.generator,
    validatorSha256: PUBLIC_ROOT_HASHES.validator,
    receiptValidatorArtifactSha256: validatorArtifactSha256,
    externalCalls: 0 as const,
    validatedAt
  });
}

export function generateClosedReceipt(profileId: ClosedProfileId, options: ClosedReceiptOptions): ClosedReceiptResult {
  process.umask(0o077);
  const appRoot = resolve(options.appRoot);
  const projectRoot = resolve(options.projectRoot);
  if (appRoot !== resolve(projectRoot, "app")) throw new ConfigError("RECEIPT_PATH", "app root is not the canonical project app directory");
  const normalizedOptions = { ...options, appRoot, projectRoot };
  prepareLocalRoot(appRoot);
  const config = profileConfig(profileId, normalizedOptions);
  if (profileId === M3_PROFILE_ID) {
    recoverM3Install(resolve(appRoot, ".local"), resolve(appRoot, M3_SQLITE_PATH));
  }
  const receiptPath = profileReceiptPath(profileId);
  const receiptAbsolutePath = resolve(projectRoot, receiptPath);
  const existingReceipt = verifyReceiptEnvelope(receiptAbsolutePath, "f1plus1-profile-closed-receipt-v1");
  if (existingReceipt) {
    if (existingReceipt.profileId !== profileId || existingReceipt.dbRelativePath !== profileDbRelativePath(profileId)) {
      throw new ConfigError("RECEIPT_TAMPER", "existing receipt is bound to another profile");
    }
    const dbPath = resolve(projectRoot, String(existingReceipt.dbRelativePath));
    assertRecoverableDatabaseSidecars(dbPath);
    if (existingReceipt.closedDbSha256 !== secureFileSha256(dbPath, "closed profile database")) {
      throw new ConfigError("RECEIPT_OLD_BYTE_DRIFT", "closed database bytes changed after the previous receipt");
    }
  }
  const existingDataReceipt = profileId === PUBLIC_PROFILE_ID
    ? verifyReceiptEnvelope(resolve(projectRoot, PUBLIC_DATA_RECEIPT_PATH), "f1plus1-public-data-closed-receipt-v1")
    : undefined;

  const validatorArtifactSha256 = readValidatorArtifactSha256();
  const beforeDbPath = resolve(appRoot, profileId === M3_PROFILE_ID ? M3_SQLITE_PATH : PUBLIC_SQLITE_PATH);
  const beforeDbSha256 = existsSync(beforeDbPath) ? secureFileSha256(beforeDbPath, "profile database before validation") : undefined;
  const validated = profileId === M3_PROFILE_ID
    ? validateOrRestoreM3(config, normalizedOptions)
    : validatePublic(config, normalizedOptions);
  const closedDbSha256 = secureFileSha256(validated.dbPath, "closed profile database");
  if (beforeDbSha256 !== undefined && beforeDbSha256 !== closedDbSha256) {
    throw new ConfigError("RECEIPT_OLD_BYTE_DRIFT", "profile database bytes changed during closed validation");
  }
  const validatedAt = (options.now?.() ?? new Date()).toISOString();
  assertCanonicalTimestamp(validatedAt);
  const dbReceipt = withReceiptHash({
    ...validated.core,
    closedDbSha256,
    validatorArtifactSha256,
    walPresent: false as const,
    shmPresent: false as const,
    externalCalls: 0 as const,
    validatedAt
  });
  assertExistingReceiptMatches(existingReceipt, dbReceipt);

  let dataReceipt: PublicDataReceipt | undefined;
  if (profileId === PUBLIC_PROFILE_ID) {
    dataReceipt = buildDataReceipt(validatedAt, validatorArtifactSha256);
    assertExistingReceiptMatches(existingDataReceipt, dataReceipt);
  }

  atomicWriteReceipt(projectRoot, receiptPath, dbReceipt);
  if (dataReceipt) atomicWriteReceipt(projectRoot, PUBLIC_DATA_RECEIPT_PATH, dataReceipt);
  return { profileId, dbReceipt, dataReceipt, restoredM3: validated.restored };
}

export const CLOSED_RECEIPT_PATHS = Object.freeze({
  m3: M3_RECEIPT_PATH,
  public: PUBLIC_RECEIPT_PATH,
  publicData: PUBLIC_DATA_RECEIPT_PATH
});
