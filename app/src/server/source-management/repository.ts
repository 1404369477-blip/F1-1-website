import { randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";

import type { AppConfig } from "../config/env.ts";
import { withImmediateTransaction, type SqliteDatabase } from "../db/database.ts";
import { canonicalJson } from "../db/profile.ts";
import {
  SOURCE_PROJECTION_SHA256,
  SOURCE_REQUIRED_FIELDS,
  SOURCE_SCHEMA_SHA256,
  readSourceFixture,
  sourceRowHash,
  validateSourceRow,
  type SourceRow
} from "../providers/source-fixture.ts";
import {
  SEED_LEASE,
  assertBusinessIdentity,
  assertCommandIdentity,
  assertLiveLease,
  canonicalHash,
  generateBusinessIdentity,
  generateLiveLease,
  sha256,
  sourceIdentity,
  type BusinessIdentity,
  type RandomBytes
} from "./identity.ts";
import {
  AdminError,
  type CommandIdentity,
  type RuntimeFences,
  type SourceExpected,
  type SourceOperationReceipt,
  type SourceReadItem,
  type SourceReadMeta
} from "./types.ts";

const COMMAND_SCHEMA = "admin-source-command-v0.3";
const ACTOR = "actor:local-synthetic-admin";
const NORMALIZER = "synthetic-normalizer-v1";
const MIGRATION_BATCH = "SOURCE-MGMT-001-v0.3";
const RETRYABLE_CODES = new Set(["MOCK_TIMEOUT", "MOCK_TRANSIENT"]);

type JsonRecord = Record<string, unknown>;
type Clock = () => Date;
type SourceIdentityResolver = typeof sourceIdentity;

export type AddSourceCommand = CommandIdentity & Readonly<{
  schema_version: typeof COMMAND_SCHEMA;
  platform: "x" | "instagram" | "reddit" | "website" | "rss";
  raw_url: string;
  handle: string;
  entity_type: string;
  content_focus: string;
  priority: "high" | "medium" | "low";
}>;

export type SourceMutationCommand = CommandIdentity & Readonly<{
  schema_version: typeof COMMAND_SCHEMA;
  expected: SourceExpected;
  runtime_fences: RuntimeFences;
  stop_reason?: "manual" | "compliance" | "authorization" | "platform";
}>;

export type SourceListQuery = Readonly<{
  platform?: string;
  lifecycleStatus?: string;
  enabled?: boolean;
  onboardingStatus?: string;
  cursor?: string;
  limit?: 25 | 50 | 100;
}>;

type LocalState = {
  source: SourceRow;
  sourceHash: string;
  sourceVersion: number;
  fullIdentityHash: string;
  fences: RuntimeFences;
};

type AcquiredActivation = Readonly<{
  jobId: string;
  sourceId: string;
  taskId: string;
  businessOperationId: string;
  retryGeneration: number;
  attempt: number;
  leaseToken: string;
  leaseExpiry: string;
  deadline: string;
  envelopeHash: string;
}>;

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminError("ADMIN_BODY_INVALID", 422);
  return value as JsonRecord;
}

function assertExactKeys(record: JsonRecord, keys: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new AdminError("ADMIN_BODY_INVALID", 422);
  }
}

function booleanFromSql(value: unknown): boolean {
  return Number(value) === 1;
}

function sqlSourceToRow(raw: Record<string, unknown>, appRoot: string, projectRoot: string): SourceRow {
  const value = Object.fromEntries(SOURCE_REQUIRED_FIELDS.map((field) => [
    field,
    field === "enabled" || field === "canonical_url_valid" ? booleanFromSql(raw[field]) : raw[field]
  ]));
  return validateSourceRow(value, appRoot, projectRoot);
}

function sqlInput(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  throw new AdminError("ADMIN_INTERNAL_FAILURE", 500);
}

function sourceValues(source: SourceRow): SQLInputValue[] {
  return SOURCE_REQUIRED_FIELDS.map((field) => {
    const value = source[field];
    return typeof value === "boolean" ? Number(value) : sqlInput(value);
  });
}

function operationTypeForPath(path: string): SourceOperationReceipt["operation_type"] {
  if (path === "/api/admin/sources") return "source_add";
  if (path.endsWith("/validate")) return "source_validate";
  if (path.endsWith("/activate")) return "source_activate";
  if (path.endsWith("/stop")) return "source_stop";
  if (path.endsWith("/retire")) return "source_retire";
  if (path.endsWith("/requeue")) return "source_requeue";
  throw new AdminError("ADMIN_ROUTE_NOT_FOUND", 404);
}

function allowedActions(source: SourceRow, origin: SourceReadMeta["origin"]): readonly string[] {
  if (origin === "m3_baseline" || source.lifecycle_status === "retired") return [];
  const state = String(source.collection_onboarding_status);
  const actions: string[] = [];
  if (["validating", "normalization_failed", "dedup_needs_review", "linked_existing", "blocked_adapter_missing", "blocked_authorization", "blocked_platform"].includes(state)) actions.push("validate");
  if (["activation_pending", "queue_failed", "stopped", "cancelled"].includes(state)) actions.push("activate");
  if (["queued", "collecting", "active"].includes(state)) actions.push("stop");
  if ((state === "stopped" || state === "cancelled") && source.lifecycle_status === "active") actions.push("retire");
  if (state === "dead_letter") actions.push("requeue");
  return actions;
}

export class SourceManagementRepository {
  private readonly database: SqliteDatabase;
  private readonly config: AppConfig;
  private readonly appRoot: string;
  private readonly projectRoot: string;
  private readonly clock: Clock;
  private readonly randomBytes: RandomBytes;
  private readonly identityForSource: SourceIdentityResolver;
  private readonly baseline: readonly SourceRow[];
  private readonly baselineById: ReadonlyMap<string, SourceRow>;
  private readonly baselineByCanonicalUrl: ReadonlyMap<string, SourceRow>;

  constructor(
    database: SqliteDatabase,
    config: AppConfig,
    appRoot: string,
    projectRoot: string,
    clock: Clock = () => new Date(),
    randomBytes: RandomBytes = nodeRandomBytes,
    identityForSource: SourceIdentityResolver = sourceIdentity
  ) {
    this.database = database;
    this.config = config;
    this.appRoot = appRoot;
    this.projectRoot = projectRoot;
    this.clock = clock;
    this.randomBytes = randomBytes;
    this.identityForSource = identityForSource;
    const fixture = readSourceFixture(config, appRoot, projectRoot);
    this.baseline = fixture.rows;
    this.baselineById = new Map(this.baseline.map((row) => [String(row.source_id), row]));
    this.baselineByCanonicalUrl = new Map(this.baseline.map((row) => [String(row.canonical_url), row]));
  }

  private timestamp(): string {
    const value = this.clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new AdminError("ADMIN_INTERNAL_FAILURE", 500);
    return value.toISOString();
  }

  private readLocal(sourceId: string): LocalState | null {
    const raw = this.database.prepare("SELECT * FROM source_config_fixture WHERE source_id = ?").get(sourceId) as Record<string, unknown> | undefined;
    if (!raw) return null;
    const source = sqlSourceToRow(raw, this.appRoot, this.projectRoot);
    const lineage = this.database.prepare("SELECT * FROM source_overlay_lineage WHERE source_id = ?").get(sourceId) as Record<string, unknown> | undefined;
    const fence = this.database.prepare("SELECT * FROM source_runtime_fence WHERE source_id = ?").get(sourceId) as Record<string, unknown> | undefined;
    const identity = this.identityForSource(String(source.platform), String(source.raw_url));
    if (
      !lineage || !fence || lineage.effective_source_hash !== sourceRowHash(source) ||
      identity.sourceId !== source.source_id || identity.fullIdentityHash !== lineage.full_identity_hash
    ) {
      throw new AdminError("ADMIN_PROFILE_NOT_READY", 503);
    }
    return {
      source,
      sourceHash: String(lineage.effective_source_hash),
      sourceVersion: Number(lineage.source_version),
      fullIdentityHash: String(lineage.full_identity_hash),
      fences: {
        authorization_version: Number(fence.authorization_version),
        policy_epoch: Number(fence.policy_epoch),
        recovery_epoch: Number(fence.recovery_epoch)
      }
    };
  }

  private meta(source: SourceRow, origin: SourceReadMeta["origin"]): SourceReadMeta {
    if (origin === "m3_baseline") {
      return {
        sourceHash: sourceRowHash(source), sourceVersion: 0, origin, baselineRowHash: sourceRowHash(source),
        lastCollectedAt: null, lastCollectedState: "unknown", allowedActions: [],
        authorizationVersion: null, policyEpoch: null, recoveryEpoch: null
      };
    }
    const state = this.readLocal(String(source.source_id));
    if (!state) throw new AdminError("ADMIN_PROFILE_NOT_READY", 503);
    return {
      sourceHash: state.sourceHash,
      sourceVersion: state.sourceVersion,
      origin,
      baselineRowHash: null,
      lastCollectedAt: null,
      lastCollectedState: "unknown",
      allowedActions: allowedActions(source, origin),
      authorizationVersion: state.fences.authorization_version,
      policyEpoch: state.fences.policy_epoch,
      recoveryEpoch: state.fences.recovery_epoch
    };
  }

  get(sourceId: string): SourceReadItem | null {
    const baseline = this.baselineById.get(sourceId);
    if (baseline) return { source: baseline, meta: this.meta(baseline, "m3_baseline") };
    const local = this.readLocal(sourceId);
    return local ? { source: local.source, meta: this.meta(local.source, "local_synthetic") } : null;
  }

  list(query: SourceListQuery): {
    schema_version: "admin-source-list-v0.2";
    effective_root: string;
    items: SourceReadItem[];
    next_cursor: string | null;
  } {
    const localRows = (this.database.prepare("SELECT * FROM source_config_fixture ORDER BY source_id").all() as Array<Record<string, unknown>>)
      .map((row) => sqlSourceToRow(row, this.appRoot, this.projectRoot));
    const all = [...this.baseline, ...localRows].sort((left, right) => String(left.source_id).localeCompare(String(right.source_id)));
    const effectiveRoot = canonicalHash({ fields: SOURCE_REQUIRED_FIELDS, baseline_projection_hash: SOURCE_PROJECTION_SHA256, rows: all });
    const filtered = all.filter((source) =>
      (query.platform === undefined || source.platform === query.platform) &&
      (query.lifecycleStatus === undefined || source.lifecycle_status === query.lifecycleStatus) &&
      (query.enabled === undefined || source.enabled === query.enabled) &&
      (query.onboardingStatus === undefined || source.collection_onboarding_status === query.onboardingStatus)
    );
    let start = 0;
    if (query.cursor) {
      let cursor: JsonRecord;
      try {
        cursor = asRecord(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")));
      } catch {
        throw new AdminError("ADMIN_SOURCE_CURSOR_STALE", 409);
      }
      const scope = canonicalHash({
        platform: query.platform ?? null,
        lifecycle_status: query.lifecycleStatus ?? null,
        enabled: query.enabled ?? null,
        collection_onboarding_status: query.onboardingStatus ?? null
      });
      if (cursor.effective_root !== effectiveRoot || cursor.scope !== scope || typeof cursor.source_id !== "string") {
        throw new AdminError("ADMIN_SOURCE_CURSOR_STALE", 409);
      }
      start = filtered.findIndex((source) => String(source.source_id) > String(cursor.source_id));
      if (start < 0) start = filtered.length;
    }
    const limit = query.limit ?? 25;
    const page = filtered.slice(start, start + limit);
    const last = page.at(-1);
    const nextCursor = start + page.length < filtered.length && last ? Buffer.from(canonicalJson({
      effective_root: effectiveRoot,
      scope: canonicalHash({
        platform: query.platform ?? null,
        lifecycle_status: query.lifecycleStatus ?? null,
        enabled: query.enabled ?? null,
        collection_onboarding_status: query.onboardingStatus ?? null
      }),
      source_id: last.source_id
    })).toString("base64url") : null;
    return {
      schema_version: "admin-source-list-v0.2",
      effective_root: effectiveRoot,
      items: page.map((source) => ({ source, meta: this.meta(source, this.baselineById.has(String(source.source_id)) ? "m3_baseline" : "local_synthetic") })),
      next_cursor: nextCursor
    };
  }

  private existingReceipt(identity: CommandIdentity, method: string, path: string, bodyHash: string): SourceOperationReceipt | null {
    const row = this.database.prepare(
      "SELECT * FROM operation_receipt WHERE command_operation_id = ? OR command_idempotency_key = ?"
    ).get(identity.command_operation_id, identity.command_idempotency_key) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (
      row.command_operation_id !== identity.command_operation_id || row.command_idempotency_key !== identity.command_idempotency_key ||
      row.method !== method || row.exact_path !== path || row.canonical_body_hash !== bodyHash
    ) {
      throw new AdminError("ADMIN_COMMAND_IDENTITY_CONFLICT", 409);
    }
    return JSON.parse(String(row.receipt_json)) as SourceOperationReceipt;
  }

  getOperation(commandOperationId: string): SourceOperationReceipt | null {
    const row = this.database.prepare("SELECT receipt_json FROM operation_receipt WHERE command_operation_id = ?").get(commandOperationId) as Record<string, unknown> | undefined;
    return row ? JSON.parse(String(row.receipt_json)) as SourceOperationReceipt : null;
  }

  private writeReceipt(
    identity: CommandIdentity,
    method: string,
    path: string,
    bodyHash: string,
    receipt: SourceOperationReceipt,
    expected: SourceExpected | null,
    fences: RuntimeFences | null,
    business: BusinessIdentity | null
  ): void {
    const receiptJson = canonicalJson(receipt);
    this.database.prepare(
      `INSERT INTO operation_receipt (
        command_operation_id,command_idempotency_key,method,exact_path,canonical_body_hash,operation_type,source_id,
        expected_source_hash,expected_source_version,expected_source_config_epoch,expected_source_safety_epoch,
        expected_authorization_version,expected_policy_epoch,expected_recovery_epoch,operation_status,
        business_operation_id,business_idempotency_key,outbox_job_id,result_hash,reason_code,receipt_json,created_at,completed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      identity.command_operation_id, identity.command_idempotency_key, method, path, bodyHash, receipt.operation_type,
      receipt.source_id, expected?.source_hash ?? null, expected?.source_version ?? null,
      expected?.source_config_epoch ?? null, expected?.source_safety_epoch ?? null,
      fences?.authorization_version ?? null, fences?.policy_epoch ?? null, fences?.recovery_epoch ?? null,
      receipt.operation_status, business?.businessOperationId ?? receipt.business_operation_id ?? null,
      business?.businessIdempotencyKey ?? null, business?.jobId ?? receipt.outbox_job_id ?? null,
      canonicalHash(receipt.result), receipt.reason_code ?? null, receiptJson, receipt.updated_at, receipt.updated_at
    );
  }

  private audit(
    reasonCode: string,
    owner: "command" | "worker",
    operationId: string,
    taskId: string | null,
    source: SourceRow,
    fences: RuntimeFences,
    attempt: number,
    payload: unknown
  ): void {
    const previous = this.database.prepare("SELECT monotonic_seq,event_hash FROM audit_event ORDER BY monotonic_seq DESC LIMIT 1").get() as Record<string, unknown> | undefined;
    const sequence = Number(previous?.monotonic_seq ?? 0) + 1;
    const occurredAt = this.timestamp();
    const payloadHash = canonicalHash(payload);
    const core = {
      event_id: `audit-${sequence.toString().padStart(12, "0")}`,
      monotonic_seq: sequence,
      occurred_at: occurredAt,
      clock_status: "trusted_local_clock",
      trace_ref: `trace-${sequence.toString().padStart(12, "0")}`,
      session_hash: null,
      reason_code: reasonCode,
      owner,
      operation_id: operationId,
      task_id: taskId,
      source_config_epoch: Number(source.source_config_epoch),
      source_safety_epoch: Number(source.source_safety_epoch),
      authorization_version: fences.authorization_version,
      policy_epoch: fences.policy_epoch,
      recovery_epoch: fences.recovery_epoch,
      attempt,
      payload_hash: payloadHash,
      fixture_hash: SOURCE_PROJECTION_SHA256,
      schema_hash: SOURCE_SCHEMA_SHA256,
      redaction_version: "source-management-redaction-v1",
      retention: "local-synthetic",
      cleanup_after: "2099-12-31T00:00:00.000Z",
      append_only: 1,
      internal_only: 1,
      external_calls: 0
    };
    const eventHash = canonicalHash({ previous_event_hash: previous?.event_hash ?? null, core, payload });
    const columns = [...Object.keys(core), "previous_event_hash", "event_hash", "payload_json"];
    const values = [...Object.values(core), previous?.event_hash ?? null, eventHash, canonicalJson(core)].map(sqlInput);
    this.database.prepare(`INSERT INTO audit_event (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...values);
  }

  private assertExpected(state: LocalState, expected: SourceExpected, fences: RuntimeFences): void {
    if (
      expected.source_id !== state.source.source_id || expected.updated_at !== state.source.updated_at ||
      expected.source_config_epoch !== state.source.source_config_epoch || expected.source_safety_epoch !== state.source.source_safety_epoch ||
      expected.collection_onboarding_status !== state.source.collection_onboarding_status ||
      expected.lifecycle_status !== state.source.lifecycle_status || expected.enabled !== state.source.enabled ||
      expected.source_hash !== state.sourceHash || expected.source_version !== state.sourceVersion ||
      fences.authorization_version !== state.fences.authorization_version || fences.policy_epoch !== state.fences.policy_epoch ||
      fences.recovery_epoch !== state.fences.recovery_epoch
    ) {
      throw new AdminError("ADMIN_SOURCE_STALE", 412);
    }
  }

  private replaceSource(state: LocalState, next: SourceRow, operationId: string): LocalState {
    const hash = sourceRowHash(next);
    const assignments = SOURCE_REQUIRED_FIELDS.map((field) => `"${field}" = ?`).join(",");
    const result = this.database.prepare(
      `UPDATE source_config_fixture SET ${assignments} WHERE source_id = ? AND updated_at = ? AND source_config_epoch = ? AND source_safety_epoch = ?`
    ).run(...sourceValues(next), sqlInput(state.source.source_id), sqlInput(state.source.updated_at), sqlInput(state.source.source_config_epoch), sqlInput(state.source.source_safety_epoch));
    if (Number(result.changes) !== 1) throw new AdminError("ADMIN_SOURCE_STALE", 412);
    const lineage = this.database.prepare(
      "UPDATE source_overlay_lineage SET source_version = ?,effective_source_hash = ?,last_operation_id = ?,updated_at = ? WHERE source_id = ? AND source_version = ? AND effective_source_hash = ?"
    ).run(state.sourceVersion + 1, hash, operationId, sqlInput(next.updated_at), sqlInput(next.source_id), state.sourceVersion, state.sourceHash);
    if (Number(lineage.changes) !== 1) throw new AdminError("ADMIN_SOURCE_STALE", 412);
    return { ...state, source: next, sourceHash: hash, sourceVersion: state.sourceVersion + 1 };
  }

  add(commandValue: unknown, method: string, path: string, bodyHash: string): SourceOperationReceipt {
    const command = asRecord(commandValue) as AddSourceCommand;
    assertExactKeys(command, ["schema_version", "command_operation_id", "command_idempotency_key", "platform", "raw_url", "handle", "entity_type", "content_focus", "priority"]);
    if (command.schema_version !== COMMAND_SCHEMA) throw new AdminError("ADMIN_BODY_INVALID", 422);
    assertCommandIdentity(command);
    const replay = this.existingReceipt(command, method, path, bodyHash);
    if (replay) return replay;
    let parsed: URL;
    try {
      parsed = new URL(command.raw_url);
    } catch {
      throw new AdminError("ADMIN_BODY_INVALID", 422);
    }
    if (
      parsed.protocol !== "https:" || parsed.hostname !== "synthetic.invalid" || parsed.username || parsed.password ||
      parsed.hash || parsed.href !== command.raw_url || command.raw_url.length > 2048 || !/^[A-Za-z0-9._/-]+$/.test(parsed.pathname)
    ) throw new AdminError("ADMIN_BODY_INVALID", 422);
    const identity = this.identityForSource(command.platform, command.raw_url);
    const existingBaseline = this.baselineById.get(identity.sourceId);
    const existingLocal = this.readLocal(identity.sourceId);
    if (existingBaseline || existingLocal) {
      const existingHash = existingLocal?.fullIdentityHash ?? this.identityForSource(String(existingBaseline?.platform), String(existingBaseline?.raw_url)).fullIdentityHash;
      throw new AdminError(existingHash === identity.fullIdentityHash ? "ADMIN_SOURCE_ALREADY_PROPOSED" : "ADMIN_SOURCE_ID_COLLISION", 409);
    }
    if (this.baselineByCanonicalUrl.has(parsed.href) || this.database.prepare("SELECT 1 AS present FROM source_config_fixture WHERE canonical_url = ?").get(parsed.href)) {
      throw new AdminError("ADMIN_SOURCE_CANONICAL_CONFLICT", 409);
    }
    const timestamp = this.timestamp();
    const source = validateSourceRow({
      source_id: identity.sourceId,
      platform: command.platform,
      platform_account_id: null,
      handle: command.handle,
      raw_url: command.raw_url,
      canonical_url: parsed.href,
      canonical_url_valid: false,
      normalizer_version: NORMALIZER,
      normalization_status: "pending",
      dedup_status: "pending",
      entity_type: command.entity_type,
      content_focus: command.content_focus,
      priority: command.priority,
      verification_status: "pending",
      identity_status: "unknown",
      relevance_status: "unknown",
      monitorability: "unknown",
      adapter_status: "unchecked",
      adapter_authorization_status: "unknown",
      platform_allowed: "unknown",
      authorization_checked_at: null,
      authorization_expires_at: null,
      collection_onboarding_status: "validating",
      onboarding_operation_id: null,
      lifecycle_status: "proposed",
      enabled: false,
      manual_disable_at: null,
      source_stop_status: "clear",
      source_safety_epoch: 1,
      source_config_epoch: 1,
      added_at: timestamp.slice(0, 10),
      evidence_url: parsed.href,
      notes: "local synthetic source; no external request",
      migration_batch_id: MIGRATION_BATCH,
      change_reason: "source_add",
      created_at: timestamp,
      updated_at: timestamp,
      created_by_ref: ACTOR,
      updated_by_ref: ACTOR
    }, this.appRoot, this.projectRoot);
    const receipt: SourceOperationReceipt = {
      schema_version: "admin-source-operation-v0.2",
      command_operation_id: command.command_operation_id,
      operation_type: "source_add",
      operation_status: "succeeded",
      source_id: identity.sourceId,
      result: {
        collection_onboarding_status: "validating", lifecycle_status: "proposed", enabled: false,
        source_config_epoch: 1, source_safety_epoch: 1, onboarding_operation_id: null
      },
      updated_at: timestamp
    };
    withImmediateTransaction(this.database, () => {
      if (this.existingReceipt(command, method, path, bodyHash)) return;
      this.database.prepare(
        `INSERT INTO source_config_fixture (${SOURCE_REQUIRED_FIELDS.join(",")}) VALUES (${SOURCE_REQUIRED_FIELDS.map(() => "?").join(",")})`
      ).run(...sourceValues(source));
      this.database.prepare(
        "INSERT INTO source_overlay_lineage (source_id,origin,baseline_projection_hash,source_version,effective_source_hash,full_identity_hash,first_operation_id,last_operation_id,created_at,updated_at) VALUES (?,'local_synthetic',?,1,?,?,?,?,?,?)"
      ).run(sqlInput(source.source_id), SOURCE_PROJECTION_SHA256, sourceRowHash(source), identity.fullIdentityHash, command.command_operation_id, command.command_operation_id, timestamp, timestamp);
      this.database.prepare(
        "INSERT INTO source_runtime_fence (source_id,authorization_version,policy_epoch,recovery_epoch,updated_at,updated_by_ref) VALUES (?,1,1,1,?,?)"
      ).run(sqlInput(source.source_id), timestamp, ACTOR);
      this.writeReceipt(command, method, path, bodyHash, receipt, null, null, null);
      this.audit("SOURCE_ADD_SUCCEEDED", "command", command.command_operation_id, null, source, { authorization_version: 1, policy_epoch: 1, recovery_epoch: 1 }, 0, receipt.result);
    });
    return receipt;
  }

  private parseMutation(commandValue: unknown, allowStopReason = false): SourceMutationCommand {
    const command = asRecord(commandValue) as SourceMutationCommand;
    const keys = ["schema_version", "command_operation_id", "command_idempotency_key", "expected", "runtime_fences", ...(allowStopReason ? ["stop_reason"] : [])];
    assertExactKeys(command, keys);
    if (command.schema_version !== COMMAND_SCHEMA) throw new AdminError("ADMIN_BODY_INVALID", 422);
    assertCommandIdentity(command);
    const expected = asRecord(command.expected);
    assertExactKeys(expected, ["source_id", "updated_at", "source_config_epoch", "source_safety_epoch", "collection_onboarding_status", "lifecycle_status", "enabled", "source_hash", "source_version"]);
    const fences = asRecord(command.runtime_fences);
    assertExactKeys(fences, ["authorization_version", "policy_epoch", "recovery_epoch"]);
    return command;
  }

  private receiptFor(
    command: SourceMutationCommand,
    operationType: SourceOperationReceipt["operation_type"],
    state: LocalState,
    timestamp: string,
    business: BusinessIdentity | null = null
  ): SourceOperationReceipt {
    return {
      schema_version: "admin-source-operation-v0.2",
      command_operation_id: command.command_operation_id,
      operation_type: operationType,
      operation_status: "succeeded",
      source_id: String(state.source.source_id),
      ...(business ? { business_operation_id: business.businessOperationId, outbox_job_id: business.jobId } : {}),
      result: {
        collection_onboarding_status: String(state.source.collection_onboarding_status),
        lifecycle_status: String(state.source.lifecycle_status),
        enabled: Boolean(state.source.enabled),
        source_config_epoch: Number(state.source.source_config_epoch),
        source_safety_epoch: Number(state.source.source_safety_epoch),
        onboarding_operation_id: state.source.onboarding_operation_id as string | null
      },
      updated_at: timestamp
    };
  }

  validate(commandValue: unknown, method: string, path: string, bodyHash: string): SourceOperationReceipt {
    const command = this.parseMutation(commandValue);
    const replay = this.existingReceipt(command, method, path, bodyHash);
    if (replay) return replay;
    if (this.baselineById.has(command.expected.source_id)) throw new AdminError("ADMIN_M3_SHADOW_DENIED", 403);
    return withImmediateTransaction(this.database, () => {
      const repeated = this.existingReceipt(command, method, path, bodyHash);
      if (repeated) return repeated;
      const state = this.readLocal(command.expected.source_id);
      if (!state) throw new AdminError("ADMIN_SOURCE_NOT_FOUND", 404);
      this.assertExpected(state, command.expected, command.runtime_fences);
      const rawUrl = String(state.source.raw_url);
      let onboarding: string = "activation_pending";
      const overrides: JsonRecord = {
        canonical_url_valid: true, normalization_status: "valid", dedup_status: "unique",
        platform_allowed: "allowed", adapter_authorization_status: "valid", adapter_status: "ready"
      };
      if (rawUrl.includes("/normalization-fail/")) {
        onboarding = "normalization_failed";
        overrides.canonical_url_valid = false;
        overrides.normalization_status = "invalid";
      } else if (rawUrl.includes("/dedup-review/")) {
        onboarding = "dedup_needs_review";
        overrides.dedup_status = "needs_review";
      } else if (rawUrl.includes("/linked/")) {
        onboarding = "linked_existing";
        overrides.dedup_status = "linked_existing";
      } else if (rawUrl.includes("/blocked-platform/")) {
        onboarding = "blocked_platform";
        overrides.platform_allowed = "blocked";
      } else if (rawUrl.includes("/blocked-auth/")) {
        onboarding = "blocked_authorization";
        overrides.adapter_authorization_status = "invalid";
      } else if (rawUrl.includes("/blocked-adapter/")) {
        onboarding = "blocked_adapter_missing";
        overrides.adapter_status = "missing";
      }
      const timestamp = this.timestamp();
      const next = validateSourceRow({
        ...state.source,
        ...overrides,
        collection_onboarding_status: onboarding,
        source_config_epoch: Number(state.source.source_config_epoch) + 1,
        updated_at: timestamp,
        updated_by_ref: ACTOR,
        change_reason: "source_validate"
      }, this.appRoot, this.projectRoot);
      const updated = this.replaceSource(state, next, command.command_operation_id);
      const receipt = this.receiptFor(command, "source_validate", updated, timestamp);
      this.writeReceipt(command, method, path, bodyHash, receipt, command.expected, command.runtime_fences, null);
      this.audit("SOURCE_VALIDATE_SUCCEEDED", "command", command.command_operation_id, null, next, state.fences, 0, receipt.result);
      return receipt;
    });
  }

  private identityExists(candidate: BusinessIdentity): boolean {
    const row = this.database.prepare(
      "SELECT 1 AS present FROM outbox_job WHERE business_operation_id=? OR business_idempotency_key=? OR job_id=? OR task_id=?"
    ).get(candidate.businessOperationId, candidate.businessIdempotencyKey, candidate.jobId, candidate.taskId) as Record<string, unknown> | undefined;
    return row?.present === 1;
  }

  private jobIdentity(row: Record<string, unknown>): BusinessIdentity {
    const identity = {
      businessOperationId: String(row.business_operation_id),
      businessIdempotencyKey: String(row.business_idempotency_key),
      jobId: String(row.job_id),
      taskId: String(row.task_id)
    };
    assertBusinessIdentity(identity);
    return identity;
  }

  activate(commandValue: unknown, method: string, path: string, bodyHash: string): SourceOperationReceipt {
    const command = this.parseMutation(commandValue);
    const replay = this.existingReceipt(command, method, path, bodyHash);
    if (replay) return replay;
    if (this.baselineById.has(command.expected.source_id)) throw new AdminError("ADMIN_M3_SHADOW_DENIED", 403);
    return withImmediateTransaction(this.database, () => {
      const state = this.readLocal(command.expected.source_id);
      if (!state) throw new AdminError("ADMIN_SOURCE_NOT_FOUND", 404);
      this.assertExpected(state, command.expected, command.runtime_fences);
      const onboardingState = String(state.source.collection_onboarding_status);
      const stopGateClear = state.source.source_stop_status === "clear" ||
        (onboardingState === "stopped" && state.source.source_stop_status === "manual");
      if (
        !["activation_pending", "queue_failed", "stopped", "cancelled"].includes(onboardingState) ||
        state.source.canonical_url_valid !== true || state.source.normalization_status !== "valid" || state.source.dedup_status !== "unique" ||
        state.source.platform_allowed !== "allowed" || state.source.adapter_authorization_status !== "valid" ||
        state.source.adapter_status !== "ready" || !stopGateClear
      ) throw new AdminError("ADMIN_SOURCE_GATE_BLOCKED", 409);
      const prior = this.database.prepare("SELECT * FROM outbox_job WHERE aggregate_id = ? ORDER BY created_at DESC LIMIT 1").get(sqlInput(state.source.source_id)) as Record<string, unknown> | undefined;
      const reuse = prior && ["queue_failed", "stopped"].includes(String(state.source.collection_onboarding_status));
      const business = reuse ? this.jobIdentity(prior) : generateBusinessIdentity((candidate) => this.identityExists(candidate), this.randomBytes);
      const timestamp = this.timestamp();
      const next = validateSourceRow({
        ...state.source,
        enabled: true,
        collection_onboarding_status: "queued",
        lifecycle_status: "active",
        source_stop_status: "clear",
        manual_disable_at: null,
        onboarding_operation_id: business.businessOperationId,
        source_config_epoch: Number(state.source.source_config_epoch) + 1,
        updated_at: timestamp,
        updated_by_ref: ACTOR,
        change_reason: "source_activate"
      }, this.appRoot, this.projectRoot);
      const updated = this.replaceSource(state, next, command.command_operation_id);
      const deadline = new Date(new Date(timestamp).getTime() + 15 * 60 * 1000).toISOString();
      const envelope = {
        task_id: business.taskId, operation_id: business.businessOperationId, aggregate_type: "source",
        aggregate_id: next.source_id, payload_hash: sourceRowHash(next), source_config_epoch: next.source_config_epoch,
        source_safety_epoch: next.source_safety_epoch, ...state.fences, lease_token: SEED_LEASE,
        lease_expiry: null, deadline, attempt: 0, idempotency_key: business.businessIdempotencyKey,
        reconcile_key: `reconcile:${business.businessOperationId}`
      };
      const envelopeJson = canonicalJson(envelope);
      const envelopeHash = sha256(envelopeJson);
      if (reuse) {
        const changed = this.database.prepare(
          "UPDATE outbox_job SET task_envelope=?,envelope_hash=?,source_config_epoch=?,source_safety_epoch=?,authorization_version=?,policy_epoch=?,recovery_epoch=?,lease_token=?,lease_expiry=NULL,deadline=?,job_status='pending',last_error_code=NULL,next_attempt_at=?,updated_at=?,updated_by_ref=? WHERE job_id=? AND business_operation_id=?"
        ).run(envelopeJson, envelopeHash, sqlInput(next.source_config_epoch), sqlInput(next.source_safety_epoch), state.fences.authorization_version, state.fences.policy_epoch, state.fences.recovery_epoch, SEED_LEASE, deadline, timestamp, timestamp, ACTOR, business.jobId, business.businessOperationId);
        if (Number(changed.changes) !== 1) throw new AdminError("ADMIN_BUSINESS_IDENTITY_INTEGRITY_FAILURE", 409);
      } else {
        this.database.prepare(
          `INSERT INTO outbox_job (
            job_id,task_id,task_envelope,envelope_hash,business_operation_id,operation_type,aggregate_type,aggregate_id,
            business_idempotency_key,reconcile_key,source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch,
            lease_token,lease_expiry,deadline,job_status,attempt,retry_generation,max_attempts,payload_hash,last_error_code,next_attempt_at,
            created_at,updated_at,created_by_ref,updated_by_ref
          ) VALUES (?,?,?,?,?,'source_activation','source',?,?,?,?,?,?,?,?,?,NULL,?,'pending',0,0,3,?,NULL,?,?,?,?,?)`
        ).run(
          business.jobId, business.taskId, envelopeJson, envelopeHash, business.businessOperationId, sqlInput(next.source_id),
          business.businessIdempotencyKey, envelope.reconcile_key, sqlInput(next.source_config_epoch), sqlInput(next.source_safety_epoch),
          state.fences.authorization_version, state.fences.policy_epoch, state.fences.recovery_epoch, SEED_LEASE,
          deadline, envelope.payload_hash, timestamp, timestamp, timestamp, ACTOR, ACTOR
        );
      }
      const receipt = this.receiptFor(command, "source_activate", updated, timestamp, business);
      this.writeReceipt(command, method, path, bodyHash, receipt, command.expected, command.runtime_fences, business);
      this.audit("SOURCE_ACTIVATE_QUEUED", "command", command.command_operation_id, business.taskId, next, state.fences, 0, receipt.result);
      return receipt;
    });
  }

  stop(commandValue: unknown, method: string, path: string, bodyHash: string): SourceOperationReceipt {
    const command = this.parseMutation(commandValue, true);
    const replay = this.existingReceipt(command, method, path, bodyHash);
    if (replay) return replay;
    if (this.baselineById.has(command.expected.source_id)) throw new AdminError("ADMIN_M3_SHADOW_DENIED", 403);
    return withImmediateTransaction(this.database, () => {
      const state = this.readLocal(command.expected.source_id);
      if (!state) throw new AdminError("ADMIN_SOURCE_NOT_FOUND", 404);
      this.assertExpected(state, command.expected, command.runtime_fences);
      if (!["queued", "collecting", "active"].includes(String(state.source.collection_onboarding_status))) {
        throw new AdminError("ADMIN_SOURCE_STATE_CONFLICT", 409);
      }
      const timestamp = this.timestamp();
      const reason = command.stop_reason ?? "manual";
      const next = validateSourceRow({
        ...state.source,
        collection_onboarding_status: "stopped", enabled: false, source_stop_status: reason,
        manual_disable_at: reason === "manual" ? timestamp : state.source.manual_disable_at,
        source_config_epoch: Number(state.source.source_config_epoch) + 1,
        source_safety_epoch: Number(state.source.source_safety_epoch) + 1,
        updated_at: timestamp, updated_by_ref: ACTOR, change_reason: "source_stop"
      }, this.appRoot, this.projectRoot);
      const updated = this.replaceSource(state, next, command.command_operation_id);
      this.database.prepare(
        "UPDATE outbox_job SET job_status='cancelled',last_error_code='SOURCE_STOPPED',updated_at=?,updated_by_ref=? WHERE aggregate_id=? AND job_status IN ('pending','leased','retryable_failed')"
      ).run(timestamp, ACTOR, sqlInput(next.source_id));
      const receipt = this.receiptFor(command, "source_stop", updated, timestamp);
      this.writeReceipt(command, method, path, bodyHash, receipt, command.expected, command.runtime_fences, null);
      this.audit("SOURCE_STOP_SUCCEEDED", "command", command.command_operation_id, null, next, state.fences, 0, receipt.result);
      return receipt;
    });
  }

  retire(commandValue: unknown, method: string, path: string, bodyHash: string): SourceOperationReceipt {
    const command = this.parseMutation(commandValue);
    const replay = this.existingReceipt(command, method, path, bodyHash);
    if (replay) return replay;
    if (this.baselineById.has(command.expected.source_id)) throw new AdminError("ADMIN_M3_SHADOW_DENIED", 403);
    return withImmediateTransaction(this.database, () => {
      const state = this.readLocal(command.expected.source_id);
      if (!state) throw new AdminError("ADMIN_SOURCE_NOT_FOUND", 404);
      this.assertExpected(state, command.expected, command.runtime_fences);
      if (
        state.source.lifecycle_status !== "active" || !["stopped", "cancelled"].includes(String(state.source.collection_onboarding_status)) ||
        state.source.enabled !== false || state.source.source_stop_status === "clear"
      ) throw new AdminError("ADMIN_SOURCE_STATE_CONFLICT", 409);
      const timestamp = this.timestamp();
      const next = validateSourceRow({
        ...state.source, lifecycle_status: "retired",
        source_config_epoch: Number(state.source.source_config_epoch) + 1,
        source_safety_epoch: Number(state.source.source_safety_epoch) + 1,
        updated_at: timestamp, updated_by_ref: ACTOR, change_reason: "source_retire"
      }, this.appRoot, this.projectRoot);
      const updated = this.replaceSource(state, next, command.command_operation_id);
      const receipt = this.receiptFor(command, "source_retire", updated, timestamp);
      this.writeReceipt(command, method, path, bodyHash, receipt, command.expected, command.runtime_fences, null);
      this.audit("SOURCE_RETIRE_SUCCEEDED", "command", command.command_operation_id, null, next, state.fences, 0, receipt.result);
      return receipt;
    });
  }

  requeue(commandValue: unknown, method: string, path: string, bodyHash: string): SourceOperationReceipt {
    const command = this.parseMutation(commandValue);
    const replay = this.existingReceipt(command, method, path, bodyHash);
    if (replay) return replay;
    return withImmediateTransaction(this.database, () => {
      const state = this.readLocal(command.expected.source_id);
      if (!state) throw new AdminError("ADMIN_SOURCE_NOT_FOUND", 404);
      this.assertExpected(state, command.expected, command.runtime_fences);
      const job = this.database.prepare("SELECT * FROM outbox_job WHERE aggregate_id=? AND job_status='dead_letter'").get(sqlInput(state.source.source_id)) as Record<string, unknown> | undefined;
      if (state.source.collection_onboarding_status !== "dead_letter" || !job) throw new AdminError("ADMIN_REQUEUE_CONFLICT", 409);
      const business = this.jobIdentity(job);
      const timestamp = this.timestamp();
      const generation = Number(job.retry_generation) + 1;
      const next = validateSourceRow({
        ...state.source, collection_onboarding_status: "queued", enabled: true,
        source_config_epoch: Number(state.source.source_config_epoch) + 1,
        updated_at: timestamp, updated_by_ref: ACTOR, change_reason: "source_requeue"
      }, this.appRoot, this.projectRoot);
      const updated = this.replaceSource(state, next, command.command_operation_id);
      const changed = this.database.prepare(
        "UPDATE outbox_job SET job_status='pending',retry_generation=?,attempt=0,last_error_code=NULL,next_attempt_at=?,lease_token=?,lease_expiry=NULL,source_config_epoch=?,source_safety_epoch=?,updated_at=?,updated_by_ref=? WHERE job_id=? AND job_status='dead_letter'"
      ).run(generation, timestamp, SEED_LEASE, sqlInput(next.source_config_epoch), sqlInput(next.source_safety_epoch), timestamp, ACTOR, business.jobId);
      if (Number(changed.changes) !== 1) throw new AdminError("ADMIN_REQUEUE_CONFLICT", 409);
      const receipt = this.receiptFor(command, "source_requeue", updated, timestamp, business);
      this.writeReceipt(command, method, path, bodyHash, receipt, command.expected, command.runtime_fences, business);
      this.audit("SOURCE_REQUEUE_SUCCEEDED", "command", command.command_operation_id, business.taskId, next, state.fences, 0, receipt.result);
      return receipt;
    });
  }

  acquireActivation(): AcquiredActivation | null {
    return withImmediateTransaction(this.database, () => {
      const now = this.timestamp();
      const job = this.database.prepare(
        "SELECT * FROM outbox_job WHERE job_status IN ('pending','retryable_failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY next_attempt_at,job_id LIMIT 1"
      ).get(now) as Record<string, unknown> | undefined;
      if (!job) return null;
      const state = this.readLocal(String(job.aggregate_id));
      if (!state || state.source.source_stop_status !== "clear" || state.source.enabled !== true ||
        Number(job.source_config_epoch) !== state.source.source_config_epoch || Number(job.source_safety_epoch) !== state.source.source_safety_epoch ||
        Number(job.authorization_version) !== state.fences.authorization_version || Number(job.policy_epoch) !== state.fences.policy_epoch || Number(job.recovery_epoch) !== state.fences.recovery_epoch
      ) {
        this.database.prepare("UPDATE outbox_job SET job_status='stale_epoch',last_error_code='FENCE_STALE',updated_at=? WHERE job_id=?").run(now, sqlInput(job.job_id));
        return null;
      }
      const lease = generateLiveLease((candidate) => Boolean(this.database.prepare("SELECT 1 FROM task_attempt WHERE lease_token=?").get(candidate)), this.randomBytes);
      assertLiveLease(lease);
      const attempt = Number(job.attempt) + 1;
      const leaseExpiry = new Date(new Date(now).getTime() + 60_000).toISOString();
      const deadline = String(job.deadline);
      const remainingWindow = new Date(deadline).getTime() - new Date(now).getTime();
      if (!Number.isFinite(remainingWindow) || remainingWindow <= 0 || remainingWindow > 15 * 60 * 1000) {
        throw new AdminError("ADMIN_BUSINESS_IDENTITY_INTEGRITY_FAILURE", 409);
      }
      const envelope = {
        ...(JSON.parse(String(job.task_envelope)) as JsonRecord),
        lease_token: lease,
        lease_expiry: leaseExpiry,
        attempt
      };
      const envelopeJson = canonicalJson(envelope);
      const envelopeHash = sha256(envelopeJson);
      const changed = this.database.prepare(
        "UPDATE outbox_job SET job_status='leased',attempt=?,lease_token=?,lease_expiry=?,task_envelope=?,envelope_hash=?,updated_at=? WHERE job_id=? AND job_status IN ('pending','retryable_failed') AND attempt=?"
      ).run(attempt, lease, leaseExpiry, envelopeJson, envelopeHash, now, sqlInput(job.job_id), sqlInput(job.attempt));
      if (Number(changed.changes) !== 1) throw new AdminError("ADMIN_SOURCE_STALE", 412);
      const nextSource = validateSourceRow({
        ...state.source, collection_onboarding_status: "collecting", updated_at: now,
        updated_by_ref: "worker:source-activation", change_reason: "source_activation_acquired"
      }, this.appRoot, this.projectRoot);
      this.replaceSource(state, nextSource, String(job.business_operation_id));
      const inboxWrite = this.database.prepare(
        `INSERT INTO inbox (inbox_id,job_id,task_envelope,envelope_hash,business_operation_id,business_idempotency_key,received_at,inbox_status,last_error_code,created_at)
         VALUES (?,?,?,?,?,?,?,'processing',NULL,?)
         ON CONFLICT(business_operation_id,business_idempotency_key) DO UPDATE SET
           task_envelope=excluded.task_envelope,envelope_hash=excluded.envelope_hash,received_at=excluded.received_at,
           inbox_status='processing',last_error_code=NULL
         WHERE inbox.job_id=excluded.job_id`
      ).run(`inbox-${randomUUID()}`, sqlInput(job.job_id), envelopeJson, envelopeHash, sqlInput(job.business_operation_id), sqlInput(job.business_idempotency_key), now, now);
      if (Number(inboxWrite.changes) !== 1) throw new AdminError("ADMIN_BUSINESS_IDENTITY_INTEGRITY_FAILURE", 409);
      this.database.prepare(
        "INSERT INTO task_attempt (attempt_id,job_id,retry_generation,attempt_no,lease_token,lease_expiry,deadline,worker_ref,started_at,finished_at,attempt_status,error_code,envelope_hash) VALUES (?,?,?,?,?,?,?,?,?,NULL,'leased',NULL,?)"
      ).run(`attempt-${randomUUID()}`, sqlInput(job.job_id), sqlInput(job.retry_generation), attempt, lease, leaseExpiry, deadline, "worker:source-activation", now, envelopeHash);
      this.audit("SOURCE_ACTIVATION_LEASED", "worker", String(job.business_operation_id), String(job.task_id), nextSource, state.fences, attempt, { envelope_hash: envelopeHash });
      return {
        jobId: String(job.job_id), sourceId: String(job.aggregate_id), taskId: String(job.task_id),
        businessOperationId: String(job.business_operation_id), retryGeneration: Number(job.retry_generation), attempt,
        leaseToken: lease, leaseExpiry, deadline, envelopeHash
      };
    });
  }

  settleActivation(acquired: AcquiredActivation, outcome: "success" | "MOCK_TIMEOUT" | "MOCK_TERMINAL"): void {
    withImmediateTransaction(this.database, () => {
      const now = this.timestamp();
      const job = this.database.prepare("SELECT * FROM outbox_job WHERE job_id=?").get(acquired.jobId) as Record<string, unknown> | undefined;
      const state = this.readLocal(acquired.sourceId);
      if (!job || !state || job.job_status !== "leased" || job.lease_token !== acquired.leaseToken ||
        new Date(acquired.leaseExpiry).getTime() < new Date(now).getTime() ||
        Number(job.source_config_epoch) !== state.source.source_config_epoch || Number(job.source_safety_epoch) !== state.source.source_safety_epoch ||
        Number(job.authorization_version) !== state.fences.authorization_version || Number(job.policy_epoch) !== state.fences.policy_epoch || Number(job.recovery_epoch) !== state.fences.recovery_epoch
      ) {
        throw new AdminError("ADMIN_SOURCE_STALE", 412);
      }
      if (outcome === "success") {
        const next = validateSourceRow({
          ...state.source, collection_onboarding_status: "active", enabled: true, updated_at: now,
          updated_by_ref: "worker:source-activation", change_reason: "source_activation_succeeded"
        }, this.appRoot, this.projectRoot);
        this.replaceSource(state, next, acquired.businessOperationId);
        this.database.prepare("UPDATE outbox_job SET job_status='succeeded',updated_at=?,last_error_code=NULL WHERE job_id=? AND lease_token=?").run(now, acquired.jobId, acquired.leaseToken);
        this.database.prepare("UPDATE task_attempt SET attempt_status='succeeded',finished_at=? WHERE job_id=? AND lease_token=?").run(now, acquired.jobId, acquired.leaseToken);
        this.database.prepare("UPDATE inbox SET inbox_status='acked' WHERE job_id=? AND envelope_hash=?").run(acquired.jobId, acquired.envelopeHash);
        this.audit("SOURCE_ACTIVATION_SUCCEEDED", "worker", acquired.businessOperationId, acquired.taskId, next, state.fences, acquired.attempt, { external_calls: 0 });
        return;
      }
      const retryable = RETRYABLE_CODES.has(outcome) && acquired.attempt < 3;
      if (retryable) {
        const next = validateSourceRow({
          ...state.source, collection_onboarding_status: "queue_failed", enabled: true, updated_at: now,
          updated_by_ref: "worker:source-activation", change_reason: "source_activation_retryable"
        }, this.appRoot, this.projectRoot);
        this.replaceSource(state, next, acquired.businessOperationId);
        this.database.prepare("UPDATE outbox_job SET job_status='retryable_failed',last_error_code=?,next_attempt_at=?,updated_at=? WHERE job_id=? AND lease_token=?")
          .run(outcome, now, now, acquired.jobId, acquired.leaseToken);
        this.database.prepare("UPDATE task_attempt SET attempt_status='retryable_failed',error_code=?,finished_at=? WHERE job_id=? AND lease_token=?")
          .run(outcome, now, acquired.jobId, acquired.leaseToken);
        this.database.prepare("UPDATE inbox SET inbox_status='rejected',last_error_code=? WHERE job_id=? AND envelope_hash=?")
          .run(outcome, acquired.jobId, acquired.envelopeHash);
        this.audit("SOURCE_ACTIVATION_RETRYABLE", "worker", acquired.businessOperationId, acquired.taskId, next, state.fences, acquired.attempt, { reason_code: outcome });
        return;
      }
      const next = validateSourceRow({
        ...state.source, collection_onboarding_status: "dead_letter", enabled: false, updated_at: now,
        updated_by_ref: "worker:source-activation", change_reason: "source_activation_dead_letter"
      }, this.appRoot, this.projectRoot);
      this.replaceSource(state, next, acquired.businessOperationId);
      this.database.prepare("UPDATE outbox_job SET job_status='dead_letter',last_error_code=?,updated_at=? WHERE job_id=? AND lease_token=?")
        .run(outcome, now, acquired.jobId, acquired.leaseToken);
      this.database.prepare("UPDATE task_attempt SET attempt_status='terminal_failed',error_code=?,finished_at=? WHERE job_id=? AND lease_token=?")
        .run(outcome, now, acquired.jobId, acquired.leaseToken);
      this.database.prepare("UPDATE inbox SET inbox_status='rejected',last_error_code=? WHERE job_id=? AND envelope_hash=?")
        .run(outcome, acquired.jobId, acquired.envelopeHash);
      this.database.prepare(
        "INSERT INTO dead_letter (dead_letter_id,job_id,retry_generation,business_operation_id,reason_code,attempt,recorded_at,external_calls) VALUES (?,?,?,?,?,?,?,0)"
      ).run(`dead-${randomUUID()}`, acquired.jobId, acquired.retryGeneration, acquired.businessOperationId, outcome, acquired.attempt, now);
      this.audit("SOURCE_ACTIVATION_DEAD_LETTER", "worker", acquired.businessOperationId, acquired.taskId, next, state.fences, acquired.attempt, { reason_code: outcome });
    });
  }

  runActivationWorker(outcome: "success" | "MOCK_TIMEOUT" | "MOCK_TERMINAL" = "success"): AcquiredActivation | null {
    const acquired = this.acquireActivation();
    if (acquired) this.settleActivation(acquired, outcome);
    return acquired;
  }

  businessCounts(): Readonly<Record<string, number>> {
    return Object.freeze(Object.fromEntries([
      "source_config_fixture", "operation_receipt", "outbox_job", "inbox", "task_attempt", "dead_letter", "audit_event"
    ].map((table) => [table, Number((this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Record<string, unknown>).count)])));
  }
}

export function sourceExpected(item: SourceReadItem): SourceExpected {
  return {
    source_id: String(item.source.source_id),
    updated_at: String(item.source.updated_at),
    source_config_epoch: Number(item.source.source_config_epoch),
    source_safety_epoch: Number(item.source.source_safety_epoch),
    collection_onboarding_status: String(item.source.collection_onboarding_status),
    lifecycle_status: String(item.source.lifecycle_status),
    enabled: Boolean(item.source.enabled),
    source_hash: item.meta.sourceHash,
    source_version: item.meta.sourceVersion
  };
}
