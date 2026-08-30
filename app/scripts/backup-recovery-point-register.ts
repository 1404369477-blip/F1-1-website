import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { basename, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

import { inspectExistingPrivateDatabase, openExistingSafeDatabase } from "../src/server/db/database.ts";
import { canonicalJsonV1 } from "../src/server/internal-operation/gateway.ts";
import { runBackupRecoveryPointRegister } from "../src/server/internal-operation/backup-recovery-point-register.ts";
import type { BackupReport } from "../src/server/backup-snapshot/core.ts";
import { SOURCE_REGISTRY_SCHEMA10_SHA256 } from "../src/server/rss/source-registry-migration.ts";

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

function absolute(name: string, value: string): string {
  assert(isAbsolute(value), "CLI_ARGUMENT_PATH_MUST_BE_ABSOLUTE");
  const resolved = resolve(value);
  for (const prefix of FORBIDDEN) {
    assert(!resolved.startsWith(prefix), "CLI_PRODUCTION_PATH_FORBIDDEN");
  }
  return resolved;
}

function requiredHash(value: string | undefined): string {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), "CLI_HASH_INVALID");
  return value;
}

export function runBackupRecoveryPointRegisterCli(argv: readonly string[]): unknown {
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
      "off-host-verified": { type: "boolean", default: false }
    },
    allowPositionals: false,
    strict: true
  });
  assert(parsed.values["off-host-verified"] === true, "OFF_HOST_NOT_VERIFIED");
  const databasePath = absolute("db", required("db", parsed.values.db));
  const identity = inspectExistingPrivateDatabase(databasePath, basename(databasePath));
  const database = openExistingSafeDatabase(databasePath, basename(databasePath), identity, [10]);
  try {
    const drillReport = JSON.parse(readFileSync(absolute("drill-report", required("drill-report", parsed.values["drill-report"])), "utf8")) as BackupReport;
    return runBackupRecoveryPointRegister({
      database,
      backupRoot: absolute("backup-root", required("backup-root", parsed.values["backup-root"])),
      drillReport,
      restoreRoot: absolute("restore-root", required("restore-root", parsed.values["restore-root"])),
      releaseSha256: requiredHash(parsed.values["release-sha256"]),
      manifestSha256: requiredHash(parsed.values["manifest-sha256"]),
      schemaSha256: parsed.values["schema-sha256"] === undefined ? SOURCE_REGISTRY_SCHEMA10_SHA256 : requiredHash(parsed.values["schema-sha256"]),
      budgetAccountId: parsed.values["budget-account-id"] ?? "backup-private",
      retentionPolicyId: parsed.values["retention-policy-id"] ?? "snap-cycle-v1",
      fencePath: parsed.values["fence-path"] === undefined ? undefined : absolute("fence-path", parsed.values["fence-path"])
    });
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
      schemaVersion: "backup-recovery-point-register-receipt-v1",
      decision: "FAIL",
      reasonCode: error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "REGISTER_FAILED"
    })}\n`);
    process.exitCode = 1;
  }
}
