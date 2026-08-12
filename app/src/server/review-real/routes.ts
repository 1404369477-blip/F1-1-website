import { z } from "zod";

import type { RawAdminContext } from "../source-management/security.ts";
import {
  ReviewAdminBackend,
  prepareApproveMutation,
  preparePublishMutation,
  prepareRejectMutation,
  prepareRevisionMutation
} from "./backend.ts";
import { asReviewRealError, ReviewRealError } from "./error.ts";
import {
  ApproveRequestSchema,
  PublishRequestSchema,
  RejectRequestSchema,
  RevisionRequestSchema
} from "./schema.ts";

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
  }).strict()
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

function csrfPrepared(input: z.infer<typeof CsrfIssueRequestSchema>) {
  if (input.operationType === "revision") return prepareRevisionMutation(input.mutation);
  if (input.operationType === "approve") return prepareApproveMutation(input.mutation);
  if (input.operationType === "reject") return prepareRejectMutation(input.mutation);
  return preparePublishMutation(input.mutation);
}

export class ReviewAdminRoutes {
  private readonly backend: ReviewAdminBackend;

  constructor(backend: ReviewAdminBackend) {
    this.backend = backend;
  }

  handle(context: RawAdminContext, body?: unknown): ReviewAdminRouteResult {
    try {
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
        const csrfToken = this.backend.issueCsrf(context, prepared);
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
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    } catch (error) {
      const reviewError = asReviewRealError(error);
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
