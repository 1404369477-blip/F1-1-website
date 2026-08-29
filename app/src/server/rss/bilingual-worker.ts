import {
  AUTOMATIC_REFINEMENT_POLICY,
  BilingualContractError,
  CLOSED_BILINGUAL_MUTATION_PORT,
  type BilingualLanguage,
  type BilingualLanguageAttemptPlan,
  type BilingualLineage,
  type BilingualMutationPort,
  type BilingualProblemCode,
  type BudgetReceipt,
  type LocalizedDraft,
  type ModelRouteReceipt,
  parseLocalizedDraft,
  planBilingualRefinement,
  assertModelReceipts,
  assertAutomaticAction
} from "./bilingual-core.ts";

// The type alias is declared locally below; keeping the worker's result
// bounded prevents model/raw source bytes from leaking into an Admin/Public
// response or receipt.
export type BilingualModelAttemptResult = Readonly<{
  rawJson: string | null;
  route: ModelRouteReceipt;
  budget: BudgetReceipt;
  externalCalls: 1;
  response: Readonly<{
    providerResourceIdentity: string;
    providerStatus: string;
    responseBodySha256: string;
    responseHeaderHashes: readonly string[];
    outcome: "succeeded" | "known_failed";
    reasonCode: string | null;
  }>;
}>;

export type BilingualModelInput = Readonly<{
  candidateId: string;
  sourceRevision: number;
  language: BilingualLanguage;
  sourceTitle: string;
  sourceAuthor: string | null;
  sourcePublishedAt: string | null;
  canonicalUrl: string;
  privateExcerpt?: string;
  promptSchemaVersion: string;
  promptSha256: string;
}>;

export type BilingualModelGateway = Readonly<{
  /** Must be pure: network, model and filesystem I/O are forbidden here. */
  plan: (input: BilingualModelInput, operationId: string, parentOperationId: string, attemptNumber: number) => BilingualLanguageAttemptPlan;
  /** The mutation port is the only caller, after durable admission. */
  execute: (plan: BilingualLanguageAttemptPlan) => Promise<BilingualModelAttemptResult>;
}>;

export type BilingualRefineOutcome = Readonly<{
  parentOperationId: string;
  status: "closed" | "complete" | "partial" | "failed";
  externalCalls: number;
  writesToBase: boolean;
  children: Readonly<Record<BilingualLanguage, Readonly<{
    operationId: string;
    language: BilingualLanguage;
    status: "complete" | "blocked" | "failed" | "reconcile_required";
    reasonCode: BilingualProblemCode | null;
    draft: LocalizedDraft | null;
    routeReceiptHash: string | null;
    budgetReceiptHash: string | null;
  }>>>;
}>;

function blockedChild(operationId: string, language: BilingualLanguage, reasonCode: BilingualProblemCode): BilingualRefineOutcome["children"][BilingualLanguage] {
  return Object.freeze({ operationId, language, status: "blocked", reasonCode, draft: null, routeReceiptHash: null, budgetReceiptHash: null });
}

function failureCode(error: unknown): BilingualProblemCode {
  if (error instanceof BilingualContractError) return error.code;
  return "OUTPUT_INVALID";
}

/**
 * Runs only the model/refinement slice. The worker has no review, approval,
 * publication, correction, withdrawal, projection, or outbox side effect.
 * With the current schema-9 candidate's closed authority, it returns before
 * the model gateway is called, so externalCalls remains zero.
 */
export async function runBilingualRefinement(input: Readonly<{
  lineage: BilingualLineage;
  promptSha256: string;
  now: string;
  attemptNumber?: number;
  gateway: BilingualModelGateway;
  mutationPort?: BilingualMutationPort;
}>): Promise<BilingualRefineOutcome> {
  assertAutomaticAction("automaticRefine");
  if (!/^[0-9a-f]{64}$/u.test(input.promptSha256)) throw new BilingualContractError("OUTPUT_INVALID", "promptSha256 is not a lowercase SHA-256");
  const pair = planBilingualRefinement(input.lineage.candidateId, input.lineage.sourceRevision, input.lineage.inputContentHash, input.attemptNumber ?? 1);
  const port = input.mutationPort ?? CLOSED_BILINGUAL_MUTATION_PORT;
  const modelInputs = pair.children.map((child) => Object.freeze({
    candidateId: input.lineage.candidateId,
    sourceRevision: input.lineage.sourceRevision,
    language: child.language,
    sourceTitle: input.lineage.sourceTitle,
    sourceAuthor: input.lineage.sourceAuthor,
    sourcePublishedAt: input.lineage.sourcePublishedAt,
    canonicalUrl: input.lineage.canonicalUrl,
    privateExcerpt: input.lineage.sourceExcerpt,
    promptSchemaVersion: "bilingual-refinement-prompt-v1" as const,
    promptSha256: input.promptSha256
  }));
  // plan() is deliberately completed for both languages before authority is
  // requested. It describes future I/O but may not perform it.
  const plans = pair.children.map((child, index) => input.gateway.plan(modelInputs[index]!, child.operationId, pair.parent.operationId, child.attemptNumber)) as unknown as readonly [BilingualLanguageAttemptPlan, BilingualLanguageAttemptPlan];
  const admission = await port.beginRefinement({ pair, lineage: input.lineage, promptSchemaVersion: "bilingual-refinement-prompt-v1", promptSha256: input.promptSha256, plans });
  if ("reasonCode" in admission) {
    return Object.freeze({
      parentOperationId: pair.parent.operationId,
      status: "closed",
      externalCalls: 0,
      writesToBase: false,
      children: Object.freeze({ "zh-CN": blockedChild(pair.children[0].operationId, "zh-CN", admission.reasonCode), en: blockedChild(pair.children[1].operationId, "en", admission.reasonCode) })
    });
  }
  const children: Partial<Record<BilingualLanguage, BilingualRefineOutcome["children"][BilingualLanguage]>> = {};
  let externalCalls = 0;
  let writesToBase = false;
  for (const [index, child] of pair.children.entries()) {
    try {
      const plan = plans[index]!;
      const admitted = admission.children[child.language];
      const committed = await port.runLanguageAttempt(admitted, async () => {
        const generated = await input.gateway.execute(plan);
        assertModelReceipts(generated.route, generated.budget, input.promptSha256);
        if (generated.response.outcome !== "succeeded" || generated.rawJson === null) return generated;
        parseLocalizedDraft(generated.rawJson, child.language, input.lineage.sourceExcerpt);
        return generated;
      });
      externalCalls += committed.externalCalls;
      writesToBase = writesToBase || committed.writesToBase;
      if (!committed.ok) {
        children[child.language] = Object.freeze({ operationId: child.operationId, language: child.language, status: committed.status === "reconcile_required" ? "reconcile_required" : committed.status === "closed" ? "blocked" : "failed", reasonCode: committed.reasonCode, draft: null, routeReceiptHash: null, budgetReceiptHash: null });
        continue;
      }
      children[child.language] = Object.freeze({ operationId: child.operationId, language: child.language, status: "complete", reasonCode: null, draft: committed.draft, routeReceiptHash: committed.routeReceiptHash, budgetReceiptHash: committed.budgetReceiptHash });
    } catch (error) {
      children[child.language] = Object.freeze({ operationId: child.operationId, language: child.language, status: "failed", reasonCode: failureCode(error), draft: null, routeReceiptHash: null, budgetReceiptHash: null });
    }
  }
  const zh = children["zh-CN"] ?? blockedChild(pair.children[0].operationId, "zh-CN", "OUTPUT_INVALID");
  const en = children.en ?? blockedChild(pair.children[1].operationId, "en", "OUTPUT_INVALID");
  return Object.freeze({ parentOperationId: pair.parent.operationId, status: zh.status === "complete" && en.status === "complete" ? "complete" : zh.status === "complete" || en.status === "complete" ? "partial" : "failed", externalCalls, writesToBase, children: Object.freeze({ "zh-CN": zh, en }) });
}

export function automaticReview(): never {
  assertAutomaticAction("automaticReview");
  throw new BilingualContractError("AUTO_REVIEW_DISABLED");
}

export function automaticPublish(): never {
  assertAutomaticAction("automaticPublish");
  throw new BilingualContractError("AUTO_PUBLISH_DISABLED");
}

export function bilingualAutomationPolicy(): typeof AUTOMATIC_REFINEMENT_POLICY {
  return AUTOMATIC_REFINEMENT_POLICY;
}
