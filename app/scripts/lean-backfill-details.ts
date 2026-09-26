import { fetchArticleParagraphs, hasStrayEnglish, isBoilerplateParagraph } from "../src/server/lean/article.ts";
import { leanPath } from "../src/server/lean/config.ts";
import { refineItem, resolveModel } from "../src/server/lean/refine.ts";
import { LeanStore, type StoredItem } from "../src/server/lean/store.ts";

const GAP_MS = 200;
const CONCURRENCY = 4;

function repairRank(item: StoredItem): number {
  if (needsReclean(item)) return 0;
  const summary = item.summaryEn?.trim() ?? "";
  if (summary.length >= 230 && !/[.!?]"?$/.test(summary)) return 0;
  if (/autosport\.com|racefans\.net/i.test(item.link)) return 1;
  return 2;
}

function needsReclean(item: StoredItem): boolean {
  const text = [...(item.detailZh ?? []), ...(item.detailEn ?? [])].join("\n");
  return (item.detailZh ?? []).some(hasStrayEnglish) || isBoilerplateParagraph(text);
}

/** Refreshes RSS full text without taking the publish lock. Newest stories first. */
async function main(): Promise<void> {
  const store = new LeanStore(leanPath("store.sqlite"));
  const gapsOnly = process.argv.includes("--gaps");
  const byId = new Map<string, StoredItem>();
  if (!gapsOnly) {
    for (const item of store.rssToRepair()) byId.set(item.publicId, item);
  }
  for (const item of store.allReadyRss()) {
    if (item.platform !== "rss" || !item.detailZh) continue;
    const missingEnglishPoints = item.keyPointsEn.length === 0;
    if (needsReclean(item) || (gapsOnly && missingEnglishPoints)) byId.set(item.publicId, item);
  }
  const items = [...byId.values()].sort((a, b) => repairRank(a) - repairRank(b) || (b.sourcePublishedAt ?? "").localeCompare(a.sourcePublishedAt ?? ""));
  const model = resolveModel();
  let filled = 0;
  let summaryOnly = 0;
  let failed = 0;
  const queue = [...items];
  async function worker(): Promise<void> {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      try {
        const fetched = await fetchArticleParagraphs(item.link);
        const paragraphs = fetched;
        const result = await refineItem(item, model, fetch, paragraphs);
        if (result.kind === "irrelevant") {
          failed += 1;
        } else {
          const keepPoints = result.keyPointsZh.length === 0 && item.keyPointsZh.length > 0 && !item.keyPointsZh.some(hasStrayEnglish);
          store.rewriteReady(item.publicId, {
            titleZh: result.titleZh,
            summaryZh: result.summaryZh,
            summaryEn: result.summaryEn,
            keyPointsZh: paragraphs ? (keepPoints ? item.keyPointsZh : result.keyPointsZh) : [],
            keyPointsEn: paragraphs ? (keepPoints ? item.keyPointsEn : result.keyPointsEn) : [],
            detailEn: paragraphs,
            detailZh: result.detailZh
          });
          if (paragraphs && result.detailZh) filled += 1;
          else summaryOnly += 1;
        }
      } catch (error) {
        failed += 1;
        const reason = error instanceof Error ? error.message : "UNKNOWN";
        process.stderr.write(`backfill fail ${item.link.slice(0, 80)} ${reason}\n`);
      }
      const done = filled + summaryOnly + failed;
      if (done % 10 === 0) process.stderr.write(`backfill ${done}/${items.length} filled=${filled} summaryOnly=${summaryOnly} failed=${failed}\n`);
      await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker()));
  } finally {
    store.close();
  }
  process.stdout.write(`${JSON.stringify({ candidates: items.length, filled, summaryOnly, failed })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "UNKNOWN"}\n`);
  process.exitCode = 1;
});
