import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";
import { inspectExistingPrivateDatabase, openExistingSafeDatabase } from "../server/db/database.ts";
import { SqliteInternalOperationGateway, type OwnerProcess, type ControlAction } from "../server/internal-operation/gateway.ts";
import { SqliteGatewayMutationPort } from "../server/internal-operation/mutation-port.ts";
import { persistOwnerSupervisorHandoff } from "../server/internal-operation/owner-supervisor.ts";
import { applyXPageCloneMigration, xPageHash, type XPageCloneManifest } from "../server/x-page/migration.ts";
import { assertSourceRegistrySchema } from "../server/rss/source-registry-migration.ts";
import { X_PAGE_SCHEMA_SHA256 } from "../server/x-page/schema-identity.ts";
import { importCapturedXPost, readXPageCompleteInput, readXPageSourceIdentity, type XPageCapture, type XPageExpectedCandidate } from "../server/x-page/bridge.ts";
import { refineOneCandidate } from "../server/rss/refinement.ts";
import { readSourceDetail, sourceIdentity, canAutoCollect } from "../server/rss/source-registry.ts";
import { X_PAGE_SELECTION } from "../server/x-page/normalize.ts";
import { xPageSchema12 } from "./helpers/x-page-database.ts";

const NOW = "2026-09-07T00:00:00.000Z";
const ZERO = "0".repeat(64);
const manifest: XPageCloneManifest = { schemaVersion: "x-page-clone-migration-v1", evidenceClass: "synthetic_clone", appliedAt: NOW,
 authorizationExpiresAt: "2027-09-07T00:00:00.000Z", selectionSha256: X_PAGE_SELECTION.sha256,
 adapterSha256: xPageHash("synthetic adapter"), authorizationReceiptSha256: xPageHash("synthetic authorization"), sourcePolicySha256: xPageHash("synthetic source policy") };
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function clone(withHistory = false): DatabaseSync {
 const database = xPageSchema12(withHistory);
 cleanups.push(() => database.close());
 return database;
}
async function ready() {
 const memory = clone();
 applyXPageCloneMigration(memory, manifest);
 const root = mkdtempSync(join(realpathSync(tmpdir()), "x-page-clone-"));
 const path = join(root, "clone.sqlite");
 await backup(memory, path);
 chmodSync(path, 0o600);
 const database = openExistingSafeDatabase(path, "clone.sqlite", inspectExistingPrivateDatabase(path, "clone.sqlite"), [11]);
 cleanups.push(() => { database.close(); rmSync(root, { recursive: true, force: true }); });
 const handoffs = new Map<string, Array<Parameters<typeof persistOwnerSupervisorHandoff>[1]>>();
 for (const owner of ["admin_http", "system_supervisor", "restore_operator", "x_page_importer", "automatic_reviewer", "rss_collector"] as const) {
  const values = [];
  for (let i = 0; i < 24; i++) {
   const id = `test-${owner}-${i}`;
   const value = { handoffId: id, ownerProcess: owner, issuer: "f1plus1-owner-supervisor-v1" as const,
    oneTimeNonce: createHash("sha256").update(id).digest("base64url"), releaseSha256: ZERO, manifestSha256: ZERO,
    receiptSha256: xPageHash(id), verifiedAt: NOW, expiresAt: "2027-09-07T00:00:00.000Z" };
   persistOwnerSupervisorHandoff(database, value, () => true); // Explicit synthetic supervisor verifier, test only.
   values.push(value);
  }
  handoffs.set(owner, values);
 }
 const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: ZERO, manifestSha256: ZERO, schemaSha256: X_PAGE_SCHEMA_SHA256, now: () => new Date(NOW) });
 cleanups.push(() => gateway.close());
 function port(owner: OwnerProcess) {
  return new SqliteGatewayMutationPort({ database, gateway, ownerProcess: owner, handoffProvider: () => {
   const result = handoffs.get(owner)?.shift(); if (!result) throw new Error("TEST_HANDOFF_EXHAUSTED"); return result;
  }, now: () => new Date(NOW) });
 }
 const admin = port("admin_http");
 admin.transitionAuthority({ operationId: "authority-x-clone", idempotencyKey: "authority-x-clone", capabilityId: "source_registry_management", action: "enable",
  expectedVersion: 2, requestHash: xPageHash("authority request"), authorityReceiptSha256: xPageHash("authority receipt") });
 let index = 0;
 function control(owner: OwnerProcess, action: ControlAction, assignment: string) {
  const current = database.prepare("SELECT * FROM internal_control").get()!;
  const id = `test-control-${++index}`;
  const restore = owner !== "admin_http";
  const capability = gateway.authorize(gateway.request(handoffs.get(owner)!.shift()!, {
   schemaVersion: "operation-request-v1", operationId: id, idempotencyKey: id, operationKind: restore ? "restore" : "phase_control", ownerProcess: owner,
   capabilityClass: restore ? "restore" : "control", policyId: restore ? `p-${owner === "system_supervisor" ? "supervisor-restore" : "restore-control"}-${current.phase}` : `p-phase-control-${current.phase}`,
   authorizationHandoffId: `test-${owner}-${24 - handoffs.get(owner)!.length - 1}`, controlAction: action,
   identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
   entitySet: [{ entityKind: "internal_control", entityId: "1", identitySelector: "control_singleton", expectedVersion: null, expectedHash: ZERO }], requiredFenceSet: [],
   expected: { controlVersion: Number(current.version), entityVersion: null, entityHash: ZERO, schemaSha256: X_PAGE_SCHEMA_SHA256, releaseSha256: ZERO, manifestSha256: ZERO,
    sourceStopEpoch: null, writerEpoch: Number(current.writer_epoch), epochs: { sourceConfig: Number(current.source_config_epoch), sourceSafety: Number(current.source_safety_epoch),
     authorization: Number(current.authorization_version), policy: Number(current.policy_epoch), recovery: Number(current.recovery_epoch) } },
   phase: current.phase as "disabled", egressClass: "none", budgetRequest: null, modelRouteRef: null, requestHash: xPageHash(id), requestFingerprint: xPageHash([id])
  }));
  // Control transitions change epochs, so use the established control permit path.
  const permit = gateway.authorizeWrite(capability, { entityKind: "internal_control", entityId: "1", mutationKind: "update", expectedVersion: null, expectedHash: ZERO });
  gateway.mutate(permit, { entityKind: "internal_control", entityId: "1", mutationKind: "update", statement: `UPDATE internal_control SET ${assignment},version=version+1,updated_by_operation_id=? WHERE singleton_id=1`, parameters: [id] });
  gateway.postcheckFenceSet(capability);
 }
 control("restore_operator", "recovery_advance", "recovery_state='restoring'");
 control("restore_operator", "recovery_advance", "recovery_state='verifying'");
 control("system_supervisor", "writer_epoch_bump", `recovery_epoch=2,writer_epoch=2,writer_authority_receipt_sha256='${"1".repeat(64)}'`);
 control("system_supervisor", "recovery_complete", "recovery_state='ready'");
 control("admin_http", "clear_global_stop", "global_stop_state='clear'");
 control("admin_http", "pause", "phase='paused'");
 for (const sourceId of ["x_f1", "x_mclarenf1"]) admin.mutateSourceRegistry({ operationId: `enable-${sourceId}`, sourceId, action: "enable", expectedRevision: 2, reasonCode: "OPERATOR_REQUEST" });
 control("admin_http", "enter_live", "phase='live'");
 return { database, gateway, port, admin, control, importer: port("x_page_importer") };
}
function capture(text = "Synthetic F1 testing post", observedAt = "2026-09-06T23:59:00.000Z", author = "f1"): XPageCapture {
 const publishedAt = "2026-09-06T23:00:00.000Z";
 const statusId = ((BigInt(Date.parse(publishedAt)) - BigInt("1288834974657")) << BigInt(22)).toString();
 const pagePost = { schemaVersion: "x-visible-post-v1" as const, source: { handle: author, enabled: false, identityStatus: "unknown" as const },
  pageUrl: `https://x.com/${author}`, observedAt, statusUrl: `https://x.com/${author}/status/${statusId}`, authorHandle: author,
  authorDisplayName: author.toUpperCase(), publishedAt, text, textComplete: true,
  relations: { replyToStatusUrl: null, quotedStatusUrl: null, repostedByHandle: null }, media: [] };
 const evidence = { schemaVersion: "x-page-capture-evidence-v1" as const, evidenceClass: "synthetic_clone" as const, toolFamily: "fixture" as const,
  instanceId: "synthetic-instance", host: "synthetic" as const, receiptSha256: xPageHash("synthetic browser receipt"), observedAt, pageUrl: pagePost.pageUrl };
 return { pagePost, evidence, evidenceSha256: xPageHash({ pagePost, evidence }) };
}
function importPost(env: Awaited<ReturnType<typeof ready>>, id: string, value = capture(), expectedCandidate: XPageExpectedCandidate = null) {
 return importCapturedXPost({ database: env.database, gatewayPort: env.importer, capture: value, expectedSourceIdentity: readXPageSourceIdentity(env.database, `x_${value.pagePost.authorHandle}`),
  expectedCandidate, operationId: id, now: new Date(NOW), verifyCaptureEvidence: () => true });
}

function durableState(database: DatabaseSync): string {
 return JSON.stringify(["pending_review_candidate", "x_page_candidate_capture_v1", "internal_operation", "internal_operation_audit", "gateway_write_permit", "owner_authorization_handoff", "review_bundle", "review_decision", "publication", "projection_outbox"].map(table => database.prepare(`SELECT * FROM ${table}`).all()));
}

describe("X page successor local clone", () => {
 test("migration preserves RSS, all 59 manual histories and control; only source capability is rebound closed", () => {
  const database = clone(true);
  const tables = ["source", "x_manual_source_registry", "x_manual_submission", "x_manual_audit", "pending_review_candidate", "review_bundle", "review_decision", "publication", "projection_outbox", "internal_control", "generic_fence_receipt", "backup_recovery_point", "projection_recovery_anchor"];
  const before = new Map(tables.map(table => [table, database.prepare(`SELECT * FROM ${table}`).all()]));
  for (const table of ["pending_review_candidate", "review_bundle", "review_decision", "publication", "projection_outbox"]) expect(before.get(table)!.length).toBeGreaterThan(0);
  const policies = database.prepare("SELECT * FROM internal_operation_policy ORDER BY policy_id").all();
  const otherCaps = database.prepare("SELECT * FROM quick_launch_authority_v2 WHERE capability_id<>'source_registry_management'").all();
  expect(applyXPageCloneMigration(database, manifest).applied).toBe(true);
  for (const table of tables) expect(database.prepare(`SELECT ${table === "source" ? "source_id,feed_url,enabled,stop_epoch,etag,last_modified,last_attempt_at,last_success_at,next_eligible_at,last_reason_code" : "*"} FROM ${table}${table === "source" ? " WHERE source_kind='rss'" : ""}`).all()).toEqual(before.get(table));
  expect(database.prepare("SELECT count(*) n FROM source WHERE source_kind='rss'").get()).toMatchObject({ n: 5 });
  expect(database.prepare("SELECT count(*) n FROM x_manual_source_registry").get()).toMatchObject({ n: 59 });
  expect(database.prepare("SELECT count(*) n FROM source WHERE source_kind='x_page' AND feed_url IS NULL AND enabled=0").get()).toMatchObject({ n: 27 });
  expect(database.prepare("SELECT * FROM quick_launch_authority_v2 WHERE capability_id<>'source_registry_management'").all()).toEqual(otherCaps);
  expect(database.prepare("SELECT * FROM quick_launch_authority_v2 WHERE capability_id='source_registry_management'").get()).toMatchObject({ state: "closed", version: 2, schema_sha256: X_PAGE_SCHEMA_SHA256 });
  expect(database.prepare("SELECT * FROM internal_operation_policy WHERE policy_id NOT LIKE 'p-x-page-%' ORDER BY policy_id").all()).toEqual(policies);
  expect(() => assertSourceRegistrySchema(database)).toThrow();
  expect(() => new SqliteInternalOperationGateway({ database, releaseSha256: ZERO, manifestSha256: ZERO })).toThrow("X_PAGE_SCHEMA_IDENTITY_REQUIRED");
  expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(applyXPageCloneMigration(database, manifest).applied).toBe(false);
 });
 test("created, duplicate, edited and old replay keep full revision history without publication", async () => {
  const env = await ready();
  const first = importPost(env, "import-first");
  expect(first.decision).toBe("created");
  const expected = { sourceRevision: first.sourceRevision, sourceVersionHash: first.sourceVersionHash };
  expect(importPost(env, "import-duplicate", capture(), expected).decision).toBe("duplicate");
  const edited = importPost(env, "import-edit", capture("Updated F1 post", "2026-09-06T23:59:30.000Z"), expected);
  expect(edited).toMatchObject({ decision: "updated", sourceRevision: 2 });
  expect(importPost(env, "import-old", capture(), { sourceRevision: edited.sourceRevision, sourceVersionHash: edited.sourceVersionHash })).toMatchObject({ decision: "duplicate", sourceRevision: 2, sourceVersionHash: edited.sourceVersionHash });
  expect(env.database.prepare("SELECT count(*) n FROM x_page_candidate_capture_v1").get()).toMatchObject({ n: 2 });
  expect(env.database.prepare("SELECT count(*) n FROM publication").get()).toMatchObject({ n: 0 });
  expect(env.database.prepare("SELECT count(*) n FROM internal_external_attempt").get()).toMatchObject({ n: 0 });
 });
 test("long Unicode body is retained outside preview and exact revision reader rejects stale input", async () => {
  const env = await ready(); const body = "赛车🏁".repeat(7000);
  const result = importPost(env, "long", capture(body));
  const expected = { sourceRevision: result.sourceRevision, sourceVersionHash: result.sourceVersionHash };
  expect(readXPageCompleteInput(env.database, result.candidateId, expected)).toBe(body);
  expect(Buffer.byteLength(String(env.database.prepare("SELECT excerpt FROM pending_review_candidate").get()!.excerpt))).toBeLessThan(16384);
  expect(() => readXPageCompleteInput(env.database, result.candidateId, { ...expected, sourceRevision: 2 })).toThrow("X_PAGE_REFINEMENT_INPUT_STALE");
 });
 test("same status with another selected author is rejected without successful audit or data residue", async () => {
  const env = await ready(); importPost(env, "original");
  const before = durableState(env.database);
  expect(() => importPost(env, "conflicting-author", capture("Pretended author", undefined, "mclarenf1"))).toThrow("X_PAGE_STATUS_AUTHOR_CONFLICT");
  expect(durableState(env.database)).toBe(before);
 });
 test.each(["hash", "unverified", "stale-source", "stale-candidate", "expired", "incomplete", "time-missing"])("%s input fails without residue", async failure => {
  const env = await ready(); const value = capture();
  const expectedSourceIdentity = readXPageSourceIdentity(env.database, "x_f1");
  const args = { database: env.database, gatewayPort: env.importer, capture: value, expectedSourceIdentity,
   expectedCandidate: null as XPageExpectedCandidate, operationId: `failure-${failure}`, now: new Date(NOW), verifyCaptureEvidence: () => true };
  if (failure === "hash") value.pagePost.text += " tamper";
  if (failure === "unverified") args.verifyCaptureEvidence = () => false;
  if (failure === "stale-source") args.expectedSourceIdentity = { ...expectedSourceIdentity, sourceConfigEpoch: 99 };
  if (failure === "stale-candidate") args.expectedCandidate = { sourceRevision: 1, sourceVersionHash: ZERO };
  if (failure === "expired") args.now = new Date("2028-01-01T00:00:00.000Z");
  if (failure === "incomplete" || failure === "time-missing") {
   if (failure === "incomplete") value.pagePost.textComplete = false;
   else value.pagePost.publishedAt = "";
   args.capture = { ...value, evidenceSha256: xPageHash({ pagePost: value.pagePost, evidence: value.evidence }) };
  }
  const before = durableState(env.database);
  expect(() => importCapturedXPost(args)).toThrow();
  expect(durableState(env.database)).toBe(before);
 });
 test("unknown earlier observation cannot roll an edited source backward", async () => {
  const env = await ready(); const first = importPost(env, "known-latest");
  const before = durableState(env.database);
  expect(() => importPost(env, "unknown-old", capture("previously unseen old body", "2026-09-06T23:58:00.000Z"), { sourceRevision: 1, sourceVersionHash: first.sourceVersionHash })).toThrow("X_PAGE_OBSERVATION_STALE");
  expect(durableState(env.database)).toBe(before);
 });
 test("capture write failure rolls back candidate, permits, handoff consumption and success audit", async () => {
  const env = await ready(); const run = env.importer.runTransaction.bind(env.importer);
  vi.spyOn(env.importer, "runTransaction").mockImplementation((input, callback) => run(input, mutate => callback(value => {
   if (value.entityKind === "x_page_capture") throw new Error("TEST_CAPTURE_STORAGE_FAILURE");
   return mutate(value);
  })));
  const before = durableState(env.database);
  expect(() => importPost(env, "capture-failure")).toThrow("TEST_CAPTURE_STORAGE_FAILURE");
  expect(durableState(env.database)).toBe(before);
 });
 test("candidate-only import cannot produce success without its complete capture", async () => {
  const env = await ready(); const run = env.importer.runTransaction.bind(env.importer);
  vi.spyOn(env.importer, "runTransaction").mockImplementation((input, callback) => run(input, mutate => callback(value => value.entityKind === "x_page_capture" ? 1 : mutate(value))));
  const before = durableState(env.database);
  expect(() => importPost(env, "capture-omitted")).toThrow("X_PAGE_IMPORT_CAPTURE_MISSING");
  expect(durableState(env.database)).toBe(before);
 });
 test("importer cannot set approved state, mutate capture history or obtain publication/projection permits", async () => {
  const env = await ready(); const run = env.importer.runTransaction.bind(env.importer);
  const spy = vi.spyOn(env.importer, "runTransaction").mockImplementation((input, callback) => run(input, mutate => callback(value => mutate({ ...value, statement: value.statement.replace("'pending_review'", "'approved'") }))));
  let before = durableState(env.database);
  expect(() => importPost(env, "approve-smuggle")).toThrow("X_PAGE_CANDIDATE_IMPORT_REQUIRED");
  expect(durableState(env.database)).toBe(before); spy.mockRestore();
  const created = importPost(env, "valid-before-attacks");
  expect(() => env.database.exec("UPDATE x_page_candidate_capture_v1 SET complete_text='replace'")).toThrow();
  const source = readXPageSourceIdentity(env.database, "x_f1");
  for (const entityKind of ["review_bundle", "publication", "published_projection"] as const) {
   before = durableState(env.database);
   expect(() => env.importer.runAtomicAdmission(() => env.importer.runTransaction({ operationId: `forbidden-${entityKind}`, operationKind: "collect", ownerProcess: "x_page_importer",
    policyId: "p-x-page-import-live", identity: { sourceId: "x_f1", candidateId: created.candidateId, publicationId: null, publicId: null }, sourceStopEpoch: source.stopEpoch,
    entitySet: [{ entityKind: "candidate", entityId: created.candidateId, identitySelector: "candidate_id", expectedVersion: 1, expectedHash: created.sourceVersionHash },
     { entityKind: "source", entityId: "x_f1", identitySelector: "source_id", expectedVersion: source.revision, expectedHash: source.identitySha256 },
     { entityKind, entityId: "smuggled-entity", identitySelector: "bound_child", expectedVersion: null, expectedHash: ZERO }]
   }, mutate => mutate({ entityKind, entityId: "smuggled-entity", mutationKind: "insert", expectedVersion: null, expectedHash: ZERO, statement: "INSERT INTO publication (publication_id) VALUES('smuggled-entity')" })))).toThrow();
   expect(durableState(env.database)).toBe(before);
  }
 });
 test("disabled source requires dedicated Admin permit to re-enable; importer and old source_update fail", async () => {
  const env = await ready(); const enabled = readXPageSourceIdentity(env.database, "x_f1");
  env.control("admin_http", "pause", "phase='paused'");
  const beforeRetire = durableState(env.database);
  expect(() => env.admin.mutateSourceRegistry({ operationId: "retire-not-supported", sourceId: "x_f1", expectedRevision: enabled.revision, action: "retire", reasonCode: "RETIREMENT" })).toThrow("X_PAGE_RETIRE_SUCCESSOR_REQUIRED");
  expect(durableState(env.database)).toBe(beforeRetire);
  env.admin.mutateSourceRegistry({ operationId: "disable-x", sourceId: "x_f1", expectedRevision: enabled.revision, action: "disable", reasonCode: "OPERATOR_REQUEST" });
  expect(env.database.prepare("SELECT enabled,stop_epoch FROM source WHERE source_id='x_f1'").get()).toMatchObject({ enabled: 0, stop_epoch: enabled.stopEpoch + 1 });
  const disabled = readXPageSourceIdentity(env.database, "x_f1");
  expect(() => env.importer.mutateSourceRegistry({ operationId: "self-enable", sourceId: "x_f1", expectedRevision: disabled.revision, action: "requeue", reasonCode: "OPERATOR_REQUEST" })).toThrow();
  expect(() => env.admin.mutate({ operationId: "legacy-enable", operationKind: "source_update", entityKind: "source", entityId: "x_f1", mutationKind: "update",
   identity: { sourceId: "x_f1", candidateId: null, publicationId: null, publicId: null }, sourceStopEpoch: disabled.stopEpoch,
   capabilityClass: "control", statement: "UPDATE source SET enabled=1 WHERE source_id=?", parameters: ["x_f1"] })).toThrow();
  const before = durableState(env.database);
  expect(() => importPost(env, "import-disabled")).toThrow("X_PAGE_SOURCE_DISABLED");
  expect(durableState(env.database)).toBe(before);
  env.admin.mutateSourceRegistry({ operationId: "requeue-x", sourceId: "x_f1", expectedRevision: disabled.revision, action: "requeue", reasonCode: "OPERATOR_REQUEST" });
  env.admin.mutateSourceRegistry({ operationId: "reenable-x", sourceId: "x_f1", expectedRevision: disabled.revision + 1, action: "enable", reasonCode: "OPERATOR_REQUEST" });
  env.control("admin_http", "enter_live", "phase='live'");
  expect(importPost(env, "after-reenable").decision).toBe("created");
 });
 test("legacy RSS refiner never selects X preview or starts a model request", async () => {
  const env = await ready(); importPost(env, "refinement-isolated");
  const result = await refineOneCandidate({ database: env.database, apiKeyPath: "/not-a-real-key", mutationPort: env.port("rss_collector"), fetchImpl: async () => { throw new Error("MODEL_MUST_NOT_RUN"); } });
  expect(result).toMatchObject({ status: "idle", externalCalls: 0 });
  const detail = readSourceDetail(env.database, "x_f1", NOW);
  expect(detail.source).toMatchObject({ sourceKind: "x_page", collectionMode: "browser_visible_dom", canonicalFeedUrl: null });
  expect(detail.config).toMatchObject({ evidence_class: "synthetic_clone", rights_status: "unknown", media_policy: "blocked" });
  expect(sourceIdentity(detail.source)).toBe(detail.source.identitySha256);
  expect(canAutoCollect(detail.source, detail.activationReadiness, detail.epochFences)).toBe(false);
 });

});
