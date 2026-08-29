import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const SOURCE_REGISTRY_SCHEMA = "source-registry-v1" as const;
export const SOURCE_REGISTRY_AUTHORITY_SCHEMA = "quick-launch-authority-v2" as const;
export const X_AUTOMATION_ZERO = Object.freeze({ poll: 0, search: 0, rules: 0, rssHub: 0, cookie: 0, oEmbed: 0, automaticBackfill: 0, externalCalls: 0 } as const);

export type LifecycleStatus = "proposed" | "active" | "paused" | "retired";
export type CollectionOnboardingStatus =
  | "validating" | "activation_pending" | "queued" | "collecting" | "active"
  | "normalization_failed" | "dedup_needs_review" | "linked_existing"
  | "blocked_adapter_missing" | "blocked_authorization" | "blocked_platform"
  | "queue_failed" | "collection_failed" | "stopped" | "cancelled" | "dead_letter";
export type NormalizationStatus = "pending" | "valid" | "invalid";
export type DedupStatus = "pending" | "unique" | "needs_review" | "linked_existing";
export type IdentityStatus = "unknown" | "verified" | "needs_review";
export type RelevanceStatus = "unknown" | "qualified" | "rejected";
export type Monitorability = "unknown" | "monitorable" | "restricted" | "unavailable";
export type AdapterStatus = "unchecked" | "ready" | "missing" | "unavailable";
export type AdapterAuthorizationStatus = "unknown" | "valid" | "invalid" | "expired";
export type PlatformAllowed = "unknown" | "allowed" | "blocked";
export type SourceStopStatus = "clear" | "manual" | "compliance" | "authorization" | "platform";
export type SourceKind = "rss" | "x_manual";
export type CollectionMode = "rss" | "manual_url";
export type SourceAction = "propose" | "validate" | "requeue" | "enable" | "disable" | "retire";
export type AuthorityCapability = "bilingual_auto_refine" | "bilingual_manual_mutation" | "source_registry_management";

export type SourceRegistryProblemCode =
  | "AUTHORITY_EXTENSION_REQUIRED"
  | "CAS_CONFLICT"
  | "IDENTITY_INVALID"
  | "IDENTITY_IMMUTABLE"
  | "STATE_TRANSITION_INVALID"
  | "ACTIVATION_BLOCKED"
  | "EPOCH_FENCE_NOT_CLEAR"
  | "X_AUTOMATION_DISABLED"
  | "SOURCE_NOT_FOUND"
  | "QUERY_INVALID"
  | "OUTBOX_TRANSITION_INVALID";

export class SourceRegistryError extends Error {
  readonly code: SourceRegistryProblemCode;

  constructor(code: SourceRegistryProblemCode, message: string = code) {
    super(message);
    this.name = "SourceRegistryError";
    this.code = code;
  }
}

export type SourceRecord = Readonly<{
  sourceId: string;
  revision: number;
  displayName: string;
  canonicalFeedUrl: string | null;
  canonicalUrlValid: boolean;
  siteUrl: string;
  sourceKind: SourceKind;
  collectionMode: CollectionMode;
  enabled: boolean;
  lifecycleStatus: LifecycleStatus;
  collectionOnboardingStatus: CollectionOnboardingStatus;
  normalizationStatus: NormalizationStatus;
  dedupStatus: DedupStatus;
  identityStatus: IdentityStatus;
  relevanceStatus: RelevanceStatus;
  monitorability: Monitorability;
  adapterStatus: AdapterStatus;
  adapterAuthorizationStatus: AdapterAuthorizationStatus;
  authorizationExpiresAt: string | null;
  platformAllowed: PlatformAllowed;
  sourceStopStatus: SourceStopStatus;
  epochs: EpochSet;
  identitySha256: string;
  currentOperationId: string | null;
  currentRequestHash: string;
  createdAt: string;
  updatedAt: string;
}>;

export type EpochSet = Readonly<{
  sourceConfig: number;
  sourceSafety: number;
  authorization: number;
  policy: number;
  recovery: number;
}>;

export type GuardDatum = Readonly<{
  state: "clear" | "blocked" | "unknown";
  reasonCode: string;
}>;

export type EpochFenceDatum = Readonly<{
  name: keyof EpochSet;
  expected: number | null;
  actual: number | null;
  writerEpoch: number | null;
  truthReceiptSha256: string | null;
  state: "clear" | "stale" | "unknown";
}>;

export type ActivationReadiness = Readonly<{
  statusGuard: GuardDatum;
  platformGuard: GuardDatum;
  authorizationGuard: GuardDatum;
  adapterGuard: GuardDatum;
  stopGuard: GuardDatum;
}>;

export type ClosedSourceMutation = Readonly<{
  status: "closed";
  reasonCode: "AUTHORITY_EXTENSION_REQUIRED";
  action: SourceAction;
  writesToDatabase: false;
  externalCalls: 0;
}>;

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new SourceRegistryError("IDENTITY_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new SourceRegistryError("IDENTITY_INVALID");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function assertTimestamp(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    throw new SourceRegistryError("IDENTITY_INVALID", `${label} invalid`);
  }
}

function assertId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(value)) throw new SourceRegistryError("IDENTITY_INVALID", `${label} invalid`);
}

function safeHttpsUrl(value: string, kind: SourceKind): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new SourceRegistryError("IDENTITY_INVALID", "URL invalid"); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "" || (parsed.port !== "" && parsed.port !== "443")) throw new SourceRegistryError("IDENTITY_INVALID", "URL unsafe");
  for (const key of parsed.searchParams.keys()) {
    if (/token|secret|key|auth|password|signature|cookie/iu.test(key)) throw new SourceRegistryError("IDENTITY_INVALID", "secret-bearing URL forbidden");
  }
  if (kind === "x_manual" && (!/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/u.test(parsed.href) || parsed.search !== "")) throw new SourceRegistryError("IDENTITY_INVALID", "X source URL invalid");
  return parsed.href;
}

export function sourceIdentity(input: Readonly<{ sourceId: string; canonicalFeedUrl: string | null; siteUrl: string; sourceKind: SourceKind; collectionMode: CollectionMode }>): string {
  assertId(input.sourceId, "sourceId");
  if ((input.sourceKind === "rss") !== (input.collectionMode === "rss") || (input.sourceKind === "rss") !== (input.canonicalFeedUrl !== null)) throw new SourceRegistryError("IDENTITY_INVALID");
  const siteUrl = safeHttpsUrl(input.siteUrl, input.sourceKind);
  const canonicalFeedUrl = input.canonicalFeedUrl === null ? null : safeHttpsUrl(input.canonicalFeedUrl, input.sourceKind);
  return sha256(canonicalJson({ sourceId: input.sourceId, canonicalFeedUrl, siteUrl, sourceKind: input.sourceKind, collectionMode: input.collectionMode }));
}

function clear(reasonCode: string): GuardDatum { return Object.freeze({ state: "clear", reasonCode }); }
function blocked(reasonCode: string): GuardDatum { return Object.freeze({ state: "blocked", reasonCode }); }
function unknown(reasonCode = "INPUT_UNKNOWN"): GuardDatum { return Object.freeze({ state: "unknown", reasonCode }); }

export function deriveActivationReadiness(source: SourceRecord, asOf: string): ActivationReadiness {
  assertTimestamp(asOf, "asOf");
  let statusGuard: GuardDatum;
  if (!source.canonicalUrlValid) statusGuard = blocked("CANONICAL_INVALID");
  else if (source.normalizationStatus === "invalid") statusGuard = blocked("NORMALIZATION_NOT_VALID");
  else if (source.normalizationStatus === "pending") statusGuard = unknown();
  else if (source.dedupStatus === "needs_review") statusGuard = blocked("DEDUP_NOT_UNIQUE");
  else if (source.dedupStatus === "linked_existing") statusGuard = blocked("DEDUP_NOT_UNIQUE");
  else if (source.dedupStatus === "pending") statusGuard = unknown();
  else if (source.identityStatus === "needs_review") statusGuard = blocked("IDENTITY_NEEDS_REVIEW");
  else if (source.relevanceStatus === "rejected") statusGuard = blocked("RELEVANCE_REJECTED");
  else if (source.monitorability === "restricted") statusGuard = blocked("MONITORABILITY_RESTRICTED");
  else if (source.monitorability === "unavailable") statusGuard = blocked("MONITORABILITY_UNAVAILABLE");
  else statusGuard = clear("READY");

  const platformGuard = source.platformAllowed === "allowed" ? clear("READY") : source.platformAllowed === "blocked" ? blocked("PLATFORM_BLOCKED") : unknown();
  let authorizationGuard: GuardDatum;
  if (source.adapterAuthorizationStatus === "invalid") authorizationGuard = blocked("AUTHORIZATION_INVALID");
  else if (source.adapterAuthorizationStatus === "expired") authorizationGuard = blocked("AUTHORIZATION_EXPIRED");
  else if (source.adapterAuthorizationStatus !== "valid" || source.authorizationExpiresAt === null) authorizationGuard = unknown();
  else {
    assertTimestamp(source.authorizationExpiresAt, "authorizationExpiresAt");
    authorizationGuard = Date.parse(source.authorizationExpiresAt) > Date.parse(asOf) ? clear("READY") : blocked("AUTHORIZATION_EXPIRED");
  }
  const adapterGuard = source.adapterStatus === "ready" ? clear("READY") : source.adapterStatus === "unchecked" ? unknown() : blocked(source.adapterStatus === "missing" ? "ADAPTER_MISSING" : "ADAPTER_UNAVAILABLE");
  const stopGuard = source.sourceStopStatus === "clear" ? clear("READY") : blocked("STOP_SET");
  return Object.freeze({ statusGuard, platformGuard, authorizationGuard, adapterGuard, stopGuard });
}

const verifiedFenceSets = new WeakSet<object>();

export function deriveEpochFences(database: DatabaseSync, sourceId: string, operationId: string | null, asOf: string): readonly EpochFenceDatum[] {
  assertId(sourceId, "sourceId");
  if (operationId !== null) assertId(operationId, "operationId");
  assertTimestamp(asOf, "asOf");
  const control = operationId === null ? undefined : database.prepare(`SELECT s.source_config_epoch,s.source_safety_epoch,
    c.authorization_version,c.policy_epoch,c.recovery_epoch,c.writer_epoch,
    op.source_config_epoch AS expected_source_config,op.source_safety_epoch AS expected_source_safety,
    op.authorization_version AS expected_authorization,op.policy_epoch AS expected_policy,op.recovery_epoch AS expected_recovery
    FROM source_registry_v1 s CROSS JOIN internal_control c
    JOIN internal_operation op ON op.operation_id=? AND op.source_id=s.source_id AND op.state='authorized'
    WHERE s.source_id=? AND c.singleton_id=1 AND unixepoch(op.updated_at)<=unixepoch(?)`).get(operationId, sourceId, asOf) as Record<string, unknown> | undefined;
  const writerEpoch = control === undefined ? null : Number(control.writer_epoch);
  const expected: EpochSet | null = control === undefined ? null : { sourceConfig: Number(control.expected_source_config), sourceSafety: Number(control.expected_source_safety), authorization: Number(control.expected_authorization), policy: Number(control.expected_policy), recovery: Number(control.expected_recovery) };
  const actual: Partial<EpochSet> | null = control === undefined ? null : {
    sourceConfig: Number(control.source_config_epoch), sourceSafety: Number(control.source_safety_epoch),
    authorization: Number(control.authorization_version), policy: Number(control.policy_epoch), recovery: Number(control.recovery_epoch)
  };
  const names: Array<keyof EpochSet> = ["sourceConfig", "sourceSafety", "authorization", "policy", "recovery"];
  const result = Object.freeze(names.map((name) => {
    const actualValue = actual?.[name];
    const expectedValue = expected?.[name];
    // Schema 0010 intentionally has no integrated, schema/current-writer-bound
    // five-receipt verifier. Expose measured values for diagnosis while every
    // fence stays unknown until a later gateway migration supplies that truth.
    return Object.freeze({ name, expected: expectedValue ?? null, actual: actualValue ?? null, writerEpoch, truthReceiptSha256: null, state: "unknown" as const });
  }));
  verifiedFenceSets.add(result);
  return result;
}

export function assertOnboardingTransition(from: CollectionOnboardingStatus, to: CollectionOnboardingStatus): void {
  const edges: Readonly<Record<CollectionOnboardingStatus, readonly CollectionOnboardingStatus[]>> = {
    validating: ["normalization_failed", "dedup_needs_review", "linked_existing", "activation_pending"],
    activation_pending: ["blocked_platform", "blocked_authorization", "blocked_adapter_missing", "queued"],
    blocked_platform: ["activation_pending"], blocked_authorization: ["activation_pending"], blocked_adapter_missing: ["activation_pending"],
    normalization_failed: ["validating"], dedup_needs_review: ["validating"], linked_existing: [],
    queued: ["collecting", "stopped", "cancelled", "queue_failed"],
    queue_failed: ["activation_pending", "dead_letter"], collecting: ["active", "collection_failed", "stopped", "cancelled"],
    collection_failed: ["collecting", "dead_letter"], active: ["stopped", "cancelled"],
    stopped: ["activation_pending"], cancelled: ["activation_pending"], dead_letter: ["activation_pending"]
  };
  if (!edges[from].includes(to)) throw new SourceRegistryError("STATE_TRANSITION_INVALID", `${from}->${to}`);
}

function closed(action: SourceAction): ClosedSourceMutation {
  return Object.freeze({ status: "closed", reasonCode: "AUTHORITY_EXTENSION_REQUIRED", action, writesToDatabase: false, externalCalls: 0 });
}

// The schema contains a future Admin-gateway substrate, but this slice has no
// authorizer integration. Exported runtime mutation entrypoints therefore stay
// permanently closed; callers cannot mint a trusted authority object in JS.
export function planProposeSource(): ClosedSourceMutation { return closed("propose"); }
export function planValidateSource(): ClosedSourceMutation { return closed("validate"); }
export function planRequeueSource(): ClosedSourceMutation { return closed("requeue"); }
export function planEnableSource(): ClosedSourceMutation { return closed("enable"); }
export function planDisableSource(): ClosedSourceMutation { return closed("disable"); }
export function planRetireSource(): ClosedSourceMutation { return closed("retire"); }

export function assertIdentityImmutable(before: SourceRecord, after: SourceRecord): void {
  const fields = ["sourceId", "displayName", "canonicalFeedUrl", "siteUrl", "sourceKind", "collectionMode", "identitySha256", "createdAt"] as const;
  if (fields.some((field) => before[field] !== after[field])) throw new SourceRegistryError("IDENTITY_IMMUTABLE");
  if (sourceIdentity(before) !== before.identitySha256 || sourceIdentity(after) !== after.identitySha256) throw new SourceRegistryError("IDENTITY_IMMUTABLE");
}

export function canAutoCollect(source: SourceRecord, readiness: ActivationReadiness, epochFences: readonly EpochFenceDatum[]): boolean {
  if (!verifiedFenceSets.has(epochFences as object)) return false;
  if (source.sourceKind !== "rss" || source.collectionMode !== "rss" || !source.enabled || source.lifecycleStatus !== "active") return false;
  if (!["queued", "collecting", "active"].includes(source.collectionOnboardingStatus)) return false;
  return Object.values(readiness).every((guard) => guard.state === "clear") && epochFences.every((fence) => fence.state === "clear");
}

export type SourceListItem = Readonly<{
  sourceId: string; revision: number; displayName: string; siteUrl: string; sourceKind: SourceKind; collectionMode: CollectionMode;
  enabled: boolean; lifecycleStatus: LifecycleStatus; collectionOnboardingStatus: CollectionOnboardingStatus;
  identityStatus: IdentityStatus; relevanceStatus: RelevanceStatus; monitorability: Monitorability; updatedAt: string;
}>;

function rowSource(row: Record<string, unknown>): SourceRecord {
  return Object.freeze({ sourceId: String(row.source_id), revision: Number(row.revision), displayName: String(row.display_name), canonicalFeedUrl: row.canonical_feed_url === null ? null : String(row.canonical_feed_url), canonicalUrlValid: Number(row.canonical_url_valid) === 1, siteUrl: String(row.site_url), sourceKind: String(row.source_kind) as SourceKind, collectionMode: String(row.collection_mode) as CollectionMode, enabled: Number(row.enabled) === 1, lifecycleStatus: String(row.lifecycle_status) as LifecycleStatus, collectionOnboardingStatus: String(row.collection_onboarding_status) as CollectionOnboardingStatus, normalizationStatus: String(row.normalization_status) as NormalizationStatus, dedupStatus: String(row.dedup_status) as DedupStatus, identityStatus: String(row.identity_status) as IdentityStatus, relevanceStatus: String(row.relevance_status) as RelevanceStatus, monitorability: String(row.monitorability) as Monitorability, adapterStatus: String(row.adapter_status) as AdapterStatus, adapterAuthorizationStatus: String(row.adapter_authorization_status) as AdapterAuthorizationStatus, authorizationExpiresAt: row.authorization_expires_at === null ? null : String(row.authorization_expires_at), platformAllowed: String(row.platform_allowed) as PlatformAllowed, sourceStopStatus: String(row.source_stop_status) as SourceStopStatus, epochs: Object.freeze({ sourceConfig: Number(row.source_config_epoch), sourceSafety: Number(row.source_safety_epoch), authorization: Number(row.authorization_version), policy: Number(row.policy_epoch), recovery: Number(row.recovery_epoch) }), identitySha256: String(row.identity_sha256), currentOperationId: row.current_operation_id === null ? null : String(row.current_operation_id), currentRequestHash: String(row.current_request_hash), createdAt: String(row.created_at), updatedAt: String(row.updated_at) });
}

export function readSourceList(database: DatabaseSync, input: Readonly<{
  limit?: number; sort?: "displayName:asc" | "updatedAt:desc";
  lifecycleStatus?: LifecycleStatus; collectionOnboardingStatus?: CollectionOnboardingStatus;
  identityStatus?: IdentityStatus; relevanceStatus?: RelevanceStatus; monitorability?: Monitorability;
  sourceKind?: SourceKind; enabled?: boolean;
}> = {}): readonly SourceListItem[] {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new SourceRegistryError("QUERY_INVALID");
  const sort = input.sort ?? "displayName:asc";
  if (sort !== "displayName:asc" && sort !== "updatedAt:desc") throw new SourceRegistryError("QUERY_INVALID");
  const orderBy = sort === "displayName:asc" ? "display_name ASC,source_id ASC" : "updated_at DESC,source_id ASC";
  const values = [input.lifecycleStatus ?? null, input.lifecycleStatus ?? null,
    input.collectionOnboardingStatus ?? null, input.collectionOnboardingStatus ?? null, input.identityStatus ?? null, input.identityStatus ?? null,
    input.relevanceStatus ?? null, input.relevanceStatus ?? null, input.monitorability ?? null, input.monitorability ?? null,
    input.sourceKind ?? null, input.sourceKind ?? null, input.enabled === undefined ? null : input.enabled ? 1 : 0,
    input.enabled === undefined ? null : input.enabled ? 1 : 0, limit];
  const rows = database.prepare(`SELECT * FROM source_registry_v1 WHERE (? IS NULL OR lifecycle_status=?) AND (? IS NULL OR collection_onboarding_status=?)
    AND (? IS NULL OR identity_status=?) AND (? IS NULL OR relevance_status=?) AND (? IS NULL OR monitorability=?)
    AND (? IS NULL OR source_kind=?) AND (? IS NULL OR enabled=?) ORDER BY ${orderBy} LIMIT ?`).all(...values) as Array<Record<string, unknown>>;
  return Object.freeze(rows.map((row) => {
    const source = rowSource(row);
    return Object.freeze({ sourceId: source.sourceId, revision: source.revision, displayName: source.displayName, siteUrl: source.siteUrl, sourceKind: source.sourceKind, collectionMode: source.collectionMode, enabled: source.enabled, lifecycleStatus: source.lifecycleStatus, collectionOnboardingStatus: source.collectionOnboardingStatus, identityStatus: source.identityStatus, relevanceStatus: source.relevanceStatus, monitorability: source.monitorability, updatedAt: source.updatedAt });
  }));
}

export type SourceDetail = Readonly<{
  source: SourceRecord;
  config: Readonly<Record<string, unknown>> | null;
  health: Readonly<Record<string, unknown>> | null;
  history: readonly Readonly<Record<string, unknown>>[];
  activationReadiness: ActivationReadiness;
  epochFences: readonly EpochFenceDatum[];
  xAutomation: typeof X_AUTOMATION_ZERO | null;
}>;

function plain(row: Record<string, unknown> | undefined): Readonly<Record<string, unknown>> | null {
  return row === undefined ? null : Object.freeze(Object.fromEntries(Object.entries(row)));
}

export function readSourceDetail(database: DatabaseSync, sourceId: string, asOf: string): SourceDetail {
  assertId(sourceId, "sourceId"); assertTimestamp(asOf, "asOf");
  const row = database.prepare("SELECT * FROM source_registry_v1 WHERE source_id=?").get(sourceId) as Record<string, unknown> | undefined;
  if (!row) throw new SourceRegistryError("SOURCE_NOT_FOUND");
  const source = rowSource(row);
  const config = plain(database.prepare("SELECT * FROM source_registry_rss_config_v1 WHERE source_id=?").get(sourceId) as Record<string, unknown> | undefined);
  const health = plain(database.prepare("SELECT * FROM source_registry_health_v1 WHERE source_id=? ORDER BY observed_at DESC,health_id DESC LIMIT 1").get(sourceId) as Record<string, unknown> | undefined);
  const history = Object.freeze((database.prepare("SELECT * FROM source_registry_history_v1 WHERE source_id=? ORDER BY to_revision DESC,history_id DESC LIMIT 50").all(sourceId) as Array<Record<string, unknown>>).map((entry) => Object.freeze(Object.fromEntries(Object.entries(entry)))));
  return Object.freeze({ source, config, health, history, activationReadiness: deriveActivationReadiness(source, asOf), epochFences: deriveEpochFences(database, source.sourceId, null, asOf), xAutomation: source.sourceKind === "x_manual" ? X_AUTOMATION_ZERO : null });
}

export type SourceOutbox = Readonly<{ outboxId: string; sourceId: string; operationId: string; sourceRevision: number; state: "pending" | "leased" | "succeeded" | "failed" | "cancelled"; leaseToken: string | null; leaseExpiresAt: string | null; attemptCount: number; payloadSha256: string; createdAt: string; updatedAt: string }>;

export function transitionSourceOutbox(current: SourceOutbox, input: Readonly<{ state: SourceOutbox["state"]; operationId: string; now: string; leaseToken?: string; leaseExpiresAt?: string }>): SourceOutbox {
  assertTimestamp(input.now, "now");
  assertId(input.operationId, "operationId");
  if (Date.parse(input.now) <= Date.parse(current.updatedAt)) throw new SourceRegistryError("OUTBOX_TRANSITION_INVALID");
  const edges: Readonly<Record<SourceOutbox["state"], readonly SourceOutbox["state"][]>> = { pending: ["leased", "cancelled"], leased: ["succeeded", "failed", "pending"], succeeded: [], failed: ["pending"], cancelled: [] };
  if (!edges[current.state].includes(input.state)) throw new SourceRegistryError("OUTBOX_TRANSITION_INVALID");
  if (input.state === "leased") {
    if (current.state !== "pending" || input.operationId === current.operationId || current.attemptCount >= 3 || input.leaseToken === undefined || input.leaseExpiresAt === undefined) throw new SourceRegistryError("OUTBOX_TRANSITION_INVALID");
    if (new TextEncoder().encode(input.leaseToken).byteLength !== 43) throw new SourceRegistryError("OUTBOX_TRANSITION_INVALID");
    assertTimestamp(input.leaseExpiresAt, "leaseExpiresAt");
    if (Date.parse(input.leaseExpiresAt) <= Date.parse(input.now)) throw new SourceRegistryError("OUTBOX_TRANSITION_INVALID");
    return Object.freeze({ ...current, operationId: input.operationId, state: "leased", leaseToken: input.leaseToken, leaseExpiresAt: input.leaseExpiresAt, attemptCount: current.attemptCount + 1, updatedAt: input.now });
  }
  if (current.state === "leased" && (input.state === "succeeded" || input.state === "failed")) {
    if (input.operationId !== current.operationId || input.leaseToken !== current.leaseToken || current.leaseExpiresAt === null || Date.parse(input.now) >= Date.parse(current.leaseExpiresAt)) throw new SourceRegistryError("OUTBOX_TRANSITION_INVALID");
    return Object.freeze({ ...current, state: input.state, updatedAt: input.now });
  }
  if (current.state === "leased" && input.state === "pending") {
    if (input.operationId === current.operationId || current.leaseExpiresAt === null || Date.parse(input.now) <= Date.parse(current.leaseExpiresAt)) throw new SourceRegistryError("OUTBOX_TRANSITION_INVALID");
    return Object.freeze({ ...current, operationId: input.operationId, state: "pending", leaseToken: null, leaseExpiresAt: null, updatedAt: input.now });
  }
  if ((current.state === "failed" && input.state === "pending") || (current.state === "pending" && input.state === "cancelled")) {
    if (input.operationId === current.operationId) throw new SourceRegistryError("OUTBOX_TRANSITION_INVALID");
    return Object.freeze({ ...current, operationId: input.operationId, state: input.state, leaseToken: null, leaseExpiresAt: null, updatedAt: input.now });
  }
  throw new SourceRegistryError("OUTBOX_TRANSITION_INVALID");
}
