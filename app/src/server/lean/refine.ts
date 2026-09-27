import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REFINE_MODEL_CATALOG, REFINE_MODEL_IDS, isRefineModelId, type RefineModelId } from "../rss/refine-model.ts";
import { hasStrayEnglish, hasUntranslatedEnglishSentence, isChromeVideoPlayerLine, strayEnglishWords, stripChromeVideoPlayerSentences } from "./article.ts";
import { applyChineseNameList, applyChineseNames } from "./chinese-names.ts";
import { MODEL_PRIVATE_DIR } from "./config.ts";
import type { StoredItem } from "./store.ts";

export type RefineResult =
  | Readonly<{ kind: "ready"; titleZh: string; summaryZh: string; summaryEn: string | null; keyPointsZh: string[]; keyPointsEn: string[]; detailZh: string[] | null }>
  | Readonly<{ kind: "irrelevant" }>;

export type ModelEndpoint = Readonly<{ model: RefineModelId; endpoint: string; key: string }>;
export type ModelErrorKind = "temporary" | "permanent" | "quality";

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
  "来源为X帖子时，titleZh概括帖子，summaryZh用1到2句转述，summaryEn留空字符串，keyPointsZh和keyPointsEn必须是空数组。",
  NAME_GUIDE
].join("\n");

function readKey(fileName: string): string | null {
  try {
    const path = join(MODEL_PRIVATE_DIR, fileName);
    if (!existsSync(path)) return null;
    const key = readFileSync(path, "utf8").trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export function leanRefineModelOrder(preferred?: string): RefineModelId[] {
  const first = preferred && isRefineModelId(preferred) ? preferred : DEFAULT_LEAN_REFINE_MODEL;
  return [first, ...REFINE_MODEL_IDS.filter((id) => id !== first)];
}

export function resolveModels(preferred: string = DEFAULT_LEAN_REFINE_MODEL): ModelEndpoint[] {
  const models: ModelEndpoint[] = [];
  for (const modelId of leanRefineModelOrder(preferred)) {
    const entry = REFINE_MODEL_CATALOG[modelId];
    const key = readKey(entry.keyFileName);
    if (key) models.push({ model: entry.modelId, endpoint: entry.endpoint, key });
  }
  if (models.length === 0) throw new Error("MODEL_KEY_MISSING");
  return models;
}

export function resolveModel(preferred: string = DEFAULT_LEAN_REFINE_MODEL): ModelEndpoint {
  return resolveModels(preferred)[0];
}

/** Only safe codes cross the model boundary; provider response bodies are never included. */
export function classifyModelError(error: unknown): ModelErrorKind {
  const code = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (code.startsWith("MODEL_OUTPUT_") || code === "MODEL_FALLBACK_QUALITY") return "quality";
  if (code === "MODEL_NETWORK_TEMPORARY" || code === "MODEL_FALLBACK_TEMPORARY") return "temporary";
  const http = /^MODEL_HTTP_(\d{3})$/.exec(code);
  if (http) return [408, 425, 429].includes(Number(http[1])) || Number(http[1]) >= 500 ? "temporary" : "permanent";
  return "permanent";
}

function parseObject(raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as unknown;
  } catch {
    throw new Error("MODEL_OUTPUT_INVALID_JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MODEL_OUTPUT_INVALID_OBJECT");
  return value as Record<string, unknown>;
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
  const words = (source.match(/[A-Za-z]+/g) ?? []).length;
  return words >= 3 || (words > 0 && /[.!?]["”']?$/.test(source.trim()));
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
  const value = parseObject(raw);
  if (requireRelevance && value.relevant === false) return { kind: "irrelevant" };
  const titleZh = typeof value.titleZh === "string" ? value.titleZh.trim() : "";
  const summaryZh = typeof value.summaryZh === "string" ? value.summaryZh.trim() : "";
  const summaryEn = typeof value.summaryEn === "string" && value.summaryEn.trim().length > 0 ? value.summaryEn.trim() : null;
  // Keep each translation attached to its original index when a repeated point is removed.
  const englishPoints: unknown[] = Array.isArray(value.keyPointsEn) ? value.keyPointsEn : [];
  const points = (Array.isArray(value.keyPointsZh) ? value.keyPointsZh : [])
    .map((point: unknown, index: number) => ({
      zh: typeof point === "string" ? point.trim() : "",
      en: typeof englishPoints[index] === "string" ? (englishPoints[index] as string).trim() : ""
    }))
    .filter((point) => dropRepeatedPoints(summaryZh, [point.zh]).length > 0)
    .slice(0, 3);
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
  const namedSummaryZh = stripChromeVideoPlayerSentences(applyChineseNames(summaryZh));
  if (!HAN.test(namedSummaryZh)) throw new Error("MODEL_OUTPUT_INVALID_SUMMARY");
  const namedSummaryEn = summaryEn === null ? null : stripChromeVideoPlayerSentences(summaryEn);
  const keptZh: string[] = [];
  const keptEn: string[] = [];
  points.forEach(({ zh, en: english }) => {
    const point = applyChineseNames(zh);
    if (isChromeVideoPlayerLine(point) || (english !== "" && isChromeVideoPlayerLine(english))) return;
    keptZh.push(point);
    keptEn.push(english);
  });
  return {
    kind: "ready",
    titleZh: applyChineseNames(titleZh),
    summaryZh: namedSummaryZh,
    summaryEn: namedSummaryEn && namedSummaryEn.length > 0 ? namedSummaryEn : null,
    keyPointsZh: keptZh,
    keyPointsEn: keptEn.every((point) => point.length > 0) ? keptEn : [],
    detailZh: applyChineseNameList(detailZh)
  };
}

async function requestContent(model: ModelEndpoint, fetcher: typeof fetch, system: string, user: string): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(model.endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { authorization: `Bearer ${model.key}`, "content-type": "application/json" },
      body: JSON.stringify(refineRequestBody(model.model, [
        { role: "system", content: system },
        { role: "user", content: user }
      ]))
    });
  } catch {
    throw new Error("MODEL_NETWORK_TEMPORARY");
  }
  if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    throw new Error("MODEL_NETWORK_TEMPORARY");
  }
  if (raw.length > 128 * 1024) throw new Error("MODEL_OUTPUT_RESPONSE_LIMIT");
  const body = parseObject(raw);
  const choice = Array.isArray(body.choices) ? body.choices[0] as { message?: { content?: unknown } } | null : null;
  const content = choice?.message?.content;
  if (typeof content !== "string") throw new Error("MODEL_OUTPUT_MISSING");
  return content;
}

async function requestRefine(item: StoredItem, model: ModelEndpoint, fetcher: typeof fetch, paragraphs: readonly string[] | null, correction = false): Promise<RefineResult> {
  const system = correction ? `${SYSTEM_PROMPT}\n本次为中文质量纠正：完整翻译所有英文句子和普通英文词汇，保留原材料的全部事实与段落顺序。` : SYSTEM_PROMPT;
  const content = await requestContent(model, fetcher, system, userPrompt(item, paragraphs));
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
  const content = await requestContent(model, fetcher, TRANSLATE_PROMPT, JSON.stringify({ paragraphs: slice }));
  const parsed = parseRefineOutput(JSON.stringify({
    relevant: true,
    titleZh: "补译",
    summaryZh: "补译段落。",
    summaryEn: "Filled.",
    keyPointsZh: [],
    keyPointsEn: [],
    detailZh: parseObject(content).detailZh
  }), false, slice.length, slice);
  if (parsed.kind !== "ready" || !parsed.detailZh) throw new Error("MODEL_OUTPUT_INVALID_DETAIL");
  return [...parsed.detailZh];
}

async function translateParagraphs(model: ModelEndpoint, fetcher: typeof fetch, paragraphs: readonly string[]): Promise<string[]> {
  const translated: string[] = [];
  for (let index = 0; index < paragraphs.length; index += TRANSLATION_CHUNK) {
    const slice = paragraphs.slice(index, index + TRANSLATION_CHUNK);
    translated.push(...await translateSlice(model, fetcher, slice));
  }
  return translated;
}

function chineseCopyHasStray(result: RefineResult): boolean {
  if (result.kind !== "ready") return false;
  return chineseParts(result).some((part) => hasStrayEnglish(part) || (!HAN.test(part) && expectsChinese(part)));
}

function chineseParts(result: Extract<RefineResult, { kind: "ready" }>): string[] {
  return [result.titleZh, result.summaryZh, ...result.keyPointsZh, ...(result.detailZh ?? [])];
}

/** An isolated term is repairable soft copy; untranslated sentences must not be published. */
function hasUntranslatedCopy(result: RefineResult): boolean {
  return result.kind === "ready" && chineseParts(result).some((part) =>
    (!HAN.test(part) && expectsChinese(part)) || strayEnglishWords(part).length >= 3
    || hasUntranslatedEnglishSentence(part)
  );
}

export async function refineItem(item: StoredItem, model: ModelEndpoint, fetcher: typeof fetch = fetch, paragraphs: readonly string[] | null = null): Promise<RefineResult> {
  const overviewParagraphs = paragraphs && paragraphs.length > 0 ? paragraphs.slice(0, TRANSLATION_CHUNK) : null;
  const finish = async (overview: RefineResult): Promise<RefineResult> => {
    if (overview.kind !== "ready" || !paragraphs || paragraphs.length === 0) return overview;
    if (overview.detailZh?.length === paragraphs.length) return overview;
    const initial = overview.detailZh ?? [];
    return { ...overview, detailZh: [...initial, ...await translateParagraphs(model, fetcher, paragraphs.slice(initial.length))] };
  };
  const overview = await requestRefine(item, model, fetcher, overviewParagraphs);
  let result = await finish(overview);
  let correctionFailure: unknown;
  if (chineseCopyHasStray(result) || hasUntranslatedCopy(result)) {
    try {
      const again = await finish(await requestRefine(item, model, fetcher, overviewParagraphs, true));
      if (again.kind === "ready" && !chineseCopyHasStray(again) && !hasUntranslatedCopy(again)) result = again;
    } catch (error) {
      correctionFailure = error;
      // Keep the first Chinese copy when the second pass fails.
    }
  }
  if (hasUntranslatedCopy(result)) {
    if (classifyModelError(correctionFailure) === "temporary") throw correctionFailure;
    throw new Error("MODEL_OUTPUT_UNTRANSLATED_COPY");
  }
  if (item.platform === "x" && result.kind === "ready") return { ...result, keyPointsZh: [], keyPointsEn: [] };
  return result;
}

/** Try each configured model once. Per-model correction is bounded inside refineItem. */
export async function refineWithFallback(item: StoredItem, models: readonly ModelEndpoint[], fetcher: typeof fetch = fetch, paragraphs: readonly string[] | null = null): Promise<RefineResult> {
  if (models.length === 0) throw new Error("MODEL_KEY_MISSING");
  const failures: ModelErrorKind[] = [];
  const tried = new Set<RefineModelId>();
  for (const model of models) {
    if (tried.has(model.model)) continue;
    tried.add(model.model);
    try {
      return await refineItem(item, model, fetcher, paragraphs);
    } catch (error) {
      failures.push(classifyModelError(error));
    }
  }
  const kind = failures.includes("temporary") ? "TEMPORARY" : failures.includes("quality") ? "QUALITY" : "PERMANENT";
  throw new Error(`MODEL_FALLBACK_${kind}`);
}
