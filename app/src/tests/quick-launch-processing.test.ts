import { readFileSync } from "node:fs";

import { afterEach, describe, expect, test } from "vitest";

import { canonicalJsonV1 } from "../server/internal-operation/gateway.ts";
import { SqliteInternalOperationGateway } from "../server/internal-operation/gateway.ts";
import {
  createQuickLaunchProcessingHandoffSet,
  parseQuickLaunchProcessingPreflightCli,
  planQuickLaunchProcessingPreflight,
  runQuickLaunchProcessingPreflight,
} from "../server/internal-operation/quick-launch-processing.ts";
import { persistOwnerSupervisorHandoff } from "../server/internal-operation/owner-supervisor.ts";
import { trustedLocalBootstrap } from "../server/internal-operation/trusted-local-bootstrap.ts";
import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";
import { applySourceRegistryMigration, readSourceRegistryMigrationSql, SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256, verifyAuthorityActivationReceipt, type SourceRegistryMigrationManifest } from "../server/rss/source-registry-migration.ts";
import { applyXManualInboxMigration } from "../server/tweet-inbox/repository.ts";
import type { OwnerSupervisorHandoff } from "../server/internal-operation/gateway.ts";
import { openAdmittedReviewFixture, disposeAdmittedReviewDatabases } from "./helpers/admitted-review-database.ts";
import type { DatabaseSync } from "node:sqlite";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");
const ZERO = "0".repeat(64);
const NOW = Date.now();
const SCHEMA10 = "e802727799654dd3e02f1b8abe6ce071dc7c96a09d9a6110c52be080d13dda4f";

function sourceManifest(): SourceRegistryMigrationManifest {
  const common = {
    scheduleSeconds: 900,
    routeIdentitySha256: "a".repeat(64),
    routeReleaseSha256: ZERO,
    routeManifestSha256: ZERO,
    rightsStatus: "clear" as const,
    mediaPolicy: "zero_media" as const,
    authorizationExpiresAt: "2027-08-25T00:00:00.000Z",
    authorizationReceiptSha256: "b".repeat(64),
    sourcePolicySha256: "c".repeat(64),
  };
  return Object.freeze({
    schemaVersion: "source-registry-migration-manifest-v1",
    migratedAt: "2026-08-25T00:00:00.000Z",
    rss: Object.freeze([
      { ...common, sourceId: "motorsport-f1-news", displayName: "Motorsport.com", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
      { ...common, sourceId: "autosport-f1-news", displayName: "Autosport", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
      { ...common, sourceId: "racefans-f1-news", displayName: "RaceFans", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
      { ...common, sourceId: "the-race-f1-news", displayName: "The Race", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" },
    ]),
  });
}

function insertCandidate(database: DatabaseSync, candidateId: string, revision = 1, payload = "2"): void {
  database.prepare(`INSERT INTO pending_review_candidate(
    candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,
    source_payload_hash,source_revision,first_seen_at,last_seen_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    candidateId,
    "motorsport-f1-news",
    `external-${candidateId}`,
    candidateId.slice(0, 20).padEnd(20, "0").replaceAll(/[^0-9a-f]/gu, "0") + "1".repeat(44),
    "https://www.motorsport.com/f1/news/example/",
    "Source title",
    "Private source excerpt",
    "Source author",
    "2026-08-24T12:00:00.000Z",
    payload.repeat(64),
    revision,
    "2026-08-24T12:00:00.000Z",
    "2026-08-24T12:00:00.000Z",
  );
}

function openSchema10Fixture(candidates: ReadonlyArray<readonly [id: string, revision?: number, payload?: string]>) {
  return openAdmittedReviewFixture({
    finalVersion: 10,
    seed: (database) => {
      for (const file of [
        "0001_rss_real.sql",
        "0002_admin_review_publish.sql",
        "0003_projection_delivery_runtime.sql",
        "0004_rss_media_and_chinese_refinement.sql",
        "0005_second_rss_autosport.sql",
        "0006_independent_rss_racefans_the_race.sql",
      ]) database.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${file}`, "utf8"));
      for (const [id, revision, payload] of candidates) insertCandidate(database, id, revision, payload);
      applyInternalOperationMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8"));
      applyXManualInboxMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0008_x_manual_inbox.sql`, "utf8"));
      applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
      applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), sourceManifest(), { applyEnabled: true });
      database.prepare(`INSERT INTO source_registry_health_v1(
        health_id,source_id,state,last_attempt_at,last_success_at,next_eligible_at,reason_code,external_calls,observed_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        "health-qlp-preflight", "motorsport-f1-news", "healthy",
        "2026-08-24T12:00:00.000Z", "2026-08-24T12:00:00.000Z", "2026-08-24T12:15:00.000Z",
        "PREFLIGHT_OK", 0, "2026-08-25T00:00:05.000Z",
      );
    },
  });
}

function persistHandoff(database: DatabaseSync, handoff: OwnerSupervisorHandoff): void {
  persistOwnerSupervisorHandoff(database, handoff, (candidate) => candidate === handoff);
}

function handoff(id: string, ownerProcess: OwnerSupervisorHandoff["ownerProcess"], marker: string): OwnerSupervisorHandoff {
  return Object.freeze({
    schemaVersion: "owner-supervisor-handoff-v1",
    handoffId: id,
    ownerProcess,
    issuer: "f1plus1-owner-supervisor-v1",
    oneTimeNonce: marker.repeat(43),
    releaseSha256: ZERO,
    manifestSha256: ZERO,
    receiptSha256: `${marker}`.padEnd(64, "d"),
    verifiedAt: "2026-08-25T00:00:05.000Z",
    expiresAt: "2099-08-26T00:00:00.000Z",
  });
}

function clearSingletonFences(database: DatabaseSync): void {
  const controls = [handoff("qlp-test-clear-deletion", "admin_http", "1"), handoff("qlp-test-clear-publication", "admin_http", "2")];
  for (const value of controls) persistHandoff(database, value);
  const gateway = new SqliteInternalOperationGateway({
    database,
    releaseSha256: ZERO,
    manifestSha256: ZERO,
    schemaSha256: "f3c0c049575b3121cccc8e66438481c70931df461cd941b95aaa54100844ad60",
    now: () => new Date(NOW),
  });
  let queue = controls.shift.bind(controls);
  try {
    trustedLocalBootstrap({
      database,
      gateway,
      handoffProvider: () => queue()!,
      requests: [
        { operationId: "qlp-test-clear-deletion", fence: "deletion", expectedControlVersion: 1 },
        { operationId: "qlp-test-clear-publication", fence: "publication", expectedControlVersion: 2 },
      ],
      now: () => new Date(NOW),
    });
  } finally {
    gateway.close();
  }
}

function processingGateway(database: DatabaseSync) {
  return new SqliteInternalOperationGateway({
    database,
    releaseSha256: ZERO,
    manifestSha256: ZERO,
    schemaSha256: SCHEMA10,
    now: (() => {
      let tick = 0;
      return () => new Date(NOW + tick++ * 1_000);
    })(),
  });
}

describe("quick-launch processing preflight", () => {
  afterEach(() => disposeAdmittedReviewDatabases());

  test("enables all authorities in order and issues bounded candidate publication/completeness fences", () => {
    const fixture = openSchema10Fixture([["candidate-qlp-ready"]]);
    const database = fixture.database;
    clearSingletonFences(database);
    const plan = planQuickLaunchProcessingPreflight({
      database,
      releaseSha256: ZERO,
      manifestSha256: ZERO,
      schemaSha256: SCHEMA10,
      limit: 1,
      now: () => new Date(NOW),
    });
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]!.missingFenceKinds).toEqual(["publication", "completeness"]);
    expect(plan.authorityPending).toEqual({
      bilingual_auto_refine: true,
      bilingual_manual_mutation: true,
      source_registry_management: true,
    });
    const handoffs = createQuickLaunchProcessingHandoffSet({
      database,
      plan,
      releaseSha256: ZERO,
      manifestSha256: ZERO,
      now: NOW,
    });
    const gateway = processingGateway(database);
    try {
      const result = runQuickLaunchProcessingPreflight({
        database,
        gateway,
        plan,
        handoffs,
        releaseSha256: ZERO,
        manifestSha256: ZERO,
        schemaSha256: SCHEMA10,
        now: () => new Date(NOW),
      });
      expect(result.decision).toBe("PASS");
      expect(Object.keys(result.authority)).toEqual([
        "bilingual_auto_refine",
        "bilingual_manual_mutation",
        "source_registry_management",
      ]);
      for (const capabilityId of Object.keys(result.authority) as Array<keyof typeof result.authority>) {
        expect(result.authority[capabilityId].state).toBe("enabled");
        expect(result.authority[capabilityId].reused).toBe(false);
        expect(result.authority[capabilityId].receiptSha256).toMatch(/^[0-9a-f]{64}$/u);
      }
      expect(result.fences.map((fence) => fence.state)).toEqual(["issued", "issued"]);
      expect(database.prepare("SELECT capability_id,state,version FROM quick_launch_authority_v2 ORDER BY CASE capability_id WHEN 'bilingual_auto_refine' THEN 1 WHEN 'bilingual_manual_mutation' THEN 2 ELSE 3 END").all()).toEqual([
        { capability_id: "bilingual_auto_refine", state: "enabled", version: 2 },
        { capability_id: "bilingual_manual_mutation", state: "enabled", version: 2 },
        { capability_id: "source_registry_management", state: "enabled", version: 2 },
      ]);
      expect(database.prepare("SELECT COUNT(*) AS count FROM quick_launch_authority_audit_v2").get()).toEqual({ count: 3 });
      expect(database.prepare("SELECT enabled,status,reason_code,schema_sha256,extension_sha256 FROM bilingual_authority_capability_v1 WHERE capability_id='bilingual-v1'").get()).toEqual({
        enabled: 1,
        status: "enabled",
        reason_code: "READY",
        schema_sha256: SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256,
        extension_sha256: SCHEMA10,
      });
      for (const capabilityId of ["bilingual_auto_refine", "bilingual_manual_mutation", "source_registry_management"] as const) {
        const state = database.prepare("SELECT updated_by_operation_id,authority_receipt_sha256 FROM quick_launch_authority_v2 WHERE capability_id=?").get(capabilityId) as Record<string, unknown>;
        expect(verifyAuthorityActivationReceipt(database, {
          capabilityId,
          operationId: String(state.updated_by_operation_id),
          receiptSha256: String(state.authority_receipt_sha256),
        }).valid).toBe(true);
      }
      expect(database.prepare("SELECT COUNT(*) AS count FROM generic_fence_receipt WHERE scope_kind='candidate'").get()).toEqual({ count: 2 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM bilingual_publication_v1").get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher')").get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM internal_operation_outbox").get()).toEqual({ count: 0 });
      const receipt = database.prepare("SELECT expires_at,observed_at,policy_epoch,recovery_epoch,writer_epoch FROM generic_fence_receipt WHERE fence_kind='completeness'").get() as Record<string, unknown>;
      expect(Number(receipt.policy_epoch)).toBe(1);
      expect(Number(receipt.recovery_epoch)).toBe(1);
      expect(Number(receipt.writer_epoch)).toBe(1);
      expect(Date.parse(String(receipt.expires_at)) - Date.parse(String(receipt.observed_at))).toBe(900_000);
    } finally {
      gateway.close();
    }
  });

  test("reuses unexpired same-epoch receipts without duplicate authority or fences", () => {
    const fixture = openSchema10Fixture([["candidate-qlp-reuse"]]);
    const database = fixture.database;
    clearSingletonFences(database);
    const firstPlan = planQuickLaunchProcessingPreflight({ database, releaseSha256: ZERO, manifestSha256: ZERO, schemaSha256: SCHEMA10, limit: 1, now: () => new Date(NOW) });
    const firstHandoffs = createQuickLaunchProcessingHandoffSet({ database, plan: firstPlan, releaseSha256: ZERO, manifestSha256: ZERO, now: NOW });
    const gateway = processingGateway(database);
    try {
      runQuickLaunchProcessingPreflight({ database, gateway, plan: firstPlan, handoffs: firstHandoffs, releaseSha256: ZERO, manifestSha256: ZERO, schemaSha256: SCHEMA10, now: () => new Date(NOW) });
      const audits = database.prepare("SELECT COUNT(*) AS count FROM quick_launch_authority_audit_v2").get() as Record<string, unknown>;
      const receipts = database.prepare("SELECT COUNT(*) AS count FROM generic_fence_receipt").get() as Record<string, unknown>;
      const secondPlan = planQuickLaunchProcessingPreflight({ database, releaseSha256: ZERO, manifestSha256: ZERO, schemaSha256: SCHEMA10, limit: 1, now: () => new Date(NOW + 1_000) });
      expect(secondPlan.authorityPending).toEqual({
        bilingual_auto_refine: false,
        bilingual_manual_mutation: false,
        source_registry_management: false,
      });
      expect(secondPlan.fenceJobs).toHaveLength(0);
      const result = runQuickLaunchProcessingPreflight({ database, gateway, plan: secondPlan, handoffs: { authority: {}, fence: {} }, releaseSha256: ZERO, manifestSha256: ZERO, schemaSha256: SCHEMA10, now: () => new Date(NOW + 2_000) });
      for (const capabilityId of Object.keys(result.authority) as Array<keyof typeof result.authority>) {
        expect(result.authority[capabilityId].reused).toBe(true);
      }
      expect(result.fences).toHaveLength(0);
      expect(database.prepare("SELECT COUNT(*) AS count FROM quick_launch_authority_audit_v2").get()).toEqual(audits);
      expect(database.prepare("SELECT COUNT(*) AS count FROM generic_fence_receipt").get()).toEqual(receipts);
    } finally {
      gateway.close();
    }
  });

  test("fails closed before authority or fence mutation when source readiness is invalid", () => {
    const fixture = openSchema10Fixture([["candidate-qlp-stale", 2, "9"]]);
    const database = fixture.database;
    clearSingletonFences(database);
    expect(() => planQuickLaunchProcessingPreflight({ database, releaseSha256: ZERO, manifestSha256: ZERO, schemaSha256: SCHEMA10, limit: 1, now: () => new Date(NOW) }))
      .toThrow(/^QUICK_LAUNCH_PROCESSING_READINESS_FAILED:/u);
    expect(database.prepare("SELECT capability_id,state,version,updated_by_operation_id,authority_receipt_sha256 FROM quick_launch_authority_v2 ORDER BY capability_id").all()).toEqual([
      { capability_id: "bilingual_auto_refine", state: "closed", version: 1, updated_by_operation_id: null, authority_receipt_sha256: null },
      { capability_id: "bilingual_manual_mutation", state: "closed", version: 1, updated_by_operation_id: null, authority_receipt_sha256: null },
      { capability_id: "source_registry_management", state: "closed", version: 1, updated_by_operation_id: null, authority_receipt_sha256: null },
    ]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM quick_launch_authority_audit_v2").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM generic_fence_receipt WHERE scope_kind='candidate'").get()).toEqual({ count: 0 });
  });

  test("CLI accepts only an absolute manifest path and a bounded integer limit", () => {
    expect(parseQuickLaunchProcessingPreflightCli(["--manifest", "/tmp/manifest.json", "--limit", "1"])).toEqual({ manifestPath: "/tmp/manifest.json", limit: 1 });
    expect(() => parseQuickLaunchProcessingPreflightCli(["--manifest", "relative.json", "--limit", "1"])).toThrow("CLI_ARGUMENT_PATH_MUST_BE_ABSOLUTE");
    expect(() => parseQuickLaunchProcessingPreflightCli(["--manifest", "/tmp/manifest.json", "--limit", "0"])).toThrow("CLI_ARGUMENTS_FORBIDDEN");
    expect(() => parseQuickLaunchProcessingPreflightCli(["--manifest", "/tmp/manifest.json", "--limit", "51"])).toThrow("CLI_ARGUMENTS_FORBIDDEN");
    expect(() => parseQuickLaunchProcessingPreflightCli(["--manifest", "/tmp/manifest.json"])).toThrow("CLI_ARGUMENTS_FORBIDDEN");
    expect(canonicalJsonV1({ decision: "PASS" })).toBe('{"decision":"PASS"}');
  });
});
