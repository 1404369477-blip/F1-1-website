import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { MODEL_PRIVATE_DIR } from "./config.ts";
import type { StoredItem } from "./store.ts";

export type RefineResult =
  | Readonly<{ kind: "ready"; titleZh: string; summaryZh: string; keyPointsZh: string[] }>
  | Readonly<{ kind: "irrelevant" }>;

type ModelEndpoint = Readonly<{ model: string; endpoint: string; key: string }>;

const REQUEST_TIMEOUT_MS = 60_000;
const HAN = /\p{Script=Han}/u;

const SYSTEM_PROMPT = [
  "你是F1中文资讯编辑。只根据用户提供的标题和正文整理中文稿，不补充未提供的事实，不推测，不虚构引语。",
  "保留车手、车队、人名和赛事专有名词的通行译法；无法确定时保留英文专名。",
  "输出严格JSON对象，且只含relevant、titleZh、summaryZh、keyPointsZh四个字段。",
  "relevant为布尔值：内容与F1、赛车运动或相关车手车队有关时为true；纯广告、与赛车无关的生活或娱乐内容为false。",
  "titleZh为准确简洁的中文标题（不超过40字）；summaryZh为一段中文摘要（不超过200字）；keyPointsZh为1至3条中文事实要点。",
  "来源为X帖子时，titleZh概括帖子要点，summaryZh忠实转述帖子内容。"
].join("\n");

function readKey(fileName: string): string | null {
  const path = join(MODEL_PRIVATE_DIR, fileName);
  if (!existsSync(path)) return null;
  const key = readFileSync(path, "utf8").trim();
  return key.length > 0 ? key : null;
}

export function resolveModel(): ModelEndpoint {
  const deepseek = readKey("deepseek-api-key");
  if (deepseek) return { model: "deepseek-chat", endpoint: "https://api.deepseek.com/chat/completions", key: deepseek };
  const glm = readKey("glm-api-key");
  if (glm) return { model: "glm-5.3-flash", endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", key: glm };
  throw new Error("MODEL_KEY_MISSING");
}

function userPrompt(item: StoredItem): string {
  const kind = item.platform === "x" ? `X帖子（${item.displayName}）` : `新闻（${item.displayName}）`;
  return JSON.stringify({ 来源类型: kind, 标题: item.title, 正文: item.text.slice(0, 3000) });
}

export function parseRefineOutput(raw: string, requireRelevance: boolean): RefineResult {
  const value = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
  if (requireRelevance && value.relevant === false) return { kind: "irrelevant" };
  const titleZh = typeof value.titleZh === "string" ? value.titleZh.trim() : "";
  const summaryZh = typeof value.summaryZh === "string" ? value.summaryZh.trim() : "";
  const keyPointsZh = Array.isArray(value.keyPointsZh)
    ? value.keyPointsZh.filter((point): point is string => typeof point === "string" && point.trim().length > 0).map((point) => point.trim()).slice(0, 3)
    : [];
  if (!HAN.test(titleZh) || !HAN.test(summaryZh) || titleZh.length > 120 || summaryZh.length > 600) throw new Error("MODEL_OUTPUT_INVALID");
  return { kind: "ready", titleZh, summaryZh, keyPointsZh };
}

export async function refineItem(item: StoredItem, model: ModelEndpoint, fetcher: typeof fetch = fetch): Promise<RefineResult> {
  const response = await fetcher(model.endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { authorization: `Bearer ${model.key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: model.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userPrompt(item) }]
    })
  });
  if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("MODEL_OUTPUT_MISSING");
  return parseRefineOutput(content, item.requireRelevance);
}
