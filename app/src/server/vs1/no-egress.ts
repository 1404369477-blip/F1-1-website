import { createRequire } from "node:module";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

type MutableModule = Record<string, unknown>;
type ExactLoopbackHost = "127.0.0.1" | "::1";
type ExactLoopbackOptions = Readonly<{ host: ExactLoopbackHost; port: number }>;
type LookupAllCallback = (error: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>) => void;
type ListenerAllowance = {
  server: Server;
  host: ExactLoopbackHost;
  port: number;
  family: 4 | 6;
  state: "armed" | "consumed";
};

let activeGuardOwner: symbol | null = null;

const DNS_CALLBACK_METHODS = [
  "lookupService",
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
  "reverse"
] as const;

const DNS_RESOLVER_METHODS = [
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
  "reverse"
] as const;

function deniedError(): Error {
  return new Error("EXTERNAL_IO_FORBIDDEN: VS1 worker permits no network or DNS calls");
}

function isLookupAllCallback(value: unknown): value is LookupAllCallback {
  return typeof value === "function";
}

function isExactAllOption(value: unknown): value is { all: true } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "all" && (value as { all?: unknown }).all === true;
}

export function assertExactLoopbackAddress(actual: unknown, expected: ExactLoopbackOptions): asserts actual is AddressInfo {
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) throw deniedError();
  const address = actual as Partial<AddressInfo>;
  const expectedFamily = expected.host === "127.0.0.1" ? "IPv4" : "IPv6";
  if (
    address.address === "0.0.0.0" || address.address === "::" ||
    address.address !== expected.host || address.family !== expectedFamily || address.port !== expected.port
  ) throw deniedError();
}

export type NoEgressGuard = {
  readonly externalCalls: number;
  listenExactLoopback(server: Server, options: ExactLoopbackOptions): Promise<void>;
  onViolation(handler: () => void): () => void;
  restore(): void;
};

export function installNoEgressGuard(): NoEgressGuard {
  if (activeGuardOwner !== null) throw deniedError();
  const owner = Symbol("no-egress-guard-owner");
  activeGuardOwner = owner;
  const require = createRequire(import.meta.url);
  const patches: Array<{ target: MutableModule; key: string; value: unknown }> = [];
  const violationHandlers = new Set<() => void>();
  let externalCalls = 0;
  let allowance: ListenerAllowance | null = null;
  let listenerCapabilityUsed = false;
  let restored = false;
  function denied(): never {
    externalCalls += 1;
    for (const handler of violationHandlers) {
      try { handler(); } catch { /* Keep the denial reason deterministic. */ }
    }
    throw deniedError();
  }
  function deniedPromise(): Promise<never> {
    try {
      denied();
    } catch (error) {
      return Promise.reject(error);
    }
  }
  const patchTarget = (target: MutableModule, keys: readonly string[]): void => {
    for (const key of keys) {
      patches.push({ target, key, value: target[key] });
      target[key] = denied;
    }
  };
  const patch = (target: MutableModule, keys: readonly string[]): MutableModule => {
    patchTarget(target, keys);
    return target;
  };
  const net = patch(require("node:net") as MutableModule, ["connect", "createConnection"]);
  const socket = net.Socket as { prototype?: MutableModule } | undefined;
  if (socket?.prototype) patchTarget(socket.prototype, ["connect"]);
  patch(require("node:http") as MutableModule, ["request", "get"]);
  patch(require("node:https") as MutableModule, ["request", "get"]);
  patch(require("node:http2") as MutableModule, ["connect"]);
  patch(require("node:tls") as MutableModule, ["connect"]);
  const dns = patch(require("node:dns") as MutableModule, DNS_CALLBACK_METHODS);
  const resolver = dns.Resolver as { prototype?: MutableModule } | undefined;
  if (resolver?.prototype) patchTarget(resolver.prototype, DNS_RESOLVER_METHODS);
  patches.push({ target: dns, key: "lookup", value: dns.lookup });
  dns.lookup = (hostname: unknown, options: unknown, callback: unknown): void => {
    const current = allowance;
    if (
      !current || current.state !== "armed" || hostname !== current.host ||
      !isExactAllOption(options) || !isLookupAllCallback(callback)
    ) denied();
    current.state = "consumed";
    const result = [{ address: current.host, family: current.family }];
    process.nextTick(() => callback(null, result));
  };
  const dnsPromises = patch(require("node:dns/promises") as MutableModule, ["lookup", ...DNS_CALLBACK_METHODS]);
  const promisesResolver = dnsPromises.Resolver as { prototype?: MutableModule } | undefined;
  if (promisesResolver?.prototype) patchTarget(promisesResolver.prototype, DNS_RESOLVER_METHODS);
  patch(require("node:dgram") as MutableModule, ["createSocket"]);
  patch(require("node:child_process") as MutableModule, ["exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync"]);
  patch(require("node:cluster") as MutableModule, ["fork"]);
  patch(require("node:worker_threads") as MutableModule, ["Worker"]);
  const previousFetch = globalThis.fetch;
  const previousWebSocket = globalThis.WebSocket;
  globalThis.fetch = denied;
  globalThis.WebSocket = denied as unknown as typeof WebSocket;
  const guard: NoEgressGuard = {
    get externalCalls() { return externalCalls; },
    listenExactLoopback(server, options) {
      if (
        restored || externalCalls !== 0 || listenerCapabilityUsed || allowance !== null || server.listening ||
        (options.host !== "127.0.0.1" && options.host !== "::1") ||
        !Number.isInteger(options.port) || options.port < 1024 || options.port > 65535
      ) return deniedPromise();
      listenerCapabilityUsed = true;
      allowance = {
        server,
        host: options.host,
        port: options.port,
        family: options.host === "127.0.0.1" ? 4 : 6,
        state: "armed"
      };
      return new Promise<void>((resolveListen, rejectListen) => {
        const fail = (error: unknown): void => {
          server.off("error", onError);
          allowance = null;
          rejectListen(error instanceof Error ? error : deniedError());
        };
        const onError = (error: Error): void => fail(error);
        server.once("error", onError);
        try {
          server.listen(options.port, options.host, () => {
            server.off("error", onError);
            const consumed = allowance?.server === server && allowance.state === "consumed";
            try {
              if (!consumed) throw deniedError();
              assertExactLoopbackAddress(server.address(), options);
              allowance = null;
              resolveListen();
            } catch (error) {
              allowance = null;
              server.closeAllConnections();
              server.close(() => fail(error));
            }
          });
        } catch (error) {
          fail(error);
        }
      });
    },
    onViolation(handler) {
      if (restored) throw deniedError();
      violationHandlers.add(handler);
      return () => violationHandlers.delete(handler);
    },
    restore() {
      if (restored) return;
      restored = true;
      allowance = null;
      violationHandlers.clear();
      try {
        for (const entry of patches.reverse()) entry.target[entry.key] = entry.value;
        globalThis.fetch = previousFetch;
        globalThis.WebSocket = previousWebSocket;
      } finally {
        if (activeGuardOwner === owner) activeGuardOwner = null;
      }
    }
  };
  return guard;
}
