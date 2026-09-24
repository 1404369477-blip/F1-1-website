import {createHash,randomBytes} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {canonicalJson} from "../db/profile.ts";
import type {EntityBinding,GatewayOperationRequest,SqliteInternalOperationGateway} from "../internal-operation/gateway.ts";
import type {SqliteGatewayMutationPort} from "../internal-operation/mutation-port.ts";
import {AutomaticMutationResultSchema} from "../rss-automatic/contract.ts";
import {buildPublicProjectionRecord,verifyStoredProjectionTaskEnvelope,verifyStoredPublicProjection,verifyStoredReviewBundle} from "../review-real/mapping.ts";
import {assertXPageAutomaticSourceBindingCurrent,assertXPageOperationSourcesCurrent} from "./source-authority.ts";
import {readXPageAutomaticControl,readXPageCaptureCommitment,xPageAutomaticContentBindings,X_PAGE_AUTOMATIC_FENCE_REASON,type XPageAuthorityIdentity} from "./content-authority.ts";
import {assertXPageCurrentFences,X_PAGE_COMMITTED_DELIVERY_FENCE_REASON} from "./current-fences.ts";

export {X_PAGE_COMMITTED_DELIVERY_FENCE_REASON} from "./current-fences.ts";
const ZERO="0".repeat(64),KINDS=["deletion","publication","completeness","rights","media"] as const;
type Row=Record<string,unknown>;
const hash=(value:unknown)=>createHash("sha256").update(canonicalJson(value)).digest("hex");
function assert(value:unknown,code="X_PAGE_DELIVERY_AUTHORITY_INVALID"):asserts value {if(!value)throw new Error(code);}
function permittedManifest(value:unknown,identity:XPageAuthorityIdentity):boolean {
  return value===identity.manifestSha256||identity.verifiedFullManifestSha256!==null&&value===identity.verifiedFullManifestSha256
    ||identity.verifiedFallbackManifestSha256!==null&&value===identity.verifiedFallbackManifestSha256;
}

/** The one existing sender may deliver these already committed bytes after a
 * content revision changes. Its source permissions and safety clocks remain
 * current; the historical signed capture and approved bytes remain immutable. */
export function readXPageCommittedDelivery(database:DatabaseSync,deliveryId:string,identity:XPageAuthorityIdentity) {
  const row=database.prepare(`SELECT outbox.*,p.publication_status,p.approved_bundle_hash,p.public_id,p.bundle_id,
    b.candidate_id,b.source_revision,b.source_payload_hash,b.bundle_hash,b.bundle_revision,b.public_payload_json,b.public_payload_hash,b.editor_notes,b.created_at AS bundle_created_at,c.source_id,
    projection.projection_json,projection.projection_hash,decision.decision,decision.approved_bundle_hash AS decision_bundle_hash,
    audit.event_json,published.operation_id AS publish_operation_id,published.result_hash,published.expected_manifest_sha256 AS publish_manifest,
    published.expected_entity_version,published.expected_entity_hash,published.source_stop_epoch,
    published.source_config_epoch,published.source_safety_epoch,published.authorization_version,published.policy_epoch,published.recovery_epoch,published.expected_writer_epoch
    FROM projection_outbox outbox JOIN publication p ON p.publication_id=outbox.publication_id
    JOIN review_bundle b ON b.bundle_id=p.bundle_id JOIN pending_review_candidate c ON c.candidate_id=b.candidate_id
    JOIN review_decision decision ON decision.decision_id=p.decision_id
    JOIN published_projection projection ON projection.publication_id=p.publication_id AND projection.bundle_id=b.bundle_id AND projection.public_id=p.public_id
    JOIN internal_operation_audit audit ON audit.event_type='operation_succeeded' AND json_extract(audit.event_json,'$.automaticResult.deliveryId')=outbox.delivery_id
    JOIN internal_operation published ON published.operation_id=audit.operation_id AND published.owner_process='automatic_publisher'
      AND published.operation_kind='publish' AND published.policy_id='p-x-page-auto-publish-live' AND published.capability_class='db_mutation' AND published.egress_class='none'
      AND published.state='succeeded' AND published.candidate_id=b.candidate_id AND published.source_id=c.source_id
      AND published.expected_schema_sha256=? AND published.expected_release_sha256=?
    WHERE outbox.delivery_id=?`).get(identity.schemaSha256,identity.releaseSha256,deliveryId) as Row|undefined;
  assert(row&&permittedManifest(row.publish_manifest,identity));
  const audit=JSON.parse(String(row.event_json)) as Row,result=AutomaticMutationResultSchema.parse(audit.automaticResult);
  assert(result.kind==="publish"&&result.operationId===row.publish_operation_id&&result.deliveryId===deliveryId&&result.publicationId===row.publication_id
    &&result.publicId===row.public_id&&result.candidateId===row.candidate_id&&result.sourceRevision===row.source_revision&&result.inputContentHash===row.source_payload_hash
    &&result.generation===row.snapshot_generation&&row.result_hash===audit.resultHash
    &&row.result_hash===createHash("sha256").update(`f1plus1-automatic-result-v1\n${canonicalJson(result)}`).digest("hex")
    &&row.expected_entity_version===row.source_revision&&row.expected_entity_hash===row.source_payload_hash);
  assert(row.publication_status==="published"&&row.approved_bundle_hash===row.bundle_hash&&row.decision==="approved"&&row.decision_bundle_hash===row.bundle_hash,"X_PAGE_DELIVERY_PUBLICATION_REVOKED");
  const target={candidateId:String(row.candidate_id),sourceRevision:Number(row.source_revision),inputContentHash:String(row.source_payload_hash)};
  const content=readXPageCaptureCommitment(database,target,identity.now,{allowHistoricalRevision:true});
  const bundle=verifyStoredReviewBundle({bundleId:String(row.bundle_id),bundleRevision:Number(row.bundle_revision),createdAt:String(row.bundle_created_at),publicPayloadJson:String(row.public_payload_json),
    publicPayloadHash:String(row.public_payload_hash),editorNotes:String(row.editor_notes),bundleHash:String(row.bundle_hash)});
  assert(bundle.publicPayload.contentType==="driver_social"&&bundle.publicPayload.xCaptureSha256===content.verified.captureSha256
    &&bundle.publicPayload.sourceTitle===content.verified.normalized.text&&bundle.publicPayload.canonicalUrl===content.verified.normalized.canonicalUrl,"X_PAGE_DELIVERY_CAPTURE_STALE");
  const envelope=verifyStoredProjectionTaskEnvelope(String(row.task_envelope_json),String(row.task_envelope_hash));
  const projection=verifyStoredPublicProjection(String(row.projection_json),String(row.projection_hash));
  assert(projection.contentType==="driver_social"&&projection.source.platform==="x"&&projection.source.sourceId===row.source_id&&projection.media===null);
  const expectedProjection=buildPublicProjectionRecord({publicId:String(row.public_id),bundleHash:bundle.bundleHash,publishedAt:projection.publishedAt,
    publicPayload:bundle.publicPayload,keyPointsZh:projection.detail.keyPointsZh});
  assert(canonicalJson(expectedProjection)===row.projection_json&&envelope.deliveryId===deliveryId&&deliveryId===`op-snapshot-${envelope.snapshot.snapshotManifestHash}`
    &&envelope.idempotencyKey===row.idempotency_key&&envelope.reconcileKey===row.reconcile_key&&envelope.snapshot.snapshotGeneration===row.snapshot_generation
    &&envelope.snapshot.snapshotManifestHash===row.snapshot_manifest_hash&&projection.publicId===row.public_id
    &&envelope.snapshot.records.some(record=>record.publicId===projection.publicId&&record.projectionHash===projection.projectionHash));
  const control=readXPageAutomaticControl(database),source=content.source;
  for(const field of ["source_config_epoch","source_safety_epoch","authorization_version","policy_epoch","recovery_epoch"] as const)assert(row[field]===control[field],"X_PAGE_DELIVERY_EPOCH_STALE");
  assert(row.expected_writer_epoch===control.writer_epoch&&row.source_stop_epoch===source.stop_epoch,"X_PAGE_DELIVERY_EPOCH_STALE");
  assertXPageOperationSourcesCurrent(database,String(row.publish_operation_id),identity.now);
  const original=database.prepare(`SELECT f.*,binding.prechecked_at,binding.consumed_at,binding.postchecked_at
    FROM operation_fence_binding binding JOIN generic_fence_receipt f ON f.fence_receipt_id=binding.fence_receipt_id
    WHERE binding.operation_id=? AND f.scope_kind='publication' AND f.scope_id=?`).all(String(row.publish_operation_id),String(row.publication_id)) as Row[];
  assert(original.length===5&&KINDS.every(kind=>original.some(fence=>fence.fence_kind===kind)));
  for(const fence of original){
    assert(fence.reason_code===X_PAGE_AUTOMATIC_FENCE_REASON&&fence.state==="clear"&&fence.prechecked_at!==null&&fence.consumed_at===fence.prechecked_at&&fence.postchecked_at!==null);
    assertIssuer(database,fence,row,content,identity,false);
  }
  assertXPageCurrentFences(database,{target,sourceIds:[String(source.source_id),String(content.observedSource.source_id)],
    publicationId:String(row.publication_id),now:identity.now,reasonCode:"X_PAGE_DELIVERY_FENCE_REVOKED"});
  return {row,source,control,original,content,target,envelope};
}

function assertIssuer(database:DatabaseSync,fence:Row,delivery:Row,content:ReturnType<typeof readXPageCaptureCommitment>,identity:XPageAuthorityIdentity,renewed:boolean):void {
  assertXPageAutomaticSourceBindingCurrent(database,String(fence.fence_receipt_id));
  const issuer=database.prepare(`SELECT op.* FROM internal_operation op JOIN owner_authorization_handoff handoff ON handoff.handoff_id=op.authorization_handoff_id
    AND handoff.owner_process=op.owner_process AND handoff.consumed_by_operation_id=op.operation_id AND handoff.release_sha256=op.expected_release_sha256 AND handoff.manifest_sha256=op.expected_manifest_sha256
    WHERE op.operation_id=? AND op.state='succeeded' AND op.owner_process='system_supervisor' AND op.operation_kind='system_producer'
      AND op.capability_class='control' AND op.control_action='fence_update' AND op.policy_id='p-x-page-fence-live'`).get(String(fence.issued_by_operation_id)) as Row|undefined;
  assert(issuer&&fence.issuer==="f1plus1-system-supervisor-v1"&&fence.scope_kind==="publication"&&fence.scope_id===delivery.publication_id);
  assert(issuer.expected_schema_sha256===identity.schemaSha256&&issuer.expected_release_sha256===identity.releaseSha256&&permittedManifest(issuer.expected_manifest_sha256,identity)
    &&issuer.candidate_id===delivery.candidate_id&&issuer.source_id===delivery.source_id&&issuer.publication_id===delivery.publication_id
    &&issuer.expected_entity_version===delivery.source_revision&&issuer.expected_entity_hash===delivery.source_payload_hash);
  for(const field of ["source_config_epoch","source_safety_epoch","authorization_version","policy_epoch","recovery_epoch"] as const)assert(issuer[field]===delivery[field],"X_PAGE_DELIVERY_EPOCH_STALE");
  assert(issuer.expected_writer_epoch===delivery.expected_writer_epoch&&issuer.source_stop_epoch===content.source.stop_epoch
    &&fence.policy_epoch===issuer.policy_epoch&&fence.recovery_epoch===issuer.recovery_epoch&&fence.writer_epoch===issuer.expected_writer_epoch);
  assertXPageOperationSourcesCurrent(database,String(issuer.operation_id),identity.now);
  const target={candidateId:String(delivery.candidate_id),sourceRevision:Number(delivery.source_revision),inputContentHash:String(delivery.source_payload_hash)};
  for(const binding of xPageAutomaticContentBindings(content,target))assert(database.prepare(`SELECT 1 FROM operation_entity_binding WHERE operation_id=? AND entity_kind=? AND entity_id=?
    AND identity_selector=? AND expected_entity_version IS ? AND expected_entity_hash=?`).get(String(issuer.operation_id),binding.entityKind,binding.entityId,binding.identitySelector,binding.expectedVersion,binding.expectedHash));
  if(renewed)assert(database.prepare("SELECT 1 FROM operation_entity_binding WHERE operation_id=? AND entity_kind='projection_outbox' AND entity_id=? AND expected_entity_version=? AND expected_entity_hash=?")
    .get(String(issuer.operation_id),String(delivery.delivery_id),Number(delivery.snapshot_generation),String(delivery.task_envelope_hash)));
}

export function assertXPageCommittedDeliveryFence(database:DatabaseSync,operationId:string,fenceReceiptId:string,identity:XPageAuthorityIdentity):void {
  const consumer=database.prepare("SELECT * FROM internal_operation WHERE operation_id=?").get(operationId) as Row|undefined;
  assert(consumer?.egress_class==="projection_private"&&((consumer.owner_process==="projection_sender"&&consumer.operation_kind==="projection"&&consumer.capability_class==="external_attempt"&&consumer.policy_id==="p-x-page-projection-live")
    ||(consumer.owner_process==="reconciler"&&consumer.operation_kind==="reconcile"&&consumer.capability_class==="reconcile_readonly"&&consumer.policy_id==="p-x-page-reconcile-live")));
  const bound=database.prepare("SELECT * FROM operation_entity_binding WHERE operation_id=? AND entity_kind='projection_outbox'").all(operationId);assert(bound.length===1);
  const proof=readXPageCommittedDelivery(database,String(bound[0].entity_id),identity);
  assert(consumer.publication_id===proof.row.publication_id&&consumer.public_id===proof.row.public_id&&consumer.source_id===proof.row.source_id
    &&consumer.candidate_id===proof.target.candidateId&&consumer.source_stop_epoch===proof.source.stop_epoch
    &&bound[0].expected_entity_version===proof.row.snapshot_generation&&bound[0].expected_entity_hash===proof.row.task_envelope_hash);
  assertXPageOperationSourcesCurrent(database,operationId,identity.now);
  for(const binding of xPageAutomaticContentBindings(proof.content,proof.target))assert(database.prepare(`SELECT 1 FROM operation_entity_binding WHERE operation_id=? AND entity_kind=? AND entity_id=?
    AND identity_selector=? AND expected_entity_version IS ? AND expected_entity_hash=?`).get(operationId,binding.entityKind,binding.entityId,binding.identitySelector,binding.expectedVersion,binding.expectedHash));
  const fence=database.prepare("SELECT * FROM generic_fence_receipt WHERE fence_receipt_id=?").get(fenceReceiptId) as Row|undefined;assert(fence?.state==="clear");
  if(fence.reason_code===X_PAGE_AUTOMATIC_FENCE_REASON)assert(proof.original.some(item=>item.fence_receipt_id===fenceReceiptId));
  else {assert(fence.reason_code===X_PAGE_COMMITTED_DELIVERY_FENCE_REASON);assertIssuer(database,fence,proof.row,proof.content,identity,true);}
}

export function assertXPageCommittedDeliveryIssuanceRequest(database:DatabaseSync,request:GatewayOperationRequest,identity:XPageAuthorityIdentity):void {
  assert(request.ownerProcess==="system_supervisor"&&request.operationKind==="system_producer"&&request.capabilityClass==="control"&&request.policyId==="p-x-page-fence-live"
    &&request.controlAction==="fence_update"&&request.egressClass==="none"&&request.requiredFenceSet.length===0,"X_PAGE_DELIVERY_GRANT_SCOPE_INVALID");
  const outboxes=request.entitySet.filter(binding=>binding.entityKind==="projection_outbox"),fences=request.entitySet.filter(binding=>binding.entityKind==="generic_fence");
  assert(outboxes.length===1&&fences.length===1,"X_PAGE_DELIVERY_GRANT_SCOPE_INVALID");
  const proof=readXPageCommittedDelivery(database,outboxes[0].entityId,identity),expected=[...xPageAutomaticContentBindings(proof.content,proof.target),
    {entityKind:"publication",entityId:String(proof.row.publication_id),identitySelector:"publication_id",expectedVersion:null,expectedHash:ZERO},
    {entityKind:"projection_outbox",entityId:String(proof.row.delivery_id),identitySelector:"bound_child",expectedVersion:Number(proof.row.snapshot_generation),expectedHash:String(proof.row.task_envelope_hash)},
    {entityKind:"generic_fence",entityId:fences[0].entityId,identitySelector:"bound_child",expectedVersion:null,expectedHash:ZERO}];
  assert(request.identity.candidateId===proof.row.candidate_id&&request.identity.sourceId===proof.row.source_id&&request.identity.publicationId===proof.row.publication_id
    &&request.identity.publicId===null&&request.expected.entityVersion===proof.row.source_revision&&request.expected.entityHash===proof.row.source_payload_hash
    &&request.entitySet.length===expected.length&&expected.every(binding=>request.entitySet.some(actual=>canonicalJson(binding)===canonicalJson(actual))),"X_PAGE_DELIVERY_GRANT_SCOPE_INVALID");
}

export function prepareXPageAutomaticDelivery(input:Readonly<{database:DatabaseSync;gateway:SqliteInternalOperationGateway;supervisorPort:SqliteGatewayMutationPort;now?:()=>Date}>):Readonly<{issued:number;reused:number}> {
  const now=(input.now??(()=>new Date()))();
  const next=input.database.prepare(`SELECT delivery_id FROM projection_outbox WHERE status IN ('leased','reconcile_wait','pending','retryable_failed')
    ORDER BY CASE status WHEN 'leased' THEN 0 WHEN 'reconcile_wait' THEN 1 ELSE 2 END,created_at,delivery_id LIMIT 1`).get();
  if(!next)return {issued:0,reused:0};
  const automatic=input.database.prepare(`SELECT 1 FROM internal_operation_audit a JOIN internal_operation op ON op.operation_id=a.operation_id
    WHERE a.event_type='operation_succeeded' AND op.policy_id='p-x-page-auto-publish-live' AND json_extract(a.event_json,'$.automaticResult.deliveryId')=?`).get(String(next.delivery_id));
  if(!automatic)return {issued:0,reused:0};
  const identity:XPageAuthorityIdentity={schemaSha256:input.gateway.expectedSchemaSha256(),releaseSha256:input.gateway.expectedReleaseSha256(),manifestSha256:input.gateway.expectedManifestSha256(),
    verifiedFullManifestSha256:input.gateway.verifiedRssAutomaticFullManifest(),verifiedFallbackManifestSha256:input.gateway.verifiedRssAutomaticFallbackManifest(),now};
  const proof=readXPageCommittedDelivery(input.database,String(next.delivery_id),identity);let issued=0,reused=0;
  for(const kind of KINDS){
    const existing=input.database.prepare("SELECT * FROM generic_fence_receipt WHERE scope_kind='publication' AND scope_id=? AND fence_kind=? AND state='clear' AND expires_at>? ORDER BY observed_at DESC,fence_receipt_id DESC LIMIT 1")
      .get(String(proof.row.publication_id),kind,new Date(now.getTime()+30_000).toISOString()) as Row|undefined;
    if(existing){try{if(existing.reason_code===X_PAGE_AUTOMATIC_FENCE_REASON)assert(proof.original.some(fence=>fence.fence_receipt_id===existing.fence_receipt_id));
      else {assert(existing.reason_code===X_PAGE_COMMITTED_DELIVERY_FENCE_REASON);assertIssuer(input.database,existing,proof.row,proof.content,identity,true);}reused++;continue;}catch{/* Reissue for these exact committed bytes. */}}
    const expiresAt=new Date(Math.min(now.getTime()+900_000,Date.parse(String(proof.source.authorization_expires_at)),Date.parse(String(proof.content.observedSource.authorization_expires_at)))).toISOString();
    const seed=hash({deliveryId:proof.row.delivery_id,kind,now:now.toISOString(),expiresAt,manifest:identity.manifestSha256}),operationId=`x-page-delivery-fence-${seed}`,fenceReceiptId=`x-page-delivery-receipt-${seed}`;
    const entitySet:EntityBinding[]=[...xPageAutomaticContentBindings(proof.content,proof.target),
      {entityKind:"publication",entityId:String(proof.row.publication_id),identitySelector:"publication_id",expectedVersion:null,expectedHash:ZERO},
      {entityKind:"projection_outbox",entityId:String(proof.row.delivery_id),identitySelector:"bound_child",expectedVersion:Number(proof.row.snapshot_generation),expectedHash:String(proof.row.task_envelope_hash)},
      {entityKind:"generic_fence",entityId:fenceReceiptId,identitySelector:"bound_child",expectedVersion:null,expectedHash:ZERO}];
    const nonce=randomBytes(32).toString("base64url"),receiptHash=hash({operationId,fenceReceiptId,kind,deliveryId:proof.row.delivery_id,nonce,expiresAt});
    input.supervisorPort.runTransaction({operationId,operationKind:"system_producer",ownerProcess:"system_supervisor",policyId:"p-x-page-fence-live",capabilityClass:"control",egressClass:"none",controlAction:"fence_update",
      identity:{sourceId:String(proof.row.source_id),candidateId:proof.target.candidateId,publicationId:String(proof.row.publication_id),publicId:null},entitySet,requiredFenceSet:[],sourceStopEpoch:Number(proof.source.stop_epoch),requestHash:receiptHash},mutate=>{
      readXPageCommittedDelivery(input.database,String(proof.row.delivery_id),identity);
      assert(mutate({entityKind:"generic_fence",entityId:fenceReceiptId,mutationKind:"insert",expectedVersion:null,expectedHash:ZERO,statement:"INSERT INTO generic_fence_receipt VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        parameters:[fenceReceiptId,"publication",proof.row.publication_id,kind,"clear",X_PAGE_COMMITTED_DELIVERY_FENCE_REASON,"f1plus1-system-supervisor-v1",operationId,nonce,receiptHash,
          proof.control.policy_epoch,proof.control.recovery_epoch,proof.control.writer_epoch,now.toISOString(),expiresAt]})===1);
      readXPageCommittedDelivery(input.database,String(proof.row.delivery_id),identity);
    });issued++;
  }
  return {issued,reused};
}
