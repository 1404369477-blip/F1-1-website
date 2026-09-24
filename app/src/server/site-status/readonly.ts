import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { SiteStatus } from "./types.ts";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Matches the established backup receipt and schema canonical JSON encodings. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("INVALID_VALUE");
}

export function requireValue(value: unknown): asserts value {
  if (!value) throw new Error("INVALID_VALUE");
}

export function record(value: unknown): Record<string, unknown> {
  requireValue(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

export function integer(value: unknown, minimum = 0): number {
  requireValue(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum);
  return value;
}

export function hash(value: unknown): string {
  requireValue(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
  return value;
}

export function timestamp(value: unknown): string {
  requireValue(typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
  return value;
}

export function worstStatus(values: readonly SiteStatus[]): SiteStatus {
  if (values.includes("failed")) return "failed";
  if (values.includes("degraded")) return "degraded";
  if (values.includes("unknown")) return "unknown";
  return "healthy";
}

/** No unbounded readFileSync: even a concurrently growing file has a fixed byte budget. */
export function readBoundedRegularFile(path: string, maxBytes: number): Buffer {
  requireValue(isAbsolute(path) && resolve(path) === path && realpathSync(path) === path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    requireValue(before.isFile() && before.nlink === 1 && before.size <= maxBytes);
    const data = Buffer.alloc(before.size + 1);
    let bytes = 0;
    while (bytes < data.length) {
      const count = readSync(fd, data, bytes, data.length - bytes, bytes);
      if (count === 0) break;
      bytes += count;
    }
    const after = fstatSync(fd), current = lstatSync(path);
    requireValue(bytes === before.size && before.dev === current.dev && before.ino === current.ino
      && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs
      && before.mtimeMs === current.mtimeMs && !current.isSymbolicLink() && realpathSync(path) === path);
    return data.subarray(0, bytes);
  } finally { closeSync(fd); }
}
