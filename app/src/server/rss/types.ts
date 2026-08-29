import {
  LIVE_RSS_SOURCES,
  MOTORSPORT_SOURCE_ID,
  type LiveRssSourceId
} from "./sources.ts";

export const RSS_PROFILE_ID = "rss-real-private" as const;
export const RSS_SOURCE_ID = MOTORSPORT_SOURCE_ID;
export const RSS_FEED_URL = LIVE_RSS_SOURCES[MOTORSPORT_SOURCE_ID].feedUrl;
export const RSS_FEED_HOST = LIVE_RSS_SOURCES[MOTORSPORT_SOURCE_ID].feedHost;
export const RSS_FEED_PATH = LIVE_RSS_SOURCES[MOTORSPORT_SOURCE_ID].feedPath;
export const RSS_SLOT_SECONDS = 900;
export const RSS_MAX_RESPONSE_BYTES = 1024 * 1024;
export const RSS_MAX_ITEMS = 60;
export const RSS_SELECTED_ITEMS = 20;
export const RSS_MAX_FIELD_BYTES = 16_384;
export const RSS_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const RSS_MAX_HTML_BYTES = 256 * 1024;

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
  "ARTICLE_BATCH_PARTIAL",
  "BATCH_DEADLINE_EXCEEDED",
  "RESOURCE_CLEANUP_TIMEOUT",
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

export type RssExternalCallBreakdown = Readonly<{
  dnsAttempts: number;
  dohAttempts: number;
  httpAttempts: number;
  successfulResourceReads: number;
}>;

export type RssAttemptSnapshot = RssExternalCallBreakdown;

function validCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("RSS_ATTEMPT_COUNT_INVALID");
  return value;
}

export class RssAttemptLedger {
  private dnsAttempts = 0;
  private dohAttempts = 0;
  private httpAttempts = 0;
  private successfulResourceReads = 0;
  private sealed = false;

  private assertOpen(): void {
    if (this.sealed) throw new Error("RSS_ATTEMPT_LEDGER_SEALED");
  }

  noteDnsAttempt(): void { this.assertOpen(); this.dnsAttempts += 1; }
  noteDohAttempt(): void { this.assertOpen(); this.dohAttempts += 1; }
  noteHttpAttempt(): void { this.assertOpen(); this.httpAttempts += 1; }
  noteSuccessfulResourceRead(): void { this.assertOpen(); this.successfulResourceReads += 1; }
  seal(): RssAttemptSnapshot { this.sealed = true; return this.snapshot(); }

  get isSealed(): boolean { return this.sealed; }

  snapshot(): RssAttemptSnapshot {
    return Object.freeze({
      dnsAttempts: validCount(this.dnsAttempts),
      dohAttempts: validCount(this.dohAttempts),
      httpAttempts: validCount(this.httpAttempts),
      successfulResourceReads: validCount(this.successfulResourceReads)
    });
  }

  totalExternalCalls(): number {
    const current = this.snapshot();
    return current.dnsAttempts + current.dohAttempts + current.httpAttempts;
  }
}

export class RssError extends Error {
  readonly reasonCode: RssReasonCode;
  readonly nextAction: RssNextAction;
  readonly externalCalls: number;
  readonly externalCallBreakdown: RssExternalCallBreakdown;
  readonly httpStatus: number | null;
  readonly retryAfterSeconds: number | null;
  readonly stopSource: boolean;

  constructor(
    reasonCode: RssReasonCode,
    options: Readonly<{
      nextAction?: RssNextAction;
      externalCalls?: number;
      externalCallBreakdown?: RssExternalCallBreakdown;
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
    this.externalCallBreakdown = Object.freeze(options.externalCallBreakdown ?? {
      dnsAttempts: 0,
      dohAttempts: 0,
      httpAttempts: 0,
      successfulResourceReads: 0
    });
    this.httpStatus = options.httpStatus ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.stopSource = options.stopSource ?? false;
  }
}

export function rssFailureForReceipt(error: unknown, attempts: RssAttemptSnapshot | boolean): RssError {
  const source = error instanceof RssError ? error : new RssError("SQLITE_FAILURE");
  const breakdown = typeof attempts === "boolean"
    ? Object.freeze({ dnsAttempts: 0, dohAttempts: 0, httpAttempts: attempts ? 1 : 0, successfulResourceReads: 0 })
    : attempts;
  return new RssError(source.reasonCode, {
    nextAction: source.nextAction,
    externalCalls: breakdown.dnsAttempts + breakdown.dohAttempts + breakdown.httpAttempts,
    externalCallBreakdown: breakdown,
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
  media: RssSourceImage | null;
  sourcePayloadHash: string;
}>;

export type RssSourceImage = Readonly<{
  url: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
  declaredBytes: number;
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
  sourceId: LiveRssSourceId;
  runId: string;
  slotKey: number;
  scheduledAt: string;
  startedAt: string;
  stopEpoch: number;
}>;

export type RssRunReceiptV1 = Readonly<{
  schemaVersion: "rss-real-receipt-v1";
  profile: typeof RSS_PROFILE_ID;
  /** Historical v1 was single-source and must retain its exact source identity. */
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

export type RssAnyRunReceipt = RssRunReceiptV1 | RssRunReceipt;

export type RssRunReceipt = Readonly<{
  schemaVersion: "rss-real-receipt-v2";
  profile: typeof RSS_PROFILE_ID;
  sourceId: LiveRssSourceId;
  runId: string;
  slotKey: number;
  status: "succeeded" | "not_modified" | "failed";
  reasonCode: RssReasonCode;
  nextAction: RssNextAction;
  externalCalls: number;
  logicalAttemptBoundaries: number;
  attemptDefinition: "dns_resolver_boundary+doh_http_request+resource_http_request";
  resourceReads: number;
  externalCallBreakdown: RssExternalCallBreakdown;
  responseSha256: string | null;
  itemCount: number;
  selectedCount: number;
  newCount: number;
  updatedCount: number;
  duplicateCount: number;
}>;
