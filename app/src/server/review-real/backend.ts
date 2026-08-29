import { createHash } from "node:crypto";

import type { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import type { RawAdminContext } from "../source-management/security.ts";
import { ReviewRealError } from "./error.ts";
import {
  type ApproveRequest,
  type ApproveSuccess,
  type OperationReceipt,
  type PublishRequest,
  type PublishSuccess,
  type RejectRequest,
  type ReleaseNowRequest,
  type RejectSuccess,
  ReviewRealRepository,
  type ReviewDetail,
  type ReviewList,
  type RevisionRequest,
  type RevisionSuccess
} from "./repository.ts";
import {
  ApproveRequestSchema,
  PublishRequestSchema,
  RejectRequestSchema,
  ReleaseNowRequestSchema,
  RevisionRequestSchema
} from "./schema.ts";
import { ReviewAdminSecurity, type ReviewMutationBinding } from "./security.ts";

type PreparedMutation<T> = Readonly<{
  request: T;
  binding: ReviewMutationBinding;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseRequest<T>(schema: z.ZodType<T>, value: unknown, reason: "REVIEW_CONTENT_INVALID" | "REVIEW_REASON_REQUIRED" | "ADMIN_REQUEST_INVALID"): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ReviewRealError(reason, reason === "ADMIN_REQUEST_INVALID" ? 400 : 422);
  return parsed.data;
}

function bodyHash(value: unknown): string {
  try {
    return sha256(canonicalJson(value));
  } catch {
    throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  }
}

function candidatePath(candidateId: string, action: "revision" | "approve" | "reject"): string {
  return `/api/admin/reviews/${encodeURIComponent(candidateId)}/${action}`;
}

export function prepareRevisionMutation(value: unknown): PreparedMutation<RevisionRequest> {
  const request = parseRequest(RevisionRequestSchema, value, "REVIEW_CONTENT_INVALID");
  return {
    request,
    binding: {
      method: "POST",
      path: candidatePath(request.expected.candidateId, "revision"),
      operationId: request.operationId,
      bodyHash: bodyHash(request)
    }
  };
}

export function prepareApproveMutation(value: unknown): PreparedMutation<ApproveRequest> {
  const request = parseRequest(ApproveRequestSchema, value, "ADMIN_REQUEST_INVALID");
  return {
    request,
    binding: {
      method: "POST",
      path: candidatePath(request.expected.candidateId, "approve"),
      operationId: request.operationId,
      bodyHash: bodyHash(request)
    }
  };
}

export function prepareRejectMutation(value: unknown): PreparedMutation<RejectRequest> {
  const request = parseRequest(RejectRequestSchema, value, "REVIEW_REASON_REQUIRED");
  return {
    request,
    binding: {
      method: "POST",
      path: candidatePath(request.expected.candidateId, "reject"),
      operationId: request.operationId,
      bodyHash: bodyHash(request)
    }
  };
}

export function preparePublishMutation(value: unknown): PreparedMutation<PublishRequest> {
  const request = parseRequest(PublishRequestSchema, value, "ADMIN_REQUEST_INVALID");
  return {
    request,
    binding: {
      method: "POST",
      path: `/api/admin/publications/${encodeURIComponent(request.expected.publicId)}/publish`,
      operationId: request.operationId,
      bodyHash: bodyHash(request),
      freshAction: "publish",
      resourceHash: bodyHash({
        publicId: request.expected.publicId,
        publishGeneration: request.expected.publishGeneration,
        approvedBundleVersionTag: request.expected.approvedBundleVersionTag
      })
    }
  };
}

export function prepareReleaseNowMutation(value: unknown): PreparedMutation<ReleaseNowRequest> {
  const request = parseRequest(ReleaseNowRequestSchema, value, "ADMIN_REQUEST_INVALID");
  return {
    request,
    binding: {
      method: "POST",
      path: "/api/admin/reviews/release",
      operationId: request.operationId,
      bodyHash: bodyHash(request),
      freshAction: "publish",
      resourceHash: bodyHash({
        items: request.expected.items,
        editable: request.editable
      })
    }
  };
}

export function prepareFreshPublishBinding(value: unknown): PreparedMutation<PublishRequest> | PreparedMutation<ReleaseNowRequest> {
  const release = ReleaseNowRequestSchema.safeParse(value);
  if (release.success) return prepareReleaseNowMutation(value);
  return preparePublishMutation(value);
}

export class ReviewAdminBackend {
  private readonly repository: ReviewRealRepository;
  private readonly security: ReviewAdminSecurity;

  constructor(repository: ReviewRealRepository, security: ReviewAdminSecurity) {
    this.repository = repository;
    this.security = security;
  }

  private assertRead(context: RawAdminContext, path: string): void {
    if (context.method !== "GET" || context.path !== path) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    }
  }

  issueCsrf(context: RawAdminContext, prepared: PreparedMutation<unknown>): string {
    return this.security.issueCsrf(context, prepared.binding);
  }

  list(context: RawAdminContext): ReviewList {
    this.assertRead(context, "/api/admin/reviews");
    this.security.authorizeRead(context);
    return this.repository.list();
  }

  detail(context: RawAdminContext, candidateId: string): ReviewDetail {
    this.assertRead(context, `/api/admin/reviews/${encodeURIComponent(candidateId)}`);
    this.security.authorizeRead(context);
    return this.repository.detail(candidateId);
  }

  operation(context: RawAdminContext, operationId: string): OperationReceipt {
    this.assertRead(context, `/api/admin/operations/${encodeURIComponent(operationId)}`);
    this.security.authorizeRead(context);
    return this.repository.operation(operationId);
  }

  revision(context: RawAdminContext, value: unknown): RevisionSuccess {
    const prepared = prepareRevisionMutation(value);
    const authorization = this.security.authorizeMutation(context, prepared.binding);
    const response = this.repository.revision(prepared.request, prepared.binding.path, authorization.actorRef);
    this.security.commitMutation(authorization);
    return response;
  }

  approve(context: RawAdminContext, value: unknown): ApproveSuccess {
    const prepared = prepareApproveMutation(value);
    const authorization = this.security.authorizeMutation(context, prepared.binding);
    const response = this.repository.approve(prepared.request, prepared.binding.path, authorization.actorRef);
    this.security.commitMutation(authorization);
    return response;
  }

  reject(context: RawAdminContext, value: unknown): RejectSuccess {
    const prepared = prepareRejectMutation(value);
    const authorization = this.security.authorizeMutation(context, prepared.binding);
    const response = this.repository.reject(prepared.request, prepared.binding.path, authorization.actorRef);
    this.security.commitMutation(authorization);
    return response;
  }

  publish(context: RawAdminContext, value: unknown): PublishSuccess {
    const prepared = preparePublishMutation(value);
    const authorization = this.security.authorizeMutation(context, prepared.binding);
    const response = this.repository.publish(prepared.request, prepared.binding.path, authorization.actorRef);
    this.security.commitMutation(authorization);
    return response;
  }

  releaseNow(context: RawAdminContext, value: unknown): PublishSuccess {
    const prepared = prepareReleaseNowMutation(value);
    const authorization = this.security.authorizeMutation(context, prepared.binding);
    const response = this.repository.releaseNow(prepared.request, prepared.binding.path, authorization.actorRef);
    this.security.commitMutation(authorization);
    return response;
  }
}
