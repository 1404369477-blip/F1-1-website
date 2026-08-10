import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createConnection, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const npmCli = process.env.npm_execpath;

type CommandResult = SpawnSyncReturns<string>;

function childEnvironment(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    NODE_ENV: "test",
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    TMPDIR: process.env.TMPDIR,
    NEXT_TELEMETRY_DISABLED: "1",
    ...overrides
  };
}

function runNpmScript(
  script: string,
  arguments_: readonly string[] = [],
  env: Record<string, string | undefined> = {},
  cwd = appRoot
): CommandResult {
  if (!npmCli) throw new Error("npm_execpath is required for subprocess acceptance tests");
  return spawnSync(
    process.execPath,
    [npmCli, "--silent", "run", script, ...(arguments_.length === 0 ? [] : ["--", ...arguments_])],
    {
      cwd,
      encoding: "utf8",
      env: childEnvironment(env),
      timeout: 30_000
    }
  );
}

const STARTUP_RECEIPT_KEYS = ["allowlistedSignal", "elapsedBucket", "normalizedExitCode", "profileLabel", "readyReached", "stage"];

function assertSafeFailure(
  result: CommandResult,
  reasonCode: string,
  options: { startupReceipt?: boolean } = {}
): void {
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.signal).toBeNull();
  expect(result.stdout).toBe("");
  const lines = result.stderr.trim().split("\n");
  const envelopeIndex = options.startupReceipt ? 1 : 0;
  if (options.startupReceipt) {
    // serve.ts emits a structured startup-failure receipt before the runSafeCli envelope.
    expect(lines).toHaveLength(2);
    const receipt = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(Object.keys(receipt).sort()).toEqual([...STARTUP_RECEIPT_KEYS].sort());
  } else {
    expect(lines).toHaveLength(1);
  }
  expect(lines[envelopeIndex]).toBe(
    JSON.stringify({
      event: "cli_failure",
      status: "rejected",
      reasonCode,
      externalCalls: 0
    })
  );
  const parsed = JSON.parse(lines[envelopeIndex]) as Record<string, unknown>;
  expect(Object.keys(parsed)).toEqual(["event", "status", "reasonCode", "externalCalls"]);
  expect(`${result.stdout}${result.stderr}`).not.toMatch(
    /(?:\/Users\/|\/private\/|file:\/\/|https?:\/\/|\bError:|\bat\s+\S+|:\d+:\d+|super-secret)/
  );
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolveListening) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (listening: boolean): void => {
      socket.destroy();
      resolveListening(listening);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function databaseSidecars(absolutePath: string): readonly string[] {
  return [absolutePath, `${absolutePath}-wal`, `${absolutePath}-shm`, `${absolutePath}-journal`];
}

function removeDatabase(absolutePath: string): void {
  for (const path of databaseSidecars(absolutePath)) rmSync(path, { force: true });
}

function createReadyRuntime(cwd = appRoot): { relativePath: string; cleanup: () => void } {
  const relativePath = ".local/f1plus1.sqlite";
  const absolutePath = resolve(cwd, relativePath);
  const migrate = runNpmScript("db:migrate", [], {}, cwd);
  expect(migrate.error).toBeUndefined();
  expect(migrate.status, migrate.stderr).toBe(0);
  const seed = runNpmScript("seed:fixtures", [], {}, cwd);
  expect(seed.error).toBeUndefined();
  expect(seed.status, seed.stderr).toBe(0);
  return {
    relativePath,
    cleanup: () => removeDatabase(absolutePath)
  };
}

function createIsolatedApp(includeBuild: boolean): { appPath: string; cleanup: () => void } {
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), "f1plus1-p1-next-"));
  const isolatedApp = resolve(temporaryRoot, "app");
  const excludedTopLevel = new Set([".local", ".next", "node_modules", ".env"]);
  cpSync(appRoot, isolatedApp, {
    recursive: true,
    filter: (source) => {
      const pathFromRoot = relative(appRoot, source);
      const topLevel = pathFromRoot.split(sep)[0];
      return pathFromRoot === "" || !excludedTopLevel.has(topLevel);
    }
  });
  symlinkSync(resolve(appRoot, "node_modules"), resolve(isolatedApp, "node_modules"), "dir");

  const dataRoot = resolve(temporaryRoot, "data");
  mkdirSync(dataRoot, { recursive: true });
  for (const directory of ["m3-base-shadow-import-v0", "m4-vs0-seed-enrichment-v0", "mvp-contract-v0"]) {
    cpSync(resolve(appRoot, `../data/${directory}`), resolve(dataRoot, directory), { recursive: true });
  }
  if (includeBuild) {
    const nextPath = resolve(appRoot, ".next");
    expect(existsSync(nextPath)).toBe(true);
    cpSync(nextPath, resolve(isolatedApp, ".next"), { recursive: true });
  }
  return {
    appPath: isolatedApp,
    cleanup: () => rmSync(temporaryRoot, { force: true, recursive: true })
  };
}

function occupyLoopbackPort(port: number): Promise<Server> {
  return new Promise((resolveServer, rejectServer) => {
    const server = createServer();
    server.once("error", rejectServer);
    server.listen(port, "127.0.0.1", () => resolveServer(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

describe("P1 dev/start argv boundary", () => {
  it.each([
    ["dev", ["--port", "3101"]],
    ["dev", ["--hostname", "0.0.0.0"]],
    ["dev", ["positional"]],
    ["start", ["--port", "3101"]],
    ["start", ["--hostname", "0.0.0.0"]],
    ["start", ["positional"]]
  ])("rejects npm run %s -- %j before listening", async (script, arguments_) => {
    expect(await isPortListening(3000)).toBe(false);
    expect(await isPortListening(3101)).toBe(false);
    const result = runNpmScript(script, arguments_);
    assertSafeFailure(result, "CLI_ARGUMENTS_FORBIDDEN");
    expect(await isPortListening(3000)).toBe(false);
    expect(await isPortListening(3101)).toBe(false);
  });
});

describe("P1 stable CLI failure envelope", () => {
  it("redacts a missing runtime database failure", () => {
    const isolated = createIsolatedApp(false);
    const canonicalPath = resolve(isolated.appPath, ".local/f1plus1.sqlite");
    try {
      expect(existsSync(canonicalPath)).toBe(false);
      assertSafeFailure(runNpmScript("runtime:assert-ready", [], {}, isolated.appPath), "HEALTH_DB_MISSING");
      expect(existsSync(canonicalPath)).toBe(false);
    } finally {
      isolated.cleanup();
    }
  });

  it("redacts forbidden environment names and secret values", () => {
    assertSafeFailure(runNpmScript("verify:env", [], { FEISHU_TOKEN: "super-secret-value" }), "ENV_FORBIDDEN");
  });

  it("redacts fixture path failures", () => {
    assertSafeFailure(
      runNpmScript("verify:env", [], { SOURCE_FIXTURE_PATH: `fixtures/p1-missing-${randomUUID()}.json` }),
      "FIXTURE_PATH"
    );
  });

  it("redacts migration ledger drift and leaves no test database", () => {
    const isolated = createIsolatedApp(false);
    const relativePath = ".local/f1plus1.sqlite";
    const absolutePath = resolve(isolated.appPath, relativePath);
    const sidecars = [absolutePath, `${absolutePath}-wal`, `${absolutePath}-shm`, `${absolutePath}-journal`];
    try {
      const initial = runNpmScript("db:migrate", [], {}, isolated.appPath);
      expect(initial.error).toBeUndefined();
      expect(initial.status).toBe(0);
      const database = new DatabaseSync(absolutePath);
      try {
        database.prepare("UPDATE migration_ledger SET migration_sha256 = ? WHERE migration_id = ?").run(
          "0".repeat(64),
          "0001_local_foundation.sql"
        );
      } finally {
        database.close();
      }
      assertSafeFailure(runNpmScript("db:migrate", [], {}, isolated.appPath), "MIGRATION_DRIFT");
    } finally {
      for (const path of sidecars) rmSync(path, { force: true });
      isolated.cleanup();
    }
    expect(existsSync(absolutePath)).toBe(false);
  });
});

describe("P1 Next process output boundary", () => {
  it.each(["dev", "start"])(
    "redacts a real npm %s port-conflict failure in an isolated app copy",
    async (script) => {
      const isolated = createIsolatedApp(script === "start");
      const runtime = createReadyRuntime(isolated.appPath);
      const occupied = await occupyLoopbackPort(3000);
      try {
        assertSafeFailure(
          runNpmScript(script, [], {}, isolated.appPath),
          "CLI_INTERNAL_ERROR",
          { startupReceipt: true }
        );
      } finally {
        await closeServer(occupied);
        runtime.cleanup();
        isolated.cleanup();
      }
      expect(await isPortListening(3000)).toBe(false);
      expect(await isPortListening(3101)).toBe(false);
    }
  );

  it("redacts a real npm start missing-build failure in an isolated app copy", async () => {
    const isolated = createIsolatedApp(false);
    const runtime = createReadyRuntime(isolated.appPath);
    try {
      expect(existsSync(resolve(isolated.appPath, ".next"))).toBe(false);
      assertSafeFailure(
        runNpmScript("start", [], {}, isolated.appPath),
        "CLI_INTERNAL_ERROR",
        { startupReceipt: true }
      );
    } finally {
      runtime.cleanup();
      isolated.cleanup();
    }
    expect(await isPortListening(3000)).toBe(false);
    expect(await isPortListening(3101)).toBe(false);
  });
});
