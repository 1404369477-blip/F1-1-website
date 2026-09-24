import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BackupSampleConfig, DatabaseSampleConfig } from "../server/site-status/types.ts";

export const TEST_NOW = new Date("2026-09-10T14:00:00.000Z");
export const TEST_SOURCES = ["motorsport-f1-news", "the-race-f1-news", "skysports-f1-news"] as const;
export const testHash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
// Deliberately independent of the sampler encoder, using JSON's replacer traversal.
export const testCanonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const at = (offsetMs: number): string => new Date(TEST_NOW.getTime() + offsetMs).toISOString();
export const testSqliteMasterFingerprint = (db: DatabaseSync): string => testHash(db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
  .all().map(row => [row.type, row.name, row.tbl_name, row.sql ?? ""].join("\x1f")).join("\n"));

export function writeFixtureJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

export function insertRow(db: DatabaseSync, table: string, row: Record<string, unknown>): void {
  const fields = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`)
    .run(...fields.map(field => row[field] as string | number | null));
}

export function createSiteStatusFixture(): { root: string; db: DatabaseSync; config: DatabaseSampleConfig } {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-site-status-"));
  const databasePath = join(root, "review.sqlite"), deploymentManifestPath = join(root, "deployment.json");
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA user_version=10;
    CREATE TABLE source(source_id TEXT PRIMARY KEY,enabled INTEGER,last_attempt_at TEXT,last_success_at TEXT);
    CREATE TABLE source_registry_v1(source_id TEXT PRIMARY KEY,enabled INTEGER,source_stop_status TEXT);
    CREATE TABLE ingest_run(source_id TEXT,slot_key INTEGER,scheduled_at TEXT,started_at TEXT,finished_at TEXT,status TEXT);
    CREATE TABLE pending_review_candidate(candidate_id TEXT PRIMARY KEY,source_id TEXT,source_revision INTEGER,source_payload_hash TEXT,review_status TEXT,first_seen_at TEXT);
    CREATE TABLE machine_summary_draft(candidate_id TEXT,source_revision INTEGER,source_payload_hash TEXT);
    CREATE TABLE review_bundle(bundle_id TEXT PRIMARY KEY,candidate_id TEXT,source_revision INTEGER,source_payload_hash TEXT,bundle_revision INTEGER);
    CREATE TABLE publication(publication_id TEXT PRIMARY KEY,bundle_id TEXT,publication_status TEXT,created_at TEXT);
    CREATE TABLE projection_outbox(status TEXT,created_at TEXT);
    CREATE TABLE internal_control(singleton_id INTEGER PRIMARY KEY,phase TEXT,global_stop_state TEXT,emergency_stop_state TEXT,recovery_state TEXT,
      deletion_fence_state TEXT,publication_fence_state TEXT,writer_epoch INTEGER,recovery_epoch INTEGER,source_config_epoch INTEGER,source_safety_epoch INTEGER,
      authorization_version INTEGER,policy_epoch INTEGER,writer_authority_receipt_sha256 TEXT);
    CREATE TABLE internal_operation(operation_id TEXT PRIMARY KEY,owner_process TEXT,operation_kind TEXT,state TEXT,capability_class TEXT,egress_class TEXT,
      expected_schema_sha256 TEXT,expected_release_sha256 TEXT,expected_manifest_sha256 TEXT,expected_writer_epoch INTEGER,recovery_epoch INTEGER,
      authorization_handoff_id TEXT,request_hash TEXT,created_at TEXT,source_id TEXT,candidate_id TEXT,expected_entity_version INTEGER,expected_entity_hash TEXT);
    CREATE TABLE owner_authorization_handoff(handoff_id TEXT PRIMARY KEY,owner_process TEXT,consumed_by_operation_id TEXT,release_sha256 TEXT,manifest_sha256 TEXT);`);
  // The production valid view and recovery-point constraints are not replaced with a permissive fake.
  const migration = readFileSync(new URL("../../migrations/rss-real/0007_internal_operation_recovery_phase.sql", import.meta.url), "utf8");
  const laterMigration = readFileSync(new URL("../../migrations/rss-real/0017_x_page_production_admission.sql", import.meta.url), "utf8");
  const backupTable = migration.match(/CREATE TABLE backup_recovery_point \([\s\S]*?\n\) STRICT;/)?.[0];
  const validView = laterMigration.match(/CREATE VIEW valid_backup_recovery_point_v1 AS[\s\S]*?;/)?.[0];
  if (!backupTable || !validView) throw new Error("FIXTURE_SCHEMA_MISSING");
  db.exec(backupTable); db.exec(validView);
  insertRow(db, "internal_control", { singleton_id: 1, phase: "live", global_stop_state: "clear", emergency_stop_state: "clear", recovery_state: "ready",
    deletion_fence_state: "clear", publication_fence_state: "clear", writer_epoch: 2, recovery_epoch: 2, source_config_epoch: 2, source_safety_epoch: 2,
    authorization_version: 2, policy_epoch: 2, writer_authority_receipt_sha256: "b".repeat(64) });
  for (const sourceId of TEST_SOURCES) {
    insertRow(db, "source", { source_id: sourceId, enabled: 1, last_attempt_at: at(-600_000), last_success_at: at(-600_000) });
    insertRow(db, "source_registry_v1", { source_id: sourceId, enabled: 1, source_stop_status: "clear" });
    for (const [slot, offset] of [[1, -1_500_000], [2, -600_000]]) insertRow(db, "ingest_run", {
      source_id: sourceId, slot_key: slot, scheduled_at: at(offset), started_at: at(offset), finished_at: at(offset + 1_000), status: "succeeded"
    });
  }
  const expectedSchemaSha256 = testHash(testCanonical(db.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' ORDER BY type,name,tbl_name,sql").all()));
  const stat = statSync(databasePath), expectedReleaseSha256 = "a".repeat(64);
  const deployment = { reviewSchemaTarget: 10, reviewSchemaSha256: expectedSchemaSha256, fullReleaseManifestSha256: expectedReleaseSha256, reviewDatabasePath: databasePath,
    reviewDatabaseIdentity: { dev: stat.dev, ino: stat.ino, uid: stat.uid, nlink: 1 }, rssAutomaticCutoffIso: "2026-09-05T02:30:00.000Z" };
  writeFixtureJson(deploymentManifestPath, deployment);
  return { root, db, config: { databasePath, deploymentManifestPath, expectedSchemaSha256, expectedReleaseSha256,
    expectedDeploymentManifestSha256: testHash(readFileSync(deploymentManifestPath)), expectedDatabaseIdentity: { device: stat.dev, inode: stat.ino, uid: stat.uid },
    busyTimeoutMs: 30, unknownBaseline: { observedAt: at(-60_000), operationIdSha256: [] } } };
}

export function addBackupFixture(fixture: ReturnType<typeof createSiteStatusFixture>, offsetMs = -300_000, options: {
  historicalGenerationCount?: number;
  sqliteMasterSha256?: string;
  mutateMembers?: (members: { relativePath: string; bytes: number; sha256: string }[]) => void;
} = {}) {
  const { db, root, config } = fixture;
  const backupRoot = join(root, "backups"), backupStateRoot = join(root, "backup-state");
  const offKey = generateKeyPairSync("ed25519"), appKey = generateKeyPairSync("ed25519");
  const offHostPublicKeyPath = join(backupStateRoot, "off-host-public.pem"), applicationDrillPublicKeyPath = join(backupStateRoot, "application-public.pem");
  mkdirSync(backupStateRoot, { recursive: true });
  writeFileSync(offHostPublicKeyPath, offKey.publicKey.export({ format: "pem", type: "spki" }));
  writeFileSync(applicationDrillPublicKeyPath, appKey.publicKey.export({ format: "pem", type: "spki" }));
  const backupConfig: BackupSampleConfig = { backupRoot, backupStateRoot, offHostPublicKeyPath, applicationDrillPublicKeyPath,
    expectedOffHostPublicKeySha256: testHash(readFileSync(offHostPublicKeyPath)), expectedApplicationDrillPublicKeySha256: testHash(readFileSync(applicationDrillPublicKeyPath)) };
  const databaseMember = { relativePath: "db/snapshot.sqlite", bytes: 1024, sha256: "c".repeat(64) };
  const activeMember = { relativePath: "projection/active.json", bytes: 250, sha256: "d".repeat(64) };
  const generations = [{ relativePath: `projection/generations/${"e".repeat(64)}.json`, bytes: 512, sha256: "f".repeat(64) }];
  for (let index = 0; index < (options.historicalGenerationCount ?? 0); index++) generations.push({
    relativePath: `projection/generations/${testHash(`historical-generation-${index}`)}.json`, bytes: 1024 + index, sha256: testHash(`historical-generation-file-${index}`)
  });
  const members = [databaseMember, ...generations.sort((left, right) => left.relativePath.localeCompare(right.relativePath)), activeMember];
  options.mutateMembers?.(members);
  const contentHash = testHash(testCanonical(members)), packageId = `${TEST_NOW.getTime() + offsetMs}_${contentHash.slice(0, 16)}`;
  const manifest = { schemaVersion: "backup-snapshot-manifest-v1", kind: "db-projection-snapshot", keyId: "0123456789abcdef",
    recovery_point_at: at(offsetMs), contentHash, userVersion: 10, sqliteMasterSha256: options.sqliteMasterSha256 ?? testSqliteMasterFingerprint(db), members };
  const manifestPath = join(backupRoot, "snap", "packages", packageId, "manifest.json");
  writeFixtureJson(manifestPath, manifest);
  const manifestSha256 = testHash(readFileSync(manifestPath));
  const offPayload = { schemaVersion: "f1plus1-off-host-read-v1", observerRef: "m5-backup-verifier-v1", readStartedAt: at(offsetMs + 500),
    readCompletedAt: at(offsetMs + 900), packageId, recoveryPointAt: at(offsetMs), contentHash, keyId: manifest.keyId,
    manifestSha256, ciphertextSha256: "1".repeat(64), ciphertextBytes: 2048 };
  const appPayload = { schemaVersion: "f1plus1-application-drill-v1", packageId, contentHash, manifestSha256,
    databaseSnapshotSha256: databaseMember.sha256, restoreRootSha256: "2".repeat(64), releaseSha256: config.expectedReleaseSha256,
    deploymentManifestSha256: config.expectedDeploymentManifestSha256, schemaSha256: config.expectedSchemaSha256,
    projectionGeneration: 5, projectionManifestSha256: "e".repeat(64), bootable: true, businessPointVerified: true,
    incidentDeclaredAt: at(offsetMs + 1000), adminAvailableAt: at(offsetMs + 2000), publicAvailableAt: at(offsetMs + 2500),
    completedAt: at(offsetMs + 3000), elapsedMs: 2000, adminResponseSha256: "3".repeat(64), publicResponseSha256: "4".repeat(64),
    adminRuntimeSha256: "5".repeat(64), publicRuntimeSha256: "6".repeat(64) };
  const offReceipt = { payload: offPayload, signature: sign(null, Buffer.from(`f1plus1-off-host-read-v1\n${testCanonical(offPayload)}`), offKey.privateKey).toString("base64url") };
  const appReceipt = { payload: appPayload, signature: sign(null, Buffer.from(`f1plus1-application-drill-v1\n${testCanonical(appPayload)}`), appKey.privateKey).toString("base64url") };
  const offPath = join(backupRoot, "off-host-receipts", `${packageId}.json`), appPath = join(backupStateRoot, "application-receipts", `${packageId}.json`);
  writeFixtureJson(offPath, offReceipt); writeFixtureJson(appPath, appReceipt);
  const offHash = testHash(testCanonical(offReceipt)), appHash = testHash(testCanonical(appReceipt));
  const evidenceHash = testHash(`f1plus1-backup-registration-evidence-v2\n${testCanonical({ applicationDrillReceiptSha256: appHash, offHostReceiptSha256: offHash, backupManifestSha256: manifestSha256 })}`);
  insertRow(db, "owner_authorization_handoff", { handoff_id: "test-backup-handoff", owner_process: "backup_worker", consumed_by_operation_id: "test-backup-operation",
    release_sha256: config.expectedReleaseSha256, manifest_sha256: config.expectedDeploymentManifestSha256 });
  insertRow(db, "internal_operation", { operation_id: "test-backup-operation", owner_process: "backup_worker", operation_kind: "backup", state: "succeeded",
    capability_class: "backup", egress_class: "backup_private", expected_schema_sha256: config.expectedSchemaSha256, expected_release_sha256: config.expectedReleaseSha256,
    expected_manifest_sha256: config.expectedDeploymentManifestSha256, expected_writer_epoch: 2, recovery_epoch: 2,
    authorization_handoff_id: "test-backup-handoff", request_hash: evidenceHash, created_at: at(offsetMs + 3000) });
  insertRow(db, "backup_recovery_point", { recovery_point_id: `rp-${packageId}`, backup_set_id: packageId, backup_manifest_sha256: manifestSha256,
    database_snapshot_sha256: databaseMember.sha256, database_schema_sha256: config.expectedSchemaSha256, sqlite_snapshot_method: "vacuum_into_verified",
    source_db_wal_shm_identity_sha256: "7".repeat(64), file_manifest_sha256: testHash(`f1plus1-snap-file-manifest-v1\n${testCanonical(members)}`),
    total_bytes: members.reduce((sum, member) => sum + member.bytes, 0), release_sha256: config.expectedReleaseSha256,
    deployment_manifest_sha256: config.expectedDeploymentManifestSha256, projection_generation: 5, projection_manifest_sha256: "e".repeat(64), projection_pointer_sha256: activeMember.sha256,
    writer_epoch: 2, recovery_epoch: 2, writer_authority_receipt_sha256: "b".repeat(64), common_checkpoint_sha256: "8".repeat(64),
    recovery_point_at: at(offsetMs), completed_at: at(offsetMs + 4000), rpo_seconds: 900, off_host_verified: 1,
    remote_receipt_sha256: offHash, encrypted: 1, encryption_key_version: manifest.keyId, retention_policy_id: "snap-cycle-v2", restore_drill_state: "verified",
    restore_duration_seconds: 2, drill_isolated: 1, drill_decryption_verified: 1, drill_hash_verified: 1, drill_integrity_verified: 1, drill_fk_verified: 1,
    drill_schema_verified: 1, drill_bootable: 1, drill_business_point_verified: 1, drill_public_pointer_verified: 1,
    incident_declared_at: appPayload.incidentDeclaredAt, admin_available_at: appPayload.adminAvailableAt, public_available_at: appPayload.publicAvailableAt,
    operation_id: "test-backup-operation" });
  return { backupConfig, packageId, manifestPath, offPath, appPath, offReceipt, appReceipt, offKey, appKey };
}
