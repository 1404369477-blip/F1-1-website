import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeSync,
  existsSync,
  type Stats
} from "node:fs";
import { dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../db/profile.ts";

// Defense boundary (must stay explicit): this fence protects the live SQLite
// file against concurrent writers that respect SQLite locking / POSIX lease
// semantics. A malicious same-UID process that bypasses SQLite (raw file
// writes, unlink+replace, or ignores the O_EXCL lease) is OUT OF SCOPE for this
// slice. Writer launchd/PID proof and wiring every writable wrapper through the
// lease check remain deferred to the B2/CLI slices and are NOT claimed here.
// The write-isolation root of this slice is the SQLite RESERVED lock acquired by
// BEGIN IMMEDIATE on the holder connection.

export const QUIESCE_SCHEMA_VERSION = "f1plus1-admin-quiesce-v3" as const;
// Schema 6 is a deliberately separate acquire entry point.  The existing
// schema-4 API keeps its original receipt identity and behavior; callers that
// intend to promote the current production database must opt into this
// schema-6 contract explicitly.
export const QUIESCE_SCHEMA6_SCHEMA_VERSION = "f1plus1-admin-quiesce-schema6-v1" as const;
export const QUIESCE_SCHEMA6_VERSION = 6 as const;
export const QUIESCE_LEASE_SCHEMA_VERSION = "f1plus1-admin-lease-v1" as const;
export const QUIESCE_CONSUMED_SCHEMA_VERSION = "f1plus1-admin-consumed-v1" as const;
export const QUIESCE_MAX_AGE_MS = 300_000 as const;
export const QUIESCE_BUSY_TIMEOUT_MS = 250 as const;
export const QUIESCE_BEGIN_TIMEOUT_MS = 0 as const;

export type LiveBase = Readonly<{
  path: string;
  pathSha256: string;
  dev: number;
  ino: number;
  nlink: number;
  uid: number;
  mode: number;
  sha256: string;
  userVersion: number;
  dataVersion: number;
  walState: "absent_or_empty" | "present";
}>;

export type QuiescedLive = Readonly<{
  livePath: string;
  livePathSha256: string;
  leasePath: string;
  quiesceId: string;
  tokenSha256: string;
  receiptSha256: string;
  schemaVersion: typeof QUIESCE_SCHEMA_VERSION;
  state: "held";
  issuedAt: string;
  expiresAt: string;
  base: LiveBase;
  backupTo(destination: string): Promise<void>;
  consumeAndRelease(): void;
  abortAndRelease(): void;
}>;

export type QuiescedSchema6 = Readonly<{
  livePath: string;
  livePathSha256: string;
  leasePath: string;
  quiesceId: string;
  tokenSha256: string;
  receiptSha256: string;
  schemaVersion: typeof QUIESCE_SCHEMA6_SCHEMA_VERSION;
  state: "held";
  issuedAt: string;
  expiresAt: string;
  base: LiveBase;
  backupTo(destination: string): Promise<void>;
  consumeAndRelease(): void;
  abortAndRelease(): void;
}>;

export type AnyQuiescedLive = QuiescedLive | QuiescedSchema6;

export type AcquireTestHooks = Readonly<{
  clock?: () => number;
  leasePath?: string;
  busyTimeoutMs?: number;
  checkpointResult?: (livePath: string) => { busy: number; log: number; checkpointed: number };
  afterCheckpoint?: (livePath: string) => void;
  afterLeaseOpen?: (fd: number, leasePath: string) => void;
}>;

type LeaseEntity = Readonly<{ dev: number; ino: number; nlink: number; uid: number; mode: number }>;

export class QuiesceError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = "QuiesceError";
    this.code = code;
  }
}

const quiesceBrand = new WeakSet<object>();

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code: string, message?: string): never {
  throw new QuiesceError(code, message);
}

function assertSameUid(uid: number, code: string): void {
  let current: number | undefined;
  try {
    current = typeof process.getuid === "function" ? process.getuid() : undefined;
  } catch {
    current = undefined;
  }
  if (typeof current !== "number") fail(code, "uid unavailable");
  if (uid !== current) fail(code, `uid=${uid},current=${current}`);
}

function isRegularPrivateFile(identity: Stats, code: string): void {
  if (!identity.isFile() || identity.isSymbolicLink()) fail(code, "not regular file");
  if (identity.nlink !== 1) fail(code, "nlink!=1");
  if ((identity.mode & 0o077) !== 0) fail(code, "not owner-private");
  assertSameUid(identity.uid, code);
}

function userVersion(database: DatabaseSync): number {
  return Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
}

function walState(path: string): "absent_or_empty" | "present" {
  const walPath = `${path}-wal`;
  if (!existsSync(walPath)) return "absent_or_empty";
  return statSync(walPath).size === 0 ? "absent_or_empty" : "present";
}

function assertCanonicalLive(inputPath: string, expectedVersion: 4 | 6): { path: string; pathSha256: string; dev: number; ino: number; nlink: number; uid: number; mode: number } {
  const input = resolve(inputPath);
  const inputLstat = lstatSync(input);
  if (inputLstat.isSymbolicLink()) fail("QUIESCE_LIVE_NOT_REGULAR");
  const absolute = realpathSync(input);
  const lstat = lstatSync(absolute);
  isRegularPrivateFile(lstat, "QUIESCE_LIVE_NOT_REGULAR");
  const database = new DatabaseSync(absolute, { readOnly: true });
  try {
    if (userVersion(database) !== expectedVersion) {
      fail(expectedVersion === 4 ? "QUIESCE_LIVE_NOT_SCHEMA4" : "QUIESCE_LIVE_NOT_SCHEMA6", `user_version=${userVersion(database)}`);
    }
  } finally {
    database.close();
  }
  return {
    path: absolute,
    pathSha256: sha256(absolute),
    dev: lstat.dev,
    ino: lstat.ino,
    nlink: lstat.nlink,
    uid: lstat.uid,
    mode: lstat.mode & 0o7777
  };
}

function collectLiveIdentity(path: string, holder: DatabaseSync): LiveBase {
  const lstat = lstatSync(path);
  if (lstat.isSymbolicLink() || !lstat.isFile()) fail("QUIESCE_LIVE_MUTATED");
  if (lstat.nlink !== 1) fail("QUIESCE_LIVE_MUTATED");
  const uv = Number((holder.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  const dv = Number((holder.prepare("PRAGMA data_version").get() as Record<string, unknown>).data_version);
  const canonical = realpathSync(path);
  return {
    path: canonical,
    pathSha256: sha256(canonical),
    dev: lstat.dev,
    ino: lstat.ino,
    nlink: lstat.nlink,
    uid: lstat.uid,
    mode: lstat.mode & 0o7777,
    sha256: sha256(readFileSync(path)),
    userVersion: uv,
    dataVersion: dv,
    walState: walState(path)
  };
}

function fsyncDir(dirPath: string): void {
  const fd = openSync(dirPath, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function validateLeaseParent(parent: string, liveDev: number): void {
  const resolved = resolve(parent);
  const canonical = realpathSync(resolved);
  if (canonical !== resolved) fail("QUIESCE_LEASE_PARENT_NOT_CANONICAL");
  const st = lstatSync(canonical);
  if (!st.isDirectory() || st.isSymbolicLink()) fail("QUIESCE_LEASE_PARENT_INVALID");
  if ((st.mode & 0o077) !== 0) fail("QUIESCE_LEASE_PARENT_NOT_PRIVATE");
  assertSameUid(st.uid, "QUIESCE_LEASE_PARENT_NOT_PRIVATE");
  if (st.dev !== liveDev) fail("QUIESCE_LEASE_PARENT_DIFFERENT_VOLUME");
}

function validateLeaseEntity(fd: number): LeaseEntity {
  const st = fstatSync(fd);
  if (!st.isFile()) fail("QUIESCE_LEASE_NOT_REGULAR");
  if (st.nlink !== 1) fail("QUIESCE_LEASE_MULTILINK");
  if ((st.mode & 0o7777) !== 0o600) fail("QUIESCE_LEASE_BAD_MODE", `mode=${st.mode & 0o7777}`);
  assertSameUid(st.uid, "QUIESCE_LEASE_NOT_OWNER");
  return Object.freeze({ dev: st.dev, ino: st.ino, nlink: st.nlink, uid: st.uid, mode: st.mode & 0o7777 });
}

function validateDestinationParent(parent: string, liveDev: number): void {
  const resolved = resolve(parent);
  const canonical = realpathSync(resolved);
  if (canonical !== resolved) fail("QUIESCE_DEST_PARENT_NOT_CANONICAL");
  const st = lstatSync(canonical);
  if (!st.isDirectory() || st.isSymbolicLink()) fail("QUIESCE_DEST_PARENT_INVALID");
  if ((st.mode & 0o077) !== 0) fail("QUIESCE_DEST_PARENT_NOT_PRIVATE");
  assertSameUid(st.uid, "QUIESCE_DEST_PARENT_NOT_PRIVATE");
  if (st.dev !== liveDev) fail("QUIESCE_DEST_DIFFERENT_VOLUME");
}

function lstatExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertDestinationWritten(dest: string, liveDev: number): void {
  const st = lstatSync(dest);
  if (!st.isFile() || st.isSymbolicLink()) fail("QUIESCE_DEST_NOT_REGULAR");
  if (st.nlink !== 1) fail("QUIESCE_DEST_MULTILINK");
  if ((st.mode & 0o077) !== 0) fail("QUIESCE_DEST_NOT_PRIVATE");
  assertSameUid(st.uid, "QUIESCE_DEST_NOT_PRIVATE");
  if (st.dev !== liveDev) fail("QUIESCE_DEST_DIFFERENT_VOLUME");
}

function openLeaseExclusive(leasePath: string): number {
  if (typeof constants.O_NOFOLLOW !== "number") fail("QUIESCE_NOFOLLOW_UNSUPPORTED");
  const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW;
  try {
    return openSync(leasePath, flags, 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") fail("QUIESCE_LEASE_EXISTS", leasePath);
    throw new QuiesceError("QUIESCE_LEASE_OPEN_FAILED", `${leasePath}: ${(error as Error).message}`);
  }
}

function writeAll(fd: number, value: string): void {
  const buffer = Buffer.from(value, "utf8");
  let offset = 0;
  while (offset < buffer.length) {
    const written = writeSync(fd, buffer, offset, buffer.length - offset, offset);
    if (written <= 0) fail("QUIESCE_LEASE_WRITE_FAILED");
    offset += written;
  }
}

function runCheckpoint(livePath: string, override?: (livePath: string) => { busy: number; log: number; checkpointed: number }): { busy: number; log: number; checkpointed: number } {
  if (override) return override(livePath);
  const database = new DatabaseSync(livePath);
  try {
    database.exec(`PRAGMA busy_timeout=${QUIESCE_BUSY_TIMEOUT_MS}`);
    const row = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as Record<string, unknown>;
    return { busy: Number(row.busy), log: Number(row.log), checkpointed: Number(row.checkpointed) };
  } finally {
    database.close();
  }
}

function writeConsumedSidecar(path: string, record: Record<string, unknown>): void {
  try {
    const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      writeAll(fd, canonicalJson(record));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") fail("QUIESCE_ALREADY_CONSUMED", path);
    throw error;
  }
  fsyncDir(dirname(path));
}

type MutableHandle = {
  leaseFd: number;
  holder: DatabaseSync;
  leaseEntity: LeaseEntity;
  leasePath: string;
  base: LiveBase;
  tokenSha256: string;
  leaseReceiptSha256: string;
  quiesceId: string;
  receiptSha256: string;
  issuedAt: string;
  expiresAt: string;
  nowFn: () => number;
  backupDone: boolean;
  promotionBackupDone: boolean;
  released: boolean;
  schemaVersion: typeof QUIESCE_SCHEMA_VERSION | typeof QUIESCE_SCHEMA6_SCHEMA_VERSION;
};

const quiesceStates = new WeakMap<object, MutableHandle>();

function verifyLeaseForBackup(state: MutableHandle): void {
  if (state.leaseFd < 0) fail("QUIESCE_LEASE_CLOSED");
  let fdStat: ReturnType<typeof fstatSync>;
  try {
    fdStat = fstatSync(state.leaseFd);
  } catch {
    fail("QUIESCE_LEASE_CLOSED");
  }
  const fdEntity = { dev: fdStat.dev, ino: fdStat.ino, nlink: fdStat.nlink, uid: fdStat.uid, mode: fdStat.mode & 0o7777 };
  if (
    fdEntity.dev !== state.leaseEntity.dev ||
    fdEntity.ino !== state.leaseEntity.ino ||
    fdEntity.nlink !== state.leaseEntity.nlink ||
    fdEntity.uid !== state.leaseEntity.uid ||
    fdEntity.mode !== state.leaseEntity.mode
  ) {
    fail("QUIESCE_LEASE_MUTATED", "lease fd identity drifted");
  }
  const pathStat = lstatSync(state.leasePath);
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) fail("QUIESCE_LEASE_MUTATED", "lease path not regular file");
  if (
    pathStat.dev !== state.leaseEntity.dev ||
    pathStat.ino !== state.leaseEntity.ino ||
    pathStat.nlink !== state.leaseEntity.nlink ||
    pathStat.uid !== state.leaseEntity.uid ||
    (pathStat.mode & 0o7777) !== state.leaseEntity.mode
  ) {
    fail("QUIESCE_LEASE_MUTATED", "lease path replaced");
  }
  const bytes = readFileSync(state.leasePath);
  if (sha256(bytes) !== state.leaseReceiptSha256) fail("QUIESCE_LEASE_MUTATED", "lease content changed");
  const parsed = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  if (parsed.tokenSha256 !== state.tokenSha256) fail("QUIESCE_LEASE_MUTATED", "lease token hash changed");
}

function assertFresh(state: MutableHandle): void {
  const now = state.nowFn();
  if (now < Date.parse(state.issuedAt)) fail("QUIESCE_STALE", "clock before issuance");
  if (now > Date.parse(state.expiresAt)) fail("QUIESCE_EXPIRED");
}

function releaseLocks(state: MutableHandle): void {
  if (state.holder) {
    try {
      state.holder.exec("ROLLBACK");
    } catch {
      // already rolled back
    }
    try {
      state.holder.close();
    } catch {
      // already closed
    }
    state.holder = null as unknown as DatabaseSync;
  }
  if (state.leaseFd >= 0) {
    try {
      closeSync(state.leaseFd);
    } catch {
      // already closed
    }
    state.leaseFd = -1;
  }
}

function unlinkLeaseIfMatch(state: MutableHandle): void {
  let current;
  try {
    current = lstatSync(state.leasePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (current.isSymbolicLink() || !current.isFile()) fail("QUIESCE_LEASE_MUTATED", "lease path replaced or symlink");
  if (
    current.dev !== state.leaseEntity.dev ||
    current.ino !== state.leaseEntity.ino ||
    current.nlink !== state.leaseEntity.nlink ||
    current.uid !== state.leaseEntity.uid ||
    (current.mode & 0o7777) !== state.leaseEntity.mode
  ) {
    fail("QUIESCE_LEASE_MUTATED", "lease path replaced");
  }
  unlinkSync(state.leasePath);
  fsyncDir(dirname(state.leasePath));
}

async function backupSnapshot(state: MutableHandle, destination: string, purpose: "stage" | "promotion"): Promise<void> {
  if (state.released) fail("QUIESCE_HANDLE_RELEASED");
  if (purpose === "stage" && state.backupDone) fail("QUIESCE_BACKUP_REPLAY");
  if (purpose === "promotion") {
    if (!state.backupDone) fail("QUIESCE_PROMOTION_BEFORE_STAGE");
    if (state.promotionBackupDone) fail("QUIESCE_PROMOTION_BACKUP_REPLAY");
  }
  verifyLeaseForBackup(state);
  assertFresh(state);
  const dest = resolve(destination);
  validateDestinationParent(dirname(dest), state.base.dev);
  if (lstatExists(dest)) fail("QUIESCE_DEST_EXISTS", dest);
  const source = new DatabaseSync(state.base.path, { readOnly: true });
  try {
    await backup(source, dest);
  } finally {
    source.close();
  }
  // The SQLite backup may have run past expiresAt; re-check after writing.
  assertFresh(state);
  chmodSync(dest, 0o600);
  assertDestinationWritten(dest, state.base.dev);
  const current = collectLiveIdentity(state.base.path, state.holder);
  if (current.dev !== state.base.dev || current.ino !== state.base.ino || current.nlink !== state.base.nlink ||
      current.uid !== state.base.uid || current.mode !== state.base.mode || current.path !== state.base.path ||
      current.sha256 !== state.base.sha256 || current.userVersion !== state.base.userVersion ||
      current.dataVersion !== state.base.dataVersion || current.walState !== state.base.walState) {
    fail("QUIESCE_LIVE_MUTATED");
  }
  verifyLeaseForBackup(state);
  if (purpose === "stage") state.backupDone = true;
  else state.promotionBackupDone = true;
}

function createHandle(state: MutableHandle): AnyQuiescedLive {
  const handle: AnyQuiescedLive = Object.freeze({
    livePath: state.base.path,
    livePathSha256: state.base.pathSha256,
    leasePath: state.leasePath,
    quiesceId: state.quiesceId,
    tokenSha256: state.tokenSha256,
    receiptSha256: state.receiptSha256,
    schemaVersion: state.schemaVersion,
    state: "held",
    issuedAt: state.issuedAt,
    expiresAt: state.expiresAt,
    base: Object.freeze({ ...state.base }) as LiveBase,
    async backupTo(destination: string): Promise<void> {
      await backupSnapshot(state, destination, "stage");
    },
    consumeAndRelease(): void {
      if (state.released) fail("QUIESCE_HANDLE_RELEASED");
      if (!state.backupDone) fail("QUIESCE_CONSUME_BEFORE_BACKUP");
      assertFresh(state);
      const consumedPath = `${state.leasePath}.${state.quiesceId}.consumed`;
      // Persist the consumed receipt while the SQLite lock and lease are still
      // held. Any failure here (including an expired handle) must NOT mark
      // released, release the lock, write the sidecar, or delete the lease; the
      // caller may retry or abort.
      writeConsumedSidecar(consumedPath, {
        schemaVersion: QUIESCE_CONSUMED_SCHEMA_VERSION,
        state: "consumed",
        quiesceId: state.quiesceId,
        receiptSha256: state.receiptSha256,
        consumedAt: new Date(state.nowFn()).toISOString()
      });
      state.released = true;
      releaseLocks(state);
      unlinkLeaseIfMatch(state);
    },
    abortAndRelease(): void {
      if (state.released) return;
      state.released = true;
      releaseLocks(state);
      try {
        unlinkLeaseIfMatch(state);
      } catch (error) {
        if ((error as QuiesceError).code === "QUIESCE_LEASE_MUTATED") {
          // Do not delete another actor's replacement; surface the safe error.
          throw error;
        }
        throw error;
      }
    }
  });
  quiesceBrand.add(handle);
  quiesceStates.set(handle, state);
  return handle;
}

export function isQuiescedLive(value: unknown): value is AnyQuiescedLive {
  return typeof value === "object" && value !== null && quiesceBrand.has(value);
}

/**
 * Save a second, independently checked snapshot of the held schema-6 live DB
 * for the pre-rename rollback path.  It is intentionally a function instead
 * of a field on QuiescedLive so old forged/test-shaped receipt objects remain
 * source-compatible; only an actually branded, still-held handle can use it.
 */
export async function backupQuiescedLiveForPromotion(handle: AnyQuiescedLive, destination: string): Promise<void> {
  if (!isQuiescedLive(handle)) fail("QUIESCE_HANDLE_INVALID");
  const state = quiesceStates.get(handle);
  if (!state) fail("QUIESCE_HANDLE_INVALID");
  if (state.base.userVersion !== QUIESCE_SCHEMA6_VERSION || state.schemaVersion !== QUIESCE_SCHEMA6_SCHEMA_VERSION) {
    fail("QUIESCE_PROMOTION_SCHEMA6_REQUIRED");
  }
  await backupSnapshot(state, destination, "promotion");
}

function openLeaseSafe(leasePath: string, afterOpen?: (fd: number, leasePath: string) => void): { fd: number; entity: LeaseEntity } {
  const fd = openLeaseExclusive(leasePath);
  let fdStat: ReturnType<typeof fstatSync>;
  try {
    fdStat = fstatSync(fd);
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
    throw error;
  }
  try {
    afterOpen?.(fd, leasePath);
    fchmodSync(fd, 0o600);
    const entity = validateLeaseEntity(fd);
    return { fd, entity };
  } catch (error) {
    // Any post-creation failure must not leak the fd or leave our lease file.
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
    try {
      const current = lstatSync(leasePath);
      if (current.isFile() && !current.isSymbolicLink() && current.dev === fdStat.dev && current.ino === fdStat.ino) {
        unlinkSync(leasePath);
        fsyncDir(dirname(leasePath));
      }
    } catch {
      // never mask the primary error; never delete a replacement path
    }
    throw error;
  }
}

function acquireInternal(livePath: string, hooks: AcquireTestHooks, expectedVersion: 4 | 6): AnyQuiescedLive {
  const nowFn = hooks.clock ?? (() => Date.now());
  const live = assertCanonicalLive(livePath, expectedVersion);
  const leasePath = resolve(hooks.leasePath ?? `${live.path}.quiesce`);
  validateLeaseParent(dirname(leasePath), live.dev);
  const { fd: leaseFd, entity: leaseEntity } = openLeaseSafe(leasePath, hooks.afterLeaseOpen);

  let holder: DatabaseSync | null = null;
  try {
    const now = nowFn();
    const token = randomBytes(32);
    const tokenSha256 = sha256(token);
    const quiesceId = randomBytes(16).toString("hex");
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + QUIESCE_MAX_AGE_MS).toISOString();
    const leaseRecord = {
      schemaVersion: QUIESCE_LEASE_SCHEMA_VERSION,
      state: "held",
      quiesceId,
      livePathSha256: live.pathSha256,
      tokenSha256,
      issuedAt,
      expiresAt
    };
    const leaseJson = canonicalJson(leaseRecord);
    writeAll(leaseFd, leaseJson);
    fsyncSync(leaseFd);
    const leaseReceiptSha256 = sha256(Buffer.from(leaseJson, "utf8"));

    let checkpoint = runCheckpoint(live.path, hooks.checkpointResult);
    if (checkpoint.busy !== 0) fail("QUIESCE_CHECKPOINT_BUSY", `busy=${checkpoint.busy}`);
    if (checkpoint.log > 0) {
      checkpoint = runCheckpoint(live.path, hooks.checkpointResult);
      if (checkpoint.busy !== 0) fail("QUIESCE_CHECKPOINT_BUSY", `busy=${checkpoint.busy}`);
      if (checkpoint.log > 0) fail("QUIESCE_CHECKPOINT_FRAMES", `log=${checkpoint.log}`);
    }
    if (walState(live.path) !== "absent_or_empty") fail("QUIESCE_WAL_STATE", "wal not empty after truncate");

    hooks.afterCheckpoint?.(live.path);

    holder = new DatabaseSync(live.path);
    holder.exec(`PRAGMA busy_timeout=${hooks.busyTimeoutMs ?? QUIESCE_BEGIN_TIMEOUT_MS}`);
    try {
      holder.exec("BEGIN IMMEDIATE");
    } catch (error) {
      try {
        holder.close();
      } catch {
        // already closed
      }
      holder = null;
      fail("QUIESCE_WRITER_BUSY", `BEGIN IMMEDIATE failed: ${(error as Error).message}`);
    }

    const base = collectLiveIdentity(live.path, holder);
    if (
      base.dev !== live.dev || base.ino !== live.ino || base.nlink !== live.nlink ||
      base.uid !== live.uid || base.mode !== live.mode || base.path !== live.path
    ) {
      fail("QUIESCE_LIVE_MUTATED");
    }
    if (base.userVersion !== expectedVersion) {
      fail(expectedVersion === 4 ? "QUIESCE_LIVE_NOT_SCHEMA4" : "QUIESCE_LIVE_NOT_SCHEMA6", `user_version=${base.userVersion}`);
    }

    const receipt = {
      schemaVersion: QUIESCE_SCHEMA_VERSION,
      state: "held",
      quiesceId,
      tokenSha256,
      livePathSha256: base.pathSha256,
      live: { dev: base.dev, ino: base.ino, nlink: base.nlink, uid: base.uid, mode: base.mode },
      liveSha256: base.sha256,
      userVersion: base.userVersion,
      dataVersion: base.dataVersion,
      walState: base.walState,
      lease: { pathSha256: sha256(leasePath), dev: leaseEntity.dev, ino: leaseEntity.ino, nlink: leaseEntity.nlink, uid: leaseEntity.uid, mode: leaseEntity.mode },
      leaseReceiptSha256,
      issuedAt,
      expiresAt
    };
    const receiptSha256 = sha256(canonicalJson(receipt));

    return createHandle({
      leaseFd,
      holder,
      leaseEntity,
      leasePath,
      base,
      tokenSha256,
      leaseReceiptSha256,
      quiesceId,
      receiptSha256,
      issuedAt,
      expiresAt,
      nowFn,
      backupDone: false,
      promotionBackupDone: false,
      released: false,
      schemaVersion: expectedVersion === 4 ? QUIESCE_SCHEMA_VERSION : QUIESCE_SCHEMA6_SCHEMA_VERSION
    });
  } catch (error) {
    if (holder) {
      try {
        holder.exec("ROLLBACK");
      } catch {
        // no transaction
      }
      try {
        holder.close();
      } catch {
        // already closed
      }
    }
    try {
      closeSync(leaseFd);
    } catch {
      // already closed
    }
    // We own the lease; best-effort remove it if still ours. Never mask the primary error.
    try {
      const current = lstatSync(leasePath);
      if (current.isFile() && !current.isSymbolicLink() && current.dev === leaseEntity.dev && current.ino === leaseEntity.ino &&
          current.nlink === leaseEntity.nlink && current.uid === leaseEntity.uid && (current.mode & 0o7777) === leaseEntity.mode) {
        unlinkSync(leasePath);
        fsyncDir(dirname(leasePath));
      }
    } catch {
      // best-effort only
    }
    throw error;
  }
}

export function acquireQuiescedLive(livePath: string): QuiescedLive;
export function acquireQuiescedLive(livePath: string, expectedSchema: 4): QuiescedLive;
export function acquireQuiescedLive(livePath: string, expectedSchema: 6): QuiescedSchema6;
export function acquireQuiescedLive(livePath: string, expectedSchema: 4 | 6 = 4): AnyQuiescedLive {
  return acquireInternal(livePath, {}, expectedSchema);
}

export function acquireQuiescedLiveForTest(livePath: string, hooks: AcquireTestHooks): QuiescedLive {
  if (process.env.NODE_ENV !== "test") throw new QuiesceError("TEST_HOOKS_FORBIDDEN");
  return acquireInternal(livePath, hooks, 4) as QuiescedLive;
}

/** Acquire the current schema-6 production DB under the same strict fence. */
export function acquireQuiescedSchema6(livePath: string): QuiescedSchema6 {
  return acquireInternal(livePath, {}, 6) as QuiescedSchema6;
}

export function acquireQuiescedSchema6ForTest(livePath: string, hooks: AcquireTestHooks): QuiescedSchema6 {
  if (process.env.NODE_ENV !== "test") throw new QuiesceError("TEST_HOOKS_FORBIDDEN");
  return acquireInternal(livePath, hooks, 6) as QuiescedSchema6;
}

export { assertQuiesceLeaseAbsent, QuiesceAbsenceError } from "./quiesce-absence-guard.ts";
export type { QuiesceAbsenceGuard } from "./quiesce-absence-guard.ts";
