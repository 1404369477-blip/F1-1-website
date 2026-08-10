import { installNoEgressGuard } from "../src/server/vs1/no-egress.ts";
const guard = installNoEgressGuard();
try {
  const [{ ConfigError }, { runSafeCli }, { runVs1Case }] = await Promise.all([
    import("../src/server/config/env.ts"),
    import("../src/server/security/cli.ts"),
    import("../src/server/vs1/pipeline.ts")
  ]);
  await runSafeCli(() => {
    const arguments_ = process.argv.slice(2);
    if (arguments_.length !== 1 || arguments_[0] !== "--once") {
      throw new ConfigError("CLI_ARGUMENTS_FORBIDDEN", "worker:mock accepts only the exact --once argument");
    }
    const result = runVs1Case(new URL("..", import.meta.url).pathname, "VS1-HAPPY-001", () => guard.externalCalls);
    if (guard.externalCalls !== 0 || result.receipt?.externalCalls !== 0) {
      throw new ConfigError("CAPABILITY_DISABLED", "worker attempted external I/O");
    }
    for (const line of result.vops) process.stdout.write(`${JSON.stringify(line)}\n`);
    process.exitCode = result.exitCode;
  }, () => guard.externalCalls);
} finally {
  guard.restore();
}
