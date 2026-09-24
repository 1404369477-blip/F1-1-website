import {generateKeyPairSync,sign} from 'node:crypto';
import {fork} from 'node:child_process';
import {rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {testXArtifactEnvironment} from './helpers/x-page-artifacts.ts';
import {createXPageFileEvidencePort,xPageArtifactVerifierSigningBytes} from '../server/x-page/capture-artifacts.ts';
import {SqliteXPageImportMutationPort} from '../server/x-page/import-port.ts';
import {admitTrustedXPageSource} from '../server/x-page/source-authority.ts';
import {xPageSelectedIdentity} from '../server/x-page/admission-migration.ts';
import {afterEach,describe,test,expect} from 'vitest';
import {xPageAdmissionFixture} from './helpers/x-page-admission.ts';
import {canonicalJson} from '../server/db/profile.ts';
import {importTrustedXCapture,readReadyXPageSource,readTrustedXPageInput} from '../server/x-page/trusted-importer.ts';
import {issueXPageAutomaticFences} from '../server/x-page/content-authority.ts';
import {createXPageModelGateway} from '../server/x-page/model-transport.ts';
import {refineOneXCandidate} from '../server/x-page/refinement.ts';
import {assertXPageOperationSourcesCurrent} from '../server/x-page/source-authority.ts';
import {applyXPageAdmissionMigration,assertXPageAdmissionSchema} from '../server/x-page/admission-migration.ts';
import {SqliteInternalOperationGateway} from '../server/internal-operation/gateway.ts';
import {X_PAGE_ADMISSION_SCHEMA_SHA256} from '../server/x-page/admission-schema-identity.ts';
import {xCaptureSigningBytes} from '../server/x-page/trusted-capture.ts';
import {testHash} from './helpers/x-page-trusted.ts';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn();});
async function ready(options:Parameters<typeof xPageAdmissionFixture>[0]={}){const env=await xPageAdmissionFixture(options);cleanup.push(env.close);return env;}
describe('0017 true file gateway admission',()=>{
 test('preserves nonempty RSS bindings and unresolved accounting while all 27 X sources start closed',async()=>{
  const e=await ready({withUnknown:true});expect(e.oldBindings.length).toBeGreaterThan(0);expect(e.unknownBefore).toHaveLength(1);
  expect(e.database.prepare('SELECT * FROM rss_automatic_source_binding_v1 ORDER BY fence_receipt_id').all()).toEqual(e.oldBindings);
  expect(e.database.prepare("SELECT * FROM internal_operation WHERE state='reconcile_required'").all()).toEqual(e.unknownBefore);
  expect(e.database.prepare("SELECT count(*) n FROM source WHERE source_kind='x_page' AND enabled=0").get()!.n).toBe(27);
  expect(e.database.prepare('PRAGMA user_version').get()!.user_version).toBe(10);assertXPageAdmissionSchema(e.database);
 });
 test('migration replay is inert and both policy-row drift and physical drift close the successor',async()=>{
  const e=await ready(),input={applyEnabled:true,appliedAt:e.now().toISOString()};
  expect(()=>applyXPageAdmissionMigration(e.database,input)).toThrow('X_PAGE_ADMISSION_WRITER_ACTIVE');e.gateway.close();
  expect(applyXPageAdmissionMigration(e.database,input)).toMatchObject({applied:false,schemaSha256:X_PAGE_ADMISSION_SCHEMA_SHA256});
  expect(()=>e.database.exec("UPDATE internal_operation_policy SET allow_global_stop=1 WHERE policy_id='p-x-page-trusted-import-live'")).toThrow('POLICY_IMMUTABLE');
  e.fixtureMutation(db=>db.exec("UPDATE internal_operation_policy SET allow_global_stop=1 WHERE policy_id='p-x-page-trusted-import-live'"));
  expect(()=>assertXPageAdmissionSchema(e.database)).toThrow('X_PAGE_ADMISSION_POLICY_DRIFT');
  expect(()=>new SqliteInternalOperationGateway({database:e.database,schemaSha256:X_PAGE_ADMISSION_SCHEMA_SHA256,releaseSha256:'0'.repeat(64),manifestSha256:'0'.repeat(64)})).toThrow('X_PAGE_ADMISSION_POLICY_DRIFT');
  e.fixtureMutation(db=>db.exec("UPDATE internal_operation_policy SET allow_global_stop=0 WHERE policy_id='p-x-page-trusted-import-live'"));
  e.database.exec('CREATE INDEX synthetic_schema_drift ON x_page_producer_receipt_v1(accepted_at)');
  expect(()=>assertXPageAdmissionSchema(e.database)).toThrow('X_PAGE_ADMISSION_SCHEMA_DRIFT');
 });
 test('real gateway admits one signed source then atomically imports and replays durable receipt',async()=>{
  const e=await ready();const admitted=e.admit();expect(admitted.registryRevision).toBe(3);e.live();
  const capture=e.capture(),imported=e.importCapture(capture);expect(imported.decision).toBe('created');
  expect(e.receiptLedger.read(capture.evidence.producerId,capture.evidence.receiptId)).toMatchObject({result:imported});
  const repeated=e.importCapture(capture,{sourceRevision:1,sourceVersionHash:imported.sourceVersionHash});expect(repeated).toEqual(imported);
  expect(e.database.prepare('SELECT count(*) n FROM x_page_producer_receipt_v1').get()!.n).toBe(1);
  const saved=readTrustedXPageInput({database:e.database,target:{candidateId:imported.candidateId,sourceRevision:1,inputContentHash:imported.sourceVersionHash},trust:e.trust,receiptLedger:e.receiptLedger,evidencePort:e.evidencePort,now:e.now()});
  expect(saved.verified.normalized.text).toBe('Synthetic original F1 post');
 });
 test('rejects forged signature and raw admission/receipt mutations',async()=>{
  const e=await ready();const original=e.capture(),bad={...original,post:{...original.post,text:'Forged post'}};expect(()=>e.admit('x_f1',bad)).toThrow('X_CAPTURE_SIGNATURE_INVALID');
  expect(()=>e.database.exec("UPDATE source SET enabled=1 WHERE source_id='x_f1'")).toThrow();
  expect(()=>e.database.exec("UPDATE x_page_source_config_v1 SET evidence_class='producer_signed_visible_capture' WHERE source_id='x_f1'")).toThrow();
  expect(e.database.prepare('SELECT count(*) n FROM x_page_source_admission_v1').get()!.n).toBe(0);
 });
 test('real model gateway records one started attempt and sends full captured text before draft storage',async()=>{
  const e=await ready();e.admit();e.live();const completeText='Synthetic complete F1 technical detail. '.repeat(100),capture=e.capture({text:completeText}),imported=e.importCapture(capture);
  const target={candidateId:imported.candidateId,sourceRevision:1,inputContentHash:imported.sourceVersionHash};
  expect(issueXPageAutomaticFences({database:e.database,gateway:e.gateway,supervisorPort:e.port('system_supervisor'),target,now:e.now})).toEqual({issued:5,reused:0});
  let sends=0,started:unknown,sentText:unknown;const model=createXPageModelGateway({externalPort:e.port('bilingual_refiner'),privateDir:e.root,fetcher:async(_url,request)=>{
   sends++;const op=e.database.prepare("SELECT a.state,a.external_calls,op.state AS operation_state FROM internal_external_attempt a JOIN internal_operation op ON op.operation_id=a.operation_id WHERE op.owner_process='bilingual_refiner'").get();
   started=op;const body=JSON.parse(String(request?.body));sentText=JSON.parse(body.messages[1].content).completeText;
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({titleZh:'车队分享技术进展',summaryZh:'车队通过原帖介绍了近期的赛车技术进展。',keyPointsZh:['完整正文已用于整理']})}}],usage:{prompt_tokens:32,completion_tokens:24}}),{status:200});
  }});
  const options={database:e.database,target,trust:e.trust,receiptLedger:e.receiptLedger,evidencePort:e.evidencePort,mutationPort:e.port('bilingual_refiner'),...model,budgetAccountId:'acct-rss',now:e.now};
  expect(await refineOneXCandidate(options)).toMatchObject({status:'generated',externalCalls:1});
  expect(await refineOneXCandidate(options)).toMatchObject({status:'already_generated',externalCalls:0});expect(sends).toBe(1);expect(started).toMatchObject({state:'started',external_calls:1,operation_state:'in_flight'});expect(sentText).toBe(completeText.trim());
  expect(e.database.prepare('SELECT count(*) n FROM machine_summary_draft WHERE candidate_id=?').get(target.candidateId)!.n).toBe(1);
 });
 test('a source-local epoch change during the real model attempt prevents draft storage and replay billing',async()=>{
  const e=await ready();e.admit();e.live();const imported=e.importCapture(),target={candidateId:imported.candidateId,sourceRevision:1,inputContentHash:imported.sourceVersionHash};
  issueXPageAutomaticFences({database:e.database,gateway:e.gateway,supervisorPort:e.port('system_supervisor'),target,now:e.now});let sends=0;
  const model=createXPageModelGateway({externalPort:e.port('bilingual_refiner'),privateDir:e.root,fetcher:async()=>{
   sends++;e.fixtureMutation(db=>db.exec("UPDATE source_registry_v1 SET source_safety_epoch=source_safety_epoch+1 WHERE source_id='x_f1'"));
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({titleZh:'车队分享动态',summaryZh:'这段返回发生在源权限变化之后。',keyPointsZh:['迟到结果应关闭']})}}],usage:{prompt_tokens:20,completion_tokens:16}}),{status:200});
  }});
  const input={database:e.database,target,trust:e.trust,receiptLedger:e.receiptLedger,evidencePort:e.evidencePort,mutationPort:e.port('bilingual_refiner'),...model,budgetAccountId:'acct-rss',now:e.now};
  await expect(refineOneXCandidate(input)).rejects.toThrow();expect(sends).toBe(1);
  expect(e.database.prepare('SELECT 1 FROM machine_summary_draft WHERE candidate_id=?').get(target.candidateId)).toBeUndefined();
  await expect(refineOneXCandidate(input)).rejects.toThrow();expect(sends).toBe(1);
 });

 test('a reused producer receipt cannot claim different content',async()=>{
  const e=await ready();e.admit();e.live();const first=e.importCapture();
  expect(()=>e.importCapture(e.capture({text:'A different signed F1 post'}),{sourceRevision:1,sourceVersionHash:first.sourceVersionHash})).toThrow('X_IMPORT_RECEIPT_CONFLICT');
  expect(e.database.prepare('SELECT count(*) n FROM x_page_producer_receipt_v1').get()!.n).toBe(1);
 });
 test('a fresh observation of unchanged content stores a receipt without changing the content revision',async()=>{
  const e=await ready();e.admit();e.live();const first=e.importCapture(),next=e.importCapture(e.capture({receiptId:'fresh-observation'}),{sourceRevision:1,sourceVersionHash:first.sourceVersionHash});
  expect(next.decision).toBe('duplicate');expect(next.sourceRevision).toBe(1);
  expect(e.database.prepare('SELECT count(*) n FROM x_page_producer_receipt_v1').get()!.n).toBe(2);
  expect(e.database.prepare('SELECT count(*) n FROM x_page_candidate_capture_v1').get()!.n).toBe(1);
 });
 test('an edited complete post creates a second immutable capture and content revision',async()=>{
  const e=await ready();e.admit();e.live();const first=e.importCapture();
  const next=e.importCapture(e.capture({text:'An edited and complete F1 source post',receiptId:'edited-observation',observedAt:'2026-09-06T23:59:30.000Z'}),{sourceRevision:1,sourceVersionHash:first.sourceVersionHash});
  expect(next).toMatchObject({decision:'updated',sourceRevision:2});
  expect(e.database.prepare('SELECT count(*) n FROM x_page_candidate_capture_v1').get()!.n).toBe(2);
  expect(()=>e.database.exec('DELETE FROM x_page_candidate_capture_v1')).toThrow();
 });
 test('receipt failure after candidate and capture writes rolls back handoff, operation, audit and business rows together',async()=>{
  const e=await ready();e.admit();e.live();const value=e.capture();
  const tables=['pending_review_candidate','x_page_candidate_capture_v1','x_page_producer_receipt_v1','internal_operation','internal_operation_audit','owner_authorization_handoff','operation_entity_binding','x_page_operation_source_binding_v1','gateway_write_permit'];
  const snapshot=()=>canonicalJson(tables.map(table=>({table,rows:e.database.prepare(`SELECT * FROM ${table}`).all()}))),before=snapshot();
  const injected={runAtomicAdmission:e.importPort.runAtomicAdmission.bind(e.importPort),runImportTransaction:<T>(input:Parameters<typeof e.importPort.runImportTransaction>[0],callback:(mutate:Parameters<Parameters<typeof e.importPort.runImportTransaction>[1]>[0])=>T)=>e.importPort.runImportTransaction(input,mutate=>callback(write=>{const count=mutate(write);if(write.entityKind==='x_page_capture')throw new Error('SYNTHETIC_BEFORE_RECEIPT_CRASH');return count;}))};
  expect(()=>importTrustedXCapture({database:e.database,gatewayPort:injected,receiptLedger:e.receiptLedger,evidencePort:e.evidencePort,capture:value,trust:e.trust,expectedSourceIdentity:readReadyXPageSource(e.database,e.trust,'x_f1',e.now()),expectedCandidate:null,operationId:'synthetic-crash-import',now:e.now})).toThrow('SYNTHETIC_BEFORE_RECEIPT_CRASH');
  expect(snapshot()).toBe(before);
 });
 test('SIGKILL between capture and receipt leaves the file database at the last committed admission',async()=>{
  const child=fork(fileURLToPath(new URL('./helpers/x-page-admission-crash-child.ts',import.meta.url)),[],{execPath:process.execPath,execArgv:['--experimental-transform-types'],stdio:['ignore','pipe','pipe','ipc']});
  cleanup.push(()=>child.kill('SIGKILL'));
  let observed:{path:string;root:string;tables:string[];snapshot:string}|undefined,stderr='';child.stderr?.on('data',value=>{stderr+=String(value);});
  const exited=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
   const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('X_PAGE_CRASH_CHILD_TIMEOUT '+stderr));},15000);
   child.once('error',error=>{clearTimeout(timeout);reject(error);});child.on('message',value=>{observed=value as typeof observed;});
   child.once('exit',(code,signal)=>{clearTimeout(timeout);resolve({code,signal});});
  });
  expect(exited,stderr).toEqual({code:null,signal:'SIGKILL'});expect(observed).toBeDefined();
  const saved=observed!;cleanup.push(()=>rmSync(saved.root,{recursive:true,force:true}));const db=new DatabaseSync(saved.path);cleanup.push(()=>db.close());
  expect(canonicalJson(saved.tables.map(table=>({table,rows:db.prepare(`SELECT * FROM ${table}`).all()})))).toBe(saved.snapshot);
  expect(db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  assertXPageAdmissionSchema(db);
 });
 test('a source-local clock change invalidates old bindings while clocks remain independent of the runtime',async()=>{
  const e=await ready();e.admit();e.live();const first=e.importCapture();
  const binding=e.database.prepare('SELECT * FROM x_page_operation_source_binding_v1 WHERE operation_id=?').get(first.operationId)!;
  const control=e.database.prepare('SELECT * FROM internal_control WHERE singleton_id=1').get()!;expect(binding.source_config_epoch).not.toBe(control.source_config_epoch);
  assertXPageOperationSourcesCurrent(e.database,first.operationId,e.now());
  e.fixtureMutation(db=>db.exec("UPDATE source_registry_v1 SET source_config_epoch=source_config_epoch+1 WHERE source_id='x_f1'"));
  expect(()=>assertXPageOperationSourcesCurrent(e.database,first.operationId,e.now())).toThrow('X_PAGE_OPERATION_SOURCE_STALE');
 });
 test('a global runtime epoch change invalidates old X source bindings without rewriting local registry history',async()=>{
  const e=await ready();e.admit();e.live();const first=e.importCapture(),local=e.database.prepare("SELECT * FROM source_registry_v1 WHERE source_id='x_f1'").get();
  e.fixtureMutation(db=>db.exec('UPDATE internal_control SET writer_epoch=writer_epoch+1'));
  expect(()=>assertXPageOperationSourcesCurrent(e.database,first.operationId,e.now())).toThrow('X_PAGE_OPERATION_SOURCE_STALE');
  expect(e.database.prepare("SELECT * FROM source_registry_v1 WHERE source_id='x_f1'").get()).toEqual(local);
 });
 test('a repost requires the observing source to remain admitted and current',async()=>{
  const e=await ready();e.admit();e.admit('x_mclarenf1');e.live();const imported=e.importCapture(e.capture({observedOn:'mclarenf1'}));
  expect(e.database.prepare('SELECT count(*) n FROM x_page_operation_source_binding_v1 WHERE operation_id=?').get(imported.operationId)!.n).toBe(2);
  e.fixtureMutation(db=>db.exec("UPDATE source SET enabled=0 WHERE source_id='x_mclarenf1'"));
  expect(()=>assertXPageOperationSourcesCurrent(e.database,imported.operationId,e.now())).toThrow('X_PAGE_SOURCE_DISABLED');
 });
 test('the existing Admin disable entry stops an admitted source and only trusted readmission can restore it',async()=>{
  const e=await ready();e.admit();e.live();const imported=e.importCapture();
  // Fixture authority mirrors an already admitted source-management capability;
  // the source transition itself goes through the unchanged real Admin port.
  e.fixtureMutation(db=>db.exec("UPDATE internal_control SET phase='paused'; UPDATE quick_launch_authority_v2 SET state='enabled',version=2,updated_by_operation_id='synthetic-x-admit-1',authority_receipt_sha256='1111111111111111111111111111111111111111111111111111111111111111' WHERE capability_id='source_registry_management'"));
  const before=e.database.prepare("SELECT * FROM source_registry_v1 WHERE source_id='x_f1'").get()!,control=e.database.prepare('SELECT * FROM internal_control').get()!;
  const admin=e.port('admin_http');expect(admin.mutateSourceRegistry({operationId:'synthetic-x-admin-stop',action:'disable',sourceId:'x_f1',expectedRevision:3,reasonCode:'OPERATOR_REQUEST'})).toBe(1);
  expect(e.database.prepare("SELECT enabled,stop_epoch FROM source WHERE source_id='x_f1'").get()).toMatchObject({enabled:0,stop_epoch:3});
  const stopped=e.database.prepare("SELECT * FROM source_registry_v1 WHERE source_id='x_f1'").get()!;
  expect(stopped).toMatchObject({enabled:0,lifecycle_status:'paused',collection_onboarding_status:'stopped',source_stop_status:'manual',revision:4,source_config_epoch:Number(before.source_config_epoch)+1,source_safety_epoch:Number(before.source_safety_epoch)+1,authorization_version:Number(before.authorization_version)+1});
  expect(e.database.prepare('SELECT * FROM internal_control').get()).toEqual(control);
  expect(e.database.prepare("SELECT source_revision FROM x_page_source_config_v1 WHERE source_id='x_f1'").get()!.source_revision).toBe(4);
  expect(e.database.prepare("SELECT action FROM source_registry_history_v1 WHERE operation_id='synthetic-x-admin-stop'").get()!.action).toBe('disabled');
  expect(()=>assertXPageOperationSourcesCurrent(e.database,imported.operationId,e.now())).toThrow('X_PAGE_SOURCE_DISABLED');
  expect(()=>admin.mutateSourceRegistry({operationId:'synthetic-x-admin-bypass',action:'requeue',sourceId:'x_f1',expectedRevision:4,reasonCode:'OPERATOR_REQUEST'})).toThrow('X_PAGE_TRUSTED_READMISSION_REQUIRED');
  e.fixtureMutation(db=>db.exec("UPDATE internal_control SET global_stop_state='stopped'"));expect(e.admit().registryRevision).toBe(5);e.live();
  expect(()=>assertXPageOperationSourcesCurrent(e.database,imported.operationId,e.now())).toThrow('X_PAGE_OPERATION_SOURCE_STALE');
  expect(e.importCapture(e.capture({receiptId:'after-readmission'}),{sourceRevision:1,sourceVersionHash:imported.sourceVersionHash})).toMatchObject({decision:'duplicate',sourceRevision:1});
 });
 test('producer key and deployment rotation preserves verifiable history and does not create a content revision',async()=>{
  const e=await ready();e.admit();e.live();const original=e.capture(),first=e.importCapture(original),keys=generateKeyPairSync('ed25519');
  const trust={...e.trust,keyId:'synthetic-rotated-key',publicKey:keys.publicKey,deploymentManifestSha256:testHash('rotated-deployment'),producerAdmissionReceiptSha256:testHash('rotated-admission'),sources:e.trust.sources.map(source=>({...source,authorizationReceiptSha256:testHash('rotated-'+source.sourceId)}))};
  const draft={...original,evidence:{...original.evidence,keyId:trust.keyId,receiptId:'rotated-observation',deploymentManifestSha256:trust.deploymentManifestSha256,producerAdmissionReceiptSha256:trust.producerAdmissionReceiptSha256}},capture={...draft,signature:sign(null,xCaptureSigningBytes(draft),keys.privateKey).toString('base64url')};
  e.fixtureMutation(db=>db.exec("UPDATE internal_control SET phase='paused',global_stop_state='stopped'"));
  admitTrustedXPageSource({database:e.database,gatewayPort:e.port('system_supervisor'),trust,evidencePort:e.evidencePort,capture,sourceId:'x_f1',expectedRegistryRevision:3,operationId:'synthetic-key-rotation',now:e.now});e.live();
  const gatewayPort=new SqliteXPageImportMutationPort({database:e.database,gatewayPort:e.port('x_page_importer'),trust,evidencePort:e.evidencePort,now:e.now});
  const current=readTrustedXPageInput({database:e.database,target:{candidateId:first.candidateId,sourceRevision:1,inputContentHash:first.sourceVersionHash},trust,receiptLedger:e.receiptLedger,evidencePort:e.evidencePort,now:e.now()});
  expect(current.verified.capture.evidence.keyId).toBe(e.trust.keyId);expect(current.verified.capture.evidence.deploymentManifestSha256).toBe(e.trust.deploymentManifestSha256);
  const duplicated=importTrustedXCapture({database:e.database,gatewayPort,receiptLedger:e.receiptLedger,evidencePort:e.evidencePort,capture,trust,expectedSourceIdentity:readReadyXPageSource(e.database,trust,'x_f1',e.now()),expectedCandidate:{sourceRevision:1,sourceVersionHash:first.sourceVersionHash},operationId:'synthetic-rotated-import',now:e.now});
  expect(duplicated).toMatchObject({decision:'duplicate',sourceRevision:1});expect(e.database.prepare('SELECT count(*) n FROM x_page_candidate_capture_v1').get()!.n).toBe(1);
  expect(e.receiptLedger.readAdmissionTrust(original.evidence.producerId,original.evidence.receiptId).trust.keyId).toBe(e.trust.keyId);
  expect(e.receiptLedger.readAdmissionTrust(capture.evidence.producerId,capture.evidence.receiptId).trust.keyId).toBe(trust.keyId);
  expect(()=>e.importCapture(e.capture({receiptId:'old-key-after-rotation'}),{sourceRevision:1,sourceVersionHash:first.sourceVersionHash})).toThrow();
 });
 test('direct X import policy lacks verified capture authority and cannot borrow a RSS source',async()=>{
  const e=await ready();e.admit();e.live();const source=e.database.prepare("SELECT revision,identity_sha256 FROM source_registry_v1 WHERE source_id='x_f1'").get()!;
  const op={operationId:'synthetic-unverified-import',operationKind:'collect' as const,ownerProcess:'x_page_importer' as const,policyId:'p-x-page-trusted-import-live',capabilityClass:'db_mutation' as const,egressClass:'none' as const,identity:{sourceId:'x_f1',candidateId:'xpage-unverified',publicationId:null,publicId:null},sourceStopEpoch:2,requestHash:'0'.repeat(64),entitySet:[{entityKind:'source' as const,entityId:'x_f1',identitySelector:'source_id' as const,expectedVersion:Number(source.revision),expectedHash:String(source.identity_sha256)},{entityKind:'candidate' as const,entityId:'xpage-unverified',identitySelector:'candidate_id' as const,expectedVersion:null,expectedHash:'0'.repeat(64)}]};
  expect(()=>e.port('x_page_importer').runTransaction(op,()=>null)).toThrow('X_PAGE_VERIFIED_CAPTURE_AUTHORITY_REQUIRED');
  expect(()=>e.port('x_page_importer').runTransaction({...op,operationId:'synthetic-rss-as-x',identity:{...op.identity,sourceId:e.sourceId},entitySet:[...op.entitySet,{entityKind:'source',entityId:e.sourceId,identitySelector:'bound_child',expectedVersion:null,expectedHash:'0'.repeat(64)}]},()=>null)).toThrow('X_PAGE_POLICY_SOURCE_KIND_INVALID');
  expect(e.database.prepare("SELECT 1 FROM internal_operation WHERE operation_id IN('synthetic-unverified-import','synthetic-rss-as-x')").get()).toBeUndefined();
 });
 test('the RSS review policy cannot acquire an X source or candidate',async()=>{
  const e=await ready();e.admit();e.live();const first=e.importCapture();
  expect(()=>e.port('automatic_reviewer').runTransaction({operationId:'synthetic-x-via-rss-policy',operationKind:'review',ownerProcess:'automatic_reviewer',policyId:'p-review-auto-live',requiredFenceSet:[],sourceStopEpoch:2,requestHash:'0'.repeat(64),identity:{sourceId:'x_f1',candidateId:first.candidateId,publicationId:null,publicId:null},entitySet:[{entityKind:'source',entityId:'x_f1',identitySelector:'source_id',expectedVersion:null,expectedHash:'0'.repeat(64)},{entityKind:'candidate',entityId:first.candidateId,identitySelector:'candidate_id',expectedVersion:1,expectedHash:first.sourceVersionHash}]},()=>null)).toThrow('X_PAGE_EXPLICIT_POLICY_REQUIRED');
  expect(e.database.prepare("SELECT 1 FROM internal_operation WHERE operation_id='synthetic-x-via-rss-policy'").get()).toBeUndefined();
 });

 test('file-pinned producer and verifier evidence crosses admission, import and historical input verification',async()=>{
  const e=await ready(),files=testXArtifactEnvironment();cleanup.push(files.cleanup);
  files.config.producerTrust.sources=files.config.producerTrust.sources.map(source=>({...source,identitySha256:xPageSelectedIdentity(source.sourceId)}));files.repinConfig();
  const runtimeTrust=files.load(),original=files.capture;
  const capture=files.producer.resign({...original,evidence:{...original.evidence,sourceIdentitySha256:xPageSelectedIdentity(original.evidence.sourceId),observedSourceIdentitySha256:xPageSelectedIdentity(original.evidence.observedSourceId)}});
  const captureSha256=files.putArtifact('captures',capture),payload={...files.payload,captureSha256,sourceIdentitySha256:capture.evidence.sourceIdentitySha256,observedSourceIdentitySha256:capture.evidence.observedSourceIdentitySha256};
  files.putArtifact('verifier-receipts',{payload,signature:sign(null,xPageArtifactVerifierSigningBytes(payload),files.verifier.privateKey).toString('base64url')},captureSha256);
  const evidencePort=createXPageFileEvidencePort({runtimeTrust,now:e.now});
  admitTrustedXPageSource({database:e.database,gatewayPort:e.port('system_supervisor'),trust:runtimeTrust.trust,evidencePort,capture,sourceId:'x_f1',expectedRegistryRevision:2,operationId:'file-proof-source-admission',now:e.now});e.live();
  const gatewayPort=new SqliteXPageImportMutationPort({database:e.database,gatewayPort:e.port('x_page_importer'),trust:runtimeTrust.trust,evidencePort,now:e.now});
  const imported=importTrustedXCapture({database:e.database,gatewayPort,receiptLedger:e.receiptLedger,evidencePort,capture,trust:runtimeTrust.trust,expectedSourceIdentity:readReadyXPageSource(e.database,runtimeTrust.trust,'x_f1',e.now()),expectedCandidate:null,operationId:'file-proof-import',now:e.now});
  const input={database:e.database,target:{candidateId:imported.candidateId,sourceRevision:1,inputContentHash:imported.sourceVersionHash},trust:runtimeTrust.trust,receiptLedger:e.receiptLedger,evidencePort,now:e.now()};
  expect(readTrustedXPageInput(input).verified.captureSha256).toBe(captureSha256);
  const historical=e.receiptLedger.readAdmissionTrust(capture.evidence.producerId,capture.evidence.receiptId);expect(historical.metadata.configurationSha256).toBe(runtimeTrust.configurationSha256);
  files.put(join(files.artifactPath,'raw-tool-output',files.tool.rawToolOutputSha256+'.json'),{...files.raw,toolCallId:'tampered'});
  expect(()=>readTrustedXPageInput(input)).toThrow('X_CAPTURE_ARTIFACT_HASH_MISMATCH');
  expect(e.database.prepare("SELECT 1 FROM internal_operation WHERE owner_process='bilingual_refiner'").get()).toBeUndefined();
 });

});
