import {createHash,randomBytes} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {canonicalJson} from "../db/profile.ts";
import type {EntityBinding,FenceKind,GatewayOperationRequest,SqliteInternalOperationGateway} from "../internal-operation/gateway.ts";
import type {SqliteGatewayMutationPort} from "../internal-operation/mutation-port.ts";
import {AutomaticMutationResultSchema} from "../rss-automatic/contract.ts";
import {refineModelById} from "../rss/refine-model.ts";
import {verifyStoredReviewBundle} from "../review-real/mapping.ts";
import {MachineSummaryDraftSchema} from "../review-real/schema.ts";
import {X_PAGE_REFINE_PROMPT,X_PAGE_REFINE_PROMPT_SHA256} from "./refinement.ts";
import {verifyTrustedXCapture,type VerifiedXCapture} from "./trusted-capture.ts";
import {XPageProducerReceiptSchema,XPageRefinementTargetSchema,type XPageRefinementTarget} from "./trusted-importer.ts";
import {xPageImportResultHash} from "./producer-receipt-ledger.ts";
import {readXPageAutomaticSourceState,readXPageHistoricalAdmission,xPageAutomaticSourceSnapshotHash,
  assertXPageOperationSourcesCurrent} from "./source-authority.ts";
import {assertXPageCurrentFences,X_PAGE_AUTOMATIC_FENCE_REASON} from "./current-fences.ts";

export {X_PAGE_AUTOMATIC_FENCE_REASON} from "./current-fences.ts";
export const X_PAGE_AUTOMATIC_FENCE_TTL_MS=900_000;
export type XPageAuthorityIdentity=Readonly<{schemaSha256:string;releaseSha256:string;manifestSha256:string;
  verifiedFullManifestSha256:string|null;verifiedFallbackManifestSha256:string|null;now:Date}>;
export type XPageAutomaticTarget=XPageRefinementTarget;
type Row=Record<string,unknown>;
const ZERO="0".repeat(64),HASH=/^[0-9a-f]{64}$/;
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const commitment=(value:unknown)=>hash(canonicalJson(value));
function assert(value:unknown,code:string):asserts value {if(!value)throw new Error(code);}
function parse(value:unknown,code:string):Row {
  assert(typeof value==="string",code);
  try {const row=JSON.parse(value);assert(row&&typeof row==="object"&&!Array.isArray(row),code);return row as Row;}catch{throw new Error(code);}
}
export function readXPageAutomaticControl(database:DatabaseSync):Row {
  const control=database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Row|undefined;
  assert(control?.phase==="live"&&control.global_stop_state==="clear"&&control.emergency_stop_state==="clear"
    &&control.recovery_state==="ready"&&control.deletion_fence_state==="clear"&&control.publication_fence_state==="clear","X_PAGE_AUTOMATIC_CONTROL_CLOSED");
  return control;
}

/** A historical signature is checked at the immutable acceptance time. Present
 * source permission is checked separately; this never changes capture time or
 * trusts a caller-supplied ready/verified flag. The import gateway has already
 * atomically bound its durable artifact proof and exact callback result. */
export function readXPageCaptureCommitment(database:DatabaseSync,target:XPageAutomaticTarget,now:Date,
  options:Readonly<{allowHistoricalRevision?:boolean}>={}) {
  XPageRefinementTargetSchema.parse(target);assert(/^xpage-[0-9a-f]{64}$/.test(target.candidateId),"X_PAGE_AUTOMATIC_TARGET_INVALID");
  const candidate=database.prepare("SELECT * FROM pending_review_candidate WHERE candidate_id=?").get(target.candidateId) as Row|undefined;
  assert(candidate,"X_PAGE_AUTOMATIC_TARGET_MISSING");
  if(!options.allowHistoricalRevision)assert(candidate.source_revision===target.sourceRevision&&candidate.source_payload_hash===target.inputContentHash,"X_PAGE_AUTOMATIC_SOURCE_STALE");
  const capture=database.prepare("SELECT * FROM x_page_candidate_capture_v1 WHERE candidate_id=? AND source_revision=? AND source_version_hash=?")
    .get(target.candidateId,target.sourceRevision,target.inputContentHash) as Row|undefined;
  assert(capture&&capture.source_id===candidate.source_id,"X_PAGE_AUTOMATIC_CAPTURE_MISSING");
  const envelope=parse(capture.evidence_json,"X_PAGE_AUTOMATIC_CAPTURE_INVALID");
  assert(canonicalJson(envelope)===capture.evidence_json&&commitment(envelope)===capture.evidence_sha256,"X_PAGE_AUTOMATIC_CAPTURE_CORRUPT");
  const evidence=envelope.evidence as Row|undefined;
  assert(evidence&&typeof evidence.producerId==="string"&&typeof evidence.receiptId==="string","X_PAGE_AUTOMATIC_CAPTURE_INVALID");
  const row=database.prepare(`SELECT r.*,op.state AS import_state,op.owner_process AS import_owner,op.operation_kind AS import_kind,
    op.capability_class AS import_capability,op.policy_id AS import_policy,op.egress_class AS import_egress,op.result_hash AS import_result_hash,
    op.candidate_id AS import_candidate_id,op.source_id AS import_source_id
    FROM x_page_producer_receipt_v1 r JOIN internal_operation op ON op.operation_id=r.operation_id
    WHERE r.producer_id=? AND r.receipt_id=?`).get(evidence.producerId,evidence.receiptId) as Row|undefined;
  assert(row&&row.import_state==="succeeded"&&row.import_owner==="x_page_importer"&&row.import_kind==="collect"
    &&row.import_capability==="db_mutation"&&row.import_policy==="p-x-page-trusted-import-live"&&row.import_egress==="none","X_PAGE_AUTOMATIC_IMPORT_UNPROVEN");
  const receipt=XPageProducerReceiptSchema.parse(parse(row.receipt_json,"X_PAGE_AUTOMATIC_RECEIPT_INVALID")),result=receipt.result;
  assert(canonicalJson(receipt)===row.receipt_json&&commitment(receipt)===row.receipt_sha256
    &&receipt.schemaVersion==="x-page-producer-receipt-v1"&&result?.schemaVersion==="x-page-trusted-import-result-v1"
    &&["created","updated"].includes(String(result.decision))&&row.import_result_hash===xPageImportResultHash(result)
    &&receipt.producerId===row.producer_id&&receipt.receiptId===row.receipt_id&&receipt.captureSha256===row.capture_sha256
    &&receipt.captureProofSha256===row.capture_proof_sha256&&HASH.test(String(row.capture_proof_sha256))
    &&receipt.sourceId===row.source_id&&receipt.observedSourceId===row.observed_source_id
    &&receipt.capturedSourceVersionHash===row.captured_source_version_hash&&receipt.acceptedAt===row.accepted_at
    &&result.candidateId===target.candidateId&&row.candidate_id===target.candidateId&&row.import_candidate_id===target.candidateId
    &&result.sourceId===candidate.source_id&&row.source_id===candidate.source_id&&row.import_source_id===candidate.source_id
    &&result.sourceRevision===target.sourceRevision&&row.source_revision===target.sourceRevision
    &&result.sourceVersionHash===target.inputContentHash&&row.captured_source_version_hash===target.inputContentHash
    &&result.captureSha256===capture.evidence_sha256&&row.capture_sha256===capture.evidence_sha256
    &&result.operationId===capture.operation_id&&row.operation_id===capture.operation_id,"X_PAGE_AUTOMATIC_RECEIPT_BINDING_INVALID");
  assert(Number.isFinite(now.getTime())&&Date.parse(String(row.accepted_at))<=now.getTime(),"X_PAGE_AUTOMATIC_RECEIPT_TIME_INVALID");
  const admission=readXPageHistoricalAdmission(database,String(row.admission_id));
  const verified=verifyTrustedXCapture({capture:envelope,trust:admission.trust,now:new Date(String(row.accepted_at))});
  const normalized=verified.normalized;
  assert(verified.captureSha256===capture.evidence_sha256&&`xpage-${normalized.identity}`===target.candidateId
    &&normalized.sourceVersionHash===target.inputContentHash&&normalized.statusId===capture.status_id
    &&normalized.authorHandle===capture.author_handle&&normalized.observedAt===capture.observed_at
    &&normalized.text===capture.complete_text&&canonicalJson(normalized)===capture.normalized_json
    &&verified.capture.evidence.sourceId===candidate.source_id&&verified.capture.evidence.observedSourceId===row.observed_source_id,"X_PAGE_AUTOMATIC_CAPTURE_BINDING_INVALID");
  if(!options.allowHistoricalRevision)assert(normalized.canonicalUrl===candidate.canonical_url&&normalized.statusId===candidate.external_id
    &&normalized.publishedAt===candidate.published_at,"X_PAGE_AUTOMATIC_CANDIDATE_BINDING_INVALID");
  const source=readXPageAutomaticSourceState(database,String(candidate.source_id),now);
  const observedSource=verified.capture.evidence.observedSourceId===source.source_id?source:
    readXPageAutomaticSourceState(database,verified.capture.evidence.observedSourceId,now);
  assert(source.identity_sha256===verified.sourceScope.identitySha256&&observedSource.identity_sha256===verified.observedSourceScope.identitySha256,
    "X_PAGE_AUTOMATIC_SOURCE_IDENTITY_STALE");
  return {candidate,capture,verified,source,observedSource,receipt,admission};
}
export type XPageCaptureCommitment=ReturnType<typeof readXPageCaptureCommitment>;

export function assertXPageNoManualOverride(database:DatabaseSync,target:XPageAutomaticTarget,candidate:Row):void {
  assert(["pending_review","approved","published"].includes(String(candidate.review_status)),"X_PAGE_AUTOMATIC_MANUAL_OVERRIDE");
  assert(!database.prepare(`SELECT 1 FROM review_decision d JOIN review_bundle b ON b.bundle_id=d.bundle_id
    WHERE b.candidate_id=? AND b.source_revision=? AND b.source_payload_hash=? AND d.decision='rejected' LIMIT 1`)
    .get(target.candidateId,target.sourceRevision,target.inputContentHash),"X_PAGE_AUTOMATIC_MANUAL_OVERRIDE");
  const bundles=database.prepare("SELECT * FROM review_bundle WHERE candidate_id=? AND source_revision=? AND source_payload_hash=? ORDER BY bundle_revision")
    .all(target.candidateId,target.sourceRevision,target.inputContentHash) as Row[];
  for(const bundle of bundles){
    const operation=database.prepare(`SELECT op.operation_id,op.result_hash,a.event_json FROM internal_operation op JOIN internal_operation_audit a ON a.operation_id=op.operation_id
      WHERE op.owner_process='automatic_reviewer' AND op.operation_kind='review' AND op.policy_id='p-x-page-auto-review-live' AND op.state='succeeded'
      AND a.event_type='operation_succeeded' AND json_extract(a.event_json,'$.automaticResult.bundleId')=?`).get(String(bundle.bundle_id)) as Row|undefined;
    assert(operation,"X_PAGE_AUTOMATIC_MANUAL_OVERRIDE");
    const audit=parse(operation.event_json,"X_PAGE_AUTOMATIC_REVIEW_RECEIPT_INVALID"),result=AutomaticMutationResultSchema.parse(audit.automaticResult);
    assert(result.kind==="review"&&result.operationId===operation.operation_id&&result.candidateId===target.candidateId
      &&result.sourceRevision===target.sourceRevision&&result.inputContentHash===target.inputContentHash&&result.bundleHash===bundle.bundle_hash
      &&operation.result_hash===hash(`f1plus1-automatic-result-v1\n${canonicalJson(result)}`),"X_PAGE_AUTOMATIC_REVIEW_RECEIPT_INVALID");
    assert(!database.prepare("SELECT 1 FROM admin_operation WHERE json_extract(response_json,'$.operation.bundleId')=? LIMIT 1").get(String(bundle.bundle_id)),"X_PAGE_AUTOMATIC_MANUAL_OVERRIDE");
  }
  if(candidate.editor_based_on_source_revision===target.sourceRevision){
    const latest=bundles.at(-1);assert(latest,"X_PAGE_AUTOMATIC_MANUAL_OVERRIDE");
    const payload=parse(latest.public_payload_json,"X_PAGE_AUTOMATIC_BUNDLE_INVALID");
    assert(candidate.editor_title===payload.titleZh&&candidate.editor_excerpt===payload.summaryZh&&candidate.editor_notes===latest.editor_notes,
      "X_PAGE_AUTOMATIC_MANUAL_OVERRIDE");
  }
}

function modelBody(proof:XPageCaptureCommitment,modelId:"deepseek-chat"):string {
  const normal=proof.verified.normalized;
  return canonicalJson({model:modelId,messages:[{role:"system",content:X_PAGE_REFINE_PROMPT},{role:"user",content:canonicalJson({authorHandle:normal.authorHandle,
    authorDisplayName:normal.authorDisplayName,publishedAt:normal.publishedAt,canonicalUrl:normal.canonicalUrl,completeText:normal.text,relations:normal.relations})}],
    response_format:{type:"json_object"},temperature:0.2,max_tokens:900,stream:false});
}
/** Verify the exact successful model carrier and trusted store operation; an
 * arbitrary machine_summary_draft with matching revision is insufficient. */
export function readXPageAutomaticDraft(database:DatabaseSync,target:XPageAutomaticTarget,proof:XPageCaptureCommitment,now:Date) {
  const row=database.prepare(`SELECT * FROM machine_summary_draft WHERE candidate_id=? AND source_revision=? AND source_payload_hash=?
    AND model='deepseek-chat' AND prompt_sha256=?`).get(target.candidateId,target.sourceRevision,target.inputContentHash,X_PAGE_REFINE_PROMPT_SHA256) as Row|undefined;
  assert(row,"X_PAGE_AUTOMATIC_DRAFT_REQUIRED");
  assert(row.draft_id===`draft-${commitment({target,model:"deepseek-chat",promptSha256:X_PAGE_REFINE_PROMPT_SHA256})}`
    &&HASH.test(String(row.response_sha256)),"X_PAGE_AUTOMATIC_DRAFT_UNPROVEN");
  const draft=MachineSummaryDraftSchema.parse({titleZh:row.title_zh,summaryZh:row.summary_zh,keyPointsZh:JSON.parse(String(row.key_points_zh_json)),model:row.model,
    generatedAt:row.generated_at,sourceRevision:row.source_revision});
  assert(/\p{Script=Han}/u.test(draft.titleZh)&&/\p{Script=Han}/u.test(draft.summaryZh)
    &&![draft.titleZh,draft.summaryZh,...draft.keyPointsZh].some(text=>/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(text)),"X_PAGE_AUTOMATIC_TEXT_UNSAFE");
  assert(Date.parse(draft.generatedAt)<=now.getTime(),"X_PAGE_AUTOMATIC_DRAFT_TIME_INVALID");
  const model=refineModelById("deepseek-chat"),bodySha256=hash(modelBody(proof,"deepseek-chat"));
  const attempts=database.prepare(`SELECT op.operation_id,op.state AS operation_state,op.model_route_ref,a.* FROM internal_operation op
    JOIN internal_external_attempt a ON a.operation_id=op.operation_id WHERE op.owner_process='bilingual_refiner' AND op.operation_kind='refine'
    AND op.policy_id='p-x-page-refine-live' AND op.capability_class='external_attempt' AND op.egress_class='model_https'
    AND op.candidate_id=? AND op.source_id=? AND op.expected_entity_version=? AND op.expected_entity_hash=?`).all(target.candidateId,String(proof.source.source_id),target.sourceRevision,target.inputContentHash) as Row[];
  let proven=false;
  for(const attempt of attempts){
    if(attempt.operation_state!=="succeeded"||attempt.state!=="response_committed"||attempt.outcome!=="succeeded"||attempt.external_calls!==1||attempt.model_route_ref!==model.modelId)continue;
    const request=parse(attempt.canonical_request_json,"X_PAGE_AUTOMATIC_MODEL_REQUEST_INVALID");
    if(request.method!=="POST"||request.routeId!==model.routeId||request.providerResource!==model.modelId||request.bodySha256!==bodySha256
      ||hash(`f1plus1-external-request-v1\n${canonicalJson(request)}`)!==attempt.canonical_request_hash
      ||canonicalJson(request)!==attempt.canonical_request_json||!Number.isFinite(Date.parse(String(attempt.committed_at)))
      ||Date.parse(String(attempt.committed_at))>Date.parse(draft.generatedAt))continue;
    // The shared gateway commits the canonical external response identity. This
    // protocol has an HTTP status commitment but no separate status column.
    // Check the finite successful-status domain without guessing one value.
    let responseBound=false;
    for(let status=200;status<300;status++){
      const expected=hash(`f1plus1-external-response-v1\n${canonicalJson({attemptId:attempt.attempt_id,canonicalRequestSha256:attempt.canonical_request_hash,
        providerResourceIdentity:model.endpoint,providerStatus:String(status),responseBodySha256:row.response_sha256,responseHeaderHashes:[]})}`);
      if(expected===attempt.response_identity_sha256&&expected===attempt.response_hash){responseBound=true;break;}
    }
    if(!responseBound)continue;
    const storeId=`x-page-refine-store-${hash(`${attempt.operation_id}\n${row.draft_id}\n${row.response_sha256}`)}`;
    const store=database.prepare(`SELECT op.request_hash FROM internal_operation op JOIN operation_entity_binding entity ON entity.operation_id=op.operation_id
      WHERE op.operation_id=? AND op.owner_process='bilingual_refiner' AND op.operation_kind='refine' AND op.policy_id='p-x-page-refine-store-live'
      AND op.state='succeeded' AND op.capability_class='db_mutation' AND op.egress_class='none' AND op.candidate_id=? AND op.source_id=?
      AND op.expected_entity_version=? AND op.expected_entity_hash=? AND entity.entity_kind='machine_draft' AND entity.entity_id=?`)
      .get(storeId,target.candidateId,String(proof.source.source_id),target.sourceRevision,target.inputContentHash,String(row.draft_id));
    if(store?.request_hash===commitment({operationId:attempt.operation_id,draftId:row.draft_id,responseSha256:row.response_sha256,captureSha256:proof.verified.captureSha256})){proven=true;break;}
  }
  assert(proven,"X_PAGE_AUTOMATIC_DRAFT_UNPROVEN");
  return Object.freeze({...draft,draftId:String(row.draft_id),promptSha256:String(row.prompt_sha256),responseSha256:String(row.response_sha256)});
}
export function readXPageAutomaticContent(database:DatabaseSync,target:XPageAutomaticTarget,now:Date,requireDraft=true) {
  readXPageAutomaticControl(database);
  const proof=readXPageCaptureCommitment(database,target,now);assertXPageNoManualOverride(database,target,proof.candidate);
  assertXPageCurrentFences(database,{target,sourceIds:[String(proof.source.source_id),String(proof.observedSource.source_id)],now});
  const draft=requireDraft?readXPageAutomaticDraft(database,target,proof,now):null;
  return {...proof,draft};
}
export type XPageAutomaticContent=ReturnType<typeof readXPageAutomaticContent>;

export function xPageAutomaticContentBindings(proof:XPageCaptureCommitment,target:XPageAutomaticTarget):EntityBinding[] {
  const sources=[proof.source,...(proof.source.source_id===proof.observedSource.source_id?[]:[proof.observedSource])];
  return [{entityKind:"candidate",entityId:target.candidateId,identitySelector:"candidate_id",expectedVersion:target.sourceRevision,expectedHash:target.inputContentHash},
    ...sources.map((source,index)=>({entityKind:"source" as const,entityId:String(source.source_id),identitySelector:index===0?"source_id" as const:"bound_child" as const,expectedVersion:Number(source.registry_revision),expectedHash:String(source.identity_sha256)})),
    {entityKind:"x_page_capture",entityId:String(proof.capture.capture_id),identitySelector:"bound_child",expectedVersion:target.sourceRevision,expectedHash:proof.verified.captureSha256}];
}

export function assertXPageAutomaticOperation(database:DatabaseSync,request:GatewayOperationRequest,identity:XPageAuthorityIdentity):void {
  const kinds={"p-x-page-auto-review-live":["automatic_reviewer","review","db_mutation","none"],
    "p-x-page-auto-publish-live":["automatic_publisher","publish","db_mutation","none"],
    "p-x-page-fence-live":["system_supervisor","system_producer","control","none"],
    "p-x-page-refine-live":["bilingual_refiner","refine","external_attempt","model_https"],
    "p-x-page-refine-store-live":["bilingual_refiner","refine","db_mutation","none"]} as const;
  const rule=kinds[request.policyId as keyof typeof kinds];
  assert(rule&&request.ownerProcess===rule[0]&&request.operationKind===rule[1]&&request.capabilityClass===rule[2]&&request.egressClass===rule[3]
    &&request.phase==="live"&&request.expected.schemaSha256===identity.schemaSha256&&request.expected.releaseSha256===identity.releaseSha256
    &&request.expected.manifestSha256===identity.manifestSha256,"X_PAGE_AUTOMATIC_OPERATION_INVALID");
  const target=XPageRefinementTargetSchema.parse({candidateId:request.identity.candidateId,sourceRevision:request.expected.entityVersion,inputContentHash:request.expected.entityHash});
  // Control operations must retain the ability to record a denial or its
  // explicit release. Automatic clear issuers perform their own current check.
  readXPageAutomaticControl(database);
  const proof=request.policyId==="p-x-page-fence-live"?readXPageCaptureCommitment(database,target,identity.now):
    readXPageAutomaticContent(database,target,identity.now,request.operationKind==="review"||request.operationKind==="publish");
  assertXPageNoManualOverride(database,target,proof.candidate);
  if(request.policyId!=="p-x-page-fence-live")assertXPageCurrentFences(database,{target,
    sourceIds:[String(proof.source.source_id),String(proof.observedSource.source_id)],publicationId:request.identity.publicationId,now:identity.now});
  assert(proof.source.source_id===request.identity.sourceId&&request.expected.sourceStopEpoch===proof.source.stop_epoch,"X_PAGE_AUTOMATIC_SOURCE_BINDING_INVALID");
  for(const binding of xPageAutomaticContentBindings(proof,target)){
    // Existing refiner's external operation declares its candidate and source;
    // the static complete capture proof above remains mandatory for that path.
    if(request.operationKind==="refine"&&binding.entityKind==="x_page_capture")continue;
    assert(request.entitySet.some(actual=>canonicalJson(actual)===canonicalJson(binding)),"X_PAGE_AUTOMATIC_ENTITY_BINDING_INVALID");
  }
  if(request.operationKind==="publish"||request.identity.publicationId!==null&&request.policyId==="p-x-page-fence-live"){
    const row=database.prepare(`SELECT p.*,b.source_revision,b.source_payload_hash,b.candidate_id,b.bundle_revision,b.public_payload_json,b.public_payload_hash,b.editor_notes,b.bundle_hash,b.created_at AS bundle_created_at,d.decision,d.approved_bundle_hash AS decision_hash
      FROM publication p JOIN review_bundle b ON b.bundle_id=p.bundle_id JOIN review_decision d ON d.decision_id=p.decision_id WHERE p.publication_id=?`).get(request.identity.publicationId) as Row|undefined;
    assert(row&&row.candidate_id===target.candidateId&&row.source_revision===target.sourceRevision&&row.source_payload_hash===target.inputContentHash
      &&row.publication_status==="queued"&&row.decision==="approved"&&row.approved_bundle_hash===row.bundle_hash&&row.decision_hash===row.bundle_hash
      &&database.prepare("SELECT MAX(bundle_revision) AS revision FROM review_bundle WHERE candidate_id=?").get(target.candidateId)?.revision===row.bundle_revision,"X_PAGE_AUTOMATIC_PUBLICATION_STALE");
    const bundle=verifyStoredReviewBundle({bundleId:String(row.bundle_id),bundleRevision:Number(row.bundle_revision),createdAt:String(row.bundle_created_at),publicPayloadJson:String(row.public_payload_json),publicPayloadHash:String(row.public_payload_hash),editorNotes:String(row.editor_notes),bundleHash:String(row.bundle_hash)});
    assert(bundle.publicPayload.contentType==="driver_social"&&bundle.publicPayload.xCaptureSha256===proof.verified.captureSha256,"X_PAGE_AUTOMATIC_BUNDLE_CAPTURE_STALE");
  }
}

export function issueXPageAutomaticFences(input:Readonly<{database:DatabaseSync;gateway:SqliteInternalOperationGateway;supervisorPort:SqliteGatewayMutationPort;
  target:XPageAutomaticTarget;publicationId?:string;now:()=>Date}>):Readonly<{issued:number;reused:number}> {
  const now=input.now(),control=readXPageAutomaticControl(input.database),proof=readXPageAutomaticContent(input.database,input.target,now,false);
  const scopes:ReadonlyArray<readonly["source"|"candidate"|"publication",string,FenceKind]>=input.publicationId?
    (["deletion","publication","completeness","rights","media"] as const).map(kind=>["publication",input.publicationId!,kind]):
    [["source",String(proof.source.source_id),"deletion"],["source",String(proof.source.source_id),"rights"],["source",String(proof.source.source_id),"media"],
      ["candidate",input.target.candidateId,"publication"],["candidate",input.target.candidateId,"completeness"]];
  const sourcesHash=commitment([xPageAutomaticSourceSnapshotHash(proof.source),xPageAutomaticSourceSnapshotHash(proof.observedSource)]);
  let issued=0,reused=0;
  for(const [scopeKind,scopeId,fenceKind] of scopes){
    const existing=input.database.prepare(`SELECT issued_by_operation_id FROM x_page_automatic_fence_current_v1 WHERE candidate_id=? AND source_revision=? AND input_content_hash=?
      AND scope_kind=? AND scope_id=? AND fence_kind=? AND expires_at>? AND EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=issued_by_operation_id
      AND op.expected_schema_sha256=? AND op.expected_release_sha256=? AND op.expected_manifest_sha256=?)`).get(input.target.candidateId,input.target.sourceRevision,input.target.inputContentHash,
      scopeKind,scopeId,fenceKind,now.toISOString(),input.gateway.expectedSchemaSha256(),input.gateway.expectedReleaseSha256(),input.gateway.expectedManifestSha256());
    if(existing){try{assertXPageOperationSourcesCurrent(input.database,String(existing.issued_by_operation_id),now);reused++;continue;}catch{/* A current source change requires a new receipt. */}}
    const expiresAt=new Date(Math.min(now.getTime()+X_PAGE_AUTOMATIC_FENCE_TTL_MS,Date.parse(String(proof.source.authorization_expires_at)),Date.parse(String(proof.observedSource.authorization_expires_at)))).toISOString();
    const seed=commitment({target:input.target,scopeKind,scopeId,fenceKind,expiresAt,sourcesHash,captureSha256:proof.verified.captureSha256,
      sourceConfigEpoch:control.source_config_epoch,sourceSafetyEpoch:control.source_safety_epoch,authorizationVersion:control.authorization_version,policyEpoch:control.policy_epoch,recoveryEpoch:control.recovery_epoch,writerEpoch:control.writer_epoch});
    const operationId=`x-page-auto-fence-${seed}`,fenceReceiptId=`x-page-auto-receipt-${seed}`,nonce=randomBytes(32).toString("base64url");
    const entitySet=[...xPageAutomaticContentBindings(proof,input.target),{entityKind:"generic_fence" as const,entityId:fenceReceiptId,identitySelector:"bound_child" as const,expectedVersion:null,expectedHash:ZERO}];
    if(input.publicationId)entitySet.push({entityKind:"publication",entityId:input.publicationId,identitySelector:"publication_id",expectedVersion:null,expectedHash:ZERO});
    const receipt={fenceReceiptId,scopeKind,scopeId,fenceKind,state:"clear",reasonCode:X_PAGE_AUTOMATIC_FENCE_REASON,issuer:"f1plus1-system-supervisor-v1",operationId,
      oneTimeNonce:nonce,sourcesHash,captureSha256:proof.verified.captureSha256,policyEpoch:control.policy_epoch,recoveryEpoch:control.recovery_epoch,writerEpoch:control.writer_epoch,observedAt:now.toISOString(),expiresAt,target:input.target};
    const assertCurrent=()=>{const current=readXPageAutomaticContent(input.database,input.target,now,false);assert(current.verified.captureSha256===proof.verified.captureSha256
      &&commitment([xPageAutomaticSourceSnapshotHash(current.source),xPageAutomaticSourceSnapshotHash(current.observedSource)])===sourcesHash,"X_PAGE_AUTOMATIC_SOURCE_STALE");};
    input.supervisorPort.runTransaction({operationId,operationKind:"system_producer",ownerProcess:"system_supervisor",policyId:"p-x-page-fence-live",capabilityClass:"control",egressClass:"none",controlAction:"fence_update",
      identity:{sourceId:String(proof.source.source_id),candidateId:input.target.candidateId,publicationId:input.publicationId??null,publicId:null},entitySet,requiredFenceSet:[],sourceStopEpoch:Number(proof.source.stop_epoch),requestHash:commitment(receipt)},mutate=>{
      assertCurrent();assert(mutate({entityKind:"generic_fence",entityId:fenceReceiptId,mutationKind:"insert",expectedVersion:null,expectedHash:ZERO,
        statement:"INSERT INTO generic_fence_receipt VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",parameters:[fenceReceiptId,scopeKind,scopeId,fenceKind,"clear",X_PAGE_AUTOMATIC_FENCE_REASON,"f1plus1-system-supervisor-v1",operationId,nonce,commitment(receipt),control.policy_epoch,control.recovery_epoch,control.writer_epoch,now.toISOString(),expiresAt]})===1,"X_PAGE_AUTOMATIC_FENCE_WRITE_FAILED");
      assertCurrent();
    });issued++;
  }
  return {issued,reused};
}
