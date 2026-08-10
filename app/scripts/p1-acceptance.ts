import { spawn, type ChildProcess } from "node:child_process";
import { get } from "node:http";
import { createConnection } from "node:net";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { appRoot } from "../src/server/runtime-config.ts";
import { runSafeCli } from "../src/server/security/cli.ts";

type HealthReceipt = {
  scope?: unknown;
  status?: unknown;
  reasonCode?: unknown;
  externalCalls?: unknown;
};

function childEnvironment(): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    NODE_ENV: "production",
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    TMPDIR: process.env.TMPDIR,
    NEXT_TELEMETRY_DISABLED: "1"
  };
}

function readHealth(): Promise<HealthReceipt> {
  return new Promise((resolveReceipt, reject) => {
    const request = get(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: "/api/health",
        timeout: 500
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          if (chunks.reduce((size, value) => size + value.byteLength, 0) < 64 * 1024) chunks.push(chunk);
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error("CLI_INTERNAL_ERROR"));
            return;
          }
          try {
            resolveReceipt(JSON.parse(Buffer.concat(chunks).toString("utf8")) as HealthReceipt);
          } catch {
            reject(new Error("CLI_INTERNAL_ERROR"));
          }
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("CLI_INTERNAL_ERROR")));
    request.on("error", reject);
  });
}

async function waitForReady(child: ChildProcess): Promise<HealthReceipt> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("CLI_INTERNAL_ERROR");
    try {
      return await readHealth();
    } catch {
      await delay(100);
    }
  }
  throw new Error("CLI_INTERNAL_ERROR");
}

async function stopProcessGroup(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-pid, "SIGINT");
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(100);
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The isolated child process group already stopped.
  }
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

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

async function assertStopped(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) throw new Error("CLI_INTERNAL_ERROR");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [port3000Listening, port3101Listening] = await Promise.all([
      isPortListening(3000),
      isPortListening(3101)
    ]);
    if (!port3000Listening && !port3101Listening && !processGroupExists(pid)) return;
    await delay(100);
  }
  throw new Error("CLI_INTERNAL_ERROR");
}

await runSafeCli(async () => {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("CLI_INTERNAL_ERROR");

  const child = spawn(process.execPath, [npmCli, "--silent", "run", "start"], {
    cwd: appRoot,
    detached: true,
    env: childEnvironment(),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let capturedBytes = 0;
  const capture = (chunk: Buffer): void => {
    capturedBytes += chunk.byteLength;
    if (capturedBytes > 256 * 1024) void stopProcessGroup(child);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);

  try {
    const health = await waitForReady(child);
    if (
      health.scope !== "local-only" ||
      health.status !== "ready" ||
      health.reasonCode !== "ok" ||
      health.externalCalls !== 0
    ) {
      throw new Error("CLI_INTERNAL_ERROR");
    }
  } finally {
    await stopProcessGroup(child);
    await assertStopped(child);
  }
  process.stdout.write(
    `${JSON.stringify({ command: "test:p1", status: "ok", bindHost: "127.0.0.1", port: 3000, health: "ready", signal: "SIGINT", stopped: true, portsClear: [3000, 3101], processGroupClear: true, externalCalls: 0 })}\n`
  );
});
