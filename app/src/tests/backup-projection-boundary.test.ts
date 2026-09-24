// Real SQLite/VACUUM, repository delivery, ProjectionReceiver and cryptographic
// package verification. Synthetic sources/keys; no production or off-host claim.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256Text, runSnapshotOnce, runRestoreDrill, backupLayout, type SnapshotInput } from "../server/backup-snapshot/core.ts";
import { createOffHostReadReceipt } from "../server/backup-snapshot/off-host-receipt.ts";
import { verifyBackupPackageBinding } from "../server/internal-operation/backup-package-binding.ts";
import { ProjectionReceiver, readProjectionSnapshot, signProjectionTaskEnvelope } from "../server/review-real/projection.ts";
import { ReviewRealRepository } from "../server/review-real/repository.ts";
import { runBackupSnapshotCli } from "../../scripts/backup-snapshot-once.ts";

const environments: Array<{ root: string; database: DatabaseSync }> = [];
afterEach(() => environments.splice(0).forEach(env => { env.database.close(); rmSync(env.root, { recursive: true, force: true }); }));
function setup() {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "f1-backup-projection-boundary-"))); chmodSync(root, 0o700);
  const databasePath = join(root, "source.sqlite"), database = new DatabaseSync(databasePath); chmodSync(databasePath, 0o600);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON");
  for (const name of ["0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql",
    "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"]) {
    database.exec(readFileSync(new URL(`../../migrations/rss-real/${name}`, import.meta.url), "utf8"));
  }
  let time = Date.parse("2026-09-07T06:00:00.000Z");
  const repository = new ReviewRealRepository(database, () => new Date(time += 1000));
  const projectionRoot = join(root, "projection"), backupRoot = join(root, "backup"), signing = generateKeyPairSync("ed25519"), observer = generateKeyPairSync("ed25519");
  const receiver = new ProjectionReceiver({ root: projectionRoot, signingKeyId: "synthetic-boundary-key", publicKey: signing.publicKey, now: () => time += 1000 });
  function publish(sequence: number) {
    const id = `boundary-candidate-${sequence}`, hash = String(sequence).repeat(64), at = new Date(time).toISOString();
    database.prepare("INSERT INTO pending_review_candidate (candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,first_seen_at,last_seen_at) VALUES (?,'motorsport-f1-news',?,?,?,'Source','Excerpt','Motorsport.com',?,?,1,?,?)")
      .run(id, `external-${sequence}`, hash, `https://www.motorsport.com/f1/news/boundary-${sequence}/`, at, hash, at, at);
    const revision = repository.revision({ schemaVersion: "admin-review-v0.2", operationId: `boundary-revision-${sequence}`,
      expected: { candidateId: id, sourceRevision: 1, sourceVersionTag: hash.slice(0, 12), latestBundleId: null, latestBundleVersionTag: null },
      editable: { titleZh: `测试投影第${sequence}条`, summaryZh: "数据库快照与投影确认边界测试。", notes: "synthetic" } }, `/api/admin/reviews/${id}/revision`, "synthetic-operator");
    const approved = repository.approve({ schemaVersion: "admin-review-v0.2", operationId: `boundary-approve-${sequence}`,
      expected: { candidateId: id, sourceRevision: 1, bundleId: revision.bundle.id, bundleVersionTag: revision.bundle.versionTag } }, `/api/admin/reviews/${id}/approve`, "synthetic-operator");
    const published = repository.publish({ schemaVersion: "admin-review-v0.2", operationId: `boundary-publish-${sequence}`,
      expected: { publicId: approved.publication.publicId, publishGeneration: 1, publicationStatus: "queued", approvedBundleVersionTag: revision.bundle.versionTag } }, `/api/admin/publications/${approved.publication.publicId}/publish`, "synthetic-operator");
    const task = repository.deliveryTask(published.delivery.id), work = repository.leaseNext("synthetic-operator")!;
    const receipt = receiver.receive(signProjectionTaskEnvelope({ envelopeJson: task.envelopeJson, envelopeHash: task.envelopeHash,
      signingKeyId: "synthetic-boundary-key", privateKey: signing.privateKey }));
    return { work, receipt, acknowledge: () => repository.markDeliverySucceeded(work, receipt, "synthetic-operator") };
  }
  const first = publish(1); first.acknowledge(); const secondDelivery = publish(2);
  const second = { ...secondDelivery, acknowledge: () => {
    // A controlled delayed acknowledgement transaction in this isolated package
    // fixture. Production gateway authorization is not under test here.
    const receipt = secondDelivery.receipt, json = canonicalJson(receipt), committedAt = new Date(time += 1000).toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("INSERT INTO projection_delivery_receipt (delivery_id,snapshot_generation,snapshot_manifest_hash,receipt_json,receipt_hash,receipt_status,received_at,activated_at,committed_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(receipt.deliveryId, receipt.snapshotGeneration, receipt.snapshotManifestHash, json, sha256Text(json), receipt.status, receipt.receivedAt, receipt.activatedAt, committedAt);
      database.prepare("UPDATE projection_outbox SET status='succeeded',lease_token=NULL,lease_expires_at=NULL,last_reason_code=NULL,updated_at=? WHERE delivery_id=? AND status='leased'")
        .run(committedAt, receipt.deliveryId);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  } };
  // This fixture isolates the package boundary. Full schema/gateway readiness is
  // independently enforced at production registration and runtime admission.
  database.exec("CREATE TABLE internal_control(singleton_id INTEGER PRIMARY KEY,phase TEXT); INSERT INTO internal_control VALUES(1,'live'); PRAGMA user_version=10");
  const key = randomBytes(32);
  const input: SnapshotInput = { sourceDbPath: databasePath, projectionRoot, outputDir: backupRoot, key, retain: 4,
    projectionBoundary: "confirmed-delivery-v1", now: () => new Date("2026-09-07T06:04:38.833Z") };
  const pointer = () => JSON.parse(readFileSync(join(projectionRoot, "active.json"), "utf8"));
  function snapshotAndVerify(overrides: Partial<SnapshotInput> = {}) {
    const report = runSnapshotOnce({ ...input, ...overrides }), restoreRoot = join(root, `restore-${report.packageId}`);
    const drillReport = runRestoreDrill({ backupRoot, restoreRoot, key, expectedUserVersion: 10 });
    const offHostReceipt = createOffHostReadReceipt({ backupRoot, packageId: report.packageId!,
      privateKeyPem: observer.privateKey.export({ format: "pem", type: "pkcs8" }).toString(), now: () => new Date("2026-09-07T06:05:00.000Z") });
    const verify = () => verifyBackupPackageBinding({ database, backupRoot, restoreRoot, drillReport, snapshotKey: key,
      projectionSigningKeyId: "synthetic-boundary-key", projectionPublicKeyPem: signing.publicKey.export({ format: "pem", type: "spki" }).toString(),
      offHostReceipt, offHostPublicKeyPem: observer.publicKey.export({ format: "pem", type: "spki" }).toString(), now: new Date("2026-09-07T06:05:01.000Z") });
    return { report, restoreRoot, verify, readPublic: () => readProjectionSnapshot({ root: join(restoreRoot, "projection"),
      signingKeyId: "synthetic-boundary-key", publicKey: signing.publicKey }) };
  }
  const env = { root, databasePath, database, projectionRoot, backupRoot, first, second, input, pointer, snapshotAndVerify };
  environments.push(env); return env;
}
function injectReceiptDamage(database: DatabaseSync, statement: string): void {
  // Fault injection only in the test-created database; retained production SQL
  // and its immutable history are never changed by the snapshot implementation.
  database.exec("DROP TRIGGER projection_delivery_receipt_no_update; DROP TRIGGER projection_delivery_receipt_no_delete");
  database.exec(statement);
}

describe("confirmed projection snapshot boundary", () => {
  it("reproduces the original receiver-ahead-of-ACK registration failure", () => {
    const env = setup(); const result = env.snapshotAndVerify({ projectionBoundary: undefined });
    expect(env.pointer().snapshotGeneration).toBe(2);
    expect(() => result.verify()).toThrow("BACKUP_PROJECTION_DELIVERY_MISSING");
  });
  it("restores the newest confirmed generation and retains the pending delivery without changing live state", () => {
    const env = setup(), originalPointer = readFileSync(join(env.projectionRoot, "active.json"));
    const before = canonicalJson(env.database.prepare("SELECT * FROM projection_outbox ORDER BY snapshot_generation").all());
    const result = env.snapshotAndVerify(); expect(result.verify().generation).toBe(1);
    expect(result.readPublic()?.snapshotGeneration).toBe(1);
    const restored = new DatabaseSync(join(result.restoreRoot, "db/snapshot.sqlite"), { readOnly: true });
    try {
      expect(canonicalJson(restored.prepare("SELECT * FROM projection_outbox ORDER BY snapshot_generation").all())).toBe(before);
      expect(restored.prepare("SELECT status FROM projection_outbox WHERE snapshot_generation=2").get()?.status).not.toBe("succeeded");
    } finally { restored.close(); }
    expect(readFileSync(join(env.projectionRoot, "active.json"))).toEqual(originalPointer);
    expect(canonicalJson(env.database.prepare("SELECT * FROM projection_outbox ORDER BY snapshot_generation").all())).toBe(before);
  });
  it("uses only snapshot ACKs when the second acknowledgement arrives after VACUUM", () => {
    const env = setup(); const result = env.snapshotAndVerify({ testOnlyAfterDatabaseSnapshot: () => env.second.acknowledge() });
    expect(env.database.prepare("SELECT status FROM projection_outbox WHERE snapshot_generation=2").get()?.status).toBe("succeeded");
    expect(result.verify().generation).toBe(1); expect(result.readPublic()?.snapshotGeneration).toBe(1);
  });
  it("uses the latest generation when its acknowledgement was committed before VACUUM", () => {
    const env = setup(); env.second.acknowledge(); const result = env.snapshotAndVerify();
    expect(result.verify().generation).toBe(2); expect(result.readPublic()?.snapshotGeneration).toBe(2);
  });
  it.each(["missing-receipt", "corrupt-receipt", "missing-generation", "missing-schema"])("fails before package publication on %s", kind => {
    const env = setup();
    if (kind === "missing-receipt") injectReceiptDamage(env.database, "DELETE FROM projection_delivery_receipt");
    else if (kind === "corrupt-receipt") injectReceiptDamage(env.database, "UPDATE projection_delivery_receipt SET receipt_hash='" + "f".repeat(64) + "'");
    else if (kind === "missing-schema") env.database.exec("ALTER TABLE projection_delivery_receipt RENAME TO fixture_receipt");
    else unlinkSync(join(env.projectionRoot, "generations", env.first.receipt.snapshotManifestHash + ".json"));
    expect(() => runSnapshotOnce(env.input)).toThrow();
    const layout = backupLayout(env.backupRoot);
    expect(readdirSync(layout.packagesDir)).toEqual([]); expect(readdirSync(layout.objectsDir)).toEqual([]);
    expect(readdirSync(layout.stagingDir)).toEqual([]); expect(existsSync(layout.lockPath)).toBe(false);
  });
  it("does not silently skip a corrupt newest acknowledged generation", () => {
    const env = setup(); env.second.acknowledge();
    injectReceiptDamage(env.database, "UPDATE projection_delivery_receipt SET receipt_hash='" + "f".repeat(64) + "' WHERE snapshot_generation=2");
    expect(() => runSnapshotOnce(env.input)).toThrow("BACKUP_PROJECTION_RECEIPT_HASH_MISMATCH");
  });
  it.each(["generation-pretty", "generation-extra", "pointer-pretty", "pointer-extra"])("rejects %s before creating an unreadable package", kind => {
    const env = setup(), file = kind.startsWith("generation")
      ? join(env.projectionRoot, "generations", env.first.receipt.snapshotManifestHash + ".json") : join(env.projectionRoot, "active.json");
    const value = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, kind.endsWith("pretty") ? JSON.stringify(value, null, 2) : canonicalJson({ ...value, extra: true }));
    expect(() => runSnapshotOnce(env.input)).toThrow(kind.startsWith("generation") ? "BACKUP_PROJECTION_GENERATION_INVALID" : "PROJECTION_POINTER_INVALID");
    const layout = backupLayout(env.backupRoot); expect(readdirSync(layout.packagesDir)).toEqual([]); expect(readdirSync(layout.objectsDir)).toEqual([]);
  });
  it("rejects a live pointer that was rolled back behind the latest acknowledged database generation", () => {
    const env = setup(); env.second.acknowledge();
    writeFileSync(join(env.projectionRoot, "active.json"), canonicalJson({ schemaVersion: "projection-active-pointer-v1",
      snapshotGeneration: env.first.receipt.snapshotGeneration, snapshotManifestHash: env.first.receipt.snapshotManifestHash,
      activatedAt: env.first.receipt.activatedAt }));
    expect(() => runSnapshotOnce(env.input)).toThrow("BACKUP_PROJECTION_LIVE_BEHIND_CONFIRMED");
  });
  it.each(["active", "generation"])("rejects a UTF-8 BOM in the original %s bytes", kind => {
    const env = setup(), file = kind === "active" ? join(env.projectionRoot, "active.json")
      : join(env.projectionRoot, "generations", env.first.receipt.snapshotManifestHash + ".json");
    writeFileSync(file, "\uFEFF" + readFileSync(file, "utf8"));
    expect(() => runSnapshotOnce(env.input)).toThrow("BACKUP_PROJECTION_FILE_INVALID");
    expect(readdirSync(backupLayout(env.backupRoot).packagesDir)).toEqual([]);
  });
  it("the official CLI always requests the confirmed delivery boundary", () => {
    const env = setup();
    // A valid key fixture is created without exposing it in command output.
    const keyPath = join(env.root, "key");
      writeFileSync(keyPath, env.input.key, { mode: 0o600 });
      injectReceiptDamage(env.database, "DELETE FROM projection_delivery_receipt");
      expect(runBackupSnapshotCli(["--source-db", env.databasePath, "--projection-root", env.projectionRoot,
        "--output-dir", env.backupRoot, "--key-file", keyPath], { NODE_ENV: "test" }).code).toBe("BACKUP_PROJECTION_DELIVERY_MISSING");
  });
});
