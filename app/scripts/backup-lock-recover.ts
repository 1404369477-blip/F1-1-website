import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { inspectBackupLock, LockRecoveryError, recoverBackupLock } from "../src/server/backup-snapshot/lock-recovery.ts";

export function runBackupLockRecoveryCli(argv: readonly string[]): Readonly<Record<string, unknown>> {
  try {
    const { values } = parseArgs({ args: [...argv], strict: true, allowPositionals: false, options: {
      "backup-root": { type: "string" }, recover: { type: "boolean", default: false },
      "expected-lock-sha256": { type: "string" }, "expected-pid": { type: "string" },
      "stop-evidence": { type: "string" }, "expected-stop-evidence-sha256": { type: "string" }
    } });
    if (!values["backup-root"]) throw new LockRecoveryError("BACKUP_ROOT_REQUIRED");
    if (!values.recover) return { ok: true, mode: "inspect", ...inspectBackupLock(values["backup-root"]) };
    if (!values["expected-lock-sha256"] || !values["expected-pid"] || !/^[1-9][0-9]*$/u.test(values["expected-pid"]) ||
      !values["stop-evidence"] || !values["expected-stop-evidence-sha256"]) throw new LockRecoveryError("RECOVERY_ARGUMENT_REQUIRED");
    return { ok: true, mode: "recover", ...recoverBackupLock({ backupRoot: values["backup-root"],
      expectedLockSha256: values["expected-lock-sha256"], expectedPid: Number(values["expected-pid"]),
      stopEvidencePath: values["stop-evidence"], expectedStopEvidenceSha256: values["expected-stop-evidence-sha256"] }) };
  } catch (error) {
    return { ok: false, reasonCode: error instanceof LockRecoveryError ? error.code : "LOCK_RECOVERY_IO_OR_ARGUMENT_FAILURE" };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = runBackupLockRecoveryCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
