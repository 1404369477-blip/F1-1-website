import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { AppConfig } from "../config/env.ts";
import type { NoEgressGuard } from "../vs1/no-egress.ts";
import { handleAdminRequest } from "./http.ts";
import { runWithRawAdminContext } from "./raw-context.ts";
import { assertRawAdminRequest } from "./security.ts";
import { closeSourceManagementRuntime, initializeSourceManagementRuntime } from "./runtime.ts";
import { AdminError, type AdminHttpResult } from "./types.ts";

const MAX_BODY = 16 * 1024;

export type SourceManagementServerHooks = Readonly<{
  initializeRuntime?: (guard: NoEgressGuard) => void;
  closeRuntime?: () => void;
  onListening?: () => void;
}>;

function securityHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store, private",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Type": "application/problem+json; charset=utf-8"
  };
}

function writeResult(response: ServerResponse, result: AdminHttpResult): void {
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers ?? securityHeaders())) response.setHeader(name, value as string | readonly string[]);
  response.end(result.body === undefined ? undefined : JSON.stringify(result.body));
}

function denied(error: unknown): AdminHttpResult {
  const failure = error instanceof AdminError ? error : new AdminError("ADMIN_INTERNAL_FAILURE", 500);
  return {
    status: failure.status,
    headers: securityHeaders(),
    body: { type: `urn:f1plus1:problem:${failure.reasonCode}`, title: "Admin request rejected", status: failure.status, reasonCode: failure.reasonCode }
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_BODY) throw new AdminError("ADMIN_BODY_TOO_LARGE", 413);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runSourceManagementServer(
  config: AppConfig,
  guard: NoEgressGuard,
  hooks: SourceManagementServerHooks = {}
): Promise<void> {
  const initializeRuntime = hooks.initializeRuntime ?? initializeSourceManagementRuntime;
  const closeRuntime = hooks.closeRuntime ?? closeSourceManagementRuntime;
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const context = assertRawAdminRequest(request, config.publicOrigin, guard.externalCalls === 0);
        const rawBody = request.method === "GET" ? "" : await readBody(request);
        const result = await runWithRawAdminContext(context, () => handleAdminRequest(context, request.url ?? context.path, rawBody));
        writeResult(response, result);
      } catch (error) {
        writeResult(response, denied(error));
      }
    })();
  });
  let resolveStop: (() => void) | undefined;
  let stopFailure: AdminError | undefined;
  const stopPromise = new Promise<void>((resolve) => { resolveStop = resolve; });
  const stop = (): void => resolveStop?.();
  const removeViolationHandler = guard.onViolation(() => {
    stopFailure ??= new AdminError("ADMIN_NO_EGRESS_REQUIRED", 503);
    stop();
  });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let lifecycleFailure: unknown;
  try {
    initializeRuntime(guard);
    await guard.listenExactLoopback(server, { host: config.bindHost, port: config.port });
    hooks.onListening?.();
    await stopPromise;
  } catch (error) {
    lifecycleFailure = error;
  }
  let cleanupFailure: unknown;
  if (server.listening) {
    try {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error?: Error): void => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
        server.closeAllConnections();
      });
    } catch (error) {
      cleanupFailure ??= error;
    }
  }
  try { closeRuntime(); } catch (error) { cleanupFailure ??= error; }
  try { guard.restore(); } catch (error) { cleanupFailure ??= error; }
  removeViolationHandler();
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  if (stopFailure || guard.externalCalls !== 0) {
    throw stopFailure ?? new AdminError("ADMIN_NO_EGRESS_REQUIRED", 503);
  }
  if (lifecycleFailure !== undefined) throw lifecycleFailure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
}
