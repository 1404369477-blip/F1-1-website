import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, objectFileName, packageIdFor, SNAPSHOT_KIND, sha256Text } from "../server/backup-snapshot/core.ts";
import { createOffHostReadReceipt, verifyOffHostReceipt } from "../server/backup-snapshot/off-host-receipt.ts";
import { observeLatest } from "../../scripts/backup-off-host-observe.ts";

const roots: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "f1-off-host-test-"))); roots.push(root);
  const key = generateKeyPairSync("ed25519"), privateKeyPem = key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKeyPem = key.publicKey.export({ type: "spki", format: "pem" }).toString();
  const members = [{ relativePath: "db/snapshot.sqlite", bytes: 10, sha256: "d".repeat(64) }, { relativePath: "projection/active.json", bytes: 10, sha256: "e".repeat(64) }];
  const recoveryPointAt = "2026-09-06T12:00:00.000Z", contentHash = sha256Text(canonicalJson(members)), keyId = "b".repeat(16), packageId = packageIdFor(recoveryPointAt, contentHash);
  mkdirSync(join(root, "packages", packageId), { recursive: true, mode: 0o700 }); mkdirSync(join(root, "objects"), { mode: 0o700 });
  const manifest = { schemaVersion: "backup-snapshot-manifest-v1", kind: SNAPSHOT_KIND, keyId, recovery_point_at: recoveryPointAt, contentHash, userVersion: 10, sqliteMasterSha256: "c".repeat(64), members };
  const manifestFile = join(root, "packages", packageId, "manifest.json"), cipherFile = join(root, "objects", objectFileName(SNAPSHOT_KIND, contentHash, keyId));
  writeFileSync(manifestFile, canonicalJson(manifest), { mode: 0o600 }); writeFileSync(cipherFile, Buffer.alloc(100, 7), { mode: 0o600 });
  writeFileSync(join(root, "latest.json"), JSON.stringify({ packageId }), { mode: 0o600 });
  const receipt = () => createOffHostReadReceipt({ backupRoot: root, packageId, privateKeyPem, now: () => new Date("2026-09-06T12:00:10.000Z") });
  return { root, key, privateKeyPem, publicKeyPem, manifestFile, cipherFile, packageId, receipt };
}
function expected(receipt: ReturnType<ReturnType<typeof fixture>["receipt"]>) {
  const { packageId, recoveryPointAt, contentHash, keyId, manifestSha256, ciphertextSha256, ciphertextBytes } = receipt.payload;
  return { packageId, recoveryPointAt, contentHash, keyId, manifestSha256, ciphertextSha256, ciphertextBytes };
}
describe("independent off-host signed read", () => {
  it("binds the bytes actually read to a pinned observer key and exact package", () => {
    const f = fixture(), receipt = f.receipt();
    const result = verifyOffHostReceipt({ receipt, publicKeyPem: f.publicKeyPem, expected: expected(receipt), now: new Date("2026-09-06T12:00:20.000Z") });
    expect(result.ciphertextBytes).toBe(100); expect(result.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("decrypt");
    const differentKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => verifyOffHostReceipt({ receipt, publicKeyPem: differentKey, expected: expected(receipt) })).toThrow("SIGNATURE_INVALID");
    expect(() => verifyOffHostReceipt({ receipt, publicKeyPem: f.publicKeyPem, expected: { ...expected(receipt), ciphertextBytes: 101 } })).toThrow("IDENTITY_MISMATCH");
  });
  it("rejects tampering, untrusted observer identity, future clocks and stale data", () => {
    const f = fixture(), receipt = f.receipt(), input = { receipt, publicKeyPem: f.publicKeyPem, expected: expected(receipt), now: new Date("2026-09-06T12:00:20.000Z") };
    expect(() => verifyOffHostReceipt({ ...input, receipt: { ...receipt, payload: { ...receipt.payload, ciphertextBytes: 99 } } })).toThrow("SIGNATURE_INVALID");
    expect(() => verifyOffHostReceipt({ ...input, observerRef: "another-host" })).toThrow("OBSERVER_MISMATCH");
    expect(() => verifyOffHostReceipt({ ...input, now: new Date("2026-09-06T11:59:00.000Z") })).toThrow("STALE_OR_FUTURE");
    expect(() => verifyOffHostReceipt({ ...input, now: new Date("2026-09-06T12:15:00.001Z") })).toThrow("STALE_OR_FUTURE");
  });
  it("detects ciphertext corruption against the independently signed hash", () => {
    const f = fixture(), receipt = f.receipt();
    writeFileSync(f.cipherFile, Buffer.alloc(100, 8)); const changed = f.receipt();
    expect(changed.payload.ciphertextSha256).not.toBe(receipt.payload.ciphertextSha256);
    expect(() => verifyOffHostReceipt({ receipt, publicKeyPem: f.publicKeyPem, expected: expected(changed) })).toThrow("IDENTITY_MISMATCH");
  });
  it("rejects symlinked objects and writable storage", () => {
    const f = fixture(); rmSync(f.cipherFile); symlinkSync(f.manifestFile, f.cipherFile);
    expect(f.receipt).toThrow("FILE_REJECTED"); rmSync(f.cipherFile); writeFileSync(f.cipherFile, Buffer.alloc(100), { mode: 0o666 }); chmodSync(f.cipherFile, 0o666);
    expect(f.receipt).toThrow("FILE_REJECTED");
  });
  it("observer stores one receipt per package and never renews its timestamp", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-06T12:00:10.000Z"));
    const f = fixture(), keyFile = join(f.root, "sign.key"), receiptsDir = join(f.root, "receipts"); writeFileSync(keyFile, f.privateKeyPem, { mode: 0o600 });
    const first = observeLatest({ backupRoot: f.root, receiptsDir, signingKeyFile: keyFile }), bytes = readFileSync(first.receiptFile);
    const second = observeLatest({ backupRoot: f.root, receiptsDir, signingKeyFile: keyFile });
    expect(first.code).toBe("OFF_HOST_READ_VERIFIED"); expect(second.code).toBe("OFF_HOST_ALREADY_OBSERVED"); expect(readFileSync(first.receiptFile)).toEqual(bytes);
    chmodSync(keyFile, 0o644); expect(() => observeLatest({ backupRoot: f.root, receiptsDir, signingKeyFile: keyFile })).toThrow("PRIVATE_KEY_PERMISSIONS");
  });
});
