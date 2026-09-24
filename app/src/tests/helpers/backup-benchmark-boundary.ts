// Synthetic minimal tables for the production confirmed-delivery snapshot branch.
// Uses the fixed runtime's envelope builder, signature verifier and receiver.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson, sha256Text } from "../../server/backup-snapshot/core.ts";
import { buildProjectionSnapshot, buildProjectionTaskEnvelope } from "../../server/review-real/mapping.ts";
import { ProjectionReceiver, signProjectionTaskEnvelope } from "../../server/review-real/projection.ts";

export function setupBenchmarkBoundary(rootPath: string) {
  const root = realpathSync(rootPath); chmodSync(root, 0o700);
  const databasePath = join(root, "source.sqlite"), database = new DatabaseSync(databasePath);
  database.exec(`CREATE TABLE projection_outbox(delivery_id TEXT PRIMARY KEY,status TEXT,snapshot_generation INTEGER,
    snapshot_manifest_hash TEXT,task_envelope_hash TEXT,task_envelope_json TEXT);
    CREATE TABLE projection_delivery_receipt(delivery_id TEXT PRIMARY KEY,receipt_json TEXT,receipt_hash TEXT);
    PRAGMA user_version=10;`);
  const snapshot = buildProjectionSnapshot({ snapshotGeneration: 1, previousSnapshotManifestHash: null, records: [] });
  const envelope = buildProjectionTaskEnvelope({ deliveryId: `op-snapshot-${snapshot.snapshotManifestHash}`,
    idempotencyKey: `snapshot:${snapshot.snapshotManifestHash}`, reconcileKey: `reconcile:snapshot:${snapshot.snapshotManifestHash}`,
    snapshot, attempt: 0, createdAt: "2026-09-10T00:00:00.000Z", deadlineAt: "2026-09-10T00:10:00.000Z" });
  const signing = generateKeyPairSync("ed25519"), projectionRoot = join(root, "projection"), backupRoot = join(root, "backup");
  const receiver = new ProjectionReceiver({ root: projectionRoot, signingKeyId: "synthetic-backup-benchmark", publicKey: signing.publicKey,
    now: () => Date.parse("2026-09-10T00:00:01.000Z") });
  const receipt = receiver.receive(signProjectionTaskEnvelope({ envelopeJson: envelope.envelopeJson, envelopeHash: envelope.envelopeHash,
    signingKeyId: "synthetic-backup-benchmark", privateKey: signing.privateKey }));
  database.prepare("INSERT INTO projection_outbox VALUES(?,?,?,?,?,?)").run(envelope.envelope.deliveryId,"succeeded",1,
    snapshot.snapshotManifestHash,envelope.envelopeHash,envelope.envelopeJson);
  const receiptJson = canonicalJson(receipt);
  database.prepare("INSERT INTO projection_delivery_receipt VALUES(?,?,?)").run(receipt.deliveryId,receiptJson,sha256Text(receiptJson));
  return { root, databasePath, database, projectionRoot, backupRoot, key: randomBytes(32) };
}
