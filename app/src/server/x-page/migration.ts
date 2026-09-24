import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonV1 } from "../internal-operation/gateway.ts";
import { getInstalledSqliteAuthorizer } from "../internal-operation/authorizer.ts";
import { SOURCE_REGISTRY_SCHEMA10_0012_SHA256, sourceRegistrySchemaFingerprint } from "../rss/source-registry-migration.ts";
import { X_PAGE_HANDLES, X_PAGE_SELECTION } from "./normalize.ts";
import { X_PAGE_SCHEMA_SHA256, X_PAGE_MIGRATION_SHA256 } from "./schema-identity.ts";

const timestamp = z.iso.datetime({ precision: 3 });
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const ManifestSchema = z.object({
  schemaVersion: z.literal("x-page-clone-migration-v1"),
  evidenceClass: z.literal("synthetic_clone"),
  appliedAt: timestamp,
  authorizationExpiresAt: timestamp,
  selectionSha256: z.literal(X_PAGE_SELECTION.sha256),
  adapterSha256: digest,
  authorizationReceiptSha256: digest,
  sourcePolicySha256: digest
}).strict();
export type XPageCloneManifest = z.infer<typeof ManifestSchema>;
export function xPageHash(value: unknown): string {
  return createHash("sha256").update(canonicalJsonV1(value)).digest("hex");
}
export function readXPageMigrationSql(): string {
  return readFileSync(new URL("../../../migrations/rss-real/0013_x_page_import.sql", import.meta.url), "utf8");
}
function assert(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }

/** Deliberately accepts only an in-memory synthetic clone. A production migration
 * requires its own reviewed backup/runtime/schema closure and real evidence. */
export function applyXPageCloneMigration(database: DatabaseSync, manifestInput: unknown): Readonly<{ applied: boolean; schemaSha256: string }> {
  const manifest = ManifestSchema.parse(manifestInput);
  assert(Date.parse(manifest.authorizationExpiresAt) > Date.parse(manifest.appliedAt), "X_PAGE_AUTHORIZATION_EXPIRED");
  assert(getInstalledSqliteAuthorizer(database) === null, "X_PAGE_MIGRATION_WRITER_ACTIVE");
  const locations = database.prepare("PRAGMA database_list").all() as Array<{ name: string; file: string }>;
  assert(locations.every(row => (row.name === "main" || row.name === "temp") && row.file === ""), "X_PAGE_MIGRATION_CLONE_ONLY");
  assert(database.prepare("SELECT 1 FROM temp.sqlite_schema LIMIT 1").get() === undefined, "X_PAGE_MIGRATION_TEMP_DIRTY");
  const fingerprint = sourceRegistrySchemaFingerprint(database);
  if (fingerprint === X_PAGE_SCHEMA_SHA256) {
    const identity = database.prepare("SELECT manifest_json FROM x_page_migration_identity_v1").get() as { manifest_json: string };
    assert(identity.manifest_json === canonicalJsonV1(manifest), "X_PAGE_MIGRATION_MANIFEST_DRIFT");
    return Object.freeze({ applied: false, schemaSha256: fingerprint });
  }
  assert(fingerprint === SOURCE_REGISTRY_SCHEMA10_0012_SHA256, "X_PAGE_MIGRATION_PREDECESSOR_DRIFT");
  const sql = readXPageMigrationSql();
  assert(createHash("sha256").update(sql).digest("hex") === X_PAGE_MIGRATION_SHA256, "X_PAGE_MIGRATION_HASH");
  const registry = database.prepare("SELECT * FROM source_registry_v1 ORDER BY source_id").all();
  const selected = X_PAGE_HANDLES.map(handle => ({ sourceId: `x_${handle}`, handle,
    identitySha256: xPageHash({ sourceId: `x_${handle}`, canonicalPageUrl: `https://x.com/${handle}`, sourceKind: "x_page", collectionMode: "browser_visible_dom", selectionSha256: X_PAGE_SELECTION.sha256 }) }));
  for (const source of selected) {
    const row = database.prepare("SELECT source_kind,enabled,site_url FROM source_registry_v1 WHERE source_id=?").get(source.sourceId) as Record<string, unknown> | undefined;
    assert(row?.source_kind === "x_manual" && row.enabled === 0 && String(row.site_url).toLowerCase() === `https://x.com/${source.handle}`, "X_PAGE_MIGRATION_SELECTION_DRIFT");
  }
  assert(Number((database.prepare("SELECT count(*) n FROM x_manual_source_registry").get() as { n: number }).n) === 59, "X_PAGE_MIGRATION_HISTORY_DRIFT");
  database.exec("PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE");
  try {
    database.exec(`CREATE TEMP TABLE migration_0013_manifest(applied_at TEXT,authorization_expires_at TEXT,selection_sha256 TEXT,adapter_sha256 TEXT,authorization_receipt_sha256 TEXT,source_policy_sha256 TEXT,manifest_json TEXT,previous_registry_json TEXT,previous_authority_json TEXT,target_schema_sha256 TEXT);
      CREATE TEMP TABLE migration_0013_source(source_id TEXT PRIMARY KEY,canonical_handle TEXT,identity_sha256 TEXT);`);
    database.prepare("INSERT INTO migration_0013_manifest VALUES(?,?,?,?,?,?,?,?,?,?)").run(manifest.appliedAt, manifest.authorizationExpiresAt, manifest.selectionSha256, manifest.adapterSha256, manifest.authorizationReceiptSha256, manifest.sourcePolicySha256, canonicalJsonV1(manifest), canonicalJsonV1(registry), canonicalJsonV1(database.prepare("SELECT * FROM quick_launch_authority_v2 WHERE capability_id='source_registry_management'").get()), X_PAGE_SCHEMA_SHA256);
    for (const source of selected) database.prepare("INSERT INTO migration_0013_source VALUES(?,?,?)").run(source.sourceId, source.handle, source.identitySha256);
    database.exec(sql);
    assert(database.prepare("PRAGMA foreign_key_check").all().length === 0, "X_PAGE_MIGRATION_FOREIGN_KEY");
    assert(sourceRegistrySchemaFingerprint(database) === X_PAGE_SCHEMA_SHA256, "X_PAGE_MIGRATION_SUCCESSOR_DRIFT");
    database.exec("DROP TABLE migration_0013_manifest; DROP TABLE migration_0013_source; COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA legacy_alter_table=OFF; PRAGMA recursive_triggers=ON");
  }
  return Object.freeze({ applied: true, schemaSha256: X_PAGE_SCHEMA_SHA256 });
}
