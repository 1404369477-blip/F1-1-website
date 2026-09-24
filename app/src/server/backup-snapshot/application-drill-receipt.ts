import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { canonicalJson } from "./core.ts";

export const APPLICATION_DRILL_SCHEMA = "f1plus1-application-drill-v1" as const;
const DOMAIN = `${APPLICATION_DRILL_SCHEMA}\n`;
const HASH = /^[a-f0-9]{64}$/;
export type ApplicationDrillIdentity = {
  packageId: string; contentHash: string; manifestSha256: string; databaseSnapshotSha256: string;
  restoreRootSha256: string; releaseSha256: string; deploymentManifestSha256: string; schemaSha256: string;
  projectionGeneration: number; projectionManifestSha256: string;
};
export type ApplicationDrillPayload = ApplicationDrillIdentity & {
  schemaVersion: typeof APPLICATION_DRILL_SCHEMA;
  bootable: true; businessPointVerified: true;
  incidentDeclaredAt: string; adminAvailableAt: string; publicAvailableAt: string; completedAt: string; elapsedMs: number;
  adminResponseSha256: string; publicResponseSha256: string; adminRuntimeSha256: string; publicRuntimeSha256: string;
};
export type ApplicationDrillReceipt = { payload: ApplicationDrillPayload; signature: string };
function fail(code: string): never { throw new Error(`APPLICATION_DRILL_${code}`); }
function time(value: unknown): number {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("TIME_INVALID");
  return Date.parse(value);
}
const fields = ["packageId", "contentHash", "manifestSha256", "databaseSnapshotSha256", "restoreRootSha256", "releaseSha256", "deploymentManifestSha256", "schemaSha256", "projectionGeneration", "projectionManifestSha256", "schemaVersion", "bootable", "businessPointVerified", "incidentDeclaredAt", "adminAvailableAt", "publicAvailableAt", "completedAt", "elapsedMs", "adminResponseSha256", "publicResponseSha256", "adminRuntimeSha256", "publicRuntimeSha256"].sort();
function validate(payload: ApplicationDrillPayload): void {
  if (!payload || typeof payload !== "object" || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(fields) ||
    payload.schemaVersion !== APPLICATION_DRILL_SCHEMA || payload.bootable !== true || payload.businessPointVerified !== true ||
    !/^[0-9]{13}_[a-f0-9]{16}$/.test(payload.packageId) || !Number.isSafeInteger(payload.projectionGeneration) || payload.projectionGeneration < 1) fail("PAYLOAD_INVALID");
  for (const field of fields.filter(field => field.endsWith("Sha256") || field === "contentHash")) {
    if (!HASH.test(String(payload[field as keyof ApplicationDrillPayload]))) fail("HASH_INVALID");
  }
  const start = time(payload.incidentDeclaredAt), admin = time(payload.adminAvailableAt), pub = time(payload.publicAvailableAt), end = time(payload.completedAt);
  if (start < Number(payload.packageId.slice(0, 13)) || admin < start || pub < start || end < Math.max(admin, pub)) fail("TIME_ORDER_INVALID");
  if (!Number.isFinite(payload.elapsedMs) || payload.elapsedMs < end - start || payload.elapsedMs < 0 || payload.elapsedMs > 14_400_000 || end - start > 14_400_000) fail("DURATION_INVALID");
}
/** Called only after the installed producer has booted and probed the isolated restored applications. */
export function createSignedApplicationDrillReceipt(payload: ApplicationDrillPayload, privateKeyPem: string): ApplicationDrillReceipt {
  validate(payload);
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") fail("KEY_TYPE_INVALID");
  return { payload, signature: sign(null, Buffer.from(DOMAIN + canonicalJson(payload)), key).toString("base64url") };
}
/** Trust comes from the deployment-pinned producer key, never from fields inside a submitted receipt. */
export function verifyApplicationDrillReceipt(input: {
  receipt: unknown; publicKeyPem: string; expected: ApplicationDrillIdentity; now: Date;
}): ApplicationDrillPayload & { receiptSha256: string } {
  if (!input.receipt) fail("REQUIRED");
  const receipt = input.receipt as ApplicationDrillReceipt;
  if (typeof receipt !== "object" || JSON.stringify(Object.keys(receipt).sort()) !== '["payload","signature"]' || typeof receipt.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)) fail("RECEIPT_INVALID");
  validate(receipt.payload);
  const key = createPublicKey(input.publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.from(DOMAIN + canonicalJson(receipt.payload)), key, Buffer.from(receipt.signature, "base64url"))) fail("SIGNATURE_INVALID");
  for (const [field, value] of Object.entries(input.expected)) if (receipt.payload[field as keyof ApplicationDrillIdentity] !== value) fail("IDENTITY_MISMATCH");
  const now = input.now.getTime();
  if (!Number.isFinite(now) || time(receipt.payload.completedAt) > now + 30_000 || now - Number(receipt.payload.packageId.slice(0, 13)) > 900_000) fail("STALE_OR_FUTURE");
  return { ...receipt.payload, receiptSha256: createHash("sha256").update(canonicalJson(receipt)).digest("hex") };
}
