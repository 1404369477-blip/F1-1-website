import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
  BackupError,
  loadKeyFile,
  reportFromError,
  runSnapshotOnce,
  type BackupReport
} from "../src/server/backup-snapshot/core.ts";

function required(name: string, cli: string | undefined, env: string | undefined): string {
  const value = cli ?? env;
  if (value === undefined || value.length === 0) throw new BackupError("CLI_ARGUMENT_MISSING");
  return value;
}

function parseRetain(cli: string | undefined, env: string | undefined): number {
  const raw = cli ?? env ?? "4";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new BackupError("RETAIN_INVALID");
  return value;
}

export function runBackupSnapshotCli(argv: readonly string[], env: NodeJS.ProcessEnv): BackupReport {
  const started = Date.now();
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: {
        "source-db": { type: "string" },
        "projection-root": { type: "string" },
        "output-dir": { type: "string" },
        "key-file": { type: "string" },
        retain: { type: "string" }
      },
      allowPositionals: false,
      strict: true
    });
    const report = runSnapshotOnce({
      sourceDbPath: required("source-db", parsed.values["source-db"], env.BACKUP_SOURCE_DB),
      projectionRoot: required("projection-root", parsed.values["projection-root"], env.BACKUP_PROJECTION_ROOT),
      outputDir: required("output-dir", parsed.values["output-dir"], env.BACKUP_OUTPUT_DIR),
      key: loadKeyFile(required("key-file", parsed.values["key-file"], env.BACKUP_KEY_FILE)),
      retain: parseRetain(parsed.values.retain, env.BACKUP_RETAIN)
    });
    return { ...report, elapsedMs: report.elapsedMs ?? Date.now() - started };
  } catch (error) {
    return reportFromError(error, Date.now() - started);
  }
}

function main(): void {
  const report = runBackupSnapshotCli(process.argv.slice(2), process.env);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
