import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SqliteInternalOperationGateway, type OwnerSupervisorHandoff } from "../src/server/internal-operation/gateway.ts";
import { persistOwnerSupervisorHandoff } from "../src/server/internal-operation/owner-supervisor.ts";
import {
  inspectExistingPrivateDatabase,
  openExistingSafeDatabase
} from "../src/server/db/database.ts";
import { applyInternalOperationMigration } from "../src/server/review-real/migration.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../src/server/rss/bilingual-migration.ts";
import {
  applySourceRegistryMigration,
  readSourceRegistryMigrationSql,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  type SourceRegistryMigrationManifest
} from "../src/server/rss/source-registry-migration.ts";
import { applyXManualInboxMigration } from "../src/server/tweet-inbox/repository.ts";

const ZERO = "0".repeat(64);

function sha256(value: string): string {
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

export function createDisposableSchema10ReleaseDatabase(appRoot: string): Readonly<{
  database: DatabaseSync;
  path: string;
  root: string;
}> {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-release-switch-v10-"));
  const path = join(root, "f1plus1-rss-real-private.sqlite");
  const seedDatabase = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    for (const file of [
      "0001_rss_real.sql",
      "0002_admin_review_publish.sql",
      "0003_projection_delivery_runtime.sql",
      "0004_rss_media_and_chinese_refinement.sql",
      "0005_second_rss_autosport.sql",
      "0006_independent_rss_racefans_the_race.sql"
    ]) seedDatabase.exec(readFileSync(join(appRoot, "migrations/rss-real", file), "utf8"));
    applyInternalOperationMigration(seedDatabase, readFileSync(join(appRoot, "migrations/rss-real/0007_internal_operation_recovery_phase.sql"), "utf8"));
    applyXManualInboxMigration(seedDatabase, readFileSync(join(appRoot, "migrations/rss-real/0008_x_manual_inbox.sql"), "utf8"));
    applyBilingualMigration(seedDatabase, readBilingualMigrationSql(), { applyEnabled: true });
    applySourceRegistryMigration(seedDatabase, readSourceRegistryMigrationSql(), sourceManifest(), { applyEnabled: true });
  } catch (error) {
    try { seedDatabase.close(); } catch { /* preserve seed failure */ }
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  seedDatabase.close();
  try {
    const identity = inspectExistingPrivateDatabase(path, basename(path));
    const database = openExistingSafeDatabase(path, basename(path), identity, [10]);
    return Object.freeze({ database, path, root });
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function seedReleaseSwitchIdempotency(database: DatabaseSync): SqliteInternalOperationGateway {
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
  persistOwnerSupervisorHandoff(database, handoff, () => true);
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
  return gateway;
}
