import {createHash,randomBytes} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {canonicalJsonV1,type OwnerSupervisorHandoff} from "../internal-operation/gateway.ts";
import {getInstalledSqliteAuthorizer} from "../internal-operation/authorizer.ts";
import {persistOwnerSupervisorHandoff} from "../internal-operation/owner-supervisor.ts";
import {assertPhaseAllowsExternal,readPhaseSnapshot} from "../internal-operation/phase.ts";
import type {ReleaseRuntimeGate} from "../internal-operation/release.ts";
import {assertXPageAdmissionSchema} from "../x-page/admission-migration.ts";
import {X_PAGE_ADMISSION_SCHEMA_SHA256} from "../x-page/admission-schema-identity.ts";
import {assertRssAutomaticSchema} from "./migration.ts";
import {isRssAutomaticSchemaSha256} from "./source-epoch-schema-identity.ts";
import {sourceRegistrySchemaFingerprint} from "../rss/source-registry-migration.ts";

export const RSS_AUTOMATIC_OWNERS=["system_supervisor","rss_collector","rss_refiner","automatic_reviewer","automatic_publisher","projection_sender","reconciler"] as const;
export type RssAutomaticOwner=typeof RSS_AUTOMATIC_OWNERS[number]|"x_page_importer"|"bilingual_refiner";
export const RSS_AUTOMATIC_HANDOFF_TTL_MS=60_000;
function assert(value:unknown,code:string):asserts value {if(!value)throw new Error(code);}

/** The separate supervisor connection never carries a gateway writer. Issuance
 * uses the existing insert-only supervisor authorizer and immutable handoff log.
 * There is no stockpile: each operation receives a new, one-use 60-second grant.
 */
export function createRssAutomaticHandoffProvider(input:Readonly<{
  supervisorDatabase:DatabaseSync;
  releaseGate:ReleaseRuntimeGate;
  expectedDeploymentManifestSha256:string;
  expectedBackupReleaseSha256:string;
  ownerProcess:RssAutomaticOwner;
  purpose?:"automatic_processing"|"committed_projection_delivery"|"x_page_source_admission"|"x_page_committed_projection_delivery";
  now?:()=>Date;
}>):()=>OwnerSupervisorHandoff {
  const database=input.supervisorDatabase;
  assert(/^[a-f0-9]{64}$/.test(input.expectedDeploymentManifestSha256),"RSS_AUTO_DEPLOYMENT_IDENTITY_INVALID");
  assert(/^[a-f0-9]{64}$/.test(input.expectedBackupReleaseSha256),"RSS_AUTO_BACKUP_RELEASE_IDENTITY_INVALID");
  const xPage=input.releaseGate.receipt.schemaSha256===X_PAGE_ADMISSION_SCHEMA_SHA256;
  assert((RSS_AUTOMATIC_OWNERS as readonly string[]).includes(input.ownerProcess) || xPage && ["x_page_importer","bilingual_refiner"].includes(input.ownerProcess),"RSS_AUTO_HANDOFF_OWNER_FORBIDDEN");
  const profile=getInstalledSqliteAuthorizer(database)?.profile;
  assert(profile===undefined || profile==="worker_or_repository","RSS_AUTO_SUPERVISOR_CONNECTION_REQUIRED");
  if(xPage)assertXPageAdmissionSchema(database);else assertRssAutomaticSchema(database);
  const xAdmission=input.purpose==="x_page_source_admission",xDelivery=input.purpose==="x_page_committed_projection_delivery";
  assert(!(xAdmission||xDelivery) || xPage && input.ownerProcess==="system_supervisor","RSS_AUTO_HANDOFF_PURPOSE_INVALID");
  const projectionSender=["projection_sender","reconciler"].includes(input.ownerProcess) || input.purpose==="committed_projection_delivery" || xDelivery;
  assert(input.purpose!=="committed_projection_delivery" || ["system_supervisor","projection_sender","reconciler"].includes(input.ownerProcess),"RSS_AUTO_HANDOFF_PURPOSE_INVALID");
  assert((xPage || isRssAutomaticSchemaSha256(input.releaseGate.receipt.schemaSha256))
    && sourceRegistrySchemaFingerprint(database)===input.releaseGate.receipt.schemaSha256
    && (projectionSender
      ? ["full_v10","manual_only_fallback_v10"].includes(input.releaseGate.receipt.role)
        && input.releaseGate.capabilities.sameDeliverySender===true && input.releaseGate.allows("delivery_sender")
      : input.releaseGate.receipt.role==="full_v10" && input.releaseGate.capabilities.automaticReview===true
        && input.releaseGate.capabilities.automaticPublish===true
        && input.releaseGate.allows("automatic_review") && input.releaseGate.allows("automatic_publish")),"RSS_AUTO_RELEASE_CLOSED");
  return () => {
    const now=(input.now ?? (()=>new Date()))();
    assert(Number.isFinite(now.getTime()),"RSS_AUTO_CLOCK_INVALID");
    const phase=readPhaseSnapshot(database);
    if(xAdmission)assert(phase.phase==="paused" && phase.globalStopState==="stopped" && phase.emergencyStopState==="clear" && phase.recoveryState==="ready","X_PAGE_ADMISSION_CONTROL_OPEN");
    else {
      if(xPage && !projectionSender)assert(phase.phase==="live","X_PAGE_AUTO_LIVE_REQUIRED");
      const egress=projectionSender ? "projection_private" : input.ownerProcess==="rss_collector" ? "rss_https"
        : xPage && ["system_supervisor","x_page_importer","automatic_reviewer","automatic_publisher"].includes(input.ownerProcess) ? "none" : "model_https";
      assertPhaseAllowsExternal(phase,egress);
    }
    assert(input.releaseGate.allows(projectionSender ? "delivery_sender" : xAdmission || input.ownerProcess==="x_page_importer" || xPage && input.ownerProcess==="system_supervisor" ? "automatic_review" : input.ownerProcess==="rss_collector" ? "collector_network" : input.ownerProcess==="automatic_reviewer" ? "automatic_review" : input.ownerProcess==="automatic_publisher" ? "automatic_publish" : "model_network"),"RSS_AUTO_RELEASE_CLOSED");
    const control=database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get()!;
    const point=database.prepare(`SELECT p.recovery_point_at,p.completed_at FROM valid_backup_recovery_point_v1 p
      JOIN internal_operation op ON op.operation_id=p.operation_id AND op.owner_process='backup_worker' AND op.operation_kind='backup' AND op.state='succeeded'
      AND op.capability_class='backup' AND op.egress_class='backup_private'
      AND op.expected_schema_sha256=p.database_schema_sha256 AND op.expected_release_sha256=p.release_sha256
      AND op.expected_manifest_sha256=p.deployment_manifest_sha256 AND op.expected_writer_epoch=p.writer_epoch AND op.recovery_epoch=p.recovery_epoch
      JOIN owner_authorization_handoff handoff ON handoff.handoff_id=op.authorization_handoff_id AND handoff.owner_process='backup_worker'
      AND handoff.consumed_by_operation_id=op.operation_id AND handoff.release_sha256=p.release_sha256 AND handoff.manifest_sha256=p.deployment_manifest_sha256
      WHERE p.database_schema_sha256=? AND p.release_sha256=? AND p.deployment_manifest_sha256=? AND p.writer_epoch=? AND p.recovery_epoch=?
      AND p.writer_authority_receipt_sha256=? ORDER BY p.recovery_point_at DESC LIMIT 1`).get(
        input.releaseGate.receipt.schemaSha256,input.expectedBackupReleaseSha256,input.expectedDeploymentManifestSha256,
        control.writer_epoch,control.recovery_epoch,control.writer_authority_receipt_sha256);
    assert(point!==undefined,"RSS_AUTO_BACKUP_REQUIRED");
    const pointAt=Date.parse(String(point.recovery_point_at)),completedAt=Date.parse(String(point.completed_at));
    assert(Number.isFinite(pointAt)&&Number.isFinite(completedAt)&&pointAt<=now.getTime()&&completedAt<=now.getTime()
      && now.getTime()-pointAt<=900_000,"RSS_AUTO_BACKUP_STALE");
    const core=Object.freeze({schemaVersion:"owner-supervisor-handoff-v1" as const,handoffId:`${xDelivery?"x-page-delivery-supervisor":input.purpose==="committed_projection_delivery" && input.ownerProcess==="system_supervisor"?"rss-delivery-supervisor":xPage?"x-page-auto-handoff":"rss-auto-handoff"}-${randomBytes(24).toString("hex")}`,
      ownerProcess:input.ownerProcess,issuer:"f1plus1-owner-supervisor-v1" as const,oneTimeNonce:randomBytes(32).toString("base64url"),
      releaseSha256:input.releaseGate.receipt.sourcePreimageSha256,manifestSha256:input.releaseGate.receipt.manifestSha256,
      verifiedAt:now.toISOString(),expiresAt:new Date(now.getTime()+RSS_AUTOMATIC_HANDOFF_TTL_MS).toISOString()});
    const handoff=Object.freeze({...core,receiptSha256:createHash("sha256").update(canonicalJsonV1(core)).digest("hex")});
    persistOwnerSupervisorHandoff(database,handoff,candidate=>candidate===handoff);
    return handoff;
  };
}
