import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  realpathSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, test } from "vitest";

import {
  ADMIN_RELEASE_RUNTIME_FILES,
  ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256
} from "../server/admin-service/release-manifest.ts";
import {
  activateReleaseCandidate,
  assertFallbackCapabilities,
  assertReleaseCandidate,
  buildReleasePairReceipt,
  buildReleaseSwitchReceipt,
  collectReleaseFiles,
  fallbackV10Capabilities,
  fullV10Capabilities,
  loadReleaseRuntimeGate,
  observeReleaseRuntime,
  releaseIdForRole,
  releasePathRoot,
  releaseSourcePreimageSha256,
  type ReleaseCandidateManifest
} from "../server/internal-operation/release.ts";
import { canonicalJsonV1, SqliteInternalOperationGateway, type OwnerSupervisorHandoff } from "../server/internal-operation/gateway.ts";
import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import {
  PUBLIC_RELEASE_RUNTIME_FILES,
  PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256
} from "../server/public/release-manifest.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";
import {
  applySourceRegistryMigration,
  readSourceRegistryMigrationSql,
  SOURCE_REGISTRY_MIGRATION_SHA256,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256,
  type SourceRegistryMigrationManifest
} from "../server/rss/source-registry-migration.ts";
import { applyXManualInboxMigration } from "../server/tweet-inbox/repository.ts";
import { openAdmittedReviewFixture, disposeAdmittedReviewDatabases } from "./helpers/admitted-review-database.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");
const ZERO = "0".repeat(64);
const roots: string[] = [];

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceManifest(): SourceRegistryMigrationManifest {
  const common = {
    scheduleSeconds: 900,
    routeIdentitySha256: "1".repeat(64),
    routeReleaseSha256: "2".repeat(64),
    routeManifestSha256: "3".repeat(64),
    rightsStatus: "clear" as const,
    mediaPolicy: "allowlisted" as const,
    authorizationExpiresAt: "2027-08-25T00:00:00.000Z",
    authorizationReceiptSha256: "4".repeat(64),
    sourcePolicySha256: "5".repeat(64)
  };
  return Object.freeze({
    schemaVersion: "source-registry-migration-manifest-v1",
    migratedAt: "2026-08-25T00:00:00.000Z",
    rss: Object.freeze([
      { ...common, sourceId: "motorsport-f1-news", displayName: "Motorsport.com", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
      { ...common, sourceId: "autosport-f1-news", displayName: "Autosport", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
      { ...common, sourceId: "racefans-f1-news", displayName: "RaceFans", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
      { ...common, sourceId: "the-race-f1-news", displayName: "The Race", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" }
    ])
  });
}

function releasePair(): Readonly<{
  full: ReleaseCandidateManifest;
  fallback: ReleaseCandidateManifest;
  receipt: ReturnType<typeof buildReleasePairReceipt>;
}> {
  const files = collectReleaseFiles(APP_ROOT, [...new Set([
    ...ADMIN_RELEASE_RUNTIME_FILES,
    ...PUBLIC_RELEASE_RUNTIME_FILES
  ])]);
  const identity = {
    schemaVersion: 10 as const,
    sourceCommitSha1: "a".repeat(40),
    sourceTreeSha1: "b".repeat(40),
    schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
    migration0009RawSha256: SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256,
    migration0010RawSha256: SOURCE_REGISTRY_MIGRATION_SHA256,
    adminRuntimeFileCount: 153 as const,
    adminRuntimePathSetSha256: ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
    publicRuntimeFileCount: 89 as const,
    publicRuntimePathSetSha256: PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256,
    packageLockSha256: files.find((file) => file.path === "package-lock.json")!.sha256,
    packageRootSha256: "c".repeat(64),
    pathRootSha256: releasePathRoot(files)
  } as const;
  const sourcePreimageSha256 = releaseSourcePreimageSha256(identity);
  const base = { ...identity, sourcePreimageSha256, files };
  const full: ReleaseCandidateManifest = {
    ...base,
    role: "full_v10",
    releaseId: releaseIdForRole("full_v10", sourcePreimageSha256),
    capabilities: fullV10Capabilities()
  };
  const fallback: ReleaseCandidateManifest = {
    ...base,
    role: "manual_only_fallback_v10",
    releaseId: releaseIdForRole("manual_only_fallback_v10", sourcePreimageSha256),
    capabilities: fallbackV10Capabilities()
  };
  return Object.freeze({
    full,
    fallback,
    receipt: buildReleasePairReceipt(full, fallback, "2026-08-25T00:00:00.000Z")
  });
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});
afterEach(() => disposeAdmittedReviewDatabases());

describe("schema10 deployment release pair", () => {
  test("binds full and manual fallback to one source/package/path preimage and closes all fallback egress", () => {
    const pair = releasePair();
    assertReleaseCandidate(pair.full);
    assertFallbackCapabilities(pair.fallback);
    expect(pair.full.sourcePreimageSha256).toBe(pair.fallback.sourcePreimageSha256);
    expect(pair.full.pathRootSha256).toBe(pair.fallback.pathRootSha256);
    expect(pair.full.packageRootSha256).toBe(pair.fallback.packageRootSha256);
    expect(pair.fallback.adminRuntimeFileCount).toBe(153);
    expect(pair.fallback.publicRuntimeFileCount).toBe(89);
    expect(pair.fallback.capabilities.manualSafetyReviewPublishWithdraw).toBe(true);
    expect(pair.fallback.capabilities.manualOutboxCreate).toBe(true);
    expect(pair.fallback.capabilities.publicLkg).toBe(true);
    expect(pair.fallback.capabilities.collectorNetwork).toBe(false);
    expect(pair.fallback.capabilities.modelNetwork).toBe(false);
    expect(pair.fallback.capabilities.retryModelCalls).toBe(false);
    expect(pair.fallback.capabilities.automaticReview).toBe(false);
    expect(pair.fallback.capabilities.automaticPublish).toBe(false);

    expect(() => assertFallbackCapabilities({
      ...pair.fallback,
      capabilities: { ...pair.fallback.capabilities, modelNetwork: true }
    })).toThrow("FALLBACK_CAPABILITY_MODELNETWORK_OPEN");
    expect(() => assertReleaseCandidate({
      ...pair.full,
      schemaSha256: ZERO
    })).toThrow("RELEASE_SCHEMA_IDENTITY_MISMATCH");
    expect(() => assertReleaseCandidate({
      ...pair.full,
      files: pair.full.files.slice(1),
      pathRootSha256: releasePathRoot(pair.full.files.slice(1))
    })).toThrow("RELEASE_RUNTIME_PATHS_INCOMPLETE");
  });

  test("loads only externally anchored owner-private pair bytes and rejects tamper or identity substitution", () => {
    const release = releasePair();
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-release-loader-v10-"));
    roots.push(root);
    const fullPath = join(root, "full.json");
    const fallbackPath = join(root, "fallback.json");
    const pairPath = join(root, "pair.json");
    const fullJson = canonicalJsonV1(release.full);
    const fallbackJson = canonicalJsonV1(release.fallback);
    const pairJson = canonicalJsonV1(release.receipt);
    writeFileSync(fullPath, fullJson, { mode: 0o600 });
    writeFileSync(fallbackPath, fallbackJson, { mode: 0o600 });
    writeFileSync(pairPath, pairJson, { mode: 0o600 });
    const input = {
      releaseRoot: root,
      fullManifestPath: fullPath,
      fullManifestSha256: sha256(fullJson),
      fallbackManifestPath: fallbackPath,
      fallbackManifestSha256: sha256(fallbackJson),
      pairReceiptPath: pairPath,
      pairReceiptSha256: sha256(pairJson),
      expectedSourceCommitSha1: release.full.sourceCommitSha1,
      expectedSourceTreeSha1: release.full.sourceTreeSha1,
      expectedPackageRootSha256: release.full.packageRootSha256,
      activeRole: "manual_only_fallback_v10" as const,
      activatedAt: "2026-08-25T00:00:00.000Z",
      previousActivationId: null
    };
    expect(loadReleaseRuntimeGate(input).gate.receipt.role).toBe("manual_only_fallback_v10");
    expect(() => loadReleaseRuntimeGate({ ...input, fullManifestSha256: ZERO })).toThrow("RELEASE_FULL_MANIFEST_FILE_INVALID");
    expect(() => loadReleaseRuntimeGate({ ...input, expectedSourceCommitSha1: "8".repeat(40) })).toThrow("RELEASE_EXTERNAL_ANCHOR_MISMATCH");
    const withUnknownKey = canonicalJsonV1({ ...release.full, unexpected: true });
    writeFileSync(fullPath, withUnknownKey, { mode: 0o600 });
    expect(() => loadReleaseRuntimeGate({ ...input, fullManifestSha256: sha256(withUnknownKey) })).toThrow("RELEASE_MANIFEST_INVALID");
    writeFileSync(fullPath, fullJson, { mode: 0o600 });
    const roleFlip = canonicalJsonV1({ ...release.fallback, role: "full_v10", releaseId: release.full.releaseId });
    writeFileSync(fallbackPath, roleFlip, { mode: 0o600 });
    expect(() => loadReleaseRuntimeGate({ ...input, fallbackManifestSha256: sha256(roleFlip) })).toThrow();
  });

  test("switches full to fallback and rolls back without schema, DB, outbox, idempotency, LKG or automation drift", () => {
    const pair = releasePair();
    const handoff: OwnerSupervisorHandoff = Object.freeze({
      handoffId: "handoff-release-switch-observation",
      ownerProcess: "admin_http",
      issuer: "f1plus1-owner-supervisor-v1",
      oneTimeNonce: "r".repeat(43),
      releaseSha256: ZERO,
      manifestSha256: ZERO,
      receiptSha256: "d".repeat(64),
      verifiedAt: "2026-08-25T00:00:00.000Z",
      expiresAt: "2099-08-26T00:00:00.000Z"
    });
    const fixture = openAdmittedReviewFixture({
      finalVersion: 10,
      seed: (seedDb: DatabaseSync) => {
        for (const file of [
          "0001_rss_real.sql",
          "0002_admin_review_publish.sql",
          "0003_projection_delivery_runtime.sql",
          "0004_rss_media_and_chinese_refinement.sql",
          "0005_second_rss_autosport.sql",
          "0006_independent_rss_racefans_the_race.sql"
        ]) seedDb.exec(readFileSync(join(APP_ROOT, "migrations/rss-real", file), "utf8"));
        applyInternalOperationMigration(seedDb, readFileSync(join(APP_ROOT, "migrations/rss-real/0007_internal_operation_recovery_phase.sql"), "utf8"));
        applyXManualInboxMigration(seedDb, readFileSync(join(APP_ROOT, "migrations/rss-real/0008_x_manual_inbox.sql"), "utf8"));
        applyBilingualMigration(seedDb, readBilingualMigrationSql(), { applyEnabled: true });
        applySourceRegistryMigration(seedDb, readSourceRegistryMigrationSql(), sourceManifest(), { applyEnabled: true });
        seedDb.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(
          handoff.handoffId,
          handoff.ownerProcess,
          handoff.issuer,
          handoff.oneTimeNonce,
          handoff.releaseSha256,
          handoff.manifestSha256,
          handoff.receiptSha256,
          handoff.verifiedAt,
          handoff.expiresAt
        );
      }
    });
    const database = fixture.database;
    const path = fixture.path;
    const gateway = new SqliteInternalOperationGateway({
      database,
      releaseSha256: ZERO,
      manifestSha256: ZERO,
      schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
      now: () => new Date("2026-08-25T00:00:01.000Z")
    });
    const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>;
    gateway.request(handoff, {
      schemaVersion: "operation-request-v1",
      operationId: "operation-release-switch-observation",
      idempotencyKey: "idempotency-release-switch-observation",
      operationKind: "phase_control",
      ownerProcess: "admin_http",
      capabilityClass: "control",
      policyId: "p-phase-control-disabled",
      authorizationHandoffId: handoff.handoffId,
      controlAction: "fence_update",
      identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
      entitySet: [{ entityKind: "internal_control", entityId: "1", identitySelector: "control_singleton", expectedVersion: null, expectedHash: ZERO }],
      requiredFenceSet: [],
      expected: {
        controlVersion: Number(control.version),
        entityVersion: null,
        entityHash: ZERO,
        schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
        releaseSha256: ZERO,
        manifestSha256: ZERO,
        sourceStopEpoch: null,
        writerEpoch: Number(control.writer_epoch),
        epochs: {
          sourceConfig: Number(control.source_config_epoch),
          sourceSafety: Number(control.source_safety_epoch),
          authorization: Number(control.authorization_version),
          policy: Number(control.policy_epoch),
          recovery: Number(control.recovery_epoch)
        }
      },
      phase: "disabled",
      egressClass: "none",
      budgetRequest: null,
      modelRouteRef: null,
      requestHash: sha256("release-switch-request"),
      requestFingerprint: sha256("release-switch-fingerprint")
    });
    const publicLkgSha256 = "e".repeat(64);
    const fullGate = activateReleaseCandidate(pair.full, pair.receipt, "2026-08-25T00:00:02.000Z", null);
    const fallbackGate = activateReleaseCandidate(pair.fallback, pair.receipt, "2026-08-25T00:00:03.000Z", fullGate.receipt.activationId);
    let forbiddenCallbacks = 0;
    for (const action of [
      "collector_network", "model_network", "retry_model_call", "automatic_review", "automatic_publish"
    ] as const) {
      expect(() => fallbackGate.run(action, () => { forbiddenCallbacks += 1; })).toThrow(`RELEASE_RUNTIME_ACTION_CLOSED:${action}`);
    }
    expect(forbiddenCallbacks).toBe(0);
    expect(fallbackGate.run("manual_safety_review_publish_withdraw", () => "manual-ready")).toBe("manual-ready");
    expect(fallbackGate.run("manual_outbox_create", () => "outbox-ready")).toBe("outbox-ready");
    expect(fallbackGate.run("public_lkg", () => publicLkgSha256)).toBe(publicLkgSha256);
    const rollbackGate = activateReleaseCandidate(pair.full, pair.receipt, "2026-08-25T00:00:04.000Z", fallbackGate.receipt.activationId);
    const fullBefore = observeReleaseRuntime(database, fullGate, publicLkgSha256);
    const fallbackAfter = observeReleaseRuntime(database, fallbackGate, publicLkgSha256);
    const rollbackAfter = observeReleaseRuntime(database, rollbackGate, publicLkgSha256);
    const receipt = buildReleaseSwitchReceipt(pair.receipt, fullBefore, fallbackAfter, rollbackAfter);
    expect(fullBefore.schemaVersion).toBe(10);
    expect(fullBefore.schemaSha256).toBe(SOURCE_REGISTRY_SCHEMA10_SHA256);
    expect(fullBefore.idempotencyRows).toBeGreaterThan(0);
    expect(fallbackAfter.databaseLogicalSha256).toBe(fullBefore.databaseLogicalSha256);
    expect(rollbackAfter.databaseLogicalSha256).toBe(fullBefore.databaseLogicalSha256);
    expect(receipt.databaseUnchanged).toBe(true);
    expect(receipt.outboxUnchanged).toBe(true);
    expect(receipt.idempotencyUnchanged).toBe(true);
    expect(receipt.automaticReviewRegistrations).toBe(0);
    expect(receipt.automaticPublishRegistrations).toBe(0);
    gateway.close();
    fixture.close();

    const reopened = new DatabaseSync(path, { readOnly: true });
    expect(Number((reopened.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version)).toBe(10);
    expect(Number((reopened.prepare(
      "SELECT COUNT(*) AS count FROM internal_operation WHERE idempotency_key='idempotency-release-switch-observation'"
    ).get() as Record<string, unknown>).count)).toBe(1);
    expect(Number((reopened.prepare(
      "SELECT COUNT(*) AS count FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher')"
    ).get() as Record<string, unknown>).count)).toBe(0);
    reopened.close();
  });
});
