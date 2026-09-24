import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { getInstalledSqliteAuthorizer } from "../internal-operation/authorizer.ts";
import { sourceRegistrySchemaFingerprint,SOURCE_REGISTRY_SCHEMA10_0012_SHA256 } from "../rss/source-registry-migration.ts";
import { X_PAGE_SCHEMA_SHA256 } from "../x-page/schema-identity.ts";
import { RSS_AUTOMATIC_SCHEMA_SHA256,RSS_AUTOMATIC_X_SCHEMA_SHA256,RSS_AUTOMATIC_MIGRATION_SHA256 } from "./schema-identity.ts";
import { isRssAutomaticSchemaSha256 } from "./source-epoch-schema-identity.ts";

function assert(value:unknown,code:string):asserts value {if(!value)throw new Error(code);}
export function assertRssAutomaticSchema(database:DatabaseSync):void {
  const fingerprint=sourceRegistrySchemaFingerprint(database);
  const version=Number(database.prepare("PRAGMA user_version").get()!.user_version);
  assert((version===10 && isRssAutomaticSchemaSha256(fingerprint)) || (version===11 && fingerprint===RSS_AUTOMATIC_X_SCHEMA_SHA256),"RSS_AUTO_SCHEMA_DRIFT");
  assert(database.prepare("PRAGMA foreign_key_check").get()===undefined,"RSS_AUTO_SCHEMA_FOREIGN_KEY");
  const policies=database.prepare("SELECT * FROM internal_operation_policy WHERE policy_id LIKE 'p-rss-auto-fence-%' OR policy_id LIKE 'p-refine-rss-store-%' ORDER BY policy_id").all();
  assert(policies.length===4 && policies.every(p=>p.allow_global_stop===0 && p.allow_emergency_stop===0 && p.allowed_recovery_state==='ready' && p.required_identity==='source_candidate' && p.egress_class==='none'),"RSS_AUTO_POLICY_DRIFT");
}
export function applyRssAutomaticMigration(database:DatabaseSync,options:Readonly<{applyEnabled:boolean}>):Readonly<{applied:boolean;schemaSha256:string;userVersion:number}> {
  assert(options.applyEnabled===true,"RSS_AUTO_MIGRATION_NOT_ENABLED");
  assert(getInstalledSqliteAuthorizer(database)===null,"RSS_AUTO_MIGRATION_WRITER_ACTIVE");
  assert(database.prepare("PRAGMA database_list").all().every(row=>row.name==="main" || row.name==="temp"),"RSS_AUTO_MIGRATION_ATTACHED_DATABASE");
  assert(database.prepare("SELECT 1 FROM temp.sqlite_schema LIMIT 1").get()===undefined,"RSS_AUTO_MIGRATION_TEMP_DIRTY");
  assert(database.prepare("PRAGMA integrity_check").all().every(row=>row.integrity_check==="ok"),"RSS_AUTO_MIGRATION_INTEGRITY");
  assert(database.prepare("PRAGMA foreign_key_check").get()===undefined,"RSS_AUTO_MIGRATION_FOREIGN_KEY");
  const before=sourceRegistrySchemaFingerprint(database);
  if(isRssAutomaticSchemaSha256(before) || before===RSS_AUTOMATIC_X_SCHEMA_SHA256) {
    assertRssAutomaticSchema(database);return {applied:false,schemaSha256:before,userVersion:Number(database.prepare("PRAGMA user_version").get()!.user_version)};
  }
  const combined=before===X_PAGE_SCHEMA_SHA256;
  assert(combined || before===SOURCE_REGISTRY_SCHEMA10_0012_SHA256,"RSS_AUTO_MIGRATION_PREDECESSOR_DRIFT");
  const control=database.prepare("SELECT phase,global_stop_state FROM internal_control WHERE singleton_id=1").get();
  assert(control && ['disabled','paused'].includes(String(control.phase)) && control.global_stop_state==='stopped',"RSS_AUTO_MIGRATION_NOT_CLOSED");
  const sql=readFileSync(new URL("../../../migrations/rss-real/0014_rss_automatic_processing.sql",import.meta.url),"utf8");
  assert(createHash("sha256").update(sql).digest("hex")===RSS_AUTOMATIC_MIGRATION_SHA256,"RSS_AUTO_MIGRATION_HASH");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(sql);assertRssAutomaticSchema(database);
    assert(sourceRegistrySchemaFingerprint(database)===(combined?RSS_AUTOMATIC_X_SCHEMA_SHA256:RSS_AUTOMATIC_SCHEMA_SHA256),"RSS_AUTO_MIGRATION_SUCCESSOR_DRIFT");
    database.exec("COMMIT");
  } catch(error) {database.exec("ROLLBACK");throw error;}
  return {applied:true,schemaSha256:sourceRegistrySchemaFingerprint(database),userVersion:Number(database.prepare("PRAGMA user_version").get()!.user_version)};
}
