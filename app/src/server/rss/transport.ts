import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";

import {
  RSS_FEED_HOST,
  RSS_FEED_PATH,
  RSS_FEED_URL,
  RSS_MAX_RESPONSE_BYTES,
  RssError,
  type RssHttpResponse,
  type SourceValidators
} from "./types.ts";

const ALLOWED_MIME_TYPES = new Set(["application/rss+xml", "application/xml", "text/xml"]);
const PROXY_ENV_KEYS = [
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "FTP_PROXY",
  "http_proxy", "https_proxy", "all_proxy", "ftp_proxy"
] as const;

function ipv4Number(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
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
    [0xf0000000, 4]
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
    const parsed = parts.map((part) => /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : Number.NaN);
    return parsed.some((part) => !Number.isInteger(part)) ? null : parsed;
  };
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array.from({ length: missing }, () => 0), ...right];
  if (words.length !== 8) return null;
  const bytes = new Uint8Array(16);
  words.forEach((word, index) => {
    bytes[index * 2] = word >>> 8;
    bytes[index * 2 + 1] = word & 0xff;
  });
  return bytes;
}

function matchesIpv6Prefix(address: Uint8Array, prefixAddress: string, prefixBits: number): boolean {
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
  ["2620:4f:8000::", 48]
];

function isPublicIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (!bytes || (bytes[0] & 0xe0) !== 0x20) return false;
  return !DENIED_IPV6_PREFIXES.some(([prefix, bits]) => matchesIpv6Prefix(bytes, prefix, bits));
}

export function isPublicRssAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export function assertFixedFeedUrl(value: string): URL {
  if (value !== RSS_FEED_URL) throw new RssError("URL_REJECTED");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RssError("URL_REJECTED");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== RSS_FEED_HOST ||
    url.pathname !== RSS_FEED_PATH ||
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

export function terminateRejectedRssResponse(response: DestroyableRssResponse): void {
  response.destroy();
}

export function createPinnedRssLookup(selected: Readonly<{
  address: string;
  family: number;
}>): NonNullable<RequestOptions["lookup"]> {
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
  if (PROXY_ENV_KEYS.some((key) => typeof env[key] === "string" && env[key] !== "")) {
    throw new RssError("PROXY_ENV_FORBIDDEN");
  }
}

function safeHeader(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value) || Buffer.byteLength(value, "utf8") > 1024 || /[\u0000\r\n]/.test(value)) {
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
    lastModified: safeHeader(response.headers["last-modified"])
  };
}

function validatorCapability(validators: SourceValidators): "supported" | "unknown" {
  return validators.etag !== null || validators.lastModified !== null ? "supported" : "unknown";
}

function parseRetryAfter(value: string | string[] | undefined, now: Date): number {
  if (Array.isArray(value) || typeof value !== "string" || value.trim() === "") {
    throw new RssError("RETRY_AFTER_INVALID", { externalCalls: 1, httpStatus: 429 });
  }
  let seconds: number;
  if (/^[0-9]+$/.test(value.trim())) {
    seconds = Number(value.trim());
  } else {
    const date = Date.parse(value);
    if (!Number.isFinite(date)) throw new RssError("RETRY_AFTER_INVALID", { externalCalls: 1, httpStatus: 429 });
    seconds = Math.ceil((date - now.getTime()) / 1000);
  }
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RssError("RETRY_AFTER_INVALID", { externalCalls: 1, httpStatus: 429 });
  }
  return Math.min(3600, Math.max(60, Math.trunc(seconds)));
}

function assertMime(response: IncomingMessage): void {
  const raw = response.headers["content-type"];
  if (Array.isArray(raw) || typeof raw !== "string") {
    throw new RssError("MIME_REJECTED", { externalCalls: 1, httpStatus: 200 });
  }
  const [mime, ...parameters] = raw.split(";").map((part) => part.trim().toLowerCase());
  if (!ALLOWED_MIME_TYPES.has(mime)) throw new RssError("MIME_REJECTED", { externalCalls: 1, httpStatus: 200 });
  for (const parameter of parameters) {
    if (parameter.startsWith("charset=") && !/^charset=(?:"?utf-8"?)$/.test(parameter)) {
      throw new RssError("MIME_REJECTED", { externalCalls: 1, httpStatus: 200 });
    }
  }
}

function assertResponseEncoding(response: IncomingMessage): void {
  const value = response.headers["content-encoding"];
  if (Array.isArray(value) || (typeof value === "string" && value.trim().toLowerCase() !== "identity")) {
    throw new RssError("CONTENT_ENCODING_REJECTED", { externalCalls: 1, httpStatus: 200 });
  }
}

function assertDeclaredLength(response: IncomingMessage): void {
  const value = response.headers["content-length"];
  if (value === undefined) return;
  if (Array.isArray(value) || !/^[0-9]+$/.test(value)) {
    throw new RssError("RESPONSE_SIZE_INVALID", { externalCalls: 1, httpStatus: 200 });
  }
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes)) throw new RssError("RESPONSE_SIZE_INVALID", { externalCalls: 1, httpStatus: 200 });
  if (bytes > RSS_MAX_RESPONSE_BYTES) throw new RssError("RESPONSE_TOO_LARGE", { externalCalls: 1, httpStatus: 200 });
}

function mapNetworkError(error: unknown): RssError {
  if (error instanceof RssError) return error;
  const code = String((error as { code?: unknown }).code ?? "");
  if (/CERT|TLS|SSL|ALTNAME|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
    return new RssError("TLS_REJECTED", { externalCalls: 1 });
  }
  return new RssError("NETWORK_FAILURE", { externalCalls: 1, nextAction: "next_slot" });
}

export async function fetchFixedRss(options: Readonly<{
  feedUrl?: string;
  validators: SourceValidators;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  onNetworkAttempt?: () => void;
}>): Promise<RssHttpResponse> {
  const transportStartedAt = Date.now();
  const feedUrl = options.feedUrl ?? RSS_FEED_URL;
  assertFixedFeedUrl(feedUrl);
  const env = options.env ?? process.env;
  if (env.RSS_REAL_IO !== "true") throw new RssError("RSS_IO_DISABLED");
  assertNoProxyEnvironment(env);
  const requestEtag = safeRequestValidator(options.validators.etag);
  const requestLastModified = safeRequestValidator(options.validators.lastModified);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new RssError("RUN_STATE_INVALID");

  options.onNetworkAttempt?.();
  let addresses: Array<{ address: string; family: number }>;
  try {
    let dnsTimer: NodeJS.Timeout | undefined;
    try {
      addresses = await Promise.race([
        dnsLookup(RSS_FEED_HOST, { all: true, verbatim: true }),
        new Promise<never>((_resolve, reject) => {
          dnsTimer = setTimeout(
            () => reject(new RssError("CONNECT_TIMEOUT", { externalCalls: 1, nextAction: "next_slot" })),
            3000
          );
        })
      ]);
    } finally {
      if (dnsTimer) clearTimeout(dnsTimer);
    }
  } catch (error) {
    if (error instanceof RssError) throw error;
    throw new RssError("DNS_FAILURE", { externalCalls: 1, nextAction: "next_slot" });
  }
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some((entry) => !isPublicRssAddress(entry.address))) {
    throw new RssError("DNS_REJECTED", { externalCalls: 1 });
  }
  const selected = addresses[0];
  const elapsedBeforeRequest = Date.now() - transportStartedAt;
  if (elapsedBeforeRequest >= 10_000) {
    throw new RssError("TOTAL_TIMEOUT", { externalCalls: 1, nextAction: "next_slot" });
  }

  return await new Promise<RssHttpResponse>((resolve, reject) => {
    let settled = false;
    const timers = new Set<NodeJS.Timeout>();
    const clearTimers = (): void => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
    const succeed = (value: RssHttpResponse): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(mapNetworkError(error));
    };

    const headers: Record<string, string> = {
      Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      "Accept-Encoding": "identity",
      "User-Agent": "F1Plus1-RSS-REAL-001/1.0"
    };
    if (requestEtag !== null) headers["If-None-Match"] = requestEtag;
    if (requestLastModified !== null) headers["If-Modified-Since"] = requestLastModified;

    const pinnedLookup = createPinnedRssLookup(selected);

    let firstByteTimer: NodeJS.Timeout | undefined;
    const requestOptions: RequestOptions & { autoSelectFamily: false } = {
      protocol: "https:",
      hostname: RSS_FEED_HOST,
      port: 443,
      method: "GET",
      path: RSS_FEED_PATH,
      servername: RSS_FEED_HOST,
      agent: false,
      autoSelectFamily: false,
      headers,
      lookup: pinnedLookup
    };
    const request = httpsRequest(requestOptions, (response) => {
      if (firstByteTimer) {
        clearTimeout(firstByteTimer);
        timers.delete(firstByteTimer);
      }
      const status = response.statusCode ?? 0;
      try {
        if (status >= 300 && status <= 399 && status !== 304) throw new RssError("REDIRECT_REJECTED", { externalCalls: 1, httpStatus: status });
        if (status === 429) {
          const retryAfterSeconds = parseRetryAfter(response.headers["retry-after"], now);
          throw new RssError("HTTP_429", {
            externalCalls: 1,
            httpStatus: status,
            retryAfterSeconds,
            nextAction: "next_slot"
          });
        }
        if (status === 401 || status === 403 || status === 404) {
          throw new RssError("HTTP_STOP_STATUS", { externalCalls: 1, httpStatus: status, stopSource: true });
        }
        if (status >= 500 && status <= 599) {
          throw new RssError("HTTP_5XX", { externalCalls: 1, httpStatus: status, nextAction: "next_slot" });
        }
        if (status === 304) {
          const validators = responseValidators(response);
          terminateRejectedRssResponse(response);
          succeed({
            kind: "not_modified",
            statusCode: 304,
            responseBytes: 0,
            responseSha256: null,
            validators,
            validatorCapability: validatorCapability(validators)
          });
          return;
        }
        if (status !== 200) throw new RssError("HTTP_STATUS_REJECTED", { externalCalls: 1, httpStatus: status });
        assertResponseEncoding(response);
        assertDeclaredLength(response);
        assertMime(response);
        const validators = responseValidators(response);
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > RSS_MAX_RESPONSE_BYTES) {
            terminateRejectedRssResponse(response);
            fail(new RssError("RESPONSE_TOO_LARGE", { externalCalls: 1, httpStatus: 200 }));
            return;
          }
          chunks.push(buffer);
        });
        response.once("aborted", () => fail(new RssError("NETWORK_FAILURE", { externalCalls: 1, nextAction: "next_slot" })));
        response.once("error", fail);
        response.once("end", () => {
          if (settled) return;
          const body = Buffer.concat(chunks, bytes);
          succeed({
            kind: "modified",
            statusCode: 200,
            body,
            responseBytes: bytes,
            responseSha256: createHash("sha256").update(body).digest("hex"),
            validators,
            validatorCapability: validatorCapability(validators)
          });
        });
      } catch (error) {
        terminateRejectedRssResponse(response);
        fail(error);
      }
    });

    const connectTimer = setTimeout(() => {
      request.destroy();
      fail(new RssError("CONNECT_TIMEOUT", { externalCalls: 1, nextAction: "next_slot" }));
    }, 3000);
    timers.add(connectTimer);
    firstByteTimer = setTimeout(() => {
      request.destroy();
      fail(new RssError("FIRST_BYTE_TIMEOUT", { externalCalls: 1, nextAction: "next_slot" }));
    }, 5000);
    timers.add(firstByteTimer);
    const totalTimer = setTimeout(() => {
      request.destroy();
      fail(new RssError("TOTAL_TIMEOUT", { externalCalls: 1, nextAction: "next_slot" }));
    }, Math.max(1, 10_000 - elapsedBeforeRequest));
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
