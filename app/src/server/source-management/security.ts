import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { canonicalSourceJson } from "../providers/source-fixture.ts";
import { AdminError } from "./types.ts";

const SESSION_COOKIE = "f1_local_admin_session";
const SESSION_ABSOLUTE_MS = 30 * 60 * 1000;
const SESSION_IDLE_MS = 10 * 60 * 1000;
const CSRF_TTL_MS = 5 * 60 * 1000;
const TOMBSTONE_MS = 10 * 60 * 1000;
const MAX_CSRF = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type RandomBytes = (size: number) => Buffer;
type Clock = () => number;

export type RawAdminContext = Readonly<{
  method: string;
  path: string;
  authority: string;
  origin: string | null;
  peer: "loopback";
  rawHeaders: ReadonlyMap<string, readonly string[]>;
  noEgressReady: true;
}>;

type ActiveSession = {
  digest: Buffer;
  absoluteExpiry: number;
  idleExpiry: number;
};

type Nonce = {
  digest: Buffer;
  sessionDigestHex: string;
  method: string;
  path: string;
  bodyHash: string;
  issuedAt: number;
  expiresAt: number;
  state: "issued" | "consumed" | "expired";
};

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function rawHeaderMap(rawHeaders: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = String(rawHeaders[index] ?? "").toLowerCase();
    const value = String(rawHeaders[index + 1] ?? "");
    const values = map.get(name) ?? [];
    values.push(value);
    map.set(name, values);
  }
  return map;
}

export function singleRawHeader(context: RawAdminContext, name: string): string | null {
  const values = context.rawHeaders.get(name.toLowerCase()) ?? [];
  return values.length === 1 ? values[0] : null;
}

function normalizedPeer(value: string | undefined): "loopback" | null {
  if (value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1") return "loopback";
  return null;
}

function requiresOrigin(method: string, path: string): boolean {
  return method === "POST" || method === "DELETE" || path === "/api/admin/csrf";
}

export function assertRawAdminRequest(
  request: IncomingMessage,
  canonicalOrigin: string,
  noEgressReady: boolean
): RawAdminContext {
  const rawHeaders = rawHeaderMap(request.rawHeaders);
  const peer = normalizedPeer(request.socket.remoteAddress);
  if (!peer) throw new AdminError("ADMIN_PEER_DENIED", 403);
  const target = request.url ?? "";
  if (request.httpVersion !== "1.1" || !target.startsWith("/") || target.startsWith("//") || target.includes("#")) {
    throw new AdminError("ADMIN_HOST_DENIED", 403);
  }
  const queryIndex = target.indexOf("?");
  const rawPath = queryIndex === -1 ? target : target.slice(0, queryIndex);
  if (
    rawPath.includes("\\") || rawPath.includes("%") ||
    rawPath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new AdminError("ADMIN_HOST_DENIED", 403);
  }
  const hosts = rawHeaders.get("host") ?? [];
  const authorities = rawHeaders.get(":authority") ?? [];
  const expectedAuthority = new URL(canonicalOrigin).host;
  if (
    hosts.length !== 1 || authorities.length !== 0 || hosts[0] !== expectedAuthority ||
    hosts[0].trim() !== hosts[0] || hosts[0].includes(",")
  ) {
    throw new AdminError("ADMIN_HOST_DENIED", 403);
  }
  for (const name of rawHeaders.keys()) {
    if (name === "forwarded" || name.startsWith("x-forwarded-") || name === "x-real-ip") {
      throw new AdminError("ADMIN_PROXY_HEADER_DENIED", 403);
    }
  }
  const method = String(request.method ?? "GET").toUpperCase();
  const path = new URL(target, canonicalOrigin).pathname;
  if (path !== rawPath) throw new AdminError("ADMIN_HOST_DENIED", 403);
  const origins = rawHeaders.get("origin") ?? [];
  if (requiresOrigin(method, path) && origins.length === 0) throw new AdminError("ADMIN_ORIGIN_REQUIRED", 403);
  if (origins.length > 1 || (origins.length === 1 && origins[0] !== canonicalOrigin)) {
    throw new AdminError("ADMIN_ORIGIN_DENIED", 403);
  }
  if (!noEgressReady) throw new AdminError("ADMIN_NO_EGRESS_REQUIRED", 503);
  return Object.freeze({
    method,
    path,
    authority: hosts[0],
    origin: origins[0] ?? null,
    peer,
    rawHeaders,
    noEgressReady: true as const
  });
}

function parseCookie(header: string | null): string | null {
  if (header === null) return null;
  const matches = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(SESSION_COOKIE.length + 1);
  return TOKEN_PATTERN.test(value) ? value : null;
}

export class AdminSessionStore {
  private active: ActiveSession | null = null;
  private unclaimed: Buffer | null;
  private readonly nonces = new Map<string, Nonce>();
  private lastNow = -Infinity;
  private readonly now: Clock;
  private readonly randomBytes: RandomBytes;

  constructor(
    now: Clock = () => performance.now(),
    randomBytes: RandomBytes = nodeRandomBytes
  ) {
    this.now = now;
    this.randomBytes = randomBytes;
    this.unclaimed = this.randomMaterial(32);
  }

  private randomMaterial(size: number): Buffer {
    let bytes: Buffer;
    try {
      bytes = this.randomBytes(size);
    } catch {
      throw new AdminError("ADMIN_INTERNAL_FAILURE", 500);
    }
    if (bytes.byteLength !== size) throw new AdminError("ADMIN_INTERNAL_FAILURE", 500);
    return bytes;
  }

  private time(): number {
    const value = this.now();
    if (!Number.isFinite(value) || value < this.lastNow) {
      this.active = null;
      this.nonces.clear();
      throw new AdminError("ADMIN_CLOCK_INVALID", 500);
    }
    this.lastNow = value;
    return value;
  }

  private cleanup(now: number): void {
    for (const [key, nonce] of this.nonces) {
      if (nonce.state === "issued" && now > nonce.expiresAt) nonce.state = "expired";
      if (now > nonce.expiresAt + TOMBSTONE_MS) this.nonces.delete(key);
    }
    if (this.active && (now > this.active.absoluteExpiry || now > this.active.idleExpiry)) {
      this.active = null;
      this.nonces.clear();
    }
  }

  private token(size = 32): string {
    const bytes = this.randomMaterial(size);
    const value = bytes.toString("base64url");
    bytes.fill(0);
    if (!TOKEN_PATTERN.test(value)) throw new AdminError("ADMIN_INTERNAL_FAILURE", 500);
    return value;
  }

  private sessionFor(cookieHeader: string | null): { session: ActiveSession; now: number } {
    const now = this.time();
    this.cleanup(now);
    if (!this.active) throw new AdminError("ADMIN_SESSION_REQUIRED", 401);
    const token = parseCookie(cookieHeader);
    if (!token || !sameDigest(digest(token), this.active.digest)) throw new AdminError("ADMIN_SESSION_REQUIRED", 401);
    return { session: this.active, now };
  }

  create(cookieHeader: string | null): { status: 200 | 201; setCookie?: string } {
    const now = this.time();
    this.cleanup(now);
    if (this.active) {
      const token = parseCookie(cookieHeader);
      if (token && sameDigest(digest(token), this.active.digest)) return { status: 200 };
      throw new AdminError("ADMIN_SESSION_ALREADY_ACTIVE", 409);
    }
    if (!this.unclaimed) throw new AdminError("ADMIN_INTERNAL_FAILURE", 500);
    const token = this.unclaimed.toString("base64url");
    this.unclaimed.fill(0);
    this.unclaimed = null;
    if (!TOKEN_PATTERN.test(token)) throw new AdminError("ADMIN_INTERNAL_FAILURE", 500);
    this.active = { digest: digest(token), absoluteExpiry: now + SESSION_ABSOLUTE_MS, idleExpiry: now + SESSION_IDLE_MS };
    return { status: 201, setCookie: this.cookie(token, SESSION_ABSOLUTE_MS) };
  }

  get(cookieHeader: string | null): { state: "active"; absolute_expires_in_seconds: number; idle_expires_in_seconds: number } {
    const { session, now } = this.sessionFor(cookieHeader);
    return {
      state: "active",
      absolute_expires_in_seconds: Math.max(0, Math.floor((session.absoluteExpiry - now) / 1000)),
      idle_expires_in_seconds: Math.max(0, Math.floor((session.idleExpiry - now) / 1000))
    };
  }

  issueCsrf(
    cookieHeader: string | null,
    binding: { body_sha256: string; method: string; path: string },
    registeredMutationPaths: ReadonlySet<string>
  ): { csrf_token: string; expires_in_seconds: 300; method: string; path: string } {
    const { session, now } = this.sessionFor(cookieHeader);
    this.cleanup(now);
    const issued = [...this.nonces.values()].filter((nonce) => nonce.state === "issued" && nonce.expiresAt >= now);
    if (issued.length >= MAX_CSRF) throw new AdminError("ADMIN_CSRF_CAPACITY", 429);
    if (
      (binding.method !== "POST" && binding.method !== "DELETE") ||
      !registeredMutationPaths.has(binding.path) ||
      !/^\/[A-Za-z0-9_./{}-]+$/.test(binding.path) ||
      !/^[a-f0-9]{64}$/.test(binding.body_sha256)
    ) {
      throw new AdminError("ADMIN_CSRF_INVALID", 422);
    }
    const token = this.token();
    const tokenDigest = digest(token);
    this.nonces.set(tokenDigest.toString("hex"), {
      digest: tokenDigest,
      sessionDigestHex: session.digest.toString("hex"),
      method: binding.method,
      path: binding.path,
      bodyHash: binding.body_sha256,
      issuedAt: now,
      expiresAt: now + CSRF_TTL_MS,
      state: "issued"
    });
    return { csrf_token: token, expires_in_seconds: 300, method: binding.method, path: binding.path };
  }

  consumeCsrf(
    cookieHeader: string | null,
    tokenHeader: string | null,
    binding: { method: string; path: string; bodyHash: string }
  ): void {
    const { session, now } = this.sessionFor(cookieHeader);
    if (!tokenHeader || !TOKEN_PATTERN.test(tokenHeader)) throw new AdminError("ADMIN_CSRF_INVALID", 403);
    const key = digest(tokenHeader).toString("hex");
    const nonce = this.nonces.get(key);
    if (!nonce) throw new AdminError("ADMIN_CSRF_INVALID", 403);
    if (nonce.state === "consumed") throw new AdminError("ADMIN_CSRF_REPLAY", 403);
    if (nonce.state === "expired" || now > nonce.expiresAt) {
      nonce.state = "expired";
      throw new AdminError("ADMIN_CSRF_EXPIRED", 403);
    }
    if (
      nonce.sessionDigestHex !== session.digest.toString("hex") || nonce.method !== binding.method ||
      nonce.path !== binding.path || nonce.bodyHash !== binding.bodyHash
    ) {
      throw new AdminError("ADMIN_CSRF_BINDING_MISMATCH", 403);
    }
    nonce.state = "consumed";
  }

  refresh(cookieHeader: string | null): { setCookie: string } {
    const { session, now } = this.sessionFor(cookieHeader);
    const token = this.token();
    this.active = { digest: digest(token), absoluteExpiry: session.absoluteExpiry, idleExpiry: Math.min(session.absoluteExpiry, now + SESSION_IDLE_MS) };
    this.nonces.clear();
    return { setCookie: this.cookie(token, Math.max(0, session.absoluteExpiry - now)) };
  }

  destroy(cookieHeader: string | null): { setCookie: string } {
    this.sessionFor(cookieHeader);
    this.active = null;
    this.nonces.clear();
    return { setCookie: `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` };
  }

  private cookie(token: string, maxAgeMs: number): string {
    return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`;
  }

  activeCount(): number {
    const now = this.time();
    this.cleanup(now);
    return this.active ? 1 : 0;
  }
}

export function canonicalBodyHash(parsed: unknown, rawBody: string): string {
  if (canonicalSourceJson(parsed) !== rawBody) throw new AdminError("ADMIN_BODY_INVALID", 422);
  return createHash("sha256").update(Buffer.from(rawBody, "utf8")).digest("hex");
}
