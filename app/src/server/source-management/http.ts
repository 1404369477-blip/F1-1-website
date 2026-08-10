import { createHash, randomUUID } from "node:crypto";

import { canonicalSourceJson } from "../providers/source-fixture.ts";
import { sourceManagementRuntime } from "./runtime.ts";
import { canonicalBodyHash, singleRawHeader, type RawAdminContext } from "./security.ts";
import { AdminError, type AdminHttpResult } from "./types.ts";

const JSON_HEADERS = Object.freeze({
  "Cache-Control": "no-store, private",
  "Pragma": "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "application/json; charset=utf-8"
});

const PROBLEM_HEADERS = Object.freeze({ ...JSON_HEADERS, "Content-Type": "application/problem+json; charset=utf-8" });
const SOURCE_ID = /^src-(?:local-)?[a-z0-9-]{6,128}$/;
const COMMAND_ID = /^op-cmd-[a-f0-9]{64}$/;
const MUTATION_PATH = /^\/api\/admin\/sources(?:\/src-(?:local-)?[a-z0-9-]{6,128}\/(?:validate|activate|stop|retire|requeue))?$/;

function problem(error: AdminError): AdminHttpResult {
  return {
    status: error.status,
    headers: PROBLEM_HEADERS,
    body: {
      type: `urn:f1plus1:problem:${error.reasonCode}`,
      title: "Admin request rejected",
      status: error.status,
      reasonCode: error.reasonCode,
      traceId: `trace-${randomUUID()}`
    }
  };
}

function json(body: unknown, status = 200, headers: Readonly<Record<string, string | readonly string[]>> = {}): AdminHttpResult {
  return { status, headers: { ...JSON_HEADERS, ...headers }, body };
}

function parseCanonicalJson(rawBody: string): { parsed: unknown; hash: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new AdminError("ADMIN_BODY_INVALID", 400);
  }
  return { parsed, hash: canonicalBodyHash(parsed, rawBody) };
}

function cookie(context: RawAdminContext): string | null {
  return singleRawHeader(context, "cookie");
}

function csrf(context: RawAdminContext): string | null {
  return singleRawHeader(context, "x-f1-csrf-token");
}

function assertJsonContentType(context: RawAdminContext): void {
  if (singleRawHeader(context, "content-type") !== "application/json") {
    throw new AdminError("ADMIN_CONTENT_TYPE_DENIED", 415);
  }
}

function parseListQuery(url: string): {
  platform?: string;
  lifecycleStatus?: string;
  enabled?: boolean;
  onboardingStatus?: string;
  cursor?: string;
  limit?: 25 | 50 | 100;
} {
  const parsed = new URL(url, "http://127.0.0.1");
  const allowed = new Set(["platform", "lifecycle_status", "enabled", "collection_onboarding_status", "cursor", "limit"]);
  const result: ReturnType<typeof parseListQuery> = {};
  for (const key of parsed.searchParams.keys()) {
    if (!allowed.has(key) || parsed.searchParams.getAll(key).length !== 1) throw new AdminError("ADMIN_BODY_INVALID", 400);
  }
  const platform = parsed.searchParams.get("platform");
  const lifecycle = parsed.searchParams.get("lifecycle_status");
  const enabled = parsed.searchParams.get("enabled");
  const onboarding = parsed.searchParams.get("collection_onboarding_status");
  const cursor = parsed.searchParams.get("cursor");
  const limit = parsed.searchParams.get("limit");
  if (platform) result.platform = platform;
  if (lifecycle) result.lifecycleStatus = lifecycle;
  if (enabled !== null) {
    if (enabled !== "true" && enabled !== "false") throw new AdminError("ADMIN_BODY_INVALID", 400);
    result.enabled = enabled === "true";
  }
  if (onboarding) result.onboardingStatus = onboarding;
  if (cursor) result.cursor = cursor;
  if (limit !== null) {
    const value = Number(limit);
    if (value !== 25 && value !== 50 && value !== 100) throw new AdminError("ADMIN_BODY_INVALID", 400);
    result.limit = value;
  }
  return result;
}

function registeredMutationPath(path: string): boolean {
  return MUTATION_PATH.test(path) || path === "/api/admin/session/refresh" || path === "/api/admin/session" || path === "/api/admin/session";
}

export async function handleAdminRequest(
  context: RawAdminContext,
  requestUrl: string,
  rawBody: string
): Promise<AdminHttpResult> {
  try {
    const runtime = sourceManagementRuntime();
    if (runtime.guard.externalCalls !== 0) throw new AdminError("ADMIN_NO_EGRESS_REQUIRED", 503);
    const method = context.method;
    const path = context.path;

    if (method === "OPTIONS") throw new AdminError("ADMIN_METHOD_DENIED", 405);
    if (path === "/api/health" && method === "GET") {
      return json({ scope: "local-only", status: "ready", dataProfile: "source-management-synthetic", externalCalls: 0 });
    }
    if (path === "/api/admin/session" && method === "POST") {
      assertJsonContentType(context);
      const { parsed } = parseCanonicalJson(rawBody);
      if (canonicalSourceJson(parsed) !== "{}") throw new AdminError("ADMIN_BODY_INVALID", 422);
      const created = runtime.sessions.create(cookie(context));
      return json({ state: "active" }, created.status, created.setCookie ? { "Set-Cookie": created.setCookie } : {});
    }
    if (path === "/api/admin/session" && method === "GET") return json(runtime.sessions.get(cookie(context)));
    if (path === "/api/admin/csrf" && method === "POST") {
      assertJsonContentType(context);
      const { parsed } = parseCanonicalJson(rawBody);
      const binding = parsed as { body_sha256?: unknown; method?: unknown; path?: unknown };
      if (
        !binding || typeof binding !== "object" || Object.keys(binding).sort().join(",") !== "body_sha256,method,path" ||
        typeof binding.body_sha256 !== "string" || typeof binding.method !== "string" || typeof binding.path !== "string" ||
        !registeredMutationPath(binding.path)
      ) throw new AdminError("ADMIN_CSRF_INVALID", 422);
      return json(runtime.sessions.issueCsrf(cookie(context), {
        body_sha256: binding.body_sha256,
        method: binding.method,
        path: binding.path
      }, new Set([binding.path])), 201);
    }
    if (path === "/api/admin/session/refresh" && method === "POST") {
      assertJsonContentType(context);
      const { parsed, hash } = parseCanonicalJson(rawBody);
      if (canonicalSourceJson(parsed) !== "{}") throw new AdminError("ADMIN_BODY_INVALID", 422);
      runtime.sessions.consumeCsrf(cookie(context), csrf(context), { method, path, bodyHash: hash });
      const refreshed = runtime.sessions.refresh(cookie(context));
      return json({ state: "active" }, 200, { "Set-Cookie": refreshed.setCookie });
    }
    if (path === "/api/admin/session" && method === "DELETE") {
      const hash = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
      if (rawBody.length !== 0) throw new AdminError("ADMIN_BODY_INVALID", 422);
      runtime.sessions.consumeCsrf(cookie(context), csrf(context), { method, path, bodyHash: hash });
      const destroyed = runtime.sessions.destroy(cookie(context));
      return { status: 204, headers: { ...JSON_HEADERS, "Set-Cookie": destroyed.setCookie } };
    }
    if (path === "/api/admin/sources" && method === "GET") {
      runtime.sessions.get(cookie(context));
      return json(runtime.repository.list(parseListQuery(requestUrl)));
    }
    if (path === "/api/admin/sources" && method === "POST") {
      assertJsonContentType(context);
      const { parsed, hash } = parseCanonicalJson(rawBody);
      runtime.sessions.consumeCsrf(cookie(context), csrf(context), { method, path, bodyHash: hash });
      return json(runtime.repository.add(parsed, method, path, hash), 202);
    }
    const sourceMatch = /^\/api\/admin\/sources\/([^/]+)$/.exec(path);
    if (sourceMatch && method === "GET") {
      runtime.sessions.get(cookie(context));
      if (!SOURCE_ID.test(sourceMatch[1])) throw new AdminError("ADMIN_SOURCE_NOT_FOUND", 404);
      const item = runtime.repository.get(sourceMatch[1]);
      if (!item) throw new AdminError("ADMIN_SOURCE_NOT_FOUND", 404);
      return json(item);
    }
    const actionMatch = /^\/api\/admin\/sources\/([^/]+)\/(validate|activate|stop|retire|requeue)$/.exec(path);
    if (actionMatch && method === "POST") {
      assertJsonContentType(context);
      const [, sourceId, action] = actionMatch;
      if (!SOURCE_ID.test(sourceId)) throw new AdminError("ADMIN_SOURCE_NOT_FOUND", 404);
      const { parsed, hash } = parseCanonicalJson(rawBody);
      const record = parsed as Record<string, unknown>;
      if (record.expected && typeof record.expected === "object" && (record.expected as Record<string, unknown>).source_id !== sourceId) {
        throw new AdminError("ADMIN_BODY_INVALID", 422);
      }
      runtime.sessions.consumeCsrf(cookie(context), csrf(context), { method, path, bodyHash: hash });
      const receipt = action === "validate" ? runtime.repository.validate(parsed, method, path, hash)
        : action === "activate" ? runtime.repository.activate(parsed, method, path, hash)
          : action === "stop" ? runtime.repository.stop(parsed, method, path, hash)
            : action === "retire" ? runtime.repository.retire(parsed, method, path, hash)
              : runtime.repository.requeue(parsed, method, path, hash);
      return json(receipt);
    }
    const operationMatch = /^\/api\/admin\/operations\/([^/]+)$/.exec(path);
    if (operationMatch && method === "GET") {
      runtime.sessions.get(cookie(context));
      if (!COMMAND_ID.test(operationMatch[1])) throw new AdminError("ADMIN_SOURCE_NOT_FOUND", 404);
      const receipt = runtime.repository.getOperation(operationMatch[1]);
      if (!receipt) throw new AdminError("ADMIN_SOURCE_NOT_FOUND", 404);
      return json(receipt);
    }
    if (path.startsWith("/api/admin/sources") && method === "DELETE") throw new AdminError("ADMIN_METHOD_DENIED", 405);
    if (path.endsWith("/retry")) throw new AdminError("ADMIN_ROUTE_NOT_FOUND", 404);
    throw new AdminError(method === "GET" || method === "POST" || method === "DELETE" ? "ADMIN_ROUTE_NOT_FOUND" : "ADMIN_METHOD_DENIED", method === "GET" || method === "POST" || method === "DELETE" ? 404 : 405);
  } catch (error) {
    return problem(error instanceof AdminError ? error : new AdminError("ADMIN_INTERNAL_FAILURE", 500));
  }
}

export async function handleNextAdminRequest(request: Request, exactPath: string): Promise<Response> {
  const { requireRawAdminContext } = await import("./raw-context.ts");
  const context = requireRawAdminContext();
  if (context.path !== exactPath || new URL(request.url).pathname !== exactPath) {
    return new Response(JSON.stringify(problem(new AdminError("ADMIN_HOST_DENIED", 403)).body), { status: 403, headers: PROBLEM_HEADERS });
  }
  const result = await handleAdminRequest(context, request.url, request.method === "GET" ? "" : await request.text());
  const headers = new Headers();
  for (const [name, value] of Object.entries(result.headers ?? {})) {
    if (typeof value === "string") headers.set(name, value);
    else value.forEach((item) => headers.append(name, item));
  }
  return new Response(result.body === undefined ? null : JSON.stringify(result.body), { status: result.status, headers });
}
