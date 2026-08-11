import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createServer, request, type OutgoingHttpHeaders, type Server } from "node:http";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";

import { appRoot } from "../src/server/runtime-config.ts";
import { loadRuntimeConfig } from "../src/server/runtime-config.ts";
import { assertNoAdditionalCliArguments, runSafeCli } from "../src/server/security/cli.ts";

type ServeMode = "dev" | "start";
type StopSignal = "SIGINT" | "SIGTERM";
type StartupStage = "spawn" | "readiness" | "early_exit" | "timeout";
type NormalizedExitCode = "zero" | "nonzero" | "unavailable";
type AllowlistedSignal = StopSignal | "SIGKILL" | "other" | "none";
type ElapsedBucket = "lt_1s" | "1_to_5s" | "5_to_15s" | "gte_15s";
type ProfileLabel = "m3-shadow" | "public-synthetic" | "public-multimedia-synthetic" | "source-management-synthetic" | "unknown";

type StartupFailureReceipt = {
  stage: StartupStage;
  normalizedExitCode: NormalizedExitCode;
  allowlistedSignal: AllowlistedSignal;
  elapsedBucket: ElapsedBucket;
  readyReached: boolean;
  profileLabel: ProfileLabel;
};

const NEXT_HOSTNAME = "127.0.0.1";
const PUBLIC_PORT = 3000;
const NEXT_INTERNAL_PORT = 3001;
const STARTUP_TIMEOUT_MS = 15_000;
const READINESS_POLL_MS = 50;

function elapsedBucket(startedAt: number): ElapsedBucket {
  const elapsed = Date.now() - startedAt;
  if (elapsed < 1_000) return "lt_1s";
  if (elapsed < 5_000) return "1_to_5s";
  if (elapsed < 15_000) return "5_to_15s";
  return "gte_15s";
}

function normalizedExitCode(code: number | null): NormalizedExitCode {
  if (code === null) return "unavailable";
  return code === 0 ? "zero" : "nonzero";
}

function allowlistedSignal(signal: NodeJS.Signals | null): AllowlistedSignal {
  if (signal === "SIGINT" || signal === "SIGTERM" || signal === "SIGKILL") return signal;
  return signal === null ? "none" : "other";
}

function writeStartupFailureReceipt(receipt: StartupFailureReceipt): void {
  process.stderr.write(`${JSON.stringify(receipt)}\n`);
}

function probeLoopback(port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = connect({ host: NEXT_HOSTNAME, port });
    const finish = (ready: boolean): void => {
      socket.destroy();
      resolveProbe(ready);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function isPublicApiPath(url: string | undefined): boolean {
  if (!url?.startsWith("/")) return false;
  const pathname = new URL(url, "http://127.0.0.1").pathname;
  return pathname === "/api/public/feed" || pathname.startsWith("/api/public/stories/");
}

function isAllowedPublicReleaseRequest(method: string | undefined, url: string | undefined): boolean {
  if ((method !== "GET" && method !== "HEAD") || !url?.startsWith("/")) return false;
  const pathname = new URL(url, "http://127.0.0.1").pathname;
  return pathname === "/" ||
    pathname === "/api/health" ||
    pathname.startsWith("/stories/") ||
    pathname.startsWith("/api/public/") ||
    pathname.startsWith("/_next/static/");
}

function closeProxy(server: Server | undefined): void {
  if (!server?.listening) return;
  server.close();
  server.closeAllConnections();
}

function createFinalResponseProxy(restrictToPublicRelease: boolean): Server {
  return createServer((incoming, outgoing) => {
    if (restrictToPublicRelease && !isAllowedPublicReleaseRequest(incoming.method, incoming.url)) {
      outgoing.writeHead(404, {
        "Cache-Control": "no-store",
        "Content-Type": "application/problem+json; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      });
      outgoing.end(JSON.stringify({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        reasonCode: "PUBLIC_ROUTE_NOT_FOUND"
      }));
      return;
    }
    const headers: OutgoingHttpHeaders = { ...incoming.headers, host: `${NEXT_HOSTNAME}:${NEXT_INTERNAL_PORT}` };
    delete headers.forwarded;
    delete headers["x-forwarded-for"];
    delete headers["x-forwarded-host"];
    delete headers["x-forwarded-port"];
    delete headers["x-forwarded-proto"];

    const upstream = request({
      host: NEXT_HOSTNAME,
      port: NEXT_INTERNAL_PORT,
      method: incoming.method,
      path: incoming.url,
      headers
    }, (upstreamResponse) => {
      outgoing.statusCode = upstreamResponse.statusCode ?? 502;
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (value !== undefined) outgoing.setHeader(name, value);
      }
      if (isPublicApiPath(incoming.url)) outgoing.setHeader("Cache-Control", "no-store");
      upstreamResponse.pipe(outgoing);
    });
    upstream.once("error", () => outgoing.destroy());
    incoming.pipe(upstream);
  });
}

function exitCodeForSignal(signal: StopSignal): number {
  return signal === "SIGINT" ? 130 : 143;
}

function stopChild(child: ChildProcess, signal: StopSignal): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill(signal);
  } catch {
    // The child may already have stopped after receiving the process-group signal.
  }
}

async function runNextProcess(mode: ServeMode, profileLabel: ProfileLabel, startedAt: number): Promise<void> {
  const nextBin = fileURLToPath(import.meta.resolve("next/dist/bin/next"));
  const nextArguments = [
    nextBin,
    mode,
    appRoot,
    "--hostname",
    NEXT_HOSTNAME,
    "--port",
    String(NEXT_INTERNAL_PORT)
  ];
  const spawnOptions: SpawnOptions = {
    cwd: appRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  };

  await new Promise<void>((resolveProcess, rejectProcess) => {
    const child = spawn(process.execPath, nextArguments, spawnOptions);
    let requestedStop: StopSignal | undefined;
    let readyReached = false;
    let concluded = false;
    let probing = false;
    let proxy: Server | undefined;
    let startingProxy = false;

    const stopMonitors = (): void => {
      clearInterval(readinessPoll);
      clearTimeout(startupTimeout);
    };

    const rejectWithReceipt = (
      stage: StartupStage,
      code: number | null,
      signal: NodeJS.Signals | null
    ): void => {
      if (concluded) return;
      concluded = true;
      stopMonitors();
      closeProxy(proxy);
      writeStartupFailureReceipt({
        stage,
        normalizedExitCode: normalizedExitCode(code),
        allowlistedSignal: allowlistedSignal(signal),
        elapsedBucket: elapsedBucket(startedAt),
        readyReached,
        profileLabel
      });
      rejectProcess(new Error("CLI_INTERNAL_ERROR"));
    };

    const readinessPoll = setInterval(() => {
      if (readyReached || probing || startingProxy || concluded) return;
      probing = true;
      void probeLoopback(NEXT_INTERNAL_PORT).then((ready) => {
        probing = false;
        if (concluded || !ready) return;
        startingProxy = true;
        proxy = createFinalResponseProxy(mode === "start" && profileLabel === "public-multimedia-synthetic");
        proxy.once("error", () => {
          rejectWithReceipt("spawn", null, null);
          stopChild(child, "SIGTERM");
        });
        proxy.listen(PUBLIC_PORT, NEXT_HOSTNAME, () => {
          if (concluded) return closeProxy(proxy);
          readyReached = true;
          clearInterval(readinessPoll);
          clearTimeout(startupTimeout);
        });
      });
    }, READINESS_POLL_MS);

    const startupTimeout = setTimeout(() => {
      if (readyReached || concluded) return;
      rejectWithReceipt("timeout", null, null);
      stopChild(child, "SIGTERM");
    }, STARTUP_TIMEOUT_MS);

    // Next owns its normal banner and failure diagnostics. Both streams stay behind
    // this boundary so an unexpected startup/listen/import failure cannot bypass
    // runSafeCli's single allowlisted error envelope.
    child.stdout?.resume();
    child.stderr?.resume();

    const forwardSignal = (signal: StopSignal): void => {
      requestedStop ??= signal;
      closeProxy(proxy);
      stopChild(child, signal);
    };
    const onSigint = (): void => forwardSignal("SIGINT");
    const onSigterm = (): void => forwardSignal("SIGTERM");
    const removeSignalHandlers = (): void => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };

    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    child.once("error", () => {
      removeSignalHandlers();
      rejectWithReceipt("spawn", null, null);
    });
    child.once("exit", (code, signal) => {
      removeSignalHandlers();
      if (requestedStop !== undefined) {
        concluded = true;
        stopMonitors();
        closeProxy(proxy);
        process.exitCode = exitCodeForSignal(requestedStop);
        resolveProcess();
        return;
      }
      rejectWithReceipt("early_exit", code, signal);
    });
  });
}

const mode = process.argv[2] as ServeMode | undefined;

await runSafeCli(async () => {
  const startedAt = Date.now();
  if (mode !== "dev" && mode !== "start") {
    throw new Error("CLI_INTERNAL_ERROR");
  }
  assertNoAdditionalCliArguments(process.argv.slice(3));
  let profileLabel: ProfileLabel = "unknown";
  try {
    const config = loadRuntimeConfig();
    if (config.dataProfile === "source-management-synthetic") {
      const { installNoEgressGuard } = await import("../src/server/vs1/no-egress.ts");
      const guard = installNoEgressGuard();
      const { assertRuntimeReady } = await import("../src/server/health.ts");
      profileLabel = assertRuntimeReady({ config }).dataProfile;
      const { runSourceManagementServer } = await import("../src/server/source-management/server.ts");
      await runSourceManagementServer(config, guard);
      return;
    }
    const { assertRuntimeReady } = await import("../src/server/health.ts");
    profileLabel = assertRuntimeReady({ config }).dataProfile;
  } catch (error) {
    writeStartupFailureReceipt({
      stage: "readiness",
      normalizedExitCode: "unavailable",
      allowlistedSignal: "none",
      elapsedBucket: elapsedBucket(startedAt),
      readyReached: false,
      profileLabel
    });
    throw error;
  }

  Object.assign(process.env, {
    NODE_ENV: mode === "dev" ? "development" : "production",
    NEXT_RUNTIME: "nodejs",
    NEXT_PRIVATE_START_TIME: Date.now().toString()
  });
  await runNextProcess(mode, profileLabel, startedAt);
});
