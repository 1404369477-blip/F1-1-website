import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJsonV1, type EntityBinding, type FenceKind, type SqliteInternalOperationGateway } from "../internal-operation/gateway.ts";
import type { SqliteGatewayMutationPort } from "../internal-operation/mutation-port.ts";
import { assertPhaseAllowsExternal, readPhaseSnapshot } from "../internal-operation/phase.ts";
import {readRssAutomaticSourceState,rssAutomaticSourceSnapshotHash} from "./source-state.ts";
import { isAutoPipelineSource } from "../review-real/automatic-pipeline.ts";
import { AutomaticTargetSchema, hasCurrentManualReview,hasCompleteRssAutomaticPayload, type AutomaticTarget } from "./contract.ts";

export const RSS_AUTOMATIC_FENCE_TTL_MS = 900_000;
export const RSS_AUTOMATIC_FENCE_REASON = "RSS_AUTOMATIC_CURRENT_V1";
const ZERO = "0".repeat(64);
const hash = (value: unknown) => createHash("sha256").update(canonicalJsonV1(value)).digest("hex");
function assert(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
type Row = Record<string, unknown>;

/** Content revision and registry configuration revision are separate clocks. */
export function assertRssAutomaticTarget(database: DatabaseSync, target: AutomaticTarget, cutoffIso: string, now = new Date()): Row {
  AutomaticTargetSchema.parse(target);
  assert(Number.isFinite(Date.parse(cutoffIso)) && Number.isFinite(now.getTime()), "RSS_AUTO_CLOCK_INVALID");
  let value = database.prepare("SELECT * FROM pending_review_candidate WHERE candidate_id=?").get(target.candidateId) as Row | undefined;
  assert(value && isAutoPipelineSource(String(value.source_id)), "RSS_AUTO_SOURCE_NOT_ALLOWED");
  assert(value.source_revision === target.sourceRevision && value.source_payload_hash === target.inputContentHash, "RSS_AUTO_SOURCE_STALE");
  assert(hasCompleteRssAutomaticPayload(database,target),"RSS_AUTO_PAYLOAD_INCOMPLETE");
  assert(Date.parse(String(value.first_seen_at)) >= Date.parse(cutoffIso), "RSS_AUTO_BEFORE_CUTOFF");
  assert(["pending_review","approved","published"].includes(String(value.review_status)), "RSS_AUTO_MANUAL_OVERRIDE");
  assert(!hasCurrentManualReview(database,target), "AUTO_REVIEW_MANUAL_OVERRIDE");
  value={...value,...readRssAutomaticSourceState(database,String(value.source_id),now)};
  assert(!database.prepare(`SELECT 1 FROM review_decision d JOIN review_bundle b ON b.bundle_id=d.bundle_id
    WHERE b.candidate_id=? AND b.source_revision=? AND b.source_payload_hash=? AND d.decision='rejected' LIMIT 1`).get(target.candidateId,target.sourceRevision,target.inputContentHash), "AUTO_REVIEW_MANUAL_OVERRIDE");
  return value;
}

export function issueRssAutomaticFences(input: Readonly<{
  database: DatabaseSync; gateway: SqliteInternalOperationGateway; supervisorPort: SqliteGatewayMutationPort;
  target: AutomaticTarget; cutoffIso: string; publicationId?: string; now?: () => Date;
}>): Readonly<{ issued: number; reused: number }> {
  const now = (input.now ?? (() => new Date()))();
  assertPhaseAllowsExternal(readPhaseSnapshot(input.database), "model_https");
  return (() => {
    const candidate = assertRssAutomaticTarget(input.database,input.target,input.cutoffIso,now);
    const control = input.database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Row;
    assert(["live","backlog"].includes(String(control.phase)) && control.global_stop_state === "clear" && control.emergency_stop_state === "clear"
      && control.recovery_state === "ready" && control.deletion_fence_state === "clear" && control.publication_fence_state === "clear", "RSS_AUTO_CONTROL_CLOSED");
    if (input.publicationId) {
      assert(input.database.prepare(`SELECT 1 FROM publication p JOIN review_bundle b ON b.bundle_id=p.bundle_id
        JOIN review_decision d ON d.decision_id=p.decision_id
        WHERE p.publication_id=? AND b.candidate_id=? AND b.source_revision=? AND b.source_payload_hash=?
        AND b.bundle_revision=(SELECT MAX(bundle_revision) FROM review_bundle WHERE candidate_id=b.candidate_id)
        AND p.approved_bundle_hash=b.bundle_hash AND d.decision='approved' AND d.approved_bundle_hash=b.bundle_hash
        AND p.publication_status='queued'`).get(input.publicationId,input.target.candidateId,input.target.sourceRevision,input.target.inputContentHash), "RSS_AUTO_PUBLICATION_STALE");
    }
    const scopes: ReadonlyArray<readonly ["source"|"candidate"|"publication",string,FenceKind]> = input.publicationId
      ? (["deletion","publication","completeness","rights","media"] as const).map(kind=>["publication",input.publicationId!,kind] as const)
      : [["source",String(candidate.source_id),"deletion"],["source",String(candidate.source_id),"rights"],["source",String(candidate.source_id),"media"],
        ["candidate",input.target.candidateId,"publication"],["candidate",input.target.candidateId,"completeness"]];
    let issued = 0, reused = 0;
    for (const [scopeKind,scopeId,fenceKind] of scopes) {
      const existing = input.database.prepare(`SELECT 1 FROM rss_automatic_fence_current_v1 WHERE candidate_id=? AND source_revision=? AND input_content_hash=?
        AND scope_kind=? AND scope_id=? AND fence_kind=? AND expires_at>?
        AND EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=issued_by_operation_id AND op.expected_schema_sha256=? AND op.expected_release_sha256=? AND op.expected_manifest_sha256=?)`).get(
          input.target.candidateId,input.target.sourceRevision,input.target.inputContentHash,scopeKind,scopeId,fenceKind,now.toISOString(),
          input.gateway.expectedSchemaSha256(),input.gateway.expectedReleaseSha256(),input.gateway.expectedManifestSha256());
      if (existing) { reused++; continue; }
      const expiresAt = new Date(Math.min(now.getTime()+RSS_AUTOMATIC_FENCE_TTL_MS,Date.parse(String(candidate.authorization_expires_at)))).toISOString();
      const sourceSnapshotSha256=rssAutomaticSourceSnapshotHash(candidate);
      const seed = hash({target:input.target,scopeKind,scopeId,fenceKind,expiresAt,sourceSnapshotSha256,
        sourceConfigEpoch:control.source_config_epoch,sourceSafetyEpoch:control.source_safety_epoch,authorizationVersion:control.authorization_version,
        policyEpoch:control.policy_epoch,recoveryEpoch:control.recovery_epoch,writerEpoch:control.writer_epoch});
      const operationId = `rss-auto-fence-${seed}`, fenceReceiptId = `rss-auto-fence-receipt-${seed}`;
      const identity = { sourceId:String(candidate.source_id),candidateId:input.target.candidateId,publicationId:input.publicationId ?? null,publicId:null };
      const entitySet: EntityBinding[] = [
        {entityKind:"candidate",entityId:input.target.candidateId,identitySelector:"candidate_id",expectedVersion:input.target.sourceRevision,expectedHash:input.target.inputContentHash},
        {entityKind:"source",entityId:identity.sourceId,identitySelector:"source_id",expectedVersion:Number(candidate.registry_revision),expectedHash:String(candidate.identity_sha256)},
        {entityKind:"generic_fence",entityId:fenceReceiptId,identitySelector:"bound_child",expectedVersion:null,expectedHash:ZERO},
      ];
      if (input.publicationId) entitySet.push({entityKind:"publication",entityId:input.publicationId,identitySelector:"publication_id",expectedVersion:null,expectedHash:ZERO});
      const oneTimeNonce = randomBytes(32).toString("base64url");
      const receipt = {fenceReceiptId,scopeKind,scopeId,fenceKind,state:"clear",reasonCode:RSS_AUTOMATIC_FENCE_REASON,issuer:"f1plus1-system-supervisor-v1",operationId,
        oneTimeNonce,sourceSnapshotSha256,policyEpoch:control.policy_epoch,recoveryEpoch:control.recovery_epoch,writerEpoch:control.writer_epoch,observedAt:now.toISOString(),expiresAt,target:input.target};
      input.supervisorPort.runTransaction({operationId,operationKind:"system_producer",ownerProcess:"system_supervisor",policyId:`p-rss-auto-fence-${control.phase}`,
        capabilityClass:"control",egressClass:"none",controlAction:"fence_update",sourceStopEpoch:Number(candidate.stop_epoch),identity,entitySet,requiredFenceSet:[],requestHash:hash(receipt)}, mutate => {
        assert(rssAutomaticSourceSnapshotHash(assertRssAutomaticTarget(input.database,input.target,input.cutoffIso,now))===sourceSnapshotSha256,"RSS_AUTO_SOURCE_BINDING_STALE");
        const changes = mutate({entityKind:"generic_fence",entityId:fenceReceiptId,mutationKind:"insert",expectedVersion:null,expectedHash:ZERO,
          statement:"INSERT INTO generic_fence_receipt VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          parameters:[fenceReceiptId,scopeKind,scopeId,fenceKind,"clear",RSS_AUTOMATIC_FENCE_REASON,"f1plus1-system-supervisor-v1",operationId,oneTimeNonce,hash(receipt),
            control.policy_epoch,control.recovery_epoch,control.writer_epoch,now.toISOString(),expiresAt]});
        assert(changes===1,"RSS_AUTO_FENCE_WRITE_FAILED");
        assert(rssAutomaticSourceSnapshotHash(assertRssAutomaticTarget(input.database,input.target,input.cutoffIso,now))===sourceSnapshotSha256,"RSS_AUTO_SOURCE_BINDING_STALE");
      });
      issued++;
    }
    return Object.freeze({issued,reused});
  })();
}
