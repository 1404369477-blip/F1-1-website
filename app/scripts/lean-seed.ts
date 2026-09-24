import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { leanPath } from "../src/server/lean/config.ts";
import type { FeedImage } from "../src/server/lean/feed.ts";
import { LeanStore, type StoredItem } from "../src/server/lean/store.ts";

type Detail = { story: Record<string, unknown> & { source: Record<string, string>; media: Record<string, unknown> | null; originalLink: { url: string | null } } };

/** Carries the stories of an exported static site (argv[2] = its `site` directory) into the lean store. */
function main(): void {
  const site = process.argv[2];
  if (!site) throw new Error("usage: lean-seed.ts <exported-site-directory>");
  const pointer = JSON.parse(readFileSync(join(site, "_public/current.json"), "utf8")) as { indexPath: string };
  const generation = join(site, pointer.indexPath, "..");
  const index = JSON.parse(readFileSync(join(site, pointer.indexPath), "utf8")) as { responses: Record<string, { status: number; path: string }> };
  mkdirSync(leanPath(), { recursive: true, mode: 0o700 });
  const store = new LeanStore(leanPath("store.sqlite"));
  let imported = 0;
  try {
    for (const [key, ref] of Object.entries(index.responses)) {
      if (!/^\/api\/public\/stories\/[^?]+\?v=1$/.test(key) || ref.status !== 200) continue;
      const { story } = JSON.parse(readFileSync(join(generation, ref.path), "utf8")) as Detail;
      if (!story.originalLink.url) continue;
      const media = story.media;
      const image: FeedImage | null = media && media.kind === "source_image"
        ? { url: String(media.assetRef), mimeType: media.mimeType as FeedImage["mimeType"], declaredBytes: Number(media.declaredBytes) }
        : null;
      const item: StoredItem = {
        publicId: String(story.publicId),
        sourceId: story.source.sourceId,
        platform: story.source.platform === "x" ? "x" : "rss",
        displayName: story.source.displayName,
        contentType: story.contentType as StoredItem["contentType"],
        requireRelevance: false,
        link: story.originalLink.url.replace(/&amp;/g, "&"),
        title: String(story.titleZh),
        text: String(story.summaryZh),
        sourcePublishedAt: (story.sourcePublishedAt as string | null) ?? null,
        firstSeenAt: String(story.publishedAt),
        image,
        status: "ready",
        attempts: 0,
        titleZh: String(story.titleZh),
        summaryZh: String(story.summaryZh),
        keyPointsZh: (story.keyPointsZh as string[] | undefined) ?? [],
        publishedAt: String(story.publishedAt)
      };
      store.importReady(item);
      imported++;
    }
    process.stdout.write(`${JSON.stringify({ imported, counts: store.counts() })}\n`);
  } finally {
    store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
