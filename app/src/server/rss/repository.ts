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
  type SourceValidators
} from "./types.ts";
import { assertRssMediaRefinementSchema } from "../review-real/migration.ts";

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
  sourceId: typeof RSS_SOURCE_ID;
  enabled: boolean;
  stopEpoch: number;
  validators: SourceValidators;
  nextEligibleAt: string | null;
}>;

type FinalizeMetadata = Readonly<{
  finishedAt: string;
  externalCalls: 0 | 1;
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
  ).get(RSS_SOURCE_ID) as SqlRow | undefined;
  if (!source || Number(source.enabled) !== 1 || Number(source.stop_epoch) !== run.stopEpoch) {
    throw new RssError("SOURCE_STOPPED");
  }
}

function receipt(
  run: ClaimedRssRun,
  values: Omit<RssRunReceipt, "schemaVersion" | "profile" | "sourceId" | "runId" | "slotKey">
): RssRunReceipt {
  return {
    schemaVersion: "rss-real-receipt-v1",
    profile: RSS_PROFILE_ID,
    sourceId: RSS_SOURCE_ID,
    runId: run.runId,
    slotKey: run.slotKey,
    ...values
  };
}

export function openRssDatabase(appRoot: string): DatabaseSync {
  const database = openSafeDatabase(RSS_DATABASE_PATH, { appRoot });
  const runtime = readSqliteRuntime(database);
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
  } else if (version !== 1 && version !== 4) {
    throw new RssError("MIGRATION_DRIFT");
  }
  if (version === 4) {
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

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  readSource(): RssSourceState {
    const row = this.database.prepare("SELECT * FROM source WHERE source_id = ?").get(RSS_SOURCE_ID) as SqlRow | undefined;
    if (!row || row.feed_url !== RSS_FEED_URL) throw new RssError("MIGRATION_DRIFT");
    return {
      sourceId: RSS_SOURCE_ID,
      enabled: Number(row.enabled) === 1,
      stopEpoch: Number(row.stop_epoch),
      validators: {
        etag: row.etag === null ? null : String(row.etag),
        lastModified: row.last_modified === null ? null : String(row.last_modified)
      },
      nextEligibleAt: row.next_eligible_at === null ? null : String(row.next_eligible_at)
    };
  }

  claimRun(scheduledAtValue: string, startedAtValue: string): ClaimedRssRun {
    const scheduledAt = normalizedIso(scheduledAtValue);
    const startedAt = normalizedIso(startedAtValue);
    const slotKey = rssSlotKey(scheduledAt);
    const runId = `rss-run-${slotKey}`;
    return withImmediateTransaction(this.database, () => {
      const source = this.readSource();
      if (!source.enabled) throw new RssError("SOURCE_STOPPED");
      if (source.nextEligibleAt !== null && Date.parse(source.nextEligibleAt) > Date.parse(scheduledAt)) {
        throw new RssError("SOURCE_NOT_ELIGIBLE", { nextAction: "next_slot" });
      }
      const sameSlot = this.database.prepare("SELECT 1 AS present FROM ingest_run WHERE slot_key = ?").get(slotKey);
      if (sameSlot) throw new RssError("SLOT_ALREADY_RECORDED", { nextAction: "next_slot" });

      const running = this.database.prepare(
        "SELECT run_id, started_at FROM ingest_run WHERE status = 'running' ORDER BY started_at LIMIT 1"
      ).get() as SqlRow | undefined;
      if (running) {
        const age = Date.parse(startedAt) - Date.parse(String(running.started_at));
        if (!Number.isFinite(age) || age < 30_000) throw new RssError("RUN_IN_FLIGHT", { nextAction: "next_slot" });
        this.database.prepare(
          "UPDATE ingest_run SET finished_at = ?, status = 'failed', reason_code = 'PROCESS_INTERRUPTED', next_action = 'manual_review' WHERE run_id = ? AND status = 'running'"
        ).run(startedAt, String(running.run_id));
      }

      const latest = this.database.prepare("SELECT MAX(slot_key) AS slot_key FROM ingest_run").get() as SqlRow;
      const latestSlot = latest.slot_key === null ? null : Number(latest.slot_key);
      if (latestSlot !== null && latestSlot < slotKey - 1) {
        const gapSlot = slotKey - 1;
        const gapAt = new Date(gapSlot * RSS_SLOT_SECONDS * 1000).toISOString();
        this.database.prepare(
          "INSERT OR IGNORE INTO ingest_run (run_id, source_id, slot_key, scheduled_at, started_at, finished_at, validator_result, validator_capability, status, reason_code, next_action) VALUES (?, ?, ?, ?, ?, ?, 'unknown', 'unknown', 'scheduler_gap', 'SCHEDULER_GAP', 'manual_review')"
        ).run(`rss-gap-${gapSlot}`, RSS_SOURCE_ID, gapSlot, gapAt, startedAt, startedAt);
      }

      this.database.prepare(
        "INSERT INTO ingest_run (run_id, source_id, slot_key, scheduled_at, started_at, validator_result, validator_capability, status, reason_code, next_action) VALUES (?, ?, ?, ?, ?, 'unknown', 'unknown', 'running', 'RUNNING', 'none')"
      ).run(runId, RSS_SOURCE_ID, slotKey, scheduledAt, startedAt);
      return { runId, slotKey, scheduledAt, startedAt, stopEpoch: source.stopEpoch };
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
    return withImmediateTransaction(this.database, () => {
      requireLiveSourceFence(this.database, run);
      const supportsMedia = Number(
        (this.database.prepare("PRAGMA user_version").get() as SqlRow).user_version
      ) === 4;
      let newCount = 0;
      let updatedCount = 0;
      let duplicateCount = 0;
      for (const item of feed.items) {
        const dedupeKey = sha256(`${RSS_SOURCE_ID}\u001f${item.externalId}`);
        const existing = this.database.prepare(
          "SELECT candidate_id, external_id, source_payload_hash, source_revision FROM pending_review_candidate WHERE dedupe_key = ?"
        ).get(dedupeKey) as SqlRow | undefined;
        let candidateId: string;
        let sourceRevision: number;
        if (!existing) {
          candidateId = `rss-candidate-${dedupeKey.slice(0, 32)}`;
          sourceRevision = 1;
          this.database.prepare(
            "INSERT INTO pending_review_candidate (candidate_id, source_id, external_id, dedupe_key, canonical_url, title, excerpt, author, published_at, source_payload_hash, source_revision, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
          ).run(
            candidateId,
            RSS_SOURCE_ID,
            item.externalId,
            dedupeKey,
            item.canonicalUrl,
            item.title,
            item.excerpt,
            item.author,
            item.publishedAt,
            item.sourcePayloadHash,
            finishedAt,
            finishedAt
          );
          newCount += 1;
        } else if (existing.source_payload_hash === item.sourcePayloadHash) {
          candidateId = requiredCandidateText(existing, "candidate_id");
          sourceRevision = requiredCandidateInteger(existing, "source_revision");
          this.database.prepare(
            "UPDATE pending_review_candidate SET last_seen_at = ? WHERE dedupe_key = ?"
          ).run(finishedAt, dedupeKey);
          duplicateCount += 1;
        } else {
          if (existing.external_id !== item.externalId) throw new RssError("RUN_STATE_INVALID");
          this.database.prepare(
            "UPDATE pending_review_candidate SET canonical_url = ?, title = ?, excerpt = ?, author = ?, published_at = ?, source_payload_hash = ?, source_revision = source_revision + 1, last_seen_at = ? WHERE dedupe_key = ?"
          ).run(
            item.canonicalUrl,
            item.title,
            item.excerpt,
            item.author,
            item.publishedAt,
            item.sourcePayloadHash,
            finishedAt,
            dedupeKey
          );
          candidateId = requiredCandidateText(existing, "candidate_id");
          sourceRevision = requiredCandidateInteger(existing, "source_revision") + 1;
          updatedCount += 1;
        }
        if (supportsMedia && item.media !== null && this.database.prepare(
          "SELECT 1 AS present FROM rss_media_candidate WHERE candidate_id = ? AND source_revision = ?"
        ).get(candidateId, sourceRevision) === undefined) {
          this.database.prepare(
            "INSERT OR IGNORE INTO rss_media_candidate (candidate_id, source_revision, source_payload_hash, media_url, media_type, declared_bytes, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).run(
            candidateId,
            sourceRevision,
            item.sourcePayloadHash,
            item.media.url,
            item.media.mimeType,
            item.media.declaredBytes,
            finishedAt
          );
        }
      }
      this.database.prepare(
        "UPDATE ingest_run SET finished_at = ?, http_status = 200, validator_result = 'modified', validator_capability = ?, response_sha256 = ?, response_bytes = ?, item_count = ?, selected_count = ?, new_count = ?, updated_count = ?, duplicate_count = ?, status = 'succeeded', reason_code = 'OK', next_action = 'next_slot' WHERE run_id = ?"
      ).run(
        finishedAt,
        response.validatorCapability,
        response.responseSha256,
        response.responseBytes,
        feed.itemCount,
        feed.items.length,
        newCount,
        updatedCount,
        duplicateCount,
        run.runId
      );
      this.database.prepare(
        "UPDATE source SET etag = ?, last_modified = ?, last_attempt_at = ?, last_success_at = ?, next_eligible_at = NULL, last_reason_code = 'OK' WHERE source_id = ?"
      ).run(response.validators.etag, response.validators.lastModified, finishedAt, finishedAt, RSS_SOURCE_ID);
      return receipt(run, {
        status: "succeeded",
        reasonCode: "OK",
        nextAction: "next_slot",
        externalCalls: metadata.externalCalls,
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
    return withImmediateTransaction(this.database, () => {
      requireLiveSourceFence(this.database, run);
      this.database.prepare(
        "UPDATE ingest_run SET finished_at = ?, http_status = 304, validator_result = 'not_modified', validator_capability = ?, status = 'not_modified', reason_code = 'NOT_MODIFIED', next_action = 'next_slot' WHERE run_id = ?"
      ).run(finishedAt, response.validatorCapability, run.runId);
      this.database.prepare(
        "UPDATE source SET etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified), last_attempt_at = ?, last_success_at = ?, next_eligible_at = NULL, last_reason_code = 'NOT_MODIFIED' WHERE source_id = ?"
      ).run(response.validators.etag, response.validators.lastModified, finishedAt, finishedAt, RSS_SOURCE_ID);
      return receipt(run, {
        status: "not_modified",
        reasonCode: "NOT_MODIFIED",
        nextAction: "next_slot",
        externalCalls: metadata.externalCalls,
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
    return withImmediateTransaction(this.database, () => {
      requireRunningRun(this.database, run);
      this.database.prepare(
        "UPDATE ingest_run SET finished_at = ?, http_status = ?, validator_result = ?, validator_capability = ?, response_sha256 = ?, response_bytes = ?, status = 'failed', reason_code = ?, next_action = ? WHERE run_id = ?"
      ).run(
        finishedAt,
        failure.httpStatus,
        response?.kind ?? "unknown",
        response?.validatorCapability ?? "unknown",
        response?.responseSha256 ?? null,
        response?.responseBytes ?? 0,
        failure.reasonCode,
        failure.nextAction,
        run.runId
      );
      this.database.prepare(
        "UPDATE source SET enabled = CASE WHEN ? = 1 THEN 0 ELSE enabled END, stop_epoch = stop_epoch + CASE WHEN ? = 1 THEN 1 ELSE 0 END, last_attempt_at = ?, next_eligible_at = ?, last_reason_code = ? WHERE source_id = ?"
      ).run(
        failure.stopSource ? 1 : 0,
        failure.stopSource ? 1 : 0,
        finishedAt,
        nextEligibleAt,
        failure.reasonCode,
        RSS_SOURCE_ID
      );
      return receipt(run, {
        status: "failed",
        reasonCode: failure.reasonCode,
        nextAction: failure.nextAction,
        externalCalls: metadata.externalCalls,
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
