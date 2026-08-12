import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { RawAdminContext } from "../source-management/security.ts";
import { asReviewRealError, ReviewRealError } from "../review-real/error.ts";
import type { ProjectionReceiver } from "../review-real/projection.ts";
import type { ReviewAdminRoutes } from "../review-real/routes.ts";
import type { ReviewAdminSecurity } from "../review-real/security.ts";
import {
  AdminPasskeyAuth,
  type AdminTrustedIdentity
} from "./auth.ts";

export const ADMIN_BIND_HOST = "127.0.0.1" as const;
export const ADMIN_BIND_PORT = 3101 as const;
const AUTH_BODY_LIMIT = 128 * 1024;
const REVIEW_BODY_LIMIT = 64 * 1024;
const PROJECTION_BODY_LIMIT = 2 * 1024 * 1024;

export type TrustedTailnetIdentity = Readonly<{
  login: string;
  operatorRef: string;
  deviceRefs: readonly string[];
}>;

export type AdminServiceDependencies = Readonly<{
  canonicalOrigin: string;
  trustedIdentities: readonly TrustedTailnetIdentity[];
  auth: AdminPasskeyAuth;
  reviewRoutes: ReviewAdminRoutes;
  security: ReviewAdminSecurity;
  projectionReceiver: ProjectionReceiver;
  staticRoot: string;
}>;

type RequestEnvelope = Readonly<{
  context: RawAdminContext;
  identity: AdminTrustedIdentity;
}>;

function headersMap(rawHeaders: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = String(rawHeaders[index] ?? "").toLowerCase();
    const value = String(rawHeaders[index + 1] ?? "");
    const values = map.get(name) ?? [];
    values.push(value);
    map.set(name, values);
  }
  return map;
}

function single(map: ReadonlyMap<string, readonly string[]>, name: string): string | null {
  const values = map.get(name) ?? [];
  return values.length === 1 ? values[0] : null;
}

function identityRef(kind: "tailnet-user" | "device", value: string): string {
  return `${kind}-${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16)}`;
}

function normalizePeer(value: string | undefined): "loopback" | null {
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1"
    ? "loopback"
    : null;
}

function requestEnvelope(request: IncomingMessage, dependencies: AdminServiceDependencies): RequestEnvelope {
  const rawHeaders = headersMap(request.rawHeaders);
  const peer = normalizePeer(request.socket.remoteAddress);
  const origin = new URL(dependencies.canonicalOrigin);
  const target = request.url ?? "";
  const method = String(request.method ?? "").toUpperCase();
  if (
    peer === null ||
    request.httpVersion !== "1.1" ||
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.includes("?") ||
    target.includes("#") ||
    target.includes("\\") ||
    target.includes("%") ||
    target.split("/").some((segment) => segment === "." || segment === "..") ||
    !["GET", "HEAD", "POST"].includes(method)
  ) {
    throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
  }
  const host = single(rawHeaders, "host");
  if (host !== origin.host || single(rawHeaders, ":authority") !== null) {
    throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
  }
  const forwardedProto = single(rawHeaders, "x-forwarded-proto");
  const forwardedHost = single(rawHeaders, "x-forwarded-host");
  if (
    (forwardedProto !== null && forwardedProto !== "https") ||
    (forwardedHost !== null && forwardedHost !== origin.host)
  ) {
    throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
  }
  for (const name of rawHeaders.keys()) {
    if (
      (name === "forwarded" || name === "x-real-ip" || name.startsWith("x-forwarded-")) &&
      name !== "x-forwarded-proto" &&
      name !== "x-forwarded-host"
    ) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    }
  }
  const login = single(rawHeaders, "tailscale-user-login");
  const requestedDevice = single(rawHeaders, "x-f1-approved-device-ref");
  const approved = dependencies.trustedIdentities.find((candidate) => candidate.login === login);
  if (!approved || requestedDevice === null || !approved.deviceRefs.includes(requestedDevice)) {
    throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
  }
  const originHeader = single(rawHeaders, "origin");
  if (
    method === "POST" && (
      originHeader !== dependencies.canonicalOrigin ||
      single(rawHeaders, "sec-fetch-site") !== "same-origin" ||
      single(rawHeaders, "content-type") !== "application/json"
    )
  ) {
    throw new ReviewRealError("ADMIN_ORIGIN_REJECTED", 403);
  }
  return {
    context: Object.freeze({
      method,
      path: target,
      authority: host,
      origin: originHeader,
      peer,
      rawHeaders,
      noEgressReady: true as const
    }),
    identity: Object.freeze({
      operatorRef: approved.operatorRef,
      deviceRef: identityRef("device", requestedDevice),
      tailnetUserRef: identityRef("tailnet-user", approved.login)
    })
  };
}

function securityHeaders(contentType: string): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000",
    "X-Content-Type-Options": "nosniff",
    "Content-Type": contentType
  };
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  setCookie?: string
): void {
  response.statusCode = status;
  for (const [name, value] of Object.entries(securityHeaders("application/json; charset=utf-8"))) {
    response.setHeader(name, value);
  }
  if (setCookie) response.setHeader("Set-Cookie", setCookie);
  response.end(JSON.stringify(body));
}

function writeError(response: ServerResponse, error: unknown): void {
  const failure = asReviewRealError(error);
  writeJson(response, failure.status, {
    schemaVersion: "admin-service-error-v1",
    reasonCode: failure.reasonCode
  });
}

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > limit) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 413);
    chunks.push(bytes);
  }
  if (size === 0) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  }
}

function staticFile(path: string, staticRoot: string): Readonly<{ path: string; type: string }> | null {
  if (path === "/admin/reviews" || path === "/admin/reviews/") {
    return { path: join(staticRoot, "index.html"), type: "text/html; charset=utf-8" };
  }
  if (path === "/admin/assets/app.css") {
    return { path: join(staticRoot, "app.css"), type: "text/css; charset=utf-8" };
  }
  if (path === "/admin/assets/app.js") {
    return { path: join(staticRoot, "app.js"), type: "text/javascript; charset=utf-8" };
  }
  return null;
}

export function adminServiceOwnsPath(path: string): boolean {
  return (
    staticFile(path, "/unused") !== null ||
    path.startsWith("/api/admin/") ||
    path === "/internal/projections" ||
    /^\/internal\/projections\/receipts\/[^/]+$/.test(path)
  );
}

function serveStatic(response: ServerResponse, method: string, path: string, staticRoot: string): boolean {
  const target = staticFile(path, resolve(staticRoot));
  if (target === null) return false;
  if (!existsSync(target.path)) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
  const stat = lstatSync(target.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  response.statusCode = 200;
  for (const [name, value] of Object.entries(securityHeaders(target.type))) response.setHeader(name, value);
  response.setHeader("Content-Length", String(stat.size));
  response.end(method === "HEAD" ? undefined : readFileSync(target.path));
  return true;
}

function routeSegment(path: string, pattern: RegExp): string | null {
  const match = pattern.exec(path);
  if (!match || match[1].length < 1 || match[1].length > 256) return null;
  return match[1];
}

async function dispatch(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: AdminServiceDependencies
): Promise<void> {
  const { context, identity } = requestEnvelope(request, dependencies);
  if ((context.method === "GET" || context.method === "HEAD") && serveStatic(
    response,
    context.method,
    context.path,
    dependencies.staticRoot
  )) return;
  if (context.method === "POST" && context.path === "/api/admin/auth/bootstrap/options") {
    writeJson(response, 200, await dependencies.auth.bootstrapOptions(identity, await readJson(request, AUTH_BODY_LIMIT)));
    return;
  }
  if (context.method === "POST" && context.path === "/api/admin/auth/bootstrap/verify") {
    writeJson(response, 201, await dependencies.auth.bootstrapVerify(identity, await readJson(request, AUTH_BODY_LIMIT)));
    return;
  }
  if (context.method === "POST" && context.path === "/api/admin/auth/login/options") {
    writeJson(response, 200, await dependencies.auth.loginOptions(identity, await readJson(request, AUTH_BODY_LIMIT)));
    return;
  }
  if (context.method === "POST" && context.path === "/api/admin/auth/login/verify") {
    const result = await dependencies.auth.loginVerify(identity, await readJson(request, AUTH_BODY_LIMIT));
    writeJson(response, 200, result.body, result.setCookie);
    return;
  }
  if (context.method === "POST" && context.path === "/api/admin/auth/fresh/options") {
    writeJson(response, 200, await dependencies.auth.freshOptions(context, identity, await readJson(request, REVIEW_BODY_LIMIT)));
    return;
  }
  if (context.method === "POST" && context.path === "/api/admin/auth/fresh/verify") {
    const result = await dependencies.auth.freshVerify(context, identity, await readJson(request, AUTH_BODY_LIMIT));
    writeJson(response, 200, result.body, result.setCookie);
    return;
  }
  if (context.method === "POST" && context.path === "/internal/projections") {
    const receipt = dependencies.projectionReceiver.receive(await readJson(request, PROJECTION_BODY_LIMIT));
    writeJson(response, 200, receipt);
    return;
  }
  const internalReceipt = routeSegment(context.path, /^\/internal\/projections\/receipts\/([^/]+)$/);
  if (context.method === "GET" && internalReceipt !== null) {
    writeJson(response, 200, dependencies.projectionReceiver.getReceipt(internalReceipt));
    return;
  }
  const adminDelivery = routeSegment(context.path, /^\/api\/admin\/deliveries\/([^/]+)$/);
  if (context.method === "GET" && adminDelivery !== null) {
    dependencies.security.authorizeBoundIdentity(context, identity);
    writeJson(response, 200, dependencies.projectionReceiver.getReceipt(adminDelivery));
    return;
  }
  if (context.path.startsWith("/api/admin/")) {
    dependencies.security.authorizeBoundIdentity(context, identity);
    const body = context.method === "POST" ? await readJson(request, REVIEW_BODY_LIMIT) : undefined;
    const result = dependencies.reviewRoutes.handle(context, body);
    writeJson(response, result.status, result.body);
    return;
  }
  throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
}

export function createAdminServiceServer(dependencies: AdminServiceDependencies): Server {
  const canonicalOrigin = new URL(dependencies.canonicalOrigin);
  if (
    canonicalOrigin.protocol !== "https:" ||
    canonicalOrigin.pathname !== "/" ||
    canonicalOrigin.search ||
    canonicalOrigin.hash ||
    dependencies.trustedIdentities.length < 1
  ) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const server = createServer((request, response) => {
    request.setTimeout(10_000, () => request.destroy(new Error("ADMIN_REQUEST_TIMEOUT")));
    void dispatch(request, response, dependencies).catch((error) => {
      if (!response.headersSent) writeError(response, error);
      else response.destroy();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}

export async function listenAdminService(server: Server): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error): void => rejectListen(error);
    server.once("error", onError);
    server.listen(ADMIN_BIND_PORT, ADMIN_BIND_HOST, () => {
      server.off("error", onError);
      const address = server.address();
      if (
        address === null ||
        typeof address === "string" ||
        address.address !== ADMIN_BIND_HOST ||
        address.port !== ADMIN_BIND_PORT
      ) {
        rejectListen(new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500));
        return;
      }
      resolveListen();
    });
  });
}
