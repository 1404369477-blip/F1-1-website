// Synthetic proof artifacts are explicit doubles; DB assertions use the real file gateway.
import {generateKeyPairSync,createHash} from 'node:crypto';
import {rssSourceEpochFixture} from './rss-source-epoch.ts';
import {testXProducer,TEST_X_NOW,testHash} from './x-page-trusted.ts';
import {issueRssAutomaticFences} from '../../server/rss-automatic/admission.ts';
import {refineOneCandidate} from '../../server/rss/refinement.ts';
import {applyXPageAdmissionMigration,xPageSelectedIdentity} from '../../server/x-page/admission-migration.ts';
import {X_PAGE_ADMISSION_SCHEMA_SHA256} from '../../server/x-page/admission-schema-identity.ts';
import {SqliteInternalOperationGateway,type OwnerProcess} from '../../server/internal-operation/gateway.ts';
import {SqliteGatewayMutationPort} from '../../server/internal-operation/mutation-port.ts';
import {persistOwnerSupervisorHandoff} from '../../server/internal-operation/owner-supervisor.ts';
import {SqliteXPageImportMutationPort} from '../../server/x-page/import-port.ts';
import {SqliteXPageProducerReceiptLedger} from '../../server/x-page/producer-receipt-ledger.ts';
import {admitTrustedXPageSource} from '../../server/x-page/source-authority.ts';
import {importTrustedXCapture,readReadyXPageSource,type XPageCandidateVersion} from '../../server/x-page/trusted-importer.ts';
import type {XCaptureEvidencePort,TrustedXCapture} from '../../server/x-page/trusted-capture.ts';
const ZERO='0'.repeat(64),hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export async function xPageAdmissionFixture(options:Readonly<{withUnknown?:boolean}>={}) {
 const old=await rssSourceEpochFixture();issueRssAutomaticFences(old);
 if(options.withUnknown)try{await refineOneCandidate({database:old.database,mutationPort:old.port('rss_refiner'),target:old.target,apiKeyPath:old.keyPath,budgetAccountId:'acct-rss',now:old.now,fetchImpl:async()=>{throw new Error('SYNTHETIC_UNKNOWN');}});}catch(error){if(String(error)!=='Error: SYNTHETIC_UNKNOWN')throw error;}
 old.gateway.close();old.fixtureMutation(db=>db.exec("UPDATE internal_control SET phase='paused',global_stop_state='stopped'"));
 const oldBindings=old.database.prepare('SELECT * FROM rss_automatic_source_binding_v1 ORDER BY fence_receipt_id').all(),unknownBefore=old.database.prepare("SELECT * FROM internal_operation WHERE state='reconcile_required'").all();
 const result=applyXPageAdmissionMigration(old.database,{applyEnabled:true,appliedAt:TEST_X_NOW});
 const producer=testXProducer(),trust={...producer.trust,sources:producer.trust.sources.map(source=>({...source,identitySha256:xPageSelectedIdentity(source.sourceId)}))};
 const verifier=generateKeyPairSync('ed25519'),metadata={schemaVersion:'x-page-historical-evidence-v1' as const,configurationSha256:testHash('configuration'),verifierId:'synthetic-verifier',verifierKeyId:'synthetic-verifier-key',verifierPublicKeySpkiPem:verifier.publicKey.export({type:'spki',format:'pem'}).toString(),verifierPublicKeySpkiSha256:hash(verifier.publicKey.export({type:'spki',format:'der'})),toolId:'synthetic-test-tool'};
 const evidencePort:XCaptureEvidencePort={...producer.evidencePort,admissionMetadata:()=>metadata,forHistoricalAdmission:()=>producer.evidencePort};
 const capture=(options:Parameters<typeof producer.capture>[0]={})=>{const value=producer.capture(options);return producer.resign({...value,evidence:{...value.evidence,sourceIdentitySha256:xPageSelectedIdentity(value.evidence.sourceId),observedSourceIdentitySha256:xPageSelectedIdentity(value.evidence.observedSourceId)}});};
 const handoffs=new Map<OwnerProcess,Array<Parameters<typeof persistOwnerSupervisorHandoff>[1]>>();
 for(const owner of ['system_supervisor','x_page_importer','bilingual_refiner','automatic_reviewer','automatic_publisher','projection_sender','reconciler','rss_collector','rss_refiner','admin_http'] as const){const values=[];for(let i=0;i<64;i++){
  const id=`x0017-synthetic-${owner}-${i}`,handoff={handoffId:id,ownerProcess:owner,issuer:'f1plus1-owner-supervisor-v1' as const,oneTimeNonce:createHash('sha256').update(id).digest('base64url'),releaseSha256:ZERO,manifestSha256:ZERO,receiptSha256:hash(id),verifiedAt:TEST_X_NOW,expiresAt:'2027-09-07T00:00:00.000Z'};
  persistOwnerSupervisorHandoff(old.database,handoff,()=>true);values.push(handoff);
 }handoffs.set(owner,values);}
 const gateway=new SqliteInternalOperationGateway({database:old.database,schemaSha256:X_PAGE_ADMISSION_SCHEMA_SHA256,releaseSha256:ZERO,manifestSha256:ZERO,now:old.now});
 const port=(owner:OwnerProcess)=>new SqliteGatewayMutationPort({database:old.database,gateway,ownerProcess:owner,now:old.now,handoffProvider:()=>{const next=handoffs.get(owner)?.shift();if(!next)throw new Error('SYNTHETIC_HANDOFF_EXHAUSTED');return next;}});
 const importPort=new SqliteXPageImportMutationPort({database:old.database,gatewayPort:port('x_page_importer'),trust,evidencePort,now:old.now}),receiptLedger=new SqliteXPageProducerReceiptLedger(old.database);let seq=0;
 const admit=(sourceId='x_f1',value:TrustedXCapture=capture({author:sourceId.slice(2) as 'f1'|'mclarenf1'}))=>admitTrustedXPageSource({database:old.database,gatewayPort:port('system_supervisor'),trust,evidencePort,capture:value,sourceId,expectedRegistryRevision:Number(old.database.prepare('SELECT revision FROM source_registry_v1 WHERE source_id=?').get(sourceId)!.revision),operationId:`synthetic-x-admit-${++seq}`,now:old.now});
 const live=()=>old.fixtureMutation(db=>db.exec("UPDATE internal_control SET phase='live',global_stop_state='clear'"));
 const importCapture=(value:TrustedXCapture=capture(),expectedCandidate:XPageCandidateVersion|null=null)=>importTrustedXCapture({database:old.database,gatewayPort:importPort,receiptLedger,evidencePort,capture:value,trust,expectedSourceIdentity:readReadyXPageSource(old.database,trust,value.evidence.sourceId,old.now()),expectedCandidate,operationId:`synthetic-x-import-${++seq}`,now:old.now});
 return {...old,gateway,port,producer,trust,evidencePort,receiptLedger,importPort,capture,admit,live,importCapture,migrationResult:result,oldBindings,unknownBefore,close:()=>{gateway.close();old.close();}};
}
