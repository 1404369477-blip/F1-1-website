export const TWEET_INBOX_PROFILE_ID = "tweet-inbox-private" as const;
export const TWEET_INBOX_SLOT_SECONDS = 900;
export const TWEET_INBOX_MAX_PER_RUN = 20;
export const TWEET_INBOX_MAX_DROP_LINES = 200;
export const TWEET_INBOX_MAX_DROP_BYTES = 65_536;
export const TWEET_INBOX_MAX_RESPONSE_BYTES = 65_536;

export const TWEET_INBOX_REASON_CODES = [
  "OK",
  "IDLE",
  "RUNNING",
  "TWEET_INBOX_IO_DISABLED",
  "CLI_ARGUMENTS_FORBIDDEN",
  "URL_REJECTED",
  "DROP_TOO_LARGE",
  "PROXY_ENV_FORBIDDEN",
  "DNS_FAILURE",
  "DNS_REJECTED",
  "REDIRECT_REJECTED",
  "TLS_REJECTED",
  "CONNECT_TIMEOUT",
  "FIRST_BYTE_TIMEOUT",
  "TOTAL_TIMEOUT",
  "CONTENT_ENCODING_REJECTED",
  "RESPONSE_TOO_LARGE",
  "MIME_REJECTED",
  "HTTP_429",
  "HTTP_STOP_STATUS",
  "HTTP_5XX",
  "HTTP_STATUS_REJECTED",
  "NETWORK_FAILURE",
  "OEMBED_JSON_REJECTED",
  "OEMBED_SCRIPT_REJECTED",
  "OEMBED_IFRAME_REJECTED",
  "OEMBED_TEXT_MISSING",
  "TWEET_UNAVAILABLE",
  "CAPABILITY_DISABLED",
  "X_MANUAL_URL_REJECTED",
  "X_MANUAL_AUTHORITY_REQUIRED",
  "SQLITE_FAILURE",
  "RUN_STATE_INVALID"
] as const;

export type TweetInboxReasonCode = (typeof TWEET_INBOX_REASON_CODES)[number];
export type TweetInboxNextAction = "none" | "next_slot" | "manual_review";
export type TweetInboxItemStatus = "queued" | "fetched" | "rejected" | "failed";

export class TweetInboxError extends Error {
  readonly reasonCode: TweetInboxReasonCode;
  readonly nextAction: TweetInboxNextAction;
  readonly externalCalls: 0 | 1;
  readonly httpStatus: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    reasonCode: TweetInboxReasonCode,
    options: Readonly<{
      nextAction?: TweetInboxNextAction;
      externalCalls?: 0 | 1;
      httpStatus?: number | null;
      retryAfterSeconds?: number | null;
    }> = {}
  ) {
    super(reasonCode);
    this.name = "TweetInboxError";
    this.reasonCode = reasonCode;
    this.nextAction = options.nextAction ?? "manual_review";
    this.externalCalls = options.externalCalls ?? 0;
    this.httpStatus = options.httpStatus ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function tweetInboxFailure(error: unknown, networkAttempted: boolean): TweetInboxError {
  const source = error instanceof TweetInboxError ? error : new TweetInboxError("SQLITE_FAILURE");
  return new TweetInboxError(source.reasonCode, {
    nextAction: source.nextAction,
    externalCalls: networkAttempted || source.externalCalls === 1 ? 1 : 0,
    httpStatus: source.httpStatus,
    retryAfterSeconds: source.retryAfterSeconds
  });
}

export type NormalizedTweetUrl = Readonly<{
  tweetId: string;
  handle: string | null;
  canonicalUrl: string;
  submittedUrl: string;
}>;

export type NormalizedManualStatusUrl = Readonly<{
  statusId: string;
  handle: string;
  canonicalUrl: string;
  submittedUrl: string;
}>;

export type XManualSourceRow = Readonly<{
  sourceId: string;
  platform: "x";
  handle: string;
  canonicalUrl: string;
  // Schema 8 freezes these values.  Schema 10 projects the same legacy X
  // registry through source_registry_v1, so keep the response type wide
  // enough to represent a verified registry row without inventing another
  // X-specific DTO.
  enabled: boolean;
  lifecycleStatus: "proposed" | "active" | "paused" | "retired";
  collectionOnboardingStatus:
    | "validating" | "activation_pending" | "queued" | "collecting" | "active"
    | "normalization_failed" | "dedup_needs_review" | "linked_existing"
    | "blocked_adapter_missing" | "blocked_authorization" | "blocked_platform"
    | "queue_failed" | "collection_failed" | "stopped" | "cancelled" | "dead_letter";
  normalizationStatus: "pending" | "valid" | "invalid";
  dedupStatus: "pending" | "unique" | "needs_review" | "linked_existing";
  identityStatus: "unknown" | "verified" | "needs_review";
  relevanceStatus: "unknown" | "qualified" | "rejected";
  monitorability: "unknown" | "monitorable" | "restricted" | "unavailable";
  adapterStatus: "unchecked" | "ready" | "missing" | "unavailable";
  adapterAuthorizationStatus: "unknown" | "valid" | "invalid" | "expired";
  platformAllowed: "unknown" | "allowed" | "blocked";
  sourceStopStatus: "clear" | "manual" | "compliance" | "authorization" | "platform";
  sourceConfigEpoch: number;
  sourceSafetyEpoch: number;
  sourceKind: "x_manual";
  collectionMode: "manual_url";
  inventorySha256: string;
  createdAt: string;
  updatedAt: string;
}>;

export type XManualSubmissionState =
  | "submitted"
  | "validated"
  | "candidate_created"
  | "retired"
  | "duplicate"
  | "blocked"
  | "oembed_pending"
  | "oembed_resolved"
  | "reconcile_required";

export type XManualSubmissionRow = Readonly<{
  submissionId: string;
  revision: number;
  submittedUrl: string;
  canonicalUrl: string;
  statusId: string;
  dedupeKey: string;
  state: XManualSubmissionState;
  sourceId: string | null;
  oembedAttemptId: string | null;
  candidateId: string | null;
  retentionExpiresAt: string;
  externalCalls: 0;
  mediaPublicationEligible: false;
  createdAt: string;
  updatedAt: string;
}>;

export type XManualSubmitInput = Readonly<{
  submittedUrl: string;
  nowIso: string;
  retentionExpiresAt?: string;
  submissionId?: string;
  operationId?: string;
  idempotencyKey?: string;
}>;

export type XManualSubmitResult = Readonly<{
  submission: XManualSubmissionRow;
  duplicate: boolean;
  externalCalls: 0;
  automaticReview: false;
  automaticPublish: false;
}>;

export type XManualInboxReceipt = Readonly<{
  schemaVersion: "x-manual-inbox-receipt-v1";
  profile: "x-manual-inbox-private";
  status: "succeeded" | "idle" | "failed";
  reasonCode: "OK" | "IDLE" | "X_MANUAL_URL_REJECTED" | "SQLITE_FAILURE";
  dropLineCount: number;
  submittedCount: number;
  duplicateCount: number;
  invalidCount: number;
  externalCalls: 0;
  automaticReview: false;
  automaticPublish: false;
  media: "none";
}>;

export type ParsedTweetOembed = Readonly<{
  tweetId: string;
  canonicalUrl: string;
  handle: string;
  authorName: string;
  text: string;
  sourcePublishedAt: string | null;
  oembedSha256: string;
}>;

export type TweetInboxReceipt = Readonly<{
  schemaVersion: "tweet-inbox-receipt-v1";
  profile: typeof TWEET_INBOX_PROFILE_ID;
  runId: string;
  slotKey: number;
  status: "succeeded" | "idle" | "failed";
  reasonCode: TweetInboxReasonCode;
  nextAction: TweetInboxNextAction;
  dropLineCount: number;
  queuedCount: number;
  fetchedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  failedCount: number;
  invalidCount: number;
  externalCalls: number;
  media: "none";
}>;
