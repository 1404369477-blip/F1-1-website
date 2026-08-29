import { lstatSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync, linkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, test } from "vitest";

import { withSqliteAuthorizerContext, installSqliteAuthorizer, getInstalledSqliteAuthorizer } from "../server/internal-operation/authorizer.ts";
import { canonicalExternalRequestHash, requestFingerprintHash, SqliteInternalOperationGateway } from "../server/internal-operation/gateway.ts";
import { openAdmittedReviewDatabase, openAdmittedReviewFixture, disposeAdmittedReviewDatabases, type AdmittedReviewFixture } from "./helpers/admitted-review-database.ts";
import { SqliteGatewayMutationPort } from "../server/internal-operation/mutation-port.ts";
import { persistOwnerSupervisorHandoff } from "../server/internal-operation/owner-supervisor.ts";
import { applyInternalOperationMigration, assertInternalOperationSchema } from "../server/review-real/migration.ts";
import { phaseEgressDecision, phaseTransitionAllowed, PHASE_BATCH_LIMIT } from "../server/internal-operation/phase.ts";
import { validateRecoveryPointReceipt } from "../server/internal-operation/recovery.ts";
import {
  assertFallbackCapabilities,
  buildReleasePairReceipt,
  collectReleaseFiles,
  fallbackV10Capabilities,
  fullV10Capabilities,
  releaseIdForRole,
  releasePathRoot,
  releaseSourcePreimageSha256,
  type ReleaseCandidateManifest
} from "../server/internal-operation/release.ts";
import { ADMIN_RELEASE_RUNTIME_FILES, ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256 } from "../server/admin-service/release-manifest.ts";
import { PUBLIC_RELEASE_RUNTIME_FILES, PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256 } from "../server/public/release-manifest.ts";
import {
  SOURCE_REGISTRY_MIGRATION_SHA256,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256
} from "../server/rss/source-registry-migration.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const MIGRATIONS = [
  "0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql",
  "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"
] as const;
const MIGRATION_0007 = `${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`;
const SCHEMA_SHA = "f3c0c049575b3121cccc8e66438481c70931df461cd941b95aaa54100844ad60";
const ZERO = "0".repeat(64);

function v6Database(): DatabaseSync {
  return openAdmittedReviewDatabase({
    finalVersion: 6,
    seed: (database: DatabaseSync) => {
      for (const migration of MIGRATIONS) database.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${migration}`, "utf8"));
    }
  });
}

function v7Database(afterMigrationSeed?: (database: DatabaseSync) => void): DatabaseSync {
  return openAdmittedReviewDatabase({
    finalVersion: 7,
    seed: (database: DatabaseSync) => {
      for (const migration of MIGRATIONS) database.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${migration}`, "utf8"));
      applyInternalOperationMigration(database, readFileSync(MIGRATION_0007, "utf8"));
      afterMigrationSeed?.(database);
    }
  });
}

function externalReadyDatabase(): {
  database: DatabaseSync;
  gateway: SqliteInternalOperationGateway;
  handoff: ReturnType<typeof ownerHandoff>;
  unknownHandoff: ReturnType<typeof ownerHandoff>;
  backlogHandoff: ReturnType<typeof ownerHandoff>;
  liveHandoff: ReturnType<typeof ownerHandoff>;
} {
  const now = "2026-08-24T00:00:00.000Z";
  const handoffs = new Map<string, ReturnType<typeof ownerHandoff>>();
  const owners = ["restore_operator", "restore_operator", "system_supervisor", "system_supervisor", "admin_http", "rss_collector", "rss_collector", "admin_http", "admin_http"] as const;
  for (let index = 0; index < owners.length; index += 1) {
    const id = `h${index + 1}`;
    const receipt = String(index + 1).repeat(64);
    const value = ownerHandoff(id, owners[index], receipt);
    handoffs.set(id, value);
  }
  const database = v7Database((seed: DatabaseSync) => {
    for (const [id, value] of handoffs) {
      seed.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(id, value.ownerProcess, value.issuer, value.oneTimeNonce, ZERO, ZERO, value.receiptSha256, now, "2026-08-25T00:00:00.000Z");
    }
    seed.prepare("INSERT INTO route_registry VALUES(?,?,?,?,?,?,?,?,?)").run("route-rss", "rss", "rss_https", "rss_fetch", ZERO, ZERO, ZERO, "active", 1);
    seed.prepare("INSERT INTO budget_account VALUES(?,?,?,?,?,?)").run("acct", "requests", 100, 0, 0, 1);
  });
  const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: ZERO, manifestSha256: ZERO, now: () => new Date(now) });
  const binding = { entityKind: "internal_control" as const, entityId: "1", identitySelector: "control_singleton" as const, expectedVersion: null, expectedHash: ZERO };
  const controlOperation = (index: number, owner: typeof owners[number], policyId: string, action: "recovery_advance" | "writer_epoch_bump" | "recovery_complete" | "clear_global_stop", sql: string): void => {
    const control = database.prepare("SELECT * FROM internal_control").get() as Record<string, unknown>;
    const id = `control-${index}`;
    const handoffValue = handoffs.get(`h${index}`);
    if (!handoffValue) throw new Error("TEST_HANDOFF_MISSING");
    const restore = action !== "clear_global_stop";
    const capability = gateway.request(handoffValue, {
      operationId: id, idempotencyKey: id, operationKind: restore ? "restore" : "phase_control", ownerProcess: owner,
      capabilityClass: restore ? "restore" : "control", policyId, authorizationHandoffId: handoffValue.handoffId, controlAction: action,
      identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null }, entitySet: [binding], requiredFenceSet: [],
      expected: { controlVersion: Number(control.version), entityVersion: null, entityHash: ZERO, schemaSha256: SCHEMA_SHA, releaseSha256: ZERO, manifestSha256: ZERO, sourceStopEpoch: null, writerEpoch: Number(control.writer_epoch), epochs: { sourceConfig: Number(control.source_config_epoch), sourceSafety: Number(control.source_safety_epoch), authorization: Number(control.authorization_version), policy: Number(control.policy_epoch), recovery: Number(control.recovery_epoch) } },
      phase: "disabled", egressClass: "none", budgetRequest: null, modelRouteRef: null, requestHash: ZERO, requestFingerprint: ZERO
    });
    const authorized = gateway.authorize(capability);
    const permit = gateway.authorizeWrite(authorized, { entityKind: "internal_control", entityId: "1", mutationKind: "update", expectedVersion: null, expectedHash: ZERO });
    gateway.mutate(permit, { entityKind: "internal_control", entityId: "1", mutationKind: "update", statement: sql });
    gateway.postcheckFenceSet(authorized);
  };
  controlOperation(1, "restore_operator", "p-restore-control-disabled", "recovery_advance", "UPDATE internal_control SET recovery_state='restoring',version=version+1,updated_by_operation_id='control-1' WHERE singleton_id=1");
  controlOperation(2, "restore_operator", "p-restore-control-disabled", "recovery_advance", "UPDATE internal_control SET recovery_state='verifying',version=version+1,updated_by_operation_id='control-2' WHERE singleton_id=1");
  controlOperation(3, "system_supervisor", "p-supervisor-restore-disabled", "writer_epoch_bump", `UPDATE internal_control SET recovery_epoch=2,writer_epoch=2,writer_authority_receipt_sha256='${"1".repeat(64)}',version=version+1,updated_by_operation_id='control-3' WHERE singleton_id=1`);
  controlOperation(4, "system_supervisor", "p-supervisor-restore-disabled", "recovery_complete", "UPDATE internal_control SET recovery_state='ready',version=version+1,updated_by_operation_id='control-4' WHERE singleton_id=1");
  controlOperation(5, "admin_http", "p-phase-control-disabled", "clear_global_stop", "UPDATE internal_control SET global_stop_state='clear',version=version+1,updated_by_operation_id='control-5' WHERE singleton_id=1");
  return { database, gateway, handoff: handoffs.get("h6")!, unknownHandoff: handoffs.get("h7")!, backlogHandoff: handoffs.get("h8")!, liveHandoff: handoffs.get("h9")! };
}

function ownerHandoff(handoffId: string, ownerProcess: "restore_operator" | "system_supervisor" | "admin_http" | "rss_collector", receiptSha256: string) {
  return { handoffId, ownerProcess, issuer: "f1plus1-owner-supervisor-v1" as const, oneTimeNonce: handoffId.padEnd(43, "a"), releaseSha256: ZERO, manifestSha256: ZERO, receiptSha256, verifiedAt: "2026-08-24T00:00:00.000Z", expiresAt: "2026-08-25T00:00:00.000Z" };
}

function leasedAdmittedGateway(handoffId: string): {
  fixture: AdmittedReviewFixture;
  gateway: SqliteInternalOperationGateway;
  database: DatabaseSync;
  path: string;
  handoff: ReturnType<typeof ownerHandoff>;
} {
  const handoff = ownerHandoff(handoffId, "rss_collector", "1".repeat(64));
  const fixture = openAdmittedReviewFixture({
    finalVersion: 7,
    seed: (seedDb: DatabaseSync) => {
      for (const migration of MIGRATIONS) seedDb.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${migration}`, "utf8"));
      applyInternalOperationMigration(seedDb, readFileSync(MIGRATION_0007, "utf8"));
      seedDb.prepare("INSERT INTO route_registry VALUES(?,?,?,?,?,?,?,?,?)").run("route-rss", "rss", "rss_https", "rss_fetch", ZERO, ZERO, ZERO, "active", 1);
      seedDb.prepare("INSERT INTO budget_account VALUES(?,?,?,?,?,?)").run("acct", "requests", 100, 0, 0, 1);
      seedDb.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(handoff.handoffId, handoff.ownerProcess, handoff.issuer, handoff.oneTimeNonce, handoff.releaseSha256, handoff.manifestSha256, handoff.receiptSha256, handoff.verifiedAt, handoff.expiresAt);
    }
  });
  const gateway = new SqliteInternalOperationGateway({ database: fixture.database, releaseSha256: ZERO, manifestSha256: ZERO, now: () => new Date("2026-08-24T00:00:00.000Z") });
  return { fixture, gateway, database: fixture.database, path: fixture.path, handoff };
}

function collectRequest(database: DatabaseSync, handoff: ReturnType<typeof ownerHandoff>) {
  const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>;
  return {
    operationId: "lease-test-op",
    idempotencyKey: "lease-test-op",
    operationKind: "collect" as const,
    ownerProcess: "rss_collector" as const,
    capabilityClass: "external_attempt" as const,
    policyId: "p-collect-disabled",
    authorizationHandoffId: handoff.handoffId,
    controlAction: null,
    identity: { sourceId: "motorsport-f1-news", candidateId: null, publicationId: null, publicId: null },
    entitySet: [{ entityKind: "source" as const, entityId: "motorsport-f1-news", identitySelector: "source_id" as const, expectedVersion: null, expectedHash: ZERO }],
    requiredFenceSet: [],
    expected: {
      controlVersion: Number(control.version),
      entityVersion: null,
      entityHash: ZERO,
      schemaSha256: SCHEMA_SHA,
      releaseSha256: ZERO,
      manifestSha256: ZERO,
      sourceStopEpoch: 1,
      writerEpoch: Number(control.writer_epoch),
      epochs: {
        sourceConfig: Number(control.source_config_epoch),
        sourceSafety: Number(control.source_safety_epoch),
        authorization: Number(control.authorization_version),
        policy: Number(control.policy_epoch),
        recovery: Number(control.recovery_epoch)
      }
    },
    phase: "disabled" as const,
    egressClass: "rss_https" as const,
    budgetRequest: { reservationId: "lease-test-budget", accountId: "acct", units: 1 },
    modelRouteRef: null,
    requestHash: "a".repeat(64),
    requestFingerprint: "b".repeat(64)
  };
}

function enterLive(database: DatabaseSync, gateway: SqliteInternalOperationGateway, backlogHandoff: ReturnType<typeof ownerHandoff>, liveHandoff: ReturnType<typeof ownerHandoff>): void {
  const transition = (operationId: string, policyId: string, handoff: ReturnType<typeof ownerHandoff>, action: "enter_backlog" | "enter_live", phase: "backlog" | "live"): void => {
    const control = database.prepare("SELECT * FROM internal_control").get() as Record<string, unknown>;
    const capability = gateway.request(handoff, {
      operationId, idempotencyKey: operationId, operationKind: "phase_control", ownerProcess: "admin_http", capabilityClass: "control", policyId,
      authorizationHandoffId: handoff.handoffId, controlAction: action,
      identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
      entitySet: [{ entityKind: "internal_control", entityId: "1", identitySelector: "control_singleton", expectedVersion: null, expectedHash: ZERO }], requiredFenceSet: [],
      expected: { controlVersion: Number(control.version), entityVersion: null, entityHash: ZERO, schemaSha256: SCHEMA_SHA, releaseSha256: ZERO, manifestSha256: ZERO, sourceStopEpoch: null, writerEpoch: Number(control.writer_epoch), epochs: { sourceConfig: Number(control.source_config_epoch), sourceSafety: Number(control.source_safety_epoch), authorization: Number(control.authorization_version), policy: Number(control.policy_epoch), recovery: Number(control.recovery_epoch) } },
      phase: String(control.phase) as "disabled" | "backlog", egressClass: "none", budgetRequest: null, modelRouteRef: null, requestHash: ZERO, requestFingerprint: ZERO
    });
    const authorized = gateway.authorize(capability);
    const permit = gateway.authorizeWrite(authorized, { entityKind: "internal_control", entityId: "1", mutationKind: "update", expectedVersion: null, expectedHash: ZERO });
    gateway.mutate(permit, { entityKind: "internal_control", entityId: "1", mutationKind: "update", statement: `UPDATE internal_control SET phase='${phase}',version=version+1,updated_by_operation_id='${operationId}' WHERE singleton_id=1` });
    gateway.postcheckFenceSet(authorized);
  };
  transition("phase-enter-backlog", "p-phase-control-disabled", backlogHandoff, "enter_backlog", "backlog");
  transition("phase-enter-live", "p-phase-control-backlog", liveHandoff, "enter_live", "live");
}

describe("0007 exact migration and authorizer", () => {
  afterEach(() => disposeAdmittedReviewDatabases());

  test("rolls back an atomic admission and removes its in-memory capability", () => {
    const { database, gateway, handoff } = externalReadyDatabase();
    const control = database.prepare("SELECT * FROM internal_control").get() as Record<string, unknown>;
    expect(() => gateway.runAtomicAdmission(() => {
      gateway.request(handoff, {
        operationId: "atomic-rollback-operation", idempotencyKey: "atomic-rollback-operation", operationKind: "collect", ownerProcess: "rss_collector", capabilityClass: "external_attempt", policyId: "p-collect-disabled", authorizationHandoffId: handoff.handoffId, controlAction: null,
        identity: { sourceId: "motorsport-f1-news", candidateId: null, publicationId: null, publicId: null }, entitySet: [{ entityKind: "source", entityId: "motorsport-f1-news", identitySelector: "source_id", expectedVersion: null, expectedHash: ZERO }], requiredFenceSet: [],
        expected: { controlVersion: Number(control.version), entityVersion: null, entityHash: ZERO, schemaSha256: SCHEMA_SHA, releaseSha256: ZERO, manifestSha256: ZERO, sourceStopEpoch: 1, writerEpoch: Number(control.writer_epoch), epochs: { sourceConfig: Number(control.source_config_epoch), sourceSafety: Number(control.source_safety_epoch), authorization: Number(control.authorization_version), policy: Number(control.policy_epoch), recovery: Number(control.recovery_epoch) } },
        phase: "disabled", egressClass: "rss_https", budgetRequest: { reservationId: "atomic-rollback-budget", accountId: "acct", units: 1 }, modelRouteRef: null, requestHash: "a".repeat(64), requestFingerprint: "b".repeat(64)
      });
      throw new Error("INJECTED_ADMISSION_ROLLBACK");
    })).toThrow("INJECTED_ADMISSION_ROLLBACK");
    expect(database.prepare("SELECT 1 FROM internal_operation WHERE operation_id='atomic-rollback-operation'").get()).toBeUndefined();
    expect(database.prepare("SELECT 1 FROM budget_reservation WHERE reservation_id='atomic-rollback-budget'").get()).toBeUndefined();
    expect(database.prepare("SELECT consumed_by_operation_id FROM owner_authorization_handoff WHERE handoff_id=?").get(handoff.handoffId)).toMatchObject({ consumed_by_operation_id: null });
    expect(() => gateway.materializeBilingualAdmission({ carrierOperationId: "x", candidateId: "x", publicId: "x", sourceId: "x", sourceRevision: 1, inputContentHash: ZERO, sourceFactSetHash: ZERO, sourceReleaseHash: ZERO, copyRiskStatus: "unknown", rightsStatus: "unknown", deletionStatus: "unknown", mediaStatus: "unknown", promptSchemaVersion: "x", promptSha256: ZERO, children: [{ operationId: "x", idempotencyKey: "x", language: "zh-CN", attemptNumber: 1 }, { operationId: "y", idempotencyKey: "y", language: "en", attemptNumber: 1 }] })).toThrow("BILINGUAL_ADMISSION_TRANSACTION_REQUIRED");
    gateway.close();
  });
  test("applies the byte-pinned migration and rejects a failed preflight atomically", () => {
    const database = v6Database();
    const migration = readFileSync(MIGRATION_0007, "utf8");
    applyInternalOperationMigration(database, migration);
    assertInternalOperationSchema(database);
    expect(database.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 7 });

    const failed = v6Database();
    failed.exec("CREATE TEMP TABLE migration_0007_preflight(source_user_version INTEGER NOT NULL, source_schema_sha256 TEXT NOT NULL, migration_sha256 TEXT NOT NULL, apply_enabled INTEGER NOT NULL) STRICT");
    failed.prepare("INSERT INTO migration_0007_preflight VALUES(6,?,?,0)").run(ZERO, ZERO);
    expect(() => failed.exec(migration)).toThrow();
    expect(failed.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 6 });
    expect(failed.prepare("SELECT 1 FROM main.sqlite_schema WHERE name='internal_control'").get()).toBeUndefined();
  });

  test("rejects ATTACH/temp/unsafe pragma/extension and enforces the second-writer boundary", () => {
    const database = v7Database();
    // This is a dedicated authorizer-profile test that installs its own
    // gateway profile, so the admitted connection's worker_or_repository
    // profile is removed first. The B2b quiesce admission WeakMap binding is
    // left intact.
    getInstalledSqliteAuthorizer(database)?.uninstall();
    const authorizer = installSqliteAuthorizer(database, "gateway_owner_writer");
    expect(() => withSqliteAuthorizerContext(database, "request", () => database.exec("ATTACH DATABASE 'file:escape' AS escape"))).toThrow();
    expect(() => withSqliteAuthorizerContext(database, "request", () => database.exec("CREATE TEMP TABLE escape(value TEXT)"))).toThrow();
    expect(() => withSqliteAuthorizerContext(database, "request", () => database.exec("PRAGMA trusted_schema=OFF"))).toThrow();
    expect(() => withSqliteAuthorizerContext(database, "request", () => database.prepare("SELECT load_extension(?)").get("escape"))).toThrow();
    authorizer.uninstall();

    const first = new SqliteInternalOperationGateway({ database, releaseSha256: ZERO, manifestSha256: ZERO });
    expect(() => new SqliteInternalOperationGateway({ database, releaseSha256: ZERO, manifestSha256: ZERO })).toThrow("SECOND_WRITER_DENIED");
    first.close();
    const afterClose = new SqliteInternalOperationGateway({ database, releaseSha256: ZERO, manifestSha256: ZERO });
    afterClose.close();
  });

  test("requires an external supervisor verifier before persisting a handoff", () => {
    const database = v7Database();
    const handoff = {
      handoffId: "handoff-owner-test",
      ownerProcess: "admin_http",
      issuer: "f1plus1-owner-supervisor-v1",
      oneTimeNonce: "o".repeat(43),
      releaseSha256: ZERO,
      manifestSha256: ZERO,
      receiptSha256: "1".repeat(64),
      verifiedAt: "2026-08-24T00:00:00.000Z",
      expiresAt: "2099-08-25T00:00:00.000Z"
    } as const;
    expect(() => persistOwnerSupervisorHandoff(database, handoff, () => false)).toThrow("HANDOFF_RECEIPT_UNVERIFIED");
    persistOwnerSupervisorHandoff(database, handoff, () => true);
    expect(database.prepare("SELECT owner_process FROM owner_authorization_handoff WHERE handoff_id=?").get(handoff.handoffId)).toMatchObject({ owner_process: "admin_http" });
    expect(() => database.exec("INSERT INTO owner_authorization_handoff(handoff_id,owner_process,issuer,one_time_nonce,release_sha256,manifest_sha256,receipt_sha256,verified_at,expires_at) VALUES('bad','admin_http','f1plus1-owner-supervisor-v1','b', '0','0','2','2026-08-24T00:00:00.000Z','2026-08-25T00:00:00.000Z')")).toThrow();
  });

  test("commits an external intent before adapter entry and closes a known response", () => {
    const { database, gateway, handoff } = externalReadyDatabase();
    const control = database.prepare("SELECT * FROM internal_control").get() as Record<string, unknown>;
    const request = {
      schemaVersion: "external-request-v1" as const, method: "GET" as const, endpointClass: "rss_fetch", providerResource: "motorsport-f1-news", routeId: "route-rss",
      externalIdempotencyKey: "ext-0007-test", reconcileKey: "reconcile-0007-test", headers: [], query: [], bodySha256: null,
      attemptIdentity: { operationId: "external-operation", attemptNumber: 1, attemptNonce: "b".repeat(43) },
      entityIdentity: { sourceId: "motorsport-f1-news", candidateId: null, publicationId: null, publicId: null },
      expected: { schemaSha256: SCHEMA_SHA, releaseSha256: ZERO, manifestSha256: ZERO, routeIdentitySha256: ZERO },
      epochs: { sourceConfig: 1, sourceSafety: 1, authorization: 1, policy: 1, recovery: 2, writer: 2 }, fenceSetHash: ZERO
    };
    const canonical = canonicalExternalRequestHash(request);
    const fingerprint = requestFingerprintHash(request);
    const capability = gateway.authorize(gateway.request(handoff, {
      operationId: "external-operation", idempotencyKey: "external-operation", operationKind: "collect", ownerProcess: "rss_collector", capabilityClass: "external_attempt", policyId: "p-collect-disabled", authorizationHandoffId: handoff.handoffId, controlAction: null,
      identity: { sourceId: "motorsport-f1-news", candidateId: null, publicationId: null, publicId: null }, entitySet: [{ entityKind: "source", entityId: "motorsport-f1-news", identitySelector: "source_id", expectedVersion: null, expectedHash: ZERO }], requiredFenceSet: [],
      expected: { controlVersion: Number(control.version), entityVersion: null, entityHash: ZERO, schemaSha256: SCHEMA_SHA, releaseSha256: ZERO, manifestSha256: ZERO, sourceStopEpoch: 1, writerEpoch: 2, epochs: { sourceConfig: 1, sourceSafety: 1, authorization: 1, policy: 1, recovery: 2 } },
      phase: "disabled", egressClass: "rss_https", budgetRequest: { reservationId: "external-reservation", accountId: "acct", units: 1 }, modelRouteRef: null, requestHash: canonical, requestFingerprint: fingerprint
    }));
    const intent = gateway.commitAttemptIntent(capability, request);
    expect(database.prepare("SELECT state,external_calls FROM internal_external_attempt WHERE attempt_id=?").get(intent.attemptId)).toMatchObject({ state: "intent_committed", external_calls: 0 });
    const started = gateway.markAttemptStarted(intent);
    expect(database.prepare("SELECT state,external_calls FROM internal_external_attempt WHERE attempt_id=?").get(intent.attemptId)).toMatchObject({ state: "started", external_calls: 1 });
    gateway.commitKnownResponse(started, { providerResourceIdentity: "motorsport-f1-news", providerStatus: "200", responseBodySha256: ZERO, responseHeaderHashes: [], outcome: "succeeded", reasonCode: null });
    expect(database.prepare("SELECT state FROM internal_operation WHERE operation_id='external-operation'").get()).toMatchObject({ state: "succeeded" });
    expect(database.prepare("SELECT state FROM internal_external_attempt WHERE attempt_id=?").get(intent.attemptId)).toMatchObject({ state: "response_committed" });
    gateway.close();
  });

  test("response loss enters reconcile_required and permits one same-attempt reconcile", () => {
    const { database, gateway, unknownHandoff } = externalReadyDatabase();
    const control = database.prepare("SELECT * FROM internal_control").get() as Record<string, unknown>;
    const request = {
      schemaVersion: "external-request-v1" as const, method: "GET" as const, endpointClass: "rss_fetch", providerResource: "motorsport-f1-news", routeId: "route-rss",
      externalIdempotencyKey: "ext-0007-unknown", reconcileKey: "reconcile-0007-unknown", headers: [], query: [], bodySha256: null,
      attemptIdentity: { operationId: "unknown-operation", attemptNumber: 1, attemptNonce: "c".repeat(43) },
      entityIdentity: { sourceId: "motorsport-f1-news", candidateId: null, publicationId: null, publicId: null },
      expected: { schemaSha256: SCHEMA_SHA, releaseSha256: ZERO, manifestSha256: ZERO, routeIdentitySha256: ZERO },
      epochs: { sourceConfig: 1, sourceSafety: 1, authorization: 1, policy: 1, recovery: 2, writer: 2 }, fenceSetHash: ZERO
    };
    const canonical = canonicalExternalRequestHash(request);
    const fingerprint = requestFingerprintHash(request);
    const capability = gateway.authorize(gateway.request(unknownHandoff, {
      operationId: "unknown-operation", idempotencyKey: "unknown-operation", operationKind: "collect", ownerProcess: "rss_collector", capabilityClass: "external_attempt", policyId: "p-collect-disabled", authorizationHandoffId: unknownHandoff.handoffId, controlAction: null,
      identity: { sourceId: "motorsport-f1-news", candidateId: null, publicationId: null, publicId: null }, entitySet: [{ entityKind: "source", entityId: "motorsport-f1-news", identitySelector: "source_id", expectedVersion: null, expectedHash: ZERO }], requiredFenceSet: [],
      expected: { controlVersion: Number(control.version), entityVersion: null, entityHash: ZERO, schemaSha256: SCHEMA_SHA, releaseSha256: ZERO, manifestSha256: ZERO, sourceStopEpoch: 1, writerEpoch: 2, epochs: { sourceConfig: 1, sourceSafety: 1, authorization: 1, policy: 1, recovery: 2 } },
      phase: "disabled", egressClass: "rss_https", budgetRequest: { reservationId: "unknown-reservation", accountId: "acct", units: 1 }, modelRouteRef: null, requestHash: canonical, requestFingerprint: fingerprint
    }));
    const started = gateway.markAttemptStarted(gateway.commitAttemptIntent(capability, request));
    const reconcile = gateway.markUnknown(started);
    expect(database.prepare("SELECT state FROM internal_operation WHERE operation_id='unknown-operation'").get()).toMatchObject({ state: "reconcile_required" });
    gateway.consumeOneTimeReconcile(reconcile, { reconcileIdentitySha256: reconcile.reconcileIdentitySha256, outcome: "known_failed" });
    expect(database.prepare("SELECT state FROM internal_operation WHERE operation_id='unknown-operation'").get()).toMatchObject({ state: "terminal_failed" });
    expect(() => gateway.consumeOneTimeReconcile(reconcile, { reconcileIdentitySha256: reconcile.reconcileIdentitySha256, outcome: "known_failed" })).toThrow("RECONCILE_ALREADY_CONSUMED");
    gateway.close();
  });

  test("mutation port rejects a closed egress before adapter entry or attempt persistence", async () => {
    const { database, gateway, handoff } = externalReadyDatabase();
    let adapterCalls = 0;
    const port = new SqliteGatewayMutationPort({
      database,
      gateway,
      ownerProcess: "rss_collector",
      handoffProvider: () => handoff,
    });
    await expect(
      port.runExternal!({
        operationId: "closed-egress-port",
        operationKind: "collect",
        endpointClass: "rss_fetch",
        providerResource: "motorsport-f1-news",
        routeId: "route-rss",
        externalIdempotencyKey: "closed-egress-idempotency",
        reconcileKey: "closed-egress-reconcile",
        identity: {
          sourceId: "motorsport-f1-news",
          candidateId: null,
          publicationId: null,
          publicId: null,
        },
        entityKind: "source",
        entityId: "motorsport-f1-news",
        budgetAccountId: "acct",
        requiredFenceSet: [],
        execute: async () => {
          adapterCalls += 1;
          throw new Error("adapter must not be entered");
        },
      }),
    ).rejects.toThrow("PHASE_DISABLED");
    expect(adapterCalls).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM internal_external_attempt").get()).toMatchObject({ count: 0 });
    expect(database.prepare("SELECT operation_id FROM internal_operation WHERE operation_id=?").get("closed-egress-port")).toBeUndefined();
    gateway.close();
  });

  test("mutation port keeps response loss on one attempt and reconciles that handle", async () => {
    const ready = externalReadyDatabase();
    enterLive(ready.database, ready.gateway, ready.backlogHandoff, ready.liveHandoff);
    let handoffCalls = 0;
    const port = new SqliteGatewayMutationPort({
      database: ready.database,
      gateway: ready.gateway,
      ownerProcess: "rss_collector",
      handoffProvider: () => {
        handoffCalls += 1;
        return handoffCalls === 1 ? ready.handoff : ready.unknownHandoff;
      },
    });
    let adapterCalls = 0;
    await expect(
      port.runExternal!({
        operationId: "same-attempt-unknown",
        operationKind: "collect",
        endpointClass: "rss_fetch",
        providerResource: "motorsport-f1-news",
        routeId: "route-rss",
        externalIdempotencyKey: "same-attempt-idempotency",
        reconcileKey: "same-attempt-reconcile",
        identity: { sourceId: "motorsport-f1-news", candidateId: null, publicationId: null, publicId: null },
        entityKind: "source",
        entityId: "motorsport-f1-news",
        sourceStopEpoch: 1,
        budgetAccountId: "acct",
        requiredFenceSet: [],
        execute: async () => {
          adapterCalls += 1;
          const row = ready.database.prepare("SELECT state,external_calls FROM internal_external_attempt WHERE external_idempotency_key=?").get("same-attempt-idempotency");
          expect(row).toMatchObject({ state: "started", external_calls: 1 });
          throw new Error("lost response");
        },
      }),
    ).rejects.toThrow("lost response");
    expect(adapterCalls).toBe(1);
    expect(ready.database.prepare("SELECT COUNT(*) AS count FROM internal_external_attempt WHERE external_idempotency_key=?").get("same-attempt-idempotency")).toMatchObject({ count: 1 });
    await expect(
      port.runExternal!({
        operationId: "same-attempt-retry",
        operationKind: "collect",
        endpointClass: "rss_fetch",
        providerResource: "motorsport-f1-news",
        routeId: "route-rss",
        externalIdempotencyKey: "same-attempt-idempotency",
        reconcileKey: "same-attempt-reconcile",
        identity: { sourceId: "motorsport-f1-news", candidateId: null, publicationId: null, publicId: null },
        entityKind: "source",
        entityId: "motorsport-f1-news",
        sourceStopEpoch: 1,
        budgetAccountId: "acct",
        requiredFenceSet: [],
        execute: async () => {
          adapterCalls += 1;
          return { value: "unexpected", response: { providerResourceIdentity: "rss", providerStatus: "200", responseBodySha256: ZERO, responseHeaderHashes: [], outcome: "succeeded" as const, reasonCode: null } };
        },
      }),
    ).rejects.toThrow("EXTERNAL_RECONCILE_REQUIRED");
    expect(adapterCalls).toBe(1);
    const reconciled = await port.runReconcile!({
      reconcileKey: "same-attempt-reconcile",
      execute: async () => ({
        value: "reconciled",
        response: { providerResourceIdentity: "rss", providerStatus: "200", responseBodySha256: ZERO, responseHeaderHashes: [], outcome: "succeeded" as const, reasonCode: null },
      }),
    });
    expect(reconciled).toBe("reconciled");
    expect(ready.database.prepare("SELECT state,external_calls FROM internal_external_attempt WHERE external_idempotency_key=?").get("same-attempt-idempotency")).toMatchObject({ state: "response_committed", external_calls: 1 });
    ready.gateway.close();
  });
});

describe("phase and recovery fail-closed views", () => {
  test("uses the four phases, bounded batch and closed egress policy", () => {
    expect(PHASE_BATCH_LIMIT).toBe(20);
    expect(phaseTransitionAllowed("disabled", "enter_backlog")).toBe(true);
    expect(phaseTransitionAllowed("disabled", "enter_live")).toBe(false);
    expect(phaseTransitionAllowed("backlog", "pause")).toBe(true);
    expect(phaseTransitionAllowed("paused", "disable")).toBe(true);
    expect(phaseEgressDecision("disabled", "rss_https").allowed).toBe(false);
    expect(phaseEgressDecision("paused", "model_https").allowed).toBe(false);
    expect(phaseEgressDecision("backlog", "projection_private").allowed).toBe(true);
    expect(phaseEgressDecision("backlog", "rss_https").allowed).toBe(false);
    expect(phaseEgressDecision("live", "model_https").allowed).toBe(true);
  });

  test("rejects missing/failed recovery drill evidence", () => {
    const invalid = { recoveryPointId: "rp", backupSetId: "bs", operationId: "op" } as never;
    expect(() => validateRecoveryPointReceipt(invalid)).toThrow("RECOVERY_HASH_INVALID");
  });
});

describe("release pair", () => {
  test("builds full/fallback pair with a hard-disabled fallback capability set", () => {
    const files = collectReleaseFiles(APP_ROOT, [...new Set([...ADMIN_RELEASE_RUNTIME_FILES, ...PUBLIC_RELEASE_RUNTIME_FILES])]);
    const identity = {
      schemaVersion: 10 as const,
      sourceCommitSha1: "0".repeat(40), sourceTreeSha1: "1".repeat(40),
      schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
      migration0009RawSha256: SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256,
      migration0010RawSha256: SOURCE_REGISTRY_MIGRATION_SHA256,
      adminRuntimeFileCount: 153 as const, adminRuntimePathSetSha256: ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
      publicRuntimeFileCount: 89 as const, publicRuntimePathSetSha256: PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256,
      packageLockSha256: files.find((file) => file.path === "package-lock.json")!.sha256,
      packageRootSha256: "2".repeat(64), pathRootSha256: releasePathRoot(files)
    } as const;
    const sourcePreimageSha256 = releaseSourcePreimageSha256(identity);
    const base = { ...identity, sourcePreimageSha256, files } as const;
    const full: ReleaseCandidateManifest = { ...base, role: "full_v10", releaseId: releaseIdForRole("full_v10", sourcePreimageSha256), capabilities: fullV10Capabilities() };
    const fallback: ReleaseCandidateManifest = { ...base, role: "manual_only_fallback_v10", releaseId: releaseIdForRole("manual_only_fallback_v10", sourcePreimageSha256), capabilities: fallbackV10Capabilities() };
    assertFallbackCapabilities(fallback);
    const receipt = buildReleasePairReceipt(full, fallback, "2026-08-24T00:00:00.000Z");
    expect(receipt.nextPairId).toBeNull();
    expect(receipt.schemaSha256).toBe(SOURCE_REGISTRY_SCHEMA10_SHA256);
    expect(receipt.fullPathRootSha256).toBe(receipt.fallbackPathRootSha256);
    expect(fallback.capabilities.manualSafetyReviewPublishWithdraw).toBe(true);
    expect(fallback.capabilities.publicLkg).toBe(true);
    expect(fallback.capabilities.collectorNetwork).toBe(false);
    expect(fallback.capabilities.modelNetwork).toBe(false);
    expect(fallback.capabilities.retryModelCalls).toBe(false);
  });

  test("rejects path escape, symlink and hardlink candidates", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-0007-path-"));
    try {
      writeFileSync(join(root, "good.txt"), "candidate");
      symlinkSync(join(root, "good.txt"), join(root, "link.txt"));
      linkSync(join(root, "good.txt"), join(root, "hard.txt"));
      expect(() => collectReleaseFiles(root, ["../escape.txt"])).toThrow("RELEASE_PATH_ESCAPE");
      expect(() => collectReleaseFiles(root, ["link.txt"])).toThrow("RELEASE_FILE_NOT_PRIVATE");
      expect(() => collectReleaseFiles(root, ["hard.txt"])).toThrow("RELEASE_FILE_NOT_PRIVATE");
      expect(lstatSync(join(root, "good.txt")).nlink).toBeGreaterThan(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("admitted helper cleans the temporary root when the reopen is rejected", () => {
    const base = realpathSync(tmpdir());
    const before = readdirSync(base).filter((name) => name.startsWith("admitted-review-")).length;
    expect(() => openAdmittedReviewDatabase({
      finalVersion: 8,
      seed: (database: DatabaseSync) => {
        for (const migration of MIGRATIONS) database.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${migration}`, "utf8"));
      }
    })).toThrow();
    const after = readdirSync(base).filter((name) => name.startsWith("admitted-review-")).length;
    expect(after).toBe(before);
  });

  test("outer gateway write is guarded by quiesce-absence admission", () => {
    const operationCount = (database: DatabaseSync): number =>
      Number((database.prepare("SELECT count(*) AS c FROM internal_operation WHERE operation_id='lease-test-op'").get() as Record<string, unknown>).c);

    // Normal: no lease, a fresh outer gateway write commits.
    let env = leasedAdmittedGateway("handoff-lease-normal");
    try {
      env.gateway.request(env.handoff, collectRequest(env.database, env.handoff));
      expect(operationCount(env.database)).toBe(1);
    } finally {
      env.gateway.close();
      env.fixture.close();
    }

    // Race: lease present -> new outer write fails closed with no partial row.
    env = leasedAdmittedGateway("handoff-lease-blocked");
    try {
      writeFileSync(`${env.path}.quiesce`, "x", { mode: 0o600 });
      expect(() => env.gateway.request(env.handoff, collectRequest(env.database, env.handoff))).toThrow(/QUIESCE_LEASE_PRESENT/);
      expect(operationCount(env.database)).toBe(0);
    } finally {
      env.gateway.close();
      env.fixture.close();
    }

    // Recovery: same gateway logic succeeds once the lease is removed.
    env = leasedAdmittedGateway("handoff-lease-recover");
    try {
      writeFileSync(`${env.path}.quiesce`, "x", { mode: 0o600 });
      expect(() => env.gateway.request(env.handoff, collectRequest(env.database, env.handoff))).toThrow(/QUIESCE_LEASE_PRESENT/);
      rmSync(`${env.path}.quiesce`, { force: true });
      env.gateway.request(env.handoff, collectRequest(env.database, env.handoff));
      expect(operationCount(env.database)).toBe(1);
    } finally {
      env.gateway.close();
      env.fixture.close();
    }

    // runAtomicAdmission path is also guarded: callback not run, no write.
    env = leasedAdmittedGateway("handoff-lease-atomic");
    try {
      writeFileSync(`${env.path}.quiesce`, "x", { mode: 0o600 });
      let callbackRuns = 0;
      expect(() => env.gateway.runAtomicAdmission(() => {
        callbackRuns += 1;
        env.gateway.request(env.handoff, collectRequest(env.database, env.handoff));
      })).toThrow(/QUIESCE_LEASE_PRESENT/);
      expect(callbackRuns).toBe(0);
      expect(operationCount(env.database)).toBe(0);
    } finally {
      env.gateway.close();
      env.fixture.close();
    }
  });
});
