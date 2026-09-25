import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runCycle } from "../src/server/lean/cycle.ts";

async function main(): Promise<void> {
  process.umask(0o077);
  const report = await runCycle();
  if (report === null) {
    process.stdout.write(`${JSON.stringify({ status: "SKIPPED_ANOTHER_CYCLE_RUNNING", at: new Date().toISOString() })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.sources.ok === 0 || report.site.reason.startsWith("PUBLISH_FAILED") || report.backup.error !== null || report.media.error !== null) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ status: "FAILED", at: new Date().toISOString(), reason: error instanceof Error ? error.message.slice(0, 300) : "UNKNOWN" })}\n`);
    process.exitCode = 1;
  });
}
