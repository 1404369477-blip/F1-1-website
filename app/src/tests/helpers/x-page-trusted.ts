// Synthetic file-backed module-contract fixture. It does not implement production
// gateway authorization, schema admission, browser capture or release validation.
import { generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { canonicalJson } from "../../server/db/profile.ts";
import { responseIdentityHash, type GatewayWriteInput, type StartedAttemptHandle } from "../../server/internal-operation/gateway.ts";
import type { GatewayMutationPort, GatewayMutationTransactionInput } from "../../server/internal-operation/mutation-port.ts";
import { X_PAGE_SELECTION } from "../../server/x-page/normalize.ts";
import { xCaptureSha256, xCaptureSigningBytes, type TrustedXCapture, type XCaptureDeploymentTrust, type XCaptureEvidencePort } from "../../server/x-page/trusted-capture.ts";
import { importTrustedXCapture, readReadyXPageSource, type XPageImportMutationPort, type XPageProducerReceipt, type XPageProducerReceiptLedger,
  type XPageCandidateVersion } from "../../server/x-page/trusted-importer.ts";

export const TEST_X_NOW = "2026-09-07T00:00:00.000Z";
export const TEST_X_OBSERVED = "2026-09-06T23:59:00.000Z";
export const testHash = (value: string) => xCaptureSha256(`synthetic-x-test:${value}`);

export function testXProducer() {
  const keys = generateKeyPairSync("ed25519");
  const trust: XCaptureDeploymentTrust = { schemaVersion: "x-page-deployment-trust-v1", deploymentManifestSha256: testHash("manifest"),
    producerId: "test-only-producer", keyId: "test-only-key", hostId: "test-only-host", publicKey: keys.publicKey,
    adapterSha256: testHash("adapter"), producerAdmissionReceiptSha256: testHash("admission"),
    authorizedAt: "2026-09-06T00:00:00.000Z", expiresAt: "2026-09-08T00:00:00.000Z", maxCaptureAgeMs: 3_600_000,
    sources: ["f1", "mclarenf1"].map(handle => ({ sourceId: `x_${handle}` as "x_f1" | "x_mclarenf1", identitySha256: testHash(handle),
      authorizationReceiptSha256: testHash(`${handle}-authorization`), sourcePolicySha256: testHash(`${handle}-policy`) })) };
  const resign = (capture: TrustedXCapture): TrustedXCapture => ({ ...structuredClone(capture),
    signature: sign(null, xCaptureSigningBytes(capture), keys.privateKey).toString("base64url") });
  function capture(options: { text?: string; receiptId?: string; author?: "f1" | "mclarenf1"; observedOn?: "f1" | "mclarenf1"; observedAt?: string; publishedAt?: string } = {}): TrustedXCapture {
    const author = options.author ?? "f1", observedOn = options.observedOn ?? author;
    const publishedAt = options.publishedAt ?? "2026-09-06T23:00:00.000Z";
    const observedAt = options.observedAt ?? TEST_X_OBSERVED;
    const statusId = ((BigInt(Date.parse(publishedAt)) - BigInt("1288834974657")) << BigInt(22)).toString();
    return resign({ schemaVersion: "x-page-trusted-capture-v1", post: {
      schemaVersion: "x-visible-post-v1", observedOnHandle: observedOn, pageUrl: `https://x.com/${observedOn}`, observedAt,
      statusUrl: `https://x.com/${author}/status/${statusId}`, authorHandle: author, authorDisplayName: author.toUpperCase(),
      publishedAt, text: options.text ?? "Synthetic original F1 post", textComplete: true,
      relations: { replyToStatusUrl: null, quotedStatusUrl: null, repostedByHandle: observedOn === author ? null : observedOn }, media: [],
    }, evidence: { schemaVersion: "x-page-producer-evidence-v1", evidenceClass: "producer_signed_visible_capture",
      receiptId: options.receiptId ?? "test-receipt-1", deploymentManifestSha256: trust.deploymentManifestSha256,
      producerId: trust.producerId, keyId: trust.keyId, hostId: trust.hostId, adapterSha256: trust.adapterSha256,
      producerAdmissionReceiptSha256: trust.producerAdmissionReceiptSha256, selectionSha256: X_PAGE_SELECTION.sha256,
      sourceId: `x_${author}`, sourceIdentitySha256: testHash(author), observedSourceId: `x_${observedOn}`, observedSourceIdentitySha256: testHash(observedOn),
      pageUrl: `https://x.com/${observedOn}`, observedAt, toolReceiptSha256: testHash(`tool:${options.receiptId ?? "1"}`),
      captureArtifactSha256: testHash(`artifact:${options.receiptId ?? "1"}`) }, signature: "a".repeat(86) });
  }
  const evidencePort: XCaptureEvidencePort = { verifyCaptureArtifacts: input => ({ schemaVersion: "x-page-capture-proof-v1",
    captureSha256: input.captureSha256, producerId: input.evidence.producerId, hostId: input.evidence.hostId,
    adapterSha256: input.evidence.adapterSha256, pageUrl: input.evidence.pageUrl, observedAt: input.evidence.observedAt,
    toolReceiptSha256: input.evidence.toolReceiptSha256, captureArtifactSha256: input.evidence.captureArtifactSha256,
    verifierReceiptSha256: testHash(`fixture-proof:${input.captureSha256}`) }) };
  return { trust, capture, resign, evidencePort, keys };
}

export function testXFileEnvironment() {
  const producer = testXProducer();
  const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-x-module-contract-"));
  chmodSync(root, 0o700);
  const path = join(root, "contract.sqlite");
  let database = new DatabaseSync(path);
  chmodSync(path, 0o600);
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE source(source_id TEXT PRIMARY KEY,source_kind TEXT,feed_url TEXT,enabled INTEGER,stop_epoch INTEGER);
    CREATE TABLE source_registry_v1(source_id TEXT PRIMARY KEY,source_kind TEXT,collection_mode TEXT,enabled INTEGER,lifecycle_status TEXT,source_stop_status TEXT,
      identity_status TEXT,identity_sha256 TEXT,adapter_status TEXT,adapter_authorization_status TEXT,platform_allowed TEXT,authorization_expires_at TEXT,
      revision INTEGER,source_config_epoch INTEGER,source_safety_epoch INTEGER,authorization_version INTEGER,policy_epoch INTEGER,recovery_epoch INTEGER);
    CREATE TABLE x_page_source_config_v1(source_id TEXT PRIMARY KEY,canonical_handle TEXT,identity_sha256 TEXT,authorization_expires_at TEXT,
      adapter_sha256 TEXT,authorization_receipt_sha256 TEXT,source_policy_sha256 TEXT,evidence_class TEXT,rights_status TEXT);
    CREATE TABLE internal_control(singleton_id INTEGER PRIMARY KEY,phase TEXT,global_stop_state TEXT,recovery_state TEXT,
      source_config_epoch INTEGER,source_safety_epoch INTEGER,authorization_version INTEGER,policy_epoch INTEGER,recovery_epoch INTEGER,writer_epoch INTEGER);
    INSERT INTO internal_control VALUES(1,'live','clear','ready',1,1,1,1,1,1);
    CREATE TABLE generic_fence_receipt(fence_receipt_id TEXT PRIMARY KEY,scope_kind TEXT,scope_id TEXT,fence_kind TEXT,state TEXT,
      reason_code TEXT,issued_by_operation_id TEXT,policy_epoch INTEGER,recovery_epoch INTEGER,writer_epoch INTEGER,observed_at TEXT);
    CREATE TABLE review_bundle(bundle_id TEXT PRIMARY KEY,candidate_id TEXT,source_revision INTEGER,source_payload_hash TEXT,bundle_revision INTEGER);
    CREATE TABLE publication(publication_id TEXT PRIMARY KEY,bundle_id TEXT);
    CREATE TABLE pending_review_candidate(candidate_id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES source(source_id),external_id TEXT,dedupe_key TEXT UNIQUE,
      canonical_url TEXT,title TEXT,excerpt TEXT,author TEXT,published_at TEXT,source_payload_hash TEXT,source_revision INTEGER,review_status TEXT,first_seen_at TEXT,last_seen_at TEXT);
    CREATE TABLE x_page_candidate_capture_v1(capture_id TEXT PRIMARY KEY,candidate_id TEXT REFERENCES pending_review_candidate(candidate_id),source_revision INTEGER,
      source_id TEXT REFERENCES source(source_id),status_id TEXT,author_handle TEXT,source_version_hash TEXT,complete_text TEXT,normalized_json TEXT,evidence_json TEXT,
      evidence_sha256 TEXT,observed_at TEXT,operation_id TEXT UNIQUE,UNIQUE(candidate_id,source_revision),UNIQUE(candidate_id,source_version_hash));
    CREATE TABLE test_producer_receipt(producer_id TEXT,receipt_id TEXT,receipt_json TEXT,PRIMARY KEY(producer_id,receipt_id));
    CREATE TABLE internal_operation(operation_id TEXT PRIMARY KEY,state TEXT,updated_at TEXT,owner_process TEXT,operation_kind TEXT,capability_class TEXT,
      egress_class TEXT,candidate_id TEXT,source_id TEXT,expected_entity_version INTEGER,expected_entity_hash TEXT,model_route_ref TEXT);
    CREATE TABLE internal_external_attempt(attempt_id TEXT PRIMARY KEY,operation_id TEXT UNIQUE,state TEXT,outcome TEXT,external_calls INTEGER,
      response_identity_sha256 TEXT,canonical_request_json TEXT,canonical_request_hash TEXT,route_id TEXT);
    CREATE TABLE machine_summary_draft(draft_id TEXT PRIMARY KEY,candidate_id TEXT,source_revision INTEGER,source_payload_hash TEXT,model TEXT,prompt_sha256 TEXT,
      response_sha256 TEXT,title_zh TEXT,summary_zh TEXT,key_points_zh_json TEXT,input_tokens INTEGER,output_tokens INTEGER,generated_at TEXT,
      UNIQUE(candidate_id,source_revision,source_payload_hash,model,prompt_sha256));
  `);
  for (const scope of producer.trust.sources) {
    const handle = scope.sourceId.slice(2);
    database.prepare("INSERT INTO source VALUES(?,'x_page',NULL,1,1)").run(scope.sourceId);
    database.prepare("INSERT INTO source_registry_v1 VALUES(?,'x_page','browser_visible_dom',1,'active','clear','verified',?,'ready','valid','allowed',?,1,1,1,1,1,1)")
      .run(scope.sourceId, scope.identitySha256, producer.trust.expiresAt);
    database.prepare("INSERT INTO x_page_source_config_v1 VALUES(?,?,?,?,?,?,?,'producer_signed_visible_capture','clear')")
      .run(scope.sourceId, handle, scope.identitySha256, producer.trust.expiresAt, producer.trust.adapterSha256, scope.authorizationReceiptSha256, scope.sourcePolicySha256);
  }
  let now = new Date(TEST_X_NOW), activeTransaction = false;
  const hooks: { beforeImport?: () => void; beforeReceipt?: () => void; beforeStore?: () => void; afterStoreWrite?: () => void;
    afterExternal?: () => void } = {};
  const imports: Array<Parameters<XPageImportMutationPort["runImportTransaction"]>[0]> = [];
  const stores: GatewayMutationTransactionInput[] = [];
  let externalCalls = 0;
  function atomic<T>(callback: () => T): T {
    if (activeTransaction) return callback();
    database.exec("BEGIN IMMEDIATE"); activeTransaction = true;
    try { const result = callback(); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
    finally { activeTransaction = false; }
  }
  function mutate(operation: GatewayMutationTransactionInput, write: GatewayWriteInput): number {
    if (!operation.entitySet.some(binding => binding.entityKind === write.entityKind && binding.entityId === write.entityId)) throw new Error("TEST_UNDECLARED_ENTITY");
    return Number(database.prepare(write.statement).run(...(write.parameters ?? []) as SQLInputValue[]).changes);
  }
  const receiptLedger: XPageProducerReceiptLedger = { read: (producerId, receiptId) => {
    const row = database.prepare("SELECT receipt_json FROM test_producer_receipt WHERE producer_id=? AND receipt_id=?").get(producerId, receiptId);
    return row ? JSON.parse(String(row.receipt_json)) : null;
  } };
  const gatewayPort: XPageImportMutationPort = {
    runAtomicAdmission: atomic,
    runImportTransaction: (input, callback) => atomic(() => {
      imports.push(input); hooks.beforeImport?.();
      const result = callback(write => mutate(input.operation, write));
      hooks.beforeReceipt?.();
      database.prepare("INSERT INTO test_producer_receipt VALUES(?,?,?)").run(input.receiptClaim.producerId, input.receiptClaim.receiptId, canonicalJson(input.receiptClaim));
      return result;
    }),
  };
  const mutationPort: Required<Pick<GatewayMutationPort, "runTransaction">> = { runTransaction: (operation, callback) => atomic(() => {
    stores.push(operation); hooks.beforeStore?.();
    const result = callback(write => { const changed = mutate(operation, write); hooks.afterStoreWrite?.(); return changed; });
    return result;
  }) };
  const externalPort: Required<Pick<GatewayMutationPort, "runExternal">> = { runExternal: async input => {
    externalCalls += 1;
    const attemptId = `attempt-${input.operationId}`;
    const request = { bodySha256: input.bodySha256, providerResource: input.providerResource };
    const requestHash = xCaptureSha256(canonicalJson(request));
    database.prepare("INSERT INTO internal_operation VALUES(?,'in_flight',?,?,?,?,?,?,?,?,?,?)").run(input.operationId, now.toISOString(),
      input.ownerProcess!, input.operationKind, "external_attempt", input.egressClass!, input.identity.candidateId, input.identity.sourceId,
      input.expectedVersion!, input.expectedHash!, input.modelRouteRef!);
    database.prepare("INSERT INTO internal_external_attempt VALUES(?,?,'started','pending',1,NULL,?,?,?)")
      .run(attemptId, input.operationId, canonicalJson(request), requestHash, input.routeId);
    const handle = { attemptId, operationId: input.operationId, canonicalRequestSha256: requestHash } as StartedAttemptHandle;
    try {
      const result = await input.execute(handle);
      database.prepare("UPDATE internal_external_attempt SET state='response_committed',outcome=?,response_identity_sha256=? WHERE operation_id=?")
        .run(result.response.outcome, responseIdentityHash(handle, result.response), input.operationId);
      database.prepare("UPDATE internal_operation SET state=?,updated_at=? WHERE operation_id=?")
        .run(result.response.outcome === "succeeded" ? "succeeded" : "terminal_failed", now.toISOString(), input.operationId);
      hooks.afterExternal?.();
      return result.value;
    } catch (error) {
      database.prepare("UPDATE internal_external_attempt SET state='reconcile_required',outcome='unknown' WHERE operation_id=?").run(input.operationId);
      database.prepare("UPDATE internal_operation SET state='reconcile_required',updated_at=? WHERE operation_id=?").run(now.toISOString(), input.operationId);
      throw error;
    }
  } };
  const env = { ...producer, root, path, get database() { return database; }, receiptLedger, gatewayPort, mutationPort, externalPort, hooks, imports, stores,
    now: () => new Date(now), advance: (milliseconds: number) => { now = new Date(now.getTime() + milliseconds); },
    get externalCalls() { return externalCalls; },
    reopen: () => { database.close(); database = new DatabaseSync(path); database.exec("PRAGMA foreign_keys=ON"); },
    cleanup: () => { database.close(); rmSync(root, { recursive: true, force: true }); },
    import: (capture: TrustedXCapture, operationId = `import-${capture.evidence.receiptId}`, expectedCandidate: XPageCandidateVersion | null = null) => importTrustedXCapture({
      database, gatewayPort, receiptLedger, evidencePort: producer.evidencePort, capture, trust: producer.trust,
      expectedSourceIdentity: readReadyXPageSource(database, producer.trust, capture.evidence.sourceId, now), expectedCandidate, operationId, now: () => new Date(now),
    }),
    savedReceipt: (capture: TrustedXCapture) => receiptLedger.read(capture.evidence.producerId, capture.evidence.receiptId) as XPageProducerReceipt | null,
  };
  return env;
}

export function testChineseCompletion() {
  return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ titleZh: "车队公布测试安排", summaryZh: "车队表示将按计划进行测试。",
    keyPointsZh: ["车队公布测试安排"] }) } }], usage: { prompt_tokens: 180, completion_tokens: 85 } });
}
