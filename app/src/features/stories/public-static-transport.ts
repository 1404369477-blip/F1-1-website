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

const sessionBundles = new WeakMap<StaticFetch, Map<string, Promise<LoadedBundle>>>();
const DEFAULT_RETRY_DELAYS_MS = [1000, 3000, 6000];

export function clearPublicStaticBundleCache(fetchImpl: StaticFetch = globalThis.fetch): void {
  sessionBundles.delete(fetchImpl);
}

class StaleStaticBundleError extends Error {
  constructor() {
    super("PUBLIC_STATIC_STALE");
    this.name = "StaleStaticBundleError";
  }
}

function cacheFor(fetchImpl: StaticFetch): Map<string, Promise<LoadedBundle>> {
  let map = sessionBundles.get(fetchImpl);
  if (!map) {
    map = new Map();
    sessionBundles.set(fetchImpl, map);
  }
  return map;
}

function sleep(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    }, { once: true });
  });
}

/** One context per logical public request keeps V2 negotiation and V1 fallback on one bundle. */
export function createPublicStaticFetch({
  fetchImpl = globalThis.fetch,
  expectedBundleId,
  basePath = PUBLIC_STATIC_BASE_PATH,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS
}: {
  fetchImpl?: StaticFetch;
  expectedBundleId?: string;
  basePath?: string;
  retryDelaysMs?: readonly number[];
} = {}): { fetch: StaticFetch; getBundleId(): string | undefined } {
  if (basePath !== "" && !/^\/[a-zA-Z0-9_-]+$/u.test(basePath)) throw unavailable();
  let bundleId: string | undefined;
  let loaded: Promise<LoadedBundle> | undefined;
  let readAttempt = 0;

  const forgetBundle = (): void => {
    loaded = undefined;
    cacheFor(fetchImpl).clear();
  };

  const loadFromPointer = async (pointer: PublicStaticPointer, signal: AbortSignal | null | undefined): Promise<LoadedBundle> => {
    const indexResponse = await fetchImpl(`${basePath}/${pointer.indexPath}`, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal });
    if (indexResponse.status === 404) throw new StaleStaticBundleError();
    const indexBytes = await readBoundedBytes(indexResponse, 16 * 1024 * 1024);
    try {
      await assertHash(indexBytes, pointer.indexSha256);
    } catch {
      throw new StaleStaticBundleError();
    }
    const index = PublicStaticIndexSchema.parse(parseJson(indexBytes));
    if (index.generatedAt !== pointer.generatedAt) throw new StaleStaticBundleError();
    throwIfAborted(signal);
    if (expectedBundleId !== undefined && pointer.bundleId !== expectedBundleId) throw new PublicStaticGenerationChangedError();
    bundleId = pointer.bundleId;
    return { pointer, index };
  };

  const readPointer = async (signal: AbortSignal | null | undefined): Promise<PublicStaticPointer> => {
    const suffix = readAttempt === 0 ? "" : `/_public/generations/manifest.json`;
    if (readAttempt > 0) {
      const manifestResponse = await fetchImpl(`${basePath}${suffix}`, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal });
      if (manifestResponse.ok) {
        const manifest = parseJson(await readBoundedBytes(manifestResponse, 256 * 1024)) as { generations?: { id?: string; publishedAt?: string; generatedAt?: string }[] };
        const newest = [...(manifest.generations ?? [])].filter((entry) => typeof entry.id === "string" && typeof entry.generatedAt === "string")
          .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))[0];
        if (newest?.id && newest.generatedAt) {
          return PublicStaticPointerSchema.parse({
            schemaVersion: "public-static-pointer-v1",
            bundleId: newest.id,
            generatedAt: newest.generatedAt,
            indexPath: `_public/generations/${newest.id}/index.json`,
            indexSha256: newest.id
          });
        }
      }
    }
    const readId = `${Date.now()}-${++pointerReadSequence}`;
    const pointerResponse = await fetchImpl(`${basePath}/_public/current.json?read=${readId}`, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal });
    if (pointerResponse.status === 404) throw new StaleStaticBundleError();
    return PublicStaticPointerSchema.parse(parseJson(await readBoundedBytes(pointerResponse, 4096)));
  };

  const loadBundleOnce = async (signal: AbortSignal | null | undefined): Promise<LoadedBundle> => {
    throwIfAborted(signal);
    const pointer = await readPointer(signal);
    return loadFromPointer(pointer, signal);
  };

  const loadBundle = (signal: AbortSignal | null | undefined): Promise<LoadedBundle> => {
    const bundles = cacheFor(fetchImpl);
    const cacheKey = expectedBundleId ? `${basePath}:${expectedBundleId}` : "";
    if (cacheKey && bundles.has(cacheKey)) {
      return bundles.get(cacheKey)!.then((bundle) => {
        bundleId = bundle.pointer.bundleId;
        return bundle;
      });
    }
    const loading = loadBundleOnce(signal).then((bundle) => {
      bundles.set(`${basePath}:${bundle.pointer.bundleId}`, Promise.resolve(bundle));
      bundleId = bundle.pointer.bundleId;
      return bundle;
    });
    // Only cache a settled bundle: one reader's AbortSignal must not poison later requests.
    return loading.then((bundle) => {
      bundleId = bundle.pointer.bundleId;
      return bundle;
    });
  };

  const fetchOnce = async (key: string, input: string, init?: RequestInit): Promise<Response> => {
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
    if (bodyResponse.status === 404) throw new StaleStaticBundleError();
    const isSearch = key === "/api/public/search?v=1";
    const bytes = await readBoundedBytes(bodyResponse, (isSearch ? 16 : 2) * 1024 * 1024);
    try {
      await assertHash(bytes, reference.sha256);
    } catch {
      throw new StaleStaticBundleError();
    }
    throwIfAborted(init?.signal);
    if (reference.status === 200) {
      const payload = parseJson(bytes);
      const expectedVersion = isSearch ? "public-search-v1" : new URL(key, "https://public.invalid").searchParams.get("v") === "2"
        ? "public-read-bilingual-v2" : "public-read-v0.1";
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)
        || (payload as Record<string, unknown>).schemaVersion !== expectedVersion) throw unavailable();
      if (isSearch && (payload as Record<string, unknown>).generatedAt !== pointer.generatedAt) throw unavailable();
    }
    return new Response(bytes, { status: reference.status, headers: { "Content-Type": reference.contentType, "Cache-Control": "no-store" } });
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
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      readAttempt = attempt;
      try {
        return await fetchOnce(key, input, init);
      } catch (error) {
        if (!(error instanceof StaleStaticBundleError)) throw error;
        forgetBundle();
        if (attempt === retryDelaysMs.length) throw unavailable();
        await sleep(retryDelaysMs[attempt] ?? 0, init?.signal);
      }
    }
    throw unavailable();
  };
  return { fetch: staticFetch, getBundleId: () => bundleId };
}
