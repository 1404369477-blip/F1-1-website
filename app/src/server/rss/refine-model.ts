import { readPrivateFile } from "./private-credential-file.ts";

import { z } from "zod";

export const REFINE_MODEL_IDS = ["deepseek-chat", "glm-5.3-flash"] as const;
export type RefineModelId = (typeof REFINE_MODEL_IDS)[number];

export const DEFAULT_REFINE_MODEL_ID = "deepseek-chat" as const;
export const REFINEMENT_MODEL_SCHEMA_VERSION = "refinement-model-v1" as const;

export const DEEPSEEK_API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{20,200}$/;
export const GLM_API_KEY_PATTERN = /^[A-Za-z0-9]{16,80}\.[A-Za-z0-9]{8,80}$/;

const ISO8601Z_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const HAN_PATTERN = /\p{Script=Han}/u;
const KEY_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const IDEMPOTENCY_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const REFINE_SYSTEM_PROMPT = [
  "你是F1中文资讯编辑。只根据用户提供的RSS标题和摘要整理中文稿，不补充未提供的事实，不推测，不虚构引语。",
  "保留车手、车队、人名和赛事专有名词的通行译法；无法确定时保留英文专名。",
  "输出严格JSON对象，且只含titleZh、summaryZh、keyPointsZh三个字段。",
  "titleZh为准确简洁的中文新闻标题；summaryZh为一段中文精编摘要；keyPointsZh为1至3条中文事实要点。",
].join("\n");

export type RefineModelCatalogEntry = Readonly<{
  modelId: RefineModelId;
  endpoint: string;
  keyFileName: string;
  apiKeyPattern: RegExp;
  apiKeyInvalidCode: string;
  routeId: "route-deepseek" | "route-glm";
  idempotencyPrefix: string;
  persistMachineSummaryDraft: boolean;
  errorPrefix: "DEEPSEEK" | "GLM";
}>;

export const REFINE_MODEL_CATALOG: Readonly<
  Record<RefineModelId, RefineModelCatalogEntry>
> = Object.freeze({
  "deepseek-chat": Object.freeze({
    modelId: "deepseek-chat",
    endpoint: "https://api.deepseek.com/chat/completions",
    keyFileName: "deepseek-api-key",
    apiKeyPattern: DEEPSEEK_API_KEY_PATTERN,
    apiKeyInvalidCode: "DEEPSEEK_API_KEY_INVALID",
    routeId: "route-deepseek",
    idempotencyPrefix: "deepseek",
    persistMachineSummaryDraft: true,
    errorPrefix: "DEEPSEEK",
  }),
  "glm-5.3-flash": Object.freeze({
    modelId: "glm-5.3-flash",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    keyFileName: "glm-api-key",
    apiKeyPattern: GLM_API_KEY_PATTERN,
    apiKeyInvalidCode: "GLM_API_KEY_INVALID",
    routeId: "route-glm",
    idempotencyPrefix: "glm",
    persistMachineSummaryDraft: false,
    errorPrefix: "GLM",
  }),
});

export type RefinementModelConfig = Readonly<{
  schemaVersion: typeof REFINEMENT_MODEL_SCHEMA_VERSION;
  modelId: RefineModelId;
  updatedAt: string;
}>;

export const DEFAULT_REFINEMENT_MODEL_CONFIG: RefinementModelConfig =
  Object.freeze({
    schemaVersion: REFINEMENT_MODEL_SCHEMA_VERSION,
    modelId: DEFAULT_REFINE_MODEL_ID,
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

const Iso8601ZSchema = z
  .string()
  .refine(
    (value) =>
      ISO8601Z_PATTERN.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(Date.parse(value)).toISOString() === value,
  );

const RefinementModelConfigSchema = z
  .object({
    schemaVersion: z.literal(REFINEMENT_MODEL_SCHEMA_VERSION),
    modelId: z.enum(REFINE_MODEL_IDS),
    updatedAt: Iso8601ZSchema,
  })
  .strict();

const RefineOutputSchema = z
  .object({
    titleZh: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .refine((value) => HAN_PATTERN.test(value)),
    summaryZh: z
      .string()
      .trim()
      .min(1)
      .max(1200)
      .refine((value) => HAN_PATTERN.test(value)),
    keyPointsZh: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(240)
          .refine((value) => HAN_PATTERN.test(value)),
      )
      .min(1)
      .max(3),
  })
  .strict();

const RefineChatCompletionSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: z.string().min(1) }).passthrough(),
          })
          .passthrough(),
      )
      .length(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative(),
        completion_tokens: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

export type RefineOutput = Readonly<{
  titleZh: string;
  summaryZh: string;
  keyPointsZh: readonly string[];
}>;

export type ParsedRefineChatCompletion = Readonly<{
  output: RefineOutput;
  promptTokens: number;
  completionTokens: number;
}>;

export function isRefineModelId(value: string): value is RefineModelId {
  return (REFINE_MODEL_IDS as readonly string[]).includes(value);
}

export function refineModelById(modelId: string): RefineModelCatalogEntry {
  if (!isRefineModelId(modelId)) throw new Error("REFINE_MODEL_UNKNOWN");
  const model = REFINE_MODEL_CATALOG[modelId];
  if (!KEY_FILE_NAME_PATTERN.test(model.keyFileName))
    throw new Error("REFINE_MODEL_CATALOG_INVALID");
  if (
    !IDEMPOTENCY_PREFIX_PATTERN.test(model.idempotencyPrefix) ||
    model.idempotencyPrefix.includes("/")
  )
    throw new Error("REFINE_MODEL_CATALOG_INVALID");
  return model;
}

export function readRefinementModelConfig(
  configPath: string,
): RefinementModelConfig {
  let raw: string;
  try {
    const file = readPrivateFile(configPath, 4096);
    if (file === null) return DEFAULT_REFINEMENT_MODEL_CONFIG;
    raw = file.text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_REFINEMENT_MODEL_CONFIG;
    }
    throw new Error("REFINEMENT_MODEL_CONFIG_UNREADABLE");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("REFINEMENT_MODEL_CONFIG_INVALID");
  }
  const parsed = RefinementModelConfigSchema.safeParse(value);
  if (!parsed.success) throw new Error("REFINEMENT_MODEL_CONFIG_INVALID");
  return Object.freeze({
    schemaVersion: parsed.data.schemaVersion,
    modelId: parsed.data.modelId,
    updatedAt: parsed.data.updatedAt,
  });
}

export function readRefineModelApiKey(
  path: string,
  modelId: RefineModelId,
): string {
  const model = refineModelById(modelId);
  let key: string;
  try {
    key = readPrivateFile(path, 1024)?.text.trim() ?? "";
  } catch {
    throw new Error(model.apiKeyInvalidCode);
  }
  if (!model.apiKeyPattern.test(key)) throw new Error(model.apiKeyInvalidCode);
  return key;
}

export function parseRefineChatCompletion(
  rawResponse: string,
  model: RefineModelCatalogEntry,
): ParsedRefineChatCompletion {
  if (Buffer.byteLength(rawResponse, "utf8") > 128 * 1024)
    throw new Error(`${model.errorPrefix}_RESPONSE_TOO_LARGE`);
  let responseValue: unknown;
  try {
    responseValue = JSON.parse(rawResponse) as unknown;
  } catch {
    throw new Error(`${model.errorPrefix}_RESPONSE_INVALID`);
  }
  let envelope: z.infer<typeof RefineChatCompletionSchema>;
  try {
    envelope = RefineChatCompletionSchema.parse(responseValue);
  } catch {
    throw new Error(`${model.errorPrefix}_RESPONSE_INVALID`);
  }
  let contentValue: unknown;
  try {
    contentValue = JSON.parse(envelope.choices[0].message.content) as unknown;
  } catch {
    throw new Error(`${model.errorPrefix}_CONTENT_INVALID`);
  }
  let output: z.infer<typeof RefineOutputSchema>;
  try {
    output = RefineOutputSchema.parse(contentValue);
  } catch {
    throw new Error(`${model.errorPrefix}_CONTENT_INVALID`);
  }
  return Object.freeze({
    output: Object.freeze({
      titleZh: output.titleZh,
      summaryZh: output.summaryZh,
      keyPointsZh: Object.freeze([...output.keyPointsZh]),
    }),
    promptTokens: envelope.usage.prompt_tokens,
    completionTokens: envelope.usage.completion_tokens,
  });
}
