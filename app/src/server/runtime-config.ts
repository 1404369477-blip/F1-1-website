import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_ENV_KEYS,
  ConfigError,
  loadAppConfig,
  mergeCanonicalEnv,
  parseEnvText,
  verifyProcessEnvironment,
  type AppConfig,
  type EnvRecord
} from "./config/env.ts";

export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const projectRoot = resolve(appRoot, "..");

function readOptionalEnvFile(path: string): EnvRecord {
  return existsSync(path) ? parseEnvText(readFileSync(path, "utf8")) : {};
}

export function loadRuntimeConfig(): AppConfig {
  verifyProcessEnvironment(process.env);
  const example = parseEnvText(readFileSync(resolve(appRoot, ".env.example"), "utf8"));
  const local = readOptionalEnvFile(resolve(appRoot, ".env"));
  const merged = mergeCanonicalEnv(example, local, process.env);
  const canonical = Object.fromEntries(CANONICAL_ENV_KEYS.map((key) => [key, merged[key]]));
  const config = loadAppConfig(canonical, { appRoot, projectRoot, strictKeys: true });
  if (
    config.appEnv === "local" && config.dataProfile !== "source-management-synthetic" &&
    (config.bindHost !== "127.0.0.1" || config.port !== 3000 || config.publicOrigin !== "http://127.0.0.1:3000")
  ) {
    throw new ConfigError("APP_COMMAND_PROFILE", "local npm dev/start are fixed to http://127.0.0.1:3000");
  }
  return config;
}
