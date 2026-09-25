import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isAgencyImage } from "./feed.ts";
import type { StoredItem } from "./store.ts";

export const MEDIA_MAX_WIDTH = 1200;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const CONCURRENCY = 6;
/** Bounds one cycle's work; the rest are fetched in later cycles and shown without a picture meanwhile. */
const MAX_DOWNLOADS_PER_RUN = 300;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 3600 * 1000;
/** Cached files no current story uses are removed once they are this old. */
const UNUSED_TTL_MS = 3 * 24 * 3600 * 1000;

/** Site-relative path (`media/<key>.webp`) and the cached file that is copied there. */
export type LocalImage = Readonly<{ sitePath: string; file: string; bytes: number }>;
/** Keyed by the original picture URL. */
export type LocalMedia = ReadonlyMap<string, LocalImage>;
export type MediaReport = { cached: number; downloaded: number; failed: number; deferred: number };
export type Encoder = (input: Buffer) => Promise<Buffer>;

type Failure = { attempts: number; lastAt: string; error: string };

export const mediaKey = (url: string): string => createHash("sha256").update(url).digest("hex").slice(0, 32);

let sharpEncoder: Encoder | null = null;

/** WebP, at most MEDIA_MAX_WIDTH wide, EXIF orientation applied and metadata stripped. */
async function defaultEncoder(input: Buffer): Promise<Buffer> {
  if (sharpEncoder === null) {
    const { default: sharp } = await import("sharp");
    sharpEncoder = (bytes) => sharp(bytes, { limitInputPixels: 100_000_000 }).rotate()
      .resize({ width: MEDIA_MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  }
  return sharpEncoder(input);
}

async function download(url: string, fetcher: typeof fetch): Promise<Buffer> {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": "F1Plus1-Reader/1.0 (+https://1404369477-blip.github.io/f1plus1/)", accept: "image/avif,image/webp,image/jpeg,image/png,image/*" },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`IMAGE_HTTP_${response.status}`);
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) throw new Error("IMAGE_NOT_AN_IMAGE");
  if (Number(response.headers.get("content-length") ?? 0) > MAX_SOURCE_BYTES) throw new Error("IMAGE_TOO_LARGE");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error("IMAGE_TOO_LARGE");
  return bytes;
}

function readFailures(path: string): Record<string, Failure> {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Record<string, Failure> : {};
  } catch {
    return {};
  }
}

/**
 * Makes a site-hosted WebP copy of every story picture, so pages never load third-party image hosts.
 * A picture that cannot be fetched is left out (the story shows no picture) and retried a few times.
 */
export async function localizeImages(items: readonly StoredItem[], cacheDir: string, now: Date,
  options: { fetcher?: typeof fetch; encode?: Encoder } = {}): Promise<{ media: LocalMedia; report: MediaReport }> {
  const fetcher = options.fetcher ?? fetch;
  const encode = options.encode ?? defaultEncoder;
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const failuresPath = join(cacheDir, "failures.json");
  const failures = readFailures(failuresPath);
  const media = new Map<string, LocalImage>();
  const report: MediaReport = { cached: 0, downloaded: 0, failed: 0, deferred: 0 };

  const urls = [...new Set(items.flatMap((item) => item.image !== null && !isAgencyImage(item.image.url) ? [item.image.url] : []))];
  const missing: string[] = [];
  for (const url of urls) {
    const key = mediaKey(url);
    const file = join(cacheDir, `${key}.webp`);
    if (existsSync(file)) {
      media.set(url, { sitePath: `media/${key}.webp`, file, bytes: statSync(file).size });
      report.cached++;
      continue;
    }
    const failure = failures[key];
    if (failure && (failure.attempts >= MAX_ATTEMPTS || now.getTime() - Date.parse(failure.lastAt) < RETRY_AFTER_MS)) continue;
    missing.push(url);
  }
  report.deferred = Math.max(0, missing.length - MAX_DOWNLOADS_PER_RUN);

  const queue = missing.slice(0, MAX_DOWNLOADS_PER_RUN);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (next < queue.length) {
      const url = queue[next++];
      const key = mediaKey(url);
      const file = join(cacheDir, `${key}.webp`);
      try {
        const webp = await encode(await download(url, fetcher));
        const temp = `${file}.${process.pid}.tmp`;
        writeFileSync(temp, webp, { mode: 0o644 });
        renameSync(temp, file);
        media.set(url, { sitePath: `media/${key}.webp`, file, bytes: webp.length });
        delete failures[key];
        report.downloaded++;
      } catch (error) {
        const previous = failures[key];
        failures[key] = { attempts: (previous?.attempts ?? 0) + 1, lastAt: now.toISOString(), error: error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN" };
        report.failed++;
      }
    }
  }));

  const wanted = new Set(urls.map(mediaKey));
  for (const key of Object.keys(failures)) if (!wanted.has(key)) delete failures[key];
  const temp = `${failuresPath}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(failures, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, failuresPath);
  for (const name of readdirSync(cacheDir)) {
    if (!name.endsWith(".webp") || wanted.has(name.slice(0, -".webp".length))) continue;
    const path = join(cacheDir, name);
    if (now.getTime() - statSync(path).mtimeMs > UNUSED_TTL_MS) unlinkSync(path);
  }
  return { media, report };
}
