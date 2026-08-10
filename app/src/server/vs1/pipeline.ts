import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { DatabaseSync } from "node:sqlite";

import { assertNodeVersion } from "../config/env.ts";
import { openSafeDatabase, readSqliteRuntime, withImmediateTransaction } from "../db/database.ts";
import { canonicalJson } from "../db/profile.ts";
import {
  loadVs1FixtureBundle,
  VS1_FIXTURE_VERSION,
  type Vs1Attempt,
  type Vs1Candidate,
  type Vs1Case,
  type Vs1FixtureBundle
} from "./fixture.ts";

export const VS1_FUNCTION_IDS = ["COLLECT-MOCK-002", "CONTENT-PROCESS-003", "SUMMARY-MOCK-004"] as const;
export type Vs1FunctionId = (typeof VS1_FUNCTION_IDS)[number];
export type Vs1VopStatus = "PASS" | "FAIL" | "NO_WORK" | "NOT_APPLICABLE";
export type Vs1VopLine = {
  functionId: Vs1FunctionId;
  status: Vs1VopStatus;
  reasonCode: string;
  artifactHash: string | null;
  externalCalls: 0;
  recoveryAction: RecoveryAction;
};

export type RecoveryAction =
  | "NO_ACTION"
  | "NO_ACTION_FILTERED"
  | "RETRY_IN_SAME_RUN"
  | "ARCHIVE_AND_RESEED_TASK_DB"
  | "FIX_FIXTURE_AND_RESEED_TASK_DB"
  | "RESTORE_CONTRACT_AND_RESEED_TASK_DB"
  | "RESOLVE_COLLISION_THEN_RESEED"
  | "CLEAR_STOP_OR_REFRESH_FENCES_THEN_RESEED"
  | "HAND_OFF_APPROVED_CHAIN_TO_ADMIN";

const DOMAIN_TABLES = ["source_observation", "captured_item", "content", "event", "summary", "release_bundle"] as const;
const APPROVED_CHAIN_TABLES = ["review_decision", "publication"] as const;
const COUNT_TABLES = [
  ...DOMAIN_TABLES,
  "inbox",
  "task_attempt",
  "dead_letter",
  "audit_event",
  "outbox_job"
] as const;

const TRANSIENT_CODES = new Set(["HTTP_429", "HTTP_500", "HTTP_502", "HTTP_503", "HTTP_504", "COLLECTION_TIMEOUT", "DB_LOCK_CONTENTION"]);
const FILTER_CODES = new Set([
  "CONTENT_NORMALIZATION_INVALID",
  "CONTENT_EMPTY",
  "CONTENT_OBVIOUS_AD",
  "CONTENT_SPAM",
  "CONTENT_F1_UNRELATED",
  "CONTENT_RELEVANCE_UNKNOWN"
]);

const FAULT_REASON = Object.freeze({
  after_capture: "TX_CAPTURE_WRITE_FAILED",
  after_content: "TX_CONTENT_WRITE_FAILED",
  after_event: "TX_EVENT_CAS_FAILED",
  after_summary: "TX_SUMMARY_WRITE_FAILED",
  after_bundle: "TX_BUNDLE_WRITE_FAILED",
  before_ack_cas: "TX_ACK_CAS_FAILED",
  before_audit: "TX_AUDIT_WRITE_FAILED"
} as const);

class PipelineFailure extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string) {
    super(reasonCode);
    this.name = "PipelineFailure";
    this.reasonCode = reasonCode;
  }
}

export type Vs1FullReceipt = {
  schemaVersion: "vs1-operator-receipt-v1";
  fixtureVersion: typeof VS1_FIXTURE_VERSION;
  fixtureHash: string;
  manifestHash: string;
  operationId: string;
  idempotencyKey: string;
  envelopeHash: string;
  sourceId: "src-queued";
  attempt: number;
  leasePresent: true;
  fiveFences: {
    source_config_epoch: number;
    source_safety_epoch: number;
    authorization_version: 1;
    policy_epoch: 1;
    recovery_epoch: 1;
  };
  transactionSequence: string[];
  transactionCommitted: boolean;
  reasonCode: string;
  entityDeltas: Record<string, number>;
  canonicalIds: { contentId: string | null; eventId: string | null; summaryId: string | null; bundleId: string | null };
  contentHash: string | null;
  eventHash: string | null;
  summaryHash: string | null;
  bundleHash: string | null;
  dbBeforeHash: string;
  dbAfterHash: string;
  domainBeforeHash: string;
  domainAfterHash: string;
  externalCalls: 0;
  cleanupStatus: "retained_for_audit";
  recoveryAction: RecoveryAction;
  attemptHistory: Array<{ attempt: number; outcome: string; leasePresent: true; retryDelaySeconds: 0 | 1 | 3 }>;
  validatorReceipt: Vs1FixtureBundle["validatorReceipt"];
};

export type Vs1RunResult = {
  taskRoot: string;
  dbPath: string;
  receiptPath: string | null;
  artifactHash: string | null;
  receipt: Vs1FullReceipt | null;
  vops: [Vs1VopLine, Vs1VopLine, Vs1VopLine];
  exitCode: 0 | 1;
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function derivedId(prefix: string, input: unknown): string {
  return `${prefix}-${sha256(canonicalJson(input)).slice(0, 32)}`;
}

function requireChanges(changes: number | bigint, code: string): void {
  if (Number(changes) !== 1) throw new PipelineFailure(code);
}

function requireRow<T extends Record<string, unknown>>(row: T | undefined, code: string): T {
  if (!row) throw new PipelineFailure(code);
  return row;
}

function requireCanonicalPayload(row: Record<string, unknown> | undefined, expected: Record<string, unknown>, code = "DB_CORRUPTION"): Record<string, unknown> {
  const stored = requireRow(row, code);
  if (canonicalJson(parseJsonRecord(stored.payload_json)) !== canonicalJson(expected)) throw new PipelineFailure(code);
  return stored;
}

export function assertVs1InsertOrReturnRow(
  row: Record<string, unknown> | undefined,
  expectedColumns: Record<string, unknown>,
  expectedPayload: Record<string, unknown>
): Record<string, unknown> {
  const stored = requireCanonicalPayload(row, expectedPayload);
  for (const [column, expected] of Object.entries(expectedColumns)) {
    if (stored[column] !== expected) throw new PipelineFailure("DB_CORRUPTION");
  }
  return stored;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") throw new PipelineFailure("DB_CORRUPTION");
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new PipelineFailure("DB_CORRUPTION");
  return parsed as Record<string, unknown>;
}

function sqlText(value: unknown): string {
  if (typeof value !== "string") throw new PipelineFailure("DB_CORRUPTION");
  return value;
}

function sqlNullableText(value: unknown): string | null {
  if (value === null) return null;
  return sqlText(value);
}

function sqlInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new PipelineFailure("DB_CORRUPTION");
  return value;
}

function countRows(database: DatabaseSync): Record<string, number> {
  return Object.fromEntries(COUNT_TABLES.map((table) => {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Record<string, unknown>;
    return [table, Number(row.count)];
  }));
}

function entityDelta(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - (before[key] ?? 0)]));
}

function domainGraphHash(database: DatabaseSync): string {
  const graph = Object.fromEntries([...DOMAIN_TABLES, ...APPROVED_CHAIN_TABLES].map((table) => {
    const rows = database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all() as Array<Record<string, unknown>>;
    return [table, rows];
  }));
  return sha256(canonicalJson(graph));
}

function assertPackageTree(appRoot: string): void {
  const packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")) as Record<string, unknown>;
  const packageLock = JSON.parse(readFileSync(resolve(appRoot, "package-lock.json"), "utf8")) as Record<string, unknown>;
  const installedLock = JSON.parse(readFileSync(resolve(appRoot, "node_modules/.package-lock.json"), "utf8")) as Record<string, unknown>;
  const root = (packageLock.packages as Record<string, Record<string, unknown>> | undefined)?.[""];
  if (!root || canonicalJson(root.dependencies) !== canonicalJson(packageJson.dependencies) || canonicalJson(root.devDependencies) !== canonicalJson(packageJson.devDependencies)) {
    throw new PipelineFailure("SCHEMA_HASH_MISMATCH");
  }
  const lockedPackages = packageLock.packages as Record<string, Record<string, unknown>>;
  const installedPackages = installedLock.packages as Record<string, Record<string, unknown>>;
  for (const [path, metadata] of Object.entries(installedPackages)) {
    if (!lockedPackages[path] || metadata.version !== lockedPackages[path].version) throw new PipelineFailure("SCHEMA_HASH_MISMATCH");
  }
  const userAgent = process.env.npm_config_user_agent;
  if (!userAgent?.startsWith("npm/11.16.0 ")) throw new PipelineFailure("SCHEMA_HASH_MISMATCH");
}

function assertRuntimePreflight(appRoot: string): void {
  assertNodeVersion();
  assertPackageTree(appRoot);
}

function openTaskDatabase(appRoot: string, taskRoot: string, dbPath: string): DatabaseSync {
  const database = openSafeDatabase(dbPath, { appRoot, allowTestRoot: taskRoot });
  const runtime = readSqliteRuntime(database);
  if (runtime.foreignKeys !== 1 || runtime.journalMode !== "wal" || runtime.synchronous !== 2 || runtime.busyTimeout > 250 || runtime.tempStore !== 2) {
    database.close();
    throw new PipelineFailure("DB_CORRUPTION");
  }
  const databases = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (databases.some((row) => row.name !== "main" && row.name !== "temp")) {
    database.close();
    throw new PipelineFailure("DB_CORRUPTION");
  }
  return database;
}

function applyTaskMigrations(database: DatabaseSync, appRoot: string, bundle: Vs1FixtureBundle): void {
  const dir = resolve(appRoot, "migrations/vs1");
  const files = readdirSync(dir).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
  const manifestPaths = bundle.migrations.map((entry) => entry.path);
  const expectedPaths = files.map((file) => `app/migrations/vs1/${file}`);
  if (files.length !== 6 || canonicalJson(manifestPaths) !== canonicalJson(expectedPaths)) throw new PipelineFailure("SCHEMA_HASH_MISMATCH");
  for (const [index, file] of files.entries()) {
    const sql = readFileSync(resolve(dir, file), "utf8");
    if (sha256(sql) !== bundle.migrations[index].sha256) throw new PipelineFailure("SCHEMA_HASH_MISMATCH");
    withImmediateTransaction(database, () => {
      database.exec(sql);
      database.exec(`PRAGMA user_version=${index + 1}`);
      database.prepare("INSERT INTO migration_ledger(migration_id,migration_sha256,applied_at,append_only) VALUES(?,?,?,1)")
        .run(file, sha256(sql), "2026-08-09T12:00:00.000Z");
    });
  }
  const runtime = readSqliteRuntime(database);
  const integrity = database.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
  if (runtime.userVersion !== 6 || integrity.length !== 1 || String(Object.values(integrity[0])[0]).toLowerCase() !== "ok") {
    throw new PipelineFailure("DB_CORRUPTION");
  }
}

function checkpointCloseHash(database: DatabaseSync, dbPath: string): string {
  const checkpoint = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as Record<string, unknown>;
  if (Number(checkpoint.busy ?? 0) !== 0) throw new PipelineFailure("DB_HASH_UNAVAILABLE");
  database.close();
  chmodSync(dbPath, 0o600);
  for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(sidecar) && statSync(sidecar).size !== 0) throw new PipelineFailure("DB_HASH_UNAVAILABLE");
  }
  const stat = lstatSync(dbPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) throw new PipelineFailure("DB_HASH_UNAVAILABLE");
  return sha256(readFileSync(dbPath));
}

export function normalizeTextV1(value: string, title: boolean): string {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0 || (code >= 1 && code <= 31 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
      throw new PipelineFailure("CONTENT_NORMALIZATION_INVALID");
    }
  }
  const lines = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").replace(/^[\t ]+|[\t ]+$/g, ""));
  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  const normalized = title ? lines.join(" ").replace(/[\t ]+/g, " ") : lines.join("\n");
  return normalized;
}

export function syntheticQualityV1(title: string, body: string): string | null {
  if (!title || !body) return "CONTENT_EMPTY";
  if (title.startsWith("SYNTHETIC_ONLY:AD:") || body.startsWith("SYNTHETIC_ONLY:AD:")) return "CONTENT_OBVIOUS_AD";
  if (title.startsWith("SYNTHETIC_ONLY:SPAM:") || body.startsWith("SYNTHETIC_ONLY:SPAM:")) return "CONTENT_SPAM";
  if (title.startsWith("SYNTHETIC_ONLY:OFF_TOPIC:") || body.startsWith("SYNTHETIC_ONLY:OFF_TOPIC:")) return "CONTENT_F1_UNRELATED";
  if (!title.startsWith("SYNTHETIC_ONLY:F1:") && !body.startsWith("SYNTHETIC_ONLY:F1:")) return "CONTENT_RELEVANCE_UNKNOWN";
  return null;
}

export function eventFingerprintInput(candidate: Pick<Vs1Candidate, "content_kind" | "language" | "published_at">, normalizedTitle: string, normalizedBody: string): Record<string, unknown> {
  return {
    content_kind: candidate.content_kind,
    language: candidate.language,
    normalized_body: normalizedBody,
    normalized_title: normalizedTitle,
    published_day_utc: candidate.published_at ? new Date(candidate.published_at).toISOString().slice(0, 10) : null
  };
}

export function eventFingerprintV1(input: Record<string, unknown>): string {
  return sha256(canonicalJson(input));
}

type Graph = {
  capture: Record<string, unknown>;
  content: Record<string, unknown>;
  eventInput: Record<string, unknown>;
  eventFingerprint: string;
  summary: Record<string, unknown> | null;
  bundle: Record<string, unknown> | null;
};

type EventStatus = "canonical" | "merged" | "needs_review";

function eventPayload(
  eventId: string,
  fingerprint: string,
  canonicalContentId: string,
  memberContentIds: string[],
  status: EventStatus,
  clock: string,
  existing?: Record<string, unknown>
): Record<string, unknown> {
  const payload = {
    event_id: eventId,
    dedup_fingerprint: fingerprint,
    canonical_content_id: canonicalContentId,
    member_content_ids: memberContentIds,
    dedup_status: status,
    source_config_epoch: 1,
    created_at: existing?.created_at ?? clock,
    updated_at: clock,
    created_by_ref: existing?.created_by_ref ?? "synthetic:vs1-worker",
    updated_by_ref: "synthetic:vs1-worker"
  };
  const expectedKeys = ["canonical_content_id", "created_at", "created_by_ref", "dedup_fingerprint", "dedup_status", "event_id", "member_content_ids", "source_config_epoch", "updated_at", "updated_by_ref"];
  if (
    canonicalJson(Object.keys(payload).sort()) !== canonicalJson(expectedKeys) ||
    !/^event-[a-z0-9-]+$/.test(eventId) || !/^[a-f0-9]{64}$/.test(fingerprint) ||
    !/^content-[a-z0-9-]+$/.test(canonicalContentId) || memberContentIds.length === 0 ||
    new Set(memberContentIds).size !== memberContentIds.length || memberContentIds.some((id) => !/^content-[a-z0-9-]+$/.test(id)) ||
    !Number.isFinite(Date.parse(String(payload.created_at))) || !Number.isFinite(Date.parse(String(payload.updated_at))) ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(String(payload.created_by_ref)) || !/^[A-Za-z0-9._:-]{1,128}$/.test(String(payload.updated_by_ref))
  ) throw new PipelineFailure("SCHEMA_HASH_MISMATCH");
  return payload;
}

function buildGraph(
  fixtureBundle: Vs1FixtureBundle,
  candidate: Vs1Candidate,
  sourceId: string,
  mockSummary: { title_zh: string; summary_zh: string } | undefined,
  clock: string,
  overrides: { contentId?: string; captureId?: string } = {}
): Graph {
  const normalizedTitle = normalizeTextV1(candidate.title, true);
  const normalizedBody = normalizeTextV1(candidate.body, false);
  const captureId = overrides.captureId ?? derivedId("cap", { source_id: sourceId, external_content_id: candidate.external_id });
  const contentId = overrides.contentId ?? derivedId("content", {
    platform: "x", source_id: sourceId, external_content_id: candidate.external_id, canonical_url: candidate.external_url, content_version: "v1"
  });
  const contentHashInput = {
    content_id: contentId,
    source_id: sourceId,
    external_content_id: candidate.external_id,
    canonical_url: candidate.external_url,
    content_kind: candidate.content_kind,
    content_version: "v1",
    normalized_title: normalizedTitle,
    normalized_body: normalizedBody,
    language: candidate.language,
    source_evidence_url: fixtureBundle.seed.source.evidence_url,
    source_config_epoch: 1
  };
  const contentVersionHash = sha256(canonicalJson(contentHashInput));
  const capture = {
    capture_id: captureId,
    raw_url: candidate.external_url,
    capture_note: null,
    captured_at: clock,
    normalization_status: "valid",
    normalization_error: null,
    dedup_status: "pending",
    dedup_match_source_id: null,
    source_id: sourceId,
    canonical_url: candidate.external_url,
    content_id: contentId,
    source_config_epoch: 1,
    created_at: clock,
    updated_at: clock,
    created_by_ref: "synthetic:vs1-worker",
    updated_by_ref: "synthetic:vs1-worker"
  };
  const content = {
    content_id: contentId,
    source_id: sourceId,
    capture_id: captureId,
    external_content_id: candidate.external_id,
    external_url: candidate.external_url,
    canonical_url: candidate.external_url,
    content_kind: candidate.content_kind,
    content_status: "review_pending",
    published_at: candidate.published_at,
    captured_at: clock,
    content_version: "v1",
    content_version_hash: contentVersionHash,
    content_hash_input: contentHashInput,
    normalized_title: normalizedTitle,
    normalized_body: normalizedBody,
    language: candidate.language,
    source_evidence_url: fixtureBundle.seed.source.evidence_url,
    source_config_epoch: 1,
    created_at: clock,
    updated_at: clock,
    created_by_ref: "synthetic:vs1-worker",
    updated_by_ref: "synthetic:vs1-worker"
  };
  const eventInput = eventFingerprintInput(candidate, normalizedTitle, normalizedBody);
  const eventFingerprint = eventFingerprintV1(eventInput);
  if (!mockSummary) return { capture, content, eventInput, eventFingerprint, summary: null, bundle: null };
  const summaryId = derivedId("summary", { content_id: contentId, content_version_hash: contentVersionHash, summary_version: "v1", ...mockSummary });
  const summaryHashInput = {
    summary_id: summaryId,
    content_id: contentId,
    summary_version: "v1",
    title_zh: mockSummary.title_zh,
    summary_zh: mockSummary.summary_zh,
    language: "zh-CN",
    source_evidence_url: fixtureBundle.seed.source.evidence_url,
    input_content_hash: contentVersionHash,
    summary_schema_version: "summary-schema-v1",
    summarizer: "synthetic:mock-summary-v1",
    deterministic: true
  };
  const summaryVersionHash = sha256(canonicalJson(summaryHashInput));
  const summary = {
    summary_id: summaryId,
    content_id: contentId,
    summary_version: "v1",
    summary_version_hash: summaryVersionHash,
    summary_hash_input: summaryHashInput,
    input_content_hash: contentVersionHash,
    summary_schema_version: "summary-schema-v1",
    summarizer: "synthetic:mock-summary-v1",
    deterministic: true,
    title_zh: mockSummary.title_zh,
    summary_zh: mockSummary.summary_zh,
    summary_status: "ready",
    language: "zh-CN",
    source_evidence_url: fixtureBundle.seed.source.evidence_url,
    created_at: clock,
    updated_at: clock,
    created_by_ref: "synthetic:vs1-worker",
    updated_by_ref: "synthetic:vs1-worker"
  };
  const releaseBundleId = derivedId("bundle", { content_id: contentId, summary_id: summaryId, content_version_hash: contentVersionHash, summary_version_hash: summaryVersionHash });
  const canonicalPayload = {
    release_bundle_id: releaseBundleId,
    content_version_hash: contentVersionHash,
    summary_version_hash: summaryVersionHash,
    content_snapshot: {
      content_id: contentId, source_id: sourceId, external_content_id: candidate.external_id,
      canonical_url: candidate.external_url, content_kind: candidate.content_kind, content_version: "v1",
      normalized_title: normalizedTitle, normalized_body: normalizedBody, language: candidate.language,
      source_evidence_url: fixtureBundle.seed.source.evidence_url, source_config_epoch: 1,
      content_version_hash: contentVersionHash, capture_id: captureId, external_url: candidate.external_url,
      published_at: candidate.published_at, captured_at: clock
    },
    summary_snapshot: { ...summaryHashInput, summary_version_hash: summaryVersionHash },
    source_snapshot: {
      source_id: sourceId, canonical_url: fixtureBundle.seed.source.canonical_url, platform: "x",
      identity_status: fixtureBundle.seed.source.identity_status, source_config_epoch: 1, source_safety_epoch: 1
    },
    original_url: candidate.external_url,
    rights: { rights_status: "unknown", evidence_ref: "synthetic:vs1-rights-unknown" },
    media: [],
    policy: { policy_epoch: 1, publication_mode: "manual_only", manual_review_required: true, safety_rule_version: "safety-rule-v1" },
    schema: { domain_schema_version: "mvp-local-v0.3", payload_schema_version: "release-payload-v1", canonical_json_rule_version: "canonical-json-v1" },
    fences: { source_config_epoch: 1, source_safety_epoch: 1, authorization_version: 1, policy_epoch: 1, recovery_epoch: 1 }
  };
  const payloadHash = sha256(canonicalJson(canonicalPayload));
  const bundleHashInput = { release_bundle_id: releaseBundleId, bundle_version: "v1", payload_hash: payloadHash, canonical_json_rule_version: "canonical-json-v1", immutable: true };
  const bundle = {
    release_bundle_id: releaseBundleId,
    bundle_version: "v1",
    content_id: contentId,
    summary_id: summaryId,
    content_version_hash: contentVersionHash,
    summary_version_hash: summaryVersionHash,
    source_evidence_url: fixtureBundle.seed.source.evidence_url,
    canonical_json_rule_version: "canonical-json-v1",
    canonical_payload: canonicalPayload,
    payload_hash: payloadHash,
    bundle_hash_input: bundleHashInput,
    bundle_hash: sha256(canonicalJson(bundleHashInput)),
    release_status: "ready",
    immutable: true,
    assembled_at: clock,
    media_refs: [],
    source_config_epoch: 1,
    source_safety_epoch: 1,
    authorization_version: 1,
    policy_epoch: 1,
    recovery_epoch: 1,
    created_at: clock,
    updated_at: clock,
    created_by_ref: "synthetic:vs1-worker",
    updated_by_ref: "synthetic:vs1-worker"
  };
  return { capture, content, eventInput, eventFingerprint, summary, bundle };
}

function insertSource(database: DatabaseSync, source: Record<string, unknown>): void {
  database.prepare(
    "INSERT INTO source(source_id,platform,collection_onboarding_status,lifecycle_status,enabled,source_stop_status,adapter_status,adapter_authorization_status,platform_allowed,source_config_epoch,source_safety_epoch,onboarding_operation_id,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(
    sqlText(source.source_id), sqlText(source.platform), sqlText(source.collection_onboarding_status), sqlText(source.lifecycle_status),
    source.enabled === true ? 1 : 0, sqlText(source.source_stop_status), sqlText(source.adapter_status),
    sqlText(source.adapter_authorization_status), sqlText(source.platform_allowed), sqlInteger(source.source_config_epoch),
    sqlInteger(source.source_safety_epoch), sqlNullableText(source.onboarding_operation_id), canonicalJson(source)
  );
}

function insertGraph(database: DatabaseSync, graph: Graph, candidate: Vs1Candidate, sourceId: string, status: "ready" | "approved" = "ready"): void {
  database.prepare(
    "INSERT INTO captured_item(capture_id,source_id,external_content_id,normalization_status,dedup_status,content_id,payload_json) VALUES(?,?,?,?,?,?,?)"
  ).run(sqlText(graph.capture.capture_id), sourceId, candidate.external_id, "valid", "unique", sqlText(graph.content.content_id), canonicalJson({ ...graph.capture, dedup_status: "unique" }));
  database.prepare(
    "INSERT INTO content(content_id,platform,source_id,capture_id,external_content_id,content_version_hash,content_status,event_input_json,payload_json) VALUES(?,?,?,?,?,?,?,?,?)"
  ).run(
    sqlText(graph.content.content_id), "x", sourceId, sqlText(graph.capture.capture_id), candidate.external_id,
    sqlText(graph.content.content_version_hash), status === "approved" ? "approved" : "review_pending",
    canonicalJson(graph.eventInput), canonicalJson({ ...graph.content, content_status: status === "approved" ? "approved" : "review_pending" })
  );
  const eventId = derivedId("event", { dedup_fingerprint: graph.eventFingerprint });
  const seededEvent = eventPayload(eventId, graph.eventFingerprint, sqlText(graph.content.content_id), [sqlText(graph.content.content_id)], "canonical", sqlText(graph.content.created_at));
  database.prepare(
    "INSERT INTO event(event_id,dedup_fingerprint,canonical_content_id,member_content_ids_json,dedup_status,source_config_epoch,created_at,updated_at,created_by_ref,updated_by_ref,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ).run(
    eventId, graph.eventFingerprint, sqlText(graph.content.content_id), canonicalJson([graph.content.content_id]), "canonical", 1,
    sqlText(seededEvent.created_at), sqlText(seededEvent.updated_at), sqlText(seededEvent.created_by_ref), sqlText(seededEvent.updated_by_ref), canonicalJson(seededEvent)
  );
  if (graph.summary && graph.bundle) {
    const summaryPayload = { ...graph.summary, summary_status: status };
    const bundlePayload = { ...graph.bundle, release_status: status };
    database.prepare("INSERT INTO summary(summary_id,content_id,summary_version_hash,summary_status,payload_json) VALUES(?,?,?,?,?)")
      .run(sqlText(graph.summary.summary_id), sqlText(graph.content.content_id), sqlText(graph.summary.summary_version_hash), status, canonicalJson(summaryPayload));
    database.prepare("INSERT INTO release_bundle(release_bundle_id,content_id,summary_id,bundle_hash,release_status,immutable,payload_json) VALUES(?,?,?,?,?,1,?)")
      .run(sqlText(graph.bundle.release_bundle_id), sqlText(graph.content.content_id), sqlText(graph.summary.summary_id), sqlText(graph.bundle.bundle_hash), status, canonicalJson(bundlePayload));
  }
}

function preexistingSource(bundle: Vs1FixtureBundle): Record<string, unknown> {
  return {
    ...bundle.seed.source,
    source_id: "src-preexisting",
    handle: "synthetic_preexisting",
    raw_url: "https://synthetic.invalid/x/src-preexisting?share=synthetic",
    canonical_url: "https://synthetic.invalid/x/src-preexisting",
    onboarding_operation_id: "op-vs1-preexisting",
    evidence_url: "https://synthetic.invalid/evidence/src-preexisting"
  };
}

function findCandidate(fixtureCase: Vs1Case): { attempt: Vs1Attempt; candidate: Vs1Candidate } {
  const attempt = fixtureCase.attempts.find((candidateAttempt) => candidateAttempt.adapter_outcome === "candidate");
  if (!attempt?.candidate) throw new PipelineFailure("SEED_GRAPH_MISMATCH");
  return { attempt, candidate: attempt.candidate };
}

function seedPrecondition(database: DatabaseSync, bundle: Vs1FixtureBundle, fixtureCase: Vs1Case): void {
  if (["empty", "stale_fence", "no_work"].includes(fixtureCase.precondition)) return;
  const clock = bundle.seed.clock;
  const current = findCandidate(fixtureCase);
  if (fixtureCase.precondition === "same_content") {
    const graph = buildGraph(bundle, current.candidate, "src-queued", current.attempt.mock_summary, clock);
    insertGraph(database, graph, current.candidate, "src-queued");
    return;
  }
  insertSource(database, preexistingSource(bundle));
  if (fixtureCase.precondition === "same_event") {
    const graph = buildGraph(bundle, current.candidate, "src-preexisting", current.attempt.mock_summary, clock, {
      contentId: bundle.seed.precondition_graphs.same_event.existing_content_id,
      captureId: "cap-00000000000000000000000000000000"
    });
    insertGraph(database, graph, current.candidate, "src-preexisting");
    return;
  }
  if (fixtureCase.precondition === "different_day") {
    const happy = bundle.cases.find((entry) => entry.case_id === "VS1-HAPPY-001");
    if (!happy) throw new PipelineFailure("SEED_GRAPH_MISMATCH");
    const happyInput = findCandidate(happy);
    const graph = buildGraph(bundle, happyInput.candidate, "src-preexisting", happyInput.attempt.mock_summary, clock, {
      contentId: "content-00000000000000000000000000000001",
      captureId: "cap-00000000000000000000000000000001"
    });
    insertGraph(database, graph, happyInput.candidate, "src-preexisting");
    return;
  }
  if (fixtureCase.precondition === "fingerprint_collision") {
    const graph = buildGraph(bundle, current.candidate, "src-preexisting", current.attempt.mock_summary, clock, {
      contentId: "content-00000000000000000000000000000002",
      captureId: "cap-00000000000000000000000000000002"
    });
    database.prepare(
      "INSERT INTO captured_item(capture_id,source_id,external_content_id,normalization_status,dedup_status,content_id,payload_json) VALUES(?,?,?,?,?,?,?)"
    ).run(sqlText(graph.capture.capture_id), "src-preexisting", "synthetic-external-collision-existing", "valid", "unique", sqlText(graph.content.content_id), canonicalJson(graph.capture));
    database.prepare(
      "INSERT INTO content(content_id,platform,source_id,capture_id,external_content_id,content_version_hash,content_status,event_input_json,payload_json) VALUES(?,?,?,?,?,?,?,?,?)"
    ).run(
      sqlText(graph.content.content_id), "x", "src-preexisting", sqlText(graph.capture.capture_id), "synthetic-external-collision-existing",
      sqlText(graph.content.content_version_hash), "dedup_pending", canonicalJson({ ...graph.eventInput, normalized_body: "DIFFERENT_BYTES" }), canonicalJson({ ...graph.content, content_status: "dedup_pending" })
    );
    const eventId = derivedId("event", { dedup_fingerprint: graph.eventFingerprint });
    const collisionEvent = eventPayload(eventId, graph.eventFingerprint, sqlText(graph.content.content_id), [sqlText(graph.content.content_id)], "needs_review", clock);
    database.prepare(
      "INSERT INTO event(event_id,dedup_fingerprint,canonical_content_id,member_content_ids_json,dedup_status,source_config_epoch,created_at,updated_at,created_by_ref,updated_by_ref,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ).run(eventId, graph.eventFingerprint, sqlText(graph.content.content_id), canonicalJson([graph.content.content_id]), "needs_review", 1,
      sqlText(collisionEvent.created_at), sqlText(collisionEvent.updated_at), sqlText(collisionEvent.created_by_ref), sqlText(collisionEvent.updated_by_ref), canonicalJson(collisionEvent));
    return;
  }
  if (fixtureCase.precondition === "approved_chain") {
    const graph = buildGraph(bundle, current.candidate, "src-preexisting", current.attempt.mock_summary, clock, {
      contentId: bundle.seed.precondition_graphs.approved_chain.existing_content_id,
      captureId: "cap-ffffffffffffffffffffffffffffffff"
    });
    insertGraph(database, graph, current.candidate, "src-preexisting", "approved");
    if (!graph.summary || !graph.bundle) throw new PipelineFailure("SEED_GRAPH_MISMATCH");
    database.prepare("INSERT INTO review_decision(review_decision_id,content_id,summary_id,release_bundle_id,payload_json) VALUES(?,?,?,?,?)")
      .run("review-approved-chain-017", sqlText(graph.content.content_id), sqlText(graph.summary.summary_id), sqlText(graph.bundle.release_bundle_id), canonicalJson({ synthetic_only: true, decision: "approved" }));
    database.prepare("INSERT INTO publication(publication_id,content_id,summary_id,release_bundle_id,payload_json) VALUES(?,?,?,?,?)")
      .run("publication-approved-chain-017", sqlText(graph.content.content_id), sqlText(graph.summary.summary_id), sqlText(graph.bundle.release_bundle_id), canonicalJson({ synthetic_only: true, publication_status: "queued" }));
    return;
  }
  throw new PipelineFailure("SEED_GRAPH_MISMATCH");
}

type SeedIdentity = {
  slug: string;
  taskId: string;
  operationId: string;
  jobId: string;
  idempotencyKey: string;
  payloadHash: string;
  deadline: string;
};

function seedCase(database: DatabaseSync, bundle: Vs1FixtureBundle, fixtureCase: Vs1Case): SeedIdentity {
  const slug = fixtureCase.case_id.toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) throw new PipelineFailure("SEED_GRAPH_MISMATCH");
  const operationId = `op-vs1-${slug}`;
  const identity: SeedIdentity = {
    slug,
    taskId: `task-vs1-${slug}`,
    operationId,
    jobId: `job-vs1-${slug}`,
    idempotencyKey: `activate:src-queued:${operationId}`,
    payloadHash: sha256(canonicalJson({ case: fixtureCase, source_id: "src-queued" })),
    deadline: "2026-08-09T12:15:00Z"
  };
  const source = { ...bundle.seed.source, onboarding_operation_id: operationId };
  withImmediateTransaction(database, () => {
    insertSource(database, source);
    if (fixtureCase.precondition !== "no_work") {
      const envelope = {
        schema_version: "mvp-local-v0.3", envelope_type: "TaskEnvelope", task_id: identity.taskId,
        operation_id: operationId, aggregate_type: "source", aggregate_id: "src-queued", payload_hash: identity.payloadHash,
        source_config_epoch: 1, source_safety_epoch: 1, authorization_version: 1, policy_epoch: 1, recovery_epoch: 1,
        lease_token: "synthetic:lease:00000000000000000000000000000000", lease_expiry: "2026-08-09T12:05:00Z",
        deadline: identity.deadline, attempt: 1, idempotency_key: identity.idempotencyKey, reconcile_key: null
      };
      database.prepare(
        "INSERT INTO outbox_job(job_id,task_envelope,operation_id,operation_type,aggregate_type,aggregate_id,idempotency_key,reconcile_key,current_source_config_epoch,authorization_version,policy_epoch,recovery_epoch,job_status,attempt,max_attempts,payload_hash,last_error_code,next_attempt_at,published_at,created_at,updated_at,created_by_ref,updated_by_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).run(
        identity.jobId, canonicalJson(envelope), operationId, "source_activation", "source", "src-queued",
        identity.idempotencyKey, null, 1, 1, 1, 1, "pending", 0, 3, identity.payloadHash,
        null, bundle.seed.clock, null, bundle.seed.clock, bundle.seed.clock, "synthetic:vs1-worker", "synthetic:vs1-worker"
      );
    }
    seedPrecondition(database, bundle, fixtureCase);
  });
  const sourceRow = requireRow(database.prepare("SELECT * FROM source WHERE source_id='src-queued'").get() as Record<string, unknown> | undefined, "SEED_GRAPH_MISMATCH");
  const storedSource = parseJsonRecord(sourceRow.payload_json);
  if (canonicalJson(storedSource) !== canonicalJson(source)) throw new PipelineFailure("SEED_GRAPH_MISMATCH");
  const outboxCount = Number((database.prepare("SELECT COUNT(*) AS count FROM outbox_job").get() as Record<string, unknown>).count);
  if (outboxCount !== (fixtureCase.precondition === "no_work" ? 0 : 1)) throw new PipelineFailure("SEED_GRAPH_MISMATCH");
  return identity;
}

function updateSourceStatus(database: DatabaseSync, fromStatuses: readonly string[], status: string): void {
  if (fromStatuses.length === 0) throw new PipelineFailure("DB_CORRUPTION");
  const row = requireRow(database.prepare("SELECT collection_onboarding_status,payload_json FROM source WHERE source_id='src-queued'").get() as Record<string, unknown> | undefined, "DB_CORRUPTION");
  if (!fromStatuses.includes(sqlText(row.collection_onboarding_status))) throw new PipelineFailure("DB_CORRUPTION");
  const payload = parseJsonRecord(row.payload_json);
  if (payload.collection_onboarding_status !== row.collection_onboarding_status) throw new PipelineFailure("DB_CORRUPTION");
  payload.collection_onboarding_status = status;
  payload.updated_at = "2026-08-09T12:00:00Z";
  const placeholders = fromStatuses.map(() => "?").join(",");
  requireChanges(database.prepare(`UPDATE source SET collection_onboarding_status=?,payload_json=? WHERE source_id='src-queued' AND collection_onboarding_status IN (${placeholders})`)
    .run(status, canonicalJson(payload), ...fromStatuses).changes, "DB_CORRUPTION");
}

type LiveEnvelope = {
  schema_version: "mvp-local-v0.3";
  envelope_type: "TaskEnvelope";
  task_id: string;
  operation_id: string;
  aggregate_type: "source";
  aggregate_id: "src-queued";
  payload_hash: string;
  source_config_epoch: number;
  source_safety_epoch: number;
  authorization_version: 1;
  policy_epoch: 1;
  recovery_epoch: 1;
  lease_token: string;
  lease_expiry: string;
  deadline: string;
  attempt: number;
  idempotency_key: string;
  reconcile_key: null;
};

type AcquiredAttempt = {
  envelope: LiveEnvelope;
  envelopeHash: string;
  attempt: number;
  clock: string;
};

function acquireAttempt(database: DatabaseSync, identity: SeedIdentity, clock: string): AcquiredAttempt {
  return withImmediateTransaction(database, () => {
    const job = requireRow(database.prepare(
      "SELECT * FROM outbox_job WHERE job_status IN ('pending','retryable_failed') AND next_attempt_at<=? ORDER BY next_attempt_at,job_id LIMIT 1"
    ).get(clock) as Record<string, unknown> | undefined, "NO_WORK");
    if (job.job_id !== identity.jobId || Number(job.attempt) >= 3 || job.payload_hash !== identity.payloadHash || job.idempotency_key !== identity.idempotencyKey) {
      throw new PipelineFailure("LEASE_INVALID");
    }
    const source = requireRow(database.prepare("SELECT * FROM source WHERE source_id='src-queued'").get() as Record<string, unknown> | undefined, "STALE_FENCE");
    if (
      Number(source.enabled) !== 1 || source.source_stop_status !== "clear" || source.adapter_status !== "ready" ||
      source.adapter_authorization_status !== "valid" || source.platform_allowed !== "allowed"
    ) throw new PipelineFailure("STOP_ASSERTED");
    if (
      Number(source.source_config_epoch) !== Number(job.current_source_config_epoch) ||
      Number(source.source_safety_epoch) !== 1 || Number(job.authorization_version) !== 1 ||
      Number(job.policy_epoch) !== 1 || Number(job.recovery_epoch) !== 1
    ) throw new PipelineFailure("STALE_FENCE");
    const attempt = Number(job.attempt) + 1;
    const started = new Date(clock);
    const leaseExpiry = new Date(started.getTime() + 300_000).toISOString().replace(".000Z", "Z");
    const token = `synthetic:lease:${randomBytes(16).toString("hex")}`;
    const envelope: LiveEnvelope = {
      schema_version: "mvp-local-v0.3", envelope_type: "TaskEnvelope", task_id: identity.taskId,
      operation_id: identity.operationId, aggregate_type: "source", aggregate_id: "src-queued", payload_hash: identity.payloadHash,
      source_config_epoch: 1, source_safety_epoch: 1, authorization_version: 1, policy_epoch: 1, recovery_epoch: 1,
      lease_token: token, lease_expiry: leaseExpiry, deadline: identity.deadline, attempt,
      idempotency_key: identity.idempotencyKey, reconcile_key: null
    };
    if (!(started.getTime() < Date.parse(leaseExpiry) && Date.parse(leaseExpiry) <= Date.parse(identity.deadline) && Date.parse(identity.deadline) <= started.getTime() + 900_000)) {
      throw new PipelineFailure("LEASE_INVALID");
    }
    const envelopeBytes = canonicalJson(envelope);
    const envelopeHash = sha256(envelopeBytes);
    requireChanges(database.prepare(
      "UPDATE outbox_job SET task_envelope=?,job_status='leased',attempt=?,updated_at=? WHERE job_id=? AND job_status IN ('pending','retryable_failed') AND attempt=?"
    ).run(envelopeBytes, attempt, clock, identity.jobId, attempt - 1).changes, "LEASE_INVALID");
    const inbox = database.prepare("SELECT inbox_id FROM inbox WHERE operation_id=? AND idempotency_key=?").get(identity.operationId, identity.idempotencyKey) as Record<string, unknown> | undefined;
    if (inbox) {
      requireChanges(database.prepare("UPDATE inbox SET task_envelope=?,envelope_hash=?,inbox_status='received',last_error_code=NULL WHERE inbox_id=?")
        .run(envelopeBytes, envelopeHash, sqlText(inbox.inbox_id)).changes, "LEASE_INVALID");
    } else {
      database.prepare(
        "INSERT INTO inbox(inbox_id,job_id,task_envelope,envelope_hash,operation_id,idempotency_key,received_at,inbox_status,last_error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
      ).run(derivedId("inbox", { operation_id: identity.operationId, idempotency_key: identity.idempotencyKey }), identity.jobId, envelopeBytes, envelopeHash, identity.operationId, identity.idempotencyKey, clock, "received", null, clock);
    }
    database.prepare(
      "INSERT INTO task_attempt(attempt_id,job_id,attempt_no,lease_token,lease_expiry,deadline,worker_ref,started_at,finished_at,attempt_status,error_code,envelope_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(derivedId("attempt", { job_id: identity.jobId, attempt }), identity.jobId, attempt, token, leaseExpiry, identity.deadline, "synthetic:vs1-worker", clock, null, "leased", null, envelopeHash);
    updateSourceStatus(database, ["queued", "collection_failed"], "collecting");
    return { envelope, envelopeHash, attempt, clock };
  });
}

function validateLeaseIdentity(database: DatabaseSync, identity: SeedIdentity, acquired: AcquiredAttempt): { job: Record<string, unknown>; source: Record<string, unknown> } {
  const job = requireRow(database.prepare("SELECT * FROM outbox_job WHERE job_id=?").get(identity.jobId) as Record<string, unknown> | undefined, "LEASE_INVALID");
  const source = requireRow(database.prepare("SELECT * FROM source WHERE source_id='src-queued'").get() as Record<string, unknown> | undefined, "STALE_FENCE");
  const inbox = requireRow(database.prepare("SELECT * FROM inbox WHERE operation_id=? AND idempotency_key=?").get(identity.operationId, identity.idempotencyKey) as Record<string, unknown> | undefined, "LEASE_INVALID");
  const attempt = requireRow(database.prepare("SELECT * FROM task_attempt WHERE job_id=? AND attempt_no=?").get(identity.jobId, acquired.attempt) as Record<string, unknown> | undefined, "LEASE_INVALID");
  if (
    job.job_status !== "leased" || job.task_envelope !== canonicalJson(acquired.envelope) || inbox.task_envelope !== canonicalJson(acquired.envelope) ||
    sha256(String(job.task_envelope)) !== acquired.envelopeHash || sha256(String(inbox.task_envelope)) !== acquired.envelopeHash || inbox.envelope_hash !== acquired.envelopeHash ||
    attempt.envelope_hash !== acquired.envelopeHash || attempt.lease_token !== acquired.envelope.lease_token ||
    attempt.lease_expiry !== acquired.envelope.lease_expiry || attempt.deadline !== acquired.envelope.deadline ||
    Date.parse(acquired.clock) >= Date.parse(acquired.envelope.lease_expiry)
  ) throw new PipelineFailure("LEASE_INVALID");
  return { job, source };
}

function validateCurrentLease(database: DatabaseSync, identity: SeedIdentity, acquired: AcquiredAttempt): void {
  const { job, source } = validateLeaseIdentity(database, identity, acquired);
  if (
    Number(source.source_config_epoch) !== acquired.envelope.source_config_epoch ||
    Number(source.source_safety_epoch) !== acquired.envelope.source_safety_epoch ||
    Number(job.authorization_version) !== acquired.envelope.authorization_version ||
    Number(job.policy_epoch) !== acquired.envelope.policy_epoch ||
    Number(job.recovery_epoch) !== acquired.envelope.recovery_epoch
  ) throw new PipelineFailure("STALE_FENCE");
  if (Number(source.enabled) !== 1 || source.source_stop_status !== "clear") throw new PipelineFailure("STOP_ASSERTED");
}

function insertAudit(database: DatabaseSync, bundle: Vs1FixtureBundle, identity: SeedIdentity, attempt: number, clock: string, reasonCode: string): void {
  const row = database.prepare("SELECT COALESCE(MAX(monotonic_seq),0)+1 AS seq FROM audit_event").get() as Record<string, unknown>;
  const seq = Number(row.seq);
  const payload = {
    event_id: derivedId("event-audit", { operation_id: identity.operationId, attempt, reason_code: reasonCode }),
    monotonic_seq: seq,
    occurred_at: clock,
    clock_status: "trusted_synthetic",
    trace_ref: `synthetic:trace-${identity.slug}`,
    session_hash: sha256(canonicalJson({ operation_id: identity.operationId, task_id: identity.taskId })),
    reason_code: reasonCode,
    owner: "synthetic:owner-vs1-worker",
    operation_id: identity.operationId,
    task_id: identity.taskId,
    source_config_epoch: 1,
    source_safety_epoch: 1,
    authorization_version: 1,
    policy_epoch: 1,
    recovery_epoch: 1,
    attempt,
    payload_hash: identity.payloadHash,
    fixture_hash: bundle.fixtureHash,
    schema_hash: bundle.schemaHash,
    redaction_version: "redaction-v1",
    retention: "audit_synthetic",
    cleanup_after: "2026-08-10T12:00:00Z",
    append_only: true,
    internal_only: true,
    external_calls: 0
  };
  database.prepare(
    "INSERT INTO audit_event(event_id,monotonic_seq,reason_code,operation_id,task_id,attempt,payload_hash,fixture_hash,schema_hash,append_only,internal_only,external_calls,payload_json) VALUES(?,?,?,?,?,?,?,?,?,1,1,0,?)"
  ).run(payload.event_id, seq, reasonCode, identity.operationId, identity.taskId, attempt, identity.payloadHash, bundle.fixtureHash, bundle.schemaHash, canonicalJson(payload));
}

function maybeFault(attempt: Vs1Attempt, point: keyof typeof FAULT_REASON): void {
  if (attempt.fault_injection === point) throw new PipelineFailure(FAULT_REASON[point]);
}

type ProcessResult = {
  reasonCode: string;
  transactionCommitted: boolean;
  canonicalIds: Vs1FullReceipt["canonicalIds"];
  contentHash: string | null;
  eventHash: string | null;
  summaryHash: string | null;
  bundleHash: string | null;
};

function finishSuccess(
  database: DatabaseSync,
  bundle: Vs1FixtureBundle,
  identity: SeedIdentity,
  acquired: AcquiredAttempt,
  attempt: Vs1Attempt,
  reasonCode: string,
  transactionSequence: string[]
): void {
  maybeFault(attempt, "before_ack_cas");
  transactionSequence.push("ack_cas");
  requireChanges(database.prepare("UPDATE inbox SET inbox_status='acked',last_error_code=NULL WHERE operation_id=? AND idempotency_key=? AND inbox_status='processing'")
    .run(identity.operationId, identity.idempotencyKey).changes, "TX_ACK_CAS_FAILED");
  requireChanges(database.prepare("UPDATE task_attempt SET attempt_status='succeeded',finished_at=?,error_code=NULL WHERE job_id=? AND attempt_no=? AND attempt_status='leased'")
    .run(acquired.clock, identity.jobId, acquired.attempt).changes, "TX_ACK_CAS_FAILED");
  requireChanges(database.prepare("UPDATE outbox_job SET job_status='succeeded',last_error_code=NULL,next_attempt_at=NULL,updated_at=? WHERE job_id=? AND job_status='leased' AND attempt=?")
    .run(acquired.clock, identity.jobId, acquired.attempt).changes, "TX_ACK_CAS_FAILED");
  updateSourceStatus(database, ["collecting"], "active");
  maybeFault(attempt, "before_audit");
  transactionSequence.push("audit_append");
  insertAudit(database, bundle, identity, acquired.attempt, acquired.clock, reasonCode);
}

function processCandidate(
  database: DatabaseSync,
  bundle: Vs1FixtureBundle,
  fixtureCase: Vs1Case,
  identity: SeedIdentity,
  acquired: AcquiredAttempt,
  attempt: Vs1Attempt,
  transactionSequence: string[]
): ProcessResult {
  const candidate = attempt.candidate;
  if (!candidate) throw new PipelineFailure("INVALID_FIXTURE");
  return withImmediateTransaction(database, () => {
    transactionSequence.push("lease_fence_recheck");
    validateCurrentLease(database, identity, acquired);
    const observationId = derivedId("observation", { source_id: "src-queued", external_id: candidate.external_id });
    const observation = {
      observation_id: observationId,
      unique_key: `source-observation:src-queued:${candidate.external_id}`,
      owner_ref: "synthetic:owner-vs1-worker",
      source_id: "src-queued",
      external_id: candidate.external_id,
      observed_at: acquired.clock,
      discovered_at: acquired.clock,
      published_at: candidate.published_at,
      cursor_ref: `synthetic:cursor-${identity.slug}`,
      response_hash: sha256(canonicalJson(candidate)),
      error_class: "none",
      source_config_epoch: 1,
      source_safety_epoch: 1,
      operation_id: identity.operationId,
      idempotency_key: identity.idempotencyKey,
      payload_hash: identity.payloadHash,
      internal_only: true
    };
    database.prepare(
      "INSERT OR IGNORE INTO source_observation(observation_id,unique_key,owner_ref,source_id,external_id,observed_at,discovered_at,published_at,cursor_ref,response_hash,error_class,source_config_epoch,source_safety_epoch,operation_id,idempotency_key,payload_hash,internal_only,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)"
    ).run(
      observationId, observation.unique_key, observation.owner_ref, "src-queued", candidate.external_id,
      acquired.clock, acquired.clock, candidate.published_at, observation.cursor_ref, observation.response_hash,
      "none", 1, 1, identity.operationId, identity.idempotencyKey, identity.payloadHash, canonicalJson(observation)
    );
    const observationColumns: Record<string, unknown> = {
      observation_id: observationId, unique_key: observation.unique_key, owner_ref: observation.owner_ref, source_id: "src-queued",
      external_id: candidate.external_id, observed_at: acquired.clock, discovered_at: acquired.clock, published_at: candidate.published_at,
      cursor_ref: observation.cursor_ref, response_hash: observation.response_hash, error_class: "none", source_config_epoch: 1,
      source_safety_epoch: 1, operation_id: identity.operationId, idempotency_key: identity.idempotencyKey,
      payload_hash: identity.payloadHash, internal_only: 1
    };
    assertVs1InsertOrReturnRow(database.prepare("SELECT * FROM source_observation WHERE observation_id=?").get(observationId) as Record<string, unknown> | undefined, observationColumns, observation);
    transactionSequence.push("observation_insert_or_return");
    requireChanges(database.prepare("UPDATE inbox SET inbox_status='processing' WHERE operation_id=? AND idempotency_key=? AND inbox_status='received'")
      .run(identity.operationId, identity.idempotencyKey).changes, "LEASE_INVALID");
    transactionSequence.push("inbox_processing");
    const captureId = derivedId("cap", { source_id: "src-queued", external_content_id: candidate.external_id });
    const capture = {
      capture_id: captureId, raw_url: candidate.external_url, capture_note: null, captured_at: acquired.clock,
      normalization_status: "valid", normalization_error: null, dedup_status: "pending", dedup_match_source_id: null,
      source_id: "src-queued", canonical_url: candidate.external_url, content_id: null, source_config_epoch: 1,
      created_at: acquired.clock, updated_at: acquired.clock, created_by_ref: "synthetic:vs1-worker", updated_by_ref: "synthetic:vs1-worker"
    };
    const captureInsert = database.prepare(
      "INSERT OR IGNORE INTO captured_item(capture_id,source_id,external_content_id,normalization_status,dedup_status,content_id,payload_json) VALUES(?,?,?,?,?,?,?)"
    ).run(captureId, "src-queued", candidate.external_id, "valid", "pending", null, canonicalJson(capture));
    const storedCapture = requireRow(database.prepare("SELECT * FROM captured_item WHERE capture_id=?").get(captureId) as Record<string, unknown> | undefined, "DB_CORRUPTION");
    let expectedCapturePayload: Record<string, unknown> = capture;
    let expectedDedupStatus = "pending";
    let expectedContentId: string | null = null;
    if (Number(captureInsert.changes) === 0) {
      if (fixtureCase.precondition !== "same_content") throw new PipelineFailure("DB_CORRUPTION");
      const existingGraph = buildGraph(bundle, candidate, "src-queued", attempt.mock_summary, acquired.clock);
      expectedCapturePayload = { ...existingGraph.capture, dedup_status: "unique" };
      expectedDedupStatus = "unique";
      expectedContentId = sqlText(existingGraph.content.content_id);
    }
    assertVs1InsertOrReturnRow(storedCapture, {
      capture_id: captureId, source_id: "src-queued", external_content_id: candidate.external_id,
      normalization_status: "valid", dedup_status: expectedDedupStatus, content_id: expectedContentId
    }, expectedCapturePayload);
    transactionSequence.push("capture_insert_or_return");
    maybeFault(attempt, "after_capture");
    let normalizedTitle: string;
    let normalizedBody: string;
    try {
      normalizedTitle = normalizeTextV1(candidate.title, true);
      normalizedBody = normalizeTextV1(candidate.body, false);
    } catch (error) {
      if (error instanceof PipelineFailure && error.reasonCode === "CONTENT_NORMALIZATION_INVALID") {
        finishSuccess(database, bundle, identity, acquired, attempt, error.reasonCode, transactionSequence);
        return { reasonCode: error.reasonCode, transactionCommitted: true, canonicalIds: { contentId: null, eventId: null, summaryId: null, bundleId: null }, contentHash: null, eventHash: null, summaryHash: null, bundleHash: null };
      }
      throw error;
    }
    const qualityReason = syntheticQualityV1(normalizedTitle, normalizedBody);
    if (qualityReason) {
      finishSuccess(database, bundle, identity, acquired, attempt, qualityReason, transactionSequence);
      return { reasonCode: qualityReason, transactionCommitted: true, canonicalIds: { contentId: null, eventId: null, summaryId: null, bundleId: null }, contentHash: null, eventHash: null, summaryHash: null, bundleHash: null };
    }
    const graph = buildGraph(bundle, candidate, "src-queued", attempt.mock_summary, acquired.clock);
    const existingContent = database.prepare(
      "SELECT * FROM content WHERE platform='x' AND source_id='src-queued' AND external_content_id=? AND content_version_hash=?"
    ).get(candidate.external_id, sqlText(graph.content.content_version_hash)) as Record<string, unknown> | undefined;
    if (existingContent) {
      const existingPayload = parseJsonRecord(existingContent.payload_json);
      if (
        existingContent.content_id !== graph.content.content_id || existingContent.event_input_json !== canonicalJson(graph.eventInput) ||
        existingPayload.content_version_hash !== graph.content.content_version_hash || existingPayload.canonical_url !== graph.content.canonical_url
      ) throw new PipelineFailure("DB_CORRUPTION");
      if (Number(captureInsert.changes) === 1) {
        requireChanges(database.prepare("UPDATE captured_item SET dedup_status='linked_existing',content_id=?,payload_json=? WHERE capture_id=? AND dedup_status='pending' AND content_id IS NULL")
          .run(sqlText(existingContent.content_id), canonicalJson({ ...capture, dedup_status: "linked_existing", content_id: existingContent.content_id }), captureId).changes, "DB_CORRUPTION");
      } else if (storedCapture.content_id !== existingContent.content_id || !["unique", "linked_existing"].includes(sqlText(storedCapture.dedup_status))) {
        throw new PipelineFailure("DB_CORRUPTION");
      }
      finishSuccess(database, bundle, identity, acquired, attempt, "CONTENT_DUPLICATE_REUSED", transactionSequence);
      return {
        reasonCode: "CONTENT_DUPLICATE_REUSED", transactionCommitted: true,
        canonicalIds: { contentId: String(existingContent.content_id), eventId: null, summaryId: null, bundleId: null },
        contentHash: String(existingContent.content_version_hash), eventHash: null, summaryHash: null, bundleHash: null
      };
    }
    database.prepare(
      "INSERT INTO content(content_id,platform,source_id,capture_id,external_content_id,content_version_hash,content_status,event_input_json,payload_json) VALUES(?,?,?,?,?,?,?,?,?)"
    ).run(sqlText(graph.content.content_id), "x", "src-queued", captureId, candidate.external_id, sqlText(graph.content.content_version_hash), "captured", canonicalJson(graph.eventInput), canonicalJson({ ...graph.content, content_status: "captured" }));
    requireChanges(database.prepare("UPDATE content SET content_status='normalized',payload_json=? WHERE content_id=? AND content_status='captured'")
      .run(canonicalJson({ ...graph.content, content_status: "normalized" }), sqlText(graph.content.content_id)).changes, "TX_CONTENT_WRITE_FAILED");
    requireChanges(database.prepare("UPDATE content SET content_status='dedup_pending',payload_json=? WHERE content_id=? AND content_status='normalized'")
      .run(canonicalJson({ ...graph.content, content_status: "dedup_pending" }), sqlText(graph.content.content_id)).changes, "TX_CONTENT_WRITE_FAILED");
    transactionSequence.push("content_captured_normalized_dedup_pending");
    maybeFault(attempt, "after_content");
    const eventId = derivedId("event", { dedup_fingerprint: graph.eventFingerprint });
    const existingEvent = database.prepare("SELECT * FROM event WHERE dedup_fingerprint=?").get(graph.eventFingerprint) as Record<string, unknown> | undefined;
    let canonicalContentId = String(graph.content.content_id);
    let currentIsCanonical = true;
    let reasonCode = fixtureCase.precondition === "different_day" ? "EVENT_NEW_DAY" : "PIPELINE_READY";
    if (existingEvent) {
      const oldEventPayload = parseJsonRecord(existingEvent.payload_json);
      const oldMembersValue = JSON.parse(sqlText(existingEvent.member_content_ids_json)) as unknown;
      if (!Array.isArray(oldMembersValue) || oldMembersValue.some((value) => typeof value !== "string")) throw new PipelineFailure("DB_CORRUPTION");
      const existingMembers = oldMembersValue as string[];
      const expectedOldPayload = eventPayload(
        sqlText(existingEvent.event_id), sqlText(existingEvent.dedup_fingerprint), sqlText(existingEvent.canonical_content_id), existingMembers,
        sqlText(existingEvent.dedup_status) as EventStatus, sqlText(existingEvent.updated_at), oldEventPayload
      );
      if (
        canonicalJson(oldEventPayload) !== canonicalJson(expectedOldPayload) ||
        existingEvent.created_at !== oldEventPayload.created_at || existingEvent.updated_at !== oldEventPayload.updated_at ||
        existingEvent.created_by_ref !== oldEventPayload.created_by_ref || existingEvent.updated_by_ref !== oldEventPayload.updated_by_ref
      ) throw new PipelineFailure("DB_CORRUPTION");
      const existingCanonical = requireRow(database.prepare("SELECT * FROM content WHERE content_id=?").get(sqlText(existingEvent.canonical_content_id)) as Record<string, unknown> | undefined, "DEDUP_COLLISION_UNRESOLVED");
      if (String(existingCanonical.event_input_json) !== canonicalJson(graph.eventInput)) {
        const collisionPayload = eventPayload(
          sqlText(existingEvent.event_id), graph.eventFingerprint, sqlText(existingEvent.canonical_content_id), existingMembers, "needs_review", acquired.clock, oldEventPayload
        );
        requireChanges(database.prepare(
          "UPDATE event SET dedup_status='needs_review',updated_at=?,updated_by_ref=?,payload_json=? WHERE event_id=? AND dedup_fingerprint=? AND canonical_content_id=? AND member_content_ids_json=? AND dedup_status=? AND source_config_epoch=? AND updated_at=?"
        ).run(
          sqlText(collisionPayload.updated_at), sqlText(collisionPayload.updated_by_ref), canonicalJson(collisionPayload), sqlText(existingEvent.event_id), graph.eventFingerprint,
          sqlText(existingEvent.canonical_content_id), sqlText(existingEvent.member_content_ids_json), sqlText(existingEvent.dedup_status), sqlInteger(existingEvent.source_config_epoch), sqlText(existingEvent.updated_at)
        ).changes, "TX_EVENT_CAS_FAILED");
        requireChanges(database.prepare("UPDATE captured_item SET dedup_status='needs_review',content_id=?,payload_json=? WHERE capture_id=? AND dedup_status='pending'")
          .run(sqlText(graph.content.content_id), canonicalJson({ ...capture, dedup_status: "needs_review", content_id: graph.content.content_id }), captureId).changes, "TX_EVENT_CAS_FAILED");
        transactionSequence.push("event_collision_needs_review");
        finishSuccess(database, bundle, identity, acquired, attempt, "DEDUP_COLLISION_UNRESOLVED", transactionSequence);
        return {
          reasonCode: "DEDUP_COLLISION_UNRESOLVED", transactionCommitted: true,
          canonicalIds: { contentId: String(graph.content.content_id), eventId: String(existingEvent.event_id), summaryId: null, bundleId: null },
          contentHash: String(graph.content.content_version_hash), eventHash: graph.eventFingerprint, summaryHash: null, bundleHash: null
        };
      }
      const memberRows = [...new Set([...existingMembers, String(graph.content.content_id)])].map((contentId) => {
        const row = requireRow(database.prepare("SELECT content_id,content_version_hash,capture_id FROM content WHERE content_id=?").get(contentId) as Record<string, unknown> | undefined, "DB_CORRUPTION");
        return { contentId: String(row.content_id), contentVersionHash: String(row.content_version_hash), captureId: row.capture_id === null ? "" : String(row.capture_id) };
      }).sort((left, right) => {
        const leftKey = [left.contentId, left.contentVersionHash, left.captureId];
        const rightKey = [right.contentId, right.contentVersionHash, right.captureId];
        for (let index = 0; index < leftKey.length; index += 1) {
          if (leftKey[index] < rightKey[index]) return -1;
          if (leftKey[index] > rightKey[index]) return 1;
        }
        return 0;
      });
      canonicalContentId = memberRows[0].contentId;
      currentIsCanonical = canonicalContentId === graph.content.content_id;
      if (canonicalContentId !== existingEvent.canonical_content_id) {
        const approved = Number((database.prepare("SELECT COUNT(*) AS count FROM review_decision WHERE content_id=?").get(sqlText(existingEvent.canonical_content_id)) as Record<string, unknown>).count) > 0 ||
          Number((database.prepare("SELECT COUNT(*) AS count FROM publication WHERE content_id=?").get(sqlText(existingEvent.canonical_content_id)) as Record<string, unknown>).count) > 0 ||
          Number((database.prepare("SELECT COUNT(*) AS count FROM summary WHERE content_id=? AND summary_status IN ('approved','rejected')").get(sqlText(existingEvent.canonical_content_id)) as Record<string, unknown>).count) > 0;
        if (approved) throw new PipelineFailure("APPROVED_CHAIN_PRESENT");
        requireChanges(database.prepare("UPDATE summary SET summary_status='superseded',payload_json=json_set(payload_json,'$.summary_status','superseded') WHERE content_id=? AND summary_status='ready'")
          .run(sqlText(existingEvent.canonical_content_id)).changes, "APPROVED_CHAIN_PRESENT");
        requireChanges(database.prepare("UPDATE release_bundle SET release_status='superseded',payload_json=json_set(payload_json,'$.release_status','superseded') WHERE content_id=? AND release_status='ready'")
          .run(sqlText(existingEvent.canonical_content_id)).changes, "APPROVED_CHAIN_PRESENT");
      }
      const members = memberRows.map((row) => row.contentId);
      const mergedPayload = eventPayload(sqlText(existingEvent.event_id), graph.eventFingerprint, canonicalContentId, members, "merged", acquired.clock, oldEventPayload);
      requireChanges(database.prepare(
        "UPDATE event SET canonical_content_id=?,member_content_ids_json=?,dedup_status='merged',updated_at=?,updated_by_ref=?,payload_json=? WHERE event_id=? AND dedup_fingerprint=? AND canonical_content_id=? AND member_content_ids_json=? AND dedup_status=? AND source_config_epoch=? AND updated_at=?"
      ).run(
        canonicalContentId, canonicalJson(members), sqlText(mergedPayload.updated_at), sqlText(mergedPayload.updated_by_ref), canonicalJson(mergedPayload),
        sqlText(existingEvent.event_id), graph.eventFingerprint, sqlText(existingEvent.canonical_content_id), sqlText(existingEvent.member_content_ids_json),
        sqlText(existingEvent.dedup_status), sqlInteger(existingEvent.source_config_epoch), sqlText(existingEvent.updated_at)
      ).changes, "TX_EVENT_CAS_FAILED");
      reasonCode = "EVENT_MEMBER_MERGED";
    } else {
      const newEvent = eventPayload(eventId, graph.eventFingerprint, sqlText(graph.content.content_id), [sqlText(graph.content.content_id)], "canonical", acquired.clock);
      database.prepare(
        "INSERT INTO event(event_id,dedup_fingerprint,canonical_content_id,member_content_ids_json,dedup_status,source_config_epoch,created_at,updated_at,created_by_ref,updated_by_ref,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
      ).run(eventId, graph.eventFingerprint, sqlText(graph.content.content_id), canonicalJson([graph.content.content_id]), "canonical", 1,
        sqlText(newEvent.created_at), sqlText(newEvent.updated_at), sqlText(newEvent.created_by_ref), sqlText(newEvent.updated_by_ref), canonicalJson(newEvent));
    }
    transactionSequence.push("event_fingerprint_union_cas");
    maybeFault(attempt, "after_event");
    if (!currentIsCanonical) {
      requireChanges(database.prepare("UPDATE captured_item SET dedup_status='linked_existing',content_id=?,payload_json=? WHERE capture_id=?")
        .run(sqlText(graph.content.content_id), canonicalJson({ ...capture, dedup_status: "linked_existing", content_id: graph.content.content_id }), captureId).changes, "TX_EVENT_CAS_FAILED");
      finishSuccess(database, bundle, identity, acquired, attempt, reasonCode, transactionSequence);
      return {
        reasonCode, transactionCommitted: true,
        canonicalIds: { contentId: canonicalContentId, eventId: existingEvent ? String(existingEvent.event_id) : eventId, summaryId: null, bundleId: null },
        contentHash: String(graph.content.content_version_hash), eventHash: graph.eventFingerprint, summaryHash: null, bundleHash: null
      };
    }
    requireChanges(database.prepare("UPDATE content SET content_status='review_pending',payload_json=? WHERE content_id=? AND content_status='dedup_pending'")
      .run(canonicalJson({ ...graph.content, content_status: "review_pending" }), sqlText(graph.content.content_id)).changes, "TX_CONTENT_WRITE_FAILED");
    requireChanges(database.prepare("UPDATE captured_item SET dedup_status='unique',content_id=?,payload_json=? WHERE capture_id=?")
      .run(sqlText(graph.content.content_id), canonicalJson({ ...capture, dedup_status: "unique", content_id: graph.content.content_id }), captureId).changes, "TX_EVENT_CAS_FAILED");
    if (!graph.summary) {
      transactionSequence.push("summary_allowlist_lookup_miss");
      throw new PipelineFailure("SUMMARY_FIXTURE_NOT_ALLOWLISTED");
    }
    database.prepare("INSERT OR IGNORE INTO summary(summary_id,content_id,summary_version_hash,summary_status,payload_json) VALUES(?,?,?,?,?)")
      .run(sqlText(graph.summary.summary_id), sqlText(graph.content.content_id), sqlText(graph.summary.summary_version_hash), "ready", canonicalJson(graph.summary));
    const storedSummary = requireCanonicalPayload(database.prepare("SELECT * FROM summary WHERE summary_id=?").get(sqlText(graph.summary.summary_id)) as Record<string, unknown> | undefined, graph.summary);
    if (storedSummary.content_id !== graph.content.content_id || storedSummary.summary_version_hash !== graph.summary.summary_version_hash || storedSummary.summary_status !== "ready") {
      throw new PipelineFailure("DB_CORRUPTION");
    }
    transactionSequence.push("summary_insert_or_return");
    maybeFault(attempt, "after_summary");
    if (!graph.bundle) throw new PipelineFailure("SUMMARY_FIXTURE_NOT_ALLOWLISTED");
    database.prepare("INSERT OR IGNORE INTO release_bundle(release_bundle_id,content_id,summary_id,bundle_hash,release_status,immutable,payload_json) VALUES(?,?,?,?,?,1,?)")
      .run(sqlText(graph.bundle.release_bundle_id), sqlText(graph.content.content_id), sqlText(graph.summary.summary_id), sqlText(graph.bundle.bundle_hash), "ready", canonicalJson(graph.bundle));
    const storedBundle = requireCanonicalPayload(database.prepare("SELECT * FROM release_bundle WHERE release_bundle_id=?").get(sqlText(graph.bundle.release_bundle_id)) as Record<string, unknown> | undefined, graph.bundle);
    if (storedBundle.content_id !== graph.content.content_id || storedBundle.summary_id !== graph.summary.summary_id || storedBundle.bundle_hash !== graph.bundle.bundle_hash || storedBundle.release_status !== "ready") {
      throw new PipelineFailure("DB_CORRUPTION");
    }
    transactionSequence.push("bundle_insert_or_return");
    maybeFault(attempt, "after_bundle");
    finishSuccess(database, bundle, identity, acquired, attempt, reasonCode, transactionSequence);
    return {
      reasonCode, transactionCommitted: true,
      canonicalIds: { contentId: String(graph.content.content_id), eventId: existingEvent ? String(existingEvent.event_id) : eventId, summaryId: String(graph.summary.summary_id), bundleId: String(graph.bundle.release_bundle_id) },
      contentHash: String(graph.content.content_version_hash), eventHash: graph.eventFingerprint,
      summaryHash: String(graph.summary.summary_version_hash), bundleHash: String(graph.bundle.bundle_hash)
    };
  });
}

function recoveryActionFor(reasonCode: string): RecoveryAction {
  if (["PIPELINE_READY", "IDEMPOTENT_REPLAY", "CONTENT_DUPLICATE_REUSED", "EVENT_MEMBER_MERGED", "EVENT_NEW_DAY"].includes(reasonCode)) return "NO_ACTION";
  if (FILTER_CODES.has(reasonCode)) return "NO_ACTION_FILTERED";
  if (["INVALID_FIXTURE", "FIXTURE_CARDINALITY_VIOLATION", "SUMMARY_FIXTURE_NOT_ALLOWLISTED"].includes(reasonCode)) return "FIX_FIXTURE_AND_RESEED_TASK_DB";
  if (["DB_CORRUPTION", "SCHEMA_HASH_MISMATCH", "SEED_GRAPH_MISMATCH", "DB_HASH_UNAVAILABLE"].includes(reasonCode)) return "RESTORE_CONTRACT_AND_RESEED_TASK_DB";
  if (reasonCode === "DEDUP_COLLISION_UNRESOLVED") return "RESOLVE_COLLISION_THEN_RESEED";
  if (["STALE_FENCE", "LEASE_INVALID", "STOP_ASSERTED"].includes(reasonCode)) return "CLEAR_STOP_OR_REFRESH_FENCES_THEN_RESEED";
  if (reasonCode === "APPROVED_CHAIN_PRESENT") return "HAND_OFF_APPROVED_CHAIN_TO_ADMIN";
  return "ARCHIVE_AND_RESEED_TASK_DB";
}

type Settlement = { retry: boolean; retryDelaySeconds: 0 | 1 | 3; recoveryAction: RecoveryAction };

function settleFailure(
  database: DatabaseSync,
  bundle: Vs1FixtureBundle,
  identity: SeedIdentity,
  acquired: AcquiredAttempt,
  reasonCode: string,
  transactionSequence: string[]
): Settlement {
  return withImmediateTransaction(database, () => {
    const { job, source } = validateLeaseIdentity(database, identity, acquired);
    const attemptRow = requireRow(database.prepare("SELECT * FROM task_attempt WHERE job_id=? AND attempt_no=?").get(identity.jobId, acquired.attempt) as Record<string, unknown> | undefined, "LEASE_INVALID");
    if (job.job_status !== "leased" || attemptRow.attempt_status !== "leased" || attemptRow.lease_token !== acquired.envelope.lease_token) {
      throw new PipelineFailure("LEASE_INVALID");
    }
    const fenceMismatch =
      Number(source.source_config_epoch) !== acquired.envelope.source_config_epoch ||
      Number(source.source_safety_epoch) !== acquired.envelope.source_safety_epoch ||
      Number(job.authorization_version) !== acquired.envelope.authorization_version ||
      Number(job.policy_epoch) !== acquired.envelope.policy_epoch ||
      Number(job.recovery_epoch) !== acquired.envelope.recovery_epoch;
    const stopMismatch = Number(source.enabled) !== 1 || source.source_stop_status !== "clear";
    if (reasonCode === "STALE_FENCE") {
      if (!fenceMismatch) throw new PipelineFailure("LEASE_INVALID");
    } else if (reasonCode === "STOP_ASSERTED") {
      if (!stopMismatch) throw new PipelineFailure("LEASE_INVALID");
    } else if (fenceMismatch || stopMismatch) {
      throw new PipelineFailure(fenceMismatch ? "STALE_FENCE" : "STOP_ASSERTED");
    }
    const retryable = TRANSIENT_CODES.has(reasonCode) && acquired.attempt < 3;
    if (retryable) {
      const retryDelaySeconds = acquired.attempt === 1 ? 1 : 3;
      const nextAttemptAt = new Date(Date.parse(acquired.clock) + retryDelaySeconds * 1000).toISOString().replace(".000Z", "Z");
      requireChanges(database.prepare("UPDATE task_attempt SET attempt_status='retryable_failed',finished_at=?,error_code=? WHERE job_id=? AND attempt_no=? AND attempt_status='leased'")
        .run(acquired.clock, reasonCode, identity.jobId, acquired.attempt).changes, "DB_CORRUPTION");
      requireChanges(database.prepare("UPDATE outbox_job SET job_status='retryable_failed',last_error_code=?,next_attempt_at=?,updated_at=? WHERE job_id=? AND job_status='leased'")
        .run(reasonCode, nextAttemptAt, acquired.clock, identity.jobId).changes, "DB_CORRUPTION");
      database.prepare("UPDATE inbox SET inbox_status='received',last_error_code=? WHERE operation_id=? AND idempotency_key=?")
        .run(reasonCode, identity.operationId, identity.idempotencyKey);
      updateSourceStatus(database, ["collecting"], "collection_failed");
      insertAudit(database, bundle, identity, acquired.attempt, acquired.clock, reasonCode);
      transactionSequence.push("failure_settlement_retryable");
      return { retry: true, retryDelaySeconds, recoveryAction: "RETRY_IN_SAME_RUN" };
    }
    const stale = ["STALE_FENCE", "LEASE_INVALID", "STOP_ASSERTED"].includes(reasonCode);
    const attemptStatus = stale ? "stale_epoch" : "terminal_failed";
    requireChanges(database.prepare("UPDATE task_attempt SET attempt_status=?,finished_at=?,error_code=? WHERE job_id=? AND attempt_no=? AND attempt_status='leased'")
      .run(attemptStatus, acquired.clock, reasonCode, identity.jobId, acquired.attempt).changes, "DB_CORRUPTION");
    database.prepare("UPDATE inbox SET inbox_status='rejected',last_error_code=? WHERE operation_id=? AND idempotency_key=?")
      .run(reasonCode, identity.operationId, identity.idempotencyKey);
    if (stale) {
      requireChanges(database.prepare("UPDATE outbox_job SET job_status='stale_epoch',last_error_code=?,next_attempt_at=NULL,updated_at=? WHERE job_id=? AND job_status='leased'")
        .run(reasonCode, acquired.clock, identity.jobId).changes, "DB_CORRUPTION");
      updateSourceStatus(database, ["collecting"], "queued");
    } else {
      requireChanges(database.prepare("UPDATE outbox_job SET job_status='terminal_failed',last_error_code=?,next_attempt_at=NULL,updated_at=? WHERE job_id=? AND job_status='leased'")
        .run(reasonCode, acquired.clock, identity.jobId).changes, "DB_CORRUPTION");
      requireChanges(database.prepare("UPDATE outbox_job SET job_status='dead_letter' WHERE job_id=? AND job_status='terminal_failed'")
        .run(identity.jobId).changes, "DB_CORRUPTION");
      database.prepare("INSERT INTO dead_letter(dead_letter_id,job_id,operation_id,reason_code,attempt,recorded_at,external_calls) VALUES(?,?,?,?,?,?,0)")
        .run(derivedId("dead", { job_id: identity.jobId, reason_code: reasonCode }), identity.jobId, identity.operationId, reasonCode, acquired.attempt, acquired.clock);
      updateSourceStatus(database, ["collecting"], "collection_failed");
    }
    insertAudit(database, bundle, identity, acquired.attempt, acquired.clock, reasonCode);
    transactionSequence.push(stale ? "failure_settlement_stale" : "failure_settlement_dead_letter");
    return { retry: false, retryDelaySeconds: 0, recoveryAction: recoveryActionFor(reasonCode) };
  });
}

function vopLines(reasonCode: string, artifactHash: string | null): [Vs1VopLine, Vs1VopLine, Vs1VopLine] {
  if (reasonCode === "NO_WORK") {
    return VS1_FUNCTION_IDS.map((functionId) => ({ functionId, status: "NO_WORK", reasonCode: "NO_WORK", artifactHash: null, externalCalls: 0, recoveryAction: "NO_ACTION" })) as [Vs1VopLine, Vs1VopLine, Vs1VopLine];
  }
  const recoveryAction = recoveryActionFor(reasonCode);
  const line = (index: number, status: Vs1VopStatus, code: string): Vs1VopLine => ({
    functionId: VS1_FUNCTION_IDS[index], status, reasonCode: code, artifactHash, externalCalls: 0, recoveryAction
  });
  if (["PIPELINE_READY", "CONTENT_DUPLICATE_REUSED", "EVENT_MEMBER_MERGED", "EVENT_NEW_DAY", "IDEMPOTENT_REPLAY"].includes(reasonCode)) {
    return [line(0, "PASS", reasonCode), line(1, "PASS", reasonCode), line(2, "PASS", reasonCode)];
  }
  if (FILTER_CODES.has(reasonCode)) {
    return [line(0, "PASS", reasonCode), line(1, "PASS", reasonCode), line(2, "NOT_APPLICABLE", reasonCode)];
  }
  if (reasonCode === "DEDUP_COLLISION_UNRESOLVED") {
    return [line(0, "PASS", reasonCode), line(1, "FAIL", reasonCode), line(2, "NOT_APPLICABLE", "UPSTREAM_FAILED")];
  }
  if (reasonCode === "APPROVED_CHAIN_PRESENT") {
    return [line(0, "PASS", reasonCode), line(1, "PASS", reasonCode), line(2, "FAIL", reasonCode)];
  }
  if (reasonCode === "SUMMARY_FIXTURE_NOT_ALLOWLISTED") {
    return [line(0, "FAIL", reasonCode), line(1, "FAIL", reasonCode), line(2, "FAIL", reasonCode)];
  }
  if (reasonCode === "TX_CONTENT_WRITE_FAILED" || reasonCode === "TX_EVENT_CAS_FAILED") {
    return [line(0, "PASS", reasonCode), line(1, "FAIL", reasonCode), line(2, "NOT_APPLICABLE", "UPSTREAM_FAILED")];
  }
  if (["TX_SUMMARY_WRITE_FAILED", "TX_BUNDLE_WRITE_FAILED", "TX_ACK_CAS_FAILED", "TX_AUDIT_WRITE_FAILED"].includes(reasonCode)) {
    return [line(0, "PASS", reasonCode), line(1, "PASS", reasonCode), line(2, "FAIL", reasonCode)];
  }
  return [line(0, "FAIL", reasonCode), line(1, "NOT_APPLICABLE", "UPSTREAM_FAILED"), line(2, "NOT_APPLICABLE", "UPSTREAM_FAILED")];
}

function makeTaskRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "TASK-20260809-D6114C-"));
  chmodSync(root, 0o700);
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new PipelineFailure("DB_CORRUPTION");
  return root;
}

function assertCaseIdentity(fixtureCase: Vs1Case): void {
  const expectedPartialFaults = new Map([
    ["VS1-PARTIAL-016A", "after_capture"], ["VS1-PARTIAL-016B", "after_content"],
    ["VS1-PARTIAL-016C", "after_event"], ["VS1-PARTIAL-016D", "after_summary"],
    ["VS1-PARTIAL-016E", "after_bundle"], ["VS1-PARTIAL-016F", "before_ack_cas"],
    ["VS1-PARTIAL-016G", "before_audit"]
  ]);
  const expected = expectedPartialFaults.get(fixtureCase.case_id);
  if (expected && (fixtureCase.attempts.length !== 1 || fixtureCase.attempts[0].fault_injection !== expected)) {
    throw new PipelineFailure("SEED_GRAPH_MISMATCH");
  }
}

export function runVs1Case(appRoot: string, caseId: string, externalCallCount: () => number = () => 0): Vs1RunResult {
  assertRuntimePreflight(appRoot);
  const fixtureBundle = loadVs1FixtureBundle(appRoot);
  const fixtureCase = fixtureBundle.cases.find((candidate) => candidate.case_id === caseId);
  if (!fixtureCase) throw new PipelineFailure("INVALID_FIXTURE");
  assertCaseIdentity(fixtureCase);
  const taskRoot = makeTaskRoot();
  const dbPath = resolve(taskRoot, "vs1-task.sqlite");
  let database = openTaskDatabase(appRoot, taskRoot, dbPath);
  applyTaskMigrations(database, appRoot, fixtureBundle);
  const identity = seedCase(database, fixtureBundle, fixtureCase);
  const beforeCounts = countRows(database);
  const domainBeforeHash = domainGraphHash(database);
  const dbBeforeHash = checkpointCloseHash(database, dbPath);
  database = openTaskDatabase(appRoot, taskRoot, dbPath);
  if (fixtureCase.precondition === "no_work") {
    const due = database.prepare("SELECT job_id FROM outbox_job WHERE job_status IN ('pending','retryable_failed') AND next_attempt_at<=? ORDER BY next_attempt_at,job_id LIMIT 1").get(fixtureBundle.seed.clock);
    if (due) throw new PipelineFailure("SEED_GRAPH_MISMATCH");
    const domainAfterHash = domainGraphHash(database);
    const afterCounts = countRows(database);
    const dbAfterHash = checkpointCloseHash(database, dbPath);
    if (canonicalJson(beforeCounts) !== canonicalJson(afterCounts) || domainBeforeHash !== domainAfterHash || dbBeforeHash !== dbAfterHash) {
      throw new PipelineFailure("DB_HASH_UNAVAILABLE");
    }
    return { taskRoot, dbPath, receiptPath: null, artifactHash: null, receipt: null, vops: vopLines("NO_WORK", null), exitCode: 0 };
  }
  const transactionSequence: string[] = [];
  const attemptHistory: Vs1FullReceipt["attemptHistory"] = [];
  let clock: string = fixtureBundle.seed.clock;
  let finalReason = "CLI_INTERNAL_ERROR";
  let finalRecovery: RecoveryAction = "ARCHIVE_AND_RESEED_TASK_DB";
  let processResult: ProcessResult = {
    reasonCode: finalReason, transactionCommitted: false,
    canonicalIds: { contentId: null, eventId: null, summaryId: null, bundleId: null },
    contentHash: null, eventHash: null, summaryHash: null, bundleHash: null
  };
  let lastAcquired: AcquiredAttempt | null = null;
  while (true) {
    const acquired = acquireAttempt(database, identity, clock);
    lastAcquired = acquired;
    transactionSequence.push(`attempt_${acquired.attempt}_lease_acquired`);
    validateCurrentLease(database, identity, acquired);
    transactionSequence.push(`attempt_${acquired.attempt}_adapter_guard`);
    const attempt = fixtureCase.attempts[acquired.attempt - 1];
    if (!attempt || attempt.attempt !== acquired.attempt) throw new PipelineFailure("INVALID_FIXTURE");
    if (attempt.adapter_outcome !== "candidate") {
      const settlement = settleFailure(database, fixtureBundle, identity, acquired, attempt.adapter_outcome, transactionSequence);
      attemptHistory.push({ attempt: acquired.attempt, outcome: attempt.adapter_outcome, leasePresent: true, retryDelaySeconds: settlement.retryDelaySeconds });
      if (settlement.retry) {
        clock = new Date(Date.parse(clock) + settlement.retryDelaySeconds * 1000).toISOString().replace(".000Z", "Z");
        continue;
      }
      finalReason = attempt.adapter_outcome;
      finalRecovery = settlement.recoveryAction;
      break;
    }
    transactionSequence.push(`attempt_${acquired.attempt}_adapter_candidate`);
    if (fixtureCase.precondition === "stale_fence") {
      withImmediateTransaction(database, () => {
        const row = requireRow(database.prepare("SELECT payload_json FROM source WHERE source_id='src-queued'").get() as Record<string, unknown> | undefined, "STALE_FENCE");
        const payload = parseJsonRecord(row.payload_json);
        payload.source_config_epoch = 2;
        requireChanges(database.prepare("UPDATE source SET source_config_epoch=2,payload_json=? WHERE source_id='src-queued' AND source_config_epoch=1")
          .run(canonicalJson(payload)).changes, "STALE_FENCE");
      });
      transactionSequence.push("stale_fence_raised_after_adapter");
    }
    try {
      processResult = processCandidate(database, fixtureBundle, fixtureCase, identity, acquired, attempt, transactionSequence);
      finalReason = processResult.reasonCode;
      finalRecovery = recoveryActionFor(finalReason);
      attemptHistory.push({ attempt: acquired.attempt, outcome: finalReason, leasePresent: true, retryDelaySeconds: 0 });
      break;
    } catch (error) {
      const reasonCode = error instanceof PipelineFailure ? error.reasonCode : "CLI_INTERNAL_ERROR";
      const settlement = settleFailure(database, fixtureBundle, identity, acquired, reasonCode, transactionSequence);
      attemptHistory.push({ attempt: acquired.attempt, outcome: reasonCode, leasePresent: true, retryDelaySeconds: settlement.retryDelaySeconds });
      if (settlement.retry) {
        clock = new Date(Date.parse(clock) + settlement.retryDelaySeconds * 1000).toISOString().replace(".000Z", "Z");
        continue;
      }
      finalReason = reasonCode;
      finalRecovery = settlement.recoveryAction;
      processResult = { ...processResult, reasonCode, transactionCommitted: false };
      break;
    }
  }
  if (!lastAcquired) throw new PipelineFailure("LEASE_INVALID");
  const afterCounts = countRows(database);
  const domainAfterHash = domainGraphHash(database);
  const dbAfterHash = checkpointCloseHash(database, dbPath);
  const receipt: Vs1FullReceipt = {
    schemaVersion: "vs1-operator-receipt-v1",
    fixtureVersion: VS1_FIXTURE_VERSION,
    fixtureHash: fixtureBundle.fixtureHash,
    manifestHash: fixtureBundle.manifestHash,
    operationId: identity.operationId,
    idempotencyKey: identity.idempotencyKey,
    envelopeHash: lastAcquired.envelopeHash,
    sourceId: "src-queued",
    attempt: lastAcquired.attempt,
    leasePresent: true,
    fiveFences: {
      source_config_epoch: lastAcquired.envelope.source_config_epoch,
      source_safety_epoch: lastAcquired.envelope.source_safety_epoch,
      authorization_version: 1, policy_epoch: 1, recovery_epoch: 1
    },
    transactionSequence,
    transactionCommitted: processResult.transactionCommitted,
    reasonCode: finalReason,
    entityDeltas: entityDelta(beforeCounts, afterCounts),
    canonicalIds: processResult.canonicalIds,
    contentHash: processResult.contentHash,
    eventHash: processResult.eventHash,
    summaryHash: processResult.summaryHash,
    bundleHash: processResult.bundleHash,
    dbBeforeHash,
    dbAfterHash,
    domainBeforeHash,
    domainAfterHash,
    externalCalls: 0,
    cleanupStatus: "retained_for_audit",
    recoveryAction: finalRecovery,
    attemptHistory,
    validatorReceipt: fixtureBundle.validatorReceipt
  };
  if (externalCallCount() !== 0) throw new PipelineFailure("EXTERNAL_IO_FORBIDDEN");
  const receiptBytes = `${canonicalJson(receipt)}\n`;
  const receiptPath = resolve(taskRoot, `${identity.operationId}.json`);
  writeFileSync(receiptPath, receiptBytes, { mode: 0o600, flag: "wx" });
  chmodSync(receiptPath, 0o600);
  const artifactHash = sha256(receiptBytes);
  const vops = vopLines(finalReason, artifactHash);
  return { taskRoot, dbPath, receiptPath, artifactHash, receipt, vops, exitCode: vops.some((entry) => entry.status === "FAIL") ? 1 : 0 };
}

export function replaySucceededReceipt(appRoot: string, result: Vs1RunResult): { receipt: Vs1FullReceipt; vops: [Vs1VopLine, Vs1VopLine, Vs1VopLine] } {
  if (!result.receiptPath || !result.receipt || result.receipt.reasonCode !== "PIPELINE_READY") throw new PipelineFailure("LEASE_INVALID");
  const beforeBytes = readFileSync(result.receiptPath);
  const database = openTaskDatabase(appRoot, result.taskRoot, result.dbPath);
  const beforeCounts = countRows(database);
  const row = requireRow(database.prepare(
    "SELECT o.job_status,i.inbox_status FROM outbox_job o JOIN inbox i ON i.job_id=o.job_id WHERE o.operation_id=? AND o.idempotency_key=?"
  ).get(result.receipt.operationId, result.receipt.idempotencyKey) as Record<string, unknown> | undefined, "LEASE_INVALID");
  if (row.job_status !== "succeeded" || row.inbox_status !== "acked") throw new PipelineFailure("LEASE_INVALID");
  const due = database.prepare("SELECT job_id FROM outbox_job WHERE job_status IN ('pending','retryable_failed') ORDER BY next_attempt_at,job_id LIMIT 1").get();
  if (due) throw new PipelineFailure("LEASE_INVALID");
  const afterCounts = countRows(database);
  checkpointCloseHash(database, result.dbPath);
  if (canonicalJson(beforeCounts) !== canonicalJson(afterCounts) || sha256(beforeBytes) !== result.artifactHash) throw new PipelineFailure("DB_CORRUPTION");
  return {
    receipt: JSON.parse(beforeBytes.toString("utf8")) as Vs1FullReceipt,
    vops: vopLines("IDEMPOTENT_REPLAY", result.artifactHash)
  };
}

export function cleanupVs1TaskRoot(taskRoot: string): void {
  const resolved = resolve(taskRoot);
  const allowedPrefix = resolve(tmpdir(), "TASK-20260809-D6114C-");
  if (!resolved.startsWith(allowedPrefix) || resolved === resolve(tmpdir())) throw new PipelineFailure("DB_CORRUPTION");
  rmSync(resolved, { recursive: true, force: false });
}
