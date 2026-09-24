import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonV1, type EntityBinding } from "../internal-operation/gateway.ts";
import type { SqliteGatewayMutationPort } from "../internal-operation/mutation-port.ts";
import { normalizePagePost, type PagePost, type XPageCandidate } from "./normalize.ts";
import { xPageHash } from "./migration.ts";

const ZERO = "0".repeat(64);
const EvidenceSchema = z.object({
  schemaVersion: z.literal("x-page-capture-evidence-v1"),
  evidenceClass: z.literal("synthetic_clone"),
  toolFamily: z.literal("fixture"),
  instanceId: z.string().min(1).max(128),
  host: z.literal("synthetic"),
  receiptSha256: z.string().regex(/^[0-9a-f]{64}$/),
  observedAt: z.iso.datetime({ precision: 3 }),
  pageUrl: z.string().max(2048)
}).strict();
export type XPageCapture = Readonly<{
  pagePost: PagePost;
  evidence: z.infer<typeof EvidenceSchema>;
  evidenceSha256: string;
}>;
export type XPageSourceIdentity = Readonly<{
  sourceId: string;
  revision: number;
  identitySha256: string;
  sourceConfigEpoch: number;
  sourceSafetyEpoch: number;
  authorizationVersion: number;
  policyEpoch: number;
  recoveryEpoch: number;
  stopEpoch: number;
}>;
export type XPageExpectedCandidate = Readonly<{ sourceRevision: number; sourceVersionHash: string }> | null;
export type XPageImportResult = Readonly<{
  decision: "created" | "duplicate" | "updated";
  candidateId: string;
  sourceRevision: number;
  sourceVersionHash: string;
  operationId: string;
  evidenceClass: "synthetic_clone";
}>;
function assert(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
type Row = Record<string, unknown>;
function sourceRow(database: DatabaseSync, sourceId: string): Row {
  const row = database.prepare(`SELECT r.*,s.enabled AS collection_enabled,s.stop_epoch,config.canonical_handle,
    config.identity_sha256 AS config_identity,config.authorization_expires_at AS config_expires,config.evidence_class
    FROM source_registry_v1 r JOIN source s ON s.source_id=r.source_id AND s.source_kind='x_page' AND s.feed_url IS NULL
    JOIN x_page_source_config_v1 config ON config.source_id=r.source_id WHERE r.source_id=?`).get(sourceId) as Row | undefined;
  assert(row !== undefined, "X_PAGE_SOURCE_NOT_CONFIGURED");
  return row;
}
function identityFromRow(row: Row): XPageSourceIdentity {
  return Object.freeze({ sourceId: String(row.source_id), revision: Number(row.revision), identitySha256: String(row.identity_sha256),
    sourceConfigEpoch: Number(row.source_config_epoch), sourceSafetyEpoch: Number(row.source_safety_epoch),
    authorizationVersion: Number(row.authorization_version), policyEpoch: Number(row.policy_epoch), recoveryEpoch: Number(row.recovery_epoch), stopEpoch: Number(row.stop_epoch) });
}
export function readXPageSourceIdentity(database: DatabaseSync, sourceId: string): XPageSourceIdentity {
  return identityFromRow(sourceRow(database, sourceId));
}
function requireReady(database: DatabaseSync, row: Row, now: string): void {
  assert(row.source_kind === "x_page" && row.collection_mode === "browser_visible_dom" && row.evidence_class === "synthetic_clone", "X_PAGE_SOURCE_KIND_INVALID");
  assert(row.enabled === 1 && row.collection_enabled === 1 && row.lifecycle_status === "active" && row.source_stop_status === "clear", "X_PAGE_SOURCE_DISABLED");
  assert(row.identity_status === "verified" && row.identity_sha256 === row.config_identity, "X_PAGE_SOURCE_IDENTITY_UNVERIFIED");
  assert(row.adapter_status === "ready" && row.adapter_authorization_status === "valid" && row.platform_allowed === "allowed", "X_PAGE_SOURCE_AUTHORITY_INVALID");
  assert(Date.parse(String(row.authorization_expires_at)) > Date.parse(now) && Date.parse(String(row.config_expires)) > Date.parse(now), "X_PAGE_AUTHORIZATION_EXPIRED");
  const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Row;
  for (const field of ["source_config_epoch", "source_safety_epoch", "authorization_version", "policy_epoch", "recovery_epoch"]) {
    assert(row[field] === control[field], "X_PAGE_SOURCE_EPOCH_DRIFT");
  }
}
function candidateState(row: Row | undefined): XPageExpectedCandidate {
  return row === undefined ? null : Object.freeze({ sourceRevision: Number(row.source_revision), sourceVersionHash: String(row.source_payload_hash) });
}
function preview(candidate: XPageCandidate): string {
  const points = [...candidate.text];
  return points.length <= 2000 ? candidate.text : `${points.slice(0, 2000).join("")}\n[预览节选；完整正文保存在捕获证据中]`;
}

/** Local successor entrypoint. No browser, model, approval, publishing or external
 * egress is performed. Synthetic input remains explicitly labeled and is rejected
 * by the old production schema/runtime. The caller must verify capture provenance. */
export function importCapturedXPost(input: Readonly<{
  database: DatabaseSync;
  gatewayPort: SqliteGatewayMutationPort;
  capture: XPageCapture;
  expectedSourceIdentity: XPageSourceIdentity;
  expectedCandidate: XPageExpectedCandidate;
  operationId: string;
  now: Date;
  verifyCaptureEvidence: (capture: XPageCapture) => boolean;
}>): XPageImportResult {
  // Copy before the verifier/callback can mutate caller-owned evidence.
  const capture = structuredClone(input.capture);
  const evidence = EvidenceSchema.parse(capture.evidence);
  assert(xPageHash({ pagePost: capture.pagePost, evidence }) === capture.evidenceSha256, "X_PAGE_CAPTURE_EVIDENCE_HASH");
  assert(input.verifyCaptureEvidence(structuredClone(capture)) === true, "X_PAGE_CAPTURE_EVIDENCE_UNVERIFIED");
  assert(evidence.pageUrl === capture.pagePost.pageUrl && evidence.observedAt === new Date(capture.pagePost.observedAt).toISOString(), "X_PAGE_CAPTURE_EVIDENCE_MISMATCH");
  const now = input.now.toISOString();
  assert(Date.parse(evidence.observedAt) <= Date.parse(now), "X_PAGE_CAPTURE_TIME_IN_FUTURE");
  const requestHash = xPageHash({ schemaVersion: "x-page-import-request-v1", evidenceSha256: capture.evidenceSha256,
    expectedSourceIdentity: input.expectedSourceIdentity, expectedCandidate: input.expectedCandidate });
  const database = input.database;
  return input.gatewayPort.runAtomicAdmission(() => {
    const source = sourceRow(database, input.expectedSourceIdentity.sourceId);
    requireReady(database, source, now);
    assert(canonicalJsonV1(identityFromRow(source)) === canonicalJsonV1(input.expectedSourceIdentity), "X_PAGE_SOURCE_IDENTITY_STALE");
    const observedHandle = capture.pagePost.source.handle.toLowerCase();
    const observedSource = sourceRow(database, `x_${observedHandle}`);
    requireReady(database, observedSource, now);
    const normalized = normalizePagePost({ ...capture.pagePost, source: {
      handle: String(observedSource.canonical_handle), enabled: observedSource.enabled === 1, identityStatus: observedSource.identity_status
    } });
    assert(normalized.authorHandle === source.canonical_handle, "X_PAGE_AUTHOR_SOURCE_MISMATCH");
    const candidateId = `xpage-${normalized.identity}`;
    const conflict = database.prepare("SELECT author_handle,candidate_id FROM x_page_candidate_capture_v1 WHERE status_id=? LIMIT 1").get(normalized.statusId) as Row | undefined;
    assert(conflict === undefined || conflict.author_handle === normalized.authorHandle && conflict.candidate_id === candidateId, "X_PAGE_STATUS_AUTHOR_CONFLICT");
    const current = database.prepare("SELECT * FROM pending_review_candidate WHERE candidate_id=?").get(candidateId) as Row | undefined;
    assert(canonicalJsonV1(candidateState(current)) === canonicalJsonV1(input.expectedCandidate), "X_PAGE_CANDIDATE_STALE");
    if (current !== undefined) assert(current.source_id === source.source_id && current.external_id === normalized.statusId, "X_PAGE_CANDIDATE_IDENTITY_CONFLICT");
    const seen = database.prepare("SELECT source_revision FROM x_page_candidate_capture_v1 WHERE candidate_id=? AND source_version_hash=?").get(candidateId, normalized.sourceVersionHash);
    const decision = current === undefined ? "created" : seen !== undefined ? "duplicate" : "updated";
    if (decision === "updated") {
      const latest = database.prepare("SELECT observed_at FROM x_page_candidate_capture_v1 WHERE candidate_id=? AND source_revision=?").get(candidateId, Number(current!.source_revision)) as Row | undefined;
      assert(latest !== undefined && normalized.observedAt > String(latest.observed_at), "X_PAGE_OBSERVATION_STALE");
    }
    const sourceRevision = current === undefined ? 1 : Number(current.source_revision) + (decision === "updated" ? 1 : 0);
    const sourceVersionHash = decision === "duplicate" ? String(current!.source_payload_hash) : normalized.sourceVersionHash;
    const captureId = `xcap-${normalized.identity}-v${sourceRevision}`;
    const previous = input.expectedCandidate;
    const candidateBinding: EntityBinding = { entityKind: "candidate", entityId: candidateId, identitySelector: "candidate_id", expectedVersion: previous?.sourceRevision ?? null, expectedHash: previous?.sourceVersionHash ?? ZERO };
    const entitySet: EntityBinding[] = [candidateBinding,
      { entityKind: "source", entityId: String(source.source_id), identitySelector: "source_id", expectedVersion: Number(source.revision), expectedHash: String(source.identity_sha256) }];
    if (decision !== "duplicate") entitySet.push({ entityKind: "x_page_capture", entityId: captureId, identitySelector: "bound_child", expectedVersion: null, expectedHash: ZERO });
    const result: XPageImportResult = Object.freeze({ decision, candidateId, sourceRevision, sourceVersionHash, operationId: input.operationId, evidenceClass: "synthetic_clone" });
    return input.gatewayPort.runTransaction({ operationId: input.operationId, operationKind: "collect", ownerProcess: "x_page_importer",
      policyId: "p-x-page-import-live", capabilityClass: "db_mutation", egressClass: "none", requestHash,
      identity: { sourceId: String(source.source_id), candidateId, publicationId: null, publicId: null }, entitySet,
      sourceStopEpoch: Number(source.stop_epoch)
    }, mutate => {
      requireReady(database, sourceRow(database, String(source.source_id)), now);
      requireReady(database, sourceRow(database, String(observedSource.source_id)), now);
      if (decision === "duplicate") return result;
      if (decision === "created") {
        mutate({ entityKind: "candidate", entityId: candidateId, mutationKind: "insert", expectedVersion: null, expectedHash: ZERO,
          statement: "INSERT INTO pending_review_candidate (candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,review_status,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?, ?,1,'pending_review',?,?)",
          parameters: [candidateId, source.source_id, normalized.statusId, normalized.identity, normalized.canonicalUrl,
            `X 原帖 · @${normalized.authorHandle}`, preview(normalized), normalized.authorDisplayName, normalized.publishedAt, normalized.sourceVersionHash, normalized.observedAt, normalized.observedAt] });
      } else {
        mutate({ entityKind: "candidate", entityId: candidateId, mutationKind: "update", expectedVersion: previous!.sourceRevision, expectedHash: previous!.sourceVersionHash,
          statement: "UPDATE pending_review_candidate SET title=?,excerpt=?,author=?,source_payload_hash=?,source_revision=source_revision+1,review_status=CASE WHEN review_status='rejected' THEN 'rejected' ELSE 'pending_review' END,last_seen_at=? WHERE candidate_id=? AND source_revision=? AND source_payload_hash=?",
          parameters: [`X 原帖 · @${normalized.authorHandle}`, preview(normalized), normalized.authorDisplayName, normalized.sourceVersionHash, normalized.observedAt, candidateId, previous!.sourceRevision, previous!.sourceVersionHash] });
      }
      mutate({ entityKind: "x_page_capture", entityId: captureId, mutationKind: "insert", expectedVersion: null, expectedHash: ZERO,
        statement: "INSERT INTO x_page_candidate_capture_v1 (capture_id,candidate_id,source_revision,source_id,status_id,author_handle,source_version_hash,complete_text,normalized_json,evidence_json,evidence_sha256,observed_at,operation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        parameters: [captureId, candidateId, sourceRevision, source.source_id, normalized.statusId, normalized.authorHandle, normalized.sourceVersionHash,
          normalized.text, canonicalJsonV1(normalized), canonicalJsonV1(capture), capture.evidenceSha256, normalized.observedAt, input.operationId] });
      return result;
    });
  });
}

/** Future refiner must select the exact revision/hash; the 16KiB preview is never its input. */
export function readXPageCompleteInput(database: DatabaseSync, candidateId: string, expected: NonNullable<XPageExpectedCandidate>): string {
  const row = database.prepare(`SELECT capture.complete_text FROM x_page_candidate_capture_v1 capture
    JOIN pending_review_candidate c ON c.candidate_id=capture.candidate_id AND c.source_revision=capture.source_revision AND c.source_payload_hash=capture.source_version_hash
    WHERE capture.candidate_id=? AND capture.source_revision=? AND capture.source_version_hash=?`).get(candidateId, expected.sourceRevision, expected.sourceVersionHash) as { complete_text: string } | undefined;
  assert(row !== undefined, "X_PAGE_REFINEMENT_INPUT_STALE");
  return row.complete_text;
}
