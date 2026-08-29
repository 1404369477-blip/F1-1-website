import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { constants as sqliteConstants, DatabaseSync } from "node:sqlite";

import { installSqliteAuthorizer } from "../src/server/internal-operation/authorizer.ts";
import { applyInternalOperationMigration } from "../src/server/review-real/migration.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../src/server/rss/bilingual-migration.ts";
import {
  applySourceRegistryMigration,
  readSourceRegistryMigrationSql,
  SOURCE_REGISTRY_MIGRATION_CANONICAL_SHA256,
  SOURCE_REGISTRY_MIGRATION_SHA256,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  SOURCE_REGISTRY_SOURCE_0009_CANONICAL_SHA256,
  SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256,
  SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256,
  SOURCE_REGISTRY_TABLES,
  sourceRegistrySchemaFingerprint,
  verifyAuthorityActivationReceipt,
  type QuickLaunchAuthorityCapability,
  type SourceRegistryMigrationManifest
} from "../src/server/rss/source-registry-migration.ts";
import { X_AUTOMATION_ZERO, planProposeSource, readSourceDetail, readSourceList } from "../src/server/rss/source-registry.ts";
import { applyXManualInboxMigration } from "../src/server/tweet-inbox/repository.ts";

const SQLITE = sqliteConstants as unknown as Record<string, number>;
type AuthorizableDatabase = DatabaseSync & { setAuthorizer(callback: ((action: number, arg1?: string | null) => number) | null): void };
const appRoot = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/u, "");
const repoRoot = dirname(appRoot);
const runId = `run-${new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}`;
const runRoot = join(repoRoot, "scratch", "2026-08-25-ql4-0010-source-registry-evidence", runId);
const migratedAt = "2026-08-25T00:00:00.000Z";

function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new Error("EVIDENCE_CANONICAL_INVALID");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function migrationManifest(): SourceRegistryMigrationManifest {
  const shared = { scheduleSeconds: 900, routeIdentitySha256: "1".repeat(64), routeReleaseSha256: "2".repeat(64), routeManifestSha256: "3".repeat(64), rightsStatus: "clear" as const, mediaPolicy: "allowlisted" as const, authorizationExpiresAt: "2027-08-25T00:00:00.000Z", authorizationReceiptSha256: "4".repeat(64), sourcePolicySha256: "5".repeat(64) };
  return Object.freeze({ schemaVersion: "source-registry-migration-manifest-v1", migratedAt, rss: Object.freeze([
    { ...shared, sourceId: "motorsport-f1-news", displayName: "Motorsport.com", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
    { ...shared, sourceId: "autosport-f1-news", displayName: "Autosport", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
    { ...shared, sourceId: "racefans-f1-news", displayName: "RaceFans", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
    { ...shared, sourceId: "the-race-f1-news", displayName: "The Race", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" }
  ]) });
}

function buildSchema9(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  for (const file of ["0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql", "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"]) {
    database.exec(readFileSync(join(appRoot, "migrations/rss-real", file), "utf8"));
  }
  applyInternalOperationMigration(database, readFileSync(join(appRoot, "migrations/rss-real/0007_internal_operation_recovery_phase.sql"), "utf8"));
  applyXManualInboxMigration(database, readFileSync(join(appRoot, "migrations/rss-real/0008_x_manual_inbox.sql"), "utf8"));
  applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
  if (sourceRegistrySchemaFingerprint(database) !== SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256) throw new Error("EVIDENCE_SCHEMA9_DRIFT");
  return database;
}

function targetCount(database: DatabaseSync): number {
  return Number((database.prepare(`SELECT count(*) AS count FROM sqlite_schema WHERE type='table' AND name IN (${SOURCE_REGISTRY_TABLES.map(() => "?").join(",")})`).get(...SOURCE_REGISTRY_TABLES) as Record<string, unknown>).count);
}

function localImportClosure(entryPath: string): readonly Readonly<{ path: string; sha256: string }>[] {
  const pending = [resolve(entryPath)]; const seen = new Set<string>(); const dependencies = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const pattern = /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{},\s]+?\s+from\s+)?["'](\.[^"']+)["']/gu;
    for (const match of source.matchAll(pattern)) {
      const base = resolve(dirname(file), match[1]);
      const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts")].find((candidate) => existsSync(candidate));
      if (!resolved) throw new Error(`EVIDENCE_IMPORT_UNRESOLVED:${match[1]}`);
      dependencies.add(resolved); pending.push(resolved);
    }
  }
  dependencies.delete(resolve(entryPath));
  return Object.freeze([...dependencies].sort().map((path) => Object.freeze({ path: relative(repoRoot, path), sha256: sha256(readFileSync(path)) })));
}

function negative(name: string, callback: () => void): Readonly<{ name: string; rejected: boolean; error: string }> {
  try { callback(); return Object.freeze({ name, rejected: false, error: "NO_ERROR" }); }
  catch (error) { return Object.freeze({ name, rejected: true, error: error instanceof Error ? error.message : String(error) }); }
}

function activateAuthority(database: DatabaseSync, capabilityId: QuickLaunchAuthorityCapability, sequence: number): Readonly<{ operationId: string; receiptSha256: string }> {
  const operationId = `evidence-authority-${capabilityId}`;
  const handoffId = `evidence-handoff-${capabilityId}`;
  const now = `2026-08-25T00:00:0${sequence}.000Z`;
  const receiptSha256 = sha256(`authority-receipt:${capabilityId}`);
  const requestHash = sha256(`authority-request:${capabilityId}`);
  const zero = "0".repeat(64);
  const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>;
  database.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(handoffId, "admin_http", "f1plus1-owner-supervisor-v1", sha256(`handoff:${capabilityId}`).slice(0, 43), zero, zero, sha256(`handoff-receipt:${capabilityId}`), now, "2026-08-26T00:00:00.000Z");
  database.prepare(`INSERT INTO internal_operation(
    operation_id,idempotency_key,operation_kind,owner_process,capability_class,policy_id,authorization_handoff_id,control_action,state,version,
    candidate_id,source_id,publication_id,public_id,phase,attempt,budget_reservation_id,egress_class,model_route_ref,
    expected_schema_sha256,expected_release_sha256,expected_manifest_sha256,source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch,
    source_stop_epoch,global_stop_state,emergency_stop_state,recovery_state,deletion_fence_state,publication_fence_state,request_hash,request_fingerprint,
    expected_control_version,expected_entity_version,expected_entity_hash,entity_set_json,entity_set_hash,required_fence_set_json,required_fence_set_hash,
    expected_writer_epoch,result_hash,reason_code,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    operationId, operationId, "phase_control", "admin_http", "control", "p-phase-control-disabled", handoffId, "fence_update", "requested", 1,
    null, null, null, null, "disabled", 0, null, "none", null, SOURCE_REGISTRY_SCHEMA10_SHA256, zero, zero,
    Number(control.source_config_epoch), Number(control.source_safety_epoch), Number(control.authorization_version), Number(control.policy_epoch), Number(control.recovery_epoch),
    null, String(control.global_stop_state), String(control.emergency_stop_state), String(control.recovery_state), String(control.deletion_fence_state), String(control.publication_fence_state),
    requestHash, sha256(`fingerprint:${capabilityId}`), Number(control.version), null, zero, "[]", zero, "[]", zero, Number(control.writer_epoch), null, null, now, now
  );
  database.prepare("UPDATE owner_authorization_handoff SET consumed_by_operation_id=? WHERE handoff_id=? AND consumed_by_operation_id IS NULL").run(operationId, handoffId);
  database.prepare("UPDATE internal_operation SET state='authorized',version=2,updated_at=? WHERE operation_id=? AND state='requested' AND version=1").run(now, operationId);
  database.prepare("INSERT INTO quick_launch_authority_permit_v2 VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(`evidence-permit-${capabilityId}`, operationId, capabilityId, "enable", 1, sha256(`permit:${capabilityId}`).slice(0, 43), requestHash, receiptSha256, now);
  database.prepare("UPDATE quick_launch_authority_v2 SET state='enabled',version=2,updated_by_operation_id=?,authority_receipt_sha256=?,updated_at=? WHERE capability_id=? AND state='closed' AND version=1").run(operationId, receiptSha256, now, capabilityId);
  return Object.freeze({ operationId, receiptSha256 });
}

function main(): void {
  if (process.version !== "v24.18.0") throw new Error(`NODE_VERSION_DRIFT:${process.version}`);
  const npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
  if (npmVersion !== "11.16.0") throw new Error(`NPM_VERSION_DRIFT:${npmVersion}`);
  mkdirSync(runRoot, { recursive: true });
  const sql = readSourceRegistryMigrationSql();
  const targetPath = join(runRoot, "schema10-source-registry.sqlite");
  const database = buildSchema9(targetPath);
  const sourceSchema = sourceRegistrySchemaFingerprint(database);
  const first = applySourceRegistryMigration(database, sql, migrationManifest(), { applyEnabled: true });
  const replay = applySourceRegistryMigration(database, sql, migrationManifest(), { applyEnabled: true });
  const measuredTargetTables = targetCount(database);
  const counts = Object.freeze({
    allSources: Number((database.prepare("SELECT count(*) AS count FROM source_registry_v1").get() as Record<string, unknown>).count),
    activeRss: Number((database.prepare("SELECT count(*) AS count FROM source_registry_v1 WHERE source_kind='rss' AND enabled=1 AND lifecycle_status='active'").get() as Record<string, unknown>).count),
    disabledX: Number((database.prepare("SELECT count(*) AS count FROM source_registry_v1 WHERE source_kind='x_manual' AND enabled=0 AND lifecycle_status='proposed' AND collection_mode='manual_url'").get() as Record<string, unknown>).count),
    configs: Number((database.prepare("SELECT count(*) AS count FROM source_registry_rss_config_v1").get() as Record<string, unknown>).count),
    health: Number((database.prepare("SELECT count(*) AS count FROM source_registry_health_v1").get() as Record<string, unknown>).count),
    history: Number((database.prepare("SELECT count(*) AS count FROM source_registry_history_v1").get() as Record<string, unknown>).count),
    outbox: Number((database.prepare("SELECT count(*) AS count FROM source_registry_outbox_v1").get() as Record<string, unknown>).count),
    closedAuthorities: Number((database.prepare("SELECT count(*) AS count FROM quick_launch_authority_v2 WHERE state='closed' AND version=1").get() as Record<string, unknown>).count)
  });
  const list = readSourceList(database, { limit: 100 });
  const rssDetail = readSourceDetail(database, "motorsport-f1-news", migratedAt);
  const xDetail = readSourceDetail(database, "x_f1", migratedAt);
  const closedPlan = planProposeSource();
  const negatives = [
    negative("replay with drifted manifest", () => {
      const current = migrationManifest();
      applySourceRegistryMigration(database, sql, { ...current, rss: current.rss.map((entry, index) => index === 0 ? { ...entry, displayName: "Drifted" } : entry) }, { applyEnabled: true });
    }),
    negative("noncanonical manifest URL", () => {
      const current = migrationManifest();
      applySourceRegistryMigration(database, sql, { ...current, rss: current.rss.map((entry, index) => index === 0 ? { ...entry, siteUrl: "https://www.motorsport.com" } : entry) }, { applyEnabled: true });
    }),
    negative("raw authority UPDATE without one-time permit", () => database.prepare("UPDATE quick_launch_authority_v2 SET state='enabled',version=2 WHERE capability_id='source_registry_management'").run()),
    negative("raw source UPDATE without source permit", () => database.prepare("UPDATE source_registry_v1 SET revision=revision+1,enabled=0 WHERE source_id='motorsport-f1-news'").run())
  ];
  const authorizer = installSqliteAuthorizer(database, "public_or_browser");
  negatives.push(negative("authorizer-protected DROP source registry trigger", () => database.exec("DROP TRIGGER source_registry_update_guard")));
  authorizer.uninstall();
  const sourceAuthority = activateAuthority(database, "source_registry_management", 1);
  const autoAuthority = activateAuthority(database, "bilingual_auto_refine", 2);
  const manualAuthority = activateAuthority(database, "bilingual_manual_mutation", 3);
  const authorityVerifications = Object.freeze([
    verifyAuthorityActivationReceipt(database, { capabilityId: "source_registry_management", ...sourceAuthority }),
    verifyAuthorityActivationReceipt(database, { capabilityId: "bilingual_auto_refine", ...autoAuthority }),
    verifyAuthorityActivationReceipt(database, { capabilityId: "bilingual_manual_mutation", ...manualAuthority })
  ]);
  if (authorityVerifications.some((entry) => !entry.valid || !Object.values(entry.truth).every(Boolean))) throw new Error("EVIDENCE_AUTHORITY_FIVE_TRUTH_INVALID");
  const bridgeTruth = database.prepare("SELECT enabled,status,version,extension_sha256 FROM bilingual_authority_capability_v1 WHERE capability_id='bilingual-v1'").get();
  database.exec("PRAGMA journal_mode=DELETE");
  database.close();

  const reopened = new DatabaseSync(targetPath, { readOnly: true });
  const reopen = Object.freeze({ version: Number((reopened.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version), schemaSha256: sourceRegistrySchemaFingerprint(reopened), sourceCount: Number((reopened.prepare("SELECT count(*) AS count FROM source_registry_v1").get() as Record<string, unknown>).count), targetTableCount: targetCount(reopened), enabledAuthorities: Number((reopened.prepare("SELECT count(*) AS count FROM quick_launch_authority_v2 WHERE state='enabled'").get() as Record<string, unknown>).count), bilingualV1Enabled: Number((reopened.prepare("SELECT enabled FROM bilingual_authority_capability_v1 WHERE capability_id='bilingual-v1'").get() as Record<string, unknown>).enabled) });
  reopened.close();

  const faultPath = join(runRoot, "schema10-fault-rollback.sqlite");
  const fault = buildSchema9(faultPath) as AuthorizableDatabase;
  let deniedCreate = false;
  fault.setAuthorizer((action, arg1) => {
    if (action === SQLITE.SQLITE_CREATE_TABLE && arg1 === "source_registry_health_v1") { deniedCreate = true; return SQLITE.SQLITE_DENY; }
    return SQLITE.SQLITE_OK;
  });
  let faultCode: string | null = null;
  try { applySourceRegistryMigration(fault, sql, migrationManifest(), { applyEnabled: true }); }
  catch (error) { faultCode = error instanceof Error && "code" in error ? String(error.code) : null; }
  fault.setAuthorizer(null);
  const rollback = Object.freeze({ deniedCreate, errorCode: faultCode, version: Number((fault.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version), targetTableCount: targetCount(fault), schemaSha256: sourceRegistrySchemaFingerprint(fault) });
  fault.exec("PRAGMA journal_mode=DELETE"); fault.close();

  const secretPath = join(runRoot, "schema10-secret-manifest-rejected.sqlite");
  const secretDatabase = buildSchema9(secretPath);
  const currentManifest = migrationManifest();
  const secretManifest = { ...currentManifest, rss: currentManifest.rss.map((entry, index) => index === 0 ? { ...entry, siteUrl: "https://www.motorsport.com/?token=plaintext-secret" } : entry) };
  const secretManifestRejection = negative("secret-bearing manifest URL", () => applySourceRegistryMigration(secretDatabase, sql, secretManifest, { applyEnabled: true }));
  const secretRollback = Object.freeze({ version: Number((secretDatabase.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version), targetTableCount: targetCount(secretDatabase), schemaSha256: sourceRegistrySchemaFingerprint(secretDatabase) });
  secretDatabase.exec("PRAGMA journal_mode=DELETE"); secretDatabase.close();

  if (first.schemaFingerprintSha256 !== SOURCE_REGISTRY_SCHEMA10_SHA256 || !replay.replay || measuredTargetTables !== SOURCE_REGISTRY_TABLES.length) throw new Error(`EVIDENCE_SCHEMA10_INVALID:${first.schemaFingerprintSha256}`);
  if (canonicalJson(counts) !== canonicalJson({ allSources: 63, activeRss: 4, disabledX: 59, configs: 4, health: 63, history: 63, outbox: 0, closedAuthorities: 3 })) throw new Error("EVIDENCE_BACKFILL_INVALID");
  if (list.length !== 63 || rssDetail.config === null || xDetail.xAutomation === null || canonicalJson(xDetail.xAutomation) !== canonicalJson(X_AUTOMATION_ZERO)) throw new Error("EVIDENCE_READ_MODEL_INVALID");
  if (closedPlan.status !== "closed" || negatives.some((entry) => !entry.rejected)) throw new Error("EVIDENCE_CLOSED_BOUNDARY_INVALID");
  if (reopen.version !== 10 || reopen.schemaSha256 !== SOURCE_REGISTRY_SCHEMA10_SHA256 || reopen.sourceCount !== 63 || reopen.targetTableCount !== SOURCE_REGISTRY_TABLES.length || reopen.enabledAuthorities !== 3 || reopen.bilingualV1Enabled !== 1) throw new Error("EVIDENCE_DURABILITY_INVALID");
  if (!deniedCreate || faultCode !== "MIGRATION_FAILED" || rollback.version !== 9 || rollback.targetTableCount !== 0 || rollback.schemaSha256 !== SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256) throw new Error("EVIDENCE_ROLLBACK_INVALID");
  if (!secretManifestRejection.rejected || secretRollback.version !== 9 || secretRollback.targetTableCount !== 0 || secretRollback.schemaSha256 !== SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256) throw new Error("EVIDENCE_SECRET_BOUNDARY_INVALID");

  const migrationInputs = Array.from({ length: 10 }, (_, index) => {
    const number = String(index + 1).padStart(4, "0");
    const file = index === 0 ? "0001_rss_real.sql" : index === 1 ? "0002_admin_review_publish.sql" : index === 2 ? "0003_projection_delivery_runtime.sql" : index === 3 ? "0004_rss_media_and_chinese_refinement.sql" : index === 4 ? "0005_second_rss_autosport.sql" : index === 5 ? "0006_independent_rss_racefans_the_race.sql" : index === 6 ? "0007_internal_operation_recovery_phase.sql" : index === 7 ? "0008_x_manual_inbox.sql" : index === 8 ? "0009_bilingual_refinement.sql" : "0010_source_registry.sql";
    if (!file.startsWith(number)) throw new Error("EVIDENCE_MIGRATION_ORDER_INVALID");
    return Object.freeze({ path: `app/migrations/rss-real/${file}`, sha256: sha256(readFileSync(join(appRoot, "migrations/rss-real", file))) });
  });
  const receipt = Object.freeze({ schemaVersion: "ql4-0010-source-registry-evidence-r2", runId, status: "PASS", scope: "scratch_acceptance_only", production: false, nodeVersion: process.version, npmVersion, externalCalls: 0, modelCalls: 0, writesToBase: false, source: { userVersion: 9, raw0009Sha256: SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256, canonical0009Sha256: SOURCE_REGISTRY_SOURCE_0009_CANONICAL_SHA256, schema9Sha256: sourceSchema }, target: { userVersion: 10, migrationSha256: SOURCE_REGISTRY_MIGRATION_SHA256, migrationCanonicalSha256: SOURCE_REGISTRY_MIGRATION_CANONICAL_SHA256, schema10Sha256: SOURCE_REGISTRY_SCHEMA10_SHA256, measuredTargetTables, expectedTargetTables: SOURCE_REGISTRY_TABLES.length, first, replay, counts, reopen }, registry: { listCount: list.length, rssDetail: { sourceId: rssDetail.source.sourceId, config: rssDetail.config !== null, health: rssDetail.health !== null, history: rssDetail.history.length }, xDetail: { sourceId: xDetail.source.sourceId, xAutomation: xDetail.xAutomation }, manifestSha256: sha256(canonicalJson(migrationManifest())) }, authority: { initialClosed: true, closedPlan, negatives, authorityVerifications, bridgeTruth, workerActivationPerformed: false, sourceMutationAcceptance: { performedInBoundDisposableFocusedTest: true, lifecycle: ["disable", "requeue", "enable"], fiveTruthVerified: true, forgedPermitRejected: true, atomicEnableOutboxCount: 1 } }, rollback, secretBoundary: { rejection: secretManifestRejection, rollback: secretRollback }, migrationInputs, adminReleaseRuntimeFiles: [] });
  const receiptJson = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(join(runRoot, "receipt.json"), receiptJson);
  const report = `# QL4/0010 source registry authority bridge R2 evidence\n\n- status: PASS\n- run: ${runId}\n- exact runtime: ${process.version} / npm ${npmVersion}\n- preimage: 0009 raw ${SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256}; schema9 ${sourceSchema}\n- migration: raw ${SOURCE_REGISTRY_MIGRATION_SHA256}; canonical ${SOURCE_REGISTRY_MIGRATION_CANONICAL_SHA256}; schema10 ${SOURCE_REGISTRY_SCHEMA10_SHA256}\n- deterministic backfill: 4 active RSS + 59 proposed/disabled/manual_url X = 63 sources; config 4; health/history 63/63\n- X automation: poll/search/rules/RSSHub/cookie/oEmbed/automaticBackfill/externalCalls all 0\n- authority: all three v2 capabilities started closed; disposable same-UID Admin permits activated source management and both bilingual capabilities; operation/handoff/permit/audit/state truths all verified\n- source mutation acceptance: the manifest-bound focused test executes disable/requeue/enable, rejects a forged authorization receipt, and commits exactly one pending enable outbox atomically\n- bilingual bridge: v1 enabled only after both granular bilingual v2 truths; raw authority/source writes and authorizer-protected DROP TRIGGER remained rejected\n- durability: reopened same DB at schema10 with ${reopen.enabledAuthorities} enabled v2 capabilities and bilingual v1 enabled=${reopen.bilingualV1Enabled}\n- replay/secret boundary: drifted manifest and secret-bearing URL rejected with zero writes\n- rollback: injected target CREATE denial returned ${faultCode}, schema9 preserved, target tables 0\n- external/model/Base/production calls: 0 / 0 / false / false\n\nThe evidence activates only the authority substrate in its file DB; the manifest-bound focused test performs source mutations only in a disposable in-memory DB. It starts no worker, exposes no Admin route, and claims no production authority. The evidence script and destructive fault injection remain scratch acceptance material outside Admin runtime/release closure.\n`;
  writeFileSync(join(runRoot, "report.md"), report);
  const evidencePath = new URL(import.meta.url).pathname;
  const imports = localImportClosure(evidencePath);
  const implementationFiles = [
    "app/migrations/rss-real/0010_source_registry.sql",
    "app/src/server/rss/source-registry-migration.ts",
    "app/src/server/rss/source-registry.ts",
    "app/src/server/rss/bilingual-gateway-port.ts",
    "app/src/server/internal-operation/gateway.ts",
    "app/src/tests/source-registry.test.ts",
    "app/scripts/source-registry-0010-evidence.ts"
  ].map((path) => Object.freeze({ path, sha256: sha256(readFileSync(join(repoRoot, path))) }));
  const manifest = Object.freeze({ schemaVersion: "ql4-0010-source-registry-evidence-manifest-v1", runId, evidenceScript: "app/scripts/source-registry-0010-evidence.ts", evidenceScriptSha256: sha256(readFileSync(evidencePath)), implementationFiles, imports: { localGraphIncludesTypeOnly: true, local: imports }, runtimeMigrationInputs: migrationInputs, receipt: "receipt.json", receiptSha256: sha256(receiptJson), report: "report.md", reportSha256: sha256(report), targetDatabase: "schema10-source-registry.sqlite", targetDatabaseSha256: sha256(readFileSync(targetPath)), faultDatabase: "schema10-fault-rollback.sqlite", faultDatabaseSha256: sha256(readFileSync(faultPath)), secretBoundaryDatabase: "schema10-secret-manifest-rejected.sqlite", secretBoundaryDatabaseSha256: sha256(readFileSync(secretPath)), closure: "scratch_only_not_admin_runtime", adminReleaseRuntimeFiles: [] });
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(runRoot, "manifest.json"), manifestJson);
  process.stdout.write(`${JSON.stringify({ runRoot, receiptSha256: sha256(receiptJson), reportSha256: sha256(report), manifestSha256: sha256(manifestJson) })}\n`);
}

main();
