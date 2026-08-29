import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  openSafeDatabase,
  readDatabaseSchemaFingerprint,
  readSqliteRuntime,
  withImmediateTransaction
} from "../db/database.ts";
import {
  RSS_FEED_URL,
  RSS_MAX_ITEMS,
  RSS_PROFILE_ID,
  RSS_SELECTED_ITEMS,
  RSS_SLOT_SECONDS,
  RSS_SOURCE_ID,
  RssError,
  type ClaimedRssRun,
  type ParsedRssFeed,
  type RssHttpResponse,
  type RssModifiedResponse,
  type RssNotModifiedResponse,
  type RssRunReceipt,
  type RssExternalCallBreakdown,
  type SourceValidators
} from "./types.ts";
import { assertIndependentRssSourcesSchema, assertRssMediaRefinementSchema, assertSecondRssAutosportSchema } from "../review-real/migration.ts";
import { LIVE_RSS_SOURCES, isLiveRssSourceId, type LiveRssSourceId } from "./sources.ts";
import type { EntityKind, MutationKind } from "../internal-operation/gateway.ts";
import type { GatewayMutationPort } from "../internal-operation/mutation-port.ts";

type SqlRow = Record<string, unknown>;

export const RSS_DATABASE_PATH = ".local/f1plus1-rss-real-private.sqlite" as const;
export const RSS_MIGRATION_SHA256 = "c03c5c0bd5887e9e74453c91602bae76f6a7c74db513a2d9ff808ad498807ef3";
export const RSS_SCHEMA_SHA256 = "b6b21a0b6f1918ea7f93a08b66bdc517b5827dff62eefe662e663e0998a8a719";

const EXPECTED_COLUMNS = Object.freeze({
  source: [
    "source_id", "feed_url", "enabled", "stop_epoch", "etag", "last_modified",
    "last_attempt_at", "last_success_at", "next_eligible_at", "last_reason_code"
  ],
  ingest_run: [
    "run_id", "source_id", "slot_key", "scheduled_at", "started_at", "finished_at",
    "http_status", "validator_result", "validator_capability", "response_sha256",
    "response_bytes", "item_count", "selected_count", "new_count", "updated_count",
    "duplicate_count", "status", "reason_code", "next_action"
  ],
  pending_review_candidate: [
    "candidate_id", "source_id", "external_id", "dedupe_key", "canonical_url", "title",
    "excerpt", "author", "published_at", "source_payload_hash", "source_revision",
    "editor_title", "editor_excerpt", "editor_notes", "editor_based_on_source_revision",
    "review_status", "first_seen_at", "last_seen_at"
  ]
});

export type RssSourceState = Readonly<{
  sourceId: LiveRssSourceId;
  enabled: boolean;
  stopEpoch: number;
  validators: SourceValidators;
  nextEligibleAt: string | null;
}>;

type FinalizeMetadata = Readonly<{
  finishedAt: string;
  externalCalls: number;
  externalCallBreakdown?: RssExternalCallBreakdown;
}>;

type FailureMetadata = FinalizeMetadata & Readonly<{
  httpResponse?: RssModifiedResponse;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedIso(value: string): string {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new RssError("RUN_STATE_INVALID");
  return new Date(millis).toISOString();
}

function metadataBreakdown(metadata: FinalizeMetadata): RssExternalCallBreakdown {
  return metadata.externalCallBreakdown ?? Object.freeze({
    dnsAttempts: 0,
    dohAttempts: 0,
    httpAttempts: metadata.externalCalls,
    successfulResourceReads: metadata.externalCalls > 0 ? 1 : 0
  });
}

function requiredCandidateText(row: SqlRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string") throw new RssError("RUN_STATE_INVALID");
  return value;
}

function requiredCandidateInteger(row: SqlRow, field: string): number {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value)) throw new RssError("RUN_STATE_INVALID");
  return value;
}

export function rssSlotKey(scheduledAt: string): number {
  const millis = Date.parse(scheduledAt);
  if (!Number.isFinite(millis)) throw new RssError("RUN_STATE_INVALID");
  return Math.floor(millis / (RSS_SLOT_SECONDS * 1000));
}

function requireRunningRun(database: DatabaseSync, run: ClaimedRssRun): void {
  const row = database.prepare(
    "SELECT run_id, slot_key, status FROM ingest_run WHERE run_id = ?"
  ).get(run.runId) as SqlRow | undefined;
  if (!row || Number(row.slot_key) !== run.slotKey || row.status !== "running") {
    throw new RssError("RUN_STATE_INVALID");
  }
}

function requireLiveSourceFence(database: DatabaseSync, run: ClaimedRssRun): void {
  requireRunningRun(database, run);
  const source = database.prepare(
    "SELECT enabled, stop_epoch FROM source WHERE source_id = ?"
  ).get(run.sourceId) as SqlRow | undefined;
  if (!source || Number(source.enabled) !== 1 || Number(source.stop_epoch) !== run.stopEpoch) {
    throw new RssError("SOURCE_STOPPED");
  }
}

function receipt(
  run: ClaimedRssRun,
  values: Omit<RssRunReceipt, "schemaVersion" | "profile" | "sourceId" | "runId" | "slotKey" | "logicalAttemptBoundaries" | "attemptDefinition" | "resourceReads">
): RssRunReceipt {
  return {
    schemaVersion: "rss-real-receipt-v2",
    profile: RSS_PROFILE_ID,
    sourceId: run.sourceId,
    runId: run.runId,
    slotKey: run.slotKey,
    logicalAttemptBoundaries: values.externalCalls,
    attemptDefinition: "dns_resolver_boundary+doh_http_request+resource_http_request",
    resourceReads: values.externalCallBreakdown.successfulResourceReads,
    ...values
  };
}

export function openRssDatabase(appRoot: string): DatabaseSync {
  const database = openSafeDatabase(RSS_DATABASE_PATH, { appRoot });
  const runtime = readSqliteRuntime(database);
  if (runtime.userVersion >= 7) {
    database.close();
    throw new RssError("SQLITE_FAILURE");
  }
  if (runtime.journalMode !== "wal" || runtime.synchronous !== 2 || runtime.foreignKeys !== 1) {
    database.close();
    throw new RssError("SQLITE_FAILURE");
  }
  return database;
}

export function applyRssMigration(database: DatabaseSync, sql: string): void {
  if (sha256(sql) !== RSS_MIGRATION_SHA256) throw new RssError("MIGRATION_DRIFT");
  const versionRow = database.prepare("PRAGMA user_version").get() as SqlRow;
  const version = Number(versionRow.user_version);
  if (version === 0) {
    const tables = database.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).all() as SqlRow[];
    if (tables.length !== 0) throw new RssError("MIGRATION_DRIFT");
    withImmediateTransaction(database, () => database.exec(sql));
  } else if (version !== 1 && version !== 4 && version !== 5 && version !== 6) {
    throw new RssError("MIGRATION_DRIFT");
  }
  if (version === 6) {
    try {
      assertIndependentRssSourcesSchema(database);
    } catch {
      throw new RssError("MIGRATION_DRIFT");
    }
  } else if (version === 5) {
    try {
      assertSecondRssAutosportSchema(database);
    } catch {
      throw new RssError("MIGRATION_DRIFT");
    }
  } else if (version === 4) {
    try {
      assertRssMediaRefinementSchema(database);
    } catch {
      throw new RssError("MIGRATION_DRIFT");
    }
  } else {
    assertRssSchema(database);
  }
}

export function assertRssRuntimeSchema(database: DatabaseSync): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as SqlRow).user_version);
  if (version === 1) {
    assertRssSchema(database);
    return;
  }
  if (version === 4) {
    try {
      assertRssMediaRefinementSchema(database);
      return;
    } catch {
      throw new RssError("MIGRATION_DRIFT");
    }
  }
  if (version === 5) {
    try {
      assertSecondRssAutosportSchema(database);
      return;
    } catch {
      throw new RssError("MIGRATION_DRIFT");
    }
  }
  if (version === 6) {
    try {
      assertIndependentRssSourcesSchema(database);
      return;
    } catch {
      throw new RssError("MIGRATION_DRIFT");
    }
  }
  throw new RssError("MIGRATION_DRIFT");
}

export function assertRssSchema(database: DatabaseSync): void {
  const versionRow = database.prepare("PRAGMA user_version").get() as SqlRow;
  if (Number(versionRow.user_version) !== 1) throw new RssError("MIGRATION_DRIFT");
  const tables = (database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as SqlRow[]).map((row) => String(row.name));
  const expectedTables = Object.keys(EXPECTED_COLUMNS).sort();
  if (tables.length !== expectedTables.length || tables.some((table, index) => table !== expectedTables[index])) {
    throw new RssError("MIGRATION_DRIFT");
  }
  for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
    const columns = (database.prepare("SELECT name FROM pragma_table_xinfo(?) ORDER BY cid").all(table) as SqlRow[])
      .map((row) => String(row.name));
    if (columns.length !== expected.length || columns.some((column, index) => column !== expected[index])) {
      throw new RssError("MIGRATION_DRIFT");
    }
  }
  const source = database.prepare("SELECT source_id, feed_url FROM source").all() as SqlRow[];
  if (source.length !== 1 || source[0].source_id !== RSS_SOURCE_ID || source[0].feed_url !== RSS_FEED_URL) {
    throw new RssError("MIGRATION_DRIFT");
  }
  const foreignKeyFailure = database.prepare("PRAGMA foreign_key_check").get();
  const integrity = database.prepare("PRAGMA integrity_check").get() as SqlRow;
  if (
    foreignKeyFailure !== undefined ||
    integrity.integrity_check !== "ok" ||
    readDatabaseSchemaFingerprint(database) !== RSS_SCHEMA_SHA256
  ) {
    throw new RssError("MIGRATION_DRIFT");
  }
}

export class RssRepository {
  readonly database: DatabaseSync;
  private readonly mutationPort: GatewayMutationPort | undefined;

  constructor(database: DatabaseSync, mutationPort?: GatewayMutationPort) {
    this.database = database;
    this.mutationPort = mutationPort;
  }

  private write(input: Readonly<{
    entityKind: EntityKind;
    entityId: string;
    mutationKind: MutationKind;
    statement: string;
    parameters?: readonly unknown[];
    sourceId: LiveRssSourceId;
  }>): number {
    const version = Number((this.database.prepare("PRAGMA user_version").get() as SqlRow).user_version);
    if (version >= 7) {
      if (!this.mutationPort) throw new RssError("SQLITE_FAILURE");
      return this.mutationPort.mutate({
        operationId: `gateway-collect-${sha256(`${input.statement}\n${JSON.stringify(input.parameters ?? [])}\n${input.entityId}`)}`,
        operationKind: "collect",
        entityKind: input.entityKind,
        entityId: input.entityId,
        mutationKind: input.mutationKind,
        statement: input.statement,
        parameters: input.parameters,
        identity: { sourceId: input.sourceId, candidateId: input.entityKind === "candidate" ? input.entityId : null, publicationId: null, publicId: null },
        capabilityClass: "external_attempt",
        egressClass: "rss_https",
        sourceStopEpoch: this.readSource(input.sourceId).stopEpoch
      });
    }
    return Number(this.database.prepare(input.statement).run(...((input.parameters ?? []) as any[])).changes);
  }

  private transaction<T>(callback: () => T): T {
    const version = Number((this.database.prepare("PRAGMA user_version").get() as SqlRow).user_version);
    // A schema-7 gateway operation owns BEGIN IMMEDIATE.  The legacy wrapper
    // remains only for the disposable schema-1..6 readers/tests.
    return version >= 7 ? callback() : withImmediateTransaction(this.database, callback);
  }

  readSource(sourceId: LiveRssSourceId = RSS_SOURCE_ID): RssSourceState {
    const expected = LIVE_RSS_SOURCES[sourceId];
    const row = this.database.prepare("SELECT * FROM source WHERE source_id = ?").get(sourceId) as SqlRow | undefined;
    if (!row || row.feed_url !== expected.feedUrl) throw new RssError("MIGRATION_DRIFT");
    return {
      sourceId,
      enabled: Number(row.enabled) === 1,
      stopEpoch: Number(row.stop_epoch),
      validators: {
        etag: row.etag === null ? null : String(row.etag),
        lastModified: row.last_modified === null ? null : String(row.last_modified)
      },
      nextEligibleAt: row.next_eligible_at === null ? null : String(row.next_eligible_at)
    };
  }

  readEnabledSources(): readonly RssSourceState[] {
    const rows = this.database.prepare(
      "SELECT source_id FROM source WHERE enabled = 1 ORDER BY source_id"
    ).all() as SqlRow[];
    return rows
      .map((row) => String(row.source_id))
      .filter(isLiveRssSourceId)
      .map((sourceId) => this.readSource(sourceId));
  }

  claimRun(
    scheduledAtValue: string,
    startedAtValue: string,
    sourceId: LiveRssSourceId = RSS_SOURCE_ID
  ): ClaimedRssRun {
    const scheduledAt = normalizedIso(scheduledAtValue);
    const startedAt = normalizedIso(startedAtValue);
    const slotKey = rssSlotKey(scheduledAt);
    const runId = sourceId === RSS_SOURCE_ID ? `rss-run-${slotKey}` : `rss-run-${sourceId}-${slotKey}`;
    return this.transaction(() => {
      const source = this.readSource(sourceId);
      if (!source.enabled) throw new RssError("SOURCE_STOPPED");
      if (source.nextEligibleAt !== null && Date.parse(source.nextEligibleAt) > Date.parse(scheduledAt)) {
        throw new RssError("SOURCE_NOT_ELIGIBLE", { nextAction: "next_slot" });
      }
      const sameSlot = this.database.prepare(
        "SELECT 1 AS present FROM ingest_run WHERE source_id = ? AND slot_key = ?"
      ).get(sourceId, slotKey);
      if (sameSlot) throw new RssError("SLOT_ALREADY_RECORDED", { nextAction: "next_slot" });

      const running = this.database.prepare(
        "SELECT run_id, started_at FROM ingest_run WHERE source_id = ? AND status = 'running' ORDER BY started_at LIMIT 1"
      ).get(sourceId) as SqlRow | undefined;
      if (running) {
        const age = Date.parse(startedAt) - Date.parse(String(running.started_at));
        if (!Number.isFinite(age) || age < 30_000) throw new RssError("RUN_IN_FLIGHT", { nextAction: "next_slot" });
        const interrupted = this.write({
          entityKind: "ingest_run",
          entityId: String(running.run_id),
          mutationKind: "update",
          statement: "UPDATE ingest_run SET finished_at = ?, status = 'failed', reason_code = 'PROCESS_INTERRUPTED', next_action = 'manual_review' WHERE run_id = ? AND status = 'running'",
          parameters: [startedAt, String(running.run_id)],
          sourceId
        });
        if (interrupted !== 1) throw new RssError("RUN_STATE_INVALID");
      }

      const latest = this.database.prepare(
        "SELECT MAX(slot_key) AS slot_key FROM ingest_run WHERE source_id = ?"
      ).get(sourceId) as SqlRow;
      const latestSlot = latest.slot_key === null ? null : Number(latest.slot_key);
      if (latestSlot !== null && latestSlot < slotKey - 1) {
        const gapSlot = slotKey - 1;
        const gapAt = new Date(gapSlot * RSS_SLOT_SECONDS * 1000).toISOString();
        const gapRunId = sourceId === RSS_SOURCE_ID ? `rss-gap-${gapSlot}` : `rss-gap-${sourceId}-${gapSlot}`;
        this.write({
          entityKind: "ingest_run",
          entityId: gapRunId,
          mutationKind: "insert",
          statement: "INSERT OR IGNORE INTO ingest_run (run_id, source_id, slot_key, scheduled_at, started_at, finished_at, validator_result, validator_capability, status, reason_code, next_action) VALUES (?, ?, ?, ?, ?, ?, 'unknown', 'unknown', 'scheduler_gap', 'SCHEDULER_GAP', 'manual_review')",
          parameters: [gapRunId, sourceId, gapSlot, gapAt, startedAt, startedAt],
          sourceId
        });
      }

      const claimed = this.write({
        entityKind: "ingest_run",
        entityId: runId,
        mutationKind: "insert",
        statement: "INSERT INTO ingest_run (run_id, source_id, slot_key, scheduled_at, started_at, validator_result, validator_capability, status, reason_code, next_action) VALUES (?, ?, ?, ?, ?, 'unknown', 'unknown', 'running', 'RUNNING', 'none')",
        parameters: [runId, sourceId, slotKey, scheduledAt, startedAt],
        sourceId
      });
      if (claimed !== 1) throw new RssError("RUN_STATE_INVALID");
      return { sourceId, runId, slotKey, scheduledAt, startedAt, stopEpoch: source.stopEpoch };
    });
  }

  finalizeModified(
    run: ClaimedRssRun,
    response: RssModifiedResponse,
    feed: ParsedRssFeed,
    metadata: FinalizeMetadata
  ): RssRunReceipt {
    const finishedAt = normalizedIso(metadata.finishedAt);
    if (feed.itemCount > RSS_MAX_ITEMS || feed.items.length > RSS_SELECTED_ITEMS || feed.items.length > feed.itemCount) {
      throw new RssError("RUN_STATE_INVALID");
    }
    return this.transaction(() => {
      requireLiveSourceFence(this.database, run);
      const supportsMedia = Number(
        (this.database.prepare("PRAGMA user_version").get() as SqlRow).user_version
      ) >= 4;
      let newCount = 0;
      let updatedCount = 0;
      let duplicateCount = 0;
      for (const item of feed.items) {
        const dedupeKey = sha256(`${run.sourceId}\u001f${item.externalId}`);
        const existing = this.database.prepare(
          "SELECT candidate_id, external_id, source_payload_hash, source_revision FROM pending_review_candidate WHERE dedupe_key = ?"
        ).get(dedupeKey) as SqlRow | undefined;
        let candidateId: string;
        let sourceRevision: number;
        if (!existing) {
          candidateId = `rss-candidate-${dedupeKey.slice(0, 32)}`;
          sourceRevision = 1;
          const inserted = this.write({
            entityKind: "candidate",
            entityId: candidateId,
            mutationKind: "insert",
            statement: "INSERT INTO pending_review_candidate (candidate_id, source_id, external_id, dedupe_key, canonical_url, title, excerpt, author, published_at, source_payload_hash, source_revision, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
            parameters: [candidateId, run.sourceId, item.externalId, dedupeKey, item.canonicalUrl, item.title, item.excerpt, item.author, item.publishedAt, item.sourcePayloadHash, finishedAt, finishedAt],
            sourceId: run.sourceId
          });
          if (inserted !== 1) throw new RssError("RUN_STATE_INVALID");
          newCount += 1;
        } else if (existing.source_payload_hash === item.sourcePayloadHash) {
          candidateId = requiredCandidateText(existing, "candidate_id");
          sourceRevision = requiredCandidateInteger(existing, "source_revision");
          const touched = this.write({
            entityKind: "candidate",
            entityId: candidateId,
            mutationKind: "update",
            statement: "UPDATE pending_review_candidate SET last_seen_at = ? WHERE dedupe_key = ?",
            parameters: [finishedAt, dedupeKey],
            sourceId: run.sourceId
          });
          if (touched !== 1) throw new RssError("RUN_STATE_INVALID");
          duplicateCount += 1;
        } else {
          if (existing.external_id !== item.externalId) throw new RssError("RUN_STATE_INVALID");
          candidateId = requiredCandidateText(existing, "candidate_id");
          const historicalMediaPayload = supportsMedia && item.media !== null
            ? this.database.prepare(
              "SELECT 1 AS present FROM rss_media_candidate WHERE candidate_id = ? AND source_payload_hash = ?"
            ).get(candidateId, item.sourcePayloadHash)
            : undefined;
          if (historicalMediaPayload !== undefined) {
            const touched = this.write({
              entityKind: "candidate",
              entityId: candidateId,
              mutationKind: "update",
              statement: "UPDATE pending_review_candidate SET last_seen_at = ? WHERE dedupe_key = ?",
              parameters: [finishedAt, dedupeKey],
              sourceId: run.sourceId
            });
            if (touched !== 1) throw new RssError("RUN_STATE_INVALID");
            sourceRevision = requiredCandidateInteger(existing, "source_revision");
            duplicateCount += 1;
          } else {
            const changed = this.write({
              entityKind: "candidate",
              entityId: candidateId,
              mutationKind: "update",
              statement: "UPDATE pending_review_candidate SET canonical_url = ?, title = ?, excerpt = ?, author = ?, published_at = ?, source_payload_hash = ?, source_revision = source_revision + 1, last_seen_at = ? WHERE dedupe_key = ?",
              parameters: [item.canonicalUrl, item.title, item.excerpt, item.author, item.publishedAt, item.sourcePayloadHash, finishedAt, dedupeKey],
              sourceId: run.sourceId
            });
            if (changed !== 1) throw new RssError("RUN_STATE_INVALID");
            sourceRevision = requiredCandidateInteger(existing, "source_revision") + 1;
            updatedCount += 1;
          }
        }
        if (supportsMedia && item.media !== null && this.database.prepare(
          "SELECT 1 AS present FROM rss_media_candidate WHERE candidate_id = ? AND source_revision = ?"
        ).get(candidateId, sourceRevision) === undefined) {
          this.write({
            entityKind: "rss_media",
            entityId: `${candidateId}:${sourceRevision}`,
            mutationKind: "insert",
            statement: "INSERT OR IGNORE INTO rss_media_candidate (candidate_id, source_revision, source_payload_hash, media_url, media_type, declared_bytes, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            parameters: [candidateId, sourceRevision, item.sourcePayloadHash, item.media.url, item.media.mimeType, item.media.declaredBytes, finishedAt],
            sourceId: run.sourceId
          });
        }
      }
      const finalized = this.write({
        entityKind: "ingest_run",
        entityId: run.runId,
        mutationKind: "update",
        statement: "UPDATE ingest_run SET finished_at = ?, http_status = 200, validator_result = 'modified', validator_capability = ?, response_sha256 = ?, response_bytes = ?, item_count = ?, selected_count = ?, new_count = ?, updated_count = ?, duplicate_count = ?, status = 'succeeded', reason_code = 'OK', next_action = 'next_slot' WHERE run_id = ?",
        parameters: [finishedAt, response.validatorCapability, response.responseSha256, response.responseBytes, feed.itemCount, feed.items.length, newCount, updatedCount, duplicateCount, run.runId],
        sourceId: run.sourceId
      });
      if (finalized !== 1) throw new RssError("RUN_STATE_INVALID");
      const sourceUpdated = this.write({
        entityKind: "source",
        entityId: run.sourceId,
        mutationKind: "update",
        statement: "UPDATE source SET etag = ?, last_modified = ?, last_attempt_at = ?, last_success_at = ?, next_eligible_at = NULL, last_reason_code = 'OK' WHERE source_id = ?",
        parameters: [response.validators.etag, response.validators.lastModified, finishedAt, finishedAt, run.sourceId],
        sourceId: run.sourceId
      });
      if (sourceUpdated !== 1) throw new RssError("RUN_STATE_INVALID");
      return receipt(run, {
        status: "succeeded",
        reasonCode: "OK",
        nextAction: "next_slot",
        externalCalls: metadata.externalCalls,
        externalCallBreakdown: metadataBreakdown(metadata),
        responseSha256: response.responseSha256,
        itemCount: feed.itemCount,
        selectedCount: feed.items.length,
        newCount,
        updatedCount,
        duplicateCount
      });
    });
  }

  finalizeNotModified(
    run: ClaimedRssRun,
    response: RssNotModifiedResponse,
    metadata: FinalizeMetadata
  ): RssRunReceipt {
    const finishedAt = normalizedIso(metadata.finishedAt);
    return this.transaction(() => {
      requireLiveSourceFence(this.database, run);
      const finalized = this.write({
        entityKind: "ingest_run",
        entityId: run.runId,
        mutationKind: "update",
        statement: "UPDATE ingest_run SET finished_at = ?, http_status = 304, validator_result = 'not_modified', validator_capability = ?, status = 'not_modified', reason_code = 'NOT_MODIFIED', next_action = 'next_slot' WHERE run_id = ?",
        parameters: [finishedAt, response.validatorCapability, run.runId],
        sourceId: run.sourceId
      });
      if (finalized !== 1) throw new RssError("RUN_STATE_INVALID");
      const sourceUpdated = this.write({
        entityKind: "source",
        entityId: run.sourceId,
        mutationKind: "update",
        statement: "UPDATE source SET etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified), last_attempt_at = ?, last_success_at = ?, next_eligible_at = NULL, last_reason_code = 'NOT_MODIFIED' WHERE source_id = ?",
        parameters: [response.validators.etag, response.validators.lastModified, finishedAt, finishedAt, run.sourceId],
        sourceId: run.sourceId
      });
      if (sourceUpdated !== 1) throw new RssError("RUN_STATE_INVALID");
      return receipt(run, {
        status: "not_modified",
        reasonCode: "NOT_MODIFIED",
        nextAction: "next_slot",
        externalCalls: metadata.externalCalls,
        externalCallBreakdown: metadataBreakdown(metadata),
        responseSha256: null,
        itemCount: 0,
        selectedCount: 0,
        newCount: 0,
        updatedCount: 0,
        duplicateCount: 0
      });
    });
  }

  finalizeFailure(run: ClaimedRssRun, failure: RssError, metadata: FailureMetadata): RssRunReceipt {
    const finishedAt = normalizedIso(metadata.finishedAt);
    const response = metadata.httpResponse;
    const nextEligibleAt = failure.retryAfterSeconds === null
      ? null
      : new Date(Date.parse(finishedAt) + failure.retryAfterSeconds * 1000).toISOString();
    return this.transaction(() => {
      requireRunningRun(this.database, run);
      const finalized = this.write({
        entityKind: "ingest_run",
        entityId: run.runId,
        mutationKind: "update",
        statement: "UPDATE ingest_run SET finished_at = ?, http_status = ?, validator_result = ?, validator_capability = ?, response_sha256 = ?, response_bytes = ?, status = 'failed', reason_code = ?, next_action = ? WHERE run_id = ?",
        parameters: [finishedAt, failure.httpStatus, response?.kind ?? "unknown", response?.validatorCapability ?? "unknown", response?.responseSha256 ?? null, response?.responseBytes ?? 0, failure.reasonCode, failure.nextAction, run.runId],
        sourceId: run.sourceId
      });
      if (finalized !== 1) throw new RssError("RUN_STATE_INVALID");
      const sourceUpdated = this.write({
        entityKind: "source",
        entityId: run.sourceId,
        mutationKind: "update",
        statement: "UPDATE source SET enabled = CASE WHEN ? = 1 THEN 0 ELSE enabled END, stop_epoch = stop_epoch + CASE WHEN ? = 1 THEN 1 ELSE 0 END, last_attempt_at = ?, next_eligible_at = ?, last_reason_code = ? WHERE source_id = ?",
        parameters: [failure.stopSource ? 1 : 0, failure.stopSource ? 1 : 0, finishedAt, nextEligibleAt, failure.reasonCode, run.sourceId],
        sourceId: run.sourceId
      });
      if (sourceUpdated !== 1) throw new RssError("RUN_STATE_INVALID");
      return receipt(run, {
        status: "failed",
        reasonCode: failure.reasonCode,
        nextAction: failure.nextAction,
        externalCalls: metadata.externalCalls,
        externalCallBreakdown: metadataBreakdown(metadata),
        responseSha256: response?.responseSha256 ?? null,
        itemCount: 0,
        selectedCount: 0,
        newCount: 0,
        updatedCount: 0,
        duplicateCount: 0
      });
    });
  }

  finalizeResponse(
    run: ClaimedRssRun,
    response: RssHttpResponse,
    feed: ParsedRssFeed | null,
    metadata: FinalizeMetadata
  ): RssRunReceipt {
    if (response.kind === "not_modified") return this.finalizeNotModified(run, response, metadata);
    if (!feed) throw new RssError("RUN_STATE_INVALID");
    return this.finalizeModified(run, response, feed, metadata);
  }
}
