import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync, constants as sqliteConstants } from "node:sqlite";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  unlinkSync
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { ConfigError, type AppConfig } from "../config/env.ts";
import { SOURCE_REQUIRED_FIELDS } from "../providers/source-fixture.ts";
import {
  closeDatabase,
  openSafeDatabase,
  readDatabaseSchemaFingerprint,
  readSqliteRuntime,
  withImmediateTransaction,
  type SqliteDatabase
} from "./database.ts";
import {
  PUBLIC_MULTIMEDIA_PROFILE_COUNTS,
  PUBLIC_MULTIMEDIA_PROFILE_ID,
  PUBLIC_MULTIMEDIA_SQLITE_PATH,
  assertSingleDatabase,
  canonicalJson,
  countTable
} from "./profile.ts";

type JsonRecord = Record<string, unknown>;

type RuntimeGraph = JsonRecord & {
  sources: JsonRecord[];
  captured_items: JsonRecord[];
  contents: JsonRecord[];
  events: JsonRecord[];
  summaries: JsonRecord[];
  media_candidates: JsonRecord[];
  release_bundles: JsonRecord[];
  review_decisions: JsonRecord[];
  publications: JsonRecord[];
  outbox_jobs: JsonRecord[];
  published_projections: JsonRecord[];
  expected_dto_cases: JsonRecord[];
  row_counts: JsonRecord;
};

type RuntimeManifest = JsonRecord & {
  candidate_canonical_sha256: string;
  candidate_file_sha256: string;
  candidate_path: string;
  frozen_input_hashes: Record<string, string>;
  manifest_root_sha256: string;
};

export const PUBLIC_MULTIMEDIA_GRAPH_FILE_SHA256 = "1eddfe54394757ff1cf00dce12ec2409772817256fe40177bc04e5a54989608b";
export const PUBLIC_MULTIMEDIA_GRAPH_ROOT_SHA256 = "52775a139bf8d7352cd5c751e090794a2aac878a3515d9c35fb61e3f13ffa532";
export const PUBLIC_MULTIMEDIA_MANIFEST_FILE_SHA256 = "38d51764568cc9d3943e0c31388bf125c1f3b207cde0fc2f37db22becfbed6eb";
export const PUBLIC_MULTIMEDIA_MANIFEST_ROOT_SHA256 = "0a0374e8eb417574128796a7d6b4c9fb3bba786430a649207aca2007225f800b";
export const PUBLIC_MULTIMEDIA_GENERATOR_ROOT_SHA256 = "84f9decf5103e5eb1077f773daf0b41c19e69388f1a1ccce8cb0f87cc5ca4f65";
export const PUBLIC_MULTIMEDIA_VALIDATOR_ROOT_SHA256 = "eeb094e8539cb2edcba11fcd3be2b81df373706d617119859bb683a939fc17f1";
export const PUBLIC_MULTIMEDIA_SCHEMA_FINGERPRINT_SHA256 = "b39672c45af95027f9ae32a5610b1d2c71c49c38d79897e1d42a8a71771efe8f";
export const PUBLIC_MULTIMEDIA_MIGRATION_SELECTOR_ROOT_SHA256 = "336a8721d75a24ac956b4d7cdecba4515fc136f96d89f91f3304293b0f6c600c";
export const PUBLIC_MULTIMEDIA_SCHEMA_OBJECTS = Object.freeze([
  "index:public_publication_published_idx",
  "index:source_config_fixture_canonical_unique",
  "index:source_config_fixture_epoch_idx",
  "index:source_config_fixture_lifecycle_idx",
  "index:source_config_fixture_status_idx",
  "table:fixture_profile_ledger",
  "table:fixture_seed_ledger",
  "table:migration_ledger",
  "table:public_captured_item",
  "table:public_content",
  "table:public_media_candidate",
  "table:public_publication",
  "table:public_release_bundle",
  "table:public_review_decision",
  "table:public_summary",
  "table:published_projection",
  "table:source_config_fixture",
  "table:source_seed_ledger",
  "trigger:public_media_candidate_max_four_before_content_update",
  "trigger:public_media_candidate_max_four_before_insert"
]);

const DATA_ROOT = "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic";
const GRAPH_PATH = `${DATA_ROOT}/runtime-graph.public-multimedia-pagination-synthetic.json`;
const MANIFEST_PATH = `${DATA_ROOT}/manifest.json`;
const PREDECESSOR_CANONICAL_SHA256 = "a1f712aacf0d78664ea9962dfe9902c194422ce099bab968a84d9a2c64cbf50c";
const FIXTURE_SET = "public-multimedia-pagination-24-v0.6" as const;
const MIGRATIONS = [
  { id: "0001_local_foundation.sql", path: "app/migrations/0001_local_foundation.sql", sha256: "9c8c083b8f3c566023e9438c254d5b1c09d87430dec08f6e6905ed84b6fb3176" },
  { id: "0002_source_fixture.sql", path: "app/migrations/0002_source_fixture.sql", sha256: "12a755754744689f977ac8b8d5d4443ec63cd5612aaff50eb920badf1ebfb031" },
  { id: "profiles/public-multimedia-synthetic/0003_public_multimedia_synthetic_profile.sql", path: "app/migrations/profiles/public-multimedia-synthetic/0003_public_multimedia_synthetic_profile.sql", sha256: "1f88116c62d2d29e469ff0dce356d07b41c8b142a00769774a3cf67709968b43" }
] as const;

const DOMAIN_TABLES = [
  ["captured_items", "public_captured_item"],
  ["contents", "public_content"],
  ["summaries", "public_summary"],
  ["media_candidates", "public_media_candidate"],
  ["release_bundles", "public_release_bundle"],
  ["review_decisions", "public_review_decision"],
  ["publications", "public_publication"],
  ["published_projections", "published_projection"]
] as const;

const CLOSED_RECEIPTS = [
  { path: "app/.local/receipts/m3-shadow.closed.json", db: "app/.local/f1plus1.sqlite", profile: "m3-shadow" },
  { path: "app/.local/receipts/public-synthetic.closed.json", db: "app/.local/f1plus1-public-synthetic.sqlite", profile: "public-synthetic" }
] as const;
const PUBLIC_DATA_RECEIPT = "app/.local/receipts/public-synthetic.data.closed.json";
const CLOSED_VALIDATOR_SHA256 = "2a8c89ace30b1e9cac876adb0583ec47e43ce6d6806616a58fac7823ca586d83";
const LEGACY_RECEIPT_EXPECTATIONS = {
  "m3-shadow": {
    schemaVersion: "f1plus1-profile-closed-receipt-v1",
    profileId: "m3-shadow",
    dbRelativePath: "app/.local/f1plus1.sqlite",
    closedDbSha256: "df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0",
    schemaFingerprintSha256: "ad2f86e03d9aa8727fe7555729e65a18e4c3986a572ca88cb52cc96245afd23b",
    migrationLedgerRootSha256: "ea8a4705b512beeaf848d9c61b5a4e71d1c15f78966e040f68197edcd36cb4c6",
    profileLedgerRootSha256: "48637139dc9655572677aa003e88c63f3e1263ea47c08cade9d9b09261cea2bd",
    storedProfileLedgerSha256: "48637139dc9655572677aa003e88c63f3e1263ea47c08cade9d9b09261cea2bd",
    logicalContentRootSha256: "f6ae0064360f4d79f418e2e5d128199854e6939ae706e7fc1403c258f2962549",
    rowCounts: { sources: 59, captured_items: 0, contents: 0, summaries: 0, media_candidates: 0, release_bundles: 0, review_decisions: 0, publications: 0, published_projections: 0 },
    fixtureManifestSha256: "d4da9fc24c792c0471bcd24c525a46dcef1e521b36a870fd111e7310243888b2",
    fixtureGraphSha256: "e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17",
    artifactRevision: "m4-vs0-seed-enrichment-manifest-v0.3",
    validatorArtifactSha256: CLOSED_VALIDATOR_SHA256,
    checkpoint: { busy: 0, log: 0, checkpointed: 0 }, walPresent: false, shmPresent: false, externalCalls: 0
  },
  "public-synthetic": {
    schemaVersion: "f1plus1-profile-closed-receipt-v1",
    profileId: "public-synthetic",
    dbRelativePath: "app/.local/f1plus1-public-synthetic.sqlite",
    closedDbSha256: "24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041",
    schemaFingerprintSha256: "ad2f86e03d9aa8727fe7555729e65a18e4c3986a572ca88cb52cc96245afd23b",
    migrationLedgerRootSha256: "797cfa512aacebe4bdc39b9ef30504bcbed4a18212cb0e88997b34719d2edafb",
    profileLedgerRootSha256: "1f7719490a18a49842427907b53c3dbde5813709a2ad611f7cfaca891880caf1",
    storedProfileLedgerSha256: "0641556828de349f0a5af64043d8f6790bee9a2ff759286459e760199640605a",
    logicalContentRootSha256: "6be7af63590b1a3e258885691eb35964813b00a27bcb62fca8e6c409d4ca7a3a",
    rowCounts: { sources: 1, captured_items: 12, contents: 12, summaries: 12, media_candidates: 10, release_bundles: 12, review_decisions: 12, publications: 12, published_projections: 12 },
    fixtureManifestSha256: "3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554",
    fixtureGraphSha256: "4be9f7e868a8bf21551bdcdc05d6b0d027e1a0ea43fd16dd2c7ea2b2ff9ba526",
    artifactRevision: "public-demo-12-v0.4-manifest-v2",
    validatorArtifactSha256: CLOSED_VALIDATOR_SHA256,
    checkpoint: { busy: 0, log: 0, checkpointed: 0 }, walPresent: false, shmPresent: false, externalCalls: 0
  }
} as const;

const PUBLIC_DATA_RECEIPT_EXPECTATION = {
  schemaVersion: "f1plus1-public-data-closed-receipt-v1",
  profileId: "public-synthetic",
  artifactRoot: "data/mvp-contract-v0.4-public-synthetic",
  artifactRevision: "public-demo-12-v0.4-manifest-v2",
  manifestSha256: "3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554",
  fixtureSha256: "c7d9d88b170214b283a214625d6fd2028fd8eb3a6a2701c556cb2364eb9941e4",
  graphSha256: "4be9f7e868a8bf21551bdcdc05d6b0d027e1a0ea43fd16dd2c7ea2b2ff9ba526",
  profileLedgerSha256: "1f7719490a18a49842427907b53c3dbde5813709a2ad611f7cfaca891880caf1",
  generatorSha256: "34ecfa83fec1f89a22d877e554c4ce5c4d11c1bad6b7f09f123fea3ede1cb81a",
  validatorSha256: "058be83bdded7f5c60028f0a2e537c510e9386934284684fffb119d2e487360c",
  receiptValidatorArtifactSha256: CLOSED_VALIDATOR_SHA256,
  externalCalls: 0
} as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown, code = "PUBLIC_MULTIMEDIA_FIXTURE_SCHEMA"): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(code, "expected an object");
  return value as JsonRecord;
}

function parseCanonicalFile(projectRoot: string, relativePath: string, expectedSha256: string): { value: JsonRecord; bytes: Buffer } {
  const path = resolve(/* turbopackIgnore: true */ projectRoot, relativePath);
  const stat = lstatSync(path);
  const uid = process.getuid?.();
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o022) !== 0 || uid === undefined || stat.uid !== uid) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_FIXTURE_PATH", "fixture artifact is not an owner-controlled regular file");
  }
  const bytes = readFileSync(/* turbopackIgnore: true */ path);
  if (sha256(bytes) !== expectedSha256) throw new ConfigError("PUBLIC_MULTIMEDIA_FIXTURE_DRIFT", "fixture artifact hash changed");
  let value: JsonRecord;
  try {
    value = record(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("PUBLIC_MULTIMEDIA_FIXTURE_SCHEMA", "fixture artifact is not valid JSON");
  }
  return { value, bytes };
}

function assertRuntimeArtifacts(projectRoot: string): { graph: RuntimeGraph; manifest: RuntimeManifest } {
  const graphFile = parseCanonicalFile(projectRoot, GRAPH_PATH, PUBLIC_MULTIMEDIA_GRAPH_FILE_SHA256);
  const manifestFile = parseCanonicalFile(projectRoot, MANIFEST_PATH, PUBLIC_MULTIMEDIA_MANIFEST_FILE_SHA256);
  const graph = graphFile.value as RuntimeGraph;
  const manifest = manifestFile.value as RuntimeManifest;
  if (sha256(canonicalJson(graph)) !== PUBLIC_MULTIMEDIA_GRAPH_ROOT_SHA256) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_GRAPH_ROOT", "runtime graph canonical root changed");
  }
  const { manifest_root_sha256: _manifestRoot, ...manifestWithoutRoot } = manifest;
  if (sha256(canonicalJson(manifestWithoutRoot)) !== PUBLIC_MULTIMEDIA_MANIFEST_ROOT_SHA256) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_MANIFEST_ROOT", "runtime manifest root changed");
  }
  if (
    graph.profile_id !== PUBLIC_MULTIMEDIA_PROFILE_ID ||
    graph.contract_version !== "public-read-v0.2" ||
    graph.fixture_set !== FIXTURE_SET ||
    graph.synthetic_only !== true || graph.external_calls !== 0 || graph.writes_to_base !== false || graph.real_media !== 0 ||
    canonicalJson(graph.row_counts) !== canonicalJson(PUBLIC_MULTIMEDIA_PROFILE_COUNTS) ||
    manifest.profile_id !== PUBLIC_MULTIMEDIA_PROFILE_ID ||
    manifest.contract_version !== "public-read-v0.2" ||
    manifest.fixture_set !== FIXTURE_SET ||
    manifest.candidate_path !== GRAPH_PATH ||
    manifest.candidate_file_sha256 !== PUBLIC_MULTIMEDIA_GRAPH_FILE_SHA256 ||
    manifest.candidate_canonical_sha256 !== PUBLIC_MULTIMEDIA_GRAPH_ROOT_SHA256 ||
    manifest.manifest_root_sha256 !== PUBLIC_MULTIMEDIA_MANIFEST_ROOT_SHA256 ||
    canonicalJson(manifest.row_counts) !== canonicalJson(PUBLIC_MULTIMEDIA_PROFILE_COUNTS) ||
    manifest.synthetic_only !== undefined ||
    manifest.external_calls !== 0 || manifest.writes_to_base !== false || manifest.real_media !== 0 || manifest.real_content_imported !== false ||
    manifest.frozen_input_hashes["app/.local/f1plus1-public-multimedia-synthetic.sqlite"] !== PREDECESSOR_CANONICAL_SHA256 ||
    manifest.frozen_input_hashes["data/mvp-contract-v0.5-public-multimedia-synthetic/generate_runtime_graph.py"] !== PUBLIC_MULTIMEDIA_GENERATOR_ROOT_SHA256 ||
    manifest.frozen_input_hashes["data/mvp-contract-v0.5-public-multimedia-synthetic/validate_runtime_graph.py"] !== PUBLIC_MULTIMEDIA_VALIDATOR_ROOT_SHA256
  ) throw new ConfigError("PUBLIC_MULTIMEDIA_FIXTURE_SCHEMA", "runtime graph or manifest identity is not accepted");
  return { graph, manifest };
}

export function readPublicMultimediaExpectedCases(projectRoot: string): JsonRecord[] {
  return assertRuntimeArtifacts(projectRoot).graph.expected_dto_cases.map((item) => record(item));
}

function assertMultimediaDatabaseProfile(database: SqliteDatabase, config: AppConfig, allowCandidate = false): void {
  if (config.dataProfile !== PUBLIC_MULTIMEDIA_PROFILE_ID) throw new ConfigError("PROFILE_MIX", "public multimedia profile is required");
  const location = database.location();
  if (!location) throw new ConfigError("PROFILE_PATH_MIX", "public multimedia database must be file-backed");
  const name = basename(location);
  if (name !== basename(PUBLIC_MULTIMEDIA_SQLITE_PATH) && !(allowCandidate && /^public-multimedia-candidate-[a-f0-9]{16}\.sqlite$/.test(name))) {
    throw new ConfigError("PROFILE_PATH_MIX", "database file does not match the selected public multimedia profile");
  }
  assertSingleDatabase(database);
  const table = database.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='fixture_profile_ledger'").get() as JsonRecord | undefined;
  if (table) {
    const rows = database.prepare("SELECT profile_id FROM fixture_profile_ledger").all() as JsonRecord[];
    if (rows.some((row) => row.profile_id !== PUBLIC_MULTIMEDIA_PROFILE_ID)) {
      throw new ConfigError("PROFILE_LEDGER_MIX", "database contains a different fixture profile");
    }
  }
}

function secureReadProjectFile(projectRoot: string, relativePath: string): Buffer {
  const root = resolve(/* turbopackIgnore: true */ projectRoot);
  const path = resolve(/* turbopackIgnore: true */ root, relativePath);
  const rel = relative(root, path);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ConfigError("RECEIPT_PATH", "legacy receipt artifact escaped the project root");
  }
  let current = root;
  for (const part of rel.split(sep)) {
    current = resolve(/* turbopackIgnore: true */ current, part);
    const component = lstatSync(current);
    if (component.isSymbolicLink()) throw new ConfigError("RECEIPT_PATH", "legacy receipt artifact path contains a symlink");
  }
  const before = lstatSync(path);
  const uid = process.getuid?.();
  if (!before.isFile() || before.nlink !== 1 || uid === undefined || before.uid !== uid || (before.mode & 0o022) !== 0) {
    throw new ConfigError("RECEIPT_PATH", "legacy receipt artifact is not an owner-controlled regular file");
  }
  const noFollow = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
  if (typeof noFollow !== "number") throw new ConfigError("RECEIPT_PATH", "O_NOFOLLOW is unavailable");
  const descriptor = openSync(path, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.nlink !== 1 || opened.uid !== uid) {
      throw new ConfigError("RECEIPT_PATH", "legacy receipt artifact changed before read");
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) throw new ConfigError("RECEIPT_PATH", "legacy receipt artifact was truncated");
      offset += count;
    }
    const after = fstatSync(descriptor);
    const pathAfter = lstatSync(path);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || pathAfter.dev !== opened.dev || pathAfter.ino !== opened.ino || pathAfter.isSymbolicLink()) {
      throw new ConfigError("RECEIPT_PATH", "legacy receipt artifact changed during read");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function verifyReceiptEnvelope(bytes: Buffer, expected: JsonRecord): JsonRecord {
  let receipt: JsonRecord;
  try { receipt = record(JSON.parse(bytes.toString("utf8")), "RECEIPT_TAMPER"); }
  catch { throw new ConfigError("RECEIPT_TAMPER", "closed receipt is not valid JSON"); }
  if (`${canonicalJson(receipt)}\n` !== bytes.toString("utf8")) throw new ConfigError("RECEIPT_TAMPER", "closed receipt bytes are not canonical");
  const claimed = receipt.receiptSha256;
  const core = { ...receipt };
  delete core.receiptSha256;
  if (typeof claimed !== "string" || sha256(canonicalJson(core)) !== claimed) throw new ConfigError("RECEIPT_TAMPER", "closed receipt self-hash changed");
  const expectedKeys = [...Object.keys(expected), "validatedAt", "receiptSha256"].sort();
  if (canonicalJson(Object.keys(receipt).sort()) !== canonicalJson(expectedKeys)) throw new ConfigError("RECEIPT_TAMPER", "closed receipt fields changed");
  for (const [key, value] of Object.entries(expected)) {
    if (canonicalJson(receipt[key]) !== canonicalJson(value)) throw new ConfigError("RECEIPT_TAMPER", "closed receipt binding changed");
  }
  if (typeof receipt.validatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.validatedAt)) {
    throw new ConfigError("RECEIPT_TAMPER", "closed receipt timestamp is invalid");
  }
  const validatedAt = Date.parse(receipt.validatedAt);
  const age = Date.now() - validatedAt;
  if (!Number.isFinite(validatedAt) || age < -300_000 || age > 24 * 60 * 60 * 1_000) {
    throw new ConfigError("RECEIPT_STALE", "closed receipt is outside the accepted freshness window");
  }
  return receipt;
}

export function assertLegacyClosedReceipts(projectRoot: string): void {
  for (const item of CLOSED_RECEIPTS) {
    const expected = LEGACY_RECEIPT_EXPECTATIONS[item.profile];
    const receipt = verifyReceiptEnvelope(secureReadProjectFile(projectRoot, item.path), expected as unknown as JsonRecord);
    const dbPath = resolve(/* turbopackIgnore: true */ projectRoot, item.db);
    if (
      sha256(secureReadProjectFile(projectRoot, item.db)) !== receipt.closedDbSha256 ||
      existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`)
    ) throw new ConfigError("RECEIPT_OLD_BYTE_DRIFT", "legacy closed receipt no longer binds the closed database");
  }
  verifyReceiptEnvelope(
    secureReadProjectFile(projectRoot, PUBLIC_DATA_RECEIPT),
    PUBLIC_DATA_RECEIPT_EXPECTATION as unknown as JsonRecord
  );
  const validatorArtifacts = ["app/src/server/db/closed-receipt.ts", "app/scripts/profile-closed-receipt.ts"].map((path) => ({
    path,
    sha256: sha256(secureReadProjectFile(projectRoot, path))
  }));
  if (sha256(canonicalJson(validatorArtifacts)) !== CLOSED_VALIDATOR_SHA256) {
    throw new ConfigError("RECEIPT_VALIDATOR", "closed receipt validator artifacts changed");
  }
}

export function publicMultimediaMigrationSelector(projectRoot: string): ReadonlyArray<{ id: string; path: string; sha256: string; sql: string }> {
  const selector = MIGRATIONS.map((migration) => {
    const sql = readFileSync(/* turbopackIgnore: true */ resolve(/* turbopackIgnore: true */ projectRoot, migration.path), "utf8");
    if (sha256(sql) !== migration.sha256) throw new ConfigError("MIGRATION_DRIFT", "public multimedia migration changed");
    return { ...migration, sql };
  });
  const root = sha256(canonicalJson(selector.map(({ path, sha256: migrationSha }) => ({ path, sha256: migrationSha }))));
  if (root !== PUBLIC_MULTIMEDIA_MIGRATION_SELECTOR_ROOT_SHA256) {
    throw new ConfigError("MIGRATION_SELECTOR_DRIFT", "public multimedia migration selector root changed");
  }
  return selector;
}

function assertMigrationLedger(database: SqliteDatabase, projectRoot: string): void {
  const selector = publicMultimediaMigrationSelector(projectRoot);
  const rows = database.prepare("SELECT migration_id, applied_at, sqlite_version, migration_sha256, append_only FROM migration_ledger ORDER BY rowid").all() as JsonRecord[];
  if (rows.length !== 3 || rows.some((row, index) =>
    row.migration_id !== selector[index].id || row.migration_sha256 !== selector[index].sha256 || Number(row.append_only) !== 1 ||
    typeof row.applied_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.applied_at) ||
    new Date(row.applied_at).toISOString() !== row.applied_at ||
    typeof row.sqlite_version !== "string" || !/^\d+\.\d+\.\d+$/.test(row.sqlite_version) ||
    row.sqlite_version.split(".").map(Number).reduce((value, part) => value * 1_000 + part, 0) < 3_051_003
  )) throw new ConfigError("MIGRATION_LEDGER", "public multimedia migration ledger is not the exact selector");
  const appliedTimes = rows.map((row) => Date.parse(String(row.applied_at)));
  if (appliedTimes.some((value, index) => index > 0 && value < appliedTimes[index - 1])) {
    throw new ConfigError("MIGRATION_LEDGER", "public multimedia migration timestamps are out of order");
  }
  if (readSqliteRuntime(database).userVersion !== 3) throw new ConfigError("MIGRATION_VERSION", "public multimedia user_version must be 3");
  if (readDatabaseSchemaFingerprint(database) !== PUBLIC_MULTIMEDIA_SCHEMA_FINGERPRINT_SHA256) {
    throw new ConfigError("MIGRATION_SCHEMA", "public multimedia schema fingerprint changed");
  }
  const objects = (database.prepare("SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as JsonRecord[])
    .map((row) => `${String(row.type)}:${String(row.name)}`);
  if (canonicalJson(objects) !== canonicalJson(PUBLIC_MULTIMEDIA_SCHEMA_OBJECTS)) {
    throw new ConfigError("MIGRATION_SCHEMA", "public multimedia schema object manifest changed");
  }
  assertSingleDatabase(database);
}

export function migratePublicMultimediaDatabase(database: SqliteDatabase, projectRoot: string): { applied: string[]; userVersion: 3; schemaFingerprintSha256: string; migrationSelectorRootSha256: string } {
  const selector = publicMultimediaMigrationSelector(projectRoot);
  const current = readSqliteRuntime(database).userVersion;
  if (current !== 0 && current !== 3) throw new ConfigError("MIGRATION_VERSION", "public multimedia database is partial or ahead");
  const applied: string[] = [];
  if (current === 0) {
    const existing = Number((database.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get() as JsonRecord).count);
    if (existing !== 0) throw new ConfigError("MIGRATION_PRECLAIM", "public multimedia database is not empty");
    for (const [index, migration] of selector.entries()) {
      withImmediateTransaction(database, () => {
        database.exec(migration.sql);
        database.exec(`PRAGMA user_version=${index + 1};`);
        database.prepare("INSERT INTO migration_ledger (migration_id, applied_at, sqlite_version, migration_sha256, append_only) VALUES (?, ?, ?, ?, 1)")
          .run(migration.id, new Date().toISOString(), readSqliteRuntime(database).sqliteVersion, migration.sha256);
      });
      applied.push(migration.id);
    }
  }
  assertMigrationLedger(database, projectRoot);
  return {
    applied,
    userVersion: 3,
    schemaFingerprintSha256: PUBLIC_MULTIMEDIA_SCHEMA_FINGERPRINT_SHA256,
    migrationSelectorRootSha256: PUBLIC_MULTIMEDIA_MIGRATION_SELECTOR_ROOT_SHA256
  };
}

function sqlValue(field: string, value: unknown): null | string | number {
  if ((field === "canonical_url_valid" || field === "enabled") && typeof value === "boolean") return value ? 1 : 0;
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  throw new ConfigError("PUBLIC_MULTIMEDIA_FIXTURE_SCHEMA", "source field is not scalar");
}

function profileLedgerRoot(): string {
  return sha256(canonicalJson({
    profile_id: PUBLIC_MULTIMEDIA_PROFILE_ID,
    sqlite_path: "app/.local/f1plus1-public-multimedia-synthetic.sqlite",
    contract_version: "public-read-v0.2",
    fixture_set: FIXTURE_SET,
    fixture_manifest_hash: PUBLIC_MULTIMEDIA_MANIFEST_FILE_SHA256,
    fixture_graph_hash: PUBLIC_MULTIMEDIA_GRAPH_ROOT_SHA256,
    row_counts: PUBLIC_MULTIMEDIA_PROFILE_COUNTS,
    manifest_root_sha256: PUBLIC_MULTIMEDIA_MANIFEST_ROOT_SHA256,
    generator_root_sha256: PUBLIC_MULTIMEDIA_GENERATOR_ROOT_SHA256,
    validator_root_sha256: PUBLIC_MULTIMEDIA_VALIDATOR_ROOT_SHA256,
    migration_selector_root_sha256: PUBLIC_MULTIMEDIA_MIGRATION_SELECTOR_ROOT_SHA256,
    schema_fingerprint_sha256: PUBLIC_MULTIMEDIA_SCHEMA_FINGERPRINT_SHA256,
    synthetic_only: true,
    external_calls: 0,
    writes_to_base: false,
    real_content_imported: false,
    real_media: 0
  }));
}

export const PUBLIC_MULTIMEDIA_PROFILE_LEDGER_ROOT_SHA256 = profileLedgerRoot();

function expectedCounts(database: SqliteDatabase): JsonRecord {
  return {
    sources: countTable(database, "source_config_fixture"),
    captured_items: countTable(database, "public_captured_item"),
    contents: countTable(database, "public_content"),
    events: 0,
    summaries: countTable(database, "public_summary"),
    media_candidates: countTable(database, "public_media_candidate"),
    release_bundles: countTable(database, "public_release_bundle"),
    review_decisions: countTable(database, "public_review_decision"),
    publications: countTable(database, "public_publication"),
    outbox_jobs: 0,
    published_projections: countTable(database, "published_projection")
  };
}

function assertStoredGraph(database: SqliteDatabase, graph: RuntimeGraph): void {
  if (canonicalJson(expectedCounts(database)) !== canonicalJson(PUBLIC_MULTIMEDIA_PROFILE_COUNTS)) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_SEED_DRIFT", "public multimedia row counts changed");
  }
  const source = database.prepare(`SELECT ${SOURCE_REQUIRED_FIELDS.join(", ")} FROM source_config_fixture`).get() as JsonRecord | undefined;
  if (!source) throw new ConfigError("PUBLIC_MULTIMEDIA_SEED_DRIFT", "source row is missing");
  const normalized = Object.fromEntries(SOURCE_REQUIRED_FIELDS.map((field) => [field,
    field === "canonical_url_valid" || field === "enabled" ? Number(source[field]) === 1 : source[field]
  ]));
  if (canonicalJson(normalized) !== canonicalJson(graph.sources[0])) throw new ConfigError("PUBLIC_MULTIMEDIA_SEED_DRIFT", "source row changed");
  for (const [key, table] of DOMAIN_TABLES) {
    const actual = (database.prepare(`SELECT payload_json FROM ${table} ORDER BY payload_json`).all() as JsonRecord[]).map((row) => String(row.payload_json)).sort();
    const expected = graph[key].map(canonicalJson).sort();
    if (canonicalJson(actual) !== canonicalJson(expected)) throw new ConfigError("PUBLIC_MULTIMEDIA_SEED_DRIFT", `${table} payloads changed`);
  }
  const materializedContracts = [
    ["public_captured_item", "capture_id", [["capture_id", "capture_id"], ["source_id", "source_id"], ["content_id", "content_id"]]],
    ["public_content", "content_id", [["content_id", "content_id"], ["source_id", "source_id"], ["capture_id", "capture_id"], ["editorial_category", "editorial_category"], ["content_version_hash", "content_version_hash"], ["content_status", "content_status"], ["published_at", "published_at"]]],
    ["public_summary", "summary_id", [["summary_id", "summary_id"], ["content_id", "content_id"], ["summary_version_hash", "summary_version_hash"], ["summary_status", "summary_status"]]],
    ["public_media_candidate", "media_candidate_id", [["media_candidate_id", "media_candidate_id"], ["content_id", "content_id"], ["media_hash", "media_hash"], ["candidate_status", "candidate_status"]]],
    ["public_release_bundle", "release_bundle_id", [["release_bundle_id", "release_bundle_id"], ["content_id", "content_id"], ["summary_id", "summary_id"], ["bundle_hash", "bundle_hash"], ["release_status", "release_status"], ["immutable", "immutable"]]],
    ["public_review_decision", "review_decision_id", [["review_decision_id", "review_decision_id"], ["content_id", "content_id"], ["summary_id", "summary_id"], ["release_bundle_id", "release_bundle_id"], ["approved_bundle_hash", "approved_bundle_hash"], ["decision", "decision"], ["immutable", "immutable"]]],
    ["public_publication", "publication_id", [["publication_id", "publication_id"], ["content_id", "content_id"], ["summary_id", "summary_id"], ["release_bundle_id", "release_bundle_id"], ["public_id", "public_id"], ["approved_bundle_hash", "approved_bundle_hash"], ["published_version_hash", "published_version_hash"], ["publication_status", "publication_status"], ["published_at", "published_at"]]],
    ["published_projection", "projection_id", [["projection_id", "projection_id"], ["public_id", "public_id"], ["content_id", "content_id"], ["summary_id", "summary_id"], ["release_bundle_id", "release_bundle_id"], ["published_version_hash", "published_version_hash"], ["projection_status", "projection_status"], ["synthetic_only", "synthetic_only"], ["external_calls", "external_calls"]]]
  ] as const;
  for (const [table, id, fields] of materializedContracts) {
    const rows = database.prepare(`SELECT * FROM ${table} ORDER BY ${id}`).all() as JsonRecord[];
    for (const row of rows) {
      const payload = record(JSON.parse(String(row.payload_json)));
      for (const [column, key] of fields) {
        const expected = key === "immutable" || key === "synthetic_only"
          ? payload[key] === true ? 1 : 0
          : payload[key];
        if (row[column] !== expected) throw new ConfigError("PUBLIC_MULTIMEDIA_SEED_DRIFT", `${table}.${column} changed`);
      }
    }
  }
  const bundleRows = database.prepare("SELECT media_presentations_json, payload_json FROM public_release_bundle ORDER BY release_bundle_id").all() as JsonRecord[];
  for (const row of bundleRows) {
    const payload = record(JSON.parse(String(row.payload_json)));
    const canonicalPayload = record(payload.canonical_payload);
    if (row.media_presentations_json !== canonicalJson(canonicalPayload.media_presentations)) {
      throw new ConfigError("PUBLIC_MULTIMEDIA_SEED_DRIFT", "immutable media presentations changed");
    }
  }
  const fk = database.prepare("PRAGMA foreign_key_check").all();
  if (fk.length !== 0) throw new ConfigError("PUBLIC_MULTIMEDIA_SEED_DRIFT", "foreign-key check failed");
}

function assertLedger(database: SqliteDatabase): void {
  const ledger = database.prepare("SELECT * FROM fixture_profile_ledger").get() as JsonRecord | undefined;
  if (!ledger ||
    ledger.profile_id !== PUBLIC_MULTIMEDIA_PROFILE_ID ||
    ledger.sqlite_path !== "app/.local/f1plus1-public-multimedia-synthetic.sqlite" ||
    ledger.contract_version !== "public-read-v0.2" ||
    ledger.fixture_set !== FIXTURE_SET ||
    ledger.fixture_manifest_hash !== PUBLIC_MULTIMEDIA_MANIFEST_FILE_SHA256 ||
    ledger.fixture_graph_hash !== PUBLIC_MULTIMEDIA_GRAPH_ROOT_SHA256 ||
    ledger.row_counts_json !== canonicalJson(PUBLIC_MULTIMEDIA_PROFILE_COUNTS) ||
    ledger.manifest_root_sha256 !== PUBLIC_MULTIMEDIA_MANIFEST_ROOT_SHA256 ||
    ledger.generator_root_sha256 !== PUBLIC_MULTIMEDIA_GENERATOR_ROOT_SHA256 ||
    ledger.validator_root_sha256 !== PUBLIC_MULTIMEDIA_VALIDATOR_ROOT_SHA256 ||
    ledger.migration_selector_root_sha256 !== PUBLIC_MULTIMEDIA_MIGRATION_SELECTOR_ROOT_SHA256 ||
    ledger.schema_fingerprint_sha256 !== PUBLIC_MULTIMEDIA_SCHEMA_FINGERPRINT_SHA256 ||
    ledger.profile_ledger_root_sha256 !== PUBLIC_MULTIMEDIA_PROFILE_LEDGER_ROOT_SHA256 ||
    Number(ledger.synthetic_only) !== 1 || Number(ledger.external_calls) !== 0 || Number(ledger.writes_to_base) !== 0 ||
    Number(ledger.real_content_imported) !== 0 || Number(ledger.real_media) !== 0
    || ledger.recorded_at !== "2026-08-09T00:00:00Z"
  ) throw new ConfigError("PROFILE_LEDGER_DRIFT", "public multimedia profile ledger changed");
}

export type PublicMultimediaSeedResult = {
  profileId: typeof PUBLIC_MULTIMEDIA_PROFILE_ID;
  contractVersion: "public-read-v0.2";
  fixtureSet: typeof FIXTURE_SET;
  rowCounts: typeof PUBLIC_MULTIMEDIA_PROFILE_COUNTS;
  fixtureGraphHash: string;
  migrationSelectorRootSha256: string;
  schemaFingerprintSha256: string;
  profileLedgerRootSha256: string;
  syntheticOnly: true;
  externalCalls: 0;
  writesToBase: false;
  realMedia: 0;
  inserted: boolean;
};

type RuntimeDatabaseState = {
  database?: SqliteDatabase;
  absolutePath?: string;
  exitHookInstalled?: boolean;
};

const runtimeDatabaseState = (() => {
  const key = Symbol.for("f1plus1.publicMultimediaRuntimeDatabase");
  const shared = globalThis as typeof globalThis & { [key]?: RuntimeDatabaseState };
  return shared[key] ??= {};
})();

export function withPublicMultimediaRuntimeDatabase<T>(
  config: AppConfig,
  appRoot: string,
  projectRoot: string,
  callback: (database: SqliteDatabase) => T
): T {
  if (config.dataProfile !== PUBLIC_MULTIMEDIA_PROFILE_ID || config.dbPath !== PUBLIC_MULTIMEDIA_SQLITE_PATH) {
    throw new ConfigError("PROFILE_MIX", "runtime database requires the canonical public multimedia profile");
  }
  const absolutePath = resolve(/* turbopackIgnore: true */ appRoot, config.dbPath);
  assertLegacyClosedReceipts(projectRoot);
  if (runtimeDatabaseState.database && runtimeDatabaseState.absolutePath !== absolutePath) {
    throw new ConfigError("PROFILE_PATH_MIX", "runtime process cannot switch SQLite profiles");
  }
  if (!runtimeDatabaseState.database) {
    runtimeDatabaseState.database = openSafeDatabase(config.dbPath, { appRoot });
    runtimeDatabaseState.absolutePath = absolutePath;
    if (!runtimeDatabaseState.exitHookInstalled) {
      runtimeDatabaseState.exitHookInstalled = true;
      process.once("exit", () => {
        runtimeDatabaseState.database?.close();
        runtimeDatabaseState.database = undefined;
        runtimeDatabaseState.absolutePath = undefined;
      });
    }
  }
  assertSingleDatabase(runtimeDatabaseState.database);
  return callback(runtimeDatabaseState.database);
}

function seedResult(inserted: boolean): PublicMultimediaSeedResult {
  return {
    profileId: PUBLIC_MULTIMEDIA_PROFILE_ID,
    contractVersion: "public-read-v0.2",
    fixtureSet: FIXTURE_SET,
    rowCounts: PUBLIC_MULTIMEDIA_PROFILE_COUNTS,
    fixtureGraphHash: PUBLIC_MULTIMEDIA_GRAPH_ROOT_SHA256,
    migrationSelectorRootSha256: PUBLIC_MULTIMEDIA_MIGRATION_SELECTOR_ROOT_SHA256,
    schemaFingerprintSha256: PUBLIC_MULTIMEDIA_SCHEMA_FINGERPRINT_SHA256,
    profileLedgerRootSha256: PUBLIC_MULTIMEDIA_PROFILE_LEDGER_ROOT_SHA256,
    syntheticOnly: true,
    externalCalls: 0,
    writesToBase: false,
    realMedia: 0,
    inserted
  };
}

function assertPublicMultimediaSeededAtPath(database: SqliteDatabase, config: AppConfig, projectRoot: string, allowCandidate: boolean): PublicMultimediaSeedResult {
  assertMultimediaDatabaseProfile(database, config, allowCandidate);
  assertMigrationLedger(database, projectRoot);
  const { graph } = assertRuntimeArtifacts(projectRoot);
  assertLedger(database);
  assertStoredGraph(database, graph);
  return seedResult(false);
}

export function assertPublicMultimediaSeeded(database: SqliteDatabase, config: AppConfig, projectRoot: string): PublicMultimediaSeedResult {
  return assertPublicMultimediaSeededAtPath(database, config, projectRoot, false);
}

export function seedPublicMultimediaFixture(
  database: SqliteDatabase,
  config: AppConfig,
  projectRoot: string,
  options: { testOnlyFailAfterWrites?: number; allowCandidatePath?: boolean } = {}
): PublicMultimediaSeedResult {
  assertMultimediaDatabaseProfile(database, config, options.allowCandidatePath === true);
  assertMigrationLedger(database, projectRoot);
  const { graph } = assertRuntimeArtifacts(projectRoot);
  if (countTable(database, "fixture_profile_ledger") === 1) return assertPublicMultimediaSeeded(database, config, projectRoot);
  if (countTable(database, "fixture_profile_ledger") !== 0 || countTable(database, "source_config_fixture") !== 0 || DOMAIN_TABLES.some(([, table]) => countTable(database, table) !== 0)) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_SEED_PARTIAL", "rows exist without the accepted ledger");
  }
  let writes = 0;
  const marked = (): void => {
    writes += 1;
    if (options.testOnlyFailAfterWrites === writes) throw new Error("PUBLIC_MULTIMEDIA_SEED_FAULT_INJECTED");
  };
  withImmediateTransaction(database, () => {
    database.prepare(`INSERT INTO source_config_fixture (${SOURCE_REQUIRED_FIELDS.join(",")}) VALUES (${SOURCE_REQUIRED_FIELDS.map(() => "?").join(",")})`)
      .run(...SOURCE_REQUIRED_FIELDS.map((field) => sqlValue(field, graph.sources[0][field])));
    marked();
    const statements = {
      captured_items: database.prepare("INSERT INTO public_captured_item (capture_id,source_id,content_id,payload_json) VALUES (?,?,?,?)"),
      contents: database.prepare("INSERT INTO public_content (content_id,source_id,capture_id,editorial_category,content_version_hash,content_status,published_at,payload_json) VALUES (?,?,?,?,?,?,?,?)"),
      summaries: database.prepare("INSERT INTO public_summary (summary_id,content_id,summary_version_hash,summary_status,payload_json) VALUES (?,?,?,?,?)"),
      media_candidates: database.prepare("INSERT INTO public_media_candidate (media_candidate_id,content_id,media_hash,candidate_status,payload_json) VALUES (?,?,?,?,?)"),
      release_bundles: database.prepare("INSERT INTO public_release_bundle (release_bundle_id,content_id,summary_id,bundle_hash,release_status,immutable,media_presentations_json,payload_json) VALUES (?,?,?,?,?,?,?,?)"),
      review_decisions: database.prepare("INSERT INTO public_review_decision (review_decision_id,content_id,summary_id,release_bundle_id,approved_bundle_hash,decision,immutable,payload_json) VALUES (?,?,?,?,?,?,?,?)"),
      publications: database.prepare("INSERT INTO public_publication (publication_id,content_id,summary_id,release_bundle_id,public_id,approved_bundle_hash,published_version_hash,publication_status,published_at,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?)"),
      published_projections: database.prepare("INSERT INTO published_projection (projection_id,public_id,content_id,summary_id,release_bundle_id,published_version_hash,projection_status,synthetic_only,external_calls,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?)")
    };
    for (const row of graph.captured_items) { statements.captured_items.run(row.capture_id as string,row.source_id as string,row.content_id as string,canonicalJson(row)); marked(); }
    for (const row of graph.contents) { statements.contents.run(row.content_id as string,row.source_id as string,row.capture_id as string,row.editorial_category as string,row.content_version_hash as string,row.content_status as string,row.published_at as string,canonicalJson(row)); marked(); }
    for (const row of graph.summaries) { statements.summaries.run(row.summary_id as string,row.content_id as string,row.summary_version_hash as string,row.summary_status as string,canonicalJson(row)); marked(); }
    for (const row of graph.media_candidates) { statements.media_candidates.run(row.media_candidate_id as string,row.content_id as string,row.media_hash as string,row.candidate_status as string,canonicalJson(row)); marked(); }
    for (const row of graph.release_bundles) {
      const payload = record(row.canonical_payload);
      statements.release_bundles.run(row.release_bundle_id as string,row.content_id as string,row.summary_id as string,row.bundle_hash as string,row.release_status as string,row.immutable === true ? 1 : 0,canonicalJson(payload.media_presentations),canonicalJson(row)); marked();
    }
    for (const row of graph.review_decisions) { statements.review_decisions.run(row.review_decision_id as string,row.content_id as string,row.summary_id as string,row.release_bundle_id as string,row.approved_bundle_hash as string,row.decision as string,row.immutable === true ? 1 : 0,canonicalJson(row)); marked(); }
    for (const row of graph.publications) { statements.publications.run(row.publication_id as string,row.content_id as string,row.summary_id as string,row.release_bundle_id as string,row.public_id as string,row.approved_bundle_hash as string,row.published_version_hash as string,row.publication_status as string,row.published_at as string,canonicalJson(row)); marked(); }
    for (const row of graph.published_projections) { statements.published_projections.run(row.projection_id as string,row.public_id as string,row.content_id as string,row.summary_id as string,row.release_bundle_id as string,row.published_version_hash as string,row.projection_status as string,1,0,canonicalJson(row)); marked(); }
    database.prepare("INSERT INTO fixture_profile_ledger (profile_id,sqlite_path,contract_version,fixture_set,fixture_manifest_hash,fixture_graph_hash,row_counts_json,synthetic_only,external_calls,writes_to_base,real_content_imported,manifest_root_sha256,profile_ledger_root_sha256,generator_root_sha256,validator_root_sha256,migration_selector_root_sha256,schema_fingerprint_sha256,real_media,recorded_at) VALUES (?,?,?,?,?,?,?,1,0,0,0,?,?,?,?,?,?,0,?)")
      .run(PUBLIC_MULTIMEDIA_PROFILE_ID,"app/.local/f1plus1-public-multimedia-synthetic.sqlite","public-read-v0.2",FIXTURE_SET,PUBLIC_MULTIMEDIA_MANIFEST_FILE_SHA256,PUBLIC_MULTIMEDIA_GRAPH_ROOT_SHA256,canonicalJson(PUBLIC_MULTIMEDIA_PROFILE_COUNTS),PUBLIC_MULTIMEDIA_MANIFEST_ROOT_SHA256,PUBLIC_MULTIMEDIA_PROFILE_LEDGER_ROOT_SHA256,PUBLIC_MULTIMEDIA_GENERATOR_ROOT_SHA256,PUBLIC_MULTIMEDIA_VALIDATOR_ROOT_SHA256,PUBLIC_MULTIMEDIA_MIGRATION_SELECTOR_ROOT_SHA256,PUBLIC_MULTIMEDIA_SCHEMA_FINGERPRINT_SHA256,"2026-08-09T00:00:00Z");
    marked();
    assertLedger(database);
    assertStoredGraph(database, graph);
  });
  return seedResult(true);
}

export function createPublicMultimediaCanonical(config: AppConfig, appRoot: string, projectRoot: string): PublicMultimediaSeedResult {
  if (config.dataProfile !== PUBLIC_MULTIMEDIA_PROFILE_ID || config.dbPath !== PUBLIC_MULTIMEDIA_SQLITE_PATH) {
    throw new ConfigError("PROFILE_MIX", "controlled creation requires the canonical public multimedia profile");
  }
  assertLegacyClosedReceipts(projectRoot);
  assertRuntimeArtifacts(projectRoot);
  const canonicalPath = resolve(/* turbopackIgnore: true */ appRoot, config.dbPath);
  recoverInterruptedPublicMultimediaInstall(config, appRoot, projectRoot);
  if (existsSync(canonicalPath)) {
    const existing = openSafeDatabase(config.dbPath, { appRoot });
    try { return assertPublicMultimediaSeeded(existing, config, projectRoot); }
    finally { closeDatabase(existing); }
  }
  const candidateName = `public-multimedia-candidate-${randomBytes(8).toString("hex")}.sqlite`;
  const candidateRelative = `.local/${candidateName}`;
  const candidatePath = resolve(/* turbopackIgnore: true */ appRoot, candidateRelative);
  let database: SqliteDatabase | undefined;
  try {
    database = openSafeDatabase(candidateRelative, { appRoot });
    migratePublicMultimediaDatabase(database, projectRoot);
    const result = seedPublicMultimediaFixture(database, config, projectRoot, { allowCandidatePath: true });
    database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    closeDatabase(database);
    database = undefined;
    if (existsSync(`${candidatePath}-wal`) || existsSync(`${candidatePath}-shm`) || existsSync(canonicalPath)) {
      throw new ConfigError("PUBLIC_MULTIMEDIA_INSTALL", "candidate is not closed or canonical appeared concurrently");
    }
    const stat = lstatSync(candidatePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || basename(candidatePath) !== candidateName) {
      throw new ConfigError("PUBLIC_MULTIMEDIA_INSTALL", "candidate identity changed before install");
    }
    const verifier = openReadOnlyCandidate(candidatePath);
    try {
      assertPublicMultimediaSeededAtPath(verifier, config, projectRoot, true);
    } finally {
      closeDatabase(verifier);
    }
    removeReadOnlyVerificationSidecars(candidatePath);
    if (existsSync(`${candidatePath}-wal`) || existsSync(`${candidatePath}-shm`)) {
      throw new ConfigError("PUBLIC_MULTIMEDIA_INSTALL", "verified candidate did not close cleanly");
    }
    installCandidateNoReplace(candidatePath, canonicalPath);
    return result;
  } catch (error) {
    if (database) closeDatabase(database);
    for (const path of [candidatePath, `${candidatePath}-wal`, `${candidatePath}-shm`]) {
      if (existsSync(path)) unlinkSync(path);
    }
    throw error;
  }
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function installCandidateNoReplace(candidatePath: string, canonicalPath: string): void {
  linkSync(candidatePath, canonicalPath);
  const candidate = lstatSync(candidatePath);
  const canonical = lstatSync(canonicalPath);
  if (!candidate.isFile() || candidate.isSymbolicLink() || !canonical.isFile() || canonical.isSymbolicLink() ||
      candidate.dev !== canonical.dev || candidate.ino !== canonical.ino || candidate.nlink !== 2 || canonical.nlink !== 2) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_INSTALL", "atomic no-replace link identity check failed");
  }
  syncDirectory(dirname(canonicalPath));
  unlinkSync(candidatePath);
  syncDirectory(dirname(canonicalPath));
  const installed = lstatSync(canonicalPath);
  if (!installed.isFile() || installed.isSymbolicLink() || installed.nlink !== 1 || (installed.mode & 0o077) !== 0) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_INSTALL", "installed canonical identity is invalid");
  }
  chmodSync(canonicalPath, 0o600);
}

function openReadOnlyCandidate(path: string): SqliteDatabase {
  const database = new DatabaseSync(path, { readOnly: true, allowExtension: false, defensive: true, timeout: 250 } as ConstructorParameters<typeof DatabaseSync>[1]);
  const constants = sqliteConstants as unknown as Record<string, number>;
  (database as SqliteDatabase & { setAuthorizer(callback: (actionCode: number) => number): void }).setAuthorizer((actionCode) =>
    actionCode === constants.SQLITE_ATTACH || actionCode === constants.SQLITE_DETACH ? constants.SQLITE_DENY : constants.SQLITE_OK
  );
  database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=250; PRAGMA trusted_schema=OFF;");
  return database;
}

function removeReadOnlyVerificationSidecars(candidatePath: string): void {
  const walPath = `${candidatePath}-wal`;
  const shmPath = `${candidatePath}-shm`;
  const present = [walPath, shmPath].filter(existsSync);
  if (present.length === 0) return;
  if (present.length !== 2) throw new ConfigError("PUBLIC_MULTIMEDIA_INSTALL", "read-only verification left an incomplete sidecar pair");
  const uid = process.getuid?.();
  const wal = lstatSync(walPath);
  const shm = lstatSync(shmPath);
  if (uid === undefined || !wal.isFile() || wal.isSymbolicLink() || wal.nlink !== 1 || wal.uid !== uid || (wal.mode & 0o077) !== 0 || wal.size !== 0 ||
      !shm.isFile() || shm.isSymbolicLink() || shm.nlink !== 1 || shm.uid !== uid || (shm.mode & 0o077) !== 0 || shm.size !== 32_768) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_INSTALL", "read-only verification sidecars are not the known empty recovery shape");
  }
  unlinkSync(walPath);
  unlinkSync(shmPath);
  syncDirectory(dirname(candidatePath));
}

function assertPrivateInterruptedLinkPair(candidatePath: string, canonicalPath: string): void {
  const uid = process.getuid?.();
  const candidate = lstatSync(candidatePath);
  const canonical = lstatSync(canonicalPath);
  if (
    uid === undefined ||
    !candidate.isFile() || candidate.isSymbolicLink() || candidate.uid !== uid || (candidate.mode & 0o077) !== 0 ||
    !canonical.isFile() || canonical.isSymbolicLink() || canonical.uid !== uid || (canonical.mode & 0o077) !== 0 ||
    candidate.dev !== canonical.dev || candidate.ino !== canonical.ino || candidate.nlink !== 2 || canonical.nlink !== 2
  ) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_INSTALL", "interrupted candidate is not the private canonical inode");
  }
}

function recoverInterruptedPublicMultimediaInstall(config: AppConfig, appRoot: string, projectRoot: string): void {
  const localRoot = resolve(/* turbopackIgnore: true */ appRoot, ".local");
  const canonicalPath = resolve(/* turbopackIgnore: true */ appRoot, config.dbPath);
  const candidates = readdirSync(localRoot).filter((name) => /^public-multimedia-candidate-[a-f0-9]{16}\.sqlite$/.test(name));
  if (candidates.length === 0) return;
  if (candidates.length !== 1) throw new ConfigError("PUBLIC_MULTIMEDIA_INSTALL", "multiple interrupted candidates require operator review");
  const candidatePath = resolve(/* turbopackIgnore: true */ localRoot, candidates[0]);
  if (existsSync(`${candidatePath}-wal`) || existsSync(`${candidatePath}-shm`)) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_INSTALL", "interrupted candidate has live sidecars");
  }
  if (existsSync(canonicalPath)) {
    assertPrivateInterruptedLinkPair(candidatePath, canonicalPath);
    const verifier = openReadOnlyCandidate(candidatePath);
    try {
      assertPublicMultimediaSeededAtPath(verifier, config, projectRoot, true);
    } finally {
      closeDatabase(verifier);
    }
    removeReadOnlyVerificationSidecars(candidatePath);
    assertPrivateInterruptedLinkPair(candidatePath, canonicalPath);
    unlinkSync(candidatePath);
    syncDirectory(localRoot);
    chmodSync(canonicalPath, 0o600);
    return;
  }
  const database = openReadOnlyCandidate(candidatePath);
  try {
    assertPublicMultimediaSeededAtPath(database, config, projectRoot, true);
  } finally {
    closeDatabase(database);
  }
  removeReadOnlyVerificationSidecars(candidatePath);
  if (existsSync(`${candidatePath}-wal`) || existsSync(`${candidatePath}-shm`)) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_INSTALL", "interrupted candidate did not close cleanly");
  }
  installCandidateNoReplace(candidatePath, canonicalPath);
}

export function resetPublicMultimediaCanonical(
  config: AppConfig,
  appRoot: string,
  projectRoot: string
): PublicMultimediaSeedResult & { backupFile: string } {
  if (config.dataProfile !== PUBLIC_MULTIMEDIA_PROFILE_ID || config.dbPath !== PUBLIC_MULTIMEDIA_SQLITE_PATH) {
    throw new ConfigError("PROFILE_MIX", "controlled reset requires the canonical public multimedia profile");
  }
  assertLegacyClosedReceipts(projectRoot);
  const canonicalPath = resolve(/* turbopackIgnore: true */ appRoot, config.dbPath);
  if (!existsSync(canonicalPath)) throw new ConfigError("PUBLIC_MULTIMEDIA_RESET", "canonical public multimedia database is missing");
  if (existsSync(`${canonicalPath}-wal`) || existsSync(`${canonicalPath}-shm`)) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_RESET", "canonical database has live sidecars");
  }
  const predecessor = sha256(secureReadProjectFile(projectRoot, "app/.local/f1plus1-public-multimedia-synthetic.sqlite")) === PREDECESSOR_CANONICAL_SHA256;
  if (!predecessor) {
    const database = openSafeDatabase(config.dbPath, { appRoot });
    try {
      assertPublicMultimediaSeeded(database, config, projectRoot);
      database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } finally {
      closeDatabase(database);
    }
  }
  if (existsSync(`${canonicalPath}-wal`) || existsSync(`${canonicalPath}-shm`)) {
    throw new ConfigError("PUBLIC_MULTIMEDIA_RESET", "canonical database did not close before reset");
  }
  const backupFile = `f1plus1-public-multimedia-synthetic.backup-${randomBytes(8).toString("hex")}.sqlite`;
  const backupPath = resolve(/* turbopackIgnore: true */ appRoot, ".local", backupFile);
  if (existsSync(backupPath)) throw new ConfigError("PUBLIC_MULTIMEDIA_RESET", "reset backup target already exists");
  renameSync(canonicalPath, backupPath);
  try {
    return { ...createPublicMultimediaCanonical(config, appRoot, projectRoot), backupFile: `.local/${backupFile}` };
  } catch (error) {
    if (!existsSync(canonicalPath) && existsSync(backupPath)) renameSync(backupPath, canonicalPath);
    throw error;
  }
}
