import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../db/profile.ts";
import { withImmediateTransaction } from "../db/database.ts";
import {
  TWEET_INBOX_MAX_PER_RUN,
  TWEET_INBOX_SLOT_SECONDS,
  TweetInboxError,
  type NormalizedTweetUrl,
  type ParsedTweetOembed,
  type TweetInboxItemStatus,
  type TweetInboxReasonCode
} from "./types.ts";
import { normalizeManualStatusUrl } from "./url.ts";
import {
  type XManualSourceRow,
  type XManualSubmitInput,
  type XManualSubmitResult,
  type XManualSubmissionRow,
  type XManualSubmissionState
} from "./types.ts";
import {
  buildReviewRealSchemaManifest,
  INTERNAL_OPERATION_MIGRATION_CANONICAL_SHA256,
  INTERNAL_OPERATION_SCHEMA_SHA256,
  reviewRealSchemaFingerprint
} from "../review-real/migration.ts";
import type { XManualAuthorityPort } from "../internal-operation/mutation-port.ts";

type SqlRow = Record<string, unknown>;

export type InboxItemRow = Readonly<{
  tweetId: string;
  submittedUrl: string;
  canonicalUrl: string | null;
  handle: string | null;
  authorName: string | null;
  tweetText: string | null;
  sourcePublishedAt: string | null;
  status: TweetInboxItemStatus;
  reasonCode: string;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const TWEET_INBOX_MIGRATION_SHA256 = "459c3a2c64f2fe40418e83be3c8b949a2a1c0c4010b07d7c9c7dd662c59a31e8";
export const X_MANUAL_INBOX_MIGRATION_SHA256 = "f11756ac22bff56f7f42b640e816c36ffcf12a863eed42b17afc156907ac1246";
export const X_MANUAL_INBOX_MIGRATION_CANONICAL_SHA256 = "f78b9f98227fcfb18de9bf7b09fef86cd62fd7c9282edb0bfb9fd1528fd2913a";
export const X_MANUAL_INBOX_SCHEMA_SHA256 = "db788b873d903f4a7224061a7c4628954244790d4d5794aa98ad07e746cabfc5";
// 0010 is additive: the old X tables and their guards remain byte-for-byte
// part of the schema.  Pin that projection separately so the repository can
// safely run against schema 8 or schema 10 without accepting an unverified
// table/trigger replacement.
export const X_MANUAL_INBOX_LEGACY_SCHEMA_PROJECTION_SHA256 = "679dd1afe0a310d97f9913214e11b41809608f7a46f862116645faa9b5608135";
export const X_MANUAL_SOURCE_REGISTRY_SET_SHA256 = "915a159f735e7d5a7adf1dbe2d4e3fa0509fc6c1766bf31f4123767eaf2d1d5d";
export const X_MANUAL_INVENTORY_SHA256 = "bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b";

function canonicalMigrationSha256(sql: string): string {
  const zeros = "0".repeat(64);
  return sha256(sql
    .replace(/MIGRATION_CANONICAL_SHA256=[0-9a-f]{64}/g, `MIGRATION_CANONICAL_SHA256=${zeros}`)
    .replace(/migration_sha256='[0-9a-f]{64}'/g, `migration_sha256='${zeros}'`));
}

export function tweetInboxSlotKey(scheduledAt: string): number {
  const millis = Date.parse(scheduledAt);
  if (!Number.isFinite(millis)) throw new TweetInboxError("RUN_STATE_INVALID");
  return Math.floor(millis / (TWEET_INBOX_SLOT_SECONDS * 1000));
}

export function applyTweetInboxMigration(database: DatabaseSync, sql: string): void {
  if (sha256(sql) === X_MANUAL_INBOX_MIGRATION_SHA256) {
    applyXManualInboxMigration(database, sql);
    return;
  }
  if (sha256(sql) !== TWEET_INBOX_MIGRATION_SHA256) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
  const version = Number((database.prepare("PRAGMA user_version").get() as SqlRow).user_version);
  if (version === 0) {
    const tables = database.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).all() as SqlRow[];
    if (tables.length !== 0) throw new TweetInboxError("SQLITE_FAILURE");
    withImmediateTransaction(database, () => database.exec(sql));
    return;
  }
  if (version !== 1) throw new TweetInboxError("SQLITE_FAILURE");
}

export function readTweetInboxMigrationSql(): string {
  return readFileSync(new URL("../../../migrations/tweet-inbox/0001_tweet_inbox.sql", import.meta.url), "utf8");
}

export function readXManualInboxMigrationSql(): string {
  return readFileSync(new URL("../../../migrations/rss-real/0008_x_manual_inbox.sql", import.meta.url), "utf8");
}

function assertXManualRegistry(database: DatabaseSync): void {
  const fixed = database.prepare(
    `SELECT count(*) AS count
       FROM x_manual_source_registry
      WHERE platform = 'x'
        AND enabled = 0
        AND lifecycle_status = 'proposed'
        AND collection_onboarding_status = 'validating'
        AND normalization_status = 'pending'
        AND dedup_status = 'pending'
        AND identity_status = 'unknown'
        AND relevance_status = 'unknown'
        AND monitorability = 'unknown'
        AND adapter_status = 'unchecked'
        AND adapter_authorization_status = 'unknown'
        AND platform_allowed = 'unknown'
        AND source_stop_status = 'clear'
        AND source_config_epoch = 1
        AND source_safety_epoch = 1
        AND source_kind = 'x_manual'
        AND collection_mode = 'manual_url'
        AND length(inventory_sha256) = 64`
  ).get() as SqlRow;
  if (Number(fixed.count) !== 59) throw new TweetInboxError("SQLITE_FAILURE");
  const total = database.prepare("SELECT count(*) AS count FROM x_manual_source_registry").get() as SqlRow;
  if (Number(total.count) !== 59) throw new TweetInboxError("SQLITE_FAILURE");
  const sourceSet = database.prepare(
    "SELECT source_id, handle, canonical_url FROM x_manual_source_registry ORDER BY source_id"
  ).all() as SqlRow[];
  const sourceSetValue = sourceSet.map((row) => `${String(row.source_id)}\n${String(row.handle)}\n${String(row.canonical_url)}`).join("\n");
  if (sha256(sourceSetValue) !== X_MANUAL_SOURCE_REGISTRY_SET_SHA256) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
}

function xManualLegacySchemaProjectionFingerprint(database: DatabaseSync): string {
  const entries = buildReviewRealSchemaManifest(database).filter((entry) => (
    entry.name.startsWith("x_manual") || entry.tbl_name.startsWith("x_manual")
  ));
  return sha256(canonicalJson(entries));
}

function assertXManualInboxLegacySchema(database: DatabaseSync): void {
  const foreignKeys = Number((database.prepare("PRAGMA foreign_keys").get() as SqlRow).foreign_keys);
  const recursiveTriggers = Number((database.prepare("PRAGMA recursive_triggers").get() as SqlRow).recursive_triggers);
  if (foreignKeys !== 1 || recursiveTriggers !== 1) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
  if (database.prepare("SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1").get() !== undefined) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
  for (const table of [
    "x_manual_source_registry",
    "x_manual_submission",
    "x_manual_operation",
    "x_manual_write_permit",
    "x_manual_audit"
  ]) {
    if (database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table) === undefined) {
      throw new TweetInboxError("SQLITE_FAILURE");
    }
  }
  assertXManualRegistry(database);
  if (xManualLegacySchemaProjectionFingerprint(database) !== X_MANUAL_INBOX_LEGACY_SCHEMA_PROJECTION_SHA256) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
  if (database.prepare("PRAGMA foreign_key_check").get() !== undefined) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as SqlRow;
  if (integrity.integrity_check !== "ok") throw new TweetInboxError("SQLITE_FAILURE");
}

function assertXManualSchema10Bridge(database: DatabaseSync): void {
  // Schema 10 owns mutable governance state through its own checks and Admin
  // opener's full fingerprint assertion.  This runtime boundary pins only the
  // frozen 59-row X inventory so later enable/pause/retire/epoch transitions
  // cannot break the manual inbox, while missing, extra, renamed, re-pointed,
  // retyped or substituted X rows remain fail-closed.
  const total = database.prepare(
    "SELECT count(*) AS count FROM source_registry_v1 WHERE source_kind='x_manual' AND collection_mode='manual_url'"
  ).get() as SqlRow;
  const mismatches = database.prepare(
    `SELECT count(*) AS count
       FROM (
         SELECT x.source_id, x.handle, x.canonical_url,
                r.source_id AS matched_source_id, r.display_name AS matched_handle,
                r.site_url AS matched_canonical_url
           FROM x_manual_source_registry x
           LEFT JOIN source_registry_v1 r
             ON r.source_kind = 'x_manual'
            AND r.collection_mode = 'manual_url'
            AND r.source_id = x.source_id
       )
      WHERE matched_source_id IS NULL
         OR matched_handle <> handle
         OR matched_canonical_url <> canonical_url`
  ).get() as SqlRow;
  const mappedRows = database.prepare(
    `SELECT r.source_id, r.display_name AS handle, r.site_url AS canonical_url
       FROM source_registry_v1 r
       JOIN x_manual_source_registry x ON x.source_id = r.source_id
      WHERE r.source_kind = 'x_manual'
        AND r.collection_mode = 'manual_url'
      ORDER BY r.source_id`
  ).all() as SqlRow[];
  const mappedSetValue = mappedRows.map((row) => `${String(row.source_id)}\n${String(row.handle)}\n${String(row.canonical_url)}`).join("\n");
  const identity = database.prepare(
    "SELECT x_inventory_set_sha256 FROM source_registry_migration_identity_v1 WHERE singleton_id = 1"
  ).get() as SqlRow | undefined;
  const inventory = database.prepare(
    "SELECT count(DISTINCT inventory_sha256) AS count FROM x_manual_source_registry"
  ).get() as SqlRow;
  const legacyInventorySha256 = String((database.prepare("SELECT min(inventory_sha256) AS inventory_sha256 FROM x_manual_source_registry").get() as SqlRow).inventory_sha256);
  const extraCount = Math.max(0, Number(total.count) - mappedRows.length);
  const mappingsValid = identity !== undefined &&
    String(identity.x_inventory_set_sha256) === X_MANUAL_SOURCE_REGISTRY_SET_SHA256 &&
    sha256(mappedSetValue) === X_MANUAL_SOURCE_REGISTRY_SET_SHA256;
  const inventoryValid = Number(inventory.count) === 1 && legacyInventorySha256 === X_MANUAL_INVENTORY_SHA256;
  if (
    Number(total.count) !== 59 ||
    Number(mismatches.count) !== 0 ||
    extraCount !== 0 ||
    !mappingsValid ||
    !inventoryValid
  ) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
}

/**
 * Assert the exact schema-8 X boundary.  Migration callers use this strict
 * version because 0008 is only valid at user_version 8.
 */
export function assertXManualInboxSchema(database: DatabaseSync): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as SqlRow).user_version);
  if (version !== 8) throw new TweetInboxError("SQLITE_FAILURE");
  assertXManualInboxLegacySchema(database);
  if (reviewRealSchemaFingerprint(database) !== X_MANUAL_INBOX_SCHEMA_SHA256) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
}

/**
 * Runtime compatibility check for the additive schema-10 source registry.
 * The manual X submissions still live in the immutable 0008 tables; only the
 * read-side source projection changes to source_registry_v1 on schema 10.
 */
export function assertXManualInboxRuntimeSchema(database: DatabaseSync): 8 | 10 {
  const version = Number((database.prepare("PRAGMA user_version").get() as SqlRow).user_version);
  if (version !== 8 && version !== 10) throw new TweetInboxError("SQLITE_FAILURE");
  assertXManualInboxLegacySchema(database);
  if (version === 8) {
    if (reviewRealSchemaFingerprint(database) !== X_MANUAL_INBOX_SCHEMA_SHA256) {
      throw new TweetInboxError("SQLITE_FAILURE");
    }
  } else {
    assertXManualSchema10Bridge(database);
  }
  return version;
}

/**
 * Apply 0008 only to the exact schema-7 internal-operation database. The SQL
 * owns its BEGIN IMMEDIATE and all checks are performed before any object is
 * created. An already valid schema-8 database is a verified idempotent no-op.
 */
export function applyXManualInboxMigration(database: DatabaseSync, migrationSql: string): void {
  if (
    sha256(migrationSql) !== X_MANUAL_INBOX_MIGRATION_SHA256 ||
    canonicalMigrationSha256(migrationSql) !== X_MANUAL_INBOX_MIGRATION_CANONICAL_SHA256
  ) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
  database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
  const version = Number((database.prepare("PRAGMA user_version").get() as SqlRow).user_version);
  if (version === 8) {
    assertXManualInboxSchema(database);
    return;
  }
  if (version !== 7 || reviewRealSchemaFingerprint(database) !== INTERNAL_OPERATION_SCHEMA_SHA256) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
  const databases = database.prepare("PRAGMA database_list").all() as SqlRow[];
  if (databases.some((row) => row.name !== "main" && row.name !== "temp")) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
  if (database.prepare("SELECT 1 FROM temp.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' LIMIT 1").get() !== undefined) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
  try {
    database.exec(
      "CREATE TEMP TABLE migration_0008_preflight(source_user_version INTEGER NOT NULL, source_schema_sha256 TEXT NOT NULL, migration_canonical_sha256 TEXT NOT NULL, apply_enabled INTEGER NOT NULL CHECK(apply_enabled IN (0,1))) STRICT"
    );
    database.prepare("INSERT INTO migration_0008_preflight VALUES(?,?,?,1)").run(
      7,
      INTERNAL_OPERATION_SCHEMA_SHA256,
      INTERNAL_OPERATION_MIGRATION_CANONICAL_SHA256
    );
    database.exec(migrationSql);
  } catch (error) {
    // SQLite ABORT rolls back the failing statement while leaving the outer
    // transaction active.  Close that transaction explicitly so no partially
    // created schema-8 object can leak from a failed migration.
    try { database.exec("ROLLBACK;"); } catch { /* no active transaction */ }
    try { database.exec("DROP TABLE IF EXISTS temp.migration_0008_preflight;"); } catch { /* preserve original failure */ }
    throw error;
  }
  try { database.exec("DROP TABLE IF EXISTS temp.migration_0008_preflight;"); } catch { /* cleanup only */ }
  assertXManualInboxSchema(database);
}

export class TweetInboxRepository {
  private runSerial = 0;
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  enqueue(urls: readonly NormalizedTweetUrl[], nowIso: string): Readonly<{ queued: number; duplicate: number }> {
    let queued = 0;
    let duplicate = 0;
    const insert = this.database.prepare(
      "INSERT OR IGNORE INTO inbox_item (tweet_id, submitted_url, canonical_url, handle, status, reason_code, first_seen_at, last_attempt_at) VALUES (?, ?, ?, ?, 'queued', 'OK', ?, ?)"
    );
    for (const url of urls) {
      const result = insert.run(
        url.tweetId,
        url.submittedUrl,
        url.canonicalUrl,
        url.handle,
        nowIso,
        nowIso
      );
      if (Number(result.changes) === 1) queued += 1;
      else duplicate += 1;
    }
    return { queued, duplicate };
  }

  takeQueued(limit = TWEET_INBOX_MAX_PER_RUN): InboxItemRow[] {
    const rows = this.database.prepare(
      "SELECT tweet_id, submitted_url, canonical_url, handle, author_name, tweet_text, source_published_at, status, reason_code FROM inbox_item WHERE status = 'queued' ORDER BY first_seen_at ASC, tweet_id ASC LIMIT ?"
    ).all(limit) as SqlRow[];
    return rows.map((row) => ({
      tweetId: String(row.tweet_id),
      submittedUrl: String(row.submitted_url),
      canonicalUrl: row.canonical_url === null ? null : String(row.canonical_url),
      handle: row.handle === null ? null : String(row.handle),
      authorName: row.author_name === null ? null : String(row.author_name),
      tweetText: row.tweet_text === null ? null : String(row.tweet_text),
      sourcePublishedAt: row.source_published_at === null ? null : String(row.source_published_at),
      status: row.status as TweetInboxItemStatus,
      reasonCode: String(row.reason_code)
    }));
  }

  markFetched(item: ParsedTweetOembed, nowIso: string): void {
    this.database.prepare(
      `UPDATE inbox_item
       SET canonical_url = ?, handle = ?, author_name = ?, tweet_text = ?, source_published_at = ?,
           oembed_sha256 = ?, status = 'fetched', reason_code = 'OK', last_attempt_at = ?, fetched_at = ?
       WHERE tweet_id = ? AND status = 'queued'`
    ).run(
      item.canonicalUrl,
      item.handle,
      item.authorName,
      item.text,
      item.sourcePublishedAt,
      item.oembedSha256,
      nowIso,
      nowIso,
      item.tweetId
    );
  }

  markTerminal(tweetId: string, status: "rejected" | "failed", reasonCode: TweetInboxReasonCode, nowIso: string): void {
    this.database.prepare(
      "UPDATE inbox_item SET status = ?, reason_code = ?, last_attempt_at = ? WHERE tweet_id = ? AND status = 'queued'"
    ).run(status, reasonCode, nowIso, tweetId);
  }

  readItem(tweetId: string): InboxItemRow | null {
    const row = this.database.prepare(
      "SELECT tweet_id, submitted_url, canonical_url, handle, author_name, tweet_text, source_published_at, status, reason_code FROM inbox_item WHERE tweet_id = ?"
    ).get(tweetId) as SqlRow | undefined;
    if (!row) return null;
    return {
      tweetId: String(row.tweet_id),
      submittedUrl: String(row.submitted_url),
      canonicalUrl: row.canonical_url === null ? null : String(row.canonical_url),
      handle: row.handle === null ? null : String(row.handle),
      authorName: row.author_name === null ? null : String(row.author_name),
      tweetText: row.tweet_text === null ? null : String(row.tweet_text),
      sourcePublishedAt: row.source_published_at === null ? null : String(row.source_published_at),
      status: row.status as TweetInboxItemStatus,
      reasonCode: String(row.reason_code)
    };
  }

  startRun(scheduledAt: string, startedAt: string): Readonly<{ runId: string; slotKey: number }> {
    const slotKey = tweetInboxSlotKey(scheduledAt);
    this.runSerial += 1;
    const runId = `tweet-inbox-${slotKey}-${this.runSerial}`;
    this.database.prepare(
      "INSERT INTO inbox_run (run_id, slot_key, scheduled_at, started_at, status, reason_code, next_action) VALUES (?, ?, ?, ?, 'running', 'RUNNING', 'none')"
    ).run(runId, slotKey, scheduledAt, startedAt);
    return { runId, slotKey };
  }

  finishRun(
    runId: string,
    fields: Readonly<{
      finishedAt: string;
      dropLineCount: number;
      queuedCount: number;
      fetchedCount: number;
      duplicateCount: number;
      rejectedCount: number;
      failedCount: number;
      invalidCount: number;
      externalCalls: number;
      status: "succeeded" | "idle" | "failed";
      reasonCode: TweetInboxReasonCode;
      nextAction: "none" | "next_slot" | "manual_review";
    }>
  ): void {
    this.database.prepare(
      `UPDATE inbox_run
       SET finished_at = ?, drop_line_count = ?, queued_count = ?, fetched_count = ?, duplicate_count = ?,
           rejected_count = ?, failed_count = ?, invalid_count = ?, external_calls = ?, status = ?, reason_code = ?, next_action = ?
       WHERE run_id = ? AND status = 'running'`
    ).run(
      fields.finishedAt,
      fields.dropLineCount,
      fields.queuedCount,
      fields.fetchedCount,
      fields.duplicateCount,
      fields.rejectedCount,
      fields.failedCount,
      fields.invalidCount,
      fields.externalCalls,
      fields.status,
      fields.reasonCode,
      fields.nextAction,
      runId
    );
  }
}

export type XManualCapabilityDisabled = Readonly<{
  capability: "x-oembed";
  enabled: false;
  externalCalls: 0;
  reasonCode: "CAPABILITY_DISABLED";
}>;

export type XManualInboxSnapshot = Readonly<{
  sourceCount: 59;
  submissionCount: number;
  operationCount: number;
  externalCalls: 0;
  automaticReview: false;
  automaticPublish: false;
  collectors: 0;
  search: 0;
  rules: 0;
  rsshub: 0;
  cookies: 0;
  automaticBackfill: 0;
}>;

function asIso(value: unknown, _label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TweetInboxError("SQLITE_FAILURE", { nextAction: "manual_review" });
  }
  return value;
}

function asXManualSourceRow(row: SqlRow): XManualSourceRow {
  return {
    sourceId: String(row.source_id),
    platform: "x",
    handle: String(row.handle),
    canonicalUrl: String(row.canonical_url),
    enabled: Number(row.enabled) === 1,
    lifecycleStatus: String(row.lifecycle_status) as XManualSourceRow["lifecycleStatus"],
    collectionOnboardingStatus: String(row.collection_onboarding_status) as XManualSourceRow["collectionOnboardingStatus"],
    normalizationStatus: String(row.normalization_status) as XManualSourceRow["normalizationStatus"],
    dedupStatus: String(row.dedup_status) as XManualSourceRow["dedupStatus"],
    identityStatus: String(row.identity_status) as XManualSourceRow["identityStatus"],
    relevanceStatus: String(row.relevance_status) as XManualSourceRow["relevanceStatus"],
    monitorability: String(row.monitorability) as XManualSourceRow["monitorability"],
    adapterStatus: String(row.adapter_status) as XManualSourceRow["adapterStatus"],
    adapterAuthorizationStatus: String(row.adapter_authorization_status) as XManualSourceRow["adapterAuthorizationStatus"],
    platformAllowed: String(row.platform_allowed) as XManualSourceRow["platformAllowed"],
    sourceStopStatus: String(row.source_stop_status) as XManualSourceRow["sourceStopStatus"],
    sourceConfigEpoch: Number(row.source_config_epoch),
    sourceSafetyEpoch: Number(row.source_safety_epoch),
    sourceKind: "x_manual",
    collectionMode: String(row.collection_mode) as "manual_url",
    inventorySha256: String(row.inventory_sha256),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function asXManualSubmissionRow(row: SqlRow): XManualSubmissionRow {
  return {
    submissionId: String(row.submission_id),
    revision: Number(row.revision),
    submittedUrl: String(row.submitted_url),
    canonicalUrl: String(row.canonical_url),
    statusId: String(row.status_id),
    dedupeKey: String(row.dedupe_key),
    state: String(row.state) as XManualSubmissionState,
    sourceId: row.source_id === null ? null : String(row.source_id),
    oembedAttemptId: row.oembed_attempt_id === null ? null : String(row.oembed_attempt_id),
    candidateId: row.candidate_id === null ? null : String(row.candidate_id),
    retentionExpiresAt: String(row.retention_expires_at),
    externalCalls: 0,
    mediaPublicationEligible: false,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function xManualId(prefix: "xsub" | "xop", seed: string): string {
  return `${prefix}_${sha256(seed).slice(0, 32)}`;
}

function validateXManualId(value: string, prefix: "xsub" | "xop"): string {
  if (!new RegExp(`^${prefix}_[a-z0-9]{8,64}$`).test(value)) {
    throw new TweetInboxError("SQLITE_FAILURE");
  }
  return value;
}

function defaultRetentionExpiresAt(nowIso: string): string {
  const millis = Date.parse(nowIso);
  if (!Number.isFinite(millis)) throw new TweetInboxError("SQLITE_FAILURE");
  return new Date(millis + 365 * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Repository for the schema-8 manual-only X boundary. Every write is a
 * short operation/permit transition and remains local to SQLite. The class
 * deliberately has no transport dependency; oEmbed is exposed as a stable
 * disabled capability result and never creates an external attempt.
 */
export class XManualInboxRepository {
  private readonly database: DatabaseSync;
  private readonly authorityPort: XManualAuthorityPort | null;
  private readonly schemaVersion: 8 | 10;

  constructor(database: DatabaseSync, authorityPort?: XManualAuthorityPort) {
    this.database = database;
    this.authorityPort = authorityPort ?? null;
    this.schemaVersion = assertXManualInboxRuntimeSchema(database);
  }

  listSources(): XManualSourceRow[] {
    const rows = this.schemaVersion === 10
      ? this.database.prepare(
        `SELECT r.source_id, r.display_name AS handle, r.site_url AS canonical_url,
                r.enabled, r.lifecycle_status, r.collection_onboarding_status,
                r.normalization_status, r.dedup_status, r.identity_status,
                r.relevance_status, r.monitorability, r.adapter_status,
                r.adapter_authorization_status, r.platform_allowed, r.source_stop_status,
                r.source_config_epoch, r.source_safety_epoch, r.collection_mode,
                x.inventory_sha256, r.created_at, r.updated_at
           FROM source_registry_v1 r
           JOIN x_manual_source_registry x ON x.source_id = r.source_id
          WHERE r.source_kind = 'x_manual'
          ORDER BY r.source_id`
      ).all() as SqlRow[]
      : this.database.prepare(
        `SELECT source_id, platform, handle, canonical_url, enabled, lifecycle_status,
                collection_onboarding_status, normalization_status, dedup_status,
                identity_status, relevance_status, monitorability, adapter_status,
                adapter_authorization_status, platform_allowed, source_stop_status,
                source_config_epoch, source_safety_epoch, source_kind, collection_mode,
                inventory_sha256, created_at, updated_at
           FROM x_manual_source_registry
          ORDER BY source_id`
      ).all() as SqlRow[];
    return rows.map(asXManualSourceRow);
  }

  readSource(sourceId: string): XManualSourceRow | null {
    const row = this.schemaVersion === 10
      ? this.database.prepare(
        `SELECT r.source_id, r.display_name AS handle, r.site_url AS canonical_url,
                r.enabled, r.lifecycle_status, r.collection_onboarding_status,
                r.normalization_status, r.dedup_status, r.identity_status,
                r.relevance_status, r.monitorability, r.adapter_status,
                r.adapter_authorization_status, r.platform_allowed, r.source_stop_status,
                r.source_config_epoch, r.source_safety_epoch, r.collection_mode,
                x.inventory_sha256, r.created_at, r.updated_at
           FROM source_registry_v1 r
           JOIN x_manual_source_registry x ON x.source_id = r.source_id
          WHERE r.source_kind = 'x_manual' AND r.source_id = ?`
      ).get(sourceId) as SqlRow | undefined
      : this.database.prepare(
        `SELECT source_id, platform, handle, canonical_url, enabled, lifecycle_status,
                collection_onboarding_status, normalization_status, dedup_status,
                identity_status, relevance_status, monitorability, adapter_status,
                adapter_authorization_status, platform_allowed, source_stop_status,
                source_config_epoch, source_safety_epoch, source_kind, collection_mode,
                inventory_sha256, created_at, updated_at
           FROM x_manual_source_registry
          WHERE source_id = ?`
      ).get(sourceId) as SqlRow | undefined;
    return row ? asXManualSourceRow(row) : null;
  }

  readSubmission(submissionId: string): XManualSubmissionRow | null {
    const row = this.database.prepare(
      `SELECT submission_id, revision, submitted_url, canonical_url, status_id, dedupe_key, state,
              source_id, oembed_attempt_id, candidate_id, retention_expires_at, created_at, updated_at
         FROM x_manual_submission
        WHERE submission_id = ?`
    ).get(submissionId) as SqlRow | undefined;
    return row ? asXManualSubmissionRow(row) : null;
  }

  listSubmissions(options: Readonly<{ state?: XManualSubmissionState; sourceId?: string; limit?: number }> = {}): XManualSubmissionRow[] {
    const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 50)));
    const rows = this.database.prepare(
      `SELECT submission_id, revision, submitted_url, canonical_url, status_id, dedupe_key, state,
              source_id, oembed_attempt_id, candidate_id, retention_expires_at, created_at, updated_at
         FROM x_manual_submission
        WHERE (? IS NULL OR state = ?)
          AND (? IS NULL OR source_id = ?)
        ORDER BY created_at DESC, submission_id DESC
        LIMIT ?`
    ).all(options.state ?? null, options.state ?? null, options.sourceId ?? null, options.sourceId ?? null, limit) as SqlRow[];
    return rows.map(asXManualSubmissionRow);
  }

  submitManualStatusUrl(input: XManualSubmitInput): XManualSubmitResult {
    const nowIso = asIso(input.nowIso, "nowIso");
    const parsed = normalizeManualStatusUrl(input.submittedUrl);
    const dedupeKey = sha256(`x-status-v1\n${parsed.statusId}`);
    const existing = this.database.prepare(
      `SELECT submission_id, revision, submitted_url, canonical_url, status_id, dedupe_key, state,
              source_id, oembed_attempt_id, candidate_id, retention_expires_at, created_at, updated_at
         FROM x_manual_submission WHERE dedupe_key = ?`
    ).get(dedupeKey) as SqlRow | undefined;
    if (existing) {
      return {
        submission: asXManualSubmissionRow(existing),
        duplicate: true,
        externalCalls: 0,
        automaticReview: false,
        automaticPublish: false
      };
    }

    const submissionId = validateXManualId(
      input.submissionId ?? xManualId("xsub", `submit\n${dedupeKey}`),
      "xsub"
    );
    const operationId = validateXManualId(
      input.operationId ?? xManualId("xop", `submit\n${dedupeKey}`),
      "xop"
    );
    const idempotencyKey = input.idempotencyKey ?? `x-submit:${dedupeKey}`;
    if (idempotencyKey.length < 8 || idempotencyKey.length > 256) throw new TweetInboxError("SQLITE_FAILURE");
    const retentionExpiresAt = asIso(input.retentionExpiresAt ?? defaultRetentionExpiresAt(nowIso), "retentionExpiresAt");
    const source = this.schemaVersion === 10
      ? this.database.prepare(
        "SELECT source_id FROM source_registry_v1 WHERE lower(display_name) = lower(?) AND source_kind = 'x_manual' AND enabled = 0 AND collection_mode = 'manual_url'"
      ).get(parsed.handle) as SqlRow | undefined
      : this.database.prepare(
        "SELECT source_id FROM x_manual_source_registry WHERE lower(handle) = lower(?) AND enabled = 0 AND collection_mode = 'manual_url'"
      ).get(parsed.handle) as SqlRow | undefined;
    const sourceId = source ? String(source.source_id) : null;
    if (this.authorityPort === null) throw new Error("X_MANUAL_AUTHORITY_REQUIRED");
    this.authorityPort.mutateXManual({
      operationId,
      idempotencyKey,
      mutation: {
        semanticKind: "x_submit",
        submissionId,
        expectedRevision: 0,
        submittedUrl: parsed.submittedUrl,
        canonicalUrl: parsed.canonicalUrl,
        statusId: parsed.statusId,
        dedupeKey,
        sourceId,
        retentionExpiresAt,
        nowIso,
      },
    });

    const row = this.readSubmission(submissionId);
    if (!row) {
      const replay = this.database.prepare(
        `SELECT submission_id, revision, submitted_url, canonical_url, status_id, dedupe_key, state,
                source_id, oembed_attempt_id, candidate_id, retention_expires_at, created_at, updated_at
           FROM x_manual_submission WHERE dedupe_key = ?`
      ).get(dedupeKey) as SqlRow | undefined;
      if (!replay) throw new TweetInboxError("SQLITE_FAILURE");
      return { submission: asXManualSubmissionRow(replay), duplicate: true, externalCalls: 0, automaticReview: false, automaticPublish: false };
    }
    return { submission: row, duplicate: false, externalCalls: 0, automaticReview: false, automaticPublish: false };
  }

  retireManualStatus(input: Readonly<{
    submissionId: string;
    expectedRevision: number;
    nowIso: string;
    operationId?: string;
    idempotencyKey?: string;
  }>): XManualSubmissionRow {
    const nowIso = asIso(input.nowIso, "nowIso");
    const current = this.readSubmission(input.submissionId);
    if (current && current.state === "retired" && current.revision === input.expectedRevision + 1) {
      return current;
    }
    if (!current || current.revision !== input.expectedRevision || !["submitted", "validated"].includes(current.state)) {
      throw new TweetInboxError("SQLITE_FAILURE");
    }
    const operationId = validateXManualId(
      input.operationId ?? xManualId("xop", `retire\n${input.submissionId}\n${input.expectedRevision}`),
      "xop"
    );
    const idempotencyKey = input.idempotencyKey ?? `x-retire:${input.submissionId}:${input.expectedRevision}`;
    if (this.authorityPort === null) throw new Error("X_MANUAL_AUTHORITY_REQUIRED");
    this.authorityPort.mutateXManual({
      operationId,
      idempotencyKey,
      mutation: {
        semanticKind: "x_retire",
        submissionId: input.submissionId,
        expectedRevision: input.expectedRevision,
        nowIso,
      },
    });
    const retired = this.readSubmission(input.submissionId);
    if (!retired) throw new TweetInboxError("SQLITE_FAILURE");
    return retired;
  }

  resolveOembed(): XManualCapabilityDisabled {
    return { capability: "x-oembed", enabled: false, externalCalls: 0, reasonCode: "CAPABILITY_DISABLED" };
  }

  snapshot(): XManualInboxSnapshot {
    const submissions = this.database.prepare("SELECT count(*) AS count FROM x_manual_submission").get() as SqlRow;
    const operations = this.database.prepare("SELECT count(*) AS count FROM x_manual_operation").get() as SqlRow;
    return {
      sourceCount: 59,
      submissionCount: Number(submissions.count),
      operationCount: Number(operations.count),
      externalCalls: 0,
      automaticReview: false,
      automaticPublish: false,
      collectors: 0,
      search: 0,
      rules: 0,
      rsshub: 0,
      cookies: 0,
      automaticBackfill: 0
    };
  }
}
