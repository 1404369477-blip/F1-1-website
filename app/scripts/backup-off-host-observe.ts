import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createOffHostReadReceipt } from "../src/server/backup-snapshot/off-host-receipt.ts";

/** M5-only observer. Its signing key never leaves M5 and is independent from the M1 AES key. */
export function observeLatest(input: { backupRoot: string; receiptsDir: string; signingKeyFile: string }): { code: string; packageId: string; receiptFile: string } {
  const keyStat = lstatSync(input.signingKeyFile);
  if (!keyStat.isFile() || keyStat.isSymbolicLink() || keyStat.uid !== process.getuid?.() || (keyStat.mode & 0o077) !== 0) throw new Error("OFF_HOST_PRIVATE_KEY_PERMISSIONS");
  const pointer = JSON.parse(readFileSync(join(input.backupRoot, "latest.json"), "utf8")) as { packageId?: string };
  if (!pointer.packageId || !/^[0-9]{13}_[a-f0-9]{16}$/.test(pointer.packageId)) throw new Error("OFF_HOST_LATEST_INVALID");
  if (Date.now() - Number(pointer.packageId.slice(0, 13)) > 900_000) throw new Error("OFF_HOST_RECOVERY_POINT_STALE");
  const receiptsDir = resolve(input.receiptsDir);
  if (!existsSync(receiptsDir)) mkdirSync(receiptsDir, { recursive: true, mode: 0o700 });
  const dirStat = lstatSync(receiptsDir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || dirStat.uid !== process.getuid?.() || (dirStat.mode & 0o022)) throw new Error("OFF_HOST_RECEIPT_DIRECTORY_REJECTED");
  // This directory belongs only to this producer. Keep seven days of small signed receipts;
  // current encrypted packages retain two hours, so their corresponding evidence is preserved.
  for (const name of readdirSync(receiptsDir)) {
    const match = /^([0-9]{13})_[a-f0-9]{16}\.json$/.exec(name);
    if (!match || Date.now() - Number(match[1]) <= 7 * 86400_000) continue;
    const path = join(receiptsDir, name), stat = lstatSync(path);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && stat.nlink === 1 && !(stat.mode & 0o022)) unlinkSync(path);
  }
  const receiptFile = join(receiptsDir, `${pointer.packageId}.json`);
  // Never renew an existing old package's apparent age. M1 validates its actual recovery point.
  if (existsSync(receiptFile)) return { code: "OFF_HOST_ALREADY_OBSERVED", packageId: pointer.packageId, receiptFile };
  const receipt = createOffHostReadReceipt({ backupRoot: input.backupRoot, packageId: pointer.packageId, privateKeyPem: readFileSync(input.signingKeyFile, "utf8") });
  const tmp = join(dirname(receiptFile), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(receipt)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(tmp, receiptFile); chmodSync(receiptFile, 0o600);
  } finally { if (existsSync(tmp)) unlinkSync(tmp); }
  return { code: "OFF_HOST_READ_VERIFIED", packageId: pointer.packageId, receiptFile };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = new Map<string, string>();
    for (let i = 2; i < process.argv.length; i += 2) {
      if (!process.argv[i]?.startsWith("--") || !process.argv[i + 1] || args.has(process.argv[i])) throw new Error("OFF_HOST_USAGE");
      args.set(process.argv[i], process.argv[i + 1]);
    }
    if (args.size !== 3 || !args.has("--backup-root") || !args.has("--receipts-dir") || !args.has("--signing-key-file")) throw new Error("OFF_HOST_USAGE");
    const result = observeLatest({ backupRoot: args.get("--backup-root")!, receiptsDir: args.get("--receipts-dir")!, signingKeyFile: args.get("--signing-key-file")! });
    process.stdout.write(`${JSON.stringify({ ok: true, observedAt: new Date().toISOString(), ...result })}\n`);
  } catch (error) {
    const code = error instanceof Error && /^OFF_HOST_[A-Z_]+$/.test(error.message) ? error.message : "OFF_HOST_READ_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, observedAt: new Date().toISOString(), code })}\n`); process.exitCode = 1;
  }
}
