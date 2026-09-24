import {createHash,randomBytes} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {canonicalJson} from "../db/profile.ts";
import {verifyStoredProjectionTaskEnvelope,verifyStoredPublicProjection} from "../review-real/mapping.ts";
import type {SqliteInternalOperationGateway,EntityBinding,GatewayOperationRequest} from "../internal-operation/gateway.ts";
import type {SqliteGatewayMutationPort} from "../internal-operation/mutation-port.ts";
import {AutomaticMutationResultSchema} from "./contract.ts";
import {readRssAutomaticSourceState,assertRssAutomaticSourceBindingCurrent} from "./source-state.ts";

export const RSS_COMMITTED_DELIVERY_FENCE_REASON="RSS_AUTOMATIC_COMMITTED_DELIVERY_V1";
const ZERO="0".repeat(64),KINDS=["deletion","publication","completeness","rights","media"] as const;
type Row=Record<string,unknown>;
type Identity=Readonly<{schemaSha256:string;releaseSha256:string;manifestSha256:string;verifiedFullManifestSha256:string|null;verifiedFallbackManifestSha256:string|null;now:Date}>;
const hash=(value:unknown)=>createHash("sha256").update(canonicalJson(value)).digest("hex");
function assert(value:unknown,code="RSS_DELIVERY_AUTHORITY_INVALID"):asserts value{if(!value)throw new Error(code);}

/** Approved projection bytes stay fixed when source text is updated. Every
 * source permission and safety clock is still checked against current state. */
export function readCommittedDelivery(database:DatabaseSync,deliveryId:string,identity:Identity) {
 const row=database.prepare(`SELECT outbox.*,p.publication_status,p.approved_bundle_hash,p.public_id,p.bundle_id,
  b.candidate_id,b.source_revision,b.source_payload_hash,b.bundle_hash,c.source_id,
  projection.projection_json,projection.projection_hash,
  decision.decision,decision.approved_bundle_hash AS decision_bundle_hash,
  audit.event_json,published.operation_id AS publish_operation_id,published.result_hash,published.expected_manifest_sha256 AS publish_manifest,
  published.expected_entity_version,published.expected_entity_hash,published.source_stop_epoch,
  published.source_config_epoch,published.source_safety_epoch,published.authorization_version,published.policy_epoch,published.recovery_epoch,published.expected_writer_epoch
  FROM projection_outbox outbox JOIN publication p ON p.publication_id=outbox.publication_id
  JOIN review_bundle b ON b.bundle_id=p.bundle_id JOIN pending_review_candidate c ON c.candidate_id=b.candidate_id
  JOIN review_decision decision ON decision.decision_id=p.decision_id
  JOIN published_projection projection ON projection.publication_id=p.publication_id AND projection.bundle_id=b.bundle_id AND projection.public_id=p.public_id
  JOIN internal_operation_audit audit ON audit.event_type='operation_succeeded' AND json_extract(audit.event_json,'$.automaticResult.deliveryId')=outbox.delivery_id
  JOIN internal_operation published ON published.operation_id=audit.operation_id AND published.owner_process='automatic_publisher'
    AND published.operation_kind='publish' AND published.state='succeeded' AND published.candidate_id=b.candidate_id AND published.source_id=c.source_id
    AND published.expected_schema_sha256=? AND published.expected_release_sha256=?
  WHERE outbox.delivery_id=?`).get(identity.schemaSha256,identity.releaseSha256,deliveryId) as Row|undefined;
 assert(row);
 assert(row.publish_manifest===identity.manifestSha256 || identity.verifiedFullManifestSha256!==null && row.publish_manifest===identity.verifiedFullManifestSha256);
 const audit=JSON.parse(String(row.event_json)) as Row,result=AutomaticMutationResultSchema.parse(audit.automaticResult);
 assert(result.kind==="publish" && result.operationId===row.publish_operation_id && result.deliveryId===deliveryId
  && result.publicationId===row.publication_id && result.publicId===row.public_id && result.candidateId===row.candidate_id
  && result.sourceRevision===row.source_revision && result.inputContentHash===row.source_payload_hash && result.generation===row.snapshot_generation
  && row.result_hash===audit.resultHash && row.result_hash===createHash("sha256").update(`f1plus1-automatic-result-v1\n${canonicalJson(result)}`).digest("hex")
  && row.expected_entity_version===row.source_revision && row.expected_entity_hash===row.source_payload_hash);
 assert(row.publication_status==="published" && row.approved_bundle_hash===row.bundle_hash && row.decision==="approved" && row.decision_bundle_hash===row.bundle_hash,"RSS_DELIVERY_PUBLICATION_REVOKED");
 const envelope=verifyStoredProjectionTaskEnvelope(String(row.task_envelope_json),String(row.task_envelope_hash));
 const projection=verifyStoredPublicProjection(String(row.projection_json),String(row.projection_hash));
 assert(envelope.deliveryId===deliveryId && deliveryId===`op-snapshot-${envelope.snapshot.snapshotManifestHash}`
  && envelope.idempotencyKey===row.idempotency_key && envelope.reconcileKey===row.reconcile_key
  && envelope.snapshot.snapshotGeneration===row.snapshot_generation && envelope.snapshot.snapshotManifestHash===row.snapshot_manifest_hash
  && projection.publicId===row.public_id && projection.source.sourceId===row.source_id
  && envelope.snapshot.records.some(record=>record.publicId===projection.publicId && record.projectionHash===projection.projectionHash));
 const control=database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Row;
 assert(control.global_stop_state==="clear" && control.emergency_stop_state==="clear" && control.recovery_state==="ready"
  && control.deletion_fence_state==="clear" && control.publication_fence_state==="clear","RSS_DELIVERY_CONTROL_CLOSED");
 const source=readRssAutomaticSourceState(database,String(row.source_id),identity.now);
 for(const field of ["source_config_epoch","source_safety_epoch","authorization_version","policy_epoch","recovery_epoch"] as const)assert(row[field]===control[field],"RSS_DELIVERY_EPOCH_STALE");
 assert(row.expected_writer_epoch===control.writer_epoch && row.source_stop_epoch===source.stop_epoch,"RSS_DELIVERY_EPOCH_STALE");
 const original=database.prepare(`SELECT f.*,binding.prechecked_at,binding.consumed_at,binding.postchecked_at
  FROM operation_fence_binding binding JOIN generic_fence_receipt f ON f.fence_receipt_id=binding.fence_receipt_id
  WHERE binding.operation_id=? AND f.scope_kind='publication' AND f.scope_id=?`).all(String(row.publish_operation_id),String(row.publication_id)) as Row[];
 assert(original.length===5 && KINDS.every(kind=>original.some(f=>f.fence_kind===kind)));
 for(const fence of original){
  assert(fence.reason_code==="RSS_AUTOMATIC_CURRENT_V1" && fence.state==="clear" && fence.prechecked_at!==null && fence.consumed_at===fence.prechecked_at && fence.postchecked_at!==null);
  assertIssuer(database,fence,row,source,identity,false);
 }
 // A later negative safety decision remains effective until a later decision
 // for that exact scope and kind supersedes it. Old content never clears it.
 const blocked=database.prepare(`SELECT 1 FROM generic_fence_receipt f WHERE f.state<>'clear'
  AND f.policy_epoch=? AND f.recovery_epoch=? AND f.writer_epoch=?
  AND ((f.scope_kind='global' AND f.scope_id IS NULL) OR (f.scope_kind='source' AND f.scope_id=?)
    OR (f.scope_kind='candidate' AND f.scope_id=?) OR (f.scope_kind='publication' AND f.scope_id=?))
  AND NOT EXISTS(SELECT 1 FROM generic_fence_receipt later WHERE later.scope_kind=f.scope_kind AND later.scope_id IS f.scope_id
    AND later.fence_kind=f.fence_kind AND later.policy_epoch=f.policy_epoch AND later.recovery_epoch=f.recovery_epoch AND later.writer_epoch=f.writer_epoch
    AND later.observed_at>f.observed_at) LIMIT 1`).get(control.policy_epoch as number,control.recovery_epoch as number,control.writer_epoch as number,String(row.source_id),String(row.candidate_id),String(row.publication_id));
 assert(!blocked,"RSS_DELIVERY_FENCE_REVOKED");
 return {row,source,control,original};
}

function assertIssuer(database:DatabaseSync,fence:Row,delivery:Row,source:Row,identity:Identity,renewed:boolean):void {
 assertRssAutomaticSourceBindingCurrent(database,String(fence.fence_receipt_id));
 const issuer=database.prepare(`SELECT op.* FROM internal_operation op JOIN owner_authorization_handoff handoff ON handoff.handoff_id=op.authorization_handoff_id
  AND handoff.owner_process=op.owner_process AND handoff.consumed_by_operation_id=op.operation_id
  AND handoff.release_sha256=op.expected_release_sha256 AND handoff.manifest_sha256=op.expected_manifest_sha256
  WHERE op.operation_id=? AND op.state='succeeded' AND op.owner_process='system_supervisor' AND op.operation_kind='system_producer'
  AND op.capability_class='control' AND op.control_action='fence_update' AND op.policy_id IN ('p-rss-auto-fence-live','p-rss-auto-fence-backlog')`).get(String(fence.issued_by_operation_id)) as Row|undefined;
 assert(issuer && fence.issuer==="f1plus1-system-supervisor-v1" && fence.scope_kind==="publication" && fence.scope_id===delivery.publication_id);
 assert(issuer.expected_schema_sha256===identity.schemaSha256 && issuer.expected_release_sha256===identity.releaseSha256
  && (issuer.expected_manifest_sha256===identity.manifestSha256 || issuer.expected_manifest_sha256===identity.verifiedFullManifestSha256 || issuer.expected_manifest_sha256===identity.verifiedFallbackManifestSha256)
  && issuer.candidate_id===delivery.candidate_id && issuer.source_id===delivery.source_id && issuer.publication_id===delivery.publication_id
  && issuer.expected_entity_version===delivery.source_revision && issuer.expected_entity_hash===delivery.source_payload_hash);
 for(const field of ["source_config_epoch","source_safety_epoch","authorization_version","policy_epoch","recovery_epoch"] as const)assert(issuer[field]===delivery[field],"RSS_DELIVERY_EPOCH_STALE");
 assert(issuer.expected_writer_epoch===delivery.expected_writer_epoch && issuer.source_stop_epoch===source.stop_epoch
  && fence.policy_epoch===issuer.policy_epoch && fence.recovery_epoch===issuer.recovery_epoch && fence.writer_epoch===issuer.expected_writer_epoch);
 const binding=database.prepare("SELECT 1 FROM operation_entity_binding WHERE operation_id=? AND entity_kind='source' AND identity_selector='source_id' AND entity_id=? AND expected_entity_version=? AND expected_entity_hash=?").get(String(issuer.operation_id),String(delivery.source_id),Number(source.registry_revision),String(source.identity_sha256));assert(binding,"RSS_DELIVERY_SOURCE_IDENTITY_STALE");
 if(renewed)assert(database.prepare("SELECT 1 FROM operation_entity_binding WHERE operation_id=? AND entity_kind='projection_outbox' AND entity_id=? AND expected_entity_version=? AND expected_entity_hash=?").get(String(issuer.operation_id),String(delivery.delivery_id),Number(delivery.snapshot_generation),String(delivery.task_envelope_hash)));
}

export function assertCommittedAutomaticDeliveryFence(database:DatabaseSync,operationId:string,fenceReceiptId:string,identity:Identity):void {
 const consumer=database.prepare("SELECT * FROM internal_operation WHERE operation_id=?").get(operationId) as Row|undefined;
 assert(consumer?.egress_class==="projection_private" && ((consumer.owner_process==="projection_sender" && consumer.operation_kind==="projection" && consumer.capability_class==="external_attempt") || (consumer.owner_process==="reconciler" && consumer.operation_kind==="reconcile" && consumer.capability_class==="reconcile_readonly")));
 const bound=database.prepare("SELECT entity_id FROM operation_entity_binding WHERE operation_id=? AND entity_kind='projection_outbox'").all(operationId);assert(bound.length===1);
 const proof=readCommittedDelivery(database,String(bound[0].entity_id),identity);
 assert(consumer.publication_id===proof.row.publication_id && consumer.public_id===proof.row.public_id);
 const fence=database.prepare("SELECT * FROM generic_fence_receipt WHERE fence_receipt_id=?").get(fenceReceiptId) as Row|undefined;assert(fence?.state==="clear");
 if(fence.reason_code==="RSS_AUTOMATIC_CURRENT_V1")assert(proof.original.some(item=>item.fence_receipt_id===fenceReceiptId));
 else {assert(fence.reason_code===RSS_COMMITTED_DELIVERY_FENCE_REASON);assertIssuer(database,fence,proof.row,proof.source,identity,true);}
}

export function assertCommittedDeliveryIssuanceRequest(database:DatabaseSync,request:GatewayOperationRequest,identity:Identity):void {
 assert(request.ownerProcess==="system_supervisor" && request.operationKind==="system_producer" && request.capabilityClass==="control"
  && request.controlAction==="fence_update" && request.egressClass==="none" && request.requiredFenceSet.length===0,"RSS_DELIVERY_GRANT_SCOPE_INVALID");
 const outbox=request.entitySet.filter(binding=>binding.entityKind==="projection_outbox");assert(outbox.length===1,"RSS_DELIVERY_GRANT_SCOPE_INVALID");
 const proof=readCommittedDelivery(database,outbox[0].entityId,identity);
 assert(request.identity.candidateId===proof.row.candidate_id && request.identity.sourceId===proof.row.source_id
  && request.identity.publicationId===proof.row.publication_id && request.identity.publicId===null
  && request.expected.entityVersion===proof.row.source_revision && request.expected.entityHash===proof.row.source_payload_hash
  && outbox[0].expectedVersion===proof.row.snapshot_generation && outbox[0].expectedHash===proof.row.task_envelope_hash,"RSS_DELIVERY_GRANT_SCOPE_INVALID");
 assert(request.entitySet.length===5 && ["candidate","source","publication","projection_outbox","generic_fence"].every(kind=>request.entitySet.filter(binding=>binding.entityKind===kind).length===1),"RSS_DELIVERY_GRANT_SCOPE_INVALID");
}

/** Reissue only safety receipts for one already committed automatic delivery.
 * Publication, projection, outbox bytes and generation never change here. */
export function prepareRssAutomaticDelivery(input:Readonly<{database:DatabaseSync;gateway:SqliteInternalOperationGateway;supervisorPort:SqliteGatewayMutationPort;now?:()=>Date}>):Readonly<{issued:number;reused:number}> {
 const now=(input.now??(()=>new Date()))();
 const next=input.database.prepare(`SELECT outbox.delivery_id FROM projection_outbox outbox
  WHERE outbox.status IN ('leased','reconcile_wait','pending','retryable_failed')
  ORDER BY CASE outbox.status WHEN 'leased' THEN 0 WHEN 'reconcile_wait' THEN 1 ELSE 2 END,outbox.created_at,outbox.delivery_id LIMIT 1`).get();
 if(!next)return {issued:0,reused:0};
 const automatic=input.database.prepare("SELECT 1 FROM internal_operation_audit WHERE event_type='operation_succeeded' AND json_extract(event_json,'$.automaticResult.kind')='publish' AND json_extract(event_json,'$.automaticResult.deliveryId')=?").get(String(next.delivery_id));
 if(!automatic)return {issued:0,reused:0};
 const identity={schemaSha256:input.gateway.expectedSchemaSha256(),releaseSha256:input.gateway.expectedReleaseSha256(),manifestSha256:input.gateway.expectedManifestSha256(),verifiedFullManifestSha256:input.gateway.verifiedRssAutomaticFullManifest(),verifiedFallbackManifestSha256:input.gateway.verifiedRssAutomaticFallbackManifest(),now};
 const proof=readCommittedDelivery(input.database,String(next.delivery_id),identity);let issued=0,reused=0;
 for(const kind of KINDS){
  const existing=input.database.prepare("SELECT * FROM generic_fence_receipt WHERE scope_kind='publication' AND scope_id=? AND fence_kind=? AND state='clear' AND expires_at>? ORDER BY observed_at DESC,fence_receipt_id DESC LIMIT 1").get(String(proof.row.publication_id),kind,new Date(now.getTime()+30_000).toISOString()) as Row|undefined;
  if(existing){try{if(existing.reason_code==="RSS_AUTOMATIC_CURRENT_V1")assert(proof.original.some(f=>f.fence_receipt_id===existing.fence_receipt_id));else{assert(existing.reason_code===RSS_COMMITTED_DELIVERY_FENCE_REASON);assertIssuer(input.database,existing,proof.row,proof.source,identity,true);}reused++;continue;}catch{/* A fresh receipt must prove this same frozen delivery. */}}
  const expiresAt=new Date(Math.min(now.getTime()+900_000,Date.parse(String(proof.source.authorization_expires_at)))).toISOString();
  const seed=hash({deliveryId:proof.row.delivery_id,kind,now:now.toISOString(),expiresAt,manifest:identity.manifestSha256}),operationId=`rss-delivery-fence-${seed}`,fenceReceiptId=`rss-delivery-receipt-${seed}`;
  const entitySet:EntityBinding[]=[{entityKind:"candidate",entityId:String(proof.row.candidate_id),identitySelector:"candidate_id",expectedVersion:Number(proof.row.source_revision),expectedHash:String(proof.row.source_payload_hash)},
   {entityKind:"source",entityId:String(proof.row.source_id),identitySelector:"source_id",expectedVersion:Number(proof.source.registry_revision),expectedHash:String(proof.source.identity_sha256)},
   {entityKind:"publication",entityId:String(proof.row.publication_id),identitySelector:"publication_id",expectedVersion:null,expectedHash:ZERO},
   {entityKind:"projection_outbox",entityId:String(proof.row.delivery_id),identitySelector:"bound_child",expectedVersion:Number(proof.row.snapshot_generation),expectedHash:String(proof.row.task_envelope_hash)},
   {entityKind:"generic_fence",entityId:fenceReceiptId,identitySelector:"bound_child",expectedVersion:null,expectedHash:ZERO}];
  const nonce=randomBytes(32).toString("base64url"),receiptHash=hash({operationId,fenceReceiptId,kind,deliveryId:proof.row.delivery_id,nonce,expiresAt});
  input.supervisorPort.runTransaction({operationId,operationKind:"system_producer",ownerProcess:"system_supervisor",policyId:`p-rss-auto-fence-${proof.control.phase}`,capabilityClass:"control",egressClass:"none",controlAction:"fence_update",
   identity:{sourceId:String(proof.row.source_id),candidateId:String(proof.row.candidate_id),publicationId:String(proof.row.publication_id),publicId:null},entitySet,requiredFenceSet:[],sourceStopEpoch:Number(proof.source.stop_epoch),requestHash:receiptHash},mutate=>{
    readCommittedDelivery(input.database,String(proof.row.delivery_id),identity);
    assert(mutate({entityKind:"generic_fence",entityId:fenceReceiptId,mutationKind:"insert",expectedVersion:null,expectedHash:ZERO,statement:"INSERT INTO generic_fence_receipt VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
     parameters:[fenceReceiptId,"publication",proof.row.publication_id,kind,"clear",RSS_COMMITTED_DELIVERY_FENCE_REASON,"f1plus1-system-supervisor-v1",operationId,nonce,receiptHash,proof.control.policy_epoch,proof.control.recovery_epoch,proof.control.writer_epoch,now.toISOString(),expiresAt]})===1);
   });issued++;
 }
 return {issued,reused};
}
