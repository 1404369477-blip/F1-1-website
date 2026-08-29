import { createHash } from "node:crypto";
import { Resolver } from "node:dns";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";

import {
  RSS_FEED_URL,
  RSS_MAX_HTML_BYTES,
  RSS_MAX_RESPONSE_BYTES,
  RssAttemptLedger,
  RssError,
  type RssHttpResponse,
  type SourceValidators,
} from "./types.ts";
import {
  LIVE_RSS_SOURCES,
  liveRssSource,
  liveRssSourceByFeedUrl,
  type LiveRssSourceId,
} from "./sources.ts";
import type {
  GatewayExternalAttemptInput,
  GatewayExternalReconcileInput,
} from "../internal-operation/mutation-port.ts";
import type { ClosedExternalResponse } from "../internal-operation/gateway.ts";

export type RssExternalAttemptRunner = <T>(
  input: GatewayExternalAttemptInput<T>,
) => Promise<T>;

export type RssExternalReconcileRunner = <T>(
  input: GatewayExternalReconcileInput<T>,
) => Promise<T>;

function isLiveFeedHost(hostname: string): boolean {
  return Object.values(LIVE_RSS_SOURCES).some(
    (source) => source.feedHost === hostname,
  );
}

const ALLOWED_MIME_TYPES = new Set([
  "application/rss+xml",
  "application/xml",
  "text/xml",
]);
const ALLOWED_HTML_MIME_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const DOH_RESOLVER = Object.freeze({
  address: "1.1.1.1",
  family: 4,
  servername: "cloudflare-dns.com",
});
const DOH_MAX_BYTES = 8 * 1024;
const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "FTP_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "ftp_proxy",
] as const;

const REQUEST_TIMEOUT_MS = 15_000;
export const RSS_RESOURCE_CLEANUP_GRACE_MS = 1_000;

type CloseEmitter = Readonly<{
  once(event: "close", listener: () => void): unknown;
}>;

export type RssTrustedTransportInjection = Readonly<{
  /**
   * Test-only local DNS seam. The production resolver still owns attempt
   * accounting and public-address filtering; this callback only supplies the
   * resolver result without opening a network socket.
   */
  dnsLookup?: (
    hostname: string,
    deadlineAt: number | undefined,
    signal: AbortSignal | undefined,
  ) => Promise<readonly string[]>;
  /** Backwards-compatible address seam; production code owns accounting. */
  resolveHost?: (
    hostname: string,
    attempts: RssAttemptLedger | undefined,
    deadlineAt: number | undefined,
    signal: AbortSignal | undefined,
  ) => Promise<{ address: string; family: number }>;
  /** Test-only loopback request factory; all response/close handling remains production code. */
  request: (
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => ReturnType<typeof httpsRequest>;
}>;

/**
 * A request promise is not allowed to settle at destroy(). Node reports the
 * actual resource boundary later through close events. This tracker waits for
 * the ClientRequest plus any response and socket observed for that request.
 * If a platform fails to acknowledge close within the bounded grace period,
 * the result is explicitly unknown/failure instead of being treated as a
 * clean cancellation.
 */
class ResourceCloseAck {
  private requestClosed = false;
  private responseClosed = true;
  private socketClosed = true;
  private terminalRequested = false;
  private terminalError: unknown = undefined;
  private settled = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly promise: Promise<void>;
  private resolvePromise!: () => void;
  private rejectPromise!: (error: unknown) => void;

  constructor(request: CloseEmitter) {
    this.promise = new Promise<void>((resolvePromise, rejectPromise) => {
      this.resolvePromise = resolvePromise;
      this.rejectPromise = rejectPromise;
    });
    request.once("close", () => {
      this.requestClosed = true;
      this.maybeSettle();
    });
  }

  addResponse(response: CloseEmitter): void {
    this.responseClosed = false;
    response.once("close", () => {
      this.responseClosed = true;
      this.maybeSettle();
    });
  }

  addSocket(socket: CloseEmitter): void {
    this.socketClosed = false;
    socket.once("close", () => {
      this.socketClosed = true;
      this.maybeSettle();
    });
  }

  wait(error: unknown): Promise<void> {
    if (!this.terminalRequested) {
      this.terminalRequested = true;
      this.terminalError = error;
      this.timer = setTimeout(() => {
        if (this.settled) return;
        this.settled = true;
        this.rejectPromise(
          new RssError("RESOURCE_CLEANUP_TIMEOUT", { nextAction: "next_slot" }),
        );
      }, RSS_RESOURCE_CLEANUP_GRACE_MS);
      this.maybeSettle();
    }
    return this.promise;
  }

  private maybeSettle(error?: unknown): void {
    if (
      !this.terminalRequested ||
      this.settled ||
      !this.requestClosed ||
      !this.responseClosed ||
      !this.socketClosed
    )
      return;
    this.settled = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.terminalError === undefined || this.terminalError === null)
      this.resolvePromise();
    else this.rejectPromise(this.terminalError);
  }
}

function remainingDeadlineMs(deadlineAt: number | undefined): number {
  if (deadlineAt === undefined) return REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= 0)
    throw new RssError("RUN_STATE_INVALID");
  return Math.max(0, deadlineAt - Date.now());
}

function assertDeadline(deadlineAt: number | undefined): void {
  if (deadlineAt !== undefined && remainingDeadlineMs(deadlineAt) <= 0) {
    throw new RssError("BATCH_DEADLINE_EXCEEDED", { nextAction: "next_slot" });
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw new RssError("BATCH_DEADLINE_EXCEEDED", { nextAction: "next_slot" });
}

function abortError(): RssError {
  return new RssError("BATCH_DEADLINE_EXCEEDED", { nextAction: "next_slot" });
}

function deadlineError(
  deadlineAt: number | undefined,
  fallback: RssError,
): RssError {
  return deadlineAt !== undefined && remainingDeadlineMs(deadlineAt) <= 0
    ? new RssError("BATCH_DEADLINE_EXCEEDED", {
        externalCalls: fallback.externalCalls,
        nextAction: "next_slot",
      })
    : fallback;
}

function ipv4Number(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return null;
  return (
    (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
  );
}

function inIpv4Range(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return false;
  const denied: Array<readonly [number, number]> = [
    [0x00000000, 8],
    [0x0a000000, 8],
    [0x64400000, 10],
    [0x7f000000, 8],
    [0xa9fe0000, 16],
    [0xac100000, 12],
    [0xc0000000, 24],
    [0xc0000200, 24],
    [0xc0586300, 24],
    [0xc0a80000, 16],
    [0xc6120000, 15],
    [0xc6336400, 24],
    [0xcb007100, 24],
    [0xe0000000, 4],
    [0xf0000000, 4],
  ];
  return !denied.some(([base, prefix]) => inIpv4Range(value, base, prefix));
}

function ipv6Bytes(address: string): Uint8Array | null {
  if (address.includes("%") || address.includes(".")) return null;
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const parseHalf = (value: string): number[] | null => {
    if (value === "") return [];
    const parts = value.split(":");
    const parsed = parts.map((part) =>
      /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : Number.NaN,
    );
    return parsed.some((part) => !Number.isInteger(part)) ? null : parsed;
  };
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  )
    return null;
  const words = [
    ...left,
    ...Array.from({ length: missing }, () => 0),
    ...right,
  ];
  if (words.length !== 8) return null;
  const bytes = new Uint8Array(16);
  words.forEach((word, index) => {
    bytes[index * 2] = word >>> 8;
    bytes[index * 2 + 1] = word & 0xff;
  });
  return bytes;
}

function matchesIpv6Prefix(
  address: Uint8Array,
  prefixAddress: string,
  prefixBits: number,
): boolean {
  const prefix = ipv6Bytes(prefixAddress);
  if (!prefix) throw new Error("invalid frozen IPv6 prefix");
  const fullBytes = Math.floor(prefixBits / 8);
  for (let index = 0; index < fullBytes; index += 1) {
    if (address[index] !== prefix[index]) return false;
  }
  const remainingBits = prefixBits % 8;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (address[fullBytes] & mask) === (prefix[fullBytes] & mask);
}

const DENIED_IPV6_PREFIXES: readonly (readonly [string, number])[] = [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3ffe::", 16],
  ["3fff::", 20],
  ["2620:4f:8000::", 48],
];

function isPublicIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (!bytes || (bytes[0] & 0xe0) !== 0x20) return false;
  return !DENIED_IPV6_PREFIXES.some(([prefix, bits]) =>
    matchesIpv6Prefix(bytes, prefix, bits),
  );
}

export function isPublicRssAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export function parseDohJsonAnswers(
  body: string,
): Array<{ address: string; family: number }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RssError("DNS_FAILURE", {
      externalCalls: 1,
      nextAction: "next_slot",
    });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RssError("DNS_FAILURE", {
      externalCalls: 1,
      nextAction: "next_slot",
    });
  }
  const status = (parsed as { Status?: unknown }).Status;
  if (status !== 0)
    throw new RssError("DNS_FAILURE", {
      externalCalls: 1,
      nextAction: "next_slot",
    });
  const answers = (parsed as { Answer?: unknown }).Answer;
  if (!Array.isArray(answers)) return [];
  const addresses: Array<{ address: string; family: number }> = [];
  for (const answer of answers) {
    if (answer === null || typeof answer !== "object" || Array.isArray(answer))
      continue;
    const type = (answer as { type?: unknown }).type;
    const data = (answer as { data?: unknown }).data;
    if (type !== 1 || typeof data !== "string" || isIP(data) !== 4) continue;
    addresses.push({ address: data, family: 4 });
  }
  return addresses;
}

export function selectPublicRssAddresses(
  addresses: ReadonlyArray<{ address: string; family: number }>,
): Array<{ address: string; family: number }> {
  return addresses.filter((entry) => isPublicRssAddress(entry.address));
}

export function lookupRssHostViaDoh(
  hostname: string,
  attempts?: RssAttemptLedger,
  deadlineAt?: number,
  signal?: AbortSignal,
  trustedTransport?: RssTrustedTransportInjection,
): Promise<Array<{ address: string; family: number }>> {
  if (!isLiveFeedHost(hostname)) {
    throw new RssError("URL_REJECTED", { externalCalls: 1 });
  }
  assertDeadline(deadlineAt);
  assertNotAborted(signal);
  attempts?.noteDohAttempt();
  return new Promise((resolve, reject) => {
    let finishRequested = false;
    let request: ReturnType<typeof httpsRequest> | undefined;
    let closeAck: ResourceCloseAck | undefined;
    let timer: NodeJS.Timeout | undefined;
    const onAbort = (): void => {
      request?.destroy();
      finish(abortError());
    };
    const finish = (
      error: unknown,
      value?: Array<{ address: string; family: number }>,
    ): void => {
      if (finishRequested) return;
      finishRequested = true;
      signal?.removeEventListener("abort", onAbort);
      const terminalError =
        error === null || error === undefined
          ? null
          : error instanceof RssError
            ? error
            : new RssError("DNS_FAILURE", {
                externalCalls: 1,
                nextAction: "next_slot",
              });
      if (!closeAck) {
        reject(
          terminalError ??
            new RssError("DNS_FAILURE", {
              externalCalls: 1,
              nextAction: "next_slot",
            }),
        );
        return;
      }
      void closeAck
        .wait(terminalError)
        .then(
          () =>
            terminalError === null
              ? resolve(value ?? [])
              : reject(terminalError),
          reject,
        );
    };
    const requestOptions: RequestOptions = {
      protocol: "https:",
      hostname: DOH_RESOLVER.address,
      port: 443,
      method: "GET",
      path: `/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      servername: DOH_RESOLVER.servername,
      agent: false,
      headers: {
        Accept: "application/dns-json",
        "Accept-Encoding": "identity",
        "User-Agent": "F1Plus1-RSS-REAL-001/1.0",
      },
      lookup: createPinnedRssLookup(DOH_RESOLVER),
    };
    request = trustedTransport?.request
      ? trustedTransport.request(requestOptions, (response) => {
          closeAck?.addResponse(response);
          const status = response.statusCode ?? 0;
          if (status !== 200) {
            response.destroy();
            finish(
              new RssError("DNS_FAILURE", {
                externalCalls: 1,
                nextAction: "next_slot",
              }),
            );
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.byteLength;
            if (bytes > DOH_MAX_BYTES) {
              response.destroy();
              finish(
                new RssError("DNS_FAILURE", {
                  externalCalls: 1,
                  nextAction: "next_slot",
                }),
              );
            } else chunks.push(buffer);
          });
          response.once("error", (error) => finish(error));
          response.once("end", () => {
            try {
              finish(
                null,
                parseDohJsonAnswers(
                  Buffer.concat(chunks, bytes).toString("utf8"),
                ),
              );
            } catch (error) {
              finish(error);
            }
          });
        })
      : httpsRequest(requestOptions, (response) => {
          closeAck?.addResponse(response);
          const status = response.statusCode ?? 0;
          if (status !== 200) {
            response.destroy();
            finish(
              new RssError("DNS_FAILURE", {
                externalCalls: 1,
                nextAction: "next_slot",
              }),
            );
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.byteLength;
            if (bytes > DOH_MAX_BYTES) {
              response.destroy();
              finish(
                new RssError("DNS_FAILURE", {
                  externalCalls: 1,
                  nextAction: "next_slot",
                }),
              );
            } else {
              chunks.push(buffer);
            }
          });
          response.once("error", (error) => finish(error));
          response.once("end", () => {
            try {
              finish(
                null,
                parseDohJsonAnswers(
                  Buffer.concat(chunks, bytes).toString("utf8"),
                ),
              );
            } catch (error) {
              finish(error);
            }
          });
        });
    signal?.addEventListener("abort", onAbort, { once: true });
    closeAck = new ResourceCloseAck(request);
    request.once("socket", (socket) => closeAck?.addSocket(socket));
    if (signal?.aborted) onAbort();
    const timeoutMs = Math.min(
      3000,
      Math.max(1, remainingDeadlineMs(deadlineAt)),
    );
    timer = setTimeout(() => {
      request?.destroy();
      finish(
        deadlineError(
          deadlineAt,
          new RssError("CONNECT_TIMEOUT", {
            externalCalls: 1,
            nextAction: "next_slot",
          }),
        ),
      );
    }, timeoutMs);
    request.once("error", (error) => {
      if (timer) clearTimeout(timer);
      finish(error);
    });
    request.once("close", () => {
      if (timer) clearTimeout(timer);
    });
    request.end();
  });
}

export function assertFixedFeedUrl(value: string): URL {
  const source = liveRssSourceByFeedUrl(value);
  if (source === null) throw new RssError("URL_REJECTED");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RssError("URL_REJECTED");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== source.feedHost ||
    url.pathname !== source.feedPath ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new RssError("URL_REJECTED");
  }
  return url;
}

export type DestroyableRssResponse = Readonly<{
  destroy(error?: Error): unknown;
}>;

export function terminateRejectedRssResponse(
  response: DestroyableRssResponse,
): void {
  response.destroy();
}

export function createPinnedRssLookup(
  selected: Readonly<{
    address: string;
    family: number;
  }>,
): NonNullable<RequestOptions["lookup"]> {
  const family: 4 | 6 = selected.family === 6 ? 6 : 4;
  return (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all === true) {
      callback(null, [{ address: selected.address, family }]);
      return;
    }
    callback(null, selected.address, family);
  };
}

function assertNoProxyEnvironment(env: NodeJS.ProcessEnv): void {
  if (
    PROXY_ENV_KEYS.some(
      (key) => typeof env[key] === "string" && env[key] !== "",
    )
  ) {
    throw new RssError("PROXY_ENV_FORBIDDEN");
  }
}

function safeHeader(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (
    Array.isArray(value) ||
    Buffer.byteLength(value, "utf8") > 1024 ||
    /[\u0000\r\n]/.test(value)
  ) {
    throw new RssError("VALIDATOR_REJECTED", { externalCalls: 1 });
  }
  return value;
}

function safeRequestValidator(value: string | null): string | null {
  if (value === null) return null;
  if (Buffer.byteLength(value, "utf8") > 1024 || /[\u0000\r\n]/.test(value)) {
    throw new RssError("VALIDATOR_REJECTED");
  }
  return value;
}

function responseValidators(response: IncomingMessage): SourceValidators {
  return {
    etag: safeHeader(response.headers.etag),
    lastModified: safeHeader(response.headers["last-modified"]),
  };
}

function validatorCapability(
  validators: SourceValidators,
): "supported" | "unknown" {
  return validators.etag !== null || validators.lastModified !== null
    ? "supported"
    : "unknown";
}

function parseRetryAfter(
  value: string | string[] | undefined,
  now: Date,
): number {
  if (
    Array.isArray(value) ||
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new RssError("RETRY_AFTER_INVALID", {
      externalCalls: 1,
      httpStatus: 429,
    });
  }
  let seconds: number;
  if (/^[0-9]+$/.test(value.trim())) {
    seconds = Number(value.trim());
  } else {
    const date = Date.parse(value);
    if (!Number.isFinite(date))
      throw new RssError("RETRY_AFTER_INVALID", {
        externalCalls: 1,
        httpStatus: 429,
      });
    seconds = Math.ceil((date - now.getTime()) / 1000);
  }
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RssError("RETRY_AFTER_INVALID", {
      externalCalls: 1,
      httpStatus: 429,
    });
  }
  return Math.min(3600, Math.max(60, Math.trunc(seconds)));
}

function assertMime(
  response: IncomingMessage,
  allowed = ALLOWED_MIME_TYPES,
): void {
  const raw = response.headers["content-type"];
  if (Array.isArray(raw) || typeof raw !== "string") {
    throw new RssError("MIME_REJECTED", { externalCalls: 1, httpStatus: 200 });
  }
  const [mime, ...parameters] = raw
    .split(";")
    .map((part) => part.trim().toLowerCase());
  if (!allowed.has(mime))
    throw new RssError("MIME_REJECTED", { externalCalls: 1, httpStatus: 200 });
  for (const parameter of parameters) {
    if (
      parameter.startsWith("charset=") &&
      !/^charset=(?:"?utf-8"?)$/.test(parameter)
    ) {
      throw new RssError("MIME_REJECTED", {
        externalCalls: 1,
        httpStatus: 200,
      });
    }
  }
}

function assertResponseEncoding(response: IncomingMessage): void {
  const value = response.headers["content-encoding"];
  if (
    Array.isArray(value) ||
    (typeof value === "string" && value.trim().toLowerCase() !== "identity")
  ) {
    throw new RssError("CONTENT_ENCODING_REJECTED", {
      externalCalls: 1,
      httpStatus: 200,
    });
  }
}

function assertDeclaredLength(
  response: IncomingMessage,
  maxBytes = RSS_MAX_RESPONSE_BYTES,
): void {
  const value = response.headers["content-length"];
  if (value === undefined) return;
  if (Array.isArray(value) || !/^[0-9]+$/.test(value)) {
    throw new RssError("RESPONSE_SIZE_INVALID", {
      externalCalls: 1,
      httpStatus: 200,
    });
  }
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes))
    throw new RssError("RESPONSE_SIZE_INVALID", {
      externalCalls: 1,
      httpStatus: 200,
    });
  if (bytes > maxBytes)
    throw new RssError("RESPONSE_TOO_LARGE", {
      externalCalls: 1,
      httpStatus: 200,
    });
}

function mapNetworkError(error: unknown): RssError {
  if (error instanceof RssError) return error;
  const code = String((error as { code?: unknown }).code ?? "");
  if (/CERT|TLS|SSL|ALTNAME|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
    return new RssError("TLS_REJECTED", { externalCalls: 1 });
  }
  return new RssError("NETWORK_FAILURE", {
    externalCalls: 1,
    nextAction: "next_slot",
  });
}

async function resolvePublicRssHost(
  hostname: string,
  attempts?: RssAttemptLedger,
  deadlineAt?: number,
  signal?: AbortSignal,
  trustedTransport?: RssTrustedTransportInjection,
): Promise<{ address: string; family: number }> {
  if (!isLiveFeedHost(hostname)) throw new RssError("URL_REJECTED");
  assertDeadline(deadlineAt);
  assertNotAborted(signal);
  // Legacy direct mapping is retained only for older focused fixtures. New
  // production-shaped tests use dnsLookup so the native DNS -> DoH state
  // machine below remains observable and owns all ledger increments.
  if (trustedTransport?.resolveHost && !trustedTransport.dnsLookup) {
    // The legacy fixture callback owns its compatibility accounting. New
    // production-shaped seams use dnsLookup and the state machine below.
    return trustedTransport.resolveHost(hostname, attempts, deadlineAt, signal);
  }
  let publicAddresses: Array<{ address: string; family: number }> = [];
  try {
    attempts?.noteDnsAttempt();
    const addresses = trustedTransport?.dnsLookup
      ? await trustedTransport.dnsLookup(hostname, deadlineAt, signal)
      : trustedTransport?.resolveHost
        ? [
            (
              await trustedTransport.resolveHost(
                hostname,
                attempts,
                deadlineAt,
                signal,
              )
            ).address,
          ]
        : await new Promise<readonly string[]>(
            (resolveAddresses, rejectAddresses) => {
              const resolver = new Resolver();
              let completed = false;
              let cancellationRequested = false;
              let cancellationTimer: NodeJS.Timeout | undefined;
              let cancellationError: RssError | undefined;
              let timer: NodeJS.Timeout | undefined;
              const complete = (
                error: unknown,
                values: readonly string[] = [],
              ): void => {
                if (completed) return;
                completed = true;
                if (timer) clearTimeout(timer);
                if (cancellationTimer) clearTimeout(cancellationTimer);
                signal?.removeEventListener("abort", onAbort);
                if (cancellationError) rejectAddresses(cancellationError);
                else if (error) rejectAddresses(error);
                else resolveAddresses(values);
              };
              const requestCancel = (error: RssError): void => {
                if (completed || cancellationRequested) return;
                cancellationRequested = true;
                cancellationError = error;
                if (timer) clearTimeout(timer);
                resolver.cancel();
                cancellationTimer = setTimeout(() => {
                  if (completed) return;
                  completed = true;
                  signal?.removeEventListener("abort", onAbort);
                  rejectAddresses(
                    new RssError("RESOURCE_CLEANUP_TIMEOUT", {
                      nextAction: "next_slot",
                    }),
                  );
                }, RSS_RESOURCE_CLEANUP_GRACE_MS);
              };
              const onAbort = (): void => {
                requestCancel(abortError());
              };
              timer = setTimeout(
                () => {
                  requestCancel(
                    deadlineError(
                      deadlineAt,
                      new RssError("DNS_FAILURE", {
                        externalCalls: 1,
                        nextAction: "next_slot",
                      }),
                    ),
                  );
                },
                Math.min(3000, Math.max(1, remainingDeadlineMs(deadlineAt))),
              );
              signal?.addEventListener("abort", onAbort, { once: true });
              if (signal?.aborted) {
                onAbort();
                return;
              }
              resolver.resolve4(hostname, (error, values) =>
                complete(error, values),
              );
            },
          );
    publicAddresses = selectPublicRssAddresses(
      addresses.map((address) => ({ address, family: 4 })),
    );
  } catch (error) {
    if (
      error instanceof RssError &&
      (error.reasonCode === "BATCH_DEADLINE_EXCEEDED" ||
        error.reasonCode === "RESOURCE_CLEANUP_TIMEOUT")
    ) {
      throw error;
    }
    publicAddresses = [];
  }
  if (publicAddresses.length === 0) {
    try {
      assertNotAborted(signal);
      publicAddresses = selectPublicRssAddresses(
        await lookupRssHostViaDoh(
          hostname,
          attempts,
          deadlineAt,
          signal,
          trustedTransport,
        ),
      );
    } catch (error) {
      if (error instanceof RssError) throw error;
      throw new RssError("DNS_FAILURE", {
        externalCalls: 1,
        nextAction: "next_slot",
      });
    }
  }
  if (publicAddresses.length === 0) {
    throw new RssError("DNS_REJECTED", { externalCalls: 1 });
  }
  return publicAddresses[0];
}

export function assertAllowlistedArticleUrl(
  value: string,
  sourceId: LiveRssSourceId,
): URL {
  const source = liveRssSource(sourceId);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RssError("URL_REJECTED");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== source.articleHost ||
    url.port !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new RssError("URL_REJECTED");
  }
  return url;
}

async function fetchAllowlistedArticleHtmlCore(
  options: Readonly<{
    articleUrl: string;
    sourceId: LiveRssSourceId;
    env?: NodeJS.ProcessEnv;
    now?: Date;
    attempts?: RssAttemptLedger;
    deadlineAt?: number;
    signal?: AbortSignal;
    onNetworkAttempt?: () => void;
    trustedTransport?: RssTrustedTransportInjection;
  }>,
): Promise<string> {
  const transportStartedAt = Date.now();
  const source = liveRssSource(options.sourceId);
  const articleUrl = assertAllowlistedArticleUrl(
    options.articleUrl,
    options.sourceId,
  );
  const env = options.env ?? process.env;
  if (env.RSS_REAL_IO !== "true") throw new RssError("RSS_IO_DISABLED");
  assertNoProxyEnvironment(env);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new RssError("RUN_STATE_INVALID");
  assertDeadline(options.deadlineAt);
  assertNotAborted(options.signal);
  options.onNetworkAttempt?.();
  const selected = await resolvePublicRssHost(
    source.articleHost,
    options.attempts,
    options.deadlineAt,
    options.signal,
    options.trustedTransport,
  );
  const elapsedBeforeRequest = Date.now() - transportStartedAt;
  const remaining = remainingDeadlineMs(options.deadlineAt);
  if (elapsedBeforeRequest >= REQUEST_TIMEOUT_MS || remaining <= 0) {
    throw new RssError(
      options.deadlineAt === undefined
        ? "TOTAL_TIMEOUT"
        : "BATCH_DEADLINE_EXCEEDED",
      { externalCalls: 1, nextAction: "next_slot" },
    );
  }

  const body = await new Promise<Buffer>((resolve, reject) => {
    let finishRequested = false;
    let closeAck: ResourceCloseAck | undefined;
    let activeResponse: IncomingMessage | undefined;
    let removeAbortListener = (): void => {};
    const timers = new Set<NodeJS.Timeout>();
    const clearTimers = (): void => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      removeAbortListener();
    };
    const succeed = (value: Buffer): void => {
      if (finishRequested) return;
      finishRequested = true;
      clearTimers();
      if (!closeAck) {
        reject(
          new RssError("NETWORK_FAILURE", {
            externalCalls: 1,
            nextAction: "next_slot",
          }),
        );
        return;
      }
      void closeAck.wait(null).then(() => resolve(value), reject);
    };
    const fail = (error: unknown): void => {
      if (finishRequested) return;
      finishRequested = true;
      clearTimers();
      const mapped = mapNetworkError(error);
      activeResponse?.destroy();
      if (!closeAck) {
        reject(mapped);
        return;
      }
      void closeAck.wait(mapped).then(() => reject(mapped), reject);
    };

    const requestOptions: RequestOptions = {
      protocol: "https:",
      hostname: source.articleHost,
      port: 443,
      method: "GET",
      path: `${articleUrl.pathname}${articleUrl.search}`,
      servername: source.articleHost,
      agent: false,
      headers: {
        Accept: "text/html, application/xhtml+xml;q=0.9",
        "Accept-Encoding": "identity",
        "User-Agent": "F1Plus1-RSS-REAL-001/1.0",
      },
      lookup: createPinnedRssLookup(selected),
    };
    let firstByteTimer: NodeJS.Timeout | undefined;
    options.attempts?.noteHttpAttempt();
    const handleResponse = (response: IncomingMessage): void => {
      activeResponse = response;
      closeAck?.addResponse(response);
      if (firstByteTimer) {
        clearTimeout(firstByteTimer);
        timers.delete(firstByteTimer);
      }
      const status = response.statusCode ?? 0;
      try {
        if (status >= 300 && status <= 399) {
          throw new RssError("REDIRECT_REJECTED", {
            externalCalls: 1,
            httpStatus: status,
          });
        }
        if (status === 429) {
          const retryAfterSeconds = parseRetryAfter(
            response.headers["retry-after"],
            now,
          );
          throw new RssError("HTTP_429", {
            externalCalls: 1,
            httpStatus: status,
            retryAfterSeconds,
            nextAction: "next_slot",
          });
        }
        if (status === 401 || status === 403 || status === 404) {
          throw new RssError("HTTP_STOP_STATUS", {
            externalCalls: 1,
            httpStatus: status,
            stopSource: true,
          });
        }
        if (status >= 500 && status <= 599) {
          throw new RssError("HTTP_5XX", {
            externalCalls: 1,
            httpStatus: status,
            nextAction: "next_slot",
          });
        }
        if (status !== 200)
          throw new RssError("HTTP_STATUS_REJECTED", {
            externalCalls: 1,
            httpStatus: status,
          });
        assertResponseEncoding(response);
        assertMime(response, ALLOWED_HTML_MIME_TYPES);
        const chunks: Buffer[] = [];
        let bytes = 0;
        let truncated = false;
        response.on("data", (chunk: Buffer | string) => {
          if (finishRequested || truncated) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (bytes + buffer.byteLength > RSS_MAX_HTML_BYTES) {
            chunks.push(buffer.subarray(0, RSS_MAX_HTML_BYTES - bytes));
            bytes = RSS_MAX_HTML_BYTES;
            truncated = true;
            terminateRejectedRssResponse(response);
            options.attempts?.noteSuccessfulResourceRead();
            succeed(Buffer.concat(chunks, bytes));
            return;
          }
          bytes += buffer.byteLength;
          chunks.push(buffer);
        });
        response.once("aborted", () => {
          if (!truncated)
            fail(
              new RssError("NETWORK_FAILURE", {
                externalCalls: 1,
                nextAction: "next_slot",
              }),
            );
        });
        response.once("error", fail);
        response.once("end", () => {
          if (finishRequested) return;
          options.attempts?.noteSuccessfulResourceRead();
          succeed(Buffer.concat(chunks, bytes));
        });
      } catch (error) {
        terminateRejectedRssResponse(response);
        fail(error);
      }
    };
    const request = options.trustedTransport
      ? options.trustedTransport.request(requestOptions, handleResponse)
      : httpsRequest(requestOptions, handleResponse);
    const onAbort = (): void => {
      activeResponse?.destroy();
      request.destroy();
      fail(abortError());
    };
    closeAck = new ResourceCloseAck(request);
    request.once("socket", (socket) => closeAck?.addSocket(socket));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = (): void =>
      options.signal?.removeEventListener("abort", onAbort);
    if (options.signal?.aborted) onAbort();

    const connectTimer = setTimeout(() => {
      request.destroy();
      fail(
        new RssError("CONNECT_TIMEOUT", {
          externalCalls: 1,
          nextAction: "next_slot",
        }),
      );
    }, 5000);
    timers.add(connectTimer);
    firstByteTimer = setTimeout(() => {
      request.destroy();
      fail(
        new RssError("FIRST_BYTE_TIMEOUT", {
          externalCalls: 1,
          nextAction: "next_slot",
        }),
      );
    }, 8000);
    timers.add(firstByteTimer);
    const totalTimer = setTimeout(
      () => {
        request.destroy();
        fail(
          options.deadlineAt !== undefined &&
            remainingDeadlineMs(options.deadlineAt) <= 0
            ? new RssError("BATCH_DEADLINE_EXCEEDED", {
                externalCalls: 1,
                nextAction: "next_slot",
              })
            : new RssError("TOTAL_TIMEOUT", {
                externalCalls: 1,
                nextAction: "next_slot",
              }),
        );
      },
      Math.max(
        1,
        Math.min(REQUEST_TIMEOUT_MS - elapsedBeforeRequest, remaining),
      ),
    );
    timers.add(totalTimer);
    request.once("socket", (socket) => {
      const connected = (): void => {
        clearTimeout(connectTimer);
        timers.delete(connectTimer);
      };
      if (socket.connecting) socket.once("secureConnect", connected);
      else connected();
    });
    request.once("error", fail);
    request.end();
  });

  return new TextDecoder("utf-8", { fatal: false }).decode(body);
}

async function fetchFixedRssCore(
  options: Readonly<{
    feedUrl?: string;
    validators: SourceValidators;
    env?: NodeJS.ProcessEnv;
    now?: Date;
    attempts?: RssAttemptLedger;
    deadlineAt?: number;
    signal?: AbortSignal;
    onNetworkAttempt?: () => void;
    trustedTransport?: RssTrustedTransportInjection;
  }>,
): Promise<RssHttpResponse> {
  const transportStartedAt = Date.now();
  const feedUrl = options.feedUrl ?? RSS_FEED_URL;
  const source = liveRssSourceByFeedUrl(feedUrl);
  if (source === null) throw new RssError("URL_REJECTED");
  assertFixedFeedUrl(feedUrl);
  const env = options.env ?? process.env;
  if (env.RSS_REAL_IO !== "true") throw new RssError("RSS_IO_DISABLED");
  assertNoProxyEnvironment(env);
  const requestEtag = safeRequestValidator(options.validators.etag);
  const requestLastModified = safeRequestValidator(
    options.validators.lastModified,
  );
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new RssError("RUN_STATE_INVALID");

  assertDeadline(options.deadlineAt);
  assertNotAborted(options.signal);
  options.onNetworkAttempt?.();
  const selected = await resolvePublicRssHost(
    source.feedHost,
    options.attempts,
    options.deadlineAt,
    options.signal,
    options.trustedTransport,
  );
  const elapsedBeforeRequest = Date.now() - transportStartedAt;
  const currentRequestTimeoutMs = 15_000;
  const remaining = remainingDeadlineMs(options.deadlineAt);
  if (
    elapsedBeforeRequest >=
      Math.min(REQUEST_TIMEOUT_MS, currentRequestTimeoutMs) ||
    remaining <= 0
  ) {
    throw new RssError(
      options.deadlineAt === undefined
        ? "TOTAL_TIMEOUT"
        : "BATCH_DEADLINE_EXCEEDED",
      { externalCalls: 1, nextAction: "next_slot" },
    );
  }

  return await new Promise<RssHttpResponse>((resolve, reject) => {
    let finishRequested = false;
    let closeAck: ResourceCloseAck | undefined;
    let activeResponse: IncomingMessage | undefined;
    let removeAbortListener = (): void => {};
    const timers = new Set<NodeJS.Timeout>();
    const clearTimers = (): void => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      removeAbortListener();
    };
    const succeed = (value: RssHttpResponse): void => {
      if (finishRequested) return;
      finishRequested = true;
      clearTimers();
      if (!closeAck) {
        reject(
          new RssError("NETWORK_FAILURE", {
            externalCalls: 1,
            nextAction: "next_slot",
          }),
        );
        return;
      }
      void closeAck.wait(null).then(() => resolve(value), reject);
    };
    const fail = (error: unknown): void => {
      if (finishRequested) return;
      finishRequested = true;
      clearTimers();
      const mapped = mapNetworkError(error);
      activeResponse?.destroy();
      if (!closeAck) {
        reject(mapped);
        return;
      }
      void closeAck.wait(mapped).then(() => reject(mapped), reject);
    };

    const headers: Record<string, string> = {
      Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      "Accept-Encoding": "identity",
      "User-Agent": "F1Plus1-RSS-REAL-001/1.0",
    };
    if (requestEtag !== null) headers["If-None-Match"] = requestEtag;
    if (requestLastModified !== null)
      headers["If-Modified-Since"] = requestLastModified;

    const pinnedLookup = createPinnedRssLookup(selected);

    let firstByteTimer: NodeJS.Timeout | undefined;
    const requestOptions: RequestOptions = {
      protocol: "https:",
      hostname: source.feedHost,
      port: 443,
      method: "GET",
      path: source.feedPath,
      servername: source.feedHost,
      agent: false,
      headers,
      lookup: pinnedLookup,
    };
    options.attempts?.noteHttpAttempt();
    const request = options.trustedTransport?.request
      ? options.trustedTransport.request(requestOptions, (response) => {
          activeResponse = response;
          closeAck?.addResponse(response);
          if (firstByteTimer) {
            clearTimeout(firstByteTimer);
            timers.delete(firstByteTimer);
          }
          const status = response.statusCode ?? 0;
          try {
            if (status >= 300 && status <= 399 && status !== 304)
              throw new RssError("REDIRECT_REJECTED", {
                externalCalls: 1,
                httpStatus: status,
              });
            if (status === 304) {
              const validators = responseValidators(response);
              terminateRejectedRssResponse(response);
              options.attempts?.noteSuccessfulResourceRead();
              succeed({
                kind: "not_modified",
                statusCode: 304,
                responseBytes: 0,
                responseSha256: null,
                validators,
                validatorCapability: validatorCapability(validators),
              });
              return;
            }
            if (status !== 200)
              throw new RssError(
                status === 404 ? "HTTP_STOP_STATUS" : "HTTP_STATUS_REJECTED",
                {
                  externalCalls: 1,
                  httpStatus: status,
                  stopSource: status === 404,
                },
              );
            assertResponseEncoding(response);
            assertDeclaredLength(response);
            assertMime(response);
            const validators = responseValidators(response);
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on("data", (chunk: Buffer | string) => {
              if (finishRequested) return;
              const buffer = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk);
              bytes += buffer.byteLength;
              if (bytes > RSS_MAX_RESPONSE_BYTES) {
                terminateRejectedRssResponse(response);
                fail(
                  new RssError("RESPONSE_TOO_LARGE", {
                    externalCalls: 1,
                    httpStatus: 200,
                  }),
                );
                return;
              }
              chunks.push(buffer);
            });
            response.once("aborted", () =>
              fail(
                new RssError("NETWORK_FAILURE", {
                  externalCalls: 1,
                  nextAction: "next_slot",
                }),
              ),
            );
            response.once("error", fail);
            response.once("end", () => {
              if (finishRequested) return;
              const body = Buffer.concat(chunks, bytes);
              options.attempts?.noteSuccessfulResourceRead();
              succeed({
                kind: "modified",
                statusCode: 200,
                body,
                responseBytes: bytes,
                responseSha256: createHash("sha256").update(body).digest("hex"),
                validators,
                validatorCapability: validatorCapability(validators),
              });
            });
          } catch (error) {
            terminateRejectedRssResponse(response);
            fail(error);
          }
        })
      : httpsRequest(requestOptions, (response) => {
          activeResponse = response;
          closeAck?.addResponse(response);
          if (firstByteTimer) {
            clearTimeout(firstByteTimer);
            timers.delete(firstByteTimer);
          }
          const status = response.statusCode ?? 0;
          try {
            if (status >= 300 && status <= 399 && status !== 304)
              throw new RssError("REDIRECT_REJECTED", {
                externalCalls: 1,
                httpStatus: status,
              });
            if (status === 429) {
              const retryAfterSeconds = parseRetryAfter(
                response.headers["retry-after"],
                now,
              );
              throw new RssError("HTTP_429", {
                externalCalls: 1,
                httpStatus: status,
                retryAfterSeconds,
                nextAction: "next_slot",
              });
            }
            if (status === 401 || status === 403 || status === 404) {
              throw new RssError("HTTP_STOP_STATUS", {
                externalCalls: 1,
                httpStatus: status,
                stopSource: true,
              });
            }
            if (status >= 500 && status <= 599) {
              throw new RssError("HTTP_5XX", {
                externalCalls: 1,
                httpStatus: status,
                nextAction: "next_slot",
              });
            }
            if (status === 304) {
              const validators = responseValidators(response);
              terminateRejectedRssResponse(response);
              options.attempts?.noteSuccessfulResourceRead();
              succeed({
                kind: "not_modified",
                statusCode: 304,
                responseBytes: 0,
                responseSha256: null,
                validators,
                validatorCapability: validatorCapability(validators),
              });
              return;
            }
            if (status !== 200)
              throw new RssError("HTTP_STATUS_REJECTED", {
                externalCalls: 1,
                httpStatus: status,
              });
            assertResponseEncoding(response);
            assertDeclaredLength(response);
            assertMime(response);
            const validators = responseValidators(response);
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on("data", (chunk: Buffer | string) => {
              if (finishRequested) return;
              const buffer = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk);
              bytes += buffer.byteLength;
              if (bytes > RSS_MAX_RESPONSE_BYTES) {
                terminateRejectedRssResponse(response);
                fail(
                  new RssError("RESPONSE_TOO_LARGE", {
                    externalCalls: 1,
                    httpStatus: 200,
                  }),
                );
                return;
              }
              chunks.push(buffer);
            });
            response.once("aborted", () =>
              fail(
                new RssError("NETWORK_FAILURE", {
                  externalCalls: 1,
                  nextAction: "next_slot",
                }),
              ),
            );
            response.once("error", fail);
            response.once("end", () => {
              if (finishRequested) return;
              const body = Buffer.concat(chunks, bytes);
              options.attempts?.noteSuccessfulResourceRead();
              succeed({
                kind: "modified",
                statusCode: 200,
                body,
                responseBytes: bytes,
                responseSha256: createHash("sha256").update(body).digest("hex"),
                validators,
                validatorCapability: validatorCapability(validators),
              });
            });
          } catch (error) {
            terminateRejectedRssResponse(response);
            fail(error);
          }
        });
    const onAbort = (): void => {
      activeResponse?.destroy();
      request.destroy();
      fail(abortError());
    };
    closeAck = new ResourceCloseAck(request);
    request.once("socket", (socket) => closeAck?.addSocket(socket));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = (): void =>
      options.signal?.removeEventListener("abort", onAbort);
    if (options.signal?.aborted) onAbort();

    const connectTimer = setTimeout(() => {
      request.destroy();
      fail(
        new RssError("CONNECT_TIMEOUT", {
          externalCalls: 1,
          nextAction: "next_slot",
        }),
      );
    }, 5000);
    timers.add(connectTimer);
    firstByteTimer = setTimeout(() => {
      request.destroy();
      fail(
        new RssError("FIRST_BYTE_TIMEOUT", {
          externalCalls: 1,
          nextAction: "next_slot",
        }),
      );
    }, 8000);
    timers.add(firstByteTimer);
    const totalTimer = setTimeout(
      () => {
        request.destroy();
        fail(
          options.deadlineAt !== undefined &&
            remainingDeadlineMs(options.deadlineAt) <= 0
            ? new RssError("BATCH_DEADLINE_EXCEEDED", {
                externalCalls: 1,
                nextAction: "next_slot",
              })
            : new RssError("TOTAL_TIMEOUT", {
                externalCalls: 1,
                nextAction: "next_slot",
              }),
        );
      },
      Math.max(
        1,
        Math.min(
          Math.min(REQUEST_TIMEOUT_MS, currentRequestTimeoutMs) -
            elapsedBeforeRequest,
          remaining,
        ),
      ),
    );
    timers.add(totalTimer);
    request.once("socket", (socket) => {
      const connected = (): void => {
        clearTimeout(connectTimer);
        timers.delete(connectTimer);
      };
      if (socket.connecting) socket.once("secureConnect", connected);
      else connected();
    });
    request.once("error", fail);
    request.end();
  });
}

type ArticleTransportOptions = Readonly<{
  articleUrl: string;
  sourceId: LiveRssSourceId;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  attempts?: RssAttemptLedger;
  deadlineAt?: number;
  signal?: AbortSignal;
  onNetworkAttempt?: () => void;
  trustedTransport?: RssTrustedTransportInjection;
  externalAttempt?: RssExternalAttemptRunner;
  externalAttemptOperationId?: string;
  externalIdempotencyKey?: string;
  reconcileKey?: string;
}>;

type FeedTransportOptions = Readonly<{
  feedUrl?: string;
  validators: SourceValidators;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  attempts?: RssAttemptLedger;
  deadlineAt?: number;
  signal?: AbortSignal;
  onNetworkAttempt?: () => void;
  trustedTransport?: RssTrustedTransportInjection;
  externalAttempt?: RssExternalAttemptRunner;
  externalAttemptOperationId?: string;
  externalIdempotencyKey?: string;
  reconcileKey?: string;
}>;

function responseForRssAttempt(
  providerResourceIdentity: string,
  status: number,
  body: Uint8Array | string,
): ClosedExternalResponse {
  const responseBodySha256 = createHash("sha256")
    .update(typeof body === "string" ? body : body)
    .digest("hex");
  return {
    providerResourceIdentity,
    providerStatus: String(status),
    responseBodySha256,
    responseHeaderHashes: [],
    outcome: status >= 200 && status < 500 ? "succeeded" : "known_failed",
    reasonCode: status >= 200 && status < 500 ? null : "RSS_HTTP_STATUS",
  };
}

function preflightArticle(options: ArticleTransportOptions): void {
  assertAllowlistedArticleUrl(options.articleUrl, options.sourceId);
  const env = options.env ?? process.env;
  if (env.RSS_REAL_IO !== "true") throw new RssError("RSS_IO_DISABLED");
  assertNoProxyEnvironment(env);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new RssError("RUN_STATE_INVALID");
  assertDeadline(options.deadlineAt);
  assertNotAborted(options.signal);
}

function preflightFeed(options: FeedTransportOptions): {
  source: ReturnType<typeof liveRssSource>;
} {
  const feedUrl = options.feedUrl ?? RSS_FEED_URL;
  const source = liveRssSourceByFeedUrl(feedUrl);
  if (source === null) throw new RssError("URL_REJECTED");
  assertFixedFeedUrl(feedUrl);
  const env = options.env ?? process.env;
  if (env.RSS_REAL_IO !== "true") throw new RssError("RSS_IO_DISABLED");
  assertNoProxyEnvironment(env);
  safeRequestValidator(options.validators.etag);
  safeRequestValidator(options.validators.lastModified);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new RssError("RUN_STATE_INVALID");
  assertDeadline(options.deadlineAt);
  assertNotAborted(options.signal);
  return { source };
}

export async function fetchAllowlistedArticleHtml(
  options: ArticleTransportOptions,
): Promise<string> {
  preflightArticle(options);
  const coreOptions = { ...options };
  delete (coreOptions as { externalAttempt?: RssExternalAttemptRunner })
    .externalAttempt;
  delete (coreOptions as { externalAttemptOperationId?: string })
    .externalAttemptOperationId;
  delete (coreOptions as { externalIdempotencyKey?: string })
    .externalIdempotencyKey;
  delete (coreOptions as { reconcileKey?: string }).reconcileKey;
  if (!options.externalAttempt)
    return fetchAllowlistedArticleHtmlCore(coreOptions);
  const operationId =
    options.externalAttemptOperationId ??
    `rss-article-${createHash("sha256").update(`${options.sourceId}\n${options.articleUrl}`).digest("hex")}`;
  return options.externalAttempt({
    operationId,
    operationKind: "collect",
    ownerProcess: "rss_collector",
    endpointClass: "rss_fetch",
    providerResource: options.articleUrl,
    routeId: "route-rss",
    method: "GET",
    externalIdempotencyKey:
      options.externalIdempotencyKey ??
      `rss:article:${options.sourceId}:${options.articleUrl}`,
    reconcileKey:
      options.reconcileKey ??
      `reconcile:rss:article:${options.sourceId}:${options.articleUrl}`,
    identity: {
      sourceId: options.sourceId,
      candidateId: null,
      publicationId: null,
      publicId: null,
    },
    entityKind: "source",
    entityId: options.sourceId,
    egressClass: "rss_https",
    execute: async () => {
      const value = await fetchAllowlistedArticleHtmlCore(coreOptions);
      return {
        value,
        response: responseForRssAttempt(options.articleUrl, 200, value),
      };
    },
  });
}

export async function fetchFixedRss(
  options: FeedTransportOptions,
): Promise<RssHttpResponse> {
  const { source } = preflightFeed(options);
  const coreOptions = { ...options };
  delete (coreOptions as { externalAttempt?: RssExternalAttemptRunner })
    .externalAttempt;
  delete (coreOptions as { externalAttemptOperationId?: string })
    .externalAttemptOperationId;
  delete (coreOptions as { externalIdempotencyKey?: string })
    .externalIdempotencyKey;
  delete (coreOptions as { reconcileKey?: string }).reconcileKey;
  if (!options.externalAttempt) return fetchFixedRssCore(coreOptions);
  const feedUrl = options.feedUrl ?? RSS_FEED_URL;
  const operationId =
    options.externalAttemptOperationId ??
    `rss-fetch-${createHash("sha256").update(`${source.sourceId}\n${feedUrl}`).digest("hex")}`;
  return options.externalAttempt({
    operationId,
    operationKind: "collect",
    ownerProcess: "rss_collector",
    endpointClass: "rss_fetch",
    providerResource: source.sourceId,
    routeId: "route-rss",
    method: "GET",
    externalIdempotencyKey:
      options.externalIdempotencyKey ??
      `rss:feed:${source.sourceId}:${feedUrl}`,
    reconcileKey:
      options.reconcileKey ??
      `reconcile:rss:feed:${source.sourceId}:${feedUrl}`,
    identity: {
      sourceId: source.sourceId,
      candidateId: null,
      publicationId: null,
      publicId: null,
    },
    entityKind: "source",
    entityId: source.sourceId,
    egressClass: "rss_https",
    execute: async () => {
      const value = await fetchFixedRssCore(coreOptions);
      const bytes = value.kind === "modified" ? value.body : new Uint8Array();
      return {
        value,
        response: responseForRssAttempt(
          source.sourceId,
          value.statusCode,
          bytes,
        ),
      };
    },
  });
}
