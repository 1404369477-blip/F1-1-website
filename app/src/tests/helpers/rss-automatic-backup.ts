// Isolated seed data only. These rows exercise admission against stored backup
// evidence; they are not a backup producer, validator, or deployment receipt.
import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { RSS_AUTOMATIC_SCHEMA_SHA256 } from "../../server/rss-automatic/schema-identity.ts";
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
export function withRssSyntheticSeed(database: DatabaseSync, callback: () => void): void {
  const triggers = database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all() as Array<{ name: string; sql: string }>;
  for (const row of triggers) database.exec(`DROP TRIGGER "${row.name.replaceAll('"', '""')}"`);
  try { callback(); } finally { for (const row of triggers) database.exec(row.sql); }
}
function insert(database: DatabaseSync, table: string, row: Record<string, SQLInputValue>): void {
  const names = Object.keys(row);
  database.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...Object.values(row));
}
export function seedRssAutomaticBackup(database: DatabaseSync, input: Readonly<{
  releaseSha256: string; manifestSha256: string; nowIso: string; id?: string;
  schemaSha256?: string; operationOverrides?: Record<string, SQLInputValue>; backupOverrides?: Record<string, SQLInputValue>;
}>): Readonly<{ operationId: string; recoveryPointId: string; handoffId: string }> {
  const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get()!;
  const id = input.id ?? "rss-synthetic-backup";
  const operationId = `${id}-operation`, recoveryPointId = `${id}-point`, handoffId = `${id}-handoff`;
  const schema = input.schemaSha256 ?? RSS_AUTOMATIC_SCHEMA_SHA256;
  const at = input.nowIso;
  withRssSyntheticSeed(database, () => {
    insert(database, "owner_authorization_handoff", { handoff_id: handoffId, owner_process: "backup_worker", issuer: "f1plus1-owner-supervisor-v1",
      one_time_nonce: createHash("sha256").update(handoffId).digest("base64url"), release_sha256: input.releaseSha256, manifest_sha256: input.manifestSha256,
      receipt_sha256: hash(handoffId), verified_at: at, expires_at: new Date(Date.parse(at) + 60_000).toISOString(), consumed_by_operation_id: operationId });
    insert(database, "internal_operation", { operation_id: operationId, idempotency_key: operationId, operation_kind: "backup", owner_process: "backup_worker",
      capability_class: "backup", policy_id: `p-backup-${control.phase}`, authorization_handoff_id: handoffId, control_action: null, state: "succeeded", version: 3,
      candidate_id: null, source_id: null, publication_id: null, public_id: null, phase: control.phase, attempt: 0, budget_reservation_id: `${id}-reservation`, egress_class: "backup_private", model_route_ref: null,
      expected_schema_sha256: schema, expected_release_sha256: input.releaseSha256, expected_manifest_sha256: input.manifestSha256,
      source_config_epoch: control.source_config_epoch, source_safety_epoch: control.source_safety_epoch, authorization_version: control.authorization_version,
      policy_epoch: control.policy_epoch, recovery_epoch: control.recovery_epoch, source_stop_epoch: null, global_stop_state: control.global_stop_state,
      emergency_stop_state: control.emergency_stop_state, recovery_state: control.recovery_state, deletion_fence_state: control.deletion_fence_state, publication_fence_state: control.publication_fence_state,
      request_hash: hash(`${id}-request`), request_fingerprint: hash(`${id}-fingerprint`), expected_control_version: control.version, expected_entity_version: null,
      expected_entity_hash: hash(`${id}-entity`), entity_set_json: "[]", entity_set_hash: hash("[]"), required_fence_set_json: "[]", required_fence_set_hash: hash("[]"),
      expected_writer_epoch: control.writer_epoch, result_hash: hash(`${id}-result`), reason_code: "SYNTHETIC_BACKUP", created_at: at, updated_at: at, ...input.operationOverrides });
    insert(database, "backup_recovery_point", { recovery_point_id: recoveryPointId, backup_set_id: `${id}-set`, backup_manifest_sha256: hash(`${id}-manifest`),
      database_snapshot_sha256: hash(`${id}-snapshot`), database_schema_sha256: schema, sqlite_snapshot_method: "online_backup_api", source_db_wal_shm_identity_sha256: hash(`${id}-wal-shm`),
      file_manifest_sha256: hash(`${id}-files`), total_bytes: 1024, release_sha256: input.releaseSha256, deployment_manifest_sha256: input.manifestSha256,
      projection_generation: 0, projection_manifest_sha256: null, projection_pointer_sha256: null, writer_epoch: control.writer_epoch, recovery_epoch: control.recovery_epoch,
      writer_authority_receipt_sha256: control.writer_authority_receipt_sha256, common_checkpoint_sha256: hash(`${id}-checkpoint`), recovery_point_at: at, completed_at: at,
      rpo_seconds: 0, off_host_verified: 1, remote_receipt_sha256: hash(`${id}-off-host`), encrypted: 1, encryption_key_version: "synthetic-key", retention_policy_id: "synthetic-retention",
      restore_drill_state: "verified", restore_duration_seconds: 1, drill_isolated: 1, drill_decryption_verified: 1, drill_hash_verified: 1, drill_integrity_verified: 1,
      drill_fk_verified: 1, drill_schema_verified: 1, drill_bootable: 1, drill_business_point_verified: 1, drill_public_pointer_verified: 1,
      incident_declared_at: at, admin_available_at: at, public_available_at: at, operation_id: operationId, ...input.backupOverrides });
  });
  return { operationId, recoveryPointId, handoffId };
}
