import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {canonicalJson} from '../db/profile.ts';
import type {GatewayWriteInput} from '../internal-operation/gateway.ts';
import type {SqliteGatewayMutationPort} from '../internal-operation/mutation-port.ts';
import {assertXPageAdmissionSchema} from './admission-migration.ts';
import {withVerifiedXPageCaptureAuthority,readXPageAutomaticSourceState} from './source-authority.ts';
import {xPageProducerReceiptEntityId} from './producer-receipt-ledger.ts';
import {snapshotXCaptureTrust,verifyTrustedXCapture,verifyXCaptureArtifacts,type XCaptureDeploymentTrust,type XCaptureEvidencePort} from './trusted-capture.ts';
import {XPageProducerReceiptSchema,type XPageImportMutationPort} from './trusted-importer.ts';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex'),ZERO='0'.repeat(64);
function assert(value:unknown,code:string):asserts value {if(!value)throw new Error(code);}
/** A fixed deployment adapter. Every invocation reauthenticates the envelope,
 * verifies actual artifacts, declares the receipt before authorization and commits
 * it with the candidate/capture under the real gateway's atomic postchecks. */
export class SqliteXPageImportMutationPort implements XPageImportMutationPort {
 private readonly database:DatabaseSync;private readonly port:SqliteGatewayMutationPort;
 private readonly trust:XCaptureDeploymentTrust;private readonly evidencePort:XCaptureEvidencePort;private readonly now:()=>Date;
 constructor(input:Readonly<{database:DatabaseSync;gatewayPort:SqliteGatewayMutationPort;trust:XCaptureDeploymentTrust;evidencePort:XCaptureEvidencePort;now:()=>Date}>){
  assertXPageAdmissionSchema(input.database);this.database=input.database;this.port=input.gatewayPort;this.trust=snapshotXCaptureTrust(input.trust);this.evidencePort=input.evidencePort;this.now=input.now;
 }
 runAtomicAdmission<T>(callback:()=>T):T{return this.port.runAtomicAdmission(callback);}
 runImportTransaction<T>(input:Parameters<XPageImportMutationPort['runImportTransaction']>[0],callback:(mutate:(write:GatewayWriteInput)=>number)=>T):T {
  const claim=XPageProducerReceiptSchema.parse(structuredClone(input.receiptClaim));
  const verified=verifyTrustedXCapture({capture:input.capture,trust:this.trust,now:this.now()}),proof=verifyXCaptureArtifacts(verified,this.evidencePort),evidence=verified.capture.evidence;
  assert(claim.producerId===evidence.producerId&&claim.receiptId===evidence.receiptId&&claim.captureSha256===verified.captureSha256
   &&claim.captureProofSha256===hash(`f1plus1-x-page-capture-proof-v1\n${canonicalJson(proof)}`)&&claim.sourceId===evidence.sourceId&&claim.observedSourceId===evidence.observedSourceId
   &&claim.capturedSourceVersionHash===verified.normalized.sourceVersionHash&&Date.parse(claim.acceptedAt)<=this.now().getTime()&&this.now().getTime()-Date.parse(claim.acceptedAt)<=5000,'X_PAGE_IMPORT_CLAIM_INVALID');
  const candidateId=`xpage-${verified.normalized.identity}`,captureId=`xcap-${verified.normalized.identity}-v${claim.result.sourceRevision}`;
  assert(claim.result.candidateId===candidateId&&claim.result.sourceId===claim.sourceId&&claim.result.operationId===input.operation.operationId
   &&claim.result.sourceVersionHash===claim.capturedSourceVersionHash&&claim.result.captureSha256===claim.captureSha256,'X_PAGE_IMPORT_RESULT_INVALID');
  const source=readXPageAutomaticSourceState(this.database,claim.sourceId,this.now());
  assert(source.producer_id===this.trust.producerId&&source.key_id===this.trust.keyId&&source.host_id===this.trust.hostId&&source.deployment_manifest_sha256===this.trust.deploymentManifestSha256
   &&source.adapter_sha256===this.trust.adapterSha256&&source.public_key_sha256===hash(this.trust.publicKey.export({type:'spki',format:'der'})),'X_PAGE_IMPORT_ADMITTED_PRODUCER_MISMATCH');
  const receiptEntityId=xPageProducerReceiptEntityId(claim.producerId,claim.receiptId),operation={...input.operation,entitySet:[...input.operation.entitySet,
   {entityKind:'x_page_producer_receipt' as const,entityId:receiptEntityId,identitySelector:'bound_child' as const,expectedVersion:null,expectedHash:ZERO}]};
  assert(input.operation.policyId==='p-x-page-trusted-import-live'&&input.operation.ownerProcess==='x_page_importer','X_PAGE_IMPORT_PORT_POLICY_INVALID');
  return withVerifiedXPageCaptureAuthority({database:this.database,operation,capture:input.capture,trust:this.trust,evidencePort:this.evidencePort,now:this.now()},()=>this.port.runTransaction(operation,mutate=>{
   assert(!this.database.prepare('SELECT 1 FROM x_page_producer_receipt_v1 WHERE producer_id=? AND receipt_id=?').get(claim.producerId,claim.receiptId),'X_PAGE_RECEIPT_ALREADY_CLAIMED');
   const result=callback(write=>{
    assert((write.entityKind==='candidate'&&write.entityId===candidateId)||(write.entityKind==='x_page_capture'&&write.entityId===captureId),'X_PAGE_IMPORT_WRITE_FORBIDDEN');
    return mutate(write);
   });
   assert(canonicalJson(result)===canonicalJson(claim.result),'X_PAGE_IMPORT_RESULT_CHANGED');
   const row=this.database.prepare('SELECT * FROM pending_review_candidate WHERE candidate_id=?').get(candidateId),normalized=verified.normalized;
   const points=[...normalized.text],excerpt=points.length<=2000?normalized.text:`${points.slice(0,2000).join('')}\n[预览节选；完整正文保存在捕获证据中]`;
   assert(row?.source_id===claim.sourceId&&row.external_id===normalized.statusId&&row.dedupe_key===normalized.identity&&row.canonical_url===normalized.canonicalUrl
    &&row.title===`X 原帖 · @${normalized.authorHandle}`&&row.excerpt===excerpt&&row.author===normalized.authorDisplayName&&row.published_at===normalized.publishedAt
    &&row.source_payload_hash===claim.capturedSourceVersionHash&&row.source_revision===claim.result.sourceRevision,'X_PAGE_IMPORT_CANDIDATE_BINDING_INVALID');
   const cap=this.database.prepare('SELECT * FROM x_page_candidate_capture_v1 WHERE capture_id=?').get(captureId);
   assert(cap?.candidate_id===candidateId&&cap.source_id===claim.sourceId&&cap.source_revision===claim.result.sourceRevision&&cap.source_version_hash===claim.capturedSourceVersionHash
    &&cap.complete_text===normalized.text&&cap.status_id===normalized.statusId&&cap.author_handle===normalized.authorHandle,'X_PAGE_IMPORT_CAPTURE_BINDING_INVALID');
   if(claim.result.decision!=='duplicate')assert(cap.normalized_json===canonicalJson(normalized)&&cap.evidence_json===canonicalJson(verified.capture)&&cap.evidence_sha256===claim.captureSha256&&cap.operation_id===operation.operationId,'X_PAGE_IMPORT_CAPTURE_BINDING_INVALID');
   const receiptJson=canonicalJson(claim);
   mutate({entityKind:'x_page_producer_receipt',entityId:receiptEntityId,mutationKind:'insert',expectedVersion:null,expectedHash:ZERO,
    statement:'INSERT INTO x_page_producer_receipt_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',parameters:[receiptEntityId,String(source.admission_id),claim.producerId,claim.receiptId,claim.captureSha256,claim.captureProofSha256,claim.sourceId,claim.observedSourceId,claim.capturedSourceVersionHash,candidateId,claim.result.sourceRevision,claim.result.operationId,receiptJson,hash(receiptJson),claim.acceptedAt]});
   return result;
  }));
 }
}
