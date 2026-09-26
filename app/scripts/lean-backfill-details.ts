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

function chineseStray(item: StoredItem): boolean {
  return [item.titleZh ?? "", item.summaryZh ?? "", ...item.keyPointsZh, ...(item.detailZh ?? [])].some((part) => hasStrayEnglish(part));
}

function needsReclean(item: StoredItem): boolean {
  const text = [...(item.detailZh ?? []), ...(item.detailEn ?? [])].join("\n");
  return chineseStray(item) || isBoilerplateParagraph(text);
}

/** Refreshes RSS full text without taking the publish lock. Newest stories first. */
async function main(): Promise<void> {
  const store = new LeanStore(leanPath("store.sqlite"));
  const gapsOnly = process.argv.includes("--gaps");
  const chineseOnly = process.argv.includes("--zh");
  const pointsOnly = process.argv.includes("--points-en");
  const byId = new Map<string, StoredItem>();
  if (!gapsOnly && !chineseOnly && !pointsOnly) {
    for (const item of store.rssToRepair()) byId.set(item.publicId, item);
  }
  const pool = chineseOnly || pointsOnly ? store.readyItems() : store.allReadyRss();
  for (const item of pool) {
    if (!chineseOnly && !pointsOnly && (item.platform !== "rss" || !item.detailZh)) continue;
    const missingEnglishPoints = item.keyPointsEn.length === 0;
    const chineseText = [item.titleZh ?? "", item.summaryZh ?? "", ...item.keyPointsZh, ...(item.detailZh ?? [])].join("\n");
    const spliced = /进站，进站|比赛 当天|噗噗噗|have 开心|skibidi/.test(chineseText);
    if (chineseOnly && (chineseStray(item) || spliced)) byId.set(item.publicId, item);
    else if (pointsOnly && item.platform === "rss" && missingEnglishPoints) byId.set(item.publicId, item);
    else if (!chineseOnly && !pointsOnly && (needsReclean(item) || (gapsOnly && missingEnglishPoints))) byId.set(item.publicId, item);
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
          if (pointsOnly) {
            if (result.keyPointsEn.length === 0) throw new Error("MODEL_OUTPUT_EMPTY_POINTS_EN");
            store.rewriteReady(item.publicId, {
              titleZh: item.titleZh ?? result.titleZh,
              summaryZh: item.summaryZh ?? result.summaryZh,
              summaryEn: item.summaryEn,
              keyPointsZh: item.keyPointsZh.length > 0 ? item.keyPointsZh : result.keyPointsZh,
              keyPointsEn: result.keyPointsEn,
              detailEn: item.detailEn,
              detailZh: item.detailZh
            });
          } else if (chineseOnly) {
            store.rewriteReady(item.publicId, {
              titleZh: result.titleZh,
              summaryZh: result.summaryZh,
              summaryEn: item.summaryEn,
              keyPointsZh: result.keyPointsZh.length > 0 ? result.keyPointsZh : item.keyPointsZh,
              keyPointsEn: item.keyPointsEn.length > 0 ? item.keyPointsEn : result.keyPointsEn,
              detailEn: item.detailEn,
              detailZh: result.detailZh ?? item.detailZh
            });
          } else {
            store.rewriteReady(item.publicId, {
              titleZh: result.titleZh,
              summaryZh: result.summaryZh,
              summaryEn: result.summaryEn,
              keyPointsZh: paragraphs ? (keepPoints ? item.keyPointsZh : result.keyPointsZh) : [],
              keyPointsEn: paragraphs ? (keepPoints ? item.keyPointsEn : result.keyPointsEn) : [],
              detailEn: paragraphs,
              detailZh: result.detailZh
            });
          }
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
