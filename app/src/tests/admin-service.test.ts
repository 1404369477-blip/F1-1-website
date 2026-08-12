import { readFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { AdminPasskeyAuth, type AdminTrustedIdentity } from "../server/admin-service/auth.ts";
import { openReviewAdminDatabase } from "../server/admin-service/runtime.ts";
import {
  ADMIN_BIND_HOST,
  ADMIN_BIND_PORT,
  adminServiceOwnsPath
} from "../server/admin-service/server.ts";
import {
  BootstrapTokenStore,
  PasskeyCredentialStore,
  type StoredPasskeyCredential
} from "../server/admin-service/storage.ts";
import type {
  AdminWebAuthnAdapter,
  AuthenticationVerification,
  RegistrationVerification
} from "../server/admin-service/webauthn.ts";
import { preparePublishMutation } from "../server/review-real/backend.ts";
import { reviewRealSchemaFingerprint } from "../server/review-real/migration.ts";
import { ReviewAdminSecurity } from "../server/review-real/security.ts";
import type { RawAdminContext } from "../server/source-management/security.ts";

const roots: string[] = [];

function privateTemporaryRoot(): string {
  const path = join(tmpdir(), `f1plus1-admin-service-${process.pid}-${roots.length}`);
  mkdirSync(path, { mode: 0o700 });
  roots.push(path);
  return path;
}

function challenge(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64url");
}

function rawContext(input: Readonly<{
  method: string;
  path: string;
  cookie?: string;
  csrf?: string;
  fresh?: string;
}>): RawAdminContext {
  const headers = new Map<string, readonly string[]>([
    ["origin", ["https://f1-admin.example.ts.net"]],
    ["sec-fetch-site", ["same-origin"]]
  ]);
  if (input.cookie) headers.set("cookie", [input.cookie]);
  if (input.csrf) headers.set("x-csrf-token", [input.csrf]);
  if (input.fresh) headers.set("x-f1-fresh-reauth", [input.fresh]);
  return Object.freeze({
    method: input.method,
    path: input.path,
    authority: "f1-admin.example.ts.net",
    origin: "https://f1-admin.example.ts.net",
    peer: "loopback",
    rawHeaders: headers,
    noEgressReady: true
  });
}

class InjectedWebAuthn implements AdminWebAuthnAdapter {
  private optionsCount = 0;
  authenticationCount = 0;

  async registrationOptions() {
    this.optionsCount += 1;
    return { challenge: challenge(this.optionsCount) } as Awaited<ReturnType<AdminWebAuthnAdapter["registrationOptions"]>>;
  }

  async verifyRegistration(): Promise<RegistrationVerification> {
    return {
      verified: true,
      credential: {
        id: "credential_primary",
        publicKey: Buffer.from("public-key"),
        counter: 0,
        transports: ["internal"],
        deviceType: "multiDevice",
        backedUp: true
      }
    };
  }

  async authenticationOptions() {
    this.optionsCount += 1;
    return { challenge: challenge(this.optionsCount) } as Awaited<ReturnType<AdminWebAuthnAdapter["authenticationOptions"]>>;
  }

  async verifyAuthentication(): Promise<AuthenticationVerification> {
    this.authenticationCount += 1;
    return {
      verified: true,
      credentialId: "credential_primary",
      newCounter: this.authenticationCount,
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true
    };
  }
}

type PendingAuthentication = Readonly<{
  expectedCounter: number;
  resolve: (verification: AuthenticationVerification) => void;
}>;

class ControlledWebAuthn implements AdminWebAuthnAdapter {
  private optionsCount = 0;
  readonly pending: PendingAuthentication[] = [];

  async registrationOptions() {
    this.optionsCount += 1;
    return { challenge: challenge(this.optionsCount) } as Awaited<ReturnType<AdminWebAuthnAdapter["registrationOptions"]>>;
  }

  async verifyRegistration(): Promise<RegistrationVerification> {
    throw new Error("UNEXPECTED_REGISTRATION_VERIFICATION");
  }

  async authenticationOptions() {
    this.optionsCount += 1;
    return { challenge: challenge(this.optionsCount) } as Awaited<ReturnType<AdminWebAuthnAdapter["authenticationOptions"]>>;
  }

  verifyAuthentication(input: Readonly<{
    response: unknown;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
    credential: StoredPasskeyCredential;
  }>): Promise<AuthenticationVerification> {
    return new Promise((resolve) => {
      this.pending.push({ expectedCounter: input.credential.counter, resolve });
    });
  }
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("independent admin service candidate", () => {
  it("opens the frozen schema and completes bootstrap, login, CSRF and fresh publish gates without owning public paths", async () => {
    process.umask(0o077);
    const root = privateTemporaryRoot();
    const fakeApp = join(root, "app");
    mkdirSync(join(fakeApp, ".local"), { mode: 0o700, recursive: true });
    mkdirSync(join(fakeApp, "migrations/rss-real"), { mode: 0o700, recursive: true });
    cpSync(join(process.cwd(), "migrations/rss-real/0001_rss_real.sql"), join(fakeApp, "migrations/rss-real/0001_rss_real.sql"));
    cpSync(join(process.cwd(), "migrations/rss-real/0002_admin_review_publish.sql"), join(fakeApp, "migrations/rss-real/0002_admin_review_publish.sql"));
    const opened = openReviewAdminDatabase(fakeApp);
    expect(Number((opened.database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version)).toBe(2);
    expect(reviewRealSchemaFingerprint(opened.database)).toBe("46a714035b59e1d608065922593895cd72c0748ac5ddbef660ae16e99e7f638e");
    opened.database.close();

    const authRoot = join(root, "auth");
    mkdirSync(authRoot, { mode: 0o700 });
    let now = Date.parse("2026-08-12T08:00:00.000Z");
    const bootstrapStore = new BootstrapTokenStore(authRoot);
    const preparedBootstrap = bootstrapStore.prepare(now);
    const bootstrapToken = readFileSync(preparedBootstrap.tokenPath, "utf8");
    const credentialStore = new PasskeyCredentialStore(authRoot);
    let randomCounter = 0;
    const security = new ReviewAdminSecurity({
      canonicalOrigin: "https://f1-admin.example.ts.net",
      sessionHashKey: Buffer.alloc(32, 9),
      readRecoveryFence: () => ({
        clockTrusted: true,
        writerReady: true,
        lastSuccessfulRecoveryPointAt: now - 60_000
      }),
      now: () => now,
      randomBytes: (size) => Buffer.alloc(size, ++randomCounter)
    });
    const webauthn = new InjectedWebAuthn();
    const auth = new AdminPasskeyAuth({
      credentialStore,
      bootstrapStore,
      security,
      webauthn,
      canonicalOrigin: "https://f1-admin.example.ts.net",
      rpName: "F1+1 Admin",
      operatorRef: "operator-primary",
      now: () => now,
      randomBytes: (size) => Buffer.alloc(size, 7)
    });
    const identity: AdminTrustedIdentity = {
      operatorRef: "operator-primary",
      deviceRef: "device-ref-mac",
      tailnetUserRef: "tailnet-user-ref"
    };

    const bootstrapOptions = await auth.bootstrapOptions(identity, {
      schemaVersion: "admin-auth-bootstrap-options-v1",
      bootstrapToken
    }) as Record<string, unknown>;
    expect(bootstrapOptions.schemaVersion).toBe("admin-auth-bootstrap-options-v1");
    const bootstrap = await auth.bootstrapVerify(identity, {
      schemaVersion: "admin-auth-bootstrap-verify-v1",
      bootstrapToken,
      response: { id: "credential_primary" }
    }) as Record<string, unknown>;
    expect(bootstrap.credentialCount).toBe(1);
    expect(credentialStore.activeCredentials()).toHaveLength(1);

    await auth.loginOptions(identity, { schemaVersion: "admin-auth-login-options-v1" });
    now += 1_000;
    const login = await auth.loginVerify(identity, {
      schemaVersion: "admin-auth-login-verify-v1",
      response: { id: "credential_primary" }
    });
    expect(login.setCookie).toContain("__Host-f1_admin_session=");
    expect(login.setCookie).toContain("Secure; HttpOnly; SameSite=Strict; Path=/");

    const mutation = {
      schemaVersion: "admin-review-v0.2",
      operationId: "operation-publish-primary",
      expected: {
        publicId: `public-rss-${"a".repeat(64)}`,
        publishGeneration: 1,
        publicationStatus: "queued",
        approvedBundleVersionTag: "b".repeat(12)
      }
    } as const;
    await auth.freshOptions(
      rawContext({ method: "POST", path: "/api/admin/auth/fresh/options", cookie: login.cookieHeader }),
      identity,
      { schemaVersion: "admin-auth-fresh-options-v1", mutation }
    );
    now += 1_000;
    const fresh = await auth.freshVerify(
      rawContext({ method: "POST", path: "/api/admin/auth/fresh/verify", cookie: login.cookieHeader }),
      identity,
      {
        schemaVersion: "admin-auth-fresh-verify-v1",
        mutation,
        response: { id: "credential_primary" }
      }
    );
    const freshReceipt = String((fresh.body as Record<string, unknown>).freshReceipt);
    const prepared = preparePublishMutation(mutation);
    const csrf = security.issueCsrf(
      rawContext({ method: "POST", path: "/api/admin/csrf", cookie: fresh.cookieHeader }),
      prepared.binding
    );
    const authorized = security.authorizeMutation(
      rawContext({
        method: "POST",
        path: prepared.binding.path,
        cookie: fresh.cookieHeader,
        csrf,
        fresh: freshReceipt
      }),
      prepared.binding
    );
    security.commitMutation(authorized);
    expect(() => security.authorizeMutation(
      rawContext({
        method: "POST",
        path: prepared.binding.path,
        cookie: fresh.cookieHeader,
        csrf,
        fresh: freshReceipt
      }),
      prepared.binding
    )).toThrowError("ADMIN_CSRF_REJECTED");

    expect(ADMIN_BIND_HOST).toBe("127.0.0.1");
    expect(ADMIN_BIND_PORT).toBe(3101);
    expect(adminServiceOwnsPath("/admin/reviews")).toBe(true);
    expect(adminServiceOwnsPath("/api/admin/reviews")).toBe(true);
    expect(adminServiceOwnsPath("/")).toBe(false);
    expect(adminServiceOwnsPath("/stories/public-rss-example")).toBe(false);
    expect(webauthn.authenticationCount).toBe(2);
  });

  it("commits counter and backup state monotonically before issuing session or fresh receipts", async () => {
    process.umask(0o077);
    const root = privateTemporaryRoot();
    const authRoot = join(root, "auth");
    mkdirSync(authRoot, { mode: 0o700 });
    const now = Date.parse("2026-08-12T09:00:00.000Z");
    const timestamp = new Date(now).toISOString();
    const credentialStore = new PasskeyCredentialStore(authRoot);
    credentialStore.addInitial({
      operatorRef: "operator-primary",
      webauthnUserId: challenge(20),
      credential: {
        id: "credential_primary",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 10,
        transports: ["internal"],
        deviceType: "multiDevice",
        backedUp: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        disabledAt: null
      }
    });
    let randomCounter = 0;
    const security = new ReviewAdminSecurity({
      canonicalOrigin: "https://f1-admin.example.ts.net",
      sessionHashKey: Buffer.alloc(32, 8),
      readRecoveryFence: () => ({
        clockTrusted: true,
        writerReady: true,
        lastSuccessfulRecoveryPointAt: now - 60_000
      }),
      now: () => now,
      randomBytes: (size) => Buffer.alloc(size, ++randomCounter)
    });
    const sessionSpy = vi.spyOn(security, "acceptVerifiedSession");
    const freshSpy = vi.spyOn(security, "acceptVerifiedFreshReauth");
    const webauthn = new ControlledWebAuthn();
    const auth = new AdminPasskeyAuth({
      credentialStore,
      bootstrapStore: new BootstrapTokenStore(authRoot),
      security,
      webauthn,
      canonicalOrigin: "https://f1-admin.example.ts.net",
      rpName: "F1+1 Admin",
      operatorRef: "operator-primary",
      now: () => now
    });
    const identity = (deviceRef: string): AdminTrustedIdentity => ({
      operatorRef: "operator-primary",
      deviceRef,
      tailnetUserRef: "tailnet-user-ref"
    });
    const beginLogin = async (deviceRef: string) => {
      const trustedIdentity = identity(deviceRef);
      await auth.loginOptions(trustedIdentity, { schemaVersion: "admin-auth-login-options-v1" });
      return {
        trustedIdentity,
        verification: auth.loginVerify(trustedIdentity, {
          schemaVersion: "admin-auth-login-verify-v1",
          response: { id: "credential_primary" }
        })
      };
    };

    const lower = await beginLogin("device-ref-lower");
    const higher = await beginLogin("device-ref-higher");
    expect(webauthn.pending.map((pending) => pending.expectedCounter)).toEqual([10, 10]);
    webauthn.pending[1]?.resolve({
      verified: true,
      credentialId: "credential_primary",
      newCounter: 12,
      credentialDeviceType: "multiDevice",
      credentialBackedUp: false
    });
    const higherSession = await higher.verification;
    webauthn.pending[0]?.resolve({
      verified: true,
      credentialId: "credential_primary",
      newCounter: 11,
      credentialDeviceType: "multiDevice",
      credentialBackedUp: false
    });
    await expect(lower.verification).rejects.toThrowError("ADMIN_SESSION_REQUIRED");
    expect(credentialStore.credential("credential_primary").counter).toBe(12);
    expect(sessionSpy).toHaveBeenCalledTimes(1);

    const deviceDrift = await beginLogin("device-ref-drift");
    webauthn.pending[2]?.resolve({
      verified: true,
      credentialId: "credential_primary",
      newCounter: 13,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false
    });
    await expect(deviceDrift.verification).rejects.toThrowError("ADMIN_SESSION_REQUIRED");
    expect(credentialStore.credential("credential_primary").counter).toBe(12);
    expect(sessionSpy).toHaveBeenCalledTimes(1);

    const backupUpgrade = await beginLogin("device-ref-backup-upgrade");
    webauthn.pending[3]?.resolve({
      verified: true,
      credentialId: "credential_primary",
      newCounter: 13,
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true
    });
    const upgradedSession = await backupUpgrade.verification;
    expect(credentialStore.credential("credential_primary")).toMatchObject({ counter: 13, backedUp: true });
    expect(sessionSpy).toHaveBeenCalledTimes(2);

    const backupDowngrade = await beginLogin("device-ref-backup-downgrade");
    webauthn.pending[4]?.resolve({
      verified: true,
      credentialId: "credential_primary",
      newCounter: 14,
      credentialDeviceType: "multiDevice",
      credentialBackedUp: false
    });
    await expect(backupDowngrade.verification).rejects.toThrowError("ADMIN_SESSION_REQUIRED");
    expect(credentialStore.credential("credential_primary")).toMatchObject({ counter: 13, backedUp: true });
    expect(sessionSpy).toHaveBeenCalledTimes(2);

    const singleRoot = join(root, "single-device-auth");
    mkdirSync(singleRoot, { mode: 0o700 });
    const singleStore = new PasskeyCredentialStore(singleRoot);
    singleStore.addInitial({
      operatorRef: "operator-primary",
      webauthnUserId: challenge(21),
      credential: {
        id: "credential_single",
        publicKey: Buffer.from("single-public-key").toString("base64url"),
        counter: 0,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        disabledAt: null
      }
    });
    singleStore.commitAuthenticationState({
      credentialId: "credential_single",
      expectedCounter: 0,
      newCounter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      now: timestamp
    });
    expect(singleStore.credential("credential_single")).toMatchObject({ counter: 0, backedUp: false });
    expect(() => singleStore.commitAuthenticationState({
      credentialId: "credential_single",
      expectedCounter: 0,
      newCounter: 1,
      deviceType: "singleDevice",
      backedUp: true,
      now: timestamp
    })).toThrowError("ADMIN_SESSION_REQUIRED");
    expect(singleStore.credential("credential_single")).toMatchObject({ counter: 0, backedUp: false });

    const mutation = {
      schemaVersion: "admin-review-v0.2",
      operationId: "operation-fresh-cas-conflict",
      expected: {
        publicId: `public-rss-${"c".repeat(64)}`,
        publishGeneration: 1,
        publicationStatus: "queued",
        approvedBundleVersionTag: "d".repeat(12)
      }
    } as const;
    await auth.freshOptions(
      rawContext({
        method: "POST",
        path: "/api/admin/auth/fresh/options",
        cookie: upgradedSession.cookieHeader
      }),
      backupUpgrade.trustedIdentity,
      { schemaVersion: "admin-auth-fresh-options-v1", mutation }
    );
    const staleFresh = auth.freshVerify(
      rawContext({
        method: "POST",
        path: "/api/admin/auth/fresh/verify",
        cookie: upgradedSession.cookieHeader
      }),
      backupUpgrade.trustedIdentity,
      {
        schemaVersion: "admin-auth-fresh-verify-v1",
        mutation,
        response: { id: "credential_primary" }
      }
    );
    expect(webauthn.pending[5]?.expectedCounter).toBe(13);
    credentialStore.commitAuthenticationState({
      credentialId: "credential_primary",
      expectedCounter: 13,
      newCounter: 15,
      deviceType: "multiDevice",
      backedUp: true,
      now: timestamp
    });
    webauthn.pending[5]?.resolve({
      verified: true,
      credentialId: "credential_primary",
      newCounter: 14,
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true
    });
    await expect(staleFresh).rejects.toThrowError("ADMIN_SESSION_REQUIRED");
    expect(credentialStore.credential("credential_primary")).toMatchObject({ counter: 15, backedUp: true });
    expect(freshSpy).not.toHaveBeenCalled();
    expect(higherSession.setCookie).toContain("__Host-f1_admin_session=");
  });
});
