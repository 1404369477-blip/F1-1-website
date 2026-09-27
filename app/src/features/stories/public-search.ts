import { createPublicStaticFetch } from "./public-static-transport";
import { PUBLIC_SEARCH_PATH, PublicSearchIndexSchema, type LoadedPublicSearchIndex } from "./public-search-schema";

export * from "./public-search-schema";

type SearchFetch = (input: string, init?: RequestInit) => Promise<Response>;
const indexes = new WeakMap<SearchFetch, Map<string, LoadedPublicSearchIndex>>();

/** Fetched only on search. Cache completed, validated indexes, never an abortable in-flight request. */
export async function loadPublicSearchIndex({ bundleId, signal, fetchImpl = globalThis.fetch }: {
  bundleId?: string;
  signal?: AbortSignal;
  fetchImpl?: SearchFetch;
} = {}): Promise<LoadedPublicSearchIndex> {
  signal?.throwIfAborted();
  const cached = bundleId ? indexes.get(fetchImpl)?.get(bundleId) : undefined;
  if (cached) return cached;
  const transport = createPublicStaticFetch({ fetchImpl, expectedBundleId: bundleId });
  const response = await transport.fetch(PUBLIC_SEARCH_PATH, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error("PUBLIC_SEARCH_UNAVAILABLE");
  const index = PublicSearchIndexSchema.parse(await response.json());
  signal?.throwIfAborted();
  const actualBundleId = transport.getBundleId();
  if (!actualBundleId) throw new Error("PUBLIC_SEARCH_UNAVAILABLE");
  const loaded: LoadedPublicSearchIndex = { ...index, bundleId: actualBundleId };
  let entries = indexes.get(fetchImpl);
  if (!entries) { entries = new Map(); indexes.set(fetchImpl, entries); }
  entries.set(actualBundleId, loaded);
  // Reading across many publications must not retain the entire archive for each generation.
  while (entries.size > 2) entries.delete(entries.keys().next().value!);
  return loaded;
}
