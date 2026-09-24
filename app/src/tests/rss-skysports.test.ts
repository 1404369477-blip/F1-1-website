import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";

import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";
import { parseRssFeed } from "../server/rss/parser.ts";
import { rssConfigTable } from "../server/rss/rss-config-read.ts";
import {
  applyRssConfigV2Migration,
  readRssConfigV2MigrationSql,
  type RssConfigV2ApplyManifest
} from "../server/rss/rss-config-v2-migration.ts";
import {
  applyRssSkysportsMigration,
  canonicalRssSkysportsMigrationSha256,
  readRssSkysportsMigrationSql,
  RSS_SKYSPORTS_MIGRATION_CANONICAL_SHA256,
  RSS_SKYSPORTS_MIGRATION_SHA256,
  RSS_SKYSPORTS_SOURCE,
  rssSourceIdentitySha256,
  type RssSkysportsApplyManifest
} from "../server/rss/rss-skysports-migration.ts";
import {
  applySourceRegistryMigration,
  assertSourceRegistrySchema,
  readSourceRegistryMigrationSql,
  SOURCE_REGISTRY_SCHEMA10_0011_SHA256,
  SOURCE_REGISTRY_SCHEMA10_0012_SHA256,
  sourceRegistrySchemaFingerprint,
  type SourceRegistryMigrationManifest
} from "../server/rss/source-registry-migration.ts";
import { isLiveRssMediaUrl } from "../server/rss/sources.ts";
import { applyXManualInboxMigration } from "../server/tweet-inbox/repository.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");
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

function schema10(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const file of [
    "0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql",
    "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"
  ]) database.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${file}`, "utf8"));
  applyInternalOperationMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8"));
  applyXManualInboxMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0008_x_manual_inbox.sql`, "utf8"));
  applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
  applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), sourceRegistryManifest(), { applyEnabled: true });
  return database;
}

function v2Manifest(overrides: Partial<RssConfigV2ApplyManifest> = {}): RssConfigV2ApplyManifest {
  return Object.freeze({
    schemaVersion: "rss-config-v2-apply-manifest-v1",
    appliedAt: "2026-08-31T15:00:00.000Z",
    authorizationExpiresAt: "2027-08-31T15:00:00.000Z",
    routeReleaseSha256: "a".repeat(64),
    routeManifestSha256: "b".repeat(64),
    ...overrides
  });
}

function skyManifest(overrides: Partial<RssSkysportsApplyManifest> = {}): RssSkysportsApplyManifest {
  return Object.freeze({
    schemaVersion: "rss-skysports-apply-manifest-v1",
    appliedAt: "2026-09-05T04:00:00.000Z",
    authorizationExpiresAt: "2027-09-05T04:00:00.000Z",
    routeReleaseSha256: "c".repeat(64),
    routeManifestSha256: "d".repeat(64),
    ...overrides
  });
}

function schema0011(): DatabaseSync {
  const database = schema10();
  applyRssConfigV2Migration(database, readRssConfigV2MigrationSql(), v2Manifest(), { applyEnabled: true });
  return database;
}

describe("0012 Sky Sports RSS config v3", () => {
  test("pins migration file hashes", () => {
    const sql = readRssSkysportsMigrationSql();
    expect(createHash("sha256").update(sql).digest("hex")).toBe(RSS_SKYSPORTS_MIGRATION_SHA256);
    expect(canonicalRssSkysportsMigrationSha256(sql)).toBe(RSS_SKYSPORTS_MIGRATION_CANONICAL_SHA256);
  });

  test("applies Sky as v3, keeps v1/v2 frozen, and rebuilds source CHECK", () => {
    const database = schema0011();
    expect(sourceRegistrySchemaFingerprint(database)).toBe(SOURCE_REGISTRY_SCHEMA10_0011_SHA256);
    const first = applyRssSkysportsMigration(database, readRssSkysportsMigrationSql(), skyManifest(), { applyEnabled: true });
    expect(first).toMatchObject({ applied: true, replay: false, schemaFingerprintSha256: SOURCE_REGISTRY_SCHEMA10_0012_SHA256 });
    expect(Number((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(10);
    assertSourceRegistrySchema(database);

    const sources = database.prepare("SELECT source_id,enabled FROM source ORDER BY source_id").all() as Array<Record<string, unknown>>;
    expect(sources.map((row) => row.source_id)).toEqual([
      "autosport-f1-news",
      "motorsport-f1-news",
      "racefans-f1-news",
      "skysports-f1-news",
      "the-race-f1-news"
    ]);
    expect(sources.find((row) => row.source_id === "skysports-f1-news")).toEqual({ source_id: "skysports-f1-news", enabled: 1 });

    expect(database.prepare("SELECT count(*) AS n FROM source_registry_rss_config_v1").get()).toEqual({ n: 4 });
    expect(database.prepare("SELECT count(*) AS n FROM source_registry_rss_config_v2").get()).toEqual({ n: 2 });
    expect(database.prepare("SELECT count(*) AS n FROM source_registry_rss_config_v2 WHERE source_id IN ('autosport-f1-news','racefans-f1-news','skysports-f1-news')").get()).toEqual({ n: 0 });
    expect(database.prepare("SELECT count(*) AS n FROM source_registry_rss_config_v3").get()).toEqual({ n: 1 });

    const current = database.prepare("SELECT source_id,config_layer FROM source_registry_rss_config_current ORDER BY source_id").all() as Array<Record<string, string>>;
    expect(current).toEqual([
      { source_id: "autosport-f1-news", config_layer: "v1" },
      { source_id: "motorsport-f1-news", config_layer: "v2" },
      { source_id: "racefans-f1-news", config_layer: "v1" },
      { source_id: "skysports-f1-news", config_layer: "v3" },
      { source_id: "the-race-f1-news", config_layer: "v2" }
    ]);
    expect(rssConfigTable(database)).toBe("source_registry_rss_config_current");

    const registry = database.prepare("SELECT enabled,lifecycle_status,collection_onboarding_status,normalization_status,dedup_status,adapter_status,adapter_authorization_status,platform_allowed,display_name FROM source_registry_v1 WHERE source_id='skysports-f1-news'").get() as Record<string, unknown>;
    expect(registry).toMatchObject({
      enabled: 1,
      lifecycle_status: "active",
      collection_onboarding_status: "active",
      normalization_status: "valid",
      dedup_status: "unique",
      adapter_status: "ready",
      adapter_authorization_status: "valid",
      platform_allowed: "allowed",
      display_name: "Sky Sports F1"
    });
    expect(database.prepare("SELECT identity_sha256 FROM source_registry_v1 WHERE source_id='skysports-f1-news'").get()).toEqual({
      identity_sha256: rssSourceIdentitySha256(RSS_SKYSPORTS_SOURCE)
    });

    expect(database.prepare("SELECT count(*) AS n FROM x_manual_source_registry").get()).toEqual({ n: 59 });
    expect(database.prepare("SELECT 1 FROM x_manual_source_registry WHERE source_id='x_skysportsf1'").get()).toEqual({ 1: 1 });

    const routes = database.prepare("SELECT route_id FROM route_registry ORDER BY route_id").all() as Array<{ route_id: string }>;
    expect(routes.map((row) => row.route_id)).toEqual(["rss-route-motorsport", "rss-route-skysports", "rss-route-the-race"]);

    expect(database.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='gateway_source_insert_guard'").get()).toEqual({ 1: 1 });
    expect(database.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='source_registry_insert_guard'").get()).toEqual({ 1: 1 });

    const replay = applyRssSkysportsMigration(database, readRssSkysportsMigrationSql(), skyManifest(), { applyEnabled: true });
    expect(replay).toMatchObject({ applied: false, replay: true, schemaFingerprintSha256: SOURCE_REGISTRY_SCHEMA10_0012_SHA256 });
    expect(applyRssConfigV2Migration(database, readRssConfigV2MigrationSql(), v2Manifest(), { applyEnabled: true })).toMatchObject({
      applied: false,
      replay: true,
      schemaFingerprintSha256: SOURCE_REGISTRY_SCHEMA10_0012_SHA256
    });
    database.close();
  });

  test("rejects post-apply mutation and keeps Autosport/RaceFans out of v2/v3", () => {
    const database = schema0011();
    applyRssSkysportsMigration(database, readRssSkysportsMigrationSql(), skyManifest(), { applyEnabled: true });
    expect(() => database.prepare("DELETE FROM source_registry_rss_config_v3 WHERE source_id='skysports-f1-news'").run()).toThrow(/SOURCE_REGISTRY_RSS_CONFIG_V3_APPEND_ONLY/);
    expect(() => database.prepare("UPDATE source_registry_rss_config_v3 SET route_identity_sha256=? WHERE source_id='skysports-f1-news'").run(createHash("sha256").update("x").digest("hex"))).toThrow(/SOURCE_REGISTRY_RSS_CONFIG_V3_IMMUTABLE/);
    expect(() => database.prepare("INSERT INTO source_registry_rss_config_v3 SELECT * FROM source_registry_rss_config_v3").run()).toThrow(/SOURCE_REGISTRY_RSS_CONFIG_V3_INSERT_CLOSED/);
    expect(() => database.prepare("INSERT INTO source_registry_rss_config_v2 SELECT * FROM source_registry_rss_config_v2 WHERE source_id='motorsport-f1-news'").run()).toThrow(/SOURCE_REGISTRY_RSS_CONFIG_V2_INSERT_CLOSED/);
    expect(() => database.prepare("INSERT INTO source(source_id,feed_url,enabled,stop_epoch,last_reason_code) VALUES('extra','https://example.com/',1,1,'NEVER_RUN')").run()).toThrow();
    expect(() => applyRssSkysportsMigration(database, readRssSkysportsMigrationSql(), skyManifest({ routeReleaseSha256: PLACEHOLDER_ROUTE }), { applyEnabled: true })).toThrow(/PLACEHOLDER_HASH/);
    expect(database.prepare("SELECT enabled FROM source WHERE source_id IN ('autosport-f1-news','racefans-f1-news') ORDER BY source_id").all()).toEqual([
      { enabled: 1 },
      { enabled: 1 }
    ]);
    database.close();
  });

  test("accepts Sky Sports article images on 365dm hosts", () => {
    expect(isLiveRssMediaUrl("https://e0.365dm.com/26/09/1600x900/skysports-example.jpg")).toBe(true);
    expect(isLiveRssMediaUrl("https://e2.365dm.com/26/09/1600x900/skysports-example.webp")).toBe(true);
    expect(isLiveRssMediaUrl("https://www.skysports.com/rss/12433")).toBe(false);
    const parsed = parseRssFeed(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Formula 1</title>
          <item>
            <guid>https://www.skysports.com/f1/news/12433/example</guid>
            <link>https://www.skysports.com/f1/news/12433/example</link>
            <title>Monza FP2</title>
            <description>Sky excerpt</description>
            <pubDate>Fri, 05 Sep 2026 12:00:00 GMT</pubDate>
            <enclosure url="https://e1.365dm.com/26/09/1600x900/skysports-example.jpg" type="image/jpeg" length="12345"/>
          </item>
        </channel>
      </rss>`, "utf8"), "skysports-f1-news");
    expect(parsed.items[0]).toMatchObject({
      canonicalUrl: "https://www.skysports.com/f1/news/12433/example",
      media: {
        url: "https://e1.365dm.com/26/09/1600x900/skysports-example.jpg",
        mimeType: "image/jpeg",
        declaredBytes: 12345
      }
    });
  });

  test("accepts Sky Sports RFC 822 pubDate with BST", () => {
    const parsed = parseRssFeed(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Formula 1</title>
          <item>
            <guid>https://www.skysports.com/f1/news/12433/bst</guid>
            <link>https://www.skysports.com/f1/news/12433/bst</link>
            <title>Monza FP2 BST</title>
            <description>Sky excerpt</description>
            <pubDate>Fri, 04 Sep 2026 16:00:00 BST</pubDate>
          </item>
        </channel>
      </rss>`, "utf8"), "skysports-f1-news");
    expect(parsed.items[0]?.publishedAt).toBe("2026-09-04T15:00:00.000Z");
  });
});
