import { AutomaticTargetSchema, type AutomaticTarget } from "../rss-automatic/contract.ts";
import type { GatewayWriteInput } from "../internal-operation/gateway.ts";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "../db/database.ts";
import { LIVE_RSS_SOURCE_IDS } from "./sources.ts";
import { canonicalJson } from "../db/profile.ts";
import type { GatewayMutationPort } from "../internal-operation/mutation-port.ts";
import {
  DEFAULT_REFINE_MODEL_ID,
  parseRefineChatCompletion,
  readRefineModelApiKey,
  refineModelById,
  REFINE_SYSTEM_PROMPT,
  type RefineModelId,
} from "./refine-model.ts";

export const DEEPSEEK_PROMPT_SHA256 = createHash("sha256")
  .update(REFINE_SYSTEM_PROMPT, "utf8")
  .digest("hex");

type CandidateRow = Readonly<{
  candidate_id: string;
  source_id: string;
  source_revision: number;
  source_payload_hash: string;
  title: string;
  excerpt: string;
  author: string | null;
  published_at: string;
}>;

export type RefinementReceipt = Readonly<{
  schemaVersion: "rss-refinement-receipt-v1";
  status: "generated" | "idle" | "blocked";
  candidateId: string | null;
  sourceRevision: number | null;
  model: RefineModelId;
  promptSha256: string;
  responseSha256: string | null;
  inputTokens: number;
  outputTokens: number;
  externalCalls: 0 | 1;
  reasonCode?: "MODEL_SCHEMA_UNSUPPORTED";
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function candidateForRefinement(
  database: DatabaseSync,
  modelId: RefineModelId,
  target?: AutomaticTarget,
): CandidateRow | null {
  return (
    (database
      .prepare(
        `
    SELECT candidate_id, source_id, source_revision, source_payload_hash, title, excerpt, author, published_at
    FROM pending_review_candidate AS candidate
    WHERE candidate.source_id IN (${LIVE_RSS_SOURCE_IDS.map(() => "?").join(",")})
      AND candidate.review_status IN ('pending_review', 'approved', 'published')
      ${target ? "AND candidate.candidate_id=? AND candidate.source_revision=? AND candidate.source_payload_hash=?" : ""}
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
  `,
      )
      .get(...LIVE_RSS_SOURCE_IDS, ...(target ? [target.candidateId,target.sourceRevision,target.inputContentHash] : []), modelId, DEEPSEEK_PROMPT_SHA256) as CandidateRow | undefined) ?? null
  );
}

function refineOperationSeed(
  candidate: CandidateRow,
  modelId: RefineModelId,
): string {
  if (modelId === "deepseek-chat") {
    return `${candidate.candidate_id}\n${candidate.source_revision}\n${candidate.source_payload_hash}\n${DEEPSEEK_PROMPT_SHA256}`;
  }
  return `${candidate.candidate_id}\n${candidate.source_revision}\n${candidate.source_payload_hash}\n${modelId}\n${DEEPSEEK_PROMPT_SHA256}`;
}

/** A new paid completion is permitted only after every earlier attempt has a
 * durable, known response. The operation log provides the retry counter and
 * clock across restarts; unknown or unfinished attempts remain unreplayable. */
function knownResponseRetry(database: DatabaseSync, baseOperationId: string, now: Date,
  identity: Readonly<{candidate:CandidateRow;modelId:RefineModelId;bodySha256:string;routeId:string}>): number {
  const prefix = `${baseOperationId}-retry-`;
  const rows = database.prepare(`SELECT op.operation_id,op.state AS operation_state,op.updated_at,op.owner_process,op.operation_kind,
      op.capability_class,op.egress_class,op.candidate_id,op.source_id,op.expected_entity_version,op.expected_entity_hash,op.model_route_ref,
      attempt.state AS attempt_state,attempt.outcome,attempt.response_identity_sha256,attempt.canonical_request_json,attempt.route_id
    FROM internal_operation op LEFT JOIN internal_external_attempt attempt ON attempt.operation_id=op.operation_id
    WHERE op.operation_id=? OR substr(op.operation_id,1,?)=?`).all(baseOperationId,prefix.length,prefix);
  if (rows.length === 0) return 0;
  let ordinal = 0, latest = 0;
  for (const row of rows) {
    const request = row.canonical_request_json ? JSON.parse(String(row.canonical_request_json)) as Record<string,unknown> : null;
    if (row.owner_process !== "rss_refiner" || row.operation_kind !== "refine" || row.capability_class !== "external_attempt"
      || row.egress_class !== "model_https" || row.candidate_id !== identity.candidate.candidate_id || row.source_id !== identity.candidate.source_id
      || row.expected_entity_version !== identity.candidate.source_revision || row.expected_entity_hash !== identity.candidate.source_payload_hash
      || row.model_route_ref !== identity.modelId || row.route_id !== identity.routeId
      || request?.providerResource !== identity.modelId || request?.bodySha256 !== identity.bodySha256) throw new Error("REFINEMENT_RETRY_IDENTITY_INVALID");
    const suffix = String(row.operation_id).slice(prefix.length);
    const number = row.operation_id === baseOperationId ? 0 : /^[1-9][0-9]*$/.test(suffix) ? Number(suffix) : NaN;
    if (!Number.isSafeInteger(number) || number < 0 || row.attempt_state !== "response_committed"
      || !/^[a-f0-9]{64}$/.test(String(row.response_identity_sha256))
      || !(row.outcome === "succeeded" && row.operation_state === "succeeded"
        || row.outcome === "known_failed" && row.operation_state === "terminal_failed")) throw new Error("EXTERNAL_RECONCILE_REQUIRED");
    ordinal = Math.max(ordinal,number+1);
    const completedAt = Date.parse(String(row.updated_at));
    if (!Number.isFinite(completedAt)) throw new Error("REFINEMENT_RETRY_CLOCK_INVALID");
    latest = Math.max(latest,completedAt);
  }
  const delay = Math.min(3_600_000,60_000 * 2 ** Math.min(ordinal-1,6));
  if (!Number.isFinite(now.getTime()) || now.getTime() < latest + delay) throw new Error("REFINEMENT_RETRY_BACKOFF");
  return ordinal;
}

export async function refineOneCandidate(
  input: Readonly<{
    database: DatabaseSync;
    apiKeyPath: string;
    modelId?: RefineModelId;
    target?: AutomaticTarget;
    budgetAccountId?: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
    mutationPort?: GatewayMutationPort;
  }>,
): Promise<RefinementReceipt> {
  const model = refineModelById(input.modelId ?? DEFAULT_REFINE_MODEL_ID);
  const schemaVersion = Number(
    (
      input.database.prepare("PRAGMA user_version").get() as Record<
        string,
        unknown
      >
    ).user_version,
  );
  if (
    schemaVersion >= 7 &&
    (!input.mutationPort || !input.mutationPort.runExternal)
  )
    throw new Error("GATEWAY_EXTERNAL_ATTEMPT_PORT_REQUIRED");
  if (input.target) AutomaticTargetSchema.parse(input.target);
  const assertCurrent = (): void => {
    if (!input.target) return;
    const row = input.database.prepare("SELECT source_revision,source_payload_hash FROM pending_review_candidate WHERE candidate_id=?").get(input.target.candidateId);
    if (!row || row.source_revision !== input.target.sourceRevision || row.source_payload_hash !== input.target.inputContentHash) throw new Error("REFINEMENT_SOURCE_STALE");
  };
  assertCurrent();
  const candidate = candidateForRefinement(input.database, model.modelId,input.target);
  if (candidate === null) {
    return {
      schemaVersion: "rss-refinement-receipt-v1",
      status: "idle",
      candidateId: null,
      sourceRevision: null,
      model: model.modelId,
      promptSha256: DEEPSEEK_PROMPT_SHA256,
      responseSha256: null,
      inputTokens: 0,
      outputTokens: 0,
      externalCalls: 0,
    };
  }

  if (!model.persistMachineSummaryDraft) {
    return {
      schemaVersion: "rss-refinement-receipt-v1",
      status: "blocked",
      candidateId: candidate.candidate_id,
      sourceRevision: candidate.source_revision,
      model: model.modelId,
      promptSha256: DEEPSEEK_PROMPT_SHA256,
      responseSha256: null,
      inputTokens: 0,
      outputTokens: 0,
      externalCalls: 0,
      reasonCode: "MODEL_SCHEMA_UNSUPPORTED",
    };
  }

  const userPayload = canonicalJson({
    title: candidate.title,
    excerpt: candidate.excerpt,
    author: candidate.author,
    publishedAt: candidate.published_at,
  });
  const hasAutomaticStore = schemaVersion >= 7 && input.database.prepare("SELECT 1 FROM internal_operation_policy WHERE policy_id='p-refine-rss-store-live'").get() !== undefined;
  const baseOperationId = `gateway-refine-${sha256(refineOperationSeed(candidate, model.modelId))}`;
  const requestBody = canonicalJson({
    model: model.modelId,
    messages: [
      { role: "system", content: REFINE_SYSTEM_PROMPT },
      { role: "user", content: userPayload },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 900,
    stream: false,
  });
  const retry = hasAutomaticStore ? knownResponseRetry(input.database,baseOperationId,(input.now ?? (() => new Date()))(),
    {candidate,modelId:model.modelId,bodySha256:sha256(requestBody),routeId:model.routeId}) : 0;
  const requestOperationId = retry === 0 ? baseOperationId : `${baseOperationId}-retry-${retry}`;
  const retryKey = retry === 0 ? "" : `:retry:${retry}`;
  const apiKey = readRefineModelApiKey(input.apiKeyPath, model.modelId);
  const externalResult =
    schemaVersion >= 7
      ? await input.mutationPort!.runExternal!({
          operationId: requestOperationId,
          operationKind: "refine",
          ownerProcess: "rss_refiner",
          endpointClass: "model_refine",
          providerResource: model.modelId,
          routeId: model.routeId,
          method: "POST",
          externalIdempotencyKey: `${model.idempotencyPrefix}:${candidate.candidate_id}:${candidate.source_revision}:${candidate.source_payload_hash}${retryKey}`,
          reconcileKey: `reconcile:${model.idempotencyPrefix}:${candidate.candidate_id}:${candidate.source_revision}:${candidate.source_payload_hash}${retryKey}`,
          headers: [
            { name: "content-type", valueSha256: sha256("application/json") },
          ],
          bodySha256: sha256(requestBody),
          identity: {
            sourceId: candidate.source_id,
            candidateId: candidate.candidate_id,
            publicationId: null,
            publicId: null,
          },
          entityKind: "candidate",
          entityId: candidate.candidate_id,
          expectedVersion: candidate.source_revision,
          expectedHash: candidate.source_payload_hash,
          sourceStopEpoch: Number(input.database.prepare("SELECT stop_epoch FROM source WHERE source_id=?").get(candidate.source_id)!.stop_epoch),
          budgetAccountId: input.budgetAccountId,
          egressClass: "model_https",
          modelRouteRef: model.modelId,
          execute: async () => {
            assertCurrent();
            const adapterResponse = await (input.fetchImpl ?? fetch)(
              model.endpoint,
              {
                method: "POST",
                headers: {
                  authorization: `Bearer ${apiKey}`,
                  "content-type": "application/json",
                },
                body: requestBody,
                signal: AbortSignal.timeout(30_000),
              },
            );
            const adapterBody = await adapterResponse.text();
            return {
              value: {
                ok: adapterResponse.ok,
                status: adapterResponse.status,
                rawResponse: adapterBody,
              },
              response: {
                providerResourceIdentity: model.endpoint,
                providerStatus: String(adapterResponse.status),
                responseBodySha256: sha256(adapterBody),
                responseHeaderHashes: [],
                outcome: adapterResponse.ok
                  ? ("succeeded" as const)
                  : ("known_failed" as const),
                reasonCode: adapterResponse.ok
                  ? null
                  : `${model.errorPrefix}_HTTP_STATUS`,
              },
            };
          },
        })
      : await (async () => {
          assertCurrent();
          const adapterResponse = await (input.fetchImpl ?? fetch)(
            model.endpoint,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${apiKey}`,
                "content-type": "application/json",
              },
              body: requestBody,
              signal: AbortSignal.timeout(30_000),
            },
          );
          return {
            ok: adapterResponse.ok,
            status: adapterResponse.status,
            rawResponse: await adapterResponse.text(),
          };
        })();
  if (!externalResult.ok)
    throw new Error(`${model.errorPrefix}_HTTP_${externalResult.status}`);
  const rawResponse = externalResult.rawResponse;
  const parsed = parseRefineChatCompletion(rawResponse, model);
  const responseSha256 = sha256(rawResponse);
  const generatedAt = (input.now ?? (() => new Date()))().toISOString();
  const draftId = `draft-${sha256(
    canonicalJson({
      candidateId: candidate.candidate_id,
      sourceRevision: candidate.source_revision,
      sourcePayloadHash: candidate.source_payload_hash,
      model: model.modelId,
      promptSha256: DEEPSEEK_PROMPT_SHA256,
    }),
  )}`;

  const persistDraft = (gatewayMutate?: (write: GatewayWriteInput) => number): void => {
    assertCurrent();
    const current = input.database
      .prepare(
        "SELECT source_revision, source_payload_hash FROM pending_review_candidate WHERE candidate_id = ?",
      )
      .get(candidate.candidate_id) as Record<string, unknown> | undefined;
    if (
      current === undefined ||
      Number(current.source_revision) !== candidate.source_revision ||
      current.source_payload_hash !== candidate.source_payload_hash
    )
      throw new Error("REFINEMENT_SOURCE_STALE");
    const statement = `INSERT INTO machine_summary_draft (
        draft_id, candidate_id, source_revision, source_payload_hash, model, prompt_sha256,
        response_sha256, title_zh, summary_zh, key_points_zh_json, input_tokens,
        output_tokens, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const parameters = [
      draftId,
      candidate.candidate_id,
      candidate.source_revision,
      candidate.source_payload_hash,
      model.modelId,
      DEEPSEEK_PROMPT_SHA256,
      responseSha256,
      parsed.output.titleZh,
      parsed.output.summaryZh,
      canonicalJson(parsed.output.keyPointsZh),
      parsed.promptTokens,
      parsed.completionTokens,
      generatedAt,
    ] as const;
    if (hasAutomaticStore) {
      if (!gatewayMutate) throw new Error("REFINEMENT_TRANSACTION_REQUIRED");
      const carrier = input.database.prepare(`SELECT 1 FROM internal_operation WHERE operation_id=? AND owner_process='rss_refiner'
        AND operation_kind='refine' AND capability_class='external_attempt' AND egress_class='model_https' AND state='succeeded'
        AND candidate_id=? AND source_id=? AND expected_entity_version=? AND expected_entity_hash=? AND model_route_ref=?`).get(requestOperationId,candidate.candidate_id,candidate.source_id,candidate.source_revision,candidate.source_payload_hash,model.modelId);
      if (!carrier) throw new Error("REFINEMENT_CARRIER_INVALID");
      const changes = gatewayMutate({entityKind:"machine_draft",entityId:draftId,mutationKind:"insert",expectedVersion:null,expectedHash:"0".repeat(64),statement,parameters});
      if (changes !== 1) throw new Error("REFINEMENT_WRITE_FAILED");
    } else if (schemaVersion >= 7) {
      const changed = input.mutationPort!.mutate({
        operationId: `gateway-refine-${sha256(`${draftId}\n${responseSha256}`)}`,
        operationKind: "refine",
        entityKind: "machine_draft",
        entityId: draftId,
        mutationKind: "insert",
        statement,
        parameters,
        identity: {
          sourceId: candidate.source_id,
          candidateId: candidate.candidate_id,
          publicationId: null,
          publicId: null,
        },
        capabilityClass: "external_attempt",
        egressClass: "model_https",
        modelRouteRef: model.modelId,
      });
      if (changed !== 1) throw new Error("REFINEMENT_WRITE_FAILED");
    } else {
      const changed = withImmediateTransaction(
        input.database,
        () => input.database.prepare(statement).run(...parameters).changes,
      );
      if (Number(changed) !== 1) throw new Error("REFINEMENT_WRITE_FAILED");
    }
  };
  if (hasAutomaticStore) {
    if (!input.mutationPort?.runTransaction) throw new Error("REFINEMENT_TRANSACTION_REQUIRED");
    const phase = String(input.database.prepare("SELECT phase FROM internal_control").get()!.phase);
    const ZERO = "0".repeat(64);
    input.mutationPort.runTransaction({operationId:`rss-refine-store-${sha256(`${requestOperationId}\n${draftId}\n${responseSha256}`)}`,operationKind:"refine",ownerProcess:"rss_refiner",
      policyId:`p-refine-rss-store-${phase}`,capabilityClass:"db_mutation",egressClass:"none",
      identity:{sourceId:candidate.source_id,candidateId:candidate.candidate_id,publicationId:null,publicId:null},
      sourceStopEpoch:Number(input.database.prepare("SELECT stop_epoch FROM source WHERE source_id=?").get(candidate.source_id)!.stop_epoch),
      entitySet:[{entityKind:"candidate",entityId:candidate.candidate_id,identitySelector:"candidate_id",expectedVersion:candidate.source_revision,expectedHash:candidate.source_payload_hash},
        {entityKind:"source",entityId:candidate.source_id,identitySelector:"source_id",expectedVersion:null,expectedHash:ZERO},
        {entityKind:"machine_draft",entityId:draftId,identitySelector:"bound_child",expectedVersion:null,expectedHash:ZERO}],
      requestHash:sha256(canonicalJson({requestOperationId,draftId,responseSha256})),
    },persistDraft);
  } else persistDraft();

  return {
    schemaVersion: "rss-refinement-receipt-v1",
    status: "generated",
    candidateId: candidate.candidate_id,
    sourceRevision: candidate.source_revision,
    model: model.modelId,
    promptSha256: DEEPSEEK_PROMPT_SHA256,
    responseSha256,
    inputTokens: parsed.promptTokens,
    outputTokens: parsed.completionTokens,
    externalCalls: 1,
  };
}
