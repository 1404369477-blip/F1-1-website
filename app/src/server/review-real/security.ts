import {
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual
} from "node:crypto";

import { singleRawHeader, type RawAdminContext } from "../source-management/security.ts";
import { ReviewRealError } from "./error.ts";

const SESSION_COOKIE = "__Host-f1_admin_session";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SESSION_IDLE_MS = 15 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const CSRF_TTL_MS = 5 * 60 * 1000;
const FRESH_TTL_MS = 5 * 60 * 1000;
const MAX_SESSIONS_PER_OPERATOR = 2;

type Clock = () => number;
type RandomBytes = (size: number) => Buffer;

type SessionRecord = {
  digest: string;
  operatorRef: string;
  deviceRef: string;
  tailnetUserRef: string;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
};

type OneTimeState = "issued" | "consumed";

type CsrfRecord = {
  digest: string;
  sessionDigest: string;
  method: "POST";
  path: string;
  operationId: string;
  bodyHash: string;
  expiresAt: number;
  state: OneTimeState;
};

type FreshRecord = {
  digest: string;
  sessionDigest: string;
  operationId: string;
  action: "publish";
  resourceHash: string;
  expiresAt: number;
  state: OneTimeState;
};

export type ReviewRecoveryFence = Readonly<{
  clockTrusted: boolean;
  writerReady: boolean;
  lastSuccessfulRecoveryPointAt: number | null;
}>;

export type AuthorizedReviewMutation = Readonly<{
  actorRef: string;
  sessionDigest: string;
  csrfDigest: string;
  freshDigest: string | null;
  operationId: string;
  bodyHash: string;
}>;

export type ReviewMutationBinding = Readonly<{
  method: "POST";
  path: string;
  operationId: string;
  bodyHash: string;
  freshAction?: "publish";
  resourceHash?: string;
}>;

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function parseSessionCookie(header: string | null): string | null {
  if (header === null) return null;
  const matches = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(SESSION_COOKIE.length + 1);
  return TOKEN_PATTERN.test(token) ? token : null;
}

export class ReviewAdminSecurity {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly csrf = new Map<string, CsrfRecord>();
  private readonly fresh = new Map<string, FreshRecord>();
  private readonly canonicalOrigin: string;
  private readonly hashKey: Buffer;
  private readonly now: Clock;
  private readonly randomBytes: RandomBytes;
  private readonly readRecoveryFence: () => ReviewRecoveryFence;
  private lastNow = -Infinity;

  constructor(input: Readonly<{
    canonicalOrigin: string;
    sessionHashKey: Uint8Array;
    readRecoveryFence: () => ReviewRecoveryFence;
    now?: Clock;
    randomBytes?: RandomBytes;
  }>) {
    const origin = new URL(input.canonicalOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.username !== "" ||
      origin.password !== "" ||
      origin.hostname === "" ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    if (input.sessionHashKey.byteLength < 32) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    this.canonicalOrigin = origin.origin;
    this.hashKey = Buffer.from(input.sessionHashKey);
    this.readRecoveryFence = input.readRecoveryFence;
    this.now = input.now ?? Date.now;
    this.randomBytes = input.randomBytes ?? nodeRandomBytes;
  }

  private time(): number {
    const value = this.now();
    if (!Number.isFinite(value) || value < this.lastNow) {
      this.sessions.clear();
      this.csrf.clear();
      this.fresh.clear();
      throw new ReviewRealError("ADMIN_BACKUP_STALE", 503);
    }
    this.lastNow = value;
    this.cleanup(value);
    return value;
  }

  private cleanup(now: number): void {
    for (const [key, session] of this.sessions) {
      if (now > session.absoluteExpiresAt || now - session.lastSeenAt > SESSION_IDLE_MS) {
        this.sessions.delete(key);
      }
    }
    for (const [key, record] of this.csrf) {
      if (now > record.expiresAt || !this.sessions.has(record.sessionDigest)) this.csrf.delete(key);
    }
    for (const [key, record] of this.fresh) {
      if (now > record.expiresAt || !this.sessions.has(record.sessionDigest)) this.fresh.delete(key);
    }
  }

  private token(): string {
    let bytes: Buffer;
    try {
      bytes = this.randomBytes(32);
    } catch {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    if (bytes.byteLength !== 32) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    const token = bytes.toString("base64url");
    bytes.fill(0);
    if (!TOKEN_PATTERN.test(token)) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    return token;
  }

  private digest(kind: "session" | "csrf" | "fresh", token: string): string {
    return createHmac("sha256", this.hashKey).update(`${kind}\n${token}`, "utf8").digest("hex");
  }

  private session(context: RawAdminContext): SessionRecord {
    const now = this.time();
    const token = parseSessionCookie(singleRawHeader(context, "cookie"));
    if (token === null) throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
    const digest = this.digest("session", token);
    const session = this.sessions.get(digest);
    if (!session || !secureEqual(session.digest, digest)) {
      throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
    }
    session.lastSeenAt = now;
    return session;
  }

  private assertOrigin(context: RawAdminContext): void {
    const origins = context.rawHeaders.get("origin") ?? [];
    const fetchSites = context.rawHeaders.get("sec-fetch-site") ?? [];
    if (
      origins.length !== 1 ||
      origins[0] !== this.canonicalOrigin ||
      context.origin !== this.canonicalOrigin ||
      fetchSites.length !== 1 ||
      fetchSites[0] !== "same-origin"
    ) {
      throw new ReviewRealError("ADMIN_ORIGIN_REJECTED", 403);
    }
  }

  private assertRecoveryFence(now: number): void {
    const fence = this.readRecoveryFence();
    if (
      !fence.clockTrusted ||
      !fence.writerReady ||
      fence.lastSuccessfulRecoveryPointAt === null ||
      !Number.isFinite(fence.lastSuccessfulRecoveryPointAt) ||
      fence.lastSuccessfulRecoveryPointAt > now ||
      now - fence.lastSuccessfulRecoveryPointAt >= 15 * 60 * 1000
    ) {
      throw new ReviewRealError("ADMIN_BACKUP_STALE", 503);
    }
  }

  acceptVerifiedSession(input: Readonly<{
    operatorRef: string;
    deviceRef: string;
    tailnetUserRef: string;
  }>): Readonly<{ setCookie: string; cookieHeader: string }> {
    const now = this.time();
    for (const value of [input.operatorRef, input.deviceRef, input.tailnetUserRef]) {
      if (value.length < 1 || value.length > 256) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    const existing = [...this.sessions.values()]
      .filter((session) => session.operatorRef === input.operatorRef)
      .sort((left, right) => left.createdAt - right.createdAt);
    while (existing.length >= MAX_SESSIONS_PER_OPERATOR) {
      const oldest = existing.shift();
      if (oldest) this.sessions.delete(oldest.digest);
    }
    const token = this.token();
    const digest = this.digest("session", token);
    this.sessions.set(digest, {
      digest,
      operatorRef: input.operatorRef,
      deviceRef: input.deviceRef,
      tailnetUserRef: input.tailnetUserRef,
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: now + SESSION_ABSOLUTE_MS
    });
    const cookieHeader = `${SESSION_COOKIE}=${token}`;
    return {
      cookieHeader,
      setCookie: `${cookieHeader}; Secure; HttpOnly; SameSite=Strict; Path=/`
    };
  }

  authorizeRead(context: RawAdminContext): Readonly<{ actorRef: string }> {
    const session = this.session(context);
    return { actorRef: session.operatorRef };
  }

  authorizeBoundIdentity(
    context: RawAdminContext,
    identity: Readonly<{ operatorRef: string; deviceRef: string; tailnetUserRef: string }>
  ): Readonly<{ actorRef: string }> {
    const session = this.session(context);
    if (
      !secureEqual(session.operatorRef, identity.operatorRef) ||
      !secureEqual(session.deviceRef, identity.deviceRef) ||
      !secureEqual(session.tailnetUserRef, identity.tailnetUserRef)
    ) {
      throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
    }
    return { actorRef: session.operatorRef };
  }

  issueCsrf(context: RawAdminContext, binding: Omit<ReviewMutationBinding, "freshAction" | "resourceHash">): string {
    this.assertOrigin(context);
    const session = this.session(context);
    if (
      context.method !== "POST" ||
      context.path !== "/api/admin/csrf" ||
      binding.method !== "POST" ||
      !binding.path.startsWith("/api/admin/") ||
      binding.path.includes("?") ||
      binding.path.includes("#") ||
      binding.path.includes("\\") ||
      binding.operationId.length < 1 ||
      binding.operationId.length > 256 ||
      !HASH_PATTERN.test(binding.bodyHash)
    ) {
      throw new ReviewRealError("ADMIN_CSRF_REJECTED", 403);
    }
    const token = this.token();
    const digest = this.digest("csrf", token);
    this.csrf.set(digest, {
      digest,
      sessionDigest: session.digest,
      method: binding.method,
      path: binding.path,
      operationId: binding.operationId,
      bodyHash: binding.bodyHash,
      expiresAt: this.time() + CSRF_TTL_MS,
      state: "issued"
    });
    return token;
  }

  acceptVerifiedFreshReauth(
    context: RawAdminContext,
    binding: Readonly<{ operationId: string; action: "publish"; resourceHash: string }>
  ): Readonly<{ setCookie: string; cookieHeader: string; freshReceipt: string }> {
    this.assertOrigin(context);
    const oldSession = this.session(context);
    if (!HASH_PATTERN.test(binding.resourceHash)) throw new ReviewRealError("ADMIN_REAUTH_REQUIRED", 403);
    const now = this.time();
    const token = this.token();
    const newDigest = this.digest("session", token);
    this.sessions.delete(oldSession.digest);
    for (const [key, record] of this.csrf) {
      if (record.sessionDigest === oldSession.digest) this.csrf.delete(key);
    }
    for (const [key, record] of this.fresh) {
      if (record.sessionDigest === oldSession.digest) this.fresh.delete(key);
    }
    this.sessions.set(newDigest, {
      ...oldSession,
      digest: newDigest,
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: now + SESSION_ABSOLUTE_MS
    });
    const freshReceipt = this.token();
    const freshDigest = this.digest("fresh", freshReceipt);
    this.fresh.set(freshDigest, {
      digest: freshDigest,
      sessionDigest: newDigest,
      operationId: binding.operationId,
      action: binding.action,
      resourceHash: binding.resourceHash,
      expiresAt: now + FRESH_TTL_MS,
      state: "issued"
    });
    const cookieHeader = `${SESSION_COOKIE}=${token}`;
    return {
      cookieHeader,
      setCookie: `${cookieHeader}; Secure; HttpOnly; SameSite=Strict; Path=/`,
      freshReceipt
    };
  }

  authorizeMutation(context: RawAdminContext, binding: ReviewMutationBinding): AuthorizedReviewMutation {
    this.assertOrigin(context);
    const session = this.session(context);
    const now = this.time();
    this.assertRecoveryFence(now);
    if (
      context.method !== binding.method ||
      context.path !== binding.path ||
      !HASH_PATTERN.test(binding.bodyHash)
    ) {
      throw new ReviewRealError("ADMIN_CSRF_REJECTED", 403);
    }
    const csrfToken = singleRawHeader(context, "x-csrf-token");
    if (csrfToken === null || !TOKEN_PATTERN.test(csrfToken)) {
      throw new ReviewRealError("ADMIN_CSRF_REJECTED", 403);
    }
    const csrfDigest = this.digest("csrf", csrfToken);
    const csrf = this.csrf.get(csrfDigest);
    if (
      !csrf ||
      csrf.state !== "issued" ||
      now > csrf.expiresAt ||
      csrf.sessionDigest !== session.digest ||
      csrf.method !== binding.method ||
      csrf.path !== binding.path ||
      csrf.operationId !== binding.operationId ||
      csrf.bodyHash !== binding.bodyHash
    ) {
      throw new ReviewRealError("ADMIN_CSRF_REJECTED", 403);
    }

    let freshDigest: string | null = null;
    if (binding.freshAction !== undefined) {
      const token = singleRawHeader(context, "x-f1-fresh-reauth");
      if (
        token === null ||
        !TOKEN_PATTERN.test(token) ||
        binding.resourceHash === undefined ||
        !HASH_PATTERN.test(binding.resourceHash)
      ) {
        throw new ReviewRealError("ADMIN_REAUTH_REQUIRED", 403);
      }
      freshDigest = this.digest("fresh", token);
      const fresh = this.fresh.get(freshDigest);
      if (
        !fresh ||
        fresh.state !== "issued" ||
        now > fresh.expiresAt ||
        fresh.sessionDigest !== session.digest ||
        fresh.operationId !== binding.operationId ||
        fresh.action !== binding.freshAction ||
        fresh.resourceHash !== binding.resourceHash
      ) {
        throw new ReviewRealError("ADMIN_REAUTH_REQUIRED", 403);
      }
    }
    return {
      actorRef: session.operatorRef,
      sessionDigest: session.digest,
      csrfDigest,
      freshDigest,
      operationId: binding.operationId,
      bodyHash: binding.bodyHash
    };
  }

  commitMutation(authorization: AuthorizedReviewMutation): void {
    const csrf = this.csrf.get(authorization.csrfDigest);
    if (!csrf || csrf.state !== "issued") throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    csrf.state = "consumed";
    if (authorization.freshDigest !== null) {
      const fresh = this.fresh.get(authorization.freshDigest);
      if (!fresh || fresh.state !== "issued") throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      fresh.state = "consumed";
    }
  }
}
