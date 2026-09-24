import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, realpathSync, renameSync, rmdirSync, writeFileSync,
  type Stats
} from "node:fs";
import { join, resolve } from "node:path";

const HASH = /^[a-f0-9]{64}$/u;
const MAX_BYTES = 4096;
const MAX_EVIDENCE_AGE_MS = 300_000;

export class LockRecoveryError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "LockRecoveryError"; this.code = code; }
}

export type LockInspection = Readonly<{
  status: "absent" | "live" | "dead";
  backupRootSha256: string;
  lockSha256: string | null;
  pid: number | null;
  startedAt: string | null;
}>;

type FileImage = { bytes: Buffer; stat: Stats; sha256: string };

function reject(code: string): never { throw new LockRecoveryError(code); }
function digest(bytes: string | Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function privateDirectory(path: string): string {
  const root = resolve(path);
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root ||
    stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) reject("BACKUP_ROOT_INVALID");
  return root;
}

function readPrivateFile(path: string): FileImage {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
    before.uid !== process.getuid?.() || (before.mode & 0o077) !== 0 || before.size > MAX_BYTES) reject("LOCK_FILE_INVALID");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!sameFile(before, fstatSync(fd))) reject("LOCK_CHANGED");
    const bytes = readFileSync(fd);
    if (bytes.length > MAX_BYTES || !sameFile(before, fstatSync(fd)) || !sameFile(before, lstatSync(path))) reject("LOCK_CHANGED");
    return { bytes, stat: before, sha256: digest(bytes) };
  } finally { closeSync(fd); }
}

function object(image: FileImage): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(image.bytes.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) reject("LOCK_INVALID");
    return parsed as Record<string, unknown>;
  } catch { return reject("LOCK_INVALID"); }
}

function iso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}

function parseLock(image: FileImage): { pid: number; startedAt: string } {
  const value = object(image);
  if (Object.keys(value).sort().join(",") !== "pid,startedAt" || !Number.isSafeInteger(value.pid) ||
    Number(value.pid) <= 0 || Number(value.pid) > 2_147_483_647 || !iso(value.startedAt)) reject("LOCK_INVALID");
  return { pid: Number(value.pid), startedAt: value.startedAt as string };
}

function pidState(pid: number): "live" | "dead" {
  try { process.kill(pid, 0); return "live"; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return "dead";
    return reject("PID_STATE_UNVERIFIED");
  }
}

function flushDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeEvidence(path: string, bytes: Buffer | string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}

export function inspectBackupLock(backupRoot: string): LockInspection {
  const root = privateDirectory(backupRoot);
  const backupRootSha256 = digest(root);
  let image: FileImage;
  try { image = readPrivateFile(join(root, "run.lock")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent", backupRootSha256, lockSha256: null, pid: null, startedAt: null };
    throw error;
  }
  const lock = parseLock(image);
  return { status: pidState(lock.pid), backupRootSha256, lockSha256: image.sha256, ...lock };
}

/**
 * This command relies on externally verified scheduler AND manual-writer
 * quiescence. The unchanged backup writer does not honor our recovery guard.
 * Node has no portable compare-inode-and-rename syscall; identity rechecks do
 * not protect against an uncooperative writer racing the final rename. An
 * ESRCH result is a point-in-time observation, not proof against PID reuse.
 */
export function recoverBackupLock(input: Readonly<{
  backupRoot: string;
  expectedLockSha256: string;
  expectedPid: number;
  stopEvidencePath: string;
  expectedStopEvidenceSha256: string;
}>): Readonly<{ status: "quarantined"; incidentDirectory: string; lockSha256: string; pid: number; stopEvidenceSha256: string }> {
  if (!HASH.test(input.expectedLockSha256) || !HASH.test(input.expectedStopEvidenceSha256) ||
    !Number.isSafeInteger(input.expectedPid) || input.expectedPid <= 0) reject("RECOVERY_ARGUMENT_INVALID");
  const root = privateDirectory(input.backupRoot);
  const rootIdentity = lstatSync(root);
  const lockPath = join(root, "run.lock");
  const guardPath = join(root, ".lock-recovery.guard");
  try { mkdirSync(guardPath, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") reject("RECOVERY_BUSY"); throw error; }
  const guardIdentity = lstatSync(guardPath);
  try {
    const lockImage = readPrivateFile(lockPath);
    const lock = parseLock(lockImage);
    if (lockImage.sha256 !== input.expectedLockSha256 || lock.pid !== input.expectedPid) reject("LOCK_IDENTITY_MISMATCH");
    if (pidState(lock.pid) !== "dead") reject("LOCK_HELD");
    const evidenceImage = readPrivateFile(resolve(input.stopEvidencePath));
    if (evidenceImage.sha256 !== input.expectedStopEvidenceSha256) reject("STOP_EVIDENCE_HASH_MISMATCH");
    const evidence = object(evidenceImage);
    if (evidence.schemaVersion !== "backup-lock-stop-evidence-v1" || evidence.backupRootSha256 !== digest(root) ||
      evidence.lockSha256 !== lockImage.sha256 || evidence.pid !== lock.pid ||
      evidence.schedulerStopped !== true || evidence.manualWritersStopped !== true ||
      !iso(evidence.observedAt) || typeof evidence.evidenceRef !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(evidence.evidenceRef)) reject("STOP_EVIDENCE_INVALID");
    const age = Date.now() - Date.parse(evidence.observedAt as string);
    if (age < 0 || age > MAX_EVIDENCE_AGE_MS) reject("STOP_EVIDENCE_EXPIRED");

    const incidentPath = mkdtempSync(join(root, "lock-incident-"));
    const incidentDirectory = incidentPath.slice(root.length + 1);
    // Preserve the external attestation before changing the lock pathname.
    writeEvidence(join(incidentPath, "stop-evidence.json"), evidenceImage.bytes);
    const currentRoot = lstatSync(root);
    if (currentRoot.dev !== rootIdentity.dev || currentRoot.ino !== rootIdentity.ino || privateDirectory(root) !== root) reject("BACKUP_ROOT_CHANGED");
    if (pidState(lock.pid) !== "dead") reject("LOCK_HELD");
    const current = readPrivateFile(lockPath);
    if (!sameFile(lockImage.stat, current.stat) || current.sha256 !== lockImage.sha256) reject("LOCK_CHANGED");
    renameSync(lockPath, join(incidentPath, "run.lock"));
    flushDirectory(incidentPath);
    flushDirectory(root);
    const preserved = readPrivateFile(join(incidentPath, "run.lock"));
    if (preserved.stat.dev !== lockImage.stat.dev || preserved.stat.ino !== lockImage.stat.ino || preserved.sha256 !== lockImage.sha256) reject("QUARANTINE_IDENTITY_MISMATCH");
    const receipt = { status: "quarantined" as const, incidentDirectory, lockSha256: lockImage.sha256, pid: lock.pid, stopEvidenceSha256: evidenceImage.sha256 };
    writeEvidence(join(incidentPath, "receipt.json"), `${JSON.stringify({ ...receipt, recoveredAt: new Date().toISOString(), schedulerProof: "external-attestation" })}\n`);
    flushDirectory(incidentPath);
    return receipt;
  } finally {
    // Never remove another recovery's guard or attempt to recover stale guards.
    const current = lstatSync(guardPath);
    if (current.dev === guardIdentity.dev && current.ino === guardIdentity.ino) rmdirSync(guardPath);
  }
}
