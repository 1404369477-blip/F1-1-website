import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadAppConfig, type EnvRecord } from "../server/config/env";

const appRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const projectRoot = resolve(appRoot, "..");
const npmCli = process.env.npm_execpath;

function canonicalEnv(profile: "m3-shadow" | "public-synthetic"): EnvRecord {
  const publicProfile = profile === "public-synthetic";
  return {
    APP_ENV: "test",
    APP_PORT: "3010",
    APP_BIND_HOST: "127.0.0.1",
    APP_PUBLIC_ORIGIN: "http://127.0.0.1:3010",
    F1_DATA_PROFILE: profile,
    F1_DB_PATH: publicProfile ? ".local/f1plus1-public-synthetic.sqlite" : ".local/f1plus1.sqlite",
    SOURCE_CONFIG_PROVIDER: "fixture",
    SOURCE_FIXTURE_PATH: publicProfile
      ? "../data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json"
      : "../data/m3-base-shadow-import-v0/main-source-record-batch.json",
    ADAPTER_MODE: "mock",
    SUMMARY_MODE: "fixture",
    MEDIA_MODE: "fixture",
    PUBLISH_MODE: "manual_only",
    REAL_FEISHU_IO: "false",
    REAL_EXTERNAL_IO: "false",
    REAL_FORM_SUBMIT: "false",
    ADMIN_ACCESS_MODE: "local_dev_only",
    LOG_LEVEL: "info"
  };
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolveListening) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (result: boolean): void => {
      socket.destroy();
      resolveListening(result);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

describe("real CLI canonical database boundary", () => {
  it("keeps both canonical profile configurations available", () => {
    expect(loadAppConfig(canonicalEnv("m3-shadow"), { appRoot, projectRoot }).dbPath).toBe(".local/f1plus1.sqlite");
    expect(loadAppConfig(canonicalEnv("public-synthetic"), { appRoot, projectRoot }).dbPath).toBe(
      ".local/f1plus1-public-synthetic.sqlite"
    );
  });

  it("rejects NODE_ENV=test random database overrides before writes or listening", async () => {
    if (!npmCli) throw new Error("npm_execpath is required");
    expect(await listening(3000)).toBe(false);
    expect(await listening(3101)).toBe(false);
    for (const script of ["db:migrate", "runtime:assert-ready", "start"] as const) {
      const relativePath = `.local/p1-profile-override-${randomUUID()}.sqlite`;
      const absolutePath = resolve(appRoot, relativePath);
      const result = spawnSync(process.execPath, [npmCli, "--silent", "run", script], {
        cwd: appRoot,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          HOME: process.env.HOME,
          NODE_ENV: "test",
          PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
          TMPDIR: process.env.TMPDIR,
          NEXT_TELEMETRY_DISABLED: "1",
          F1_DB_PATH: relativePath
        }
      });
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      const lines = result.stderr.trim().split("\n");
      const envelopeIndex = script === "start" ? 1 : 0;
      if (script === "start") {
        // serve.ts emits a structured startup-failure receipt before the runSafeCli envelope.
        expect(lines).toHaveLength(2);
        const receipt = JSON.parse(lines[0]) as Record<string, unknown>;
        expect(Object.keys(receipt).sort()).toEqual(
          ["allowlistedSignal", "elapsedBucket", "normalizedExitCode", "profileLabel", "readyReached", "stage"].sort()
        );
      } else {
        expect(lines).toHaveLength(1);
      }
      expect(lines[envelopeIndex]).toBe(
        JSON.stringify({ event: "cli_failure", status: "rejected", reasonCode: "DB_PATH", externalCalls: 0 })
      );
      expect(`${result.stdout}${result.stderr}`).not.toMatch(
        /(?:\/Users\/|\/private\/|file:\/\/|https?:\/\/|\bError:|\bat\s+\S+|:\d+:\d+|super-secret)/
      );
      for (const path of [absolutePath, `${absolutePath}-wal`, `${absolutePath}-shm`, `${absolutePath}-journal`]) {
        expect(existsSync(path), `${script} created ${path}`).toBe(false);
      }
    }
    expect(await listening(3000)).toBe(false);
    expect(await listening(3101)).toBe(false);
  });
});
