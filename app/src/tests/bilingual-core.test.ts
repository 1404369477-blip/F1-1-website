import {
  mkdtempSync,
  readFileSync,
  realpathSync
} from "node:fs";
import { constants as sqliteConstants, DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "vitest";

import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { installSqliteAuthorizer } from "../server/internal-operation/authorizer.ts";
import { applyXManualInboxMigration } from "../server/tweet-inbox/repository.ts";
import {
  BILINGUAL_DRAFT_SCHEMA,
  BILINGUAL_PROMPT_SCHEMA,
  BilingualContractError,
  assertSourceLineage,
  buildManualApproval,
  buildCorrectionPublication,
  buildPublicV2,
  buildQueuedPublication,
  buildReviewableBundle,
  buildWithdrawalPublication,
  canonicalJson,
  compareAndSwapActivePointer,
  createDelivery,
  createInitialLanguageSlots,
  transitionDelivery,
  parseLocalizedDraft,
  planBilingualRefinement,
  screenCopyRisk,
  sha256,
  retryFailedPublication,
  transitionLanguageSlot,
  transitionPublication,
  type BilingualLineage,
  type BilingualLanguageAttemptPlan,
  type LanguageSlot,
  type LocalizedDraft
} from "../server/rss/bilingual-core.ts";
import { applyRecentThreeToDisposable, queryRecentThreeFromExistingOnly } from "../server/rss/bilingual-backfill.ts";
import { runBilingualRefinement } from "../server/rss/bilingual-worker.ts";
import { applyBilingualMigration, assertBilingualSchema, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";

const ZERO = "0".repeat(64);
const NOW = "2026-08-24T12:00:00.000Z";
const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");
const SQLITE = sqliteConstants as unknown as Record<string, number>;
const SAFETY = Object.freeze({ decisionId: "safety-1", decisionSeq: 1, resourceHash: "a".repeat(64), requestHash: "b".repeat(64), authorityContextHash: "c".repeat(64), expiresAt: "2026-08-25T12:00:00.000Z" });
type AuthorizableDatabase = DatabaseSync & { setAuthorizer: (callback: ((action: number, arg1?: string | null) => number) | null) => void };

function v8Database(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const file of [
    "0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql",
    "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"
  ]) database.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${file}`, "utf8"));
  applyInternalOperationMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8"));
  applyXManualInboxMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0008_x_manual_inbox.sql`, "utf8"));
  return database;
}

function lineage(): BilingualLineage {
  return {
    ...assertSourceLineage({
      candidateId: "candidate-bilingual-001",
      publicId: "public-bilingual-001",
      sourceId: "motorsport-f1-news",
      sourceRevision: 1,
      inputContentHash: "1".repeat(64),
      sourceFactSetHash: "2".repeat(64),
      sourceReleaseHash: "3".repeat(64),
      canonicalUrl: "https://example.invalid/f1/story",
      sourceTitle: "A supplied F1 source title",
      sourceAuthor: "Editorial source",
      sourcePublishedAt: NOW,
      sourceExcerpt: "A short private evidence excerpt used only by the model screen."
    }),
    copyRiskStatus: "screen_passed",
    rightsStatus: "clear",
    deletionStatus: "clear",
    mediaStatus: "none"
  };
}

function modelPlan(operationId: string, parentOperationId: string, language: "zh-CN" | "en", attemptNumber: number): BilingualLanguageAttemptPlan {
  return Object.freeze({
    operationId,
    parentOperationId,
    idempotencyKey: `model-${operationId}`,
    candidateId: "candidate-bilingual-001",
    language,
    attemptNumber,
    route: Object.freeze({ routeRef: "test-route", providerId: "test-provider", modelId: "test-model", routeIdentitySha256: "9".repeat(64), releaseSha256: "c".repeat(64), manifestSha256: "d".repeat(64) }),
    budget: Object.freeze({ accountId: "model-budget", reservationId: `budget-${language}`, units: 1, currency: "USD" }),
    external: Object.freeze({ method: "POST", endpointClass: "model_refine", providerResource: "test-model", externalIdempotencyKey: `external-${operationId}`, reconcileKey: `reconcile-${operationId}`, headers: Object.freeze([]), query: Object.freeze([]), bodySha256: "7".repeat(64) })
  });
}

function draft(language: "zh-CN" | "en"): LocalizedDraft {
  const base = {
    language,
    title: language === "zh-CN" ? "排位赛前的设置变化" : "Setup changes ahead of qualifying",
    summary: language === "zh-CN" ? "站内整理了车队在排位赛前披露的设置变化。" : "An editorial summary of the setup change disclosed before qualifying.",
    lead: language === "zh-CN" ? "这是一段站内整理。" : "This is an editorial summary.",
    body: [language === "zh-CN" ? "车队说明了调整方向。" : "The team described the direction of the adjustment."],
    keyPoints: [language === "zh-CN" ? "调整仍待比赛验证。" : "The adjustment remains to be validated in competition."]
  };
  return { schemaVersion: BILINGUAL_DRAFT_SCHEMA, ...base, contentHash: sha256(canonicalJson({ language: base.language, title: base.title, summary: base.summary, lead: base.lead, body: base.body, keyPoints: base.keyPoints })) };
}

function after(slot: LanguageSlot, milliseconds = 1): string { return new Date(Date.parse(slot.updatedAt) + milliseconds).toISOString(); }

function completeSlot(slot: LanguageSlot, operationId: string, language: "zh-CN" | "en"): LanguageSlot {
  const queued = transitionLanguageSlot(slot, "queued", { operationId, now: after(slot), newOperation: true });
  const running = transitionLanguageSlot(queued, "running", { operationId, now: after(queued), attemptId: `${language}-attempt` });
  return transitionLanguageSlot(running, "complete", { operationId, now: after(running), draftHash: draft(language).contentHash, modelRouteReceiptHash: language === "zh-CN" ? "6".repeat(64) : "7".repeat(64), attemptId: `${language}-attempt` });
}

function existingV8File(sourceEnabled = true): string {
  const path = join(mkdtempSync(join(realpathSync(tmpdir()), "bilingual-r2-")), "authority.sqlite");
  const database = new DatabaseSync(path);
  for (const file of ["0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql", "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"]) database.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${file}`, "utf8"));
  if (!sourceEnabled) database.exec("UPDATE source SET enabled=0,stop_epoch=stop_epoch+1 WHERE source_id='motorsport-f1-news'");
  for (let index = 1; index <= 3; index += 1) {
    const candidateId = `candidate-backfill-${index}`; const hash = `${index}`.repeat(64); const publicId = `public-rss-${`${index + 3}`.repeat(64)}`;
    const publishedAt = `2026-08-2${index}T12:00:00.000Z`;
    const payload = JSON.stringify({ candidateId, sourceId: "motorsport-f1-news", sourceRevision: 1, sourcePayloadHash: hash, canonicalUrl: `https://example.invalid/${index}`, sourceTitle: `Source ${index}`, sourcePublishedAt: publishedAt, titleZh: `标题${index}`, summaryZh: `摘要${index}`, media: [] });
    database.prepare("INSERT INTO pending_review_candidate(candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,editor_title,editor_excerpt,editor_notes,editor_based_on_source_revision,first_seen_at,last_seen_at) VALUES(?,'motorsport-f1-news',?,?,?,?,?,NULL,?,?,1,?,?,?,1,?,?)").run(candidateId, `ext-${index}`, hash, `https://example.invalid/${index}`, `Source ${index}`, "excerpt", publishedAt, hash, `标题${index}`, `摘要${index}`, "", NOW, NOW);
    database.prepare("INSERT INTO review_bundle VALUES(?,?,?,?,?,?,?,?,?,?)").run(`bundle-${index}`, candidateId, 1, 1, hash, payload, sha256(payload), "", hash, NOW);
    database.prepare("INSERT INTO review_decision VALUES(?,?, 'approved',?,NULL,?)").run(`decision-${index}`, `bundle-${index}`, hash, NOW);
    database.prepare("INSERT INTO publication VALUES(?,?,?,?,?,1,'queued',NULL,?,?)").run(`publication-${index}`, `decision-${index}`, `bundle-${index}`, publicId, hash, NOW, NOW);
    database.prepare("UPDATE publication SET publication_status='published',published_at=?,updated_at=? WHERE publication_id=?").run(publishedAt, publishedAt, `publication-${index}`);
    database.prepare("INSERT INTO published_projection VALUES(?,?,?,?,1,?,?,?)").run(`projection-${index}`, `publication-${index}`, `bundle-${index}`, publicId, JSON.stringify({ publicId }), `${index + 6}`.repeat(64), NOW);
  }
  applyInternalOperationMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8"));
  database.prepare("INSERT INTO route_registry VALUES(?,?,?,?,?,?,?,?,?)").run("model-backfill", "model", "model_https", "model_refine", "a".repeat(64), "b".repeat(64), "c".repeat(64), "active", 1);
  database.prepare("INSERT INTO budget_account VALUES(?,?,?,?,?,?)").run("budget-backfill", "model_tokens", 100, 0, 0, 1);
  applyXManualInboxMigration(database, readFileSync(`${APP_ROOT}/migrations/rss-real/0008_x_manual_inbox.sql`, "utf8"));
  database.close(); return path;
}

describe("0009 schema preflight and write boundary", () => {
  test("applies exact schema8 to schema9, verifies fingerprint, and replays idempotently", () => {
    const database = v8Database();
    const first = applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
    expect(first.applied).toBe(true);
    expect(first.replay).toBe(false);
    expect(database.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 9 });
    assertBilingualSchema(database);
    expect(database.prepare("SELECT enabled,status,reason_code FROM bilingual_authority_capability_v1").get()).toEqual({ enabled: 0, status: "closed", reason_code: "AUTHORITY_EXTENSION_REQUIRED" });
    const migration = readBilingualMigrationSql();
    expect(migration).toContain("CREATE TRIGGER bilingual_projection_transition_guard");
    expect(migration).toContain("CREATE TRIGGER bilingual_outbox_transition_guard");
    expect(migration).not.toContain("CREATE TRIGGER bilingual_projection_no_update");
    expect(migration).not.toContain("CREATE TRIGGER bilingual_outbox_no_update");
    expect(migration).toContain("bilingual_operation_link_candidate_language_attempt_v1");
    expect(migration).toContain("prior_language.attempt_number = NEW.attempt_number - 1");
    expect(migration).toContain("NEW.prompt_schema_version <> OLD.prompt_schema_version OR NEW.prompt_sha256 <> OLD.prompt_sha256");
    const replay = applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
    expect(replay).toMatchObject({ applied: false, replay: true, schemaFingerprintSha256: first.schemaFingerprintSha256 });
  });

  test("requires explicit apply and rejects schema8 drift before creating a target table", () => {
    const closed = v8Database();
    expect(() => applyBilingualMigration(closed, readBilingualMigrationSql())).toThrowError(expect.objectContaining({ code: "APPLY_DISABLED" }));
    const drifted = v8Database();
    drifted.exec("CREATE TABLE ql3_0009_unexpected_drift(marker INTEGER NOT NULL) STRICT");
    expect(() => applyBilingualMigration(drifted, readBilingualMigrationSql(), { applyEnabled: true })).toThrowError(expect.objectContaining({ code: "SCHEMA8_DRIFT" }));
    expect(drifted.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 8 });
    expect(drifted.prepare("SELECT 1 FROM sqlite_schema WHERE name='bilingual_bundle_v1'").get()).toBeUndefined();
  });

  test("rolls back the additive migration after a fault injected during target DDL", () => {
    const faulted = v8Database();
    const authorizable = faulted as AuthorizableDatabase;
    let denied = false;
    authorizable.setAuthorizer((action, arg1) => {
      if (action === SQLITE.SQLITE_CREATE_TABLE && arg1 === "bilingual_authority_capability_v1") {
        denied = true;
        return SQLITE.SQLITE_DENY;
      }
      return SQLITE.SQLITE_OK;
    });
    expect(() => applyBilingualMigration(faulted, readBilingualMigrationSql(), { applyEnabled: true })).toThrowError(expect.objectContaining({ code: "MIGRATION_FAILED" }));
    authorizable.setAuthorizer(null);
    expect(denied).toBe(true);
    expect(faulted.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 8 });
    expect(faulted.prepare("SELECT 1 FROM sqlite_schema WHERE name='bilingual_bundle_v1'").get()).toBeUndefined();
  });

  test("raw new-table insert, capability update, trigger drop and bare update stay denied", () => {
    const database = v8Database();
    applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
    expect(() => database.prepare("INSERT INTO bilingual_candidate_lineage_v1 (candidate_id,public_id,source_id,source_revision,input_content_hash,source_fact_set_hash,source_release_hash,copy_risk_status,rights_status,deletion_status,media_status,operation_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("candidate-bilingual-001", "public-bilingual-001", "motorsport-f1-news", 1, "1".repeat(64), "2".repeat(64), "3".repeat(64), "unknown", "unknown", "unknown", "unknown", "op-missing", NOW, NOW)).toThrow(/BILINGUAL_AUTHORITY_EXTENSION_REQUIRED/u);
    expect(() => database.prepare("UPDATE bilingual_authority_capability_v1 SET enabled=1,status='enabled',reason_code='READY',extension_sha256=? WHERE capability_id='bilingual-v1'").run(ZERO)).toThrow(/BILINGUAL_AUTHORITY_TRANSITION_INVALID/u);
    const authorizer = installSqliteAuthorizer(database, "public_or_browser");
    expect(() => database.exec("DROP TRIGGER bilingual_bundle_no_delete")).toThrow();
    authorizer.uninstall();
    expect(() => database.exec("UPDATE bilingual_authority_capability_v1 SET enabled=1 WHERE capability_id='bilingual-v1'")).toThrow();
    expect(database.prepare("SELECT enabled FROM bilingual_authority_capability_v1").get()).toMatchObject({ enabled: 0 });
  });
});

describe("bilingual independent slot and release state", () => {
  test("uses a two-operation acyclic combined parent carrier", () => {
    const pair = planBilingualRefinement("candidate-bilingual-001", 1, "1".repeat(64), 1);
    expect(pair.parent.operationId).toBe(pair.children[0].operationId);
    expect(pair.parent.idempotencyKey).toBe(pair.children[0].idempotencyKey);
    expect(pair.children[0]).toMatchObject({ language: "zh-CN", parentOperationId: pair.parent.operationId });
    expect(pair.children[1]).toMatchObject({ language: "en", parentOperationId: pair.parent.operationId });
    expect(pair.children[1].operationId).not.toBe(pair.parent.operationId);
    expect(new Set(pair.children.map((child) => child.operationId)).size).toBe(2);
  });
  test("keeps zh-CN/en independent and requires both complete slots for reviewable bundle", () => {
    const current = lineage();
    const slots = createInitialLanguageSlots(current, BILINGUAL_PROMPT_SCHEMA, "8".repeat(64), NOW);
    const pair = planBilingualRefinement(current.candidateId, current.sourceRevision, current.inputContentHash);
    expect(pair.children.map((child) => child.language)).toEqual(["zh-CN", "en"]);
    const zh = completeSlot(slots[0], pair.children[0].operationId, "zh-CN");
    expect(() => buildReviewableBundle(current, [zh, slots[1]], { "zh-CN": draft("zh-CN"), en: draft("en") }, 1, SAFETY)).toThrowError(expect.objectContaining({ code: "OUTPUT_INVALID" }));
    const en = completeSlot(slots[1], pair.children[1].operationId, "en");
    const bundle = buildReviewableBundle(current, [zh, en], { "zh-CN": draft("zh-CN"), en: draft("en") }, 1, SAFETY);
    expect(bundle.state).toBe("reviewable");
    expect(bundle.zh.language).toBe("zh-CN");
    expect(bundle.en.language).toBe("en");
  });

  test("enforces retry, reconcile, source drift and attempt cap semantics", () => {
    const slots = createInitialLanguageSlots(lineage(), BILINGUAL_PROMPT_SCHEMA, "8".repeat(64), NOW);
    expect(() => transitionLanguageSlot(slots[0], "running", { operationId: "op", now: NOW })).toThrowError(expect.objectContaining({ code: "OUTPUT_INVALID" }));
    const queued = transitionLanguageSlot(slots[0], "queued", { operationId: "op", now: after(slots[0]), newOperation: true });
    const failed = transitionLanguageSlot(queued, "failed", { operationId: "op", now: after(queued), failureReason: "MODEL_ROUTE_UNAVAILABLE" });
    expect(() => transitionLanguageSlot(failed, "queued", { operationId: "op", now: after(failed) })).toThrowError();
    const retried = transitionLanguageSlot(failed, "queued", { operationId: "op-retry", now: after(failed), newOperation: true });
    const reconcile = transitionLanguageSlot(retried, "running", { operationId: "op-retry", now: after(retried), attemptId: "attempt-retry" });
    expect(() => transitionLanguageSlot(reconcile, "complete", { operationId: "op-retry", now: after(reconcile) })).toThrowError();
    expect(() => transitionLanguageSlot(reconcile, "reconcile_required", { operationId: "op-retry", now: after(reconcile), failureReason: null })).toThrowError(expect.objectContaining({ code: "RECONCILE_REQUIRED" }));
    expect(transitionLanguageSlot(reconcile, "failed", { operationId: "op-retry", now: after(reconcile), sameAttemptReceipt: true, failureReason: "RECONCILE_REQUIRED" }).state).toBe("failed");
    const complete = completeSlot(slots[1], "op-complete", "en");
    const completeDraftHash = complete.draftHash;
    const directRerun = transitionLanguageSlot(complete, "queued", { operationId: "op-complete-rerun", now: "2026-08-24T12:00:00.500Z", newOperation: true });
    expect(directRerun).toMatchObject({ state: "queued", operationId: "op-complete-rerun", currentAttemptId: null, draftHash: null });
    expect(complete).toMatchObject({ state: "complete", operationId: "op-complete", draftHash: completeDraftHash });
    expect(() => transitionLanguageSlot(complete, "queued", { operationId: "op-source-drift", now: "2026-08-24T12:00:00.600Z", newOperation: true, sourceRevision: 2 })).toThrowError(expect.objectContaining({ code: "SOURCE_DRIFT" }));
    const stale = transitionLanguageSlot(complete, "stale", { operationId: "op-stale", now: "2026-08-24T12:00:01.000Z", newOperation: true });
    expect(stale).toMatchObject({ state: "stale", currentAttemptId: "en-attempt", draftHash: null });
    expect(transitionLanguageSlot(stale, "queued", { operationId: "op-rerun", now: "2026-08-24T12:00:02.000Z", newOperation: true, sourceRevision: 2, inputContentHash: "9".repeat(64), sourceFactSetHash: stale.sourceFactSetHash, sourceReleaseHash: stale.sourceReleaseHash, promptSchemaVersion: stale.promptSchemaVersion, promptSha256: stale.promptSha256 })).toMatchObject({ state: "queued", currentAttemptId: null, sourceRevision: 2 });
    expect(() => planBilingualRefinement("candidate-bilingual-001", 1, "1".repeat(64), 4)).toThrowError(expect.objectContaining({ code: "ATTEMPT_LIMIT" }));
  });

  test("screens copy risk and excludes source/raw fields from strict draft/public output", () => {
    const source = "A supplied source sentence records the exact setup change before qualifying and repeats the complete order for the weekend comparison.";
    expect(screenCopyRisk({ ...draft("en"), lead: source }, source).status).toBe("blocked");
    const value = draft("en");
    const raw = JSON.stringify(value);
    expect(parseLocalizedDraft(raw, "en", "Short evidence.").language).toBe("en");
    const forbidden = JSON.parse(raw) as Record<string, unknown>;
    forbidden.rawSource = "must not pass";
    expect(() => parseLocalizedDraft(JSON.stringify(forbidden), "en")).toThrowError(expect.objectContaining({ code: "OUTPUT_INVALID" }));
  });

  test("requires manual approval before publication and preserves public LKG on CAS conflict", () => {
    const current = lineage();
    const slots = createInitialLanguageSlots(current, BILINGUAL_PROMPT_SCHEMA, "8".repeat(64), NOW);
    const pair = planBilingualRefinement(current.candidateId, 1, current.inputContentHash);
    const bundle = buildReviewableBundle(current, [completeSlot(slots[0], pair.children[0].operationId, "zh-CN"), completeSlot(slots[1], pair.children[1].operationId, "en")], { "zh-CN": draft("zh-CN"), en: draft("en") }, 1, SAFETY);
    expect(() => buildManualApproval(bundle, "approved", "system-auto-review-v1", "op", NOW)).toThrowError(expect.objectContaining({ code: "AUTO_REVIEW_DISABLED" }));
    const approval = buildManualApproval(bundle, "approved", "operator-local", "review-op", NOW);
    const publication = buildQueuedPublication(bundle, approval, "9".repeat(64), 1, "publish-op", NOW);
    const publishing = transitionPublication(publication, "publishing", "2026-08-24T12:00:01.000Z");
    const currentPublished = transitionPublication(publishing, "published", "2026-08-24T12:00:02.000Z");
    expect(currentPublished.status).toBe("published");
    const publicPayload = buildPublicV2(bundle, current, NOW, "generation-1", "a".repeat(64));
    expect(publicPayload.schemaVersion).toBe("public-read-bilingual-v2");
    expect(publicPayload.localized["zh-CN"]).not.toHaveProperty("schemaVersion");
    expect(publicPayload.localized.en).not.toHaveProperty("language");
    expect(typeof publicPayload.localized.en.body).toBe("string");
    const pointer = compareAndSwapActivePointer(null, { publicId: current.publicId, projectionId: "projection-1", generation: 1, schemaVersion: "public-read-bilingual-v2", releaseSha256: "d".repeat(64), manifestSha256: "e".repeat(64), projectionHash: "a".repeat(64), pointerVersion: 1, operationId: "activate-op", status: "active", updatedAt: NOW }, { publicId: current.publicId, pointerVersion: 0, generation: 0, schemaVersion: "public-read-bilingual-v2", releaseSha256: "d".repeat(64), manifestSha256: "e".repeat(64), projectionHash: null });
    expect(pointer.pointerVersion).toBe(1);
    expect(() => compareAndSwapActivePointer(pointer, { ...pointer, publicId: "public-other", projectionId: "projection-other", generation: 2, projectionHash: "f".repeat(64), pointerVersion: 2 }, { publicId: current.publicId, pointerVersion: 1, generation: 1, schemaVersion: "public-read-bilingual-v2", releaseSha256: "d".repeat(64), manifestSha256: "e".repeat(64), projectionHash: "a".repeat(64) })).toThrowError(expect.objectContaining({ code: "CAS_CONFLICT" }));
    expect(() => compareAndSwapActivePointer(pointer, { ...pointer, projectionId: "projection-2", generation: 2, projectionHash: "b".repeat(64), pointerVersion: 2 }, { publicId: current.publicId, pointerVersion: 0, generation: 0, schemaVersion: "public-read-bilingual-v2", releaseSha256: "d".repeat(64), manifestSha256: "e".repeat(64), projectionHash: null })).toThrowError(expect.objectContaining({ code: "CAS_CONFLICT" }));
    const delivery = createDelivery(publication.publicationId, "projection-1", 1, "a".repeat(64), "delivery-op", NOW);
    const leased = transitionDelivery(delivery, { state: "leased", operationId: "delivery-op", now: "2026-08-24T12:00:01.000Z", leaseToken: "l".repeat(43), leaseExpiresAt: "2026-08-24T12:01:01.000Z" });
    expect(transitionDelivery(leased, { state: "reconcile_required", operationId: "delivery-op", now: "2026-08-24T12:00:02.000Z", reasonCode: "RESPONSE_LOST" })).toMatchObject({ state: "reconcile_required", attemptCount: 1, leaseToken: null });
    const singleAttempt = createDelivery(publication.publicationId, "projection-limit", 2, "f".repeat(64), "delivery-limit-op", NOW, 1);
    const singleLeased = transitionDelivery(singleAttempt, { state: "leased", operationId: "delivery-limit-op", now: "2026-08-24T12:00:01.000Z", leaseToken: "m".repeat(43), leaseExpiresAt: "2026-08-24T12:01:01.000Z" });
    const singleExpired = transitionDelivery(singleLeased, { state: "pending", operationId: "delivery-limit-retry", now: "2026-08-24T12:01:01.000Z", reasonCode: "LEASE_EXPIRED" });
    expect(() => transitionDelivery(singleExpired, { state: "leased", operationId: "delivery-limit-retry", now: "2026-08-24T12:01:02.000Z", leaseToken: "n".repeat(43), leaseExpiresAt: "2026-08-24T12:02:02.000Z" })).toThrowError(expect.objectContaining({ code: "OUTPUT_INVALID" }));
    const replacementBundle = buildReviewableBundle(current, [completeSlot(slots[0], pair.children[0].operationId, "zh-CN"), completeSlot(slots[1], pair.children[1].operationId, "en")], { "zh-CN": draft("zh-CN"), en: draft("en") }, 10, SAFETY);
    const replacementApproval = buildManualApproval(replacementBundle, "manual_override", "operator-local", "review-op-2", NOW);
    expect(buildCorrectionPublication(currentPublished, replacementBundle, replacementApproval, "b".repeat(64), "correct-op", "2026-08-24T12:00:03.000Z")).toMatchObject({ status: "correction_queued", revision: 2 });
    const correction = buildCorrectionPublication(currentPublished, replacementBundle, replacementApproval, "b".repeat(64), "correct-op", "2026-08-24T12:00:03.000Z");
    const correctionFailed = transitionPublication(correction, "failed", "2026-08-24T12:00:04.000Z");
    expect(retryFailedPublication(correctionFailed, "correct-retry-op", "2026-08-24T12:00:05.000Z")).toMatchObject({ status: "correction_queued", revision: 2, operationId: "correct-retry-op" });
    const rejectedApproval = { ...replacementApproval, decision: "rejected" as const };
    expect(() => buildCorrectionPublication(currentPublished, replacementBundle, rejectedApproval, "b".repeat(64), "correct-op", "2026-08-24T12:00:03.000Z")).toThrowError(expect.objectContaining({ code: "PUBLICATION_FENCE" }));
    const withdrawal = buildWithdrawalPublication(currentPublished, "c".repeat(64), "withdraw-op", "2026-08-24T12:00:03.000Z");
    expect(withdrawal).toMatchObject({ status: "withdrawal_queued", revision: 2, bundleId: currentPublished.bundleId, supersedesPublicationId: currentPublished.publicationId });
    const withdrawalPublishing = transitionPublication(withdrawal, "publishing", "2026-08-24T12:00:04.000Z");
    const withdrawalReconcile = transitionPublication(withdrawalPublishing, "reconcile_required", "2026-08-24T12:00:05.000Z");
    expect(transitionPublication(withdrawalReconcile, "withdrawn", "2026-08-24T12:00:06.000Z").status).toBe("withdrawn");
  });

  test("queries recent three from one existing-only schema8 DB and applies per-item CAS transactions", () => {
    const sourcePath = existingV8File();
    const selection = queryRecentThreeFromExistingOnly({ sourceDatabasePath: sourcePath, routeId: "model-backfill", budgetAccountId: "budget-backfill", promptSchemaVersion: BILINGUAL_PROMPT_SCHEMA, promptSha256: "8".repeat(64), operationId: "backfill-query", queriedAt: NOW });
    expect(selection.items.map((item) => item.candidateId)).toEqual(["candidate-backfill-3", "candidate-backfill-2", "candidate-backfill-1"]);
    expect(selection.receipt.database.schemaFingerprint).toBe("db788b873d903f4a7224061a7c4628954244790d4d5794aa98ad07e746cabfc5");
    const sourceBytesBeforeAliasAttempt = sha256(readFileSync(sourcePath));
    expect(() => applyRecentThreeToDisposable(selection, sourcePath)).toThrow("BACKFILL_SOURCE_TARGET_ALIAS_FORBIDDEN");
    expect(sha256(readFileSync(sourcePath))).toBe(sourceBytesBeforeAliasAttempt);
    const sourceAfterAliasAttempt = new DatabaseSync(sourcePath, { readOnly: true });
    expect(sourceAfterAliasAttempt.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name LIKE 'bilingual_backfill_%'").get()).toEqual({ count: 0 });
    sourceAfterAliasAttempt.close();
    expect(() => queryRecentThreeFromExistingOnly({ sourceDatabasePath: existingV8File(false), routeId: "model-backfill", budgetAccountId: "budget-backfill", promptSchemaVersion: BILINGUAL_PROMPT_SCHEMA, promptSha256: "8".repeat(64), operationId: "backfill-disabled-source", queriedAt: NOW })).toThrow("BACKFILL_EXACTLY_THREE_REQUIRED");
    expect(() => applyRecentThreeToDisposable({ ...selection }, join(mkdtempSync(join(realpathSync(tmpdir()), "bilingual-r2-forged-")), "apply.sqlite"))).toThrow("BACKFILL_CALLER_FIXTURE_FORBIDDEN");
    const disposablePath = join(mkdtempSync(join(realpathSync(tmpdir()), "bilingual-r2-apply-")), "apply.sqlite");
    expect(applyRecentThreeToDisposable(selection, disposablePath).every((item) => item.committed && !item.replay)).toBe(true);
    expect(applyRecentThreeToDisposable(selection, disposablePath).every((item) => item.committed && item.replay)).toBe(true);
    const corruptPath = join(mkdtempSync(join(realpathSync(tmpdir()), "bilingual-r2-corrupt-")), "apply.sqlite");
    applyRecentThreeToDisposable(selection, corruptPath);
    const corruptDb = new DatabaseSync(corruptPath);
    expect(() => corruptDb.exec("DELETE FROM bilingual_backfill_attempt")).toThrow("BACKFILL_DISPOSABLE_IMMUTABLE");
    corruptDb.exec("DROP TRIGGER bilingual_backfill_attempt_no_delete; DELETE FROM bilingual_backfill_attempt WHERE attempt_id=(SELECT attempt_id FROM bilingual_backfill_attempt ORDER BY attempt_id LIMIT 1); CREATE TRIGGER bilingual_backfill_attempt_no_delete BEFORE DELETE ON bilingual_backfill_attempt BEGIN SELECT RAISE(ABORT,'BACKFILL_DISPOSABLE_IMMUTABLE'); END;");
    corruptDb.close();
    expect(() => applyRecentThreeToDisposable(selection, corruptPath)).toThrow("BACKFILL_REPLAY_RECEIPT_DRIFT");
    const failurePath = join(mkdtempSync(join(realpathSync(tmpdir()), "bilingual-r2-fail-")), "apply.sqlite");
    const failure = applyRecentThreeToDisposable(selection, failurePath, { failCandidateId: selection.items[1].candidateId });
    expect(failure).toMatchObject([{ committed: true }, { committed: false }, { committed: true }]);
    const failureDb = new DatabaseSync(failurePath, { readOnly: true });
    expect(failureDb.prepare("SELECT count(*) AS count FROM bilingual_backfill_operation").get()).toEqual({ count: 2 });
    expect(failureDb.prepare("SELECT count(*) AS count FROM bilingual_backfill_attempt").get()).toEqual({ count: 4 });
    failureDb.close();
  });
});

describe("bilingual worker closed boundary", () => {
  test("does not call the model before authority extension and never auto-reviews or auto-publishes", async () => {
    let calls = 0;
    const result = await runBilingualRefinement({
      lineage: lineage(),
      promptSha256: "8".repeat(64),
      now: NOW,
      gateway: {
        plan(input, operationId, parentOperationId, attemptNumber) { return modelPlan(operationId, parentOperationId, input.language, attemptNumber); },
        async execute() { calls += 1; throw new Error("must not call while closed"); }
      }
    });
    expect(result).toMatchObject({ status: "closed", externalCalls: 0, writesToBase: false });
    expect(calls).toBe(0);
    await expect(import("../server/rss/bilingual-worker.ts").then(({ automaticReview }) => automaticReview())).rejects.toMatchObject({ code: "AUTO_REVIEW_DISABLED" });
    await expect(import("../server/rss/bilingual-worker.ts").then(({ automaticPublish }) => automaticPublish())).rejects.toMatchObject({ code: "AUTO_PUBLISH_DISABLED" });
  });

  test("with an explicitly injected authority, calls zh/en independently and keeps one failure isolated", async () => {
    const current = lineage();
    let calls = 0;
    const generated = (language: "zh-CN" | "en") => {
      const content = draft(language);
      return { rawJson: JSON.stringify(content), route: { routeRef: "test-route", providerId: "test-provider", modelId: "test-model", promptSchemaVersion: BILINGUAL_PROMPT_SCHEMA, promptSha256: "8".repeat(64), receiptHash: "a".repeat(64), releaseSha256: "c".repeat(64), manifestSha256: "d".repeat(64) }, budget: { reservationId: `budget-${language}`, units: 1, currency: "USD", receiptHash: "b".repeat(64) }, externalCalls: 1 as const, response: { providerResourceIdentity: "test-model", providerStatus: "200", responseBodySha256: "6".repeat(64), responseHeaderHashes: [], outcome: "succeeded" as const, reasonCode: null } };
    };
    const result = await runBilingualRefinement({
      lineage: current,
      promptSha256: "8".repeat(64),
      now: NOW,
      gateway: {
        plan(input, operationId, parentOperationId, attemptNumber) { return modelPlan(operationId, parentOperationId, input.language, attemptNumber); },
        async execute(plan) { calls += 1; if (plan.language === "en") throw new BilingualContractError("COPY_RISK"); return generated(plan.language); }
      },
      mutationPort: {
        async beginRefinement({ plans }) {
          const admitted = (plan: BilingualLanguageAttemptPlan) => ({ operationId: plan.operationId, parentOperationId: plan.parentOperationId, attemptId: `attempt-${plan.language}`, attemptNumber: plan.attemptNumber, language: plan.language, canonicalRequestSha256: "1".repeat(64), requestFingerprintSha256: "2".repeat(64), fenceSetHash: "3".repeat(64), routeBindingHash: "4".repeat(64), budgetBindingHash: "5".repeat(64) });
          return { ok: true as const, externalModelAllowed: true as const, children: { "zh-CN": admitted(plans[0]), en: admitted(plans[1]) } };
        },
        async runLanguageAttempt(admission, execute) {
          try {
            const value = await execute();
            if (value.rawJson === null) throw new BilingualContractError("OUTPUT_INVALID");
            return { ok: true as const, status: "complete" as const, externalCalls: 1 as const, writesToBase: true as const, draft: parseLocalizedDraft(value.rawJson, admission.language, current.sourceExcerpt), routeReceiptHash: value.route.receiptHash, budgetReceiptHash: value.budget.receiptHash, attemptId: admission.attemptId };
          } catch (error) {
            return { ok: false as const, status: "failed" as const, reasonCode: error instanceof BilingualContractError ? error.code : "OUTPUT_INVALID" as const, externalCalls: 1 as const, writesToBase: false, attemptId: admission.attemptId };
          }
        }
      }
    });
    expect(calls).toBe(2);
    expect(result.externalCalls).toBe(2);
    expect(result.children["zh-CN"].status).toBe("complete");
    expect(result.children.en.reasonCode).toBe("COPY_RISK");
  });
});
