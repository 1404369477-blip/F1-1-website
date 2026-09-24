import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { sampleDatabase } from "../server/site-status/database.ts";
import { addBackupFixture, at, createSiteStatusFixture, insertRow, TEST_NOW, testHash } from "./site-status-fixtures.ts";

const fixtures: ReturnType<typeof createSiteStatusFixture>[] = [];
function fixture() { const value = createSiteStatusFixture(); fixtures.push(value); return value; }
afterEach(() => { for (const value of fixtures.splice(0)) { try { value.db.close(); } catch { /* Explicit close in a failure test. */ } rmSync(value.root, { recursive: true, force: true }); } });

describe("standalone read-only database sampling", () => {
  it("samples healthy counters and actual intervals without modifying database bytes or creating files", () => {
    const value = fixture();
    const before = testHash(readFileSync(value.config.databasePath)), files = readdirSync(value.root), stat = statSync(value.config.databasePath);
    const sample = sampleDatabase(value.config, TEST_NOW);
    expect(sample.status).toBe("healthy");
    expect(sample.rss?.sources).toHaveLength(3);
    expect(sample.rss?.sources[0]).toMatchObject({ actualSucceededSlotIntervalMs: 900_000, backlog: { count: 0 }, missingCurrentDraft: { count: 0 } });
    expect(sample.pipeline).toMatchObject({ unknownOperations: 0, newUnknown: 0, unresolvedOperations: { count: 0 }, unresolvedOutbox: { count: 0 } });
    expect(testHash(readFileSync(value.config.databasePath))).toBe(before);
    expect(statSync(value.config.databasePath).mtimeMs).toBe(stat.mtimeMs);
    expect(readdirSync(value.root)).toEqual(files);
    expect(JSON.stringify(sample)).not.toContain(value.root);
  });

  it("reports actual starts separately from nominal scheduling, and degrades at 15 minutes", () => {
    const value = fixture();
    value.db.prepare("UPDATE ingest_run SET started_at=?,finished_at=? WHERE slot_key=2").run(at(-393_000), at(-392_000));
    let sample = sampleDatabase(value.config, TEST_NOW);
    expect(sample.rss?.sources[0]).toMatchObject({ actualSucceededSlotIntervalMs: 1_107_000, scheduledSucceededSlotIntervalMs: 900_000, status: "degraded" });
    value.db.prepare("UPDATE source SET last_success_at=?").run(at(-900_001));
    sample = sampleDatabase(value.config, TEST_NOW);
    expect(sample.rss?.status).toBe("degraded");
    expect(sample.rss?.sources[0].reasons).toContain("RSS_SUCCESS_STALE");
    value.db.prepare("UPDATE source SET last_success_at=?").run(at(-1_800_001));
    expect(sampleDatabase(value.config, TEST_NOW).rss?.status).toBe("failed");
  });

  it("ignores a health default when real successful observations are absent", () => {
    const value = fixture();
    value.db.exec("UPDATE source SET last_success_at=NULL; DELETE FROM ingest_run;");
    const sample = sampleDatabase(value.config, TEST_NOW);
    expect(sample.status).toBe("unknown");
    expect(sample.rss?.sources[0]).toMatchObject({ lastSuccessAt: null, lastSuccessAgeMs: null, actualSucceededSlotIntervalMs: null });
  });

  it.each(["last_success_at", "last_attempt_at", "started_at", "finished_at", "scheduled_at"])("rejects future %s observations instead of reporting age zero", (field) => {
    const value = fixture();
    if (field === "last_success_at" || field === "last_attempt_at") value.db.prepare(`UPDATE source SET ${field}=?`).run(at(15_000));
    else if (field === "started_at") value.db.prepare("UPDATE ingest_run SET started_at=?,finished_at=? WHERE slot_key=2").run(at(15_000), at(16_000));
    else value.db.prepare(`UPDATE ingest_run SET ${field}=? WHERE slot_key=2`).run(at(15_000));
    expect(sampleDatabase(value.config, TEST_NOW)).toMatchObject({ status: "unknown", reasons: ["DATABASE_DATA_INVALID"], rss: null, pipeline: null });
  });

  it("preserves known degradation when another source observation is unknown", () => {
    const value = fixture();
    value.db.exec("UPDATE source SET last_success_at=NULL WHERE source_id='motorsport-f1-news'");
    value.db.prepare("UPDATE source SET last_success_at=? WHERE source_id='the-race-f1-news'").run(at(-900_001));
    const sample = sampleDatabase(value.config, TEST_NOW);
    expect(sample.status).toBe("degraded");
    expect(sample.rss?.status).toBe("degraded");
    expect(sample.rss?.sources.map(source => source.status)).toEqual(["unknown", "degraded", "healthy"]);
    expect(sample.reasons).toContain("RSS_SUCCESS_UNKNOWN");
    expect(sample.reasons).toContain("RSS_SUCCESS_STALE");
    expect(sample.rss?.sources[0].lastSuccessAgeMs).toBeNull();
  });

  it("keeps wrong-revision and wrong-hash drafts in the precise cutoff/allowlist backlog", () => {
    const value = fixture();
    const add = (id: string, status: string, source = "motorsport-f1-news", first = at(-600_000)) => insertRow(value.db, "pending_review_candidate", {
      candidate_id: id, source_id: source, source_revision: 2, source_payload_hash: "a".repeat(64), review_status: status, first_seen_at: first
    });
    add("old-revision", "pending_review"); add("wrong-hash", "approved"); add("current-draft", "pending_review");
    add("published-old-bundle", "published"); add("published-current-bundle", "published"); add("latest-bundle-wrong", "published");
    add("excluded-source", "pending_review", "autosport-f1-news"); add("before-cutoff", "pending_review", "motorsport-f1-news", "2026-09-05T02:29:59.999Z");
    for (const [id, revision, digest] of [["old-revision", 1, "a"], ["wrong-hash", 2, "b"], ["current-draft", 2, "a"]] as const) {
      insertRow(value.db, "machine_summary_draft", { candidate_id: id, source_revision: revision, source_payload_hash: digest.repeat(64) });
    }
    for (const [id, revision, bundleRevision] of [["published-old-bundle", 1, 1], ["published-current-bundle", 2, 1], ["latest-bundle-wrong", 2, 1], ["latest-bundle-wrong", 1, 2]] as const) {
      insertRow(value.db, "review_bundle", { bundle_id: `${id}-${bundleRevision}`, candidate_id: id, source_revision: revision, source_payload_hash: "a".repeat(64), bundle_revision: bundleRevision });
    }
    const sample = sampleDatabase(value.config, TEST_NOW), source = sample.rss?.sources[0];
    expect(source?.backlog.count).toBe(5);
    expect(source?.missingCurrentDraft.count).toBe(4);
    expect(source?.awaitingReview.count).toBe(1);
    expect(source?.candidateCounts).toEqual({ pending_review: 2, approved: 1, published: 3, rejected: 0, other: 0 });
    expect(source?.backlog.oldestAgeMs).toBe(600_000);
    expect(JSON.stringify(sample)).not.toMatch(/old-revision|wrong-hash|published-old-bundle/);
  });

  it("separates identity-bound historical unknowns, current revision unknowns and delivery queues", () => {
    const value = fixture();
    insertRow(value.db, "pending_review_candidate", { candidate_id: "candidate-a", source_id: "motorsport-f1-news", source_revision: 2,
      source_payload_hash: "c".repeat(64), review_status: "pending_review", first_seen_at: at(-1000) });
    for (const [id, owner, revision] of [["old", "rss_collector", 1], ["new", "rss_refiner", 2], ["old-revision", "rss_refiner", 1], ["delivery", "projection_sender", 1]] as const) {
      insertRow(value.db, "internal_operation", { operation_id: id, state: "reconcile_required", created_at: at(-1000), owner_process: owner,
        source_id: "motorsport-f1-news", candidate_id: "candidate-a", expected_entity_version: revision, expected_entity_hash: "c".repeat(64) });
    }
    insertRow(value.db, "projection_outbox", { status: "pending", created_at: at(-2000) });
    insertRow(value.db, "projection_outbox", { status: "terminal_failed", created_at: at(-3000) });
    const withoutBaseline = sampleDatabase({ ...value.config, unknownBaseline: undefined }, TEST_NOW);
    expect(withoutBaseline.pipeline).toMatchObject({ unknownOperations: 4, newUnknown: null, existingUnknown: null,
      unknownByOwner: { rss_collector: 1, rss_refiner: 2, projection_sender: 1, other: 0 }, currentRevisionRefinerUnknown: 1,
      unresolvedOperations: { count: 4 }, unresolvedOutbox: { count: 1 }, terminalFailedOutbox: 1 });
    const withBaseline = sampleDatabase({ ...value.config, unknownBaseline: { observedAt: at(-500), operationIdSha256: [testHash("old"), testHash("old-revision")] } }, TEST_NOW);
    expect(withBaseline.pipeline).toMatchObject({ existingUnknown: 2, newUnknown: 2, unknownBaselineAt: at(-500) });
    expect(JSON.stringify(withBaseline)).not.toContain('"candidate-a"');
  });

  it.each(["schema", "user-version", "deployment", "inode", "missing", "lock"])("returns unknown with null metrics on %s failure", (kind) => {
    const value = fixture();
    let config = value.config;
    if (kind === "schema") value.db.exec("CREATE TABLE unexpected_schema(value TEXT)");
    if (kind === "user-version") value.db.exec("PRAGMA user_version=9");
    if (kind === "deployment") config = { ...config, expectedDeploymentManifestSha256: "0".repeat(64) };
    if (kind === "inode") config = { ...config, expectedDatabaseIdentity: { ...config.expectedDatabaseIdentity, inode: config.expectedDatabaseIdentity.inode + 1 } };
    if (kind === "missing") { value.db.close(); rmSync(value.config.databasePath); }
    if (kind === "lock") value.db.exec("BEGIN EXCLUSIVE");
    const started = performance.now(), sample = sampleDatabase(config, TEST_NOW);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(sample).toMatchObject({ status: "unknown", identity: null, rss: null, pipeline: null, backupPoint: null });
    expect(sample.reasons).toHaveLength(1);
    expect(JSON.stringify(sample)).not.toContain(value.root);
    if (kind === "lock") value.db.exec("ROLLBACK");
  });

  it("does not change live WAL database or WAL bytes, and refuses absent WAL sidecars", () => {
    const value = fixture();
    value.db.exec("PRAGMA journal_mode=WAL; UPDATE source SET enabled=1;");
    const paths = [value.config.databasePath, `${value.config.databasePath}-wal`];
    const before = paths.map(path => testHash(readFileSync(path))), files = readdirSync(value.root);
    expect(sampleDatabase(value.config, TEST_NOW).status).toBe("healthy");
    expect(paths.map(path => testHash(readFileSync(path)))).toEqual(before);
    expect(readdirSync(value.root)).toEqual(files);
    // Closing the writer removes sidecars. A sampler must not recreate them to open a WAL DB.
    value.db.close();
    expect(sampleDatabase(value.config, TEST_NOW)).toMatchObject({ status: "unknown", rss: null, pipeline: null });
    expect(readdirSync(value.root)).not.toContain("review.sqlite-wal");
    expect(readdirSync(value.root)).not.toContain("review.sqlite-shm");
  });

  it("requires consumed handoff, successful backup operation and current epoch identity", () => {
    const value = fixture(); addBackupFixture(value);
    expect(sampleDatabase(value.config, TEST_NOW).backupPoint).not.toBeNull();
    value.db.exec("UPDATE owner_authorization_handoff SET consumed_by_operation_id='different-operation'");
    expect(sampleDatabase(value.config, TEST_NOW).backupPoint).toBeNull();
    value.db.exec("UPDATE owner_authorization_handoff SET consumed_by_operation_id='test-backup-operation'; UPDATE internal_operation SET state='in_flight'");
    expect(sampleDatabase(value.config, TEST_NOW).backupPoint).toBeNull();
    value.db.exec("UPDATE internal_operation SET state='succeeded'; UPDATE internal_control SET writer_epoch=3");
    expect(sampleDatabase(value.config, TEST_NOW).backupPoint).toBeNull();
  });

  it("preserves failed control as a distinct observed state", () => {
    const value = fixture(); value.db.exec("UPDATE internal_control SET global_stop_state='stopped'");
    const sample = sampleDatabase(value.config, TEST_NOW);
    expect(sample.control).toMatchObject({ status: "failed", globalStopState: "stopped" });
    expect(sample.rss?.sources[0].backlog.count).toBe(0);
    expect(sample.reasons).toContain("CONTROL_CLOSED");
  });
});
