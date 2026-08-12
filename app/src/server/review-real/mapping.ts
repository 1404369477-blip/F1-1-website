import { createHash } from "node:crypto";
import type { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import {
  ADMIN_REVIEW_DTO_SCHEMAS,
  AuditEventPayloadSchema,
  CandidateSourceSnapshotSchema,
  HashSchema,
  IdentifierSchema,
  ProjectionSnapshotSchema,
  ProjectionTaskEnvelopeSchema,
  PublicProjectionRecordCoreSchema,
  PublicProjectionRecordSchema,
  ReviewBundlePublicPayloadSchema,
  ReviewEditableSchema,
  UtcTimestampSchema,
  type CandidateSourceSnapshot,
  type ProjectionSnapshot,
  type ProjectionTaskEnvelope,
  type PublicProjectionRecord,
  type PublicProjectionRecordCore,
  type ReviewBundlePublicPayload,
  type ReviewEditable
} from "./schema.ts";

export const ADMIN_REVIEW_DTO_COUNT = 11 as const;
export const AUDIT_GENESIS_PREVIOUS_HASH = null;

export type AuditEventPayload = z.infer<typeof AuditEventPayloadSchema>;
export type AuditEventMaterial = Readonly<{
  previousEventHash: string | null;
  eventPayload: AuditEventPayload;
  eventJson: string;
  eventHash: string;
}>;

export class ReviewDataError extends Error {
  readonly reasonCode: "REVIEW_DATA_INVALID" | "REVIEW_HASH_MISMATCH";

  constructor(reasonCode: "REVIEW_DATA_INVALID" | "REVIEW_HASH_MISMATCH") {
    super(reasonCode);
    this.name = "ReviewDataError";
    this.reasonCode = reasonCode;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ReviewDataError("REVIEW_DATA_INVALID");
  }
}

function requireEqual(actual: string, expected: string): void {
  if (actual !== expected) throw new ReviewDataError("REVIEW_HASH_MISMATCH");
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

export function buildAuditEventMaterial(input: Readonly<{
  previousEventHash: string | null;
  eventPayload: AuditEventPayload;
}>): AuditEventMaterial {
  const previousEventHash = input.previousEventHash === AUDIT_GENESIS_PREVIOUS_HASH
    ? AUDIT_GENESIS_PREVIOUS_HASH
    : HashSchema.safeParse(input.previousEventHash);
  const eventPayload = AuditEventPayloadSchema.safeParse(input.eventPayload);
  if (
    (previousEventHash !== AUDIT_GENESIS_PREVIOUS_HASH && !previousEventHash.success) ||
    !eventPayload.success
  ) {
    throw new ReviewDataError("REVIEW_DATA_INVALID");
  }
  const previous = previousEventHash === AUDIT_GENESIS_PREVIOUS_HASH
    ? AUDIT_GENESIS_PREVIOUS_HASH
    : previousEventHash.data;
  const eventJson = canonicalJson(eventPayload.data);
  const eventHash = sha256(canonicalJson({
    previous_event_hash: previous,
    event_payload: eventPayload.data
  }));
  return {
    previousEventHash: previous,
    eventPayload: eventPayload.data,
    eventJson,
    eventHash
  };
}

export function verifyStoredAuditEvent(input: Readonly<{
  previousEventHash: string | null;
  eventJson: string;
  eventHash: string;
}>): AuditEventMaterial {
  const eventPayload = AuditEventPayloadSchema.safeParse(parseJson(input.eventJson));
  const eventHash = HashSchema.safeParse(input.eventHash);
  const previousEventHash = input.previousEventHash === AUDIT_GENESIS_PREVIOUS_HASH
    ? AUDIT_GENESIS_PREVIOUS_HASH
    : HashSchema.safeParse(input.previousEventHash);
  if (
    !eventPayload.success ||
    !eventHash.success ||
    (previousEventHash !== AUDIT_GENESIS_PREVIOUS_HASH && !previousEventHash.success)
  ) {
    throw new ReviewDataError("REVIEW_DATA_INVALID");
  }
  const previous = previousEventHash === AUDIT_GENESIS_PREVIOUS_HASH
    ? AUDIT_GENESIS_PREVIOUS_HASH
    : previousEventHash.data;
  const canonicalEventJson = canonicalJson(eventPayload.data);
  requireEqual(input.eventJson, canonicalEventJson);
  const expectedHash = sha256(canonicalJson({
    previous_event_hash: previous,
    event_payload: eventPayload.data
  }));
  requireEqual(eventHash.data, expectedHash);
  return {
    previousEventHash: previous,
    eventPayload: eventPayload.data,
    eventJson: canonicalEventJson,
    eventHash: eventHash.data
  };
}

export type ReviewBundleMaterial = Readonly<{
  publicPayload: ReviewBundlePublicPayload;
  publicPayloadJson: string;
  publicPayloadHash: string;
  editorNotes: string;
  bundleHash: string;
}>;

export function derivePublicId(candidateId: string, bundleHash: string): string {
  const parsedCandidateId = IdentifierSchema.safeParse(candidateId);
  const parsedBundleHash = HashSchema.safeParse(bundleHash);
  if (!parsedCandidateId.success || !parsedBundleHash.success) {
    throw new ReviewDataError("REVIEW_DATA_INVALID");
  }
  return `public-rss-${sha256(`${parsedCandidateId.data}\u001f${parsedBundleHash.data}`)}`;
}

export function buildReviewBundleMaterial(input: Readonly<{
  bundleId: string;
  bundleRevision: number;
  createdAt: string;
  candidate: CandidateSourceSnapshot;
  editable: ReviewEditable;
}>): ReviewBundleMaterial {
  const bundleId = IdentifierSchema.safeParse(input.bundleId);
  const candidate = CandidateSourceSnapshotSchema.safeParse(input.candidate);
  const editable = ReviewEditableSchema.safeParse(input.editable);
  const createdAt = UtcTimestampSchema.safeParse(input.createdAt);
  if (
    !bundleId.success ||
    !candidate.success ||
    !editable.success ||
    !createdAt.success ||
    !Number.isSafeInteger(input.bundleRevision) ||
    input.bundleRevision < 1
  ) {
    throw new ReviewDataError("REVIEW_DATA_INVALID");
  }

  const sourceAuthor = candidate.data.sourceAuthor?.trim() || "Motorsport.com";
  const publicPayload = ReviewBundlePublicPayloadSchema.parse({
    candidateId: candidate.data.candidateId,
    sourceId: candidate.data.sourceId,
    sourceRevision: candidate.data.sourceRevision,
    sourcePayloadHash: candidate.data.sourcePayloadHash,
    canonicalUrl: candidate.data.canonicalUrl,
    sourceTitle: candidate.data.sourceTitle,
    sourceAuthor,
    sourcePublishedAt: candidate.data.sourcePublishedAt,
    contentType: "race_news",
    titleZh: editable.data.titleZh,
    summaryZh: editable.data.summaryZh,
    media: [],
    sourceDisplayName: "Motorsport.com"
  });
  const publicPayloadJson = canonicalJson(publicPayload);
  const publicPayloadHash = sha256(publicPayloadJson);
  const bundleHash = sha256(canonicalJson({
    bundle_id: bundleId.data,
    bundle_revision: input.bundleRevision,
    public_payload_hash: publicPayloadHash,
    editor_notes: editable.data.notes,
    created_at: createdAt.data
  }));

  return {
    publicPayload,
    publicPayloadJson,
    publicPayloadHash,
    editorNotes: editable.data.notes,
    bundleHash
  };
}

export function verifyStoredReviewBundle(input: Readonly<{
  bundleId: string;
  bundleRevision: number;
  createdAt: string;
  publicPayloadJson: string;
  publicPayloadHash: string;
  editorNotes: string;
  bundleHash: string;
}>): ReviewBundleMaterial {
  const bundleId = IdentifierSchema.safeParse(input.bundleId);
  const publicPayloadResult = ReviewBundlePublicPayloadSchema.safeParse(parseJson(input.publicPayloadJson));
  const createdAt = UtcTimestampSchema.safeParse(input.createdAt);
  const payloadHash = HashSchema.safeParse(input.publicPayloadHash);
  const bundleHash = HashSchema.safeParse(input.bundleHash);
  const editable = publicPayloadResult.success
    ? ReviewEditableSchema.safeParse({
      titleZh: publicPayloadResult.data.titleZh,
      summaryZh: publicPayloadResult.data.summaryZh,
      notes: input.editorNotes
    })
    : null;
  if (
    !bundleId.success ||
    !publicPayloadResult.success ||
    !createdAt.success ||
    !payloadHash.success ||
    !bundleHash.success ||
    editable === null ||
    !editable.success ||
    !Number.isSafeInteger(input.bundleRevision) ||
    input.bundleRevision < 1
  ) {
    throw new ReviewDataError("REVIEW_DATA_INVALID");
  }
  const canonicalPayload = canonicalJson(publicPayloadResult.data);
  requireEqual(input.publicPayloadJson, canonicalPayload);
  requireEqual(payloadHash.data, sha256(canonicalPayload));
  const expectedBundleHash = sha256(canonicalJson({
    bundle_id: bundleId.data,
    bundle_revision: input.bundleRevision,
    public_payload_hash: payloadHash.data,
    editor_notes: editable.data.notes,
    created_at: createdAt.data
  }));
  requireEqual(bundleHash.data, expectedBundleHash);
  return {
    publicPayload: publicPayloadResult.data,
    publicPayloadJson: canonicalPayload,
    publicPayloadHash: payloadHash.data,
    editorNotes: editable.data.notes,
    bundleHash: bundleHash.data
  };
}

function projectionHash(core: PublicProjectionRecordCore): string {
  return sha256(canonicalJson(core));
}

export function buildPublicProjectionRecord(input: Readonly<{
  publicId: string;
  bundleHash: string;
  publishedAt: string;
  publicPayload: ReviewBundlePublicPayload;
}>): PublicProjectionRecord {
  const payload = ReviewBundlePublicPayloadSchema.safeParse(input.publicPayload);
  const publishedAt = UtcTimestampSchema.safeParse(input.publishedAt);
  const bundleHash = HashSchema.safeParse(input.bundleHash);
  if (!payload.success || !publishedAt.success || !bundleHash.success) {
    throw new ReviewDataError("REVIEW_DATA_INVALID");
  }
  requireEqual(input.publicId, derivePublicId(payload.data.candidateId, bundleHash.data));

  const core = PublicProjectionRecordCoreSchema.parse({
    publicId: input.publicId,
    publishGeneration: 1,
    contentType: "race_news",
    state: "media_missing",
    titleZh: payload.data.titleZh,
    summaryZh: payload.data.summaryZh,
    publishedAt: publishedAt.data,
    sourcePublishedAt: payload.data.sourcePublishedAt,
    sourceTimeStatus: "known",
    source: {
      sourceId: payload.data.sourceId,
      platform: "rss",
      displayName: payload.data.sourceDisplayName,
      byline: payload.data.sourceAuthor,
      accessStatus: "available"
    },
    media: null,
    originalLink: {
      enabled: true,
      url: payload.data.canonicalUrl,
      reason: null
    },
    detail: {
      leadZh: payload.data.summaryZh,
      bodyZh: [payload.data.summaryZh],
      keyPointsZh: []
    }
  });
  return PublicProjectionRecordSchema.parse({ ...core, projectionHash: projectionHash(core) });
}

export function verifyStoredPublicProjection(projectionJson: string, expectedHash: string): PublicProjectionRecord {
  const parsed = PublicProjectionRecordSchema.safeParse(parseJson(projectionJson));
  const hash = HashSchema.safeParse(expectedHash);
  if (!parsed.success || !hash.success) throw new ReviewDataError("REVIEW_DATA_INVALID");
  requireEqual(projectionJson, canonicalJson(parsed.data));
  const { projectionHash: storedProjectionHash, ...coreInput } = parsed.data;
  const core = PublicProjectionRecordCoreSchema.parse(coreInput);
  const computed = projectionHash(core);
  requireEqual(storedProjectionHash, computed);
  requireEqual(hash.data, computed);
  return parsed.data;
}

function snapshotManifestHash(input: Readonly<{
  snapshotGeneration: number;
  previousSnapshotManifestHash: string | null;
  recordsHash: string;
  recordCount: number;
}>): string {
  return sha256(canonicalJson({
    schema_version: "projection-snapshot-v1",
    snapshot_generation: input.snapshotGeneration,
    previous_snapshot_manifest_hash: input.previousSnapshotManifestHash,
    records_hash: input.recordsHash,
    record_count: input.recordCount
  }));
}

export function buildProjectionSnapshot(input: Readonly<{
  snapshotGeneration: number;
  previousSnapshotManifestHash: string | null;
  records: readonly PublicProjectionRecord[];
}>): ProjectionSnapshot {
  if (!Number.isSafeInteger(input.snapshotGeneration) || input.snapshotGeneration < 1) {
    throw new ReviewDataError("REVIEW_DATA_INVALID");
  }
  const previous = input.previousSnapshotManifestHash === null
    ? null
    : HashSchema.safeParse(input.previousSnapshotManifestHash);
  if (previous !== null && !previous.success) throw new ReviewDataError("REVIEW_DATA_INVALID");

  const records = input.records
    .map((record) => PublicProjectionRecordSchema.parse(record))
    .sort((left, right) => compareUnicodeCodePoints(left.publicId, right.publicId));
  if (new Set(records.map((record) => record.publicId)).size !== records.length) {
    throw new ReviewDataError("REVIEW_DATA_INVALID");
  }
  for (const record of records) {
    verifyStoredPublicProjection(canonicalJson(record), record.projectionHash);
  }
  const recordsHash = sha256(canonicalJson(records));
  const previousHash = previous === null ? null : previous.data;
  return ProjectionSnapshotSchema.parse({
    snapshotGeneration: input.snapshotGeneration,
    previousSnapshotManifestHash: previousHash,
    records,
    recordsHash,
    snapshotManifestHash: snapshotManifestHash({
      snapshotGeneration: input.snapshotGeneration,
      previousSnapshotManifestHash: previousHash,
      recordsHash,
      recordCount: records.length
    })
  });
}

export function verifyProjectionSnapshot(value: unknown): ProjectionSnapshot {
  const snapshot = ProjectionSnapshotSchema.safeParse(value);
  if (!snapshot.success) throw new ReviewDataError("REVIEW_DATA_INVALID");
  for (const record of snapshot.data.records) {
    verifyStoredPublicProjection(canonicalJson(record), record.projectionHash);
  }
  const recordsHash = sha256(canonicalJson(snapshot.data.records));
  requireEqual(snapshot.data.recordsHash, recordsHash);
  requireEqual(snapshot.data.snapshotManifestHash, snapshotManifestHash({
    snapshotGeneration: snapshot.data.snapshotGeneration,
    previousSnapshotManifestHash: snapshot.data.previousSnapshotManifestHash,
    recordsHash,
    recordCount: snapshot.data.records.length
  }));
  return snapshot.data;
}

export function buildProjectionTaskEnvelope(input: Readonly<{
  deliveryId: string;
  idempotencyKey: string;
  reconcileKey: string;
  snapshot: ProjectionSnapshot;
  attempt: number;
  createdAt: string;
  deadlineAt: string;
}>): Readonly<{ envelope: ProjectionTaskEnvelope; envelopeJson: string; envelopeHash: string }> {
  const envelope = ProjectionTaskEnvelopeSchema.safeParse({
    schemaVersion: "projection-snapshot-task-v1",
    deliveryId: input.deliveryId,
    idempotencyKey: input.idempotencyKey,
    reconcileKey: input.reconcileKey,
    operationType: "snapshot_sync",
    snapshot: verifyProjectionSnapshot(input.snapshot),
    attempt: input.attempt,
    createdAt: input.createdAt,
    deadlineAt: input.deadlineAt
  });
  if (!envelope.success) throw new ReviewDataError("REVIEW_DATA_INVALID");
  const envelopeJson = canonicalJson(envelope.data);
  return { envelope: envelope.data, envelopeJson, envelopeHash: sha256(envelopeJson) };
}

export function verifyStoredProjectionTaskEnvelope(
  envelopeJson: string,
  expectedHash: string
): ProjectionTaskEnvelope {
  const parsed = ProjectionTaskEnvelopeSchema.safeParse(parseJson(envelopeJson));
  const hash = HashSchema.safeParse(expectedHash);
  if (!parsed.success || !hash.success) throw new ReviewDataError("REVIEW_DATA_INVALID");
  verifyProjectionSnapshot(parsed.data.snapshot);
  const canonicalEnvelope = canonicalJson(parsed.data);
  requireEqual(envelopeJson, canonicalEnvelope);
  requireEqual(hash.data, sha256(canonicalEnvelope));
  return parsed.data;
}

export function parseAdminReviewDto(
  name: keyof typeof ADMIN_REVIEW_DTO_SCHEMAS,
  value: unknown
): unknown {
  const schema = ADMIN_REVIEW_DTO_SCHEMAS[name];
  const result = schema.safeParse(value);
  if (!result.success) throw new ReviewDataError("REVIEW_DATA_INVALID");
  return result.data;
}
