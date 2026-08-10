import { assertRuntimeReady } from "../src/server/health.ts";
import { runSafeCli } from "../src/server/security/cli.ts";

await runSafeCli(() => {
  assertRuntimeReady();
  process.stdout.write(`${JSON.stringify({ command: "runtime:assert-ready", status: "ready", scope: "local-only" })}\n`);
});
