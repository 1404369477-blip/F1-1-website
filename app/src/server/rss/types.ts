export const RSS_PROFILE_ID = "rss-real-private" as const;
export const RSS_SOURCE_ID = "motorsport-f1-news" as const;
export const RSS_FEED_URL = "https://www.motorsport.com/rss/f1/news/" as const;
export const RSS_FEED_HOST = "www.motorsport.com" as const;
export const RSS_FEED_PATH = "/rss/f1/news/" as const;
export const RSS_SLOT_SECONDS = 900;
export const RSS_MAX_RESPONSE_BYTES = 1024 * 1024;
export const RSS_MAX_ITEMS = 60;
export const RSS_SELECTED_ITEMS = 20;
export const RSS_MAX_FIELD_BYTES = 16_384;

export const RSS_REASON_CODES = [
  "OK",
  "NOT_MODIFIED",
  "RUNNING",
  "NEVER_RUN",
  "SCHEDULER_GAP",
  "PROCESS_INTERRUPTED",
  "RSS_IO_DISABLED",
  "CLI_ARGUMENTS_FORBIDDEN",
  "URL_REJECTED",
  "PROXY_ENV_FORBIDDEN",
  "DNS_FAILURE",
  "DNS_REJECTED",
  "REDIRECT_REJECTED",
  "TLS_REJECTED",
  "CONNECT_TIMEOUT",
  "FIRST_BYTE_TIMEOUT",
  "TOTAL_TIMEOUT",
  "CONTENT_ENCODING_REJECTED",
  "RESPONSE_SIZE_INVALID",
  "RESPONSE_TOO_LARGE",
  "MIME_REJECTED",
  "VALIDATOR_REJECTED",
  "RETRY_AFTER_INVALID",
  "HTTP_429",
  "HTTP_STOP_STATUS",
  "HTTP_5XX",
  "HTTP_STATUS_REJECTED",
  "NETWORK_FAILURE",
  "UTF8_REJECTED",
  "XML_FORBIDDEN_DECLARATION",
  "XINCLUDE_REJECTED",
  "XML_PARSE_REJECTED",
  "XML_DEPTH_EXCEEDED",
  "XML_NODE_LIMIT",
  "ITEM_LIMIT",
  "ITEM_FIELD_INVALID",
  "ITEM_TIME_INVALID",
  "ITEM_IDENTITY_INVALID",
  "SLOT_ALREADY_RECORDED",
  "RUN_IN_FLIGHT",
  "SOURCE_STOPPED",
  "SOURCE_NOT_ELIGIBLE",
  "RUN_STATE_INVALID",
  "MIGRATION_DRIFT",
  "SQLITE_FAILURE"
] as const;

export type RssReasonCode = (typeof RSS_REASON_CODES)[number];
export type RssNextAction = "none" | "next_slot" | "manual_review";

export class RssError extends Error {
  readonly reasonCode: RssReasonCode;
  readonly nextAction: RssNextAction;
  readonly externalCalls: 0 | 1;
  readonly httpStatus: number | null;
  readonly retryAfterSeconds: number | null;
  readonly stopSource: boolean;

  constructor(
    reasonCode: RssReasonCode,
    options: Readonly<{
      nextAction?: RssNextAction;
      externalCalls?: 0 | 1;
      httpStatus?: number | null;
      retryAfterSeconds?: number | null;
      stopSource?: boolean;
    }> = {}
  ) {
    super(reasonCode);
    this.name = "RssError";
    this.reasonCode = reasonCode;
    this.nextAction = options.nextAction ?? "manual_review";
    this.externalCalls = options.externalCalls ?? 0;
    this.httpStatus = options.httpStatus ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.stopSource = options.stopSource ?? false;
  }
}

export function rssFailureForReceipt(error: unknown, networkAttempted: boolean): RssError {
  const source = error instanceof RssError ? error : new RssError("SQLITE_FAILURE");
  return new RssError(source.reasonCode, {
    nextAction: source.nextAction,
    externalCalls: networkAttempted || source.externalCalls === 1 ? 1 : 0,
    httpStatus: source.httpStatus,
    retryAfterSeconds: source.retryAfterSeconds,
    stopSource: source.stopSource
  });
}

export type RssItem = Readonly<{
  externalId: string;
  canonicalUrl: string;
  title: string;
  excerpt: string;
  author: string | null;
  publishedAt: string;
  sourcePayloadHash: string;
}>;

export type ParsedRssFeed = Readonly<{
  itemCount: number;
  items: readonly RssItem[];
}>;

export type SourceValidators = Readonly<{
  etag: string | null;
  lastModified: string | null;
}>;

export type RssModifiedResponse = Readonly<{
  kind: "modified";
  statusCode: 200;
  body: Uint8Array;
  responseBytes: number;
  responseSha256: string;
  validators: SourceValidators;
  validatorCapability: "supported" | "unknown";
}>;

export type RssNotModifiedResponse = Readonly<{
  kind: "not_modified";
  statusCode: 304;
  responseBytes: 0;
  responseSha256: null;
  validators: SourceValidators;
  validatorCapability: "supported" | "unknown";
}>;

export type RssHttpResponse = RssModifiedResponse | RssNotModifiedResponse;

export type ClaimedRssRun = Readonly<{
  runId: string;
  slotKey: number;
  scheduledAt: string;
  startedAt: string;
  stopEpoch: number;
}>;

export type RssRunReceipt = Readonly<{
  schemaVersion: "rss-real-receipt-v1";
  profile: typeof RSS_PROFILE_ID;
  sourceId: typeof RSS_SOURCE_ID;
  runId: string;
  slotKey: number;
  status: "succeeded" | "not_modified" | "failed";
  reasonCode: RssReasonCode;
  nextAction: RssNextAction;
  externalCalls: 0 | 1;
  responseSha256: string | null;
  itemCount: number;
  selectedCount: number;
  newCount: number;
  updatedCount: number;
  duplicateCount: number;
}>;
