import {DatabaseSync} from "node:sqlite";
import {createHash,generateKeyPairSync} from "node:crypto";
import {join} from "node:path";
import {writeFileSync} from "node:fs";
import {afterEach,describe,expect,test,vi} from "vitest";
import {rssSourceEpochFixture} from "./helpers/rss-source-epoch.ts";
import {xPageSchema12} from "./helpers/x-page-database.ts";
import {applyRssAutomaticMigration,assertRssAutomaticSchema} from "../server/rss-automatic/migration.ts";
import {applyRssAutomaticSourceEpochMigration} from "../server/rss-automatic/source-epoch-migration.ts";
import {RSS_AUTOMATIC_SCHEMA_SHA256} from "../server/rss-automatic/schema-identity.ts";
import {RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256} from "../server/rss-automatic/source-epoch-schema-identity.ts";
import {sourceRegistrySchemaFingerprint,assertSourceRegistrySchema} from "../server/rss/source-registry-migration.ts";
import {assertRssAutomaticTarget,issueRssAutomaticFences} from "../server/rss-automatic/admission.ts";
import {runRssAutomaticCycle} from "../server/rss-automatic/worker.ts";
import {refineOneCandidate,DEEPSEEK_PROMPT_SHA256} from "../server/rss/refinement.ts";
import {prepareRssAutomaticDelivery} from "../server/rss-automatic/delivery-authority.ts";
import {ProjectionSender} from "../server/review-real/sender.ts";
import {ProjectionReceiver} from "../server/review-real/projection.ts";
import {ReviewRealRepository} from "../server/review-real/repository.ts";
import {canonicalJson} from "../server/db/profile.ts";
import {createReviewAdminRuntime,createRssAutomaticRuntime} from "../server/admin-service/runtime.ts";
import {ADMIN_RELEASE_RUNTIME_FILES,ADMIN_RELEASE_RUNTIME_FILE_COUNT,ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256} from "../server/admin-service/release-manifest.ts";
import { PUBLIC_RELEASE_RUNTIME_FILE_COUNT,PUBLIC_RELEASE_RUNTIME_FILES,PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256} from "../server/public/release-manifest.ts";
import {activateReleaseCandidate,buildReleasePairReceipt,collectReleaseFiles,fallbackV10Capabilities,fullV10Capabilities,releaseIdForRole,releasePathRoot,releaseSourcePreimageSha256,type ReleaseCandidateManifest} from "../server/internal-operation/release.ts";
import {SOURCE_REGISTRY_MIGRATION_SHA256,SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256} from "../server/rss/source-registry-migration.ts";
import {rssAutomaticServiceFixture} from "./helpers/rss-automatic-service-fixture.ts";
import {seedRssAutomaticBackup,withRssSyntheticSeed} from "./helpers/rss-automatic-backup.ts";

const cleanups:Array<()=>void>=[];
afterEach(()=>{vi.restoreAllMocks();for(const cleanup of cleanups.splice(0).reverse())cleanup();});
async function ready(options:Parameters<typeof rssSourceEpochFixture>[0]={}) {
 const env=await rssSourceEpochFixture(options);cleanups.push(env.close);return env;
}
const modelResponse=()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({titleZh:"当前来源的F1新闻",summaryZh:"通过独立来源时钟校验后的模型中文摘要。",keyPointsZh:["保留来源历史"]})}}],usage:{prompt_tokens:10,completion_tokens:12}}),{status:200});
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const idle=async()=>({schemaVersion:"rss-refinement-receipt-v1" as const,status:"idle" as const,candidateId:null,sourceRevision:null,model:"deepseek-chat" as const,promptSha256:DEEPSEEK_PROMPT_SHA256,responseSha256:null,inputTokens:0,outputTokens:0,externalCalls:0 as const});
const sourceChanges=[
 ["config epoch","UPDATE source_registry_v1 SET source_config_epoch=source_config_epoch+1 WHERE source_id=?"],
 ["safety epoch","UPDATE source_registry_v1 SET source_safety_epoch=source_safety_epoch+1 WHERE source_id=?"],
 ["authorization version","UPDATE source_registry_v1 SET authorization_version=authorization_version+1 WHERE source_id=?"],
 ["policy epoch","UPDATE source_registry_v1 SET policy_epoch=policy_epoch+1 WHERE source_id=?"],
 ["recovery epoch","UPDATE source_registry_v1 SET recovery_epoch=recovery_epoch+1 WHERE source_id=?"],
 ["stop epoch","UPDATE source SET stop_epoch=stop_epoch+1 WHERE source_id=?"],
 ["identity","UPDATE source_registry_v1 SET identity_sha256='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE source_id=?"],
 ["registry revision","UPDATE source_registry_v1 SET revision=revision+1 WHERE source_id=?"],
 ["config revision","UPDATE source_registry_rss_config_v2 SET source_revision=source_revision+1 WHERE source_id=?"],
 ["authorization receipt","UPDATE source_registry_rss_config_v2 SET authorization_receipt_sha256='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE source_id=?"],
 ["policy receipt","UPDATE source_registry_rss_config_v2 SET source_policy_sha256='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE source_id=?"],
 ["authorization expiry","UPDATE source_registry_v1 SET authorization_expires_at='2027-07-01T00:00:00.000Z' WHERE source_id=?"],
 ["rights","UPDATE source_registry_rss_config_v2 SET rights_status='blocked' WHERE source_id=?"],
 ["media","UPDATE source_registry_rss_config_v2 SET media_policy='zero_media' WHERE source_id=?"],
] as const;
const globalClocks=['source_config_epoch','source_safety_epoch','authorization_version','policy_epoch','recovery_epoch','writer_epoch'] as const;
function projectionSender(env:Awaited<ReturnType<typeof ready>>,unknown=false) {
 env.fixtureMutation(database=>{
  database.prepare("INSERT INTO budget_account VALUES('acct-projection','request',100,0,0,1)").run();
  database.prepare("INSERT INTO route_registry VALUES('route-projection','projection','projection_private','projection_deliver',?,?,?,'active',1)").run(digest("127.0.0.1:3102/internal/projections"),'0'.repeat(64),'0'.repeat(64));
 });
 const keys=generateKeyPairSync('ed25519'),receiver=new ProjectionReceiver({root:join(env.root,'public'),signingKeyId:'synthetic-key',publicKey:keys.publicKey,now:()=>env.now().getTime()});
 const port=env.port('projection_sender'),reconciler=env.port('reconciler');let posts=0,gets=0;
 const sender=new ProjectionSender({prepareDeliveryAuthority:()=>{prepareRssAutomaticDelivery(env);},repository:new ReviewRealRepository(env.database,env.now,port),signingKeyId:'synthetic-key',privateKey:keys.privateKey,actorRef:'synthetic-sender',
  externalAttempt:port.runExternal.bind(port),externalReconcile:reconciler.runProjectionReconcile.bind(reconciler),transport:{post:async value=>{posts++;const body=receiver.receive(value);return unknown?{kind:'unknown'}:{kind:'response',status:200,body};},getReceipt:async id=>{gets++;return {kind:'response',status:200,body:receiver.getReceipt(id)};}}});
 return {sender,receiver,counts:()=>({posts,gets})};
}

function sourceEpochReleasePair(schemaSha256:typeof RSS_AUTOMATIC_SCHEMA_SHA256|typeof RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256) {
 const appRoot=new URL('../../',import.meta.url).pathname.replace(/\/$/u,'');
 const files=collectReleaseFiles(appRoot,[...new Set([...ADMIN_RELEASE_RUNTIME_FILES,...PUBLIC_RELEASE_RUNTIME_FILES])]);
 const identity={schemaVersion:10 as const,sourceCommitSha1:'a'.repeat(40),sourceTreeSha1:'b'.repeat(40),schemaSha256,
  migration0009RawSha256:SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256,migration0010RawSha256:SOURCE_REGISTRY_MIGRATION_SHA256,
  adminRuntimeFileCount:ADMIN_RELEASE_RUNTIME_FILE_COUNT,adminRuntimePathSetSha256:ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
  publicRuntimeFileCount: PUBLIC_RELEASE_RUNTIME_FILE_COUNT,publicRuntimePathSetSha256:PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256,
  packageLockSha256:files.find(file=>file.path==='package-lock.json')!.sha256,packageRootSha256:'c'.repeat(64),pathRootSha256:releasePathRoot(files)};
 const sourcePreimageSha256=releaseSourcePreimageSha256(identity),base={...identity,sourcePreimageSha256,files};
 const full:ReleaseCandidateManifest={...base,role:'full_v10',releaseId:releaseIdForRole('full_v10',sourcePreimageSha256),capabilities:fullV10Capabilities({schemaSha256})};
 const fallback:ReleaseCandidateManifest={...base,role:'manual_only_fallback_v10',releaseId:releaseIdForRole('manual_only_fallback_v10',sourcePreimageSha256),capabilities:fallbackV10Capabilities()};
 const receipt=buildReleasePairReceipt(full,fallback,'2026-09-07T00:00:00.000Z');
 return {receipt,gate:activateReleaseCandidate(full,receipt,'2026-09-07T00:00:01.000Z',null)};
}
function migrationHistory(database:DatabaseSync) {
 return database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'rss_automatic_source_binding_v1' ORDER BY name").all().map(row=>({table:row.name,
  rows:database.prepare(`SELECT * FROM "${String(row.name).replaceAll('"','""')}"`).all().map(value=>canonicalJson(value)).sort()}));
}
async function closedUnknownModel() {
 const env=await ready({legacy:true,sourceId:'skysports-f1-news'});issueRssAutomaticFences(env);
 await expect(refineOneCandidate({database:env.database,mutationPort:env.port('rss_refiner'),target:env.target,apiKeyPath:env.keyPath,budgetAccountId:'acct-rss',now:env.now,
  fetchImpl:async()=>{throw new Error('SYNTHETIC_UNKNOWN_MODEL_RESPONSE');}})).rejects.toThrow('SYNTHETIC_UNKNOWN_MODEL_RESPONSE');
 env.gateway.close();env.fixtureMutation(database=>database.exec("UPDATE internal_control SET phase='paused',global_stop_state='stopped'"));
 const operation=env.database.prepare("SELECT * FROM internal_operation WHERE owner_process='rss_refiner'").get()!;
 expect(operation).toMatchObject({state:'reconcile_required',reason_code:'EXTERNAL_UNKNOWN',result_hash:null});
 return {...env,unknownOperationId:String(operation.operation_id)};
}

describe("RSS 0016 independent source and runtime clocks",()=>{
 test.each([
  ['requested operation',"UPDATE internal_operation SET state='requested' WHERE operation_id=?"],
  ['authorized operation',"UPDATE internal_operation SET state='authorized' WHERE operation_id=?"],
  ['in-flight operation',"UPDATE internal_operation SET state='in_flight' WHERE operation_id=?"],
  ['reviewer owner',"UPDATE internal_operation SET owner_process='automatic_reviewer' WHERE operation_id=?"],
  ['publisher owner',"UPDATE internal_operation SET owner_process='automatic_publisher' WHERE operation_id=?"],
  ['sender owner',"UPDATE internal_operation SET owner_process='projection_sender' WHERE operation_id=?"],
  ['reconciler owner',"UPDATE internal_operation SET owner_process='reconciler' WHERE operation_id=?"],
  ['store capability',"UPDATE internal_operation SET capability_class='db_mutation' WHERE operation_id=?"],
  ['store policy',"UPDATE internal_operation SET policy_id='p-refine-rss-store-live' WHERE operation_id=?"],
  ['unexpected result',"UPDATE internal_operation SET result_hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE operation_id=?"],
  ['non-unknown operation reason',"UPDATE internal_operation SET reason_code='OTHER_REASON' WHERE operation_id=?"],
  ['unstarted intent',"UPDATE internal_external_attempt SET state='intent_committed',outcome='pending',external_calls=0,started_at=NULL WHERE operation_id=?"],
  ['started attempt',"UPDATE internal_external_attempt SET state='started',outcome='pending' WHERE operation_id=?"],
  ['missing start time',"UPDATE internal_external_attempt SET started_at=NULL WHERE operation_id=?"],
  ['unexpected response hash',"UPDATE internal_external_attempt SET response_hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE operation_id=?"],
  ['missing attempt',"DELETE FROM internal_external_attempt WHERE operation_id=?"],
  ['missing budget',"DELETE FROM budget_reservation WHERE operation_id=?"],
  ['unfrozen reservation',"UPDATE budget_reservation SET state='reserved' WHERE operation_id=?"],
  ['non-request budget units',"UPDATE budget_account SET unit_kind='tokens' WHERE account_id=(SELECT account_id FROM budget_reservation WHERE operation_id=?)"],
  ['mismatched reservation attempt',"UPDATE budget_reservation SET attempt_id='different-attempt' WHERE operation_id=?"],
  ['registered route identity changed',"UPDATE route_registry SET endpoint_identity_sha256='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' WHERE route_id=(SELECT route_id FROM internal_external_attempt WHERE operation_id=?)"],
  ['request hash corruption',"UPDATE internal_external_attempt SET canonical_request_hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE operation_id=?"],
  ['attempt nonce corruption',"UPDATE internal_external_attempt SET attempt_nonce='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' WHERE operation_id=?"],
  ['canonical request method corruption',"UPDATE internal_external_attempt SET canonical_request_json=json_set(canonical_request_json,'$.method','GET') WHERE operation_id=?"],
  ['request identity corruption',"UPDATE internal_external_attempt SET canonical_request_json=json_set(canonical_request_json,'$.entityIdentity.candidateId','different-candidate') WHERE operation_id=?"],
  ['request epoch corruption',"UPDATE internal_operation SET recovery_epoch=recovery_epoch+1 WHERE operation_id=?"],
  ['operation outbox',"INSERT INTO internal_operation_outbox SELECT 'unexpected-outbox',operation_id,'reconcile_query','unexpected-outbox-key','{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','pending',1,created_at,updated_at FROM internal_operation WHERE operation_id=?"],
  ['business write permit',"INSERT INTO gateway_write_permit SELECT 'unexpected-write',operation_id,'machine_draft','unexpected-draft','insert',NULL,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NULL,created_at FROM internal_operation WHERE operation_id=?"],
 ] as const)("unknown preservation rejects %s without changing history or schema",async(_name,sql)=>{
  const env=await closedUnknownModel();env.fixtureMutation(database=>database.prepare(sql).run(env.unknownOperationId));
  const before=migrationHistory(env.database);
  expect(()=>applyRssAutomaticSourceEpochMigration(env.database,{applyEnabled:true})).toThrow('AUTOMATIC_WORK_OPEN');
  expect(sourceRegistrySchemaFingerprint(env.database)).toBe(RSS_AUTOMATIC_SCHEMA_SHA256);
  expect(migrationHistory(env.database)).toEqual(before);
 });
 test.each([
  ['singular request fixture','request',digest('https://api.deepseek.com/chat/completions')],
  // Actual immutable M1 ledger shape: plural request unit and an opaque
  // registered route identity. The gateway binds that identity verbatim.
  ['actual M1 ledger shape','requests','6750c64aad19d45ec5edeb5e3d8543a79e8334ada45fbd4abdc1fdc4c8a5af0f'],
 ] as const)("preserves a durable unknown model request and two reopened successor runtimes cannot POST or create a draft: %s",async(_shape,unitKind,routeIdentity)=>{
  const legacy=sourceEpochReleasePair(RSS_AUTOMATIC_SCHEMA_SHA256),successor=sourceEpochReleasePair(RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256);
  const fixture=await rssAutomaticServiceFixture(legacy.gate,true,legacy.receipt.fallbackManifestSha256);cleanups.push(fixture.cleanup);
  const seed=new DatabaseSync(fixture.databasePath);try{withRssSyntheticSeed(seed,()=>{
   seed.exec("DELETE FROM machine_summary_draft; UPDATE pending_review_candidate SET source_id='skysports-f1-news'");
   seed.prepare("UPDATE budget_account SET unit_kind=? WHERE account_id='acct-rss'").run(unitKind);
   seed.prepare("INSERT INTO route_registry VALUES('route-deepseek','model','model_https','model_refine',?,?,?,'active',1)").run(routeIdentity,'0'.repeat(64),'0'.repeat(64));
  });}finally{seed.close();}
  writeFileSync(join(fixture.privateDir,'deepseek-api-key'),'sk-'+'x'.repeat(24),{mode:0o600});
  const calls=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('SYNTHETIC_UNKNOWN_MODEL_RESPONSE'));
  const oldRuntime=createReviewAdminRuntime(fixture.config),oldAutomatic=createRssAutomaticRuntime(fixture.config,oldRuntime);
  try{expect(await oldAutomatic.tick()).toMatchObject({status:'blocked',reasonCode:'SYNTHETIC_UNKNOWN_MODEL_RESPONSE'});expect(calls).toHaveBeenCalledTimes(1);}
  finally{oldAutomatic.close();oldRuntime.closeBackgroundResources();oldRuntime.gateway?.close();oldRuntime.database.close();}
  const offline=new DatabaseSync(fixture.databasePath);
  let oldOperationId:string,oldOperation:unknown,oldAttempts:unknown,oldBudget:unknown,oldAccounts:unknown;
  try{
   withRssSyntheticSeed(offline,()=>offline.exec("UPDATE internal_control SET phase='paused',global_stop_state='stopped'"));
   oldOperation=offline.prepare("SELECT * FROM internal_operation WHERE owner_process='rss_refiner'").get()!;
   oldOperationId=String((oldOperation as Record<string,unknown>).operation_id);
   expect(oldOperation).toMatchObject({state:'reconcile_required',reason_code:'EXTERNAL_UNKNOWN',result_hash:null});
   oldAttempts=offline.prepare('SELECT * FROM internal_external_attempt WHERE operation_id=?').all(oldOperationId);
   oldBudget=offline.prepare('SELECT * FROM budget_reservation WHERE operation_id=?').all(oldOperationId);
   oldAccounts=offline.prepare('SELECT * FROM budget_account ORDER BY account_id').all();
   const history=migrationHistory(offline);
   expect(applyRssAutomaticSourceEpochMigration(offline,{applyEnabled:true}).applied).toBe(true);
   expect(migrationHistory(offline)).toEqual(history);
   expect(offline.prepare('SELECT count(*) n FROM rss_automatic_source_binding_v1').get()!.n).toBe(0);
   withRssSyntheticSeed(offline,()=>offline.exec("UPDATE internal_control SET phase='live',global_stop_state='clear'"));
   seedRssAutomaticBackup(offline,{releaseSha256:successor.gate.receipt.manifestSha256,manifestSha256:fixture.config.expectedDeploymentManifestSha256!,nowIso:new Date().toISOString(),schemaSha256:RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256,id:'unknown-successor-backup'});
  }finally{offline.close();}
  const config:Parameters<typeof createReviewAdminRuntime>[0]={...fixture.config,reviewSchemaSha256:RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256,releaseGate:successor.gate,
   expectedBackupReleaseSha256:successor.gate.receipt.manifestSha256,verifiedRssAutomaticFullManifestSha256:successor.gate.receipt.manifestSha256,verifiedRssAutomaticFallbackManifestSha256:successor.receipt.fallbackManifestSha256};
  calls.mockClear();calls.mockResolvedValue(modelResponse());
  for(let round=0;round<2;round++){
   const runtime=createReviewAdminRuntime(config),automatic=createRssAutomaticRuntime(config,runtime);
   try{
    expect(await automatic.tick()).toMatchObject({status:'blocked',considered:1,refined:0,approved:0,published:0,reasonCode:'EXTERNAL_RECONCILE_REQUIRED'});
    expect(calls).not.toHaveBeenCalled();
    for(const table of ['machine_summary_draft','review_bundle','projection_outbox'])expect(runtime.database.prepare(`SELECT count(*) n FROM ${table}`).get()!.n).toBe(0);
    expect(runtime.database.prepare('SELECT * FROM internal_operation WHERE operation_id=?').get(oldOperationId!)).toEqual(oldOperation);
    expect(runtime.database.prepare('SELECT * FROM internal_external_attempt WHERE operation_id=?').all(oldOperationId!)).toEqual(oldAttempts);
    expect(runtime.database.prepare('SELECT * FROM budget_reservation WHERE operation_id=?').all(oldOperationId!)).toEqual(oldBudget);
    expect(runtime.database.prepare('SELECT * FROM budget_account ORDER BY account_id').all()).toEqual(oldAccounts);
   }finally{automatic.close();runtime.closeBackgroundResources();runtime.gateway?.close();runtime.database.close();}
  }
 });
 test.each(['attached','temp','drift','schema11'] as const)("migration rejects %s before schema changes",mode=>{
  const db=xPageSchema12();cleanups.push(()=>db.close());applyRssAutomaticMigration(db,{applyEnabled:true});
  if(mode==='attached')db.exec("ATTACH ':memory:' AS unrelated");if(mode==='temp')db.exec("CREATE TEMP TABLE unexpected(value TEXT)");if(mode==='drift')db.exec("CREATE TABLE unexpected(value TEXT)");if(mode==='schema11')db.exec('PRAGMA user_version=11');
  expect(()=>applyRssAutomaticSourceEpochMigration(db,{applyEnabled:true})).toThrow(/RSS_AUTO_SOURCE_EPOCH_MIGRATION_(ATTACHED_DATABASE|TEMP_DIRTY|PREDECESSOR_DRIFT)/);
  expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='rss_automatic_source_binding_v1'").get()).toBeUndefined();
 });
 test("migration rejects an installed writer and an open phase",async()=>{
  const env=await ready({legacy:true});expect(()=>applyRssAutomaticSourceEpochMigration(env.database,{applyEnabled:true})).toThrow('WRITER_ACTIVE');
  env.gateway.close();expect(()=>applyRssAutomaticSourceEpochMigration(env.database,{applyEnabled:true})).toThrow('NOT_CLOSED');
  expect(sourceRegistrySchemaFingerprint(env.database)).toBe(RSS_AUTOMATIC_SCHEMA_SHA256);
 });
 test.each([true,false])("migration preserves historical unfinished rows and blocks current predecessor work: current=%s",async current=>{
  const env=await ready({legacy:true,sourceId:'skysports-f1-news'});issueRssAutomaticFences(env);
  env.gateway.close();env.fixtureMutation(db=>{
   db.exec("UPDATE internal_control SET phase='paused',global_stop_state='stopped'");
   db.prepare("UPDATE internal_operation SET state='requested',expected_schema_sha256=? WHERE operation_id=(SELECT operation_id FROM internal_operation LIMIT 1)").run(current?RSS_AUTOMATIC_SCHEMA_SHA256:'e'.repeat(64));
  });
  const before=env.database.prepare("SELECT * FROM internal_operation ORDER BY operation_id").all();
  if(current)expect(()=>applyRssAutomaticSourceEpochMigration(env.database,{applyEnabled:true})).toThrow('AUTOMATIC_WORK_OPEN');
  else expect(applyRssAutomaticSourceEpochMigration(env.database,{applyEnabled:true}).applied).toBe(true);
  expect(env.database.prepare("SELECT * FROM internal_operation ORDER BY operation_id").all()).toEqual(before);
 });
 test("migration blocks pending delivery even when its publisher belongs to an older schema",async()=>{
  const env=await ready({legacy:true,withDraft:true,sourceId:'skysports-f1-news'});
  const result=await runRssAutomaticCycle({...env,refine:idle});expect(result.published).toBe(1);env.gateway.close();
  env.fixtureMutation(db=>{db.exec("UPDATE internal_control SET phase='paused',global_stop_state='stopped'");db.prepare("UPDATE internal_operation SET expected_schema_sha256=? WHERE owner_process='automatic_publisher'").run('e'.repeat(64));});
  expect(()=>applyRssAutomaticSourceEpochMigration(env.database,{applyEnabled:true})).toThrow('DELIVERY_OPEN');
  expect(sourceRegistrySchemaFingerprint(env.database)).toBe(RSS_AUTOMATIC_SCHEMA_SHA256);
 });
 test("offline exact predecessor, unchanged old rows, no backfill, and idempotent replay",()=>{
  const database=xPageSchema12(true);cleanups.push(()=>database.close());
  // This fixture's historical publisher leaves a pending outbox. Close only
  // this synthetic history before asserting an offline migration is admitted.
  const triggers=database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all();
  for(const row of triggers)database.exec(`DROP TRIGGER "${row.name}"`);
  try{database.exec("UPDATE projection_outbox SET status='terminal_failed'");}finally{for(const row of triggers)database.exec(String(row.sql));}
  applyRssAutomaticMigration(database,{applyEnabled:true});
  expect(sourceRegistrySchemaFingerprint(database)).toBe(RSS_AUTOMATIC_SCHEMA_SHA256);
  const before=database.prepare("SELECT * FROM source_registry_v1 ORDER BY source_id").all();
  const result=applyRssAutomaticSourceEpochMigration(database,{applyEnabled:true});
  expect(result).toMatchObject({applied:true,schemaSha256:RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256,predecessorSha256:RSS_AUTOMATIC_SCHEMA_SHA256,userVersion:10});
  expect(result.preservedHistorySha256).toMatch(/^[a-f0-9]{64}$/);
  expect(database.prepare("SELECT * FROM source_registry_v1 ORDER BY source_id").all()).toEqual(before);
  expect(database.prepare("SELECT count(*) n FROM rss_automatic_source_binding_v1").get()!.n).toBe(0);
  expect(()=>assertSourceRegistrySchema(database)).not.toThrow();expect(()=>assertRssAutomaticSchema(database)).not.toThrow();
  expect(applyRssAutomaticSourceEpochMigration(database,{applyEnabled:true})).toMatchObject({applied:false,preservedHistorySha256:result.preservedHistorySha256});
  expect(applyRssAutomaticMigration(database,{applyEnabled:true}).applied).toBe(false);
 });
 test.each(['motorsport-f1-news','the-race-f1-news'])("unmigrated 0014 preserves its original fail-closed source check: %s",async sourceId=>{
  const env=await ready({legacy:true,sourceId});expect(()=>assertRssAutomaticTarget(env.database,env.target,env.cutoffIso,env.now())).toThrow('RSS_AUTO_SOURCE_EPOCH_STALE');
 });
 test.each(["motorsport-f1-news","the-race-f1-news","skysports-f1-news"])("actual M1 clock shape proceeds through model, draft, review, and outbox: %s",async sourceId=>{
  const env=await ready({sourceId});let calls=0;
  expect(()=>assertRssAutomaticTarget(env.database,env.target,env.cutoffIso,env.now())).not.toThrow();
  const result=await runRssAutomaticCycle({...env,refine:target=>refineOneCandidate({database:env.database,mutationPort:env.port("rss_refiner"),target,apiKeyPath:env.keyPath,budgetAccountId:"acct-rss",now:env.now,fetchImpl:async()=>{calls++;return modelResponse();}})});
  expect(result,JSON.stringify(result)).toMatchObject({status:"processed",refined:1,approved:1,published:1});
  expect(calls).toBe(1);expect(env.database.prepare("SELECT count(*) n FROM machine_summary_draft").get()!.n).toBe(1);
  expect(env.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(1);
  expect(env.database.prepare("SELECT source_config_epoch,recovery_epoch,expected_writer_epoch FROM internal_operation WHERE owner_process='rss_refiner' AND egress_class='model_https'").get()).toMatchObject({source_config_epoch:1,recovery_epoch:2,expected_writer_epoch:2});
  expect(env.database.prepare("SELECT source_config_epoch,recovery_epoch FROM rss_automatic_source_binding_v1 LIMIT 1").get()).toMatchObject({source_config_epoch:sourceId==='motorsport-f1-news'?4:1,recovery_epoch:sourceId==='skysports-f1-news'?2:1});
 });
 test.each(sourceChanges)("source %s change invalidates all old fences and blocks review",async (_name,sql)=>{
  const env=await ready({withDraft:true});expect(issueRssAutomaticFences(env)).toEqual({issued:5,reused:0});
  const old=env.database.prepare("SELECT * FROM rss_automatic_source_binding_v1 ORDER BY fence_receipt_id").all();
  env.fixtureMutation(db=>db.prepare(sql).run(env.sourceId));
  expect(env.database.prepare("SELECT count(*) n FROM rss_automatic_source_binding_current_v1").get()!.n).toBe(0);
  expect(env.database.prepare("SELECT count(*) n FROM rss_automatic_fence_current_v1").get()!.n).toBe(0);
  expect(()=>env.reviewer.reviewAutomaticCandidate(env.target)).toThrow();
  expect(env.database.prepare("SELECT count(*) n FROM review_decision").get()!.n).toBe(0);
  expect(env.database.prepare("SELECT * FROM rss_automatic_source_binding_v1 ORDER BY fence_receipt_id").all()).toEqual(old);
 });
 test.each(sourceChanges.slice(0,6))("fixed clock and capped expiry permit fresh issuance after source %s changes",async (_name,sql)=>{
  const env=await ready();env.fixtureMutation(db=>db.prepare("UPDATE source_registry_v1 SET authorization_expires_at=? WHERE source_id=?").run(new Date(env.now().getTime()+60_000).toISOString(),env.sourceId));
  issueRssAutomaticFences(env);const old=env.database.prepare("SELECT fence_receipt_id FROM rss_automatic_fence_current_v1 ORDER BY fence_receipt_id").all();
  env.fixtureMutation(db=>db.prepare(sql).run(env.sourceId));
  expect(issueRssAutomaticFences(env)).toEqual({issued:5,reused:0});
  const fresh=env.database.prepare("SELECT fence_receipt_id FROM rss_automatic_fence_current_v1 ORDER BY fence_receipt_id").all();
  expect(fresh).toHaveLength(5);expect(fresh.some(f=>old.some(o=>o.fence_receipt_id===f.fence_receipt_id))).toBe(false);
  expect(env.database.prepare("SELECT count(*) n FROM generic_fence_receipt").get()!.n).toBe(10);
 });
 test.each(globalClocks)("global %s remains strict and fixed-clock reissuance obtains fresh receipts",async field=>{
  const env=await ready();issueRssAutomaticFences(env);
  env.fixtureMutation(db=>db.exec(`UPDATE internal_control SET ${field}=${field}+1`));
  expect(env.database.prepare("SELECT count(*) n FROM rss_automatic_fence_current_v1").get()!.n).toBe(0);
  expect(env.database.prepare("SELECT count(*) n FROM rss_automatic_source_binding_current_v1").get()!.n).toBe(5);
  expect(issueRssAutomaticFences(env)).toEqual({issued:5,reused:0});
  expect(env.database.prepare("SELECT count(*) n FROM rss_automatic_fence_current_v1").get()!.n).toBe(5);
 });
 test("source safety change during model response prevents persistence and retries",async()=>{
  const env=await ready();issueRssAutomaticFences(env);let calls=0;
  const input={database:env.database,mutationPort:env.port('rss_refiner'),target:env.target,apiKeyPath:env.keyPath,budgetAccountId:'acct-rss',now:env.now,fetchImpl:async()=>{
   calls++;env.fixtureMutation(db=>db.prepare(sourceChanges[1][1]).run(env.sourceId));return modelResponse();
  }};
  await expect(refineOneCandidate(input)).rejects.toThrow('RSS_AUTO_FENCE_STALE');
  expect(env.database.prepare("SELECT count(*) n FROM machine_summary_draft").get()!.n).toBe(0);
  expect(env.database.prepare("SELECT state FROM internal_external_attempt").get()!.state).toBe('reconcile_required');
  env.advanceNow(60_000);await expect(refineOneCandidate(input)).rejects.toThrow('EXTERNAL_RECONCILE_REQUIRED');expect(calls).toBe(1);
 });
 test("old fence history survives migration and cannot receive a post-hoc source binding",async()=>{
  const env=await ready({legacy:true});env.fixtureMutation(db=>{db.prepare("UPDATE source SET stop_epoch=1 WHERE source_id=?").run(env.sourceId);db.prepare("UPDATE source_registry_v1 SET source_config_epoch=1,source_safety_epoch=1,recovery_epoch=2 WHERE source_id=?").run(env.sourceId);});
  issueRssAutomaticFences(env);const old=env.database.prepare("SELECT * FROM generic_fence_receipt ORDER BY fence_receipt_id").all();
  env.gateway.close();env.fixtureMutation(db=>db.exec("UPDATE internal_control SET phase='paused',global_stop_state='stopped'"));
  expect(applyRssAutomaticSourceEpochMigration(env.database,{applyEnabled:true}).applied).toBe(true);
  expect(env.database.prepare("SELECT * FROM generic_fence_receipt ORDER BY fence_receipt_id").all()).toEqual(old);
  expect(env.database.prepare("SELECT count(*) n FROM rss_automatic_fence_current_v1").get()!.n).toBe(0);
  expect(()=>env.database.exec(`INSERT INTO rss_automatic_source_binding_v1 SELECT f.fence_receipt_id,f.issued_by_operation_id,s.source_id,r.revision,r.identity_sha256,cfg.source_revision,s.stop_epoch,r.source_config_epoch,r.source_safety_epoch,r.authorization_version,r.policy_epoch,r.recovery_epoch,cfg.authorization_receipt_sha256,cfg.source_policy_sha256,r.authorization_expires_at,cfg.rights_status,cfg.media_policy FROM generic_fence_receipt f JOIN internal_operation op ON op.operation_id=f.issued_by_operation_id JOIN source s ON s.source_id=op.source_id JOIN source_registry_v1 r ON r.source_id=s.source_id JOIN source_registry_rss_config_current cfg ON cfg.source_id=s.source_id LIMIT 1`)).toThrow('RSS_AUTO_SOURCE_BINDING_UNAUTHORIZED');
 });
 test.each(['INSERT INTO rss_automatic_source_binding_v1 SELECT * FROM rss_automatic_source_binding_v1','UPDATE rss_automatic_source_binding_v1 SET recovery_epoch=2','DELETE FROM rss_automatic_source_binding_v1'])("gateway owner connection rejects direct source binding mutation: %s",async sql=>{
  const env=await ready();issueRssAutomaticFences(env);expect(()=>env.database.exec(sql)).toThrow(/not authorized/);
  const raw=new DatabaseSync(env.path);try{expect(()=>raw.exec(sql)).toThrow(/RSS_AUTO_SOURCE_BINDING_(IMMUTABLE|UNAUTHORIZED)/);}finally{raw.close();}
  expect(env.database.prepare("SELECT count(*) n FROM rss_automatic_source_binding_v1").get()!.n).toBe(5);
 });
 test("source authorization unchanged permits delayed committed delivery after candidate content advances",async()=>{
  const env=await ready({withDraft:true});const result=await runRssAutomaticCycle({...env,refine:idle});
  expect(result.published).toBe(1);const outbox=env.database.prepare("SELECT * FROM projection_outbox").get();
  env.fixtureMutation(db=>db.prepare("UPDATE pending_review_candidate SET source_revision=2,source_payload_hash=?,title='New candidate content' WHERE candidate_id=?").run('b'.repeat(64),env.target.candidateId));
  env.advanceNow(900_001);const delivery=projectionSender(env);
  await expect(delivery.sender.tick()).resolves.toMatchObject({outcome:'succeeded',deliveryId:result.deliveryId});
  expect(delivery.counts()).toEqual({posts:1,gets:0});expect(delivery.receiver.readActiveSnapshot()?.snapshotGeneration).toBe(1);
  expect(env.database.prepare("SELECT count(*) n FROM generic_fence_receipt WHERE reason_code='RSS_AUTOMATIC_COMMITTED_DELIVERY_V1'").get()!.n).toBe(5);
  expect(env.database.prepare("SELECT task_envelope_hash FROM projection_outbox").get()!.task_envelope_hash).toBe(outbox!.task_envelope_hash);
 });
 test.each([false,true])("source clock drift blocks committed delivery and durable GET: unknown=%s",async unknown=>{
  const env=await ready({withDraft:true});const result=await runRssAutomaticCycle({...env,refine:idle});expect(result.published).toBe(1);
  const delivery=projectionSender(env,unknown);if(unknown)await expect(delivery.sender.tick()).resolves.toMatchObject({outcome:'reconcile_wait'});
  env.fixtureMutation(db=>db.prepare(sourceChanges[1][1]).run(env.sourceId));
  await expect(delivery.sender.tick()).rejects.toThrow('RSS_AUTO_SOURCE_BINDING_STALE');
  expect(delivery.counts()).toEqual({posts:unknown?1:0,gets:0});
 });
});
