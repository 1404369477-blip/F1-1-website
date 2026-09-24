import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson, hash, integer, readBoundedRegularFile, record, requireValue, sha256, timestamp, worstStatus } from "./readonly.ts";
import type { BackupPointSample, ControlSample, CountAge, DatabaseReason, DatabaseSample, DatabaseSampleConfig, RssSourceSample, SiteStatus } from "./types.ts";

export const RSS_SOURCE_IDS = ["motorsport-f1-news", "the-race-f1-news", "skysports-f1-news"] as const;
export const RSS_CUTOFF = "2026-09-05T02:30:00.000Z" as const;
const SOURCE_STALE_MS = 900_000;
const SOURCE_FAILED_MS = 1_800_000;
const MAX_TRANSACTION_MS = 2_500;
const UNKNOWN_LIMIT = 10_000;

// Exact worker selection before pagination; a draft at any older revision/hash is insufficient.
const BACKLOG_WHERE = `c.source_id=? AND c.first_seen_at>=?
  AND (c.review_status IN ('pending_review','approved') OR (c.review_status='published' AND NOT EXISTS(
    SELECT 1 FROM review_bundle b WHERE b.candidate_id=c.candidate_id AND b.source_revision=c.source_revision
    AND b.source_payload_hash=c.source_payload_hash AND b.bundle_revision=(SELECT MAX(latest.bundle_revision)
      FROM review_bundle latest WHERE latest.candidate_id=c.candidate_id))))`;
const CURRENT_DRAFT = `EXISTS(SELECT 1 FROM machine_summary_draft d WHERE d.candidate_id=c.candidate_id
  AND d.source_revision=c.source_revision AND d.source_payload_hash=c.source_payload_hash)`;

/** This is the supervisor's legal registration predicate, without invoking its writer-capable closure. */
const MATCHED_POINT_SQL = `SELECT p.*,op.request_hash AS registration_evidence_sha256 FROM valid_backup_recovery_point_v1 p
  JOIN internal_operation op ON op.operation_id=p.operation_id AND op.owner_process='backup_worker' AND op.operation_kind='backup' AND op.state='succeeded'
  AND op.capability_class='backup' AND op.egress_class='backup_private'
  AND op.expected_schema_sha256=p.database_schema_sha256 AND op.expected_release_sha256=p.release_sha256
  AND op.expected_manifest_sha256=p.deployment_manifest_sha256 AND op.expected_writer_epoch=p.writer_epoch AND op.recovery_epoch=p.recovery_epoch
  JOIN owner_authorization_handoff handoff ON handoff.handoff_id=op.authorization_handoff_id AND handoff.owner_process='backup_worker'
  AND handoff.consumed_by_operation_id=op.operation_id AND handoff.release_sha256=p.release_sha256 AND handoff.manifest_sha256=p.deployment_manifest_sha256
  WHERE p.database_schema_sha256=? AND p.release_sha256=? AND p.deployment_manifest_sha256=? AND p.writer_epoch=? AND p.recovery_epoch=?
  AND p.writer_authority_receipt_sha256=? ORDER BY p.recovery_point_at DESC LIMIT 1`;

/** Private evidence never enters the JSON DTO. The inspector accepts only this sample's original object. */
export type BackupReadContext = Readonly<{ point: Readonly<Record<string, unknown>>; userVersion: number; sqliteMasterSha256: string }>;
const backupContexts = new WeakMap<DatabaseSample, BackupReadContext>();
export function getBackupReadContext(sample: DatabaseSample): BackupReadContext | undefined {
  return backupContexts.get(sample);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  requireValue(typeof value === "string" && allowed.includes(value as T));
  return value as T;
}

function age(value: unknown, now: number): { at: string; ageMs: number } {
  const at = timestamp(value), ageMs = now - Date.parse(at);
  requireValue(ageMs >= 0);
  return { at, ageMs };
}

function countAge(row: Record<string, unknown> | undefined, now: number): CountAge {
  requireValue(row);
  const count = integer(row.count);
  if (count === 0) {
    requireValue(row.oldest_at === null);
    return { count, oldestAt: null, oldestAgeMs: null };
  }
  const oldest = age(row.oldest_at, now);
  return { count, oldestAt: oldest.at, oldestAgeMs: oldest.ageMs };
}

function readControl(row: Record<string, unknown> | undefined, observedAt: string): ControlSample {
  requireValue(row);
  const phase = oneOf(row.phase, ["disabled", "backlog", "live", "paused"] as const);
  const globalStopState = oneOf(row.global_stop_state, ["clear", "stopped"] as const);
  const emergencyStopState = oneOf(row.emergency_stop_state, ["clear", "stopped"] as const);
  const recoveryState = oneOf(row.recovery_state, ["ready", "fenced", "restoring", "verifying", "failed"] as const);
  const deletionFenceState = oneOf(row.deletion_fence_state, ["clear", "blocked", "unknown"] as const);
  const publicationFenceState = oneOf(row.publication_fence_state, ["clear", "blocked", "unknown"] as const);
  return { status: phase === "live" && globalStopState === "clear" && emergencyStopState === "clear"
    && recoveryState === "ready" && deletionFenceState === "clear" && publicationFenceState === "clear" ? "healthy" : "failed",
  observedAt, phase, globalStopState, emergencyStopState, recoveryState, deletionFenceState, publicationFenceState,
  writerEpoch: integer(row.writer_epoch, 1), recoveryEpoch: integer(row.recovery_epoch, 1),
  sourceConfigEpoch: integer(row.source_config_epoch, 1), sourceSafetyEpoch: integer(row.source_safety_epoch, 1),
  authorizationVersion: integer(row.authorization_version, 1), policyEpoch: integer(row.policy_epoch, 1),
  writerAuthorityReceiptSha256: hash(row.writer_authority_receipt_sha256) };
}

function assertDatabaseFile(config: DatabaseSampleConfig): void {
  requireValue(realpathSync(config.databasePath) === config.databasePath);
  const fd = openSync(config.databasePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd), expected = config.expectedDatabaseIdentity;
    requireValue(stat.isFile() && stat.nlink === 1 && stat.dev === expected.device && stat.ino === expected.inode && stat.uid === expected.uid);
    const header = Buffer.alloc(100);
    requireValue(readSync(fd, header, 0, header.length, 0) === 100 && header.subarray(0, 16).toString("binary") === "SQLite format 3\0");
    // A read-only WAL connection may otherwise create absent sidecars. Fail before opening it.
    if (header[18] === 2 || header[19] === 2) {
      for (const suffix of ["-wal", "-shm"]) {
        const path = `${config.databasePath}${suffix}`, sidecar = lstatSync(path);
        requireValue(realpathSync(path) === path && sidecar.isFile() && sidecar.nlink === 1 && sidecar.uid === expected.uid);
      }
    }
  } finally { closeSync(fd); }
}

function readPoint(row: Record<string, unknown>, now: number): BackupPointSample {
  requireValue(typeof row.backup_set_id === "string" && /^[0-9]{13}_[a-f0-9]{16}$/.test(row.backup_set_id));
  const pointAt = timestamp(row.recovery_point_at), completedAt = timestamp(row.completed_at);
  requireValue(Date.parse(completedAt) >= Date.parse(pointAt));
  return { packageRef: sha256(row.backup_set_id), recoveryPointAt: pointAt, completedAt, ageMs: now - Date.parse(pointAt),
    manifestSha256: hash(row.backup_manifest_sha256), databaseSnapshotSha256: hash(row.database_snapshot_sha256),
    deploymentManifestSha256: hash(row.deployment_manifest_sha256), releaseSha256: hash(row.release_sha256),
    schemaSha256: hash(row.database_schema_sha256), writerEpoch: integer(row.writer_epoch, 1), recoveryEpoch: integer(row.recovery_epoch, 1),
    writerAuthorityReceiptSha256: hash(row.writer_authority_receipt_sha256), projectionGeneration: integer(row.projection_generation),
    projectionManifestSha256: row.projection_manifest_sha256 === null ? null : hash(row.projection_manifest_sha256) };
}

export function sampleDatabase(config: DatabaseSampleConfig, now = new Date()): DatabaseSample {
  const nowMs = now.getTime(), observedAt = Number.isFinite(nowMs) ? now.toISOString() : new Date().toISOString();
  const failed = (reason: DatabaseReason): DatabaseSample => ({ status: "unknown", observedAt, reasons: [reason],
    identity: null, control: null, rss: null, pipeline: null, backupPoint: null });
  if (!Number.isFinite(nowMs)) return failed("CLOCK_INVALID");
  let database: DatabaseSync | undefined, inTransaction = false;
  let failureReason: DatabaseReason = "DEPLOYMENT_IDENTITY_MISMATCH";
  try {
    const deploymentRaw = readBoundedRegularFile(config.deploymentManifestPath, 256 * 1024);
    requireValue(sha256(deploymentRaw) === hash(config.expectedDeploymentManifestSha256));
    const deployment = record(JSON.parse(deploymentRaw.toString("utf8")));
    const deployedDatabase = record(deployment.reviewDatabaseIdentity);
    requireValue(deployment.reviewSchemaSha256 === hash(config.expectedSchemaSha256)
      && deployment.fullReleaseManifestSha256 === hash(config.expectedReleaseSha256)
      && deployment.reviewSchemaTarget === 10
      && deployment.reviewDatabasePath === config.databasePath && deployment.rssAutomaticCutoffIso === RSS_CUTOFF
      && deployedDatabase.dev === config.expectedDatabaseIdentity.device && deployedDatabase.ino === config.expectedDatabaseIdentity.inode
      && deployedDatabase.uid === config.expectedDatabaseIdentity.uid && deployedDatabase.nlink === 1);
    failureReason = "DATABASE_IDENTITY_MISMATCH";
    assertDatabaseFile(config);
    failureReason = "DATABASE_READ_FAILED";
    const busyTimeoutMs = config.busyTimeoutMs ?? 150;
    requireValue(Number.isInteger(busyTimeoutMs) && busyTimeoutMs >= 0 && busyTimeoutMs <= 1_000);
    database = new DatabaseSync(config.databasePath, { readOnly: true, allowExtension: false });
    database.exec(`PRAGMA query_only=ON; PRAGMA busy_timeout=${busyTimeoutMs}; BEGIN DEFERRED`);
    inTransaction = true;
    const transactionStarted = performance.now();
    const checkTime = () => {
      if (performance.now() - transactionStarted > MAX_TRANSACTION_MS) {
        failureReason = "DATABASE_SAMPLE_LIMIT";
        throw new Error("SAMPLE_LIMIT");
      }
    };
    const get = (sql: string, ...args: (string | number)[]) => {
      checkTime(); const row = database!.prepare(sql).get(...args); checkTime(); return row;
    };
    const all = (sql: string, ...args: (string | number)[]) => {
      checkTime(); const rows = database!.prepare(sql).all(...args); checkTime(); return rows;
    };
    const schema = all("SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE lower(name) NOT GLOB 'sqlite_*' ORDER BY type,name,tbl_name,sql LIMIT 2001");
    failureReason = "DATABASE_SCHEMA_MISMATCH";
    requireValue(schema.length <= 2_000);
    const schemaJson = canonicalJson(schema);
    requireValue(schemaJson.length <= 4 * 1024 * 1024 && sha256(schemaJson) === config.expectedSchemaSha256);
    const userVersion = integer(get("PRAGMA user_version")?.user_version);
    requireValue(userVersion === deployment.reviewSchemaTarget);
    // The backup producer hashes all sqlite_master rows (including sqlite_* objects), using
    // field separators rather than the filtered canonical JSON deployment schema fingerprint.
    const master = all("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name LIMIT 2001");
    requireValue(master.length <= 2_000);
    const masterText = master.map(row => {
      requireValue(typeof row.type === "string" && typeof row.name === "string" && typeof row.tbl_name === "string"
        && (row.sql === null || typeof row.sql === "string"));
      return `${row.type}\x1f${row.name}\x1f${row.tbl_name}\x1f${row.sql ?? ""}`;
    }).join("\n");
    requireValue(masterText.length <= 4 * 1024 * 1024);
    const sqliteMasterSha256 = sha256(masterText);
    failureReason = "DATABASE_DATA_INVALID";
    const control = readControl(get("SELECT * FROM internal_control WHERE singleton_id=1"), observedAt);
    const reasons: DatabaseReason[] = control.status === "healthy" ? [] : ["CONTROL_CLOSED"];
    const sources: RssSourceSample[] = RSS_SOURCE_IDS.map(sourceId => {
      const source = get(`SELECT s.enabled,s.last_attempt_at,s.last_success_at,r.enabled AS registry_enabled,
        r.source_stop_status FROM source s JOIN source_registry_v1 r ON r.source_id=s.source_id WHERE s.source_id=?`, sourceId);
      requireValue(source);
      const enabled = source.enabled === 1 && source.registry_enabled === 1 && source.source_stop_status === "clear";
      const sourceReasons: DatabaseReason[] = [], states: SiteStatus[] = [];
      if (!enabled) { sourceReasons.push("RSS_SOURCE_DISABLED"); states.push("failed"); }
      const lastAttempt = source.last_attempt_at === null ? null : age(source.last_attempt_at, nowMs);
      const lastSuccess = source.last_success_at === null ? null : age(source.last_success_at, nowMs);
      if (!lastSuccess) { sourceReasons.push("RSS_SUCCESS_UNKNOWN"); states.push("unknown"); }
      else if (lastSuccess.ageMs > SOURCE_STALE_MS) { sourceReasons.push("RSS_SUCCESS_STALE"); states.push(lastSuccess.ageMs > SOURCE_FAILED_MS ? "failed" : "degraded"); }
      const latestAttempt = get("SELECT status FROM ingest_run WHERE source_id=? ORDER BY slot_key DESC LIMIT 1", sourceId);
      const latestAttemptStatus = latestAttempt ? oneOf(latestAttempt.status, ["running", "succeeded", "not_modified", "failed", "scheduler_gap"] as const) : null;
      if (latestAttemptStatus === "failed" || latestAttemptStatus === "scheduler_gap") {
        sourceReasons.push("RSS_LATEST_ATTEMPT_FAILED"); states.push("degraded");
      }
      const slots = all(`SELECT scheduled_at,started_at,finished_at FROM ingest_run WHERE source_id=?
        AND status IN ('succeeded','not_modified') ORDER BY slot_key DESC LIMIT 2`, sourceId);
      const slotTimes = slots.map(row => {
        const started = age(row.started_at, nowMs), finished = age(row.finished_at, nowMs);
        requireValue(Date.parse(finished.at) >= Date.parse(started.at)); return started.at;
      });
      const scheduledTimes = slots.map(row => age(row.scheduled_at, nowMs).at);
      const interval = slotTimes.length === 2 ? Date.parse(slotTimes[0]) - Date.parse(slotTimes[1]) : null;
      const scheduledInterval = scheduledTimes.length === 2 ? Date.parse(scheduledTimes[0]) - Date.parse(scheduledTimes[1]) : null;
      if (interval === null) { sourceReasons.push("RSS_SLOT_INTERVAL_UNKNOWN"); states.push("unknown"); }
      else {
        requireValue(interval > 0);
        if (interval > 900_000) { sourceReasons.push("RSS_SLOT_INTERVAL_EXCEEDED"); states.push("degraded"); }
      }
      const candidateCounts = { pending_review: 0, approved: 0, published: 0, rejected: 0, other: 0 };
      for (const row of all(`SELECT review_status,count(*) AS count FROM pending_review_candidate
        WHERE source_id=? AND first_seen_at>=? GROUP BY review_status LIMIT 100`, sourceId, RSS_CUTOFF)) {
        const key = row.review_status === "pending_review" || row.review_status === "approved" || row.review_status === "published" || row.review_status === "rejected" ? row.review_status : "other";
        candidateCounts[key] += integer(row.count);
      }
      const counts = (extra: string) => countAge(get(`SELECT count(*) AS count,min(c.first_seen_at) AS oldest_at
        FROM pending_review_candidate c WHERE ${BACKLOG_WHERE} ${extra}`, sourceId, RSS_CUTOFF), nowMs);
      const backlog = counts(""), missingCurrentDraft = counts(`AND NOT ${CURRENT_DRAFT}`);
      const awaitingReview = counts(`AND ${CURRENT_DRAFT} AND c.review_status='pending_review'`);
      const queuedPublications = countAge(get(`SELECT count(*) AS count,min(p.created_at) AS oldest_at FROM publication p
        JOIN review_bundle b ON b.bundle_id=p.bundle_id JOIN pending_review_candidate c ON c.candidate_id=b.candidate_id
        WHERE c.source_id=? AND c.first_seen_at>=? AND p.publication_status='queued'
        AND b.source_revision=c.source_revision AND b.source_payload_hash=c.source_payload_hash
        AND b.bundle_revision=(SELECT max(latest.bundle_revision) FROM review_bundle latest WHERE latest.candidate_id=c.candidate_id)`, sourceId, RSS_CUTOFF), nowMs);
      for (const [queue, reason] of [[missingCurrentDraft, "RSS_DRAFT_BACKLOG_AGED"], [awaitingReview, "RSS_REVIEW_BACKLOG_AGED"],
        [queuedPublications, "RSS_PUBLICATION_BACKLOG_AGED"]] as const) {
        if (queue.oldestAgeMs !== null && queue.oldestAgeMs > SOURCE_STALE_MS) { sourceReasons.push(reason); states.push("degraded"); }
      }
      reasons.push(...sourceReasons);
      return { sourceId, status: worstStatus(states), observedAt, reasons: sourceReasons, enabled,
        lastAttemptAt: lastAttempt?.at ?? null, lastSuccessAt: lastSuccess?.at ?? null, lastSuccessAgeMs: lastSuccess?.ageMs ?? null,
        latestAttemptStatus, latestSucceededSlotAt: slotTimes[0] ?? null, previousSucceededSlotAt: slotTimes[1] ?? null,
        actualSucceededSlotIntervalMs: interval, latestSucceededScheduledAt: scheduledTimes[0] ?? null,
        previousSucceededScheduledAt: scheduledTimes[1] ?? null, scheduledSucceededSlotIntervalMs: scheduledInterval,
        candidateCounts, backlog, missingCurrentDraft, awaitingReview, queuedPublications };
    });
    const unknownOperations = integer(get("SELECT count(*) AS count FROM internal_operation WHERE state='reconcile_required'")?.count);
    const unknownByOwner = { rss_collector: 0, rss_refiner: 0, projection_sender: 0, other: 0 };
    for (const row of all(`SELECT CASE WHEN owner_process IN ('rss_collector','rss_refiner','projection_sender')
      THEN owner_process ELSE 'other' END AS owner,count(*) AS count FROM internal_operation
      WHERE state='reconcile_required' GROUP BY owner`)) {
      const owner = oneOf(row.owner, ["rss_collector", "rss_refiner", "projection_sender", "other"] as const);
      unknownByOwner[owner] = integer(row.count);
    }
    const currentRevisionRefinerUnknown = integer(get(`SELECT count(*) AS count FROM internal_operation op
      JOIN pending_review_candidate c ON c.candidate_id=op.candidate_id AND c.source_id=op.source_id
      AND c.source_revision=op.expected_entity_version AND c.source_payload_hash=op.expected_entity_hash
      WHERE op.owner_process='rss_refiner' AND op.state='reconcile_required'
      AND c.source_id IN (?,?,?) AND c.first_seen_at>=?`, ...RSS_SOURCE_IDS, RSS_CUTOFF)?.count);
    const baseline = config.unknownBaseline;
    let existingUnknown: number | null = null, newUnknown: number | null = null;
    if (baseline) {
      requireValue(Date.parse(timestamp(baseline.observedAt)) <= nowMs && baseline.operationIdSha256.length <= UNKNOWN_LIMIT);
      const hashes = new Set(baseline.operationIdSha256.map(hash));
      requireValue(hashes.size === baseline.operationIdSha256.length && unknownOperations <= UNKNOWN_LIMIT);
      const unknown = all("SELECT operation_id FROM internal_operation WHERE state='reconcile_required' LIMIT 10001");
      requireValue(unknown.length === unknownOperations);
      existingUnknown = unknown.filter(row => {
        requireValue(typeof row.operation_id === "string" && row.operation_id.length <= 256);
        return hashes.has(sha256(row.operation_id));
      }).length;
      newUnknown = unknownOperations - existingUnknown;
    } else reasons.push("UNKNOWN_BASELINE_UNAVAILABLE");
    const unresolvedOperations = countAge(get(`SELECT count(*) AS count,min(created_at) AS oldest_at FROM internal_operation
      WHERE state IN ('requested','authorized','attempt_committed','in_flight','reconcile_required')`), nowMs);
    const unresolvedOutbox = countAge(get(`SELECT count(*) AS count,min(created_at) AS oldest_at FROM projection_outbox
      WHERE status NOT IN ('succeeded','terminal_failed')`), nowMs);
    const terminalFailedOutbox = integer(get("SELECT count(*) AS count FROM projection_outbox WHERE status='terminal_failed'")?.count);
    const pipelineStates: SiteStatus[] = [];
    if (unknownOperations > 0) { reasons.push("UNKNOWN_OPERATIONS_PRESENT"); pipelineStates.push("degraded"); }
    if (unresolvedOperations.count > 0) { reasons.push("UNRESOLVED_OPERATIONS_PRESENT"); pipelineStates.push("degraded"); }
    if (unresolvedOutbox.count > 0) { reasons.push("UNRESOLVED_OUTBOX_PRESENT"); pipelineStates.push("degraded"); }
    if (terminalFailedOutbox > 0) { reasons.push("TERMINAL_FAILED_OUTBOX_PRESENT"); pipelineStates.push("degraded"); }
    const pointRow = get(MATCHED_POINT_SQL, config.expectedSchemaSha256, config.expectedReleaseSha256, config.expectedDeploymentManifestSha256,
      control.writerEpoch, control.recoveryEpoch, control.writerAuthorityReceiptSha256);
    const backupPoint = pointRow ? readPoint(pointRow, nowMs) : null;
    checkTime();
    failureReason = "DATABASE_READ_FAILED";
    database.exec("COMMIT"); inTransaction = false;
    failureReason = "DATABASE_IDENTITY_MISMATCH";
    assertDatabaseFile(config);
    // Pin changes while sampling must not produce a result labelled with the previous deployment.
    failureReason = "DEPLOYMENT_IDENTITY_MISMATCH";
    requireValue(sha256(readBoundedRegularFile(config.deploymentManifestPath, 256 * 1024)) === config.expectedDeploymentManifestSha256);
    const rss = { status: worstStatus(sources.map(source => source.status)), observedAt, cutoffAt: RSS_CUTOFF,
      expectedSlotIntervalMs: 900000 as const, staleSuccessAfterMs: 900000 as const, failedSuccessAfterMs: 1800000 as const, sources };
    const pipeline = { status: worstStatus(pipelineStates), observedAt, unknownOperations,
      unknownScope: "recorded_unresolved_operations_all_revisions" as const, unknownByOwner, currentRevisionRefinerUnknown,
      unknownBaselineAt: baseline?.observedAt ?? null,
      existingUnknown, newUnknown, unresolvedOperations, unresolvedOutbox, terminalFailedOutbox };
    const sample: DatabaseSample = Object.freeze({ status: worstStatus([control.status, rss.status, pipeline.status]), observedAt,
      reasons: [...new Set(reasons)], identity: { deploymentManifestSha256: config.expectedDeploymentManifestSha256,
        schemaSha256: config.expectedSchemaSha256, releaseSha256: config.expectedReleaseSha256, userVersion }, control, rss, pipeline, backupPoint });
    if (pointRow) backupContexts.set(sample, { point: Object.freeze(pointRow), userVersion, sqliteMasterSha256 });
    return sample;
  } catch {
    return failed(failureReason);
  } finally {
    if (inTransaction) { try { database?.exec("ROLLBACK"); } catch { /* Read transaction has no writes to roll back. */ } }
    database?.close();
  }
}
