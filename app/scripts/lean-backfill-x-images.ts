import { statSync } from "node:fs";

import { leanPath, leanSources, MEDIA_DOWNLOAD_MAX_AGE_DAYS } from "../src/server/lean/config.ts";
import { fetchFeed } from "../src/server/lean/feed.ts";
import { localizeImages, mediaKey } from "../src/server/lean/media.ts";
import { LeanStore, linkKey } from "../src/server/lean/store.ts";

const RECENT_MS = MEDIA_DOWNLOAD_MAX_AGE_DAYS * 24 * 3600 * 1000;

/** Refills images on recent X posts from the local RSSHub. Other columns stay as they are. */
async function main(): Promise<void> {
  const store = new LeanStore(leanPath("store.sqlite"));
  const now = new Date();
  const since = now.getTime() - RECENT_MS;
  const recent = new Map(store.readyItems().filter((item) => item.platform === "x" && Date.parse(item.sourcePublishedAt ?? item.firstSeenAt) >= since).map((item) => [linkKey(item.link), item]));
  const sources = leanSources("all").filter((source) => source.platform === "x");
  let matched = 0;
  const gained = { 2: 0, 3: 0, 4: 0 };
  const before = new Set<string>();
  for (const item of recent.values()) for (const image of item.images) before.add(mediaKey(image.url));
  try {
    for (const source of sources) {
      let entries;
      try {
        entries = await fetchFeed(source);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const item = recent.get(linkKey(entry.link));
        if (!item || entry.images.length <= item.images.length) continue;
        if (!store.replaceImages(entry.link, entry.images)) continue;
        matched += 1;
        if (entry.images.length >= 2 && entry.images.length <= 4) gained[entry.images.length as 2 | 3 | 4] += 1;
      }
    }
    const updated = store.readyItems().filter((item) => item.platform === "x" && recent.has(linkKey(item.link)));
    const { report } = await localizeImages(updated, leanPath("media"), now, { downloadSince: since });
    let addedBytes = 0;
    let addedFiles = 0;
    for (const item of updated) {
      for (const image of item.images) {
        const key = mediaKey(image.url);
        if (before.has(key)) continue;
        before.add(key);
        addedFiles += 1;
        try { addedBytes += statSync(`${leanPath("media")}/${key}.webp`).size; } catch { /* not downloaded */ }
      }
    }
    process.stdout.write(`${JSON.stringify({ recent: recent.size, filled: matched, two: gained[2], three: gained[3], four: gained[4], newFiles: addedFiles, newBytes: addedBytes, downloaded: report.downloaded })}\n`);
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "UNKNOWN"}\n`);
  process.exitCode = 1;
});
