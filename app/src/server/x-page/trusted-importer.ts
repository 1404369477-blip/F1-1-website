import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import type { EntityBinding, GatewayWriteInput } from "../internal-operation/gateway.ts";
import type { GatewayMutationTransactionInput } from "../internal-operation/mutation-port.ts";
import {
  snapshotXCaptureTrust, verifyTrustedXCapture, verifyXCaptureArtifacts, xCaptureSha256,
  type VerifiedXCapture, type XCaptureDeploymentTrust, type XCaptureEvidencePort, type XCaptureProof, type XCaptureHistoricalEvidenceMetadata,
} from "./trusted-capture.ts";

import { readXPageAutomaticSourceState } from "./source-authority.ts";

const ZERO = "0".repeat(64);
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/);
const Time = z.string().refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const ResultSchema = z.object({
  schemaVersion: z.literal("x-page-trusted-import-result-v1"),
  decision: z.enum(["created", "duplicate", "updated"]),
  candidateId: Id,
  sourceId: Id,
  sourceRevision: z.number().int().positive(),
  sourceVersionHash: Hash,
  captureSha256: Hash,
  operationId: Id,
}).strict();
export type XPageTrustedImportResult = Readonly<z.infer<typeof ResultSchema>>;
const ReceiptSchema = z.object({
  schemaVersion: z.literal("x-page-producer-receipt-v1"),
  producerId: Id,
  receiptId: Id,
  captureSha256: Hash,
  captureProofSha256: Hash,
  sourceId: Id,
  observedSourceId: Id,
  capturedSourceVersionHash: Hash,
  acceptedAt: Time,
  result: ResultSchema,
}).strict();
export type XPageProducerReceipt = Readonly<z.infer<typeof ReceiptSchema>>;
export type XPageProducerReceiptLedger = Readonly<{
  /** Durable immutable result, unique by (producerId, receiptId), never a Map. */
  read(producerId: string, receiptId: string): unknown | null;
  readAdmissionTrust?(producerId: string, receiptId: string): Readonly<{trust: XCaptureDeploymentTrust; metadata: XCaptureHistoricalEvidenceMetadata}>;
}>;
/** Required successor gateway adapter. It must declare the receipt entity before
 * authorization, atomically claim it with candidate/capture writes, bind the
 * operation result to receiptClaim, and run the real gateway's postchecks.
 * The current 0015 and generic gateway do NOT implement this interface.
 * No implementation may uninstall authorization or translate this to raw writes. */
export type XPageImportMutationPort = Readonly<{
  runAtomicAdmission<T>(callback: () => T): T;
  runImportTransaction<T>(input: Readonly<{
    operation: GatewayMutationTransactionInput;
    receiptClaim: XPageProducerReceipt;
    capture: unknown;
  }>, callback: (mutate: (write: GatewayWriteInput) => number) => T): T;
}>;
export type XPageSourceIdentity = Readonly<{
  sourceId: string;
  revision: number;
  identitySha256: string;
  sourceStopEpoch: number;
  sourceConfigEpoch: number;
  sourceSafetyEpoch: number;
  authorizationVersion: number;
  policyEpoch: number;
  recoveryEpoch: number;
}>;
export type XPageCandidateVersion = Readonly<{ sourceRevision: number; sourceVersionHash: string }>;
export type XPageRefinementTarget = Readonly<{ candidateId: string; sourceRevision: number; inputContentHash: string }>;
export const XPageRefinementTargetSchema = z.object({ candidateId: Id,
  sourceRevision: z.number().int().positive(), inputContentHash: Hash }).strict();
type Row = Record<string, unknown>;
function assert(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
function integer(value: unknown): number {
  assert(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "X_IMPORT_SOURCE_DATA_INVALID");
  return value;
}

/** Reads actual source/control state; signed producer identity never substitutes
 * for current source permission. The precise successor schema remains a runtime
 * opener/gateway requirement, not a self-approved flag accepted by this module. */
export function readReadyXPageSource(database: DatabaseSync, trust: XCaptureDeploymentTrust, sourceId: string, now: Date): XPageSourceIdentity {
  const scope = trust.sources.find(source => source.sourceId === sourceId);
  assert(scope, "X_IMPORT_SOURCE_NOT_IN_DEPLOYMENT");
  if (database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='x_page_source_admission_v1'").get()) {
    const current = readXPageAutomaticSourceState(database, sourceId, now);
    assert(current.identity_sha256 === scope.identitySha256 && current.adapter_sha256 === trust.adapterSha256
      && current.authorization_receipt_sha256 === scope.authorizationReceiptSha256 && current.source_policy_sha256 === scope.sourcePolicySha256,
      "X_IMPORT_SOURCE_AUTHORITY_INVALID");
    const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get();
    assert(control?.phase === "live" && control.global_stop_state === "clear" && control.emergency_stop_state === "clear" && control.recovery_state === "ready", "X_IMPORT_CONTROL_CLOSED");
    assert(now.getTime() >= Date.parse(trust.authorizedAt) && now.getTime() < Date.parse(trust.expiresAt), "X_IMPORT_SOURCE_AUTHORIZATION_EXPIRED");
    return Object.freeze({ sourceId, revision: integer(current.registry_revision), identitySha256: scope.identitySha256,
      sourceStopEpoch: integer(current.stop_epoch), sourceConfigEpoch: integer(current.source_config_epoch), sourceSafetyEpoch: integer(current.source_safety_epoch),
      authorizationVersion: integer(current.authorization_version), policyEpoch: integer(current.policy_epoch), recoveryEpoch: integer(current.recovery_epoch) });
  }
  const row = database.prepare(`SELECT r.*,s.enabled AS collection_enabled,s.stop_epoch,
    config.canonical_handle,config.identity_sha256 AS config_identity,config.authorization_expires_at AS config_expires,
    config.adapter_sha256,config.authorization_receipt_sha256 AS config_authorization_receipt,
    config.source_policy_sha256,config.evidence_class,config.rights_status AS config_rights_status
    FROM source_registry_v1 r JOIN source s ON s.source_id=r.source_id AND s.source_kind='x_page' AND s.feed_url IS NULL
    JOIN x_page_source_config_v1 config ON config.source_id=r.source_id WHERE r.source_id=?`).get(sourceId) as Row | undefined;
  assert(row && sourceId === `x_${row.canonical_handle}`, "X_IMPORT_SOURCE_NOT_CONFIGURED");
  assert(row.source_kind === "x_page" && row.collection_mode === "browser_visible_dom"
    && row.evidence_class === "producer_signed_visible_capture", "X_IMPORT_SOURCE_NOT_ADMITTED");
  assert(row.enabled === 1 && row.collection_enabled === 1 && row.lifecycle_status === "active"
    && row.source_stop_status === "clear", "X_IMPORT_SOURCE_DISABLED");
  assert(row.identity_status === "verified" && row.identity_sha256 === scope.identitySha256
    && row.config_identity === scope.identitySha256, "X_IMPORT_SOURCE_IDENTITY_INVALID");
  assert(row.adapter_status === "ready" && row.adapter_authorization_status === "valid" && row.platform_allowed === "allowed"
    && row.config_rights_status === "clear" && row.adapter_sha256 === trust.adapterSha256
    && row.config_authorization_receipt === scope.authorizationReceiptSha256
    && row.source_policy_sha256 === scope.sourcePolicySha256, "X_IMPORT_SOURCE_AUTHORITY_INVALID");
  const at = now.getTime();
  assert(Number.isFinite(at) && Date.parse(String(row.authorization_expires_at)) > at
    && Date.parse(String(row.config_expires)) > at && at >= Date.parse(trust.authorizedAt) && at < Date.parse(trust.expiresAt), "X_IMPORT_SOURCE_AUTHORIZATION_EXPIRED");
  const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Row | undefined;
  assert(control?.phase === "live" && control.global_stop_state === "clear" && control.recovery_state === "ready", "X_IMPORT_CONTROL_CLOSED");
  for (const field of ["source_config_epoch", "source_safety_epoch", "authorization_version", "policy_epoch", "recovery_epoch"] as const) {
    assert(row[field] === control[field], "X_IMPORT_SOURCE_EPOCH_DRIFT");
  }
  return Object.freeze({ sourceId, revision: integer(row.revision), identitySha256: scope.identitySha256,
    sourceStopEpoch: integer(row.stop_epoch), sourceConfigEpoch: integer(row.source_config_epoch), sourceSafetyEpoch: integer(row.source_safety_epoch),
    authorizationVersion: integer(row.authorization_version), policyEpoch: integer(row.policy_epoch), recoveryEpoch: integer(row.recovery_epoch) });
}

function receipt(ledger: XPageProducerReceiptLedger, verified: VerifiedXCapture): XPageProducerReceipt | null {
  assert(typeof ledger?.read === "function", "X_IMPORT_RECEIPT_LEDGER_REQUIRED");
  const evidence = verified.capture.evidence;
  const value = ledger.read(evidence.producerId, evidence.receiptId);
  if (value === null) return null;
  const parsed = ReceiptSchema.safeParse(value);
  assert(parsed.success, "X_IMPORT_RECEIPT_INVALID");
  const row = parsed.data;
  assert(row.producerId === evidence.producerId && row.receiptId === evidence.receiptId
    && row.captureSha256 === verified.captureSha256 && row.sourceId === evidence.sourceId
    && row.observedSourceId === evidence.observedSourceId && row.capturedSourceVersionHash === verified.normalized.sourceVersionHash
    && row.result.candidateId === `xpage-${verified.normalized.identity}` && row.result.sourceId === row.sourceId
    && row.result.sourceVersionHash === row.capturedSourceVersionHash && row.result.captureSha256 === row.captureSha256, "X_IMPORT_RECEIPT_CONFLICT");
  Object.freeze(row.result);
  return Object.freeze(row);
}
function proofHash(proof: XCaptureProof): string {
  return xCaptureSha256(`f1plus1-x-page-capture-proof-v1\n${canonicalJson(proof)}`);
}
function candidateVersion(row: Row | undefined): XPageCandidateVersion | null {
  return row ? { sourceRevision: integer(row.source_revision), sourceVersionHash: String(row.source_payload_hash) } : null;
}

export function importTrustedXCapture(input: Readonly<{
  database: DatabaseSync;
  gatewayPort: XPageImportMutationPort;
  receiptLedger: XPageProducerReceiptLedger;
  evidencePort: XCaptureEvidencePort;
  capture: unknown;
  trust: XCaptureDeploymentTrust;
  expectedSourceIdentity: XPageSourceIdentity;
  expectedCandidate: XPageCandidateVersion | null;
  operationId: string;
  now: () => Date;
}>): XPageTrustedImportResult {
  assert(typeof input.gatewayPort?.runAtomicAdmission === "function" && typeof input.gatewayPort.runImportTransaction === "function", "X_IMPORT_GATEWAY_PORT_REQUIRED");
  Id.parse(input.operationId);
  const trust = snapshotXCaptureTrust(input.trust);
  const capture = structuredClone(input.capture);
  const expectedSource = structuredClone(input.expectedSourceIdentity);
  const expectedCandidate = structuredClone(input.expectedCandidate);
  const verified = verifyTrustedXCapture({ capture, trust, now: input.now() });
  const captureProof = verifyXCaptureArtifacts(verified, input.evidencePort);
  const normalized = verified.normalized;
  const evidence = verified.capture.evidence;
  return input.gatewayPort.runAtomicAdmission(() => {
    const now = input.now();
    verifyTrustedXCapture({ capture, trust, now });
    const source = readReadyXPageSource(input.database, trust, evidence.sourceId, now);
    const observed = readReadyXPageSource(input.database, trust, evidence.observedSourceId, now);
    assert(canonicalJson(source) === canonicalJson(expectedSource), "X_IMPORT_SOURCE_IDENTITY_STALE");
    const priorReceipt = receipt(input.receiptLedger, verified);
    if (priorReceipt) {
      assert(priorReceipt.captureProofSha256 === proofHash(captureProof), "X_IMPORT_CAPTURE_PROOF_CHANGED");
      return Object.freeze(priorReceipt.result);
    }
    const candidateId = `xpage-${normalized.identity}`;
    const current = input.database.prepare("SELECT * FROM pending_review_candidate WHERE candidate_id=?").get(candidateId) as Row | undefined;
    assert(canonicalJson(candidateVersion(current)) === canonicalJson(expectedCandidate), "X_IMPORT_CANDIDATE_STALE");
    if (current) assert(current.source_id === evidence.sourceId && current.external_id === normalized.statusId
      && current.canonical_url === normalized.canonicalUrl, "X_IMPORT_CANDIDATE_IDENTITY_CONFLICT");
    const conflict = input.database.prepare("SELECT author_handle,candidate_id FROM x_page_candidate_capture_v1 WHERE status_id=? LIMIT 1").get(normalized.statusId) as Row | undefined;
    assert(!conflict || conflict.author_handle === normalized.authorHandle && conflict.candidate_id === candidateId, "X_IMPORT_STATUS_AUTHOR_CONFLICT");
    const currentVersion = candidateVersion(current);
    const decision = !current ? "created" : current.source_payload_hash === normalized.sourceVersionHash ? "duplicate" : "updated";
    const seen = input.database.prepare("SELECT source_revision FROM x_page_candidate_capture_v1 WHERE candidate_id=? AND source_version_hash=?")
      .get(candidateId, normalized.sourceVersionHash);
    if (decision === "duplicate") assert(seen?.source_revision === current!.source_revision, "X_IMPORT_CURRENT_CAPTURE_MISSING");
    if (decision === "updated") {
      assert(!seen, "X_IMPORT_HISTORICAL_CONTENT_REPLAY");
      const latest = input.database.prepare("SELECT observed_at FROM x_page_candidate_capture_v1 WHERE candidate_id=? AND source_revision=? AND source_version_hash=?")
        .get(candidateId, currentVersion!.sourceRevision, currentVersion!.sourceVersionHash);
      assert(latest && normalized.observedAt > String(latest.observed_at), "X_IMPORT_OBSERVATION_STALE");
    }
    const sourceRevision = current ? currentVersion!.sourceRevision + (decision === "updated" ? 1 : 0) : 1;
    const captureId = `xcap-${normalized.identity}-v${sourceRevision}`;
    const result = Object.freeze(ResultSchema.parse({ schemaVersion: "x-page-trusted-import-result-v1", decision,
      candidateId, sourceId: evidence.sourceId, sourceRevision, sourceVersionHash: normalized.sourceVersionHash,
      captureSha256: verified.captureSha256, operationId: input.operationId }));
    const claim = Object.freeze(ReceiptSchema.parse({ schemaVersion: "x-page-producer-receipt-v1",
      producerId: evidence.producerId, receiptId: evidence.receiptId, captureSha256: verified.captureSha256,
      captureProofSha256: proofHash(captureProof), sourceId: evidence.sourceId, observedSourceId: evidence.observedSourceId,
      capturedSourceVersionHash: normalized.sourceVersionHash, acceptedAt: now.toISOString(), result }));
    Object.freeze(claim.result);
    const entities: EntityBinding[] = [{ entityKind: "candidate", entityId: candidateId, identitySelector: "candidate_id",
      expectedVersion: currentVersion?.sourceRevision ?? null, expectedHash: currentVersion?.sourceVersionHash ?? ZERO }];
    for (const item of source.sourceId === observed.sourceId ? [source] : [source, observed]) entities.push({ entityKind: "source", entityId: item.sourceId,
      identitySelector: item.sourceId === source.sourceId ? "source_id" : "bound_child", expectedVersion: item.revision, expectedHash: item.identitySha256 });
    if (decision !== "duplicate") entities.push({ entityKind: "x_page_capture", entityId: captureId, identitySelector: "bound_child", expectedVersion: null, expectedHash: ZERO });
    const assertCurrent = () => {
      const at = input.now();
      verifyTrustedXCapture({ capture, trust, now: at });
      assert(canonicalJson(readReadyXPageSource(input.database, trust, source.sourceId, at)) === canonicalJson(source)
        && canonicalJson(readReadyXPageSource(input.database, trust, observed.sourceId, at)) === canonicalJson(observed), "X_IMPORT_SOURCE_IDENTITY_STALE");
    };
    const committed = input.gatewayPort.runImportTransaction({ receiptClaim: claim, capture: verified.capture, operation: {
      operationId: input.operationId, operationKind: "collect", ownerProcess: "x_page_importer", policyId: "p-x-page-trusted-import-live",
      capabilityClass: "db_mutation", egressClass: "none", sourceStopEpoch: source.sourceStopEpoch,
      identity: { sourceId: source.sourceId, candidateId, publicationId: null, publicId: null }, entitySet: entities,
      requestHash: xCaptureSha256(canonicalJson({ claim, expectedSource, expectedCandidate })),
    } }, mutate => {
      assertCurrent();
      assert(canonicalJson(candidateVersion(input.database.prepare("SELECT source_revision,source_payload_hash FROM pending_review_candidate WHERE candidate_id=?")
        .get(candidateId) as Row | undefined)) === canonicalJson(expectedCandidate), "X_IMPORT_CANDIDATE_STALE");
      const points = [...normalized.text];
      const excerpt = points.length <= 2000 ? normalized.text : `${points.slice(0, 2000).join("")}\n[预览节选；完整正文保存在捕获证据中]`;
      if (decision !== "duplicate") {
        const create = decision === "created";
        const changed = mutate({ entityKind: "candidate", entityId: candidateId, mutationKind: create ? "insert" : "update",
          expectedVersion: currentVersion?.sourceRevision ?? null, expectedHash: currentVersion?.sourceVersionHash ?? ZERO,
          statement: create
            ? "INSERT INTO pending_review_candidate (candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,review_status,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,'pending_review',?,?)"
            : "UPDATE pending_review_candidate SET title=?,excerpt=?,author=?,published_at=?,source_payload_hash=?,source_revision=source_revision+1,review_status=CASE WHEN review_status='rejected' THEN 'rejected' ELSE 'pending_review' END,last_seen_at=? WHERE candidate_id=? AND source_revision=? AND source_payload_hash=?",
          parameters: create ? [candidateId, source.sourceId, normalized.statusId, normalized.identity, normalized.canonicalUrl,
            `X 原帖 · @${normalized.authorHandle}`, excerpt, normalized.authorDisplayName, normalized.publishedAt, normalized.sourceVersionHash, normalized.observedAt, normalized.observedAt]
            : [`X 原帖 · @${normalized.authorHandle}`, excerpt, normalized.authorDisplayName, normalized.publishedAt, normalized.sourceVersionHash, normalized.observedAt,
              candidateId, currentVersion!.sourceRevision, currentVersion!.sourceVersionHash] });
        assert(changed === 1, "X_IMPORT_CANDIDATE_WRITE_FAILED");
        assert(mutate({ entityKind: "x_page_capture", entityId: captureId, mutationKind: "insert", expectedVersion: null, expectedHash: ZERO,
          statement: "INSERT INTO x_page_candidate_capture_v1 (capture_id,candidate_id,source_revision,source_id,status_id,author_handle,source_version_hash,complete_text,normalized_json,evidence_json,evidence_sha256,observed_at,operation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          parameters: [captureId, candidateId, sourceRevision, source.sourceId, normalized.statusId, normalized.authorHandle, normalized.sourceVersionHash,
            normalized.text, canonicalJson(normalized), canonicalJson(verified.capture), verified.captureSha256, normalized.observedAt, input.operationId] }) === 1, "X_IMPORT_CAPTURE_WRITE_FAILED");
      }
      assertCurrent();
      return result;
    });
    assert(canonicalJson(committed) === canonicalJson(result)
      && canonicalJson(receipt(input.receiptLedger, verified)) === canonicalJson(claim), "X_IMPORT_ATOMIC_RECEIPT_MISSING");
    return result;
  });
}

/** Exact stored input for the refiner. Reauthenticates the envelope at its durable
 * admission time, verifies artifact/receipt binding, and checks present authority.
 * Re-reading old captured material never pretends it was captured again now. */
export function readTrustedXPageInput(input: Readonly<{
  database: DatabaseSync; target: XPageRefinementTarget; trust: XCaptureDeploymentTrust;
  receiptLedger: XPageProducerReceiptLedger; evidencePort: XCaptureEvidencePort; now: Date;
}>): Readonly<{ verified: VerifiedXCapture; source: XPageSourceIdentity; producerReceipt: XPageProducerReceipt; captureId: string }> {
  XPageRefinementTargetSchema.parse(input.target);
  const row = input.database.prepare(`SELECT cap.*,c.canonical_url AS candidate_url,c.external_id AS candidate_status_id,
      c.published_at AS candidate_published_at,c.review_status AS candidate_review_status FROM x_page_candidate_capture_v1 cap JOIN pending_review_candidate c
    ON c.candidate_id=cap.candidate_id AND c.source_id=cap.source_id AND c.source_revision=cap.source_revision
      AND c.source_payload_hash=cap.source_version_hash
    WHERE cap.candidate_id=? AND cap.source_revision=? AND cap.source_version_hash=?`)
    .get(input.target.candidateId, input.target.sourceRevision, input.target.inputContentHash) as Row | undefined;
  assert(row, "X_REFINE_INPUT_STALE");
  assert(["pending_review", "approved", "published"].includes(String(row.candidate_review_status)), "X_REFINE_CANDIDATE_NOT_ELIGIBLE");
  const envelope = JSON.parse(String(row.evidence_json));
  assert(typeof envelope?.evidence?.producerId === "string" && typeof envelope.evidence.receiptId === "string", "X_REFINE_CAPTURE_ENVELOPE_INVALID");
  const savedValue = input.receiptLedger.read(envelope?.evidence?.producerId, envelope?.evidence?.receiptId);
  const saved = ReceiptSchema.safeParse(savedValue);
  assert(saved.success, "X_REFINE_IMPORT_RECEIPT_MISSING");
  assert(Date.parse(saved.data.acceptedAt) <= input.now.getTime(), "X_REFINE_ADMISSION_TIME_INVALID");
  const successor = input.database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='x_page_source_admission_v1'").get() !== undefined;
  if (successor) assert(typeof input.receiptLedger.readAdmissionTrust === "function" && typeof input.evidencePort.forHistoricalAdmission === "function", "X_REFINE_HISTORICAL_ADMISSION_REQUIRED");
  const historical = successor ? input.receiptLedger.readAdmissionTrust!(saved.data.producerId, saved.data.receiptId) : null;
  const historicalTrust = historical?.trust ?? input.trust;
  const historicalEvidencePort = historical ? input.evidencePort.forHistoricalAdmission!({ trust: historicalTrust, acceptedAt: saved.data.acceptedAt, metadata: historical.metadata }) : input.evidencePort;
  const verified = verifyTrustedXCapture({ capture: envelope, trust: historicalTrust, now: new Date(saved.data.acceptedAt) });
  const stored = receipt(input.receiptLedger, verified);
  const proof = verifyXCaptureArtifacts(verified, historicalEvidencePort);
  assert(stored && stored.captureProofSha256 === proofHash(proof) && stored.result.sourceRevision === row.source_revision
    && stored.result.operationId === row.operation_id && verified.captureSha256 === row.evidence_sha256
    && `xpage-${verified.normalized.identity}` === input.target.candidateId && verified.normalized.sourceVersionHash === input.target.inputContentHash
    && verified.capture.evidence.sourceId === row.source_id && verified.normalized.statusId === row.status_id
    && verified.normalized.authorHandle === row.author_handle && verified.normalized.observedAt === row.observed_at
    && verified.normalized.canonicalUrl === row.candidate_url && verified.normalized.statusId === row.candidate_status_id
    && verified.normalized.publishedAt === row.candidate_published_at
    && verified.normalized.text === row.complete_text && canonicalJson(verified.normalized) === row.normalized_json, "X_REFINE_CAPTURE_BINDING_INVALID");
  const source = readReadyXPageSource(input.database, snapshotXCaptureTrust(input.trust), String(row.source_id), input.now);
  readReadyXPageSource(input.database, input.trust, verified.capture.evidence.observedSourceId, input.now);
  return Object.freeze({ verified, source, producerReceipt: stored, captureId: String(row.capture_id) });
}

export { ReceiptSchema as XPageProducerReceiptSchema, ResultSchema as XPageTrustedImportResultSchema };
