import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJsonV1 } from "../internal-operation/gateway.ts";
import {
  SOURCE_REGISTRY_SCHEMA10_0011_SHA256,
  SOURCE_REGISTRY_SCHEMA10_0012_SHA256,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  sourceRegistrySchemaFingerprint
} from "./source-registry-migration.ts";

export const RSS_CONFIG_V2_MIGRATION_SHA256 = "bfb4cace2bf5d98eb326146bb937904e6c6398f1caa706ce75dc13ac526d6108";
export const RSS_CONFIG_V2_MIGRATION_CANONICAL_SHA256 = "d7af89d7235a8b67696c3895030c7ac97899bcfc9baa48ad8b253a00ef28bed3";

const PLACEHOLDERS = Object.freeze([
  "1".repeat(64),
  "4".repeat(64),
  "5".repeat(64)
]);

export const RSS_CONFIG_V2_CANARY_SOURCE_IDS = ["motorsport-f1-news", "the-race-f1-news"] as const;
export type RssConfigV2CanarySourceId = (typeof RSS_CONFIG_V2_CANARY_SOURCE_IDS)[number];

export type RssSourceHashSpec = Readonly<{
  sourceId: string;
  routeId: string;
  canonicalFeedUrl: string;
  siteUrl: string;
  allowlistedImageHosts: readonly string[];
}>;

export type RssConfigV2SourceSpec = RssSourceHashSpec & Readonly<{
  sourceId: RssConfigV2CanarySourceId;
  routeId: "rss-route-motorsport" | "rss-route-the-race";
  v1ConfigId: string;
}>;

export const RSS_CONFIG_V2_SOURCES: Readonly<Record<RssConfigV2CanarySourceId, RssConfigV2SourceSpec>> = Object.freeze({
  "motorsport-f1-news": Object.freeze({
    sourceId: "motorsport-f1-news",
    routeId: "rss-route-motorsport",
    canonicalFeedUrl: "https://www.motorsport.com/rss/f1/news/",
    siteUrl: "https://www.motorsport.com/",
    v1ConfigId: "rss-config-motorsport-f1-news",
    allowlistedImageHosts: Object.freeze(["cdn-1.motorsport.com", "cdn-2.motorsport.com"])
  }),
  "the-race-f1-news": Object.freeze({
    sourceId: "the-race-f1-news",
    routeId: "rss-route-the-race",
    canonicalFeedUrl: "https://www.the-race.com/category/formula-1/rss/",
    siteUrl: "https://www.the-race.com/",
    v1ConfigId: "rss-config-the-race-f1-news",
    allowlistedImageHosts: Object.freeze(["storage.ghost.io"])
  })
});

export type RssConfigV2ApplyManifest = Readonly<{
  schemaVersion: "rss-config-v2-apply-manifest-v1";
  appliedAt: string;
  authorizationExpiresAt: string;
  routeReleaseSha256: string;
  routeManifestSha256: string;
}>;

export type RssConfigV2MigrationErrorCode =
  | "APPLY_DISABLED"
  | "MIGRATION_HASH"
  | "MIGRATION_CANONICAL_HASH"
  | "VERSION_DRIFT"
  | "SCHEMA10_DRIFT"
  | "SCHEMA10_0011_DRIFT"
  | "MANIFEST_INVALID"
  | "PLACEHOLDER_HASH"
  | "TEMP_SCHEMA_DIRTY"
  | "DATABASE_ATTACH"
  | "MIGRATION_FAILED";

export class RssConfigV2MigrationError extends Error {
  readonly code: RssConfigV2MigrationErrorCode;
  constructor(code: RssConfigV2MigrationErrorCode, message: string = code) {
    super(message);
    this.name = "RssConfigV2MigrationError";
    this.code = code;
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function domainHash(domain: string, value: unknown): string {
  return sha256(`${domain}\n${canonicalJsonV1(value)}`);
}

function assertTimestamp(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || new Date(Date.parse(value)).toISOString() !== value) {
    throw new RssConfigV2MigrationError("MANIFEST_INVALID");
  }
}

function assertHash(value: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new RssConfigV2MigrationError("MANIFEST_INVALID");
  if (PLACEHOLDERS.includes(value)) throw new RssConfigV2MigrationError("PLACEHOLDER_HASH");
}

function assertClosedConnection(database: DatabaseSync): void {
  const attached = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (attached.some((row) => row.name !== "main" && row.name !== "temp")) throw new RssConfigV2MigrationError("DATABASE_ATTACH");
  if (database.prepare("SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1").get() !== undefined) {
    throw new RssConfigV2MigrationError("TEMP_SCHEMA_DIRTY");
  }
}

export function rssRouteIdentitySha256(spec: RssSourceHashSpec): string {
  return domainHash("f1plus1-rss-route-identity-v1", {
    canonicalFeedUrl: spec.canonicalFeedUrl,
    egressClass: "rss_https",
    endpointClass: "rss_fetch",
    routeClass: "rss",
    routeId: spec.routeId,
    scheduleSeconds: 900,
    siteUrl: spec.siteUrl
  });
}

export function rssAuthorizationReceiptSha256(spec: RssSourceHashSpec, input: Readonly<{ grantedAt: string; expiresAt: string }>): string {
  return domainHash("f1plus1-rss-authorization-receipt-v1", {
    automaticPublish: false,
    automaticReview: false,
    canonicalFeedUrl: spec.canonicalFeedUrl,
    expiresAt: input.expiresAt,
    grant: "collection-only",
    grantedAt: input.grantedAt,
    grantedBy: "owner-supervisor",
    scheduleSeconds: 900,
    sourceId: spec.sourceId
  });
}

export function rssSourcePolicySha256(spec: RssSourceHashSpec): string {
  return domainHash("f1plus1-rss-source-policy-v1", {
    allowlistedImageHosts: [...spec.allowlistedImageHosts],
    automaticPublish: false,
    automaticReview: false,
    collectionMode: "rss",
    dedupeStrategy: "source_external_id_sha256_v1",
    mediaPolicy: "allowlisted",
    normalizationStrategy: "rss_xml_canonical_v1",
    rightsStatus: "clear",
    scheduleSeconds: 900,
    sourceId: spec.sourceId
  });
}

export function readRssConfigV2MigrationSql(): string {
  return readFileSync(new URL("../../../migrations/rss-real/0011_source_registry_rss_config_v2.sql", import.meta.url), "utf8");
}

export function canonicalRssConfigV2MigrationSha256(sql: string): string {
  return sha256(sql.replace(/MIGRATION_CANONICAL_SHA256=[0-9a-f]{64}/gu, `MIGRATION_CANONICAL_SHA256=${"0".repeat(64)}`));
}

function validateManifest(manifest: RssConfigV2ApplyManifest): void {
  if (manifest.schemaVersion !== "rss-config-v2-apply-manifest-v1") throw new RssConfigV2MigrationError("MANIFEST_INVALID");
  assertTimestamp(manifest.appliedAt);
  assertTimestamp(manifest.authorizationExpiresAt);
  if (Date.parse(manifest.authorizationExpiresAt) <= Date.parse(manifest.appliedAt)) throw new RssConfigV2MigrationError("MANIFEST_INVALID");
  assertHash(manifest.routeReleaseSha256);
  assertHash(manifest.routeManifestSha256);
}

function dropTemp(database: DatabaseSync): void {
  for (const table of ["migration_0011_preflight", "migration_0011_source", "migration_0011_assert"]) {
    try { database.exec(`DROP TABLE IF EXISTS temp.${table}`); } catch { /* cleanup only */ }
  }
}

function assertReplay(database: DatabaseSync, sql: string, manifest: RssConfigV2ApplyManifest): void {
  const identity = database.prepare("SELECT * FROM source_registry_rss_config_v2_identity WHERE singleton_id=1").get() as Record<string, unknown> | undefined;
  if (identity === undefined) throw new RssConfigV2MigrationError("SCHEMA10_0011_DRIFT");
  if (identity.migration_0011_canonical_sha256 !== RSS_CONFIG_V2_MIGRATION_CANONICAL_SHA256) throw new RssConfigV2MigrationError("MIGRATION_CANONICAL_HASH");
  if (identity.route_release_sha256 !== manifest.routeReleaseSha256 || identity.route_manifest_sha256 !== manifest.routeManifestSha256) {
    throw new RssConfigV2MigrationError("MANIFEST_INVALID");
  }
  for (const sourceId of RSS_CONFIG_V2_CANARY_SOURCE_IDS) {
    const spec = RSS_CONFIG_V2_SOURCES[sourceId];
    const row = database.prepare("SELECT * FROM source_registry_rss_config_v2 WHERE source_id=? AND superseded_at IS NULL").get(sourceId) as Record<string, unknown> | undefined;
    if (row === undefined) throw new RssConfigV2MigrationError("SCHEMA10_0011_DRIFT");
    const expectedRoute = rssRouteIdentitySha256(spec);
    const expectedAuth = rssAuthorizationReceiptSha256(spec, { grantedAt: manifest.appliedAt, expiresAt: manifest.authorizationExpiresAt });
    const expectedPolicy = rssSourcePolicySha256(spec);
    if (row.route_identity_sha256 !== expectedRoute || row.authorization_receipt_sha256 !== expectedAuth || row.source_policy_sha256 !== expectedPolicy) {
      throw new RssConfigV2MigrationError("MANIFEST_INVALID");
    }
    if (row.route_id !== spec.routeId || row.v1_config_id !== spec.v1ConfigId || Number(row.source_revision) !== 1) throw new RssConfigV2MigrationError("MANIFEST_INVALID");
  }
  const v1 = database.prepare("SELECT count(*) AS n FROM source_registry_rss_config_v1").get() as { n: number };
  if (Number(v1.n) !== 4) throw new RssConfigV2MigrationError("SCHEMA10_DRIFT");
  const excluded = database.prepare("SELECT count(*) AS n FROM source_registry_rss_config_v2 WHERE source_id IN ('autosport-f1-news','racefans-f1-news')").get() as { n: number };
  if (Number(excluded.n) !== 0) throw new RssConfigV2MigrationError("SCHEMA10_0011_DRIFT");
  void sql;
}

export function applyRssConfigV2Migration(
  database: DatabaseSync,
  sql: string,
  manifest: RssConfigV2ApplyManifest,
  options: Readonly<{ applyEnabled?: boolean }> = {}
): Readonly<{ applied: boolean; replay: boolean; schemaFingerprintSha256: string }> {
  if (options.applyEnabled !== true) throw new RssConfigV2MigrationError("APPLY_DISABLED");
  if (sha256(sql) !== RSS_CONFIG_V2_MIGRATION_SHA256) throw new RssConfigV2MigrationError("MIGRATION_HASH");
  if (canonicalRssConfigV2MigrationSha256(sql) !== RSS_CONFIG_V2_MIGRATION_CANONICAL_SHA256) throw new RssConfigV2MigrationError("MIGRATION_CANONICAL_HASH");
  validateManifest(manifest);
  database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version !== 10) throw new RssConfigV2MigrationError("VERSION_DRIFT");
  assertClosedConnection(database);
  const hasV2 = database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='source_registry_rss_config_v2'").get() !== undefined;
  if (hasV2) {
    const fingerprint = sourceRegistrySchemaFingerprint(database);
    if (fingerprint === SOURCE_REGISTRY_SCHEMA10_0012_SHA256) {
      assertReplay(database, sql, manifest);
      return Object.freeze({ applied: false, replay: true, schemaFingerprintSha256: fingerprint });
    }
    if (fingerprint !== SOURCE_REGISTRY_SCHEMA10_0011_SHA256) throw new RssConfigV2MigrationError("SCHEMA10_0011_DRIFT");
    assertReplay(database, sql, manifest);
    return Object.freeze({ applied: false, replay: true, schemaFingerprintSha256: SOURCE_REGISTRY_SCHEMA10_0011_SHA256 });
  }
  if (sourceRegistrySchemaFingerprint(database) !== SOURCE_REGISTRY_SCHEMA10_SHA256) throw new RssConfigV2MigrationError("SCHEMA10_DRIFT");

  try {
    database.exec(`CREATE TEMP TABLE migration_0011_preflight(
      source_user_version INTEGER NOT NULL,
      apply_enabled INTEGER NOT NULL CHECK(apply_enabled IN(0,1)),
      migration_0011_canonical_sha256 TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      authorization_expires_at TEXT NOT NULL,
      route_release_sha256 TEXT NOT NULL,
      route_manifest_sha256 TEXT NOT NULL
    ) STRICT`);
    database.prepare("INSERT INTO migration_0011_preflight VALUES(?,?,?,?,?,?,?)").run(
      10, 1, RSS_CONFIG_V2_MIGRATION_CANONICAL_SHA256, manifest.appliedAt, manifest.authorizationExpiresAt,
      manifest.routeReleaseSha256, manifest.routeManifestSha256
    );
    database.exec(`CREATE TEMP TABLE migration_0011_source(
      source_id TEXT PRIMARY KEY,
      v1_config_id TEXT NOT NULL UNIQUE,
      route_id TEXT NOT NULL UNIQUE,
      route_identity_sha256 TEXT NOT NULL UNIQUE,
      authorization_receipt_sha256 TEXT NOT NULL UNIQUE,
      source_policy_sha256 TEXT NOT NULL UNIQUE
    ) STRICT`);
    const insert = database.prepare("INSERT INTO migration_0011_source VALUES(?,?,?,?,?,?)");
    for (const sourceId of RSS_CONFIG_V2_CANARY_SOURCE_IDS) {
      const spec = RSS_CONFIG_V2_SOURCES[sourceId];
      const routeIdentity = rssRouteIdentitySha256(spec);
      const authorization = rssAuthorizationReceiptSha256(spec, { grantedAt: manifest.appliedAt, expiresAt: manifest.authorizationExpiresAt });
      const policy = rssSourcePolicySha256(spec);
      assertHash(routeIdentity);
      assertHash(authorization);
      assertHash(policy);
      insert.run(spec.sourceId, spec.v1ConfigId, spec.routeId, routeIdentity, authorization, policy);
    }
    database.exec(sql);
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* migration owns its transaction */ }
    dropTemp(database);
    if (error instanceof RssConfigV2MigrationError) throw error;
    throw new RssConfigV2MigrationError("MIGRATION_FAILED", error instanceof Error ? error.message : String(error));
  }
  dropTemp(database);
  assertClosedConnection(database);
  if (Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version) !== 10) {
    throw new RssConfigV2MigrationError("VERSION_DRIFT");
  }
  const fingerprint = sourceRegistrySchemaFingerprint(database);
  if (fingerprint !== SOURCE_REGISTRY_SCHEMA10_0011_SHA256) throw new RssConfigV2MigrationError("SCHEMA10_0011_DRIFT");
  assertReplay(database, sql, manifest);
  return Object.freeze({ applied: true, replay: false, schemaFingerprintSha256: fingerprint });
}
