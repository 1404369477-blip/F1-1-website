import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
  BackupError,
  loadKeyFile,
  reportFromError,
  runRestoreDrill,
  type BackupReport
} from "../src/server/backup-snapshot/core.ts";

function required(name: string, cli: string | undefined, env: string | undefined): string {
  const value = cli ?? env;
  if (value === undefined || value.length === 0) throw new BackupError("CLI_ARGUMENT_MISSING");
  return value;
}

function optional(cli: string | undefined, env: string | undefined): string | undefined {
  const value = cli ?? env;
  return value === undefined || value.length === 0 ? undefined : value;
}

function parseExpectedUserVersion(cli: string | undefined, env: string | undefined): number | undefined {
  const raw = optional(cli, env);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new BackupError("USER_VERSION_MISMATCH");
  return value;
}

export function runBackupRestoreCli(argv: readonly string[], env: NodeJS.ProcessEnv): BackupReport {
  const started = Date.now();
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: {
        "backup-root": { type: "string" },
        "restore-root": { type: "string" },
        "key-file": { type: "string" },
        "package-id": { type: "string" },
        "expected-user-version": { type: "string" },
        "verify-only": { type: "boolean", default: false }
      },
      allowPositionals: false,
      strict: true
    });
    const verifyOnly = parsed.values["verify-only"] === true || env.BACKUP_VERIFY_ONLY === "1";
    const report = runRestoreDrill({
      backupRoot: required("backup-root", parsed.values["backup-root"], env.BACKUP_BACKUP_ROOT),
      restoreRoot: required("restore-root", parsed.values["restore-root"], env.BACKUP_RESTORE_ROOT),
      key: loadKeyFile(required("key-file", parsed.values["key-file"], env.BACKUP_KEY_FILE)),
      packageId: optional(parsed.values["package-id"], env.BACKUP_PACKAGE_ID),
      expectedUserVersion: parseExpectedUserVersion(
        parsed.values["expected-user-version"],
        env.BACKUP_EXPECTED_USER_VERSION
      ),
      verifyOnly
    });
    return { ...report, elapsedMs: report.elapsedMs ?? Date.now() - started };
  } catch (error) {
    return reportFromError(error, Date.now() - started);
  }
}

function main(): void {
  const report = runBackupRestoreCli(process.argv.slice(2), process.env);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
