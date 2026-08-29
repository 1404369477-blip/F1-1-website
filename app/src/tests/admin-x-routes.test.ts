import { createHash } from "node:crypto";
import { request as httpRequest, type Server } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../server/db/profile.ts";
import type { AdminPasskeyAuth } from "../server/admin-service/auth.ts";
import {
  createAdminServiceServer,
  parseTrustedAdminIdentity
} from "../server/admin-service/server.ts";
import { SqliteInternalOperationGateway } from "../server/internal-operation/gateway.ts";
import { SqliteGatewayMutationPort } from "../server/internal-operation/mutation-port.ts";
import { persistOwnerSupervisorHandoff } from "../server/internal-operation/owner-supervisor.ts";
import { ReviewAdminBackend } from "../server/review-real/backend.ts";
import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { ReviewRealRepository } from "../server/review-real/repository.ts";
import {
  prepareXManualRetireMutation,
  ReviewAdminRoutes
} from "../server/review-real/routes.ts";
import { ReviewAdminSecurity } from "../server/review-real/security.ts";
import type { RawAdminContext } from "../server/source-management/security.ts";
import {
  applyXManualInboxMigration,
  readXManualInboxMigrationSql,
  XManualInboxRepository,
  X_MANUAL_INBOX_SCHEMA_SHA256
} from "../server/tweet-inbox/repository.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";
import {
  applySourceRegistryMigration,
  readSourceRegistryMigrationSql,
  type SourceRegistryMigrationManifest
} from "../server/rss/source-registry-migration.ts";
import { openAdmittedReviewDatabase, disposeAdmittedReviewDatabases } from "./helpers/admitted-review-database.ts";

const ADMIN_ORIGIN = "https://admin.f1.test";
const ZERO = "0".repeat(64);
const opened: Array<Readonly<{ database: DatabaseSync; gateway: SqliteInternalOperationGateway }>> = [];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function contractHash(input: Readonly<{
  path: string;
  resourceId: string;
  expectedRevision: number;
  bodyWithoutMeta: unknown;
}>): string {
  return sha256(canonicalJson({
    method: "POST",
    canonicalPath: input.path,
    resourceId: input.resourceId,
    expectedRevision: input.expectedRevision,
    bodyWithoutMeta: input.bodyWithoutMeta
  }));
}

function handoff(index: number) {
  return {
    handoffId: `admin-x-route-handoff-${index}`,
    ownerProcess: "admin_http" as const,
    issuer: "f1plus1-owner-supervisor-v1" as const,
    oneTimeNonce: `adminxroute${String(index).padStart(2, "0")}`.padEnd(43, "a"),
    releaseSha256: ZERO,
    manifestSha256: ZERO,
    receiptSha256: sha256(`admin-x-route-handoff-receipt-${index}`),
    verifiedAt: "2026-08-24T00:00:00.000Z",
    expiresAt: "2099-08-25T00:00:00.000Z"
  };
}

function context(input: Readonly<{
  method: "GET" | "POST";
  path: string;
  cookie: string;
  csrf?: string;
  fresh?: string;
  idempotency?: string | readonly string[];
}>): RawAdminContext {
  const rawHeaders = new Map<string, readonly string[]>([
    ["cookie", [input.cookie]],
    ["origin", [ADMIN_ORIGIN]],
    ["sec-fetch-site", ["same-origin"]]
  ]);
  if (input.csrf) rawHeaders.set("x-csrf-token", [input.csrf]);
  if (input.fresh) rawHeaders.set("x-f1-fresh-reauth", [input.fresh]);
  if (input.idempotency) {
    rawHeaders.set("idempotency-key", typeof input.idempotency === "string" ? [input.idempotency] : input.idempotency);
  }
  return Object.freeze({
    method: input.method,
    path: input.path,
    authority: "admin.f1.test",
    origin: ADMIN_ORIGIN,
    peer: "loopback" as const,
    rawHeaders,
    noEgressReady: true as const
  });
}

function setup() {
  const handoffs = Array.from({ length: 24 }, (_, index) => handoff(index + 1));
  const database = openAdmittedReviewDatabase({
    finalVersion: 8,
    seed: (seedDatabase: DatabaseSync) => {
      for (const migration of [
        "0001_rss_real.sql",
        "0002_admin_review_publish.sql",
        "0003_projection_delivery_runtime.sql",
        "0004_rss_media_and_chinese_refinement.sql",
        "0005_second_rss_autosport.sql",
        "0006_independent_rss_racefans_the_race.sql"
      ]) {
        seedDatabase.exec(readFileSync(new URL(`../../migrations/rss-real/${migration}`, import.meta.url), "utf8"));
      }
      applyInternalOperationMigration(
        seedDatabase,
        readFileSync(new URL("../../migrations/rss-real/0007_internal_operation_recovery_phase.sql", import.meta.url), "utf8")
      );
      applyXManualInboxMigration(seedDatabase, readXManualInboxMigrationSql());
      for (const value of handoffs) persistOwnerSupervisorHandoff(seedDatabase, value, () => true);
    }
  });
  let handoffIndex = 0;
  const gateway = new SqliteInternalOperationGateway({
    database,
    releaseSha256: ZERO,
    manifestSha256: ZERO,
    schemaSha256: X_MANUAL_INBOX_SCHEMA_SHA256,
    now: () => new Date("2026-08-24T00:30:00.000Z")
  });
  const port = new SqliteGatewayMutationPort({
    database,
    gateway,
    ownerProcess: "admin_http",
    handoffProvider: () => handoffs[handoffIndex++]!,
    now: () => new Date("2026-08-24T00:30:00.000Z")
  });
  let securityNow = Date.parse("2026-08-24T00:30:00.000Z");
  let randomCounter = 0;
  const security = new ReviewAdminSecurity({
    canonicalOrigin: ADMIN_ORIGIN,
    sessionHashKey: Buffer.alloc(32, 0x4f),
    readRecoveryFence: () => ({
      clockTrusted: true,
      writerReady: true,
      lastSuccessfulRecoveryPointAt: securityNow - 60_000
    }),
    now: () => securityNow,
    randomBytes: (size) => Buffer.alloc(size, ++randomCounter)
  });
  const repository = new ReviewRealRepository(database, () => new Date(securityNow), port);
  const routes = new ReviewAdminRoutes(
    new ReviewAdminBackend(repository, security),
    security,
    new XManualInboxRepository(database, port),
    () => new Date(securityNow)
  );
  const session = security.acceptVerifiedSession({
    operatorRef: "operator-primary",
    deviceRef: "device-primary",
    tailnetUserRef: "tailnet-primary"
  });
  opened.push({ database, gateway });
  return {
    database,
    routes,
    security,
    cookie: session.cookieHeader,
    advance: () => { securityNow += 1_000; }
  };
}

function submitMutation(index: number, submittedUrl = `https://x.com/Ferrari/status/10000000000000000${index}`) {
  const clientRequestId = `client_submit_${String(index).padStart(4, "0")}`;
  const idempotencyKey = `idem_submit_${String(index).padStart(4, "0")}`;
  return {
    meta: {
      idempotencyKey,
      expectedRevision: 0,
      requestHash: contractHash({
        path: "/api/admin/x-submissions",
        resourceId: "x-manual-inbox",
        expectedRevision: 0,
        bodyWithoutMeta: { submittedUrl }
      }),
      clientRequestId
    },
    submittedUrl
  };
}

function retireMutation(submissionId: string, revision: number, index: number, reasonCode: "OPERATOR_REQUEST" | "RETIREMENT" = "RETIREMENT") {
  const path = `/api/admin/x-submissions/${submissionId}/retire`;
  return {
    submissionId,
    meta: {
      idempotencyKey: `idem_retire_${String(index).padStart(4, "0")}`,
      expectedRevision: revision,
      requestHash: contractHash({
        path,
        resourceId: submissionId,
        expectedRevision: revision,
        bodyWithoutMeta: { reasonCode }
      }),
      clientRequestId: `client_retire_${String(index).padStart(4, "0")}`
    },
    reasonCode
  };
}

function issueCsrf(routes: ReviewAdminRoutes, cookie: string, operationType: "x-submit" | "x-retire", mutation: unknown) {
  const result = routes.handle(context({ method: "POST", path: "/api/admin/csrf", cookie }), {
    schemaVersion: "admin-review-csrf-v1",
    operationType,
    mutation
  });
  expect(result.status).toBe(200);
  return String((result.body as Record<string, unknown>).csrfToken);
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function httpPost(input: Readonly<{
  port: number;
  path: string;
  body: unknown;
  cookie: string;
  sourceRef: string;
  idempotencyKey?: string;
  csrf?: string;
}>): Promise<Readonly<{ status: number; body: Record<string, unknown> }>> {
  const bytes = Buffer.from(JSON.stringify(input.body));
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: input.port,
      method: "POST",
      path: input.path,
      headers: {
        Host: "admin.f1.test",
        Origin: ADMIN_ORIGIN,
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json",
        "Content-Length": String(bytes.length),
        "Tailscale-User-Login": "owner@example.com",
        "Tailscale-App-Capabilities": JSON.stringify({
          "example.com/cap/f1-admin-device": [{ sourceRef: input.sourceRef }]
        }),
        "X-Forwarded-For": "100.64.0.1",
        "X-Forwarded-Host": "admin.f1.test",
        "X-Forwarded-Proto": "https",
        Cookie: input.cookie,
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
        ...(input.csrf ? { "X-CSRF-Token": input.csrf } : {})
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        try {
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
          });
        } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.end(bytes);
  });
}

afterEach(() => {
  while (opened.length > 0) opened.pop()!.gateway.close();
  disposeAdmittedReviewDatabases();
});

describe("Admin X production route contract", () => {
  it("rejects legacy, open-object, wrong-hash and missing/multiple idempotency-header submissions", () => {
    const runtime = setup();
    const path = "/api/admin/x-submissions";
    const legacy = {
      schemaVersion: "admin-x-manual-v1",
      submittedUrl: "https://x.com/Ferrari/status/100000000000000001",
      operationId: "xop_legacy0001",
      idempotencyKey: "legacy_submit_0001"
    };
    expect(runtime.routes.handle(context({ method: "POST", path, cookie: runtime.cookie }), legacy)).toMatchObject({ status: 400 });

    const openObject = { ...submitMutation(1), legacy: true };
    expect(runtime.routes.handle(context({ method: "POST", path, cookie: runtime.cookie }), openObject)).toMatchObject({ status: 400 });

    const wrongHash = submitMutation(2);
    wrongHash.meta.requestHash = "0".repeat(64);
    expect(runtime.routes.handle(context({ method: "POST", path, cookie: runtime.cookie }), wrongHash)).toMatchObject({ status: 400 });

    const missingHeader = submitMutation(3);
    const csrf = issueCsrf(runtime.routes, runtime.cookie, "x-submit", missingHeader);
    expect(runtime.routes.handle(context({ method: "POST", path, cookie: runtime.cookie, csrf }), missingHeader)).toMatchObject({ status: 400 });
    expect(runtime.routes.handle(context({
      method: "POST",
      path,
      cookie: runtime.cookie,
      csrf,
      idempotency: [missingHeader.meta.idempotencyKey, missingHeader.meta.idempotencyKey]
    }), missingHeader)).toMatchObject({ status: 400 });

    const accepted = runtime.routes.handle(context({
      method: "POST",
      path,
      cookie: runtime.cookie,
      csrf,
      idempotency: missingHeader.meta.idempotencyKey
    }), missingHeader);
    expect(accepted).toMatchObject({ status: 202 });
    expect((accepted.body as { submission: { state: string } }).submission.state).toBe("submitted");
  });

  it("binds CSRF to the exact canonical body and retire to the matching one-time fresh grant", () => {
    const runtime = setup();
    const submitPath = "/api/admin/x-submissions";
    const first = submitMutation(10);
    const firstCsrf = issueCsrf(runtime.routes, runtime.cookie, "x-submit", first);
    const changed = submitMutation(11);
    expect(runtime.routes.handle(context({
      method: "POST",
      path: submitPath,
      cookie: runtime.cookie,
      csrf: firstCsrf,
      idempotency: changed.meta.idempotencyKey
    }), changed)).toMatchObject({ status: 403 });

    const changedCsrf = issueCsrf(runtime.routes, runtime.cookie, "x-submit", changed);
    const submitted = runtime.routes.handle(context({
      method: "POST",
      path: submitPath,
      cookie: runtime.cookie,
      csrf: changedCsrf,
      idempotency: changed.meta.idempotencyKey
    }), changed);
    expect(submitted.status).toBe(202);
    const submission = (submitted.body as { submission: { submissionId: string; revision: number } }).submission;

    const legacyRetire = {
      schemaVersion: "admin-x-manual-v1",
      expectedRevision: submission.revision,
      reasonCode: "RETIREMENT",
      operationId: "xop_legacyretire01",
      idempotencyKey: "legacy_retire_0001"
    };
    expect(runtime.routes.handle(context({
      method: "POST",
      path: `/api/admin/x-submissions/${submission.submissionId}/retire`,
      cookie: runtime.cookie
    }), legacyRetire)).toMatchObject({ status: 400 });

    const retire = retireMutation(submission.submissionId, submission.revision, 1);
    const prepared = prepareXManualRetireMutation(retire);
    const fresh = runtime.security.acceptVerifiedFreshReauth(
      context({ method: "POST", path: "/api/admin/auth/fresh/verify", cookie: runtime.cookie }),
      {
        operationId: prepared.binding.operationId,
        action: "SOURCE_RETIRE",
        resourceHash: prepared.binding.resourceHash!
      }
    );
    const retireCsrf = issueCsrf(runtime.routes, fresh.cookieHeader, "x-retire", retire);
    const actualBody = { meta: retire.meta, reasonCode: retire.reasonCode };
    expect(runtime.routes.handle(context({
      method: "POST",
      path: prepared.binding.path,
      cookie: fresh.cookieHeader,
      csrf: retireCsrf,
      idempotency: retire.meta.idempotencyKey
    }), actualBody)).toMatchObject({ status: 403 });

    const successful = runtime.routes.handle(context({
      method: "POST",
      path: prepared.binding.path,
      cookie: fresh.cookieHeader,
      csrf: retireCsrf,
      fresh: fresh.freshReceipt,
      idempotency: retire.meta.idempotencyKey
    }), actualBody);
    expect(successful).toMatchObject({ status: 202 });
    expect((successful.body as { submission: { state: string; revision: number } }).submission).toMatchObject({
      state: "retired",
      revision: submission.revision + 1
    });
  });

  it("enforces the closed meta and Idempotency-Key contract through the real Admin HTTP dispatcher", async () => {
    const runtime = setup();
    const sourceRef = "a".repeat(43);
    const trustedIdentities = [{
      login: "owner@example.com",
      operatorRef: "operator-primary",
      sourceRefs: [sourceRef, "b".repeat(43), "c".repeat(43)]
    }] as const;
    const identity = parseTrustedAdminIdentity({
      rawHeaders: [
        "Tailscale-User-Login", "owner@example.com",
        "Tailscale-App-Capabilities", JSON.stringify({
          "example.com/cap/f1-admin-device": [{ sourceRef }]
        })
      ],
      tailscaleAppCapabilityId: "example.com/cap/f1-admin-device",
      trustedIdentities
    });
    const httpSession = runtime.security.acceptVerifiedSession(identity);
    const server = createAdminServiceServer({
      canonicalOrigin: ADMIN_ORIGIN,
      tailscaleAppCapabilityId: "example.com/cap/f1-admin-device",
      trustedIdentities,
      auth: {} as AdminPasskeyAuth,
      reviewRoutes: runtime.routes,
      security: runtime.security,
      projectionDeliveryReceipt: () => { throw new Error("UNUSED"); },
      staticRoot: new URL("../admin-ui", import.meta.url).pathname
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const legacy = await httpPost({
        port,
        path: "/api/admin/x-submissions",
        cookie: httpSession.cookieHeader,
        sourceRef,
        body: {
          schemaVersion: "admin-x-manual-v1",
          submittedUrl: "https://x.com/Ferrari/status/100000000000000009",
          operationId: "xop_legacyhttp01",
          idempotencyKey: "legacy_http_0001"
        }
      });
      expect(legacy).toMatchObject({ status: 400, body: { reasonCode: "ADMIN_REQUEST_INVALID" } });

      const mutation = submitMutation(20);
      const csrfResponse = await httpPost({
        port,
        path: "/api/admin/csrf",
        cookie: httpSession.cookieHeader,
        sourceRef,
        body: { schemaVersion: "admin-review-csrf-v1", operationType: "x-submit", mutation }
      });
      expect(csrfResponse.status).toBe(200);
      const csrf = String(csrfResponse.body.csrfToken);
      const missing = await httpPost({
        port,
        path: "/api/admin/x-submissions",
        cookie: httpSession.cookieHeader,
        sourceRef,
        csrf,
        body: mutation
      });
      expect(missing).toMatchObject({ status: 400, body: { reasonCode: "ADMIN_REQUEST_INVALID" } });
      const accepted = await httpPost({
        port,
        path: "/api/admin/x-submissions",
        cookie: httpSession.cookieHeader,
        sourceRef,
        csrf,
        idempotencyKey: mutation.meta.idempotencyKey,
        body: mutation
      });
      expect(accepted.status).toBe(202);
      expect(accepted.body).toMatchObject({ externalCalls: 0, automaticReview: false, automaticPublish: false });
    } finally {
      await closeServer(server);
    }
  });
function schema10SourceRegistryManifest(): SourceRegistryMigrationManifest {
  const shared = {
    scheduleSeconds: 900,
    routeIdentitySha256: "1".repeat(64),
    routeReleaseSha256: "2".repeat(64),
    routeManifestSha256: "3".repeat(64),
    rightsStatus: "clear" as const,
    mediaPolicy: "allowlisted" as const,
    authorizationExpiresAt: "2027-08-27T00:00:00.000Z",
    authorizationReceiptSha256: "4".repeat(64),
    sourcePolicySha256: "5".repeat(64)
  };
  return Object.freeze({
    schemaVersion: "source-registry-migration-manifest-v1",
    migratedAt: "2026-08-27T00:00:00.000Z",
    rss: [
      { ...shared, sourceId: "motorsport-f1-news", displayName: "Motorsport.com", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
      { ...shared, sourceId: "autosport-f1-news", displayName: "Autosport", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
      { ...shared, sourceId: "racefans-f1-news", displayName: "RaceFans", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
      { ...shared, sourceId: "the-race-f1-news", displayName: "The Race", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" }
    ]
  });
}

it("bridges schema10 identity without pinning mutable X governance state", () => {
  const database = openAdmittedReviewDatabase({
    finalVersion: 10,
    seed: (seedDatabase: DatabaseSync) => {
      for (const migration of [
        "0001_rss_real.sql",
        "0002_admin_review_publish.sql",
        "0003_projection_delivery_runtime.sql",
        "0004_rss_media_and_chinese_refinement.sql",
        "0005_second_rss_autosport.sql",
        "0006_independent_rss_racefans_the_race.sql"
      ]) seedDatabase.exec(readFileSync(new URL(`../../migrations/rss-real/${migration}`, import.meta.url), "utf8"));
      applyInternalOperationMigration(seedDatabase, readFileSync(new URL("../../migrations/rss-real/0007_internal_operation_recovery_phase.sql", import.meta.url), "utf8"));
      applyXManualInboxMigration(seedDatabase, readXManualInboxMigrationSql());
      applyBilingualMigration(seedDatabase, readBilingualMigrationSql(), { applyEnabled: true });
      applySourceRegistryMigration(seedDatabase, readSourceRegistryMigrationSql(), schema10SourceRegistryManifest(), { applyEnabled: true });
    }
  });
  expect(new XManualInboxRepository(database).listSources()).toHaveLength(59);
  disposeAdmittedReviewDatabases();
});
});
