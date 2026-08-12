import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { z } from "zod";

import { withImmediateTransaction } from "../db/database.ts";
import { canonicalJson } from "../db/profile.ts";
import {
  buildAuditEventMaterial,
  buildProjectionSnapshot,
  buildProjectionTaskEnvelope,
  buildPublicProjectionRecord,
  buildReviewBundleMaterial,
  derivePublicId,
  verifyStoredAuditEvent,
  verifyStoredProjectionTaskEnvelope,
  verifyStoredPublicProjection,
  verifyStoredReviewBundle,
  type ReviewBundleMaterial
} from "./mapping.ts";
import {
  ApproveRequestSchema,
  ApproveSuccessSchema,
  AuditEventPayloadSchema,
  CandidateSourceSnapshotSchema,
  OperationReceiptSchema,
  PublishRequestSchema,
  PublishSuccessSchema,
  RejectRequestSchema,
  RejectSuccessSchema,
  ReviewDetailSchema,
  ReviewListSchema,
  ReviewQueueItemSchema,
  RevisionRequestSchema,
  RevisionSuccessSchema,
  type CandidateSourceSnapshot,
  type ProjectionTaskEnvelope
} from "./schema.ts";
import { asReviewRealError, ReviewRealError } from "./error.ts";

type SqlRow = Record<string, unknown>;
type Clock = () => Date;

export type ReviewList = z.infer<typeof ReviewListSchema>;
export type ReviewDetail = z.infer<typeof ReviewDetailSchema>;
export type ReviewQueueItem = z.infer<typeof ReviewQueueItemSchema>;
export type OperationReceipt = z.infer<typeof OperationReceiptSchema>;
export type RevisionRequest = z.infer<typeof RevisionRequestSchema>;
export type RevisionSuccess = z.infer<typeof RevisionSuccessSchema>;
export type ApproveRequest = z.infer<typeof ApproveRequestSchema>;
export type ApproveSuccess = z.infer<typeof ApproveSuccessSchema>;
export type RejectRequest = z.infer<typeof RejectRequestSchema>;
export type RejectSuccess = z.infer<typeof RejectSuccessSchema>;
export type PublishRequest = z.infer<typeof PublishRequestSchema>;
export type PublishSuccess = z.infer<typeof PublishSuccessSchema>;

type OperationType = OperationReceipt["operationType"];
type StoredBundle = Readonly<{ row: SqlRow; material: ReviewBundleMaterial }>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function derivedId(prefix: string, operationId: string): string {
  return `${prefix}-${sha256(`${prefix}\n${operationId}`)}`;
}

function requiredText(row: SqlRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string") throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  return value;
}

function nullableText(row: SqlRow, field: string): string | null {
  const value = row[field];
  if (value === null) return null;
  if (typeof value !== "string") throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  return value;
}

function requiredInteger(row: SqlRow, field: string): number {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value)) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  return value;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
}

function parseStored<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  return parsed.data;
}

function responseSchema(operationType: OperationType): z.ZodType<unknown> {
  if (operationType === "revision") return RevisionSuccessSchema;
  if (operationType === "approve") return ApproveSuccessSchema;
  if (operationType === "reject") return RejectSuccessSchema;
  return PublishSuccessSchema;
}

function toCandidateSnapshot(row: SqlRow): CandidateSourceSnapshot {
  return parseStored(CandidateSourceSnapshotSchema, {
    candidateId: requiredText(row, "candidate_id"),
    sourceId: requiredText(row, "source_id"),
    sourceRevision: requiredInteger(row, "source_revision"),
    sourcePayloadHash: requiredText(row, "source_payload_hash"),
    canonicalUrl: requiredText(row, "canonical_url"),
    sourceTitle: requiredText(row, "title"),
    sourceExcerpt: requiredText(row, "excerpt"),
    sourceAuthor: nullableText(row, "author"),
    sourcePublishedAt: requiredText(row, "published_at"),
    editorTitle: nullableText(row, "editor_title"),
    editorExcerpt: nullableText(row, "editor_excerpt"),
    editorNotes: nullableText(row, "editor_notes"),
    editorBasedOnSourceRevision: row.editor_based_on_source_revision === null
      ? null
      : requiredInteger(row, "editor_based_on_source_revision"),
    reviewStatus: requiredText(row, "review_status"),
    firstSeenAt: requiredText(row, "first_seen_at"),
    lastSeenAt: requiredText(row, "last_seen_at")
  });
}

function latestTimestamp(values: readonly (string | null)[]): string {
  const present = values.filter((value): value is string => value !== null);
  if (present.length === 0) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  return present.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}

export class ReviewRealRepository {
  private readonly database: DatabaseSync;
  private readonly clock: Clock;

  constructor(database: DatabaseSync, clock: Clock = () => new Date()) {
    this.database = database;
    this.clock = clock;
  }

  private now(): string {
    const value = this.clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    return value.toISOString();
  }

  private transaction<T>(callback: () => T): T {
    try {
      return withImmediateTransaction(this.database, callback);
    } catch (error) {
      if (error instanceof ReviewRealError) throw error;
      throw asReviewRealError(error);
    }
  }

  private candidate(candidateId: string): SqlRow {
    const row = this.database.prepare(
      "SELECT * FROM pending_review_candidate WHERE candidate_id = ?"
    ).get(candidateId) as SqlRow | undefined;
    if (!row) throw new ReviewRealError("REVIEW_CANDIDATE_NOT_FOUND", 404);
    toCandidateSnapshot(row);
    return row;
  }

  private latestBundle(candidateId: string): StoredBundle | null {
    const row = this.database.prepare(
      "SELECT * FROM review_bundle WHERE candidate_id = ? ORDER BY bundle_revision DESC LIMIT 1"
    ).get(candidateId) as SqlRow | undefined;
    if (!row) return null;
    const material = verifyStoredReviewBundle({
      bundleId: requiredText(row, "bundle_id"),
      bundleRevision: requiredInteger(row, "bundle_revision"),
      createdAt: requiredText(row, "created_at"),
      publicPayloadJson: requiredText(row, "public_payload_json"),
      publicPayloadHash: requiredText(row, "public_payload_hash"),
      editorNotes: requiredText(row, "editor_notes"),
      bundleHash: requiredText(row, "bundle_hash")
    });
    return { row, material };
  }

  private decision(bundleId: string): SqlRow | null {
    return (this.database.prepare(
      "SELECT * FROM review_decision WHERE bundle_id = ?"
    ).get(bundleId) as SqlRow | undefined) ?? null;
  }

  private publication(bundleId: string): SqlRow | null {
    return (this.database.prepare(
      "SELECT * FROM publication WHERE bundle_id = ?"
    ).get(bundleId) as SqlRow | undefined) ?? null;
  }

  private delivery(publicationId: string): SqlRow | null {
    const row = this.database.prepare(
      "SELECT * FROM projection_outbox WHERE publication_id = ?"
    ).get(publicationId) as SqlRow | undefined;
    if (!row) return null;
    verifyStoredProjectionTaskEnvelope(
      requiredText(row, "task_envelope_json"),
      requiredText(row, "task_envelope_hash")
    );
    return row;
  }

  private view(candidateRow: SqlRow, detail: boolean): ReviewQueueItem | ReviewDetail {
    const candidate = toCandidateSnapshot(candidateRow);
    const latest = this.latestBundle(candidate.candidateId);
    const decision = latest === null ? null : this.decision(requiredText(latest.row, "bundle_id"));
    const publication = latest === null ? null : this.publication(requiredText(latest.row, "bundle_id"));
    const delivery = publication === null ? null : this.delivery(requiredText(publication, "publication_id"));
    const sourceStale = latest !== null && (
      requiredInteger(latest.row, "source_revision") !== candidate.sourceRevision ||
      requiredText(latest.row, "source_payload_hash") !== candidate.sourcePayloadHash ||
      candidate.editorBasedOnSourceRevision !== candidate.sourceRevision
    );

    let reviewState: ReviewQueueItem["reviewState"] = "pending_review";
    if (sourceStale) reviewState = "source_updated";
    else if (delivery !== null) {
      const status = requiredText(delivery, "status");
      if (status === "succeeded") reviewState = "published";
      else if (status === "terminal_failed" || status === "cancelled") reviewState = "terminal_failed";
      else if (status === "reconcile_wait" || status === "retryable_failed") reviewState = "reconcile_wait";
      else reviewState = "published_delivery_pending";
    } else if (publication !== null) {
      const status = requiredText(publication, "publication_status");
      if (status === "queued") reviewState = "approved_waiting_publish";
      else if (status === "reconcile_wait") reviewState = "reconcile_wait";
      else if (status === "terminal_failed") reviewState = "terminal_failed";
      else if (status === "emergency_stopped") reviewState = "emergency_stopped";
      else if (status === "superseded") reviewState = "blocked";
      else reviewState = "published_delivery_pending";
    } else if (decision !== null && requiredText(decision, "decision") === "rejected") {
      reviewState = "rejected";
    }

    const allowedActions: ReviewQueueItem["allowedActions"] = [];
    if (latest === null || sourceStale) allowedActions.push("revision");
    else if (decision === null) allowedActions.push("revision", "approve", "reject");
    else if (publication === null) allowedActions.push("return_to_queue");
    else if (requiredText(publication, "publication_status") === "queued") allowedActions.push("publish");
    else if (delivery !== null && requiredText(delivery, "status") === "succeeded") allowedActions.push("open_public_story");
    else if (delivery !== null) allowedActions.push("check_delivery");

    const latestBundleSummary = latest === null ? null : {
      id: requiredText(latest.row, "bundle_id"),
      revision: requiredInteger(latest.row, "bundle_revision"),
      versionTag: latest.material.bundleHash.slice(0, 12)
    };
    const decisionSummary = decision === null ? null : {
      id: requiredText(decision, "decision_id"),
      bundleId: requiredText(decision, "bundle_id"),
      decision: requiredText(decision, "decision"),
      rejectionReason: nullableText(decision, "rejection_reason"),
      decidedAt: requiredText(decision, "decided_at")
    };
    const publicationSummary = publication === null ? null : {
      id: requiredText(publication, "publication_id"),
      publicId: requiredText(publication, "public_id"),
      bundleId: requiredText(publication, "bundle_id"),
      publishGeneration: requiredInteger(publication, "publish_generation"),
      status: requiredText(publication, "publication_status"),
      publishedAt: nullableText(publication, "published_at"),
      updatedAt: requiredText(publication, "updated_at")
    };
    const deliverySummary = delivery === null ? null : {
      id: requiredText(delivery, "delivery_id"),
      status: requiredText(delivery, "status"),
      snapshotGeneration: requiredInteger(delivery, "snapshot_generation"),
      attemptCount: requiredInteger(delivery, "attempt_count"),
      reasonCode: nullableText(delivery, "last_reason_code") ?? "NONE",
      updatedAt: requiredText(delivery, "updated_at")
    };
    const updatedAt = latestTimestamp([
      candidate.lastSeenAt,
      latest === null ? null : requiredText(latest.row, "created_at"),
      decision === null ? null : requiredText(decision, "decided_at"),
      publication === null ? null : requiredText(publication, "updated_at"),
      delivery === null ? null : requiredText(delivery, "updated_at")
    ]);
    const common = {
      candidateId: candidate.candidateId,
      sourceId: candidate.sourceId,
      sourceRevision: candidate.sourceRevision,
      editorBasedOnSourceRevision: candidate.editorBasedOnSourceRevision,
      sourceTitle: candidate.sourceTitle,
      titleZh: latest?.material.publicPayload.titleZh ?? null,
      summaryZh: latest?.material.publicPayload.summaryZh ?? null,
      sourceAuthor: candidate.sourceAuthor,
      sourcePublishedAt: candidate.sourcePublishedAt,
      sourceDisplayName: "Motorsport.com" as const,
      originalUrl: candidate.canonicalUrl,
      mediaState: "none" as const,
      reviewState,
      latestBundle: latestBundleSummary,
      decision: decisionSummary,
      publication: publicationSummary,
      delivery: deliverySummary,
      updatedAt,
      allowedActions
    };
    if (!detail) return parseStored(ReviewQueueItemSchema, common);
    return parseStored(ReviewDetailSchema, {
      schemaVersion: "admin-review-v0.2",
      ...common,
      sourceExcerpt: candidate.sourceExcerpt,
      editorNotes: latest?.material.editorNotes ?? candidate.editorNotes,
      integrity: {
        status: sourceStale ? "blocked" : "ok",
        reasonCode: sourceStale ? "REVIEW_SOURCE_STALE" : null,
        versionTag: candidate.sourcePayloadHash.slice(0, 12)
      }
    });
  }

  list(): ReviewList {
    const rows = this.database.prepare(
      "SELECT * FROM pending_review_candidate ORDER BY published_at DESC, candidate_id LIMIT 100"
    ).all() as SqlRow[];
    return parseStored(ReviewListSchema, {
      schemaVersion: "admin-review-v0.2",
      items: rows.map((row) => this.view(row, false)),
      nextCursor: null
    });
  }

  detail(candidateId: string): ReviewDetail {
    return this.view(this.candidate(candidateId), true) as ReviewDetail;
  }

  private storedOperation<T>(input: Readonly<{
    operationId: string;
    operationType: OperationType;
    path: string;
    requestHash: string;
    schema: z.ZodType<T>;
  }>): T | null {
    const row = this.database.prepare(
      "SELECT * FROM admin_operation WHERE operation_id = ?"
    ).get(input.operationId) as SqlRow | undefined;
    if (!row) return null;
    if (
      requiredText(row, "operation_type") !== input.operationType ||
      requiredText(row, "http_method") !== "POST" ||
      requiredText(row, "request_path") !== input.path ||
      requiredText(row, "request_hash") !== input.requestHash
    ) {
      throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
    }
    const responseJson = requiredText(row, "response_json");
    if (sha256(responseJson) !== requiredText(row, "response_hash") || canonicalJson(parseJson(responseJson)) !== responseJson) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    return parseStored(input.schema, parseJson(responseJson));
  }

  private persistSuccess<T>(input: Readonly<{
    operationId: string;
    operationType: OperationType;
    path: string;
    requestHash: string;
    actorRef: string;
    candidateId: string;
    bundleId: string | null;
    publicId: string | null;
    deliveryId: string | null;
    eventType: z.infer<typeof AuditEventPayloadSchema>["eventType"];
    entityType: z.infer<typeof AuditEventPayloadSchema>["entityType"];
    entityId: string;
    createdAt: string;
    schema: z.ZodType<T>;
    buildResponse: (operation: OperationReceipt) => T;
  }>): T {
    const operationBase = {
      schemaVersion: "admin-review-v0.2" as const,
      operationId: input.operationId,
      operationType: input.operationType,
      status: "completed" as const,
      httpStatus: 200,
      reasonCode: null,
      requestVersionTag: input.requestHash.slice(0, 12),
      candidateId: input.candidateId,
      bundleId: input.bundleId,
      publicId: input.publicId,
      deliveryId: input.deliveryId,
      createdAt: input.createdAt
    };
    const draft = input.buildResponse(parseStored(OperationReceiptSchema, {
      ...operationBase,
      responseVersionTag: "000000000000"
    }));
    const operation = parseStored(OperationReceiptSchema, {
      ...operationBase,
      responseVersionTag: sha256(canonicalJson(draft)).slice(0, 12)
    });
    const response = parseStored(input.schema, input.buildResponse(operation));
    const responseJson = canonicalJson(response);
    const responseHash = sha256(responseJson);
    this.database.prepare(
      "INSERT INTO admin_operation (operation_id, operation_type, http_method, request_path, request_hash, response_json, response_hash, http_status, operation_status, reason_code, created_at) VALUES (?, ?, 'POST', ?, ?, ?, ?, 200, 'completed', NULL, ?)"
    ).run(
      input.operationId,
      input.operationType,
      input.path,
      input.requestHash,
      responseJson,
      responseHash,
      input.createdAt
    );

    const previousRow = this.database.prepare(
      "SELECT previous_event_hash, event_json, event_hash FROM audit_event ORDER BY audit_seq DESC LIMIT 1"
    ).get() as SqlRow | undefined;
    const previousHash = previousRow === undefined ? null : requiredText(previousRow, "event_hash");
    if (previousRow !== undefined) {
      verifyStoredAuditEvent({
        previousEventHash: nullableText(previousRow, "previous_event_hash"),
        eventJson: requiredText(previousRow, "event_json"),
        eventHash: requiredText(previousRow, "event_hash")
      });
    }
    const payload = parseStored(AuditEventPayloadSchema, {
      schemaVersion: "admin-audit-v1",
      eventType: input.eventType,
      outcome: "succeeded",
      reasonCode: null,
      operationId: input.operationId,
      entityType: input.entityType,
      entityId: input.entityId,
      actorRef: input.actorRef,
      occurredAt: input.createdAt
    });
    const audit = buildAuditEventMaterial({ previousEventHash: previousHash, eventPayload: payload });
    const eventId = derivedId("audit", input.operationId);
    this.database.prepare(
      "INSERT INTO audit_event (event_id, event_type, operation_id, entity_type, entity_id, actor_ref, event_json, previous_event_hash, event_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      eventId,
      payload.eventType,
      payload.operationId,
      payload.entityType,
      payload.entityId,
      payload.actorRef,
      audit.eventJson,
      audit.previousEventHash,
      audit.eventHash,
      payload.occurredAt
    );
    const storedAudit = this.database.prepare(
      "SELECT previous_event_hash, event_json, event_hash FROM audit_event WHERE event_id = ?"
    ).get(eventId) as SqlRow | undefined;
    if (!storedAudit) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    verifyStoredAuditEvent({
      previousEventHash: nullableText(storedAudit, "previous_event_hash"),
      eventJson: requiredText(storedAudit, "event_json"),
      eventHash: requiredText(storedAudit, "event_hash")
    });
    return response;
  }

  revision(request: RevisionRequest, path: string, actorRef: string): RevisionSuccess {
    const requestHash = sha256(canonicalJson(request));
    return this.transaction(() => {
      const replay = this.storedOperation({
        operationId: request.operationId,
        operationType: "revision",
        path,
        requestHash,
        schema: RevisionSuccessSchema
      });
      if (replay !== null) return replay;
      const candidateRow = this.candidate(request.expected.candidateId);
      const candidate = toCandidateSnapshot(candidateRow);
      const latest = this.latestBundle(candidate.candidateId);
      if (
        candidate.sourceRevision !== request.expected.sourceRevision ||
        candidate.sourcePayloadHash.slice(0, 12) !== request.expected.sourceVersionTag
      ) {
        throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
      }
      if (
        (latest === null) !== (request.expected.latestBundleId === null) ||
        (latest !== null && (
          requiredText(latest.row, "bundle_id") !== request.expected.latestBundleId ||
          latest.material.bundleHash.slice(0, 12) !== request.expected.latestBundleVersionTag
        ))
      ) {
        throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
      }
      if (latest !== null && this.decision(requiredText(latest.row, "bundle_id")) !== null) {
        throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
      }
      const createdAt = this.now();
      const bundleRevision = latest === null ? 1 : requiredInteger(latest.row, "bundle_revision") + 1;
      const bundleId = derivedId("bundle", request.operationId);
      const changed = this.database.prepare(
        "UPDATE pending_review_candidate SET editor_title=?, editor_excerpt=?, editor_notes=?, editor_based_on_source_revision=?, review_status='pending_review' WHERE candidate_id=? AND source_revision=? AND source_payload_hash=?"
      ).run(
        request.editable.titleZh,
        request.editable.summaryZh,
        request.editable.notes,
        candidate.sourceRevision,
        candidate.candidateId,
        candidate.sourceRevision,
        candidate.sourcePayloadHash
      );
      if (Number(changed.changes) !== 1) throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
      const updatedCandidate = toCandidateSnapshot(this.candidate(candidate.candidateId));
      const bundle = buildReviewBundleMaterial({
        bundleId,
        bundleRevision,
        createdAt,
        candidate: updatedCandidate,
        editable: request.editable
      });
      this.database.prepare(
        "INSERT INTO review_bundle (bundle_id, candidate_id, bundle_revision, source_revision, source_payload_hash, public_payload_json, public_payload_hash, editor_notes, bundle_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        bundleId,
        candidate.candidateId,
        bundleRevision,
        candidate.sourceRevision,
        candidate.sourcePayloadHash,
        bundle.publicPayloadJson,
        bundle.publicPayloadHash,
        bundle.editorNotes,
        bundle.bundleHash,
        createdAt
      );
      const candidateView = this.view(this.candidate(candidate.candidateId), false) as ReviewQueueItem;
      const bundleSummary = { id: bundleId, revision: bundleRevision, versionTag: bundle.bundleHash.slice(0, 12) };
      return this.persistSuccess({
        operationId: request.operationId,
        operationType: "revision",
        path,
        requestHash,
        actorRef,
        candidateId: candidate.candidateId,
        bundleId,
        publicId: null,
        deliveryId: null,
        eventType: "review_revision_saved",
        entityType: "bundle",
        entityId: bundleId,
        createdAt,
        schema: RevisionSuccessSchema,
        buildResponse: (operation) => ({
          schemaVersion: "admin-review-v0.2",
          operation,
          candidate: candidateView,
          bundle: bundleSummary
        })
      });
    });
  }

  approve(request: ApproveRequest, path: string, actorRef: string): ApproveSuccess {
    const requestHash = sha256(canonicalJson(request));
    return this.transaction(() => {
      const replay = this.storedOperation({
        operationId: request.operationId,
        operationType: "approve",
        path,
        requestHash,
        schema: ApproveSuccessSchema
      });
      if (replay !== null) return replay;
      const candidateRow = this.candidate(request.expected.candidateId);
      const candidate = toCandidateSnapshot(candidateRow);
      const latest = this.latestBundle(candidate.candidateId);
      if (candidate.sourceRevision !== request.expected.sourceRevision) {
        throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
      }
      if (
        latest === null ||
        requiredText(latest.row, "bundle_id") !== request.expected.bundleId ||
        latest.material.bundleHash.slice(0, 12) !== request.expected.bundleVersionTag ||
        requiredInteger(latest.row, "source_revision") !== candidate.sourceRevision ||
        requiredText(latest.row, "source_payload_hash") !== candidate.sourcePayloadHash ||
        candidate.editorBasedOnSourceRevision !== candidate.sourceRevision
      ) {
        throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
      }
      if (this.decision(request.expected.bundleId) !== null) {
        throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
      }
      const createdAt = this.now();
      const decisionId = derivedId("decision", request.operationId);
      const publicationId = derivedId("publication", request.operationId);
      const publicId = derivePublicId(candidate.candidateId, latest.material.bundleHash);
      this.database.prepare(
        "INSERT INTO review_decision (decision_id, bundle_id, decision, approved_bundle_hash, rejection_reason, decided_at) VALUES (?, ?, 'approved', ?, NULL, ?)"
      ).run(decisionId, request.expected.bundleId, latest.material.bundleHash, createdAt);
      this.database.prepare(
        "INSERT INTO publication (publication_id, decision_id, bundle_id, public_id, approved_bundle_hash, publish_generation, publication_status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'queued', NULL, ?, ?)"
      ).run(
        publicationId,
        decisionId,
        request.expected.bundleId,
        publicId,
        latest.material.bundleHash,
        createdAt,
        createdAt
      );
      const changed = this.database.prepare(
        "UPDATE pending_review_candidate SET review_status='approved' WHERE candidate_id=? AND source_revision=? AND source_payload_hash=? AND review_status='pending_review'"
      ).run(candidate.candidateId, candidate.sourceRevision, candidate.sourcePayloadHash);
      if (Number(changed.changes) !== 1) throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
      const candidateView = this.view(this.candidate(candidate.candidateId), false) as ReviewQueueItem;
      const decisionSummary = candidateView.decision;
      const publicationSummary = candidateView.publication;
      if (decisionSummary === null || publicationSummary === null) {
        throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      }
      return this.persistSuccess({
        operationId: request.operationId,
        operationType: "approve",
        path,
        requestHash,
        actorRef,
        candidateId: candidate.candidateId,
        bundleId: request.expected.bundleId,
        publicId,
        deliveryId: null,
        eventType: "review_approved",
        entityType: "decision",
        entityId: decisionId,
        createdAt,
        schema: ApproveSuccessSchema,
        buildResponse: (operation) => ({
          schemaVersion: "admin-review-v0.2",
          operation,
          candidate: candidateView,
          decision: decisionSummary,
          publication: publicationSummary
        })
      });
    });
  }

  reject(request: RejectRequest, path: string, actorRef: string): RejectSuccess {
    const requestHash = sha256(canonicalJson(request));
    return this.transaction(() => {
      const replay = this.storedOperation({
        operationId: request.operationId,
        operationType: "reject",
        path,
        requestHash,
        schema: RejectSuccessSchema
      });
      if (replay !== null) return replay;
      const candidateRow = this.candidate(request.expected.candidateId);
      const candidate = toCandidateSnapshot(candidateRow);
      const latest = this.latestBundle(candidate.candidateId);
      if (candidate.sourceRevision !== request.expected.sourceRevision) {
        throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
      }
      if (
        latest === null ||
        requiredText(latest.row, "bundle_id") !== request.expected.bundleId ||
        latest.material.bundleHash.slice(0, 12) !== request.expected.bundleVersionTag ||
        requiredInteger(latest.row, "source_revision") !== candidate.sourceRevision ||
        requiredText(latest.row, "source_payload_hash") !== candidate.sourcePayloadHash ||
        candidate.editorBasedOnSourceRevision !== candidate.sourceRevision
      ) {
        throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
      }
      if (this.decision(request.expected.bundleId) !== null) {
        throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
      }
      const createdAt = this.now();
      const decisionId = derivedId("decision", request.operationId);
      this.database.prepare(
        "INSERT INTO review_decision (decision_id, bundle_id, decision, approved_bundle_hash, rejection_reason, decided_at) VALUES (?, ?, 'rejected', NULL, ?, ?)"
      ).run(decisionId, request.expected.bundleId, request.reason, createdAt);
      const changed = this.database.prepare(
        "UPDATE pending_review_candidate SET review_status='rejected' WHERE candidate_id=? AND source_revision=? AND source_payload_hash=? AND review_status='pending_review'"
      ).run(candidate.candidateId, candidate.sourceRevision, candidate.sourcePayloadHash);
      if (Number(changed.changes) !== 1) throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
      const candidateView = this.view(this.candidate(candidate.candidateId), false) as ReviewQueueItem;
      const decisionSummary = candidateView.decision;
      if (decisionSummary === null) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      return this.persistSuccess({
        operationId: request.operationId,
        operationType: "reject",
        path,
        requestHash,
        actorRef,
        candidateId: candidate.candidateId,
        bundleId: request.expected.bundleId,
        publicId: null,
        deliveryId: null,
        eventType: "review_rejected",
        entityType: "decision",
        entityId: decisionId,
        createdAt,
        schema: RejectSuccessSchema,
        buildResponse: (operation) => ({
          schemaVersion: "admin-review-v0.2",
          operation,
          candidate: candidateView,
          decision: decisionSummary
        })
      });
    });
  }

  publish(request: PublishRequest, path: string, actorRef: string): PublishSuccess {
    const requestHash = sha256(canonicalJson(request));
    return this.transaction(() => {
      const replay = this.storedOperation({
        operationId: request.operationId,
        operationType: "publish",
        path,
        requestHash,
        schema: PublishSuccessSchema
      });
      if (replay !== null) return replay;
      const publication = this.database.prepare(
        "SELECT * FROM publication WHERE public_id = ?"
      ).get(request.expected.publicId) as SqlRow | undefined;
      if (!publication) throw new ReviewRealError("PUBLICATION_NOT_FOUND", 404);
      if (
        requiredText(publication, "publication_status") !== request.expected.publicationStatus ||
        requiredInteger(publication, "publish_generation") !== request.expected.publishGeneration ||
        requiredText(publication, "approved_bundle_hash").slice(0, 12) !== request.expected.approvedBundleVersionTag
      ) {
        throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
      }
      const bundleId = requiredText(publication, "bundle_id");
      const bundleRow = this.database.prepare(
        "SELECT * FROM review_bundle WHERE bundle_id = ?"
      ).get(bundleId) as SqlRow | undefined;
      if (!bundleRow) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      const bundle = verifyStoredReviewBundle({
        bundleId,
        bundleRevision: requiredInteger(bundleRow, "bundle_revision"),
        createdAt: requiredText(bundleRow, "created_at"),
        publicPayloadJson: requiredText(bundleRow, "public_payload_json"),
        publicPayloadHash: requiredText(bundleRow, "public_payload_hash"),
        editorNotes: requiredText(bundleRow, "editor_notes"),
        bundleHash: requiredText(bundleRow, "bundle_hash")
      });
      const candidate = toCandidateSnapshot(this.candidate(requiredText(bundleRow, "candidate_id")));
      const latest = this.latestBundle(candidate.candidateId);
      if (
        latest === null ||
        requiredText(latest.row, "bundle_id") !== bundleId ||
        latest.material.bundleHash !== bundle.bundleHash ||
        candidate.sourceRevision !== requiredInteger(bundleRow, "source_revision") ||
        candidate.sourcePayloadHash !== requiredText(bundleRow, "source_payload_hash") ||
        candidate.editorBasedOnSourceRevision !== candidate.sourceRevision
      ) {
        throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
      }
      const decision = this.decision(bundleId);
      if (
        decision === null ||
        requiredText(decision, "decision") !== "approved" ||
        nullableText(decision, "approved_bundle_hash") !== bundle.bundleHash
      ) {
        throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
      }
      if (this.database.prepare(
        "SELECT 1 AS present FROM published_projection WHERE publication_id = ?"
      ).get(requiredText(publication, "publication_id"))) {
        throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
      }
      const previousOutbox = this.database.prepare(
        "SELECT * FROM projection_outbox ORDER BY snapshot_generation DESC LIMIT 1"
      ).get() as SqlRow | undefined;
      if (previousOutbox !== undefined && requiredText(previousOutbox, "status") !== "succeeded") {
        throw new ReviewRealError("PUBLICATION_RECONCILE_WAIT", 409);
      }
      const createdAt = this.now();
      const publicationId = requiredText(publication, "publication_id");
      const changedPublication = this.database.prepare(
        "UPDATE publication SET publication_status='published', published_at=?, updated_at=? WHERE publication_id=? AND publication_status='queued' AND published_at IS NULL"
      ).run(createdAt, createdAt, publicationId);
      if (Number(changedPublication.changes) !== 1) throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
      const projection = buildPublicProjectionRecord({
        publicId: request.expected.publicId,
        bundleHash: bundle.bundleHash,
        publishedAt: createdAt,
        publicPayload: bundle.publicPayload
      });
      const projectionId = derivedId("projection", request.operationId);
      this.database.prepare(
        "INSERT INTO published_projection (projection_id, publication_id, bundle_id, public_id, publish_generation, projection_json, projection_hash, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)"
      ).run(
        projectionId,
        publicationId,
        bundleId,
        request.expected.publicId,
        canonicalJson(projection),
        projection.projectionHash,
        createdAt
      );
      const projections = (this.database.prepare(
        "SELECT projection_json, projection_hash FROM published_projection ORDER BY public_id"
      ).all() as SqlRow[]).map((row) => verifyStoredPublicProjection(
        requiredText(row, "projection_json"),
        requiredText(row, "projection_hash")
      ));
      const snapshotGeneration = previousOutbox === undefined
        ? 1
        : requiredInteger(previousOutbox, "snapshot_generation") + 1;
      const previousSnapshotManifestHash = previousOutbox === undefined
        ? null
        : requiredText(previousOutbox, "snapshot_manifest_hash");
      const snapshot = buildProjectionSnapshot({ snapshotGeneration, previousSnapshotManifestHash, records: projections });
      const deliveryId = `op-snapshot-${snapshot.snapshotManifestHash}`;
      const source = this.database.prepare(
        "SELECT stop_epoch FROM source WHERE source_id = ?"
      ).get(candidate.sourceId) as SqlRow | undefined;
      if (!source) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      const idempotencyKey = `snapshot-sync:${requiredInteger(source, "stop_epoch")}:${snapshot.snapshotManifestHash}`;
      const reconcileKey = `reconcile:snapshot:${snapshot.snapshotManifestHash}`;
      const deadlineAt = new Date(Date.parse(createdAt) + 15 * 60 * 1000).toISOString();
      const task = buildProjectionTaskEnvelope({
        deliveryId,
        idempotencyKey,
        reconcileKey,
        snapshot,
        attempt: 0,
        createdAt,
        deadlineAt
      });
      this.database.prepare(
        "INSERT INTO projection_outbox (delivery_id, publication_id, operation_type, snapshot_generation, snapshot_manifest_hash, idempotency_key, reconcile_key, task_envelope_json, task_envelope_hash, status, attempt_count, max_attempts, lease_token, lease_expires_at, last_reason_code, created_at, updated_at) VALUES (?, ?, 'snapshot_sync', ?, ?, ?, ?, ?, ?, 'pending', 0, 3, NULL, NULL, NULL, ?, ?)"
      ).run(
        deliveryId,
        publicationId,
        snapshot.snapshotGeneration,
        snapshot.snapshotManifestHash,
        idempotencyKey,
        reconcileKey,
        task.envelopeJson,
        task.envelopeHash,
        createdAt,
        createdAt
      );
      const changedCandidate = this.database.prepare(
        "UPDATE pending_review_candidate SET review_status='published' WHERE candidate_id=? AND source_revision=? AND source_payload_hash=? AND review_status='approved'"
      ).run(candidate.candidateId, candidate.sourceRevision, candidate.sourcePayloadHash);
      if (Number(changedCandidate.changes) !== 1) throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
      const candidateView = this.view(this.candidate(candidate.candidateId), false) as ReviewQueueItem;
      const publicationSummary = candidateView.publication;
      const deliverySummary = candidateView.delivery;
      if (publicationSummary === null || deliverySummary === null) {
        throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      }
      return this.persistSuccess({
        operationId: request.operationId,
        operationType: "publish",
        path,
        requestHash,
        actorRef,
        candidateId: candidate.candidateId,
        bundleId,
        publicId: request.expected.publicId,
        deliveryId,
        eventType: "publication_published",
        entityType: "publication",
        entityId: publicationId,
        createdAt,
        schema: PublishSuccessSchema,
        buildResponse: (operation) => ({
          schemaVersion: "admin-review-v0.2",
          operation,
          candidate: candidateView,
          publication: publicationSummary,
          delivery: deliverySummary,
          status: "delivery_pending",
          publicPath: null
        })
      });
    });
  }

  operation(operationId: string): OperationReceipt {
    const row = this.database.prepare(
      "SELECT * FROM admin_operation WHERE operation_id = ?"
    ).get(operationId) as SqlRow | undefined;
    if (!row) throw new ReviewRealError("ADMIN_OPERATION_NOT_FOUND", 404);
    const operationType = requiredText(row, "operation_type") as OperationType;
    if (!["revision", "approve", "reject", "publish"].includes(operationType)) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    const responseJson = requiredText(row, "response_json");
    if (sha256(responseJson) !== requiredText(row, "response_hash") || canonicalJson(parseJson(responseJson)) !== responseJson) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    const response = parseStored(responseSchema(operationType), parseJson(responseJson)) as { operation?: unknown };
    return parseStored(OperationReceiptSchema, response.operation);
  }

  deliveryTask(deliveryId: string): Readonly<{
    envelope: ProjectionTaskEnvelope;
    envelopeJson: string;
    envelopeHash: string;
  }> {
    const row = this.database.prepare(
      "SELECT task_envelope_json, task_envelope_hash FROM projection_outbox WHERE delivery_id = ?"
    ).get(deliveryId) as SqlRow | undefined;
    if (!row) throw new ReviewRealError("PROJECTION_RECEIPT_UNKNOWN", 404);
    const envelopeJson = requiredText(row, "task_envelope_json");
    const envelopeHash = requiredText(row, "task_envelope_hash");
    return {
      envelope: verifyStoredProjectionTaskEnvelope(envelopeJson, envelopeHash),
      envelopeJson,
      envelopeHash
    };
  }
}
