import { chmodSync, existsSync, lstatSync, readFileSync, rmSync, mkdirSync, cpSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { AdminPasskeyAuth, type AdminTrustedIdentity } from "../server/admin-service/auth.ts";
import {
  ADMIN_REVIEW_DATABASE_PATH,
  AdminTrustedIdentityDeploymentSchema,
  adminDeploymentPaths,
  prepareAdminDeployment,
  TailscaleAppCapabilityIdSchema
} from "../server/admin-service/deployment.ts";
import { openReviewAdminDatabase } from "../server/admin-service/runtime.ts";
import { inspectExistingPrivateDatabase } from "../server/db/database.ts";
import {
  ADMIN_BIND_HOST,
  ADMIN_BIND_PORT,
  adminServiceOwnsPath,
  parseTrustedAdminIdentity,
  validTailscaleForwardedFor,
  type TrustedTailnetIdentity
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
import { assertProjectionDeliveryRuntimeSchema, reviewRealSchemaFingerprint } from "../server/review-real/migration.ts";
import { applyRssMigration, openRssDatabase } from "../server/rss/repository.ts";
import { ReviewAdminSecurity } from "../server/review-real/security.ts";
import type { RawAdminContext } from "../server/source-management/security.ts";

const roots: string[] = [];

function privateTemporaryRoot(): string {
  const path = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-admin-service-"));
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
  it("rejects a second owner-private same-name review database before creating Admin artifacts", () => {
    process.umask(0o077);
    expect(ADMIN_REVIEW_DATABASE_PATH).toBe(
      "/Users/chanai/F1-1-website/app/.local/f1plus1-rss-real-private.sqlite"
    );
    const root = privateTemporaryRoot();
    const secondAppRoot = join(root, "second-app");
    mkdirSync(join(secondAppRoot, ".local"), { mode: 0o700, recursive: true });
    const secondDatabase = openRssDatabase(secondAppRoot);
    secondDatabase.close();
    const secondDatabasePath = join(secondAppRoot, ".local/f1plus1-rss-real-private.sqlite");
    chmodSync(secondDatabasePath, 0o600);
    const secondIdentity = inspectExistingPrivateDatabase(
      secondDatabasePath,
      "f1plus1-rss-real-private.sqlite"
    );
    const home = join(root, "home");
    const paths = adminDeploymentPaths(home);

    expect(() => prepareAdminDeployment({
      home,
      targetReleaseAppRoot: join(root, "release"),
      reviewDatabasePath: secondDatabasePath,
      reviewDatabaseExpectedDev: secondIdentity.dev,
      reviewDatabaseExpectedIno: secondIdentity.ino,
      nodePath: "/usr/bin/false",
      canonicalOrigin: "https://f1-admin.example.ts.net",
      rpName: "F1+1 Admin",
      operatorRef: "operator-primary",
      tailscaleAppCapabilityId: "admin.example.com/cap/f1-admin-device",
      trustedIdentities: [{
        login: "owner@example.com",
        operatorRef: "operator-primary",
        sourceRefs: ["A".repeat(43), "B".repeat(43), "C".repeat(43)]
      }],
      projectionSigningKeyId: "projection-key-v1",
      projectionSigningPrivateKeyPath: join(root, "private.pem"),
      projectionVerifyKeyPath: join(root, "public.pem"),
      publicReadMode: "public-real-snapshot",
      syntheticRollbackRelease: "synthetic-release-v1",
      syntheticRollbackHash: "a".repeat(64),
      projectionSenderServiceIdentity: "projection-sender-v1",
      projectionReceiverServiceIdentity: "projection-receiver-v1"
    })).toThrowError("ADMIN_REVIEW_DATABASE_PATH_INVALID");

    expect(existsSync(paths.dataRoot)).toBe(false);
    expect(existsSync(paths.publicProjectionRoot)).toBe(false);
    expect(existsSync(paths.manifest)).toBe(false);
    expect(existsSync(paths.plist)).toBe(false);
    expect(existsSync(paths.sessionHashKey)).toBe(false);
    expect(existsSync(paths.recoveryFence)).toBe(false);
  });

  it("parses the single Serve app-cap identity for every Admin route before session handling", () => {
    const capabilityId = "admin.example.com/cap/f1-admin-device";
    const m5SourceRef = "A".repeat(43);
    const iphoneSourceRef = "B".repeat(43);
    const ipadSourceRef = "C".repeat(43);
    const trustedIdentities: readonly TrustedTailnetIdentity[] = [{
      login: "owner@example.com",
      operatorRef: "operator-primary",
      sourceRefs: [m5SourceRef, iphoneSourceRef, ipadSourceRef]
    }];
    const rawHeaders = (sourceRef: string): string[] => [
      "Tailscale-User-Login", "owner@example.com",
      "Tailscale-App-Capabilities", JSON.stringify({ [capabilityId]: [{ sourceRef }] })
    ];
    const parse = (headers: readonly string[]) => parseTrustedAdminIdentity({
      rawHeaders: headers,
      tailscaleAppCapabilityId: capabilityId,
      trustedIdentities
    });

    const m5 = parse(rawHeaders(m5SourceRef));
    const iphone = parse(rawHeaders(iphoneSourceRef));
    const ipad = parse(rawHeaders(ipadSourceRef));
    expect(m5).toMatchObject({
      operatorRef: "operator-primary",
      tailnetUserRef: "tailnet-user-c8cd3c6427301eaf"
    });
    expect(m5.deviceRef).toMatch(/^device-[0-9a-f]{16}$/);
    expect(iphone.deviceRef).toMatch(/^device-[0-9a-f]{16}$/);
    expect(iphone.deviceRef).not.toBe(m5.deviceRef);
    expect(ipad.deviceRef).toMatch(/^device-[0-9a-f]{16}$/);
    expect(new Set([m5.deviceRef, iphone.deviceRef, ipad.deviceRef]).size).toBe(3);

    const failures: readonly (readonly string[])[] = [
      rawHeaders(m5SourceRef).slice(2),
      ["Tailscale-User-Login", "owner@example.com", ...rawHeaders(m5SourceRef)],
      ["Tailscale-User-Login", "ownér@example.com", ...rawHeaders(m5SourceRef).slice(2)],
      rawHeaders(m5SourceRef).slice(0, 2),
      [...rawHeaders(m5SourceRef), "Tailscale-App-Capabilities", "{}"],
      ["Tailscale-User-Login", "owner@example.com", "Tailscale-App-Capabilities", "{"],
      ["Tailscale-User-Login", "owner@example.com", "Tailscale-App-Capabilities", JSON.stringify({ "other.example.com/cap/f1-admin-device": [{ sourceRef: m5SourceRef }] })],
      ["Tailscale-User-Login", "owner@example.com", "Tailscale-App-Capabilities", JSON.stringify({ [capabilityId]: [{ sourceRef: m5SourceRef }], unexpected: [] })],
      ["Tailscale-User-Login", "owner@example.com", "Tailscale-App-Capabilities", JSON.stringify({ [capabilityId]: [] })],
      ["Tailscale-User-Login", "owner@example.com", "Tailscale-App-Capabilities", JSON.stringify({ [capabilityId]: [{ sourceRef: m5SourceRef }, { sourceRef: iphoneSourceRef }] })],
      ["Tailscale-User-Login", "owner@example.com", "Tailscale-App-Capabilities", JSON.stringify({ [capabilityId]: [{ sourceRef: m5SourceRef, unexpected: true }] })],
      ["Tailscale-User-Login", "owner@example.com", "Tailscale-App-Capabilities", JSON.stringify({ [capabilityId]: [{ sourceRef: "short" }] })],
      ["Tailscale-User-Login", "other@example.com", "Tailscale-App-Capabilities", JSON.stringify({ [capabilityId]: [{ sourceRef: m5SourceRef }] })],
      ["Tailscale-User-Login", "owner@example.com", "Tailscale-App-Capabilities", " ".repeat(4097)]
    ];
    for (const headers of failures) {
      expect(() => parse(headers)).toThrowError("ADMIN_SESSION_REQUIRED");
    }

    const legacy = ["x-f1-approved-device-ref", "unread"];
    Object.defineProperty(legacy, 1, { get: () => { throw new Error("LEGACY_VALUE_WAS_READ"); } });
    expect(() => parse(legacy)).toThrowError("ADMIN_SESSION_REQUIRED");

    expect(TailscaleAppCapabilityIdSchema.safeParse(capabilityId).success).toBe(true);
    expect(TailscaleAppCapabilityIdSchema.safeParse("tailscale.com/cap/f1-admin-device").success).toBe(false);
    expect(AdminTrustedIdentityDeploymentSchema.safeParse(trustedIdentities[0]).success).toBe(true);
    expect(AdminTrustedIdentityDeploymentSchema.safeParse({
      login: "owner@example.com",
      operatorRef: "operator-primary",
      sourceRefs: [m5SourceRef, iphoneSourceRef]
    }).success).toBe(false);
    expect(AdminTrustedIdentityDeploymentSchema.safeParse({
      login: "owner@example.com",
      operatorRef: "operator-primary",
      sourceRefs: [m5SourceRef, iphoneSourceRef, iphoneSourceRef]
    }).success).toBe(false);
    expect(AdminTrustedIdentityDeploymentSchema.safeParse({
      login: "owner@example.com",
      operatorRef: "operator-primary",
      deviceRefs: ["legacy-device"]
    }).success).toBe(false);

    const security = new ReviewAdminSecurity({
      canonicalOrigin: "https://f1-admin.example.ts.net",
      sessionHashKey: Buffer.alloc(32, 5),
      readRecoveryFence: () => ({
        clockTrusted: true,
        writerReady: true,
        lastSuccessfulRecoveryPointAt: Date.now()
      }),
      randomBytes: (size) => Buffer.alloc(size, 6)
    });
    const session = security.acceptVerifiedSession(m5);
    expect(security.authorizeBoundIdentity(
      rawContext({ method: "GET", path: "/api/admin/reviews", cookie: session.cookieHeader }),
      m5
    )).toEqual({ actorRef: "operator-primary" });
    expect(() => security.authorizeBoundIdentity(
      rawContext({ method: "GET", path: "/api/admin/reviews", cookie: session.cookieHeader }),
      iphone
    )).toThrowError("ADMIN_SESSION_REQUIRED");
  });

  it("accepts only a single Tailscale source address forwarded by loopback Serve", () => {
    expect(validTailscaleForwardedFor("100.123.84.74")).toBe(true);
    expect(validTailscaleForwardedFor("100.64.0.1")).toBe(true);
    expect(validTailscaleForwardedFor("100.127.255.254")).toBe(true);
    expect(validTailscaleForwardedFor("fd7a:115c:a1e0::d435:544c")).toBe(true);

    for (const value of [
      null,
      "100.63.255.255",
      "100.128.0.1",
      "192.168.1.20",
      "203.0.113.10",
      "fd7a:115c:a1e1::1",
      "100.123.84.74, 100.115.142.46",
      " 100.123.84.74",
      "100.123.84.74 "
    ]) {
      expect(validTailscaleForwardedFor(value)).toBe(false);
    }
  });

  it("opens the frozen schema and completes bootstrap, login, CSRF and fresh publish gates without owning public paths", async () => {
    process.umask(0o077);
    const root = privateTemporaryRoot();
    const fakeApp = join(root, "app");
    mkdirSync(join(fakeApp, ".local"), { mode: 0o700, recursive: true });
    mkdirSync(join(fakeApp, "migrations/rss-real"), { mode: 0o700, recursive: true });
    cpSync(join(process.cwd(), "migrations/rss-real/0001_rss_real.sql"), join(fakeApp, "migrations/rss-real/0001_rss_real.sql"));
    cpSync(join(process.cwd(), "migrations/rss-real/0002_admin_review_publish.sql"), join(fakeApp, "migrations/rss-real/0002_admin_review_publish.sql"));
    cpSync(join(process.cwd(), "migrations/rss-real/0003_projection_delivery_runtime.sql"), join(fakeApp, "migrations/rss-real/0003_projection_delivery_runtime.sql"));
    cpSync(join(process.cwd(), "migrations/rss-real/0004_rss_media_and_chinese_refinement.sql"), join(fakeApp, "migrations/rss-real/0004_rss_media_and_chinese_refinement.sql"));
    const databasePath = join(fakeApp, ".local/f1plus1-rss-real-private.sqlite");
    const initialDatabase = openRssDatabase(fakeApp);
    applyRssMigration(initialDatabase, readFileSync(join(fakeApp, "migrations/rss-real/0001_rss_real.sql"), "utf8"));
    initialDatabase.close();
    chmodSync(databasePath, 0o600);
    const databaseIdentity = inspectExistingPrivateDatabase(databasePath, "f1plus1-rss-real-private.sqlite");
    const opened = openReviewAdminDatabase({
      targetReleaseAppRoot: fakeApp,
      reviewDatabasePath: databasePath,
      reviewDatabaseIdentity: databaseIdentity
    });
    expect(Number((opened.database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version)).toBe(4);
    expect(reviewRealSchemaFingerprint(opened.database)).toBe("40b1b59c8a8dab3413dfe85311b72cb735e3523071dbd70b0c3a42b0b7eb3b7c");
    opened.database.close();

    const missingPath = join(fakeApp, ".local/missing/f1plus1-rss-real-private.sqlite");
    expect(() => openReviewAdminDatabase({
      targetReleaseAppRoot: fakeApp,
      reviewDatabasePath: missingPath,
      reviewDatabaseIdentity: databaseIdentity
    })).toThrow();
    expect(existsSync(missingPath)).toBe(false);
    expect(lstatSync(databasePath).dev).toBe(databaseIdentity.dev);
    expect(lstatSync(databasePath).ino).toBe(databaseIdentity.ino);

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
    expect(adminServiceOwnsPath("/internal/projections")).toBe(false);
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
