import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REFINE_MODEL_CATALOG, REFINE_MODEL_IDS, isRefineModelId, type RefineModelId } from "../rss/refine-model.ts";
import { applyChineseNameList, applyChineseNames } from "./chinese-names.ts";
import { hasStrayEnglish } from "./article.ts";
import { MODEL_PRIVATE_DIR } from "./config.ts";
import type { StoredItem } from "./store.ts";

export type RefineResult =
  | Readonly<{ kind: "ready"; titleZh: string; summaryZh: string; summaryEn: string | null; keyPointsZh: string[]; keyPointsEn: string[]; detailZh: string[] | null }>
  | Readonly<{ kind: "irrelevant" }>;

type ModelEndpoint = Readonly<{ model: RefineModelId; endpoint: string; key: string }>;

const REQUEST_TIMEOUT_MS = 60_000;
/** Lean publishing prefers the faster flash model. DeepSeek remains the fallback. */
export const DEFAULT_LEAN_REFINE_MODEL: RefineModelId = "glm-5.3-flash";
const HAN = /\p{Script=Han}/u;

const NAME_GUIDE = [
  "常见人名和车队一律用中文：安东内利、拉塞尔、阿隆索、斯特罗尔、阿斯顿·马丁、凯迪拉克。Racing Bulls 写成 RB 或小红牛。Sky Sports 写成天空体育。",
  "中文句子里不要留下小写英文单词，例如 stint、pit、focus、grid、shootout、somehow、sensation、tifosi、definitely、latest。译不出来的术语写成中文，并在括号里注明英文。",
  "undercut 写成提前进站，pits 写成维修区，sessions 写成各节练习与排位，bargeboard 写成导流板，junior 车队写成青训车队，Madring 写成马德里赛道。",
  "driver 指车手，不要译成车号。"
].join("");

const SYSTEM_PROMPT = [
  "你是F1中文资讯编辑。只根据用户提供的材料整理，不补充未提供的事实，不推测，不虚构引语。",
  "保留车手、车队、人名和赛事专有名词的通行译法；无法确定时保留英文专名。",
  "输出严格JSON对象，字段只有 relevant、titleZh、summaryZh、summaryEn、keyPointsZh、keyPointsEn、detailZh。",
  "relevant为布尔值：内容与F1、赛车运动或相关车手车队有关时为true；纯广告、与赛车无关的生活或娱乐内容为false。",
  "titleZh不超过40字。summaryZh只用1到2句讲核心事件。summaryEn是同样意思的1到2句完整英文，写完整个句子，不要在词中间停。",
  "keyPointsZh只写中文摘要里没有的新信息，最多3条。提供了 paragraphs 时至少写1条正文里的具体事实，并给出条数相同的 keyPointsEn；没有 paragraphs 且没有新信息时两个数组都为空。",
  "不要把英文单词从中间截断后接中文。gurney flap 译成格尼襟翼。",
  "如果提供了 paragraphs，detailZh必须是等长数组：按原段落顺序完整翻译，保留全部引述并加引号、注明说话人，不删减、不改写观点。没有 paragraphs 时 detailZh 为 null。",
  "来源为X帖子时，titleZh概括帖子，summaryZh用1到2句转述，summaryEn留空字符串。",
  NAME_GUIDE
].join("\n");

function readKey(fileName: string): string | null {
  const path = join(MODEL_PRIVATE_DIR, fileName);
  if (!existsSync(path)) return null;
  const key = readFileSync(path, "utf8").trim();
  return key.length > 0 ? key : null;
}

export function leanRefineModelOrder(preferred?: string): RefineModelId[] {
  const first = preferred && isRefineModelId(preferred) ? preferred : DEFAULT_LEAN_REFINE_MODEL;
  return [first, ...REFINE_MODEL_IDS.filter((id) => id !== first)];
}

export function resolveModel(preferred: string = DEFAULT_LEAN_REFINE_MODEL): ModelEndpoint {
  for (const modelId of leanRefineModelOrder(preferred)) {
    const entry = REFINE_MODEL_CATALOG[modelId];
    const key = readKey(entry.keyFileName);
    if (key) return { model: entry.modelId, endpoint: entry.endpoint, key };
  }
  throw new Error("MODEL_KEY_MISSING");
}

/** GLM spends reasoning tokens unless this is set; DeepSeek ignores the field. */
export function refineRequestBody(modelId: RefineModelId, messages: readonly { role: string; content: string }[]): Record<string, unknown> {
  return {
    model: modelId,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages,
    ...(modelId === "glm-5.3-flash" ? { reasoning_effort: "low" } : {})
  };
}

function expectsChinese(source: string): boolean {
  return (source.match(/\b[a-z]{3,}\b/g) ?? []).length >= 4;
}

function fold(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Drops key points that restate the summary. */
export function dropRepeatedPoints(summary: string, points: readonly string[]): string[] {
  const base = fold(summary);
  return points.filter((point) => {
    const folded = fold(point);
    if (folded.length < 6 || base.includes(folded) || (base.length >= 6 && folded.includes(base))) return false;
    const size = 4;
    if (folded.length < size || base.length < size) return true;
    const grams = new Set<string>();
    for (let index = 0; index <= base.length - size; index += 1) grams.add(base.slice(index, index + size));
    let shared = 0;
    const total = folded.length - size + 1;
    for (let index = 0; index <= folded.length - size; index += 1) if (grams.has(folded.slice(index, index + size))) shared += 1;
    return shared / total < 0.55;
  }).slice(0, 3);
}

function userPrompt(item: StoredItem, paragraphs: readonly string[] | null): string {
  const kind = item.platform === "x" ? `X帖子（${item.displayName}）` : `新闻（${item.displayName}）`;
  return JSON.stringify({
    来源类型: kind,
    标题: item.title,
    简介: item.text.slice(0, 1500),
    paragraphs: paragraphs ?? null
  });
}

export function parseRefineOutput(raw: string, requireRelevance: boolean, paragraphCount = 0, sources: readonly string[] = []): RefineResult {
  const value = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
  if (requireRelevance && value.relevant === false) return { kind: "irrelevant" };
  const titleZh = typeof value.titleZh === "string" ? value.titleZh.trim() : "";
  const summaryZh = typeof value.summaryZh === "string" ? value.summaryZh.trim() : "";
  const summaryEn = typeof value.summaryEn === "string" && value.summaryEn.trim().length > 0 ? value.summaryEn.trim() : null;
  const keyPointsZh = dropRepeatedPoints(summaryZh, Array.isArray(value.keyPointsZh)
    ? value.keyPointsZh.filter((point): point is string => typeof point === "string" && point.trim().length > 0).map((point) => point.trim()).slice(0, 3)
    : []);
  const keyPointsEn = dropRepeatedPoints(summaryEn ?? "", Array.isArray(value.keyPointsEn)
    ? value.keyPointsEn.filter((point): point is string => typeof point === "string" && point.trim().length > 0).map((point) => point.trim()).slice(0, keyPointsZh.length)
    : []).slice(0, keyPointsZh.length);
  if (!HAN.test(titleZh)) throw new Error("MODEL_OUTPUT_INVALID_TITLE");
  if (!HAN.test(summaryZh) || titleZh.length > 120 || summaryZh.length > 600) throw new Error("MODEL_OUTPUT_INVALID_SUMMARY");
  let detailZh: string[] | null = null;
  if (paragraphCount > 0) {
    if (!Array.isArray(value.detailZh)) throw new Error("MODEL_OUTPUT_INVALID_DETAIL");
    if (value.detailZh.length !== paragraphCount) throw new Error(`MODEL_OUTPUT_INVALID_DETAIL_LENGTH_${value.detailZh.length}_${paragraphCount}`);
    detailZh = value.detailZh.map((paragraph) => typeof paragraph === "string" ? paragraph.trim() : "");
    if (detailZh.some((paragraph) => paragraph.length === 0)) throw new Error("MODEL_OUTPUT_INVALID_DETAIL_EMPTY");
    const untranslated = detailZh.findIndex((paragraph, index) => !HAN.test(paragraph) && expectsChinese(sources[index] ?? "the team said this sentence"));
    if (untranslated >= 0) throw new Error(`MODEL_OUTPUT_INVALID_DETAIL_LANGUAGE_${untranslated}`);
  }
  return {
    kind: "ready",
    titleZh: applyChineseNames(titleZh),
    summaryZh: applyChineseNames(summaryZh),
    summaryEn,
    keyPointsZh: applyChineseNameList(keyPointsZh) ?? [],
    keyPointsEn,
    detailZh: applyChineseNameList(detailZh)
  };
}

async function requestRefine(item: StoredItem, model: ModelEndpoint, fetcher: typeof fetch, paragraphs: readonly string[] | null): Promise<RefineResult> {
  const response = await fetcher(model.endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { authorization: `Bearer ${model.key}`, "content-type": "application/json" },
    body: JSON.stringify(refineRequestBody(model.model, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt(item, paragraphs) }
    ]))
  });
  if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("MODEL_OUTPUT_MISSING");
  return parseRefineOutput(content, item.requireRelevance, paragraphs?.length ?? 0, paragraphs ?? []);
}

const TRANSLATION_CHUNK = 4;
const TRANSLATE_PROMPT = [
  "把 paragraphs 逐段译成中文。",
  "只输出 JSON 对象 {\"detailZh\": string[]}。",
  "detailZh 长度必须与 paragraphs 相同，一段对应一段，禁止合并、省略或概括。",
  "车号和人名可以保留英文；只要原文是完整句子，译文里就必须有中文。",
  NAME_GUIDE
].join("\n");

async function translateSlice(model: ModelEndpoint, fetcher: typeof fetch, slice: readonly string[]): Promise<string[]> {
  const response = await fetcher(model.endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { authorization: `Bearer ${model.key}`, "content-type": "application/json" },
    body: JSON.stringify(refineRequestBody(model.model, [
      { role: "system", content: TRANSLATE_PROMPT },
      { role: "user", content: JSON.stringify({ paragraphs: slice }) }
    ]))
  });
  if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("MODEL_OUTPUT_MISSING");
  const parsed = parseRefineOutput(JSON.stringify({
    relevant: true,
    titleZh: "补译",
    summaryZh: "补译段落。",
    summaryEn: "Filled.",
    keyPointsZh: [],
    keyPointsEn: [],
    detailZh: JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")).detailZh
  }), false, slice.length, slice);
  if (parsed.kind !== "ready" || !parsed.detailZh) throw new Error("MODEL_OUTPUT_INVALID_DETAIL");
  return [...parsed.detailZh];
}

async function translateParagraphs(model: ModelEndpoint, fetcher: typeof fetch, paragraphs: readonly string[]): Promise<string[]> {
  const translated: string[] = [];
  for (let index = 0; index < paragraphs.length; index += TRANSLATION_CHUNK) {
    const slice = paragraphs.slice(index, index + TRANSLATION_CHUNK);
    try {
      translated.push(...await translateSlice(model, fetcher, slice));
    } catch {
      for (const paragraph of slice) translated.push(...await translateSlice(model, fetcher, [paragraph]));
    }
  }
  return translated;
}

function chineseCopyHasStray(result: RefineResult): boolean {
  if (result.kind !== "ready") return false;
  return [result.titleZh, result.summaryZh, ...result.keyPointsZh, ...(result.detailZh ?? [])].some((part) => hasStrayEnglish(part));
}

export async function refineItem(item: StoredItem, model: ModelEndpoint, fetcher: typeof fetch = fetch, paragraphs: readonly string[] | null = null): Promise<RefineResult> {
  const overviewParagraphs = paragraphs && paragraphs.length > 0 ? paragraphs.slice(0, TRANSLATION_CHUNK) : null;
  const finish = async (overview: RefineResult): Promise<RefineResult> => {
    if (overview.kind !== "ready" || !paragraphs || paragraphs.length === 0) return overview;
    if (overview.detailZh?.length === paragraphs.length) return overview;
    return { ...overview, detailZh: await translateParagraphs(model, fetcher, paragraphs) };
  };
  let overview: RefineResult;
  try {
    overview = await requestRefine(item, model, fetcher, overviewParagraphs);
  } catch {
    overview = await requestRefine(item, model, fetcher, null);
  }
  let result = await finish(overview);
  if (chineseCopyHasStray(result)) {
    try {
      const again = await finish(await requestRefine(item, model, fetcher, overviewParagraphs));
      if (!chineseCopyHasStray(again)) result = again;
    } catch {
      // Keep the first Chinese copy when the second pass fails.
    }
  }
  return result;
}
