import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";

import { describe, expect, it } from "vitest";

import type { AppConfig } from "../server/config/env";
import { runSourceManagementServer } from "../server/source-management/server";
import { assertExactLoopbackAddress, installNoEgressGuard } from "../server/vs1/no-egress";

const require = createRequire(import.meta.url);

type LookupModule = { lookup(hostname: string, options: { all: true }, callback: () => void): void };
type FullDnsModule = LookupModule & {
  Resolver: new () => { resolve4(hostname: string, callback: () => void): void };
  lookupService(address: string, port: number, callback: () => void): void;
  reverse(address: string, callback: () => void): void;
};
type ConnectModule = { connect(options: { host: string; port: number }): unknown };
type HttpModule = { get(url: string): unknown };
type SpawnModule = { spawn(command: string): unknown };
type PromiseLookupModule = {
  Resolver: new () => { resolve4(hostname: string): Promise<unknown> };
  lookup(hostname: string): Promise<unknown>;
};

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolveClose, rejectClose) => {
    server.close((error?: Error): void => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
    server.closeAllConnections();
  });
}

function listenEphemeral(server: Server, host: "127.0.0.1" | "::1" = "127.0.0.1"): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, host, () => {
      server.off("error", rejectListen);
      const address = server.address();
      if (!address || typeof address === "string") return rejectListen(new Error("TEST_LISTENER_ADDRESS"));
      resolveListen(address.port);
    });
  });
}

function config(port: number): AppConfig {
  return {
    appEnv: "test",
    port,
    bindHost: "127.0.0.1",
    publicOrigin: `http://127.0.0.1:${port}`,
    dataProfile: "source-management-synthetic",
    dbPath: ".local/f1plus1-source-management-synthetic.sqlite",
    sourceProvider: "fixture",
    fixturePath: "synthetic-test-only",
    adapterMode: "mock",
    summaryMode: "fixture",
    mediaMode: "none",
    publishMode: "manual_only",
    adminAccessMode: "local_dev_only",
    logLevel: "info",
    realFeishuIo: false,
    realExternalIo: false,
    realFormSubmit: false
  };
}

describe("source-management exact loopback no-egress capability", () => {
  it("binds one exact all-aware IPv4 listener and still denies every outbound surface", async () => {
    const probe = createServer();
    const port = await listenEphemeral(probe);
    await closeServer(probe);

    const guard = installNoEgressGuard();
    const server = createServer();
    try {
      await guard.listenExactLoopback(server, { host: "127.0.0.1", port });
      expect(server.address()).toEqual({ address: "127.0.0.1", family: "IPv4", port });
      expect(guard.externalCalls).toBe(0);

      const dns = require("node:dns") as FullDnsModule;
      const dnsPromises = require("node:dns/promises") as PromiseLookupModule;
      const net = require("node:net") as ConnectModule;
      const http = require("node:http") as HttpModule;
      const child = require("node:child_process") as SpawnModule;
      expect(() => dns.lookup("localhost", { all: true }, () => undefined)).toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(() => dnsPromises.lookup("127.0.0.1")).toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(() => net.connect({ host: "127.0.0.1", port })).toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(() => http.get(`http://127.0.0.1:${port}/`)).toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(() => globalThis.fetch(`http://127.0.0.1:${port}/`)).toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(() => child.spawn("true")).toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(() => dns.lookupService("127.0.0.1", port, () => undefined)).toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(() => dns.reverse("127.0.0.1", () => undefined)).toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(() => new dns.Resolver().resolve4("example.invalid", () => undefined)).toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(() => new dnsPromises.Resolver().resolve4("example.invalid")).toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(guard.externalCalls).toBe(10);
    } finally {
      await closeServer(server);
      guard.restore();
    }
  });

  it("binds an exact all-aware IPv6 listener and rejects the naive callback wildcard result", async () => {
    const probe = createServer();
    const port = await listenEphemeral(probe, "::1");
    await closeServer(probe);
    const guard = installNoEgressGuard();
    const server = createServer();
    try {
      await guard.listenExactLoopback(server, { host: "::1", port });
      expect(server.address()).toEqual({ address: "::1", family: "IPv6", port });
      expect(guard.externalCalls).toBe(0);
      expect(() => assertExactLoopbackAddress(
        { address: "::", family: "IPv6", port },
        { host: "127.0.0.1", port }
      )).toThrow(/EXTERNAL_IO_FORBIDDEN/);
    } finally {
      await closeServer(server);
      guard.restore();
    }
  });

  it("rejects a second guard owner without weakening the active guard", () => {
    const guard = installNoEgressGuard();
    try {
      expect(() => installNoEgressGuard()).toThrow(/EXTERNAL_IO_FORBIDDEN/);
      const dns = require("node:dns") as LookupModule;
      expect(() => dns.lookup("localhost", { all: true }, () => undefined)).toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(guard.externalCalls).toBe(1);
    } finally {
      guard.restore();
    }
    const replacement = installNoEgressGuard();
    replacement.restore();
    replacement.restore();
  });

  it("rejects concurrent, second-port and same-server reuse of the one-shot capability", async () => {
    const firstProbe = createServer();
    const firstPort = await listenEphemeral(firstProbe);
    await closeServer(firstProbe);
    const secondProbe = createServer();
    const secondPort = await listenEphemeral(secondProbe);
    await closeServer(secondProbe);
    const guard = installNoEgressGuard();
    const first = createServer();
    const second = createServer();
    try {
      const firstListen = guard.listenExactLoopback(first, { host: "127.0.0.1", port: firstPort });
      const concurrentSecond = guard.listenExactLoopback(second, { host: "127.0.0.1", port: secondPort });
      await expect(concurrentSecond)
        .rejects.toThrow(/EXTERNAL_IO_FORBIDDEN/);
      await firstListen;
      await expect(guard.listenExactLoopback(first, { host: "127.0.0.1", port: firstPort }))
        .rejects.toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(first.listening).toBe(true);
      expect(second.listening).toBe(false);
      expect(guard.externalCalls).toBe(2);
    } finally {
      await closeServer(first);
      await closeServer(second);
      guard.restore();
    }
  });

  it("cleans runtime hooks, signals and guard after a listener startup failure", async () => {
    const occupied = createServer();
    const port = await listenEphemeral(occupied);
    const guard = installNoEgressGuard();
    const events: string[] = [];
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");
    try {
      await expect(runSourceManagementServer(config(port), guard, {
        initializeRuntime: () => { events.push("runtime_open"); },
        closeRuntime: () => { events.push("runtime_close"); }
      })).rejects.toMatchObject({ code: "EADDRINUSE" });
      expect(events).toEqual(["runtime_open", "runtime_close"]);
      expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
      expect(guard.externalCalls).toBe(0);
      const unusedServer = createServer();
      await expect(guard.listenExactLoopback(unusedServer, { host: "127.0.0.1", port })).rejects.toThrow(/EXTERNAL_IO_FORBIDDEN/);
      expect(guard.externalCalls).toBe(1);
    } finally {
      await closeServer(occupied);
      guard.restore();
    }
  });

  it("closes the listener and rejects the server lifecycle after a no-egress violation", async () => {
    const probe = createServer();
    const port = await listenEphemeral(probe);
    await closeServer(probe);
    const guard = installNoEgressGuard();
    const events: string[] = [];
    let ready: (() => void) | undefined;
    const readyPromise = new Promise<void>((resolveReady) => { ready = resolveReady; });
    const originalRestore = guard.restore;
    guard.restore = () => {
      events.push("guard_restore");
      originalRestore();
    };
    const running = runSourceManagementServer(config(port), guard, {
      initializeRuntime: () => { events.push("runtime_open"); },
      closeRuntime: () => { events.push("runtime_close"); },
      onListening: () => { events.push("listening"); ready?.(); }
    });
    await readyPromise;
    expect(() => globalThis.fetch(`http://127.0.0.1:${port}/`)).toThrow(/EXTERNAL_IO_FORBIDDEN/);
    await expect(running).rejects.toMatchObject({ reasonCode: "ADMIN_NO_EGRESS_REQUIRED" });
    expect(events).toEqual(["runtime_open", "listening", "runtime_close", "guard_restore"]);
    expect(guard.externalCalls).toBe(1);
    const rebound = createServer();
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        rebound.once("error", rejectListen);
        rebound.listen(port, "127.0.0.1", () => resolveListen());
      });
    } finally {
      await closeServer(rebound);
    }
  });

  it.each(["SIGINT", "SIGTERM"] as const)("cleans in fixed order after a normal %s exit", async (signal) => {
    const probe = createServer();
    const port = await listenEphemeral(probe);
    await closeServer(probe);
    const guard = installNoEgressGuard();
    const events: string[] = [];
    let ready: (() => void) | undefined;
    const readyPromise = new Promise<void>((resolveReady) => { ready = resolveReady; });
    const originalRestore = guard.restore;
    guard.restore = () => {
      events.push("guard_restore");
      originalRestore();
    };
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");
    const running = runSourceManagementServer(config(port), guard, {
      initializeRuntime: () => { events.push("runtime_open"); },
      closeRuntime: () => { events.push("runtime_close"); },
      onListening: () => { events.push("listening"); ready?.(); }
    });
    await readyPromise;
    process.emit(signal, signal);
    await expect(running).resolves.toBeUndefined();
    expect(events).toEqual(["runtime_open", "listening", "runtime_close", "guard_restore"]);
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    expect(guard.externalCalls).toBe(0);
  });

  it("keeps a cleanup-window violation as the final nonzero exit reason", async () => {
    const probe = createServer();
    const port = await listenEphemeral(probe);
    await closeServer(probe);
    const guard = installNoEgressGuard();
    const events: string[] = [];
    let ready: (() => void) | undefined;
    const readyPromise = new Promise<void>((resolveReady) => { ready = resolveReady; });
    const originalRestore = guard.restore;
    guard.restore = () => {
      events.push("guard_restore");
      originalRestore();
    };
    const running = runSourceManagementServer(config(port), guard, {
      initializeRuntime: () => { events.push("runtime_open"); },
      closeRuntime: () => {
        events.push("runtime_close");
        try { globalThis.fetch(`http://127.0.0.1:${port}/`); } catch { events.push("cleanup_violation_caught"); }
      },
      onListening: () => { events.push("listening"); ready?.(); }
    });
    await readyPromise;
    process.emit("SIGTERM", "SIGTERM");
    await expect(running).rejects.toMatchObject({ reasonCode: "ADMIN_NO_EGRESS_REQUIRED" });
    expect(events).toEqual([
      "runtime_open",
      "listening",
      "runtime_close",
      "cleanup_violation_caught",
      "guard_restore"
    ]);
    expect(guard.externalCalls).toBe(1);
    const rebound = createServer();
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        rebound.once("error", rejectListen);
        rebound.listen(port, "127.0.0.1", () => resolveListen());
      });
    } finally {
      await closeServer(rebound);
    }
  });
});
