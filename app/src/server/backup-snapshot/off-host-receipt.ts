import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalJson, objectFileName, packageIdFor, parseManifest } from "./core.ts";

const VERSION = "f1plus1-off-host-read-v1" as const;
const DOMAIN = "f1plus1-off-host-read-v1\n";
const HASH = /^[a-f0-9]{64}$/;
export type OffHostIdentity = {
  packageId: string;
  recoveryPointAt: string;
  contentHash: string;
  keyId: string;
  manifestSha256: string;
  ciphertextSha256: string;
  ciphertextBytes: number;
};
export type OffHostReadPayload = OffHostIdentity & {
  schemaVersion: typeof VERSION;
  observerRef: string;
  readStartedAt: string;
  readCompletedAt: string;
};
export type OffHostReadReceipt = { payload: OffHostReadPayload; signature: string };
const keys = ["schemaVersion", "observerRef", "readStartedAt", "readCompletedAt", "packageId", "recoveryPointAt", "contentHash", "keyId", "manifestSha256", "ciphertextSha256", "ciphertextBytes"].sort();
function fail(reason: string): never { throw new Error(`OFF_HOST_${reason}`); }
function digest(data: Buffer | string): string { return createHash("sha256").update(data).digest("hex"); }
function time(value: unknown): number {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("TIME_INVALID");
  return Date.parse(value);
}
function validate(payload: OffHostReadPayload): void {
  if (!payload || typeof payload !== "object" || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(keys) ||
    payload.schemaVersion !== VERSION || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(payload.observerRef) ||
    !HASH.test(payload.contentHash) || !HASH.test(payload.manifestSha256) || !HASH.test(payload.ciphertextSha256) ||
    !/^[a-f0-9]{16}$/.test(payload.keyId) || !Number.isSafeInteger(payload.ciphertextBytes) || payload.ciphertextBytes < 29 ||
    payload.packageId !== packageIdFor(payload.recoveryPointAt, payload.contentHash)) fail("PAYLOAD_INVALID");
  const point = time(payload.recoveryPointAt), start = time(payload.readStartedAt), end = time(payload.readCompletedAt);
  if (start < point || end < start) fail("TIME_ORDER_INVALID");
}

/** The configured public key identifies the independent observer; receipt-controlled keys are never accepted. */
export function verifyOffHostReceipt(input: {
  receipt: unknown; publicKeyPem: string; expected: OffHostIdentity;
  now?: Date; maxAgeMs?: number; observerRef?: string;
}): OffHostReadPayload & { receiptSha256: string } {
  const receipt = input.receipt as OffHostReadReceipt;
  if (!receipt || typeof receipt !== "object" || JSON.stringify(Object.keys(receipt).sort()) !== '["payload","signature"]' ||
    typeof receipt.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)) fail("RECEIPT_INVALID");
  validate(receipt.payload);
  if (receipt.payload.observerRef !== (input.observerRef ?? "m5-backup-verifier-v1")) fail("OBSERVER_MISMATCH");
  const publicKey = createPublicKey(input.publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.from(DOMAIN + canonicalJson(receipt.payload)), publicKey, Buffer.from(receipt.signature, "base64url"))) fail("SIGNATURE_INVALID");
  for (const [key, value] of Object.entries(input.expected)) {
    if (receipt.payload[key as keyof OffHostIdentity] !== value) fail("IDENTITY_MISMATCH");
  }
  const now = (input.now ?? new Date()).getTime(), maxAge = input.maxAgeMs ?? 900_000;
  if (!Number.isFinite(now) || !Number.isFinite(maxAge) || maxAge < 0 || maxAge > 900_000 ||
    time(receipt.payload.readCompletedAt) > now + 30_000 || time(receipt.payload.readStartedAt) > now + 30_000 ||
    now - time(receipt.payload.recoveryPointAt) > maxAge || now - time(receipt.payload.readCompletedAt) > maxAge) fail("STALE_OR_FUTURE");
  return { ...receipt.payload, receiptSha256: digest(canonicalJson(receipt)) };
}

function safeRegular(path: string): void {
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid?.() || (st.mode & 0o022)) fail("FILE_REJECTED");
}
function stableRead(path: string): Buffer {
  safeRegular(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 4 * 1024 * 1024) fail("MANIFEST_SIZE_INVALID");
    const data = readFileSync(fd), after = fstatSync(fd), current = lstatSync(path);
    if (before.dev !== current.dev || before.ino !== current.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.mtimeMs !== current.mtimeMs || data.length !== before.size) fail("FILE_CHANGED");
    return data;
  } finally { closeSync(fd); }
}
export function hashCiphertextFile(path: string): { sha256: string; bytes: number } {
  safeRegular(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd), hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0, count: number;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) { hash.update(buffer.subarray(0, count)); bytes += count; }
    const after = fstatSync(fd), current = lstatSync(path);
    if (before.size !== bytes || before.ino !== current.ino || before.dev !== current.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.mtimeMs !== current.mtimeMs) fail("FILE_CHANGED");
    return { sha256: hash.digest("hex"), bytes };
  } finally { closeSync(fd); }
}

/** Run on M5 against files actually read from M5's off-host filesystem. It does not claim decryption. */
export function createOffHostReadReceipt(input: {
  backupRoot: string; packageId: string; privateKeyPem: string; observerRef?: string; now?: () => Date;
}): OffHostReadReceipt {
  if (!/^[0-9]{13}_[a-f0-9]{16}$/.test(input.packageId)) fail("PACKAGE_INVALID");
  const now = input.now ?? (() => new Date()), readStartedAt = now().toISOString();
  const root = realpathSync(input.backupRoot);
  if (resolve(input.backupRoot) !== root) fail("ROOT_LINK_REJECTED");
  for (const directory of [root, join(root, "packages"), join(root, "objects"), join(root, "packages", input.packageId)]) {
    const st = lstatSync(directory);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.() || (st.mode & 0o022)) fail("DIRECTORY_REJECTED");
  }
  const manifestPath = join(root, "packages", input.packageId, "manifest.json");
  const manifestBytes = stableRead(manifestPath), manifest = parseManifest(manifestBytes.toString("utf8"));
  if (packageIdFor(manifest.recovery_point_at, manifest.contentHash) !== input.packageId) fail("PACKAGE_MISMATCH");
  const cipher = hashCiphertextFile(join(root, "objects", objectFileName(manifest.kind, manifest.contentHash, manifest.keyId)));
  if (!stableRead(manifestPath).equals(manifestBytes)) fail("MANIFEST_CHANGED");
  const payload: OffHostReadPayload = {
    schemaVersion: VERSION, observerRef: input.observerRef ?? "m5-backup-verifier-v1",
    readStartedAt, readCompletedAt: now().toISOString(), packageId: input.packageId,
    recoveryPointAt: manifest.recovery_point_at, contentHash: manifest.contentHash, keyId: manifest.keyId,
    manifestSha256: digest(manifestBytes), ciphertextSha256: cipher.sha256, ciphertextBytes: cipher.bytes
  };
  validate(payload);
  const privateKey = createPrivateKey(input.privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") fail("KEY_TYPE_INVALID");
  return { payload, signature: sign(null, Buffer.from(DOMAIN + canonicalJson(payload)), privateKey).toString("base64url") };
}
