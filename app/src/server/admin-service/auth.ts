import { randomBytes as nodeRandomBytes } from "node:crypto";

import { z } from "zod";

import type { RawAdminContext } from "../source-management/security.ts";
import { prepareFreshPublishBinding } from "../review-real/backend.ts";
import { ReviewRealError } from "../review-real/error.ts";
import {
  XManualRetireMutationSchema,
  prepareXManualRetireMutation
} from "../review-real/routes.ts";
import { PublishRequestSchema, ReleaseNowRequestSchema } from "../review-real/schema.ts";
import { ReviewAdminSecurity } from "../review-real/security.ts";
import { BootstrapTokenStore, PasskeyCredentialStore, type StoredPasskeyCredential } from "./storage.ts";
import type { AdminWebAuthnAdapter } from "./webauthn.ts";
import { AuthorityMutationSchema, MutationSchema as BilingualMutationSchema, SourceRegistryMutationSchema, prepareAuthorityMutation, prepareBilingualMutation, prepareSourceRegistryMutation } from "./bilingual-admin.ts";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;

export const BootstrapOptionsRequestSchema = z.object({
  schemaVersion: z.literal("admin-auth-bootstrap-options-v1"),
  bootstrapToken: z.string().regex(TOKEN_PATTERN)
}).strict();

export const BootstrapVerifyRequestSchema = z.object({
  schemaVersion: z.literal("admin-auth-bootstrap-verify-v1"),
  bootstrapToken: z.string().regex(TOKEN_PATTERN),
  response: z.unknown()
}).strict();

export const LoginOptionsRequestSchema = z.object({
  schemaVersion: z.literal("admin-auth-login-options-v1")
}).strict();

export const LoginVerifyRequestSchema = z.object({
  schemaVersion: z.literal("admin-auth-login-verify-v1"),
  response: z.unknown()
}).strict();

export const FreshOptionsRequestSchema = z.object({
  schemaVersion: z.literal("admin-auth-fresh-options-v1"),
  mutation: z.union([ReleaseNowRequestSchema, PublishRequestSchema, XManualRetireMutationSchema, AuthorityMutationSchema, SourceRegistryMutationSchema, BilingualMutationSchema])
}).strict();

export const FreshVerifyRequestSchema = z.object({
  schemaVersion: z.literal("admin-auth-fresh-verify-v1"),
  mutation: z.union([ReleaseNowRequestSchema, PublishRequestSchema, XManualRetireMutationSchema, AuthorityMutationSchema, SourceRegistryMutationSchema, BilingualMutationSchema]),
  response: z.unknown()
}).strict();

export type AdminTrustedIdentity = Readonly<{
  operatorRef: string;
  deviceRef: string;
  tailnetUserRef: string;
}>;

type ChallengePurpose = "bootstrap" | "login" | "fresh";

type ChallengeRecord = Readonly<{
  purpose: ChallengePurpose;
  identityKey: string;
  challenge: string;
  expiresAt: number;
  webauthnUserId?: string;
  freshBinding?: Readonly<{
    operationId: string;
    action: "publish" | "SOURCE_RETIRE" | "AUTHORITY_ACTIVATE" | "BILINGUAL_SAFETY_REVIEW" | "BILINGUAL_CORRECT" | "BILINGUAL_WITHDRAW";
    resourceHash: string;
  }>;
}>;

function parseCredentialId(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
  }
  const id = (value as Record<string, unknown>).id;
  if (typeof id !== "string" || id.length < 1 || id.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
  }
  return id;
}

function assertChallenge(challenge: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(challenge)) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(challenge, "base64url");
  } catch {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  if (bytes.byteLength < 32) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
}

function storedCredential(input: Readonly<{
  verification: Awaited<ReturnType<AdminWebAuthnAdapter["verifyRegistration"]>>;
  now: string;
}>): StoredPasskeyCredential {
  const { credential } = input.verification;
  return {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: [...credential.transports],
    deviceType: credential.deviceType,
    backedUp: credential.backedUp,
    createdAt: input.now,
    updatedAt: input.now,
    disabledAt: null
  };
}

export class AdminPasskeyAuth {
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly credentialStore: PasskeyCredentialStore;
  private readonly bootstrapStore: BootstrapTokenStore;
  private readonly security: ReviewAdminSecurity;
  private readonly webauthn: AdminWebAuthnAdapter;
  private readonly canonicalOrigin: string;
  private readonly rpId: string;
  private readonly rpName: string;
  private readonly operatorRef: string;
  private readonly now: () => number;
  private readonly randomBytes: (size: number) => Buffer;
  private lastNow = -Infinity;

  constructor(input: Readonly<{
    credentialStore: PasskeyCredentialStore;
    bootstrapStore: BootstrapTokenStore;
    security: ReviewAdminSecurity;
    webauthn: AdminWebAuthnAdapter;
    canonicalOrigin: string;
    rpName: string;
    operatorRef: string;
    now?: () => number;
    randomBytes?: (size: number) => Buffer;
  }>) {
    const origin = new URL(input.canonicalOrigin);
    if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    this.credentialStore = input.credentialStore;
    this.bootstrapStore = input.bootstrapStore;
    this.security = input.security;
    this.webauthn = input.webauthn;
    this.canonicalOrigin = origin.origin;
    this.rpId = origin.hostname;
    this.rpName = input.rpName;
    this.operatorRef = input.operatorRef;
    this.now = input.now ?? Date.now;
    this.randomBytes = input.randomBytes ?? nodeRandomBytes;
  }

  private time(): number {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < this.lastNow) {
      this.challenges.clear();
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    this.lastNow = now;
    for (const [key, record] of this.challenges) {
      if (now > record.expiresAt) this.challenges.delete(key);
    }
    return now;
  }

  private identityKey(identity: AdminTrustedIdentity): string {
    if (identity.operatorRef !== this.operatorRef) throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
    return `${identity.operatorRef}\u001f${identity.deviceRef}\u001f${identity.tailnetUserRef}`;
  }

  private challengeKey(purpose: ChallengePurpose, identity: AdminTrustedIdentity): string {
    return `${purpose}\u001f${this.identityKey(identity)}`;
  }

  private prepareFreshBinding(value: unknown): Readonly<{
    binding: Readonly<{
      operationId: string;
      action: "publish" | "SOURCE_RETIRE" | "AUTHORITY_ACTIVATE" | "BILINGUAL_SAFETY_REVIEW" | "BILINGUAL_CORRECT" | "BILINGUAL_WITHDRAW";
      resourceHash: string;
    }>;
  }> {
    const authority = AuthorityMutationSchema.safeParse(value);
    if (authority.success) {
      const prepared = prepareAuthorityMutation(authority.data);
      return { binding: { operationId: prepared.binding.operationId, action: "AUTHORITY_ACTIVATE", resourceHash: prepared.binding.resourceHash } };
    }
    const source = SourceRegistryMutationSchema.safeParse(value);
    if (source.success && source.data.action === "retire") {
      const prepared = prepareSourceRegistryMutation(source.data);
      if (prepared.binding.freshAction !== "SOURCE_RETIRE" || !prepared.binding.resourceHash) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      return { binding: { operationId: prepared.binding.operationId, action: "SOURCE_RETIRE", resourceHash: prepared.binding.resourceHash } };
    }
    try {
      const bilingual = prepareBilingualMutation(value);
      if (bilingual.binding.freshAction && bilingual.binding.resourceHash) {
        return { binding: { operationId: bilingual.binding.operationId, action: bilingual.binding.freshAction, resourceHash: bilingual.binding.resourceHash } };
      }
    } catch { /* continue to other fresh mutation schemas */ }
    const xRetire = XManualRetireMutationSchema.safeParse(value);
    if (xRetire.success) {
      const prepared = prepareXManualRetireMutation(xRetire.data);
      if (prepared.binding.freshAction !== "SOURCE_RETIRE" || !prepared.binding.resourceHash) {
        throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
      }
      return {
        binding: {
          operationId: prepared.binding.operationId,
          action: "SOURCE_RETIRE",
          resourceHash: prepared.binding.resourceHash
        }
      };
    }
    const prepared = prepareFreshPublishBinding(value);
    if (!prepared.binding.resourceHash) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    return {
      binding: {
        operationId: prepared.binding.operationId,
        action: "publish",
        resourceHash: prepared.binding.resourceHash
      }
    };
  }

  private remember(record: ChallengeRecord): void {
    assertChallenge(record.challenge);
    this.challenges.set(`${record.purpose}\u001f${record.identityKey}`, Object.freeze(record));
  }

  private consume(purpose: ChallengePurpose, identity: AdminTrustedIdentity): ChallengeRecord {
    const now = this.time();
    const key = this.challengeKey(purpose, identity);
    const record = this.challenges.get(key);
    this.challenges.delete(key);
    if (!record || now > record.expiresAt) {
      throw new ReviewRealError(purpose === "fresh" ? "ADMIN_REAUTH_REQUIRED" : "ADMIN_SESSION_REQUIRED", 401);
    }
    return record;
  }

  async bootstrapOptions(identity: AdminTrustedIdentity, value: unknown): Promise<unknown> {
    const request = BootstrapOptionsRequestSchema.safeParse(value);
    if (!request.success || this.credentialStore.read() !== null) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    }
    const now = this.time();
    this.bootstrapStore.assertUsable(request.data.bootstrapToken, now);
    const userIdBytes = this.randomBytes(32);
    if (userIdBytes.byteLength !== 32) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    const webauthnUserId = userIdBytes.toString("base64url");
    const publicKey = await this.webauthn.registrationOptions({
      rpName: this.rpName,
      rpId: this.rpId,
      operatorRef: this.operatorRef,
      userId: userIdBytes,
      excludeCredentials: []
    });
    userIdBytes.fill(0);
    this.remember({
      purpose: "bootstrap",
      identityKey: this.identityKey(identity),
      challenge: publicKey.challenge,
      expiresAt: now + CHALLENGE_TTL_MS,
      webauthnUserId
    });
    return { schemaVersion: "admin-auth-bootstrap-options-v1", publicKey };
  }

  async bootstrapVerify(identity: AdminTrustedIdentity, value: unknown): Promise<unknown> {
    const request = BootstrapVerifyRequestSchema.safeParse(value);
    if (!request.success || this.credentialStore.read() !== null) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    }
    const record = this.consume("bootstrap", identity);
    const now = this.time();
    this.bootstrapStore.assertUsable(request.data.bootstrapToken, now);
    const verification = await this.webauthn.verifyRegistration({
      response: request.data.response,
      expectedChallenge: record.challenge,
      expectedOrigin: this.canonicalOrigin,
      expectedRpId: this.rpId
    });
    if (!record.webauthnUserId) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    const stored = this.credentialStore.addInitial({
      operatorRef: this.operatorRef,
      webauthnUserId: record.webauthnUserId,
      credential: storedCredential({ verification, now: new Date(now).toISOString() })
    });
    this.bootstrapStore.consume(request.data.bootstrapToken, now);
    return {
      schemaVersion: "admin-auth-bootstrap-verify-v1",
      credentialCount: stored.credentials.length
    };
  }

  async loginOptions(identity: AdminTrustedIdentity, value: unknown): Promise<unknown> {
    if (!LoginOptionsRequestSchema.safeParse(value).success) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    }
    const credentials = this.credentialStore.activeCredentials();
    if (credentials.length === 0) throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
    const now = this.time();
    const publicKey = await this.webauthn.authenticationOptions({ rpId: this.rpId, credentials });
    this.remember({
      purpose: "login",
      identityKey: this.identityKey(identity),
      challenge: publicKey.challenge,
      expiresAt: now + CHALLENGE_TTL_MS
    });
    return { schemaVersion: "admin-auth-login-options-v1", publicKey };
  }

  async loginVerify(identity: AdminTrustedIdentity, value: unknown): Promise<Readonly<{
    body: unknown;
    setCookie: string;
    cookieHeader: string;
  }>> {
    const request = LoginVerifyRequestSchema.safeParse(value);
    if (!request.success) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    const record = this.consume("login", identity);
    const credential = this.credentialStore.credential(parseCredentialId(request.data.response));
    const verification = await this.webauthn.verifyAuthentication({
      response: request.data.response,
      expectedChallenge: record.challenge,
      expectedOrigin: this.canonicalOrigin,
      expectedRpId: this.rpId,
      credential
    });
    if (verification.credentialId !== credential.id) throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
    this.credentialStore.commitAuthenticationState({
      credentialId: credential.id,
      expectedCounter: credential.counter,
      newCounter: verification.newCounter,
      deviceType: verification.credentialDeviceType,
      backedUp: verification.credentialBackedUp,
      now: new Date(this.time()).toISOString()
    });
    const session = this.security.acceptVerifiedSession(identity);
    return {
      body: { schemaVersion: "admin-auth-login-verify-v1", authenticated: true },
      ...session
    };
  }

  async freshOptions(
    context: RawAdminContext,
    identity: AdminTrustedIdentity,
    value: unknown
  ): Promise<unknown> {
    const request = FreshOptionsRequestSchema.safeParse(value);
    if (!request.success) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    this.security.authorizeBoundIdentity(context, identity);
    const credentials = this.credentialStore.activeCredentials();
    if (credentials.length === 0) throw new ReviewRealError("ADMIN_REAUTH_REQUIRED", 403);
    const prepared = this.prepareFreshBinding(request.data.mutation);
    const now = this.time();
    const publicKey = await this.webauthn.authenticationOptions({ rpId: this.rpId, credentials });
    this.remember({
      purpose: "fresh",
      identityKey: this.identityKey(identity),
      challenge: publicKey.challenge,
      expiresAt: now + CHALLENGE_TTL_MS,
      freshBinding: prepared.binding
    });
    return { schemaVersion: "admin-auth-fresh-options-v1", publicKey };
  }

  async freshVerify(
    context: RawAdminContext,
    identity: AdminTrustedIdentity,
    value: unknown
  ): Promise<Readonly<{
    body: unknown;
    setCookie: string;
    cookieHeader: string;
  }>> {
    const request = FreshVerifyRequestSchema.safeParse(value);
    if (!request.success) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    this.security.authorizeBoundIdentity(context, identity);
    const record = this.consume("fresh", identity);
    const prepared = this.prepareFreshBinding(request.data.mutation);
    if (
      !record.freshBinding ||
      prepared.binding.operationId !== record.freshBinding.operationId ||
      prepared.binding.action !== record.freshBinding.action ||
      prepared.binding.resourceHash !== record.freshBinding.resourceHash
    ) {
      throw new ReviewRealError("ADMIN_REAUTH_REQUIRED", 403);
    }
    const credential = this.credentialStore.credential(parseCredentialId(request.data.response));
    const verification = await this.webauthn.verifyAuthentication({
      response: request.data.response,
      expectedChallenge: record.challenge,
      expectedOrigin: this.canonicalOrigin,
      expectedRpId: this.rpId,
      credential
    });
    if (verification.credentialId !== credential.id) throw new ReviewRealError("ADMIN_REAUTH_REQUIRED", 403);
    this.credentialStore.commitAuthenticationState({
      credentialId: credential.id,
      expectedCounter: credential.counter,
      newCounter: verification.newCounter,
      deviceType: verification.credentialDeviceType,
      backedUp: verification.credentialBackedUp,
      now: new Date(this.time()).toISOString()
    });
    const fresh = this.security.acceptVerifiedFreshReauth(context, record.freshBinding);
    return {
      body: {
        schemaVersion: "admin-auth-fresh-verify-v1",
        freshReceipt: fresh.freshReceipt
      },
      ...fresh
    };
  }
}
