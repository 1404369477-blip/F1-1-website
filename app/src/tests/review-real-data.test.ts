import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { canonicalJson } from "../server/db/profile.ts";
import {
  ADMIN_REVIEW_DTO_COUNT,
  ReviewDataError,
  buildAuditEventMaterial,
  buildProjectionSnapshot,
  buildProjectionTaskEnvelope,
  buildPublicProjectionRecord,
  buildReviewBundleMaterial,
  derivePublicId,
  verifyStoredProjectionTaskEnvelope,
  verifyStoredPublicProjection,
  verifyStoredAuditEvent,
  verifyStoredReviewBundle
} from "../server/review-real/mapping.ts";
import {
  ADMIN_REVIEW_DTO_SCHEMAS,
  AuditEventPayloadSchema,
  PublicProjectionRecordSchema,
  ReviewBundlePublicPayloadSchema,
  type CandidateSourceSnapshot,
  type ReviewEditable
} from "../server/review-real/schema.ts";

const migration0001 = readFileSync(new URL("../../migrations/rss-real/0001_rss_real.sql", import.meta.url), "utf8");
const migration0002 = readFileSync(new URL("../../migrations/rss-real/0002_admin_review_publish.sql", import.meta.url), "utf8");

const candidate: CandidateSourceSnapshot = {
  candidateId: "rss-candidate-data-test",
  sourceId: "motorsport-f1-news",
  sourceRevision: 1,
  sourcePayloadHash: "b".repeat(64),
  canonicalUrl: "https://www.motorsport.com/f1/news/data-test/",
  sourceTitle: "Machine source title",
  sourceExcerpt: "Machine source excerpt",
  sourceAuthor: null,
  sourcePublishedAt: "2026-08-12T00:00:00.000Z",
  editorTitle: null,
  editorExcerpt: null,
  editorNotes: null,
  editorBasedOnSourceRevision: null,
  reviewStatus: "pending_review",
  firstSeenAt: "2026-08-12T00:01:00.000Z",
  lastSeenAt: "2026-08-12T00:01:00.000Z"
};

const editable: ReviewEditable = {
  titleZh: "  中文标题  ",
  summaryZh: "中文摘要\r\n第二行",
  notes: "  private-editor-note  "
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function count(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Record<string, unknown>;
  return Number(row.count);
}

describe("DATA-REAL-REVIEW-MAP-01", () => {
  it("keeps the accepted RSS base migration and current collector implementation byte-pinned", () => {
    const pinned = [
      ["../../migrations/rss-real/0001_rss_real.sql", "c03c5c0bd5887e9e74453c91602bae76f6a7c74db513a2d9ff808ad498807ef3"],
      ["../server/rss/repository.ts", "c4908efa94e86088a99be1ce4e603de9b07e93c03ca8185898759c90d9a2cc37"],
      ["../server/rss/parser.ts", "ea96fdf7f1a0e86b3b998f80600882f0f1c085c912b26bd3bc0925a7b37cc606"],
      ["../server/rss/transport.ts", "a55b76fa8899173341671a3c8e13d67c47e6f74d8fd6e0ff68a29e1abc134028"],
      ["../server/rss/types.ts", "e77a9a1a492dae942ad1e8deb9703d68c03bd2e4a81f07b35ac066c3a40f5cb6"],
      ["../server/rss/deployment.ts", "2b09bedf9bc087e79a33e0b48fc25360e432887afd24bdad4de8bd9540f89539"],
      ["../server/rss/release-manifest.ts", "f61f5e1c34b236c16af2649c5a08fc91751e1bc8b851c41681ccab906085ddef"],
      ["./rss-real.test.ts", "8ab8f0d7b6887726fd2ef86a576fa5c541e6b5041fafc1ef8b82622a1f2842d3"]
    ] as const;
    for (const [path, expected] of pinned) {
      expect(sha256(readFileSync(new URL(path, import.meta.url))), path).toBe(expected);
    }
  });

  it("migrates 0001 to the seven-table 0002 schema and enforces immutable audit and hash-bound rows", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys=ON;");
      database.exec(migration0001);
      const originalSchema = database.prepare(
        "SELECT name, sql FROM sqlite_schema WHERE type='table' AND name IN ('source','ingest_run','pending_review_candidate') ORDER BY name"
      ).all();

      database.exec(migration0002);
      expect(database.prepare("PRAGMA recursive_triggers").get()).toMatchObject({ recursive_triggers: 0 });
      expect(database.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 2 });
      expect(database.prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all().map((row) => String((row as Record<string, unknown>).name))).toEqual([
        "admin_operation",
        "audit_event",
        "ingest_run",
        "pending_review_candidate",
        "projection_outbox",
        "publication",
        "published_projection",
        "review_bundle",
        "review_decision",
        "source"
      ]);
      expect(database.prepare(
        "SELECT name, sql FROM sqlite_schema WHERE type='table' AND name IN ('source','ingest_run','pending_review_candidate') ORDER BY name"
      ).all()).toEqual(originalSchema);

      database.prepare(
        "INSERT INTO pending_review_candidate (candidate_id, source_id, external_id, dedupe_key, canonical_url, title, excerpt, author, published_at, source_payload_hash, source_revision, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        candidate.candidateId,
        candidate.sourceId,
        "data-test-external-id",
        "a".repeat(64),
        candidate.canonicalUrl,
        candidate.sourceTitle,
        candidate.sourceExcerpt,
        candidate.sourceAuthor,
        candidate.sourcePublishedAt,
        candidate.sourcePayloadHash,
        candidate.sourceRevision,
        candidate.firstSeenAt,
        candidate.lastSeenAt
      );

      const bundle = buildReviewBundleMaterial({
        bundleId: "bundle-data-test-1",
        bundleRevision: 1,
        createdAt: "2026-08-12T00:02:00.000Z",
        candidate,
        editable
      });
      database.prepare(
        "UPDATE pending_review_candidate SET editor_title=?, editor_excerpt=?, editor_notes=?, editor_based_on_source_revision=? WHERE candidate_id=?"
      ).run(
        bundle.publicPayload.titleZh,
        bundle.publicPayload.summaryZh,
        bundle.editorNotes,
        candidate.sourceRevision,
        candidate.candidateId
      );
      const insertBundle = database.prepare(
        "INSERT INTO review_bundle (bundle_id, candidate_id, bundle_revision, source_revision, source_payload_hash, public_payload_json, public_payload_hash, editor_notes, bundle_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      insertBundle.run(
        "bundle-data-test-1",
        candidate.candidateId,
        1,
        candidate.sourceRevision,
        candidate.sourcePayloadHash,
        bundle.publicPayloadJson,
        bundle.publicPayloadHash,
        bundle.editorNotes,
        bundle.bundleHash,
        "2026-08-12T00:02:00.000Z"
      );
      expect(() => insertBundle.run(
        "bundle-data-test-duplicate",
        candidate.candidateId,
        1,
        candidate.sourceRevision,
        candidate.sourcePayloadHash,
        bundle.publicPayloadJson,
        bundle.publicPayloadHash,
        bundle.editorNotes,
        "c".repeat(64),
        "2026-08-12T00:02:01.000Z"
      )).toThrow();

      database.prepare(
        "INSERT INTO review_decision (decision_id, bundle_id, decision, approved_bundle_hash, rejection_reason, decided_at) VALUES (?, ?, 'approved', ?, NULL, ?)"
      ).run("decision-data-test-1", "bundle-data-test-1", bundle.bundleHash, "2026-08-12T00:03:00.000Z");
      expect(() => database.prepare(
        "INSERT INTO review_decision (decision_id, bundle_id, decision, approved_bundle_hash, rejection_reason, decided_at) VALUES (?, ?, 'rejected', NULL, '   ', ?)"
      ).run("decision-invalid-reason", "missing-bundle", "2026-08-12T00:03:00.000Z")).toThrow();

      const publicId = derivePublicId(candidate.candidateId, bundle.bundleHash);
      database.prepare(
        "INSERT INTO publication (publication_id, decision_id, bundle_id, public_id, approved_bundle_hash, publish_generation, publication_status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'queued', NULL, ?, ?)"
      ).run(
        "publication-data-test-1",
        "decision-data-test-1",
        "bundle-data-test-1",
        publicId,
        bundle.bundleHash,
        "2026-08-12T00:03:00.000Z",
        "2026-08-12T00:03:00.000Z"
      );
      const queuedPublicationBeforeReplace = database.prepare(
        "SELECT * FROM publication WHERE publication_id='publication-data-test-1'"
      ).get();
      expect(() => database.prepare(
        "INSERT OR REPLACE INTO publication (publication_id, decision_id, bundle_id, public_id, approved_bundle_hash, publish_generation, publication_status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'queued', NULL, ?, ?)"
      ).run(
        "publication-data-test-replacement",
        "decision-data-test-1",
        "bundle-data-test-1",
        `public-rss-${"f".repeat(64)}`,
        bundle.bundleHash,
        "2026-08-12T00:03:30.000Z",
        "2026-08-12T00:03:30.000Z"
      )).toThrow(/PUBLICATION_APPROVAL_INVALID/);
      expect(database.prepare(
        "SELECT * FROM publication WHERE publication_id='publication-data-test-1'"
      ).get()).toEqual(queuedPublicationBeforeReplace);
      expect(database.prepare(
        "SELECT 1 FROM publication WHERE publication_id='publication-data-test-replacement'"
      ).get()).toBeUndefined();
      expect(() => database.prepare(
        "DELETE FROM publication WHERE publication_id='publication-data-test-1'"
      ).run()).toThrow(/PUBLICATION_IMMUTABLE/);
      expect(() => database.prepare(
        "UPDATE publication SET published_at='2026-08-12T00:03:30.000Z' WHERE publication_id='publication-data-test-1'"
      ).run()).toThrow(/PUBLICATION_PUBLISHED_AT_IMMUTABLE/);
      expect(() => database.prepare(
        "UPDATE publication SET publication_status='published' WHERE publication_id='publication-data-test-1'"
      ).run()).toThrow();
      database.prepare(
        "UPDATE publication SET publication_status='published', published_at=?, updated_at=? WHERE publication_id=?"
      ).run("2026-08-12T00:04:00.000Z", "2026-08-12T00:04:00.000Z", "publication-data-test-1");
      expect(() => database.prepare(
        "UPDATE publication SET published_at='2026-08-12T00:05:00.000Z' WHERE publication_id='publication-data-test-1'"
      ).run()).toThrow(/PUBLICATION_PUBLISHED_AT_IMMUTABLE/);
      expect(() => database.prepare(
        "UPDATE publication SET created_at='2026-08-12T00:05:00.000Z' WHERE publication_id='publication-data-test-1'"
      ).run()).toThrow(/PUBLICATION_IDENTITY_IMMUTABLE/);
      expect(() => database.prepare(
        "DELETE FROM publication WHERE publication_id='publication-data-test-1'"
      ).run()).toThrow(/PUBLICATION_IMMUTABLE/);

      const projection = buildPublicProjectionRecord({
        publicId,
        bundleHash: bundle.bundleHash,
        publishedAt: "2026-08-12T00:04:00.000Z",
        publicPayload: bundle.publicPayload
      });
      const projectionJson = canonicalJson(projection);
      database.prepare(
        "INSERT INTO published_projection (projection_id, publication_id, bundle_id, public_id, publish_generation, projection_json, projection_hash, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)"
      ).run(
        "projection-data-test-1",
        "publication-data-test-1",
        "bundle-data-test-1",
        publicId,
        projectionJson,
        projection.projectionHash,
        "2026-08-12T00:04:00.000Z"
      );

      const snapshot = buildProjectionSnapshot({
        snapshotGeneration: 1,
        previousSnapshotManifestHash: null,
        records: [projection]
      });
      const task = buildProjectionTaskEnvelope({
        deliveryId: "delivery-data-test-1",
        idempotencyKey: "snapshot-idempotency-data-test-1",
        reconcileKey: "snapshot-reconcile-data-test-1",
        snapshot,
        attempt: 0,
        createdAt: "2026-08-12T00:04:00.000Z",
        deadlineAt: "2026-08-12T00:19:00.000Z"
      });
      const insertOutbox = database.prepare(
        "INSERT INTO projection_outbox (delivery_id, publication_id, operation_type, snapshot_generation, snapshot_manifest_hash, idempotency_key, reconcile_key, task_envelope_json, task_envelope_hash, status, attempt_count, max_attempts, lease_token, lease_expires_at, last_reason_code, created_at, updated_at) VALUES (?, ?, 'snapshot_sync', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      const outboxIdentity = [
        "delivery-data-test-1",
        "publication-data-test-1",
        snapshot.snapshotGeneration,
        snapshot.snapshotManifestHash,
        "snapshot-idempotency-data-test-1",
        "snapshot-reconcile-data-test-1",
        task.envelopeJson,
        task.envelopeHash
      ] as const;
      expect(() => insertOutbox.run(
        ...outboxIdentity,
        "succeeded",
        0,
        3,
        null,
        null,
        null,
        "2026-08-12T00:04:00.000Z",
        "2026-08-12T00:04:00.000Z"
      )).toThrow(/PROJECTION_OUTBOX_INVALID/);
      expect(() => insertOutbox.run(
        ...outboxIdentity,
        "pending",
        0,
        3,
        "forbidden-initial-lease",
        "2026-08-12T00:05:00.000Z",
        null,
        "2026-08-12T00:04:00.000Z",
        "2026-08-12T00:04:00.000Z"
      )).toThrow();
      expect(() => insertOutbox.run(
        ...outboxIdentity,
        "pending",
        4,
        3,
        null,
        null,
        null,
        "2026-08-12T00:04:00.000Z",
        "2026-08-12T00:04:00.000Z"
      )).toThrow();
      insertOutbox.run(
        ...outboxIdentity,
        "pending",
        0,
        3,
        null,
        null,
        null,
        "2026-08-12T00:04:00.000Z",
        "2026-08-12T00:04:00.000Z"
      );
      const outboxBeforeReplace = database.prepare(
        "SELECT * FROM projection_outbox WHERE delivery_id='delivery-data-test-1'"
      ).get();
      const replacementTask = buildProjectionTaskEnvelope({
        deliveryId: "delivery-data-test-replacement",
        idempotencyKey: "snapshot-idempotency-data-test-replacement",
        reconcileKey: "snapshot-reconcile-data-test-replacement",
        snapshot,
        attempt: 0,
        createdAt: "2026-08-12T00:04:30.000Z",
        deadlineAt: "2026-08-12T00:19:30.000Z"
      });
      expect(() => database.prepare(
        "INSERT OR REPLACE INTO projection_outbox (delivery_id, publication_id, operation_type, snapshot_generation, snapshot_manifest_hash, idempotency_key, reconcile_key, task_envelope_json, task_envelope_hash, status, attempt_count, max_attempts, lease_token, lease_expires_at, last_reason_code, created_at, updated_at) VALUES (?, ?, 'snapshot_sync', ?, ?, ?, ?, ?, ?, 'pending', 0, 3, NULL, NULL, NULL, ?, ?)"
      ).run(
        "delivery-data-test-replacement",
        "publication-data-test-1",
        snapshot.snapshotGeneration,
        snapshot.snapshotManifestHash,
        "snapshot-idempotency-data-test-replacement",
        "snapshot-reconcile-data-test-replacement",
        replacementTask.envelopeJson,
        replacementTask.envelopeHash,
        "2026-08-12T00:04:30.000Z",
        "2026-08-12T00:04:30.000Z"
      )).toThrow(/PROJECTION_OUTBOX_INVALID/);
      expect(database.prepare(
        "SELECT * FROM projection_outbox WHERE delivery_id='delivery-data-test-1'"
      ).get()).toEqual(outboxBeforeReplace);
      expect(database.prepare(
        "SELECT 1 FROM projection_outbox WHERE delivery_id='delivery-data-test-replacement'"
      ).get()).toBeUndefined();
      expect(() => database.prepare(
        "DELETE FROM projection_outbox WHERE delivery_id='delivery-data-test-1'"
      ).run()).toThrow(/PROJECTION_OUTBOX_IMMUTABLE/);
      expect(() => database.prepare(
        "UPDATE projection_outbox SET max_attempts=4 WHERE delivery_id='delivery-data-test-1'"
      ).run()).toThrow(/PROJECTION_OUTBOX_IDENTITY_IMMUTABLE/);
      expect(() => database.prepare(
        "UPDATE projection_outbox SET created_at='2026-08-12T00:04:30.000Z' WHERE delivery_id='delivery-data-test-1'"
      ).run()).toThrow(/PROJECTION_OUTBOX_IDENTITY_IMMUTABLE/);
      expect(() => database.prepare(
        "UPDATE projection_outbox SET status='succeeded' WHERE delivery_id='delivery-data-test-1'"
      ).run()).toThrow(/PROJECTION_OUTBOX_STATE_INVALID/);
      expect(() => database.prepare(
        "UPDATE projection_outbox SET attempt_count=1 WHERE delivery_id='delivery-data-test-1'"
      ).run()).toThrow(/PROJECTION_OUTBOX_STATE_INVALID/);
      database.prepare(
        "UPDATE projection_outbox SET status='leased', attempt_count=attempt_count+1, lease_token='lease-data-test-1', lease_expires_at='2026-08-12T00:06:00.000Z', updated_at='2026-08-12T00:05:00.000Z' WHERE delivery_id='delivery-data-test-1'"
      ).run();
      database.prepare(
        "UPDATE projection_outbox SET status='retryable_failed', lease_token=NULL, lease_expires_at=NULL, last_reason_code='DELIVERY_TIMEOUT', updated_at='2026-08-12T00:06:00.000Z' WHERE delivery_id='delivery-data-test-1'"
      ).run();
      expect(() => database.prepare(
        "UPDATE projection_outbox SET attempt_count=0 WHERE delivery_id='delivery-data-test-1'"
      ).run()).toThrow(/PROJECTION_OUTBOX_STATE_INVALID/);

      const responseJson = canonicalJson({ schemaVersion: "admin-review-v0.2", status: "delivery_pending" });
      database.prepare(
        "INSERT INTO admin_operation (operation_id, operation_type, http_method, request_path, request_hash, response_json, response_hash, http_status, operation_status, reason_code, created_at) VALUES (?, 'publish', 'POST', ?, ?, ?, ?, 200, 'completed', NULL, ?)"
      ).run(
        "operation-data-test-1",
        `/api/admin/publications/${publicId}/publish`,
        "d".repeat(64),
        responseJson,
        sha256(responseJson),
        "2026-08-12T00:04:00.000Z"
      );
      const auditPayload = AuditEventPayloadSchema.parse({
        schemaVersion: "admin-audit-v1",
        eventType: "publication_published",
        outcome: "succeeded",
        reasonCode: null,
        operationId: "operation-data-test-1",
        entityType: "publication",
        entityId: "publication-data-test-1",
        actorRef: "admin-data-test",
        occurredAt: "2026-08-12T00:04:00.000Z"
      });
      const firstAudit = buildAuditEventMaterial({ previousEventHash: null, eventPayload: auditPayload });
      expect(buildAuditEventMaterial({ previousEventHash: null, eventPayload: auditPayload })).toEqual(firstAudit);
      const insertAudit = database.prepare(
        "INSERT INTO audit_event (event_id, event_type, operation_id, entity_type, entity_id, actor_ref, event_json, previous_event_hash, event_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      insertAudit.run(
        "audit-data-test-1",
        auditPayload.eventType,
        auditPayload.operationId,
        auditPayload.entityType,
        auditPayload.entityId,
        auditPayload.actorRef,
        firstAudit.eventJson,
        firstAudit.previousEventHash,
        firstAudit.eventHash,
        auditPayload.occurredAt
      );
      expect(verifyStoredAuditEvent({
        previousEventHash: firstAudit.previousEventHash,
        eventJson: firstAudit.eventJson,
        eventHash: firstAudit.eventHash
      })).toEqual(firstAudit);

      const secondAuditPayload = AuditEventPayloadSchema.parse({
        schemaVersion: "admin-audit-v1",
        eventType: "projection_delivery_retryable_failed",
        outcome: "failed",
        reasonCode: "DELIVERY_TIMEOUT",
        operationId: "operation-data-test-1",
        entityType: "delivery",
        entityId: "delivery-data-test-1",
        actorRef: "projection-worker",
        occurredAt: "2026-08-12T00:06:00.000Z"
      });
      const disconnectedAudit = buildAuditEventMaterial({
        previousEventHash: null,
        eventPayload: secondAuditPayload
      });
      expect(() => insertAudit.run(
        "audit-data-test-disconnected",
        secondAuditPayload.eventType,
        secondAuditPayload.operationId,
        secondAuditPayload.entityType,
        secondAuditPayload.entityId,
        secondAuditPayload.actorRef,
        disconnectedAudit.eventJson,
        disconnectedAudit.previousEventHash,
        disconnectedAudit.eventHash,
        secondAuditPayload.occurredAt
      )).toThrow(/AUDIT_EVENT_PREDECESSOR_INVALID/);
      const wrongParentAudit = buildAuditEventMaterial({
        previousEventHash: "e".repeat(64),
        eventPayload: secondAuditPayload
      });
      expect(() => insertAudit.run(
        "audit-data-test-wrong-parent",
        secondAuditPayload.eventType,
        secondAuditPayload.operationId,
        secondAuditPayload.entityType,
        secondAuditPayload.entityId,
        secondAuditPayload.actorRef,
        wrongParentAudit.eventJson,
        wrongParentAudit.previousEventHash,
        wrongParentAudit.eventHash,
        secondAuditPayload.occurredAt
      )).toThrow(/AUDIT_EVENT_PREDECESSOR_INVALID/);
      const secondAudit = buildAuditEventMaterial({
        previousEventHash: firstAudit.eventHash,
        eventPayload: secondAuditPayload
      });
      expect(() => verifyStoredAuditEvent({
        previousEventHash: secondAudit.previousEventHash,
        eventJson: secondAudit.eventJson,
        eventHash: "f".repeat(64)
      })).toThrowError(ReviewDataError);
      expect(() => buildAuditEventMaterial({
        previousEventHash: firstAudit.eventHash,
        eventPayload: { ...secondAuditPayload, editorNotes: "private" } as typeof secondAuditPayload
      })).toThrowError(ReviewDataError);
      insertAudit.run(
        "audit-data-test-2",
        secondAuditPayload.eventType,
        secondAuditPayload.operationId,
        secondAuditPayload.entityType,
        secondAuditPayload.entityId,
        secondAuditPayload.actorRef,
        secondAudit.eventJson,
        secondAudit.previousEventHash,
        secondAudit.eventHash,
        secondAuditPayload.occurredAt
      );
      const staleParentPayload = AuditEventPayloadSchema.parse({
        ...secondAuditPayload,
        eventType: "projection_delivery_terminal_failed",
        reasonCode: "RETRY_BUDGET_EXHAUSTED",
        occurredAt: "2026-08-12T00:07:00.000Z"
      });
      const staleParentAudit = buildAuditEventMaterial({
        previousEventHash: firstAudit.eventHash,
        eventPayload: staleParentPayload
      });
      expect(() => insertAudit.run(
        "audit-data-test-stale-parent",
        staleParentPayload.eventType,
        staleParentPayload.operationId,
        staleParentPayload.entityType,
        staleParentPayload.entityId,
        staleParentPayload.actorRef,
        staleParentAudit.eventJson,
        staleParentAudit.previousEventHash,
        staleParentAudit.eventHash,
        staleParentPayload.occurredAt
      )).toThrow(/AUDIT_EVENT_PREDECESSOR_INVALID/);

      const replacementAudit = buildAuditEventMaterial({
        previousEventHash: secondAudit.eventHash,
        eventPayload: staleParentPayload
      });
      const auditRowsBeforeBypassAttempts = database.prepare(
        "SELECT * FROM audit_event ORDER BY audit_seq"
      ).all();
      expect(() => database.prepare(
        "INSERT OR REPLACE INTO audit_event (event_id, event_type, operation_id, entity_type, entity_id, actor_ref, event_json, previous_event_hash, event_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        "audit-data-test-2",
        staleParentPayload.eventType,
        staleParentPayload.operationId,
        staleParentPayload.entityType,
        staleParentPayload.entityId,
        staleParentPayload.actorRef,
        replacementAudit.eventJson,
        replacementAudit.previousEventHash,
        replacementAudit.eventHash,
        staleParentPayload.occurredAt
      )).toThrow(/AUDIT_EVENT_INVALID/);
      expect(database.prepare(
        "SELECT * FROM audit_event ORDER BY audit_seq"
      ).all()).toEqual(auditRowsBeforeBypassAttempts);

      expect(() => database.prepare(
        "INSERT INTO audit_event (audit_seq, event_id, event_type, operation_id, entity_type, entity_id, actor_ref, event_json, previous_event_hash, event_hash, created_at) VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        "audit-data-test-low-sequence",
        staleParentPayload.eventType,
        staleParentPayload.operationId,
        staleParentPayload.entityType,
        staleParentPayload.entityId,
        staleParentPayload.actorRef,
        replacementAudit.eventJson,
        replacementAudit.previousEventHash,
        replacementAudit.eventHash,
        staleParentPayload.occurredAt
      )).toThrow(/AUDIT_EVENT_SEQUENCE_INVALID/);
      expect(database.prepare(
        "SELECT * FROM audit_event ORDER BY audit_seq"
      ).all()).toEqual(auditRowsBeforeBypassAttempts);

      for (const table of [
        "review_bundle",
        "review_decision",
        "publication",
        "published_projection",
        "projection_outbox",
        "admin_operation",
        "audit_event"
      ]) {
        expect(count(database, table), table).toBe(table === "audit_event" ? 2 : 1);
      }
      expect(() => database.prepare("UPDATE audit_event SET actor_ref='changed' WHERE event_id='audit-data-test-1'").run())
        .toThrow(/AUDIT_EVENT_APPEND_ONLY/);
      expect(() => database.prepare("DELETE FROM audit_event WHERE event_id='audit-data-test-1'").run())
        .toThrow(/AUDIT_EVENT_APPEND_ONLY/);
      expect(() => database.prepare("UPDATE review_bundle SET editor_notes='changed' WHERE bundle_id='bundle-data-test-1'").run())
        .toThrow(/REVIEW_BUNDLE_IMMUTABLE/);
      expect(database.prepare("PRAGMA foreign_key_check").get()).toBeUndefined();
      expect(database.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
    } finally {
      database.close();
    }
  });

  it("maps candidate data deterministically through the public allowlist without leaking private notes", () => {
    expect(ADMIN_REVIEW_DTO_COUNT).toBe(11);
    expect(Object.keys(ADMIN_REVIEW_DTO_SCHEMAS)).toHaveLength(11);

    const input = {
      bundleId: "bundle-data-test-1",
      bundleRevision: 1,
      createdAt: "2026-08-12T00:02:00.000Z",
      candidate,
      editable
    } as const;
    const first = buildReviewBundleMaterial(input);
    const second = buildReviewBundleMaterial(input);
    expect(first).toEqual(second);
    expect(first.publicPayload.titleZh).toBe("中文标题");
    expect(first.publicPayload.summaryZh).toBe("中文摘要\n第二行");
    expect(first.editorNotes).toBe("private-editor-note");
    expect(verifyStoredReviewBundle({
      bundleId: input.bundleId,
      bundleRevision: input.bundleRevision,
      createdAt: input.createdAt,
      publicPayloadJson: first.publicPayloadJson,
      publicPayloadHash: first.publicPayloadHash,
      editorNotes: first.editorNotes,
      bundleHash: first.bundleHash
    })).toEqual(first);

    const publicId = derivePublicId(candidate.candidateId, first.bundleHash);
    const projection = buildPublicProjectionRecord({
      publicId,
      bundleHash: first.bundleHash,
      publishedAt: "2026-08-12T00:04:00.000Z",
      publicPayload: first.publicPayload
    });
    const projectionJson = canonicalJson(projection);
    expect(verifyStoredPublicProjection(projectionJson, projection.projectionHash)).toEqual(projection);
    expect(Object.keys(projection).sort()).toEqual([
      "contentType",
      "detail",
      "media",
      "originalLink",
      "projectionHash",
      "publicId",
      "publishGeneration",
      "publishedAt",
      "source",
      "sourcePublishedAt",
      "sourceTimeStatus",
      "state",
      "summaryZh",
      "titleZh"
    ].sort());
    expect(projectionJson).not.toContain("editorNotes");
    expect(projectionJson).not.toContain(first.editorNotes);
    expect(PublicProjectionRecordSchema.safeParse({ ...projection, editorNotes: first.editorNotes }).success).toBe(false);
    expect(ReviewBundlePublicPayloadSchema.safeParse({ ...first.publicPayload, editorNotes: first.editorNotes }).success).toBe(false);

    const snapshot = buildProjectionSnapshot({
      snapshotGeneration: 1,
      previousSnapshotManifestHash: null,
      records: [projection]
    });
    const task = buildProjectionTaskEnvelope({
      deliveryId: "delivery-data-test-1",
      idempotencyKey: "snapshot-idempotency-data-test-1",
      reconcileKey: "snapshot-reconcile-data-test-1",
      snapshot,
      attempt: 0,
      createdAt: "2026-08-12T00:04:00.000Z",
      deadlineAt: "2026-08-12T00:19:00.000Z"
    });
    expect(verifyStoredProjectionTaskEnvelope(task.envelopeJson, task.envelopeHash)).toEqual(task.envelope);
    expect(task.envelopeJson).not.toContain(first.editorNotes);

    expect(() => buildReviewBundleMaterial({
      ...input,
      candidate: { ...candidate, canonicalUrl: "https://example.com/f1/news/data-test/" }
    })).toThrowError(ReviewDataError);
    expect(() => verifyStoredPublicProjection(` ${projectionJson}`, projection.projectionHash))
      .toThrowError(ReviewDataError);
  });
});
