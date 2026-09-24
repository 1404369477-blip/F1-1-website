// Synthetic isolated database fixture. Never a producer or deployment entrypoint.
import { createHash } from "node:crypto";
import { ReviewRealRepository } from "../../server/review-real/repository.ts";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { applyInternalOperationMigration } from "../../server/review-real/migration.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../../server/rss/bilingual-migration.ts";
import { applyRssConfigV2Migration, readRssConfigV2MigrationSql } from "../../server/rss/rss-config-v2-migration.ts";
import { applyRssSkysportsMigration, readRssSkysportsMigrationSql } from "../../server/rss/rss-skysports-migration.ts";
import { applySourceRegistryMigration, readSourceRegistryMigrationSql, type SourceRegistryMigrationManifest } from "../../server/rss/source-registry-migration.ts";
import { applyXManualInboxMigration } from "../../server/tweet-inbox/repository.ts";
const APP_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/u, "");
const PLACEHOLDER_ROUTE = "1".repeat(64);
const PLACEHOLDER_AUTH = "4".repeat(64);
const PLACEHOLDER_POLICY = "5".repeat(64);
function sourceRegistryManifest(): SourceRegistryMigrationManifest {
  const shared = {
    scheduleSeconds: 900,
    routeIdentitySha256: PLACEHOLDER_ROUTE,
    routeReleaseSha256: "2".repeat(64),
    routeManifestSha256: "3".repeat(64),
    rightsStatus: "clear" as const,
    mediaPolicy: "allowlisted" as const,
    authorizationExpiresAt: "2027-08-25T00:00:00.000Z",
    authorizationReceiptSha256: PLACEHOLDER_AUTH,
    sourcePolicySha256: PLACEHOLDER_POLICY
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

export function xPageSchema12(withHistory = false): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const file of [
    "0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql",
    "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"
  ]) {
    database.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${file}`, "utf8"));
    if (withHistory && file === "0003_projection_delivery_runtime.sql") seedPublishedRssHistory(database);
  }
  applyInternalOperationMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8"));
  applyXManualInboxMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0008_x_manual_inbox.sql`, "utf8"));
  applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
  applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), sourceRegistryManifest(), { applyEnabled: true });
  applyRssConfigV2Migration(database, readRssConfigV2MigrationSql(), {schemaVersion: "rss-config-v2-apply-manifest-v1", appliedAt: "2026-08-31T15:00:00.000Z", authorizationExpiresAt: "2027-08-31T15:00:00.000Z", routeReleaseSha256: "a".repeat(64), routeManifestSha256: "b".repeat(64)}, {applyEnabled: true});
  applyRssSkysportsMigration(database, readRssSkysportsMigrationSql(), {schemaVersion: "rss-skysports-apply-manifest-v1", appliedAt: "2026-09-05T04:00:00.000Z", authorizationExpiresAt: "2027-09-05T04:00:00.000Z", routeReleaseSha256: "c".repeat(64), routeManifestSha256: "d".repeat(64)}, {applyEnabled: true});
  return database;
}


function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function seedPublishedRssHistory(database: DatabaseSync): void {
  const suffix = "historical-synthetic";
  const candidateId = `rss-candidate-delivery-${suffix}`;
  const publishedAt = "2026-08-12T01:00:00.000Z";
  const sourcePayloadHash = sha256(`source-${suffix}`);
  database.prepare(
    "INSERT INTO pending_review_candidate (candidate_id, source_id, external_id, dedupe_key, canonical_url, title, excerpt, author, published_at, source_payload_hash, source_revision, first_seen_at, last_seen_at) VALUES (?, 'motorsport-f1-news', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
  ).run(
    candidateId,
    `delivery-${suffix}`,
    sha256(`dedupe-${suffix}`),
    `https://www.motorsport.com/f1/news/delivery-${suffix}/`,
    `Source ${suffix}`,
    `Excerpt ${suffix}`,
    "Motorsport.com",
    publishedAt,
    sourcePayloadHash,
    publishedAt,
    publishedAt
  );
  let now = Date.parse("2026-08-12T02:00:00.000Z");
  const repository = new ReviewRealRepository(database, () => {
    const value = new Date(now);
    now += 1_000;
    return value;
  });
  const revision = repository.revision({
    schemaVersion: "admin-review-v0.2",
    operationId: `operation-revision-${suffix}`,
    expected: {
      candidateId,
      sourceRevision: 1,
      sourceVersionTag: sourcePayloadHash.slice(0, 12),
      latestBundleId: null,
      latestBundleVersionTag: null
    },
    editable: {
      titleZh: `真实投影 ${suffix}`,
      summaryZh: `用于验证 single sender 状态机的摘要 ${suffix}`,
      notes: "private"
    }
  }, `/api/admin/reviews/${candidateId}/revision`, "operator-test");
  const approval = repository.approve({
    schemaVersion: "admin-review-v0.2",
    operationId: `operation-approve-${suffix}`,
    expected: {
      candidateId,
      sourceRevision: 1,
      bundleId: revision.bundle.id,
      bundleVersionTag: revision.bundle.versionTag
    }
  }, `/api/admin/reviews/${candidateId}/approve`, "operator-test");
  repository.publish({
    schemaVersion: "admin-review-v0.2",
    operationId: `operation-publish-${suffix}`,
    expected: {
      publicId: approval.publication.publicId,
      publishGeneration: 1,
      publicationStatus: "queued",
      approvedBundleVersionTag: revision.bundle.versionTag
    }
  }, `/api/admin/publications/${approval.publication.publicId}/publish`, "operator-test");
}
