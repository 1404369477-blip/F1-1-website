import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { asReviewRealError, ReviewRealError } from "./error.ts";
import type { ProjectionReceiver } from "./projection.ts";

export const PROJECTION_INTERNAL_HOST = "127.0.0.1" as const;
export const PROJECTION_INTERNAL_PORT = 3102 as const;
export const PROJECTION_INTERNAL_ENDPOINT = "http://127.0.0.1:3102/internal/projections" as const;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;

function header(request: IncomingMessage, name: string): string | null {
  const values = request.rawHeaders.reduce<string[]>((all, value, index, raw) => {
    if (index % 2 === 0 && value.toLowerCase() === name) all.push(String(raw[index + 1] ?? ""));
    return all;
  }, []);
  return values.length === 1 ? values[0] : null;
}

function loopback(value: string | undefined): boolean {
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_PACKAGE_BYTES) throw new ReviewRealError("PROJECTION_REQUEST_INVALID", 413);
    chunks.push(bytes);
  }
  if (size === 0) throw new ReviewRealError("PROJECTION_REQUEST_INVALID", 400);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new ReviewRealError("PROJECTION_REQUEST_INVALID", 400); }
}

function write(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

export function createProjectionReceiverServer(input: Readonly<{
  receiver: ProjectionReceiver;
  senderServiceIdentity: string;
}>): Server {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(input.senderServiceIdentity)) {
    throw new Error("PROJECTION_RECEIVER_CONFIG_INVALID");
  }
  const server = createServer((request, response) => {
    request.setTimeout(10_000, () => request.destroy(new Error("PROJECTION_REQUEST_TIMEOUT")));
    void (async () => {
      const method = String(request.method ?? "").toUpperCase();
      const path = request.url ?? "";
      if (
        !loopback(request.socket.remoteAddress) ||
        request.httpVersion !== "1.1" ||
        header(request, "host") !== "127.0.0.1:3102" ||
        header(request, "x-f1-service-identity") !== input.senderServiceIdentity ||
        header(request, "forwarded") !== null ||
        request.rawHeaders.some((value, index) => index % 2 === 0 && value.toLowerCase().startsWith("x-forwarded-")) ||
        path.includes("?") || path.includes("#") || path.includes("%") || path.includes("\\")
      ) throw new ReviewRealError("PROJECTION_REQUEST_INVALID", 404);
      if (method === "POST" && path === "/internal/projections") {
        if (header(request, "content-type") !== "application/json") {
          throw new ReviewRealError("PROJECTION_REQUEST_INVALID", 415);
        }
        write(response, 200, input.receiver.receive(await jsonBody(request)));
        return;
      }
      const receipt = /^\/internal\/projections\/receipts\/(op-snapshot-[0-9a-f]{64})$/.exec(path);
      if (method === "GET" && receipt) {
        write(response, 200, input.receiver.getReceipt(receipt[1]));
        return;
      }
      throw new ReviewRealError("PROJECTION_REQUEST_INVALID", 404);
    })().catch((error) => {
      if (response.headersSent) { response.destroy(); return; }
      const failure = asReviewRealError(error);
      write(response, failure.status, { schemaVersion: "projection-internal-error-v1", reasonCode: failure.reasonCode });
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

export async function listenProjectionReceiver(server: Server): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error): void => rejectListen(error);
    server.once("error", onError);
    server.listen(PROJECTION_INTERNAL_PORT, PROJECTION_INTERNAL_HOST, () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string" || address.address !== PROJECTION_INTERNAL_HOST || address.port !== PROJECTION_INTERNAL_PORT) {
        rejectListen(new Error("PROJECTION_LISTENER_INVALID"));
      } else resolveListen();
    });
  });
}
