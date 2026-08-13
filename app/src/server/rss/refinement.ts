import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { withImmediateTransaction } from "../db/database.ts";
import { canonicalJson } from "../db/profile.ts";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions" as const;
const DEEPSEEK_MODEL = "deepseek-chat" as const;
const API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{20,200}$/;
const HAN_PATTERN = /\p{Script=Han}/u;

const OutputSchema = z.object({
  titleZh: z.string().trim().min(1).max(400).refine((value) => HAN_PATTERN.test(value)),
  summaryZh: z.string().trim().min(1).max(1200).refine((value) => HAN_PATTERN.test(value)),
  keyPointsZh: z.array(z.string().trim().min(1).max(240).refine((value) => HAN_PATTERN.test(value))).min(1).max(3)
}).strict();

const ResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().min(1) }).passthrough()
  }).passthrough()).length(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative()
  }).passthrough()
}).passthrough();

const SYSTEM_PROMPT = [
  "你是F1中文资讯编辑。只根据用户提供的RSS标题和摘要整理中文稿，不补充未提供的事实，不推测，不虚构引语。",
  "保留车手、车队、人名和赛事专有名词的通行译法；无法确定时保留英文专名。",
  "输出严格JSON对象，且只含titleZh、summaryZh、keyPointsZh三个字段。",
  "titleZh为准确简洁的中文新闻标题；summaryZh为一段中文精编摘要；keyPointsZh为1至3条中文事实要点。"
].join("\n");

export const DEEPSEEK_PROMPT_SHA256 = createHash("sha256").update(SYSTEM_PROMPT, "utf8").digest("hex");

type CandidateRow = Readonly<{
  candidate_id: string;
  source_revision: number;
  source_payload_hash: string;
  title: string;
  excerpt: string;
  author: string | null;
  published_at: string;
}>;

export type RefinementReceipt = Readonly<{
  schemaVersion: "rss-refinement-receipt-v1";
  status: "generated" | "idle";
  candidateId: string | null;
  sourceRevision: number | null;
  model: typeof DEEPSEEK_MODEL;
  promptSha256: string;
  responseSha256: string | null;
  inputTokens: number;
  outputTokens: number;
  externalCalls: 0 | 1;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readApiKey(path: string): string {
  const key = readFileSync(path, "utf8").trim();
  if (!API_KEY_PATTERN.test(key)) throw new Error("DEEPSEEK_API_KEY_INVALID");
  return key;
}

function candidateForRefinement(database: DatabaseSync): CandidateRow | null {
  return (database.prepare(`
    SELECT candidate_id, source_revision, source_payload_hash, title, excerpt, author, published_at
    FROM pending_review_candidate AS candidate
    WHERE candidate.review_status = 'pending_review'
      AND NOT EXISTS (
        SELECT 1 FROM machine_summary_draft AS draft
        WHERE draft.candidate_id = candidate.candidate_id
          AND draft.source_revision = candidate.source_revision
          AND draft.source_payload_hash = candidate.source_payload_hash
          AND draft.model = ?
          AND draft.prompt_sha256 = ?
      )
    ORDER BY candidate.published_at DESC, candidate.candidate_id
    LIMIT 1
  `).get(DEEPSEEK_MODEL, DEEPSEEK_PROMPT_SHA256) as CandidateRow | undefined) ?? null;
}

export async function refineOneCandidate(input: Readonly<{
  database: DatabaseSync;
  apiKeyPath: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}>): Promise<RefinementReceipt> {
  const candidate = candidateForRefinement(input.database);
  if (candidate === null) {
    return {
      schemaVersion: "rss-refinement-receipt-v1",
      status: "idle",
      candidateId: null,
      sourceRevision: null,
      model: DEEPSEEK_MODEL,
      promptSha256: DEEPSEEK_PROMPT_SHA256,
      responseSha256: null,
      inputTokens: 0,
      outputTokens: 0,
      externalCalls: 0
    };
  }

  const userPayload = canonicalJson({
    title: candidate.title,
    excerpt: candidate.excerpt,
    author: candidate.author,
    publishedAt: candidate.published_at
  });
  const apiKey = readApiKey(input.apiKeyPath);
  const requestBody = canonicalJson({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPayload }
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 900,
    stream: false
  });
  const response = await (input.fetchImpl ?? fetch)(DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: requestBody,
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`DEEPSEEK_HTTP_${response.status}`);
  const rawResponse = await response.text();
  if (Buffer.byteLength(rawResponse, "utf8") > 128 * 1024) throw new Error("DEEPSEEK_RESPONSE_TOO_LARGE");
  let responseValue: unknown;
  try {
    responseValue = JSON.parse(rawResponse) as unknown;
  } catch {
    throw new Error("DEEPSEEK_RESPONSE_INVALID");
  }
  const envelope = ResponseSchema.parse(responseValue);
  let contentValue: unknown;
  try {
    contentValue = JSON.parse(envelope.choices[0].message.content) as unknown;
  } catch {
    throw new Error("DEEPSEEK_CONTENT_INVALID");
  }
  const output = OutputSchema.parse(contentValue);
  const responseSha256 = sha256(rawResponse);
  const generatedAt = (input.now ?? (() => new Date()))().toISOString();
  const draftId = `draft-${sha256(canonicalJson({
    candidateId: candidate.candidate_id,
    sourceRevision: candidate.source_revision,
    sourcePayloadHash: candidate.source_payload_hash,
    model: DEEPSEEK_MODEL,
    promptSha256: DEEPSEEK_PROMPT_SHA256
  }))}`;

  withImmediateTransaction(input.database, () => {
    const current = input.database.prepare(
      "SELECT source_revision, source_payload_hash FROM pending_review_candidate WHERE candidate_id = ?"
    ).get(candidate.candidate_id) as Record<string, unknown> | undefined;
    if (
      current === undefined ||
      Number(current.source_revision) !== candidate.source_revision ||
      current.source_payload_hash !== candidate.source_payload_hash
    ) throw new Error("REFINEMENT_SOURCE_STALE");
    input.database.prepare(`
      INSERT INTO machine_summary_draft (
        draft_id, candidate_id, source_revision, source_payload_hash, model, prompt_sha256,
        response_sha256, title_zh, summary_zh, key_points_zh_json, input_tokens,
        output_tokens, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      draftId,
      candidate.candidate_id,
      candidate.source_revision,
      candidate.source_payload_hash,
      DEEPSEEK_MODEL,
      DEEPSEEK_PROMPT_SHA256,
      responseSha256,
      output.titleZh,
      output.summaryZh,
      canonicalJson(output.keyPointsZh),
      envelope.usage.prompt_tokens,
      envelope.usage.completion_tokens,
      generatedAt
    );
  });

  return {
    schemaVersion: "rss-refinement-receipt-v1",
    status: "generated",
    candidateId: candidate.candidate_id,
    sourceRevision: candidate.source_revision,
    model: DEEPSEEK_MODEL,
    promptSha256: DEEPSEEK_PROMPT_SHA256,
    responseSha256,
    inputTokens: envelope.usage.prompt_tokens,
    outputTokens: envelope.usage.completion_tokens,
    externalCalls: 1
  };
}
