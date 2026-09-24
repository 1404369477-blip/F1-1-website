import { createPublicKey, verify } from "node:crypto";
import { join } from "node:path";
import { getBackupReadContext } from "./database.ts";
import { canonicalJson, hash, integer, readBoundedRegularFile, record, requireValue, sha256, timestamp } from "./readonly.ts";
import type { BackupReason, BackupSample, BackupSampleConfig, DatabaseSample, SiteStatus } from "./types.ts";

const OFFHOST_FIELDS = ["schemaVersion", "observerRef", "readStartedAt", "readCompletedAt", "packageId", "recoveryPointAt", "contentHash", "keyId", "manifestSha256", "ciphertextSha256", "ciphertextBytes"];
const APPLICATION_FIELDS = ["packageId", "contentHash", "manifestSha256", "databaseSnapshotSha256", "restoreRootSha256", "releaseSha256", "deploymentManifestSha256", "schemaSha256", "projectionGeneration", "projectionManifestSha256", "schemaVersion", "bootable", "businessPointVerified", "incidentDeclaredAt", "adminAvailableAt", "publicAvailableAt", "completedAt", "elapsedMs", "adminResponseSha256", "publicResponseSha256", "adminRuntimeSha256", "publicRuntimeSha256"];
const MAX_MANIFEST_MEMBERS = 20_000;
const MEMBER_PATH = /^(?:db\/snapshot\.sqlite|projection\/active\.json|projection\/generations\/[a-f0-9]{64}\.json)$/;

function exactKeys(value: Record<string, unknown>, fields: readonly string[]): void {
  requireValue(canonicalJson(Object.keys(value).sort()) === canonicalJson([...fields].sort()));
}

function signedPayload(receipt: unknown, pem: Buffer, domain: string, fields: readonly string[]): Record<string, unknown> {
  const envelope = record(receipt);
  exactKeys(envelope, ["payload", "signature"]);
  const payload = record(envelope.payload);
  exactKeys(payload, fields);
  requireValue(typeof envelope.signature === "string" && /^[A-Za-z0-9_-]{86}$/.test(envelope.signature));
  const key = createPublicKey(pem);
  requireValue(key.asymmetricKeyType === "ed25519"
    && verify(null, Buffer.from(`${domain}\n${canonicalJson(payload)}`), key, Buffer.from(envelope.signature, "base64url")));
  return payload;
}

function identity(payload: Record<string, unknown>, expected: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(expected)) requireValue(payload[field] === value);
}

function readJson(path: string, maxBytes = 64 * 1024): { value: unknown; raw: Buffer } {
  const raw = readBoundedRegularFile(path, maxBytes);
  return { value: JSON.parse(raw.toString("utf8")), raw };
}

/**
 * Revalidates the current legal registration, package manifest, pinned signatures and their
 * registration hashes. It neither rereads the off-host ciphertext nor reexecutes a restore.
 * A previously valid signature remains authentic after its point expires; freshness is reported
 * independently so stale evidence never gets relabelled as a signature failure.
 */
export function inspectBackup(config: BackupSampleConfig, database: DatabaseSample, now = new Date()): BackupSample {
  const nowMs = now.getTime(), observedAt = Number.isFinite(nowMs) ? now.toISOString() : new Date().toISOString();
  const reasons: BackupReason[] = [];
  let status: SiteStatus = "healthy";
  let manifestVerified: boolean | null = null, offHostSignatureVerified: boolean | null = null, applicationSignatureVerified: boolean | null = null;
  let offHostReadCompletedAt: string | null = null, applicationDrillCompletedAt: string | null = null;
  const result = (): BackupSample => ({ status, observedAt, reasons: [...new Set(reasons)], databaseObservedAt: database.observedAt,
    point: database.backupPoint && Number.isFinite(nowMs) ? { ...database.backupPoint, ageMs: nowMs - Date.parse(database.backupPoint.recoveryPointAt) } : null,
    maxRecoveryPointAgeMs: 900000, manifestVerified, offHostSignatureVerified, applicationSignatureVerified,
    offHostReadCompletedAt, applicationDrillCompletedAt, verificationScope: "registered-point-and-pinned-signed-receipts",
    offHostCiphertextReread: false, restoreExecuted: false });
  const fail = (reason: BackupReason, severity: "failed" | "unknown" = "failed") => {
    reasons.push(reason);
    if (status !== "failed") status = severity;
  };
  if (!Number.isFinite(nowMs)) { fail("BACKUP_TIME_INVALID", "unknown"); return result(); }
  if (!database.identity) { fail("BACKUP_DATABASE_UNKNOWN", "unknown"); return result(); }
  if (!database.backupPoint) { fail("BACKUP_POINT_MISSING"); return result(); }
  const point = database.backupPoint;
  const pointAt = Date.parse(point.recoveryPointAt), completedAt = Date.parse(point.completedAt);
  if (!Number.isFinite(pointAt) || !Number.isFinite(completedAt) || pointAt > nowMs || completedAt > nowMs || completedAt < pointAt) fail("BACKUP_TIME_INVALID");
  if (nowMs - pointAt > 900_000) fail("BACKUP_POINT_STALE");
  const sampledAt = Date.parse(database.observedAt);
  if (!Number.isFinite(sampledAt) || sampledAt > nowMs || nowMs - sampledAt > 60_000) {
    fail("BACKUP_DATABASE_SAMPLE_STALE", "unknown"); return result();
  }
  const context = getBackupReadContext(database);
  if (!context) { fail("BACKUP_DATABASE_UNKNOWN", "unknown"); return result(); }
  const row = context.point;
  let stage: BackupReason = "BACKUP_EVIDENCE_INVALID";
  try {
    const packageId = row.backup_set_id;
    requireValue(typeof packageId === "string" && /^[0-9]{13}_[a-f0-9]{16}$/.test(packageId) && sha256(packageId) === point.packageRef);
    stage = "BACKUP_MANIFEST_MISMATCH";
    const manifestFile = readJson(join(config.backupRoot, "snap", "packages", packageId, "manifest.json"), 4 * 1024 * 1024);
    const manifest = record(manifestFile.value);
    exactKeys(manifest, ["schemaVersion", "kind", "keyId", "recovery_point_at", "contentHash", "userVersion", "sqliteMasterSha256", "members"]);
    requireValue(manifest.schemaVersion === "backup-snapshot-manifest-v1" && manifest.kind === "db-projection-snapshot"
      && typeof manifest.keyId === "string" && /^[a-f0-9]{16}$/.test(manifest.keyId)
      && manifest.keyId === row.encryption_key_version && manifest.recovery_point_at === point.recoveryPointAt
      && manifest.userVersion === context.userVersion && manifest.sqliteMasterSha256 === context.sqliteMasterSha256
      && sha256(manifestFile.raw) === point.manifestSha256 && Array.isArray(manifest.members)
      && manifest.members.length >= 3 && manifest.members.length <= MAX_MANIFEST_MEMBERS);
    const members = manifest.members.map(value => {
      const member = record(value); exactKeys(member, ["relativePath", "bytes", "sha256"]);
      requireValue(typeof member.relativePath === "string" && MEMBER_PATH.test(member.relativePath));
      const bytes = integer(member.bytes);
      requireValue(bytes <= 0xffff_ffff); // Each producer archive member has an unsigned 32-bit byte length.
      return { relativePath: member.relativePath, bytes, sha256: hash(member.sha256) };
    });
    const byPath = new Map(members.map(member => [member.relativePath, member]));
    requireValue(byPath.size === members.length && byPath.has("db/snapshot.sqlite") && byPath.has("projection/active.json")
      && point.projectionManifestSha256 !== null && byPath.has(`projection/generations/${point.projectionManifestSha256}.json`)
      && byPath.get("db/snapshot.sqlite")?.sha256 === point.databaseSnapshotSha256
      && byPath.get("projection/active.json")?.sha256 === hash(row.projection_pointer_sha256));
    const contentHash = hash(manifest.contentHash);
    requireValue(contentHash === sha256(canonicalJson(members)) && packageId === `${pointAt}_${contentHash.slice(0, 16)}`
      && row.file_manifest_sha256 === sha256(`f1plus1-snap-file-manifest-v1\n${canonicalJson(members)}`)
      && row.total_bytes === members.reduce((sum, member) => sum + member.bytes, 0));
    manifestVerified = true;

    stage = "BACKUP_KEY_MISMATCH";
    const offHostKey = readBoundedRegularFile(config.offHostPublicKeyPath, 8 * 1024);
    const applicationKey = readBoundedRegularFile(config.applicationDrillPublicKeyPath, 8 * 1024);
    requireValue(sha256(offHostKey) === hash(config.expectedOffHostPublicKeySha256)
      && sha256(applicationKey) === hash(config.expectedApplicationDrillPublicKeySha256));

    stage = "BACKUP_OFFHOST_SIGNATURE_INVALID";
    const offHostFile = readJson(join(config.backupRoot, "off-host-receipts", `${packageId}.json`));
    const offHost = signedPayload(offHostFile.value, offHostKey, "f1plus1-off-host-read-v1", OFFHOST_FIELDS);
    identity(offHost, { schemaVersion: "f1plus1-off-host-read-v1", observerRef: "m5-backup-verifier-v1", packageId,
      recoveryPointAt: point.recoveryPointAt, contentHash, keyId: manifest.keyId, manifestSha256: point.manifestSha256 });
    hash(offHost.ciphertextSha256); integer(offHost.ciphertextBytes, 29);
    const readStartedAt = Date.parse(timestamp(offHost.readStartedAt));
    const readCompletedAt = timestamp(offHost.readCompletedAt);
    requireValue(readStartedAt >= pointAt && Date.parse(readCompletedAt) >= readStartedAt && Date.parse(readCompletedAt) <= nowMs + 30_000);
    const offHostReceiptHash = sha256(canonicalJson(offHostFile.value));
    stage = "BACKUP_RECEIPT_BINDING_MISMATCH";
    requireValue(offHostReceiptHash === hash(row.remote_receipt_sha256));
    offHostSignatureVerified = true; offHostReadCompletedAt = readCompletedAt;

    stage = "BACKUP_APPLICATION_SIGNATURE_INVALID";
    const applicationFile = readJson(join(config.backupStateRoot, "application-receipts", `${packageId}.json`));
    const application = signedPayload(applicationFile.value, applicationKey, "f1plus1-application-drill-v1", APPLICATION_FIELDS);
    identity(application, { schemaVersion: "f1plus1-application-drill-v1", packageId, contentHash,
      manifestSha256: point.manifestSha256, databaseSnapshotSha256: point.databaseSnapshotSha256,
      releaseSha256: point.releaseSha256, deploymentManifestSha256: point.deploymentManifestSha256, schemaSha256: point.schemaSha256,
      projectionGeneration: point.projectionGeneration, projectionManifestSha256: point.projectionManifestSha256,
      bootable: true, businessPointVerified: true, incidentDeclaredAt: row.incident_declared_at,
      adminAvailableAt: row.admin_available_at, publicAvailableAt: row.public_available_at });
    for (const field of APPLICATION_FIELDS.filter(field => field.endsWith("Sha256") || field === "contentHash")) hash(application[field]);
    integer(application.projectionGeneration, 1);
    const incidentAt = Date.parse(timestamp(application.incidentDeclaredAt));
    const adminAt = Date.parse(timestamp(application.adminAvailableAt));
    const publicAt = Date.parse(timestamp(application.publicAvailableAt));
    const applicationCompleted = timestamp(application.completedAt), applicationCompletedMs = Date.parse(applicationCompleted);
    requireValue(typeof application.elapsedMs === "number" && Number.isFinite(application.elapsedMs)
      && application.elapsedMs >= 0 && application.elapsedMs <= 14_400_000 && incidentAt >= pointAt && adminAt >= incidentAt
      && publicAt >= incidentAt && applicationCompletedMs >= Math.max(adminAt, publicAt)
      && application.elapsedMs >= applicationCompletedMs - incidentAt && applicationCompletedMs <= nowMs + 30_000
      && applicationCompletedMs <= completedAt && application.elapsedMs <= integer(row.restore_duration_seconds) * 1000);
    stage = "BACKUP_RECEIPT_BINDING_MISMATCH";
    const applicationReceiptHash = sha256(canonicalJson(applicationFile.value));
    const registrationEvidence = sha256(`f1plus1-backup-registration-evidence-v2\n${canonicalJson({
      applicationDrillReceiptSha256: applicationReceiptHash, offHostReceiptSha256: offHostReceiptHash, backupManifestSha256: point.manifestSha256
    })}`);
    requireValue(registrationEvidence === hash(row.registration_evidence_sha256));
    applicationSignatureVerified = true; applicationDrillCompletedAt = applicationCompleted;
  } catch (error) {
    if (stage === "BACKUP_MANIFEST_MISMATCH") manifestVerified = false;
    if (stage === "BACKUP_OFFHOST_SIGNATURE_INVALID") offHostSignatureVerified = false;
    if (stage === "BACKUP_APPLICATION_SIGNATURE_INVALID") applicationSignatureVerified = false;
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "ENOENT") fail("BACKUP_EVIDENCE_MISSING");
    else if (code === "EACCES" || code === "EPERM" || code === "EIO") fail("BACKUP_EVIDENCE_INVALID", "unknown");
    else fail(stage);
  }
  return result();
}
