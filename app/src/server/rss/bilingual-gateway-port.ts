import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  canonicalExternalRequestHash,
  canonicalJsonV1,
  requestFingerprintHash,
  type ClosedExternalRequest,
  type ClosedExternalResponse,
  type BilingualSafetyDecisionReceipt,
  type CommittedAttemptHandle,
  type FenceBinding,
  type OwnerSupervisorHandoff,
  type OperationCapability,
  type SqliteInternalOperationGateway,
} from "../internal-operation/gateway.ts";
import { assertPhaseAllowsExternal, readPhaseSnapshot } from "../internal-operation/phase.ts";
import {
  BILINGUAL_PROMPT_SCHEMA,
  BilingualContractError,
  buildReviewableBundle,
  canonicalJson,
  parseLocalizedDraft,
  sha256,
  type BilingualAttemptAdmission,
  type BilingualAttemptRunResult,
  type BilingualLanguage,
  type BilingualLanguageAttemptPlan,
  type BilingualLineage,
  type BilingualMutationPort,
  type BilingualWriteClosed,
  type BudgetReceipt,
  type LanguageSlot,
  type LocalizedDraft,
  type ModelRouteReceipt,
} from "./bilingual-core.ts";
import { verifyAuthorityActivationReceipt } from "./source-registry-migration.ts";

const HASH = /^[0-9a-f]{64}$/u;
const ZERO = "0".repeat(64);

function invariant(value: unknown, code: string): asserts value {
  if (!value) throw new BilingualContractError(code === "SOURCE_DRIFT" ? "SOURCE_DRIFT" : "AUTHORITY_EXTENSION_REQUIRED", code);
}

function domainHash(domain: string, value: unknown): string {
  return createHash("sha256").update(`${domain}\n${canonicalJsonV1(value)}`).digest("hex");
}

function fenceSetHash(set: readonly FenceBinding[]): string {
  return domainHash("f1plus1-operation-fence-set-v1", set.map((binding) => ({
    fenceReceiptId: binding.fenceReceiptId,
    receiptSha256: binding.receiptSha256,
    scopeKind: binding.scopeKind,
    scopeId: binding.scopeId,
    fenceKind: binding.fenceKind,
    requiredState: binding.requiredState,
  })));
}

function routeBindingHash(plan: BilingualLanguageAttemptPlan): string {
  return domainHash("f1plus1-bilingual-route-binding-v1", plan.route);
}

function budgetBindingHash(plan: BilingualLanguageAttemptPlan): string {
  return domainHash("f1plus1-bilingual-budget-binding-v1", plan.budget);
}

function slotId(candidateId: string, language: BilingualLanguage): string {
  return `slot-${sha256(`${candidateId}\n${language}`).slice(0, 48)}`;
}

function row(database: DatabaseSync, sql: string, ...parameters: unknown[]): Record<string, unknown> {
  const value = database.prepare(sql).get(...(parameters as any[])) as Record<string, unknown> | undefined;
  invariant(value !== undefined, "SOURCE_DRIFT");
  return value;
}

type DurableChild = Readonly<{
  public: BilingualAttemptAdmission;
  secret: CommittedAttemptHandle;
  plan: BilingualLanguageAttemptPlan;
  lineage: BilingualLineage;
  promptSha256: string;
  slotId: string;
  databaseParentOperationId: string | null;
  routeBindingHash: string;
  budgetBindingHash: string;
}>;

type AdmissionCacheEntry = Readonly<{
  inputHash: string;
  value: Readonly<{ ok: true; externalModelAllowed: true; children: Readonly<Partial<Record<BilingualLanguage, BilingualAttemptAdmission>>> }>;
}>;

type TrustedSourceAuthority = NonNullable<ClosedExternalRequest["sourceAuthority"]>;

type TrustedAdmissionLineage = Readonly<{
  lineage: BilingualLineage;
  authority: TrustedSourceAuthority;
  sourceStopEpoch: number;
}>;

export class SqliteBilingualGatewayMutationPort implements BilingualMutationPort {
  private readonly database: DatabaseSync;
  private readonly gateway: SqliteInternalOperationGateway;
  private readonly handoffProvider: (language: BilingualLanguage) => OwnerSupervisorHandoff;
  private readonly activation: Readonly<{ operationId: string; receiptSha256: string }>;
  private readonly now: () => Date;
  private readonly materializationFailureInjector?: (stage: "before_success", language: BilingualLanguage) => void;
  private readonly durable = new Map<string, DurableChild>();
  private readonly admissionCache = new Map<string, AdmissionCacheEntry>();
  private readonly attemptResults = new Map<string, BilingualAttemptRunResult>();
  private readonly attemptRuns = new Map<string, Promise<BilingualAttemptRunResult>>();

  public constructor(input: Readonly<{
    database: DatabaseSync;
    gateway: SqliteInternalOperationGateway;
    handoffProvider: (language: BilingualLanguage) => OwnerSupervisorHandoff;
    activation: Readonly<{ operationId: string; receiptSha256: string }>;
    now?: () => Date;
    materializationFailureInjector?: (stage: "before_success", language: BilingualLanguage) => void;
  }>) {
    this.database = input.database;
    this.gateway = input.gateway;
    this.handoffProvider = input.handoffProvider;
    this.activation = input.activation;
    this.now = input.now ?? (() => new Date());
    this.materializationFailureInjector = input.materializationFailureInjector;
  }

  public materializeReviewableBundleAfterSafetyDecision(receipt: BilingualSafetyDecisionReceipt): Readonly<{ bundleId: string; bundleHash: string; revision: number }> {
    return this.gateway.materializeBilingualBundleAfterSafetyDecision(receipt, (authority) => {
      const existing = this.database.prepare(`SELECT bundle_id,bundle_hash,revision FROM bilingual_bundle_v1
        WHERE candidate_id=? AND json_extract(payload_json,'$.safetyAuthority.decisionId')=? ORDER BY revision DESC LIMIT 1`).get(authority.candidateId, authority.decisionId) as Record<string, unknown> | undefined;
      if (existing !== undefined) return Object.freeze({ bundleId: String(existing.bundle_id), bundleHash: String(existing.bundle_hash), revision: Number(existing.revision) });
      const lineageRow = row(this.database, `SELECT lineage.*,candidate.canonical_url,candidate.title,candidate.author,candidate.published_at,candidate.excerpt
        FROM bilingual_candidate_lineage_v1 lineage JOIN pending_review_candidate candidate ON candidate.candidate_id=lineage.candidate_id
        WHERE lineage.candidate_id=?`, authority.candidateId);
      const lineage: BilingualLineage = Object.freeze({
        candidateId: String(lineageRow.candidate_id), publicId: String(lineageRow.public_id), sourceId: String(lineageRow.source_id),
        sourceRevision: Number(lineageRow.source_revision), inputContentHash: String(lineageRow.input_content_hash),
        sourceFactSetHash: String(lineageRow.source_fact_set_hash), sourceReleaseHash: String(lineageRow.source_release_hash),
        canonicalUrl: String(lineageRow.canonical_url), sourceTitle: String(lineageRow.title),
        sourceAuthor: lineageRow.author === null ? null : String(lineageRow.author), sourcePublishedAt: lineageRow.published_at === null ? null : String(lineageRow.published_at),
        sourceExcerpt: lineageRow.excerpt === null ? undefined : String(lineageRow.excerpt), copyRiskStatus: "screen_passed", rightsStatus: "clear", deletionStatus: "clear",
        mediaStatus: String(lineageRow.media_status) as "none" | "allowed",
      });
      const slots = this.database.prepare("SELECT * FROM bilingual_language_slot_v1 WHERE candidate_id=? ORDER BY language DESC").all(authority.candidateId) as Array<Record<string, unknown>>;
      invariant(slots.length === 2 && slots.every((slot) => slot.state === "complete"), "BILINGUAL_PAIR_INCOMPLETE");
      const drafts = {} as Record<BilingualLanguage, LocalizedDraft>;
      const languageSlots = slots.map((slot) => {
        const language = String(slot.language) as BilingualLanguage;
        const draftRow = row(this.database, "SELECT output_json FROM bilingual_language_slot_draft_v1 WHERE slot_id=? AND draft_hash=?", slot.slot_id, slot.draft_hash);
        drafts[language] = parseLocalizedDraft(String(draftRow.output_json), language, lineage.sourceExcerpt);
        return {
          slotId: String(slot.slot_id), candidateId: String(slot.candidate_id), language, revision: Number(slot.revision), state: "complete" as const,
          sourceRevision: Number(slot.source_revision), inputContentHash: String(slot.input_content_hash), sourceFactSetHash: String(slot.source_fact_set_hash), sourceReleaseHash: String(slot.source_release_hash),
          promptSchemaVersion: String(slot.prompt_schema_version), promptSha256: String(slot.prompt_sha256), modelRouteReceiptHash: String(slot.model_route_receipt_hash), draftHash: String(slot.draft_hash),
          currentAttemptId: String(slot.current_attempt_id), currentAttemptOperationId: String(slot.current_attempt_operation_id), failureReason: null, operationId: String(slot.operation_id), updatedAt: String(slot.updated_at),
        } satisfies LanguageSlot;
      });
      const zhSlot = languageSlots.find((slot) => slot.language === "zh-CN")!;
      const enSlot = languageSlots.find((slot) => slot.language === "en")!;
      invariant(zhSlot.promptSchemaVersion === enSlot.promptSchemaVersion && zhSlot.promptSha256 === enSlot.promptSha256, "BILINGUAL_PROMPT_INVALID");
      const carrierOperationId = zhSlot.operationId;
      invariant(this.database.prepare(`SELECT 1 FROM bilingual_operation_link_v1 link JOIN internal_operation op ON op.operation_id=link.operation_id
        WHERE link.operation_id=? AND link.candidate_id=? AND link.semantic_action='create_bundle' AND link.parent_operation_id IS NULL AND link.language IS NULL AND op.state='succeeded'`).get(carrierOperationId, authority.candidateId) !== undefined, "BILINGUAL_CARRIER_INVALID");
      const revision = Number(row(this.database, "SELECT COALESCE(MAX(revision),0)+1 AS revision FROM bilingual_bundle_v1 WHERE candidate_id=?", authority.candidateId).revision);
      const bundle = buildReviewableBundle(lineage, languageSlots, drafts, revision, {
        decisionId: authority.decisionId, decisionSeq: authority.decisionSeq, resourceHash: authority.resourceHash,
        requestHash: authority.requestHash, authorityContextHash: authority.authorityContextHash, expiresAt: authority.expiresAt,
      });
      this.database.prepare("INSERT INTO bilingual_bundle_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(bundle.bundleId, bundle.candidateId, bundle.publicId, bundle.revision, bundle.state, bundle.sourceRevision, bundle.inputContentHash, bundle.sourceFactSetHash, bundle.sourceReleaseHash, zhSlot.promptSchemaVersion, zhSlot.promptSha256, zhSlot.slotId, zhSlot.revision, bundle.zh.contentHash, bundle.zhModelRouteReceiptHash, enSlot.slotId, enSlot.revision, bundle.en.contentHash, bundle.enModelRouteReceiptHash, bundle.bundleHash, canonicalJson(bundle), carrierOperationId, authority.materializedAt);
      return Object.freeze({ bundleId: bundle.bundleId, bundleHash: bundle.bundleHash, revision: bundle.revision });
    });
  }

  public async beginRefinement(input: Parameters<BilingualMutationPort["beginRefinement"]>[0]): ReturnType<BilingualMutationPort["beginRefinement"]> {
    this.assertAdmissionShape(input);
    return await this.beginAdmission({ lineage: input.lineage, promptSchemaVersion: input.promptSchemaVersion, promptSha256: input.promptSha256, plans: input.plans }, input.pair.parent.operationId) as Awaited<ReturnType<BilingualMutationPort["beginRefinement"]>>;
  }

  public async beginLanguageRetry(input: Readonly<{
    carrierOperationId: string;
    lineage: BilingualLineage;
    promptSchemaVersion: typeof BILINGUAL_PROMPT_SCHEMA;
    promptSha256: string;
    plan: BilingualLanguageAttemptPlan;
  }>): Promise<Readonly<{ ok: true; externalModelAllowed: true; child: BilingualAttemptAdmission }> | BilingualWriteClosed> {
    invariant(input.promptSchemaVersion === BILINGUAL_PROMPT_SCHEMA && HASH.test(input.promptSha256), "PROMPT_BINDING_INVALID");
    const plan = input.plan;
    invariant(plan.candidateId === input.lineage.candidateId && plan.attemptNumber >= 2 && plan.attemptNumber <= 3, "PLAN_IDENTITY_INVALID");
    invariant(plan.language === "zh-CN" ? input.carrierOperationId === plan.operationId && plan.parentOperationId === plan.operationId : input.carrierOperationId !== plan.operationId && plan.parentOperationId === input.carrierOperationId, "COMBINED_PARENT_CARRIER_INVALID");
    this.assertPlanBinding(plan);
    const admission = await this.beginAdmission({ lineage: input.lineage, promptSchemaVersion: input.promptSchemaVersion, promptSha256: input.promptSha256, plans: [plan] }, input.carrierOperationId);
    if ("reasonCode" in admission) return admission;
    const child = admission.children[plan.language];
    invariant(child !== undefined, "ADMISSION_HANDLE_INVALID");
    return Object.freeze({ ok: true, externalModelAllowed: true, child });
  }

  private async beginAdmission(input: Readonly<{
    lineage: BilingualLineage;
    promptSchemaVersion: typeof BILINGUAL_PROMPT_SCHEMA;
    promptSha256: string;
    plans: readonly BilingualLanguageAttemptPlan[];
  }>, carrierOperationId: string): Promise<Readonly<{ ok: true; externalModelAllowed: true; children: Readonly<Partial<Record<BilingualLanguage, BilingualAttemptAdmission>>> }> | BilingualWriteClosed> {
    const trusted = this.readTrustedAdmissionLineage(input.lineage);
    const inputHash = domainHash("f1plus1-bilingual-admission-v1", {
      carrierOperationId,
      lineage: {
        candidateId: trusted.lineage.candidateId,
        sourceId: trusted.lineage.sourceId,
        sourceRevision: trusted.lineage.sourceRevision,
        inputContentHash: trusted.lineage.inputContentHash,
        sourceFactSetHash: trusted.lineage.sourceFactSetHash,
        sourceReleaseHash: trusted.lineage.sourceReleaseHash,
        copyRiskStatus: trusted.lineage.copyRiskStatus,
        rightsStatus: trusted.lineage.rightsStatus,
        deletionStatus: trusted.lineage.deletionStatus,
        mediaStatus: trusted.lineage.mediaStatus,
      },
      sourceAuthority: trusted.authority,
      promptSchemaVersion: input.promptSchemaVersion,
      promptSha256: input.promptSha256,
      plans: input.plans,
    });
    const admissionKey = input.plans.length === 2 ? carrierOperationId : input.plans[0]!.operationId;
    const cached = this.admissionCache.get(admissionKey);
    if (cached !== undefined) {
      if (cached.inputHash !== inputHash) throw new BilingualContractError("CAS_CONFLICT", "admission idempotency drift");
      return cached.value;
    }

    const historical = verifyAuthorityActivationReceipt(this.database, {
      capabilityId: "bilingual_auto_refine",
      operationId: this.activation.operationId,
      receiptSha256: this.activation.receiptSha256,
    });
    if (!historical.valid) return { ok: false, status: "closed", reasonCode: "AUTHORITY_EXTENSION_REQUIRED", externalCalls: 0, writesToBase: false };
    const capability = row(this.database, "SELECT enabled,status,extension_sha256 FROM bilingual_authority_capability_v1 WHERE capability_id='bilingual-v1'");
    if (capability.enabled !== 1 || capability.status !== "enabled" || capability.extension_sha256 !== this.gateway.expectedSchemaSha256()) {
      return { ok: false, status: "closed", reasonCode: "AUTHORITY_EXTENSION_REQUIRED", externalCalls: 0, writesToBase: false };
    }

    const control = row(this.database, "SELECT * FROM internal_control WHERE singleton_id=1");
    const phase = String(control.phase);
    if (phase !== "backlog" && phase !== "live") return { ok: false, status: "closed", reasonCode: "AUTHORITY_EXTENSION_REQUIRED", externalCalls: 0, writesToBase: false };
    assertPhaseAllowsExternal(readPhaseSnapshot(this.database), "model_https");
    invariant(control.global_stop_state === "clear" && control.emergency_stop_state === "clear" && control.recovery_state === "ready", "AUTHORITY_RUNTIME_CLOSED");

    const candidate = row(this.database, "SELECT candidate_id,source_id,source_revision,source_payload_hash FROM pending_review_candidate WHERE candidate_id=?", input.lineage.candidateId);
    invariant(candidate.source_id === input.lineage.sourceId && Number(candidate.source_revision) === input.lineage.sourceRevision && candidate.source_payload_hash === input.lineage.inputContentHash, "SOURCE_DRIFT");
    const policyId = `p-refine-bi-${phase}`;
    const fences = this.readRequiredFenceSet(policyId, input.lineage.candidateId, control);
    const fHash = fenceSetHash(fences);
    const children: Partial<Record<BilingualLanguage, BilingualAttemptAdmission>> = {};
    const durableChildren: DurableChild[] = [];
    const prepared: Array<Readonly<{ plan: BilingualLanguageAttemptPlan; authorized: OperationCapability; externalRequest: ClosedExternalRequest; secret?: CommittedAttemptHandle }>> = [];

    this.gateway.runAtomicAdmission(() => {
      const transactionTrusted = this.readTrustedAdmissionLineage(input.lineage);
      invariant(domainHash("f1plus1-bilingual-trusted-lineage-v1", transactionTrusted) === domainHash("f1plus1-bilingual-trusted-lineage-v1", trusted), "SOURCE_DRIFT");
      for (const plan of input.plans) {
        const route = row(this.database, "SELECT * FROM route_registry WHERE route_id=?", plan.route.routeRef);
        invariant(route.route_class === "model" && route.egress_class === "model_https" && route.endpoint_class === "model_refine" && route.state === "active", "MODEL_ROUTE_UNAVAILABLE");
        invariant(route.endpoint_identity_sha256 === plan.route.routeIdentitySha256 && route.release_sha256 === plan.route.releaseSha256 && route.manifest_sha256 === plan.route.manifestSha256, "MODEL_ROUTE_UNAVAILABLE");
        const budget = row(this.database, "SELECT account_id,unit_kind,hard_limit,consumed_units,reserved_units FROM budget_account WHERE account_id=?", plan.budget.accountId);
        invariant(Number(budget.consumed_units) + Number(budget.reserved_units) + plan.budget.units <= Number(budget.hard_limit), "BUDGET_UNAVAILABLE");
        const handoff = this.handoffProvider(plan.language);
        invariant(handoff.ownerProcess === "bilingual_refiner" && handoff.releaseSha256 === plan.route.releaseSha256 && handoff.manifestSha256 === plan.route.manifestSha256, "HANDOFF_BINDING_INVALID");
        const externalRequest: ClosedExternalRequest = Object.freeze({
          schemaVersion: "external-request-v1",
          method: plan.external.method,
          endpointClass: plan.external.endpointClass,
          providerResource: plan.external.providerResource,
          routeId: plan.route.routeRef,
          externalIdempotencyKey: plan.external.externalIdempotencyKey,
          reconcileKey: plan.external.reconcileKey,
          headers: Object.freeze([...plan.external.headers]),
          query: Object.freeze([...plan.external.query]),
          bodySha256: plan.external.bodySha256,
          attemptIdentity: { operationId: plan.operationId, attemptNumber: plan.attemptNumber, attemptNonce: randomBytes(32).toString("base64url") },
          entityIdentity: { sourceId: input.lineage.sourceId, candidateId: input.lineage.candidateId, publicationId: null, publicId: null },
          expected: { schemaSha256: this.gateway.expectedSchemaSha256(), releaseSha256: handoff.releaseSha256, manifestSha256: handoff.manifestSha256, routeIdentitySha256: plan.route.routeIdentitySha256 },
          epochs: { sourceConfig: Number(control.source_config_epoch), sourceSafety: Number(control.source_safety_epoch), authorization: Number(control.authorization_version), policy: Number(control.policy_epoch), recovery: Number(control.recovery_epoch), writer: Number(control.writer_epoch) },
          sourceAuthority: trusted.authority,
          fenceSetHash: fHash,
        });
        const requestHash = canonicalExternalRequestHash(externalRequest);
        const fingerprint = requestFingerprintHash(externalRequest);
        const requested = this.gateway.request(handoff, {
          schemaVersion: "operation-request-v1",
          operationId: plan.operationId,
          idempotencyKey: plan.idempotencyKey,
          operationKind: "refine",
          ownerProcess: "bilingual_refiner",
          capabilityClass: "external_attempt",
          policyId,
          authorizationHandoffId: handoff.handoffId,
          controlAction: null,
          identity: { sourceId: input.lineage.sourceId, candidateId: input.lineage.candidateId, publicationId: null, publicId: null },
          entitySet: [
            { entityKind: "source", entityId: trusted.lineage.sourceId, identitySelector: "source_id", expectedVersion: trusted.authority.sourceRegistryRevision, expectedHash: trusted.authority.sourceIdentitySha256 },
            { entityKind: "candidate", entityId: trusted.lineage.candidateId, identitySelector: "candidate_id", expectedVersion: trusted.lineage.sourceRevision, expectedHash: trusted.lineage.inputContentHash },
          ],
          requiredFenceSet: fences,
          expected: {
            controlVersion: Number(control.version), entityVersion: input.lineage.sourceRevision, entityHash: input.lineage.inputContentHash,
            schemaSha256: this.gateway.expectedSchemaSha256(), releaseSha256: handoff.releaseSha256, manifestSha256: handoff.manifestSha256,
            sourceStopEpoch: trusted.sourceStopEpoch, writerEpoch: Number(control.writer_epoch),
            epochs: { sourceConfig: Number(control.source_config_epoch), sourceSafety: Number(control.source_safety_epoch), authorization: Number(control.authorization_version), policy: Number(control.policy_epoch), recovery: Number(control.recovery_epoch) },
          },
          phase,
          egressClass: "model_https",
          budgetRequest: { reservationId: plan.budget.reservationId, accountId: plan.budget.accountId, units: plan.budget.units, unitKind: String(budget.unit_kind) },
          modelRouteRef: plan.route.routeRef,
          requestHash,
          requestFingerprint: fingerprint,
        });
        const authorized = this.gateway.authorize(requested);
        prepared.push(Object.freeze({ plan, authorized, externalRequest }));
      }
      const committed = prepared.map(({ plan, authorized, externalRequest }) => Object.freeze({
        plan,
        authorized,
        externalRequest,
        secret: this.gateway.commitAttemptIntent(authorized, externalRequest),
      }));
      this.gateway.materializeBilingualAdmission({
        carrierOperationId,
        candidateId: input.lineage.candidateId,
        publicId: input.lineage.publicId,
        sourceId: input.lineage.sourceId,
        sourceRevision: input.lineage.sourceRevision,
        inputContentHash: input.lineage.inputContentHash,
        sourceFactSetHash: input.lineage.sourceFactSetHash,
        sourceReleaseHash: input.lineage.sourceReleaseHash,
        copyRiskStatus: trusted.lineage.copyRiskStatus,
        rightsStatus: trusted.lineage.rightsStatus,
        deletionStatus: trusted.lineage.deletionStatus,
        mediaStatus: trusted.lineage.mediaStatus,
        promptSchemaVersion: input.promptSchemaVersion,
        promptSha256: input.promptSha256,
        children: input.plans.map((plan) => ({ operationId: plan.operationId, idempotencyKey: plan.idempotencyKey, language: plan.language, attemptNumber: plan.attemptNumber })),
      });
      for (const { plan, secret } of committed) {
        const publicAdmission = Object.freeze({
          operationId: plan.operationId,
          parentOperationId: carrierOperationId,
          attemptId: secret.attemptId,
          attemptNumber: plan.attemptNumber,
          language: plan.language,
          canonicalRequestSha256: secret.canonicalRequestSha256,
          requestFingerprintSha256: secret.requestFingerprintSha256,
          fenceSetHash: fHash,
          routeBindingHash: routeBindingHash(plan),
          budgetBindingHash: budgetBindingHash(plan),
        });
        children[plan.language] = publicAdmission;
        durableChildren.push(Object.freeze({ public: publicAdmission, secret, plan, lineage: trusted.lineage, promptSha256: input.promptSha256, slotId: slotId(trusted.lineage.candidateId, plan.language), databaseParentOperationId: plan.language === "zh-CN" ? null : carrierOperationId, routeBindingHash: routeBindingHash(plan), budgetBindingHash: budgetBindingHash(plan) }));
      }
    });

    for (const child of durableChildren) this.durable.set(child.public.attemptId, child);
    const value = Object.freeze({ ok: true as const, externalModelAllowed: true as const, children: Object.freeze(children) });
    this.admissionCache.set(admissionKey, Object.freeze({ inputHash, value }));
    return value;
  }

  public async runLanguageAttempt(admission: BilingualAttemptAdmission, execute: Parameters<BilingualMutationPort["runLanguageAttempt"]>[1]): Promise<BilingualAttemptRunResult> {
    const completed = this.attemptResults.get(admission.attemptId);
    if (completed !== undefined) return completed;
    const running = this.attemptRuns.get(admission.attemptId);
    if (running !== undefined) return running;
    const promise = this.runLanguageAttemptOnce(admission, execute);
    this.attemptRuns.set(admission.attemptId, promise);
    try {
      const result = await promise;
      this.attemptResults.set(admission.attemptId, result);
      return result;
    } finally {
      this.attemptRuns.delete(admission.attemptId);
    }
  }

  private async runLanguageAttemptOnce(admission: BilingualAttemptAdmission, execute: Parameters<BilingualMutationPort["runLanguageAttempt"]>[1]): Promise<BilingualAttemptRunResult> {
    const child = this.durable.get(admission.attemptId);
    invariant(child !== undefined && child.public === admission, "ADMISSION_HANDLE_INVALID");
    const started = this.gateway.markAttemptStarted(child.secret);
    let generated: Awaited<ReturnType<typeof execute>>;
    try {
      generated = await execute();
    } catch {
      this.gateway.markUnknownWithBilingualMaterialization(started, (state) => this.materializeUnknown(child, state.materializedAt));
      return { ok: false, status: "reconcile_required", reasonCode: "RECONCILE_REQUIRED", externalCalls: 1, writesToBase: true, attemptId: child.public.attemptId };
    }
    try {
      this.assertExecutionBinding(child, generated);
      const response = generated.response as ClosedExternalResponse;
      return this.gateway.commitKnownResponseWithBilingualMaterialization(started, response, (state) => {
        if (response.outcome === "known_failed") {
          this.materializeKnownFailure(child, generated.route, generated.budget, state.responseIdentitySha256, state.materializedAt, response.reasonCode ?? "MODEL_KNOWN_FAILED");
          return { ok: false as const, status: "failed" as const, reasonCode: "OUTPUT_INVALID" as const, externalCalls: 1 as const, writesToBase: true, attemptId: child.public.attemptId };
        }
        invariant(generated.rawJson !== null, "MODEL_RESPONSE_BODY_MISSING");
        const draft = parseLocalizedDraft(generated.rawJson, child.plan.language, child.lineage.sourceExcerpt);
        this.materializationFailureInjector?.("before_success", child.plan.language);
        this.materializeSuccess(child, generated.route, generated.budget, draft, state.responseIdentitySha256, state.materializedAt);
        return { ok: true as const, status: "complete" as const, externalCalls: 1 as const, writesToBase: true as const, draft, routeReceiptHash: generated.route.receiptHash, budgetReceiptHash: generated.budget.receiptHash, attemptId: child.public.attemptId };
      });
    } catch {
      // The model was called exactly once. A binding/CAS/materialization fault
      // transitions the same started attempt to reconciliation; it is never
      // converted into a fresh model attempt here.
      const state = this.database.prepare("SELECT state FROM internal_operation WHERE operation_id=?").get(child.plan.operationId) as Record<string, unknown> | undefined;
      if (state?.state === "in_flight") this.gateway.markUnknownWithBilingualMaterialization(started, (unknown) => this.materializeUnknown(child, unknown.materializedAt));
      return { ok: false, status: "reconcile_required", reasonCode: "RECONCILE_REQUIRED", externalCalls: 1, writesToBase: true, attemptId: child.public.attemptId };
    }
  }

  private assertAdmissionShape(input: Parameters<BilingualMutationPort["beginRefinement"]>[0]): void {
    invariant(input.promptSchemaVersion === BILINGUAL_PROMPT_SCHEMA && HASH.test(input.promptSha256), "PROMPT_BINDING_INVALID");
    const [zh, en] = input.plans;
    invariant(input.pair.parent.operationId === input.pair.children[0].operationId && input.pair.parent.operationId === zh.operationId, "COMBINED_PARENT_CARRIER_INVALID");
    invariant(zh.language === "zh-CN" && en.language === "en" && zh.parentOperationId === zh.operationId && en.parentOperationId === zh.operationId && zh.operationId !== en.operationId, "COMBINED_PARENT_CARRIER_INVALID");
    for (const [index, plan] of input.plans.entries()) {
      const child = input.pair.children[index]!;
      invariant(plan.operationId === child.operationId && plan.idempotencyKey === child.idempotencyKey && plan.candidateId === input.lineage.candidateId && plan.language === child.language && plan.attemptNumber === child.attemptNumber, "PLAN_IDENTITY_INVALID");
      this.assertPlanBinding(plan);
    }
  }

  private assertPlanBinding(plan: BilingualLanguageAttemptPlan): void {
    invariant(plan.attemptNumber >= 1 && plan.attemptNumber <= 3 && HASH.test(plan.route.routeIdentitySha256) && HASH.test(plan.route.releaseSha256) && HASH.test(plan.route.manifestSha256) && HASH.test(plan.external.bodySha256), "PLAN_BINDING_INVALID");
    invariant(plan.budget.units > 0 && /^[A-Z]{3}$/u.test(plan.budget.currency), "BUDGET_UNAVAILABLE");
  }

  private readTrustedAdmissionLineage(caller: BilingualLineage): TrustedAdmissionLineage {
    const trusted = row(this.database, `SELECT legacy.stop_epoch,registry.revision AS registry_revision,registry.identity_sha256,
      registry.enabled,registry.lifecycle_status,registry.source_kind,registry.collection_mode,registry.source_stop_status,
      registry.authorization_version,registry.source_config_epoch,registry.source_safety_epoch,registry.policy_epoch,registry.recovery_epoch,
      registry.authorization_expires_at,registry.normalization_status,registry.dedup_status,registry.identity_status,
      registry.relevance_status,registry.monitorability,registry.adapter_status,registry.adapter_authorization_status,registry.platform_allowed,
      config.source_revision AS config_revision,config.rights_status,config.media_policy,
      config.authorization_receipt_sha256,config.source_policy_sha256,
      control.source_config_epoch AS control_source_config_epoch,control.source_safety_epoch AS control_source_safety_epoch,
      control.authorization_version AS control_authorization_version,control.policy_epoch AS control_policy_epoch,
      control.recovery_epoch AS control_recovery_epoch,control.writer_epoch
      FROM source legacy
      JOIN source_registry_v1 registry ON registry.source_id=legacy.source_id
      LEFT JOIN source_registry_rss_config_v1 config ON config.source_id=registry.source_id
      JOIN internal_control control ON control.singleton_id=1
      WHERE legacy.source_id=?`, caller.sourceId);
    const observedAt = this.now().toISOString();
    invariant(trusted.enabled === 1 && trusted.lifecycle_status === "active" && trusted.source_kind === "rss" && trusted.collection_mode === "rss" && trusted.source_stop_status === "clear"
      && trusted.normalization_status === "valid" && ["unique", "linked_existing"].includes(String(trusted.dedup_status))
      && trusted.adapter_status === "ready" && trusted.adapter_authorization_status === "valid" && trusted.platform_allowed === "allowed"
      && (trusted.authorization_expires_at === null || Date.parse(String(trusted.authorization_expires_at)) > Date.parse(observedAt)), "SOURCE_DRIFT");
    invariant(Number.isSafeInteger(Number(trusted.registry_revision)) && Number(trusted.registry_revision) >= 1 && HASH.test(String(trusted.identity_sha256)), "SOURCE_DRIFT");
    invariant(Number(trusted.config_revision) === 1 && HASH.test(String(trusted.authorization_receipt_sha256)) && HASH.test(String(trusted.source_policy_sha256)), "SOURCE_DRIFT");

    // Source configuration can make a candidate more restrictive. It cannot
    // self-assert a publishable clearance. Clear/screened facts require the
    // separate fresh-passkey manual authority path, so admission defaults to
    // the strict pending state even when the manifest says clear/allowlisted.
    const authority: TrustedSourceAuthority = Object.freeze({
      sourceRegistryRevision: Number(trusted.registry_revision),
      sourceIdentitySha256: String(trusted.identity_sha256),
      sourceConfigRevision: Number(trusted.config_revision),
      authorizationReceiptSha256: String(trusted.authorization_receipt_sha256),
      sourcePolicySha256: String(trusted.source_policy_sha256),
      authorizationExpiresAt: trusted.authorization_expires_at === null ? null : String(trusted.authorization_expires_at),
      sourceConfigEpoch: Number(trusted.source_config_epoch), sourceSafetyEpoch: Number(trusted.source_safety_epoch), authorizationVersion: Number(trusted.authorization_version),
      policyEpoch: Number(trusted.policy_epoch), recoveryEpoch: Number(trusted.recovery_epoch), controlSourceConfigEpoch: Number(trusted.control_source_config_epoch),
      controlSourceSafetyEpoch: Number(trusted.control_source_safety_epoch), controlAuthorizationVersion: Number(trusted.control_authorization_version),
      controlPolicyEpoch: Number(trusted.control_policy_epoch), controlRecoveryEpoch: Number(trusted.control_recovery_epoch), writerEpoch: Number(trusted.writer_epoch),
      normalizationStatus: "valid", dedupStatus: String(trusted.dedup_status) as "unique" | "linked_existing",
      identityStatus: String(trusted.identity_status) as "unknown" | "verified" | "needs_review",
      relevanceStatus: String(trusted.relevance_status) as "unknown" | "qualified" | "rejected",
      monitorability: String(trusted.monitorability) as "unknown" | "monitorable" | "restricted" | "unavailable",
      adapterStatus: "ready", adapterAuthorizationStatus: "valid", platformAllowed: "allowed",
      copyRiskStatus: "unknown",
      rightsStatus: trusted.rights_status === "blocked" ? "blocked" : "unknown",
      deletionStatus: "unknown",
      mediaStatus: trusted.media_policy === "blocked" ? "blocked" : "unknown",
    });
    const lineage = Object.freeze({
      ...caller,
      copyRiskStatus: authority.copyRiskStatus,
      rightsStatus: authority.rightsStatus,
      deletionStatus: authority.deletionStatus,
      mediaStatus: authority.mediaStatus,
    }) satisfies BilingualLineage;
    return Object.freeze({ lineage, authority, sourceStopEpoch: Number(trusted.stop_epoch) });
  }

  private readRequiredFenceSet(policyId: string, candidateId: string, control: Record<string, unknown>): readonly FenceBinding[] {
    const now = this.now().toISOString();
    const rows = this.database.prepare("SELECT scope_selector,fence_kind,required_state FROM internal_required_fence_policy WHERE policy_id=? ORDER BY scope_selector,fence_kind,required_state").all(policyId) as Array<Record<string, unknown>>;
    return Object.freeze(rows.map((required) => {
      invariant(required.scope_selector === "candidate_id", "FENCE_TEMPLATE_INVALID");
      const receipt = row(this.database, "SELECT fence_receipt_id,receipt_sha256 FROM generic_fence_receipt WHERE scope_kind='candidate' AND scope_id=? AND fence_kind=? AND policy_epoch=? AND recovery_epoch=? AND writer_epoch=? AND state='clear' AND expires_at>? ORDER BY observed_at DESC,fence_receipt_id DESC LIMIT 1", candidateId, required.fence_kind, control.policy_epoch, control.recovery_epoch, control.writer_epoch, now);
      return Object.freeze({ fenceReceiptId: String(receipt.fence_receipt_id), receiptSha256: String(receipt.receipt_sha256), scopeKind: "candidate" as const, scopeId: candidateId, fenceKind: String(required.fence_kind) as FenceBinding["fenceKind"], requiredState: String(required.required_state) as FenceBinding["requiredState"] });
    }));
  }

  private assertExecutionBinding(child: DurableChild, generated: Awaited<ReturnType<Parameters<BilingualMutationPort["runLanguageAttempt"]>[1]>>): void {
    invariant(generated.externalCalls === 1, "EXTERNAL_CALL_COUNT_INVALID");
    invariant(generated.route.routeRef === child.plan.route.routeRef && generated.route.providerId === child.plan.route.providerId && generated.route.modelId === child.plan.route.modelId && generated.route.releaseSha256 === child.plan.route.releaseSha256 && generated.route.manifestSha256 === child.plan.route.manifestSha256 && generated.route.promptSchemaVersion === BILINGUAL_PROMPT_SCHEMA && generated.route.promptSha256 === child.promptSha256 && HASH.test(generated.route.receiptHash), "MODEL_ROUTE_UNAVAILABLE");
    invariant(generated.budget.reservationId === child.plan.budget.reservationId && generated.budget.units === child.plan.budget.units && generated.budget.currency === child.plan.budget.currency && HASH.test(generated.budget.receiptHash), "BUDGET_UNAVAILABLE");
    invariant(generated.response.providerResourceIdentity === child.plan.external.providerResource && HASH.test(generated.response.responseBodySha256), "RESPONSE_BINDING_INVALID");
    if (generated.response.outcome === "succeeded") invariant(generated.rawJson !== null && sha256(generated.rawJson) === generated.response.responseBodySha256, "RESPONSE_BODY_HASH_MISMATCH");
    else invariant(generated.rawJson === null && generated.response.reasonCode !== null, "KNOWN_FAILURE_INVALID");
  }

  private insertReceipt(child: DurableChild, route: ModelRouteReceipt, budget: BudgetReceipt, attemptState: "response_committed" | "reconcile_required", responseHash: string | null, reasonCode: string | null, at: string): string {
    const receiptId = `model-receipt-${child.public.attemptId}`;
    this.database.prepare("INSERT INTO bilingual_model_receipt_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(receiptId, child.public.attemptId, child.plan.operationId, child.databaseParentOperationId, child.slotId, child.lineage.candidateId, child.plan.language, child.plan.attemptNumber, attemptState, child.plan.route.routeRef, BILINGUAL_PROMPT_SCHEMA, child.promptSha256, canonicalJson(route), route.receiptHash, child.plan.budget.reservationId, canonicalJson(budget), budget.receiptHash, child.plan.route.releaseSha256, child.plan.route.manifestSha256, child.public.canonicalRequestSha256, responseHash, 1, reasonCode, at);
    return receiptId;
  }

  private materializeSuccess(child: DurableChild, route: ModelRouteReceipt, budget: BudgetReceipt, draft: LocalizedDraft, responseHash: string, at: string): void {
    const receiptId = this.insertReceipt(child, route, budget, "response_committed", responseHash, null, at);
    this.database.prepare("INSERT INTO bilingual_language_slot_draft_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(`draft-${child.public.attemptId}`, child.slotId, child.public.attemptId, receiptId, child.lineage.candidateId, child.plan.language, Number(row(this.database, "SELECT revision FROM bilingual_language_slot_v1 WHERE slot_id=?", child.slotId).revision) + 1, draft.contentHash, canonicalJson(draft), child.lineage.inputContentHash, child.lineage.sourceFactSetHash, child.lineage.sourceReleaseHash, BILINGUAL_PROMPT_SCHEMA, child.promptSha256, route.receiptHash, "screen_passed", "clear", at);
    this.database.prepare("UPDATE bilingual_language_slot_v1 SET revision=revision+1,state='complete',model_route_receipt_hash=?,draft_hash=?,current_attempt_id=?,current_attempt_operation_id=?,failure_reason=NULL,operation_id=?,updated_at=? WHERE slot_id=? AND operation_id=? AND state IN ('queued','running')").run(route.receiptHash, draft.contentHash, child.public.attemptId, child.plan.operationId, child.plan.operationId, at, child.slotId, child.plan.operationId);
    this.materializeBundleIfComplete(child, at);
  }

  private materializeKnownFailure(child: DurableChild, route: ModelRouteReceipt, budget: BudgetReceipt, responseHash: string, at: string, reasonCode: string): void {
    this.insertReceipt(child, route, budget, "response_committed", responseHash, reasonCode, at);
    this.database.prepare("UPDATE bilingual_language_slot_v1 SET revision=revision+1,state='failed',model_route_receipt_hash=NULL,draft_hash=NULL,current_attempt_id=?,current_attempt_operation_id=?,failure_reason=?,operation_id=?,updated_at=? WHERE slot_id=? AND operation_id=? AND state IN ('queued','running')").run(child.public.attemptId, child.plan.operationId, reasonCode, child.plan.operationId, at, child.slotId, child.plan.operationId);
  }

  private materializeUnknown(child: DurableChild, at: string): void {
    const route: ModelRouteReceipt = { routeRef: child.plan.route.routeRef, providerId: child.plan.route.providerId, modelId: child.plan.route.modelId, promptSchemaVersion: BILINGUAL_PROMPT_SCHEMA, promptSha256: child.promptSha256, receiptHash: child.routeBindingHash, releaseSha256: child.plan.route.releaseSha256, manifestSha256: child.plan.route.manifestSha256 };
    const budget: BudgetReceipt = { reservationId: child.plan.budget.reservationId, units: child.plan.budget.units, currency: child.plan.budget.currency, receiptHash: child.budgetBindingHash };
    this.insertReceipt(child, route, budget, "reconcile_required", null, "EXTERNAL_UNKNOWN", at);
    this.database.prepare("UPDATE bilingual_language_slot_v1 SET revision=revision+1,state='reconcile_required',model_route_receipt_hash=NULL,draft_hash=NULL,current_attempt_id=?,current_attempt_operation_id=?,failure_reason='EXTERNAL_UNKNOWN',operation_id=?,updated_at=? WHERE slot_id=? AND operation_id=? AND state IN ('queued','running')").run(child.public.attemptId, child.plan.operationId, child.plan.operationId, at, child.slotId, child.plan.operationId);
  }

  private materializeBundleIfComplete(child: DurableChild, at: string): void {
    const safety = this.database.prepare("SELECT decision_id,decision_seq,resource_hash,request_hash,authority_context_hash,expires_at,copy_risk_status,rights_status,deletion_status,media_status FROM bilingual_lineage_effective_safety_v1 WHERE candidate_id=? AND action='clear' AND expires_at>?").get(child.lineage.candidateId, at) as Record<string, unknown> | undefined;
    if (safety === undefined) return;
    const slots = this.database.prepare("SELECT * FROM bilingual_language_slot_v1 WHERE candidate_id=? ORDER BY language DESC").all(child.lineage.candidateId) as Array<Record<string, unknown>>;
    if (slots.length !== 2 || slots.some((slot) => slot.state !== "complete")) return;
    const drafts = {} as Record<BilingualLanguage, LocalizedDraft>;
    const languageSlots = slots.map((slot) => {
      const language = String(slot.language) as BilingualLanguage;
      const draftRow = row(this.database, "SELECT output_json FROM bilingual_language_slot_draft_v1 WHERE slot_id=? AND draft_hash=?", slot.slot_id, slot.draft_hash);
      drafts[language] = parseLocalizedDraft(String(draftRow.output_json), language, child.lineage.sourceExcerpt);
      return {
        slotId: String(slot.slot_id), candidateId: String(slot.candidate_id), language, revision: Number(slot.revision), state: "complete" as const,
        sourceRevision: Number(slot.source_revision), inputContentHash: String(slot.input_content_hash), sourceFactSetHash: String(slot.source_fact_set_hash), sourceReleaseHash: String(slot.source_release_hash),
        promptSchemaVersion: String(slot.prompt_schema_version), promptSha256: String(slot.prompt_sha256), modelRouteReceiptHash: String(slot.model_route_receipt_hash), draftHash: String(slot.draft_hash),
        currentAttemptId: String(slot.current_attempt_id), currentAttemptOperationId: String(slot.current_attempt_operation_id), failureReason: null, operationId: String(slot.operation_id), updatedAt: String(slot.updated_at),
      } satisfies LanguageSlot;
    });
    const revisionRow = this.database.prepare("SELECT COALESCE(MAX(revision),0)+1 AS revision FROM bilingual_bundle_v1 WHERE candidate_id=?").get(child.lineage.candidateId) as Record<string, unknown>;
    const safeLineage = Object.freeze({ ...child.lineage, copyRiskStatus: String(safety.copy_risk_status) as "screen_passed", rightsStatus: String(safety.rights_status) as "clear", deletionStatus: String(safety.deletion_status) as "clear", mediaStatus: String(safety.media_status) as "none" | "allowed" });
    const bundle = buildReviewableBundle(safeLineage, languageSlots, drafts, Number(revisionRow.revision), { decisionId: String(safety.decision_id), decisionSeq: Number(safety.decision_seq), resourceHash: String(safety.resource_hash), requestHash: String(safety.request_hash), authorityContextHash: String(safety.authority_context_hash), expiresAt: String(safety.expires_at) });
    const zhSlot = languageSlots.find((slot) => slot.language === "zh-CN")!;
    const enSlot = languageSlots.find((slot) => slot.language === "en")!;
    const carrierOperationId = child.public.parentOperationId;
    this.database.prepare("INSERT INTO bilingual_bundle_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(bundle.bundleId, bundle.candidateId, bundle.publicId, bundle.revision, bundle.state, bundle.sourceRevision, bundle.inputContentHash, bundle.sourceFactSetHash, bundle.sourceReleaseHash, BILINGUAL_PROMPT_SCHEMA, child.promptSha256, zhSlot.slotId, zhSlot.revision, bundle.zh.contentHash, bundle.zhModelRouteReceiptHash, enSlot.slotId, enSlot.revision, bundle.en.contentHash, bundle.enModelRouteReceiptHash, bundle.bundleHash, canonicalJson(bundle), carrierOperationId, at);
  }
}
