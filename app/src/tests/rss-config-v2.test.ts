import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";

import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";
import { rssConfigTable } from "../server/rss/rss-config-read.ts";
import {
  applyRssConfigV2Migration,
  readRssConfigV2MigrationSql,
  RSS_CONFIG_V2_CANARY_SOURCE_IDS,
  RSS_CONFIG_V2_SOURCES,
  rssAuthorizationReceiptSha256,
  rssRouteIdentitySha256,
  rssSourcePolicySha256,
  type RssConfigV2ApplyManifest
} from "../server/rss/rss-config-v2-migration.ts";
import {
  applySourceRegistryMigration,
  assertSourceRegistrySchema,
  readSourceRegistryMigrationSql,
  SOURCE_REGISTRY_SCHEMA10_0011_SHA256,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  sourceRegistrySchemaFingerprint,
  type SourceRegistryMigrationManifest
} from "../server/rss/source-registry-migration.ts";
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

function applyManifest(overrides: Partial<RssConfigV2ApplyManifest> = {}): RssConfigV2ApplyManifest {
  return Object.freeze({
    schemaVersion: "rss-config-v2-apply-manifest-v1",
    appliedAt: "2026-08-31T15:00:00.000Z",
    authorizationExpiresAt: "2027-08-31T15:00:00.000Z",
    routeReleaseSha256: "a".repeat(64),
    routeManifestSha256: "b".repeat(64),
    ...overrides
  });
}

describe("0011 source_registry_rss_config_v2", () => {
  test("applies two-source v2 current rows, freezes v1, and switches the read relation", () => {
    const database = schema10();
    expect(sourceRegistrySchemaFingerprint(database)).toBe(SOURCE_REGISTRY_SCHEMA10_SHA256);
    const first = applyRssConfigV2Migration(database, readRssConfigV2MigrationSql(), applyManifest(), { applyEnabled: true });
    expect(first).toMatchObject({ applied: true, replay: false, schemaFingerprintSha256: SOURCE_REGISTRY_SCHEMA10_0011_SHA256 });
    expect(Number((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(10);
    assertSourceRegistrySchema(database);

    const v1 = database.prepare("SELECT source_id,route_identity_sha256,authorization_receipt_sha256,source_policy_sha256 FROM source_registry_rss_config_v1 ORDER BY source_id").all() as Array<Record<string, string>>;
    expect(v1).toHaveLength(4);
    expect(v1.every((row) => row.route_identity_sha256 === PLACEHOLDER_ROUTE && row.authorization_receipt_sha256 === PLACEHOLDER_AUTH && row.source_policy_sha256 === PLACEHOLDER_POLICY)).toBe(true);

    const v2 = database.prepare("SELECT source_id,source_revision,superseded_at FROM source_registry_rss_config_v2 ORDER BY source_id").all() as Array<Record<string, unknown>>;
    expect(v2.map((row) => row.source_id)).toEqual(["motorsport-f1-news", "the-race-f1-news"]);
    expect(v2.every((row) => row.source_revision === 1 && row.superseded_at === null)).toBe(true);
    expect(database.prepare("SELECT count(*) AS n FROM source_registry_rss_config_v2 WHERE source_id IN ('autosport-f1-news','racefans-f1-news')").get()).toEqual({ n: 0 });

    const current = database.prepare("SELECT source_id,config_layer,route_identity_sha256 FROM source_registry_rss_config_current ORDER BY source_id").all() as Array<Record<string, string>>;
    expect(current.map((row) => [row.source_id, row.config_layer])).toEqual([
      ["autosport-f1-news", "v1"],
      ["motorsport-f1-news", "v2"],
      ["racefans-f1-news", "v1"],
      ["the-race-f1-news", "v2"]
    ]);
    expect(rssConfigTable(database)).toBe("source_registry_rss_config_current");

    const motorsport = RSS_CONFIG_V2_SOURCES["motorsport-f1-news"];
    const race = RSS_CONFIG_V2_SOURCES["the-race-f1-news"];
    const manifest = applyManifest();
    expect(current.find((row) => row.source_id === "motorsport-f1-news")?.route_identity_sha256).toBe(rssRouteIdentitySha256(motorsport));
    expect(current.find((row) => row.source_id === "the-race-f1-news")?.route_identity_sha256).toBe(rssRouteIdentitySha256(race));
    const motorsportRow = database.prepare("SELECT authorization_receipt_sha256,source_policy_sha256 FROM source_registry_rss_config_v2 WHERE source_id='motorsport-f1-news'").get() as Record<string, string>;
    expect(motorsportRow.authorization_receipt_sha256).toBe(rssAuthorizationReceiptSha256(motorsport, { grantedAt: manifest.appliedAt, expiresAt: manifest.authorizationExpiresAt }));
    expect(motorsportRow.source_policy_sha256).toBe(rssSourcePolicySha256(motorsport));

    const routes = database.prepare("SELECT route_id,route_class,egress_class,endpoint_class FROM route_registry ORDER BY route_id").all();
    expect(routes).toEqual([
      { route_id: "rss-route-motorsport", route_class: "rss", egress_class: "rss_https", endpoint_class: "rss_fetch" },
      { route_id: "rss-route-the-race", route_class: "rss", egress_class: "rss_https", endpoint_class: "rss_fetch" }
    ]);

    const replay = applyRssConfigV2Migration(database, readRssConfigV2MigrationSql(), applyManifest(), { applyEnabled: true });
    expect(replay).toMatchObject({ applied: false, replay: true, schemaFingerprintSha256: SOURCE_REGISTRY_SCHEMA10_0011_SHA256 });
    expect(database.prepare("SELECT count(*) AS n FROM source_registry_rss_config_v2").get()).toEqual({ n: 2 });
    database.close();
  });

  test("rejects placeholder hashes, excluded sources, and post-apply mutation", () => {
    const database = schema10();
    applyRssConfigV2Migration(database, readRssConfigV2MigrationSql(), applyManifest(), { applyEnabled: true });
    expect(() => database.prepare("DELETE FROM source_registry_rss_config_v2 WHERE source_id='motorsport-f1-news'").run()).toThrow(/SOURCE_REGISTRY_RSS_CONFIG_V2_APPEND_ONLY/);
    expect(() => database.prepare("UPDATE source_registry_rss_config_v2 SET route_identity_sha256=? WHERE source_id='motorsport-f1-news'").run(createHash("sha256").update("x").digest("hex"))).toThrow(/SOURCE_REGISTRY_RSS_CONFIG_V2_IMMUTABLE/);
    expect(() => database.prepare("INSERT INTO source_registry_rss_config_v2 SELECT * FROM source_registry_rss_config_v2 WHERE source_id='motorsport-f1-news'").run()).toThrow(/SOURCE_REGISTRY_RSS_CONFIG_V2_INSERT_CLOSED/);
    expect(() => database.prepare("INSERT INTO source_registry_rss_config_v2(config_id,source_id,source_revision,v1_config_id,schedule_seconds,route_id,route_identity_sha256,route_release_sha256,route_manifest_sha256,rights_status,media_policy,dedupe_strategy,normalization_strategy,monitorability_policy,authorization_receipt_sha256,authorization_expires_at,source_policy_sha256,operation_id,created_at,superseded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "rss-cfg-v2-autosport-f1-news-1", "autosport-f1-news", 1, "rss-config-autosport-f1-news", 900, "rss-route-autosport",
      rssRouteIdentitySha256(RSS_CONFIG_V2_SOURCES["motorsport-f1-news"]), "a".repeat(64), "b".repeat(64),
      "clear", "allowlisted", "source_external_id_sha256_v1", "rss_xml_canonical_v1", "manifest_schedule_v1",
      rssAuthorizationReceiptSha256(RSS_CONFIG_V2_SOURCES["motorsport-f1-news"], { grantedAt: "2026-08-31T15:00:00.000Z", expiresAt: "2027-08-31T15:00:00.000Z" }),
      "2027-08-31T15:00:00.000Z", rssSourcePolicySha256(RSS_CONFIG_V2_SOURCES["motorsport-f1-news"]), null, "2026-08-31T15:00:00.000Z", null
    )).toThrow();
    expect(() => applyRssConfigV2Migration(database, readRssConfigV2MigrationSql(), applyManifest({ routeReleaseSha256: PLACEHOLDER_ROUTE }), { applyEnabled: true })).toThrow(/PLACEHOLDER_HASH/);
    void RSS_CONFIG_V2_CANARY_SOURCE_IDS;
    database.close();
  });
});
