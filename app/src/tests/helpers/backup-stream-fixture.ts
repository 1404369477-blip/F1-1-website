import { createCipheriv, createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, type SnapshotMember } from "../../server/backup-snapshot/core.ts";

export type Entry = { path: string; data: Buffer };
export const digest = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
export const u32 = (value: number): Buffer => { const out = Buffer.alloc(4); out.writeUInt32LE(value); return out; };
export function archive(entries: Entry[]): Buffer {
  return Buffer.concat([Buffer.from("F1PK"), u32(entries.length), ...entries.flatMap(entry => {
    const path = Buffer.from(entry.path);
    return [u32(path.length), path, u32(entry.data.length), entry.data];
  })]);
}
export function encrypted(plain: Buffer, key: Buffer, kind: string, contentHash: string, keyId: string): Buffer {
  const iv = Buffer.alloc(12, 0x29), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(kind + "|" + contentHash + "|" + keyId));
  return Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}
export function streamFixture(
  entries: Entry[] = [{ path: "db/snapshot.sqlite", data: Buffer.from("synthetic database") },
    { path: "projection/generations/边界.json", data: Buffer.from("synthetic projection") }],
  plaintext?: Buffer,
  expectedMembers?: SnapshotMember[]
) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "backup-stream-test-"));
  const key = Buffer.alloc(32, 0x31), keyId = digest(key).slice(0, 16), kind = "db-projection-snapshot";
  const members = expectedMembers ?? entries.map(e => ({ relativePath: e.path, bytes: e.data.length, sha256: digest(e.data) }));
  const contentHash = digest(canonicalJson(members));
  const at = "2026-09-12T00:00:00.000Z", packageId = String(Date.parse(at)) + "_" + contentHash.slice(0, 16);
  const packagesDir = join(root, "packages", packageId), objectsDir = join(root, "objects");
  mkdirSync(packagesDir, { recursive: true, mode: 0o700 }); mkdirSync(objectsDir, { mode: 0o700 });
  const objectPath = join(objectsDir, kind + "." + contentHash + "." + keyId);
  writeFileSync(objectPath, encrypted(plaintext ?? archive(entries), key, kind, contentHash, keyId), { mode: 0o600 });
  writeFileSync(join(packagesDir, "manifest.json"), JSON.stringify({
    schemaVersion: "backup-snapshot-manifest-v1", kind, keyId, recovery_point_at: at, contentHash,
    userVersion: 10, sqliteMasterSha256: "a".repeat(64), members
  }), { mode: 0o600 });
  // The verifier-only test stops at CAPTURE_DATABASE before SQLite is opened.
  const sourceDbPath = join(root, "source.sqlite"), projectionRoot = join(root, "projection-source");
  writeFileSync(sourceDbPath, Buffer.alloc(4096), { mode: 0o600 });
  mkdirSync(join(projectionRoot, "generations"), { recursive: true, mode: 0o700 });
  const generation = Buffer.from("{}"), generationHash = digest(generation);
  writeFileSync(join(projectionRoot, "generations", generationHash + ".json"), generation, { mode: 0o600 });
  writeFileSync(join(projectionRoot, "active.json"), JSON.stringify({ snapshotManifestHash: generationHash }), { mode: 0o600 });
  return { root, objectPath, key, keyId, kind, contentHash, members, packageId, sourceDbPath, projectionRoot };
}
