import {
  normalizePublicStaticRequestKey,
  PublicStaticIndexSchema,
  PublicStaticPointerSchema,
  PublicStaticQueryError,
  type PublicStaticIndex,
  type PublicStaticPointer,
  type PublicStaticQueryReason
} from "./public-static-schema";
import { PUBLIC_STATIC_BASE_PATH } from "./public-site-config";

type StaticFetch = (input: string, init?: RequestInit) => Promise<Response>;
type LoadedBundle = { pointer: PublicStaticPointer; index: PublicStaticIndex };
let pointerReadSequence = 0;

export class PublicStaticGenerationChangedError extends Error {
  constructor() {
    super("PUBLIC_STATIC_GENERATION_CHANGED");
    this.name = "PublicStaticGenerationChangedError";
  }
}

function unavailable(): Error {
  return new Error("PUBLIC_STATIC_UNAVAILABLE");
}

function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}

async function readBoundedBytes(response: Response, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok || !response.body) throw unavailable();
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maximum) throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw unavailable();
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function assertHash(bytes: Uint8Array<ArrayBuffer>, expected: string): Promise<void> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw unavailable();
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw unavailable();
  }
}

function problem(reasonCode: PublicStaticQueryReason | "PUBLIC_STORY_NOT_FOUND", path: string): Response {
  const status = reasonCode === "PUBLIC_STORY_NOT_FOUND" ? 404 : 400;
  return new Response(JSON.stringify({
    type: `urn:f1plus1:problem:${reasonCode}`,
    title: status === 404 ? "Public story not found" : "Invalid public query",
    status,
    detail: status === 404 ? "The public story is not available." : "The public feed query is invalid.",
    instance: path.startsWith("/api/public/stories/") ? "/api/public/stories" : "/api/public/feed",
    reasonCode,
    traceId: "trace-public-static"
  }), { status, headers: { "Content-Type": "application/problem+json; charset=utf-8", "Cache-Control": "no-store" } });
}

/** One context per logical public request keeps V2 negotiation and V1 fallback on one bundle. */
export function createPublicStaticFetch({
  fetchImpl = globalThis.fetch,
  expectedBundleId,
  basePath = PUBLIC_STATIC_BASE_PATH
}: {
  fetchImpl?: StaticFetch;
  expectedBundleId?: string;
  basePath?: string;
} = {}): { fetch: StaticFetch; getBundleId(): string | undefined } {
  if (!/^\/[a-zA-Z0-9_-]+$/u.test(basePath)) throw unavailable();
  let loaded: Promise<LoadedBundle> | undefined;
  let bundleId: string | undefined;

  const loadBundle = async (signal: AbortSignal | null | undefined): Promise<LoadedBundle> => {
    throwIfAborted(signal);
    // Pages controls response headers. A unique pointer URL also avoids serving a stale CDN entry.
    const readId = `${Date.now()}-${++pointerReadSequence}`;
    const pointerResponse = await fetchImpl(`${basePath}/_public/current.json?read=${readId}`, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal });
    const pointer = PublicStaticPointerSchema.parse(parseJson(await readBoundedBytes(pointerResponse, 4096)));
    const indexResponse = await fetchImpl(`${basePath}/${pointer.indexPath}`, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal });
    const indexBytes = await readBoundedBytes(indexResponse, 16 * 1024 * 1024);
    await assertHash(indexBytes, pointer.indexSha256);
    const index = PublicStaticIndexSchema.parse(parseJson(indexBytes));
    if (index.generatedAt !== pointer.generatedAt) throw unavailable();
    throwIfAborted(signal);
    if (expectedBundleId !== undefined && pointer.bundleId !== expectedBundleId) throw new PublicStaticGenerationChangedError();
    bundleId = pointer.bundleId;
    return { pointer, index };
  };

  const staticFetch: StaticFetch = async (input, init) => {
    throwIfAborted(init?.signal);
    const headers = new Headers(init?.headers);
    if ((init?.method ?? "GET") !== "GET" || headers.get("accept") !== "application/json") return problem("PUBLIC_QUERY_INVALID", input);
    let key: string;
    try {
      key = normalizePublicStaticRequestKey(input);
    } catch (error) {
      return problem(error instanceof PublicStaticQueryError ? error.reasonCode : "PUBLIC_QUERY_INVALID", input);
    }
    loaded ??= loadBundle(init?.signal);
    const { pointer, index } = await loaded;
    throwIfAborted(init?.signal);
    const reference = index.responses[key];
    if (!reference) {
      if (key.startsWith("/api/public/stories/")) return problem("PUBLIC_STORY_NOT_FOUND", input);
      const params = new URL(key, "https://public.invalid").searchParams;
      return problem(params.has("cursor") || params.has("cursorId") ? "PUBLIC_CURSOR_INVALID" : "PUBLIC_QUERY_INVALID", input);
    }
    const directory = pointer.indexPath.slice(0, -"index.json".length);
    const bodyResponse = await fetchImpl(`${basePath}/${directory}${reference.path}`, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal: init?.signal });
    const bytes = await readBoundedBytes(bodyResponse, 2 * 1024 * 1024);
    await assertHash(bytes, reference.sha256);
    throwIfAborted(init?.signal);
    if (reference.status === 200) {
      const payload = parseJson(bytes);
      const expectedVersion = new URL(key, "https://public.invalid").searchParams.get("v") === "2"
        ? "public-read-bilingual-v2" : "public-read-v0.1";
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)
        || (payload as Record<string, unknown>).schemaVersion !== expectedVersion) throw unavailable();
    }
    return new Response(bytes, { status: reference.status, headers: { "Content-Type": reference.contentType, "Cache-Control": "no-store" } });
  };
  return { fetch: staticFetch, getBundleId: () => bundleId };
}
