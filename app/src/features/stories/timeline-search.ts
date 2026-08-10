type SearchListener = (query: string) => void;

let currentQuery = "";
const listeners = new Set<SearchListener>();

export function getTimelineSearchQuery(): string {
  return currentQuery;
}

export function setTimelineSearchQuery(next: string): void {
  const value = next ?? "";
  if (value === currentQuery) return;
  currentQuery = value;
  for (const listener of listeners) listener(currentQuery);
}

export function subscribeTimelineSearch(listener: SearchListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
