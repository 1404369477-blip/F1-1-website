import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import type {DatabaseSync} from "node:sqlite";
import {canonicalJson} from "../db/profile.ts";
import {getInstalledSqliteAuthorizer} from "../internal-operation/authorizer.ts";
import {canonicalExternalRequestHash,reconcileIdentityHash,requestFingerprintHash,validateClosedExternalRequest,type ClosedExternalRequest} from "../internal-operation/gateway.ts";
import {sourceRegistrySchemaFingerprint} from "../rss/source-registry-migration.ts";
import {REFINE_SYSTEM_PROMPT,refineModelById} from "../rss/refine-model.ts";
import {assertRssAutomaticSchema} from "./migration.ts";
import {RSS_AUTOMATIC_SCHEMA_SHA256} from "./schema-identity.ts";
import {RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256,RSS_AUTOMATIC_SOURCE_EPOCH_MIGRATION_SHA256} from "./source-epoch-schema-identity.ts";

function assert(value:unknown,code:string):asserts value {if(!value)throw new Error(code);}
const sha256=(value:string)=>createHash("sha256").update(value).digest("hex");
const quote=(value:string)=>`"${value.replaceAll('"','""')}"`;
type Row=Record<string,unknown>;

/** Preserve only an already-started, unresolved base DeepSeek request. It stays
 * unknown with its reserved budget; this is not a terminal result or a retry
 * grant. The stable request ID excludes schema/release, so the successor's
 * knownResponseRetry rejects the same revision/hash/model before any new POST.
 * Retry-suffixed requests and other incomplete work remain migration blockers. */
function isFrozenUnknownModelRequest(database:DatabaseSync,op:Row):boolean {
 try {
  if(op.expected_schema_sha256!==RSS_AUTOMATIC_SCHEMA_SHA256 || op.owner_process!=='rss_refiner' || op.operation_kind!=='refine'
   || op.capability_class!=='external_attempt' || op.egress_class!=='model_https' || op.state!=='reconcile_required'
   || op.reason_code!=='EXTERNAL_UNKNOWN' || op.result_hash!==null || op.control_action!==null || op.attempt!==1
   || !['live','backlog'].includes(String(op.phase)) || op.policy_id!==`p-refine-rss-${op.phase}`
   || op.model_route_ref!=='deepseek-chat' || typeof op.candidate_id!=='string' || typeof op.source_id!=='string'
   || op.publication_id!==null || op.public_id!==null || !Number.isSafeInteger(op.expected_entity_version) || Number(op.expected_entity_version)<1) return false;
  const model=refineModelById('deepseek-chat'),operationId=String(op.operation_id);
  const stableSeed=`${op.candidate_id}\n${op.expected_entity_version}\n${op.expected_entity_hash}\n${sha256(REFINE_SYSTEM_PROMPT)}`;
  const externalKey=`${model.idempotencyPrefix}:${op.candidate_id}:${op.expected_entity_version}:${op.expected_entity_hash}`;
  if(operationId!==`gateway-refine-${sha256(stableSeed)}` || op.idempotency_key!==`external-${externalKey}`) return false;
  const attempts=database.prepare('SELECT * FROM internal_external_attempt WHERE operation_id=?').all(operationId);
  if(attempts.length!==1)return false;
  const a=attempts[0];
  if(a.state!=='reconcile_required' || a.outcome!=='unknown' || a.external_calls!==1 || a.attempt_number!==1
   || a.reason_code!=='EXTERNAL_UNKNOWN' || a.response_hash!==null || a.response_identity_sha256!==null || a.reconcile_consumed_at!==null
   || a.endpoint_class!=='model_refine' || a.route_id!==model.routeId || a.provider_resource_identity!==model.modelId
   || a.external_idempotency_key!==externalKey || a.reconcile_key!==`reconcile:${externalKey}`)return false;
  const times=[op.created_at,a.committed_at,a.started_at,op.updated_at].map(value=>typeof value==='string'?Date.parse(value):NaN);
  if(!times.every(Number.isFinite) || times.some((time,index)=>index>0 && time<times[index-1]))return false;
  const request=validateClosedExternalRequest(JSON.parse(String(a.canonical_request_json)) as ClosedExternalRequest);
  if(canonicalJson(request)!==a.canonical_request_json || request.method!=='POST' || request.endpointClass!==a.endpoint_class
   || request.routeId!==a.route_id || request.providerResource!==model.modelId || request.bodySha256===null
   || request.externalIdempotencyKey!==a.external_idempotency_key || request.reconcileKey!==a.reconcile_key
   || request.attemptIdentity.operationId!==operationId || request.attemptIdentity.attemptNumber!==a.attempt_number || request.attemptIdentity.attemptNonce!==a.attempt_nonce
   || canonicalExternalRequestHash(request)!==a.canonical_request_hash || requestFingerprintHash(request)!==a.request_fingerprint
   || reconcileIdentityHash(request)!==a.reconcile_identity_sha256 || op.request_hash!==a.canonical_request_hash || op.request_fingerprint!==a.request_fingerprint
   || request.expected.schemaSha256!==op.expected_schema_sha256 || request.expected.releaseSha256!==op.expected_release_sha256
   || request.expected.manifestSha256!==op.expected_manifest_sha256
   || canonicalJson(request.entityIdentity)!==canonicalJson({sourceId:op.source_id,candidateId:op.candidate_id,publicationId:null,publicId:null})
   || canonicalJson(request.epochs)!==canonicalJson({sourceConfig:op.source_config_epoch,sourceSafety:op.source_safety_epoch,
    authorization:op.authorization_version,policy:op.policy_epoch,recovery:op.recovery_epoch,writer:op.expected_writer_epoch}))return false;
  const route=database.prepare('SELECT * FROM route_registry WHERE route_id=?').get(model.routeId);
  // The original gateway copies the immutable registered identity into the
  // request; it does not define that identity as a hash of current URL bytes.
  if(!route || route.route_class!=='model' || route.egress_class!=='model_https' || route.endpoint_class!=='model_refine'
   || request.expected.routeIdentitySha256!==route.endpoint_identity_sha256)return false;
  const reservations=database.prepare('SELECT * FROM budget_reservation WHERE operation_id=?').all(operationId);
  if(reservations.length!==1)return false;
  const budget=reservations[0],account=database.prepare('SELECT * FROM budget_account WHERE account_id=?').get(String(budget.account_id));
  // This predecessor never sets reservation.attempt_id; the unique attempt is
  // bound by operation_id and the verified canonical request above.
  if(budget.reservation_id!==op.budget_reservation_id || budget.reservation_id!==`reservation-${operationId}`
   || budget.state!=='reconcile_required' || budget.units!==1 || budget.attempt_id!==null || budget.consumed_at!==null
   || budget.account_id!=='acct-rss' || !account || !['request','requests'].includes(String(account.unit_kind)) || Number(account.reserved_units)<1)return false;
  const bindings=database.prepare('SELECT * FROM operation_entity_binding WHERE operation_id=? ORDER BY entity_kind').all(operationId);
  if(bindings.length!==2)return false;
  const [candidate,source]=bindings;
  if(candidate.entity_kind!=='candidate' || candidate.identity_selector!=='candidate_id' || candidate.entity_id!==op.candidate_id
   || candidate.expected_entity_version!==op.expected_entity_version || candidate.expected_entity_hash!==op.expected_entity_hash
   || source.entity_kind!=='source' || source.identity_selector!=='source_id' || source.entity_id!==op.source_id
   || source.expected_entity_version!==null || source.expected_entity_hash!=='0'.repeat(64)
   || bindings.some(binding=>binding.entity_set_hash!==op.entity_set_hash))return false;
  const entityJson=canonicalJson(bindings.map(binding=>({entityKind:binding.entity_kind,entityId:binding.entity_id,expectedVersion:binding.expected_entity_version,expectedHash:binding.expected_entity_hash})));
  if(op.entity_set_json!==entityJson || op.entity_set_hash!==sha256(`f1plus1-operation-entity-set-v1\n${entityJson}`))return false;
  // No business write permit or queued work may accompany this exception.
  return !database.prepare('SELECT 1 FROM gateway_write_permit WHERE operation_id=? LIMIT 1').get(operationId)
   && !database.prepare('SELECT 1 FROM internal_operation_outbox WHERE operation_id=? LIMIT 1').get(operationId);
 }catch{return false;}
}
function historySnapshot(database:DatabaseSync,tables:readonly string[]):string {
  return sha256(canonicalJson(tables.map(table=>{
    const statement=database.prepare(`SELECT * FROM ${quote(table)}`);statement.setReadBigInts(true);
    const rows=statement.all().map(row=>canonicalJson(Object.fromEntries(Object.entries(row).map(([key,value])=>[key,
      typeof value==='bigint'?{integer:value.toString()}:value instanceof Uint8Array?{blob:Buffer.from(value).toString('hex')}:value])))).sort();
    return {table,count:rows.length,sha256:sha256(canonicalJson(rows))};
  })));
}

/** Explicit offline successor. No registry, operation, receipt, or business row
 * is rewritten. Old fences receive no snapshot and therefore no new authority. */
export function applyRssAutomaticSourceEpochMigration(database:DatabaseSync,options:Readonly<{applyEnabled:boolean}>):Readonly<{
  applied:boolean;schemaSha256:string;predecessorSha256:string;userVersion:number;migrationSha256:string;preservedHistorySha256:string;
}> {
  assert(options.applyEnabled===true,"RSS_AUTO_SOURCE_EPOCH_MIGRATION_NOT_ENABLED");
  assert(getInstalledSqliteAuthorizer(database)===null,"RSS_AUTO_SOURCE_EPOCH_MIGRATION_WRITER_ACTIVE");
  assert(database.prepare("PRAGMA database_list").all().every(row=>row.name==='main'||row.name==='temp'),"RSS_AUTO_SOURCE_EPOCH_MIGRATION_ATTACHED_DATABASE");
  assert(database.prepare("SELECT 1 FROM temp.sqlite_schema LIMIT 1").get()===undefined,"RSS_AUTO_SOURCE_EPOCH_MIGRATION_TEMP_DIRTY");
  assert(database.prepare("PRAGMA integrity_check").all().every(row=>row.integrity_check==='ok'),"RSS_AUTO_SOURCE_EPOCH_MIGRATION_INTEGRITY");
  assert(database.prepare("PRAGMA foreign_key_check").get()===undefined,"RSS_AUTO_SOURCE_EPOCH_MIGRATION_FOREIGN_KEY");
  const sql=readFileSync(new URL("../../../migrations/rss-real/0016_rss_source_epoch_scope.sql",import.meta.url),"utf8");
  assert(sha256(sql)===RSS_AUTOMATIC_SOURCE_EPOCH_MIGRATION_SHA256,"RSS_AUTO_SOURCE_EPOCH_MIGRATION_HASH");
  database.exec("BEGIN IMMEDIATE");
  try {
    const before=sourceRegistrySchemaFingerprint(database),version=Number(database.prepare("PRAGMA user_version").get()!.user_version);
    assert(version===10 && [RSS_AUTOMATIC_SCHEMA_SHA256,RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256].includes(before),"RSS_AUTO_SOURCE_EPOCH_MIGRATION_PREDECESSOR_DRIFT");
    assertRssAutomaticSchema(database);
    const tables=database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'rss_automatic_source_binding_v1' ORDER BY name").all().map(row=>String(row.name));
    const preservedHistorySha256=historySnapshot(database,tables);
    if(before===RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256){
      database.exec("COMMIT");return {applied:false,schemaSha256:before,predecessorSha256:RSS_AUTOMATIC_SCHEMA_SHA256,userVersion:version,migrationSha256:RSS_AUTOMATIC_SOURCE_EPOCH_MIGRATION_SHA256,preservedHistorySha256};
    }
    const control=database.prepare("SELECT phase,global_stop_state FROM internal_control WHERE singleton_id=1").get();
    assert(control && ['disabled','paused'].includes(String(control.phase)) && control.global_stop_state==='stopped',"RSS_AUTO_SOURCE_EPOCH_MIGRATION_NOT_CLOSED");
    // Earlier deployments retain unfinished audit rows whose deliveries have
    // already closed. Preserve them verbatim; only this predecessor's active
    // automatic operations can depend on the 0014 authority being replaced.
    const open=database.prepare(`SELECT * FROM internal_operation WHERE expected_schema_sha256=? AND
      (owner_process IN ('rss_refiner','automatic_reviewer','automatic_publisher','projection_sender','reconciler') OR policy_id LIKE 'p-rss-auto-fence-%')
      AND state NOT IN ('succeeded','blocked','terminal_failed','cancelled')`).all(RSS_AUTOMATIC_SCHEMA_SHA256);
    assert(open.every(op=>isFrozenUnknownModelRequest(database,op)),"RSS_AUTO_SOURCE_EPOCH_MIGRATION_AUTOMATIC_WORK_OPEN");
    assert(!database.prepare("SELECT 1 FROM projection_outbox WHERE status NOT IN ('succeeded','terminal_failed') LIMIT 1").get(),"RSS_AUTO_SOURCE_EPOCH_MIGRATION_DELIVERY_OPEN");
    database.exec(sql);
    assert(sourceRegistrySchemaFingerprint(database)===RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256,"RSS_AUTO_SOURCE_EPOCH_MIGRATION_SUCCESSOR_DRIFT");
    assertRssAutomaticSchema(database);
    assert(database.prepare("PRAGMA integrity_check").all().every(row=>row.integrity_check==='ok'),"RSS_AUTO_SOURCE_EPOCH_MIGRATION_INTEGRITY");
    assert(historySnapshot(database,tables)===preservedHistorySha256,"RSS_AUTO_SOURCE_EPOCH_MIGRATION_HISTORY_CHANGED");
    assert(database.prepare("SELECT 1 FROM rss_automatic_source_binding_v1 LIMIT 1").get()===undefined,"RSS_AUTO_SOURCE_EPOCH_MIGRATION_BACKFILL_FORBIDDEN");
    database.exec("COMMIT");
    return {applied:true,schemaSha256:RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256,predecessorSha256:before,userVersion:10,migrationSha256:RSS_AUTOMATIC_SOURCE_EPOCH_MIGRATION_SHA256,preservedHistorySha256};
  } catch(error) {database.exec("ROLLBACK");throw error;}
}
