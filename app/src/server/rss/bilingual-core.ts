import { createHash } from "node:crypto";

export const BILINGUAL_PUBLIC_SCHEMA = "public-read-bilingual-v2" as const;
export const BILINGUAL_DRAFT_SCHEMA = "bilingual-slot-draft-v1" as const;
export const BILINGUAL_PROMPT_SCHEMA = "bilingual-refinement-prompt-v1" as const;
export const BILINGUAL_LANGUAGES = ["zh-CN", "en"] as const;
export type BilingualLanguage = (typeof BILINGUAL_LANGUAGES)[number];

export type LanguageSlotState =
  | "missing"
  | "queued"
  | "running"
  | "complete"
  | "blocked"
  | "failed"
  | "reconcile_required"
  | "stale";
export type BundleState = "draft" | "reviewable" | "superseded";
export type ApprovalDecision = "approved" | "rejected" | "manual_override" | "superseded";
export type PublicationState =
  | "queued"
  | "publishing"
  | "published"
  | "reconcile_required"
  | "failed"
  | "correction_queued"
  | "withdrawal_queued"
  | "withdrawn";
export type ProjectionState = "staged" | "active" | "superseded" | "withdrawn" | "invalid";
export type DeliveryState = "pending" | "leased" | "succeeded" | "reconcile_required" | "failed" | "cancelled";

export type BilingualProblemCode =
  | "AUTHORITY_EXTENSION_REQUIRED"
  | "SOURCE_DRIFT"
  | "COPY_RISK"
  | "RIGHTS_UNKNOWN"
  | "RIGHTS_BLOCKED"
  | "DELETION_BLOCKED"
  | "MEDIA_RIGHTS_UNKNOWN"
  | "MEDIA_RIGHTS_BLOCKED"
  | "MODEL_ROUTE_UNAVAILABLE"
  | "BUDGET_UNAVAILABLE"
  | "OUTPUT_INVALID"
  | "ATTEMPT_LIMIT"
  | "CAS_CONFLICT"
  | "RECONCILE_REQUIRED"
  | "AUTO_REVIEW_DISABLED"
  | "AUTO_PUBLISH_DISABLED"
  | "PUBLICATION_FENCE"
  | "SCHEMA_DRIFT";

export class BilingualContractError extends Error {
  readonly code: BilingualProblemCode;

  constructor(code: BilingualProblemCode, message: string = code) {
    super(message);
    this.name = "BilingualContractError";
    this.code = code;
  }
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new BilingualContractError("OUTPUT_INVALID", "non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new BilingualContractError("OUTPUT_INVALID", "unsupported JSON value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

const FORBIDDEN_KEYS = new Set([
  "sourceExcerpt", "rawSource", "sourceBody", "rawBody", "sourceText", "originalText",
  "prompt", "modelResponse", "privateRouteReceipt", "sourceBodyText"
]);
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u;

function assertSafeString(value: string, label: string): void {
  if (CONTROL_CHARS.test(value)) throw new BilingualContractError("OUTPUT_INVALID", `${label} contains control characters`);
}

function inspectKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(inspectKeys);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) throw new BilingualContractError("OUTPUT_INVALID", `forbidden key ${key}`);
    assertSafeString(key, "JSON key");
    inspectKeys(child);
  }
}

export type SourceLineageInput = Readonly<{
  candidateId: string;
  publicId: string;
  sourceId: string;
  sourceRevision: number;
  inputContentHash: string;
  sourceFactSetHash: string;
  sourceReleaseHash: string;
  canonicalUrl: string;
  sourceTitle: string;
  sourceAuthor: string | null;
  sourcePublishedAt: string | null;
  sourceExcerpt?: string;
}>;

export type BilingualLineage = Readonly<SourceLineageInput & {
  copyRiskStatus: "unknown" | "screen_passed" | "blocked";
  rightsStatus: "unknown" | "clear" | "blocked";
  deletionStatus: "unknown" | "clear" | "blocked";
  mediaStatus: "none" | "allowed" | "unknown" | "blocked";
}>;

function assertHash(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new BilingualContractError("OUTPUT_INVALID", `${label} is not a lowercase SHA-256`);
}

function assertTimestamp(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new BilingualContractError("OUTPUT_INVALID", `${label} is not RFC3339 millisecond UTC`);
  }
}

export function assertSourceLineage(input: SourceLineageInput): BilingualLineage {
  for (const [value, label] of [
    [input.candidateId, "candidateId"], [input.publicId, "publicId"], [input.sourceId, "sourceId"],
    [input.canonicalUrl, "canonicalUrl"], [input.sourceTitle, "sourceTitle"]
  ] as const) {
    if (value.trim().length === 0) throw new BilingualContractError("OUTPUT_INVALID", `${label} is empty`);
    assertSafeString(value, label);
  }
  if (!/^https:\/\//u.test(input.canonicalUrl)) throw new BilingualContractError("OUTPUT_INVALID", "canonical URL must be HTTPS");
  if (!Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 1) throw new BilingualContractError("OUTPUT_INVALID", "sourceRevision invalid");
  for (const [value, label] of [[input.inputContentHash, "inputContentHash"], [input.sourceFactSetHash, "sourceFactSetHash"], [input.sourceReleaseHash, "sourceReleaseHash"]] as const) assertHash(value, label);
  if (input.sourceAuthor !== null) {
    if (input.sourceAuthor.trim().length === 0) throw new BilingualContractError("OUTPUT_INVALID", "sourceAuthor is empty");
    assertSafeString(input.sourceAuthor, "sourceAuthor");
  }
  if (input.sourcePublishedAt !== null) assertTimestamp(input.sourcePublishedAt, "sourcePublishedAt");
  if (input.sourceExcerpt !== undefined) assertSafeString(input.sourceExcerpt, "private source excerpt");
  return Object.freeze({ ...input, copyRiskStatus: "unknown", rightsStatus: "unknown", deletionStatus: "unknown", mediaStatus: "unknown" });
}

export type LanguageSlot = Readonly<{
  slotId: string;
  candidateId: string;
  language: BilingualLanguage;
  revision: number;
  state: LanguageSlotState;
  sourceRevision: number;
  inputContentHash: string;
  sourceFactSetHash: string;
  sourceReleaseHash: string;
  promptSchemaVersion: string;
  promptSha256: string;
  modelRouteReceiptHash: string | null;
  draftHash: string | null;
  currentAttemptId: string | null;
  currentAttemptOperationId: string | null;
  failureReason: BilingualProblemCode | null;
  operationId: string;
  updatedAt: string;
}>;

export type SlotTransitionOptions = Readonly<{
  operationId: string;
  now: string;
  newOperation?: boolean;
  sameAttemptReceipt?: boolean;
  failureReason?: BilingualProblemCode | null;
  modelRouteReceiptHash?: string | null;
  draftHash?: string | null;
  attemptId?: string | null;
  sourceRevision?: number;
  inputContentHash?: string;
  sourceFactSetHash?: string;
  sourceReleaseHash?: string;
  promptSchemaVersion?: string;
  promptSha256?: string;
}>;

const SLOT_EDGES: Readonly<Record<LanguageSlotState, readonly LanguageSlotState[]>> = {
  missing: ["queued"],
  queued: ["running", "blocked", "failed", "reconcile_required"],
  running: ["complete", "blocked", "failed", "reconcile_required"],
  complete: ["queued", "stale"],
  blocked: ["queued"],
  failed: ["queued"],
  reconcile_required: ["running", "complete", "failed"],
  stale: ["queued", "reconcile_required"]
};

export function assertSlotTransition(from: LanguageSlotState, to: LanguageSlotState, options: Pick<SlotTransitionOptions, "newOperation" | "sameAttemptReceipt"> = {}): void {
  if (!SLOT_EDGES[from].includes(to)) throw new BilingualContractError("OUTPUT_INVALID", `illegal slot edge ${from}->${to}`);
  if (((from === "blocked" || from === "failed" || from === "stale" || from === "complete") && to === "queued") || (from === "complete" && to === "stale")) {
    if (options.newOperation !== true) throw new BilingualContractError("OUTPUT_INVALID", "retry or invalidation requires a new operation");
  }
  if ((from === "reconcile_required" || (from === "stale" && to === "reconcile_required")) && options.sameAttemptReceipt !== true) throw new BilingualContractError("RECONCILE_REQUIRED", "reconcile must reuse the same attempt receipt");
}

export function createInitialLanguageSlots(lineage: BilingualLineage, promptSchemaVersion: string, promptSha256: string, now: string): readonly [LanguageSlot, LanguageSlot] {
  if (promptSchemaVersion.trim().length < 1 || promptSchemaVersion.length > 80) throw new BilingualContractError("OUTPUT_INVALID", "promptSchemaVersion invalid");
  assertHash(promptSha256, "promptSha256");
  assertTimestamp(now, "now");
  return BILINGUAL_LANGUAGES.map((language) => Object.freeze({
    slotId: `slot-${sha256(`${lineage.candidateId}\n${language}`).slice(0, 48)}`,
    candidateId: lineage.candidateId,
    language,
    revision: 0,
    state: "missing" as const,
    sourceRevision: lineage.sourceRevision,
    inputContentHash: lineage.inputContentHash,
    sourceFactSetHash: lineage.sourceFactSetHash,
    sourceReleaseHash: lineage.sourceReleaseHash,
    promptSchemaVersion,
    promptSha256,
    modelRouteReceiptHash: null,
    draftHash: null,
    currentAttemptId: null,
    currentAttemptOperationId: null,
    failureReason: null,
    operationId: "bilingual-bootstrap-closed",
    updatedAt: now
  })) as unknown as readonly [LanguageSlot, LanguageSlot];
}

export type NewBilingualCandidateState = Readonly<{ lineage: BilingualLineage; slots: readonly [LanguageSlot, LanguageSlot]; bundle: null; approval: null; publication: null; projection: null; activePointer: null; outbox: null }>;

/** New content starts with one parent lineage and exactly two independent
 * missing slots. No review/publication/projection side effect is created. */
export function initializeNewBilingualCandidate(lineageInput: SourceLineageInput, promptSchemaVersion: string, promptSha256: string, now: string): NewBilingualCandidateState {
  const lineage = assertSourceLineage(lineageInput);
  return Object.freeze({ lineage, slots: createInitialLanguageSlots(lineage, promptSchemaVersion, promptSha256, now), bundle: null, approval: null, publication: null, projection: null, activePointer: null, outbox: null });
}

export function transitionLanguageSlot(slot: LanguageSlot, to: LanguageSlotState, options: SlotTransitionOptions): LanguageSlot {
  assertTimestamp(options.now, "now");
  if (!options.operationId.trim()) throw new BilingualContractError("OUTPUT_INVALID", "slot operation identity is required");
  assertSlotTransition(slot.state, to, options);
  if (options.now <= slot.updatedAt) throw new BilingualContractError("CAS_CONFLICT", "slot timestamp did not advance");
  const requiresFreshOperation = ((slot.state === "blocked" || slot.state === "failed" || slot.state === "stale" || slot.state === "complete") && to === "queued") || (slot.state === "complete" && to === "stale");
  if (requiresFreshOperation && options.operationId === slot.operationId) throw new BilingualContractError("OUTPUT_INVALID", "fresh operation identity is required");
  if (!requiresFreshOperation && options.newOperation !== true && options.operationId !== slot.operationId) throw new BilingualContractError("OUTPUT_INVALID", "operation identity changed inside one attempt");
  const retryReset = to === "queued";
  const staleReset = to === "stale";
  const refreshingStale = slot.state === "stale" && to === "queued";
  const rerunningComplete = slot.state === "complete" && to === "queued";
  const retryingTerminal = (slot.state === "failed" || slot.state === "blocked") && to === "queued";
  if (retryingTerminal) {
    const bound = [
      [options.sourceRevision, slot.sourceRevision], [options.inputContentHash, slot.inputContentHash],
      [options.sourceFactSetHash, slot.sourceFactSetHash], [options.sourceReleaseHash, slot.sourceReleaseHash],
      [options.promptSchemaVersion, slot.promptSchemaVersion], [options.promptSha256, slot.promptSha256],
    ] as const;
    if (bound.some(([next, current]) => next !== undefined && next !== current)) throw new BilingualContractError("SOURCE_DRIFT", "retry changed the failed slot contract");
  }
  if (refreshingStale) {
    const fields = [options.sourceRevision, options.inputContentHash, options.sourceFactSetHash, options.sourceReleaseHash, options.promptSchemaVersion, options.promptSha256];
    if (fields.some((value) => value === undefined)) throw new BilingualContractError("SOURCE_DRIFT", "stale retry requires the complete refreshed source and prompt contract");
    if (options.sourceRevision === slot.sourceRevision && options.inputContentHash === slot.inputContentHash && options.sourceFactSetHash === slot.sourceFactSetHash && options.sourceReleaseHash === slot.sourceReleaseHash && options.promptSchemaVersion === slot.promptSchemaVersion && options.promptSha256 === slot.promptSha256) throw new BilingualContractError("SOURCE_DRIFT", "stale retry did not refresh its contract");
    if (!Number.isSafeInteger(options.sourceRevision) || (options.sourceRevision ?? 0) < slot.sourceRevision) throw new BilingualContractError("SOURCE_DRIFT", "refreshed source revision is invalid");
    assertHash(options.inputContentHash as string, "inputContentHash"); assertHash(options.sourceFactSetHash as string, "sourceFactSetHash"); assertHash(options.sourceReleaseHash as string, "sourceReleaseHash"); assertHash(options.promptSha256 as string, "promptSha256");
  }
  if (rerunningComplete) {
    for (const [value, current, label] of [
      [options.sourceRevision, slot.sourceRevision, "sourceRevision"],
      [options.inputContentHash, slot.inputContentHash, "inputContentHash"],
      [options.sourceFactSetHash, slot.sourceFactSetHash, "sourceFactSetHash"],
      [options.sourceReleaseHash, slot.sourceReleaseHash, "sourceReleaseHash"],
    ] as const) {
      if (value !== undefined && value !== current) throw new BilingualContractError("SOURCE_DRIFT", `complete rerun changed ${label}`);
    }
    if ((options.promptSchemaVersion === undefined) !== (options.promptSha256 === undefined)) throw new BilingualContractError("OUTPUT_INVALID", "prompt rerun contract is incomplete");
    if (options.promptSha256 !== undefined) assertHash(options.promptSha256, "promptSha256");
  }
  const next: LanguageSlot = Object.freeze({
    ...slot,
    revision: slot.revision + 1,
    state: to,
    sourceRevision: refreshingStale ? options.sourceRevision as number : slot.sourceRevision,
    inputContentHash: refreshingStale ? options.inputContentHash as string : slot.inputContentHash,
    sourceFactSetHash: refreshingStale ? options.sourceFactSetHash as string : slot.sourceFactSetHash,
    sourceReleaseHash: refreshingStale ? options.sourceReleaseHash as string : slot.sourceReleaseHash,
    promptSchemaVersion: refreshingStale || rerunningComplete && options.promptSchemaVersion !== undefined ? options.promptSchemaVersion as string : slot.promptSchemaVersion,
    promptSha256: refreshingStale || rerunningComplete && options.promptSha256 !== undefined ? options.promptSha256 as string : slot.promptSha256,
    currentAttemptId: retryReset ? null : (options.attemptId === undefined ? slot.currentAttemptId : options.attemptId),
    currentAttemptOperationId: retryReset ? null : (to === "running" && options.attemptId !== undefined ? options.operationId : slot.currentAttemptOperationId),
    modelRouteReceiptHash: retryReset || staleReset ? null : (options.modelRouteReceiptHash === undefined ? slot.modelRouteReceiptHash : options.modelRouteReceiptHash),
    draftHash: retryReset || staleReset ? null : (options.draftHash === undefined ? slot.draftHash : options.draftHash),
    failureReason: options.failureReason === undefined ? (to === "reconcile_required" ? "RECONCILE_REQUIRED" : (to === "complete" || to === "queued" || to === "running" ? null : slot.failureReason)) : options.failureReason,
    operationId: options.operationId,
    updatedAt: options.now
  } as LanguageSlot & { operationId: string });
  if (to === "complete" && (!next.draftHash || !next.modelRouteReceiptHash || next.failureReason !== null)) throw new BilingualContractError("OUTPUT_INVALID", "complete slot is not hash closed");
  if ((to === "failed" || to === "blocked") && !next.failureReason) throw new BilingualContractError("OUTPUT_INVALID", "failed slot requires a reason");
  if (to === "running" && (!next.currentAttemptId || (slot.state === "queued" && next.currentAttemptId === slot.currentAttemptId))) throw new BilingualContractError("OUTPUT_INVALID", "running slot requires a fresh attempt");
  if (to === "reconcile_required" && (!next.currentAttemptId || next.failureReason === null)) throw new BilingualContractError("RECONCILE_REQUIRED", "reconcile requires the existing attempt identity and reason");
  if ((next.currentAttemptId === null) !== (next.currentAttemptOperationId === null)) throw new BilingualContractError("OUTPUT_INVALID", "attempt and owning operation must be bound together");
  return next;
}

export type LocalizedDraft = Readonly<{
  schemaVersion: typeof BILINGUAL_DRAFT_SCHEMA;
  language: BilingualLanguage;
  title: string;
  summary: string;
  lead: string;
  body: readonly string[];
  keyPoints: readonly string[];
  contentHash: string;
}>;

export type CopyRiskResult = Readonly<{ status: "screen_passed" | "blocked"; reason: "none" | "long_source_overlap" | "high_source_coverage" }>;

function normalizedText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function allDraftText(draft: Pick<LocalizedDraft, "title" | "summary" | "lead" | "body" | "keyPoints">): string {
  return [draft.title, draft.summary, draft.lead, ...draft.body, ...draft.keyPoints].join(" ");
}

export function screenCopyRisk(draft: Pick<LocalizedDraft, "title" | "summary" | "lead" | "body" | "keyPoints">, sourceExcerpt: string | undefined): CopyRiskResult {
  if (!sourceExcerpt) return { status: "screen_passed", reason: "none" };
  const source = normalizedText(sourceExcerpt);
  const output = normalizedText(allDraftText(draft));
  if (source.length === 0 || output.length === 0) return { status: "screen_passed", reason: "none" };
  if (source === output || (source.length >= 20 && output.includes(source))) return { status: "blocked", reason: "long_source_overlap" };
  for (let width = Math.min(120, source.length); width >= 80; width -= 1) {
    for (let index = 0; index + width <= source.length; index += Math.max(1, Math.floor(width / 5))) {
      if (output.includes(source.slice(index, index + width))) return { status: "blocked", reason: "long_source_overlap" };
    }
  }
  const sourceWords = source.split(/\s+/u).filter(Boolean);
  if (sourceWords.length >= 12) {
    const outputWords = new Set(output.split(/\s+/u));
    const coverage = sourceWords.filter((word) => outputWords.has(word)).length / sourceWords.length;
    if (coverage >= 0.8) return { status: "blocked", reason: "high_source_coverage" };
  }
  return { status: "screen_passed", reason: "none" };
}

function ensureText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || Buffer.byteLength(value, "utf8") > maxBytes) throw new BilingualContractError("OUTPUT_INVALID", `${label} invalid`);
  assertSafeString(value, label);
  return value;
}

export function parseLocalizedDraft(raw: string, expectedLanguage: BilingualLanguage, sourceExcerpt?: string): LocalizedDraft {
  if (raw.length === 0 || raw.charCodeAt(0) === 0xfeff || raw.trim() !== raw || raw[0] !== "{" || raw.at(-1) !== "}") throw new BilingualContractError("OUTPUT_INVALID", "output must be exact JSON object bytes");
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { throw new BilingualContractError("OUTPUT_INVALID", "output is not JSON"); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new BilingualContractError("OUTPUT_INVALID", "output is not an object");
  inspectKeys(value);
  const object = value as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "language", "title", "summary", "lead", "body", "keyPoints", "contentHash"]);
  if (Object.keys(object).some((key) => !allowed.has(key)) || Object.keys(object).length !== allowed.size) throw new BilingualContractError("OUTPUT_INVALID", "unknown or missing output field");
  if (object.schemaVersion !== BILINGUAL_DRAFT_SCHEMA || object.language !== expectedLanguage) throw new BilingualContractError("OUTPUT_INVALID", "draft identity mismatch");
  if (!Array.isArray(object.body) || object.body.length < 1 || object.body.length > 8 || !Array.isArray(object.keyPoints) || object.keyPoints.length < 1 || object.keyPoints.length > 8) throw new BilingualContractError("OUTPUT_INVALID", "draft arrays invalid");
  const draft: LocalizedDraft = Object.freeze({
    schemaVersion: BILINGUAL_DRAFT_SCHEMA,
    language: expectedLanguage,
    title: ensureText(object.title, "title", 400),
    summary: ensureText(object.summary, "summary", 1200),
    lead: ensureText(object.lead, "lead", 600),
    body: Object.freeze(object.body.map((entry, index) => ensureText(entry, `body[${index}]`, 12000))),
    keyPoints: Object.freeze(object.keyPoints.map((entry, index) => ensureText(entry, `keyPoints[${index}]`, 240))),
    contentHash: typeof object.contentHash === "string" ? object.contentHash : ""
  });
  assertHash(draft.contentHash, "contentHash");
  const expectedHash = sha256(canonicalJson({ language: draft.language, title: draft.title, summary: draft.summary, lead: draft.lead, body: draft.body, keyPoints: draft.keyPoints }));
  if (expectedHash !== draft.contentHash) throw new BilingualContractError("OUTPUT_INVALID", "contentHash mismatch");
  const copyRisk = screenCopyRisk(draft, sourceExcerpt);
  if (copyRisk.status === "blocked") throw new BilingualContractError("COPY_RISK", copyRisk.reason);
  return draft;
}

export type ModelRouteReceipt = Readonly<{
  routeRef: string;
  providerId: string;
  modelId: string;
  promptSchemaVersion: string;
  promptSha256: string;
  receiptHash: string;
  releaseSha256: string;
  manifestSha256: string;
}>;
export type BudgetReceipt = Readonly<{ reservationId: string; units: number; currency: string; receiptHash: string }>;

export function assertModelReceipts(route: ModelRouteReceipt, budget: BudgetReceipt, promptSha256: string): void {
  if (!route.routeRef || !route.providerId || !route.modelId || route.promptSchemaVersion !== BILINGUAL_PROMPT_SCHEMA || route.promptSha256 !== promptSha256) throw new BilingualContractError("MODEL_ROUTE_UNAVAILABLE", "route receipt does not bind prompt");
  assertHash(route.promptSha256, "route.promptSha256");
  assertHash(route.receiptHash, "route.receiptHash");
  assertHash(route.releaseSha256, "route.releaseSha256");
  assertHash(route.manifestSha256, "route.manifestSha256");
  if (!budget.reservationId || !Number.isSafeInteger(budget.units) || budget.units <= 0 || !/^[A-Z]{3}$/u.test(budget.currency)) throw new BilingualContractError("BUDGET_UNAVAILABLE", "budget receipt invalid");
  assertHash(budget.receiptHash, "budget.receiptHash");
}

export type RefinementChild = Readonly<{
  operationId: string;
  idempotencyKey: string;
  semanticAction: "refine_language";
  parentOperationId: string;
  candidateId: string;
  language: BilingualLanguage;
  attemptNumber: number;
}>;

export type RefinementOperationPair = Readonly<{
  parent: Readonly<{ operationId: string; idempotencyKey: string; semanticAction: "refine_both"; candidateId: string; attemptNumber: number }>;
  children: readonly [RefinementChild, RefinementChild];
}>;

export function planBilingualRefinement(candidateId: string, sourceRevision: number, inputContentHash: string, attemptNumber = 1): RefinementOperationPair {
  if (!candidateId || !Number.isSafeInteger(sourceRevision) || sourceRevision < 1 || !Number.isSafeInteger(attemptNumber) || attemptNumber < 1) throw new BilingualContractError("OUTPUT_INVALID", "refinement identity invalid");
  if (attemptNumber > 3) throw new BilingualContractError("ATTEMPT_LIMIT", "language attempt budget exhausted");
  assertHash(inputContentHash, "inputContentHash");
  const seed = `${candidateId}\n${sourceRevision}\n${inputContentHash}\n${attemptNumber}`;
  // combined-parent-carrier-v1: the zh operation carries the aggregate link
  // and its own language link with a NULL database parent. The en operation
  // points to that carrier. This is a two-node DAG (en -> zh), so there is no
  // fake third external operation, self-link, orphan budget or extra attempt.
  const parentOperationId = `bilingual-zh-${sha256(`${seed}\nzh-CN`).slice(0, 48)}`;
  const zhIdempotencyKey = `bilingual-idem-zh-CN-${sha256(`${seed}\nzh-CN`).slice(0, 32)}`;
  const parent = Object.freeze({ operationId: parentOperationId, idempotencyKey: zhIdempotencyKey, semanticAction: "refine_both" as const, candidateId, attemptNumber });
  const child = (language: BilingualLanguage): RefinementChild => Object.freeze({ operationId: language === "zh-CN" ? parentOperationId : `bilingual-en-${sha256(`${seed}\nen`).slice(0, 48)}`, idempotencyKey: language === "zh-CN" ? zhIdempotencyKey : `bilingual-idem-en-${sha256(`${seed}\nen`).slice(0, 32)}`, semanticAction: "refine_language" as const, parentOperationId, candidateId, language, attemptNumber });
  return Object.freeze({ parent, children: [child("zh-CN"), child("en")] as const });
}

export const AUTOMATIC_REFINEMENT_POLICY = Object.freeze({ automaticRefine: true, automaticReview: false, automaticApprove: false, automaticPublish: false, automaticCorrect: false, automaticWithdraw: false });

export function assertAutomaticAction(action: keyof typeof AUTOMATIC_REFINEMENT_POLICY): void {
  if (action === "automaticRefine" && AUTOMATIC_REFINEMENT_POLICY.automaticRefine) return;
  const code = action === "automaticReview" || action === "automaticApprove" ? "AUTO_REVIEW_DISABLED" : "AUTO_PUBLISH_DISABLED";
  throw new BilingualContractError(code, `${action} is disabled`);
}

export type BilingualBundle = Readonly<{
  bundleId: string;
  candidateId: string;
  publicId: string;
  revision: number;
  state: BundleState;
  sourceRevision: number;
  inputContentHash: string;
  sourceFactSetHash: string;
  sourceReleaseHash: string;
  promptSchemaVersion: string;
  promptSha256: string;
  zhModelRouteReceiptHash: string;
  enModelRouteReceiptHash: string;
  zh: LocalizedDraft;
  en: LocalizedDraft;
  safetyAuthority: BilingualSafetyAuthorityRef;
  bundleHash: string;
}>;

export type BilingualSafetyAuthorityRef = Readonly<{
  decisionId: string;
  decisionSeq: number;
  resourceHash: string;
  requestHash: string;
  authorityContextHash: string;
  expiresAt: string;
}>;

export function buildReviewableBundle(lineage: BilingualLineage, slots: readonly LanguageSlot[], drafts: Readonly<Record<BilingualLanguage, LocalizedDraft>>, revision: number, safetyAuthority?: BilingualSafetyAuthorityRef): BilingualBundle {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new BilingualContractError("OUTPUT_INVALID", "bundle revision invalid");
  if (lineage.copyRiskStatus !== "screen_passed" || lineage.rightsStatus !== "clear" || lineage.deletionStatus !== "clear" || !["none", "allowed"].includes(lineage.mediaStatus)) throw new BilingualContractError("PUBLICATION_FENCE", "lineage gates are not clear");
  if (safetyAuthority === undefined || !safetyAuthority.decisionId || !Number.isSafeInteger(safetyAuthority.decisionSeq) || safetyAuthority.decisionSeq < 1) throw new BilingualContractError("PUBLICATION_FENCE", "fresh safety authority is required");
  for (const [value, label] of [[safetyAuthority.resourceHash, "safety.resourceHash"], [safetyAuthority.requestHash, "safety.requestHash"], [safetyAuthority.authorityContextHash, "safety.authorityContextHash"]] as const) assertHash(value, label);
  assertTimestamp(safetyAuthority.expiresAt, "safety.expiresAt");
  if (slots.length !== 2 || new Set(slots.map((slot) => slot.language)).size !== 2 || slots.some((slot) => slot.state !== "complete" || slot.candidateId !== lineage.candidateId || slot.sourceRevision !== lineage.sourceRevision || slot.inputContentHash !== lineage.inputContentHash || slot.sourceFactSetHash !== lineage.sourceFactSetHash || slot.sourceReleaseHash !== lineage.sourceReleaseHash)) throw new BilingualContractError("OUTPUT_INVALID", "both current complete slots are required");
  const zh = drafts["zh-CN"]; const en = drafts.en;
  if (!zh || !en || zh.schemaVersion !== BILINGUAL_DRAFT_SCHEMA || en.schemaVersion !== BILINGUAL_DRAFT_SCHEMA || zh.language !== "zh-CN" || en.language !== "en") throw new BilingualContractError("OUTPUT_INVALID", "both language drafts are required");
  assertHash(zh.contentHash, "zh.contentHash");
  assertHash(en.contentHash, "en.contentHash");
  for (const [draft, label] of [[zh, "zh-CN"], [en, "en"]] as const) {
    if (draft.body.length < 1 || draft.body.length > 8 || draft.keyPoints.length < 1 || draft.keyPoints.length > 8) throw new BilingualContractError("OUTPUT_INVALID", `${label} draft arrays are invalid`);
  }
  const [zhSlot, enSlot] = slots[0].language === "zh-CN" ? [slots[0], slots[1]] : [slots[1], slots[0]];
  if (zhSlot.language !== "zh-CN" || enSlot.language !== "en" || zhSlot.promptSchemaVersion !== enSlot.promptSchemaVersion || zhSlot.promptSha256 !== enSlot.promptSha256 || !zhSlot.modelRouteReceiptHash || !enSlot.modelRouteReceiptHash || zhSlot.draftHash !== zh.contentHash || enSlot.draftHash !== en.contentHash) {
    throw new BilingualContractError("OUTPUT_INVALID", "bundle receipts or draft hashes are not bound to both current slots");
  }
  assertHash(zhSlot.promptSha256, "promptSha256");
  const bundleId = `bundle-${sha256(`${lineage.candidateId}\n${revision}\n${zh.contentHash}\n${en.contentHash}`).slice(0, 48)}`;
  const bundleHash = sha256(canonicalJson({ bundleId, candidateId: lineage.candidateId, publicId: lineage.publicId, revision, sourceRevision: lineage.sourceRevision, inputContentHash: lineage.inputContentHash, sourceFactSetHash: lineage.sourceFactSetHash, sourceReleaseHash: lineage.sourceReleaseHash, promptSchemaVersion: zhSlot.promptSchemaVersion, promptSha256: zhSlot.promptSha256, zh: zh.contentHash, zhModelRouteReceiptHash: zhSlot.modelRouteReceiptHash, en: en.contentHash, enModelRouteReceiptHash: enSlot.modelRouteReceiptHash, safetyAuthority }));
  return Object.freeze({ bundleId, candidateId: lineage.candidateId, publicId: lineage.publicId, revision, state: "reviewable", sourceRevision: lineage.sourceRevision, inputContentHash: lineage.inputContentHash, sourceFactSetHash: lineage.sourceFactSetHash, sourceReleaseHash: lineage.sourceReleaseHash, promptSchemaVersion: zhSlot.promptSchemaVersion, promptSha256: zhSlot.promptSha256, zhModelRouteReceiptHash: zhSlot.modelRouteReceiptHash, enModelRouteReceiptHash: enSlot.modelRouteReceiptHash, zh, en, safetyAuthority, bundleHash });
}

export type Approval = Readonly<{ approvalId: string; bundleId: string; bundleHash: string; decision: ApprovalDecision; actorRef: string; operationId: string; decidedAt: string }>;

export function buildManualApproval(bundle: BilingualBundle, decision: "approved" | "rejected" | "manual_override", actorRef: string, operationId: string, decidedAt: string): Approval {
  if (bundle.state !== "reviewable" || actorRef.startsWith("system-")) throw new BilingualContractError("AUTO_REVIEW_DISABLED", "review must be manual");
  if (!actorRef || actorRef.trim().length === 0 || !operationId || operationId.trim().length === 0) throw new BilingualContractError("OUTPUT_INVALID", "manual approval identity is required");
  assertSafeString(actorRef, "actorRef");
  assertSafeString(operationId, "operationId");
  assertTimestamp(decidedAt, "decidedAt");
  const approvalId = `approval-${sha256(`${bundle.bundleId}\n${decision}\n${operationId}`).slice(0, 48)}`;
  return Object.freeze({ approvalId, bundleId: bundle.bundleId, bundleHash: bundle.bundleHash, decision, actorRef, operationId, decidedAt });
}

export function invalidateApprovalOnDrift(approval: Approval, currentBundleHash: string): Approval {
  assertHash(currentBundleHash, "currentBundleHash");
  if (approval.bundleHash === currentBundleHash) return approval;
  return Object.freeze({ ...approval, decision: "superseded", approvalId: `${approval.approvalId}-superseded` });
}

export type PublicationChangeKind = "initial" | "correction" | "withdrawal";
export type Publication = Readonly<{ publicationId: string; publicId: string; revision: number; changeKind: PublicationChangeKind; supersedesPublicationId: string | null; reasonCode: string | null; bundleId: string; bundleHash: string; approvalId: string; approvalHash: string; status: PublicationState; payloadHash: string; operationId: string; publishedAt: string | null; createdAt: string; updatedAt: string }>;

export function buildQueuedPublication(bundle: BilingualBundle, approval: Approval, payloadHash: string, revision: number, operationId: string, now: string): Publication {
  if (!((approval.decision === "approved" || approval.decision === "manual_override") && approval.bundleId === bundle.bundleId && approval.bundleHash === bundle.bundleHash)) throw new BilingualContractError("PUBLICATION_FENCE", "approved current bundle is required");
  if (revision !== 1) throw new BilingualContractError("OUTPUT_INVALID", "initial publication revision must be one");
  assertHash(payloadHash, "payloadHash");
  assertTimestamp(now, "now");
  if (!operationId || operationId.trim().length === 0) throw new BilingualContractError("OUTPUT_INVALID", "publication operation is required");
  return Object.freeze({ publicationId: `publication-${sha256(`${bundle.publicId}\ninitial\n${revision}\n${bundle.bundleHash}`).slice(0, 48)}`, publicId: bundle.publicId, revision, changeKind: "initial", supersedesPublicationId: null, reasonCode: null, bundleId: bundle.bundleId, bundleHash: bundle.bundleHash, approvalId: approval.approvalId, approvalHash: sha256(canonicalJson(approval)), status: "queued", payloadHash, operationId, publishedAt: null, createdAt: now, updatedAt: now });
}

const PUBLICATION_EDGES: Readonly<Record<PublicationState, readonly PublicationState[]>> = {
  queued: ["publishing", "reconcile_required", "failed"],
  publishing: ["published", "withdrawn", "reconcile_required", "failed"],
  published: [],
  reconcile_required: ["published", "withdrawn", "failed"],
  failed: [],
  correction_queued: ["publishing", "reconcile_required", "failed"],
  withdrawal_queued: ["publishing", "withdrawn", "reconcile_required", "failed"],
  withdrawn: []
};

export function transitionPublication(publication: Publication, status: PublicationState, now: string): Publication {
  assertTimestamp(now, "now");
  if (now <= publication.updatedAt) throw new BilingualContractError("CAS_CONFLICT", "publication timestamp did not advance");
  if (!PUBLICATION_EDGES[publication.status].includes(status)) throw new BilingualContractError("OUTPUT_INVALID", `illegal publication edge ${publication.status}->${status}`);
  if (status === "withdrawn" && publication.changeKind !== "withdrawal") throw new BilingualContractError("PUBLICATION_FENCE", "only a withdrawal revision may withdraw");
  if (status === "published" && publication.changeKind === "withdrawal") throw new BilingualContractError("PUBLICATION_FENCE", "withdrawal revisions cannot publish");
  return Object.freeze({ ...publication, status, publishedAt: status === "published" ? now : null, updatedAt: now });
}

export function buildCorrectionPublication(previous: Publication, bundle: BilingualBundle, approval: Approval, payloadHash: string, operationId: string, now: string, reasonCode = "manual_correction"): Publication {
  if (previous.status !== "published" || bundle.publicId !== previous.publicId || !["approved", "manual_override"].includes(approval.decision) || approval.bundleId !== bundle.bundleId || approval.bundleHash !== bundle.bundleHash || (bundle.bundleId === previous.bundleId && bundle.bundleHash === previous.bundleHash)) throw new BilingualContractError("PUBLICATION_FENCE", "correction requires a distinct approved replacement bundle for the current published revision");
  if (!reasonCode.trim()) throw new BilingualContractError("OUTPUT_INVALID", "correction reason is required");
  assertHash(payloadHash, "payloadHash");
  assertTimestamp(now, "now");
  const revision = previous.revision + 1;
  const publicationId = `publication-${sha256(`${previous.publicId}\ncorrection\n${revision}\n${previous.publicationId}\n${bundle.bundleHash}`).slice(0, 48)}`;
  return Object.freeze({ publicationId, publicId: previous.publicId, revision, changeKind: "correction", supersedesPublicationId: previous.publicationId, reasonCode, bundleId: bundle.bundleId, bundleHash: bundle.bundleHash, approvalId: approval.approvalId, approvalHash: sha256(canonicalJson(approval)), status: "correction_queued", payloadHash, operationId, publishedAt: null, createdAt: now, updatedAt: now });
}

export function buildWithdrawalPublication(previous: Publication, payloadHash: string, operationId: string, now: string, reasonCode = "manual_withdrawal"): Publication {
  if (previous.status !== "published") throw new BilingualContractError("PUBLICATION_FENCE", "withdrawal must bind the current published publication revision");
  if (!reasonCode.trim()) throw new BilingualContractError("OUTPUT_INVALID", "withdrawal reason is required");
  assertHash(payloadHash, "payloadHash");
  assertTimestamp(now, "now");
  const revision = previous.revision + 1;
  const publicationId = `publication-${sha256(`${previous.publicId}\nwithdrawal\n${revision}\n${previous.publicationId}\n${previous.bundleHash}`).slice(0, 48)}`;
  return Object.freeze({ publicationId, publicId: previous.publicId, revision, changeKind: "withdrawal", supersedesPublicationId: previous.publicationId, reasonCode, bundleId: previous.bundleId, bundleHash: previous.bundleHash, approvalId: previous.approvalId, approvalHash: previous.approvalHash, status: "withdrawal_queued", payloadHash, operationId, publishedAt: null, createdAt: now, updatedAt: now });
}

export function retryFailedPublication(publication: Publication, operationId: string, now: string): Publication {
  if (publication.status !== "failed" || !operationId.trim() || operationId === publication.operationId) throw new BilingualContractError("OUTPUT_INVALID", "failed publication retry requires a fresh operation");
  assertTimestamp(now, "now");
  if (now <= publication.updatedAt) throw new BilingualContractError("CAS_CONFLICT", "publication retry timestamp did not advance");
  const status = publication.changeKind === "initial" ? "queued" : publication.changeKind === "correction" ? "correction_queued" : "withdrawal_queued";
  return Object.freeze({ ...publication, status, operationId, updatedAt: now });
}

export type PublicLocalized = Readonly<{ title: string; summary: string; lead: string; body: string; keyPoints: readonly string[]; contentHash: string }>;
export type PublicV2 = Readonly<{ schemaVersion: typeof BILINGUAL_PUBLIC_SCHEMA; publicId: string; category: string; defaultLanguage: "zh-CN"; availableLanguages: readonly ["zh-CN", "en"]; localized: Readonly<{ "zh-CN": PublicLocalized; en: PublicLocalized }>; source: Readonly<{ name: string; author: string | null; publishedAt: string | null; canonicalUrl: string }>; publishedAt: string; updatedAt: string; media: readonly Readonly<{ kind: "image"; url: string; alt: string; width: number; height: number; rightsPolicyId: string; mediaHash: string }>[]; generationId: string; generationHash: string }>;

export type PublicMedia = Readonly<{ url: string; alt: string; width: number; height: number; rightsPolicyId: string; mediaHash: string }>;

export function buildPublicV2(bundle: BilingualBundle, source: Pick<SourceLineageInput, "sourceTitle" | "sourceAuthor" | "sourcePublishedAt" | "canonicalUrl">, publishedAt: string, generationId: string, generationHash: string, media: readonly PublicMedia[] = []): PublicV2 {
  if (bundle.state !== "reviewable" || media.length > 4) throw new BilingualContractError("PUBLICATION_FENCE", "public payload requires a current reviewable bundle");
  assertTimestamp(publishedAt, "publishedAt"); assertHash(generationHash, "generationHash");
  if (typeof generationId !== "string" || generationId.trim().length === 0 || generationId.length > 256 || typeof source.canonicalUrl !== "string" || !/^https:\/\//u.test(source.canonicalUrl)) throw new BilingualContractError("OUTPUT_INVALID", "public identity or source URL invalid");
  assertSafeString(source.canonicalUrl, "public source URL");
  if (source.sourcePublishedAt !== null) assertTimestamp(source.sourcePublishedAt, "public source publishedAt");
  const mapMedia = media.map((item) => {
    if (typeof item.url !== "string" || typeof item.alt !== "string" || typeof item.rightsPolicyId !== "string" || !/^https:\/\//u.test(item.url) || item.rightsPolicyId.trim().length === 0 || item.alt.trim().length === 0 || item.alt.length > 300 || !Number.isSafeInteger(item.width) || item.width < 1 || item.width > 8192 || !Number.isSafeInteger(item.height) || item.height < 1 || item.height > 8192) throw new BilingualContractError("MEDIA_RIGHTS_BLOCKED");
    assertSafeString(item.url, "media URL");
    assertSafeString(item.alt, "media alt");
    assertSafeString(item.rightsPolicyId, "media rightsPolicyId");
    assertHash(item.mediaHash, "mediaHash");
    return Object.freeze({ kind: "image" as const, ...item });
  });
  const localized = (draft: LocalizedDraft): PublicLocalized => Object.freeze({ title: ensureText(draft.title, "public title", 200), summary: ensureText(draft.summary, "public summary", 600), lead: ensureText(draft.lead, "public lead", 600), body: ensureText(draft.body.join("\n"), "public body", 12000), keyPoints: draft.keyPoints, contentHash: draft.contentHash });
  const payload: PublicV2 = Object.freeze({ schemaVersion: BILINGUAL_PUBLIC_SCHEMA, publicId: bundle.publicId, category: "race_news", defaultLanguage: "zh-CN", availableLanguages: ["zh-CN", "en"] as const, localized: { "zh-CN": localized(bundle.zh), en: localized(bundle.en) }, source: { name: ensureText(source.sourceTitle, "public source name", 200), author: source.sourceAuthor === null ? null : ensureText(source.sourceAuthor, "public source author", 200), publishedAt: source.sourcePublishedAt, canonicalUrl: source.canonicalUrl }, publishedAt, updatedAt: publishedAt, media: mapMedia, generationId, generationHash });
  inspectKeys(payload);
  return payload;
}

export type ActivePointer = Readonly<{ publicId: string; projectionId: string; generation: number; schemaVersion: typeof BILINGUAL_PUBLIC_SCHEMA; releaseSha256: string; manifestSha256: string; projectionHash: string; pointerVersion: number; operationId: string; status: "active" | "withdrawn"; updatedAt: string }>;

export type ActivePointerExpectation = Readonly<{ publicId: string; pointerVersion: number; generation: number; schemaVersion: typeof BILINGUAL_PUBLIC_SCHEMA; releaseSha256: string; manifestSha256: string; projectionHash: string | null }>;
export function compareAndSwapActivePointer(current: ActivePointer | null, next: ActivePointer, expected: ActivePointerExpectation): ActivePointer {
  assertTimestamp(next.updatedAt, "activePointer.updatedAt");
  if (next.publicId !== expected.publicId || current?.publicId !== undefined && current.publicId !== expected.publicId) throw new BilingualContractError("CAS_CONFLICT", "active pointer publicId changed");
  if (!current && (expected.pointerVersion !== 0 || expected.generation !== 0 || expected.projectionHash !== null)) throw new BilingualContractError("CAS_CONFLICT", "initial active pointer expectation is invalid");
  if (!current && (next.releaseSha256 !== expected.releaseSha256 || next.manifestSha256 !== expected.manifestSha256 || next.schemaVersion !== expected.schemaVersion)) throw new BilingualContractError("CAS_CONFLICT", "initial active pointer release expectation is invalid");
  if (current && (current.pointerVersion !== expected.pointerVersion || current.generation !== expected.generation || current.schemaVersion !== expected.schemaVersion || current.releaseSha256 !== expected.releaseSha256 || current.manifestSha256 !== expected.manifestSha256 || current.projectionHash !== expected.projectionHash)) throw new BilingualContractError("CAS_CONFLICT", "active pointer compare-and-swap failed");
  if (next.pointerVersion !== expected.pointerVersion + 1 || next.generation < 1 || !next.projectionId || !next.operationId || next.schemaVersion !== BILINGUAL_PUBLIC_SCHEMA) throw new BilingualContractError("CAS_CONFLICT", "active pointer version is invalid");
  if (current && (next.generation <= current.generation || next.releaseSha256 !== current.releaseSha256 || next.manifestSha256 !== current.manifestSha256 || next.projectionHash === current.projectionHash || next.operationId === current.operationId || next.updatedAt <= current.updatedAt)) throw new BilingualContractError("CAS_CONFLICT", "active pointer successor is invalid");
  assertHash(next.releaseSha256, "releaseSha256");
  assertHash(next.manifestSha256, "manifestSha256");
  assertHash(next.projectionHash, "projectionHash");
  return Object.freeze(next);
}

export type Delivery = Readonly<{ deliveryId: string; publicationId: string; projectionId: string; generation: number; generationHash: string; idempotencyKey: string; reconcileKey: string; state: DeliveryState; version: number; attemptCount: number; maxAttempts: number; leaseToken: string | null; leaseExpiresAt: string | null; reconcileConsumedAt: string | null; lastReasonCode: string | null; operationId: string; createdAt: string; updatedAt: string }>;

export function createDelivery(publicationId: string, projectionId: string, generation: number, generationHash: string, operationId: string, now: string, maxAttempts = 3): Delivery {
  assertHash(generationHash, "generationHash");
  assertTimestamp(now, "now");
  if (!publicationId || !projectionId || !operationId || !Number.isSafeInteger(generation) || generation < 1 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new BilingualContractError("OUTPUT_INVALID", "delivery limits invalid");
  const key = sha256(`${publicationId}\n${projectionId}\n${generation}\n${generationHash}`);
  return Object.freeze({ deliveryId: `delivery-${key.slice(0, 48)}`, publicationId, projectionId, generation, generationHash, idempotencyKey: `bilingual-delivery-${key.slice(0, 40)}`, reconcileKey: `bilingual-reconcile-${key.slice(0, 40)}`, state: "pending", version: 1, attemptCount: 0, maxAttempts, leaseToken: null, leaseExpiresAt: null, reconcileConsumedAt: null, lastReasonCode: null, operationId, createdAt: now, updatedAt: now });
}

export type DeliveryTransition = Readonly<{ state: DeliveryState; operationId: string; now: string; leaseToken?: string; leaseExpiresAt?: string; reasonCode?: string; reconcileConsumed?: true }>;

export function transitionDelivery(delivery: Delivery, input: DeliveryTransition): Delivery {
  assertTimestamp(input.now, "now");
  if (!input.operationId.trim()) throw new BilingualContractError("OUTPUT_INVALID", "delivery operation identity is required");
  if (input.now <= delivery.updatedAt) throw new BilingualContractError("CAS_CONFLICT", "delivery timestamp did not advance");
  const fail = (message: string): never => { throw new BilingualContractError("OUTPUT_INVALID", message); };
  let attemptCount = delivery.attemptCount;
  let leaseToken: string | null = null;
  let leaseExpiresAt: string | null = null;
  let reconcileConsumedAt = delivery.reconcileConsumedAt;
  let lastReasonCode = input.reasonCode ?? null;
  if (delivery.state === "pending" && input.state === "leased") {
    if (delivery.attemptCount >= delivery.maxAttempts) fail("delivery attempt limit reached");
    const requestedLeaseToken = input.leaseToken;
    const requestedLeaseExpiresAt = input.leaseExpiresAt;
    if (typeof requestedLeaseToken !== "string" || requestedLeaseToken.length !== 43 || typeof requestedLeaseExpiresAt !== "string") fail("lease identity is invalid");
    const validLeaseToken = requestedLeaseToken as string;
    const validLeaseExpiresAt = requestedLeaseExpiresAt as string;
    assertTimestamp(validLeaseExpiresAt, "leaseExpiresAt");
    if (validLeaseExpiresAt <= input.now || lastReasonCode !== null) fail("lease expiry is invalid");
    attemptCount += 1; leaseToken = validLeaseToken; leaseExpiresAt = validLeaseExpiresAt;
  } else if (delivery.state === "leased" && ["succeeded", "reconcile_required", "failed"].includes(input.state)) {
    if (input.state === "succeeded" ? lastReasonCode !== null : lastReasonCode === null) fail("delivery result reason is invalid");
  } else if (delivery.state === "leased" && input.state === "pending") {
    if (!delivery.leaseExpiresAt || input.now < delivery.leaseExpiresAt || !lastReasonCode || input.operationId === delivery.operationId) fail("only an expired lease may be retried by a fresh operation");
  } else if (delivery.state === "reconcile_required" && ["succeeded", "failed", "cancelled"].includes(input.state)) {
    if (!input.reconcileConsumed || delivery.reconcileConsumedAt !== null || input.operationId === delivery.operationId) fail("reconcile resolution requires a fresh one-shot operation");
    if (input.state === "succeeded" ? lastReasonCode !== null : lastReasonCode === null) fail("reconcile result reason is invalid");
    reconcileConsumedAt = input.now;
  } else if (delivery.state === "failed" && input.state === "pending") {
    if (delivery.attemptCount >= delivery.maxAttempts || delivery.reconcileConsumedAt !== null || input.operationId === delivery.operationId || lastReasonCode !== null) fail("failed delivery retry is invalid");
  } else if (delivery.state === "pending" && input.state === "cancelled") {
    if (!lastReasonCode) fail("cancellation reason is required");
  } else fail(`illegal delivery edge ${delivery.state}->${input.state}`);
  return Object.freeze({ ...delivery, state: input.state, version: delivery.version + 1, attemptCount, leaseToken, leaseExpiresAt, reconcileConsumedAt, lastReasonCode, operationId: input.operationId, updatedAt: input.now });
}

export type BilingualRoutePlan = Readonly<{
  routeRef: string;
  providerId: string;
  modelId: string;
  routeIdentitySha256: string;
  releaseSha256: string;
  manifestSha256: string;
}>;

export type BilingualBudgetPlan = Readonly<{
  accountId: string;
  reservationId: string;
  units: number;
  currency: string;
}>;

export type BilingualExternalPlan = Readonly<{
  method: "POST";
  endpointClass: "model_refine";
  providerResource: string;
  externalIdempotencyKey: string;
  reconcileKey: string;
  headers: readonly Readonly<{ name: string; valueSha256: string }>[];
  query: readonly Readonly<{ name: string; value: string }>[];
  bodySha256: string;
}>;

/** Pure, secret-free description of one future model call. */
export type BilingualLanguageAttemptPlan = Readonly<{
  operationId: string;
  parentOperationId: string;
  idempotencyKey: string;
  candidateId: string;
  language: BilingualLanguage;
  attemptNumber: number;
  route: BilingualRoutePlan;
  budget: BilingualBudgetPlan;
  external: BilingualExternalPlan;
}>;

/** Opaque admission returned only after the durable attempt intent exists. */
export type BilingualAttemptAdmission = Readonly<{
  operationId: string;
  parentOperationId: string;
  attemptId: string;
  attemptNumber: number;
  language: BilingualLanguage;
  canonicalRequestSha256: string;
  requestFingerprintSha256: string;
  fenceSetHash: string;
  routeBindingHash: string;
  budgetBindingHash: string;
}>;

export type BilingualWriteClosed = Readonly<{ ok: false; status: "closed"; reasonCode: "AUTHORITY_EXTENSION_REQUIRED"; externalCalls: 0; writesToBase: false }>;
export type BilingualAttemptRunResult =
  | Readonly<{ ok: true; status: "complete"; externalCalls: 1; writesToBase: true; draft: LocalizedDraft; routeReceiptHash: string; budgetReceiptHash: string; attemptId: string }>
  | Readonly<{ ok: false; status: "failed" | "reconcile_required"; reasonCode: BilingualProblemCode; externalCalls: 1; writesToBase: boolean; attemptId: string }>
  | BilingualWriteClosed;

export type BilingualMutationPort = Readonly<{
  beginRefinement: (input: Readonly<{
    pair: RefinementOperationPair;
    lineage: BilingualLineage;
    promptSchemaVersion: typeof BILINGUAL_PROMPT_SCHEMA;
    promptSha256: string;
    plans: readonly [BilingualLanguageAttemptPlan, BilingualLanguageAttemptPlan];
  }>) => Promise<Readonly<{
    ok: true;
    externalModelAllowed: true;
    children: Readonly<Record<BilingualLanguage, BilingualAttemptAdmission>>;
  }> | BilingualWriteClosed>;
  runLanguageAttempt: (
    admission: BilingualAttemptAdmission,
    execute: () => Promise<Readonly<{
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
    }>>,
  ) => Promise<BilingualAttemptRunResult>;
}>;

export const CLOSED_BILINGUAL_WRITE: BilingualWriteClosed = Object.freeze({ ok: false, status: "closed", reasonCode: "AUTHORITY_EXTENSION_REQUIRED", externalCalls: 0, writesToBase: false });

export const CLOSED_BILINGUAL_MUTATION_PORT: BilingualMutationPort = Object.freeze({
  async beginRefinement(): Promise<BilingualWriteClosed> { return CLOSED_BILINGUAL_WRITE; },
  async runLanguageAttempt(): Promise<BilingualWriteClosed> { return CLOSED_BILINGUAL_WRITE; }
});
