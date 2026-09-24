import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
  BackupError,
  loadKeyFile,
  reportFromError,
  runSnapshotOnce,
  type SnapshotStage,
  type BackupReport
} from "../src/server/backup-snapshot/core.ts";
import { loadXPageBackupDeploymentTrust } from "../src/server/backup-snapshot/x-deployment.ts";

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
  let stage: SnapshotStage | undefined, failureStage: SnapshotStage | undefined;
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: {
        "source-db": { type: "string" },
        "projection-root": { type: "string" },
        "output-dir": { type: "string" },
        "key-file": { type: "string" },
        "deployment-manifest": { type: "string" },
        "deployment-manifest-sha256": { type: "string" },
        retain: { type: "string" }
      },
      allowPositionals: false,
      strict: true
    });
    const sourceDbPath = required("source-db", parsed.values["source-db"], env.BACKUP_SOURCE_DB);
    const projectionRoot = required("projection-root", parsed.values["projection-root"], env.BACKUP_PROJECTION_ROOT);
    const deploymentManifestPath = parsed.values["deployment-manifest"], expectedDeploymentManifestSha256 = parsed.values["deployment-manifest-sha256"];
    if ((deploymentManifestPath === undefined) !== (expectedDeploymentManifestSha256 === undefined)) throw new BackupError("X_BACKUP_DEPLOYMENT_PINS_REQUIRED");
    const xDeployment = deploymentManifestPath && expectedDeploymentManifestSha256 ? loadXPageBackupDeploymentTrust({
      deploymentManifestPath, expectedDeploymentManifestSha256, sourceDbPath, projectionRoot }) : undefined;
    const report = runSnapshotOnce({
      sourceDbPath,
      projectionRoot,
      outputDir: required("output-dir", parsed.values["output-dir"], env.BACKUP_OUTPUT_DIR),
      key: loadKeyFile(required("key-file", parsed.values["key-file"], env.BACKUP_KEY_FILE)),
      projectionBoundary: "confirmed-delivery-v1",
      ...(xDeployment ? { xPageRuntimeTrust: xDeployment.runtimeTrust, sourceDatabaseIdentity: xDeployment.sourceDatabaseIdentity } : {}),
      retain: parseRetain(parsed.values.retain, env.BACKUP_RETAIN),
      onStage: (diagnostic) => {
        stage = diagnostic.stage;
        if (diagnostic.failure) failureStage = diagnostic.stage;
        process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
      }
    });
    return { ...report, elapsedMs: Date.now() - started };
  } catch (error) {
    const report = reportFromError(error, Date.now() - started);
    return { ...report, stage: report.stage ?? failureStage ?? stage };
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
