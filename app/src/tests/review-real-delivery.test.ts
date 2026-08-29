import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  realpathSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  buildProjectionSnapshot,
  buildProjectionTaskEnvelope
} from "../server/review-real/mapping.ts";
import {
  applyProjectionDeliveryRuntimeMigration,
  applyReviewRealAdminMigration
} from "../server/review-real/migration.ts";
import {
  ProjectionReceiver,
  signProjectionTaskEnvelope,
  type SignedProjectionPackage
} from "../server/review-real/projection.ts";
import { ReviewRealRepository } from "../server/review-real/repository.ts";
import {
  ProjectionSender,
  type ProjectionSenderTransport,
  type ProjectionTransportResult
} from "../server/review-real/sender.ts";
import { canonicalJson } from "../server/db/profile.ts";

const migration0001 = readFileSync(new URL("../../migrations/rss-real/0001_rss_real.sql", import.meta.url), "utf8");
const migration0002 = readFileSync(new URL("../../migrations/rss-real/0002_admin_review_publish.sql", import.meta.url), "utf8");
const migration0003 = readFileSync(new URL("../../migrations/rss-real/0003_projection_delivery_runtime.sql", import.meta.url), "utf8");

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function scalar(database: DatabaseSync, sql: string): string | number {
  return Object.values(database.prepare(sql).get() as Record<string, unknown>)[0] as string | number;
}

function publishedFixture(suffix: string): Readonly<{
  database: DatabaseSync;
  repository: ReviewRealRepository;
  deliveryId: string;
}> {
  const database = new DatabaseSync(":memory:");
  database.exec(migration0001);
  applyReviewRealAdminMigration(database, migration0002);
  applyProjectionDeliveryRuntimeMigration(database, migration0003);
  const candidateId = `rss-candidate-delivery-${suffix}`;
  const publishedAt = "2026-08-12T01:00:00.000Z";
  const sourcePayloadHash = sha256(`source-${suffix}`);
  database.prepare(
    "INSERT INTO pending_review_candidate (candidate_id, source_id, external_id, dedupe_key, canonical_url, title, excerpt, author, published_at, source_payload_hash, source_revision, first_seen_at, last_seen_at) VALUES (?, 'motorsport-f1-news', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
  ).run(
    candidateId,
    `delivery-${suffix}`,
    sha256(`dedupe-${suffix}`),
    `https://www.motorsport.com/f1/news/delivery-${suffix}/`,
    `Source ${suffix}`,
    `Excerpt ${suffix}`,
    "Motorsport.com",
    publishedAt,
    sourcePayloadHash,
    publishedAt,
    publishedAt
  );
  let now = Date.parse("2026-08-12T02:00:00.000Z");
  const repository = new ReviewRealRepository(database, () => {
    const value = new Date(now);
    now += 1_000;
    return value;
  });
  const revision = repository.revision({
    schemaVersion: "admin-review-v0.2",
    operationId: `operation-revision-${suffix}`,
    expected: {
      candidateId,
      sourceRevision: 1,
      sourceVersionTag: sourcePayloadHash.slice(0, 12),
      latestBundleId: null,
      latestBundleVersionTag: null
    },
    editable: {
      titleZh: `真实投影 ${suffix}`,
      summaryZh: `用于验证 single sender 状态机的摘要 ${suffix}`,
      notes: "private"
    }
  }, `/api/admin/reviews/${candidateId}/revision`, "operator-test");
  const approval = repository.approve({
    schemaVersion: "admin-review-v0.2",
    operationId: `operation-approve-${suffix}`,
    expected: {
      candidateId,
      sourceRevision: 1,
      bundleId: revision.bundle.id,
      bundleVersionTag: revision.bundle.versionTag
    }
  }, `/api/admin/reviews/${candidateId}/approve`, "operator-test");
  expect(Number(scalar(database, "SELECT COUNT(*) FROM projection_outbox"))).toBe(0);
  const publication = repository.publish({
    schemaVersion: "admin-review-v0.2",
    operationId: `operation-publish-${suffix}`,
    expected: {
      publicId: approval.publication.publicId,
      publishGeneration: 1,
      publicationStatus: "queued",
      approvedBundleVersionTag: revision.bundle.versionTag
    }
  }, `/api/admin/publications/${approval.publication.publicId}/publish`, "operator-test");
  expect(Number(scalar(database, "SELECT COUNT(*) FROM projection_outbox"))).toBe(1);
  return { database, repository, deliveryId: publication.delivery.id };
}

class ReceiverTransport implements ProjectionSenderTransport {
  readonly posted: string[] = [];
  postMode: "commit" | "lose" | "drop" | "conflict" = "commit";

  constructor(private readonly receiver: ProjectionReceiver) {}

  async post(packageValue: SignedProjectionPackage): Promise<ProjectionTransportResult> {
    this.posted.push(canonicalJson(packageValue));
    if (this.postMode === "conflict") return { kind: "response", status: 409, body: null };
    if (this.postMode === "drop") return { kind: "unknown" };
    const receipt = this.receiver.receive(packageValue);
    if (this.postMode === "lose") return { kind: "unknown" };
    return { kind: "response", status: 200, body: receipt };
  }

  async getReceipt(deliveryId: string): Promise<ProjectionTransportResult> {
    try {
      return { kind: "response", status: 200, body: this.receiver.getReceipt(deliveryId) };
    } catch {
      return { kind: "response", status: 404, body: null };
    }
  }
}

describe("ADR-M5-REAL-PROJECTION-RUNTIME-002 sender A", () => {
  it("leases one stored package, reconciles response loss, retries the same package after exact 404, and terminalizes semantic conflicts", async () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-projection-sender-"));
    chmodSync(root, 0o700);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const databases: DatabaseSync[] = [];
    try {
      const success = publishedFixture("success");
      databases.push(success.database);
      const successReceiver = new ProjectionReceiver({ root: join(root, "success"), signingKeyId: "projection-key", publicKey });
      const successTransport = new ReceiverTransport(successReceiver);
      const successSender = new ProjectionSender({
        repository: success.repository,
        transport: successTransport,
        signingKeyId: "projection-key",
        privateKey,
        actorRef: "projection-sender"
      });
      expect((await successSender.tick()).outcome).toBe("succeeded");
      expect(scalar(success.database, "SELECT status FROM projection_outbox")).toBe("succeeded");
      expect(success.repository.deliveryReceipt(success.deliveryId)).toEqual(successReceiver.getReceipt(success.deliveryId));

      const lost = publishedFixture("lost");
      databases.push(lost.database);
      const lostReceiver = new ProjectionReceiver({ root: join(root, "lost"), signingKeyId: "projection-key", publicKey });
      const lostTransport = new ReceiverTransport(lostReceiver);
      lostTransport.postMode = "lose";
      const lostSender = new ProjectionSender({ repository: lost.repository, transport: lostTransport, signingKeyId: "projection-key", privateKey, actorRef: "projection-sender" });
      expect((await lostSender.tick()).outcome).toBe("reconcile_wait");
      expect(lostTransport.posted).toHaveLength(1);
      expect((await lostSender.tick()).outcome).toBe("succeeded");
      expect(lostTransport.posted).toHaveLength(1);

      const retry = publishedFixture("retry");
      databases.push(retry.database);
      const retryReceiver = new ProjectionReceiver({ root: join(root, "retry"), signingKeyId: "projection-key", publicKey });
      const retryTransport = new ReceiverTransport(retryReceiver);
      retryTransport.postMode = "drop";
      const retrySender = new ProjectionSender({ repository: retry.repository, transport: retryTransport, signingKeyId: "projection-key", privateKey, actorRef: "projection-sender" });
      expect((await retrySender.tick()).outcome).toBe("reconcile_wait");
      expect((await retrySender.tick()).outcome).toBe("retryable_failed");
      retryTransport.postMode = "commit";
      expect((await retrySender.tick()).outcome).toBe("succeeded");
      expect(retryTransport.posted).toHaveLength(2);
      expect(retryTransport.posted[1]).toBe(retryTransport.posted[0]);

      const conflict = publishedFixture("conflict");
      databases.push(conflict.database);
      const conflictReceiver = new ProjectionReceiver({ root: join(root, "conflict"), signingKeyId: "projection-key", publicKey });
      const conflictTransport = new ReceiverTransport(conflictReceiver);
      conflictTransport.postMode = "conflict";
      const conflictSender = new ProjectionSender({ repository: conflict.repository, transport: conflictTransport, signingKeyId: "projection-key", privateKey, actorRef: "projection-sender" });
      expect((await conflictSender.tick()).outcome).toBe("terminal_failed");
      expect(scalar(conflict.database, "SELECT status FROM projection_outbox")).toBe("terminal_failed");
    } finally {
      for (const database of databases) database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("bootstraps only a valid signed generation 1 and makes activation-lock contention fail closed", () => {
    const fixture = publishedFixture("bootstrap");
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-projection-bootstrap-"));
    chmodSync(root, 0o700);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const { publicKey: wrongPublicKey } = generateKeyPairSync("ed25519");
    try {
      const task = fixture.repository.deliveryTask(fixture.deliveryId);
      const packageValue = signProjectionTaskEnvelope({ envelopeJson: task.envelopeJson, envelopeHash: task.envelopeHash, signingKeyId: "projection-key", privateKey });
      const invalidReceiver = new ProjectionReceiver({ root: join(root, "invalid"), signingKeyId: "projection-key", publicKey: wrongPublicKey });
      expect(() => invalidReceiver.receive(packageValue)).toThrowError("PROJECTION_SIGNATURE_INVALID");

      const generationTwo = buildProjectionSnapshot({
        snapshotGeneration: 2,
        previousSnapshotManifestHash: task.envelope.snapshot.snapshotManifestHash,
        records: task.envelope.snapshot.records
      });
      const taskTwo = buildProjectionTaskEnvelope({
        deliveryId: `op-snapshot-${generationTwo.snapshotManifestHash}`,
        idempotencyKey: `snapshot-sync:0:${generationTwo.snapshotManifestHash}`,
        reconcileKey: `reconcile:snapshot:${generationTwo.snapshotManifestHash}`,
        snapshot: generationTwo,
        attempt: 0,
        createdAt: "2026-08-12T02:10:00.000Z",
        deadlineAt: "2026-08-12T02:25:00.000Z"
      });
      const packageTwo = signProjectionTaskEnvelope({ envelopeJson: taskTwo.envelopeJson, envelopeHash: taskTwo.envelopeHash, signingKeyId: "projection-key", privateKey });
      const receiverRoot = join(root, "active");
      const receiver = new ProjectionReceiver({ root: receiverRoot, signingKeyId: "projection-key", publicKey });
      expect(() => receiver.receive(packageTwo)).toThrowError("PROJECTION_GENERATION_CONFLICT");
      writeFileSync(join(receiverRoot, "activation.lock"), "held", { mode: 0o600 });
      expect(() => receiver.receive(packageValue)).toThrowError("PROJECTION_GENERATION_CONFLICT");
      unlinkSync(join(receiverRoot, "activation.lock"));
      expect(receiver.receive(packageValue).status).toBe("active");
      expect(receiver.receive(packageValue).deliveryId).toBe(fixture.deliveryId);
    } finally {
      fixture.database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
