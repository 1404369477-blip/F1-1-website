import { chmodSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  ADMIN_BILINGUAL_SCHEMA,
  BilingualAdminRepository,
  BilingualAdminRoutes,
  prepareBilingualMutation,
  type BilingualManualMutationPort,
} from "../server/admin-service/bilingual-admin.ts";
import { canonicalJson } from "../server/db/profile.ts";
import { inspectExistingPrivateDatabase } from "../server/db/database.ts";
import { openReviewAdminDatabase } from "../server/admin-service/runtime.ts";
import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { ReviewAdminSecurity } from "../server/review-real/security.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";
import { applySourceRegistryMigration, readSourceRegistryMigrationSql, SOURCE_REGISTRY_MIGRATION_SHA256, SOURCE_REGISTRY_SCHEMA10_SHA256, SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256, SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256, verifyAuthorityActivationReceipt, type SourceRegistryMigrationManifest } from "../server/rss/source-registry-migration.ts";
import { SqliteInternalOperationGateway, type OwnerSupervisorHandoff } from "../server/internal-operation/gateway.ts";
import { openAdmittedReviewDatabase, disposeAdmittedReviewDatabases } from "./helpers/admitted-review-database.ts";
import { SqliteGatewayMutationPort } from "../server/internal-operation/mutation-port.ts";
import { applyXManualInboxMigration } from "../server/tweet-inbox/repository.ts";
import type { RawAdminContext } from "../server/source-management/security.ts";
import { createHash } from "node:crypto";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function database9(path = ":memory:"): DatabaseSync {
  const database = new DatabaseSync(path);
  for (const file of [
    "0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql",
    "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"
  ]) database.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${file}`, "utf8"));
  database.prepare(`
    INSERT INTO pending_review_candidate(
      candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,
      source_payload_hash,source_revision,first_seen_at,last_seen_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "candidate-admin-bilingual", "motorsport-f1-news", "external-admin-bilingual", "1".repeat(64),
    "https://www.motorsport.com/f1/news/example/", "Source title", "Private source excerpt", "Source author",
    "2026-08-24T12:00:00.000Z", "2".repeat(64), 1, "2026-08-24T12:00:00.000Z", "2026-08-24T12:00:00.000Z"
  );
  applyInternalOperationMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8"));
  applyXManualInboxMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0008_x_manual_inbox.sql`, "utf8"));
  applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
  return database;
}

function sourceManifest(): SourceRegistryMigrationManifest {
  const shared = { scheduleSeconds: 900, routeIdentitySha256: "1".repeat(64), routeReleaseSha256: "2".repeat(64), routeManifestSha256: "3".repeat(64), rightsStatus: "clear" as const, mediaPolicy: "allowlisted" as const, authorizationExpiresAt: "2027-08-25T00:00:00.000Z", authorizationReceiptSha256: "4".repeat(64), sourcePolicySha256: "5".repeat(64) };
  return Object.freeze({ schemaVersion: "source-registry-migration-manifest-v1", migratedAt: "2026-08-25T00:00:00.000Z", rss: Object.freeze([
    { ...shared, sourceId: "motorsport-f1-news", displayName: "Motorsport.com", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
    { ...shared, sourceId: "autosport-f1-news", displayName: "Autosport", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
    { ...shared, sourceId: "racefans-f1-news", displayName: "RaceFans", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
    { ...shared, sourceId: "the-race-f1-news", displayName: "The Race", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" }
  ]) });
}

function database10(path = ":memory:"): DatabaseSync {
  const database = database9(path);
  applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), sourceManifest(), { applyEnabled: true });
  return database;
}

function context(input: Readonly<{ path: string; cookie: string; csrf?: string; fresh?: string; idempotencyKey?: string }>): RawAdminContext {
  const rawHeaders = new Map<string, readonly string[]>([
    ["origin", ["https://f1-admin.example.ts.net"]],
    ["sec-fetch-site", ["same-origin"]],
    ["cookie", [input.cookie]]
  ]);
  if (input.csrf) rawHeaders.set("x-csrf-token", [input.csrf]);
  if (input.fresh) rawHeaders.set("x-f1-fresh-reauth", [input.fresh]);
  if (input.idempotencyKey) rawHeaders.set("idempotency-key", [input.idempotencyKey]);
  return Object.freeze({
    method: "POST",
    path: input.path,
    authority: "f1-admin.example.ts.net",
    origin: "https://f1-admin.example.ts.net",
    peer: "loopback",
    rawHeaders,
    noEgressReady: true
  });
}

describe("schema9 bilingual Admin interim integration", () => {
  test("opens an exact schema9 read model without exposing full source text", () => {
    const database = database9();
    const repository = new BilingualAdminRepository(database);
    expect(repository.capability()).toEqual({
      enabled: false, status: "closed", reasonCode: "AUTHORITY_EXTENSION_REQUIRED", extensionSha256: null
    });
    expect(repository.list()).toMatchObject({
      schemaVersion: ADMIN_BILINGUAL_SCHEMA,
      mode: "INTERIM_READ_ONLY_PASS",
      deployable: false,
      automaticReviewRegistrations: 0,
      automaticPublishRegistrations: 0,
      items: [{ candidateId: "candidate-admin-bilingual", allowedActions: [] }]
    });
    expect(repository.detail("candidate-admin-bilingual")).toMatchObject({
      sourceText: { scope: "private_excerpt", excerpt: "Private source excerpt", fullSourceBodyExposed: false, redistributionAllowed: false },
      languages: { zh: { state: "missing" }, en: { state: "missing" } },
      rights: { copyRiskStatus: "unknown", rightsStatus: "unknown" },
      unavailableReasonCode: "AUTHORITY_EXTENSION_REQUIRED"
    });
    expect(repository.recentThree()).toMatchObject({ exactCount: 0, disposableBackfill: { enabled: false, destination: "disposable-only" } });
    database.close();
  });

  test("runtime opener accepts only the pinned existing schema9 identity", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "admin-bilingual-opener-"));
    const path = join(root, "f1plus1-rss-real-private.sqlite");
    const created = database9(path);
    created.close();
    chmodSync(path, 0o600);
    const identity = inspectExistingPrivateDatabase(path, "f1plus1-rss-real-private.sqlite");
    const opened = openReviewAdminDatabase({
      targetReleaseAppRoot: APP_ROOT,
      reviewDatabasePath: path,
      reviewDatabaseIdentity: identity,
      requiredSchemaVersion: 9
    });
    expect(opened.gateway).toBeNull();
    expect(opened.mutationPort).toBeNull();
    expect(opened.database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 9 });
    opened.database.close();
  });

  test("validates session, Origin, CSRF, request hash and idempotency before fixed closed response", () => {
    const database = database9();
    const security = new ReviewAdminSecurity({
      canonicalOrigin: "https://f1-admin.example.ts.net",
      sessionHashKey: Buffer.alloc(32, 7),
      now: () => Date.parse("2026-08-24T12:05:00.000Z"),
      readRecoveryFence: () => ({ clockTrusted: true, writerReady: true, lastSuccessfulRecoveryPointAt: Date.parse("2026-08-24T12:04:00.000Z") })
    });
    const session = security.acceptVerifiedSession({ operatorRef: "operator", deviceRef: "device", tailnetUserRef: "tailnet-user" });
    const routes = new BilingualAdminRoutes(new BilingualAdminRepository(database), security);
    const path = "/api/admin/bilingual/reviews/candidate-admin-bilingual/rerun";
    const unsigned = {
      schemaVersion: ADMIN_BILINGUAL_SCHEMA,
      action: "rerun" as const,
      candidateId: "candidate-admin-bilingual",
      language: "en" as const,
      expectedRevision: 0,
      idempotencyKey: "idem-bilingual-0001",
      clientRequestId: "client-bilingual-0001"
    };
    const mutation = {
      ...unsigned,
      requestHash: sha256(canonicalJson({ method: "POST", canonicalPath: path, body: unsigned }))
    };
    const csrfResult = routes.tryHandle(context({ path: "/api/admin/csrf", cookie: session.cookieHeader }), {
      schemaVersion: ADMIN_BILINGUAL_SCHEMA,
      mutation
    });
    const csrf = (csrfResult?.body as { csrfToken: string }).csrfToken;
    const result = routes.tryHandle(context({ path, cookie: session.cookieHeader, csrf, idempotencyKey: unsigned.idempotencyKey }), mutation);
    expect(result).toEqual({
      status: 503,
      body: expect.objectContaining({
        status: "closed",
        reasonCode: "AUTHORITY_EXTENSION_REQUIRED",
        writesToBaseDatabase: 0,
        externalCalls: 0,
        automaticReviewRegistrations: 0,
        automaticPublishRegistrations: 0,
        deployable: false
      })
    });
    expect(database.prepare("SELECT count(*) AS count FROM bilingual_operation_link_v1").get()).toEqual({ count: 0 });
    database.close();
  });

  test("raw authority activation remains impossible", () => {
    const database = database9();
    expect(() => database.exec("UPDATE bilingual_authority_capability_v1 SET enabled=1,status='enabled',reason_code='READY',extension_sha256='" + "a".repeat(64) + "' WHERE capability_id='bilingual-v1'"))
      .toThrow(/BILINGUAL_AUTHORITY_TRANSITION_INVALID/u);
    database.close();
  });

  test("requires a fresh passkey receipt for correct and binds it to the publication revision", () => {
    const database = database9();
    const security = new ReviewAdminSecurity({
      canonicalOrigin: "https://f1-admin.example.ts.net",
      sessionHashKey: Buffer.alloc(32, 9),
      now: () => Date.parse("2026-08-24T12:05:00.000Z"),
      readRecoveryFence: () => ({ clockTrusted: true, writerReady: true, lastSuccessfulRecoveryPointAt: Date.parse("2026-08-24T12:04:00.000Z") })
    });
    const session = security.acceptVerifiedSession({ operatorRef: "operator", deviceRef: "device", tailnetUserRef: "tailnet-user" });
    const routes = new BilingualAdminRoutes(new BilingualAdminRepository(database), security);
    const path = "/api/admin/bilingual/publications/public-bilingual-001/correct";
    const unsigned = {
      schemaVersion: ADMIN_BILINGUAL_SCHEMA,
      action: "correct" as const,
      publicationId: "public-bilingual-001",
      replacementBundleId: "bundle-bilingual-002",
      replacementApprovalId: "approval-bilingual-002",
      expectedRevision: 3,
      idempotencyKey: "idem-bilingual-correct-0001",
      clientRequestId: "client-bilingual-correct-0001"
    };
    const mutation = { ...unsigned, requestHash: sha256(canonicalJson({ method: "POST", canonicalPath: path, body: unsigned })) };
    const operationId = `bilingual_${sha256(`correct\n${unsigned.idempotencyKey}`).slice(0, 32)}`;
    const resourceHash = sha256(canonicalJson({ publicationId: unsigned.publicationId, expectedRevision: unsigned.expectedRevision, replacementBundleId: unsigned.replacementBundleId, replacementApprovalId: unsigned.replacementApprovalId, correctionScope: "whole-bilingual-bundle" }));
    const fresh = security.acceptVerifiedFreshReauth(context({ path: "/api/admin/auth/fresh/verify", cookie: session.cookieHeader }), {
      operationId,
      action: "BILINGUAL_CORRECT",
      resourceHash
    });
    const csrfResult = routes.tryHandle(context({ path: "/api/admin/csrf", cookie: fresh.cookieHeader }), { schemaVersion: ADMIN_BILINGUAL_SCHEMA, mutation });
    const csrf = (csrfResult?.body as { csrfToken: string }).csrfToken;
    expect(() => routes.tryHandle(context({ path, cookie: fresh.cookieHeader, csrf, idempotencyKey: unsigned.idempotencyKey }), mutation))
      .toThrowError(expect.objectContaining({ reasonCode: "ADMIN_REAUTH_REQUIRED" }));
    const result = routes.tryHandle(context({ path, cookie: fresh.cookieHeader, csrf, fresh: fresh.freshReceipt, idempotencyKey: unsigned.idempotencyKey }), mutation);
    expect(result).toMatchObject({ status: 503, body: { reasonCode: "MIGRATION_EXTENSION_REQUIRED", externalCalls: 0, writesToBaseDatabase: 0 } });
    database.close();
  });
});

describe("schema10 Admin authority integration", () => {
  afterEach(() => disposeAdmittedReviewDatabases());

  test("opens only an existing schema10 identity and pins the final 0009/0010 identities", () => {
    expect(SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256).toBe("d3a8e3de9ade121766af72e648b1cc5986bfd93556c091563ae66e58b0eedebd");
    expect(SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256).toBe("d2460592cb4c6aaec099155ff483224e33706dc6efaafb7a17dc1b22e86121f4");
    expect(SOURCE_REGISTRY_MIGRATION_SHA256).toBe("83c1aa4e350bc32fee594ffa4bec9caa85201ae120c29e21834c32463e36bb7a");
    expect(SOURCE_REGISTRY_SCHEMA10_SHA256).toBe("e802727799654dd3e02f1b8abe6ce071dc7c96a09d9a6110c52be080d13dda4f");
    const root = mkdtempSync(join(realpathSync(tmpdir()), "admin-schema10-opener-"));
    const path = join(root, "f1plus1-rss-real-private.sqlite");
    const created = database10(path); created.close(); chmodSync(path, 0o600);
    const identity = inspectExistingPrivateDatabase(path, "f1plus1-rss-real-private.sqlite");
    const opened = openReviewAdminDatabase({ targetReleaseAppRoot: APP_ROOT, reviewDatabasePath: path, reviewDatabaseIdentity: identity, requiredSchemaVersion: 10 });
    expect(opened.database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 10 });
    expect(opened.gateway).toBeNull(); opened.database.close();
  });

  test("activates the two bilingual capabilities through gateway five-truth receipts and bridges v1", () => {
    const handoffs: OwnerSupervisorHandoff[] = ["auto", "manual"].map((suffix, index) => Object.freeze({
      handoffId: `handoff-admin-${suffix}`,
      ownerProcess: "admin_http" as const,
      issuer: "f1plus1-owner-supervisor-v1" as const,
      oneTimeNonce: String.fromCharCode(97 + index).repeat(43),
      releaseSha256: "0".repeat(64), manifestSha256: "0".repeat(64), receiptSha256: String(index + 6).repeat(64),
      verifiedAt: `2026-08-25T00:00:0${index}.000Z`, expiresAt: "2099-08-26T00:00:00.000Z"
    }));
    const database = openAdmittedReviewDatabase({
      finalVersion: 10,
      seed: (seedDb: DatabaseSync) => {
        for (const file of ["0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql", "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"]) {
          seedDb.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${file}`, "utf8"));
        }
        seedDb.prepare(`INSERT INTO pending_review_candidate(
          candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,
          source_payload_hash,source_revision,first_seen_at,last_seen_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          "candidate-admin-bilingual", "motorsport-f1-news", "external-admin-bilingual", "1".repeat(64),
          "https://www.motorsport.com/f1/news/example/", "Source title", "Private source excerpt", "Source author",
          "2026-08-24T12:00:00.000Z", "2".repeat(64), 1, "2026-08-24T12:00:00.000Z", "2026-08-24T12:00:00.000Z"
        );
        applyInternalOperationMigration(seedDb, readFileSync(`${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8"));
        applyXManualInboxMigration(seedDb, readFileSync(`${APP_ROOT}/migrations/rss-real/0008_x_manual_inbox.sql`, "utf8"));
        applyBilingualMigration(seedDb, readBilingualMigrationSql(), { applyEnabled: true });
        applySourceRegistryMigration(seedDb, readSourceRegistryMigrationSql(), sourceManifest(), { applyEnabled: true });
        for (const handoff of handoffs) seedDb.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(handoff.handoffId, handoff.ownerProcess, handoff.issuer, handoff.oneTimeNonce, handoff.releaseSha256, handoff.manifestSha256, handoff.receiptSha256, handoff.verifiedAt, handoff.expiresAt);
      }
    });
    const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: "0".repeat(64), manifestSha256: "0".repeat(64), schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256, now: (() => { let index = 0; return () => new Date(`2026-08-25T00:00:0${index++}.000Z`); })() });
    const port = new SqliteGatewayMutationPort({ database, gateway, ownerProcess: "admin_http", handoffProvider: () => handoffs.shift()! });
    const first = port.transitionAuthority({ operationId: "authority-auto-admin", idempotencyKey: "authority-auto-admin", capabilityId: "bilingual_auto_refine", action: "enable", expectedVersion: 1, requestHash: "8".repeat(64), authorityReceiptSha256: "a".repeat(64) });
    const second = port.transitionAuthority({ operationId: "authority-manual-admin", idempotencyKey: "authority-manual-admin", capabilityId: "bilingual_manual_mutation", action: "enable", expectedVersion: 1, requestHash: "9".repeat(64), authorityReceiptSha256: "b".repeat(64) });
    expect(verifyAuthorityActivationReceipt(database, { capabilityId: first.capabilityId, operationId: first.operationId, receiptSha256: first.receiptSha256 }).valid).toBe(true);
    expect(verifyAuthorityActivationReceipt(database, { capabilityId: second.capabilityId, operationId: second.operationId, receiptSha256: second.receiptSha256 }).valid).toBe(true);
    expect(database.prepare("SELECT enabled,status,extension_sha256 FROM bilingual_authority_capability_v1").get()).toEqual({ enabled: 1, status: "enabled", extension_sha256: SOURCE_REGISTRY_SCHEMA10_SHA256 });
    const repository = new BilingualAdminRepository(database);
    expect(repository.capability()).toMatchObject({ enabled: true, status: "enabled", reasonCode: "READY", autoRefine: true, manualMutation: true });
    expect(repository.detail("candidate-admin-bilingual")).toMatchObject({
      deployable: false,
      allowedActions: [],
      unavailableActions: ["retry", "rerun", "review", "approve", "reject", "publish", "withdraw"],
      deferredActions: ["correct"],
      unavailableReasonCode: "BILINGUAL_MANUAL_SUBSTRATE_UNAVAILABLE"
    });
    expect(repository.sources()).toMatchObject({ schemaVersion: "admin-source-registry-v1", rssActive: 4, xManualDisabled: 59, authority: { enabled: false } });
    expect(repository.operationsOverview()).toMatchObject({
      sources: { total: 63, rssActive: 4, xManualDisabled: 59 },
      collection: { automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 },
      observability: {
        health: { frontend: { status: "unavailable", reasonCode: "PRODUCER_NOT_CONFIGURED" }, backend: { status: "available" }, adminApi: { status: "available" } },
        apis: { bilingualRead: { status: "available" }, sourceRead: { status: "available" }, operationsRead: { status: "available" }, bilingualManualWrite: { status: "unavailable", reasonCode: "BILINGUAL_MANUAL_SUBSTRATE_UNAVAILABLE" } },
        sourceManagement: { status: "closed", writesRequirePausedPhase: true },
        logs: { source: "internal_operation_audit" },
        errors: { internalOperations: 0, sourceOutboxFailed: 0 }
      },
      producers: { adminApiHealth: { status: "available" }, trafficStats: { status: "unavailable", reasonCode: "PRODUCER_NOT_CONFIGURED" }, costTelemetry: { status: "unavailable", reasonCode: "PRODUCER_NOT_CONFIGURED" } }
    });
    const security = new ReviewAdminSecurity({
      canonicalOrigin: "https://f1-admin.example.ts.net",
      sessionHashKey: Buffer.alloc(32, 5),
      now: () => Date.parse("2026-08-25T00:10:00.000Z"),
      readRecoveryFence: () => ({ clockTrusted: true, writerReady: true, lastSuccessfulRecoveryPointAt: Date.parse("2026-08-25T00:09:00.000Z") })
    });
    const session = security.acceptVerifiedSession({ operatorRef: "operator", deviceRef: "device", tailnetUserRef: "tailnet-user" });
    const routes = new BilingualAdminRoutes(repository, security);
    const path = "/api/admin/bilingual/reviews/candidate-admin-bilingual/retry";
    const unsigned = { schemaVersion: ADMIN_BILINGUAL_SCHEMA, action: "retry" as const, candidateId: "candidate-admin-bilingual", language: "en" as const, expectedRevision: 0, idempotencyKey: "idem-schema10-retry", clientRequestId: "client-schema10-retry" };
    const mutation = { ...unsigned, requestHash: sha256(canonicalJson({ method: "POST", canonicalPath: path, body: unsigned })) };
    const invalidUnsigned = { ...unsigned, language: "both" as const, idempotencyKey: "idem-schema10-both", clientRequestId: "client-schema10-both" };
    const invalidMutation = { ...invalidUnsigned, requestHash: sha256(canonicalJson({ method: "POST", canonicalPath: path, body: invalidUnsigned })) };
    expect(routes.tryHandle(context({ path: "/api/admin/csrf", cookie: session.cookieHeader }), { schemaVersion: ADMIN_BILINGUAL_SCHEMA, mutation: invalidMutation })).toBeNull();
    const csrfResult = routes.tryHandle(context({ path: "/api/admin/csrf", cookie: session.cookieHeader }), { schemaVersion: ADMIN_BILINGUAL_SCHEMA, mutation });
    const csrf = (csrfResult?.body as { csrfToken: string }).csrfToken;
    expect(routes.tryHandle(context({ path, cookie: session.cookieHeader, csrf, idempotencyKey: unsigned.idempotencyKey }), mutation)).toMatchObject({
      status: 503,
      body: { reasonCode: "BILINGUAL_MANUAL_SUBSTRATE_UNAVAILABLE", writesToBaseDatabase: 0, externalCalls: 0, automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 }
    });
    gateway.close();
  });

  test("binds a safety decision from fresh passkey through CSRF to one manual gateway operation", () => {
    const database = database10();
    const now = Date.parse("2026-08-25T00:10:00.000Z");
    const security = new ReviewAdminSecurity({
      canonicalOrigin: "https://f1-admin.example.ts.net",
      sessionHashKey: Buffer.alloc(32, 6),
      now: () => now,
      readRecoveryFence: () => ({ clockTrusted: true, writerReady: true, lastSuccessfulRecoveryPointAt: now - 60_000 })
    });
    const captured: Array<Readonly<Record<string, unknown>>> = [];
    const approvals: Array<Readonly<Record<string, unknown>>> = [];
    const manualPort: BilingualManualMutationPort = {
      commitApproval: (authorization, input) => {
        approvals.push({ authorization, input });
        return { approvalId: "approval-http-1", bundleId: "bundle-http-1", bundleHash: "b".repeat(64), decision: input.decision, operationId: authorization.operationId, approvalHash: "c".repeat(64), decidedAt: "2026-08-25T00:10:00.000Z" };
      },
      commitSafetyDecision: (authorization, input) => {
        captured.push({ authorization, input });
        return {
          receipt: {
            decisionId: "safety-decision-http-1", decisionSeq: 1, operationId: authorization.operationId,
            resourceHash: authorization.resourceHash, decisionHash: "a".repeat(64), decidedAt: "2026-08-25T00:10:00.000Z"
          },
          bundle: null
        };
      }
    };
    const repository = new BilingualAdminRepository(database, () => true);
    const routes = new BilingualAdminRoutes(repository, security, undefined, manualPort);
    const session = security.acceptVerifiedSession({ operatorRef: "operator", deviceRef: "device", tailnetUserRef: "tailnet-user" });
    const path = "/api/admin/bilingual/reviews/candidate-admin-bilingual/review";
    const unsigned = {
      schemaVersion: ADMIN_BILINGUAL_SCHEMA,
      action: "review" as const,
      candidateId: "candidate-admin-bilingual",
      sourceId: "motorsport-f1-news",
      inputContentHash: "2".repeat(64),
      safetyAction: "block" as const,
      blockReason: "RIGHTS_BLOCKED" as const,
      expectedDecisionSeq: 1,
      supersedesDecisionId: null,
      expectedRevision: 1,
      idempotencyKey: "idem-bilingual-safety-http-1",
      clientRequestId: "client-bilingual-safety-http-1"
    };
    const mutation = { ...unsigned, requestHash: sha256(canonicalJson({ method: "POST", canonicalPath: path, body: unsigned })) };
    const prepared = prepareBilingualMutation(mutation);
    expect(prepared.binding.freshAction).toBe("BILINGUAL_SAFETY_REVIEW");
    const fresh = security.acceptVerifiedFreshReauth(context({ path: "/api/admin/auth/fresh/verify", cookie: session.cookieHeader }), {
      operationId: prepared.binding.operationId,
      action: "BILINGUAL_SAFETY_REVIEW",
      resourceHash: prepared.binding.resourceHash!
    });
    const csrfResult = routes.tryHandle(context({ path: "/api/admin/csrf", cookie: fresh.cookieHeader }), { schemaVersion: ADMIN_BILINGUAL_SCHEMA, mutation });
    const csrf = (csrfResult?.body as { csrfToken: string }).csrfToken;
    const mutationContext = context({ path, cookie: fresh.cookieHeader, csrf, fresh: fresh.freshReceipt, idempotencyKey: unsigned.idempotencyKey });
    expect(routes.tryHandle(mutationContext, mutation)).toMatchObject({
      status: 200,
      body: { status: "succeeded", writesToBaseDatabase: 1, externalCalls: 0, automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 }
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      authorization: {
        actorRef: "operator", operationId: prepared.binding.operationId, bodyHash: prepared.binding.bodyHash,
        resourceHash: prepared.binding.resourceHash, freshAction: "BILINGUAL_SAFETY_DECISION",
        verifiedAt: "2026-08-25T00:10:00.000Z"
      },
      input: {
        candidateId: unsigned.candidateId, sourceId: unsigned.sourceId, sourceRevision: 1,
        inputContentHash: unsigned.inputContentHash, action: "block", blockReason: "RIGHTS_BLOCKED",
        expectedDecisionSeq: 1, supersedesDecisionId: null
      }
    });
    expect(() => routes.tryHandle(mutationContext, mutation)).toThrowError(expect.objectContaining({ reasonCode: "ADMIN_CSRF_REJECTED" }));
    expect(captured).toHaveLength(1);

    const approvalPath = "/api/admin/bilingual/reviews/candidate-admin-bilingual/approve";
    const approvalUnsigned = { schemaVersion: ADMIN_BILINGUAL_SCHEMA, action: "approve" as const, candidateId: "candidate-admin-bilingual", expectedRevision: 1, idempotencyKey: "idem-bilingual-approve-http-1", clientRequestId: "client-bilingual-approve-http-1" };
    const approvalMutation = { ...approvalUnsigned, requestHash: sha256(canonicalJson({ method: "POST", canonicalPath: approvalPath, body: approvalUnsigned })) };
    const approvalCsrfResult = routes.tryHandle(context({ path: "/api/admin/csrf", cookie: fresh.cookieHeader }), { schemaVersion: ADMIN_BILINGUAL_SCHEMA, mutation: approvalMutation });
    const approvalCsrf = (approvalCsrfResult?.body as { csrfToken: string }).csrfToken;
    expect(routes.tryHandle(context({ path: approvalPath, cookie: fresh.cookieHeader, csrf: approvalCsrf, idempotencyKey: approvalUnsigned.idempotencyKey }), approvalMutation)).toMatchObject({ status: 200, body: { status: "succeeded", externalCalls: 0, automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 } });
    expect(approvals).toMatchObject([{ authorization: { actorRef: "operator" }, input: { candidateId: "candidate-admin-bilingual", expectedBundleRevision: 1, decision: "approved" } }]);
    database.close();
  });
});
