import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeSync, type Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const FIELDS = ["dev", "ino", "mode", "nlink", "uid", "size", "mtimeMs", "ctimeMs"] as const;
export type PrivateFile = Readonly<{ text: string; identity: string; revisionInput: string; modifiedAt: string }>;

function identity(stat: Stats): string { return FIELDS.map(field => stat[field]).join(":"); }
function parentIdentity(path: string): string {
  const parent = dirname(path);
  const stat = lstatSync(parent);
  if (resolve(path) !== path || realpathSync(parent) !== parent || !stat.isDirectory() || stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error("PRIVATE_FILE_UNSAFE");
  return `${stat.dev}:${stat.ino}:${stat.uid}:${stat.mode}`;
}

/** Bounded descriptor read shared by the Admin and worker; never follows a key link. */
export function readPrivateFile(path: string, maxBytes: number): PrivateFile | null {
  const parent = parentIdentity(path);
  let descriptor: number | undefined;
  try {
    let initial: Stats;
    try { initial = lstatSync(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1 || initial.uid !== process.getuid?.() ||
      (initial.mode & 0o077) !== 0 || initial.size < 0 || initial.size > maxBytes || typeof constants.O_NOFOLLOW !== "number") throw new Error("PRIVATE_FILE_UNSAFE");
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(descriptor);
    if (!before.isFile() || identity(before) !== identity(initial)) throw new Error("PRIVATE_FILE_CHANGED");
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const size = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (size === 0) break;
      length += size;
    }
    if (length !== before.size || identity(before) !== identity(fstatSync(descriptor)) ||
      identity(before) !== identity(lstatSync(path)) || parent !== parentIdentity(path)) throw new Error("PRIVATE_FILE_CHANGED");
    const content = bytes.subarray(0, length);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    return Object.freeze({ text, identity: identity(before),
      revisionInput: `${before.dev}:${before.ino}:${before.mtimeMs}:${createHash("sha256").update(content).digest("hex")}`,
      modifiedAt: new Date(before.mtimeMs).toISOString() });
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

export class PrivateFileCommitError extends Error {
  constructor(readonly committed: boolean) { super(committed ? "CREDENTIAL_COMMIT_UNKNOWN" : "CREDENTIAL_SAVE_FAILED"); }
}

/** The caller holds the provider lock and rechecks authorization immediately before this synchronous CAS. */
export function atomicWritePrivateFile(path: string, text: string, expectedIdentity: string | null, maxBytes: number): void {
  const parent = parentIdentity(path);
  if (Buffer.byteLength(text) < 1 || Buffer.byteLength(text) > maxBytes) throw new PrivateFileCommitError(false);
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(16).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  let committed = false;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const bytes = Buffer.from(text, "utf8");
    let position = 0;
    while (position < bytes.length) position += writeSync(descriptor, bytes, position, bytes.length - position);
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    if (parent !== parentIdentity(path) || (readPrivateFile(path, maxBytes)?.identity ?? null) !== expectedIdentity) throw new Error("PRIVATE_FILE_CHANGED");
    renameSync(temporary, path); committed = true;
    descriptor = openSync(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
    fsyncSync(descriptor);
  } catch { throw new PrivateFileCommitError(committed); }
  finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (!committed) { try { unlinkSync(temporary); } catch { /* only this call's uncommitted temporary */ } }
  }
}

/** A short cross-process writer lock; no network or await may run inside. */
export function withPrivateFileLock<T>(path: string, action: () => T): T {
  const parent = parentIdentity(path);
  let descriptor: number;
  try { descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { throw new Error("CREDENTIAL_BUSY"); }
  const held = fstatSync(descriptor);
  try {
    if (parent !== parentIdentity(path)) throw new Error("PRIVATE_FILE_CHANGED");
    return action();
  } finally {
    closeSync(descriptor);
    try {
      const current = lstatSync(path);
      if (current.dev === held.dev && current.ino === held.ino && parent === parentIdentity(path)) unlinkSync(path);
    } catch { /* A cleanup failure cannot turn a completed atomic write into a claimed rollback. A retained lock blocks later writers. */ }
  }
}
