import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { constants as sqliteConstants, DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, test } from "vitest";

import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";
import {
  applySourceRegistryMigration,
  assertSourceRegistrySchema,
  readSourceRegistryMigrationSql,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256,
  SOURCE_REGISTRY_TABLES,
  verifyAuthorityActivationReceipt,
  type QuickLaunchAuthorityCapability,
  type SourceRegistryMigrationManifest
} from "../server/rss/source-registry-migration.ts";
import {
  X_AUTOMATION_ZERO,
  assertIdentityImmutable,
  assertOnboardingTransition,
  canAutoCollect,
  deriveActivationReadiness,
  deriveEpochFences,
  planDisableSource,
  planEnableSource,
  planProposeSource,
  planRequeueSource,
  planRetireSource,
  planValidateSource,
  readSourceDetail,
  readSourceList,
  sourceIdentity,
  transitionSourceOutbox,
  type SourceRecord
} from "../server/rss/source-registry.ts";
import { applyXManualInboxMigration } from "../server/tweet-inbox/repository.ts";
import { SqliteInternalOperationGateway } from "../server/internal-operation/gateway.ts";
import { SqliteGatewayMutationPort } from "../server/internal-operation/mutation-port.ts";
import { SqliteBilingualGatewayMutationPort } from "../server/rss/bilingual-gateway-port.ts";
import { assertSourceLineage, planBilingualRefinement } from "../server/rss/bilingual-core.ts";
import { runBilingualRefinement } from "../server/rss/bilingual-worker.ts";
import { BilingualAdminRepository, BilingualAdminRoutes } from "../server/admin-service/bilingual-admin.ts";
import { canonicalJson } from "../server/db/profile.ts";
import { ReviewAdminSecurity } from "../server/review-real/security.ts";
import type { RawAdminContext } from "../server/source-management/security.ts";
import { openAdmittedReviewDatabase, disposeAdmittedReviewDatabases } from "./helpers/admitted-review-database.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");
const NOW = "2026-08-25T00:00:00.000Z";
const ZERO = "0".repeat(64);
const SQLITE = sqliteConstants as unknown as Record<string, number>;
type AuthorizableDatabase = DatabaseSync & { setAuthorizer(callback: ((action: number, arg1?: string | null) => number) | null): void };

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function adminContext(input: Readonly<{ path: string; cookie: string; csrf?: string; idempotencyKey?: string }>): RawAdminContext {
  const rawHeaders = new Map<string, readonly string[]>([
    ["origin", ["https://f1-admin.example.ts.net"]],
    ["sec-fetch-site", ["same-origin"]],
    ["cookie", [input.cookie]]
  ]);
  if (input.csrf) rawHeaders.set("x-csrf-token", [input.csrf]);
  if (input.idempotencyKey) rawHeaders.set("idempotency-key", [input.idempotencyKey]);
  return Object.freeze({ method: "POST", path: input.path, authority: "f1-admin.example.ts.net", origin: "https://f1-admin.example.ts.net", peer: "loopback", rawHeaders, noEgressReady: true });
}

function v9Database(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const file of [
    "0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql",
    "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"
  ]) database.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${file}`, "utf8"));
  applyInternalOperationMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8"));
  applyXManualInboxMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0008_x_manual_inbox.sql`, "utf8"));
  applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
  return database;
}

function manifest(): SourceRegistryMigrationManifest {
  const shared = { scheduleSeconds: 900, routeIdentitySha256: "1".repeat(64), routeReleaseSha256: "2".repeat(64), routeManifestSha256: "3".repeat(64), rightsStatus: "clear" as const, mediaPolicy: "allowlisted" as const, authorizationExpiresAt: "2027-08-25T00:00:00.000Z", authorizationReceiptSha256: "4".repeat(64), sourcePolicySha256: "5".repeat(64) };
  return Object.freeze({
    schemaVersion: "source-registry-migration-manifest-v1",
    migratedAt: NOW,
    rss: Object.freeze([
      { ...shared, sourceId: "motorsport-f1-news", displayName: "Motorsport.com", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
      { ...shared, sourceId: "autosport-f1-news", displayName: "Autosport", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
      { ...shared, sourceId: "racefans-f1-news", displayName: "RaceFans", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
      { ...shared, sourceId: "the-race-f1-news", displayName: "The Race", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" }
    ])
  });
}

function v10Database(): DatabaseSync {
  const database = v9Database();
  applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), manifest(), { applyEnabled: true });
  return database;
}

function applySchema10Base(database: DatabaseSync): void {
  for (const file of [
    "0001_rss_real.sql",
    "0002_admin_review_publish.sql",
    "0003_projection_delivery_runtime.sql",
    "0004_rss_media_and_chinese_refinement.sql",
    "0005_second_rss_autosport.sql",
    "0006_independent_rss_racefans_the_race.sql"
  ]) {
    database.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${file}`, "utf8"));
  }
  applyInternalOperationMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8"));
  applyXManualInboxMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0008_x_manual_inbox.sql`, "utf8"));
  applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
  applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), manifest(), { applyEnabled: true });
}

function v10AdmittedDatabase(seed?: (database: DatabaseSync) => void): DatabaseSync {
  return openAdmittedReviewDatabase({
    finalVersion: 10,
    seed: (database: DatabaseSync) => {
      applySchema10Base(database);
      seed?.(database);
    }
  });
}

function activateAuthority(
  database: DatabaseSync,
  capabilityId: QuickLaunchAuthorityCapability,
  suffix: string,
  now: string,
  receiptSha256: string,
  nonceCharacter: string,
  action: "enable" | "close" = "enable",
  beforeTransition?: (context: Readonly<{ operationId: string; requestHash: string; now: string }>) => void
): string {
  const operationId = `activate-${capabilityId}-${suffix}`;
  const handoffId = `handoff-${capabilityId}-${suffix}`;
  const requestHash = ((Number.parseInt(receiptSha256[0], 16) + 1) % 16).toString(16).repeat(64);
  const capability = database.prepare("SELECT version,state FROM quick_launch_authority_v2 WHERE capability_id=?").get(capabilityId) as Record<string, unknown>;
  const expectedVersion = Number(capability.version);
  const targetState = action === "enable" ? "enabled" : "closed";
  database.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(
    handoffId, "admin_http", "f1plus1-owner-supervisor-v1", `h${nonceCharacter}`.repeat(22).slice(0, 43), ZERO, ZERO,
    receiptSha256, now, "2026-08-26T00:00:00.000Z"
  );
  const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>;
  database.prepare(`INSERT INTO internal_operation(
    operation_id,idempotency_key,operation_kind,owner_process,capability_class,policy_id,authorization_handoff_id,control_action,state,version,
    candidate_id,source_id,publication_id,public_id,phase,attempt,budget_reservation_id,egress_class,model_route_ref,
    expected_schema_sha256,expected_release_sha256,expected_manifest_sha256,source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch,
    source_stop_epoch,global_stop_state,emergency_stop_state,recovery_state,deletion_fence_state,publication_fence_state,request_hash,request_fingerprint,
    expected_control_version,expected_entity_version,expected_entity_hash,entity_set_json,entity_set_hash,required_fence_set_json,required_fence_set_hash,
    expected_writer_epoch,result_hash,reason_code,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    operationId, operationId, "phase_control", "admin_http", "control", "p-phase-control-disabled", handoffId, "fence_update", "requested", 1,
    null, null, null, null, "disabled", 0, null, "none", null,
    SOURCE_REGISTRY_SCHEMA10_SHA256, ZERO, ZERO, Number(control.source_config_epoch), Number(control.source_safety_epoch), Number(control.authorization_version), Number(control.policy_epoch), Number(control.recovery_epoch),
    null, String(control.global_stop_state), String(control.emergency_stop_state), String(control.recovery_state), String(control.deletion_fence_state), String(control.publication_fence_state), requestHash, receiptSha256,
    Number(control.version), null, ZERO, "[]", ZERO, "[]", ZERO, Number(control.writer_epoch), null, null, now, now
  );
  database.prepare("UPDATE owner_authorization_handoff SET consumed_by_operation_id=? WHERE handoff_id=? AND consumed_by_operation_id IS NULL").run(operationId, handoffId);
  database.prepare("UPDATE internal_operation SET state='authorized',version=2,updated_at=? WHERE operation_id=? AND state='requested' AND version=1").run(now, operationId);
  database.prepare("INSERT INTO quick_launch_authority_permit_v2 VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(
    `permit-${capabilityId}-${suffix}`, operationId, capabilityId, action, expectedVersion,
    nonceCharacter.repeat(43), requestHash, receiptSha256, now
  );
  beforeTransition?.({ operationId, requestHash, now });
  database.prepare(`UPDATE quick_launch_authority_v2 SET state=?,version=?,updated_by_operation_id=?,authority_receipt_sha256=?,updated_at=?
    WHERE capability_id=? AND state=? AND version=?`).run(targetState, expectedVersion + 1, operationId, receiptSha256, now, capabilityId, String(capability.state), expectedVersion);
  return operationId;
}

function activateV1Direct(database: DatabaseSync): void {
  const operationId = "activate-bilingual-v1-direct";
  const handoffId = "handoff-bilingual-v1-direct";
  const receipt = "d".repeat(64); const requestHash = "e".repeat(64); const now = "2026-08-25T00:00:01.000Z";
  const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>;
  database.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(handoffId, "admin_http", "f1plus1-owner-supervisor-v1", "d".repeat(43), ZERO, ZERO, "c".repeat(64), NOW, "2026-08-26T00:00:00.000Z");
  database.prepare(`INSERT INTO internal_operation(
    operation_id,idempotency_key,operation_kind,owner_process,capability_class,policy_id,authorization_handoff_id,control_action,state,version,
    candidate_id,source_id,publication_id,public_id,phase,attempt,budget_reservation_id,egress_class,model_route_ref,
    expected_schema_sha256,expected_release_sha256,expected_manifest_sha256,source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch,
    source_stop_epoch,global_stop_state,emergency_stop_state,recovery_state,deletion_fence_state,publication_fence_state,request_hash,request_fingerprint,
    expected_control_version,expected_entity_version,expected_entity_hash,entity_set_json,entity_set_hash,required_fence_set_json,required_fence_set_hash,
    expected_writer_epoch,result_hash,reason_code,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    operationId, operationId, "phase_control", "admin_http", "control", "p-phase-control-disabled", handoffId, "fence_update", "requested", 1,
    null, null, null, null, "disabled", 0, null, "none", null, SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256, ZERO, ZERO,
    Number(control.source_config_epoch), Number(control.source_safety_epoch), Number(control.authorization_version), Number(control.policy_epoch), Number(control.recovery_epoch),
    null, String(control.global_stop_state), String(control.emergency_stop_state), String(control.recovery_state), String(control.deletion_fence_state), String(control.publication_fence_state), requestHash, "f".repeat(64),
    Number(control.version), null, ZERO, "[]", ZERO, "[]", ZERO, Number(control.writer_epoch), null, null, now, now
  );
  database.prepare("UPDATE owner_authorization_handoff SET consumed_by_operation_id=? WHERE handoff_id=?").run(operationId, handoffId);
  database.prepare("UPDATE internal_operation SET state='authorized',version=2,updated_at=? WHERE operation_id=? AND state='requested'").run(now, operationId);
  database.prepare("INSERT INTO bilingual_authority_permit_v1 VALUES(?,?,?,?,?,?,?,?,?,?,NULL)").run("permit-bilingual-v1-direct", operationId, "enable", 1, SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256, SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256, "v".repeat(43), requestHash, receipt, now);
  database.prepare("UPDATE bilingual_authority_capability_v1 SET enabled=1,status='enabled',reason_code='READY',extension_sha256=?,version=2,updated_by_operation_id=?,authority_receipt_sha256=?,updated_at=? WHERE capability_id='bilingual-v1' AND version=1").run(SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256, operationId, receipt, now);
}

type OperationOwner = "admin_http" | "restore_operator" | "system_supervisor";

function authorizeBoundOperation(database: DatabaseSync, input: Readonly<{ operationId: string; owner: OperationOwner; operationKind: "phase_control" | "restore" | "source_update"; capabilityClass: "control" | "restore"; policyId: string; controlAction: string | null; sourceId: string | null; entityKind: "internal_control" | "source"; entityId: string; identitySelector: "control_singleton" | "source_id"; now: string; requestHash: string }>): void {
  const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>;
  const handoffId = `handoff-${input.operationId}`;
  const entityJson = JSON.stringify([{ entityKind: input.entityKind, entityId: input.entityId, expectedVersion: null, expectedHash: ZERO }]);
  database.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(handoffId, input.owner, "f1plus1-owner-supervisor-v1", input.operationId.padEnd(43, "h").slice(0, 43), ZERO, ZERO, Buffer.from(input.operationId, "utf8").toString("hex").padEnd(64, "0").slice(0, 64), input.now, "2026-08-26T00:00:00.000Z");
  database.prepare(`INSERT INTO internal_operation(
    operation_id,idempotency_key,operation_kind,owner_process,capability_class,policy_id,authorization_handoff_id,control_action,state,version,
    candidate_id,source_id,publication_id,public_id,phase,attempt,budget_reservation_id,egress_class,model_route_ref,
    expected_schema_sha256,expected_release_sha256,expected_manifest_sha256,source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch,
    source_stop_epoch,global_stop_state,emergency_stop_state,recovery_state,deletion_fence_state,publication_fence_state,request_hash,request_fingerprint,
    expected_control_version,expected_entity_version,expected_entity_hash,entity_set_json,entity_set_hash,required_fence_set_json,required_fence_set_hash,
    expected_writer_epoch,result_hash,reason_code,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.operationId, input.operationId, input.operationKind, input.owner, input.capabilityClass, input.policyId, handoffId, input.controlAction, "requested", 1,
    null, input.sourceId, null, null, String(control.phase), 0, null, "none", null,
    SOURCE_REGISTRY_SCHEMA10_SHA256, ZERO, ZERO, Number(control.source_config_epoch), Number(control.source_safety_epoch), Number(control.authorization_version), Number(control.policy_epoch), Number(control.recovery_epoch),
    input.sourceId === null ? null : 1, String(control.global_stop_state), String(control.emergency_stop_state), String(control.recovery_state), String(control.deletion_fence_state), String(control.publication_fence_state), input.requestHash, "f".repeat(64),
    Number(control.version), null, ZERO, entityJson, ZERO, "[]", ZERO, Number(control.writer_epoch), null, null, input.now, input.now
  );
  database.prepare("INSERT INTO operation_entity_binding VALUES(?,?,?,?,?,?,?)").run(input.operationId, input.entityKind, input.entityId, input.identitySelector, null, ZERO, ZERO);
  database.prepare("UPDATE owner_authorization_handoff SET consumed_by_operation_id=? WHERE handoff_id=? AND consumed_by_operation_id IS NULL").run(input.operationId, handoffId);
  expect(database.prepare("UPDATE internal_operation SET state='authorized',version=2,updated_at=? WHERE operation_id=? AND state='requested' AND version=1").run(input.now, input.operationId).changes).toBe(1);
}

function readyPausedControl(database: DatabaseSync): void {
  const control = (index: number, owner: OperationOwner, policyId: string, action: "recovery_advance" | "writer_epoch_bump" | "recovery_complete" | "clear_global_stop" | "pause", statement: string): void => {
    const now = `2026-08-25T00:00:${String(10 + index).padStart(2, "0")}.000Z`;
    const operationId = `source-control-${index}`;
    authorizeBoundOperation(database, { operationId, owner, operationKind: action === "recovery_advance" || action === "writer_epoch_bump" || action === "recovery_complete" ? "restore" : "phase_control", capabilityClass: action === "recovery_advance" || action === "writer_epoch_bump" || action === "recovery_complete" ? "restore" : "control", policyId, controlAction: action, sourceId: null, entityKind: "internal_control", entityId: "1", identitySelector: "control_singleton", now, requestHash: `${index}`.repeat(64) });
    database.prepare("INSERT INTO gateway_write_permit VALUES(?,?,?,?,?,NULL,?,NULL,?)").run(`write-${operationId}`, operationId, "internal_control", "1", "update", ZERO, now);
    expect(database.prepare(statement).run().changes).toBe(1);
    database.prepare("UPDATE gateway_write_permit SET consumed_at=? WHERE permit_id=? AND consumed_at IS NULL").run(now, `write-${operationId}`);
    database.prepare("UPDATE internal_operation SET state='succeeded',version=3,result_hash=?,updated_at=? WHERE operation_id=? AND state='authorized' AND version=2").run(`${index + 2}`.repeat(64), now, operationId);
  };
  control(1, "restore_operator", "p-restore-control-disabled", "recovery_advance", "UPDATE internal_control SET recovery_state='restoring',version=version+1,updated_by_operation_id='source-control-1' WHERE singleton_id=1");
  control(2, "restore_operator", "p-restore-control-disabled", "recovery_advance", "UPDATE internal_control SET recovery_state='verifying',version=version+1,updated_by_operation_id='source-control-2' WHERE singleton_id=1");
  control(3, "system_supervisor", "p-supervisor-restore-disabled", "writer_epoch_bump", `UPDATE internal_control SET recovery_epoch=recovery_epoch+1,writer_epoch=writer_epoch+1,writer_authority_receipt_sha256='${"9".repeat(64)}',version=version+1,updated_by_operation_id='source-control-3' WHERE singleton_id=1`);
  control(4, "system_supervisor", "p-supervisor-restore-disabled", "recovery_complete", "UPDATE internal_control SET recovery_state='ready',version=version+1,updated_by_operation_id='source-control-4' WHERE singleton_id=1");
  control(5, "admin_http", "p-phase-control-disabled", "clear_global_stop", "UPDATE internal_control SET global_stop_state='clear',version=version+1,updated_by_operation_id='source-control-5' WHERE singleton_id=1");
  control(6, "admin_http", "p-phase-control-disabled", "pause", "UPDATE internal_control SET phase='paused',version=version+1,updated_by_operation_id='source-control-6' WHERE singleton_id=1");
}

function mutateRssSource(database: DatabaseSync, action: "disable" | "requeue" | "enable", expectedRevision: number, now: string, beforePermit?: (input: Readonly<{ operationId: string; requestHash: string; handoffId: string }>) => void): void {
  const operationId = `source-${action}-${expectedRevision}`;
  const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>;
  const requestHash = String.fromCharCode(96 + expectedRevision).repeat(64);
  authorizeBoundOperation(database, { operationId, owner: "admin_http", operationKind: "source_update", capabilityClass: "control", policyId: "p-source-update-paused", controlAction: null, sourceId: "motorsport-f1-news", entityKind: "source", entityId: "motorsport-f1-news", identitySelector: "source_id", now, requestHash });
  const handoffId = `handoff-${operationId}`;
  beforePermit?.({ operationId, requestHash, handoffId });
  database.prepare("INSERT INTO source_registry_mutation_permit_v1 VALUES(?,?,?,?,?,?,?,?,?,?,NULL)").run(`source-permit-${action}-${expectedRevision}`, operationId, "motorsport-f1-news", action, expectedRevision, requestHash, action === "requeue" ? "CREDENTIAL_ROTATION" : "OPERATOR_REQUEST", handoffId, `${action[0]}${expectedRevision}`.padEnd(43, action[0]), now);
  const common = `revision=revision+1,current_operation_id=?,current_request_hash=?,updated_at=?,source_config_epoch=?,source_safety_epoch=?,authorization_version=?,policy_epoch=?,recovery_epoch=?`;
  const values = [operationId, requestHash, now, Number(control.source_config_epoch), Number(control.source_safety_epoch), Number(control.authorization_version), Number(control.policy_epoch), Number(control.recovery_epoch), "motorsport-f1-news", expectedRevision];
  const edge = action === "disable" ? "enabled=0,lifecycle_status='paused',collection_onboarding_status='stopped',source_stop_status='manual'" : action === "requeue" ? "enabled=0,lifecycle_status='paused',collection_onboarding_status='activation_pending',source_stop_status='clear'" : "enabled=1,lifecycle_status='active',collection_onboarding_status='queued',source_stop_status='clear'";
  expect(database.prepare(`UPDATE source_registry_v1 SET ${common},${edge} WHERE source_id=? AND revision=?`).run(...values).changes).toBe(1);
}

describe("0010 schema and deterministic backfill", () => {
  test("applies exact schema9, maps four RSS and 59 X, and replays", () => {
    const database = v9Database();
    const first = applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), manifest(), { applyEnabled: true });
    expect(first).toEqual({ applied: true, replay: false, schemaFingerprintSha256: SOURCE_REGISTRY_SCHEMA10_SHA256 });
    assertSourceRegistrySchema(database);
    expect(database.prepare("SELECT count(*) AS count FROM source_registry_v1").get()).toEqual({ count: 63 });
    expect(database.prepare("SELECT count(*) AS count FROM source_registry_v1 WHERE source_kind='rss' AND enabled=1 AND lifecycle_status='active' AND collection_onboarding_status='active'").get()).toEqual({ count: 4 });
    expect(database.prepare("SELECT count(*) AS count FROM source_registry_v1 WHERE source_kind='x_manual' AND enabled=0 AND lifecycle_status='proposed' AND collection_mode='manual_url'").get()).toEqual({ count: 59 });
    expect(database.prepare("SELECT count(*) AS count FROM source_registry_history_v1").get()).toEqual({ count: 63 });
    expect(database.prepare("SELECT count(*) AS count FROM source_registry_health_v1").get()).toEqual({ count: 63 });
    expect(database.prepare("SELECT count(*) AS count FROM quick_launch_authority_v2 WHERE state='closed' AND version=1").get()).toEqual({ count: 3 });
    expect(applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), manifest(), { applyEnabled: true })).toEqual({ applied: false, replay: true, schemaFingerprintSha256: SOURCE_REGISTRY_SCHEMA10_SHA256 });
    const driftedManifest = { ...manifest(), rss: manifest().rss.map((entry, index) => index === 0 ? { ...entry, displayName: "Drifted" } : entry) };
    expect(() => applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), driftedManifest, { applyEnabled: true })).toThrowError(expect.objectContaining({ code: "MANIFEST_INVALID" }));
  });

  test("fails closed on preimage drift and atomically rolls back a denied target table", () => {
    const secret = v9Database();
    const secretManifest = { ...manifest(), rss: manifest().rss.map((entry, index) => index === 0 ? { ...entry, siteUrl: "https://www.motorsport.com/?token=plaintext-secret" } : entry) };
    expect(() => applySourceRegistryMigration(secret, readSourceRegistryMigrationSql(), secretManifest, { applyEnabled: true })).toThrowError(expect.objectContaining({ code: "MANIFEST_INVALID" }));
    expect(secret.prepare("PRAGMA user_version").get()).toEqual({ user_version: 9 });
    for (const noncanonicalSiteUrl of ["https://www.motorsport.com", "https://www.motorsport.com:443/", "https://www.motorsport.com/a/../"]) {
      const noncanonical = v9Database();
      const noncanonicalManifest = { ...manifest(), rss: manifest().rss.map((entry, index) => index === 0 ? { ...entry, siteUrl: noncanonicalSiteUrl } : entry) };
      expect(() => applySourceRegistryMigration(noncanonical, readSourceRegistryMigrationSql(), noncanonicalManifest, { applyEnabled: true })).toThrowError(expect.objectContaining({ code: "MANIFEST_INVALID" }));
      expect(noncanonical.prepare("PRAGMA user_version").get()).toEqual({ user_version: 9 });
    }
    const drift = v9Database();
    drift.exec("CREATE TABLE schema9_drift(value TEXT) STRICT");
    expect(() => applySourceRegistryMigration(drift, readSourceRegistryMigrationSql(), manifest(), { applyEnabled: true })).toThrowError(expect.objectContaining({ code: "SCHEMA9_DRIFT" }));
    expect(drift.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name IN ('source_registry_v1','quick_launch_authority_v2')").get()).toEqual({ count: 0 });

    const denied = v9Database() as AuthorizableDatabase;
    let injected = false;
    denied.setAuthorizer((action, arg1) => {
      if (action === SQLITE.SQLITE_CREATE_TABLE && arg1 === "source_registry_health_v1") { injected = true; return SQLITE.SQLITE_DENY; }
      return SQLITE.SQLITE_OK;
    });
    expect(() => applySourceRegistryMigration(denied, readSourceRegistryMigrationSql(), manifest(), { applyEnabled: true })).toThrowError(expect.objectContaining({ code: "MIGRATION_FAILED" }));
    denied.setAuthorizer(null);
    expect(injected).toBe(true);
    expect(denied.prepare("PRAGMA user_version").get()).toEqual({ user_version: 9 });
    expect(denied.prepare(`SELECT count(*) AS count FROM sqlite_schema WHERE name IN (${SOURCE_REGISTRY_TABLES.map(() => "?").join(",")})`).get(...SOURCE_REGISTRY_TABLES)).toEqual({ count: 0 });
  });

  test("rejects a legally direct-enabled schema9 preimage with zero schema10 targets", () => {
    const database = v9Database();
    activateV1Direct(database);
    expect(database.prepare("SELECT enabled,status,version FROM bilingual_authority_capability_v1").get()).toEqual({ enabled: 1, status: "enabled", version: 2 });
    expect(() => applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), manifest(), { applyEnabled: true })).toThrowError(expect.objectContaining({ code: "MIGRATION_FAILED" }));
    expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 9 });
    expect(database.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name IN ('quick_launch_authority_v2','source_registry_v1')").get()).toEqual({ count: 0 });
  });
});

describe("source registry read models and closed core", () => {
  test("serves bounded list/detail/config/health/history and the X automation-zero boundary", () => {
    const database = v10Database();
    expect(readSourceList(database, { sourceKind: "rss", enabled: true, limit: 10 })).toHaveLength(4);
    expect(readSourceList(database, { sourceKind: "x_manual", enabled: false, limit: 100 })).toHaveLength(59);
    const rss = readSourceDetail(database, "motorsport-f1-news", NOW);
    expect(rss.config).toMatchObject({ schedule_seconds: 900, rights_status: "clear" });
    expect(rss.health).toMatchObject({ external_calls: 0 });
    expect(rss.history).toHaveLength(1);
    expect(rss.xAutomation).toBeNull();
    const x = readSourceDetail(database, "x_f1", NOW);
    expect(x.config).toBeNull();
    expect(x.xAutomation).toEqual(X_AUTOMATION_ZERO);
    expect(x.source).toMatchObject({ enabled: false, lifecycleStatus: "proposed", collectionMode: "manual_url" });
    expect(() => readSourceList(database, { limit: 101 })).toThrowError(expect.objectContaining({ code: "QUERY_INVALID" }));
  });

  test("keeps every exported runtime mutation API closed until gateway integration", () => {
    for (const result of [planProposeSource(), planValidateSource(), planRequeueSource(), planEnableSource(), planDisableSource(), planRetireSource()]) {
      expect(result).toMatchObject({ status: "closed", reasonCode: "AUTHORITY_EXTENSION_REQUIRED", writesToDatabase: false, externalCalls: 0 });
    }
    expect([planProposeSource().action, planValidateSource().action, planRequeueSource().action, planEnableSource().action, planDisableSource().action, planRetireSource().action]).toEqual(["propose", "validate", "requeue", "enable", "disable", "retire"]);
  });

  test("derives five guards/fences, preserves identity, and closes outbox transitions", () => {
    const source = readSourceDetail(v10Database(), "motorsport-f1-news", NOW).source;
    const readySource: SourceRecord = Object.freeze({ ...source, monitorability: "monitorable" });
    const readiness = deriveActivationReadiness(readySource, NOW);
    const database = v10Database();
    const fences = deriveEpochFences(database, readySource.sourceId, null, NOW);
    expect(Object.values(readiness).every((guard) => guard.state === "clear")).toBe(true);
    expect(fences).toHaveLength(5);
    expect(fences.every((fence) => fence.state === "unknown" && fence.truthReceiptSha256 === null)).toBe(true);
    expect(canAutoCollect(readySource, readiness, fences)).toBe(false);
    expect(canAutoCollect(readySource, readiness, fences.map((fence) => ({ ...fence, state: "clear" as const, truthReceiptSha256: "a".repeat(64) })))).toBe(false);
    expect(sourceIdentity(source)).toBe(source.identitySha256);
    expect(() => assertIdentityImmutable(source, { ...source, siteUrl: "https://drift.invalid/" })).toThrowError(expect.objectContaining({ code: "IDENTITY_IMMUTABLE" }));
    expect(() => assertOnboardingTransition("linked_existing", "activation_pending")).toThrowError(expect.objectContaining({ code: "STATE_TRANSITION_INVALID" }));
    const outbox = { outboxId: "outbox-1", sourceId: source.sourceId, operationId: "enable-1", sourceRevision: 2, state: "pending" as const, leaseToken: null, leaseExpiresAt: null, attemptCount: 0, payloadSha256: ZERO, createdAt: NOW, updatedAt: NOW };
    expect(() => transitionSourceOutbox(outbox, { state: "leased", operationId: "lease-short", now: "2026-08-25T00:00:01.000Z", leaseToken: "short", leaseExpiresAt: "2026-08-25T00:01:01.000Z" })).toThrowError(expect.objectContaining({ code: "OUTBOX_TRANSITION_INVALID" }));
    const leased = transitionSourceOutbox(outbox, { state: "leased", operationId: "lease-1", now: "2026-08-25T00:00:01.000Z", leaseToken: "l".repeat(43), leaseExpiresAt: "2026-08-25T00:01:01.000Z" });
    expect(leased).toMatchObject({ state: "leased", attemptCount: 1 });
    expect(() => transitionSourceOutbox(leased, { state: "succeeded", operationId: "lease-1", now: "2026-08-25T00:00:02.000Z", leaseToken: "wrong" })).toThrowError(expect.objectContaining({ code: "OUTBOX_TRANSITION_INVALID" }));
    expect(() => transitionSourceOutbox(leased, { state: "pending", operationId: "retry-1", now: "2026-08-25T00:00:02.000Z" })).toThrowError(expect.objectContaining({ code: "OUTBOX_TRANSITION_INVALID" }));
    expect(() => transitionSourceOutbox(leased, { state: "succeeded", operationId: "lease-1", now: "2026-08-25T00:01:01.000Z", leaseToken: "l".repeat(43) })).toThrowError(expect.objectContaining({ code: "OUTBOX_TRANSITION_INVALID" }));
    const expiredRetry = transitionSourceOutbox(leased, { state: "pending", operationId: "retry-1", now: "2026-08-25T00:01:02.000Z" });
    expect(expiredRetry).toMatchObject({ state: "pending", operationId: "retry-1", attemptCount: 1, leaseToken: null });
  });
});

describe("quick-launch v2 authority substrate", () => {
  afterEach(() => disposeAdmittedReviewDatabases());

  test("keeps the concrete bilingual gateway port closed before activation and performs zero model calls", async () => {
    const database = v10AdmittedDatabase();
    const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: ZERO, manifestSha256: ZERO, schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256, now: () => new Date("2026-08-25T00:00:20.000Z") });
    let handoffs = 0;
    let externalCalls = 0;
    const port = new SqliteBilingualGatewayMutationPort({ database, gateway, activation: { operationId: "missing-activation", receiptSha256: "1".repeat(64) }, handoffProvider: () => { handoffs += 1; throw new Error("closed port requested handoff"); } });
    const lineage = assertSourceLineage({ candidateId: "candidate-closed-port", publicId: "public-closed-port", sourceId: "motorsport-f1-news", sourceRevision: 1, inputContentHash: "1".repeat(64), sourceFactSetHash: "2".repeat(64), sourceReleaseHash: "3".repeat(64), canonicalUrl: "https://example.invalid/closed", sourceTitle: "Closed", sourceAuthor: null, sourcePublishedAt: NOW, sourceExcerpt: "private" });
    const plannedPair = planBilingualRefinement(lineage.candidateId, lineage.sourceRevision, lineage.inputContentHash, 1);
    const result = await runBilingualRefinement({ lineage, promptSha256: "4".repeat(64), now: NOW, mutationPort: port, gateway: {
      plan(modelInput, operationId, parentOperationId, attemptNumber) { return { operationId, parentOperationId, idempotencyKey: plannedPair.children.find((child) => child.language === modelInput.language)!.idempotencyKey, candidateId: lineage.candidateId, language: modelInput.language, attemptNumber, route: { routeRef: "closed", providerId: "closed", modelId: "closed", routeIdentitySha256: ZERO, releaseSha256: ZERO, manifestSha256: ZERO }, budget: { accountId: "closed", reservationId: `closed-${modelInput.language}`, units: 1, currency: "USD" }, external: { method: "POST", endpointClass: "model_refine", providerResource: "closed", externalIdempotencyKey: `closed-${modelInput.language}`, reconcileKey: `closed-reconcile-${modelInput.language}`, headers: [], query: [], bodySha256: ZERO } }; },
      async execute() { externalCalls += 1; throw new Error("closed port called model"); }
    } });
    expect(result).toMatchObject({ status: "closed", externalCalls: 0, writesToBase: false });
    expect({ handoffs, externalCalls }).toEqual({ handoffs: 0, externalCalls: 0 });
    gateway.close();
  });
  test("starts closed, rejects raw enable, and consumes one Admin handoff permit exactly once", () => {
    const database = v10Database();
    expect(() => database.prepare("UPDATE quick_launch_authority_v2 SET state='enabled',version=2 WHERE capability_id='source_registry_management'").run()).toThrow(/QUICK_LAUNCH_AUTHORITY_TRANSITION_INVALID/u);
    const handoff = { handoffId: "handoff-0010-authority", ownerProcess: "admin_http" as const, issuer: "f1plus1-owner-supervisor-v1" as const, oneTimeNonce: "h".repeat(43), releaseSha256: ZERO, manifestSha256: ZERO, receiptSha256: "6".repeat(64), verifiedAt: NOW, expiresAt: "2026-08-26T00:00:00.000Z" };
    database.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(handoff.handoffId, handoff.ownerProcess, handoff.issuer, handoff.oneTimeNonce, handoff.releaseSha256, handoff.manifestSha256, handoff.receiptSha256, handoff.verifiedAt, handoff.expiresAt);
    const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>;
    database.prepare(`INSERT INTO internal_operation(
      operation_id,idempotency_key,operation_kind,owner_process,capability_class,policy_id,authorization_handoff_id,control_action,state,version,
      candidate_id,source_id,publication_id,public_id,phase,attempt,budget_reservation_id,egress_class,model_route_ref,
      expected_schema_sha256,expected_release_sha256,expected_manifest_sha256,source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch,
      source_stop_epoch,global_stop_state,emergency_stop_state,recovery_state,deletion_fence_state,publication_fence_state,request_hash,request_fingerprint,
      expected_control_version,expected_entity_version,expected_entity_hash,entity_set_json,entity_set_hash,required_fence_set_json,required_fence_set_hash,
      expected_writer_epoch,result_hash,reason_code,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "activate-source-registry-v2", "activate-source-registry-v2", "phase_control", "admin_http", "control", "p-phase-control-disabled", handoff.handoffId, "fence_update", "requested", 1,
      null, null, null, null, "disabled", 0, null, "none", null,
      SOURCE_REGISTRY_SCHEMA10_SHA256, ZERO, ZERO, Number(control.source_config_epoch), Number(control.source_safety_epoch), Number(control.authorization_version), Number(control.policy_epoch), Number(control.recovery_epoch),
      null, String(control.global_stop_state), String(control.emergency_stop_state), String(control.recovery_state), String(control.deletion_fence_state), String(control.publication_fence_state), "7".repeat(64), "8".repeat(64),
      Number(control.version), null, ZERO, "[]", ZERO, "[]", ZERO, Number(control.writer_epoch), null, null, NOW, NOW
    );
    database.prepare("UPDATE owner_authorization_handoff SET consumed_by_operation_id=? WHERE handoff_id=? AND consumed_by_operation_id IS NULL").run("activate-source-registry-v2", handoff.handoffId);
    database.prepare("UPDATE internal_operation SET state='authorized',version=2,updated_at=? WHERE operation_id=? AND state='requested' AND version=1").run(NOW, "activate-source-registry-v2");
    const receipt = "9".repeat(64);
    database.prepare("INSERT INTO quick_launch_authority_permit_v2 VALUES(?,?,?,?,?,?,?,?,?,NULL)").run("permit-source-registry-v2", "activate-source-registry-v2", "source_registry_management", "enable", 1, "p".repeat(43), "7".repeat(64), receipt, NOW);
    database.prepare("UPDATE quick_launch_authority_v2 SET state='enabled',version=2,updated_by_operation_id=?,authority_receipt_sha256=?,updated_at=? WHERE capability_id='source_registry_management' AND state='closed' AND version=1").run("activate-source-registry-v2", receipt, NOW);
    expect(database.prepare("SELECT state,version FROM quick_launch_authority_v2 WHERE capability_id='source_registry_management'").get()).toEqual({ state: "enabled", version: 2 });
    expect(database.prepare("SELECT consumed_at FROM quick_launch_authority_permit_v2 WHERE permit_id='permit-source-registry-v2'").get()).toEqual({ consumed_at: NOW });
    expect(database.prepare("SELECT count(*) AS count FROM quick_launch_authority_audit_v2").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT state,version FROM internal_operation WHERE operation_id='activate-source-registry-v2'").get()).toEqual({ state: "succeeded", version: 3 });
    expect(database.prepare("SELECT count(*) AS count FROM internal_operation_audit WHERE operation_id='activate-source-registry-v2' AND event_type='operation_succeeded'").get()).toEqual({ count: 1 });
    expect(verifyAuthorityActivationReceipt(database, { capabilityId: "source_registry_management", operationId: "activate-source-registry-v2", receiptSha256: receipt })).toMatchObject({ valid: true, truth: { operation: true, handoff: true, permit: true, audit: true, state: true } });
    expect(readSourceRegistryMigrationSql()).not.toContain("NEW.action<>'enable'");
    expect(() => database.prepare("UPDATE quick_launch_authority_v2 SET version=3,updated_at=? WHERE capability_id='source_registry_management'").run("2026-08-25T00:00:01.000Z")).toThrow(/QUICK_LAUNCH_AUTHORITY_TRANSITION_INVALID/u);
    expect(database.prepare("SELECT enabled,status FROM bilingual_authority_capability_v1").get()).toEqual({ enabled: 0, status: "closed" });
  });

  test("bridges both bilingual v2 truths to v1 once, verifies five truths, and closes on either capability", () => {
    const database = v10Database();
    const autoOperation = activateAuthority(database, "bilingual_auto_refine", "auto", "2026-08-25T00:00:01.000Z", "1".repeat(64), "a", "enable", ({ operationId, requestHash, now }) => {
      expect(() => database.prepare("INSERT INTO bilingual_authority_bridge_marker_v1 VALUES(?,?,?,?,?,?,NULL)").run("forged-marker", operationId, "enable", SOURCE_REGISTRY_SCHEMA10_SHA256, "1".repeat(64), now)).toThrow(/BILINGUAL_AUTHORITY_BRIDGE_INVALID/u);
      expect(() => database.prepare("INSERT INTO bilingual_authority_permit_v1 VALUES(?,?,?,?,?,?,?,?,?,?,NULL)").run("forged-v1-permit", operationId, "enable", 1, SOURCE_REGISTRY_SCHEMA10_SHA256, SOURCE_REGISTRY_SCHEMA10_SHA256, "z".repeat(43), requestHash, "1".repeat(64), now)).toThrow(/BILINGUAL_AUTHORITY_SCHEMA10_BRIDGE_REQUIRED/u);
      expect(() => database.prepare("INSERT INTO bilingual_authority_permit_v1 VALUES(?,?,?,?,?,?,?,?,?,?,NULL)").run("forged-v1-direct-schema9", operationId, "enable", 1, SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256, SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256, "y".repeat(43), requestHash, "1".repeat(64), now)).toThrow(/BILINGUAL_AUTHORITY_SCHEMA10_BRIDGE_REQUIRED/u);
    });
    expect(database.prepare("SELECT enabled,status,version FROM bilingual_authority_capability_v1").get()).toEqual({ enabled: 0, status: "closed", version: 1 });
    expect(verifyAuthorityActivationReceipt(database, { capabilityId: "bilingual_auto_refine", operationId: autoOperation, receiptSha256: "1".repeat(64) }).valid).toBe(false);

    const manualOperation = activateAuthority(database, "bilingual_manual_mutation", "manual", "2026-08-25T00:00:02.000Z", "3".repeat(64), "b");
    expect(database.prepare("SELECT enabled,status,version,extension_sha256 FROM bilingual_authority_capability_v1").get()).toEqual({ enabled: 1, status: "enabled", version: 2, extension_sha256: SOURCE_REGISTRY_SCHEMA10_SHA256 });
    expect(database.prepare("SELECT consumed_at FROM bilingual_authority_permit_v1 WHERE operation_id=?").get(manualOperation)).toEqual({ consumed_at: "2026-08-25T00:00:02.000Z" });
    expect(database.prepare("SELECT count(*) AS count FROM bilingual_authority_audit_v1 WHERE to_state='enabled'").get()).toEqual({ count: 1 });
    expect(readBilingualMigrationSql()).toContain("authority_receipt_sha256 TEXT NOT NULL UNIQUE");
    expect(readSourceRegistryMigrationSql()).toContain("authority_receipt_sha256 TEXT NOT NULL UNIQUE");
    expect(verifyAuthorityActivationReceipt(database, { capabilityId: "bilingual_auto_refine", operationId: autoOperation, receiptSha256: "1".repeat(64) })).toMatchObject({ valid: true, truth: { operation: true, handoff: true, permit: true, audit: true, state: true } });
    expect(verifyAuthorityActivationReceipt(database, { capabilityId: "bilingual_manual_mutation", operationId: manualOperation, receiptSha256: "3".repeat(64) })).toMatchObject({ valid: true, truth: { operation: true, handoff: true, permit: true, audit: true, state: true } });
    expect(() => database.prepare("UPDATE bilingual_authority_capability_v1 SET enabled=0,status='closed',version=3 WHERE capability_id='bilingual-v1'").run()).toThrow(/BILINGUAL_AUTHORITY_TRANSITION_INVALID/u);
    expect(() => database.prepare("UPDATE quick_launch_authority_v2 SET version=3 WHERE capability_id='bilingual_manual_mutation'").run()).toThrow(/QUICK_LAUNCH_AUTHORITY_TRANSITION_INVALID/u);

    activateAuthority(database, "bilingual_auto_refine", "auto-close", "2026-08-25T00:00:03.000Z", "5".repeat(64), "c", "close");
    expect(database.prepare("SELECT enabled,status,version FROM bilingual_authority_capability_v1").get()).toEqual({ enabled: 0, status: "closed", version: 3 });
  });

  test("executes source disable-requeue-enable with five-truth authority and one atomic outbox", () => {
    const database = v10Database();
    const authorityOperation = activateAuthority(database, "source_registry_management", "source-positive", "2026-08-25T00:00:01.000Z", "7".repeat(64), "s");
    expect(verifyAuthorityActivationReceipt(database, { capabilityId: "source_registry_management", operationId: authorityOperation, receiptSha256: "7".repeat(64) }).valid).toBe(true);
    readyPausedControl(database);
    expect(verifyAuthorityActivationReceipt(database, { capabilityId: "source_registry_management", operationId: authorityOperation, receiptSha256: "7".repeat(64) })).toMatchObject({ valid: true, truth: { operation: true, handoff: true, permit: true, audit: true, state: true } });
    expect(verifyAuthorityActivationReceipt(database, { capabilityId: "source_registry_management", operationId: authorityOperation, receiptSha256: "6".repeat(64) }).valid).toBe(false);
    expect(verifyAuthorityActivationReceipt(database, { capabilityId: "source_registry_management", operationId: "forged-activation", receiptSha256: "7".repeat(64) }).valid).toBe(false);
    mutateRssSource(database, "disable", 1, "2026-08-25T00:00:20.000Z");
    mutateRssSource(database, "requeue", 2, "2026-08-25T00:00:21.000Z");
    mutateRssSource(database, "enable", 3, "2026-08-25T00:00:22.000Z", ({ operationId, requestHash }) => {
        expect(() => database.prepare("INSERT INTO source_registry_mutation_permit_v1 VALUES(?,?,?,?,?,?,?,?,?,?,NULL)").run("bad-source-enable-permit", operationId, "motorsport-f1-news", "enable", 3, requestHash, "OPERATOR_REQUEST", "wrong-handoff", "x".repeat(43), "2026-08-25T00:00:22.000Z")).toThrow(/SOURCE_REGISTRY_MUTATION_PERMIT_INVALID/u);
        expect(database.prepare("SELECT revision,enabled FROM source_registry_v1 WHERE source_id='motorsport-f1-news'").get()).toEqual({ revision: 3, enabled: 0 });
    });
    expect(database.prepare("SELECT revision,enabled,lifecycle_status,collection_onboarding_status FROM source_registry_v1 WHERE source_id='motorsport-f1-news'").get()).toEqual({ revision: 4, enabled: 1, lifecycle_status: "active", collection_onboarding_status: "queued" });
    expect(database.prepare("SELECT count(*) AS count FROM source_registry_outbox_v1 WHERE source_id='motorsport-f1-news' AND source_revision=4 AND state='pending'").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM source_registry_mutation_permit_v1 WHERE consumed_at IS NOT NULL").get()).toEqual({ count: 3 });
    expect(readSourceRegistryMigrationSql()).toContain("c.phase='paused'");
    expect(readSourceRegistryMigrationSql()).toContain("op.expected_writer_epoch=c.writer_epoch");
  });

  test("executes a paused source disable through the schema10 gateway and mutation port", () => {
    const handoff = {
      handoffId: "handoff-source-gateway-disable",
      ownerProcess: "admin_http" as const,
      issuer: "f1plus1-owner-supervisor-v1" as const,
      oneTimeNonce: "g".repeat(43),
      releaseSha256: ZERO,
      manifestSha256: ZERO,
      receiptSha256: "8".repeat(64),
      verifiedAt: "2026-08-25T00:00:19.000Z",
      expiresAt: "2099-08-26T00:00:00.000Z"
    };
    const database = v10AdmittedDatabase((seedDatabase: DatabaseSync) => {
      activateAuthority(seedDatabase, "source_registry_management", "source-gateway", "2026-08-25T00:00:01.000Z", "7".repeat(64), "s");
      readyPausedControl(seedDatabase);
      seedDatabase.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(
        handoff.handoffId,
        handoff.ownerProcess,
        handoff.issuer,
        handoff.oneTimeNonce,
        handoff.releaseSha256,
        handoff.manifestSha256,
        handoff.receiptSha256,
        handoff.verifiedAt,
        handoff.expiresAt
      );
    });
    const gateway = new SqliteInternalOperationGateway({
      database,
      releaseSha256: ZERO,
      manifestSha256: ZERO,
      schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
      now: () => new Date("2026-08-25T00:00:20.000Z")
    });
    const port = new SqliteGatewayMutationPort({
      database,
      gateway,
      ownerProcess: "admin_http",
      handoffProvider: () => handoff,
      now: () => new Date("2026-08-25T00:00:20.000Z")
    });

    expect(port.mutateSourceRegistry({
      operationId: "source-gateway-disable",
      action: "disable",
      sourceId: "motorsport-f1-news",
      expectedRevision: 1,
      reasonCode: "OPERATOR_REQUEST"
    })).toBe(1);
    expect(database.prepare("SELECT revision,enabled,lifecycle_status,collection_onboarding_status FROM source_registry_v1 WHERE source_id='motorsport-f1-news'").get()).toEqual({
      revision: 2,
      enabled: 0,
      lifecycle_status: "paused",
      collection_onboarding_status: "stopped"
    });
    expect(database.prepare("SELECT state,result_hash FROM internal_operation WHERE operation_id='source-gateway-disable'").get()).toMatchObject({ state: "succeeded" });
    expect(database.prepare("SELECT count(*) AS count FROM source_registry_mutation_permit_v1 WHERE operation_id='source-gateway-disable' AND consumed_at IS NOT NULL").get()).toEqual({ count: 1 });
    gateway.close();
  });

  test("binds a paused source mutation to historical five-truth authority and current operation epochs at the Admin route", () => {
    const handoff = {
      handoffId: "handoff-source-admin-route",
      ownerProcess: "admin_http" as const,
      issuer: "f1plus1-owner-supervisor-v1" as const,
      oneTimeNonce: "r".repeat(43),
      releaseSha256: ZERO,
      manifestSha256: ZERO,
      receiptSha256: "8".repeat(64),
      verifiedAt: "2026-08-25T00:00:19.000Z",
      expiresAt: "2099-08-26T00:00:00.000Z"
    };
    const database = v10AdmittedDatabase((seedDatabase: DatabaseSync) => {
      activateAuthority(seedDatabase, "source_registry_management", "source-admin-route", "2026-08-25T00:00:01.000Z", "7".repeat(64), "s");
      readyPausedControl(seedDatabase);
      seedDatabase.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(
        handoff.handoffId, handoff.ownerProcess, handoff.issuer, handoff.oneTimeNonce,
        handoff.releaseSha256, handoff.manifestSha256, handoff.receiptSha256,
        handoff.verifiedAt, handoff.expiresAt
      );
    });
    const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: ZERO, manifestSha256: ZERO, schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256, now: () => new Date("2026-08-25T00:00:20.000Z") });
    const port = new SqliteGatewayMutationPort({ database, gateway, ownerProcess: "admin_http", handoffProvider: () => handoff, now: () => new Date("2026-08-25T00:00:20.000Z") });
    const security = new ReviewAdminSecurity({
      canonicalOrigin: "https://f1-admin.example.ts.net",
      sessionHashKey: Buffer.alloc(32, 9),
      now: () => Date.parse("2026-08-25T00:00:20.000Z"),
      readRecoveryFence: () => ({ clockTrusted: true, writerReady: true, lastSuccessfulRecoveryPointAt: Date.parse("2026-08-25T00:00:19.000Z") })
    });
    const session = security.acceptVerifiedSession({ operatorRef: "operator", deviceRef: "device", tailnetUserRef: "tailnet-user" });
    const repository = new BilingualAdminRepository(database);
    expect(repository.sourceManagementCapability()).toMatchObject({ enabled: true, reasonCode: "READY" });
    const routes = new BilingualAdminRoutes(repository, security, port);
    const path = "/api/admin/sources/motorsport-f1-news/disable";
    const unsigned = {
      schemaVersion: "admin-source-registry-v1" as const,
      action: "disable" as const,
      sourceId: "motorsport-f1-news",
      expectedRevision: 1,
      reasonCode: "OPERATOR_REQUEST" as const,
      idempotencyKey: "source-route-disable-idem",
      clientRequestId: "source-route-disable-client"
    };
    const mutation = { ...unsigned, requestHash: sha256(canonicalJson({ method: "POST", canonicalPath: path, body: unsigned })) };
    expect(() => routes.tryHandle(adminContext({ path, cookie: session.cookieHeader, idempotencyKey: unsigned.idempotencyKey }), mutation)).toThrow("ADMIN_CSRF_REJECTED");
    const csrfResult = routes.tryHandle(adminContext({ path: "/api/admin/csrf", cookie: session.cookieHeader }), { schemaVersion: "admin-bilingual-v1", mutation });
    const csrf = (csrfResult?.body as { csrfToken: string }).csrfToken;
    expect(routes.tryHandle(adminContext({ path, cookie: session.cookieHeader, csrf, idempotencyKey: unsigned.idempotencyKey }), mutation)).toEqual({
      status: 200,
      body: expect.objectContaining({ status: "succeeded", changes: 1, externalCalls: 0, automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 })
    });
    expect(database.prepare("SELECT revision,enabled,lifecycle_status FROM source_registry_v1 WHERE source_id='motorsport-f1-news'").get()).toEqual({ revision: 2, enabled: 0, lifecycle_status: "paused" });
    gateway.close();
  });
});
