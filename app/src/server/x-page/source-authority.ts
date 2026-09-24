import {createHash,createPublicKey} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {canonicalJson} from '../db/profile.ts';
import type {EntityBinding,GatewayOperationRequest} from '../internal-operation/gateway.ts';
import type {SqliteGatewayMutationPort,GatewayMutationTransactionInput} from '../internal-operation/mutation-port.ts';
import {assertXPageAdmissionSchema,xPageSelectedIdentity} from './admission-migration.ts';
import {snapshotXCaptureTrust,verifyTrustedXCapture,verifyXCaptureArtifacts,type XCaptureDeploymentTrust,type XCaptureEvidencePort,type VerifiedXCapture,type XCaptureHistoricalEvidenceMetadata} from './trusted-capture.ts';
const ZERO='0'.repeat(64),hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
type Row=Record<string,unknown>;
function assert(value:unknown,code:string):asserts value {if(!value)throw new Error(code);}
export function readXPageAutomaticSourceState(database:DatabaseSync,sourceId:string,now:Date):Row {
 const row=database.prepare(`SELECT s.source_id,s.enabled AS legacy_enabled,s.stop_epoch,r.enabled AS registry_enabled,r.revision AS registry_revision,r.identity_sha256,
 r.source_kind,r.collection_mode,r.lifecycle_status,r.collection_onboarding_status,r.normalization_status,r.dedup_status,r.identity_status,r.relevance_status,r.monitorability,
 r.adapter_status,r.adapter_authorization_status,r.platform_allowed,r.source_stop_status,r.current_operation_id,r.authorization_expires_at,
 r.source_config_epoch,r.source_safety_epoch,r.authorization_version,r.policy_epoch,r.recovery_epoch,
 cfg.source_revision AS config_revision,cfg.canonical_handle,cfg.identity_sha256 AS config_identity_sha256,cfg.adapter_sha256,cfg.rights_status,cfg.media_policy,
 cfg.authorization_receipt_sha256,cfg.source_policy_sha256,cfg.authorization_expires_at AS config_expires_at,cfg.evidence_class,cfg.admission_id,
 a.producer_id,a.key_id,a.host_id,a.deployment_manifest_sha256,a.public_key_sha256,a.producer_admission_receipt_sha256,
 a.authorized_at,a.expires_at,a.admission_json,a.admission_sha256,a.operation_id AS admission_operation_id,op.state AS admission_operation_state
 FROM source s JOIN source_registry_v1 r ON r.source_id=s.source_id JOIN x_page_source_config_v1 cfg ON cfg.source_id=s.source_id
 LEFT JOIN x_page_source_admission_v1 a ON a.admission_id=cfg.admission_id LEFT JOIN internal_operation op ON op.operation_id=a.operation_id WHERE s.source_id=?`).get(sourceId) as Row|undefined;
 assert(row,'X_PAGE_SOURCE_NOT_CONFIGURED');
 assert(row.source_kind==='x_page'&&row.collection_mode==='browser_visible_dom'&&sourceId===`x_${row.canonical_handle}`,'X_PAGE_SOURCE_KIND_INVALID');
 assert(row.legacy_enabled===1&&row.registry_enabled===1&&row.lifecycle_status==='active'&&row.collection_onboarding_status==='active','X_PAGE_SOURCE_DISABLED');
 assert(row.registry_revision===row.config_revision&&row.identity_sha256===row.config_identity_sha256&&row.identity_sha256===xPageSelectedIdentity(sourceId),'X_PAGE_SOURCE_IDENTITY_INVALID');
 assert(row.normalization_status==='valid'&&row.dedup_status==='unique'&&row.identity_status==='verified'&&row.relevance_status==='qualified'&&row.monitorability==='monitorable'
  &&row.adapter_status==='ready'&&row.adapter_authorization_status==='valid'&&row.platform_allowed==='allowed'&&row.source_stop_status==='clear','X_PAGE_SOURCE_NOT_READY');
 assert(row.evidence_class==='producer_signed_visible_capture'&&row.rights_status==='clear'&&row.media_policy==='blocked'&&row.admission_operation_state==='succeeded','X_PAGE_SOURCE_NOT_ADMITTED');
 assert(Number.isFinite(now.getTime())&&Date.parse(String(row.authorization_expires_at))>now.getTime()&&row.authorization_expires_at===row.config_expires_at
  &&row.config_expires_at===row.expires_at&&Date.parse(String(row.authorized_at))<=now.getTime(),'X_PAGE_SOURCE_AUTHORIZATION_EXPIRED');
 for(const field of ['source_config_epoch','source_safety_epoch','authorization_version','policy_epoch','recovery_epoch','stop_epoch'] as const)assert(Number.isSafeInteger(row[field])&&Number(row[field])>=1,'X_PAGE_SOURCE_EPOCH_INVALID');
 assert(hash(String(row.admission_json))===row.admission_sha256,'X_PAGE_SOURCE_ADMISSION_CORRUPT');
 return row;
}
export function xPageAutomaticSourceSnapshotHash(source:Row):string {
 const fields=['source_id','registry_revision','identity_sha256','config_revision','stop_epoch','source_config_epoch','source_safety_epoch','authorization_version','policy_epoch','recovery_epoch','authorization_receipt_sha256','source_policy_sha256','authorization_expires_at','rights_status','media_policy','admission_id','adapter_sha256'];
 return hash(canonicalJson(Object.fromEntries(fields.map(field=>[field,source[field]]))));
}
export function assertXPageAutomaticSourceBindingCurrent(database:DatabaseSync,fenceReceiptId:string):void {
 assert(database.prepare('SELECT 1 FROM x_page_automatic_source_binding_current_v1 WHERE fence_receipt_id=?').get(fenceReceiptId),'X_PAGE_SOURCE_BINDING_STALE');
}
export function assertXPageOperationSourcesCurrent(database:DatabaseSync,operationId:string,now:Date):void {
 if(!database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='x_page_operation_source_binding_v1'").get())return;
 const op=database.prepare('SELECT policy_id FROM internal_operation WHERE operation_id=?').get(operationId);
 if(!String(op?.policy_id).startsWith('p-x-page-')||['p-x-page-source-admit-paused','p-x-page-source-update-paused'].includes(String(op?.policy_id)))return;
 const rows=database.prepare("SELECT entity_id FROM operation_entity_binding WHERE operation_id=? AND entity_kind='source'").all(operationId);
 assert(rows.length>0,'X_PAGE_OPERATION_SOURCE_MISSING');
 for(const row of rows){readXPageAutomaticSourceState(database,String(row.entity_id),now);assert(database.prepare('SELECT 1 FROM x_page_operation_source_binding_current_v1 WHERE operation_id=? AND source_id=?').get(operationId,String(row.entity_id)),'X_PAGE_OPERATION_SOURCE_STALE');}
}
type Grant={policyId:string;requestHash:string;sourceId:string;candidateId:string|null;capture:VerifiedXCapture;trust:XCaptureDeploymentTrust};
const grants=new WeakMap<DatabaseSync,Map<string,Grant>>();
/** Only verified capture paths can reach the new source/import policies. The
 * gateway still owns handoff consumption, phase/epoch checks and every permit. */
export function withVerifiedXPageCaptureAuthority<T>(input:Readonly<{database:DatabaseSync;operation:GatewayMutationTransactionInput;capture:unknown;trust:XCaptureDeploymentTrust;evidencePort:XCaptureEvidencePort;now:Date}>,callback:(verified:VerifiedXCapture)=>T):T {
 assert(['p-x-page-trusted-import-live','p-x-page-source-admit-paused'].includes(String(input.operation.policyId)),'X_PAGE_CAPTURE_POLICY_INVALID');
 const trust=snapshotXCaptureTrust(input.trust),verified=verifyTrustedXCapture({capture:input.capture,trust,now:input.now});verifyXCaptureArtifacts(verified,input.evidencePort);
 const sourceId=input.operation.identity.sourceId;assert(sourceId&&([verified.capture.evidence.sourceId,verified.capture.evidence.observedSourceId] as string[]).includes(sourceId),'X_PAGE_CAPTURE_SOURCE_INVALID');
 const map=grants.get(input.database)??new Map<string,Grant>();grants.set(input.database,map);assert(!map.has(input.operation.operationId),'X_PAGE_CAPTURE_AUTHORITY_REENTRANT');
 map.set(input.operation.operationId,{policyId:String(input.operation.policyId),requestHash:String(input.operation.requestHash),sourceId,candidateId:input.operation.identity.candidateId,capture:verified,trust});
 try{return callback(verified);}finally{map.delete(input.operation.operationId);if(!map.size)grants.delete(input.database);}
}
export function assertXPageGatewayRequest(database:DatabaseSync,request:GatewayOperationRequest,now:Date):void {
 const hasSchema=database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='x_page_source_admission_v1'").get();
 const xPolicy=request.policyId.startsWith('p-x-page-');
 if(!hasSchema){assert(!xPolicy,'X_PAGE_ADMISSION_SCHEMA_REQUIRED');return;}
 const sourceIds=new Set<string>();if(request.identity.sourceId)sourceIds.add(request.identity.sourceId);
 for(const entity of request.entitySet){
  if(entity.entityKind==='source'||['x_page_source_config','x_page_source_registry'].includes(entity.entityKind))sourceIds.add(entity.entityId);
  if(entity.entityKind==='candidate'){const source=database.prepare('SELECT source_id FROM pending_review_candidate WHERE candidate_id=?').get(entity.entityId);if(source)sourceIds.add(String(source.source_id));}
  if(entity.entityKind==='x_page_capture'){const source=database.prepare('SELECT source_id FROM x_page_candidate_capture_v1 WHERE capture_id=?').get(entity.entityId);if(source)sourceIds.add(String(source.source_id));}
 }
 const kinds=[...sourceIds].map(id=>database.prepare('SELECT source_kind FROM source WHERE source_id=?').get(id)?.source_kind);
 if(!xPolicy){
  // The common signed receiver is selected by a verified payload protocol. Its
  // existing gateway owns only receiver writes; automatic RSS policies do not.
  if(request.ownerProcess!=='projection_receiver')assert(!kinds.includes('x_page')&&!request.entitySet.some(e=>e.entityKind.startsWith('x_page_')),'X_PAGE_EXPLICIT_POLICY_REQUIRED');
  return;
 }
 assert(sourceIds.size>0&&kinds.every(kind=>kind==='x_page'),'X_PAGE_POLICY_SOURCE_KIND_INVALID');
 const admission=request.policyId==='p-x-page-source-admit-paused',importing=request.policyId==='p-x-page-trusted-import-live',stopping=request.policyId==='p-x-page-source-update-paused';
 if(stopping)assert(request.ownerProcess==='admin_http'&&request.operationKind==='source_update'&&request.phase==='paused'&&request.capabilityClass==='control'&&request.egressClass==='none'&&request.entitySet.every(e=>e.entityKind==='source'&&e.entityId===request.identity.sourceId),'X_PAGE_SOURCE_STOP_OPERATION_INVALID');
 if(admission||importing){
  const grant=grants.get(database)?.get(request.operationId);
  assert(grant&&grant.policyId===request.policyId&&grant.requestHash===request.requestHash&&grant.sourceId===request.identity.sourceId&&grant.candidateId===request.identity.candidateId,'X_PAGE_VERIFIED_CAPTURE_AUTHORITY_REQUIRED');
  verifyTrustedXCapture({capture:grant.capture.capture,trust:grant.trust,now});
  if(importing){
   assert(request.ownerProcess==='x_page_importer'&&request.operationKind==='collect'&&request.capabilityClass==='db_mutation'&&request.egressClass==='none','X_PAGE_IMPORT_OPERATION_INVALID');
   assert(request.identity.candidateId===`xpage-${grant.capture.normalized.identity}`&&request.entitySet.some(e=>e.entityKind==='x_page_producer_receipt'),'X_PAGE_IMPORT_RECEIPT_ENTITY_REQUIRED');
   for(const e of request.entitySet)assert(['candidate','source','x_page_capture','x_page_producer_receipt'].includes(e.entityKind),'X_PAGE_IMPORT_ENTITY_FORBIDDEN');
  }else{
   assert(request.ownerProcess==='system_supervisor'&&request.operationKind==='system_producer'&&request.phase==='paused'&&request.capabilityClass==='control'&&request.controlAction==='fence_update','X_PAGE_ADMISSION_OPERATION_INVALID');
   const ctl=database.prepare('SELECT global_stop_state,emergency_stop_state,recovery_state FROM internal_control WHERE singleton_id=1').get();
   assert(ctl?.global_stop_state==='stopped'&&ctl.emergency_stop_state==='clear'&&ctl.recovery_state==='ready','X_PAGE_ADMISSION_CONTROL_OPEN');
   for(const e of request.entitySet)assert(['source','x_page_source_config','x_page_source_registry','x_page_source_admission'].includes(e.entityKind),'X_PAGE_ADMISSION_ENTITY_FORBIDDEN');
  }
 }
 if(!admission&&!stopping)for(const sourceId of sourceIds)readXPageAutomaticSourceState(database,sourceId,now);
}
export function readXPageHistoricalAdmission(database:DatabaseSync,admissionId:string):Readonly<{trust:XCaptureDeploymentTrust;metadata:XCaptureHistoricalEvidenceMetadata}> {
 const row=database.prepare(`SELECT a.*,op.state FROM x_page_source_admission_v1 a JOIN internal_operation op ON op.operation_id=a.operation_id WHERE a.admission_id=?`).get(admissionId);
 assert(row?.state==='succeeded'&&hash(String(row.admission_json))===row.admission_sha256,'X_PAGE_HISTORICAL_ADMISSION_INVALID');
 const core=JSON.parse(String(row.admission_json));
 const publicKey=createPublicKey(core.publicKeySpkiPem);assert(hash(publicKey.export({type:'spki',format:'der'}))===row.public_key_sha256,'X_PAGE_HISTORICAL_KEY_INVALID');
 const trust=snapshotXCaptureTrust({...core.trust,publicKey});
 assert(trust.producerId===row.producer_id&&trust.keyId===row.key_id&&trust.hostId===row.host_id&&trust.deploymentManifestSha256===row.deployment_manifest_sha256
  &&trust.adapterSha256===row.adapter_sha256&&trust.authorizedAt===row.authorized_at&&trust.expiresAt===row.expires_at,'X_PAGE_HISTORICAL_TRUST_INVALID');
 return Object.freeze({trust,metadata:Object.freeze({...core.evidenceMetadata})});
}
export function admitTrustedXPageSource(input:Readonly<{database:DatabaseSync;gatewayPort:SqliteGatewayMutationPort;trust:XCaptureDeploymentTrust;evidencePort:XCaptureEvidencePort;capture:unknown;sourceId:string;expectedRegistryRevision:number;operationId:string;now:()=>Date}>):Readonly<{schemaVersion:'x-page-source-admission-result-v1';sourceId:string;registryRevision:number;admissionId:string;operationId:string;admissionSha256:string}> {
 assertXPageAdmissionSchema(input.database);
 const trust=snapshotXCaptureTrust(input.trust),verified=verifyTrustedXCapture({capture:input.capture,trust,now:input.now()}),proof=verifyXCaptureArtifacts(verified,input.evidencePort);
 assert(typeof input.evidencePort.admissionMetadata==='function','X_PAGE_ADMISSION_VERIFIER_METADATA_REQUIRED');
 const evidenceMetadata=input.evidencePort.admissionMetadata();
 const key=createPublicKey(evidenceMetadata.verifierPublicKeySpkiPem);
 assert(evidenceMetadata.schemaVersion==='x-page-historical-evidence-v1'&&key.asymmetricKeyType==='ed25519'&&hash(key.export({type:'spki',format:'der'}))===evidenceMetadata.verifierPublicKeySpkiSha256,'X_PAGE_ADMISSION_VERIFIER_METADATA_INVALID');
 const scope=trust.sources.find(source=>source.sourceId===input.sourceId);assert(scope&&scope.identitySha256===xPageSelectedIdentity(input.sourceId),'X_PAGE_ADMISSION_SOURCE_IDENTITY_INVALID');
 const admissionId=`xadmit-${hash(input.operationId)}`,at=input.now().toISOString(),revision=input.expectedRegistryRevision+1;
 const {publicKey,...trustCore}=trust,publicKeySpkiPem=publicKey.export({type:'spki',format:'pem'}).toString();
 const core={schemaVersion:'x-page-source-admission-v1',sourceId:input.sourceId,registryRevision:revision,operationId:input.operationId,trust:trustCore,publicKeySpkiPem,evidenceMetadata,capture:verified.capture,captureProof:proof,admittedAt:at};
 const admissionJson=canonicalJson(core),admissionSha256=hash(admissionJson);
 const result=Object.freeze({schemaVersion:'x-page-source-admission-result-v1' as const,sourceId:input.sourceId,registryRevision:revision,admissionId,operationId:input.operationId,admissionSha256});
 const operation:GatewayMutationTransactionInput={operationId:input.operationId,operationKind:'system_producer',ownerProcess:'system_supervisor',capabilityClass:'control',egressClass:'none',policyId:'p-x-page-source-admit-paused',controlAction:'fence_update',
 identity:{sourceId:input.sourceId,candidateId:null,publicationId:null,publicId:null},requestHash:admissionSha256,entitySet:[
 {entityKind:'source',entityId:input.sourceId,identitySelector:'source_id',expectedVersion:input.expectedRegistryRevision,expectedHash:scope.identitySha256},
 {entityKind:'x_page_source_config',entityId:input.sourceId,identitySelector:'bound_child',expectedVersion:input.expectedRegistryRevision,expectedHash:scope.identitySha256},
 {entityKind:'x_page_source_registry',entityId:input.sourceId,identitySelector:'bound_child',expectedVersion:input.expectedRegistryRevision,expectedHash:scope.identitySha256},
 {entityKind:'x_page_source_admission',entityId:admissionId,identitySelector:'bound_child',expectedVersion:null,expectedHash:ZERO}]};
 return input.gatewayPort.runAtomicAdmission(()=>withVerifiedXPageCaptureAuthority({...input,operation,now:input.now()},()=>{
  const current=input.database.prepare('SELECT r.revision,r.identity_sha256,s.stop_epoch FROM source_registry_v1 r JOIN source s ON s.source_id=r.source_id WHERE r.source_id=?').get(input.sourceId);
  assert(current?.revision===input.expectedRegistryRevision&&current.identity_sha256===scope.identitySha256,'X_PAGE_ADMISSION_SOURCE_STALE');
  return input.gatewayPort.runTransaction({...operation,sourceStopEpoch:Number(current.stop_epoch)},mutate=>{
   mutate({entityKind:'x_page_source_admission',entityId:admissionId,mutationKind:'insert',expectedVersion:null,expectedHash:ZERO,statement:'INSERT INTO x_page_source_admission_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',parameters:[admissionId,input.sourceId,revision,input.operationId,trust.producerId,trust.keyId,trust.hostId,trust.deploymentManifestSha256,hash(publicKey.export({type:'spki',format:'der'})),trust.adapterSha256,trust.producerAdmissionReceiptSha256,scope.authorizationReceiptSha256,scope.sourcePolicySha256,verified.captureSha256,hash(`f1plus1-x-page-capture-proof-v1\n${canonicalJson(proof)}`),trust.authorizedAt,trust.expiresAt,admissionJson,admissionSha256,at]});
   mutate({entityKind:'x_page_source_config',entityId:input.sourceId,mutationKind:'update',expectedVersion:input.expectedRegistryRevision,expectedHash:scope.identitySha256,statement:"UPDATE x_page_source_config_v1 SET source_revision=source_revision+1,adapter_sha256=?,authorization_receipt_sha256=?,authorization_expires_at=?,source_policy_sha256=?,rights_status='clear',evidence_class='producer_signed_visible_capture',admission_id=? WHERE source_id=? AND source_revision=?",parameters:[trust.adapterSha256,scope.authorizationReceiptSha256,trust.expiresAt,scope.sourcePolicySha256,admissionId,input.sourceId,input.expectedRegistryRevision]});
   mutate({entityKind:'x_page_source_registry',entityId:input.sourceId,mutationKind:'update',expectedVersion:input.expectedRegistryRevision,expectedHash:scope.identitySha256,statement:"UPDATE source_registry_v1 SET revision=revision+1,enabled=1,lifecycle_status='active',collection_onboarding_status='active',canonical_url_valid=1,normalization_status='valid',dedup_status='unique',identity_status='verified',relevance_status='qualified',monitorability='monitorable',adapter_status='ready',adapter_authorization_status='valid',platform_allowed='allowed',source_stop_status='clear',source_config_epoch=source_config_epoch+1,source_safety_epoch=source_safety_epoch+1,authorization_version=authorization_version+1,authorization_expires_at=?,current_operation_id=?,current_request_hash=?,updated_at=? WHERE source_id=? AND revision=?",parameters:[trust.expiresAt,input.operationId,admissionSha256,at,input.sourceId,input.expectedRegistryRevision]});
   mutate({entityKind:'source',entityId:input.sourceId,mutationKind:'update',expectedVersion:input.expectedRegistryRevision,expectedHash:scope.identitySha256,statement:"UPDATE source SET enabled=1,stop_epoch=stop_epoch+1,last_reason_code='X_PAGE_SOURCE_ADMITTED' WHERE source_id=? AND stop_epoch=?",parameters:[input.sourceId,Number(current.stop_epoch)]});
   return result;
  });
 }));
}

/** The unchanged trusted refiner specifies its target; the production adapter
 * expands it into exact current source/capture read bindings before request. */
export function xPageRefinementReadBindings(database:DatabaseSync,entitySet:readonly EntityBinding[],identity:GatewayOperationRequest['identity'],now:Date):EntityBinding[] {
 const result=[...entitySet],candidate=database.prepare('SELECT source_revision,source_payload_hash FROM pending_review_candidate WHERE candidate_id=? AND source_id=?').get(identity.candidateId!,identity.sourceId!);
 assert(candidate,'X_PAGE_REFINE_TARGET_MISSING');
 const cap=database.prepare('SELECT * FROM x_page_candidate_capture_v1 WHERE candidate_id=? AND source_revision=? AND source_version_hash=?').get(identity.candidateId!,Number(candidate.source_revision),String(candidate.source_payload_hash));
 assert(cap,'X_PAGE_REFINE_CAPTURE_MISSING');
 const envelope=JSON.parse(String(cap.evidence_json)),ids=new Set<string>([identity.sourceId!,String(envelope.evidence.observedSourceId)]);
 const add=(binding:EntityBinding)=>{const index=result.findIndex(e=>e.entityKind===binding.entityKind&&e.entityId===binding.entityId);
  if(index>=0){const old=result[index];assert((old.expectedVersion===null&&old.expectedHash===ZERO)||canonicalJson(old)===canonicalJson(binding),'X_PAGE_REFINE_READ_BINDING_STALE');result[index]=binding;}else result.push(binding);};
 for(const sourceId of ids){const source=readXPageAutomaticSourceState(database,sourceId,now);add({entityKind:'source',entityId:sourceId,identitySelector:sourceId===identity.sourceId?'source_id':'bound_child',expectedVersion:Number(source.registry_revision),expectedHash:String(source.identity_sha256)});}
 add({entityKind:'x_page_capture',entityId:String(cap.capture_id),identitySelector:'bound_child',expectedVersion:Number(cap.source_revision),expectedHash:String(cap.evidence_sha256)});
 return result;
}
