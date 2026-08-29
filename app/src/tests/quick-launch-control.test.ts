import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { openAdmittedReviewDatabase, disposeAdmittedReviewDatabases } from "./helpers/admitted-review-database.ts";
import { SqliteInternalOperationGateway, type OwnerSupervisorHandoff } from "../server/internal-operation/gateway.ts";
import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";
import {
  applySourceRegistryMigration, readSourceRegistryMigrationSql,
  SOURCE_REGISTRY_SCHEMA10_SHA256, type SourceRegistryMigrationManifest
} from "../server/rss/source-registry-migration.ts";
import { applyXManualInboxMigration } from "../server/tweet-inbox/repository.ts";
import { runQuickLaunchControlSequence, type QuickLaunchControlHandoffSet } from "../server/internal-operation/quick-launch-control.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const SCHEMA10_SHA256 = SOURCE_REGISTRY_SCHEMA10_SHA256;
const MIGRATIONS = [
  "0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql",
  "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql",
  "0007_internal_operation_recovery_phase.sql", "0008_x_manual_inbox.sql"
] as const;

function sourceRegistryManifest(): SourceRegistryMigrationManifest {
  const shared = { scheduleSeconds: 900, routeIdentitySha256: "1".repeat(64), routeReleaseSha256: "2".repeat(64), routeManifestSha256: "3".repeat(64), rightsStatus: "clear" as const, mediaPolicy: "allowlisted" as const, authorizationExpiresAt: "2027-08-25T00:00:00.000Z", authorizationReceiptSha256: "4".repeat(64), sourcePolicySha256: "5".repeat(64) };
  return Object.freeze({ schemaVersion: "source-registry-migration-manifest-v1", migratedAt: "2026-08-25T00:00:00.000Z", rss: Object.freeze([
    { ...shared, sourceId: "motorsport-f1-news", displayName: "Motorsport.com", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
    { ...shared, sourceId: "autosport-f1-news", displayName: "Autosport", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
    { ...shared, sourceId: "racefans-f1-news", displayName: "RaceFans", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
    { ...shared, sourceId: "the-race-f1-news", displayName: "The Race", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" }
  ]) });
}

const ZERO = "0".repeat(64);
const RELEASE = "a".repeat(64);
const MANIFEST = "b".repeat(64);

function handoff(id: string, owner: OwnerSupervisorHandoff["ownerProcess"]): OwnerSupervisorHandoff {
  return {
    schemaVersion: "owner-supervisor-handoff-v1", handoffId: id, ownerProcess: owner,
    issuer: "f1plus1-owner-supervisor-v1", oneTimeNonce: id.padEnd(43, "a"),
    releaseSha256: RELEASE, manifestSha256: MANIFEST,
    receiptSha256: createHash("sha256").update(id).digest("hex"),
    verifiedAt: "2026-08-24T00:00:00.000Z", expiresAt: "2026-08-25T00:00:00.000Z"
  };
}
function handoffSet(): QuickLaunchControlHandoffSet {
  return {
    "clear-deletion-fence": handoff("h1", "admin_http"),
    "clear-publication-fence": handoff("h2", "admin_http"),
    "recovery-restoring": handoff("h3", "restore_operator"),
    "recovery-verifying": handoff("h4", "restore_operator"),
    "writer-epoch-bump": handoff("h5", "system_supervisor"),
    "recovery-complete": handoff("h6", "system_supervisor"),
    "clear-global-stop": handoff("h7", "admin_http"),
    "enter-backlog": handoff("h8", "admin_http"),
    "enter-live": handoff("h9", "admin_http")
  };
}
function v10(handoffs: readonly OwnerSupervisorHandoff[]): DatabaseSync {
  return openAdmittedReviewDatabase({
    finalVersion: 10,
    seed: (database: DatabaseSync) => {
      for (const migration of MIGRATIONS.slice(0, 6)) database.exec(readFileSync(join(APP_ROOT, "migrations/rss-real", migration), "utf8"));
      applyInternalOperationMigration(database, readFileSync(join(APP_ROOT, "migrations/rss-real/0007_internal_operation_recovery_phase.sql"), "utf8"));
      applyXManualInboxMigration(database, readFileSync(join(APP_ROOT, "migrations/rss-real/0008_x_manual_inbox.sql"), "utf8"));
      applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
      applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), sourceRegistryManifest(), { applyEnabled: true });
      for (const value of handoffs) {
        database.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(
          value.handoffId, value.ownerProcess, value.issuer, value.oneTimeNonce, value.releaseSha256,
          value.manifestSha256, value.receiptSha256, value.verifiedAt, value.expiresAt
        );
      }
    }
  });
}

describe("quick-launch fail-closed control sequence", () => {
  afterEach(() => disposeAdmittedReviewDatabases());
  test("runs every owner handoff through gateway request, authorize, authorizeWrite, mutate and postcheck", () => {
    const values = handoffSet();
    const database = v10(Object.values(values));
    const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: RELEASE, manifestSha256: MANIFEST, schemaSha256: SCHEMA10_SHA256, now: () => new Date("2026-08-24T00:00:00.000Z") });
    try {
      const result = runQuickLaunchControlSequence({ database, gateway, handoffs: values, releaseSha256: RELEASE, manifestSha256: MANIFEST, schemaSha256: SCHEMA10_SHA256, now: () => new Date("2026-08-24T00:00:00.000Z") });
      expect(result).toMatchObject({
        phase: "live", globalStopState: "clear", emergencyStopState: "clear", recoveryState: "ready",
        deletionFenceState: "clear", publicationFenceState: "clear", writerEpoch: 2, recoveryEpoch: 2,
        controlVersion: 10, automaticReviewOperations: 0, automaticPublishOperations: 0
      });
      expect(result.receipts.map((receipt) => receipt.resultingControlVersion)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const operations = database.prepare("SELECT operation_id,owner_process,operation_kind,control_action,state,version FROM internal_operation ORDER BY rowid").all() as Array<Record<string, unknown>>;
      expect(operations).toHaveLength(9);
      expect(operations.every((operation) => operation.state === "succeeded" && operation.version === 3)).toBe(true);
      expect(operations.filter((operation) => operation.owner_process === "automatic_reviewer" || operation.owner_process === "automatic_publisher")).toHaveLength(0);
    } finally {
      gateway.close();
    }
  });
  test("rejects a wrong owner before creating an operation", () => {
    const values = { ...handoffSet(), "recovery-restoring": handoff("h3", "system_supervisor") };
    const database = v10(Object.values(values));
    const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: RELEASE, manifestSha256: MANIFEST, schemaSha256: SCHEMA10_SHA256, now: () => new Date("2026-08-24T00:00:00.000Z") });
    try {
      expect(() => runQuickLaunchControlSequence({ database, gateway, handoffs: values, releaseSha256: RELEASE, manifestSha256: MANIFEST, schemaSha256: SCHEMA10_SHA256 })).toThrow("QUICK_LAUNCH_HANDOFF_OWNER_MISMATCH");
      expect(database.prepare("SELECT count(*) AS count FROM internal_operation").get()).toMatchObject({ count: 0 });
    } finally {
      gateway.close();
    }
  });
  test("rejects a release identity mismatch before database mutation", () => {
    const values = handoffSet();
    const database = v10(Object.values(values));
    const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: RELEASE, manifestSha256: MANIFEST, schemaSha256: SCHEMA10_SHA256, now: () => new Date("2026-08-24T00:00:00.000Z") });
    try {
      expect(() => runQuickLaunchControlSequence({ database, gateway, handoffs: values, releaseSha256: ZERO, manifestSha256: MANIFEST, schemaSha256: SCHEMA10_SHA256 })).toThrow("QUICK_LAUNCH_HANDOFF_RELEASE_MISMATCH");
      expect(database.prepare("SELECT count(*) AS count FROM internal_operation").get()).toMatchObject({ count: 0 });
      const control = database.prepare("SELECT phase,global_stop_state,recovery_state,version FROM internal_control").get() as Record<string, unknown>;
      expect(control).toMatchObject({ phase: "disabled", global_stop_state: "stopped", recovery_state: "fenced", version: 1 });
    } finally {
      gateway.close();
    }
  });
});
