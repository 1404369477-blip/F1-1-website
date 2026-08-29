import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { z } from "zod";

import { withImmediateTransaction } from "../db/database.ts";
import { canonicalJson } from "../db/profile.ts";
import type {
  EntityBinding,
  EntityKind,
  MutationKind,
  OperationKind,
  OwnerProcess,
} from "../internal-operation/gateway.ts";
import type {
  GatewayMutationPort,
  GatewayMutationTransactionInput,
} from "../internal-operation/mutation-port.ts";
import { liveRssDisplayName } from "../rss/sources.ts";
import {
  buildAuditEventMaterial,
  buildProjectionSnapshot,
  buildProjectionTaskEnvelope,
  buildPublicProjectionRecord,
  buildReviewBundleMaterial,
  normalizeProjectionKeyPoints,
  derivePublicId,
  verifyStoredAuditEvent,
  verifyStoredProjectionTaskEnvelope,
  verifyStoredPublicProjection,
  verifyStoredReviewBundle,
  type ReviewBundleMaterial,
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
  ReleaseNowRequestSchema,
  RejectSuccessSchema,
  ReviewDetailSchema,
  ReviewListSchema,
  ReviewQueueItemSchema,
  RevisionRequestSchema,
  RevisionSuccessSchema,
  type CandidateSourceSnapshot,
  type ProjectionTaskEnvelope,
  type SourceImage,
} from "./schema.ts";
import { asReviewRealError, ReviewRealError } from "./error.ts";
import {
  ProjectionReceiptSchema,
  type ProjectionReceipt,
} from "./projection.ts";

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
export type ReleaseNowRequest = z.infer<typeof ReleaseNowRequestSchema>;

export type AutomaticReviewItemReceipt = Readonly<{
  candidateId: string;
  sourceRevision: number;
  status: "approved" | "rejected" | "waiting" | "manual_override" | "failed";
  reasonCode: string;
}>;

export type AutomaticReviewBatchReceipt = Readonly<{
  schemaVersion: "automatic-review-receipt-v1";
  considered: number;
  approved: number;
  rejected: number;
  waiting: number;
  manualOverride: number;
  failed: number;
  items: readonly AutomaticReviewItemReceipt[];
}>;

export type AutomaticPublishItemReceipt = Readonly<{
  candidateId: string;
  sourceRevision: number;
  publicId: string | null;
  status: "published" | "blocked" | "failed";
  reasonCode: string;
}>;

export type AutomaticPublishBatchReceipt = Readonly<{
  schemaVersion: "automatic-publish-receipt-v1";
  considered: number;
  published: number;
  blocked: number;
  failed: number;
  deliveryId: string | null;
  items: readonly AutomaticPublishItemReceipt[];
}>;

type OperationType = OperationReceipt["operationType"];
type StoredBundle = Readonly<{ row: SqlRow; material: ReviewBundleMaterial }>;

export type ProjectionDeliveryWork = Readonly<{
  deliveryId: string;
  leaseToken: string | null;
  attemptCount: number;
  maxAttempts: number;
  envelope: ProjectionTaskEnvelope;
  envelopeJson: string;
  envelopeHash: string;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function derivedId(prefix: string, operationId: string): string {
  return `${prefix}-${sha256(`${prefix}\n${operationId}`)}`;
}

function requiredText(row: SqlRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string")
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  return value;
}

function previousOutboxBlocksNewGeneration(
  status: string | undefined,
): boolean {
  return (
    status !== undefined &&
    status !== "succeeded" &&
    status !== "terminal_failed" &&
    status !== "cancelled"
  );
}

function nullableText(row: SqlRow, field: string): string | null {
  const value = row[field];
  if (value === null) return null;
  if (typeof value !== "string")
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  return value;
}

function requiredInteger(row: SqlRow, field: string): number {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value))
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
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

function containsHan(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

const UNSAFE_TEXT_CONTROL_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u;

function automaticReviewSecurityReason(detail: ReviewDetail): string | null {
  const draft = detail.machineDraft;
  if (draft === null || draft.sourceRevision !== detail.sourceRevision)
    return "AUTO_REVIEW_WAITING_FOR_CHINESE";
  if (!containsHan(draft.titleZh) || !containsHan(draft.summaryZh))
    return "AUTO_REVIEW_WAITING_FOR_CHINESE";
  const textFields = [
    detail.sourceTitle,
    detail.sourceExcerpt,
    detail.sourceAuthor ?? "",
    detail.titleZh ?? "",
    detail.summaryZh ?? "",
    draft.titleZh,
    draft.summaryZh,
    ...draft.keyPointsZh,
  ];
  return textFields.some((value) => UNSAFE_TEXT_CONTROL_PATTERN.test(value))
    ? "AUTO_SECURITY_UNSAFE_TEXT_CONTROL"
    : null;
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
    editorBasedOnSourceRevision:
      row.editor_based_on_source_revision === null
        ? null
        : requiredInteger(row, "editor_based_on_source_revision"),
    reviewStatus: requiredText(row, "review_status"),
    firstSeenAt: requiredText(row, "first_seen_at"),
    lastSeenAt: requiredText(row, "last_seen_at"),
  });
}

function latestTimestamp(values: readonly (string | null)[]): string {
  const present = values.filter((value): value is string => value !== null);
  if (present.length === 0)
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  return present.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest,
  );
}

export class ReviewRealRepository {
  private readonly database: DatabaseSync;
  private readonly clock: Clock;
  private readonly mutationPort: GatewayMutationPort | undefined;
  private mutationOwner: OwnerProcess = "admin_http";
  private activeGatewayMutate:
    | ((input: {
        entityKind: EntityKind;
        entityId: string;
        mutationKind: MutationKind;
        expectedVersion: number | null;
        expectedHash: string;
        statement: string;
        parameters?: readonly unknown[];
      }) => number)
    | null = null;

  constructor(
    database: DatabaseSync,
    clock: Clock = () => new Date(),
    mutationPort?: GatewayMutationPort,
  ) {
    this.database = database;
    this.clock = clock;
    this.mutationPort = mutationPort;
  }

  /** Schema 7 external work is valid only when a gateway attempt runner is present. */
  public requiresGatewayExternalAttempt(): boolean {
    return (
      Number(
        (this.database.prepare("PRAGMA user_version").get() as SqlRow)
          .user_version,
      ) >= 7
    );
  }

  private now(): string {
    const value = this.clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    return value.toISOString();
  }

  private transaction<T>(
    callback: () => T,
    ownerProcess: OwnerProcess = this.mutationOwner,
    gatewayContext?: () => GatewayMutationTransactionInput,
  ): T {
    const previousOwner = this.mutationOwner;
    this.mutationOwner = ownerProcess;
    try {
      const version = Number(
        (this.database.prepare("PRAGMA user_version").get() as SqlRow)
          .user_version,
      );
      // Schema 7 transactions are owned by the gateway operation.  Starting
      // an outer BEGIN IMMEDIATE here would create a second writer boundary
      // and would make the repository capable of bypassing the permit batch.
      if (version >= 7) {
        if (
          !this.mutationPort?.runTransaction ||
          gatewayContext === undefined
        ) {
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        }
        const previousMutate = this.activeGatewayMutate;
        return this.mutationPort.runTransaction(gatewayContext(), (mutate) => {
          this.activeGatewayMutate = mutate;
          try {
            return callback();
          } finally {
            this.activeGatewayMutate = previousMutate;
          }
        });
      }
      return withImmediateTransaction(this.database, callback);
    } catch (error) {
      if (error instanceof ReviewRealError) throw error;
      throw asReviewRealError(error);
    } finally {
      this.mutationOwner = previousOwner;
    }
  }

  private write(
    input: Readonly<{
      operationKind: OperationKind;
      entityKind: EntityKind;
      entityId: string;
      mutationKind: MutationKind;
      statement: string;
      parameters?: readonly unknown[];
      identity?: Readonly<{
        sourceId: string | null;
        candidateId: string | null;
        publicationId: string | null;
        publicId: string | null;
      }>;
    }>,
  ): number {
    const version = Number(
      (this.database.prepare("PRAGMA user_version").get() as SqlRow)
        .user_version,
    );
    if (version >= 7) {
      if (!this.mutationPort)
        throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      if (this.activeGatewayMutate !== null) {
        return this.activeGatewayMutate({
          entityKind: input.entityKind,
          entityId: input.entityId,
          mutationKind: input.mutationKind,
          expectedVersion: null,
          expectedHash: "0".repeat(64),
          statement: input.statement,
          parameters: input.parameters,
        });
      }
      if (this.mutationPort.runTransaction) {
        // All schema-7 repository mutations must run through a transaction
        // context.  A standalone write has no declared complete entity set,
        // so fail closed instead of silently opening a second operation.
        throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      }
      const identity =
        input.identity ?? this.identityFor(input.entityKind, input.entityId);
      const operationId = `gateway-${sha256(
        canonicalJson({
          operationKind: input.operationKind,
          ownerProcess: this.mutationOwner,
          entityKind: input.entityKind,
          entityId: input.entityId,
          mutationKind: input.mutationKind,
          statement: input.statement,
          parameters: input.parameters ?? [],
        }),
      ).slice(0, 48)}`;
      return this.mutationPort.mutate({
        operationId,
        operationKind: input.operationKind,
        entityKind: input.entityKind,
        entityId: input.entityId,
        mutationKind: input.mutationKind,
        statement: input.statement,
        parameters: input.parameters,
        identity,
      });
    }
    return Number(
      this.database
        .prepare(input.statement)
        .run(...((input.parameters ?? []) as any[])).changes,
    );
  }

  private gatewayBinding(
    entityKind: EntityKind,
    entityId: string,
    selector?: EntityBinding["identitySelector"],
  ): EntityBinding {
    const identitySelector =
      selector ??
      (entityKind === "candidate"
        ? "candidate_id"
        : entityKind === "publication"
          ? "publication_id"
          : entityKind === "published_projection"
            ? "public_id"
            : entityKind === "internal_control"
              ? "control_singleton"
              : "bound_child");
    return Object.freeze({
      entityKind,
      entityId,
      identitySelector,
      expectedVersion: null,
      expectedHash: "0".repeat(64),
    });
  }

  private gatewayReviewContext(
    operationId: string,
    identity: Readonly<{
      sourceId: string | null;
      candidateId: string | null;
      publicationId: string | null;
      publicId: string | null;
    }>,
    bindings: readonly EntityBinding[],
  ): GatewayMutationTransactionInput {
    if (identity.sourceId === null || identity.candidateId === null)
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    const source = this.database
      .prepare("SELECT stop_epoch FROM source WHERE source_id=?")
      .get(identity.sourceId) as SqlRow | undefined;
    if (source === undefined)
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    const entitySet = [this.gatewayBinding("source", identity.sourceId, "source_id"), ...bindings];
    if (identity.publicId !== null && !entitySet.some((binding) => binding.identitySelector === "public_id" && binding.entityId === identity.publicId)) {
      entitySet.push(this.gatewayBinding("published_projection", identity.publicId, "public_id"));
    }
    return {
      operationId,
      operationKind: "review",
      // Identity-scoped source binding is required even when this operation
      // does not mutate the source row; schema-7 authorization verifies every
      // non-null operation identity against its declared entity set.
      entitySet,
      identity,
      capabilityClass: "db_mutation",
      egressClass: "none",
      sourceStopEpoch: requiredInteger(source, "stop_epoch"),
    };
  }

  private gatewayPublishContext(
    operationId: string,
    identity: Readonly<{
      sourceId: string | null;
      candidateId: string | null;
      publicationId: string | null;
      publicId: string | null;
    }>,
    bindings: readonly EntityBinding[],
  ): GatewayMutationTransactionInput {
    if (identity.publicationId === null || identity.publicId === null)
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    const sourceStopEpoch = identity.sourceId === null
      ? null
      : requiredInteger(
        this.database
          .prepare("SELECT stop_epoch FROM source WHERE source_id=?")
          .get(identity.sourceId) as SqlRow,
        "stop_epoch",
      );
    const entitySet = identity.sourceId === null
      ? [...bindings]
      : [this.gatewayBinding("source", identity.sourceId, "source_id"), ...bindings];
    if (!entitySet.some((binding) => binding.identitySelector === "public_id" && binding.entityId === identity.publicId)) {
      entitySet.push(this.gatewayBinding("published_projection", identity.publicId, "public_id"));
    }
    return {
      operationId,
      operationKind: "publish",
      entitySet,
      identity,
      capabilityClass: "db_mutation",
      egressClass: "none",
      sourceStopEpoch,
    };
  }

  private gatewayProjectionContext(
    operationId: string,
    identity: Readonly<{
      sourceId: string | null;
      candidateId: string | null;
      publicationId: string | null;
      publicId: string | null;
    }>,
    bindings: readonly EntityBinding[],
  ): GatewayMutationTransactionInput {
    if (identity.publicationId === null)
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    const phase = requiredText(
      this.database
        .prepare("SELECT phase FROM internal_control WHERE singleton_id=1")
        .get() as SqlRow,
      "phase",
    );
    if (phase !== "backlog" && phase !== "live")
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    const entitySet = [...bindings];
    if (!entitySet.some((binding) => binding.identitySelector === "publication_id" && binding.entityId === identity.publicationId)) {
      entitySet.push(this.gatewayBinding("publication", identity.publicationId, "publication_id"));
    }
    if (identity.publicId !== null && !entitySet.some((binding) => binding.identitySelector === "public_id" && binding.entityId === identity.publicId)) {
      entitySet.push(this.gatewayBinding("published_projection", identity.publicId, "public_id"));
    }
    return {
      operationId,
      operationKind: "projection",
      ownerProcess: "projection_sender",
      entitySet,
      identity,
      policyId: `p-projection-${phase}`,
      capabilityClass: "external_attempt",
      egressClass: "projection_private",
      budgetAccountId: "acct-projection",
    };
  }

  private identityFor(
    entityKind: EntityKind,
    entityId: string,
  ): Readonly<{
    sourceId: string | null;
    candidateId: string | null;
    publicationId: string | null;
    publicId: string | null;
  }> {
    if (entityKind === "source")
      return {
        sourceId: entityId,
        candidateId: null,
        publicationId: null,
        publicId: null,
      };
    if (entityKind === "candidate") {
      const row = this.database
        .prepare(
          "SELECT source_id FROM pending_review_candidate WHERE candidate_id=?",
        )
        .get(entityId) as SqlRow | undefined;
      return {
        sourceId: row?.source_id === undefined ? null : String(row.source_id),
        candidateId: entityId,
        publicationId: null,
        publicId: null,
      };
    }
    if (entityKind === "publication" || entityKind === "published_projection") {
      const row = this.database
        .prepare(
          "SELECT publication_id,public_id FROM publication WHERE publication_id=? OR public_id=?",
        )
        .get(entityId, entityId) as SqlRow | undefined;
      return {
        sourceId: null,
        candidateId: null,
        publicationId:
          row?.publication_id === undefined
            ? entityId
            : String(row.publication_id),
        publicId: row?.public_id === undefined ? null : String(row.public_id),
      };
    }
    return {
      sourceId: null,
      candidateId: null,
      publicationId: null,
      publicId: null,
    };
  }

  private projectionIdentity(row: SqlRow): Readonly<{
    sourceId: string | null;
    candidateId: string | null;
    publicationId: string | null;
    publicId: string | null;
  }> {
    const publicationId =
      row.publication_id === undefined || row.publication_id === null
        ? null
        : String(row.publication_id);
    if (publicationId === null)
      return {
        sourceId: null,
        candidateId: null,
        publicationId: null,
        publicId: null,
      };
    const publication = this.database
      .prepare("SELECT public_id FROM publication WHERE publication_id=?")
      .get(publicationId) as SqlRow | undefined;
    return {
      sourceId: null,
      candidateId: null,
      publicationId,
      publicId:
        publication?.public_id === undefined
          ? null
          : String(publication.public_id),
    };
  }

  private candidate(candidateId: string): SqlRow {
    const row = this.database
      .prepare("SELECT * FROM pending_review_candidate WHERE candidate_id = ?")
      .get(candidateId) as SqlRow | undefined;
    if (!row) throw new ReviewRealError("REVIEW_CANDIDATE_NOT_FOUND", 404);
    toCandidateSnapshot(row);
    return row;
  }

  private latestBundle(candidateId: string): StoredBundle | null {
    const row = this.database
      .prepare(
        "SELECT * FROM review_bundle WHERE candidate_id = ? ORDER BY bundle_revision DESC LIMIT 1",
      )
      .get(candidateId) as SqlRow | undefined;
    if (!row) return null;
    const material = verifyStoredReviewBundle({
      bundleId: requiredText(row, "bundle_id"),
      bundleRevision: requiredInteger(row, "bundle_revision"),
      createdAt: requiredText(row, "created_at"),
      publicPayloadJson: requiredText(row, "public_payload_json"),
      publicPayloadHash: requiredText(row, "public_payload_hash"),
      editorNotes: requiredText(row, "editor_notes"),
      bundleHash: requiredText(row, "bundle_hash"),
    });
    return { row, material };
  }

  private decision(bundleId: string): SqlRow | null {
    return (
      (this.database
        .prepare("SELECT * FROM review_decision WHERE bundle_id = ?")
        .get(bundleId) as SqlRow | undefined) ?? null
    );
  }

  private publication(bundleId: string): SqlRow | null {
    return (
      (this.database
        .prepare("SELECT * FROM publication WHERE bundle_id = ?")
        .get(bundleId) as SqlRow | undefined) ?? null
    );
  }

  private delivery(publicationId: string): SqlRow | null {
    const row = this.database
      .prepare("SELECT * FROM projection_outbox WHERE publication_id = ?")
      .get(publicationId) as SqlRow | undefined;
    if (!row) return null;
    verifyStoredProjectionTaskEnvelope(
      requiredText(row, "task_envelope_json"),
      requiredText(row, "task_envelope_hash"),
    );
    return row;
  }

  private sourceMedia(
    candidateId: string,
    sourceRevision: number,
    sourcePayloadHash: string,
  ): SourceImage | null {
    if (
      this.database
        .prepare(
          "SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='rss_media_candidate'",
        )
        .get() === undefined
    )
      return null;
    const row = this.database
      .prepare(
        "SELECT media_url, media_type, declared_bytes FROM rss_media_candidate WHERE candidate_id = ? AND source_revision = ? AND source_payload_hash = ?",
      )
      .get(candidateId, sourceRevision, sourcePayloadHash) as
      SqlRow | undefined;
    if (!row) return null;
    return {
      kind: "source_image",
      url: requiredText(row, "media_url"),
      mimeType: requiredText(row, "media_type") as SourceImage["mimeType"],
      declaredBytes: requiredInteger(row, "declared_bytes"),
    };
  }

  private machineDraft(
    candidateId: string,
    sourceRevision: number,
    sourcePayloadHash: string,
  ): Record<string, unknown> | null {
    if (
      this.database
        .prepare(
          "SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='machine_summary_draft'",
        )
        .get() === undefined
    )
      return null;
    const row = this.database
      .prepare(
        "SELECT title_zh, summary_zh, key_points_zh_json, model, generated_at, source_revision FROM machine_summary_draft WHERE candidate_id = ? AND source_revision = ? AND source_payload_hash = ? ORDER BY generated_at DESC, draft_id DESC LIMIT 1",
      )
      .get(candidateId, sourceRevision, sourcePayloadHash) as
      SqlRow | undefined;
    if (!row) return null;
    return {
      titleZh: requiredText(row, "title_zh"),
      summaryZh: requiredText(row, "summary_zh"),
      keyPointsZh: parseJson(requiredText(row, "key_points_zh_json")),
      model: requiredText(row, "model"),
      generatedAt: requiredText(row, "generated_at"),
      sourceRevision: requiredInteger(row, "source_revision"),
    };
  }

  private view(
    candidateRow: SqlRow,
    detail: boolean,
  ): ReviewQueueItem | ReviewDetail {
    const candidate = toCandidateSnapshot(candidateRow);
    const latest = this.latestBundle(candidate.candidateId);
    const decision =
      latest === null
        ? null
        : this.decision(requiredText(latest.row, "bundle_id"));
    const publication =
      latest === null
        ? null
        : this.publication(requiredText(latest.row, "bundle_id"));
    const delivery =
      publication === null
        ? null
        : this.delivery(requiredText(publication, "publication_id"));
    const sourceMedia = this.sourceMedia(
      candidate.candidateId,
      candidate.sourceRevision,
      candidate.sourcePayloadHash,
    );
    const machineDraft = this.machineDraft(
      candidate.candidateId,
      candidate.sourceRevision,
      candidate.sourcePayloadHash,
    );
    const sourceStale =
      latest !== null &&
      (requiredInteger(latest.row, "source_revision") !==
        candidate.sourceRevision ||
        requiredText(latest.row, "source_payload_hash") !==
          candidate.sourcePayloadHash ||
        candidate.editorBasedOnSourceRevision !== candidate.sourceRevision);

    let reviewState: ReviewQueueItem["reviewState"] = "pending_review";
    if (sourceStale) reviewState = "source_updated";
    else if (delivery !== null) {
      const status = requiredText(delivery, "status");
      if (status === "succeeded") reviewState = "published";
      else if (status === "terminal_failed" || status === "cancelled")
        reviewState = "terminal_failed";
      else if (status === "reconcile_wait" || status === "retryable_failed")
        reviewState = "reconcile_wait";
      else reviewState = "published_delivery_pending";
    } else if (publication !== null) {
      const status = requiredText(publication, "publication_status");
      if (status === "queued") reviewState = "approved_waiting_publish";
      else if (status === "reconcile_wait") reviewState = "reconcile_wait";
      else if (status === "terminal_failed") reviewState = "terminal_failed";
      else if (status === "emergency_stopped")
        reviewState = "emergency_stopped";
      else if (status === "superseded") reviewState = "blocked";
      else reviewState = "published_delivery_pending";
    } else if (
      decision !== null &&
      requiredText(decision, "decision") === "rejected"
    ) {
      reviewState = "rejected";
    }

    const allowedActions: ReviewQueueItem["allowedActions"] = [];
    if (latest === null || sourceStale) allowedActions.push("revision");
    else if (decision === null)
      allowedActions.push("revision", "approve", "reject");
    else if (publication === null)
      allowedActions.push("revision", "return_to_queue");
    else if (requiredText(publication, "publication_status") === "queued")
      allowedActions.push("publish");
    else if (
      delivery !== null &&
      requiredText(delivery, "status") === "succeeded"
    )
      allowedActions.push("open_public_story");
    else if (delivery !== null) allowedActions.push("check_delivery");

    const latestBundleSummary =
      latest === null
        ? null
        : {
            id: requiredText(latest.row, "bundle_id"),
            revision: requiredInteger(latest.row, "bundle_revision"),
            versionTag: latest.material.bundleHash.slice(0, 12),
          };
    const decisionSummary =
      decision === null
        ? null
        : {
            id: requiredText(decision, "decision_id"),
            bundleId: requiredText(decision, "bundle_id"),
            decision: requiredText(decision, "decision"),
            rejectionReason: nullableText(decision, "rejection_reason"),
            decidedAt: requiredText(decision, "decided_at"),
          };
    const publicationSummary =
      publication === null
        ? null
        : {
            id: requiredText(publication, "publication_id"),
            publicId: requiredText(publication, "public_id"),
            bundleId: requiredText(publication, "bundle_id"),
            publishGeneration: requiredInteger(
              publication,
              "publish_generation",
            ),
            status: requiredText(publication, "publication_status"),
            publishedAt: nullableText(publication, "published_at"),
            updatedAt: requiredText(publication, "updated_at"),
          };
    const deliverySummary =
      delivery === null
        ? null
        : {
            id: requiredText(delivery, "delivery_id"),
            status: requiredText(delivery, "status"),
            snapshotGeneration: requiredInteger(
              delivery,
              "snapshot_generation",
            ),
            attemptCount: requiredInteger(delivery, "attempt_count"),
            reasonCode: nullableText(delivery, "last_reason_code") ?? "NONE",
            updatedAt: requiredText(delivery, "updated_at"),
          };
    const updatedAt = latestTimestamp([
      candidate.lastSeenAt,
      latest === null ? null : requiredText(latest.row, "created_at"),
      decision === null ? null : requiredText(decision, "decided_at"),
      publication === null ? null : requiredText(publication, "updated_at"),
      delivery === null ? null : requiredText(delivery, "updated_at"),
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
      sourceDisplayName: liveRssDisplayName(candidate.sourceId),
      originalUrl: candidate.canonicalUrl,
      mediaState:
        sourceMedia === null ? ("none" as const) : ("source_image" as const),
      reviewState,
      latestBundle: latestBundleSummary,
      decision: decisionSummary,
      publication: publicationSummary,
      delivery: deliverySummary,
      updatedAt,
      allowedActions,
    };
    if (!detail) return parseStored(ReviewQueueItemSchema, common);
    return parseStored(ReviewDetailSchema, {
      schemaVersion: "admin-review-v0.2",
      ...common,
      sourceExcerpt: candidate.sourceExcerpt,
      sourceMedia,
      machineDraft,
      editorNotes: latest?.material.editorNotes ?? candidate.editorNotes,
      integrity: {
        status: sourceStale ? "blocked" : "ok",
        reasonCode: sourceStale ? "REVIEW_SOURCE_STALE" : null,
        versionTag: candidate.sourcePayloadHash.slice(0, 12),
      },
    });
  }

  private prepareReleaseItem(
    item: ReleaseNowRequest["expected"]["items"][number],
    request: ReleaseNowRequest,
    createdAt: string,
  ): Readonly<{
    candidate: CandidateSourceSnapshot;
    bundle: ReviewBundleMaterial;
    bundleId: string;
    publicationId: string;
    publicId: string;
  }> {
    const candidate = toCandidateSnapshot(this.candidate(item.candidateId));
    if (
      candidate.sourceRevision !== item.sourceRevision ||
      candidate.sourcePayloadHash.slice(0, 12) !== item.sourceVersionTag
    ) {
      throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
    }
    let latest = this.latestBundle(candidate.candidateId);
    if (
      (latest === null) !== (item.latestBundleId === null) ||
      (latest !== null &&
        (requiredText(latest.row, "bundle_id") !== item.latestBundleId ||
          latest.material.bundleHash.slice(0, 12) !==
            item.latestBundleVersionTag))
    ) {
      throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
    }

    const sourceStale =
      latest !== null &&
      (requiredInteger(latest.row, "source_revision") !==
        candidate.sourceRevision ||
        requiredText(latest.row, "source_payload_hash") !==
          candidate.sourcePayloadHash);
    const editable =
      request.editable ??
      (latest === null || sourceStale
        ? this.editableFromDraft(candidate)
        : null);
    if (editable !== null) {
      const latestDecision =
        latest === null
          ? null
          : this.decision(requiredText(latest.row, "bundle_id"));
      if (latestDecision !== null && !sourceStale) {
        throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
      }
      const bundleId = derivedId(
        "bundle",
        `${request.operationId}:${candidate.candidateId}`,
      );
      const bundleRevision =
        latest === null
          ? 1
          : requiredInteger(latest.row, "bundle_revision") + 1;
      const changed = this.write({
        operationKind: "review",
        entityKind: "candidate",
        entityId: candidate.candidateId,
        mutationKind: "update",
        statement:
          "UPDATE pending_review_candidate SET editor_title=?, editor_excerpt=?, editor_notes=?, editor_based_on_source_revision=?, review_status='pending_review' WHERE candidate_id=? AND source_revision=? AND source_payload_hash=?",
        parameters: [
          editable.titleZh,
          editable.summaryZh,
          editable.notes,
          candidate.sourceRevision,
          candidate.candidateId,
          candidate.sourceRevision,
          candidate.sourcePayloadHash,
        ],
        identity: {
          sourceId: candidate.sourceId,
          candidateId: candidate.candidateId,
          publicationId: null,
          publicId: null,
        },
      });
      if (changed !== 1) throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
      const updatedCandidate = toCandidateSnapshot(
        this.candidate(candidate.candidateId),
      );
      const bundle = buildReviewBundleMaterial({
        bundleId,
        bundleRevision,
        createdAt,
        candidate: updatedCandidate,
        editable,
        media: this.sourceMedia(
          candidate.candidateId,
          candidate.sourceRevision,
          candidate.sourcePayloadHash,
        ),
      });
      const bundleInserted = this.write({
        operationKind: "review",
        entityKind: "review_bundle",
        entityId: bundleId,
        mutationKind: "insert",
        statement:
          "INSERT INTO review_bundle (bundle_id, candidate_id, bundle_revision, source_revision, source_payload_hash, public_payload_json, public_payload_hash, editor_notes, bundle_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        parameters: [
          bundleId,
          candidate.candidateId,
          bundleRevision,
          candidate.sourceRevision,
          candidate.sourcePayloadHash,
          bundle.publicPayloadJson,
          bundle.publicPayloadHash,
          bundle.editorNotes,
          bundle.bundleHash,
          createdAt,
        ],
        identity: {
          sourceId: candidate.sourceId,
          candidateId: candidate.candidateId,
          publicationId: null,
          publicId: null,
        },
      });
      if (bundleInserted !== 1)
        throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      latest = {
        row: this.database
          .prepare("SELECT * FROM review_bundle WHERE bundle_id = ?")
          .get(bundleId) as SqlRow,
        material: bundle,
      };
    }

    if (latest === null) throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
    const bundleId = requiredText(latest.row, "bundle_id");
    const refreshed = toCandidateSnapshot(
      this.candidate(candidate.candidateId),
    );
    if (
      requiredInteger(latest.row, "source_revision") !==
        refreshed.sourceRevision ||
      requiredText(latest.row, "source_payload_hash") !==
        refreshed.sourcePayloadHash ||
      refreshed.editorBasedOnSourceRevision !== refreshed.sourceRevision
    ) {
      throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
    }
    if (
      !containsHan(latest.material.publicPayload.titleZh) ||
      !containsHan(latest.material.publicPayload.summaryZh)
    ) {
      throw new ReviewRealError("REVIEW_CHINESE_REQUIRED", 409);
    }

    let decision = this.decision(bundleId);
    if (decision === null) {
      const decisionId = derivedId(
        "decision",
        `${request.operationId}:${candidate.candidateId}`,
      );
      const publicationId = derivedId(
        "publication",
        `${request.operationId}:${candidate.candidateId}`,
      );
      const publicId = derivePublicId(
        candidate.candidateId,
        latest.material.bundleHash,
      );
      const decisionInserted = this.write({
        operationKind: "review",
        entityKind: "review_decision",
        entityId: decisionId,
        mutationKind: "insert",
        statement:
          "INSERT INTO review_decision (decision_id, bundle_id, decision, approved_bundle_hash, rejection_reason, decided_at) VALUES (?, ?, 'approved', ?, NULL, ?)",
        parameters: [
          decisionId,
          bundleId,
          latest.material.bundleHash,
          createdAt,
        ],
        identity: {
          sourceId: candidate.sourceId,
          candidateId: candidate.candidateId,
          publicationId: null,
          publicId: null,
        },
      });
      if (decisionInserted !== 1)
        throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      const publicationInserted = this.write({
        operationKind: "review",
        entityKind: "publication",
        entityId: publicationId,
        mutationKind: "insert",
        statement:
          "INSERT INTO publication (publication_id, decision_id, bundle_id, public_id, approved_bundle_hash, publish_generation, publication_status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'queued', NULL, ?, ?)",
        parameters: [
          publicationId,
          decisionId,
          bundleId,
          publicId,
          latest.material.bundleHash,
          createdAt,
          createdAt,
        ],
        identity: {
          sourceId: candidate.sourceId,
          candidateId: candidate.candidateId,
          publicationId,
          publicId,
        },
      });
      if (publicationInserted !== 1)
        throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      const approved = this.write({
        operationKind: "review",
        entityKind: "candidate",
        entityId: candidate.candidateId,
        mutationKind: "update",
        statement:
          "UPDATE pending_review_candidate SET review_status='approved' WHERE candidate_id=? AND source_revision=? AND source_payload_hash=? AND review_status='pending_review'",
        parameters: [
          candidate.candidateId,
          candidate.sourceRevision,
          candidate.sourcePayloadHash,
        ],
        identity: {
          sourceId: candidate.sourceId,
          candidateId: candidate.candidateId,
          publicationId: null,
          publicId: null,
        },
      });
      if (approved !== 1) throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
      decision = this.decision(bundleId);
    }
    const publication = this.publication(bundleId);
    if (
      decision === null ||
      requiredText(decision, "decision") !== "approved" ||
      nullableText(decision, "approved_bundle_hash") !==
        latest.material.bundleHash ||
      publication === null ||
      requiredText(publication, "publication_status") !== "queued"
    ) {
      throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
    }
    if (
      this.database
        .prepare(
          "SELECT 1 AS present FROM published_projection WHERE publication_id = ?",
        )
        .get(requiredText(publication, "publication_id"))
    ) {
      throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
    }
    return {
      candidate: refreshed,
      bundle: latest.material,
      bundleId,
      publicationId: requiredText(publication, "publication_id"),
      publicId: requiredText(publication, "public_id"),
    };
  }

  private editableFromDraft(candidate: CandidateSourceSnapshot): {
    titleZh: string;
    summaryZh: string;
    notes: string;
  } {
    const draft = this.machineDraft(
      candidate.candidateId,
      candidate.sourceRevision,
      candidate.sourcePayloadHash,
    );
    const titleZh = typeof draft?.titleZh === "string" ? draft.titleZh : "";
    const summaryZh =
      typeof draft?.summaryZh === "string" ? draft.summaryZh : "";
    if (!containsHan(titleZh) || !containsHan(summaryZh)) {
      throw new ReviewRealError("REVIEW_CHINESE_REQUIRED", 409);
    }
    return { titleZh, summaryZh, notes: candidate.editorNotes ?? "" };
  }

  private currentProjectionRecords() {
    const rows = this.database
      .prepare(
        `
      SELECT projection.projection_json, projection.projection_hash
      FROM published_projection AS projection
      JOIN review_bundle AS bundle ON bundle.bundle_id = projection.bundle_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM published_projection AS newer_projection
        JOIN review_bundle AS newer_bundle ON newer_bundle.bundle_id = newer_projection.bundle_id
        WHERE newer_bundle.candidate_id = bundle.candidate_id
          AND (
            newer_bundle.source_revision > bundle.source_revision OR
            (newer_bundle.source_revision = bundle.source_revision AND newer_bundle.bundle_revision > bundle.bundle_revision)
          )
      )
      ORDER BY projection.public_id
    `,
      )
      .all() as SqlRow[];
    return rows.map((row) =>
      verifyStoredPublicProjection(
        requiredText(row, "projection_json"),
        requiredText(row, "projection_hash"),
      ),
    );
  }

  list(): ReviewList {
    const rows = this.database
      .prepare(
        "SELECT * FROM pending_review_candidate ORDER BY published_at DESC, candidate_id LIMIT 100",
      )
      .all() as SqlRow[];
    return parseStored(ReviewListSchema, {
      schemaVersion: "admin-review-v0.2",
      items: rows.map((row) => this.view(row, false)),
      nextCursor: null,
    });
  }

  detail(candidateId: string): ReviewDetail {
    return this.view(this.candidate(candidateId), true) as ReviewDetail;
  }

  private storedOperation<T>(
    input: Readonly<{
      operationId: string;
      operationType: OperationType;
      path: string;
      requestHash: string;
      schema: z.ZodType<T>;
    }>,
  ): T | null {
    const row = this.database
      .prepare("SELECT * FROM admin_operation WHERE operation_id = ?")
      .get(input.operationId) as SqlRow | undefined;
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
    if (
      sha256(responseJson) !== requiredText(row, "response_hash") ||
      canonicalJson(parseJson(responseJson)) !== responseJson
    ) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    return parseStored(input.schema, parseJson(responseJson));
  }

  private persistSuccess<T>(
    input: Readonly<{
      operationId: string;
      operationType: OperationType;
      path: string;
      requestHash: string;
      actorRef: string;
      candidateId: string;
      candidateIds?: readonly string[];
      bundleId: string | null;
      publicId: string | null;
      deliveryId: string | null;
      eventType: z.infer<typeof AuditEventPayloadSchema>["eventType"];
      entityType: z.infer<typeof AuditEventPayloadSchema>["entityType"];
      entityId: string;
      createdAt: string;
      schema: z.ZodType<T>;
      buildResponse: (operation: OperationReceipt) => T;
    }>,
  ): T {
    const operationBase = {
      schemaVersion: "admin-review-v0.2" as const,
      operationId: input.operationId,
      operationType: input.operationType,
      status: "completed" as const,
      httpStatus: 200,
      reasonCode: null,
      requestVersionTag: input.requestHash.slice(0, 12),
      candidateId: input.candidateId,
      ...(input.candidateIds === undefined
        ? {}
        : { candidateIds: input.candidateIds }),
      bundleId: input.bundleId,
      publicId: input.publicId,
      deliveryId: input.deliveryId,
      createdAt: input.createdAt,
    };
    const draft = input.buildResponse(
      parseStored(OperationReceiptSchema, {
        ...operationBase,
        responseVersionTag: "000000000000",
      }),
    );
    const operation = parseStored(OperationReceiptSchema, {
      ...operationBase,
      responseVersionTag: sha256(canonicalJson(draft)).slice(0, 12),
    });
    const response = parseStored(input.schema, input.buildResponse(operation));
    const responseJson = canonicalJson(response);
    const responseHash = sha256(responseJson);
    const operationInserted = this.write({
      operationKind: input.operationType === "publish" ? "publish" : "review",
      entityKind: "legacy_admin_operation",
      entityId: input.operationId,
      mutationKind: "insert",
      statement:
        "INSERT INTO admin_operation (operation_id, operation_type, http_method, request_path, request_hash, response_json, response_hash, http_status, operation_status, reason_code, created_at) VALUES (?, ?, 'POST', ?, ?, ?, ?, 200, 'completed', NULL, ?)",
      parameters: [
        input.operationId,
        input.operationType,
        input.path,
        input.requestHash,
        responseJson,
        responseHash,
        input.createdAt,
      ],
      identity: {
        sourceId: null,
        candidateId: input.candidateId,
        publicationId: null,
        publicId: input.publicId,
      },
    });
    if (operationInserted !== 1)
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);

    const previousRow = this.database
      .prepare(
        "SELECT previous_event_hash, event_json, event_hash FROM audit_event ORDER BY audit_seq DESC LIMIT 1",
      )
      .get() as SqlRow | undefined;
    const previousHash =
      previousRow === undefined
        ? null
        : requiredText(previousRow, "event_hash");
    if (previousRow !== undefined) {
      verifyStoredAuditEvent({
        previousEventHash: nullableText(previousRow, "previous_event_hash"),
        eventJson: requiredText(previousRow, "event_json"),
        eventHash: requiredText(previousRow, "event_hash"),
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
      occurredAt: input.createdAt,
    });
    const audit = buildAuditEventMaterial({
      previousEventHash: previousHash,
      eventPayload: payload,
    });
    const eventId = derivedId("audit", input.operationId);
    const auditInserted = this.write({
      operationKind: input.operationType === "publish" ? "publish" : "review",
      entityKind: "legacy_audit",
      entityId: eventId,
      mutationKind: "insert",
      statement:
        "INSERT INTO audit_event (event_id, event_type, operation_id, entity_type, entity_id, actor_ref, event_json, previous_event_hash, event_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      parameters: [
        eventId,
        payload.eventType,
        payload.operationId,
        payload.entityType,
        payload.entityId,
        payload.actorRef,
        audit.eventJson,
        audit.previousEventHash,
        audit.eventHash,
        payload.occurredAt,
      ],
      identity: {
        sourceId: null,
        candidateId: input.candidateId,
        publicationId: null,
        publicId: input.publicId,
      },
    });
    if (auditInserted !== 1)
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    const storedAudit = this.database
      .prepare(
        "SELECT previous_event_hash, event_json, event_hash FROM audit_event WHERE event_id = ?",
      )
      .get(eventId) as SqlRow | undefined;
    if (!storedAudit) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    verifyStoredAuditEvent({
      previousEventHash: nullableText(storedAudit, "previous_event_hash"),
      eventJson: requiredText(storedAudit, "event_json"),
      eventHash: requiredText(storedAudit, "event_hash"),
    });
    return response;
  }

  revision(
    request: RevisionRequest,
    path: string,
    actorRef: string,
  ): RevisionSuccess {
    const requestHash = sha256(canonicalJson(request));
    return this.transaction(
      () => {
        const replay = this.storedOperation({
          operationId: request.operationId,
          operationType: "revision",
          path,
          requestHash,
          schema: RevisionSuccessSchema,
        });
        if (replay !== null) return replay;
        const candidateRow = this.candidate(request.expected.candidateId);
        const candidate = toCandidateSnapshot(candidateRow);
        const latest = this.latestBundle(candidate.candidateId);
        if (
          candidate.sourceRevision !== request.expected.sourceRevision ||
          candidate.sourcePayloadHash.slice(0, 12) !==
            request.expected.sourceVersionTag
        ) {
          throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
        }
        if (
          (latest === null) !== (request.expected.latestBundleId === null) ||
          (latest !== null &&
            (requiredText(latest.row, "bundle_id") !==
              request.expected.latestBundleId ||
              latest.material.bundleHash.slice(0, 12) !==
                request.expected.latestBundleVersionTag))
        ) {
          throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
        }
        const latestDecision =
          latest === null
            ? null
            : this.decision(requiredText(latest.row, "bundle_id"));
        const sourceStale =
          latest !== null &&
          (requiredInteger(latest.row, "source_revision") !==
            candidate.sourceRevision ||
            requiredText(latest.row, "source_payload_hash") !==
              candidate.sourcePayloadHash);
        if (
          latestDecision !== null &&
          requiredText(latestDecision, "decision") !== "rejected" &&
          !sourceStale
        ) {
          throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
        }
        const createdAt = this.now();
        const bundleRevision =
          latest === null
            ? 1
            : requiredInteger(latest.row, "bundle_revision") + 1;
        const bundleId = derivedId("bundle", request.operationId);
        const changed = this.write({
          operationKind: "review",
          entityKind: "candidate",
          entityId: candidate.candidateId,
          mutationKind: "update",
          statement:
            "UPDATE pending_review_candidate SET editor_title=?, editor_excerpt=?, editor_notes=?, editor_based_on_source_revision=?, review_status='pending_review' WHERE candidate_id=? AND source_revision=? AND source_payload_hash=?",
          parameters: [
            request.editable.titleZh,
            request.editable.summaryZh,
            request.editable.notes,
            candidate.sourceRevision,
            candidate.candidateId,
            candidate.sourceRevision,
            candidate.sourcePayloadHash,
          ],
          identity: {
            sourceId: candidate.sourceId,
            candidateId: candidate.candidateId,
            publicationId: null,
            publicId: null,
          },
        });
        if (changed !== 1)
          throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
        const updatedCandidate = toCandidateSnapshot(
          this.candidate(candidate.candidateId),
        );
        const bundle = buildReviewBundleMaterial({
          bundleId,
          bundleRevision,
          createdAt,
          candidate: updatedCandidate,
          editable: request.editable,
          media: this.sourceMedia(
            candidate.candidateId,
            candidate.sourceRevision,
            candidate.sourcePayloadHash,
          ),
        });
        const bundleInserted = this.write({
          operationKind: "review",
          entityKind: "review_bundle",
          entityId: bundleId,
          mutationKind: "insert",
          statement:
            "INSERT INTO review_bundle (bundle_id, candidate_id, bundle_revision, source_revision, source_payload_hash, public_payload_json, public_payload_hash, editor_notes, bundle_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          parameters: [
            bundleId,
            candidate.candidateId,
            bundleRevision,
            candidate.sourceRevision,
            candidate.sourcePayloadHash,
            bundle.publicPayloadJson,
            bundle.publicPayloadHash,
            bundle.editorNotes,
            bundle.bundleHash,
            createdAt,
          ],
          identity: {
            sourceId: candidate.sourceId,
            candidateId: candidate.candidateId,
            publicationId: null,
            publicId: null,
          },
        });
        if (bundleInserted !== 1)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const candidateView = this.view(
          this.candidate(candidate.candidateId),
          false,
        ) as ReviewQueueItem;
        const bundleSummary = {
          id: bundleId,
          revision: bundleRevision,
          versionTag: bundle.bundleHash.slice(0, 12),
        };
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
            bundle: bundleSummary,
          }),
        });
      },
      "admin_http",
      () => {
        const row = this.candidate(request.expected.candidateId);
        const identity = {
          sourceId: requiredText(row, "source_id"),
          candidateId: request.expected.candidateId,
          publicationId: null,
          publicId: null,
        };
        return this.gatewayReviewContext(request.operationId, identity, [
          this.gatewayBinding(
            "candidate",
            request.expected.candidateId,
            "candidate_id",
          ),
          this.gatewayBinding(
            "review_bundle",
            derivedId("bundle", request.operationId),
          ),
          this.gatewayBinding("legacy_admin_operation", request.operationId),
          this.gatewayBinding(
            "legacy_audit",
            derivedId("audit", request.operationId),
          ),
        ]);
      },
    );
  }

  approve(
    request: ApproveRequest,
    path: string,
    actorRef: string,
  ): ApproveSuccess {
    const requestHash = sha256(canonicalJson(request));
    return this.transaction(
      () => {
        const replay = this.storedOperation({
          operationId: request.operationId,
          operationType: "approve",
          path,
          requestHash,
          schema: ApproveSuccessSchema,
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
          latest.material.bundleHash.slice(0, 12) !==
            request.expected.bundleVersionTag ||
          requiredInteger(latest.row, "source_revision") !==
            candidate.sourceRevision ||
          requiredText(latest.row, "source_payload_hash") !==
            candidate.sourcePayloadHash ||
          candidate.editorBasedOnSourceRevision !== candidate.sourceRevision
        ) {
          throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
        }
        if (this.decision(request.expected.bundleId) !== null) {
          throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
        }
        if (
          !containsHan(latest.material.publicPayload.titleZh) ||
          !containsHan(latest.material.publicPayload.summaryZh)
        ) {
          throw new ReviewRealError("REVIEW_CHINESE_REQUIRED", 409);
        }
        const createdAt = this.now();
        const decisionId = derivedId("decision", request.operationId);
        const publicationId = derivedId("publication", request.operationId);
        const publicId = derivePublicId(
          candidate.candidateId,
          latest.material.bundleHash,
        );
        const decisionInserted = this.write({
          operationKind: "review",
          entityKind: "review_decision",
          entityId: decisionId,
          mutationKind: "insert",
          statement:
            "INSERT INTO review_decision (decision_id, bundle_id, decision, approved_bundle_hash, rejection_reason, decided_at) VALUES (?, ?, 'approved', ?, NULL, ?)",
          parameters: [
            decisionId,
            request.expected.bundleId,
            latest.material.bundleHash,
            createdAt,
          ],
          identity: {
            sourceId: candidate.sourceId,
            candidateId: candidate.candidateId,
            publicationId: null,
            publicId: null,
          },
        });
        if (decisionInserted !== 1)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const publicationInserted = this.write({
          operationKind: "review",
          entityKind: "publication",
          entityId: publicationId,
          mutationKind: "insert",
          statement:
            "INSERT INTO publication (publication_id, decision_id, bundle_id, public_id, approved_bundle_hash, publish_generation, publication_status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'queued', NULL, ?, ?)",
          parameters: [
            publicationId,
            decisionId,
            request.expected.bundleId,
            publicId,
            latest.material.bundleHash,
            createdAt,
            createdAt,
          ],
          identity: {
            sourceId: candidate.sourceId,
            candidateId: candidate.candidateId,
            publicationId,
            publicId,
          },
        });
        if (publicationInserted !== 1)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const changed = this.write({
          operationKind: "review",
          entityKind: "candidate",
          entityId: candidate.candidateId,
          mutationKind: "update",
          statement:
            "UPDATE pending_review_candidate SET review_status='approved' WHERE candidate_id=? AND source_revision=? AND source_payload_hash=? AND review_status='pending_review'",
          parameters: [
            candidate.candidateId,
            candidate.sourceRevision,
            candidate.sourcePayloadHash,
          ],
          identity: {
            sourceId: candidate.sourceId,
            candidateId: candidate.candidateId,
            publicationId: null,
            publicId: null,
          },
        });
        if (changed !== 1)
          throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
        const candidateView = this.view(
          this.candidate(candidate.candidateId),
          false,
        ) as ReviewQueueItem;
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
            publication: publicationSummary,
          }),
        });
      },
      "admin_http",
      () => {
        const row = this.candidate(request.expected.candidateId);
        const bundleRow = this.database
          .prepare("SELECT bundle_hash FROM review_bundle WHERE bundle_id=?")
          .get(request.expected.bundleId) as SqlRow | undefined;
        if (bundleRow === undefined)
          throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
        const identity = {
          sourceId: requiredText(row, "source_id"),
          candidateId: request.expected.candidateId,
          publicationId: derivedId("publication", request.operationId),
          publicId: derivePublicId(
            request.expected.candidateId,
            requiredText(bundleRow, "bundle_hash"),
          ),
        };
        return this.gatewayReviewContext(request.operationId, identity, [
          this.gatewayBinding(
            "review_decision",
            derivedId("decision", request.operationId),
          ),
          this.gatewayBinding(
            "publication",
            derivedId("publication", request.operationId),
            "publication_id",
          ),
          this.gatewayBinding(
            "candidate",
            request.expected.candidateId,
            "candidate_id",
          ),
          this.gatewayBinding("legacy_admin_operation", request.operationId),
          this.gatewayBinding(
            "legacy_audit",
            derivedId("audit", request.operationId),
          ),
        ]);
      },
    );
  }

  reject(
    request: RejectRequest,
    path: string,
    actorRef: string,
  ): RejectSuccess {
    const requestHash = sha256(canonicalJson(request));
    return this.transaction(
      () => {
        const replay = this.storedOperation({
          operationId: request.operationId,
          operationType: "reject",
          path,
          requestHash,
          schema: RejectSuccessSchema,
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
          latest.material.bundleHash.slice(0, 12) !==
            request.expected.bundleVersionTag ||
          requiredInteger(latest.row, "source_revision") !==
            candidate.sourceRevision ||
          requiredText(latest.row, "source_payload_hash") !==
            candidate.sourcePayloadHash ||
          candidate.editorBasedOnSourceRevision !== candidate.sourceRevision
        ) {
          throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
        }
        if (this.decision(request.expected.bundleId) !== null) {
          throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
        }
        const createdAt = this.now();
        const decisionId = derivedId("decision", request.operationId);
        const decisionInserted = this.write({
          operationKind: "review",
          entityKind: "review_decision",
          entityId: decisionId,
          mutationKind: "insert",
          statement:
            "INSERT INTO review_decision (decision_id, bundle_id, decision, approved_bundle_hash, rejection_reason, decided_at) VALUES (?, ?, 'rejected', NULL, ?, ?)",
          parameters: [
            decisionId,
            request.expected.bundleId,
            request.reason,
            createdAt,
          ],
          identity: {
            sourceId: candidate.sourceId,
            candidateId: candidate.candidateId,
            publicationId: null,
            publicId: null,
          },
        });
        if (decisionInserted !== 1)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const changed = this.write({
          operationKind: "review",
          entityKind: "candidate",
          entityId: candidate.candidateId,
          mutationKind: "update",
          statement:
            "UPDATE pending_review_candidate SET review_status='rejected' WHERE candidate_id=? AND source_revision=? AND source_payload_hash=? AND review_status='pending_review'",
          parameters: [
            candidate.candidateId,
            candidate.sourceRevision,
            candidate.sourcePayloadHash,
          ],
          identity: {
            sourceId: candidate.sourceId,
            candidateId: candidate.candidateId,
            publicationId: null,
            publicId: null,
          },
        });
        if (changed !== 1)
          throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
        const candidateView = this.view(
          this.candidate(candidate.candidateId),
          false,
        ) as ReviewQueueItem;
        const decisionSummary = candidateView.decision;
        if (decisionSummary === null)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
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
            decision: decisionSummary,
          }),
        });
      },
      "admin_http",
      () => {
        const row = this.candidate(request.expected.candidateId);
        const identity = {
          sourceId: requiredText(row, "source_id"),
          candidateId: request.expected.candidateId,
          publicationId: null,
          publicId: null,
        };
        return this.gatewayReviewContext(request.operationId, identity, [
          this.gatewayBinding(
            "review_decision",
            derivedId("decision", request.operationId),
          ),
          this.gatewayBinding(
            "candidate",
            request.expected.candidateId,
            "candidate_id",
          ),
          this.gatewayBinding("legacy_admin_operation", request.operationId),
          this.gatewayBinding(
            "legacy_audit",
            derivedId("audit", request.operationId),
          ),
        ]);
      },
    );
  }

  automaticReviewBatch(
    limit = 100,
    actorRef = "system-auto-review-v1",
  ): AutomaticReviewBatchReceipt {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    }
    const candidates = this.list()
      .items.filter(
        (item) =>
          item.reviewState === "pending_review" ||
          item.reviewState === "source_updated",
      )
      .slice(0, limit);
    const items: AutomaticReviewItemReceipt[] = [];

    for (const candidate of candidates) {
      try {
        const candidateRow = toCandidateSnapshot(
          this.candidate(candidate.candidateId),
        );
        const priorRejection = this.database
          .prepare(
            `
          SELECT 1 AS present
          FROM review_decision AS decision
          JOIN review_bundle AS bundle ON bundle.bundle_id = decision.bundle_id
          WHERE bundle.candidate_id = ?
            AND bundle.source_revision = ?
            AND bundle.source_payload_hash = ?
            AND decision.decision = 'rejected'
          LIMIT 1
        `,
          )
          .get(
            candidateRow.candidateId,
            candidateRow.sourceRevision,
            candidateRow.sourcePayloadHash,
          );
        if (priorRejection !== undefined) {
          items.push({
            candidateId: candidateRow.candidateId,
            sourceRevision: candidateRow.sourceRevision,
            status: "manual_override",
            reasonCode: "AUTO_REVIEW_MANUAL_OVERRIDE",
          });
          continue;
        }

        let detail = this.detail(candidateRow.candidateId);
        const securityReason = automaticReviewSecurityReason(detail);
        if (securityReason === "AUTO_REVIEW_WAITING_FOR_CHINESE") {
          items.push({
            candidateId: candidateRow.candidateId,
            sourceRevision: candidateRow.sourceRevision,
            status: "waiting",
            reasonCode: securityReason,
          });
          continue;
        }

        if (
          detail.latestBundle === null ||
          detail.reviewState === "source_updated" ||
          !detail.allowedActions.includes(
            securityReason === null ? "approve" : "reject",
          )
        ) {
          const draft = detail.machineDraft;
          if (draft === null)
            throw new ReviewRealError("REVIEW_CHINESE_REQUIRED", 409);
          const operationId = `auto-review-revision-${sha256(`${candidateRow.candidateId}\n${candidateRow.sourceRevision}\n${candidateRow.sourcePayloadHash}`)}`;
          this.revision(
            {
              schemaVersion: "admin-review-v0.2",
              operationId,
              expected: {
                candidateId: candidateRow.candidateId,
                sourceRevision: candidateRow.sourceRevision,
                sourceVersionTag: candidateRow.sourcePayloadHash.slice(0, 12),
                latestBundleId: detail.latestBundle?.id ?? null,
                latestBundleVersionTag: detail.latestBundle?.versionTag ?? null,
              },
              editable: {
                titleZh: draft.titleZh,
                summaryZh: draft.summaryZh,
                notes: detail.editorNotes ?? "",
              },
            },
            `/api/admin/reviews/${encodeURIComponent(candidateRow.candidateId)}/revision`,
            actorRef,
          );
          detail = this.detail(candidateRow.candidateId);
        }

        if (detail.latestBundle === null)
          throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
        const operationSeed = sha256(
          `${candidateRow.candidateId}\n${candidateRow.sourceRevision}\n${candidateRow.sourcePayloadHash}`,
        );
        if (securityReason === null) {
          this.approve(
            {
              schemaVersion: "admin-review-v0.2",
              operationId: `auto-review-approve-${operationSeed}`,
              expected: {
                candidateId: candidateRow.candidateId,
                sourceRevision: candidateRow.sourceRevision,
                bundleId: detail.latestBundle.id,
                bundleVersionTag: detail.latestBundle.versionTag,
              },
            },
            `/api/admin/reviews/${encodeURIComponent(candidateRow.candidateId)}/approve`,
            actorRef,
          );
          items.push({
            candidateId: candidateRow.candidateId,
            sourceRevision: candidateRow.sourceRevision,
            status: "approved",
            reasonCode: "AUTO_REVIEW_SECURITY_PASS",
          });
        } else {
          this.reject(
            {
              schemaVersion: "admin-review-v0.2",
              operationId: `auto-review-reject-${operationSeed}`,
              expected: {
                candidateId: candidateRow.candidateId,
                sourceRevision: candidateRow.sourceRevision,
                bundleId: detail.latestBundle.id,
                bundleVersionTag: detail.latestBundle.versionTag,
              },
              reason: `[${securityReason}] 自动初审发现不可见控制字符或双向文本控制符，需人工核对后决定是否恢复。`,
            },
            `/api/admin/reviews/${encodeURIComponent(candidateRow.candidateId)}/reject`,
            actorRef,
          );
          items.push({
            candidateId: candidateRow.candidateId,
            sourceRevision: candidateRow.sourceRevision,
            status: "rejected",
            reasonCode: securityReason,
          });
        }
      } catch (error) {
        const reviewError = asReviewRealError(error);
        items.push({
          candidateId: candidate.candidateId,
          sourceRevision: candidate.sourceRevision,
          status: "failed",
          reasonCode: reviewError.reasonCode,
        });
      }
    }

    return {
      schemaVersion: "automatic-review-receipt-v1",
      considered: items.length,
      approved: items.filter((item) => item.status === "approved").length,
      rejected: items.filter((item) => item.status === "rejected").length,
      waiting: items.filter((item) => item.status === "waiting").length,
      manualOverride: items.filter((item) => item.status === "manual_override")
        .length,
      failed: items.filter((item) => item.status === "failed").length,
      items,
    };
  }

  automaticPublishBatch(
    limit = 20,
    actorRef = "system-auto-publish-v1",
  ): AutomaticPublishBatchReceipt {
    if (actorRef !== "system-auto-publish-v1") {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    }

    const empty = (
      items: readonly AutomaticPublishItemReceipt[],
    ): AutomaticPublishBatchReceipt => ({
      schemaVersion: "automatic-publish-receipt-v1",
      considered: items.length,
      published: items.filter((item) => item.status === "published").length,
      blocked: items.filter((item) => item.status === "blocked").length,
      failed: items.filter((item) => item.status === "failed").length,
      deliveryId: null,
      items,
    });

    const previousOutbox = this.database
      .prepare(
        "SELECT * FROM projection_outbox ORDER BY snapshot_generation DESC LIMIT 1",
      )
      .get() as SqlRow | undefined;
    if (
      previousOutboxBlocksNewGeneration(
        previousOutbox === undefined
          ? undefined
          : requiredText(previousOutbox, "status"),
      )
    ) {
      return {
        schemaVersion: "automatic-publish-receipt-v1",
        considered: 0,
        published: 0,
        blocked: 1,
        failed: 0,
        deliveryId: null,
        items: [
          {
            candidateId: "auto-publish-fence",
            sourceRevision: 1,
            publicId: null,
            status: "blocked",
            reasonCode: "PUBLICATION_RECONCILE_WAIT",
          },
        ],
      };
    }

    const rows = this.database
      .prepare(
        `
      SELECT * FROM pending_review_candidate
      WHERE review_status = 'approved'
      ORDER BY published_at ASC, candidate_id ASC
      LIMIT ?
    `,
      )
      .all(limit) as SqlRow[];

    const releaseItems: ReleaseNowRequest["expected"]["items"] = [];
    const skipped: AutomaticPublishItemReceipt[] = [];
    for (const row of rows) {
      const item = this.view(row, true) as ReviewDetail;
      if (
        item.reviewState !== "approved_waiting_publish" ||
        !item.allowedActions.includes("publish") ||
        item.latestBundle === null
      ) {
        skipped.push({
          candidateId: item.candidateId,
          sourceRevision: item.sourceRevision,
          publicId: item.publication?.publicId ?? null,
          status: "blocked",
          reasonCode: item.integrity.reasonCode ?? "AUTO_PUBLISH_NOT_READY",
        });
        continue;
      }
      releaseItems.push({
        candidateId: item.candidateId,
        sourceRevision: item.sourceRevision,
        sourceVersionTag: item.integrity.versionTag,
        latestBundleId: item.latestBundle.id,
        latestBundleVersionTag: item.latestBundle.versionTag,
      });
    }

    if (releaseItems.length === 0) {
      return empty(skipped);
    }

    const generation =
      previousOutbox === undefined
        ? 0
        : requiredInteger(previousOutbox, "snapshot_generation");
    const seed = releaseItems
      .map(
        (item) =>
          `${item.candidateId}\n${item.sourceRevision}\n${item.sourceVersionTag}\n${item.latestBundleVersionTag ?? ""}`,
      )
      .join("\n");
    const operationId = `auto-publish-batch-${sha256(`${generation}\n${seed}`)}`;

    try {
      const published = this.releaseNow(
        {
          schemaVersion: "admin-review-v0.2",
          operationId,
          expected: { items: releaseItems },
          editable: null,
        },
        "/api/admin/reviews/release",
        actorRef,
      );
      const publishedItems = releaseItems.map((item) => {
        const after = this.detail(item.candidateId);
        return {
          candidateId: item.candidateId,
          sourceRevision: item.sourceRevision,
          publicId: after.publication?.publicId ?? null,
          status: "published" as const,
          reasonCode: "AUTO_PUBLISH_CAS_PASS",
        };
      });
      return {
        schemaVersion: "automatic-publish-receipt-v1",
        considered: skipped.length + publishedItems.length,
        published: publishedItems.length,
        blocked: skipped.length,
        failed: 0,
        deliveryId: published.delivery.id,
        items: [...skipped, ...publishedItems],
      };
    } catch (error) {
      const reviewError = asReviewRealError(error);
      return empty([
        ...skipped,
        ...releaseItems.map((item) => ({
          candidateId: item.candidateId,
          sourceRevision: item.sourceRevision,
          publicId: null,
          status: "failed" as const,
          reasonCode: reviewError.reasonCode,
        })),
      ]);
    }
  }

  publish(
    request: PublishRequest,
    path: string,
    actorRef: string,
  ): PublishSuccess {
    const requestHash = sha256(canonicalJson(request));
    const operationCreatedAt = this.now();
    return this.transaction(
      () => {
        const replay = this.storedOperation({
          operationId: request.operationId,
          operationType: "publish",
          path,
          requestHash,
          schema: PublishSuccessSchema,
        });
        if (replay !== null) return replay;
        const publication = this.database
          .prepare("SELECT * FROM publication WHERE public_id = ?")
          .get(request.expected.publicId) as SqlRow | undefined;
        if (!publication)
          throw new ReviewRealError("PUBLICATION_NOT_FOUND", 404);
        if (
          requiredText(publication, "publication_status") !==
            request.expected.publicationStatus ||
          requiredInteger(publication, "publish_generation") !==
            request.expected.publishGeneration ||
          requiredText(publication, "approved_bundle_hash").slice(0, 12) !==
            request.expected.approvedBundleVersionTag
        ) {
          throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
        }
        const bundleId = requiredText(publication, "bundle_id");
        const bundleRow = this.database
          .prepare("SELECT * FROM review_bundle WHERE bundle_id = ?")
          .get(bundleId) as SqlRow | undefined;
        if (!bundleRow)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const bundle = verifyStoredReviewBundle({
          bundleId,
          bundleRevision: requiredInteger(bundleRow, "bundle_revision"),
          createdAt: requiredText(bundleRow, "created_at"),
          publicPayloadJson: requiredText(bundleRow, "public_payload_json"),
          publicPayloadHash: requiredText(bundleRow, "public_payload_hash"),
          editorNotes: requiredText(bundleRow, "editor_notes"),
          bundleHash: requiredText(bundleRow, "bundle_hash"),
        });
        if (
          !containsHan(bundle.publicPayload.titleZh) ||
          !containsHan(bundle.publicPayload.summaryZh)
        ) {
          throw new ReviewRealError("REVIEW_CHINESE_REQUIRED", 409);
        }
        const candidate = toCandidateSnapshot(
          this.candidate(requiredText(bundleRow, "candidate_id")),
        );
        const latest = this.latestBundle(candidate.candidateId);
        if (
          latest === null ||
          requiredText(latest.row, "bundle_id") !== bundleId ||
          latest.material.bundleHash !== bundle.bundleHash ||
          candidate.sourceRevision !==
            requiredInteger(bundleRow, "source_revision") ||
          candidate.sourcePayloadHash !==
            requiredText(bundleRow, "source_payload_hash") ||
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
        if (
          this.database
            .prepare(
              "SELECT 1 AS present FROM published_projection WHERE publication_id = ?",
            )
            .get(requiredText(publication, "publication_id"))
        ) {
          throw new ReviewRealError("REVIEW_DECISION_CONFLICT", 409);
        }
        const previousOutbox = this.database
          .prepare(
            "SELECT * FROM projection_outbox ORDER BY snapshot_generation DESC LIMIT 1",
          )
          .get() as SqlRow | undefined;
        if (
          previousOutboxBlocksNewGeneration(
            previousOutbox === undefined
              ? undefined
              : requiredText(previousOutbox, "status"),
          )
        ) {
          throw new ReviewRealError("PUBLICATION_RECONCILE_WAIT", 409);
        }
        const createdAt = operationCreatedAt;
        const publicationId = requiredText(publication, "publication_id");
        const changedPublication = this.write({
          operationKind: "publish",
          entityKind: "publication",
          entityId: publicationId,
          mutationKind: "update",
          statement:
            "UPDATE publication SET publication_status='published', published_at=?, updated_at=? WHERE publication_id=? AND publication_status='queued' AND published_at IS NULL",
          parameters: [createdAt, createdAt, publicationId],
          identity: {
            sourceId: candidate.sourceId,
            candidateId: candidate.candidateId,
            publicationId,
            publicId: request.expected.publicId,
          },
        });
        if (changedPublication !== 1)
          throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
        const machineDraft = this.machineDraft(
          candidate.candidateId,
          candidate.sourceRevision,
          candidate.sourcePayloadHash,
        );
        const projection = buildPublicProjectionRecord({
          publicId: request.expected.publicId,
          bundleHash: bundle.bundleHash,
          publishedAt: createdAt,
          publicPayload: bundle.publicPayload,
          keyPointsZh: normalizeProjectionKeyPoints(machineDraft?.keyPointsZh),
        });
        const projectionId = derivedId("projection", request.operationId);
        const projectionInserted = this.write({
          operationKind: "publish",
          entityKind: "published_projection",
          entityId: projectionId,
          mutationKind: "insert",
          statement:
            "INSERT INTO published_projection (projection_id, publication_id, bundle_id, public_id, publish_generation, projection_json, projection_hash, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)",
          parameters: [
            projectionId,
            publicationId,
            bundleId,
            request.expected.publicId,
            canonicalJson(projection),
            projection.projectionHash,
            createdAt,
          ],
          identity: {
            sourceId: candidate.sourceId,
            candidateId: candidate.candidateId,
            publicationId,
            publicId: request.expected.publicId,
          },
        });
        if (projectionInserted !== 1)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const projections = this.currentProjectionRecords();
        const lastSuccessfulOutbox = this.database
          .prepare(
            "SELECT * FROM projection_outbox WHERE status = 'succeeded' ORDER BY snapshot_generation DESC LIMIT 1",
          )
          .get() as SqlRow | undefined;
        const snapshotGeneration =
          lastSuccessfulOutbox === undefined
            ? 1
            : requiredInteger(lastSuccessfulOutbox, "snapshot_generation") + 1;
        const previousSnapshotManifestHash =
          lastSuccessfulOutbox === undefined
            ? null
            : requiredText(lastSuccessfulOutbox, "snapshot_manifest_hash");
        const snapshot = buildProjectionSnapshot({
          snapshotGeneration,
          previousSnapshotManifestHash,
          records: projections,
        });
        const deliveryId = `op-snapshot-${snapshot.snapshotManifestHash}`;
        const source = this.database
          .prepare("SELECT stop_epoch FROM source WHERE source_id = ?")
          .get(candidate.sourceId) as SqlRow | undefined;
        if (!source) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const idempotencyKey = `snapshot-sync:${requiredInteger(source, "stop_epoch")}:${snapshot.snapshotManifestHash}`;
        const reconcileKey = `reconcile:snapshot:${snapshot.snapshotManifestHash}`;
        const deadlineAt = new Date(
          Date.parse(createdAt) + 15 * 60 * 1000,
        ).toISOString();
        const task = buildProjectionTaskEnvelope({
          deliveryId,
          idempotencyKey,
          reconcileKey,
          snapshot,
          attempt: 0,
          createdAt,
          deadlineAt,
        });
        const outboxInserted = this.write({
          operationKind: "publish",
          entityKind: "projection_outbox",
          entityId: deliveryId,
          mutationKind: "insert",
          statement:
            "INSERT INTO projection_outbox (delivery_id, publication_id, operation_type, snapshot_generation, snapshot_manifest_hash, idempotency_key, reconcile_key, task_envelope_json, task_envelope_hash, status, attempt_count, max_attempts, lease_token, lease_expires_at, last_reason_code, created_at, updated_at) VALUES (?, ?, 'snapshot_sync', ?, ?, ?, ?, ?, ?, 'pending', 0, 3, NULL, NULL, NULL, ?, ?)",
          parameters: [
            deliveryId,
            publicationId,
            snapshot.snapshotGeneration,
            snapshot.snapshotManifestHash,
            idempotencyKey,
            reconcileKey,
            task.envelopeJson,
            task.envelopeHash,
            createdAt,
            createdAt,
          ],
          identity: {
            sourceId: candidate.sourceId,
            candidateId: candidate.candidateId,
            publicationId,
            publicId: request.expected.publicId,
          },
        });
        if (outboxInserted !== 1)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const changedCandidate = this.write({
          operationKind: "publish",
          entityKind: "candidate",
          entityId: candidate.candidateId,
          mutationKind: "update",
          statement:
            "UPDATE pending_review_candidate SET review_status='published' WHERE candidate_id=? AND source_revision=? AND source_payload_hash=? AND review_status='approved'",
          parameters: [
            candidate.candidateId,
            candidate.sourceRevision,
            candidate.sourcePayloadHash,
          ],
          identity: {
            sourceId: candidate.sourceId,
            candidateId: candidate.candidateId,
            publicationId,
            publicId: request.expected.publicId,
          },
        });
        if (changedCandidate !== 1)
          throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
        const candidateView = this.view(
          this.candidate(candidate.candidateId),
          false,
        ) as ReviewQueueItem;
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
            publicPath: null,
          }),
        });
      },
      "admin_http",
      () => {
        const publication = this.database
          .prepare(
            "SELECT publication_id,public_id,bundle_id FROM publication WHERE public_id=?",
          )
          .get(request.expected.publicId) as SqlRow | undefined;
        if (!publication)
          throw new ReviewRealError("PUBLICATION_NOT_FOUND", 404);
        const bundleRef = this.database
          .prepare("SELECT candidate_id FROM review_bundle WHERE bundle_id=?")
          .get(requiredText(publication, "bundle_id")) as SqlRow | undefined;
        if (!bundleRef)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const candidate = this.candidate(
          requiredText(bundleRef, "candidate_id"),
        );
        const projectionId = derivedId("projection", request.operationId);
        const bundleRow = this.database
          .prepare("SELECT * FROM review_bundle WHERE bundle_id=?")
          .get(requiredText(publication, "bundle_id")) as SqlRow | undefined;
        if (!bundleRow)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const bundle = verifyStoredReviewBundle({
          bundleId: requiredText(bundleRow, "bundle_id"),
          bundleRevision: requiredInteger(bundleRow, "bundle_revision"),
          createdAt: requiredText(bundleRow, "created_at"),
          publicPayloadJson: requiredText(bundleRow, "public_payload_json"),
          publicPayloadHash: requiredText(bundleRow, "public_payload_hash"),
          editorNotes: requiredText(bundleRow, "editor_notes"),
          bundleHash: requiredText(bundleRow, "bundle_hash"),
        });
        const machineDraft = this.machineDraft(
          requiredText(candidate, "candidate_id"),
          requiredInteger(candidate, "source_revision"),
          requiredText(candidate, "source_payload_hash"),
        );
        const projected = buildPublicProjectionRecord({
          publicId: request.expected.publicId,
          bundleHash: bundle.bundleHash,
          publishedAt: operationCreatedAt,
          publicPayload: bundle.publicPayload,
          keyPointsZh: normalizeProjectionKeyPoints(machineDraft?.keyPointsZh),
        });
        const previousSuccessful = this.database
          .prepare(
            "SELECT * FROM projection_outbox WHERE status='succeeded' ORDER BY snapshot_generation DESC LIMIT 1",
          )
          .get() as SqlRow | undefined;
        const generation =
          previousSuccessful === undefined
            ? 1
            : requiredInteger(previousSuccessful, "snapshot_generation") + 1;
        const previousManifest =
          previousSuccessful === undefined
            ? null
            : requiredText(previousSuccessful, "snapshot_manifest_hash");
        const snapshot = buildProjectionSnapshot({
          snapshotGeneration: generation,
          previousSnapshotManifestHash: previousManifest,
          records: [...this.currentProjectionRecords(), projected],
        });
        const deliveryId = `op-snapshot-${snapshot.snapshotManifestHash}`;
        const identity = {
          sourceId: requiredText(candidate, "source_id"),
          candidateId: requiredText(candidate, "candidate_id"),
          publicationId: requiredText(publication, "publication_id"),
          // Migration 0007's frozen policy binds published_projection through
          // public_id while its legacy table key is projection_id.  The
          // projection binding therefore uses the deterministic projection id
          // as the operation's public-id selector; the row still stores the
          // caller's real public id in its SQL values.
          publicId: projectionId,
        };
        return this.gatewayPublishContext(request.operationId, identity, [
          this.gatewayBinding(
            "publication",
            requiredText(publication, "publication_id"),
            "publication_id",
          ),
          this.gatewayBinding(
            "published_projection",
            projectionId,
            "public_id",
          ),
          this.gatewayBinding("projection_outbox", deliveryId),
          this.gatewayBinding(
            "candidate",
            requiredText(candidate, "candidate_id"),
            "candidate_id",
          ),
          this.gatewayBinding("legacy_admin_operation", request.operationId),
          this.gatewayBinding(
            "legacy_audit",
            derivedId("audit", request.operationId),
          ),
        ]);
      },
    );
  }

  releaseNow(
    request: ReleaseNowRequest,
    path: string,
    actorRef: string,
  ): PublishSuccess {
    const requestHash = sha256(canonicalJson(request));
    const operationCreatedAt = this.now();
    return this.transaction(
      () => {
        const replay = this.storedOperation({
          operationId: request.operationId,
          operationType: "publish",
          path,
          requestHash,
          schema: PublishSuccessSchema,
        });
        if (replay !== null) return replay;
        const previousOutbox = this.database
          .prepare(
            "SELECT * FROM projection_outbox ORDER BY snapshot_generation DESC LIMIT 1",
          )
          .get() as SqlRow | undefined;
        if (
          previousOutboxBlocksNewGeneration(
            previousOutbox === undefined
              ? undefined
              : requiredText(previousOutbox, "status"),
          )
        ) {
          throw new ReviewRealError("PUBLICATION_RECONCILE_WAIT", 409);
        }
        const createdAt = operationCreatedAt;
        const prepared = request.expected.items
          .slice()
          .sort((left, right) =>
            left.candidateId.localeCompare(right.candidateId),
          )
          .map((item) => this.prepareReleaseItem(item, request, createdAt));
        let firstPublicationId: string | null = null;
        for (const item of prepared) {
          const changedPublication = this.write({
            operationKind: "publish",
            entityKind: "publication",
            entityId: item.publicationId,
            mutationKind: "update",
            statement:
              "UPDATE publication SET publication_status='published', published_at=?, updated_at=? WHERE publication_id=? AND publication_status='queued' AND published_at IS NULL",
            parameters: [createdAt, createdAt, item.publicationId],
            identity: {
              sourceId: item.candidate.sourceId,
              candidateId: item.candidate.candidateId,
              publicationId: item.publicationId,
              publicId: item.publicId,
            },
          });
          if (changedPublication !== 1)
            throw new ReviewRealError("REVIEW_BUNDLE_STALE", 409);
          const machineDraft = this.machineDraft(
            item.candidate.candidateId,
            item.candidate.sourceRevision,
            item.candidate.sourcePayloadHash,
          );
          const projection = buildPublicProjectionRecord({
            publicId: item.publicId,
            bundleHash: item.bundle.bundleHash,
            publishedAt: createdAt,
            publicPayload: item.bundle.publicPayload,
            keyPointsZh: normalizeProjectionKeyPoints(
              machineDraft?.keyPointsZh,
            ),
          });
          const projectionId = derivedId(
            "projection",
            `${request.operationId}:${item.candidate.candidateId}`,
          );
          const projectionInserted = this.write({
            operationKind: "publish",
            entityKind: "published_projection",
            entityId: projectionId,
            mutationKind: "insert",
            statement:
              "INSERT INTO published_projection (projection_id, publication_id, bundle_id, public_id, publish_generation, projection_json, projection_hash, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)",
            parameters: [
              projectionId,
              item.publicationId,
              item.bundleId,
              item.publicId,
              canonicalJson(projection),
              projection.projectionHash,
              createdAt,
            ],
            identity: {
              sourceId: item.candidate.sourceId,
              candidateId: item.candidate.candidateId,
              publicationId: item.publicationId,
              publicId: item.publicId,
            },
          });
          if (projectionInserted !== 1)
            throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
          const changedCandidate = this.write({
            operationKind: "publish",
            entityKind: "candidate",
            entityId: item.candidate.candidateId,
            mutationKind: "update",
            statement:
              "UPDATE pending_review_candidate SET review_status='published' WHERE candidate_id=? AND source_revision=? AND source_payload_hash=? AND review_status='approved'",
            parameters: [
              item.candidate.candidateId,
              item.candidate.sourceRevision,
              item.candidate.sourcePayloadHash,
            ],
            identity: {
              sourceId: item.candidate.sourceId,
              candidateId: item.candidate.candidateId,
              publicationId: item.publicationId,
              publicId: item.publicId,
            },
          });
          if (changedCandidate !== 1)
            throw new ReviewRealError("REVIEW_SOURCE_STALE", 409);
          firstPublicationId ??= item.publicationId;
        }
        const projections = this.currentProjectionRecords();
        const lastSuccessfulOutbox = this.database
          .prepare(
            "SELECT * FROM projection_outbox WHERE status = 'succeeded' ORDER BY snapshot_generation DESC LIMIT 1",
          )
          .get() as SqlRow | undefined;
        const snapshotGeneration =
          lastSuccessfulOutbox === undefined
            ? 1
            : requiredInteger(lastSuccessfulOutbox, "snapshot_generation") + 1;
        const previousSnapshotManifestHash =
          lastSuccessfulOutbox === undefined
            ? null
            : requiredText(lastSuccessfulOutbox, "snapshot_manifest_hash");
        const snapshot = buildProjectionSnapshot({
          snapshotGeneration,
          previousSnapshotManifestHash,
          records: projections,
        });
        const deliveryId = `op-snapshot-${snapshot.snapshotManifestHash}`;
        const source = this.database
          .prepare("SELECT stop_epoch FROM source WHERE source_id = ?")
          .get(prepared[0].candidate.sourceId) as SqlRow | undefined;
        if (!source || firstPublicationId === null)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const idempotencyKey = `snapshot-sync:${requiredInteger(source, "stop_epoch")}:${snapshot.snapshotManifestHash}`;
        const reconcileKey = `reconcile:snapshot:${snapshot.snapshotManifestHash}`;
        const deadlineAt = new Date(
          Date.parse(createdAt) + 15 * 60 * 1000,
        ).toISOString();
        const task = buildProjectionTaskEnvelope({
          deliveryId,
          idempotencyKey,
          reconcileKey,
          snapshot,
          attempt: 0,
          createdAt,
          deadlineAt,
        });
        const outboxInserted = this.write({
          operationKind: "publish",
          entityKind: "projection_outbox",
          entityId: deliveryId,
          mutationKind: "insert",
          statement:
            "INSERT INTO projection_outbox (delivery_id, publication_id, operation_type, snapshot_generation, snapshot_manifest_hash, idempotency_key, reconcile_key, task_envelope_json, task_envelope_hash, status, attempt_count, max_attempts, lease_token, lease_expires_at, last_reason_code, created_at, updated_at) VALUES (?, ?, 'snapshot_sync', ?, ?, ?, ?, ?, ?, 'pending', 0, 3, NULL, NULL, NULL, ?, ?)",
          parameters: [
            deliveryId,
            firstPublicationId,
            snapshot.snapshotGeneration,
            snapshot.snapshotManifestHash,
            idempotencyKey,
            reconcileKey,
            task.envelopeJson,
            task.envelopeHash,
            createdAt,
            createdAt,
          ],
          identity: {
            sourceId: prepared[0].candidate.sourceId,
            candidateId: prepared[0].candidate.candidateId,
            publicationId: firstPublicationId,
            publicId: prepared[0].publicId,
          },
        });
        if (outboxInserted !== 1)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const first = prepared[0];
        const candidateView = this.view(
          this.candidate(first.candidate.candidateId),
          false,
        ) as ReviewQueueItem;
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
          candidateId: first.candidate.candidateId,
          candidateIds: prepared.map((item) => item.candidate.candidateId),
          bundleId: first.bundleId,
          publicId: first.publicId,
          deliveryId,
          eventType: "publication_published",
          entityType: "publication",
          entityId: first.publicationId,
          createdAt,
          schema: PublishSuccessSchema,
          buildResponse: (operation) => ({
            schemaVersion: "admin-review-v0.2",
            operation,
            candidate: candidateView,
            publication: publicationSummary,
            delivery: deliverySummary,
            status: "delivery_pending",
            publicPath: null,
          }),
        });
      },
      "admin_http",
      () => {
        if (request.expected.items.length !== 1) {
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        }
        const prepared = request.expected.items
          .slice()
          .sort((left, right) =>
            left.candidateId.localeCompare(right.candidateId),
          )
          .map((item) =>
            this.prepareReleaseItem(item, request, operationCreatedAt),
          );
        const first = prepared[0];
        const projectionId = derivedId(
          "projection",
          `${request.operationId}:${first.candidate.candidateId}`,
        );
        const projection = buildPublicProjectionRecord({
          publicId: first.publicId,
          bundleHash: first.bundle.bundleHash,
          publishedAt: operationCreatedAt,
          publicPayload: first.bundle.publicPayload,
          keyPointsZh: normalizeProjectionKeyPoints(
            this.machineDraft(
              first.candidate.candidateId,
              first.candidate.sourceRevision,
              first.candidate.sourcePayloadHash,
            )?.keyPointsZh,
          ),
        });
        const previousSuccessful = this.database
          .prepare(
            "SELECT * FROM projection_outbox WHERE status='succeeded' ORDER BY snapshot_generation DESC LIMIT 1",
          )
          .get() as SqlRow | undefined;
        const generation =
          previousSuccessful === undefined
            ? 1
            : requiredInteger(previousSuccessful, "snapshot_generation") + 1;
        const previousManifest =
          previousSuccessful === undefined
            ? null
            : requiredText(previousSuccessful, "snapshot_manifest_hash");
        const snapshot = buildProjectionSnapshot({
          snapshotGeneration: generation,
          previousSnapshotManifestHash: previousManifest,
          records: [...this.currentProjectionRecords(), projection],
        });
        const deliveryId = `op-snapshot-${snapshot.snapshotManifestHash}`;
        const identity = {
          sourceId: first.candidate.sourceId,
          candidateId: first.candidate.candidateId,
          publicationId: first.publicationId,
          publicId: projectionId,
        };
        return this.gatewayPublishContext(request.operationId, identity, [
          this.gatewayBinding(
            "publication",
            first.publicationId,
            "publication_id",
          ),
          this.gatewayBinding(
            "published_projection",
            projectionId,
            "public_id",
          ),
          this.gatewayBinding("projection_outbox", deliveryId),
          this.gatewayBinding(
            "candidate",
            first.candidate.candidateId,
            "candidate_id",
          ),
          this.gatewayBinding("legacy_admin_operation", request.operationId),
          this.gatewayBinding(
            "legacy_audit",
            derivedId("audit", request.operationId),
          ),
        ]);
      },
    );
  }

  operation(operationId: string): OperationReceipt {
    const row = this.database
      .prepare("SELECT * FROM admin_operation WHERE operation_id = ?")
      .get(operationId) as SqlRow | undefined;
    if (!row) throw new ReviewRealError("ADMIN_OPERATION_NOT_FOUND", 404);
    const operationType = requiredText(row, "operation_type") as OperationType;
    if (!["revision", "approve", "reject", "publish"].includes(operationType)) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    const responseJson = requiredText(row, "response_json");
    if (
      sha256(responseJson) !== requiredText(row, "response_hash") ||
      canonicalJson(parseJson(responseJson)) !== responseJson
    ) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    const response = parseStored(
      responseSchema(operationType),
      parseJson(responseJson),
    ) as { operation?: unknown };
    return parseStored(OperationReceiptSchema, response.operation);
  }

  private deliveryWork(row: SqlRow): ProjectionDeliveryWork {
    const envelopeJson = requiredText(row, "task_envelope_json");
    const envelopeHash = requiredText(row, "task_envelope_hash");
    return Object.freeze({
      deliveryId: requiredText(row, "delivery_id"),
      leaseToken: nullableText(row, "lease_token"),
      attemptCount: requiredInteger(row, "attempt_count"),
      maxAttempts: requiredInteger(row, "max_attempts"),
      envelope: verifyStoredProjectionTaskEnvelope(envelopeJson, envelopeHash),
      envelopeJson,
      envelopeHash,
    });
  }

  private appendDeliveryAudit(
    row: SqlRow,
    eventType: z.infer<typeof AuditEventPayloadSchema>["eventType"],
    outcome: "succeeded" | "failed",
    reasonCode: string | null,
    actorRef: string,
    occurredAt: string,
  ): void {
    const deliveryId = requiredText(row, "delivery_id");
    const operation = this.database
      .prepare(
        "SELECT operation_id FROM admin_operation WHERE operation_type='publish' AND json_extract(response_json, '$.operation.deliveryId') = ?",
      )
      .get(deliveryId) as SqlRow | undefined;
    if (!operation) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    const operationId = requiredText(operation, "operation_id");
    const previous = this.database
      .prepare(
        "SELECT previous_event_hash, event_json, event_hash FROM audit_event ORDER BY audit_seq DESC LIMIT 1",
      )
      .get() as SqlRow | undefined;
    const previousHash =
      previous === undefined ? null : requiredText(previous, "event_hash");
    if (previous !== undefined) {
      verifyStoredAuditEvent({
        previousEventHash: nullableText(previous, "previous_event_hash"),
        eventJson: requiredText(previous, "event_json"),
        eventHash: requiredText(previous, "event_hash"),
      });
    }
    const payload = parseStored(AuditEventPayloadSchema, {
      schemaVersion: "admin-audit-v1",
      eventType,
      outcome,
      reasonCode,
      operationId,
      entityType: "delivery",
      entityId: deliveryId,
      actorRef,
      occurredAt,
    });
    const material = buildAuditEventMaterial({
      previousEventHash: previousHash,
      eventPayload: payload,
    });
    const eventId = `audit-delivery-${sha256(`${deliveryId}\n${eventType}\n${requiredInteger(row, "attempt_count")}\n${occurredAt}`)}`;
    const inserted = this.write({
      operationKind: "projection",
      entityKind: "legacy_audit",
      entityId: eventId,
      mutationKind: "insert",
      statement:
        "INSERT INTO audit_event (event_id, event_type, operation_id, entity_type, entity_id, actor_ref, event_json, previous_event_hash, event_hash, created_at) VALUES (?, ?, ?, 'delivery', ?, ?, ?, ?, ?, ?)",
      parameters: [
        eventId,
        eventType,
        operationId,
        deliveryId,
        actorRef,
        material.eventJson,
        material.previousEventHash,
        material.eventHash,
        occurredAt,
      ],
      identity: {
        sourceId: null,
        candidateId: null,
        publicationId: requiredText(row, "publication_id"),
        publicId: null,
      },
    });
    if (inserted !== 1)
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }

  recoverExpiredLease(actorRef: string): ProjectionDeliveryWork | null {
    const operationCreatedAt = this.now();
    const expiredLease = this.database
      .prepare(
        "SELECT 1 FROM projection_outbox WHERE status='leased' AND lease_expires_at <= ? LIMIT 1",
      )
      .get(operationCreatedAt);
    if (expiredLease === undefined) return null;
    const operationId = `projection-recover-${sha256(`${actorRef}\n${operationCreatedAt}`).slice(0, 48)}`;
    return this.transaction(
      () => {
        const now = operationCreatedAt;
        const row = this.database
          .prepare(
            "SELECT * FROM projection_outbox WHERE status='leased' AND lease_expires_at <= ? ORDER BY lease_expires_at, delivery_id LIMIT 1",
          )
          .get(now) as SqlRow | undefined;
        if (!row) return null;
        const changed = this.write({
          operationKind: "projection",
          entityKind: "projection_outbox",
          entityId: requiredText(row, "delivery_id"),
          mutationKind: "update",
          statement:
            "UPDATE projection_outbox SET status='reconcile_wait', lease_token=NULL, lease_expires_at=NULL, last_reason_code='DELIVERY_LEASE_EXPIRED', updated_at=? WHERE delivery_id=? AND status='leased' AND lease_token=?",
          parameters: [
            now,
            requiredText(row, "delivery_id"),
            requiredText(row, "lease_token"),
          ],
          identity: this.projectionIdentity(row),
        });
        if (changed !== 1)
          throw new ReviewRealError("DELIVERY_RECONCILE_WAIT", 409);
        const updated = this.database
          .prepare("SELECT * FROM projection_outbox WHERE delivery_id=?")
          .get(requiredText(row, "delivery_id")) as SqlRow;
        this.appendDeliveryAudit(
          updated,
          "projection_delivery_reconcile_wait",
          "failed",
          "DELIVERY_LEASE_EXPIRED",
          actorRef,
          now,
        );
        return this.deliveryWork(updated);
      },
      "projection_receiver",
      () => {
        const row = this.database
          .prepare(
            "SELECT * FROM projection_outbox WHERE status='leased' AND lease_expires_at <= ? ORDER BY lease_expires_at, delivery_id LIMIT 1",
          )
          .get(operationCreatedAt) as SqlRow | undefined;
        if (!row) throw new ReviewRealError("DELIVERY_RECONCILE_WAIT", 409);
        const deliveryId = requiredText(row, "delivery_id");
        const auditId = `audit-delivery-${sha256(`${deliveryId}\nprojection_delivery_reconcile_wait\n${requiredInteger(row, "attempt_count")}\n${operationCreatedAt}`)}`;
        return this.gatewayProjectionContext(
          operationId,
          this.projectionIdentity(row),
          [
            this.gatewayBinding("projection_outbox", deliveryId),
            this.gatewayBinding("legacy_audit", auditId),
          ],
        );
      },
    );
  }

  nextReconcile(): ProjectionDeliveryWork | null {
    const row = this.database
      .prepare(
        "SELECT * FROM projection_outbox WHERE status='reconcile_wait' ORDER BY updated_at, delivery_id LIMIT 1",
      )
      .get() as SqlRow | undefined;
    return row ? this.deliveryWork(row) : null;
  }

  leaseNext(actorRef: string): ProjectionDeliveryWork | null {
    const operationCreatedAt = this.now();
    const operationId = `projection-lease-${sha256(`${actorRef}\n${operationCreatedAt}`).slice(0, 48)}`;
    return this.transaction(
      () => {
        const now = operationCreatedAt;
        const row = this.database
          .prepare(
            "SELECT * FROM projection_outbox WHERE status IN ('pending','retryable_failed') AND attempt_count < max_attempts AND NOT EXISTS (SELECT 1 FROM projection_outbox WHERE status IN ('leased','reconcile_wait')) ORDER BY created_at, delivery_id LIMIT 1",
          )
          .get() as SqlRow | undefined;
        if (!row) return null;
        const token = `lease-${randomUUID()}`;
        const expiresAt = new Date(Date.parse(now) + 60_000).toISOString();
        const changed = this.write({
          operationKind: "projection",
          entityKind: "projection_outbox",
          entityId: requiredText(row, "delivery_id"),
          mutationKind: "update",
          statement:
            "UPDATE projection_outbox SET status='leased', attempt_count=attempt_count+1, lease_token=?, lease_expires_at=?, last_reason_code=NULL, updated_at=? WHERE delivery_id=? AND status=? AND attempt_count=?",
          parameters: [
            token,
            expiresAt,
            now,
            requiredText(row, "delivery_id"),
            requiredText(row, "status"),
            requiredInteger(row, "attempt_count"),
          ],
          identity: this.projectionIdentity(row),
        });
        if (changed !== 1) return null;
        const updated = this.database
          .prepare("SELECT * FROM projection_outbox WHERE delivery_id=?")
          .get(requiredText(row, "delivery_id")) as SqlRow;
        this.appendDeliveryAudit(
          updated,
          "projection_delivery_leased",
          "succeeded",
          null,
          actorRef,
          now,
        );
        return this.deliveryWork(updated);
      },
      "projection_receiver",
      () => {
        const row = this.database
          .prepare(
            "SELECT * FROM projection_outbox WHERE status IN ('pending','retryable_failed') AND attempt_count < max_attempts AND NOT EXISTS (SELECT 1 FROM projection_outbox WHERE status IN ('leased','reconcile_wait')) ORDER BY created_at, delivery_id LIMIT 1",
          )
          .get() as SqlRow | undefined;
        if (!row) throw new ReviewRealError("DELIVERY_RECONCILE_WAIT", 409);
        const deliveryId = requiredText(row, "delivery_id");
        const auditId = `audit-delivery-${sha256(`${deliveryId}\nprojection_delivery_leased\n${requiredInteger(row, "attempt_count") + 1}\n${operationCreatedAt}`)}`;
        return this.gatewayProjectionContext(
          operationId,
          this.projectionIdentity(row),
          [
            this.gatewayBinding("projection_outbox", deliveryId),
            this.gatewayBinding("legacy_audit", auditId),
          ],
        );
      },
    );
  }

  markDeliveryReconcileWait(
    work: ProjectionDeliveryWork,
    reasonCode: string,
    actorRef: string,
  ): void {
    this.transitionDelivery(work, "reconcile_wait", reasonCode, actorRef);
  }

  markDeliveryRetryable(
    work: ProjectionDeliveryWork,
    reasonCode: string,
    actorRef: string,
  ): "retryable_failed" | "terminal_failed" {
    const terminal = work.attemptCount >= work.maxAttempts;
    this.transitionDelivery(
      work,
      terminal ? "terminal_failed" : "retryable_failed",
      reasonCode,
      actorRef,
    );
    return terminal ? "terminal_failed" : "retryable_failed";
  }

  markDeliveryTerminal(
    work: ProjectionDeliveryWork,
    reasonCode: string,
    actorRef: string,
  ): void {
    this.transitionDelivery(work, "terminal_failed", reasonCode, actorRef);
  }

  private transitionDelivery(
    work: ProjectionDeliveryWork,
    target: "retryable_failed" | "reconcile_wait" | "terminal_failed",
    reasonCode: string,
    actorRef: string,
  ): void {
    const operationCreatedAt = this.now();
    const operationId = `projection-transition-${sha256(`${work.deliveryId}\n${target}\n${operationCreatedAt}`).slice(0, 48)}`;
    this.transaction(
      () => {
        const now = operationCreatedAt;
        const row = this.database
          .prepare("SELECT * FROM projection_outbox WHERE delivery_id=?")
          .get(work.deliveryId) as SqlRow | undefined;
        if (
          !row ||
          !["leased", "reconcile_wait"].includes(requiredText(row, "status"))
        ) {
          throw new ReviewRealError("DELIVERY_RECONCILE_WAIT", 409);
        }
        if (
          requiredText(row, "status") === "leased" &&
          nullableText(row, "lease_token") !== work.leaseToken
        ) {
          throw new ReviewRealError("DELIVERY_RECONCILE_WAIT", 409);
        }
        const schemaVersion = Number(
          (this.database.prepare("PRAGMA user_version").get() as SqlRow)
            .user_version,
        );
        const originalStatus = requiredText(row, "status");
        if (
          schemaVersion < 7 &&
          target === "terminal_failed" &&
          originalStatus === "leased"
        ) {
          const staged = this.write({
            operationKind: "projection",
            entityKind: "projection_outbox",
            entityId: work.deliveryId,
            mutationKind: "update",
            statement:
              "UPDATE projection_outbox SET status='reconcile_wait', lease_token=NULL, lease_expires_at=NULL, last_reason_code=?, updated_at=? WHERE delivery_id=? AND status='leased' AND lease_token=? AND attempt_count=?",
            parameters: [
              reasonCode,
              now,
              work.deliveryId,
              work.leaseToken,
              work.attemptCount,
            ],
            identity: this.projectionIdentity(row),
          });
          if (staged !== 1)
            throw new ReviewRealError("DELIVERY_RECONCILE_WAIT", 409);
        }
        const changed = this.write({
          operationKind: "projection",
          entityKind: "projection_outbox",
          entityId: work.deliveryId,
          mutationKind: "update",
          statement:
            "UPDATE projection_outbox SET status=?, lease_token=NULL, lease_expires_at=NULL, last_reason_code=?, updated_at=? WHERE delivery_id=? AND status=? AND attempt_count=?",
          parameters: [
            target,
            reasonCode,
            now,
            work.deliveryId,
            schemaVersion < 7 &&
            target === "terminal_failed" &&
            originalStatus === "leased"
              ? "reconcile_wait"
              : originalStatus,
            work.attemptCount,
          ],
          identity: this.projectionIdentity(row),
        });
        if (changed !== 1)
          throw new ReviewRealError("DELIVERY_RECONCILE_WAIT", 409);
        const updated = this.database
          .prepare("SELECT * FROM projection_outbox WHERE delivery_id=?")
          .get(work.deliveryId) as SqlRow;
        const eventType =
          target === "retryable_failed"
            ? "projection_delivery_retryable_failed"
            : target === "reconcile_wait"
              ? "projection_delivery_reconcile_wait"
              : "projection_delivery_terminal_failed";
        this.appendDeliveryAudit(
          updated,
          eventType,
          "failed",
          reasonCode,
          actorRef,
          now,
        );
      },
      "projection_receiver",
      () => {
        const row = this.database
          .prepare("SELECT * FROM projection_outbox WHERE delivery_id=?")
          .get(work.deliveryId) as SqlRow | undefined;
        if (!row) throw new ReviewRealError("DELIVERY_RECONCILE_WAIT", 409);
        const auditEvent =
          target === "retryable_failed"
            ? "projection_delivery_retryable_failed"
            : target === "reconcile_wait"
              ? "projection_delivery_reconcile_wait"
              : "projection_delivery_terminal_failed";
        const auditId = `audit-delivery-${sha256(`${work.deliveryId}\n${auditEvent}\n${requiredInteger(row, "attempt_count")}\n${operationCreatedAt}`)}`;
        return this.gatewayProjectionContext(
          operationId,
          this.projectionIdentity(row),
          [
            this.gatewayBinding("projection_outbox", work.deliveryId),
            this.gatewayBinding("legacy_audit", auditId),
          ],
        );
      },
    );
  }

  markDeliverySucceeded(
    work: ProjectionDeliveryWork,
    value: unknown,
    actorRef: string,
  ): ProjectionReceipt {
    const receipt = ProjectionReceiptSchema.parse(value);
    if (
      receipt.deliveryId !== work.deliveryId ||
      receipt.snapshotGeneration !==
        work.envelope.snapshot.snapshotGeneration ||
      receipt.snapshotManifestHash !==
        work.envelope.snapshot.snapshotManifestHash
    ) {
      throw new ReviewRealError("PROJECTION_IDEMPOTENCY_CONFLICT", 409);
    }
    const operationCreatedAt = this.now();
    const operationId = `projection-success-${sha256(`${work.deliveryId}\n${work.attemptCount}\n${operationCreatedAt}`).slice(0, 48)}`;
    return this.transaction(
      () => {
        const now = operationCreatedAt;
        const row = this.database
          .prepare("SELECT * FROM projection_outbox WHERE delivery_id=?")
          .get(work.deliveryId) as SqlRow | undefined;
        if (
          !row ||
          !["leased", "reconcile_wait"].includes(requiredText(row, "status"))
        ) {
          throw new ReviewRealError("DELIVERY_RECONCILE_WAIT", 409);
        }
        if (
          requiredText(row, "status") === "leased" &&
          nullableText(row, "lease_token") !== work.leaseToken
        ) {
          throw new ReviewRealError("DELIVERY_RECONCILE_WAIT", 409);
        }
        const receiptJson = canonicalJson(receipt);
        const receiptInserted = this.write({
          operationKind: "projection",
          entityKind: "projection_receipt",
          entityId: work.deliveryId,
          mutationKind: "insert",
          statement:
            "INSERT INTO projection_delivery_receipt (delivery_id, snapshot_generation, snapshot_manifest_hash, receipt_json, receipt_hash, receipt_status, received_at, activated_at, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          parameters: [
            work.deliveryId,
            receipt.snapshotGeneration,
            receipt.snapshotManifestHash,
            receiptJson,
            sha256(receiptJson),
            receipt.status,
            receipt.receivedAt,
            receipt.activatedAt,
            now,
          ],
          identity: this.projectionIdentity(row),
        });
        if (receiptInserted !== 1)
          throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
        const changed = this.write({
          operationKind: "projection",
          entityKind: "projection_outbox",
          entityId: work.deliveryId,
          mutationKind: "update",
          statement:
            "UPDATE projection_outbox SET status='succeeded', lease_token=NULL, lease_expires_at=NULL, last_reason_code=NULL, updated_at=? WHERE delivery_id=? AND status=? AND attempt_count=?",
          parameters: [
            now,
            work.deliveryId,
            requiredText(row, "status"),
            work.attemptCount,
          ],
          identity: this.projectionIdentity(row),
        });
        if (changed !== 1)
          throw new ReviewRealError("DELIVERY_RECONCILE_WAIT", 409);
        const updated = this.database
          .prepare("SELECT * FROM projection_outbox WHERE delivery_id=?")
          .get(work.deliveryId) as SqlRow;
        this.appendDeliveryAudit(
          updated,
          "projection_delivery_succeeded",
          "succeeded",
          null,
          actorRef,
          now,
        );
        return receipt;
      },
      "projection_receiver",
      () => {
        const row = this.database
          .prepare("SELECT * FROM projection_outbox WHERE delivery_id=?")
          .get(work.deliveryId) as SqlRow | undefined;
        if (!row) throw new ReviewRealError("DELIVERY_RECONCILE_WAIT", 409);
        const auditId = `audit-delivery-${sha256(`${work.deliveryId}\nprojection_delivery_succeeded\n${requiredInteger(row, "attempt_count")}\n${operationCreatedAt}`)}`;
        return this.gatewayProjectionContext(
          operationId,
          this.projectionIdentity(row),
          [
            this.gatewayBinding("projection_receipt", work.deliveryId),
            this.gatewayBinding("projection_outbox", work.deliveryId),
            this.gatewayBinding("legacy_audit", auditId),
          ],
        );
      },
    );
  }

  deliveryReceipt(deliveryId: string): ProjectionReceipt {
    const row = this.database
      .prepare(
        "SELECT receipt_json, receipt_hash FROM projection_delivery_receipt WHERE delivery_id=?",
      )
      .get(deliveryId) as SqlRow | undefined;
    if (!row) throw new ReviewRealError("PROJECTION_RECEIPT_UNKNOWN", 404);
    const json = requiredText(row, "receipt_json");
    if (
      sha256(json) !== requiredText(row, "receipt_hash") ||
      canonicalJson(parseJson(json)) !== json
    ) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    return parseStored(ProjectionReceiptSchema, parseJson(json));
  }

  projectionDeliveryIdentity(deliveryId: string): Readonly<{
    sourceId: string | null;
    candidateId: string | null;
    publicationId: string | null;
    publicId: string | null;
  }> {
    const row = this.database
      .prepare("SELECT * FROM projection_outbox WHERE delivery_id=?")
      .get(deliveryId) as SqlRow | undefined;
    if (!row) throw new ReviewRealError("PROJECTION_RECEIPT_UNKNOWN", 404);
    return this.projectionIdentity(row);
  }

  deliveryTask(deliveryId: string): Readonly<{
    envelope: ProjectionTaskEnvelope;
    envelopeJson: string;
    envelopeHash: string;
  }> {
    const row = this.database
      .prepare(
        "SELECT task_envelope_json, task_envelope_hash FROM projection_outbox WHERE delivery_id = ?",
      )
      .get(deliveryId) as SqlRow | undefined;
    if (!row) throw new ReviewRealError("PROJECTION_RECEIPT_UNKNOWN", 404);
    const envelopeJson = requiredText(row, "task_envelope_json");
    const envelopeHash = requiredText(row, "task_envelope_hash");
    return {
      envelope: verifyStoredProjectionTaskEnvelope(envelopeJson, envelopeHash),
      envelopeJson,
      envelopeHash,
    };
  }
}
