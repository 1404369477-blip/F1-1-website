"use client";

import { useEffect, useMemo, useState } from "react";

import {
  loadPublicSearchIndex, matchPublicSearchItems, normalizePublicSearchQuery, PUBLIC_SEARCH_PAGE_SIZE,
  type LoadedPublicSearchIndex, type PublicSearchItem
} from "./public-search";
import { PublicStaticGenerationChangedError } from "./public-static-transport";

type SearchState = { key: string; status: "loading" | "error" } | { key: string; status: "ready"; index: LoadedPublicSearchIndex };

export function usePublicSearch({ enabled, query, contentType, bundleId, onGenerationChange }: {
  enabled: boolean;
  query: string;
  contentType: PublicSearchItem["contentType"] | null;
  bundleId?: string;
  onGenerationChange: () => void;
}) {
  const normalized = normalizePublicSearchQuery(query);
  const active = enabled && normalized.length > 0;
  const key = JSON.stringify([normalized, contentType, bundleId]);
  const [state, setState] = useState<SearchState>({ key: "", status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState({ key: "", count: PUBLIC_SEARCH_PAGE_SIZE });

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    // Debounce input while making old query results disappear immediately through the keyed view below.
    const timer = window.setTimeout(() => {
      void loadPublicSearchIndex({ bundleId, signal: controller.signal }).then((index) => {
        if (!controller.signal.aborted) setState({ key, status: "ready", index });
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof PublicStaticGenerationChangedError) {
          onGenerationChange();
          return;
        }
        setState({ key, status: "error" });
      });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [active, bundleId, key, attempt, onGenerationChange]);

  const current = useMemo(() => state.key === key ? state : { key, status: "loading" as const }, [state, key]);
  const matched = useMemo(() => current.status === "ready"
    ? matchPublicSearchItems(current.index.items, normalized, contentType)
    : [], [current, normalized, contentType]);
  const count = page.key === key ? page.count : PUBLIC_SEARCH_PAGE_SIZE;
  return {
    active,
    status: current.status,
    bundleId: current.status === "ready" ? current.index.bundleId : undefined,
    items: matched.slice(0, count),
    total: matched.length,
    hasMore: matched.length > count,
    loadMore: () => setPage({ key, count: count + PUBLIC_SEARCH_PAGE_SIZE }),
    retry: () => { setState({ key, status: "loading" }); setAttempt((value) => value + 1); }
  };
}
