import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export type QuiesceAbsenceGuard = Readonly<{
  dbPath: string;
  leasePath: string;
  parentPath: string;
  assertAbsent(): void;
}>;

export class QuiesceAbsenceError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = "QuiesceAbsenceError";
    this.code = code;
  }
}

function fail(code: string, message?: string): never {
  throw new QuiesceAbsenceError(code, message);
}

function currentUid(): number {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (typeof uid !== "number") fail("QUIESCE_ABSENCE_UID_UNAVAILABLE");
  return uid;
}

function leaseLstat(path: string): { present: boolean } {
  try {
    lstatSync(path);
    return { present: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { present: false };
    throw new QuiesceAbsenceError("QUIESCE_LEASE_PRESENT", `${path}: ${(error as Error).message}`);
  }
}

function assertCanonicalParent(dbPath: string): { parent: string; identity: { dev: number; ino: number } } {
  if (!isAbsolute(dbPath) || resolve(dbPath) !== dbPath) {
    fail("QUIESCE_ABSENCE_PATH_NOT_ABSOLUTE");
  }
  const parent = dirname(dbPath);
  let canonicalParent: string;
  try {
    canonicalParent = realpathSync(parent);
  } catch {
    fail("QUIESCE_ABSENCE_PARENT_NOT_CANONICAL", "parent does not exist or cannot be canonicalized");
  }
  if (canonicalParent !== parent) fail("QUIESCE_ABSENCE_PARENT_NOT_CANONICAL");
  if (join(canonicalParent, basename(dbPath)) !== dbPath) {
    fail("QUIESCE_ABSENCE_PATH_NOT_CANONICAL", "db path is not canonical parent plus basename");
  }
  const st = lstatSync(parent);
  if (!st.isDirectory() || st.isSymbolicLink()) fail("QUIESCE_ABSENCE_PARENT_NOT_CANONICAL", "parent is not a real directory");
  if ((st.mode & 0o077) !== 0) fail("QUIESCE_ABSENCE_PARENT_NOT_PRIVATE");
  if (st.uid !== currentUid()) fail("QUIESCE_ABSENCE_PARENT_NOT_OWNER");
  return { parent, identity: { dev: st.dev, ino: st.ino } };
}

export function assertQuiesceLeaseAbsent(dbPath: string): QuiesceAbsenceGuard {
  const { parent, identity } = assertCanonicalParent(dbPath);
  const leasePath = `${dbPath}.quiesce`;
  if (leaseLstat(leasePath).present) fail("QUIESCE_LEASE_PRESENT", leasePath);
  return Object.freeze({
    dbPath,
    leasePath,
    parentPath: parent,
    assertAbsent(): void {
      let canonical: string;
      try {
        canonical = realpathSync(parent);
      } catch {
        fail("QUIESCE_ABSENCE_PARENT_NOT_CANONICAL", "parent cannot be canonicalized");
      }
      if (canonical !== parent) fail("QUIESCE_ABSENCE_PARENT_NOT_CANONICAL");
      const current = lstatSync(parent);
      if (current.dev !== identity.dev || current.ino !== identity.ino) fail("QUIESCE_ABSENCE_PARENT_MUTATED");
      if (!current.isDirectory() || current.isSymbolicLink()) fail("QUIESCE_ABSENCE_PARENT_NOT_CANONICAL", "parent is not a real directory");
      if ((current.mode & 0o077) !== 0) fail("QUIESCE_ABSENCE_PARENT_NOT_PRIVATE");
      if (current.uid !== currentUid()) fail("QUIESCE_ABSENCE_PARENT_NOT_OWNER");
      if (leaseLstat(leasePath).present) fail("QUIESCE_LEASE_PRESENT", leasePath);
    }
  });
}
