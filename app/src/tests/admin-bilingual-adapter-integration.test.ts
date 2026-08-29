import { createHash, generateKeyPairSync } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  realpathSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, test } from "vitest";

import { SqliteInternalOperationGateway, bilingualSafetyResourceHash, type BilingualSafetyDecisionInput, type OwnerProcess, type OwnerSupervisorHandoff } from "../server/internal-operation/gateway.ts";
import { SqliteGatewayMutationPort } from "../server/internal-operation/mutation-port.ts";
import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";
import { BILINGUAL_DRAFT_SCHEMA, BILINGUAL_PROMPT_SCHEMA, assertSourceLineage, canonicalJson, planBilingualRefinement, sha256, type BilingualLineage } from "../server/rss/bilingual-core.ts";
import { SqliteBilingualGatewayMutationPort } from "../server/rss/bilingual-gateway-port.ts";
import { applySourceRegistryMigration, readSourceRegistryMigrationSql, SOURCE_REGISTRY_SCHEMA10_SHA256, type SourceRegistryMigrationManifest } from "../server/rss/source-registry-migration.ts";
import { runBilingualRefinement } from "../server/rss/bilingual-worker.ts";
import { applyXManualInboxMigration } from "../server/tweet-inbox/repository.ts";
import { AdminBilingualRetryAdapter } from "../server/admin-service/bilingual-retry.ts";
import { ADMIN_BILINGUAL_SCHEMA, BilingualAdminRepository, BilingualAdminRoutes, prepareBilingualMutation, type BilingualManualMutationPort } from "../server/admin-service/bilingual-admin.ts";
import { ReviewAdminSecurity } from "../server/review-real/security.ts";
import type { RawAdminContext } from "../server/source-management/security.ts";
import { canonicalJson as profileCanonicalJson } from "../server/db/profile.ts";
import { AdminBilingualProjectionWriter, bilingualPublicationId } from "../server/admin-service/bilingual-projection-writer.ts";
import { AdminBilingualProjectionExporter, AdminBilingualPublicationService } from "../server/admin-service/bilingual-projection-exporter.ts";
import { readPublicBilingualSnapshot } from "../server/public/bilingual-snapshot.ts";
import { openAdmittedReviewFixture, disposeAdmittedReviewDatabases } from "./helpers/admitted-review-database.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");
const ZERO = "0".repeat(64);
const START = Date.parse("2026-08-25T00:00:01.000Z");

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function adminContext(input: Readonly<{ path: string; cookie: string; csrf?: string; idempotencyKey?: string; origin?: string }>): RawAdminContext {
  const origin = input.origin ?? "https://f1-admin.example.ts.net";
  const rawHeaders = new Map<string, readonly string[]>([["origin", [origin]], ["sec-fetch-site", ["same-origin"]], ["cookie", [input.cookie]]]);
  if (input.csrf) rawHeaders.set("x-csrf-token", [input.csrf]);
  if (input.idempotencyKey) rawHeaders.set("idempotency-key", [input.idempotencyKey]);
  return Object.freeze({ method: "POST", path: input.path, authority: "f1-admin.example.ts.net", origin, peer: "loopback", rawHeaders, noEgressReady: true });
}

function manifest(): SourceRegistryMigrationManifest {
  const common = { scheduleSeconds: 900, routeIdentitySha256: "1".repeat(64), routeReleaseSha256: "2".repeat(64), routeManifestSha256: "3".repeat(64), rightsStatus: "clear" as const, mediaPolicy: "allowlisted" as const, authorizationExpiresAt: "2027-08-25T00:00:00.000Z", authorizationReceiptSha256: "4".repeat(64), sourcePolicySha256: "5".repeat(64) };
  return Object.freeze({ schemaVersion: "source-registry-migration-manifest-v1", migratedAt: "2026-08-25T00:00:00.000Z", rss: Object.freeze([
    { ...common, sourceId: "motorsport-f1-news", displayName: "Motorsport.com", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
    { ...common, sourceId: "autosport-f1-news", displayName: "Autosport", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
    { ...common, sourceId: "racefans-f1-news", displayName: "RaceFans", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
    { ...common, sourceId: "the-race-f1-news", displayName: "The Race", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" }
  ]) });
}

function handoff(id: string, ownerProcess: OwnerProcess, marker: string): OwnerSupervisorHandoff {
  return Object.freeze({ handoffId: id, ownerProcess, issuer: "f1plus1-owner-supervisor-v1", oneTimeNonce: marker.repeat(43), releaseSha256: ZERO, manifestSha256: ZERO, receiptSha256: hash(`receipt-${id}`), verifiedAt: "2026-08-25T00:00:00.000Z", expiresAt: "2099-08-26T00:00:00.000Z" });
}

function persistHandoffs(db: DatabaseSync, values: readonly OwnerSupervisorHandoff[]): void {
  for (const item of values) db.prepare("INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(item.handoffId, item.ownerProcess, item.issuer, item.oneTimeNonce, item.releaseSha256, item.manifestSha256, item.receiptSha256, item.verifiedAt, item.expiresAt);
}

function controlMutation(db: DatabaseSync, gateway: SqliteInternalOperationGateway, item: OwnerSupervisorHandoff, operationId: string, policyId: string, operationKind: "phase_control" | "restore", capabilityClass: "control" | "restore", controlAction: "fence_update" | "recovery_advance" | "writer_epoch_bump" | "recovery_complete" | "clear_global_stop" | "enter_backlog" | "enter_live", statement: string): void {
  const control = db.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>;
  const requested = gateway.request(item, {
    schemaVersion: "operation-request-v1", operationId, idempotencyKey: operationId, operationKind, ownerProcess: item.ownerProcess, capabilityClass, policyId, authorizationHandoffId: item.handoffId, controlAction,
    identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null }, entitySet: [{ entityKind: "internal_control", entityId: "1", identitySelector: "control_singleton", expectedVersion: null, expectedHash: ZERO }], requiredFenceSet: [],
    expected: { controlVersion: Number(control.version), entityVersion: null, entityHash: ZERO, schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256, releaseSha256: ZERO, manifestSha256: ZERO, sourceStopEpoch: null, writerEpoch: Number(control.writer_epoch), epochs: { sourceConfig: Number(control.source_config_epoch), sourceSafety: Number(control.source_safety_epoch), authorization: Number(control.authorization_version), policy: Number(control.policy_epoch), recovery: Number(control.recovery_epoch) } },
    phase: String(control.phase) as "disabled" | "backlog" | "paused", egressClass: "none", budgetRequest: null, modelRouteRef: null, requestHash: hash(`request-${operationId}`), requestFingerprint: hash(`fingerprint-${operationId}`)
  });
  const authorized = gateway.authorize(requested);
  const permit = gateway.authorizeWrite(authorized, { entityKind: "internal_control", entityId: "1", mutationKind: "update", expectedVersion: null, expectedHash: ZERO });
  gateway.mutate(permit, { entityKind: "internal_control", entityId: "1", mutationKind: "update", statement });
  gateway.postcheckFenceSet(authorized);
}

function issueFence(db: DatabaseSync, gateway: SqliteInternalOperationGateway, item: OwnerSupervisorHandoff, scopeKind: "source" | "candidate" | "publication", scopeId: string, fenceKind: "deletion" | "rights" | "media" | "publication" | "completeness"): void {
  const control = db.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>;
  const receiptId = `fence-${scopeId}-${fenceKind}`;
  const operationId = `issue-${scopeId}-${fenceKind}`;
  const receiptHash = hash(`receipt-${scopeId}-${fenceKind}`);
  const requested = gateway.request(item, {
    schemaVersion: "operation-request-v1", operationId, idempotencyKey: operationId, operationKind: "system_producer", ownerProcess: "system_supervisor", capabilityClass: "control", policyId: "p-supervisor-fence-disabled", authorizationHandoffId: item.handoffId, controlAction: "fence_update",
    identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null }, entitySet: [{ entityKind: "generic_fence", entityId: receiptId, identitySelector: "bound_child", expectedVersion: null, expectedHash: ZERO }], requiredFenceSet: [],
    expected: { controlVersion: Number(control.version), entityVersion: null, entityHash: ZERO, schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256, releaseSha256: ZERO, manifestSha256: ZERO, sourceStopEpoch: null, writerEpoch: Number(control.writer_epoch), epochs: { sourceConfig: Number(control.source_config_epoch), sourceSafety: Number(control.source_safety_epoch), authorization: Number(control.authorization_version), policy: Number(control.policy_epoch), recovery: Number(control.recovery_epoch) } },
    phase: "disabled", egressClass: "none", budgetRequest: null, modelRouteRef: null, requestHash: hash(`request-${operationId}`), requestFingerprint: hash(`fingerprint-${operationId}`)
  });
  const authorized = gateway.authorize(requested);
  const permit = gateway.authorizeWrite(authorized, { entityKind: "generic_fence", entityId: receiptId, mutationKind: "insert", expectedVersion: null, expectedHash: ZERO });
  gateway.mutate(permit, { entityKind: "generic_fence", entityId: receiptId, mutationKind: "insert", statement: "INSERT INTO generic_fence_receipt VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", parameters: [receiptId, scopeKind, scopeId, fenceKind, "clear", "READY", "f1plus1-system-supervisor-v1", operationId, hash(`${scopeId}-${fenceKind}`).slice(0, 43), receiptHash, Number(control.policy_epoch), Number(control.recovery_epoch), Number(control.writer_epoch), "2026-08-25T00:00:20.000Z", "2099-08-26T00:00:00.000Z"] });
  gateway.postcheckFenceSet(authorized);
}

describe("schema10 bilingual concrete gateway adapter integration", () => {
  afterEach(() => disposeAdmittedReviewDatabases());

  test("materializes two known fixture responses after authority-bound admission and keeps unsafe review/publish at zero", async () => {
    const adminAuto = handoff("handoff-adapter-auto", "admin_http", "a");
    const adminManual = handoff("handoff-adapter-manual", "admin_http", "b");
    const controls = [
      handoff("handoff-adapter-clear-deletion", "admin_http", "n"), handoff("handoff-adapter-clear-publication", "admin_http", "o"),
      handoff("handoff-adapter-restore-1", "restore_operator", "c"), handoff("handoff-adapter-restore-2", "restore_operator", "d"),
      handoff("handoff-adapter-supervisor-1", "system_supervisor", "e"), handoff("handoff-adapter-supervisor-2", "system_supervisor", "f"),
      handoff("handoff-adapter-clear", "admin_http", "g"), handoff("handoff-adapter-backlog", "admin_http", "h"), handoff("handoff-adapter-live", "admin_http", "m")
    ] as const;
    const fenceHandoffs = [
      handoff("handoff-adapter-fence-e2e-publication", "system_supervisor", "i"), handoff("handoff-adapter-fence-e2e-completeness", "system_supervisor", "j"),
      handoff("handoff-adapter-fence-fail-publication", "system_supervisor", "t"), handoff("handoff-adapter-fence-fail-completeness", "system_supervisor", "u"),
      handoff("handoff-adapter-fence-fault-publication", "system_supervisor", "v"), handoff("handoff-adapter-fence-fault-completeness", "system_supervisor", "w")
    ] as const;
    const sourceFenceHandoffs = [
      handoff("handoff-adapter-source-deletion", "system_supervisor", "1"),
      handoff("handoff-adapter-source-rights", "system_supervisor", "2"),
      handoff("handoff-adapter-source-media", "system_supervisor", "3")
    ] as const;
    const publicationFenceHandoffs = [
      handoff("handoff-adapter-publication-deletion", "system_supervisor", "F"),
      handoff("handoff-adapter-publication-rights", "system_supervisor", "G"),
      handoff("handoff-adapter-publication-media", "system_supervisor", "H"),
      handoff("handoff-adapter-publication-publication", "system_supervisor", "I"),
      handoff("handoff-adapter-publication-completeness", "system_supervisor", "J")
    ] as const;
    const modelHandoffs = [
      handoff("handoff-adapter-model-zh-1", "bilingual_refiner", "k"), handoff("handoff-adapter-model-en-1", "bilingual_refiner", "l"),
      handoff("handoff-adapter-model-zh-2", "bilingual_refiner", "p"), handoff("handoff-adapter-model-en-2", "bilingual_refiner", "q"),
      handoff("handoff-adapter-model-zh-3", "bilingual_refiner", "r"), handoff("handoff-adapter-model-en-3", "bilingual_refiner", "s"),
      handoff("handoff-adapter-model-en-retry", "bilingual_refiner", "8"), handoff("handoff-adapter-model-zh-rerun", "bilingual_refiner", "9")
      , handoff("handoff-adapter-model-en-direct", "bilingual_refiner", "A"), handoff("handoff-adapter-model-zh-direct", "bilingual_refiner", "B")
    ] as const;
    const safetyHandoffs = [
      handoff("handoff-adapter-safety-clear", "admin_http", "x"), handoff("handoff-adapter-safety-block", "admin_http", "y"),
      handoff("handoff-adapter-safety-reuse", "admin_http", "4"), handoff("handoff-adapter-safety-stale", "admin_http", "5"),
      handoff("handoff-adapter-safety-cas-a", "admin_http", "6"), handoff("handoff-adapter-safety-cas-b", "admin_http", "7")
    ] as const;
    const approvalHandoff = handoff("handoff-adapter-approval", "admin_http", "z");
    const publicationHandoffs = [handoff("handoff-adapter-publish", "admin_http", "C"), handoff("handoff-adapter-activate", "admin_http", "D"), handoff("handoff-adapter-withdraw", "admin_http", "E")] as const;
    const fixture = openAdmittedReviewFixture({
      finalVersion: 10,
      seed: (seedDb: DatabaseSync) => {
        for (const file of ["0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql", "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"]) {
          seedDb.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${file}`, "utf8"));
        }
        const insertCandidate = seedDb.prepare(`INSERT INTO pending_review_candidate(candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,first_seen_at,last_seen_at)
          VALUES(?,'motorsport-f1-news',?,?,?,?, 'Private factual excerpt','Source author','2026-08-25T00:00:00.000Z',?,1,'2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z')`);
        for (const suffix of ["e2e", "known-fail", "materialization-fault", "graph"]) insertCandidate.run(`candidate-adapter-${suffix}`, `external-adapter-${suffix}`, hash(`dedupe-${suffix}`), `https://www.motorsport.com/f1/news/adapter-${suffix}/`, "Source title", "8".repeat(64));
        applyInternalOperationMigration(seedDb, readFileSync(`${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8"));
        applyXManualInboxMigration(seedDb, readFileSync(`${APP_ROOT}/migrations/rss-real/0008_x_manual_inbox.sql`, "utf8"));
        applyBilingualMigration(seedDb, readBilingualMigrationSql(), { applyEnabled: true });
        applySourceRegistryMigration(seedDb, readSourceRegistryMigrationSql(), manifest(), { applyEnabled: true });
        seedDb.prepare("INSERT INTO route_registry VALUES(?,?,?,?,?,?,?,?,?)").run("model-bilingual-fixture", "model", "model_https", "model_refine", "a".repeat(64), ZERO, ZERO, "active", 1);
        seedDb.prepare("INSERT INTO budget_account VALUES(?,?,?,?,?,?)").run("budget-bilingual-fixture", "model_tokens", 100, 0, 0, 1);
        persistHandoffs(seedDb, [adminAuto, adminManual, ...controls, ...fenceHandoffs, ...sourceFenceHandoffs, ...publicationFenceHandoffs, ...modelHandoffs, ...safetyHandoffs, approvalHandoff, ...publicationHandoffs]);
      }
    });
    const db = fixture.database;
    const databasePath = fixture.path;
    let tick = 0;
    const gateway = new SqliteInternalOperationGateway({ database: db, releaseSha256: ZERO, manifestSha256: ZERO, schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256, now: () => new Date(START + tick++ * 1_000) });
    const autoReceipt = "1".repeat(64);
    gateway.transitionQuickLaunchAuthority(adminAuto, { operationId: "activate-adapter-auto", idempotencyKey: "activate-adapter-auto", capabilityId: "bilingual_auto_refine", action: "enable", expectedVersion: 1, requestHash: hash("activate-auto"), authorityReceiptSha256: autoReceipt });
    gateway.transitionQuickLaunchAuthority(adminManual, { operationId: "activate-adapter-manual", idempotencyKey: "activate-adapter-manual", capabilityId: "bilingual_manual_mutation", action: "enable", expectedVersion: 1, requestHash: hash("activate-manual"), authorityReceiptSha256: "2".repeat(64) });
    controlMutation(db, gateway, controls[0], "adapter-clear-deletion", "p-phase-control-disabled", "phase_control", "control", "fence_update", "UPDATE internal_control SET deletion_fence_state='clear',version=version+1,updated_by_operation_id='adapter-clear-deletion' WHERE singleton_id=1");
    controlMutation(db, gateway, controls[1], "adapter-clear-publication", "p-phase-control-disabled", "phase_control", "control", "fence_update", "UPDATE internal_control SET publication_fence_state='clear',version=version+1,updated_by_operation_id='adapter-clear-publication' WHERE singleton_id=1");
    controlMutation(db, gateway, controls[2], "adapter-restore-1", "p-restore-control-disabled", "restore", "restore", "recovery_advance", "UPDATE internal_control SET recovery_state='restoring',version=version+1,updated_by_operation_id='adapter-restore-1' WHERE singleton_id=1");
    controlMutation(db, gateway, controls[3], "adapter-restore-2", "p-restore-control-disabled", "restore", "restore", "recovery_advance", "UPDATE internal_control SET recovery_state='verifying',version=version+1,updated_by_operation_id='adapter-restore-2' WHERE singleton_id=1");
    controlMutation(db, gateway, controls[4], "adapter-supervisor-1", "p-supervisor-restore-disabled", "restore", "restore", "writer_epoch_bump", `UPDATE internal_control SET recovery_epoch=recovery_epoch+1,writer_epoch=writer_epoch+1,writer_authority_receipt_sha256='${"9".repeat(64)}',version=version+1,updated_by_operation_id='adapter-supervisor-1' WHERE singleton_id=1`);
    controlMutation(db, gateway, controls[5], "adapter-supervisor-2", "p-supervisor-restore-disabled", "restore", "restore", "recovery_complete", "UPDATE internal_control SET recovery_state='ready',version=version+1,updated_by_operation_id='adapter-supervisor-2' WHERE singleton_id=1");
    controlMutation(db, gateway, controls[6], "adapter-clear", "p-phase-control-disabled", "phase_control", "control", "clear_global_stop", "UPDATE internal_control SET global_stop_state='clear',version=version+1,updated_by_operation_id='adapter-clear' WHERE singleton_id=1");
    for (const [index, candidateId] of ["candidate-adapter-e2e", "candidate-adapter-known-fail", "candidate-adapter-materialization-fault"].entries()) {
      issueFence(db, gateway, fenceHandoffs[index * 2]!, "candidate", candidateId, "publication");
      issueFence(db, gateway, fenceHandoffs[index * 2 + 1]!, "candidate", candidateId, "completeness");
    }
    issueFence(db, gateway, sourceFenceHandoffs[0], "source", "motorsport-f1-news", "deletion");
    issueFence(db, gateway, sourceFenceHandoffs[1], "source", "motorsport-f1-news", "rights");
    issueFence(db, gateway, sourceFenceHandoffs[2], "source", "motorsport-f1-news", "media");
    const initialPublicationId = bilingualPublicationId("public-adapter-e2e", 1);
    for (const [index, fenceKind] of ["deletion", "rights", "media", "publication", "completeness"].entries()) {
      issueFence(db, gateway, publicationFenceHandoffs[index]!, "publication", initialPublicationId, fenceKind as "deletion" | "rights" | "media" | "publication" | "completeness");
    }
    controlMutation(db, gateway, controls[7], "adapter-backlog", "p-phase-control-disabled", "phase_control", "control", "enter_backlog", "UPDATE internal_control SET phase='backlog',version=version+1,updated_by_operation_id='adapter-backlog' WHERE singleton_id=1");
    controlMutation(db, gateway, controls[8], "adapter-live", "p-phase-control-backlog", "phase_control", "control", "enter_live", "UPDATE internal_control SET phase='live',version=version+1,updated_by_operation_id='adapter-live' WHERE singleton_id=1");

    const makeLineage = (suffix: string) => assertSourceLineage({ candidateId: `candidate-adapter-${suffix}`, publicId: `public-adapter-${suffix}`, sourceId: "motorsport-f1-news", sourceRevision: 1, inputContentHash: "8".repeat(64), sourceFactSetHash: "3".repeat(64), sourceReleaseHash: "4".repeat(64), canonicalUrl: `https://www.motorsport.com/f1/news/adapter-${suffix}/`, sourceTitle: "Source title", sourceAuthor: "Source author", sourcePublishedAt: "2026-08-25T00:00:00.000Z", sourceExcerpt: "Private factual excerpt" });
    const lineage = Object.freeze({
      ...makeLineage("e2e"),
      copyRiskStatus: "screen_passed" as const,
      rightsStatus: "clear" as const,
      deletionStatus: "clear" as const,
      mediaStatus: "allowed" as const
    });
    expect(db.prepare("SELECT enabled,stop_epoch FROM source WHERE source_id='motorsport-f1-news'").get()).toEqual({ enabled: 1, stop_epoch: 1 });
    const handoffQueue = [...modelHandoffs];
    let materializationFaultLanguage: "zh-CN" | "en" | null = null;
    let promptOnlyDriftRejected = false;
    const port = new SqliteBilingualGatewayMutationPort({
      database: db,
      gateway,
      activation: { operationId: "activate-adapter-auto", receiptSha256: autoReceipt },
      handoffProvider: () => handoffQueue.shift()!,
      materializationFailureInjector: (_stage, language) => {
        if (!promptOnlyDriftRejected && language === "zh-CN") {
          const fixture = db.prepare(`SELECT slot.slot_id,slot.candidate_id,slot.operation_id,link.parent_operation_id,
              link.attempt_number,attempt.attempt_id,attempt.state AS attempt_state,attempt.route_id,
              attempt.canonical_request_hash,attempt.response_hash,attempt.external_calls,
              op.budget_reservation_id,op.expected_release_sha256,op.expected_manifest_sha256
            FROM bilingual_language_slot_v1 slot
            JOIN bilingual_operation_link_v1 link ON link.operation_id=slot.operation_id
              AND link.candidate_id=slot.candidate_id AND link.language=slot.language
              AND link.semantic_action IN ('refine_language','retry_language','rerun_language')
            JOIN internal_operation op ON op.operation_id=slot.operation_id
            JOIN internal_external_attempt attempt ON attempt.operation_id=op.operation_id
              AND attempt.attempt_number=link.attempt_number
            WHERE slot.candidate_id='candidate-adapter-e2e' AND slot.language='zh-CN'`).get() as Record<string, unknown>;
          try {
            db.prepare("INSERT INTO bilingual_model_receipt_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
              `prompt-drift-${String(fixture.attempt_id)}`, String(fixture.attempt_id), String(fixture.operation_id),
              fixture.parent_operation_id === null ? null : String(fixture.parent_operation_id), String(fixture.slot_id), String(fixture.candidate_id), "zh-CN", Number(fixture.attempt_number),
              String(fixture.attempt_state), String(fixture.route_id), BILINGUAL_PROMPT_SCHEMA, "6".repeat(64),
              "{}", hash("prompt-drift-route"), String(fixture.budget_reservation_id), "{}", hash("prompt-drift-budget"),
              String(fixture.expected_release_sha256), String(fixture.expected_manifest_sha256), String(fixture.canonical_request_hash),
              fixture.response_hash === null ? null : String(fixture.response_hash), Number(fixture.external_calls), null, "2026-08-25T00:01:01.000Z"
            );
            throw new Error("PROMPT_ONLY_DRIFT_UNEXPECTEDLY_ACCEPTED");
          } catch (error) {
            if (error instanceof Error && error.message === "PROMPT_ONLY_DRIFT_UNEXPECTEDLY_ACCEPTED") throw error;
            promptOnlyDriftRejected = error instanceof Error && error.message.includes("BILINGUAL_AUTHORITY_EXTENSION_REQUIRED");
          }
        }
        if (language === materializationFaultLanguage) throw new Error("INJECTED_MATERIALIZATION_FAULT");
      }
    });
    let externalCalls = 0;
    let mode: "success" | "known_fail_unknown" = "success";
    const run = (targetLineage: BilingualLineage = lineage) => runBilingualRefinement({ lineage: targetLineage, promptSha256: "5".repeat(64), now: "2026-08-25T00:01:00.000Z", mutationPort: port, gateway: {
      plan(input, operationId, parentOperationId, attemptNumber) {
        const child = planBilingualRefinement(input.candidateId, 1, targetLineage.inputContentHash, attemptNumber).children.find((entry) => entry.language === input.language)!;
        return { operationId, parentOperationId, idempotencyKey: child.idempotencyKey, candidateId: input.candidateId, language: input.language, attemptNumber, route: { routeRef: "model-bilingual-fixture", providerId: "fixture-provider", modelId: "fixture-model", routeIdentitySha256: "a".repeat(64), releaseSha256: ZERO, manifestSha256: ZERO }, budget: { accountId: "budget-bilingual-fixture", reservationId: `reservation-${input.candidateId}-${input.language}`, units: 5, currency: "USD" }, external: { method: "POST", endpointClass: "model_refine", providerResource: `fixture-model-${input.language}`, externalIdempotencyKey: `external-${input.candidateId}-${input.language}`, reconcileKey: `reconcile-${input.candidateId}-${input.language}`, headers: [], query: [], bodySha256: hash(`body-${input.candidateId}-${input.language}`) } };
      },
      async execute(plan) {
        externalCalls += 1;
        if (mode === "known_fail_unknown" && plan.language === "en") throw new Error("FIXTURE_EXTERNAL_UNKNOWN");
        if (mode === "known_fail_unknown") return { rawJson: null, route: { routeRef: plan.route.routeRef, providerId: plan.route.providerId, modelId: plan.route.modelId, promptSchemaVersion: BILINGUAL_PROMPT_SCHEMA, promptSha256: "5".repeat(64), receiptHash: hash(`route-${plan.attemptNumber}-${plan.language}`), releaseSha256: ZERO, manifestSha256: ZERO }, budget: { reservationId: plan.budget.reservationId, units: plan.budget.units, currency: plan.budget.currency, receiptHash: hash(`budget-${plan.attemptNumber}-${plan.language}`) }, externalCalls: 1, response: { providerResourceIdentity: plan.external.providerResource, providerStatus: "422", responseBodySha256: hash(`known-fail-${plan.attemptNumber}-${plan.language}`), responseHeaderHashes: [], outcome: "known_failed", reasonCode: "FIXTURE_KNOWN_FAILED" } } as const;
        const content = { language: plan.language, title: `${plan.language === "zh-CN" ? "中文标题" : "English title"} ${plan.candidateId}`, summary: plan.language === "zh-CN" ? "中文摘要" : "English summary", lead: plan.language === "zh-CN" ? "中文导语" : "English lead", body: [plan.language === "zh-CN" ? "中文正文" : "English body"], keyPoints: [plan.language === "zh-CN" ? "中文要点" : "English point"] };
        const rawJson = canonicalJson({ schemaVersion: BILINGUAL_DRAFT_SCHEMA, ...content, contentHash: sha256(canonicalJson(content)) });
        return { rawJson, route: { routeRef: plan.route.routeRef, providerId: plan.route.providerId, modelId: plan.route.modelId, promptSchemaVersion: BILINGUAL_PROMPT_SCHEMA, promptSha256: "5".repeat(64), receiptHash: hash(`route-${plan.attemptNumber}-${plan.language}`), releaseSha256: ZERO, manifestSha256: ZERO }, budget: { reservationId: plan.budget.reservationId, units: plan.budget.units, currency: plan.budget.currency, receiptHash: hash(`budget-${plan.attemptNumber}-${plan.language}`) }, externalCalls: 1, response: { providerResourceIdentity: plan.external.providerResource, providerStatus: "200", responseBodySha256: sha256(rawJson), responseHeaderHashes: [], outcome: "succeeded", reasonCode: null } } as const;
      }
    } });

    const [result, concurrentDuplicate] = await Promise.all([run(), run()]);
    expect(result).toMatchObject({ status: "complete", externalCalls: 2, writesToBase: true });
    expect(concurrentDuplicate).toEqual(result);
    expect(promptOnlyDriftRejected).toBe(true);
    expect(externalCalls).toBe(2);
    expect(db.prepare("SELECT count(*) AS count FROM internal_operation WHERE owner_process='bilingual_refiner' AND state='succeeded'").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT count(*) AS count FROM internal_external_attempt WHERE state='response_committed' AND outcome='succeeded'").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_model_receipt_v1 WHERE attempt_state='response_committed'").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_language_slot_v1 WHERE state='complete'").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT copy_risk_status,rights_status,deletion_status,media_status FROM bilingual_candidate_lineage_v1 WHERE candidate_id='candidate-adapter-e2e'").get()).toEqual({ copy_risk_status: "unknown", rights_status: "unknown", deletion_status: "unknown", media_status: "unknown" });
    expect(db.prepare("SELECT count(*) AS count FROM operation_entity_binding WHERE entity_kind='source' AND entity_id='motorsport-f1-news'").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT count(*) AS count FROM internal_external_attempt WHERE json_extract(canonical_request_json,'$.sourceAuthority.sourceRegistryRevision')=1").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_bundle_v1 WHERE state='reviewable'").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_approval_v1").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_publication_v1").get()).toEqual({ count: 0 });

    const safetyOperation = (operationId: string, item: OwnerSupervisorHandoff, requestHash: string) => {
      const control = db.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>;
      const source = db.prepare("SELECT revision,identity_sha256 FROM source_registry_v1 WHERE source_id='motorsport-f1-news'").get() as Record<string, unknown>;
      const requiredFenceSet = (db.prepare("SELECT fence_receipt_id,receipt_sha256,scope_kind,scope_id,fence_kind FROM generic_fence_receipt WHERE (scope_kind='candidate' AND scope_id='candidate-adapter-e2e' AND fence_kind IN ('publication','completeness')) OR (scope_kind='source' AND scope_id='motorsport-f1-news' AND fence_kind IN ('deletion','rights','media')) ORDER BY scope_kind,fence_kind").all() as Array<Record<string, unknown>>).map((fence) => ({ fenceReceiptId: String(fence.fence_receipt_id), receiptSha256: String(fence.receipt_sha256), scopeKind: String(fence.scope_kind) as "source" | "candidate", scopeId: String(fence.scope_id), fenceKind: String(fence.fence_kind) as "deletion" | "rights" | "media" | "publication" | "completeness", requiredState: "clear" as const }));
      const requested = gateway.request(item, {
        schemaVersion: "operation-request-v1", operationId, idempotencyKey: operationId, operationKind: "review", ownerProcess: "admin_http", capabilityClass: "db_mutation", policyId: "p-review-admin-live", authorizationHandoffId: item.handoffId, controlAction: null,
        identity: { sourceId: "motorsport-f1-news", candidateId: "candidate-adapter-e2e", publicationId: null, publicId: null },
        entitySet: [
          { entityKind: "source", entityId: "motorsport-f1-news", identitySelector: "source_id", expectedVersion: Number(source.revision), expectedHash: String(source.identity_sha256) },
          { entityKind: "candidate", entityId: "candidate-adapter-e2e", identitySelector: "candidate_id", expectedVersion: 1, expectedHash: "8".repeat(64) },
        ], requiredFenceSet,
        expected: { controlVersion: Number(control.version), entityVersion: 1, entityHash: "8".repeat(64), schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256, releaseSha256: ZERO, manifestSha256: ZERO, sourceStopEpoch: 1, writerEpoch: Number(control.writer_epoch), epochs: { sourceConfig: Number(control.source_config_epoch), sourceSafety: Number(control.source_safety_epoch), authorization: Number(control.authorization_version), policy: Number(control.policy_epoch), recovery: Number(control.recovery_epoch) } },
        phase: "live", egressClass: "none", budgetRequest: null, modelRouteRef: null, requestHash, requestFingerprint: hash(`fingerprint-${operationId}`)
      });
      return gateway.authorize(requested);
    };
    const clearInput: BilingualSafetyDecisionInput = { candidateId: "candidate-adapter-e2e", sourceId: "motorsport-f1-news", sourceRevision: 1, inputContentHash: "8".repeat(64), action: "clear", mediaClearance: "allowed", expiresAt: "2026-08-25T01:00:00.000Z", expectedDecisionSeq: 1, supersedesDecisionId: null };
    const clearResourceHash = bilingualSafetyResourceHash(clearInput);
    const clearRequestHash = hash("safety-clear-request");
    const clearAuthorization = { actorRef: "operator-local", sessionDigest: hash("session-clear"), csrfDigest: hash("csrf-clear"), freshDigest: hash("fresh-clear"), verifiedAt: "2026-08-25T00:00:20.000Z", freshAction: "BILINGUAL_SAFETY_DECISION" as const, resourceHash: clearResourceHash, operationId: "adapter-safety-clear", bodyHash: clearRequestHash };
    const adminMutationPort = new SqliteGatewayMutationPort({ database: db, gateway, ownerProcess: "admin_http", handoffProvider: () => safetyHandoffs[0] });
    const clearReceipt = adminMutationPort.commitBilingualSafetyDecision(clearAuthorization, clearInput);
    expect(db.prepare("SELECT entity_kind,entity_id,expected_entity_version,expected_entity_hash FROM operation_entity_binding WHERE operation_id='adapter-safety-clear' ORDER BY entity_kind").all()).toEqual([
      { entity_kind: "candidate", entity_id: "candidate-adapter-e2e", expected_entity_version: 1, expected_entity_hash: "8".repeat(64) },
      { entity_kind: "source", entity_id: "motorsport-f1-news", expected_entity_version: 1, expected_entity_hash: expect.stringMatching(/^[0-9a-f]{64}$/u) }
    ]);
    expect(db.prepare("SELECT copy_risk_status,rights_status,deletion_status,media_status FROM bilingual_candidate_lineage_v1 WHERE candidate_id='candidate-adapter-e2e'").get()).toEqual({ copy_risk_status: "screen_passed", rights_status: "clear", deletion_status: "clear", media_status: "allowed" });
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_lineage_effective_safety_v1 WHERE candidate_id='candidate-adapter-e2e' AND action='clear'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT count(*) AS count FROM gateway_write_permit WHERE operation_id='adapter-safety-clear' AND consumed_at IS NOT NULL").get()).toEqual({ count: 1 });
    const reviewable = port.materializeReviewableBundleAfterSafetyDecision(clearReceipt);
    expect(port.materializeReviewableBundleAfterSafetyDecision(clearReceipt)).toEqual(reviewable);
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_bundle_v1 WHERE state='reviewable' AND json_extract(payload_json,'$.safetyAuthority.decisionId')=?").get(clearReceipt.decisionId)).toEqual({ count: 1 });
    const approvalPort = new SqliteGatewayMutationPort({ database: db, gateway, ownerProcess: "admin_http", handoffProvider: () => approvalHandoff });
    const approvalBodyHash = hash("approval-http-body");
    const approval = approvalPort.commitBilingualApproval({ actorRef: "operator-local", sessionDigest: hash("approval-session"), csrfDigest: hash("approval-csrf"), operationId: "adapter-approval", bodyHash: approvalBodyHash }, { candidateId: "candidate-adapter-e2e", expectedBundleRevision: reviewable.revision, decision: "approved" });
    expect(approval).toMatchObject({ bundleId: reviewable.bundleId, bundleHash: reviewable.bundleHash, decision: "approved", operationId: "adapter-approval" });
    expect(db.prepare("SELECT decision,actor_ref FROM bilingual_approval_v1 WHERE approval_id=?").get(approval.approvalId)).toEqual({ decision: "approved", actor_ref: "operator-local" });
    expect(db.prepare("SELECT count(*) AS count FROM internal_external_attempt WHERE operation_id='adapter-approval'").get()).toEqual({ count: 0 });

    const publicationQueue = [...publicationHandoffs];
    const publicationMutationPort = new SqliteGatewayMutationPort({ database: db, gateway, ownerProcess: "admin_http", handoffProvider: () => publicationQueue.shift()! });
    const projectionRoot = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-bilingual-projection-e2e-"));
    const signing = generateKeyPairSync("ed25519");
    const projectionWriter = new AdminBilingualProjectionWriter(db, publicationMutationPort, () => new Date(START + 180_000));
    const projectionExporter = new AdminBilingualProjectionExporter(db, projectionRoot, "synthetic-ed25519", signing.privateKey);
    const publicationService = new AdminBilingualPublicationService(db, projectionWriter, projectionExporter, ZERO, ZERO, () => new Date(START + 180_000));
    const publicationSecurityNow = START + 1_000;
    const publicationSecurity = new ReviewAdminSecurity({ canonicalOrigin: "https://f1-admin.example.ts.net", sessionHashKey: Buffer.alloc(32, 3), now: () => publicationSecurityNow, readRecoveryFence: () => ({ clockTrusted: true, writerReady: true, lastSuccessfulRecoveryPointAt: publicationSecurityNow - 1_000 }) });
    const publicationSession = publicationSecurity.acceptVerifiedSession({ operatorRef: "operator-local", deviceRef: "device-publication", tailnetUserRef: "tailnet-publication" });
    let failWithdrawalExport = true;
    const withdrawalExporter = new AdminBilingualProjectionExporter(db, projectionRoot, "synthetic-ed25519", signing.privateKey, (stage) => { if (stage === "after_generation" && failWithdrawalExport) { failWithdrawalExport = false; throw new Error("INJECTED_EXPORT_FAILURE"); } });
    const withdrawalService = new AdminBilingualPublicationService(db, projectionWriter, withdrawalExporter, ZERO, ZERO, () => new Date(START + 190_000));
    const publicationManualPort: BilingualManualMutationPort = {
      commitApproval: () => { throw new Error("UNEXPECTED_APPROVAL"); }, commitSafetyDecision: () => { throw new Error("UNEXPECTED_SAFETY"); },
      publish: publicationService.publish.bind(publicationService), withdraw: withdrawalService.withdraw.bind(withdrawalService),
    };
    const publicationRoutes = new BilingualAdminRoutes(new BilingualAdminRepository(db, () => true), publicationSecurity, undefined, publicationManualPort);
    const publishPath = "/api/admin/bilingual/reviews/candidate-adapter-e2e/publish";
    const publishUnsigned = { schemaVersion: ADMIN_BILINGUAL_SCHEMA, action: "publish" as const, candidateId: "candidate-adapter-e2e", expectedRevision: reviewable.revision, idempotencyKey: "admin-publish-e2e", clientRequestId: "admin-publish-client" };
    const publishMutation = { ...publishUnsigned, requestHash: hash(profileCanonicalJson({ method: "POST", canonicalPath: publishPath, body: publishUnsigned })) };
    const publishCsrfResult = publicationRoutes.tryHandle(adminContext({ path: "/api/admin/csrf", cookie: publicationSession.cookieHeader }), { schemaVersion: ADMIN_BILINGUAL_SCHEMA, mutation: publishMutation });
    const publishCsrf = (publishCsrfResult?.body as { csrfToken: string }).csrfToken;
    expect(() => publicationRoutes.tryHandle(adminContext({ path: publishPath, cookie: "__Host-f1_admin_session=invalid", csrf: publishCsrf, idempotencyKey: publishUnsigned.idempotencyKey }), publishMutation)).toThrow("ADMIN_SESSION_REQUIRED");
    expect(() => publicationRoutes.tryHandle(adminContext({ path: publishPath, cookie: publicationSession.cookieHeader, csrf: publishCsrf, idempotencyKey: publishUnsigned.idempotencyKey, origin: "https://evil.example" }), publishMutation)).toThrow("ADMIN_ORIGIN_REJECTED");
    expect(() => publicationRoutes.tryHandle(adminContext({ path: publishPath, cookie: publicationSession.cookieHeader, idempotencyKey: publishUnsigned.idempotencyKey }), publishMutation)).toThrow("ADMIN_CSRF_REJECTED");
    expect(() => publicationRoutes.tryHandle(adminContext({ path: publishPath, cookie: publicationSession.cookieHeader, csrf: publishCsrf, idempotencyKey: publishUnsigned.idempotencyKey }), { ...publishMutation, requestHash: hash("wrong-publish-request") })).toThrow("ADMIN_REQUEST_INVALID");
    const publishResult = publicationRoutes.tryHandle(adminContext({ path: publishPath, cookie: publicationSession.cookieHeader, csrf: publishCsrf, idempotencyKey: publishUnsigned.idempotencyKey }), publishMutation);
    expect(publishResult).toMatchObject({ status: 200, body: { status: "succeeded", externalCalls: 0, automaticReviewRegistrations: 0, automaticPublishRegistrations: 0, publication: { status: "published", revision: 1 } } });
    const published = (publishResult!.body as any).publication as { publicationId: string; projectionId: string };
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_publication_outbox_v1").get()).toEqual({ count: 1 });
    expect(readPublicBilingualSnapshot({ root: projectionRoot, signingKeyId: "synthetic-ed25519", publicKey: signing.publicKey })).toMatchObject({ usedLkg: false, body: { records: [{ publicationId: published.publicationId }], withdrawals: [] } });
    const publishReplayCsrf = ((publicationRoutes.tryHandle(adminContext({ path: "/api/admin/csrf", cookie: publicationSession.cookieHeader }), { schemaVersion: ADMIN_BILINGUAL_SCHEMA, mutation: publishMutation }))?.body as { csrfToken: string }).csrfToken;
    expect(publicationRoutes.tryHandle(adminContext({ path: publishPath, cookie: publicationSession.cookieHeader, csrf: publishReplayCsrf, idempotencyKey: publishUnsigned.idempotencyKey }), publishMutation)).toMatchObject({ status: 200, body: { publication: { publicationId: published.publicationId } } });
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_publication_outbox_v1").get()).toEqual({ count: 1 });
    const withdrawPath = `/api/admin/bilingual/publications/${published.publicationId}/withdraw`;
    const withdrawUnsigned = { schemaVersion: ADMIN_BILINGUAL_SCHEMA, action: "withdraw" as const, publicationId: published.publicationId, expectedRevision: 1, idempotencyKey: "admin-withdraw-e2e", clientRequestId: "admin-withdraw-client" };
    const withdrawMutation = { ...withdrawUnsigned, requestHash: hash(profileCanonicalJson({ method: "POST", canonicalPath: withdrawPath, body: withdrawUnsigned })) };
    const withdrawPrepared = prepareBilingualMutation(withdrawMutation);
    const withdrawFresh = publicationSecurity.acceptVerifiedFreshReauth(adminContext({ path: "/api/admin/auth/fresh/verify", cookie: publicationSession.cookieHeader }), { operationId: withdrawPrepared.binding.operationId, action: "BILINGUAL_WITHDRAW", resourceHash: withdrawPrepared.binding.resourceHash! });
    const withdrawCsrfResult = publicationRoutes.tryHandle(adminContext({ path: "/api/admin/csrf", cookie: withdrawFresh.cookieHeader }), { schemaVersion: ADMIN_BILINGUAL_SCHEMA, mutation: withdrawMutation });
    const withdrawCsrf = (withdrawCsrfResult?.body as { csrfToken: string }).csrfToken;
    const withdrawHeaders = new Map(adminContext({ path: withdrawPath, cookie: withdrawFresh.cookieHeader, csrf: withdrawCsrf, idempotencyKey: withdrawUnsigned.idempotencyKey }).rawHeaders);
    withdrawHeaders.set("x-f1-fresh-reauth", [withdrawFresh.freshReceipt]);
    const withdrawContext = Object.freeze({ ...adminContext({ path: withdrawPath, cookie: withdrawFresh.cookieHeader, csrf: withdrawCsrf, idempotencyKey: withdrawUnsigned.idempotencyKey }), rawHeaders: withdrawHeaders });
    expect(() => publicationRoutes.tryHandle(adminContext({ path: withdrawPath, cookie: withdrawFresh.cookieHeader, csrf: withdrawCsrf, idempotencyKey: withdrawUnsigned.idempotencyKey }), withdrawMutation)).toThrow("ADMIN_REAUTH_REQUIRED");
    const withdrawBadOriginHeaders = new Map(withdrawHeaders); withdrawBadOriginHeaders.set("origin", ["https://evil.example"]);
    const withdrawBadOrigin = Object.freeze({ ...withdrawContext, origin: "https://evil.example", rawHeaders: withdrawBadOriginHeaders });
    expect(() => publicationRoutes.tryHandle(withdrawBadOrigin, withdrawMutation)).toThrow("ADMIN_ORIGIN_REJECTED");
    expect(() => publicationRoutes.tryHandle(withdrawContext, { ...withdrawMutation, requestHash: hash("wrong-withdraw-request") })).toThrow("ADMIN_REQUEST_INVALID");
    expect(() => publicationRoutes.tryHandle(withdrawContext, withdrawMutation)).toThrow("INJECTED_EXPORT_FAILURE");
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_publication_v1 WHERE change_kind='withdrawal' AND status='withdrawn'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_publication_outbox_v1").get()).toEqual({ count: 2 });
    const withdrawResult = publicationRoutes.tryHandle(withdrawContext, withdrawMutation);
    expect(withdrawResult).toMatchObject({ status: 200, body: { publication: { status: "withdrawn", revision: 2 }, externalCalls: 0 } });
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_publication_outbox_v1").get()).toEqual({ count: 2 });
    expect(readPublicBilingualSnapshot({ root: projectionRoot, signingKeyId: "synthetic-ed25519", publicKey: signing.publicKey })).toMatchObject({ usedLkg: false, body: { records: [], withdrawals: [{ publicationId: (withdrawResult!.body as any).publication.publicationId }] } });

    const blockInput: BilingualSafetyDecisionInput = { candidateId: "candidate-adapter-e2e", sourceId: "motorsport-f1-news", sourceRevision: 1, inputContentHash: "8".repeat(64), action: "block", blockReason: "RIGHTS_BLOCKED", expectedDecisionSeq: 2, supersedesDecisionId: clearReceipt.decisionId };
    const blockResourceHash = bilingualSafetyResourceHash(blockInput);
    const blockRequestHash = hash("safety-block-request");
    const blockCapability = safetyOperation("adapter-safety-block", safetyHandoffs[1], blockRequestHash);
    const blockReceipt = gateway.commitBilingualLineageSafetyDecision(blockCapability, { actorRef: "operator-local", sessionDigest: hash("session-block"), csrfDigest: hash("csrf-block"), freshDigest: hash("fresh-block"), verifiedAt: "2026-08-25T00:00:21.000Z", freshAction: "BILINGUAL_SAFETY_DECISION", resourceHash: blockResourceHash, operationId: "adapter-safety-block", bodyHash: blockRequestHash }, blockInput);
    expect(db.prepare("SELECT rights_status FROM bilingual_candidate_lineage_v1 WHERE candidate_id='candidate-adapter-e2e'").get()).toEqual({ rights_status: "blocked" });
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_lineage_effective_safety_v1 WHERE candidate_id='candidate-adapter-e2e' AND action='clear'").get()).toEqual({ count: 0 });
    expect(() => db.prepare("UPDATE bilingual_candidate_lineage_v1 SET rights_status='clear' WHERE candidate_id='candidate-adapter-e2e'").run()).toThrow();

    const withdrawInput: BilingualSafetyDecisionInput = { candidateId: "candidate-adapter-e2e", sourceId: "motorsport-f1-news", sourceRevision: 1, inputContentHash: "8".repeat(64), action: "withdraw", expectedDecisionSeq: 3, supersedesDecisionId: blockReceipt.decisionId };
    const withdrawResourceHash = bilingualSafetyResourceHash(withdrawInput);
    const reusedFreshHash = hash("safety-reused-fresh-request");
    const reusedFreshCapability = safetyOperation("adapter-safety-reused-fresh", safetyHandoffs[2], reusedFreshHash);
    expect(() => gateway.commitBilingualLineageSafetyDecision(reusedFreshCapability, { actorRef: "operator-local", sessionDigest: hash("session-reuse"), csrfDigest: hash("csrf-reuse"), freshDigest: clearAuthorization.freshDigest, verifiedAt: "2026-08-25T00:00:22.000Z", freshAction: "BILINGUAL_SAFETY_DECISION", resourceHash: withdrawResourceHash, operationId: "adapter-safety-reused-fresh", bodyHash: reusedFreshHash }, withdrawInput)).toThrow();
    const staleFreshHash = hash("safety-stale-fresh-request");
    const staleFreshCapability = safetyOperation("adapter-safety-stale-fresh", safetyHandoffs[3], staleFreshHash);
    expect(() => gateway.commitBilingualLineageSafetyDecision(staleFreshCapability, { actorRef: "operator-local", sessionDigest: hash("session-stale"), csrfDigest: hash("csrf-stale"), freshDigest: hash("fresh-stale"), verifiedAt: "2026-08-24T23:00:00.000Z", freshAction: "BILINGUAL_SAFETY_DECISION", resourceHash: withdrawResourceHash, operationId: "adapter-safety-stale-fresh", bodyHash: staleFreshHash }, withdrawInput)).toThrow("BILINGUAL_SAFETY_FRESHNESS_INVALID");
    const casAHash = hash("safety-cas-a-request");
    const casACapability = safetyOperation("adapter-safety-cas-a", safetyHandoffs[4], casAHash);
    gateway.commitBilingualLineageSafetyDecision(casACapability, { actorRef: "operator-local", sessionDigest: hash("session-cas-a"), csrfDigest: hash("csrf-cas-a"), freshDigest: hash("fresh-cas-a"), verifiedAt: "2026-08-25T00:00:23.000Z", freshAction: "BILINGUAL_SAFETY_DECISION", resourceHash: withdrawResourceHash, operationId: "adapter-safety-cas-a", bodyHash: casAHash }, withdrawInput);
    const expireInput: BilingualSafetyDecisionInput = { ...withdrawInput, action: "expire" };
    const casBHash = hash("safety-cas-b-request");
    const casBCapability = safetyOperation("adapter-safety-cas-b", safetyHandoffs[5], casBHash);
    expect(() => gateway.commitBilingualLineageSafetyDecision(casBCapability, { actorRef: "operator-local", sessionDigest: hash("session-cas-b"), csrfDigest: hash("csrf-cas-b"), freshDigest: hash("fresh-cas-b"), verifiedAt: "2026-08-25T00:00:24.000Z", freshAction: "BILINGUAL_SAFETY_DECISION", resourceHash: bilingualSafetyResourceHash(expireInput), operationId: "adapter-safety-cas-b", bodyHash: casBHash }, expireInput)).toThrow("BILINGUAL_SAFETY_CAS_INVALID");
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_lineage_safety_decision_v1 WHERE candidate_id='candidate-adapter-e2e'").get()).toEqual({ count: 3 });

    mode = "known_fail_unknown";
    const attempt2 = await run(makeLineage("known-fail"));
    expect(attempt2).toMatchObject({ status: "failed", externalCalls: 2, writesToBase: true, children: { "zh-CN": { status: "failed" }, en: { status: "reconcile_required" } } });
    expect(externalCalls).toBe(4);
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_language_slot_draft_v1").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT language,state,failure_reason FROM bilingual_language_slot_v1 WHERE candidate_id='candidate-adapter-known-fail' ORDER BY language").all()).toEqual([
      { language: "en", state: "reconcile_required", failure_reason: "EXTERNAL_UNKNOWN" },
      { language: "zh-CN", state: "failed", failure_reason: "FIXTURE_KNOWN_FAILED" }
    ]);
    const attempt2Duplicate = await run(makeLineage("known-fail"));
    expect(attempt2Duplicate).toEqual(attempt2);
    expect(externalCalls).toBe(4);

    mode = "success";
    materializationFaultLanguage = "zh-CN";
    const attempt3 = await run(makeLineage("materialization-fault"));
    expect(attempt3).toMatchObject({ status: "partial", externalCalls: 2, writesToBase: true, children: { "zh-CN": { status: "reconcile_required" }, en: { status: "complete" } } });
    expect(externalCalls).toBe(6);
    expect(db.prepare("SELECT state,outcome,external_calls FROM internal_external_attempt WHERE operation_id IN (SELECT operation_id FROM bilingual_operation_link_v1 WHERE candidate_id='candidate-adapter-materialization-fault' AND semantic_action IN ('refine_language','rerun_language')) ORDER BY operation_id").all()).toEqual([
      { state: "response_committed", outcome: "succeeded", external_calls: 1 },
      { state: "reconcile_required", outcome: "unknown", external_calls: 1 }
    ]);
    expect(db.prepare("SELECT count(*) AS count FROM bilingual_language_slot_draft_v1 WHERE candidate_id='candidate-adapter-materialization-fault'").get()).toEqual({ count: 1 });
    expect(await run(makeLineage("materialization-fault"))).toEqual(attempt3);
    expect(externalCalls).toBe(6);
    materializationFaultLanguage = null;

    const adminRetry = new AdminBilingualRetryAdapter(db, port, { routeRef: "model-bilingual-fixture", providerId: "fixture-provider", modelId: "fixture-model", routeIdentitySha256: "a".repeat(64), releaseSha256: ZERO, manifestSha256: ZERO, budgetAccountId: "budget-bilingual-fixture", units: 5, currency: "USD", promptSha256: "5".repeat(64) });
    const securityNow = START + 120_000;
    const security = new ReviewAdminSecurity({ canonicalOrigin: "https://f1-admin.example.ts.net", sessionHashKey: Buffer.alloc(32, 4), now: () => securityNow, readRecoveryFence: () => ({ clockTrusted: true, writerReady: true, lastSuccessfulRecoveryPointAt: securityNow - 1_000 }) });
    const session = security.acceptVerifiedSession({ operatorRef: "operator-local", deviceRef: "device-local", tailnetUserRef: "tailnet-local" });
    const manualPort: BilingualManualMutationPort = { retryLanguage: (authorization, input) => adminRetry.retryLanguage(authorization, input), commitApproval: () => { throw new Error("UNEXPECTED_APPROVAL"); }, commitSafetyDecision: () => { throw new Error("UNEXPECTED_SAFETY"); } };
    const adminRoutes = new BilingualAdminRoutes(new BilingualAdminRepository(db, () => true), security, undefined, manualPort);
    const enBeforeAdminRerun = db.prepare("SELECT revision FROM bilingual_language_slot_v1 WHERE candidate_id='candidate-adapter-e2e' AND language='en'").get() as Record<string, unknown>;
    const zhBytesBeforeAdminRerun = db.prepare("SELECT * FROM bilingual_language_slot_v1 WHERE candidate_id='candidate-adapter-e2e' AND language='zh-CN'").get();
    const retryPath = "/api/admin/bilingual/reviews/candidate-adapter-e2e/rerun";
    const retryUnsigned = { schemaVersion: ADMIN_BILINGUAL_SCHEMA, action: "rerun" as const, candidateId: "candidate-adapter-e2e", language: "en" as const, expectedRevision: Number(enBeforeAdminRerun.revision), idempotencyKey: "admin-en-rerun-e2e", clientRequestId: "admin-en-rerun-client" };
    const retryMutation = { ...retryUnsigned, requestHash: hash(profileCanonicalJson({ method: "POST", canonicalPath: retryPath, body: retryUnsigned })) };
    const retryCsrfResult = adminRoutes.tryHandle(adminContext({ path: "/api/admin/csrf", cookie: session.cookieHeader }), { schemaVersion: ADMIN_BILINGUAL_SCHEMA, mutation: retryMutation });
    const retryCsrf = (retryCsrfResult?.body as { csrfToken: string }).csrfToken;
    const retryContext = adminContext({ path: retryPath, cookie: session.cookieHeader, csrf: retryCsrf, idempotencyKey: retryUnsigned.idempotencyKey });
    const adminRerun = await adminRoutes.tryHandleAsync(retryContext, retryMutation);
    expect(adminRerun).toMatchObject({ status: 200, body: { status: "complete", externalCalls: 1, writesToBase: true, automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 } });
    expect(db.prepare("SELECT * FROM bilingual_language_slot_v1 WHERE candidate_id='candidate-adapter-e2e' AND language='zh-CN'").get()).toEqual(zhBytesBeforeAdminRerun);
    await expect(adminRoutes.tryHandleAsync(retryContext, retryMutation)).rejects.toMatchObject({ reasonCode: "ADMIN_CSRF_REJECTED" });
    const failedZh = db.prepare("SELECT revision FROM bilingual_language_slot_v1 WHERE candidate_id='candidate-adapter-known-fail' AND language='zh-CN'").get() as Record<string, unknown>;
    const failedEnBytes = db.prepare("SELECT * FROM bilingual_language_slot_v1 WHERE candidate_id='candidate-adapter-known-fail' AND language='en'").get();
    const zhRetryPath = "/api/admin/bilingual/reviews/candidate-adapter-known-fail/retry";
    const zhRetryUnsigned = { schemaVersion: ADMIN_BILINGUAL_SCHEMA, action: "retry" as const, candidateId: "candidate-adapter-known-fail", language: "zh-CN" as const, expectedRevision: Number(failedZh.revision), idempotencyKey: "admin-zh-retry-e2e", clientRequestId: "admin-zh-retry-client" };
    const zhRetryMutation = { ...zhRetryUnsigned, requestHash: hash(profileCanonicalJson({ method: "POST", canonicalPath: zhRetryPath, body: zhRetryUnsigned })) };
    const zhRetryCsrfResult = adminRoutes.tryHandle(adminContext({ path: "/api/admin/csrf", cookie: session.cookieHeader }), { schemaVersion: ADMIN_BILINGUAL_SCHEMA, mutation: zhRetryMutation });
    const zhRetryCsrf = (zhRetryCsrfResult?.body as { csrfToken: string }).csrfToken;
    expect(await adminRoutes.tryHandleAsync(adminContext({ path: zhRetryPath, cookie: session.cookieHeader, csrf: zhRetryCsrf, idempotencyKey: zhRetryUnsigned.idempotencyKey }), zhRetryMutation)).toMatchObject({ status: 200, body: { status: "complete", externalCalls: 1, writesToBase: true } });
    expect(db.prepare("SELECT * FROM bilingual_language_slot_v1 WHERE candidate_id='candidate-adapter-known-fail' AND language='en'").get()).toEqual(failedEnBytes);

    const retryPair = planBilingualRefinement("candidate-adapter-e2e", 1, "8".repeat(64), 2);
    const makeRetryPlan = (language: "zh-CN" | "en", carrierOperationId: string) => {
      const child = retryPair.children.find((entry) => entry.language === language)!;
      return Object.freeze({
        operationId: child.operationId, parentOperationId: language === "zh-CN" ? child.operationId : carrierOperationId,
        idempotencyKey: child.idempotencyKey, candidateId: "candidate-adapter-e2e", language, attemptNumber: 2,
        route: Object.freeze({ routeRef: "model-bilingual-fixture", providerId: "fixture-provider", modelId: "fixture-model", routeIdentitySha256: "a".repeat(64), releaseSha256: ZERO, manifestSha256: ZERO }),
        budget: Object.freeze({ accountId: "budget-bilingual-fixture", reservationId: `reservation-candidate-adapter-e2e-${language}-2`, units: 5, currency: "USD" }),
        external: Object.freeze({ method: "POST" as const, endpointClass: "model_refine", providerResource: `fixture-model-${language}`, externalIdempotencyKey: `external-candidate-adapter-e2e-${language}-2`, reconcileKey: `reconcile-candidate-adapter-e2e-${language}-2`, headers: Object.freeze([]), query: Object.freeze([]), bodySha256: hash(`body-candidate-adapter-e2e-${language}-2`) })
      });
    };
    const executeRetry = async (plan: ReturnType<typeof makeRetryPlan>) => {
      const content = { language: plan.language, title: plan.language === "zh-CN" ? "中文重跑标题" : "English retry title", summary: plan.language === "zh-CN" ? "中文重跑摘要" : "English retry summary", lead: plan.language === "zh-CN" ? "中文重跑导语" : "English retry lead", body: [plan.language === "zh-CN" ? "中文重跑正文" : "English retry body"], keyPoints: [plan.language === "zh-CN" ? "中文重跑要点" : "English retry point"] };
      const rawJson = canonicalJson({ schemaVersion: BILINGUAL_DRAFT_SCHEMA, ...content, contentHash: sha256(canonicalJson(content)) });
      return { rawJson, route: { routeRef: plan.route.routeRef, providerId: plan.route.providerId, modelId: plan.route.modelId, promptSchemaVersion: BILINGUAL_PROMPT_SCHEMA, promptSha256: "5".repeat(64), receiptHash: hash(`route-retry-${plan.language}`), releaseSha256: ZERO, manifestSha256: ZERO }, budget: { reservationId: plan.budget.reservationId, units: plan.budget.units, currency: plan.budget.currency, receiptHash: hash(`budget-retry-${plan.language}`) }, externalCalls: 1 as const, response: { providerResourceIdentity: plan.external.providerResource, providerStatus: "200", responseBodySha256: sha256(rawJson), responseHeaderHashes: [] as const, outcome: "succeeded" as const, reasonCode: null } };
    };
    const enBeforeZhRerun = db.prepare("SELECT * FROM bilingual_language_slot_v1 WHERE candidate_id='candidate-adapter-e2e' AND language='en'").get();
    const zhPlan = makeRetryPlan("zh-CN", retryPair.parent.operationId);
    const zhAdmission = await port.beginLanguageRetry({ carrierOperationId: retryPair.parent.operationId, lineage: makeLineage("e2e"), promptSchemaVersion: BILINGUAL_PROMPT_SCHEMA, promptSha256: "5".repeat(64), plan: zhPlan });
    expect(zhAdmission).toMatchObject({ ok: true, child: { language: "zh-CN", attemptNumber: 2, parentOperationId: retryPair.parent.operationId } });
    if (!("child" in zhAdmission)) throw new Error("ZH_RERUN_ADMISSION_CLOSED");
    expect(await port.runLanguageAttempt(zhAdmission.child, () => executeRetry(zhPlan))).toMatchObject({ ok: true, status: "complete", externalCalls: 1 });
    expect(db.prepare("SELECT * FROM bilingual_language_slot_v1 WHERE candidate_id='candidate-adapter-e2e' AND language='en'").get()).toEqual(enBeforeZhRerun);
    expect(db.prepare("SELECT language,attempt_number,count(*) AS count FROM bilingual_model_receipt_v1 WHERE candidate_id='candidate-adapter-e2e' GROUP BY language,attempt_number ORDER BY language,attempt_number").all()).toEqual([
      { language: "en", attempt_number: 1, count: 1 }, { language: "en", attempt_number: 2, count: 1 },
      { language: "zh-CN", attempt_number: 1, count: 1 }, { language: "zh-CN", attempt_number: 2, count: 1 }
    ]);
    gateway.close();

    const graphOperations = ["adapter-safety-reused-fresh", "adapter-safety-stale-fresh", "adapter-safety-cas-a", "adapter-safety-cas-b"] as const;
    const operationTriggers = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='internal_operation' ORDER BY name").all() as Array<Record<string, unknown>>;
    const forceGraphOperation = (operationId: string, attempt: number, state: "attempt_committed" | "succeeded" = "attempt_committed", sourceId = "motorsport-f1-news") => {
      for (const trigger of operationTriggers) db.exec(`DROP TRIGGER "${String(trigger.name).replaceAll('"', '""')}"`);
      db.prepare(`UPDATE internal_operation SET operation_kind='refine',owner_process='bilingual_refiner',capability_class='external_attempt',
          policy_id='p-refine-bi-live',control_action=NULL,state=?,version=version+1,candidate_id='candidate-adapter-graph',source_id=?,
          phase='live',attempt=?,budget_reservation_id='reservation-candidate-adapter-e2e-zh-CN',egress_class='model_https',
          model_route_ref='model-bilingual-fixture',expected_entity_version=1,expected_entity_hash=?,result_hash=?,reason_code=NULL,
          updated_at='2026-08-25T00:02:00.000Z' WHERE operation_id=?`).run(
        state, sourceId, attempt, "8".repeat(64), state === "succeeded" ? hash(`graph-result-${operationId}`) : null, operationId
      );
      for (const trigger of operationTriggers) db.exec(String(trigger.sql));
    };
    let graphLinkSequence = 0;
    const insertGraphLink = (operationId: string, parentOperationId: string | null, semanticAction: "refine_both" | "refine_language" | "retry_language" | "rerun_language", language: "zh-CN" | "en" | null, attempt: number, requestHash?: string) => {
      graphLinkSequence += 1;
      const operation = db.prepare("SELECT request_hash FROM internal_operation WHERE operation_id=?").get(operationId) as Record<string, unknown>;
      db.prepare("INSERT INTO bilingual_operation_link_v1 VALUES(?,?,?,?,?,?,?,?,?,?)").run(
        `graph-link-${graphLinkSequence}`, operationId, parentOperationId, "candidate-adapter-graph", language,
        semanticAction, attempt, requestHash ?? String(operation.request_hash), `graph-idempotency-${graphLinkSequence}`, "2026-08-25T00:02:01.000Z"
      );
    };
    const graphDigest = () => hash(JSON.stringify([
      db.prepare("SELECT * FROM bilingual_operation_link_v1 ORDER BY link_id").all(),
      db.prepare("SELECT operation_id,state,attempt,source_id,candidate_id,request_hash FROM internal_operation ORDER BY operation_id").all()
    ]));
    const baselineGraphDigest = graphDigest();
    const graphResults: Array<{ name: string; expected: "accept" | "reject"; observed: "accepted" | "rejected" }> = [];
    const graphCase = (name: string, expected: "accept" | "reject", setup: () => void, attack: () => void) => {
      db.exec("BEGIN IMMEDIATE");
      let observed: "accepted" | "rejected" = "accepted";
      try {
        setup();
        try { attack(); } catch { observed = "rejected"; }
      } finally {
        db.exec("ROLLBACK");
      }
      graphResults.push({ name, expected, observed });
      expect(observed, name).toBe(expected === "accept" ? "accepted" : "rejected");
      expect(graphDigest(), `${name} rollback`).toBe(baselineGraphDigest);
    };
    const prepareCarrier = (carrier: string, attempt = 1, carrierState: "attempt_committed" | "succeeded" = "attempt_committed") => {
      forceGraphOperation(carrier, attempt);
      insertGraphLink(carrier, null, "refine_both", null, attempt);
      insertGraphLink(carrier, null, attempt === 1 ? "refine_language" : "rerun_language", "zh-CN", attempt);
      if (carrierState === "succeeded") forceGraphOperation(carrier, attempt, "succeeded");
    };
    const prepareCombined = (carrier: string, child: string, attempt = 1, carrierState: "attempt_committed" | "succeeded" = "attempt_committed") => {
      prepareCarrier(carrier, attempt, carrierState);
      forceGraphOperation(child, attempt);
    };
    const prepareTerminalEnAttemptOne = (carrier: string, enOperation: string) => {
      prepareCarrier(carrier, 1, "succeeded");
      forceGraphOperation(enOperation, 1);
      insertGraphLink(enOperation, carrier, "refine_language", "en", 1);
      forceGraphOperation(enOperation, 1, "succeeded");
    };

    graphCase("positive combined", "accept", () => prepareCombined(graphOperations[0], graphOperations[1]), () => insertGraphLink(graphOperations[1], graphOperations[0], "refine_language", "en", 1));
    graphCase("positive zh-only", "accept", () => { forceGraphOperation(graphOperations[0], 1); insertGraphLink(graphOperations[0], null, "refine_both", null, 1); }, () => insertGraphLink(graphOperations[0], null, "refine_language", "zh-CN", 1));
    graphCase("positive en retry", "accept", () => prepareTerminalEnAttemptOne(graphOperations[0], graphOperations[1]), () => { forceGraphOperation(graphOperations[2], 2); insertGraphLink(graphOperations[2], graphOperations[0], "retry_language", "en", 2); });
    graphCase("positive zh retry", "accept", () => prepareCarrier(graphOperations[0], 1, "succeeded"), () => { forceGraphOperation(graphOperations[1], 2); insertGraphLink(graphOperations[1], null, "refine_both", null, 2); insertGraphLink(graphOperations[1], null, "rerun_language", "zh-CN", 2); });
    graphCase("two-node cycle", "reject", () => { prepareCarrier(graphOperations[0], 1, "succeeded"); prepareCarrier(graphOperations[1], 2); forceGraphOperation(graphOperations[0], 1); }, () => insertGraphLink(graphOperations[0], graphOperations[1], "retry_language", "en", 1));
    graphCase("three-node cycle", "reject", () => { prepareCarrier(graphOperations[0], 1, "succeeded"); prepareCarrier(graphOperations[1], 2, "succeeded"); prepareCarrier(graphOperations[2], 3); forceGraphOperation(graphOperations[0], 1); }, () => insertGraphLink(graphOperations[0], graphOperations[2], "retry_language", "en", 1));
    graphCase("multiple parent", "reject", () => {
      prepareTerminalEnAttemptOne(graphOperations[0], graphOperations[1]);
      forceGraphOperation(graphOperations[2], 2); insertGraphLink(graphOperations[2], null, "refine_both", null, 2); insertGraphLink(graphOperations[2], null, "rerun_language", "zh-CN", 2);
      forceGraphOperation(graphOperations[3], 2); insertGraphLink(graphOperations[3], graphOperations[0], "retry_language", "en", 2);
    }, () => insertGraphLink(graphOperations[3], graphOperations[2], "rerun_language", "en", 2));
    graphCase("duplicate language attempt across action", "reject", () => { prepareTerminalEnAttemptOne(graphOperations[0], graphOperations[1]); forceGraphOperation(graphOperations[2], 2); insertGraphLink(graphOperations[2], graphOperations[0], "retry_language", "en", 2); }, () => insertGraphLink(graphOperations[2], graphOperations[0], "rerun_language", "en", 2));
    graphCase("reverse carrier child topology", "reject", () => { prepareCarrier(graphOperations[0], 1, "succeeded"); prepareCarrier(graphOperations[1], 2); forceGraphOperation(graphOperations[0], 1); }, () => insertGraphLink(graphOperations[0], graphOperations[1], "rerun_language", "en", 1));
    graphCase("carrier source drift", "reject", () => { prepareCombined(graphOperations[0], graphOperations[2], 1, "succeeded"); forceGraphOperation(graphOperations[1], 2, "attempt_committed", "autosport-f1-news"); }, () => insertGraphLink(graphOperations[1], graphOperations[0], "retry_language", "en", 2));
    graphCase("attempt gap starts at three", "reject", () => forceGraphOperation(graphOperations[0], 3), () => insertGraphLink(graphOperations[0], null, "refine_both", null, 3));
    graphCase("request hash mismatch", "reject", () => forceGraphOperation(graphOperations[0], 1), () => insertGraphLink(graphOperations[0], null, "refine_both", null, 1, hash("wrong-link-request")));
    graphCase("operation attempt mismatch", "reject", () => forceGraphOperation(graphOperations[0], 1), () => insertGraphLink(graphOperations[0], null, "refine_both", null, 2));
    graphCase("en attempt 2 missing attempt 1", "reject", () => { prepareCarrier(graphOperations[0], 1, "succeeded"); forceGraphOperation(graphOperations[1], 2); }, () => insertGraphLink(graphOperations[1], graphOperations[0], "retry_language", "en", 2));
    graphCase("en attempt 3 missing attempt 2", "reject", () => { prepareTerminalEnAttemptOne(graphOperations[0], graphOperations[1]); forceGraphOperation(graphOperations[2], 3); }, () => insertGraphLink(graphOperations[2], graphOperations[0], "rerun_language", "en", 3));
    graphCase("zh attempt 2 missing attempt 1", "reject", () => { forceGraphOperation(graphOperations[0], 1); insertGraphLink(graphOperations[0], null, "refine_both", null, 1); forceGraphOperation(graphOperations[0], 1, "succeeded"); forceGraphOperation(graphOperations[1], 2); }, () => insertGraphLink(graphOperations[1], null, "refine_both", null, 2));
    graphCase("two operations contend for same en attempt 2", "reject", () => { prepareTerminalEnAttemptOne(graphOperations[0], graphOperations[1]); forceGraphOperation(graphOperations[2], 2); forceGraphOperation(graphOperations[3], 2); insertGraphLink(graphOperations[2], graphOperations[0], "retry_language", "en", 2); }, () => insertGraphLink(graphOperations[3], graphOperations[0], "rerun_language", "en", 2));
    expect(graphResults).toHaveLength(17);
    const concurrentWriter = new DatabaseSync(databasePath);
    concurrentWriter.exec("PRAGMA busy_timeout=0");
    db.exec("BEGIN IMMEDIATE");
    let secondBeginImmediateRejected = false;
    try { concurrentWriter.exec("BEGIN IMMEDIATE"); }
    catch { secondBeginImmediateRejected = true; }
    finally { db.exec("ROLLBACK"); }
    expect(secondBeginImmediateRejected).toBe(true);
    expect(graphDigest(), "BEGIN IMMEDIATE writer serialization rollback").toBe(baselineGraphDigest);
    concurrentWriter.close();

    fixture.close();
    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    expect(hash(JSON.stringify([
      reopened.prepare("SELECT * FROM bilingual_operation_link_v1 ORDER BY link_id").all(),
      reopened.prepare("SELECT operation_id,state,attempt,source_id,candidate_id,request_hash FROM internal_operation ORDER BY operation_id").all()
    ]))).toBe(baselineGraphDigest);
    expect(reopened.prepare("SELECT status,pointer_version,generation FROM bilingual_public_projection_active_v1 WHERE public_id='public-adapter-e2e'").get()).toEqual({ status: "withdrawn", pointer_version: 2, generation: 2 });
    expect(reopened.prepare("SELECT publication_id,count(*) AS count FROM bilingual_publication_outbox_v1 GROUP BY publication_id ORDER BY publication_id").all()).toEqual([
      { publication_id: published.publicationId, count: 1 },
      { publication_id: (withdrawResult!.body as any).publication.publicationId, count: 1 }
    ].sort((left, right) => left.publication_id.localeCompare(right.publication_id)));
    expect(reopened.prepare("SELECT count(*) AS count FROM internal_external_attempt WHERE operation_id IN ('admin-publish-e2e','admin-publish-e2e.activate','admin-withdraw-e2e')").get()).toEqual({ count: 0 });
    expect(reopened.prepare("SELECT count(*) AS count FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher')").get()).toEqual({ count: 0 });
    expect(readPublicBilingualSnapshot({ root: projectionRoot, signingKeyId: "synthetic-ed25519", publicKey: signing.publicKey })).toMatchObject({ usedLkg: false, body: { records: [], withdrawals: [{ publicationId: (withdrawResult!.body as any).publication.publicationId }] } });
    reopened.close();
  });
});
