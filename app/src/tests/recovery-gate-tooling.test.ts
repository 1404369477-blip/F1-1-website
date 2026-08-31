import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";

import { runSnapshotOnce, runRestoreDrill } from "../server/backup-snapshot/core.ts";
import { runBackupRecoveryPointRegister } from "../server/internal-operation/backup-recovery-point-register.ts";
import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";
import { installSchema10RssCollectorPlist, RSS_COLLECTOR_INTERVAL_SECONDS, RSS_COLLECTOR_LABEL } from "../server/rss/deployment.ts";
import {
  applySourceRegistryMigration,
  readSourceRegistryMigrationSql,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  type SourceRegistryMigrationManifest
} from "../server/rss/source-registry-migration.ts";
import { inspectExistingPrivateDatabase, openExistingSafeDatabase } from "../server/db/database.ts";
import { applyXManualInboxMigration } from "../server/tweet-inbox/repository.ts";
import { openAdmittedReviewFixture, disposeAdmittedReviewDatabases } from "./helpers/admitted-review-database.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const MIGRATIONS = [
  "0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql",
  "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql",
  "0007_internal_operation_recovery_phase.sql", "0008_x_manual_inbox.sql"
] as const;
const RELEASE = "a".repeat(64);
const MANIFEST = "b".repeat(64);
const roots: string[] = [];

afterEach(() => {
  disposeAdmittedReviewDatabases();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

function sourceRegistryManifest(): SourceRegistryMigrationManifest {
  const shared = {
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
      { ...shared, sourceId: "motorsport-f1-news", displayName: "Motorsport.com", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
      { ...shared, sourceId: "autosport-f1-news", displayName: "Autosport", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
      { ...shared, sourceId: "racefans-f1-news", displayName: "RaceFans", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
      { ...shared, sourceId: "the-race-f1-news", displayName: "The Race", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" }
    ])
  });
}

function seedSchema10(database: DatabaseSync): void {
  for (const migration of MIGRATIONS.slice(0, 6)) database.exec(readFileSync(join(APP_ROOT, "migrations/rss-real", migration), "utf8"));
  applyInternalOperationMigration(database, readFileSync(join(APP_ROOT, "migrations/rss-real/0007_internal_operation_recovery_phase.sql"), "utf8"));
  applyXManualInboxMigration(database, readFileSync(join(APP_ROOT, "migrations/rss-real/0008_x_manual_inbox.sql"), "utf8"));
  applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
  applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), sourceRegistryManifest(), { applyEnabled: true });
  database.prepare("INSERT INTO budget_account VALUES(?,?,?,?,?,?)").run("backup-private", "backup_copy", 1000, 0, 0, 1);
}

function writeProjection(root: string): void {
  const generations = join(root, "generations");
  mkdirSync(generations, { recursive: true, mode: 0o700 });
  // 生产形状:文件名哈希 = 内部签名信封的 snapshotManifestHash(非原始字节内容寻址)。
  const hash = createHash("sha256").update("recovery-gate-fixture-envelope-1").digest("hex");
  const body = Buffer.from(JSON.stringify({
    schemaVersion: "public-projection-generation-v1",
    receivedAt: "2026-08-30T00:00:00.000Z",
    activatedAt: "2026-08-30T00:00:00.000Z",
    package: { taskEnvelope: { snapshot: { snapshotManifestHash: hash } } }
  }), "utf8");
  writeFileSync(join(generations, `${hash}.json`), body);
  writeFileSync(join(root, "active.json"), `${JSON.stringify({
    schemaVersion: "projection-active-pointer-v1",
    snapshotGeneration: 1,
    snapshotManifestHash: hash,
    activatedAt: "2026-08-30T00:00:00.000Z"
  })}\n`);
}

describe("recovery-gate tooling smokes", () => {
  test("G1/G2 register a valid recovery point through the gateway and write the fence", () => {
    const workspace = scratch("f1plus1-recovery-gate-");
    const fixture = openAdmittedReviewFixture({
      finalVersion: 10,
      seed: seedSchema10
    });
    const projectionRoot = join(workspace, "projection");
    const backupRoot = join(workspace, "backup");
    const restoreRoot = join(workspace, "restore");
    const fenceDir = join(workspace, "fence");
    mkdirSync(projectionRoot, { mode: 0o700 });
    mkdirSync(backupRoot, { mode: 0o700 });
    mkdirSync(fenceDir, { mode: 0o700 });
    writeProjection(projectionRoot);
    const dbPath = fixture.path;
    fixture.close();
    const key = randomBytes(32);
    const snapshot = runSnapshotOnce({
      sourceDbPath: dbPath,
      projectionRoot,
      outputDir: backupRoot,
      key,
      retain: 2
    });
    expect(snapshot.ok).toBe(true);
    const drill = runRestoreDrill({
      backupRoot,
      restoreRoot,
      key,
      expectedUserVersion: 10
    });
    expect(drill.ok).toBe(true);
    const identity = inspectExistingPrivateDatabase(dbPath, "state.sqlite");
    const database = openExistingSafeDatabase(dbPath, "state.sqlite", identity, [10]);
    try {
      const receipt = runBackupRecoveryPointRegister({
        database,
        backupRoot,
        drillReport: drill,
        restoreRoot,
        releaseSha256: RELEASE,
        manifestSha256: MANIFEST,
        schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
        budgetAccountId: "backup-private",
        fencePath: join(fenceDir, "recovery-fence.json")
      });
      expect(receipt.decision).toBe("SUCCESS");
      expect(receipt.validBackupRecoveryPoint).toBe(true);
      expect(receipt.bindingPassed).toBe(true);
      const valid = database.prepare("SELECT count(*) AS count FROM valid_backup_recovery_point_v1").get() as { count: number };
      expect(valid.count).toBe(1);
      const anchor = database.prepare("SELECT singleton_id FROM projection_recovery_anchor WHERE singleton_id=1").get();
      expect(anchor).toBeDefined();
      expect(receipt.fence).toMatchObject({
        after: {
          schemaVersion: "admin-recovery-fence-v1",
          writerReady: true,
          clockTrusted: true
        }
      });
      expect(receipt.fence?.before).toBeNull();
      expect(receipt.fence?.after.lastSuccessfulRecoveryPointAt).toBe(Date.parse(receipt.recoveryPointAt));
      const firstAnchor = database.prepare(
        "SELECT version, common_checkpoint_sha256 FROM projection_recovery_anchor WHERE singleton_id=1"
      ).get() as { version: number; common_checkpoint_sha256: string };
      expect(firstAnchor.version).toBe(1);
      const firstCheckpoint = firstAnchor.common_checkpoint_sha256;
      database.close();
      const restoreRoot2 = join(workspace, "restore-2");
      const snapshot2 = runSnapshotOnce({
        sourceDbPath: dbPath,
        projectionRoot,
        outputDir: backupRoot,
        key,
        retain: 2
      });
      expect(snapshot2.ok).toBe(true);
      const drill2 = runRestoreDrill({
        backupRoot,
        restoreRoot: restoreRoot2,
        key,
        expectedUserVersion: 10
      });
      expect(drill2.ok).toBe(true);
      const identity2 = inspectExistingPrivateDatabase(dbPath, "state.sqlite");
      const database2 = openExistingSafeDatabase(dbPath, "state.sqlite", identity2, [10]);
      try {
        const receipt2 = runBackupRecoveryPointRegister({
          database: database2,
          backupRoot,
          drillReport: drill2,
          restoreRoot: restoreRoot2,
          releaseSha256: RELEASE,
          manifestSha256: MANIFEST,
          schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
          budgetAccountId: "backup-private",
          fencePath: join(fenceDir, "recovery-fence.json")
        });
        expect(receipt2.decision).toBe("SUCCESS");
        const valid2 = database2.prepare("SELECT count(*) AS count FROM valid_backup_recovery_point_v1").get() as { count: number };
        expect(valid2.count).toBe(2);
        const secondAnchor = database2.prepare(
          "SELECT version, common_checkpoint_sha256 FROM projection_recovery_anchor WHERE singleton_id=1"
        ).get() as { version: number; common_checkpoint_sha256: string };
        expect(secondAnchor.version).toBe(2);
        expect(secondAnchor.common_checkpoint_sha256).not.toBe(firstCheckpoint);
      } finally {
        database2.close();
      }
    } finally {
      try { database.close(); } catch { /* already closed after first register */ }
    }
  });

  test("G5 schema10 plist installer writes installed-not-loaded without launchctl or a v1 database open", () => {
    const workspace = scratch("f1plus1-schema10-plist-");
    const releaseManifestSha256 = "c".repeat(64);
    const receipt = installSchema10RssCollectorPlist({
      appRoot: APP_ROOT,
      plistDir: join(workspace, "plist"),
      logDir: join(workspace, "logs"),
      releaseManifestSha256
    });
    expect(receipt).toMatchObject({
      status: "installed-not-loaded",
      label: RSS_COLLECTOR_LABEL,
      scheduleSeconds: RSS_COLLECTOR_INTERVAL_SECONDS,
      launchctlInvoked: false,
      databaseOpened: false,
      releaseManifestSha256
    });
    const plist = readFileSync(receipt.plistPath, "utf8");
    expect(plist).toContain(`RSS_RELEASE_MANIFEST_SHA256=${releaseManifestSha256}`);
    expect(plist).toContain(`<integer>${RSS_COLLECTOR_INTERVAL_SECONDS}</integer>`);
    expect(plist).toContain(receipt.stdoutLog);
    expect(plist).toContain(receipt.stderrLog);
    expect(plist).not.toContain("launchctl");
  });
});
