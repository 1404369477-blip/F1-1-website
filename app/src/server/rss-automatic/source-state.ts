import type {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {canonicalJson} from "../db/profile.ts";
import {rssConfigTable} from "../rss/rss-config-read.ts";
type Row=Record<string,unknown>;
function assert(value:unknown,code:string):asserts value{if(!value)throw new Error(code);}

/** Source policy is current even when an approved delivery carries an older
 * content revision. Source configuration and content revisions are independent. */
export function readRssAutomaticSourceState(database:DatabaseSync,sourceId:string,now:Date):Row {
 const value=database.prepare(`SELECT s.source_id,s.enabled AS legacy_enabled,s.stop_epoch,
  r.enabled AS registry_enabled,r.revision AS registry_revision,r.identity_sha256,r.source_kind,r.collection_mode,r.lifecycle_status,r.collection_onboarding_status,
  r.normalization_status,r.dedup_status,r.monitorability,r.adapter_status,r.adapter_authorization_status,r.platform_allowed,r.source_stop_status,r.current_operation_id,
  r.authorization_expires_at,r.source_config_epoch,r.source_safety_epoch,r.authorization_version,r.policy_epoch,r.recovery_epoch,
  cfg.source_revision AS config_revision,cfg.rights_status,cfg.media_policy,cfg.authorization_receipt_sha256,cfg.source_policy_sha256
  FROM source s JOIN source_registry_v1 r ON r.source_id=s.source_id JOIN ${rssConfigTable(database)} cfg ON cfg.source_id=s.source_id WHERE s.source_id=?`).get(sourceId) as Row|undefined;
 assert(value,"RSS_AUTO_SOURCE_NOT_ALLOWED");
 assert(value.legacy_enabled===1 && value.registry_enabled===1 && value.source_kind==="rss" && value.collection_mode==="rss"
  && value.lifecycle_status==="active" && value.collection_onboarding_status==="active","RSS_AUTO_SOURCE_NOT_ACTIVE");
 assert(value.registry_revision===value.config_revision && value.current_operation_id===null,"RSS_AUTO_CONFIG_STALE");
 assert(value.normalization_status==="valid" && ["unique","linked_existing"].includes(String(value.dedup_status))
  && value.monitorability==="monitorable" && value.adapter_status==="ready" && value.adapter_authorization_status==="valid"
  && value.platform_allowed==="allowed" && value.source_stop_status==="clear","RSS_AUTO_SOURCE_NOT_READY");
 assert(value.rights_status==="clear" && ["zero_media","allowlisted"].includes(String(value.media_policy)),"RSS_AUTO_RIGHTS_OR_MEDIA_BLOCKED");
 assert(Number.isFinite(now.getTime()) && Date.parse(String(value.authorization_expires_at))>now.getTime(),"RSS_AUTO_AUTHORIZATION_EXPIRED");
 assert([value.authorization_receipt_sha256,value.source_policy_sha256].every(v=>typeof v==="string" && /^[0-9a-f]{64}$/.test(v)),"RSS_AUTO_SOURCE_RECEIPT_INVALID");
 // Registry clocks are source-local/history snapshots, while operation clocks
 // belong to the active runtime. 0016 binds each current source value separately;
 // recovery or another source's config change must not rewrite source history.
 for(const field of ["source_config_epoch","source_safety_epoch","authorization_version","policy_epoch","recovery_epoch","stop_epoch"] as const)
  assert(Number.isSafeInteger(value[field]) && Number(value[field])>=1,"RSS_AUTO_SOURCE_EPOCH_INVALID");
 if(!database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='rss_automatic_source_binding_v1'").get()) {
  // The predecessor has no per-receipt source snapshot. Retain its original
  // admission/delivery checks until the explicit 0016 migration has completed.
  const control=database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Row;
  for(const field of ["source_config_epoch","source_safety_epoch","authorization_version","policy_epoch","recovery_epoch"] as const)
   assert(value[field]===control[field],"RSS_AUTO_SOURCE_EPOCH_STALE");
  assert(value.stop_epoch===control.source_config_epoch,"RSS_AUTO_SOURCE_EPOCH_STALE");
 }
 return value;
}

export function rssAutomaticSourceSnapshotHash(source:Row):string {
 const fields=["source_id","registry_revision","identity_sha256","config_revision","stop_epoch","source_config_epoch","source_safety_epoch",
  "authorization_version","policy_epoch","recovery_epoch","authorization_receipt_sha256","source_policy_sha256","authorization_expires_at","rights_status","media_policy"];
 return createHash("sha256").update(canonicalJson(Object.fromEntries(fields.map(field=>[field,source[field]])))).digest("hex");
}

export function assertRssAutomaticSourceBindingCurrent(database:DatabaseSync,fenceReceiptId:string):void {
 // Immutable 0014 databases retain their original SQL checks. Every 0016 receipt
 // must have a snapshot; old receipts receive no implicit backfill or exemption.
 if(!database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='rss_automatic_source_binding_v1'").get())return;
 assert(database.prepare("SELECT 1 FROM rss_automatic_source_binding_current_v1 WHERE fence_receipt_id=?").get(fenceReceiptId),"RSS_AUTO_SOURCE_BINDING_STALE");
}
