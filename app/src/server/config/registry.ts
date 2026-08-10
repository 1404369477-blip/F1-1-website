import type { AppConfig } from "./env.ts";
import { ConfigError } from "./env.ts";
import { CAPABILITY_REGISTRY } from "./capabilities.ts";

export { CAPABILITY_REGISTRY } from "./capabilities.ts";

export type CapabilitySnapshot = {
  localOnly: true;
  externalCalls: 0;
  sourceProvider: "fixture";
  adapter: "mock";
  summary: "fixture";
  media: "fixture" | "none";
  publication: "manual_only";
};

export function assertCapabilityRegistry(config: AppConfig): CapabilitySnapshot {
  if (
    config.sourceProvider !== "fixture" ||
    config.adapterMode !== "mock" ||
    config.summaryMode !== "fixture" ||
    config.publishMode !== "manual_only" ||
    (config.mediaMode !== "fixture" && config.mediaMode !== "none") ||
    config.realFeishuIo !== false ||
    config.realExternalIo !== false ||
    config.realFormSubmit !== false
  ) {
    throw new ConfigError("CAPABILITY_REGISTRY", "runtime capability intersection is empty");
  }
  return {
    localOnly: true,
    externalCalls: 0,
    sourceProvider: "fixture",
    adapter: "mock",
    summary: "fixture",
    media: config.mediaMode,
    publication: "manual_only"
  };
}

export function getCapabilityRegistry(): typeof CAPABILITY_REGISTRY {
  return CAPABILITY_REGISTRY;
}
