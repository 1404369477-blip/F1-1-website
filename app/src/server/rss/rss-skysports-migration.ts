import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJsonV1 } from "../internal-operation/gateway.ts";
import {
  rssAuthorizationReceiptSha256,
  rssRouteIdentitySha256,
  rssSourcePolicySha256,
  type RssSourceHashSpec
} from "./rss-config-v2-migration.ts";
import {
  SOURCE_REGISTRY_SCHEMA10_0011_SHA256,
  SOURCE_REGISTRY_SCHEMA10_0012_SHA256,
  sourceRegistrySchemaFingerprint
} from "./source-registry-migration.ts";

export const RSS_SKYSPORTS_MIGRATION_SHA256 = "66ad9474a90709e4071d82672adb70b1ae23eee6747e1aa15a1b98cebc966597";
export const RSS_SKYSPORTS_MIGRATION_CANONICAL_SHA256 = "c9efdbfb0725994fc0617984c5b89dab937da69b37172eff249ef9248d94d278";

const PLACEHOLDERS = Object.freeze([
  "1".repeat(64),
  "4".repeat(64),
  "5".repeat(64)
]);

export const RSS_SKYSPORTS_SOURCE_ID = "skysports-f1-news" as const;
export const RSS_SKYSPORTS_ROUTE_ID = "rss-route-skysports" as const;

export type RssSkysportsSourceSpec = RssSourceHashSpec & Readonly<{
  sourceId: typeof RSS_SKYSPORTS_SOURCE_ID;
  routeId: typeof RSS_SKYSPORTS_ROUTE_ID;
  displayName: "Sky Sports F1";
}>;

export const RSS_SKYSPORTS_SOURCE: RssSkysportsSourceSpec = Object.freeze({
  sourceId: RSS_SKYSPORTS_SOURCE_ID,
  routeId: RSS_SKYSPORTS_ROUTE_ID,
  displayName: "Sky Sports F1",
  canonicalFeedUrl: "https://www.skysports.com/rss/12433",
  siteUrl: "https://www.skysports.com/",
  allowlistedImageHosts: Object.freeze(["e0.365dm.com", "e1.365dm.com", "e2.365dm.com"])
});

export type RssSkysportsApplyManifest = Readonly<{
  schemaVersion: "rss-skysports-apply-manifest-v1";
  appliedAt: string;
  authorizationExpiresAt: string;
  routeReleaseSha256: string;
  routeManifestSha256: string;
}>;

export type RssSkysportsMigrationErrorCode =
  | "APPLY_DISABLED"
  | "MIGRATION_HASH"
  | "MIGRATION_CANONICAL_HASH"
  | "VERSION_DRIFT"
  | "SCHEMA10_DRIFT"
  | "SCHEMA10_0011_DRIFT"
  | "SCHEMA10_0012_DRIFT"
  | "MANIFEST_INVALID"
  | "PLACEHOLDER_HASH"
  | "TEMP_SCHEMA_DIRTY"
  | "DATABASE_ATTACH"
  | "MIGRATION_FAILED";

export class RssSkysportsMigrationError extends Error {
  readonly code: RssSkysportsMigrationErrorCode;
  constructor(code: RssSkysportsMigrationErrorCode, message: string = code) {
    super(message);
    this.name = "RssSkysportsMigrationError";
    this.code = code;
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertTimestamp(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || new Date(Date.parse(value)).toISOString() !== value) {
    throw new RssSkysportsMigrationError("MANIFEST_INVALID");
  }
}

function assertHash(value: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new RssSkysportsMigrationError("MANIFEST_INVALID");
  if (PLACEHOLDERS.includes(value)) throw new RssSkysportsMigrationError("PLACEHOLDER_HASH");
}

function assertClosedConnection(database: DatabaseSync): void {
  const attached = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (attached.some((row) => row.name !== "main" && row.name !== "temp")) throw new RssSkysportsMigrationError("DATABASE_ATTACH");
  if (database.prepare("SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1").get() !== undefined) {
    throw new RssSkysportsMigrationError("TEMP_SCHEMA_DIRTY");
  }
}

export function rssSourceIdentitySha256(spec: RssSourceHashSpec): string {
  return sha256(canonicalJsonV1({
    sourceId: spec.sourceId,
    canonicalFeedUrl: spec.canonicalFeedUrl,
    siteUrl: spec.siteUrl,
    sourceKind: "rss",
    collectionMode: "rss"
  }));
}

export function readRssSkysportsMigrationSql(): string {
  return readFileSync(new URL("../../../migrations/rss-real/0012_rss_skysports.sql", import.meta.url), "utf8");
}

export function canonicalRssSkysportsMigrationSha256(sql: string): string {
  return sha256(sql.replace(/MIGRATION_CANONICAL_SHA256=[0-9a-f]{64}/gu, `MIGRATION_CANONICAL_SHA256=${"0".repeat(64)}`));
}

function validateManifest(manifest: RssSkysportsApplyManifest): void {
  if (manifest.schemaVersion !== "rss-skysports-apply-manifest-v1") throw new RssSkysportsMigrationError("MANIFEST_INVALID");
  assertTimestamp(manifest.appliedAt);
  assertTimestamp(manifest.authorizationExpiresAt);
  if (Date.parse(manifest.authorizationExpiresAt) <= Date.parse(manifest.appliedAt)) throw new RssSkysportsMigrationError("MANIFEST_INVALID");
  assertHash(manifest.routeReleaseSha256);
  assertHash(manifest.routeManifestSha256);
}

function dropTemp(database: DatabaseSync): void {
  for (const table of ["migration_0012_preflight", "migration_0012_source", "migration_0012_assert"]) {
    try { database.exec(`DROP TABLE IF EXISTS temp.${table}`); } catch { /* cleanup only */ }
  }
}

function assertReplay(database: DatabaseSync, sql: string, manifest: RssSkysportsApplyManifest): void {
  const identity = database.prepare("SELECT * FROM source_registry_rss_skysports_identity WHERE singleton_id=1").get() as Record<string, unknown> | undefined;
  if (identity === undefined) throw new RssSkysportsMigrationError("SCHEMA10_0012_DRIFT");
  if (identity.migration_0012_canonical_sha256 !== RSS_SKYSPORTS_MIGRATION_CANONICAL_SHA256) throw new RssSkysportsMigrationError("MIGRATION_CANONICAL_HASH");
  if (identity.route_release_sha256 !== manifest.routeReleaseSha256 || identity.route_manifest_sha256 !== manifest.routeManifestSha256) {
    throw new RssSkysportsMigrationError("MANIFEST_INVALID");
  }
  const spec = RSS_SKYSPORTS_SOURCE;
  const row = database.prepare("SELECT * FROM source_registry_rss_config_v3 WHERE source_id=? AND superseded_at IS NULL").get(spec.sourceId) as Record<string, unknown> | undefined;
  if (row === undefined) throw new RssSkysportsMigrationError("SCHEMA10_0012_DRIFT");
  const expectedRoute = rssRouteIdentitySha256(spec);
  const expectedAuth = rssAuthorizationReceiptSha256(spec, { grantedAt: manifest.appliedAt, expiresAt: manifest.authorizationExpiresAt });
  const expectedPolicy = rssSourcePolicySha256(spec);
  if (row.route_identity_sha256 !== expectedRoute || row.authorization_receipt_sha256 !== expectedAuth || row.source_policy_sha256 !== expectedPolicy) {
    throw new RssSkysportsMigrationError("MANIFEST_INVALID");
  }
  if (row.route_id !== spec.routeId || Number(row.source_revision) !== 1) throw new RssSkysportsMigrationError("MANIFEST_INVALID");
  const v1 = database.prepare("SELECT count(*) AS n FROM source_registry_rss_config_v1").get() as { n: number };
  if (Number(v1.n) !== 4) throw new RssSkysportsMigrationError("SCHEMA10_DRIFT");
  const v2 = database.prepare("SELECT count(*) AS n FROM source_registry_rss_config_v2").get() as { n: number };
  if (Number(v2.n) !== 2) throw new RssSkysportsMigrationError("SCHEMA10_0011_DRIFT");
  const excluded = database.prepare("SELECT count(*) AS n FROM source_registry_rss_config_v3 WHERE source_id IN ('autosport-f1-news','racefans-f1-news')").get() as { n: number };
  if (Number(excluded.n) !== 0) throw new RssSkysportsMigrationError("SCHEMA10_0012_DRIFT");
  const sources = database.prepare("SELECT count(*) AS n FROM source").get() as { n: number };
  if (Number(sources.n) !== 5) throw new RssSkysportsMigrationError("SCHEMA10_0012_DRIFT");
  if (database.prepare("SELECT 1 FROM sqlite_schema WHERE name='source_pre_0012'").get() !== undefined) {
    throw new RssSkysportsMigrationError("SCHEMA10_0012_DRIFT");
  }
  const xManual = database.prepare("SELECT count(*) AS n FROM x_manual_source_registry").get() as { n: number };
  if (Number(xManual.n) !== 59) throw new RssSkysportsMigrationError("SCHEMA10_DRIFT");
  void sql;
}

export function applyRssSkysportsMigration(
  database: DatabaseSync,
  sql: string,
  manifest: RssSkysportsApplyManifest,
  options: Readonly<{ applyEnabled?: boolean }> = {}
): Readonly<{ applied: boolean; replay: boolean; schemaFingerprintSha256: string }> {
  if (options.applyEnabled !== true) throw new RssSkysportsMigrationError("APPLY_DISABLED");
  if (sha256(sql) !== RSS_SKYSPORTS_MIGRATION_SHA256) throw new RssSkysportsMigrationError("MIGRATION_HASH");
  if (canonicalRssSkysportsMigrationSha256(sql) !== RSS_SKYSPORTS_MIGRATION_CANONICAL_SHA256) throw new RssSkysportsMigrationError("MIGRATION_CANONICAL_HASH");
  validateManifest(manifest);
  database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
  const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (version !== 10) throw new RssSkysportsMigrationError("VERSION_DRIFT");
  assertClosedConnection(database);
  const hasSky = database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='source_registry_rss_skysports_identity'").get() !== undefined;
  if (hasSky) {
    if (sourceRegistrySchemaFingerprint(database) !== SOURCE_REGISTRY_SCHEMA10_0012_SHA256) throw new RssSkysportsMigrationError("SCHEMA10_0012_DRIFT");
    assertReplay(database, sql, manifest);
    return Object.freeze({ applied: false, replay: true, schemaFingerprintSha256: SOURCE_REGISTRY_SCHEMA10_0012_SHA256 });
  }
  if (sourceRegistrySchemaFingerprint(database) !== SOURCE_REGISTRY_SCHEMA10_0011_SHA256) throw new RssSkysportsMigrationError("SCHEMA10_0011_DRIFT");

  try {
    database.exec("PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; PRAGMA recursive_triggers=ON;");
    database.exec(`CREATE TEMP TABLE migration_0012_preflight(
      source_user_version INTEGER NOT NULL,
      apply_enabled INTEGER NOT NULL CHECK(apply_enabled IN(0,1)),
      migration_0012_canonical_sha256 TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      authorization_expires_at TEXT NOT NULL,
      route_release_sha256 TEXT NOT NULL,
      route_manifest_sha256 TEXT NOT NULL
    ) STRICT`);
    database.prepare("INSERT INTO migration_0012_preflight VALUES(?,?,?,?,?,?,?)").run(
      10, 1, RSS_SKYSPORTS_MIGRATION_CANONICAL_SHA256, manifest.appliedAt, manifest.authorizationExpiresAt,
      manifest.routeReleaseSha256, manifest.routeManifestSha256
    );
    database.exec(`CREATE TEMP TABLE migration_0012_source(
      source_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      feed_url TEXT NOT NULL UNIQUE,
      site_url TEXT NOT NULL UNIQUE,
      route_id TEXT NOT NULL UNIQUE,
      route_identity_sha256 TEXT NOT NULL UNIQUE,
      authorization_receipt_sha256 TEXT NOT NULL UNIQUE,
      source_policy_sha256 TEXT NOT NULL UNIQUE,
      identity_sha256 TEXT NOT NULL UNIQUE
    ) STRICT`);
    const spec = RSS_SKYSPORTS_SOURCE;
    const routeIdentity = rssRouteIdentitySha256(spec);
    const authorization = rssAuthorizationReceiptSha256(spec, { grantedAt: manifest.appliedAt, expiresAt: manifest.authorizationExpiresAt });
    const policy = rssSourcePolicySha256(spec);
    const identity = rssSourceIdentitySha256(spec);
    assertHash(routeIdentity);
    assertHash(authorization);
    assertHash(policy);
    assertHash(identity);
    database.prepare("INSERT INTO migration_0012_source VALUES(?,?,?,?,?,?,?,?,?)").run(
      spec.sourceId, spec.displayName, spec.canonicalFeedUrl, spec.siteUrl, spec.routeId,
      routeIdentity, authorization, policy, identity
    );
    database.exec(sql);
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* migration owns its transaction */ }
    try { database.exec("PRAGMA foreign_keys=ON; PRAGMA legacy_alter_table=OFF; PRAGMA recursive_triggers=ON;"); } catch { /* restore */ }
    dropTemp(database);
    if (error instanceof RssSkysportsMigrationError) throw error;
    throw new RssSkysportsMigrationError("MIGRATION_FAILED", error instanceof Error ? error.message : String(error));
  }
  dropTemp(database);
  database.exec("PRAGMA foreign_keys=ON; PRAGMA legacy_alter_table=OFF; PRAGMA recursive_triggers=ON;");
  assertClosedConnection(database);
  if (Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version) !== 10) {
    throw new RssSkysportsMigrationError("VERSION_DRIFT");
  }
  const fingerprint = sourceRegistrySchemaFingerprint(database);
  if (fingerprint !== SOURCE_REGISTRY_SCHEMA10_0012_SHA256) throw new RssSkysportsMigrationError("SCHEMA10_0012_DRIFT");
  assertReplay(database, sql, manifest);
  return Object.freeze({ applied: true, replay: false, schemaFingerprintSha256: fingerprint });
}
