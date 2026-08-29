import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import { ReviewRealError } from "../review-real/error.ts";
import {
  prepareApproveMutation,
  preparePublishMutation,
  prepareRejectMutation,
  prepareReleaseNowMutation,
  prepareRevisionMutation
} from "../review-real/backend.ts";
import type { ReviewAdminRouteResult, ReviewAdminRoutes } from "../review-real/routes.ts";
import { ReviewAdminSecurity, type ReviewMutationBinding } from "../review-real/security.ts";
import { singleRawHeader, type RawAdminContext } from "../source-management/security.ts";
import { assertBilingualSchema } from "../rss/bilingual-migration.ts";
import {
  assertSourceRegistrySchema,
  verifyAuthorityActivationReceipt
} from "../rss/source-registry-migration.ts";
import { readSourceDetail, readSourceList, X_AUTOMATION_ZERO } from "../rss/source-registry.ts";
import type { QuickLaunchAuthorityPort, SourceRegistryAuthorityPort } from "../internal-operation/mutation-port.ts";
import { bilingualSafetyResourceHash, type BilingualApprovalReceipt, type BilingualSafetyAuthorization, type BilingualSafetyDecisionInput, type BilingualSafetyDecisionReceipt } from "../internal-operation/gateway.ts";
import type { BilingualPublicationReceipt } from "./bilingual-projection-writer.ts";

export const ADMIN_BILINGUAL_SCHEMA = "admin-bilingual-v1" as const;
export const BILINGUAL_AUTHORITY_REASON = "AUTHORITY_EXTENSION_REQUIRED" as const;
export const BILINGUAL_MANUAL_SUBSTRATE_REASON = "BILINGUAL_MANUAL_SUBSTRATE_UNAVAILABLE" as const;
export const BILINGUAL_DISPOSABLE_BACKFILL_REASON = "DISPOSABLE_BACKFILL_GATE_REQUIRED" as const;
export const BILINGUAL_MIGRATION_EXTENSION_REASON = "MIGRATION_EXTENSION_REQUIRED" as const;

const IdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const MutationSchema = z.object({
  schemaVersion: z.literal(ADMIN_BILINGUAL_SCHEMA),
  action: z.enum(["retry", "rerun", "review", "approve", "reject", "publish", "correct", "withdraw", "backfill-recent-three"]),
  candidateId: IdSchema.optional(),
  publicationId: IdSchema.optional(),
  replacementBundleId: IdSchema.optional(),
  replacementApprovalId: IdSchema.optional(),
  sourceId: IdSchema.optional(),
  inputContentHash: HashSchema.optional(),
  language: z.enum(["zh-CN", "en", "both"]).optional(),
  safetyAction: z.enum(["clear", "block", "withdraw", "expire"]).optional(),
  blockReason: z.enum(["COPY_RISK", "RIGHTS_BLOCKED", "DELETION_BLOCKED", "MEDIA_BLOCKED"]).optional(),
  mediaClearance: z.enum(["none", "allowed"]).optional(),
  expiresAt: z.string().datetime({ offset: false }).optional(),
  expectedDecisionSeq: z.number().int().min(1).max(2_147_483_647).optional(),
  supersedesDecisionId: IdSchema.nullable().optional(),
  expectedRevision: z.number().int().min(0).max(2_147_483_647),
  idempotencyKey: IdSchema,
  clientRequestId: IdSchema,
  requestHash: HashSchema
}).strict().superRefine((mutation, context) => {
  const candidateAction = ["retry", "rerun", "review", "approve", "reject", "publish"].includes(mutation.action);
  const publicationAction = mutation.action === "correct" || mutation.action === "withdraw";
  if (candidateAction && mutation.candidateId === undefined) context.addIssue({ code: "custom", message: "candidateId required", path: ["candidateId"] });
  if (!candidateAction && mutation.candidateId !== undefined) context.addIssue({ code: "custom", message: "candidateId forbidden", path: ["candidateId"] });
  if (publicationAction && mutation.publicationId === undefined) context.addIssue({ code: "custom", message: "publicationId required", path: ["publicationId"] });
  if (!publicationAction && mutation.publicationId !== undefined) context.addIssue({ code: "custom", message: "publicationId forbidden", path: ["publicationId"] });
  if ((mutation.action === "retry" || mutation.action === "rerun") && mutation.language !== "zh-CN" && mutation.language !== "en") {
    context.addIssue({ code: "custom", message: "retry/rerun requires one exact language", path: ["language"] });
  }
  if (!["retry", "rerun"].includes(mutation.action) && mutation.language !== undefined) {
    context.addIssue({ code: "custom", message: "language forbidden for action", path: ["language"] });
  }
  if (mutation.action === "correct" && (mutation.replacementBundleId === undefined || mutation.replacementApprovalId === undefined)) {
    context.addIssue({ code: "custom", message: "whole-bundle correction requires replacement bundle and approval", path: ["replacementBundleId"] });
  }
  if (mutation.action !== "correct" && (mutation.replacementBundleId !== undefined || mutation.replacementApprovalId !== undefined)) {
    context.addIssue({ code: "custom", message: "replacement binding forbidden", path: ["replacementBundleId"] });
  }
  const safetyFields = [mutation.sourceId, mutation.inputContentHash, mutation.safetyAction, mutation.expectedDecisionSeq, mutation.supersedesDecisionId];
  if (mutation.action === "review") {
    if (safetyFields.some((value) => value === undefined)) context.addIssue({ code: "custom", message: "review safety binding required", path: ["safetyAction"] });
    if (mutation.safetyAction === "block" && mutation.blockReason === undefined) context.addIssue({ code: "custom", message: "blockReason required", path: ["blockReason"] });
    if (mutation.safetyAction === "clear" && (mutation.mediaClearance === undefined || mutation.expiresAt === undefined)) context.addIssue({ code: "custom", message: "clearance and expiry required", path: ["expiresAt"] });
  } else if (safetyFields.some((value) => value !== undefined) || mutation.blockReason !== undefined || mutation.mediaClearance !== undefined || mutation.expiresAt !== undefined) {
    context.addIssue({ code: "custom", message: "safety fields forbidden", path: ["safetyAction"] });
  }
});

const CsrfSchema = z.object({
  schemaVersion: z.literal(ADMIN_BILINGUAL_SCHEMA),
  mutation: z.union([MutationSchema, z.lazy(() => AuthorityMutationSchema), z.lazy(() => SourceRegistryMutationSchema)])
}).strict();

export type BilingualMutation = z.infer<typeof MutationSchema>;

export const AuthorityMutationSchema = z.object({
  schemaVersion: z.literal("admin-authority-v2"),
  action: z.enum(["enable", "close"]),
  capabilityId: z.enum(["bilingual_auto_refine", "bilingual_manual_mutation", "source_registry_management"]),
  expectedVersion: z.number().int().min(1).max(2_147_483_647),
  idempotencyKey: IdSchema,
  clientRequestId: IdSchema,
  requestHash: HashSchema,
  authorityReceiptSha256: HashSchema
}).strict();

export type AuthorityMutation = z.infer<typeof AuthorityMutationSchema>;

export const SourceRegistryMutationSchema = z.object({
  schemaVersion: z.literal("admin-source-registry-v1"),
  action: z.enum(["disable", "requeue", "enable", "retire"]),
  sourceId: IdSchema,
  expectedRevision: z.number().int().min(1).max(2_147_483_647),
  reasonCode: z.enum(["OPERATOR_REQUEST", "POLICY_CHANGE", "CREDENTIAL_ROTATION", "INCIDENT", "RETIREMENT"]),
  idempotencyKey: IdSchema,
  clientRequestId: IdSchema,
  requestHash: HashSchema
}).strict();

export type SourceRegistryMutation = z.infer<typeof SourceRegistryMutationSchema>;

export function prepareSourceRegistryMutation(value: unknown): Readonly<{ mutation: SourceRegistryMutation; binding: ReviewMutationBinding }> {
  const parsed = SourceRegistryMutationSchema.safeParse(value);
  if (!parsed.success) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  const mutation = parsed.data;
  const path = `/api/admin/sources/${encodeURIComponent(mutation.sourceId)}/${mutation.action}`;
  const { requestHash: _requestHash, ...unsigned } = mutation;
  if (mutation.requestHash !== sha256(canonicalJson({ method: "POST", canonicalPath: path, body: unsigned }))) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  const operationId = `source_${sha256(`${mutation.action}\n${mutation.idempotencyKey}`).slice(0, 32)}`;
  const base = { method: "POST" as const, path, operationId, bodyHash: sha256(canonicalJson(mutation)) };
  return Object.freeze({ mutation, binding: mutation.action === "retire" ? Object.freeze({ ...base, freshAction: "SOURCE_RETIRE" as const, resourceHash: sha256(canonicalJson({ sourceId: mutation.sourceId, expectedRevision: mutation.expectedRevision })) }) : Object.freeze(base) });
}

export function prepareAuthorityMutation(value: unknown): Readonly<{
  mutation: AuthorityMutation;
  binding: ReviewMutationBinding & Readonly<{ freshAction: "AUTHORITY_ACTIVATE"; resourceHash: string }>;
}> {
  const parsed = AuthorityMutationSchema.safeParse(value);
  if (!parsed.success) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  const mutation = parsed.data;
  const path = `/api/admin/authority/${mutation.capabilityId}/${mutation.action}`;
  const { requestHash: _requestHash, authorityReceiptSha256: _receipt, ...unsigned } = mutation;
  const expected = sha256(canonicalJson({ method: "POST", canonicalPath: path, body: unsigned }));
  if (mutation.requestHash !== expected) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  const opId = `authority_${sha256(`${mutation.capabilityId}\n${mutation.action}\n${mutation.idempotencyKey}`).slice(0, 32)}`;
  return Object.freeze({
    mutation,
    binding: Object.freeze({
      method: "POST",
      path,
      operationId: opId,
      bodyHash: sha256(canonicalJson(mutation)),
      freshAction: "AUTHORITY_ACTIVATE",
      resourceHash: sha256(canonicalJson({ capabilityId: mutation.capabilityId, action: mutation.action, expectedVersion: mutation.expectedVersion }))
    })
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function mutationPath(mutation: BilingualMutation): string {
  if (mutation.action === "backfill-recent-three") return "/api/admin/bilingual/recent-three/backfill";
  if (mutation.action === "correct" || mutation.action === "withdraw") {
    if (!mutation.publicationId) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    return `/api/admin/bilingual/publications/${encodeURIComponent(mutation.publicationId)}/${mutation.action}`;
  }
  if (!mutation.candidateId) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  return `/api/admin/bilingual/reviews/${encodeURIComponent(mutation.candidateId)}/${mutation.action}`;
}

function operationId(mutation: BilingualMutation): string {
  return `bilingual_${sha256(`${mutation.action}\n${mutation.idempotencyKey}`).slice(0, 32)}`;
}

function requestHash(mutation: BilingualMutation): string {
  const { requestHash: _ignored, ...withoutRequestHash } = mutation;
  return sha256(canonicalJson({ method: "POST", canonicalPath: mutationPath(mutation), body: withoutRequestHash }));
}

function binding(mutation: BilingualMutation): ReviewMutationBinding {
  const base = {
    method: "POST" as const,
    path: mutationPath(mutation),
    operationId: operationId(mutation),
    bodyHash: sha256(canonicalJson(mutation))
  };
  if (mutation.action === "correct" || mutation.action === "withdraw") {
    return Object.freeze({
      ...base,
      freshAction: mutation.action === "correct" ? "BILINGUAL_CORRECT" as const : "BILINGUAL_WITHDRAW" as const,
      resourceHash: sha256(canonicalJson({
        publicationId: mutation.publicationId,
        expectedRevision: mutation.expectedRevision,
        replacementBundleId: mutation.replacementBundleId ?? null,
        replacementApprovalId: mutation.replacementApprovalId ?? null,
        correctionScope: "whole-bilingual-bundle"
      }))
    });
  }
  if (mutation.action === "review") {
    const safetyInput = safetyDecisionInput(mutation);
    return Object.freeze({ ...base, freshAction: "BILINGUAL_SAFETY_REVIEW" as const, resourceHash: bilingualSafetyResourceHash(safetyInput) });
  }
  return Object.freeze(base);
}

function safetyDecisionInput(mutation: BilingualMutation): BilingualSafetyDecisionInput {
  if (mutation.action !== "review" || !mutation.candidateId || !mutation.sourceId || !mutation.inputContentHash || !mutation.safetyAction || mutation.expectedDecisionSeq === undefined || mutation.supersedesDecisionId === undefined) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  return Object.freeze({
    candidateId: mutation.candidateId, sourceId: mutation.sourceId, sourceRevision: mutation.expectedRevision,
    inputContentHash: mutation.inputContentHash, action: mutation.safetyAction, blockReason: mutation.blockReason,
    mediaClearance: mutation.mediaClearance, expiresAt: mutation.expiresAt,
    expectedDecisionSeq: mutation.expectedDecisionSeq, supersedesDecisionId: mutation.supersedesDecisionId,
  });
}

export type BilingualManualMutationPort = Readonly<{
  commitSafetyDecision(authorization: BilingualSafetyAuthorization, input: BilingualSafetyDecisionInput): Readonly<{ receipt: BilingualSafetyDecisionReceipt; bundle: Readonly<{ bundleId: string; bundleHash: string; revision: number }> | null }>;
  commitApproval(authorization: Readonly<{ actorRef: string; sessionDigest: string; csrfDigest: string; operationId: string; bodyHash: string }>, input: Readonly<{ candidateId: string; expectedBundleRevision: number; decision: "approved" | "rejected" }>): BilingualApprovalReceipt;
  retryLanguage?(authorization: Readonly<{ actorRef: string; sessionDigest: string; csrfDigest: string; operationId: string; bodyHash: string }>, input: Readonly<{ candidateId: string; language: "zh-CN" | "en"; expectedRevision: number; action: "retry" | "rerun" }>): Promise<Readonly<{ status: string; externalCalls: number; writesToBase: boolean }>>;
  publish?(authorization: Readonly<{ actorRef: string; sessionDigest: string; csrfDigest: string; operationId: string; bodyHash: string; idempotencyKey: string }>, input: Readonly<{ candidateId: string; expectedBundleRevision: number }>): BilingualPublicationReceipt;
  withdraw?(authorization: Readonly<{ actorRef: string; sessionDigest: string; csrfDigest: string; freshDigest: string; freshVerifiedAt: string; resourceHash: string; operationId: string; bodyHash: string; idempotencyKey: string }>, input: Readonly<{ publicationId: string; expectedRevision: number }>): BilingualPublicationReceipt;
}>;

function parseMutation(value: unknown): BilingualMutation {
  const parsed = MutationSchema.safeParse(value);
  if (!parsed.success) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  const mutation = parsed.data;
  if (mutation.requestHash !== requestHash(mutation)) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  return mutation;
}

export function prepareBilingualMutation(value: unknown): Readonly<{ mutation: BilingualMutation; binding: ReviewMutationBinding }> {
  const mutation = parseMutation(value);
  return Object.freeze({ mutation, binding: binding(mutation) });
}

type Capability = Readonly<{
  enabled: boolean;
  status: "closed" | "enabled";
  reasonCode: typeof BILINGUAL_AUTHORITY_REASON | "READY" | "AUTHORITY_TRUTH_INVALID";
  extensionSha256: string | null;
  autoRefine?: boolean;
  manualMutation?: boolean;
}>;

const CLOSED_CAPABILITY: Capability = Object.freeze({
  enabled: false,
  status: "closed",
  reasonCode: BILINGUAL_AUTHORITY_REASON,
  extensionSha256: null
});

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export class BilingualAdminRepository {
  private readonly schemaVersion: number;

  constructor(private readonly database: DatabaseSync, private readonly manualWriterReady: () => boolean = () => false) {
    this.schemaVersion = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
    if (this.schemaVersion === 10) assertSourceRegistrySchema(database);
    else assertBilingualSchema(database);
    const row = database.prepare(
      "SELECT enabled, status, reason_code, extension_sha256 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1'"
    ).get() as Record<string, unknown> | undefined;
    if (!row || ![0, 1].includes(Number(row.enabled)) || !["closed", "enabled"].includes(String(row.status))) {
      throw new Error("ADMIN_BILINGUAL_CAPABILITY_DRIFT");
    }
  }

  capability(): Capability {
    if (this.schemaVersion !== 10) return CLOSED_CAPABILITY;
    const rows = this.database.prepare("SELECT capability_id,state,updated_by_operation_id,authority_receipt_sha256 FROM quick_launch_authority_v2 WHERE capability_id IN ('bilingual_auto_refine','bilingual_manual_mutation') ORDER BY capability_id").all() as Array<Record<string, unknown>>;
    const truth = (capabilityId: "bilingual_auto_refine" | "bilingual_manual_mutation"): boolean => {
      const row = rows.find((candidate) => candidate.capability_id === capabilityId);
      if (!row || row.state !== "enabled" || typeof row.updated_by_operation_id !== "string" || typeof row.authority_receipt_sha256 !== "string") return false;
      return verifyAuthorityActivationReceipt(this.database, {
        capabilityId,
        operationId: row.updated_by_operation_id,
        receiptSha256: row.authority_receipt_sha256
      }).valid;
    };
    const autoRefine = truth("bilingual_auto_refine");
    const manualMutation = truth("bilingual_manual_mutation");
    const v1 = this.database.prepare("SELECT enabled,status,reason_code,extension_sha256 FROM bilingual_authority_capability_v1 WHERE capability_id='bilingual-v1'").get() as Record<string, unknown>;
    const enabled = autoRefine && manualMutation && v1.enabled === 1 && v1.status === "enabled" && v1.reason_code === "READY";
    return Object.freeze({
      enabled,
      status: enabled ? "enabled" : "closed",
      reasonCode: enabled ? "READY" : rows.some((row) => row.state === "enabled") ? "AUTHORITY_TRUTH_INVALID" : BILINGUAL_AUTHORITY_REASON,
      extensionSha256: enabled && typeof v1.extension_sha256 === "string" ? v1.extension_sha256 : null,
      autoRefine,
      manualMutation
    });
  }

  list(): Readonly<Record<string, unknown>> {
    const capability = this.capability();
    const writable = capability.enabled && this.manualWriterReady();
    const rows = this.database.prepare(`
      SELECT c.candidate_id, c.source_id, c.source_revision, c.title, c.published_at, c.review_status,
             l.public_id, l.copy_risk_status, l.rights_status, l.deletion_status, l.media_status,
             zh.state AS zh_state, en.state AS en_state,
             (SELECT max(revision) FROM bilingual_bundle_v1 b WHERE b.candidate_id = c.candidate_id) AS bundle_revision
      FROM pending_review_candidate c
      LEFT JOIN bilingual_candidate_lineage_v1 l ON l.candidate_id = c.candidate_id
      LEFT JOIN bilingual_language_slot_v1 zh ON zh.candidate_id = c.candidate_id AND zh.language = 'zh-CN'
      LEFT JOIN bilingual_language_slot_v1 en ON en.candidate_id = c.candidate_id AND en.language = 'en'
      ORDER BY c.published_at DESC, c.candidate_id ASC
      LIMIT 100
    `).all() as Array<Record<string, unknown>>;
    return Object.freeze({
      schemaVersion: ADMIN_BILINGUAL_SCHEMA,
      mode: this.schemaVersion === 10 ? "SCHEMA10_ADMIN" : "INTERIM_READ_ONLY_PASS",
      deployable: false,
      authority: capability,
      automaticReviewRegistrations: 0,
      automaticPublishRegistrations: 0,
      items: rows.map((row) => Object.freeze({
        candidateId: row.candidate_id,
        sourceId: row.source_id,
        sourceRevision: row.source_revision,
        sourceTitle: row.title,
        sourcePublishedAt: row.published_at,
        legacyReviewStatus: row.review_status,
        publicId: row.public_id,
        copyRiskStatus: row.copy_risk_status ?? "unknown",
        rightsStatus: row.rights_status ?? "unknown",
        deletionStatus: row.deletion_status ?? "unknown",
        mediaStatus: row.media_status ?? "unknown",
        languages: { zh: row.zh_state ?? "missing", en: row.en_state ?? "missing" },
        bundleRevision: row.bundle_revision,
        allowedActions: writable ? ["retry", "rerun", "review", "approve", "reject", "publish", "withdraw"] : [],
        deferredActions: ["correct"],
        unavailableReasonCode: writable ? null : capability.enabled ? BILINGUAL_MANUAL_SUBSTRATE_REASON : capability.reasonCode
      }))
    });
  }

  detail(candidateId: string): Readonly<Record<string, unknown>> {
    const capability = this.capability();
    const writable = capability.enabled && this.manualWriterReady();
    const candidate = this.database.prepare(`
      SELECT c.candidate_id, c.source_id, c.source_revision, c.title, c.excerpt, c.author,
             c.canonical_url, c.published_at, c.review_status, l.public_id,
             l.input_content_hash, l.source_fact_set_hash, l.source_release_hash,
             l.copy_risk_status, l.rights_status, l.deletion_status, l.media_status
      FROM pending_review_candidate c
      LEFT JOIN bilingual_candidate_lineage_v1 l ON l.candidate_id = c.candidate_id
      WHERE c.candidate_id = ?
    `).get(candidateId) as Record<string, unknown> | undefined;
    if (!candidate) throw new ReviewRealError("REVIEW_CANDIDATE_NOT_FOUND", 404);
    const slots = this.database.prepare(`
      SELECT s.language, s.revision, s.state, s.failure_reason, s.updated_at, d.output_json,
             d.copy_risk_status AS draft_copy_risk_status, d.rights_status AS draft_rights_status
      FROM bilingual_language_slot_v1 s
      LEFT JOIN bilingual_language_slot_draft_v1 d ON d.draft_id = (
        SELECT d2.draft_id FROM bilingual_language_slot_draft_v1 d2
        WHERE d2.slot_id = s.slot_id ORDER BY d2.slot_revision DESC, d2.created_at DESC LIMIT 1
      )
      WHERE s.candidate_id = ? ORDER BY s.language
    `).all(candidateId) as Array<Record<string, unknown>>;
    const bundle = this.database.prepare(
      "SELECT bundle_id, revision, state, bundle_hash, payload_json, created_at FROM bilingual_bundle_v1 WHERE candidate_id = ? ORDER BY revision DESC LIMIT 1"
    ).get(candidateId) as Record<string, unknown> | undefined;
    const publication = typeof candidate.public_id === "string" ? this.database.prepare(
      "SELECT publication_id, revision, change_kind, status, reason_code, published_at, updated_at FROM bilingual_publication_v1 WHERE public_id = ? ORDER BY revision DESC LIMIT 1"
    ).get(candidate.public_id) as Record<string, unknown> | undefined : undefined;
    const language = (tag: "zh-CN" | "en") => {
      const slot = slots.find((item) => item.language === tag);
      return slot ? Object.freeze({
        language: tag,
        revision: slot.revision,
        state: slot.state,
        failureReason: slot.failure_reason,
        updatedAt: slot.updated_at,
        draft: parseJsonObject(slot.output_json),
        copyRiskStatus: slot.draft_copy_risk_status,
        rightsStatus: slot.draft_rights_status
      }) : Object.freeze({ language: tag, revision: 0, state: "missing", draft: null });
    };
    return Object.freeze({
      schemaVersion: ADMIN_BILINGUAL_SCHEMA,
      mode: this.schemaVersion === 10 ? "SCHEMA10_ADMIN" : "INTERIM_READ_ONLY_PASS",
      deployable: false,
      authority: capability,
      candidateId: candidate.candidate_id,
      publicId: candidate.public_id,
      sourceId: candidate.source_id,
      sourceRevision: candidate.source_revision,
      sourceTitle: candidate.title,
      sourceAuthor: candidate.author,
      sourcePublishedAt: candidate.published_at,
      originalUrl: candidate.canonical_url,
      sourceText: {
        scope: "private_excerpt",
        excerpt: candidate.excerpt,
        fullSourceBodyExposed: false,
        redistributionAllowed: false
      },
      rights: {
        copyRiskStatus: candidate.copy_risk_status ?? "unknown",
        rightsStatus: candidate.rights_status ?? "unknown",
        deletionStatus: candidate.deletion_status ?? "unknown",
        mediaStatus: candidate.media_status ?? "unknown"
      },
      lineage: candidate.public_id === null ? null : {
        inputContentHash: candidate.input_content_hash,
        sourceFactSetHash: candidate.source_fact_set_hash,
        sourceReleaseHash: candidate.source_release_hash
      },
      languages: { zh: language("zh-CN"), en: language("en") },
      latestBundle: bundle ? { ...bundle, payload: parseJsonObject(bundle.payload_json), payload_json: undefined } : null,
      latestPublication: publication ?? null,
      allowedActions: writable ? ["retry", "rerun", "review", "approve", "reject", "publish", "withdraw"] : [],
      unavailableActions: writable ? [] : ["retry", "rerun", "review", "approve", "reject", "publish", "withdraw"],
      deferredActions: ["correct"],
      unavailableReasonCode: writable ? null : capability.enabled ? BILINGUAL_MANUAL_SUBSTRATE_REASON : capability.reasonCode
    });
  }

  recentThree(): Readonly<Record<string, unknown>> {
    const rows = this.database.prepare(`
      SELECT p.public_id, c.candidate_id, c.title AS source_title, c.canonical_url, c.published_at
      FROM publication p JOIN review_bundle b ON b.bundle_id = p.bundle_id
      JOIN pending_review_candidate c ON c.candidate_id = b.candidate_id
      WHERE p.publication_status = 'published'
      ORDER BY p.published_at DESC, p.public_id ASC LIMIT 3
    `).all() as Array<Record<string, unknown>>;
    return Object.freeze({
      schemaVersion: ADMIN_BILINGUAL_SCHEMA,
      mode: "read-only-preview",
      authority: this.capability(),
      exactCount: rows.length,
      items: rows,
      disposableBackfill: { enabled: false, destination: "disposable-only", reasonCode: BILINGUAL_DISPOSABLE_BACKFILL_REASON }
    });
  }

  sources(): Readonly<Record<string, unknown>> {
    if (this.schemaVersion !== 10) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    const items = readSourceList(this.database, { limit: 100 });
    return Object.freeze({
      schemaVersion: "admin-source-registry-v1",
      authority: this.sourceAuthority(),
      rssActive: items.filter((item) => item.sourceKind === "rss" && item.enabled).length,
      xManualDisabled: items.filter((item) => item.sourceKind === "x_manual" && !item.enabled).length,
      xAutomation: X_AUTOMATION_ZERO,
      items
    });
  }

  sourceManagementCapability(): Readonly<Record<string, unknown>> {
    return this.sourceAuthority();
  }

  sourceDetail(sourceId: string): Readonly<Record<string, unknown>> {
    if (this.schemaVersion !== 10) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    return Object.freeze({ schemaVersion: "admin-source-registry-v1", authority: this.sourceAuthority(), ...readSourceDetail(this.database, sourceId, new Date().toISOString()) });
  }

  operationsOverview(): Readonly<Record<string, unknown>> {
    if (this.schemaVersion !== 10) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    const scalar = (sql: string): number => Number((this.database.prepare(sql).get() as Record<string, unknown>).count);
    const control = this.database.prepare("SELECT phase,global_stop_state,emergency_stop_state,recovery_state,writer_epoch,version FROM internal_control WHERE singleton_id=1").get();
    const sourceStatusCounts = this.database.prepare(`
      SELECT source_kind AS kind,lifecycle_status AS lifecycle_status,enabled,
             collection_onboarding_status AS onboarding_status,count(*) AS count
      FROM source_registry_v1
      GROUP BY source_kind,lifecycle_status,enabled,collection_onboarding_status
      ORDER BY source_kind,lifecycle_status,collection_onboarding_status
    `).all();
    const recentAuditEvents = this.database.prepare(`
      SELECT a.audit_seq,a.operation_id,a.event_type,a.actor_ref,a.created_at,
             o.operation_kind,o.state AS operation_state
      FROM internal_operation_audit a JOIN internal_operation o ON o.operation_id=a.operation_id
      ORDER BY a.audit_seq DESC LIMIT 20
    `).all();
    const recentFailedOperations = this.database.prepare(`
      SELECT operation_id,operation_kind,owner_process,state,reason_code,phase,attempt,created_at,updated_at
      FROM internal_operation
      WHERE state IN ('terminal_failed','cancelled')
      ORDER BY updated_at DESC,operation_id ASC LIMIT 20
    `).all();
    const sourceAuthority = this.sourceAuthority();
    const phase = (control as Record<string, unknown> | undefined)?.phase;
    return Object.freeze({
      schemaVersion: "admin-operations-overview-v1",
      generatedAt: new Date().toISOString(),
      processUptimeSeconds: Math.floor(process.uptime()),
      control,
      authority: this.database.prepare("SELECT capability_id,state,version,updated_at FROM quick_launch_authority_v2 ORDER BY capability_id").all(),
      sources: {
        total: scalar("SELECT count(*) AS count FROM source_registry_v1"),
        rssActive: scalar("SELECT count(*) AS count FROM source_registry_v1 WHERE source_kind='rss' AND enabled=1"),
        xManualDisabled: scalar("SELECT count(*) AS count FROM source_registry_v1 WHERE source_kind='x_manual' AND enabled=0"),
        byKind: this.database.prepare("SELECT source_kind AS name,count(*) AS count FROM source_registry_v1 GROUP BY source_kind ORDER BY source_kind").all(),
        byLifecycle: this.database.prepare("SELECT lifecycle_status AS name,count(*) AS count FROM source_registry_v1 GROUP BY lifecycle_status ORDER BY lifecycle_status").all(),
        statusCounts: sourceStatusCounts
      },
      operations: {
        active: scalar("SELECT count(*) AS count FROM internal_operation WHERE state NOT IN ('succeeded','terminal_failed','cancelled')"),
        failed: scalar("SELECT count(*) AS count FROM internal_operation WHERE state IN ('terminal_failed','cancelled')"),
        auditEvents: scalar("SELECT count(*) AS count FROM internal_operation_audit")
      },
      collection: {
        outboxPending: scalar("SELECT count(*) AS count FROM source_registry_outbox_v1 WHERE state='pending'"),
        outboxFailed: scalar("SELECT count(*) AS count FROM source_registry_outbox_v1 WHERE state='failed'"),
        outboxLeased: scalar("SELECT count(*) AS count FROM source_registry_outbox_v1 WHERE state='leased'"),
        outboxCancelled: scalar("SELECT count(*) AS count FROM source_registry_outbox_v1 WHERE state='cancelled'"),
        automaticReviewRegistrations: 0,
        automaticPublishRegistrations: 0
      },
      recentAuditEvents,
      recentFailedOperations,
      observability: {
        health: {
          frontend: { status: "unavailable", reasonCode: "PRODUCER_NOT_CONFIGURED" },
          backend: { status: "available" },
          adminApi: { status: "available" }
        },
        apis: {
          dbBackend: { status: "available" },
          adminApi: { status: "available" },
          operationsRead: { status: "available" },
          sourceRead: { status: "available" },
          bilingualRead: { status: "available" },
          bilingualManualWrite: { status: this.manualWriterReady() ? "available" : "unavailable", reasonCode: this.manualWriterReady() ? null : BILINGUAL_MANUAL_SUBSTRATE_REASON },
          sourceManagementWrite: {
            status: sourceAuthority.enabled === true && phase === "paused" ? "gated_by_fresh_reauth" : "unavailable",
            reasonCode: sourceAuthority.enabled === true ? (phase === "paused" ? null : "PHASE_NOT_PAUSED") : (sourceAuthority.reasonCode ?? BILINGUAL_AUTHORITY_REASON)
          }
        },
        sourceManagement: { status: sourceAuthority.enabled === true ? "authority_ready" : "closed", writesRequirePausedPhase: true },
        logs: { source: "internal_operation_audit", events: scalar("SELECT count(*) AS count FROM internal_operation_audit"), recent: recentAuditEvents },
        errors: {
          internalOperations: scalar("SELECT count(*) AS count FROM internal_operation WHERE state IN ('terminal_failed','cancelled')"),
          sourceOutboxFailed: scalar("SELECT count(*) AS count FROM source_registry_outbox_v1 WHERE state='failed'")
        }
      },
      producers: {
        frontendHealth: { status: "unavailable", reasonCode: "PRODUCER_NOT_CONFIGURED" },
        backendHealth: { status: "available" },
        adminApiHealth: { status: "available" },
        trafficStats: { status: "unavailable", reasonCode: "PRODUCER_NOT_CONFIGURED" },
        costTelemetry: { status: "unavailable", reasonCode: "PRODUCER_NOT_CONFIGURED" },
        backups: { status: "unavailable", reasonCode: "PRODUCER_NOT_CONFIGURED" },
        releaseHistory: { status: "unavailable", reasonCode: "PRODUCER_NOT_CONFIGURED" }
      }
    });
  }

  private sourceAuthority(): Readonly<Record<string, unknown>> {
    if (this.schemaVersion !== 10) return CLOSED_CAPABILITY;
    const row = this.database.prepare("SELECT state,version,updated_by_operation_id,authority_receipt_sha256 FROM quick_launch_authority_v2 WHERE capability_id='source_registry_management'").get() as Record<string, unknown>;
    const valid = row?.state === "enabled" && typeof row.updated_by_operation_id === "string" && typeof row.authority_receipt_sha256 === "string" && verifyAuthorityActivationReceipt(this.database, { capabilityId: "source_registry_management", operationId: row.updated_by_operation_id, receiptSha256: row.authority_receipt_sha256 }).valid;
    return Object.freeze({ enabled: valid, status: valid ? "enabled" : "closed", version: row?.version, reasonCode: valid ? "READY" : row?.state === "enabled" ? "AUTHORITY_TRUTH_INVALID" : BILINGUAL_AUTHORITY_REASON });
  }
}

export class BilingualAdminRoutes {
  constructor(
    private readonly repository: BilingualAdminRepository,
    private readonly security: ReviewAdminSecurity,
    private readonly authorityPort?: QuickLaunchAuthorityPort & SourceRegistryAuthorityPort,
    private readonly manualPort?: BilingualManualMutationPort,
  ) {}

  async tryHandleAsync(context: RawAdminContext, value?: unknown): Promise<ReviewAdminRouteResult | null> {
    if (context.method !== "POST" || !/^\/api\/admin\/bilingual\/reviews\/[^/]+\/(retry|rerun)$/u.test(context.path)) return null;
    const mutation = parseMutation(value);
    if (mutation.action !== "retry" && mutation.action !== "rerun") return null;
    if (mutationPath(mutation) !== context.path || singleRawHeader(context, "idempotency-key") !== mutation.idempotencyKey) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    if (!this.manualPort?.retryLanguage || !mutation.candidateId || (mutation.language !== "zh-CN" && mutation.language !== "en")) return null;
    const authorization = this.security.authorizeMutation(context, binding(mutation));
    const result = await this.manualPort.retryLanguage({ actorRef: authorization.actorRef, sessionDigest: authorization.sessionDigest, csrfDigest: authorization.csrfDigest, operationId: authorization.operationId, bodyHash: authorization.bodyHash }, { candidateId: mutation.candidateId, language: mutation.language, expectedRevision: mutation.expectedRevision, action: mutation.action });
    this.security.commitMutation(authorization);
    return { status: 200, body: { schemaVersion: ADMIN_BILINGUAL_SCHEMA, operationId: authorization.operationId, ...result, automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 } };
  }

  tryHandle(context: RawAdminContext, value?: unknown): ReviewAdminRouteResult | null {
    if (context.method === "GET" && context.path === "/api/admin/bilingual/reviews") {
      return { status: 200, body: this.repository.list() };
    }
    if (context.method === "GET" && context.path === "/api/admin/bilingual/recent-three") {
      return { status: 200, body: this.repository.recentThree() };
    }
    if (context.method === "GET" && context.path === "/api/admin/sources") return { status: 200, body: this.repository.sources() };
    if (context.method === "GET" && context.path === "/api/admin/operations/overview") return { status: 200, body: this.repository.operationsOverview() };
    const sourceDetail = /^\/api\/admin\/sources\/([^/]+)$/u.exec(context.path);
    if (context.method === "GET" && sourceDetail) return { status: 200, body: this.repository.sourceDetail(decodeURIComponent(sourceDetail[1])) };
    const detail = /^\/api\/admin\/bilingual\/reviews\/([^/]+)$/.exec(context.path);
    if (context.method === "GET" && detail) return { status: 200, body: this.repository.detail(decodeURIComponent(detail[1])) };
    if (context.method === "POST" && context.path === "/api/admin/csrf") {
      const parsed = CsrfSchema.safeParse(value);
      if (!parsed.success) return null;
      const preparedAuthority = AuthorityMutationSchema.safeParse(parsed.data.mutation);
      const preparedSource = SourceRegistryMutationSchema.safeParse(parsed.data.mutation);
      const prepared = preparedAuthority.success
        ? prepareAuthorityMutation(preparedAuthority.data)
        : preparedSource.success
          ? prepareSourceRegistryMutation(preparedSource.data)
          : { mutation: parseMutation(parsed.data.mutation), binding: binding(parseMutation(parsed.data.mutation)) };
      const token = this.security.issueCsrf(context, prepared.binding);
      return { status: 200, body: { schemaVersion: ADMIN_BILINGUAL_SCHEMA, csrfToken: token, expiresInSeconds: 300 } };
    }
    const authorityMatch = /^\/api\/admin\/authority\/([^/]+)\/(enable|close)$/u.exec(context.path);
    if (context.method === "POST" && authorityMatch) {
      const prepared = prepareAuthorityMutation(value);
      if (prepared.binding.path !== context.path || singleRawHeader(context, "idempotency-key") !== prepared.mutation.idempotencyKey) {
        throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
      }
      const authorization = this.security.authorizeMutation(context, prepared.binding);
      if (!this.authorityPort) {
        this.security.commitMutation(authorization);
        return { status: 503, body: { schemaVersion: "admin-authority-v2", status: "closed", reasonCode: BILINGUAL_AUTHORITY_REASON, writesToBaseDatabase: 0, externalCalls: 0 } };
      }
      const result = this.authorityPort.transitionAuthority({
        operationId: authorization.operationId,
        idempotencyKey: prepared.mutation.idempotencyKey,
        requestHash: prepared.mutation.requestHash,
        authorityReceiptSha256: prepared.mutation.authorityReceiptSha256,
        capabilityId: prepared.mutation.capabilityId,
        action: prepared.mutation.action,
        expectedVersion: prepared.mutation.expectedVersion
      });
      this.security.commitMutation(authorization);
      return { status: 200, body: { schemaVersion: "admin-authority-v2", status: result.state, ...result, authority: this.repository.capability(), automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 } };
    }
    const sourceMutationMatch = /^\/api\/admin\/sources\/([^/]+)\/(disable|requeue|enable|retire)$/u.exec(context.path);
    if (context.method === "POST" && sourceMutationMatch) {
      const prepared = prepareSourceRegistryMutation(value);
      if (prepared.binding.path !== context.path || singleRawHeader(context, "idempotency-key") !== prepared.mutation.idempotencyKey) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
      const authorization = this.security.authorizeMutation(context, prepared.binding);
      const sourceAuthority = this.repository.sourceManagementCapability();
      if (!this.authorityPort || sourceAuthority.enabled !== true) {
        this.security.commitMutation(authorization);
        return { status: 503, body: { schemaVersion: "admin-source-registry-v1", status: "closed", reasonCode: sourceAuthority.reasonCode ?? BILINGUAL_AUTHORITY_REASON, writesToBaseDatabase: 0, externalCalls: 0 } };
      }
      const changes = this.authorityPort.mutateSourceRegistry({ operationId: authorization.operationId, action: prepared.mutation.action, sourceId: prepared.mutation.sourceId, expectedRevision: prepared.mutation.expectedRevision, reasonCode: prepared.mutation.reasonCode });
      this.security.commitMutation(authorization);
      return { status: 200, body: { schemaVersion: "admin-source-registry-v1", status: "succeeded", operationId: authorization.operationId, changes, externalCalls: 0, automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 } };
    }
    if (context.method !== "POST" || !context.path.startsWith("/api/admin/bilingual/")) return null;
    const mutation = parseMutation(value);
    if (mutationPath(mutation) !== context.path || singleRawHeader(context, "idempotency-key") !== mutation.idempotencyKey) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    }
    const authorization = this.security.authorizeMutation(context, binding(mutation));
    if (mutation.action === "review" && this.manualPort && authorization.freshDigest !== null && authorization.freshVerifiedAt !== null) {
      const decisionInput = safetyDecisionInput(mutation);
      const preparedBinding = binding(mutation);
      const result = this.manualPort.commitSafetyDecision({
        actorRef: authorization.actorRef, sessionDigest: authorization.sessionDigest, csrfDigest: authorization.csrfDigest,
        freshDigest: authorization.freshDigest, verifiedAt: authorization.freshVerifiedAt, freshAction: "BILINGUAL_SAFETY_DECISION",
        resourceHash: preparedBinding.resourceHash!, operationId: authorization.operationId, bodyHash: authorization.bodyHash,
      }, decisionInput);
      this.security.commitMutation(authorization);
      return { status: 200, body: { schemaVersion: ADMIN_BILINGUAL_SCHEMA, status: "succeeded", operationId: authorization.operationId, decision: result.receipt, bundle: result.bundle, writesToBaseDatabase: 1, externalCalls: 0, automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 } };
    }
    if ((mutation.action === "approve" || mutation.action === "reject") && this.manualPort && mutation.candidateId) {
      const approval = this.manualPort.commitApproval({
        actorRef: authorization.actorRef,
        sessionDigest: authorization.sessionDigest,
        csrfDigest: authorization.csrfDigest,
        operationId: authorization.operationId,
        bodyHash: authorization.bodyHash,
      }, {
        candidateId: mutation.candidateId,
        expectedBundleRevision: mutation.expectedRevision,
        decision: mutation.action === "approve" ? "approved" : "rejected",
      });
      this.security.commitMutation(authorization);
      return { status: 200, body: { schemaVersion: ADMIN_BILINGUAL_SCHEMA, status: "succeeded", operationId: authorization.operationId, approval, writesToBaseDatabase: 1, externalCalls: 0, automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 } };
    }
    if (mutation.action === "publish" && this.manualPort?.publish && mutation.candidateId) {
      const publication = this.manualPort.publish({ actorRef: authorization.actorRef, sessionDigest: authorization.sessionDigest, csrfDigest: authorization.csrfDigest, operationId: authorization.operationId, bodyHash: authorization.bodyHash, idempotencyKey: mutation.idempotencyKey }, { candidateId: mutation.candidateId, expectedBundleRevision: mutation.expectedRevision });
      this.security.commitMutation(authorization);
      return { status: 200, body: { schemaVersion: ADMIN_BILINGUAL_SCHEMA, status: "succeeded", operationId: authorization.operationId, publication, writesToBaseDatabase: 1, externalCalls: 0, automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 } };
    }
    if (mutation.action === "withdraw" && this.manualPort?.withdraw && mutation.publicationId && authorization.freshDigest !== null && authorization.freshVerifiedAt !== null) {
      const preparedBinding = binding(mutation);
      const publication = this.manualPort.withdraw({ actorRef: authorization.actorRef, sessionDigest: authorization.sessionDigest, csrfDigest: authorization.csrfDigest, freshDigest: authorization.freshDigest, freshVerifiedAt: authorization.freshVerifiedAt, resourceHash: preparedBinding.resourceHash!, operationId: authorization.operationId, bodyHash: authorization.bodyHash, idempotencyKey: mutation.idempotencyKey }, { publicationId: mutation.publicationId, expectedRevision: mutation.expectedRevision });
      this.security.commitMutation(authorization);
      return { status: 200, body: { schemaVersion: ADMIN_BILINGUAL_SCHEMA, status: "succeeded", operationId: authorization.operationId, publication, writesToBaseDatabase: 1, externalCalls: 0, automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 } };
    }
    this.security.commitMutation(authorization);
    const capability = this.repository.capability();
    const reasonCode = mutation.action === "backfill-recent-three"
      ? BILINGUAL_DISPOSABLE_BACKFILL_REASON
      : mutation.action === "correct"
        ? BILINGUAL_MIGRATION_EXTENSION_REASON
      : capability.enabled
        ? BILINGUAL_MANUAL_SUBSTRATE_REASON
        : capability.reasonCode;
    return {
      status: 503,
      body: {
        schemaVersion: ADMIN_BILINGUAL_SCHEMA,
        status: "closed",
        reasonCode,
        operationId: authorization.operationId,
        writesToBaseDatabase: 0,
        externalCalls: 0,
        automaticReviewRegistrations: 0,
        automaticPublishRegistrations: 0,
        deployable: false
      }
    };
  }
}

/**
 * Schema 9 is an interim read-only runtime. Legacy review reads remain
 * available, while every legacy review mutation consumes its already-bound
 * one-time authorization and returns the same closed authority result without
 * reaching a repository write.
 */
export class Schema9ReadOnlyReviewRoutes {
  constructor(
    private readonly fallback: ReviewAdminRoutes,
    private readonly security: ReviewAdminSecurity,
    private readonly writable: () => boolean = () => false
  ) {}

  handle(context: RawAdminContext, value?: unknown): ReviewAdminRouteResult {
    if (context.method !== "POST" || context.path === "/api/admin/csrf") {
      return this.fallback.handle(context, value);
    }
    let prepared: ReturnType<typeof prepareRevisionMutation> | ReturnType<typeof prepareApproveMutation> |
      ReturnType<typeof prepareRejectMutation> | ReturnType<typeof preparePublishMutation> |
      ReturnType<typeof prepareReleaseNowMutation> | null = null;
    if (/^\/api\/admin\/reviews\/[^/]+\/revision$/u.test(context.path)) prepared = prepareRevisionMutation(value);
    else if (/^\/api\/admin\/reviews\/[^/]+\/approve$/u.test(context.path)) prepared = prepareApproveMutation(value);
    else if (/^\/api\/admin\/reviews\/[^/]+\/reject$/u.test(context.path)) prepared = prepareRejectMutation(value);
    else if (/^\/api\/admin\/publications\/[^/]+\/publish$/u.test(context.path)) prepared = preparePublishMutation(value);
    else if (context.path === "/api/admin/reviews/release") prepared = prepareReleaseNowMutation(value);
    if (prepared === null) return this.fallback.handle(context, value);
    if (this.writable()) return this.fallback.handle(context, value);
    const authorization = this.security.authorizeMutation(context, prepared.binding);
    this.security.commitMutation(authorization);
    return {
      status: 503,
      body: {
        schemaVersion: ADMIN_BILINGUAL_SCHEMA,
        status: "closed",
        reasonCode: BILINGUAL_AUTHORITY_REASON,
        operationId: authorization.operationId,
        writesToBaseDatabase: 0,
        externalCalls: 0,
        automaticReviewRegistrations: 0,
        automaticPublishRegistrations: 0,
        deployable: false
      }
    };
  }
}
