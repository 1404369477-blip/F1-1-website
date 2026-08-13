export const REVIEW_REAL_REASON_CODES = [
  "ADMIN_REQUEST_INVALID",
  "ADMIN_SESSION_REQUIRED",
  "ADMIN_ORIGIN_REJECTED",
  "ADMIN_CSRF_REJECTED",
  "ADMIN_REAUTH_REQUIRED",
  "ADMIN_BACKUP_STALE",
  "ADMIN_STORAGE_BUSY",
  "ADMIN_OPERATION_NOT_FOUND",
  "REVIEW_CANDIDATE_NOT_FOUND",
  "REVIEW_SOURCE_STALE",
  "REVIEW_BUNDLE_STALE",
  "REVIEW_CHINESE_REQUIRED",
  "REVIEW_DECISION_CONFLICT",
  "REVIEW_CONTENT_INVALID",
  "REVIEW_REASON_REQUIRED",
  "PUBLICATION_NOT_FOUND",
  "PUBLICATION_RECONCILE_WAIT",
  "DELIVERY_RECONCILE_WAIT",
  "PROJECTION_RECEIPT_UNKNOWN",
  "PROJECTION_REQUEST_INVALID",
  "PROJECTION_SCHEMA_INVALID",
  "PROJECTION_RECORD_HASH_MISMATCH",
  "PROJECTION_MANIFEST_HASH_MISMATCH",
  "PROJECTION_SIGNATURE_INVALID",
  "PROJECTION_SIGNING_KEY_INACTIVE",
  "PROJECTION_GENERATION_CONFLICT",
  "PROJECTION_IDEMPOTENCY_CONFLICT",
  "PROJECTION_STORAGE_FAILED",
  "PROJECTION_ACTIVATION_FAILED",
  "PUBLIC_SNAPSHOT_UNAVAILABLE",
  "PUBLIC_SNAPSHOT_INTEGRITY_FAILED",
  "ADMIN_INTERNAL_FAILURE"
] as const;

export type ReviewRealReasonCode = (typeof REVIEW_REAL_REASON_CODES)[number];

export class ReviewRealError extends Error {
  readonly reasonCode: ReviewRealReasonCode;
  readonly status: number;

  constructor(reasonCode: ReviewRealReasonCode, status: number) {
    super(reasonCode);
    this.name = "ReviewRealError";
    this.reasonCode = reasonCode;
    this.status = status;
  }
}

export function asReviewRealError(error: unknown): ReviewRealError {
  if (error instanceof ReviewRealError) return error;
  const candidate = error as { code?: unknown; errcode?: unknown; message?: unknown };
  if (
    candidate.code === "ERR_SQLITE_ERROR" &&
    (candidate.errcode === 5 || candidate.errcode === 6 || /(?:busy|locked|LOCK_CONTENTION)/i.test(String(candidate.message)))
  ) {
    return new ReviewRealError("ADMIN_STORAGE_BUSY", 503);
  }
  if (/LOCK_CONTENTION/i.test(String(candidate.message))) {
    return new ReviewRealError("ADMIN_STORAGE_BUSY", 503);
  }
  return new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
}
