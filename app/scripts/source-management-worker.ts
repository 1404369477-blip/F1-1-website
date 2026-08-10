import { assertNoAdditionalCliArguments, runSafeCli } from "../src/server/security/cli.ts";

await runSafeCli(async () => {
  assertNoAdditionalCliArguments(process.argv.slice(2));
  const { installNoEgressGuard } = await import("../src/server/vs1/no-egress.ts");
  const guard = installNoEgressGuard();
  const { initializeSourceManagementRuntime, closeSourceManagementRuntime } = await import("../src/server/source-management/runtime.ts");
  try {
    const runtime = initializeSourceManagementRuntime(guard);
    const acquired = runtime.repository.runActivationWorker("success");
    process.stdout.write(`${JSON.stringify({
      command: "worker:source-mock",
      outcome: acquired ? "settled" : "no_work",
      attempt: acquired?.attempt ?? 0,
      externalCalls: guard.externalCalls
    })}\n`);
  } finally {
    closeSourceManagementRuntime();
  }
});
