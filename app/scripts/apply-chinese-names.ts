import { DatabaseSync } from "node:sqlite";

import { applyChineseNames } from "../src/server/lean/chinese-names.ts";
import { leanPath } from "../src/server/lean/config.ts";

type Row = {
  public_id: string;
  title_zh: string | null;
  summary_zh: string | null;
  key_points_json: string | null;
  detail_zh_json: string | null;
};

function mappedList(raw: string | null): { json: string | null; changed: boolean } {
  if (raw == null) return { json: null, changed: false };
  const values = JSON.parse(raw) as unknown;
  if (!Array.isArray(values)) return { json: raw, changed: false };
  const next = values.map((value) => typeof value === "string" ? applyChineseNames(value) : value);
  const json = JSON.stringify(next);
  return { json, changed: json !== raw };
}

const database = new DatabaseSync(process.argv[2] ?? leanPath("store.sqlite"));
database.exec("PRAGMA busy_timeout=8000");
const rows = database.prepare("SELECT public_id, title_zh, summary_zh, key_points_json, detail_zh_json FROM items").all() as Row[];
const update = database.prepare("UPDATE items SET title_zh = ?, summary_zh = ?, key_points_json = ?, detail_zh_json = ? WHERE public_id = ?");
let changed = 0;
database.exec("BEGIN IMMEDIATE");
try {
  for (const row of rows) {
    const title = row.title_zh === null ? null : applyChineseNames(row.title_zh);
    const summary = row.summary_zh === null ? null : applyChineseNames(row.summary_zh);
    const points = mappedList(row.key_points_json);
    const detail = mappedList(row.detail_zh_json);
    if (title === row.title_zh && summary === row.summary_zh && !points.changed && !detail.changed) continue;
    update.run(title, summary, points.json ?? row.key_points_json, detail.json, row.public_id);
    changed += 1;
  }
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
}
console.log(JSON.stringify({ scanned: rows.length, changed }));
