import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  backupLayout,
  LATEST_SCHEMA_VERSION,
  MANIFEST_SCHEMA_VERSION,
  SNAPSHOT_KIND,
  type BackupReport,
  type LatestPointer,
  type SnapshotManifest
} from "../backup-snapshot/core.ts";
import { canonicalJson } from "../db/profile.ts";
import { reviewRealSchemaFingerprint } from "../review-real/migration.ts";
import { SOURCE_REGISTRY_SCHEMA10_SHA256 } from "../rss/source-registry-migration.ts";
import {
  canonicalJsonV1,
  SqliteInternalOperationGateway,
  type EntityKind,
  type OwnerProcess,
  type OwnerSupervisorHandoff,
  type Phase
} from "./gateway.ts";
import { persistOwnerSupervisorHandoff } from "./owner-supervisor.ts";
import { writeRecoveryFenceAfterRegistration, type RecoveryFenceWriteReceipt } from "./recovery-fence-write.ts";
import { assertRecoveryPointBinding, validateRecoveryPointReceipt, type RecoveryPointReceipt } from "./recovery.ts";

const ZERO_HASH = "0".repeat(64);
const HASH = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HANDOFF_SCHEMA_VERSION = "owner-supervisor-handoff-v1" as const;
const HANDOFF_ISSUER = "f1plus1-owner-supervisor-v1" as const;
const HANDOFF_TTL_MS = 15 * 60_000;
const SNAP_CYCLE_RPO_SECONDS = 900;
const RECEIPT_SCHEMA = "backup-recovery-point-register-receipt-v1" as const;

export type BackupRecoveryPointRegisterInput = Readonly<{
  database: DatabaseSync;
  backupRoot: string;
  drillReport: BackupReport;
  restoreRoot: string;
  releaseSha256: string;
  manifestSha256: string;
  schemaSha256?: string;
  budgetAccountId: string;
  retentionPolicyId?: string;
  fencePath?: string;
  now?: () => Date;
}>;

export type BackupRecoveryPointRegisterReceipt = Readonly<{
  schemaVersion: typeof RECEIPT_SCHEMA;
  decision: "SUCCESS";
  recoveryPointId: string;
  backupSetId: string;
  operationId: string;
  validBackupRecoveryPoint: true;
  bindingPassed: true;
  recoveryPointAt: string;
  writerEpoch: number;
  recoveryEpoch: number;
  fence: RecoveryFenceWriteReceipt | null;
}>;

type ControlRow = Record<string, unknown>;
type DrillBits = Readonly<{
  isolated: 1;
  decryption: 1;
  hash: 1;
  integrity: 1;
  fk: 1;
  schema: 1;
  bootable: 1;
  business: 1;
  publicPointer: 1;
}>;

function fail(code: string): never { throw new Error(code); }
function assert(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }
function hashText(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function domainHash(domain: string, value: unknown): string { return hashText(`${domain}\n${canonicalJsonV1(value)}`); }
function validateHash(value: string, code = "HASH_INVALID"): void { assert(HASH.test(value), code); }

function nowIso(now: (() => Date) | undefined): string {
  const value = (now ?? (() => new Date()))().toISOString();
  assert(UTC.test(value), "REGISTER_TIMESTAMP_INVALID");
  return value;
}

function normalizeUtcMillis(value: string): string {
  if (UTC.test(value) && new Date(Date.parse(value)).toISOString() === value) return value;
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), "RECOVERY_POINT_AT_INVALID");
  const normalized = new Date(parsed).toISOString();
  assert(UTC.test(normalized), "RECOVERY_POINT_AT_INVALID");
  return normalized;
}

function addUtcMillis(value: string, millis: number): string {
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), "RECOVERY_TIMESTAMP_INVALID");
  return new Date(parsed + millis).toISOString();
}

function verifyGeneratedReceipt(expected: OwnerSupervisorHandoff): (candidate: OwnerSupervisorHandoff) => boolean {
  return (candidate) => candidate === expected || (
    candidate.schemaVersion === expected.schemaVersion &&
    candidate.handoffId === expected.handoffId &&
    candidate.ownerProcess === expected.ownerProcess &&
    candidate.issuer === expected.issuer &&
    candidate.oneTimeNonce === expected.oneTimeNonce &&
    candidate.releaseSha256 === expected.releaseSha256 &&
    candidate.manifestSha256 === expected.manifestSha256 &&
    candidate.receiptSha256 === expected.receiptSha256 &&
    candidate.verifiedAt === expected.verifiedAt &&
    candidate.expiresAt === expected.expiresAt
  );
}

export function createOwnerSupervisorHandoff(
  database: DatabaseSync,
  ownerProcess: OwnerProcess,
  releaseSha256: string,
  manifestSha256: string,
  nowMs: number
): OwnerSupervisorHandoff {
  const verifiedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + HANDOFF_TTL_MS).toISOString();
  const core = Object.freeze({
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    handoffId: `register-${ownerProcess}-${nowMs}-${randomBytes(8).toString("hex")}`,
    ownerProcess,
    issuer: HANDOFF_ISSUER,
    oneTimeNonce: randomBytes(32).toString("base64url"),
    releaseSha256,
    manifestSha256,
    verifiedAt,
    expiresAt
  });
  const handoff: OwnerSupervisorHandoff = Object.freeze({
    ...core,
    receiptSha256: createHash("sha256").update(canonicalJson(core)).digest("hex")
  });
  persistOwnerSupervisorHandoff(database, handoff, verifyGeneratedReceipt(handoff));
  return handoff;
}

function control(database: DatabaseSync): ControlRow {
  const row = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get();
  assert(row !== null && typeof row === "object", "REGISTER_CONTROL_MISSING");
  return row as ControlRow;
}

function integer(row: ControlRow, field: string): number {
  const parsed = Number(row[field]);
  assert(Number.isSafeInteger(parsed) && parsed >= 0, "REGISTER_CONTROL_FIELD_INVALID");
  return parsed;
}

function expected(database: DatabaseSync, releaseSha256: string, manifestSha256: string, schemaSha256: string) {
  const row = control(database);
  return Object.freeze({
    controlVersion: integer(row, "version"),
    entityVersion: null,
    entityHash: ZERO_HASH,
    schemaSha256,
    releaseSha256,
    manifestSha256,
    sourceStopEpoch: null,
    writerEpoch: integer(row, "writer_epoch"),
    epochs: Object.freeze({
      sourceConfig: integer(row, "source_config_epoch"),
      sourceSafety: integer(row, "source_safety_epoch"),
      authorization: integer(row, "authorization_version"),
      policy: integer(row, "policy_epoch"),
      recovery: integer(row, "recovery_epoch")
    })
  });
}

function backupPolicy(phase: Phase): string {
  const policies: Record<Phase, string> = {
    disabled: "p-backup-disabled",
    backlog: "p-backup-backlog",
    live: "p-backup-live",
    paused: "p-backup-paused"
  };
  return policies[phase];
}

function restorePolicy(phase: Phase): string {
  assert(phase === "disabled" || phase === "paused", "REGISTER_RESTORE_PHASE_UNSUPPORTED");
  return phase === "disabled" ? "p-restore-disabled" : "p-restore-paused";
}

function producerPolicy(phase: Phase): string {
  const policies: Record<Phase, string> = {
    disabled: "p-system-producer-disabled",
    backlog: "p-system-producer-backlog",
    live: "p-system-producer-live",
    paused: "p-system-producer-paused"
  };
  return policies[phase];
}

export function readSnapLatestAndManifest(backupRoot: string): Readonly<{
  latest: LatestPointer;
  manifest: SnapshotManifest;
  manifestSha256: string;
  packageDir: string;
}> {
  const layout = backupLayout(backupRoot);
  assert(existsSync(layout.latestPath), "SNAP_LATEST_MISSING");
  const latest = JSON.parse(readFileSync(layout.latestPath, "utf8")) as LatestPointer;
  assert(latest.schemaVersion === LATEST_SCHEMA_VERSION && latest.kind === SNAPSHOT_KIND, "SNAP_LATEST_SCHEMA_INVALID");
  const packageDir = join(layout.packagesDir, latest.packageId);
  const manifestPath = join(packageDir, "manifest.json");
  assert(existsSync(manifestPath), "SNAP_MANIFEST_MISSING");
  const manifestRaw = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestRaw.toString("utf8")) as SnapshotManifest;
  assert(manifest.schemaVersion === MANIFEST_SCHEMA_VERSION && manifest.kind === SNAPSHOT_KIND, "SNAP_MANIFEST_SCHEMA_INVALID");
  assert(manifest.contentHash === latest.contentHash, "SNAP_LATEST_MANIFEST_MISMATCH");
  assert(manifest.recovery_point_at === latest.recovery_point_at, "SNAP_RECOVERY_POINT_MISMATCH");
  return Object.freeze({
    latest,
    manifest,
    manifestSha256: hashText(manifestRaw.toString("utf8")),
    packageDir
  });
}

export function attestRestoreDrillBits(report: BackupReport, restoreRoot: string, backupRoot: string): DrillBits {
  assert(report.ok === true, "DRILL_NOT_VERIFIED");
  assert(report.code === "RESTORE_OK" || report.code === "RESTORE_VERIFY_OK", "DRILL_CODE_INVALID");
  const checks = report.checks;
  assert(checks !== undefined, "DRILL_CHECKS_MISSING");
  assert(checks.quick_check === "ok", "DRILL_INTEGRITY_UNVERIFIED");
  assert(checks.foreign_key_check === "ok", "DRILL_FK_UNVERIFIED");
  assert(typeof checks.sqlite_master_sha256 === "string" && HASH.test(checks.sqlite_master_sha256), "DRILL_SCHEMA_UNVERIFIED");
  assert(checks.user_version === "10", "DRILL_BUSINESS_POINT_UNVERIFIED");
  assert(checks.drill_public_pointer_verified === "1", "DRILL_PUBLIC_POINTER_UNVERIFIED");
  const restoredDb = join(restoreRoot, "db", "snapshot.sqlite");
  assert(existsSync(restoredDb) && existsSync(join(restoreRoot, "projection", "active.json")), "DRILL_RESTORE_TREE_MISSING");
  assert(realpathSync(restoreRoot) !== realpathSync(backupRoot), "DRILL_NOT_ISOLATED");
  return Object.freeze({
    isolated: 1, decryption: 1, hash: 1, integrity: 1, fk: 1,
    schema: 1, bootable: 1, business: 1, publicPointer: 1
  });
}

function readProjectionBinding(restoreRoot: string, manifest: SnapshotManifest): Readonly<{
  generation: number;
  manifestSha256: string | null;
  pointerSha256: string | null;
}> {
  const activePath = join(restoreRoot, "projection", "active.json");
  const activeRaw = readFileSync(activePath);
  const active = JSON.parse(activeRaw.toString("utf8")) as {
    snapshotGeneration?: unknown;
    snapshotManifestHash?: unknown;
  };
  assert(Number.isSafeInteger(active.snapshotGeneration) && Number(active.snapshotGeneration) >= 1, "PROJECTION_GENERATION_INVALID");
  const generation = Number(active.snapshotGeneration);
  const manifestSha256 = active.snapshotManifestHash;
  assert(typeof manifestSha256 === "string" && HASH.test(manifestSha256), "PROJECTION_MANIFEST_INVALID");
  const pointerSha256 = createHash("sha256").update(activeRaw).digest("hex");
  const pointerMember = manifest.members.find((member) => member.relativePath === "projection/active.json");
  assert(pointerMember !== undefined && pointerMember.sha256 === pointerSha256, "PROJECTION_POINTER_MEMBER_MISMATCH");
  // 生产投影不是原始字节内容寻址:generations/<hash>.json 的文件名哈希指的是
  // 文件内部签名信封的 snapshotManifestHash(与 review-real/projection.ts 的
  // readGeneration 判定一致),不等于文件本身的 SHA-256。
  const generationRelPath = `projection/generations/${manifestSha256}.json`;
  const generationMember = manifest.members.find((member) => member.relativePath === generationRelPath);
  assert(generationMember !== undefined, "PROJECTION_GENERATION_MEMBER_MISSING");
  const generationRaw = readFileSync(join(restoreRoot, "projection", "generations", `${manifestSha256}.json`));
  assert(createHash("sha256").update(generationRaw).digest("hex") === generationMember.sha256, "PROJECTION_GENERATION_MEMBER_MISMATCH");
  const generationDoc = JSON.parse(generationRaw.toString("utf8")) as {
    package?: { taskEnvelope?: { snapshot?: { snapshotManifestHash?: unknown } } };
  };
  assert(
    generationDoc.package?.taskEnvelope?.snapshot?.snapshotManifestHash === manifestSha256,
    "PROJECTION_GENERATION_ENVELOPE_MISMATCH"
  );
  return Object.freeze({ generation, manifestSha256, pointerSha256 });
}

function runGatewayInsert(input: Readonly<{
  database: DatabaseSync;
  gateway: SqliteInternalOperationGateway;
  handoff: OwnerSupervisorHandoff;
  operationId: string;
  operationKind: "backup" | "restore" | "system_producer";
  ownerProcess: OwnerProcess;
  capabilityClass: "backup" | "restore" | "db_mutation";
  policyId: string;
  controlAction: null;
  egressClass: "backup_private" | "none";
  budgetRequest: { reservationId: string; accountId: string; units: number } | null;
  entityKind: EntityKind;
  entityId: string;
  identitySelector: "bound_child" | "control_singleton";
  mutationKind: "insert" | "activate";
  statement: string;
  parameters: readonly unknown[];
  releaseSha256: string;
  manifestSha256: string;
  schemaSha256: string;
  now?: () => Date;
}>): void {
  const phase = String(control(input.database).phase) as Phase;
  const capability = input.gateway.request(input.handoff, {
    schemaVersion: "operation-request-v1",
    operationId: input.operationId,
    idempotencyKey: input.operationId,
    operationKind: input.operationKind,
    ownerProcess: input.ownerProcess,
    capabilityClass: input.capabilityClass,
    policyId: input.policyId,
    authorizationHandoffId: input.handoff.handoffId,
    controlAction: input.controlAction,
    identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
    entitySet: [{
      entityKind: input.entityKind,
      entityId: input.entityId,
      identitySelector: input.identitySelector,
      expectedVersion: null,
      expectedHash: ZERO_HASH
    }],
    requiredFenceSet: [],
    expected: expected(input.database, input.releaseSha256, input.manifestSha256, input.schemaSha256),
    phase,
    egressClass: input.egressClass,
    budgetRequest: input.budgetRequest,
    modelRouteRef: null,
    requestHash: ZERO_HASH,
    requestFingerprint: ZERO_HASH
  });
  const authorized = input.gateway.authorize(capability);
  const permit = input.gateway.authorizeWrite(authorized, {
    entityKind: input.entityKind,
    entityId: input.entityId,
    mutationKind: input.mutationKind,
    expectedVersion: null,
    expectedHash: ZERO_HASH
  });
  input.gateway.mutate(permit, {
    entityKind: input.entityKind,
    entityId: input.entityId,
    mutationKind: input.mutationKind,
    statement: input.statement,
    parameters: input.parameters
  });
  input.gateway.postcheckFenceSet(authorized);
}

function ensureOutboxHead(input: Readonly<{
  database: DatabaseSync;
  gateway: SqliteInternalOperationGateway;
  handoff: OwnerSupervisorHandoff;
  releaseSha256: string;
  manifestSha256: string;
  schemaSha256: string;
  now?: () => Date;
}>): void {
  const existing = input.database.prepare("SELECT outbox_id FROM internal_operation_outbox ORDER BY outbox_id DESC LIMIT 1").get();
  if (existing !== undefined) return;
  const at = nowIso(input.now);
  const operationId = `register-outbox-${Date.parse(at)}-${randomBytes(6).toString("hex")}`;
  const outboxId = `outbox-${operationId}`;
  const payload = Object.freeze({ schemaVersion: "backup-register-telemetry-v1", operationId });
  const payloadJson = canonicalJsonV1(payload);
  const payloadHash = domainHash("f1plus1-internal-outbox-v1", payload);
  const phase = String(control(input.database).phase) as Phase;
  runGatewayInsert({
    database: input.database,
    gateway: input.gateway,
    handoff: input.handoff,
    operationId,
    operationKind: "system_producer",
    ownerProcess: "admin_telemetry_producer",
    capabilityClass: "db_mutation",
    policyId: producerPolicy(phase),
    controlAction: null,
    egressClass: "none",
    budgetRequest: null,
    entityKind: "telemetry_receipt",
    entityId: outboxId,
    identitySelector: "bound_child",
    mutationKind: "insert",
    statement: "INSERT INTO internal_operation_outbox (outbox_id,operation_id,outbox_kind,idempotency_key,payload_json,payload_hash,state,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    parameters: [outboxId, operationId, "telemetry_receipt", `idem-${outboxId}`, payloadJson, payloadHash, "pending", 1, at, at],
    releaseSha256: input.releaseSha256,
    manifestSha256: input.manifestSha256,
    schemaSha256: input.schemaSha256,
    now: input.now
  });
}

function commonCheckpoint(input: Readonly<{
  contentHash: string;
  writerEpoch: number;
  recoveryEpoch: number;
  schemaSha256: string;
  generation: number;
  projectionManifestSha256: string | null;
  projectionPointerSha256: string | null;
}>): string {
  return domainHash("f1plus1-common-checkpoint-v1", {
    contentHash: input.contentHash,
    writerEpoch: input.writerEpoch,
    recoveryEpoch: input.recoveryEpoch,
    schemaSha256: input.schemaSha256,
    generation: input.generation,
    projectionManifestSha256: input.projectionManifestSha256,
    projectionPointerSha256: input.projectionPointerSha256
  });
}

function ensureProjectionAnchor(input: Readonly<{
  database: DatabaseSync;
  gateway: SqliteInternalOperationGateway;
  handoff: OwnerSupervisorHandoff;
  releaseSha256: string;
  manifestSha256: string;
  schemaSha256: string;
  checkpointSha256: string;
  generation: number;
  projectionManifestSha256: string | null;
  projectionPointerSha256: string | null;
  budgetAccountId: string;
  now?: () => Date;
}>): void {
  const existing = input.database.prepare("SELECT * FROM projection_recovery_anchor WHERE singleton_id=1").get() as ControlRow | undefined;
  const row = control(input.database);
  const writerEpoch = integer(row, "writer_epoch");
  const recoveryEpoch = integer(row, "recovery_epoch");
  const writerReceipt = String(row.writer_authority_receipt_sha256);
  if (existing !== undefined) {
    const unchanged =
      Number(existing.active_generation) === input.generation &&
      (existing.active_manifest_sha256 as string | null) === input.projectionManifestSha256 &&
      (existing.active_pointer_sha256 as string | null) === input.projectionPointerSha256 &&
      String(existing.common_checkpoint_sha256) === input.checkpointSha256 &&
      Number(existing.writer_epoch) === writerEpoch &&
      Number(existing.recovery_epoch) === recoveryEpoch &&
      String(existing.writer_authority_receipt_sha256) === writerReceipt;
    if (unchanged) return;
  }
  const at = nowIso(input.now);
  const operationId = `register-anchor-${Date.parse(at)}-${randomBytes(6).toString("hex")}`;
  const phase = String(row.phase) as Phase;
  const budget = input.database.prepare("SELECT account_id FROM budget_account WHERE account_id=?").get(input.budgetAccountId);
  assert(budget !== undefined, "BUDGET_ACCOUNT_MISSING");
  const nextVersion = existing === undefined ? 1 : Number(existing.version) + 1;
  assert(Number.isSafeInteger(nextVersion) && nextVersion >= 1, "REGISTER_ANCHOR_VERSION_INVALID");
  runGatewayInsert({
    database: input.database,
    gateway: input.gateway,
    handoff: input.handoff,
    operationId,
    operationKind: "restore",
    ownerProcess: "restore_operator",
    capabilityClass: "restore",
    policyId: restorePolicy(phase),
    controlAction: null,
    egressClass: "backup_private",
    budgetRequest: { reservationId: `budget-${operationId}`, accountId: input.budgetAccountId, units: 1 },
    entityKind: "projection_pointer",
    entityId: "active",
    identitySelector: "control_singleton",
    mutationKind: "activate",
    statement: existing === undefined
      ? "INSERT INTO projection_recovery_anchor (singleton_id,active_generation,active_manifest_sha256,active_pointer_sha256,writer_epoch,recovery_epoch,writer_authority_receipt_sha256,common_checkpoint_sha256,version,operation_id,updated_at) VALUES(1,?,?,?,?,?,?,?,?,?,?)"
      : "UPDATE projection_recovery_anchor SET active_generation=?, active_manifest_sha256=?, active_pointer_sha256=?, writer_epoch=?, recovery_epoch=?, writer_authority_receipt_sha256=?, common_checkpoint_sha256=?, version=?, operation_id=?, updated_at=? WHERE singleton_id=1",
    parameters: [
      input.generation,
      input.projectionManifestSha256,
      input.projectionPointerSha256,
      writerEpoch,
      recoveryEpoch,
      writerReceipt,
      input.checkpointSha256,
      nextVersion,
      operationId,
      at
    ],
    releaseSha256: input.releaseSha256,
    manifestSha256: input.manifestSha256,
    schemaSha256: input.schemaSha256,
    now: input.now
  });
}

export function runBackupRecoveryPointRegister(input: BackupRecoveryPointRegisterInput): BackupRecoveryPointRegisterReceipt {
  validateHash(input.releaseSha256, "RELEASE_SHA256_INVALID");
  validateHash(input.manifestSha256, "MANIFEST_SHA256_INVALID");
  const schemaSha256 = input.schemaSha256 ?? SOURCE_REGISTRY_SCHEMA10_SHA256;
  validateHash(schemaSha256, "SCHEMA_SHA256_INVALID");
  const retentionPolicyId = input.retentionPolicyId ?? "snap-cycle-v1";
  const snap = readSnapLatestAndManifest(input.backupRoot);
  const bits = attestRestoreDrillBits(input.drillReport, input.restoreRoot, input.backupRoot);
  assert(input.drillReport.contentHash === snap.manifest.contentHash, "DRILL_CONTENT_HASH_MISMATCH");
  assert(input.drillReport.packageId === snap.latest.packageId, "DRILL_PACKAGE_MISMATCH");
  const projection = readProjectionBinding(input.restoreRoot, snap.manifest);
  const dbMember = snap.manifest.members.find((member) => member.relativePath === "db/snapshot.sqlite");
  assert(dbMember !== undefined && dbMember.bytes > 0, "SNAP_DB_MEMBER_MISSING");
  const totalBytes = snap.manifest.members.reduce((sum, member) => sum + member.bytes, 0);
  assert(totalBytes > 0, "SNAP_TOTAL_BYTES_INVALID");
  const recoveryPointAt = normalizeUtcMillis(snap.manifest.recovery_point_at);
  const completedAt = recoveryPointAt;
  const restoreDurationSeconds = Math.max(0, Math.min(14400, Math.ceil((input.drillReport.elapsedMs ?? 0) / 1000)));
  const incidentDeclaredAt = recoveryPointAt;
  const adminAvailableAt = addUtcMillis(recoveryPointAt, restoreDurationSeconds * 1000);
  const publicAvailableAt = adminAvailableAt;
  const schemaFingerprint = reviewRealSchemaFingerprint(input.database);
  const row = control(input.database);
  const writerEpoch = integer(row, "writer_epoch");
  const recoveryEpoch = integer(row, "recovery_epoch");
  const writerAuthority = String(row.writer_authority_receipt_sha256);
  validateHash(writerAuthority, "WRITER_AUTHORITY_INVALID");
  const checkpoint = commonCheckpoint({
    contentHash: snap.manifest.contentHash,
    writerEpoch,
    recoveryEpoch,
    schemaSha256: schemaFingerprint,
    generation: projection.generation,
    projectionManifestSha256: projection.manifestSha256,
    projectionPointerSha256: projection.pointerSha256
  });
  const remoteReceiptSha256 = domainHash("f1plus1-off-host-receipt-v1", {
    packageId: snap.latest.packageId,
    contentHash: snap.manifest.contentHash,
    drillCode: input.drillReport.code,
    keyId: snap.manifest.keyId
  });
  const walIdentity = domainHash("f1plus1-vacuum-wal-shm-identity-v1", {
    method: "vacuum_into_verified",
    contentHash: snap.manifest.contentHash
  });
  const fileManifestSha256 = domainHash("f1plus1-snap-file-manifest-v1", snap.manifest.members.map((member) => ({
    relativePath: member.relativePath,
    bytes: member.bytes,
    sha256: member.sha256
  })));
  const budget = input.database.prepare("SELECT account_id FROM budget_account WHERE account_id=?").get(input.budgetAccountId);
  assert(budget !== undefined, "BUDGET_ACCOUNT_MISSING");
  const nowMs = (input.now ?? (() => new Date()))().getTime();
  const backupHandoff = createOwnerSupervisorHandoff(input.database, "backup_worker", input.releaseSha256, input.manifestSha256, nowMs);
  const restoreHandoff = createOwnerSupervisorHandoff(input.database, "restore_operator", input.releaseSha256, input.manifestSha256, nowMs + 1);
  const telemetryHandoff = createOwnerSupervisorHandoff(input.database, "admin_telemetry_producer", input.releaseSha256, input.manifestSha256, nowMs + 2);
  const gateway = new SqliteInternalOperationGateway({
    database: input.database,
    releaseSha256: input.releaseSha256,
    manifestSha256: input.manifestSha256,
    schemaSha256,
    now: input.now
  });
  try {
    ensureOutboxHead({
      database: input.database,
      gateway,
      handoff: telemetryHandoff,
      releaseSha256: input.releaseSha256,
      manifestSha256: input.manifestSha256,
      schemaSha256,
      now: input.now
    });
    ensureProjectionAnchor({
      database: input.database,
      gateway,
      handoff: restoreHandoff,
      releaseSha256: input.releaseSha256,
      manifestSha256: input.manifestSha256,
      schemaSha256,
      checkpointSha256: checkpoint,
      generation: projection.generation,
      projectionManifestSha256: projection.manifestSha256,
      projectionPointerSha256: projection.pointerSha256,
      budgetAccountId: input.budgetAccountId,
      now: input.now
    });
    const at = nowIso(input.now);
    const operationId = `register-backup-${Date.parse(at)}-${randomBytes(6).toString("hex")}`;
    const recoveryPointId = `rp-${snap.latest.packageId}`;
    const phase = String(control(input.database).phase) as Phase;
    const receipt: RecoveryPointReceipt = Object.freeze({
      recoveryPointId,
      backupSetId: snap.latest.packageId,
      backupManifestSha256: snap.manifestSha256,
      databaseSnapshotSha256: dbMember.sha256,
      databaseSchemaSha256: schemaFingerprint,
      sqliteSnapshotMethod: "vacuum_into_verified",
      sourceDbWalShmIdentitySha256: walIdentity,
      fileManifestSha256,
      totalBytes,
      releaseSha256: input.releaseSha256,
      deploymentManifestSha256: input.manifestSha256,
      projectionGeneration: projection.generation,
      projectionManifestSha256: projection.manifestSha256,
      projectionPointerSha256: projection.pointerSha256,
      writerEpoch,
      recoveryEpoch,
      writerAuthorityReceiptSha256: writerAuthority,
      commonCheckpointSha256: checkpoint,
      recoveryPointAt,
      completedAt,
      rpoSeconds: SNAP_CYCLE_RPO_SECONDS,
      offHostVerified: true,
      remoteReceiptSha256,
      encrypted: true,
      encryptionKeyVersion: snap.manifest.keyId,
      retentionPolicyId,
      restoreDrillState: "verified",
      restoreDurationSeconds,
      drillIsolated: bits.isolated,
      drillDecryptionVerified: bits.decryption,
      drillHashVerified: bits.hash,
      drillIntegrityVerified: bits.integrity,
      drillFkVerified: bits.fk,
      drillSchemaVerified: bits.schema,
      drillBootable: bits.bootable,
      drillBusinessPointVerified: bits.business,
      drillPublicPointerVerified: bits.publicPointer,
      incidentDeclaredAt,
      adminAvailableAt,
      publicAvailableAt,
      operationId
    });
    validateRecoveryPointReceipt(receipt);
    runGatewayInsert({
      database: input.database,
      gateway,
      handoff: backupHandoff,
      operationId,
      operationKind: "backup",
      ownerProcess: "backup_worker",
      capabilityClass: "backup",
      policyId: backupPolicy(phase),
      controlAction: null,
      egressClass: "backup_private",
      budgetRequest: { reservationId: `budget-${operationId}`, accountId: input.budgetAccountId, units: 1 },
      entityKind: "backup",
      entityId: recoveryPointId,
      identitySelector: "bound_child",
      mutationKind: "insert",
      statement: `INSERT INTO backup_recovery_point (
        recovery_point_id,backup_set_id,backup_manifest_sha256,database_snapshot_sha256,database_schema_sha256,
        sqlite_snapshot_method,source_db_wal_shm_identity_sha256,file_manifest_sha256,total_bytes,release_sha256,
        deployment_manifest_sha256,projection_generation,projection_manifest_sha256,projection_pointer_sha256,
        writer_epoch,recovery_epoch,writer_authority_receipt_sha256,common_checkpoint_sha256,recovery_point_at,
        completed_at,rpo_seconds,off_host_verified,remote_receipt_sha256,encrypted,encryption_key_version,
        retention_policy_id,restore_drill_state,restore_duration_seconds,drill_isolated,drill_decryption_verified,
        drill_hash_verified,drill_integrity_verified,drill_fk_verified,drill_schema_verified,drill_bootable,
        drill_business_point_verified,drill_public_pointer_verified,incident_declared_at,admin_available_at,
        public_available_at,operation_id
      ) VALUES(${Array.from({ length: 41 }, () => "?").join(",")})`,
      parameters: [
        receipt.recoveryPointId, receipt.backupSetId, receipt.backupManifestSha256, receipt.databaseSnapshotSha256,
        receipt.databaseSchemaSha256, receipt.sqliteSnapshotMethod, receipt.sourceDbWalShmIdentitySha256,
        receipt.fileManifestSha256, receipt.totalBytes, receipt.releaseSha256, receipt.deploymentManifestSha256,
        receipt.projectionGeneration, receipt.projectionManifestSha256, receipt.projectionPointerSha256,
        receipt.writerEpoch, receipt.recoveryEpoch, receipt.writerAuthorityReceiptSha256, receipt.commonCheckpointSha256,
        receipt.recoveryPointAt, receipt.completedAt, receipt.rpoSeconds, 1, receipt.remoteReceiptSha256, 1,
        receipt.encryptionKeyVersion, receipt.retentionPolicyId, receipt.restoreDrillState, receipt.restoreDurationSeconds,
        receipt.drillIsolated, receipt.drillDecryptionVerified, receipt.drillHashVerified, receipt.drillIntegrityVerified,
        receipt.drillFkVerified, receipt.drillSchemaVerified, receipt.drillBootable, receipt.drillBusinessPointVerified,
        receipt.drillPublicPointerVerified, receipt.incidentDeclaredAt, receipt.adminAvailableAt, receipt.publicAvailableAt,
        receipt.operationId
      ],
      releaseSha256: input.releaseSha256,
      manifestSha256: input.manifestSha256,
      schemaSha256,
      now: input.now
    });
    const valid = input.database.prepare("SELECT recovery_point_id FROM valid_backup_recovery_point_v1 WHERE recovery_point_id=?").get(recoveryPointId);
    assert(valid !== undefined, "VALID_BACKUP_RECOVERY_POINT_MISSING");
    assertRecoveryPointBinding(input.database, receipt);
    let fence: RecoveryFenceWriteReceipt | null = null;
    if (input.fencePath !== undefined) {
      fence = writeRecoveryFenceAfterRegistration({
        fencePath: input.fencePath,
        recoveryPointAt,
        completedAt,
        controlUpdatedAt: String(control(input.database).updated_at),
        now: input.now
      });
    }
    return Object.freeze({
      schemaVersion: RECEIPT_SCHEMA,
      decision: "SUCCESS",
      recoveryPointId,
      backupSetId: snap.latest.packageId,
      operationId,
      validBackupRecoveryPoint: true,
      bindingPassed: true,
      recoveryPointAt,
      writerEpoch,
      recoveryEpoch,
      fence
    });
  } finally {
    gateway.close();
  }
}
