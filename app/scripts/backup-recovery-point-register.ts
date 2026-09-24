import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { basename, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { inspectExistingPrivateDatabase, openExistingSafeDatabase } from "../src/server/db/database.ts";
import { canonicalJsonV1 } from "../src/server/internal-operation/gateway.ts";
import { runBackupRecoveryPointRegister } from "../src/server/internal-operation/backup-recovery-point-register.ts";
import { loadKeyFile, type BackupReport } from "../src/server/backup-snapshot/core.ts";
import { SOURCE_REGISTRY_SCHEMA10_SHA256 } from "../src/server/rss/source-registry-migration.ts";
import { ConfigError } from "../src/server/config/env.ts";

const FORBIDDEN = [
  join(homedir(), "F1-1-website"),
  join(homedir(), "Library", "Application Support", "F1Plus1"),
  join(homedir(), "Library", "LaunchAgents")
];

function fail(code: string): never { throw new Error(code); }
function assert(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }

function required(name: string, value: string | undefined): string {
  assert(typeof value === "string" && value.length > 0, "CLI_ARGUMENT_MISSING");
  return value;
}

function absolute(name: string, value: string, allowProduction: boolean): string {
  assert(isAbsolute(value), "CLI_ARGUMENT_PATH_MUST_BE_ABSOLUTE");
  const resolved = resolve(value);
  if (!allowProduction) {
    for (const prefix of FORBIDDEN) {
      assert(!resolved.startsWith(prefix), "CLI_PRODUCTION_PATH_FORBIDDEN");
    }
  }
  return resolved;
}

function requiredHash(value: string | undefined): string {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), "CLI_HASH_INVALID");
  return value;
}

type RegistrationStage = "ARGUMENTS" | "READ_TARGET" | "OPEN_DATABASE" | "PROOF_AND_REGISTER";

export function backupRegistrationFailureCode(error: unknown): string {
  if (error instanceof ConfigError && /^[A-Z][A-Z0-9_]+$/.test(error.code)) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  if (isRegistrationLockContention(error)) return "REGISTER_SQLITE_BUSY";
  return "REGISTER_FAILED";
}

function isRegistrationLockContention(error: unknown): boolean {
  if (error instanceof ConfigError && error.code === "LOCK_CONTENTION") return true;
  if (!(error instanceof Error)) return false;
  const value = error as Error & { code?: unknown; errcode?: unknown };
  return value.code === "ERR_SQLITE_ERROR" && typeof value.errcode === "number" && Number.isSafeInteger(value.errcode)
    && value.errcode >= 0 && value.errcode <= 65535 && (value.errcode & 0xff) === 5;
}

/** Retry only real SQLite writer contention, reopening and revalidating the
 * same package each time. The register operation itself remains idempotent.
 * The existing outer process deadline still bounds the complete command.
 */
export function runBackupRecoveryPointRegisterCli(argv: readonly string[]): unknown {
  const started = performance.now(), delays = [250, 500] as const;
  let stage: RegistrationStage = "ARGUMENTS";
  let targetSha256: string | null = null;
  const pinTarget = (bytes: Buffer): void => {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (targetSha256 === null) targetSha256 = sha256;
    else assert(targetSha256 === sha256, "REGISTER_TARGET_CHANGED");
  };
  for (let attempt = 0; ; attempt++) {
    try { return runBackupRecoveryPointRegisterCliOnce(argv, value => { stage = value; }, pinTarget); }
    catch (error) {
      const native = error instanceof Error ? error as Error & { code?: unknown; errcode?: unknown } : null;
      const retry = isRegistrationLockContention(error) && attempt < delays.length && performance.now() - started < 30_000;
      // Never emit native messages, paths, argument values, key material or stack.
      const nativeCode = typeof native?.code === "string" && ["ERR_SQLITE_ERROR", "LOCK_CONTENTION", "ENOENT", "EACCES", "EPERM", "ENOSPC", "EIO", "EROFS", "ELOOP", "EMFILE", "ENFILE"].includes(native.code) ? native.code : null;
      process.stderr.write(`${canonicalJsonV1({ event: "backup_register_attempt_failed", stage, attempt: attempt + 1,
        reasonCode: backupRegistrationFailureCode(error), nativeCode,
        sqliteCode: nativeCode === "ERR_SQLITE_ERROR" && typeof native?.errcode === "number" && Number.isSafeInteger(native.errcode) && native.errcode >= 0 && native.errcode <= 65535 ? native.errcode : null,
        retry, waitMs: retry ? delays[attempt] : 0 })}\n`);
      if (!retry) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
      if (performance.now() - started >= 30_000) {
        process.stderr.write(`${canonicalJsonV1({ event: "backup_register_retry_deadline", stage, attempt: attempt + 1,
          reasonCode: backupRegistrationFailureCode(error), retry: false })}\n`);
        throw error;
      }
    }
  }
}

function runBackupRecoveryPointRegisterCliOnce(argv: readonly string[], setStage: (stage: RegistrationStage) => void, pinTarget: (bytes: Buffer) => void): unknown {
  setStage("ARGUMENTS");
  const parsed = parseArgs({
    args: [...argv],
    options: {
      "backup-root": { type: "string" },
      db: { type: "string" },
      "drill-report": { type: "string" },
      "restore-root": { type: "string" },
      "release-sha256": { type: "string" },
      "manifest-sha256": { type: "string" },
      "schema-sha256": { type: "string" },
      "budget-account-id": { type: "string" },
      "retention-policy-id": { type: "string" },
      "fence-path": { type: "string" },
      "off-host-receipt": { type: "string" },
      "application-drill-receipt": { type: "string" },
      "application-drill-public-key": { type: "string" },
      "off-host-public-key": { type: "string" },
      "key-file": { type: "string" },
      "projection-signing-key-id": { type: "string" },
      "projection-public-key": { type: "string" },
      // 生产路径默认拒绝(disposable 安全网);对真实生产库执行属 A 级动作,
      // 必须由用户单独授权后显式携带本开关,使授权在命令行上审计可见。
      "allow-production": { type: "boolean", default: false }
    },
    allowPositionals: false,
    strict: true
  });
  const allowProduction = parsed.values["allow-production"] === true;
  const databasePath = absolute("db", required("db", parsed.values.db), allowProduction);
  // Pin the complete requested report before even opening SQLite: an open can
  // itself contend. Every attempt still reads and validates all current proof.
  setStage("READ_TARGET");
  const drillReportBytes = readFileSync(absolute("drill-report", required("drill-report", parsed.values["drill-report"]), allowProduction));
  pinTarget(drillReportBytes);
  const drillReport = JSON.parse(drillReportBytes.toString("utf8")) as BackupReport;
  setStage("OPEN_DATABASE");
  const identity = inspectExistingPrivateDatabase(databasePath, basename(databasePath));
  const database = openExistingSafeDatabase(databasePath, basename(databasePath), identity, [10]);
  try {
    setStage("PROOF_AND_REGISTER");
    const receipt = runBackupRecoveryPointRegister({
      database,
      snapshotKey: loadKeyFile(absolute("key-file", required("key-file", parsed.values["key-file"]), allowProduction)),
      applicationDrill: JSON.parse(readFileSync(absolute("application-drill-receipt", required("application-drill-receipt", parsed.values["application-drill-receipt"]), allowProduction), "utf8")),
      applicationDrillPublicKeyPem: readFileSync(absolute("application-drill-public-key", required("application-drill-public-key", parsed.values["application-drill-public-key"]), allowProduction), "utf8"),
      offHostReceipt: JSON.parse(readFileSync(absolute("off-host-receipt", required("off-host-receipt", parsed.values["off-host-receipt"]), allowProduction), "utf8")),
      offHostPublicKeyPem: readFileSync(absolute("off-host-public-key", required("off-host-public-key", parsed.values["off-host-public-key"]), allowProduction), "utf8"),
      projectionSigningKeyId: required("projection-signing-key-id", parsed.values["projection-signing-key-id"]),
      projectionPublicKeyPem: readFileSync(absolute("projection-public-key", required("projection-public-key", parsed.values["projection-public-key"]), allowProduction), "utf8"),
      backupRoot: absolute("backup-root", required("backup-root", parsed.values["backup-root"]), allowProduction),
      drillReport,
      restoreRoot: absolute("restore-root", required("restore-root", parsed.values["restore-root"]), allowProduction),
      releaseSha256: requiredHash(parsed.values["release-sha256"]),
      manifestSha256: requiredHash(parsed.values["manifest-sha256"]),
      schemaSha256: parsed.values["schema-sha256"] === undefined ? SOURCE_REGISTRY_SCHEMA10_SHA256 : requiredHash(parsed.values["schema-sha256"]),
      budgetAccountId: parsed.values["budget-account-id"] ?? "backup-private",
      retentionPolicyId: parsed.values["retention-policy-id"] ?? "snap-cycle-v1",
      fencePath: parsed.values["fence-path"] === undefined ? undefined : absolute("fence-path", parsed.values["fence-path"], allowProduction)
    });
    if (receipt.decision !== "SUCCESS") process.exitCode = 1;
    return receipt;
  } finally {
    database.close();
  }
}

function main(): void {
  const receipt = runBackupRecoveryPointRegisterCli(process.argv.slice(2));
  process.stdout.write(`${canonicalJsonV1(receipt)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stdout.write(`${canonicalJsonV1({
      schemaVersion: "backup-recovery-point-register-receipt-v2",
      decision: "FAIL",
      reasonCode: backupRegistrationFailureCode(error)
    })}\n`);
    process.exitCode = 1;
  }
}
