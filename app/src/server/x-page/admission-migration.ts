import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {DatabaseSync} from 'node:sqlite';
import {canonicalJson} from '../db/profile.ts';
import {getInstalledSqliteAuthorizer} from '../internal-operation/authorizer.ts';
import {sourceRegistrySchemaFingerprint} from '../rss/source-registry-migration.ts';
import {X_PAGE_HANDLES,X_PAGE_SELECTION} from './normalize.ts';
import {X_PAGE_ADMISSION_PREDECESSOR_SHA256,X_PAGE_ADMISSION_SCHEMA_SHA256,X_PAGE_ADMISSION_MIGRATION_SHA256,X_PAGE_ADMISSION_POLICY_SHA256} from './admission-schema-identity.ts';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const quote=(value:string)=>`"${value.replaceAll('"','""')}"`;
type Row=Record<string,unknown>;
function assert(value:unknown,code:string):asserts value {if(!value)throw new Error(code);}
const selected=new Set<string>(X_PAGE_HANDLES.map(handle=>`x_${handle}`));
export function xPageSelectedIdentity(sourceId:string):string {
 assert(selected.has(sourceId),'X_PAGE_SELECTION_INVALID');
 return hash(canonicalJson({sourceId,canonicalPageUrl:`https://x.com/${sourceId.slice(2)}`,sourceKind:'x_page',collectionMode:'browser_visible_dom',selectionSha256:X_PAGE_SELECTION.sha256}));
}
function serial(row:Row):string {return canonicalJson(Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='bigint'?{integer:value.toString()}:value instanceof Uint8Array?{blob:Buffer.from(value).toString('hex')}:value])));}
function rows(database:DatabaseSync,table:string):Row[] {const stmt=database.prepare(`SELECT * FROM ${quote(table)}`);stmt.setReadBigInts(true);return stmt.all();}
function history(database:DatabaseSync,tables:string[],successor:boolean):Record<string,string> {
 return Object.fromEntries(tables.map(table=>{
  let values=rows(database,table);
  if(table==='source_registry_v1')values=values.filter(row=>!selected.has(String(row.source_id)));
  if(table==='source'&&successor)values=values.filter(row=>row.source_kind==='rss').map(row=>{const copy={...row};delete copy.source_kind;return copy;});
  if(successor&&['internal_operation_policy','internal_required_fence_policy','internal_control_action_policy'].includes(table))values=values.filter(row=>!String(row.policy_id).startsWith('p-x-page-'));
  if(successor&&table==='gateway_entity_policy')values=values.filter(row=>!String(row.entity_kind).startsWith('x_page_')&&!(row.operation_kind==='system_producer'&&row.capability_class==='control'&&row.entity_kind==='source'&&row.mutation_kind==='update')&&!(row.operation_kind==='collect'&&row.capability_class==='db_mutation'&&row.entity_kind==='candidate'&&['insert','update'].includes(String(row.mutation_kind))));
  return [table,hash(values.map(serial).sort().join('\n'))];
 }));
}
function integrity(database:DatabaseSync):void {
 assert(database.prepare('PRAGMA integrity_check').all().every(row=>row.integrity_check==='ok'),'X_PAGE_ADMISSION_INTEGRITY');
 assert(!database.prepare('PRAGMA foreign_key_check').get(),'X_PAGE_ADMISSION_FOREIGN_KEY');
}
export function xPageAdmissionPolicyFingerprint(database:DatabaseSync):string {
 const policies=['internal_operation_policy','internal_control_action_policy','internal_required_fence_policy'].map(table=>({table,rows:database.prepare(`SELECT * FROM ${table} WHERE policy_id LIKE 'p-x-page-%'`).all().map(row=>canonicalJson(row)).sort()}));
 policies.push({table:'gateway_entity_policy',rows:database.prepare("SELECT * FROM gateway_entity_policy WHERE entity_kind LIKE 'x_page_%' OR (operation_kind='system_producer' AND capability_class='control' AND entity_kind='source' AND mutation_kind='update') OR (operation_kind='collect' AND capability_class='db_mutation' AND entity_kind='candidate' AND mutation_kind IN('insert','update'))").all().map(row=>canonicalJson(row)).sort()});
 return hash(canonicalJson(policies));
}
export function assertXPageAdmissionSchema(database:DatabaseSync):void {
 assert(Number(database.prepare('PRAGMA user_version').get()!.user_version)===10&&sourceRegistrySchemaFingerprint(database)===X_PAGE_ADMISSION_SCHEMA_SHA256,'X_PAGE_ADMISSION_SCHEMA_DRIFT');
 const row=database.prepare('SELECT * FROM x_page_admission_identity_v1 WHERE singleton_id=1').get();
 assert(row?.predecessor_schema_sha256===X_PAGE_ADMISSION_PREDECESSOR_SHA256&&row.target_schema_sha256===X_PAGE_ADMISSION_SCHEMA_SHA256&&row.migration_sha256===X_PAGE_ADMISSION_MIGRATION_SHA256&&row.selection_sha256===X_PAGE_SELECTION.sha256,'X_PAGE_ADMISSION_IDENTITY_DRIFT');
 assert(xPageAdmissionPolicyFingerprint(database)===X_PAGE_ADMISSION_POLICY_SHA256,'X_PAGE_ADMISSION_POLICY_DRIFT');
}
/** Offline, explicit successor on an already closed disposable file clone. The
 * caller owns filesystem export/install; this synchronous transaction never
 * opens a runtime, changes phase, imports content or grants source readiness. */
export function applyXPageAdmissionMigration(database:DatabaseSync,input:Readonly<{applyEnabled:boolean;appliedAt:string}>):Readonly<{
 applied:boolean;schemaSha256:string;predecessorSha256:string;migrationSha256:string;preservedHistorySha256:string;userVersion:10;
}> {
 assert(input.applyEnabled===true,'X_PAGE_ADMISSION_MIGRATION_NOT_ENABLED');
 assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.appliedAt)&&new Date(input.appliedAt).toISOString()===input.appliedAt,'X_PAGE_ADMISSION_TIME_INVALID');
 assert(getInstalledSqliteAuthorizer(database)===null,'X_PAGE_ADMISSION_WRITER_ACTIVE');
 assert(!database.isTransaction,'X_PAGE_ADMISSION_TRANSACTION_ALREADY_OPEN');
 assert(database.prepare('PRAGMA database_list').all().every(row=>['main','temp'].includes(String(row.name))),'X_PAGE_ADMISSION_ATTACHED_DATABASE');
 assert(!database.prepare('SELECT 1 FROM temp.sqlite_schema LIMIT 1').get(),'X_PAGE_ADMISSION_TEMP_DIRTY');
 integrity(database);
 const before=sourceRegistrySchemaFingerprint(database),version=Number(database.prepare('PRAGMA user_version').get()!.user_version);
 assert(version===10&&[X_PAGE_ADMISSION_PREDECESSOR_SHA256,X_PAGE_ADMISSION_SCHEMA_SHA256].includes(before),'X_PAGE_ADMISSION_PREDECESSOR_DRIFT');
 if(before===X_PAGE_ADMISSION_SCHEMA_SHA256){assertXPageAdmissionSchema(database);const saved=database.prepare('SELECT preserved_history_sha256 FROM x_page_admission_identity_v1').get()!;return {applied:false,schemaSha256:before,predecessorSha256:X_PAGE_ADMISSION_PREDECESSOR_SHA256,migrationSha256:X_PAGE_ADMISSION_MIGRATION_SHA256,preservedHistorySha256:String(saved.preserved_history_sha256),userVersion:10};}
 const sql=readFileSync(new URL('../../../migrations/rss-real/0017_x_page_production_admission.sql',import.meta.url),'utf8');
 assert(hash(sql)===X_PAGE_ADMISSION_MIGRATION_SHA256,'X_PAGE_ADMISSION_MIGRATION_HASH');
 const originalForeignKeys=Number(database.prepare('PRAGMA foreign_keys').get()!.foreign_keys),originalLegacy=Number(database.prepare('PRAGMA legacy_alter_table').get()!.legacy_alter_table);
 try {
  database.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON');
  assert(Number(database.prepare('PRAGMA foreign_keys').get()!.foreign_keys)===0,'X_PAGE_ADMISSION_TRANSACTION_ALREADY_OPEN');
  database.exec('BEGIN IMMEDIATE');
  assert(sourceRegistrySchemaFingerprint(database)===before,'X_PAGE_ADMISSION_PREDECESSOR_DRIFT');
  const ctl=database.prepare('SELECT * FROM internal_control WHERE singleton_id=1').get();
  assert(ctl&&['disabled','paused'].includes(String(ctl.phase))&&ctl.global_stop_state==='stopped','X_PAGE_ADMISSION_NOT_CLOSED');
  assert(!database.prepare("SELECT 1 FROM projection_outbox WHERE status NOT IN('succeeded','terminal_failed') LIMIT 1").get(),'X_PAGE_ADMISSION_DELIVERY_OPEN');
  assert(!database.prepare("SELECT 1 FROM internal_external_attempt WHERE state IN('intent_committed','started') LIMIT 1").get(),'X_PAGE_ADMISSION_ATTEMPT_IN_FLIGHT');
  const objects=database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name').all();
  const tables=objects.filter(row=>row.type==='table'&&!String(row.name).startsWith('sqlite_')).map(row=>String(row.name));
  const snapshot=history(database,tables,false),preservedHistorySha256=hash(canonicalJson(snapshot));
  const registry=database.prepare('SELECT * FROM source_registry_v1 ORDER BY source_id').all();
  for(const sourceId of selected){const row=registry.find(item=>item.source_id===sourceId);assert(row?.source_kind==='x_manual'&&row.enabled===0&&String(row.site_url).toLowerCase()===`https://x.com/${sourceId.slice(2)}`,'X_PAGE_ADMISSION_SELECTION_DRIFT');}
  database.exec('CREATE TEMP TABLE migration_0017_source(source_id TEXT,canonical_handle TEXT,identity_sha256 TEXT); CREATE TEMP TABLE migration_0017_manifest(applied_at TEXT,selection_sha256 TEXT,predecessor_schema_sha256 TEXT,target_schema_sha256 TEXT,migration_sha256 TEXT,preserved_history_sha256 TEXT)');
  for(const sourceId of selected)database.prepare('INSERT INTO migration_0017_source VALUES(?,?,?)').run(sourceId,sourceId.slice(2),xPageSelectedIdentity(sourceId));
  database.prepare('INSERT INTO migration_0017_manifest VALUES(?,?,?,?,?,?)').run(input.appliedAt,X_PAGE_SELECTION.sha256,before,X_PAGE_ADMISSION_SCHEMA_SHA256,X_PAGE_ADMISSION_MIGRATION_SHA256,preservedHistorySha256);
  database.exec(sql);database.exec('DROP TABLE migration_0017_source; DROP TABLE migration_0017_manifest');
  assertXPageAdmissionSchema(database);integrity(database);
  assert(canonicalJson(history(database,tables,true))===canonicalJson(snapshot),'X_PAGE_ADMISSION_HISTORY_CHANGED');
  const current=new Map(database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL').all().map(row=>[row.name,row]));
  const changed=new Set(['source','source_registry_v1','internal_operation_policy','internal_operation','operation_entity_binding','gateway_write_permit','publication','source_registry_update_guard','source_registry_update_effects','source_registry_mutation_permit_insert_guard','rss_automatic_fence_consumer_guard_v1','review_bundle_guard_insert']);
  for(const obj of objects)if(!changed.has(String(obj.name)))assert(canonicalJson(current.get(obj.name))===canonicalJson(obj),'X_PAGE_ADMISSION_SECURITY_OBJECT_CHANGED');
  for(const row of database.prepare("SELECT name FROM sqlite_schema WHERE type='view'").all())database.prepare(`SELECT * FROM ${quote(String(row.name))} LIMIT 0`).all();
  const expected=registry.map(row=>selected.has(String(row.source_id))?{...row,source_kind:'x_page',collection_mode:'browser_visible_dom',revision:Number(row.revision)+1,canonical_url_valid:0,normalization_status:'pending',dedup_status:'pending',identity_status:'unknown',relevance_status:'unknown',monitorability:'unknown',adapter_status:'unchecked',adapter_authorization_status:'unknown',platform_allowed:'unknown',authorization_expires_at:null,lifecycle_status:'proposed',collection_onboarding_status:'validating',enabled:0,identity_sha256:xPageSelectedIdentity(String(row.source_id)),updated_at:input.appliedAt}:row);
  assert(canonicalJson(database.prepare('SELECT * FROM source_registry_v1 ORDER BY source_id').all())===canonicalJson(expected),'X_PAGE_ADMISSION_SELECTED_HISTORY_CHANGED');
  assert(Number(database.prepare("SELECT count(*) n FROM x_page_source_config_v1 WHERE evidence_class='admission_required' AND admission_id IS NULL").get()!.n)===27,'X_PAGE_ADMISSION_DEFAULTS_INVALID');
  for(const table of ['x_page_source_admission_v1','x_page_producer_receipt_v1','x_page_candidate_capture_v1','x_page_operation_source_binding_v1','x_page_automatic_source_binding_v1'])assert(!database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get(),'X_PAGE_ADMISSION_BACKFILL_FORBIDDEN');
  database.exec('COMMIT');return {applied:true,schemaSha256:X_PAGE_ADMISSION_SCHEMA_SHA256,predecessorSha256:before,migrationSha256:X_PAGE_ADMISSION_MIGRATION_SHA256,preservedHistorySha256,userVersion:10};
 }catch(error){if(database.isTransaction)database.exec('ROLLBACK');throw error;}
 finally{database.exec(`PRAGMA foreign_keys=${originalForeignKeys}; PRAGMA legacy_alter_table=${originalLegacy}`);}
}
