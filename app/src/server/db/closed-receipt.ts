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
  validatorRevision: typeof CLOSED_RECEIPT_VALIDATOR_REVISION;
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
  receiptValidatorRevision: typeof CLOSED_RECEIPT_VALIDATOR_REVISION;
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
  testOnlyReceiptSetCrashAt?: "after-first-install" | "after-all-installs" | "during-recovery";
};

const RECEIPT_DIRECTORY = "app/.local/receipts";
const VALIDATOR_MARKER_DIRECTORY = "app/.local/validator-migrations";
const M3_RECEIPT_PATH = `${RECEIPT_DIRECTORY}/m3-shadow.closed.json`;
const PUBLIC_RECEIPT_PATH = `${RECEIPT_DIRECTORY}/public-synthetic.closed.json`;
const PUBLIC_DATA_RECEIPT_PATH = `${RECEIPT_DIRECTORY}/public-synthetic.data.closed.json`;
const M3_VALIDATOR_MARKER_PATH = `${VALIDATOR_MARKER_DIRECTORY}/m3-shadow.validator-v2.json`;
const PUBLIC_VALIDATOR_MARKER_PATH = `${VALIDATOR_MARKER_DIRECTORY}/public-synthetic.validator-v2.json`;
const M3_ARTIFACT_REVISION = "m4-vs0-seed-enrichment-manifest-v0.3";
const PUBLIC_ARTIFACT_REVISION = "public-demo-12-v0.4-manifest-v2";
const EXPECTED_SCHEMA_FINGERPRINT = "ad2f86e03d9aa8727fe7555729e65a18e4c3986a572ca88cb52cc96245afd23b";
export const PREVIOUS_CLOSED_RECEIPT_VALIDATOR_SHA256 = "2a8c89ace30b1e9cac876adb0583ec47e43ce6d6806616a58fac7823ca586d83";
export const CLOSED_RECEIPT_VALIDATOR_REVISION = "legacy-profile-validator-v2" as const;
const CLOSED_RECEIPT_VALIDATOR_MANIFEST = "app/validator-manifests/legacy-profile-validator-v2.json";
const RECEIPT_PATH_ALLOWLIST = new Set([
  M3_RECEIPT_PATH,
  PUBLIC_RECEIPT_PATH,
  PUBLIC_DATA_RECEIPT_PATH,
  M3_VALIDATOR_MARKER_PATH,
  PUBLIC_VALIDATOR_MARKER_PATH
]);
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

export function readValidatorArtifactSha256(): string {
  const modulePath = fileURLToPath(import.meta.url);
  const projectRoot = resolve(dirname(modulePath), "../../../..");
  const scriptPath = resolve(projectRoot, "app/scripts/profile-closed-receipt.ts");
  const manifestPath = resolve(projectRoot, CLOSED_RECEIPT_VALIDATOR_MANIFEST);
  const expectedModulePath = resolve(projectRoot, "app/src/server/db/closed-receipt.ts");
  if (modulePath !== expectedModulePath) {
    throw new ConfigError("RECEIPT_VALIDATOR", "validator module is outside its canonical project path");
  }
  const artifacts = [modulePath, scriptPath].map((path) => ({
    path: relative(projectRoot, path).replaceAll(sep, "/"),
    sha256: secureArtifactSha256(path, projectRoot)
  }));
  let manifest: Record<string, unknown>;
  const manifestBytes = secureArtifactBytes(manifestPath, projectRoot).toString("utf8");
  try {
    const value: unknown = JSON.parse(manifestBytes);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid manifest");
    manifest = value as Record<string, unknown>;
  } catch {
    throw new ConfigError("RECEIPT_VALIDATOR", "validator manifest is not canonical JSON");
  }
  if (manifestBytes !== `${canonicalJson(manifest)}\n`) {
    throw new ConfigError("RECEIPT_VALIDATOR", "validator manifest bytes are not canonical");
  }
  const root = sha256(canonicalJson(artifacts));
  if (
    canonicalJson(Object.keys(manifest).sort()) !== canonicalJson(["artifacts", "revision", "rootSha256"]) ||
    manifest.revision !== CLOSED_RECEIPT_VALIDATOR_REVISION ||
    canonicalJson(manifest.artifacts) !== canonicalJson(artifacts) ||
    manifest.rootSha256 !== root ||
    root === PREVIOUS_CLOSED_RECEIPT_VALIDATOR_SHA256
  ) {
    throw new ConfigError("RECEIPT_VALIDATOR", "validator manifest does not bind the frozen scoped artifacts");
  }
  return root;
}

function assertNoSymlinkComponents(path: string, root: string): void {
  if (!isInside(root, path)) throw new ConfigError("RECEIPT_VALIDATOR", "validator artifact escaped the project root");
  let current = root;
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o022) !== 0) {
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
  return sha256(secureArtifactBytes(path, projectRoot));
}

function secureArtifactBytes(path: string, projectRoot: string): Buffer {
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
    return bytes;
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

type ValidatorMigrationMarkerCore = {
  schemaVersion: "f1plus1-validator-migration-marker-v1";
  profileId: ClosedProfileId;
  previousValidatorArtifactSha256: typeof PREVIOUS_CLOSED_RECEIPT_VALIDATOR_SHA256;
  validatorRevision: typeof CLOSED_RECEIPT_VALIDATOR_REVISION;
  validatorArtifactSha256: string;
  externalCalls: 0;
};

type ValidatorMigrationMarker = ValidatorMigrationMarkerCore & { receiptSha256: string };

function validatorMarkerPath(profileId: ClosedProfileId): string {
  return profileId === M3_PROFILE_ID ? M3_VALIDATOR_MARKER_PATH : PUBLIC_VALIDATOR_MARKER_PATH;
}

function buildValidatorMigrationMarker(profileId: ClosedProfileId, validatorArtifactSha256: string): ValidatorMigrationMarker {
  return withReceiptHash({
    schemaVersion: "f1plus1-validator-migration-marker-v1" as const,
    profileId,
    previousValidatorArtifactSha256: PREVIOUS_CLOSED_RECEIPT_VALIDATOR_SHA256,
    validatorRevision: CLOSED_RECEIPT_VALIDATOR_REVISION,
    validatorArtifactSha256,
    externalCalls: 0 as const
  });
}

function verifyValidatorMigrationMarker(path: string, profileId: ClosedProfileId): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  const marker = readJsonRecord(path);
  const { receiptSha256, ...core } = marker;
  if (
    marker.schemaVersion !== "f1plus1-validator-migration-marker-v1" ||
    marker.profileId !== profileId ||
    marker.previousValidatorArtifactSha256 !== PREVIOUS_CLOSED_RECEIPT_VALIDATOR_SHA256 ||
    marker.validatorRevision !== CLOSED_RECEIPT_VALIDATOR_REVISION ||
    marker.externalCalls !== 0 ||
    typeof marker.validatorArtifactSha256 !== "string" || !SHA256_PATTERN.test(marker.validatorArtifactSha256) ||
    typeof receiptSha256 !== "string" || !SHA256_PATTERN.test(receiptSha256) ||
    sha256(canonicalJson(core)) !== receiptSha256 ||
    canonicalJson(Object.keys(marker).sort()) !== canonicalJson([
      "externalCalls",
      "previousValidatorArtifactSha256",
      "profileId",
      "receiptSha256",
      "schemaVersion",
      "validatorArtifactSha256",
      "validatorRevision"
    ])
  ) {
    throw new ConfigError("RECEIPT_TAMPER", "validator migration marker is invalid");
  }
  return marker;
}

function withoutVolatile(receipt: Record<string, unknown>): Record<string, unknown> {
  const { validatedAt: _validatedAt, receiptSha256: _receiptSha256, ...stable } = receipt;
  return stable;
}

type ValidatorIdentityKeys = {
  revision: "validatorRevision" | "receiptValidatorRevision";
  root: "validatorArtifactSha256" | "receiptValidatorArtifactSha256";
};

const PROFILE_VALIDATOR_KEYS: ValidatorIdentityKeys = {
  revision: "validatorRevision",
  root: "validatorArtifactSha256"
};
const PUBLIC_DATA_VALIDATOR_KEYS: ValidatorIdentityKeys = {
  revision: "receiptValidatorRevision",
  root: "receiptValidatorArtifactSha256"
};

function withoutValidatorIdentity(
  receipt: Record<string, unknown>,
  keys: ValidatorIdentityKeys
): Record<string, unknown> {
  const stable = withoutVolatile(receipt);
  delete stable[keys.revision];
  delete stable[keys.root];
  return stable;
}

function assertExistingReceiptMatches(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
  keys: ValidatorIdentityKeys
): void {
  if (!existing) return;
  if (canonicalJson(withoutVolatile(existing)) === canonicalJson(withoutVolatile(next))) return;
  const exactLegacyMigration =
    existing[keys.root] === PREVIOUS_CLOSED_RECEIPT_VALIDATOR_SHA256 &&
    existing[keys.revision] === undefined &&
    next[keys.revision] === CLOSED_RECEIPT_VALIDATOR_REVISION &&
    typeof next[keys.root] === "string" &&
    next[keys.root] !== PREVIOUS_CLOSED_RECEIPT_VALIDATOR_SHA256 &&
    canonicalJson(withoutValidatorIdentity(existing, keys)) === canonicalJson(withoutValidatorIdentity(next, keys));
  if (!exactLegacyMigration) {
    throw new ConfigError("RECEIPT_OLD_BYTE_DRIFT", "existing closed receipt no longer matches the validated profile");
  }
}

function assertPublicReceiptSetIdentity(
  profileReceipt: Record<string, unknown> | undefined,
  dataReceipt: Record<string, unknown> | undefined
): void {
  if ((profileReceipt === undefined) !== (dataReceipt === undefined)) {
    throw new ConfigError("RECEIPT_SET_DRIFT", "public receipt set is incomplete");
  }
  if (!profileReceipt || !dataReceipt) return;
  if (
    profileReceipt.validatorArtifactSha256 !== dataReceipt.receiptValidatorArtifactSha256 ||
    profileReceipt.validatorRevision !== dataReceipt.receiptValidatorRevision
  ) {
    throw new ConfigError("RECEIPT_SET_DRIFT", "public receipt set validator identity is inconsistent");
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

function ensureValidatorMarkerDirectory(projectRoot: string): string {
  const appLocal = resolve(projectRoot, "app/.local");
  const markerDirectory = resolve(projectRoot, VALIDATOR_MARKER_DIRECTORY);
  if (!isInside(appLocal, markerDirectory) || dirname(markerDirectory) !== appLocal) {
    throw new ConfigError("RECEIPT_PATH", "validator marker directory escaped app/.local");
  }
  assertPrivateDirectory(appLocal, "app local directory");
  if (!existsSync(markerDirectory)) mkdirSync(markerDirectory, { mode: 0o700 });
  assertPrivateDirectory(markerDirectory, "validator marker directory");
  return markerDirectory;
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

type ReceiptSetEntry = {
  relativePath: string;
  receipt: Record<string, unknown>;
};

function writePrivateTemp(directory: string, label: string, bytes: Buffer): string {
  const path = join(directory, `.${label}.${randomBytes(8).toString("hex")}.tmp`);
  const noFollow = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
  if (typeof noFollow !== "number") throw new ConfigError("RECEIPT_PATH", "O_NOFOLLOW is unavailable");
  const descriptor = openSync(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow, 0o600);
  try {
    writeFileSync(descriptor, bytes);
    fdatasyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  assertPrivateFile(path, "receipt transaction file");
  return path;
}

function readPrivateFileBytes(path: string, label: string): Buffer {
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
      after.dev !== pathAfter.dev || after.ino !== pathAfter.ino || pathAfter.isSymbolicLink() ||
      pathAfter.nlink !== 1 || (pathAfter.mode & 0o077) !== 0
    ) {
      throw new ConfigError("RECEIPT_PATH", `${label} changed during secure read`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

type ReceiptTransactionJournalEntry = {
  index: number;
  relativePath: string;
  oldExists: boolean;
  oldSha256: string | null;
  candidateSha256: string;
};

function transactionDirectory(projectRoot: string, transactionName: string): string {
  if (!/^[a-z0-9-]{3,48}$/.test(transactionName)) throw new ConfigError("RECEIPT_PATH", "invalid receipt transaction name");
  return join(ensureReceiptDirectory(projectRoot), `.${transactionName}.transaction`);
}

function transactionFileName(index: number, kind: "candidate" | "rollback"): string {
  return `${index}.${kind}`;
}

function writeNamedPrivateFile(directory: string, name: string, bytes: Buffer): string {
  const target = join(directory, name);
  if (existsSync(target)) throw new ConfigError("RECEIPT_SET_DRIFT", "receipt transaction file already exists");
  const temporary = writePrivateTemp(directory, name, bytes);
  renameSync(temporary, target);
  chmodSync(target, 0o600);
  assertPrivateFile(target, "receipt transaction file");
  return target;
}

function readTransactionJournal(path: string, transactionName: string): ReceiptTransactionJournalEntry[] {
  const journal = readJsonRecord(path);
  const { receiptSha256, ...core } = journal;
  if (
    journal.schemaVersion !== "f1plus1-receipt-set-transaction-v1" ||
    journal.transactionName !== transactionName ||
    journal.externalCalls !== 0 ||
    !Array.isArray(journal.entries) ||
    typeof receiptSha256 !== "string" || !SHA256_PATTERN.test(receiptSha256) ||
    sha256(canonicalJson(core)) !== receiptSha256 ||
    canonicalJson(Object.keys(journal).sort()) !== canonicalJson([
      "entries", "externalCalls", "receiptSha256", "schemaVersion", "transactionName"
    ])
  ) {
    throw new ConfigError("RECEIPT_ROLLBACK", "receipt transaction journal is invalid");
  }
  const entries = journal.entries.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ConfigError("RECEIPT_ROLLBACK", "receipt transaction entry is invalid");
    }
    const entry = value as Record<string, unknown>;
    if (
      canonicalJson(Object.keys(entry).sort()) !== canonicalJson([
        "candidateSha256", "index", "oldExists", "oldSha256", "relativePath"
      ]) ||
      entry.index !== index || typeof entry.relativePath !== "string" ||
      typeof entry.oldExists !== "boolean" || typeof entry.candidateSha256 !== "string" ||
      !SHA256_PATTERN.test(entry.candidateSha256) ||
      (entry.oldExists ? typeof entry.oldSha256 !== "string" || !SHA256_PATTERN.test(entry.oldSha256) : entry.oldSha256 !== null)
    ) {
      throw new ConfigError("RECEIPT_ROLLBACK", "receipt transaction entry fields are invalid");
    }
    assertRelativePath(entry.relativePath);
    return entry as unknown as ReceiptTransactionJournalEntry;
  });
  if (entries.length < 2 || new Set(entries.map((entry) => entry.relativePath)).size !== entries.length) {
    throw new ConfigError("RECEIPT_ROLLBACK", "receipt transaction set is incomplete or duplicated");
  }
  return entries;
}

function removeTransactionDirectory(directory: string, entries: readonly ReceiptTransactionJournalEntry[]): void {
  const allowed = new Set(["journal.json"]);
  for (const entry of entries) {
    allowed.add(transactionFileName(entry.index, "candidate"));
    allowed.add(transactionFileName(entry.index, "rollback"));
  }
  for (const name of readdirSync(directory)) {
    if (!allowed.has(name)) throw new ConfigError("RECEIPT_ROLLBACK", "receipt transaction contains an unknown file");
    const path = join(directory, name);
    assertPrivateFile(path, "receipt transaction cleanup file");
    unlinkSync(path);
  }
  rmdirSync(directory);
  syncDirectory(dirname(directory));
}

function recoverReceiptSetTransaction(projectRoot: string, transactionName: string, crashDuringRecovery = false): void {
  const directory = transactionDirectory(projectRoot, transactionName);
  if (!existsSync(directory)) return;
  assertPrivateDirectory(directory, "receipt transaction directory");
  const journalPath = join(directory, "journal.json");
  if (!existsSync(journalPath)) {
    const entries = readdirSync(directory);
    for (const name of entries) {
      if (
        !/^\d+\.(?:candidate|rollback)$/.test(name) &&
        !/^\.\d+\.(?:candidate|rollback)\.[a-f0-9]{16}\.tmp$/.test(name) &&
        !/^\.journal\.json\.[a-f0-9]{16}\.tmp$/.test(name)
      ) {
        throw new ConfigError("RECEIPT_ROLLBACK", "uncommitted receipt transaction contains an unknown file");
      }
      const path = join(directory, name);
      assertPrivateFile(path, "uncommitted receipt transaction file");
      unlinkSync(path);
    }
    rmdirSync(directory);
    syncDirectory(dirname(directory));
    return;
  }
  const entries = readTransactionJournal(journalPath, transactionName);
  const allowedTargetDirectories = new Set([
    ensureReceiptDirectory(projectRoot),
    ensureValidatorMarkerDirectory(projectRoot)
  ]);
  let restoredEntries = 0;
  for (const entry of [...entries].reverse()) {
    const target = resolve(projectRoot, entry.relativePath);
    if (!allowedTargetDirectories.has(dirname(target))) {
      throw new ConfigError("RECEIPT_ROLLBACK", "receipt transaction target directory is not allowlisted");
    }
    const rollback = join(directory, transactionFileName(entry.index, "rollback"));
    if (entry.oldExists) {
      if (existsSync(target)) {
        const currentSha256 = sha256(readPrivateFileBytes(target, "receipt rollback target"));
        if (currentSha256 !== entry.oldSha256 && currentSha256 !== entry.candidateSha256) {
          throw new ConfigError("RECEIPT_ROLLBACK", "receipt rollback target has a third-state hash");
        }
      }
      if (existsSync(rollback)) {
        const rollbackBytes = readPrivateFileBytes(rollback, "receipt rollback file");
        if (sha256(rollbackBytes) !== entry.oldSha256) {
          throw new ConfigError("RECEIPT_ROLLBACK", "receipt rollback bytes changed");
        }
        renameSync(rollback, target);
        chmodSync(target, 0o600);
      }
      if (!existsSync(target) || sha256(readPrivateFileBytes(target, "restored receipt")) !== entry.oldSha256) {
        throw new ConfigError("RECEIPT_ROLLBACK", "receipt transaction cannot restore exact old bytes");
      }
    } else if (existsSync(target)) {
      const targetBytes = readPrivateFileBytes(target, "new receipt rollback target");
      if (sha256(targetBytes) !== entry.candidateSha256) {
        throw new ConfigError("RECEIPT_ROLLBACK", "new receipt rollback target is not the staged candidate");
      }
      unlinkSync(target);
    }
    restoredEntries += 1;
    if (crashDuringRecovery && restoredEntries === 1) {
      process.kill(process.pid, "SIGKILL");
      throw new ConfigError("RECEIPT_SET_TEST_CRASH", "receipt recovery process interruption did not terminate");
    }
  }
  for (const targetDirectory of allowedTargetDirectories) syncDirectory(targetDirectory);
  removeTransactionDirectory(directory, entries);
}

function atomicWriteReceiptSet(
  projectRoot: string,
  transactionName: string,
  entries: readonly ReceiptSetEntry[],
  crashAt?: ClosedReceiptOptions["testOnlyReceiptSetCrashAt"]
): void {
  recoverReceiptSetTransaction(projectRoot, transactionName);
  const receiptDirectory = ensureReceiptDirectory(projectRoot);
  const markerDirectory = ensureValidatorMarkerDirectory(projectRoot);
  const allowedTargetDirectories = new Set([receiptDirectory, markerDirectory]);
  const localDirectory = dirname(receiptDirectory);
  const directoryBefore = directoryIdentity(receiptDirectory);
  const localBefore = directoryIdentity(localDirectory);
  const directory = transactionDirectory(projectRoot, transactionName);
  if (existsSync(directory)) throw new ConfigError("RECEIPT_SET_DRIFT", "receipt transaction was not fully recovered");
  const transaction = entries.map((entry, index) => {
    assertRelativePath(entry.relativePath);
    const target = resolve(projectRoot, entry.relativePath);
    if (!allowedTargetDirectories.has(dirname(target))) throw new ConfigError("RECEIPT_PATH", "receipt target escaped the allowlisted directories");
    const oldBytes = existsSync(target) ? readPrivateFileBytes(target, "existing receipt") : undefined;
    const candidateBytes = Buffer.from(`${canonicalJson(entry.receipt)}\n`, "utf8");
    return { ...entry, index, target, oldBytes, candidateBytes };
  });
  if (transaction.length < 2 || new Set(transaction.map((item) => item.target)).size !== transaction.length) {
    throw new ConfigError("RECEIPT_PATH", "receipt set is incomplete or contains duplicate targets");
  }
  mkdirSync(directory, { mode: 0o700 });
  assertPrivateDirectory(directory, "receipt transaction directory");

  try {
    const journalEntries: ReceiptTransactionJournalEntry[] = transaction.map((item) => {
      writeNamedPrivateFile(directory, transactionFileName(item.index, "candidate"), item.candidateBytes);
      if (item.oldBytes) writeNamedPrivateFile(directory, transactionFileName(item.index, "rollback"), item.oldBytes);
      return {
        index: item.index,
        relativePath: item.relativePath,
        oldExists: item.oldBytes !== undefined,
        oldSha256: item.oldBytes ? sha256(item.oldBytes) : null,
        candidateSha256: sha256(item.candidateBytes)
      };
    });
    const journalCore = {
      schemaVersion: "f1plus1-receipt-set-transaction-v1" as const,
      transactionName,
      entries: journalEntries,
      externalCalls: 0 as const
    };
    writeNamedPrivateFile(
      directory,
      "journal.json",
      Buffer.from(`${canonicalJson({ ...journalCore, receiptSha256: sha256(canonicalJson(journalCore)) })}\n`, "utf8")
    );
    syncDirectory(directory);
    for (const targetDirectory of allowedTargetDirectories) syncDirectory(targetDirectory);

    for (const item of transaction) {
      if (item.oldBytes) {
        if (!readPrivateFileBytes(item.target, "existing receipt before set commit").equals(item.oldBytes)) {
          throw new ConfigError("RECEIPT_SET_DRIFT", "receipt set changed before commit");
        }
      } else if (existsSync(item.target)) {
        throw new ConfigError("RECEIPT_SET_DRIFT", "receipt set target appeared before commit");
      }
      renameSync(join(directory, transactionFileName(item.index, "candidate")), item.target);
      chmodSync(item.target, 0o600);
      assertPrivateFile(item.target, "installed receipt");
      if (item.index === 0 && crashAt === "after-first-install") {
        process.kill(process.pid, "SIGKILL");
        throw new ConfigError("RECEIPT_SET_TEST_CRASH", "receipt set process interruption did not terminate");
      }
    }
    if (crashAt === "after-all-installs") {
      process.kill(process.pid, "SIGKILL");
      throw new ConfigError("RECEIPT_SET_TEST_CRASH", "receipt set process interruption did not terminate");
    }
    for (const targetDirectory of allowedTargetDirectories) syncDirectory(targetDirectory);
    for (const item of transaction) {
      if (!readPrivateFileBytes(item.target, "installed receipt").equals(item.candidateBytes)) {
        throw new ConfigError("RECEIPT_TAMPER", "installed receipt bytes changed");
      }
    }
    removeTransactionDirectory(directory, journalEntries);
  } catch (error) {
    try {
      recoverReceiptSetTransaction(projectRoot, transactionName);
    } catch {
      throw new ConfigError("RECEIPT_ROLLBACK", "receipt set rollback could not prove exact old bytes");
    }
    throw error;
  }

  const directoryAfter = directoryIdentity(receiptDirectory);
  const localAfter = directoryIdentity(localDirectory);
  if (
    directoryBefore.dev !== directoryAfter.dev || directoryBefore.ino !== directoryAfter.ino ||
    localBefore.dev !== localAfter.dev || localBefore.ino !== localAfter.ino
  ) {
    throw new ConfigError("RECEIPT_PATH", "receipt directory changed during set commit");
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
): Omit<ClosedReceiptCore, "closedDbSha256" | "validatorRevision" | "validatorArtifactSha256" | "validatedAt" | "walPresent" | "shmPresent" | "externalCalls"> {
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
    receiptValidatorRevision: CLOSED_RECEIPT_VALIDATOR_REVISION,
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
  const transactionName = profileId === M3_PROFILE_ID ? "m3-receipt-v2" : "public-receipt-v2";
  recoverReceiptSetTransaction(projectRoot, transactionName, options.testOnlyReceiptSetCrashAt === "during-recovery");
  const config = profileConfig(profileId, normalizedOptions);
  if (profileId === M3_PROFILE_ID) {
    recoverM3Install(resolve(appRoot, ".local"), resolve(appRoot, M3_SQLITE_PATH));
  }
  const receiptPath = profileReceiptPath(profileId);
  const receiptAbsolutePath = resolve(projectRoot, receiptPath);
  const existingReceipt = verifyReceiptEnvelope(receiptAbsolutePath, "f1plus1-profile-closed-receipt-v1");
  const markerPath = validatorMarkerPath(profileId);
  const existingMarker = verifyValidatorMigrationMarker(resolve(projectRoot, markerPath), profileId);
  if (existingMarker && !existingReceipt) {
    throw new ConfigError("RECEIPT_SET_DRIFT", "validator marker exists without its closed receipt");
  }
  if (existingReceipt) {
    if (existingReceipt.profileId !== profileId || existingReceipt.dbRelativePath !== profileDbRelativePath(profileId)) {
      throw new ConfigError("RECEIPT_TAMPER", "existing receipt is bound to another profile");
    }
    const dbPath = resolve(projectRoot, String(existingReceipt.dbRelativePath));
    assertRecoverableDatabaseSidecars(dbPath);
    if (existingReceipt.closedDbSha256 !== secureFileSha256(dbPath, "closed profile database")) {
      throw new ConfigError("RECEIPT_OLD_BYTE_DRIFT", "closed database bytes changed after the previous receipt");
    }
    if (existingMarker && existingReceipt.validatorArtifactSha256 === PREVIOUS_CLOSED_RECEIPT_VALIDATOR_SHA256) {
      throw new ConfigError("RECEIPT_MIGRATION_REPLAY", "legacy validator receipt replay is forbidden after migration");
    }
    if (!existingMarker && existingReceipt.validatorRevision === CLOSED_RECEIPT_VALIDATOR_REVISION) {
      throw new ConfigError("RECEIPT_SET_DRIFT", "scoped validator receipt is missing its migration marker");
    }
  }
  const existingDataReceipt = profileId === PUBLIC_PROFILE_ID
    ? verifyReceiptEnvelope(resolve(projectRoot, PUBLIC_DATA_RECEIPT_PATH), "f1plus1-public-data-closed-receipt-v1")
    : undefined;
  if (profileId === PUBLIC_PROFILE_ID) assertPublicReceiptSetIdentity(existingReceipt, existingDataReceipt);

  const validatorArtifactSha256 = readValidatorArtifactSha256();
  if (existingMarker && existingMarker.validatorArtifactSha256 !== validatorArtifactSha256) {
    throw new ConfigError("RECEIPT_VALIDATOR", "validator migration marker does not match the frozen artifact root");
  }
  const validatorMarker = existingMarker ?? buildValidatorMigrationMarker(profileId, validatorArtifactSha256);
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
    validatorRevision: CLOSED_RECEIPT_VALIDATOR_REVISION,
    validatorArtifactSha256,
    walPresent: false as const,
    shmPresent: false as const,
    externalCalls: 0 as const,
    validatedAt
  });
  assertExistingReceiptMatches(existingReceipt, dbReceipt, PROFILE_VALIDATOR_KEYS);

  let dataReceipt: PublicDataReceipt | undefined;
  if (profileId === PUBLIC_PROFILE_ID) {
    dataReceipt = buildDataReceipt(validatedAt, validatorArtifactSha256);
    assertExistingReceiptMatches(existingDataReceipt, dataReceipt, PUBLIC_DATA_VALIDATOR_KEYS);
  }

  if (dataReceipt) {
    const publicEntries: ReceiptSetEntry[] = [
      { relativePath: receiptPath, receipt: dbReceipt },
      { relativePath: PUBLIC_DATA_RECEIPT_PATH, receipt: dataReceipt }
    ];
    if (!existingMarker) publicEntries.push({ relativePath: markerPath, receipt: validatorMarker });
    atomicWriteReceiptSet(projectRoot, transactionName, publicEntries, options.testOnlyReceiptSetCrashAt);
  } else if (!existingMarker) {
    atomicWriteReceiptSet(projectRoot, transactionName, [
      { relativePath: receiptPath, receipt: dbReceipt },
      { relativePath: markerPath, receipt: validatorMarker }
    ], options.testOnlyReceiptSetCrashAt);
  } else {
    atomicWriteReceipt(projectRoot, receiptPath, dbReceipt);
  }
  return { profileId, dbReceipt, dataReceipt, restoredM3: validated.restored };
}

export const CLOSED_RECEIPT_PATHS = Object.freeze({
  m3: M3_RECEIPT_PATH,
  public: PUBLIC_RECEIPT_PATH,
  publicData: PUBLIC_DATA_RECEIPT_PATH,
  m3ValidatorMarker: M3_VALIDATOR_MARKER_PATH,
  publicValidatorMarker: PUBLIC_VALIDATOR_MARKER_PATH
});
