import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import { TweetInboxError } from "../tweet-inbox/types.ts";
import { XManualInboxRepository } from "../tweet-inbox/repository.ts";
import { singleRawHeader, type RawAdminContext } from "../source-management/security.ts";
import {
  ReviewAdminBackend,
  prepareApproveMutation,
  preparePublishMutation,
  prepareRejectMutation,
  prepareReleaseNowMutation,
  prepareRevisionMutation
} from "./backend.ts";
import { asReviewRealError, ReviewRealError } from "./error.ts";
import {
  ApproveRequestSchema,
  PublishRequestSchema,
  RejectRequestSchema,
  ReleaseNowRequestSchema,
  RevisionRequestSchema
} from "./schema.ts";
import { ReviewAdminSecurity, type ReviewMutationBinding } from "./security.ts";

const ADMIN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{7,63}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

const XManualMutationMetaSchema = z.object({
  idempotencyKey: z.string().regex(ADMIN_ID_PATTERN),
  expectedRevision: z.number().int().min(0).max(2_147_483_647),
  requestHash: z.string().regex(HASH_PATTERN),
  clientRequestId: z.string().regex(ADMIN_ID_PATTERN)
}).strict();

const XManualSubmitContractSchema = z.object({
  meta: XManualMutationMetaSchema,
  submittedUrl: z.string().url().refine((value) => new URL(value).protocol === "https:")
}).strict();
export const XManualSubmitRequestSchema = XManualSubmitContractSchema;

const XManualRetireContractSchema = z.object({
  submissionId: z.string().regex(/^xsub_[a-z0-9]{8,64}$/),
  meta: XManualMutationMetaSchema,
  reasonCode: z.enum(["OPERATOR_REQUEST", "RETIREMENT"])
}).strict();

/** Full mutation used by the fresh-auth ceremony (the path id is included). */
export const XManualRetireMutationSchema = XManualRetireContractSchema;

export type XManualRetireMutation = z.infer<typeof XManualRetireMutationSchema>;

const XManualSubmitCsrfSchema = z.object({
  schemaVersion: z.literal("admin-review-csrf-v1"),
  operationType: z.literal("x-submit"),
  mutation: XManualSubmitRequestSchema
}).strict();

const XManualRetireCsrfSchema = z.object({
  schemaVersion: z.literal("admin-review-csrf-v1"),
  operationType: z.literal("x-retire"),
  mutation: XManualRetireMutationSchema
}).strict();

const CsrfIssueRequestSchema = z.discriminatedUnion("operationType", [
  z.object({
    schemaVersion: z.literal("admin-review-csrf-v1"),
    operationType: z.literal("revision"),
    mutation: RevisionRequestSchema
  }).strict(),
  z.object({
    schemaVersion: z.literal("admin-review-csrf-v1"),
    operationType: z.literal("approve"),
    mutation: ApproveRequestSchema
  }).strict(),
  z.object({
    schemaVersion: z.literal("admin-review-csrf-v1"),
    operationType: z.literal("reject"),
    mutation: RejectRequestSchema
  }).strict(),
  z.object({
    schemaVersion: z.literal("admin-review-csrf-v1"),
    operationType: z.literal("publish"),
    mutation: PublishRequestSchema
  }).strict(),
  z.object({
    schemaVersion: z.literal("admin-review-csrf-v1"),
    operationType: z.literal("release"),
    mutation: ReleaseNowRequestSchema
  }).strict(),
  XManualSubmitCsrfSchema,
  XManualRetireCsrfSchema
]);

export type ReviewAdminRouteResult = Readonly<{
  status: number;
  body: unknown;
}>;

function routeSegment(path: string, pattern: RegExp): string | null {
  const match = pattern.exec(path);
  if (!match) return null;
  const segment = match[1];
  if (segment.length < 1 || segment.length > 256 || segment.includes("%")) return null;
  return segment;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function bodyHash(value: unknown): string {
  try {
    return sha256(canonicalJson(value));
  } catch {
    throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  }
}

function xOperationId(kind: "submit" | "retire", seed: string): string {
  return `xop_${sha256(`admin-x-${kind}\n${seed}`).slice(0, 32)}`;
}

function xSubmissionId(seed: string): string {
  return `xsub_${sha256(`admin-x-submission\n${seed}`).slice(0, 32)}`;
}

function expectedContractRequestHash(input: Readonly<{
  path: string;
  resourceId: string;
  expectedRevision: number;
  bodyWithoutMeta: unknown;
}>): string {
  return bodyHash({
    method: "POST",
    canonicalPath: input.path,
    resourceId: input.resourceId,
    expectedRevision: input.expectedRevision,
    bodyWithoutMeta: input.bodyWithoutMeta
  });
}

function assertIdempotencyHeader(context: RawAdminContext, idempotencyKey: string): void {
  const header = singleRawHeader(context, "idempotency-key");
  if (header === null || header !== idempotencyKey) {
    throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  }
}

function assertContractHash(actual: string, expected: string): void {
  if (actual !== expected) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
}

type PreparedXSubmit = Readonly<{
  request: z.infer<typeof XManualSubmitRequestSchema>;
  operationId: string;
  submissionId: string;
  idempotencyKey: string;
  binding: ReviewMutationBinding;
}>;

type PreparedXRetire = Readonly<{
  request: XManualRetireMutation;
  operationId: string;
  idempotencyKey: string;
  expectedRevision: number;
  binding: ReviewMutationBinding;
}>;

function preparedXSubmit(value: unknown): PreparedXSubmit {
  const parsed = XManualSubmitRequestSchema.safeParse(value);
  if (!parsed.success) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  const request = parsed.data;
  if (request.meta.expectedRevision !== 0) {
    throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  }
  assertContractHash(
    request.meta.requestHash,
    expectedContractRequestHash({
      path: "/api/admin/x-submissions",
      resourceId: "x-manual-inbox",
      expectedRevision: request.meta.expectedRevision,
      bodyWithoutMeta: { submittedUrl: request.submittedUrl }
    })
  );
  const operationId = xOperationId("submit", request.meta.clientRequestId);
  return {
    request,
    operationId,
    submissionId: xSubmissionId(request.meta.clientRequestId),
    idempotencyKey: request.meta.idempotencyKey,
    binding: {
      method: "POST",
      path: "/api/admin/x-submissions",
      operationId,
      bodyHash: bodyHash(request)
    }
  };
}

export function prepareXManualSubmitMutation(value: unknown): PreparedXSubmit {
  return preparedXSubmit(value);
}

function preparedXRetire(value: unknown): PreparedXRetire {
  const parsed = XManualRetireMutationSchema.safeParse(value);
  if (!parsed.success) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  const request = parsed.data;
  const path = `/api/admin/x-submissions/${encodeURIComponent(request.submissionId)}/retire`;
  assertContractHash(
    request.meta.requestHash,
    expectedContractRequestHash({
      path,
      resourceId: request.submissionId,
      expectedRevision: request.meta.expectedRevision,
      bodyWithoutMeta: { reasonCode: request.reasonCode }
    })
  );
  const operationId = xOperationId("retire", request.meta.clientRequestId);
  return {
    request,
    operationId,
    idempotencyKey: request.meta.idempotencyKey,
    expectedRevision: request.meta.expectedRevision,
    binding: {
      method: "POST",
      path: `/api/admin/x-submissions/${encodeURIComponent(request.submissionId)}/retire`,
      operationId,
      bodyHash: bodyHash(request),
      freshAction: "SOURCE_RETIRE",
      resourceHash: bodyHash({
        submissionId: request.submissionId,
        expectedRevision: request.meta.expectedRevision,
        requestHash: request.meta.requestHash
      })
    }
  };
}

export function prepareXManualRetireMutation(value: unknown): PreparedXRetire {
  return preparedXRetire(value);
}

function mapXManualError(error: unknown): ReviewRealError {
  if (error instanceof ReviewRealError) return error;
  if (error instanceof TweetInboxError) {
    if (error.reasonCode === "X_MANUAL_URL_REJECTED" || error.reasonCode === "URL_REJECTED") {
      return new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    }
    if (error.reasonCode === "SQLITE_FAILURE") return new ReviewRealError("ADMIN_STORAGE_BUSY", 503);
  }
  if (error instanceof Error && error.message === "X_MANUAL_AUTHORITY_REQUIRED") {
    return new ReviewRealError("ADMIN_BACKUP_STALE", 503);
  }
  return asReviewRealError(error);
}

function csrfPrepared(input: z.infer<typeof CsrfIssueRequestSchema>) {
  if (input.operationType === "revision") return prepareRevisionMutation(input.mutation);
  if (input.operationType === "approve") return prepareApproveMutation(input.mutation);
  if (input.operationType === "reject") return prepareRejectMutation(input.mutation);
  if (input.operationType === "release") return prepareReleaseNowMutation(input.mutation);
  if (input.operationType === "x-submit") return preparedXSubmit(input.mutation);
  if (input.operationType === "x-retire") return preparedXRetire(input.mutation);
  return preparePublishMutation(input.mutation);
}

export class ReviewAdminRoutes {
  private readonly backend: ReviewAdminBackend;
  private readonly security: ReviewAdminSecurity | null;
  private readonly xManual: XManualInboxRepository | null;
  private readonly now: () => Date;

  constructor(
    backend: ReviewAdminBackend,
    security: ReviewAdminSecurity | null = null,
    xManual: XManualInboxRepository | null = null,
    now: () => Date = () => new Date()
  ) {
    this.backend = backend;
    this.security = security;
    this.xManual = xManual;
    this.now = now;
  }

  private xRead(): XManualInboxRepository {
    if (this.xManual === null) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    if (this.security === null) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    return this.xManual;
  }

  private xIssueCsrf(context: RawAdminContext, prepared: PreparedXSubmit | PreparedXRetire): string {
    if (this.security === null) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    return this.security.issueCsrf(context, {
      method: prepared.binding.method,
      path: prepared.binding.path,
      operationId: prepared.binding.operationId,
      bodyHash: prepared.binding.bodyHash
    });
  }

  private xSourceList(context: RawAdminContext): ReviewAdminRouteResult {
    const repository = this.xRead();
    if (context.method !== "GET") throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    this.security!.authorizeRead(context);
    const items = repository.listSources();
    return {
      status: 200,
      body: {
        schemaVersion: "admin-x-manual-v1",
        items,
        page: { limit: items.length, nextCursor: null, asOf: this.now().toISOString() }
      }
    };
  }

  private xSourceDetail(context: RawAdminContext, sourceId: string): ReviewAdminRouteResult {
    const repository = this.xRead();
    if (context.method !== "GET") throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    this.security!.authorizeRead(context);
    const source = repository.readSource(sourceId);
    if (source === null) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    return { status: 200, body: { schemaVersion: "admin-x-manual-v1", source } };
  }

  private xSubmissionList(context: RawAdminContext): ReviewAdminRouteResult {
    const repository = this.xRead();
    if (context.method !== "GET") throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    this.security!.authorizeRead(context);
    const items = repository.listSubmissions({ limit: 100 });
    return {
      status: 200,
      body: {
        schemaVersion: "admin-x-manual-v1",
        items,
        page: { limit: items.length, nextCursor: null, asOf: this.now().toISOString() }
      }
    };
  }

  private xSubmissionDetail(context: RawAdminContext, submissionId: string): ReviewAdminRouteResult {
    const repository = this.xRead();
    if (context.method !== "GET") throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    this.security!.authorizeRead(context);
    const submission = repository.readSubmission(submissionId);
    if (submission === null) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    return { status: 200, body: { schemaVersion: "admin-x-manual-v1", submission } };
  }

  private xSubmit(context: RawAdminContext, body: unknown): ReviewAdminRouteResult {
    const repository = this.xRead();
    const prepared = preparedXSubmit(body);
    assertIdempotencyHeader(context, prepared.request.meta.idempotencyKey);
    const authorization = this.security!.authorizeMutation(context, prepared.binding);
    try {
      const submitted = repository.submitManualStatusUrl({
        submittedUrl: prepared.request.submittedUrl,
        nowIso: this.now().toISOString(),
        submissionId: prepared.submissionId,
        operationId: prepared.operationId,
        idempotencyKey: prepared.idempotencyKey
      });
      this.security!.commitMutation(authorization);
      return {
        status: 202,
        body: {
          schemaVersion: "admin-x-manual-v1",
          submission: submitted.submission,
          duplicate: submitted.duplicate,
          externalCalls: 0,
          automaticReview: false,
          automaticPublish: false,
          operationId: prepared.operationId
        }
      };
    } catch (error) {
      throw mapXManualError(error);
    }
  }

  private xRetire(context: RawAdminContext, submissionId: string, body: unknown): ReviewAdminRouteResult {
    const repository = this.xRead();
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.hasOwn(body, "submissionId")) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    }
    const prepared = preparedXRetire({ ...(body as Record<string, unknown>), submissionId });
    assertIdempotencyHeader(context, prepared.request.meta.idempotencyKey);
    const authorization = this.security!.authorizeMutation(context, prepared.binding);
    try {
      const retired = repository.retireManualStatus({
        submissionId,
        expectedRevision: prepared.expectedRevision,
        nowIso: this.now().toISOString(),
        operationId: prepared.operationId,
        idempotencyKey: prepared.idempotencyKey
      });
      this.security!.commitMutation(authorization);
      return {
        status: 202,
        body: {
          schemaVersion: "admin-x-manual-v1",
          submission: retired,
          operationId: prepared.operationId,
          reasonCode: "OK"
        }
      };
    } catch (error) {
      throw mapXManualError(error);
    }
  }

  handle(context: RawAdminContext, body?: unknown): ReviewAdminRouteResult {
    try {
      if (context.method === "GET" && context.path === "/api/admin/sources") {
        return this.xSourceList(context);
      }
      const sourceId = routeSegment(context.path, /^\/api\/admin\/sources\/([^/]+)$/);
      if (context.method === "GET" && sourceId !== null) {
        return this.xSourceDetail(context, sourceId);
      }
      if (context.method === "GET" && context.path === "/api/admin/x-submissions") {
        return this.xSubmissionList(context);
      }
      const submissionId = routeSegment(context.path, /^\/api\/admin\/x-submissions\/([^/]+)$/);
      if (context.method === "GET" && submissionId !== null) {
        return this.xSubmissionDetail(context, submissionId);
      }
      if (context.method === "GET" && context.path === "/api/admin/reviews") {
        return { status: 200, body: this.backend.list(context) };
      }
      const detailId = routeSegment(context.path, /^\/api\/admin\/reviews\/([^/]+)$/);
      if (context.method === "GET" && detailId !== null) {
        return { status: 200, body: this.backend.detail(context, detailId) };
      }
      const operationId = routeSegment(context.path, /^\/api\/admin\/operations\/([^/]+)$/);
      if (context.method === "GET" && operationId !== null) {
        return { status: 200, body: this.backend.operation(context, operationId) };
      }
      if (context.method === "POST" && context.path === "/api/admin/csrf") {
        const parsed = CsrfIssueRequestSchema.safeParse(body);
        if (!parsed.success) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
        const prepared = csrfPrepared(parsed.data);
        const csrfToken = parsed.data.operationType === "x-submit" || parsed.data.operationType === "x-retire"
          ? this.xIssueCsrf(context, prepared as PreparedXSubmit | PreparedXRetire)
          : this.backend.issueCsrf(context, prepared);
        return {
          status: 200,
          body: {
            schemaVersion: "admin-review-csrf-v1",
            csrfToken,
            operationId: prepared.binding.operationId,
            method: prepared.binding.method,
            path: prepared.binding.path,
            bodyHash: prepared.binding.bodyHash,
            expiresInSeconds: 300
          }
        };
      }
      const revisionId = routeSegment(context.path, /^\/api\/admin\/reviews\/([^/]+)\/revision$/);
      if (context.method === "POST" && revisionId !== null) {
        return { status: 200, body: this.backend.revision(context, body) };
      }
      const approveId = routeSegment(context.path, /^\/api\/admin\/reviews\/([^/]+)\/approve$/);
      if (context.method === "POST" && approveId !== null) {
        return { status: 200, body: this.backend.approve(context, body) };
      }
      const rejectId = routeSegment(context.path, /^\/api\/admin\/reviews\/([^/]+)\/reject$/);
      if (context.method === "POST" && rejectId !== null) {
        return { status: 200, body: this.backend.reject(context, body) };
      }
      const publicId = routeSegment(context.path, /^\/api\/admin\/publications\/([^/]+)\/publish$/);
      if (context.method === "POST" && publicId !== null) {
        return { status: 200, body: this.backend.publish(context, body) };
      }
      if (context.method === "POST" && context.path === "/api/admin/reviews/release") {
        return { status: 200, body: this.backend.releaseNow(context, body) };
      }
      if (context.method === "POST" && context.path === "/api/admin/x-submissions") {
        return this.xSubmit(context, body);
      }
      const retireId = routeSegment(context.path, /^\/api\/admin\/x-submissions\/([^/]+)\/retire$/);
      if (context.method === "POST" && retireId !== null) {
        return this.xRetire(context, retireId, body);
      }
      const oembedId = routeSegment(context.path, /^\/api\/admin\/x-submissions\/([^/]+)\/resolve-oembed$/);
      if (context.method === "POST" && oembedId !== null) {
        this.xRead();
        return {
          status: 403,
          body: {
            schemaVersion: "admin-x-manual-v1",
            reasonCode: "CAPABILITY_DISABLED",
            externalCalls: 0
          }
        };
      }
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    } catch (error) {
      const reviewError = mapXManualError(error);
      return {
        status: reviewError.status,
        body: {
          schemaVersion: "admin-review-error-v1",
          reasonCode: reviewError.reasonCode
        }
      };
    }
  }
}
