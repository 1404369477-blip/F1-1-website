export type HashParams = Record<string, string>;

function currentHash(): string {
  if (typeof location === "undefined") return "";
  return location.hash.replace(/^#/, "");
}

/**
 * Parse `#key=value&key2=value2` style hash params. Values are
 * decodeURIComponent-decoded. Malformed segments are ignored.
 */
export function parseHashParams(hash = currentHash()): HashParams {
  const params: HashParams = {};
  if (!hash) return params;
  for (const segment of hash.split("&")) {
    const index = segment.indexOf("=");
    if (index <= 0) continue;
    const key = segment.slice(0, index);
    let value: string;
    try {
      value = decodeURIComponent(segment.slice(index + 1));
    } catch {
      value = segment.slice(index + 1);
    }
    params[key] = value;
  }
  return params;
}

export function readHashParam(key: string, fallback = ""): string {
  return parseHashParams()[key] ?? fallback;
}

/**
 * Write the merged set of hash params back to the URL via
 * history.replaceState. Values that are undefined or empty are removed.
 * Sandbox-safe: any history API failure is a noop.
 */
export function setHashParams(patch: Record<string, string | undefined>): void {
  if (typeof history === "undefined") return;
  const params = parseHashParams();
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "") delete params[key];
    else params[key] = value;
  }
  const keys = Object.keys(params).filter((key) => params[key] !== "" && params[key] !== undefined);
  const query = keys.map((key) => `${key}=${encodeURIComponent(params[key])}`).join("&");
  try {
    history.replaceState(null, "", query ? `#${query}` : location.pathname);
  } catch {
    // noop
  }
}
