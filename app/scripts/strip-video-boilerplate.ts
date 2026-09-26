import { DatabaseSync } from "node:sqlite";

import { isBoilerplateParagraph } from "../src/server/lean/article.ts";
import { applyChineseNames } from "../src/server/lean/chinese-names.ts";
import { leanPath } from "../src/server/lean/config.ts";

type Row = {
  public_id: string;
  title_zh: string | null;
  summary_zh: string | null;
  key_points_json: string | null;
  detail_zh_json: string | null;
  detail_en_json: string | null;
};

function paragraphs(raw: string | null): string[] | null {
  if (raw == null) return null;
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : null;
}

function stripPair(english: string[] | null, chinese: string[] | null): { english: string[] | null; chinese: string[] | null; changed: boolean } {
  if (english && chinese && english.length === chinese.length) {
    const kept = english.map((paragraph, index) => !isBoilerplateParagraph(paragraph) && !isBoilerplateParagraph(chinese[index] ?? ""));
    const nextEnglish = english.filter((_, index) => kept[index]);
    const nextChinese = chinese.filter((_, index) => kept[index]);
    return { english: nextEnglish, chinese: nextChinese, changed: nextEnglish.length !== english.length };
  }
  const nextEnglish = english?.filter((paragraph) => !isBoilerplateParagraph(paragraph)) ?? null;
  const nextChinese = chinese?.filter((paragraph) => !isBoilerplateParagraph(paragraph)) ?? null;
  return {
    english: nextEnglish,
    chinese: nextChinese,
    changed: (nextEnglish?.length ?? 0) !== (english?.length ?? 0) || (nextChinese?.length ?? 0) !== (chinese?.length ?? 0)
  };
}

const database = new DatabaseSync(process.argv[2] ?? leanPath("store.sqlite"));
database.exec("PRAGMA busy_timeout=8000");
const rows = database.prepare("SELECT public_id, title_zh, summary_zh, key_points_json, detail_zh_json, detail_en_json FROM items").all() as Row[];
const update = database.prepare("UPDATE items SET title_zh = ?, summary_zh = ?, key_points_json = ?, detail_zh_json = ?, detail_en_json = ? WHERE public_id = ?");
let stripped = 0;
let renamed = 0;
database.exec("BEGIN IMMEDIATE");
try {
  for (const row of rows) {
    const detail = stripPair(paragraphs(row.detail_en_json), paragraphs(row.detail_zh_json));
    const title = row.title_zh === null ? null : applyChineseNames(row.title_zh);
    const summary = row.summary_zh === null ? null : applyChineseNames(row.summary_zh);
    const points = paragraphs(row.key_points_json);
    const nextPoints = points?.map((point) => applyChineseNames(point)) ?? null;
    const chineseDetail = detail.chinese?.map((paragraph) => applyChineseNames(paragraph)) ?? null;
    const pointsChanged = JSON.stringify(nextPoints) !== JSON.stringify(points);
    const namesChanged = title !== row.title_zh || summary !== row.summary_zh || pointsChanged || JSON.stringify(chineseDetail) !== JSON.stringify(detail.chinese);
    if (!detail.changed && !namesChanged) continue;
    update.run(
      title,
      summary,
      nextPoints === null ? row.key_points_json : JSON.stringify(nextPoints),
      chineseDetail === null ? null : JSON.stringify(chineseDetail),
      detail.english === null ? null : JSON.stringify(detail.english),
      row.public_id
    );
    if (detail.changed) stripped += 1;
    if (namesChanged) renamed += 1;
  }
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
}
console.log(JSON.stringify({ scanned: rows.length, stripped, renamed }));
