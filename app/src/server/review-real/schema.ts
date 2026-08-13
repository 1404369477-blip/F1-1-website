import { z } from "zod";

import { RSS_SOURCE_ID } from "../rss/types.ts";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const VERSION_TAG_PATTERN = /^[0-9a-f]{12}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function codePointLength(value: string): number {
  return [...value].length;
}

function normalizedText(maximum: number, minimum = 0): z.ZodType<string> {
  return z.string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .refine((value) => codePointLength(value) >= minimum && codePointLength(value) <= maximum);
}

export const HashSchema = z.string().regex(HASH_PATTERN);
export const VersionTagSchema = z.string().regex(VERSION_TAG_PATTERN);
export const IdentifierSchema = z.string().min(1).max(256);
export const UtcTimestampSchema = z.string().regex(UTC_PATTERN).refine((value) => Number.isFinite(Date.parse(value)));

export const MotorsportCanonicalUrlSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "www.motorsport.com" &&
      url.username === "" &&
      url.password === "" &&
      (url.port === "" || url.port === "443") &&
      url.hash === "";
  } catch {
    return false;
  }
}, "canonical URL is outside the Motorsport HTTPS allowlist");

export const MotorsportMediaUrlSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      /^cdn-[0-9]+\.motorsport\.com$/.test(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      (url.port === "" || url.port === "443") &&
      url.hash === "";
  } catch {
    return false;
  }
}, "media URL is outside the Motorsport CDN HTTPS allowlist");

export const SourceImageSchema = z.object({
  kind: z.literal("source_image"),
  url: MotorsportMediaUrlSchema,
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif"]),
  declaredBytes: z.number().int().min(1).max(20 * 1024 * 1024)
}).strict();

export const MachineSummaryDraftSchema = z.object({
  titleZh: normalizedText(400, 1),
  summaryZh: normalizedText(1200, 1),
  keyPointsZh: z.array(normalizedText(240, 1)).min(1).max(3),
  model: z.literal("deepseek-chat"),
  generatedAt: UtcTimestampSchema,
  sourceRevision: z.number().int().positive()
}).strict();

export const ReviewStateSchema = z.enum([
  "pending_review",
  "source_updated",
  "approved_waiting_publish",
  "rejected",
  "published_delivery_pending",
  "published",
  "reconcile_wait",
  "terminal_failed",
  "emergency_stopped",
  "blocked"
]);

export const AllowedActionSchema = z.enum([
  "revision",
  "approve",
  "reject",
  "publish",
  "check_delivery",
  "open_public_story",
  "return_to_queue"
]);

export const CandidateSourceSnapshotSchema = z.object({
  candidateId: IdentifierSchema,
  sourceId: z.literal(RSS_SOURCE_ID),
  sourceRevision: z.number().int().positive(),
  sourcePayloadHash: HashSchema,
  canonicalUrl: MotorsportCanonicalUrlSchema,
  sourceTitle: z.string().min(1).max(16_384),
  sourceExcerpt: z.string().max(16_384),
  sourceAuthor: z.string().max(16_384).nullable(),
  sourcePublishedAt: UtcTimestampSchema,
  editorTitle: z.string().max(16_384).nullable(),
  editorExcerpt: z.string().max(16_384).nullable(),
  editorNotes: z.string().max(16_384).nullable(),
  editorBasedOnSourceRevision: z.number().int().positive().nullable(),
  reviewStatus: z.enum(["pending_review", "approved", "rejected", "published"]),
  firstSeenAt: UtcTimestampSchema,
  lastSeenAt: UtcTimestampSchema
}).strict().superRefine((candidate, context) => {
  if (
    candidate.editorBasedOnSourceRevision !== null &&
    candidate.editorBasedOnSourceRevision > candidate.sourceRevision
  ) {
    context.addIssue({ code: "custom", message: "editor revision cannot be newer than source revision" });
  }
});

export const ReviewEditableSchema = z.object({
  titleZh: normalizedText(400, 1),
  summaryZh: normalizedText(1200, 1),
  notes: normalizedText(2000)
}).strict();

export const ReviewBundlePublicPayloadSchema = z.object({
  candidateId: IdentifierSchema,
  sourceId: z.literal(RSS_SOURCE_ID),
  sourceRevision: z.number().int().positive(),
  sourcePayloadHash: HashSchema,
  canonicalUrl: MotorsportCanonicalUrlSchema,
  sourceTitle: z.string().min(1).max(16_384),
  sourceAuthor: z.string().min(1).max(16_384),
  sourcePublishedAt: UtcTimestampSchema,
  contentType: z.literal("race_news"),
  titleZh: normalizedText(400, 1),
  summaryZh: normalizedText(1200, 1),
  media: z.array(SourceImageSchema).max(1),
  sourceDisplayName: z.literal("Motorsport.com")
}).strict();

export const PublicProjectionRecordCoreSchema = z.object({
  publicId: z.string().regex(/^public-rss-[0-9a-f]{64}$/),
  publishGeneration: z.literal(1),
  contentType: z.literal("race_news"),
  state: z.enum(["media_missing", "ready"]),
  titleZh: normalizedText(400, 1),
  summaryZh: normalizedText(1200, 1),
  publishedAt: UtcTimestampSchema,
  sourcePublishedAt: UtcTimestampSchema,
  sourceTimeStatus: z.literal("known"),
  source: z.object({
    sourceId: z.literal(RSS_SOURCE_ID),
    platform: z.literal("rss"),
    displayName: z.literal("Motorsport.com"),
    byline: z.string().min(1).max(16_384),
    accessStatus: z.literal("available")
  }).strict(),
  media: z.object({
    kind: z.literal("source_image"),
    assetRef: MotorsportMediaUrlSchema,
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif"]),
    declaredBytes: z.number().int().min(1).max(20 * 1024 * 1024),
    altZh: normalizedText(400, 1)
  }).strict().nullable(),
  originalLink: z.object({
    enabled: z.literal(true),
    url: MotorsportCanonicalUrlSchema,
    reason: z.null()
  }).strict(),
  detail: z.object({
    leadZh: normalizedText(1200, 1),
    bodyZh: z.array(normalizedText(1200, 1)).length(1),
    keyPointsZh: z.array(normalizedText(240, 1)).max(3)
  }).strict()
}).strict().superRefine((record, context) => {
  if ((record.state === "ready") !== (record.media !== null)) {
    context.addIssue({ code: "custom", message: "media state and payload disagree" });
  }
});

export const PublicProjectionRecordSchema = PublicProjectionRecordCoreSchema.extend({
  projectionHash: HashSchema
}).strict();

export const BundleSummarySchema = z.object({
  id: IdentifierSchema,
  revision: z.number().int().positive(),
  versionTag: VersionTagSchema
}).strict();

export const DecisionSummarySchema = z.object({
  id: IdentifierSchema,
  bundleId: IdentifierSchema,
  decision: z.enum(["approved", "rejected"]),
  rejectionReason: normalizedText(500, 1).nullable(),
  decidedAt: UtcTimestampSchema
}).strict().superRefine((decision, context) => {
  if (decision.decision === "approved" && decision.rejectionReason !== null) {
    context.addIssue({ code: "custom", message: "approved decision cannot include a rejection reason" });
  }
  if (decision.decision === "rejected" && decision.rejectionReason === null) {
    context.addIssue({ code: "custom", message: "rejected decision requires a reason" });
  }
});

export const PublicationSummarySchema = z.object({
  id: IdentifierSchema,
  publicId: z.string().regex(/^public-rss-[0-9a-f]{64}$/),
  bundleId: IdentifierSchema,
  publishGeneration: z.literal(1),
  status: z.enum(["queued", "published", "reconcile_wait", "terminal_failed", "emergency_stopped", "superseded"]),
  publishedAt: UtcTimestampSchema.nullable(),
  updatedAt: UtcTimestampSchema
}).strict();

export const DeliverySummarySchema = z.object({
  id: IdentifierSchema,
  status: z.enum(["pending", "leased", "succeeded", "retryable_failed", "reconcile_wait", "terminal_failed", "cancelled"]),
  snapshotGeneration: z.number().int().positive(),
  attemptCount: z.number().int().nonnegative(),
  reasonCode: z.string().min(1).max(128),
  updatedAt: UtcTimestampSchema
}).strict();

const ReviewQueueItemShape = {
  candidateId: IdentifierSchema,
  sourceId: z.literal(RSS_SOURCE_ID),
  sourceRevision: z.number().int().positive(),
  editorBasedOnSourceRevision: z.number().int().positive().nullable(),
  sourceTitle: z.string().min(1).max(16_384),
  titleZh: normalizedText(400, 1).nullable(),
  summaryZh: normalizedText(1200, 1).nullable(),
  sourceAuthor: z.string().max(16_384).nullable(),
  sourcePublishedAt: UtcTimestampSchema,
  sourceDisplayName: z.literal("Motorsport.com"),
  originalUrl: MotorsportCanonicalUrlSchema,
  mediaState: z.enum(["none", "source_image"]),
  reviewState: ReviewStateSchema,
  latestBundle: BundleSummarySchema.nullable(),
  decision: DecisionSummarySchema.nullable(),
  publication: PublicationSummarySchema.nullable(),
  delivery: DeliverySummarySchema.nullable(),
  updatedAt: UtcTimestampSchema,
  allowedActions: z.array(AllowedActionSchema)
} as const;

export const ReviewQueueItemSchema = z.object(ReviewQueueItemShape).strict();

export const ReviewListSchema = z.object({
  schemaVersion: z.literal("admin-review-v0.2"),
  items: z.array(ReviewQueueItemSchema),
  nextCursor: z.string().min(1).max(2048).nullable()
}).strict();

export const ReviewDetailSchema = z.object({
  schemaVersion: z.literal("admin-review-v0.2"),
  ...ReviewQueueItemShape,
  sourceExcerpt: z.string().max(16_384),
  sourceMedia: SourceImageSchema.nullable(),
  machineDraft: MachineSummaryDraftSchema.nullable(),
  editorNotes: normalizedText(2000).nullable(),
  integrity: z.object({
    status: z.enum(["ok", "blocked"]),
    reasonCode: z.string().min(1).max(128).nullable(),
    versionTag: VersionTagSchema
  }).strict()
}).strict();

export const OperationReceiptSchema = z.object({
  schemaVersion: z.literal("admin-review-v0.2"),
  operationId: IdentifierSchema,
  operationType: z.enum(["revision", "approve", "reject", "publish"]),
  status: z.enum(["completed", "failed"]),
  httpStatus: z.number().int().min(200).max(599),
  reasonCode: z.string().min(1).max(128).nullable(),
  requestVersionTag: VersionTagSchema,
  responseVersionTag: VersionTagSchema,
  candidateId: IdentifierSchema.nullable(),
  bundleId: IdentifierSchema.nullable(),
  publicId: z.string().regex(/^public-rss-[0-9a-f]{64}$/).nullable(),
  deliveryId: IdentifierSchema.nullable(),
  createdAt: UtcTimestampSchema
}).strict().superRefine((receipt, context) => {
  const completed = receipt.status === "completed";
  if (completed !== (receipt.httpStatus >= 200 && receipt.httpStatus <= 299)) {
    context.addIssue({ code: "custom", message: "operation status and HTTP status disagree" });
  }
  if (completed !== (receipt.reasonCode === null)) {
    context.addIssue({ code: "custom", message: "completed receipt cannot include a reason code" });
  }
});

const RevisionExpectedSchema = z.object({
  candidateId: IdentifierSchema,
  sourceRevision: z.number().int().positive(),
  sourceVersionTag: VersionTagSchema,
  latestBundleId: IdentifierSchema.nullable(),
  latestBundleVersionTag: VersionTagSchema.nullable()
}).strict().superRefine((expected, context) => {
  if ((expected.latestBundleId === null) !== (expected.latestBundleVersionTag === null)) {
    context.addIssue({ code: "custom", message: "latest bundle id and version tag must be present together" });
  }
});

const DecisionExpectedSchema = z.object({
  candidateId: IdentifierSchema,
  sourceRevision: z.number().int().positive(),
  bundleId: IdentifierSchema,
  bundleVersionTag: VersionTagSchema
}).strict();

export const RevisionRequestSchema = z.object({
  schemaVersion: z.literal("admin-review-v0.2"),
  operationId: IdentifierSchema,
  expected: RevisionExpectedSchema,
  editable: ReviewEditableSchema
}).strict();

export const ApproveRequestSchema = z.object({
  schemaVersion: z.literal("admin-review-v0.2"),
  operationId: IdentifierSchema,
  expected: DecisionExpectedSchema
}).strict();

export const RejectRequestSchema = z.object({
  schemaVersion: z.literal("admin-review-v0.2"),
  operationId: IdentifierSchema,
  expected: DecisionExpectedSchema,
  reason: normalizedText(500, 1)
}).strict();

export const PublishRequestSchema = z.object({
  schemaVersion: z.literal("admin-review-v0.2"),
  operationId: IdentifierSchema,
  expected: z.object({
    publicId: z.string().regex(/^public-rss-[0-9a-f]{64}$/),
    publishGeneration: z.literal(1),
    publicationStatus: z.literal("queued"),
    approvedBundleVersionTag: VersionTagSchema
  }).strict()
}).strict();

export const RevisionSuccessSchema = z.object({
  schemaVersion: z.literal("admin-review-v0.2"),
  operation: OperationReceiptSchema,
  candidate: ReviewQueueItemSchema,
  bundle: BundleSummarySchema
}).strict();

export const ApproveSuccessSchema = z.object({
  schemaVersion: z.literal("admin-review-v0.2"),
  operation: OperationReceiptSchema,
  candidate: ReviewQueueItemSchema,
  decision: DecisionSummarySchema,
  publication: PublicationSummarySchema
}).strict();

export const RejectSuccessSchema = z.object({
  schemaVersion: z.literal("admin-review-v0.2"),
  operation: OperationReceiptSchema,
  candidate: ReviewQueueItemSchema,
  decision: DecisionSummarySchema
}).strict();

export const PublishSuccessSchema = z.object({
  schemaVersion: z.literal("admin-review-v0.2"),
  operation: OperationReceiptSchema,
  candidate: ReviewQueueItemSchema,
  publication: PublicationSummarySchema,
  delivery: DeliverySummarySchema,
  status: z.enum(["delivery_pending", "active"]),
  publicPath: z.string().regex(/^\/stories\/public-rss-[0-9a-f]{64}$/).nullable()
}).strict().superRefine((result, context) => {
  if ((result.status === "active") !== (result.publicPath !== null)) {
    context.addIssue({ code: "custom", message: "only an active receipt can expose the public path" });
  }
});

export const ADMIN_REVIEW_DTO_SCHEMAS = Object.freeze({
  reviewList: ReviewListSchema,
  reviewDetail: ReviewDetailSchema,
  operationReceipt: OperationReceiptSchema,
  revisionRequest: RevisionRequestSchema,
  revisionSuccess: RevisionSuccessSchema,
  approveRequest: ApproveRequestSchema,
  approveSuccess: ApproveSuccessSchema,
  rejectRequest: RejectRequestSchema,
  rejectSuccess: RejectSuccessSchema,
  publishRequest: PublishRequestSchema,
  publishSuccess: PublishSuccessSchema
});

export const ProjectionSnapshotSchema = z.object({
  snapshotGeneration: z.number().int().positive(),
  previousSnapshotManifestHash: HashSchema.nullable(),
  records: z.array(PublicProjectionRecordSchema),
  recordsHash: HashSchema,
  snapshotManifestHash: HashSchema
}).strict().superRefine((snapshot, context) => {
  for (let index = 1; index < snapshot.records.length; index += 1) {
    if (snapshot.records[index - 1].publicId >= snapshot.records[index].publicId) {
      context.addIssue({ code: "custom", message: "projection records must be unique and sorted by publicId" });
      break;
    }
  }
});

export const ProjectionTaskEnvelopeSchema = z.object({
  schemaVersion: z.literal("projection-snapshot-task-v1"),
  deliveryId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  reconcileKey: IdentifierSchema,
  operationType: z.literal("snapshot_sync"),
  snapshot: ProjectionSnapshotSchema,
  attempt: z.number().int().nonnegative(),
  createdAt: UtcTimestampSchema,
  deadlineAt: UtcTimestampSchema
}).strict().superRefine((envelope, context) => {
  const lifetime = Date.parse(envelope.deadlineAt) - Date.parse(envelope.createdAt);
  if (lifetime <= 0 || lifetime > 900_000) {
    context.addIssue({ code: "custom", message: "task deadline must be within 900 seconds" });
  }
});

export const AuditEventPayloadSchema = z.object({
  schemaVersion: z.literal("admin-audit-v1"),
  eventType: z.enum([
    "review_revision_saved",
    "review_approved",
    "review_rejected",
    "publication_published",
    "publication_superseded",
    "projection_delivery_leased",
    "projection_delivery_succeeded",
    "projection_delivery_retryable_failed",
    "projection_delivery_reconcile_wait",
    "projection_delivery_terminal_failed",
    "projection_delivery_cancelled",
    "emergency_stopped"
  ]),
  outcome: z.enum(["succeeded", "failed"]),
  reasonCode: z.string().min(1).max(128).nullable(),
  operationId: IdentifierSchema,
  entityType: z.enum(["candidate", "bundle", "decision", "publication", "projection", "delivery"]),
  entityId: IdentifierSchema,
  actorRef: IdentifierSchema,
  occurredAt: UtcTimestampSchema
}).strict();

export type CandidateSourceSnapshot = z.infer<typeof CandidateSourceSnapshotSchema>;
export type ReviewEditable = z.infer<typeof ReviewEditableSchema>;
export type SourceImage = z.infer<typeof SourceImageSchema>;
export type MachineSummaryDraft = z.infer<typeof MachineSummaryDraftSchema>;
export type ReviewBundlePublicPayload = z.infer<typeof ReviewBundlePublicPayloadSchema>;
export type PublicProjectionRecord = z.infer<typeof PublicProjectionRecordSchema>;
export type PublicProjectionRecordCore = z.infer<typeof PublicProjectionRecordCoreSchema>;
export type ProjectionSnapshot = z.infer<typeof ProjectionSnapshotSchema>;
export type ProjectionTaskEnvelope = z.infer<typeof ProjectionTaskEnvelopeSchema>;
