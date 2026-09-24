import { createHash, createPublicKey } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { backupLayout, canonicalJson, objectFileName, packageIdFor, parseManifest, runRestoreDrill, verifyRestoredTree, type BackupReport, type LatestPointer } from "../backup-snapshot/core.ts";
import { verifyOffHostReceipt } from "../backup-snapshot/off-host-receipt.ts";
import { reviewRealSchemaFingerprint } from "../review-real/migration.ts";
import { ProjectionReceiptSchema, verifySignedProjectionPackage } from "../review-real/projection.ts";

function assert(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
function sha(value: Buffer | string): string { return createHash("sha256").update(value).digest("hex"); }

/** Reject symlinks along the complete path and detect replacement while reading. */
export function readBackupRegularFile(path: string): Buffer {
  const absolute = resolve(path);
  for (let parent = absolute; parent !== dirname(parent); parent = dirname(parent)) {
    assert(!lstatSync(parent).isSymbolicLink(), "BACKUP_SYMLINK_FORBIDDEN");
  }
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    assert(before.isFile() && before.nlink === 1, "BACKUP_MEMBER_NOT_REGULAR");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    const current = lstatSync(absolute);
    assert(before.dev === current.dev && before.ino === current.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && bytes.length === before.size, "BACKUP_FILE_CHANGED");
    return bytes;
  } finally { closeSync(fd); }
}

export function readSnapLatestAndManifest(backupRoot: string) {
  const layout = backupLayout(backupRoot);
  const latest = JSON.parse(readBackupRegularFile(layout.latestPath).toString("utf8")) as LatestPointer;
  assert(latest.schemaVersion === "backup-snapshot-latest-v1" && latest.kind === "db-projection-snapshot" && /^[0-9]{13}_[0-9a-f]{16}$/.test(latest.packageId), "SNAP_LATEST_SCHEMA_INVALID");
  const packageDir = join(layout.packagesDir, latest.packageId);
  const manifestRaw = readBackupRegularFile(join(packageDir, "manifest.json"));
  const manifest = parseManifest(manifestRaw.toString("utf8"));
  assert(latest.packageId === packageIdFor(manifest.recovery_point_at, manifest.contentHash), "SNAP_PACKAGE_ID_MISMATCH");
  assert(manifest.contentHash === latest.contentHash && manifest.keyId === latest.keyId, "SNAP_LATEST_MANIFEST_MISMATCH");
  assert(manifest.recovery_point_at === latest.recovery_point_at, "SNAP_RECOVERY_POINT_MISMATCH");
  return Object.freeze({ latest, manifest, manifestSha256: sha(manifestRaw), packageDir });
}

function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(sep));
}

export function verifyBackupPackageBinding(input: Readonly<{
  database: DatabaseSync; backupRoot: string; restoreRoot: string; drillReport: BackupReport;
  snapshotKey: Buffer; projectionSigningKeyId: string; projectionPublicKeyPem: string;
  offHostReceipt: unknown; offHostPublicKeyPem: string; now: Date;
}>) {
  const snap = readSnapLatestAndManifest(input.backupRoot);
  const report = input.drillReport;
  assert(typeof report.elapsedMs === "number" && Number.isFinite(report.elapsedMs) && report.elapsedMs >= 0, "DRILL_DURATION_UNVERIFIED");
  assert(report.elapsedMs <= 14_400_000, "RTO_EXCEEDED");
  assert(report.ok && (report.code === "RESTORE_OK" || report.code === "RESTORE_VERIFY_OK"), "DRILL_NOT_VERIFIED");
  for (const [left, right] of [[report.packageId, snap.latest.packageId], [report.contentHash, snap.manifest.contentHash], [report.keyId, snap.manifest.keyId], [report.recoveryPointAt, snap.manifest.recovery_point_at]]) assert(left === right, "DRILL_PACKAGE_IDENTITY_MISMATCH");
  const root = realpathSync(input.restoreRoot);
  const backupRoot = realpathSync(input.backupRoot);
  assert(!contained(backupRoot, root) && !contained(root, backupRoot), "DRILL_NOT_ISOLATED");
  const liveFile = (input.database.prepare("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")?.file;
  assert(liveFile && !contained(root, realpathSync(liveFile)), "DRILL_SOURCE_NOT_ISOLATED");
  const memberPaths = new Set<string>();
  for (const member of snap.manifest.members) {
    assert(!memberPaths.has(member.relativePath), "BACKUP_DUPLICATE_MEMBER");
    memberPaths.add(member.relativePath);
    const bytes = readBackupRegularFile(join(root, member.relativePath));
    assert(bytes.length === member.bytes && sha(bytes) === member.sha256, "BACKUP_RESTORED_MEMBER_MISMATCH");
  }
  // Separate bilingual pointers require their own DB/publication boundary contract.
  // The current deployed projection has only active.json; never silently attest a new pointer kind.
  assert(!memberPaths.has("projection/bilingual-active.json"), "BACKUP_BILINGUAL_BOUNDARY_UNSUPPORTED");
  function walk(path: string): void {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else assert(entry.isFile() && memberPaths.has(relative(root, full)), "BACKUP_UNEXPECTED_RESTORED_MEMBER");
    }
  }
  walk(root);
  const checks = verifyRestoredTree(root, snap.manifest, 10);
  assert(canonicalJson(report.checks) === canonicalJson(checks), "DRILL_CHECKS_MISMATCH");
  if (snap.manifest.xArtifacts) {
    assert(report.xArtifactRebinding && sha(canonicalJson(report.xArtifactRebinding)) === checks.x_artifact_rebinding_proposal_sha256
      && checks.x_artifact_manifest_sha256 === snap.manifest.xArtifacts.manifestSha256
      && checks.x_artifact_database_sha256 === snap.manifest.xArtifacts.databaseSha256, "DRILL_X_ARTIFACT_PROOF_MISMATCH");
  }
  const objectPath = join(backupLayout(backupRoot).objectsDir, objectFileName(snap.manifest.kind, snap.manifest.contentHash, snap.manifest.keyId));
  const ciphertext = readBackupRegularFile(objectPath);
  const offHost = verifyOffHostReceipt({ receipt: input.offHostReceipt, publicKeyPem: input.offHostPublicKeyPem, expected: {
    packageId: snap.latest.packageId, recoveryPointAt: snap.manifest.recovery_point_at,
    contentHash: snap.manifest.contentHash, keyId: snap.manifest.keyId, manifestSha256: snap.manifestSha256,
    ciphertextSha256: sha(ciphertext), ciphertextBytes: ciphertext.length
  }, now: input.now });
  // Re-decrypt this exact ciphertext. A caller-provided success report cannot authorize registration.
  const verifyRoot = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-register-verify-"));
  let measuredMs: number;
  try {
    const verified = runRestoreDrill({ backupRoot, restoreRoot: verifyRoot, packageId: snap.latest.packageId, key: input.snapshotKey, expectedUserVersion: 10 });
    assert(verified.ok && verified.contentHash === snap.manifest.contentHash, "BACKUP_DECRYPTION_UNVERIFIED");
    measuredMs = verified.elapsedMs!;
    assert(sha(readBackupRegularFile(objectPath)) === sha(ciphertext), "BACKUP_CIPHERTEXT_CHANGED");
  } finally { rmSync(verifyRoot, { recursive: true }); }
  assert(measuredMs <= 14_400_000, "RTO_EXCEEDED");
  const activeRaw = readBackupRegularFile(join(root, "projection/active.json"));
  const active = JSON.parse(activeRaw.toString("utf8")) as { schemaVersion?: string; snapshotGeneration?: number; snapshotManifestHash?: string; activatedAt?: string };
  assert(active.schemaVersion === "projection-active-pointer-v1" && Number.isSafeInteger(active.snapshotGeneration) && active.snapshotGeneration! >= 1 && /^[0-9a-f]{64}$/.test(active.snapshotManifestHash!), "PROJECTION_POINTER_INVALID");
  const generation = JSON.parse(readBackupRegularFile(join(root, "projection/generations", `${active.snapshotManifestHash}.json`)).toString("utf8")) as { schemaVersion?: string; package?: unknown; activatedAt?: string; receivedAt?: string };
  assert(generation.schemaVersion === "projection-committed-generation-v1" && generation.activatedAt === active.activatedAt, "PROJECTION_GENERATION_ENVELOPE_MISMATCH");
  const signed = verifySignedProjectionPackage(generation.package, { signingKeyId: input.projectionSigningKeyId, publicKey: createPublicKey(input.projectionPublicKeyPem) });
  assert(signed.taskEnvelope.snapshot.snapshotGeneration === active.snapshotGeneration && signed.taskEnvelope.snapshot.snapshotManifestHash === active.snapshotManifestHash, "PROJECTION_GENERATION_ENVELOPE_MISMATCH");
  const database = new DatabaseSync(join(root, "db/snapshot.sqlite"), { readOnly: true });
  try {
    database.exec("PRAGMA query_only=ON");
    const control = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown> | undefined;
    assert(control, "BACKUP_CONTROL_MISSING");
    const outbox = database.prepare("SELECT * FROM projection_outbox WHERE delivery_id=? AND snapshot_generation=? AND snapshot_manifest_hash=? AND status='succeeded'").get(signed.taskEnvelope.deliveryId, active.snapshotGeneration!, active.snapshotManifestHash!) as Record<string, unknown> | undefined;
    const receiptRow = database.prepare("SELECT * FROM projection_delivery_receipt WHERE delivery_id=?").get(signed.taskEnvelope.deliveryId) as Record<string, unknown> | undefined;
    assert(outbox && receiptRow, "BACKUP_PROJECTION_DELIVERY_MISSING");
    assert(outbox.task_envelope_hash === signed.taskEnvelopeHash && outbox.task_envelope_json === canonicalJson(signed.taskEnvelope), "BACKUP_PROJECTION_OUTBOX_MISMATCH");
    const receiptJson = String(receiptRow.receipt_json);
    const receipt = ProjectionReceiptSchema.parse(JSON.parse(receiptJson));
    assert(canonicalJson(receipt) === receiptJson && sha(receiptJson) === receiptRow.receipt_hash, "BACKUP_PROJECTION_RECEIPT_HASH_MISMATCH");
    assert(receipt.deliveryId === signed.taskEnvelope.deliveryId && receipt.snapshotGeneration === active.snapshotGeneration && receipt.snapshotManifestHash === active.snapshotManifestHash && receipt.status === "active" && receipt.activeSnapshotGeneration === active.snapshotGeneration && receipt.activeSnapshotManifestHash === active.snapshotManifestHash && receipt.activatedAt === generation.activatedAt && receipt.receivedAt === generation.receivedAt, "BACKUP_PROJECTION_RECEIPT_MISMATCH");
    const schemaSha256 = reviewRealSchemaFingerprint(database);
    const dbMember = snap.manifest.members.find(member => member.relativePath === "db/snapshot.sqlite")!;
    assert(sha(readBackupRegularFile(join(root, "db/snapshot.sqlite"))) === dbMember.sha256, "BACKUP_RESTORED_DB_CHANGED");
    assert(readSnapLatestAndManifest(backupRoot).manifestSha256 === snap.manifestSha256, "BACKUP_MANIFEST_CHANGED");
    return Object.freeze({ snap, control, schemaSha256, checks, remoteReceiptSha256: offHost.receiptSha256,
      durationMs: Math.max(measuredMs, report.elapsedMs), generation: active.snapshotGeneration!,
      projectionManifestSha256: active.snapshotManifestHash!, projectionPointerSha256: sha(activeRaw) });
  } finally { database.close(); }
}
