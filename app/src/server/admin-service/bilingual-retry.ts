import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  BILINGUAL_DRAFT_SCHEMA,
  BILINGUAL_PROMPT_SCHEMA,
  canonicalJson,
  sha256,
  type BilingualLanguage,
  type BilingualLanguageAttemptPlan,
  type BilingualLineage,
} from "../rss/bilingual-core.ts";
import { SqliteBilingualGatewayMutationPort } from "../rss/bilingual-gateway-port.ts";

const HASH = /^[0-9a-f]{64}$/u;

function domainHash(domain: string, value: unknown): string {
  return createHash("sha256").update(`${domain}\n${canonicalJson(value)}`, "utf8").digest("hex");
}

function row(database: DatabaseSync, sql: string, ...parameters: unknown[]): Record<string, unknown> {
  const value = database.prepare(sql).get(...(parameters as any[])) as Record<string, unknown> | undefined;
  if (value === undefined) throw new Error("BILINGUAL_RETRY_SOURCE_DRIFT");
  return value;
}

export type BilingualRetryFixture = Readonly<{
  routeRef: string;
  providerId: string;
  modelId: string;
  routeIdentitySha256: string;
  releaseSha256: string;
  manifestSha256: string;
  budgetAccountId: string;
  units: number;
  currency: string;
  promptSha256: string;
}>;

export class AdminBilingualRetryAdapter {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly port: SqliteBilingualGatewayMutationPort,
    private readonly fixture: BilingualRetryFixture,
  ) {
    if (![fixture.routeIdentitySha256, fixture.releaseSha256, fixture.manifestSha256, fixture.promptSha256].every((value) => HASH.test(value))) {
      throw new Error("BILINGUAL_RETRY_FIXTURE_INVALID");
    }
    if (!Number.isSafeInteger(fixture.units) || fixture.units < 1 || !/^[A-Z]{3}$/u.test(fixture.currency)) {
      throw new Error("BILINGUAL_RETRY_FIXTURE_INVALID");
    }
  }

  public async retryLanguage(
    authorization: Readonly<{ actorRef: string; sessionDigest: string; csrfDigest: string; operationId: string; bodyHash: string }>,
    input: Readonly<{ candidateId: string; language: BilingualLanguage; expectedRevision: number; action: "retry" | "rerun" }>,
  ): Promise<Readonly<{ status: string; externalCalls: number; writesToBase: boolean }>> {
    if (!authorization.actorRef || !HASH.test(authorization.bodyHash) || !HASH.test(authorization.sessionDigest) || !HASH.test(authorization.csrfDigest)) {
      throw new Error("BILINGUAL_RETRY_AUTHORIZATION_INVALID");
    }
    const slot = row(this.database, "SELECT * FROM bilingual_language_slot_v1 WHERE candidate_id=? AND language=?", input.candidateId, input.language);
    if (Number(slot.revision) !== input.expectedRevision) throw new Error("BILINGUAL_RETRY_SLOT_STALE");
    if (input.action === "retry" && !["failed", "blocked"].includes(String(slot.state))) throw new Error("BILINGUAL_RETRY_STATE_INVALID");
    if (input.action === "rerun" && !["complete", "stale"].includes(String(slot.state))) throw new Error("BILINGUAL_RERUN_STATE_INVALID");
    if (slot.state === "reconcile_required") throw new Error("BILINGUAL_RETRY_RECONCILE_REQUIRED");

    const lineageRow = row(this.database, `SELECT lineage.*,candidate.canonical_url,candidate.title,candidate.author,candidate.published_at,candidate.excerpt
      FROM bilingual_candidate_lineage_v1 lineage JOIN pending_review_candidate candidate ON candidate.candidate_id=lineage.candidate_id
      WHERE lineage.candidate_id=?`, input.candidateId);
    const lineage: BilingualLineage = Object.freeze({
      candidateId: input.candidateId,
      publicId: String(lineageRow.public_id),
      sourceId: String(lineageRow.source_id),
      sourceRevision: Number(lineageRow.source_revision),
      inputContentHash: String(lineageRow.input_content_hash),
      sourceFactSetHash: String(lineageRow.source_fact_set_hash),
      sourceReleaseHash: String(lineageRow.source_release_hash),
      canonicalUrl: String(lineageRow.canonical_url),
      sourceTitle: String(lineageRow.title),
      sourceAuthor: lineageRow.author === null ? null : String(lineageRow.author),
      sourcePublishedAt: lineageRow.published_at === null ? null : String(lineageRow.published_at),
      sourceExcerpt: lineageRow.excerpt === null ? undefined : String(lineageRow.excerpt),
      copyRiskStatus: String(lineageRow.copy_risk_status) as BilingualLineage["copyRiskStatus"],
      rightsStatus: String(lineageRow.rights_status) as BilingualLineage["rightsStatus"],
      deletionStatus: String(lineageRow.deletion_status) as BilingualLineage["deletionStatus"],
      mediaStatus: String(lineageRow.media_status) as BilingualLineage["mediaStatus"],
    });
    const maximumAttempt = Number(row(this.database, "SELECT COALESCE(MAX(attempt_number),0) AS attempt_number FROM bilingual_operation_link_v1 WHERE candidate_id=? AND language=? AND semantic_action IN ('refine_language','retry_language','rerun_language')", input.candidateId, input.language).attempt_number);
    const attemptNumber = maximumAttempt + 1;
    if (attemptNumber < 2 || attemptNumber > 3) throw new Error("BILINGUAL_RETRY_ATTEMPT_EXHAUSTED");
    const carrierOperationId = input.language === "zh-CN"
      ? authorization.operationId
      : String(row(this.database, `SELECT carrier.operation_id FROM bilingual_operation_link_v1 carrier
          JOIN internal_operation op ON op.operation_id=carrier.operation_id
         WHERE carrier.candidate_id=? AND carrier.semantic_action='refine_both' AND carrier.parent_operation_id IS NULL
           AND carrier.language IS NULL AND op.state='succeeded' AND op.expected_entity_version=? AND op.expected_entity_hash=?
         ORDER BY carrier.attempt_number DESC,carrier.created_at DESC LIMIT 1`, input.candidateId, lineage.sourceRevision, lineage.inputContentHash).operation_id);
    const seed = domainHash("f1plus1-admin-bilingual-retry-v1", {
      operationId: authorization.operationId,
      bodyHash: authorization.bodyHash,
      candidateId: input.candidateId,
      language: input.language,
      action: input.action,
      attemptNumber,
    });
    const plan: BilingualLanguageAttemptPlan = Object.freeze({
      operationId: authorization.operationId,
      parentOperationId: input.language === "zh-CN" ? authorization.operationId : carrierOperationId,
      idempotencyKey: `bilingual-admin-${seed.slice(0, 40)}`,
      candidateId: input.candidateId,
      language: input.language,
      attemptNumber,
      route: Object.freeze({
        routeRef: this.fixture.routeRef,
        providerId: this.fixture.providerId,
        modelId: this.fixture.modelId,
        routeIdentitySha256: this.fixture.routeIdentitySha256,
        releaseSha256: this.fixture.releaseSha256,
        manifestSha256: this.fixture.manifestSha256,
      }),
      budget: Object.freeze({
        accountId: this.fixture.budgetAccountId,
        reservationId: `reservation-${seed.slice(0, 40)}`,
        units: this.fixture.units,
        currency: this.fixture.currency,
      }),
      external: Object.freeze({
        method: "POST" as const,
        endpointClass: "model_refine" as const,
        providerResource: `fixture:${this.fixture.modelId}:${input.language}`,
        externalIdempotencyKey: `external-${seed.slice(0, 40)}`,
        reconcileKey: `reconcile-${seed.slice(0, 40)}`,
        headers: Object.freeze([]),
        query: Object.freeze([]),
        bodySha256: domainHash("f1plus1-admin-bilingual-retry-body-v1", { candidateId: input.candidateId, language: input.language, attemptNumber }),
      }),
    });
    const admission = await this.port.beginLanguageRetry({ carrierOperationId, lineage, promptSchemaVersion: BILINGUAL_PROMPT_SCHEMA, promptSha256: this.fixture.promptSha256, plan });
    if (!("child" in admission)) return { status: admission.status, externalCalls: 0, writesToBase: false };
    const result = await this.port.runLanguageAttempt(admission.child, async () => {
      const content = input.language === "zh-CN"
        ? { language: "zh-CN" as const, title: `重试：${lineage.sourceTitle}`, summary: "经人工触发的确定性双语重试摘要。", lead: "此内容由本地验收 fixture 生成。", body: ["该重试不连接外部模型，并保留逐语言操作与预算回执。"], keyPoints: ["单语言重试", "幂等执行"] }
        : { language: "en" as const, title: `Retry: ${lineage.sourceTitle}`, summary: "A deterministic bilingual retry summary triggered by an operator.", lead: "This content was generated by the local acceptance fixture.", body: ["The retry does not contact an external model and preserves per-language operation and budget receipts."], keyPoints: ["Single-language retry", "Idempotent execution"] };
      const rawJson = canonicalJson({ schemaVersion: BILINGUAL_DRAFT_SCHEMA, ...content, contentHash: sha256(canonicalJson(content)) });
      return Object.freeze({
        rawJson,
        route: Object.freeze({ routeRef: plan.route.routeRef, providerId: plan.route.providerId, modelId: plan.route.modelId, promptSchemaVersion: BILINGUAL_PROMPT_SCHEMA, promptSha256: this.fixture.promptSha256, receiptHash: domainHash("f1plus1-admin-bilingual-route-receipt-v1", { seed, language: input.language }), releaseSha256: plan.route.releaseSha256, manifestSha256: plan.route.manifestSha256 }),
        budget: Object.freeze({ reservationId: plan.budget.reservationId, units: plan.budget.units, currency: plan.budget.currency, receiptHash: domainHash("f1plus1-admin-bilingual-budget-receipt-v1", { seed, language: input.language }) }),
        externalCalls: 1 as const,
        response: Object.freeze({ providerResourceIdentity: plan.external.providerResource, providerStatus: "200", responseBodySha256: sha256(rawJson), responseHeaderHashes: Object.freeze([]), outcome: "succeeded" as const, reasonCode: null }),
      });
    });
    return Object.freeze({ status: result.status, externalCalls: result.externalCalls, writesToBase: result.writesToBase });
  }
}
