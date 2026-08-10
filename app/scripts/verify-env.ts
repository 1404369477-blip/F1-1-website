import { assertCapabilityRegistry } from "../src/server/config/registry.ts";
import { runSafeCli } from "../src/server/security/cli.ts";
import { createRedactedLogger } from "../src/server/security/log.ts";
import { loadRuntimeConfig } from "./runtime-config.ts";

await runSafeCli(() => {
  const config = loadRuntimeConfig();
  const capabilities = assertCapabilityRegistry(config);
  const logger = createRedactedLogger((line) => process.stdout.write(`${line}\n`));
  logger.info({
    event: "verify_env",
    status: "ok",
    capability: "fixture/mock/manual_only",
    externalCalls: capabilities.externalCalls
  });
  process.stdout.write(
    `${JSON.stringify({
      node: "24.18.0",
      appEnv: config.appEnv,
      bindHost: config.bindHost,
      port: config.port,
      provider: config.sourceProvider,
      adapter: config.adapterMode,
      publish: config.publishMode,
      externalCalls: 0
    })}\n`
  );
});
