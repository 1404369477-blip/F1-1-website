import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { withRecoveryFenceWriterLock } from "../server/internal-operation/recovery-fence-write.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";

import { runSnapshotOnce, runRestoreDrill } from "../server/backup-snapshot/core.ts";
import { runBackupRecoveryPointRegister, createOwnerSupervisorHandoff, readStoredBackupRecoveryPoint } from "../server/internal-operation/backup-recovery-point-register.ts";
import { APPLICATION_DRILL_SCHEMA, createSignedApplicationDrillReceipt } from "../server/backup-snapshot/application-drill-receipt.ts";
import { readSnapLatestAndManifest } from "../server/internal-operation/backup-package-binding.ts";
import { createOffHostReadReceipt } from "../server/backup-snapshot/off-host-receipt.ts";
import { canonicalJsonV1, SqliteInternalOperationGateway, type Phase, type OwnerProcess } from "../server/internal-operation/gateway.ts";
import { backupCheckpointHash, assertBackupCheckpointBinding } from "../server/internal-operation/recovery.ts";
import { ProjectionReceiver, signProjectionTaskEnvelope } from "../server/review-real/projection.ts";
import { ReviewRealRepository } from "../server/review-real/repository.ts";
import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";
import { installSchema10RssCollectorPlist, RSS_COLLECTOR_INTERVAL_SECONDS, RSS_COLLECTOR_LABEL } from "../server/rss/deployment.ts";
import {
  applySourceRegistryMigration,
  readSourceRegistryMigrationSql,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  type SourceRegistryMigrationManifest
} from "../server/rss/source-registry-migration.ts";
import { inspectExistingPrivateDatabase, openExistingSafeDatabase } from "../server/db/database.ts";
import { backupRegistrationFailureCode } from "../../scripts/backup-recovery-point-register.ts";
import { applyXManualInboxMigration } from "../server/tweet-inbox/repository.ts";
import { openAdmittedReviewFixture, disposeAdmittedReviewDatabases } from "./helpers/admitted-review-database.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const MIGRATIONS = [
  "0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql",
  "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql",
  "0007_internal_operation_recovery_phase.sql", "0008_x_manual_inbox.sql"
] as const;
const RELEASE = "a".repeat(64);
const MANIFEST = "b".repeat(64);
const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  disposeAdmittedReviewDatabases();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

function sourceRegistryManifest(): SourceRegistryMigrationManifest {
  const shared = {
    scheduleSeconds: 900,
    routeIdentitySha256: "1".repeat(64),
    routeReleaseSha256: "2".repeat(64),
    routeManifestSha256: "3".repeat(64),
    rightsStatus: "clear" as const,
    mediaPolicy: "allowlisted" as const,
    authorizationExpiresAt: "2027-08-25T00:00:00.000Z",
    authorizationReceiptSha256: "4".repeat(64),
    sourcePolicySha256: "5".repeat(64)
  };
  return Object.freeze({
    schemaVersion: "source-registry-migration-manifest-v1",
    migratedAt: "2026-08-25T00:00:00.000Z",
    rss: Object.freeze([
      { ...shared, sourceId: "motorsport-f1-news", displayName: "Motorsport.com", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
      { ...shared, sourceId: "autosport-f1-news", displayName: "Autosport", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
      { ...shared, sourceId: "racefans-f1-news", displayName: "RaceFans", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
      { ...shared, sourceId: "the-race-f1-news", displayName: "The Race", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" }
    ])
  });
}

function seedSchema10(database: DatabaseSync, beforeV7?: (database: DatabaseSync) => void): void {
  for (const migration of MIGRATIONS.slice(0, 6)) database.exec(readFileSync(join(APP_ROOT, "migrations/rss-real", migration), "utf8"));
  beforeV7?.(database);
  applyInternalOperationMigration(database, readFileSync(join(APP_ROOT, "migrations/rss-real/0007_internal_operation_recovery_phase.sql"), "utf8"));
  applyXManualInboxMigration(database, readFileSync(join(APP_ROOT, "migrations/rss-real/0008_x_manual_inbox.sql"), "utf8"));
  applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
  applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), sourceRegistryManifest(), { applyEnabled: true });
  database.prepare("INSERT INTO budget_account VALUES(?,?,?,?,?,?)").run("backup-private", "backup_copy", 1000, 0, 0, 1);
}

function seedDeliveredProjection(database: DatabaseSync, root: string, keyPair: ReturnType<typeof generateKeyPairSync>, omitReceipt = false) {
  const publishedAt = "2026-08-12T01:00:00.000Z";
  const payloadHash = "1".repeat(64);
  database.prepare("INSERT INTO pending_review_candidate (candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,first_seen_at,last_seen_at) VALUES ('backup-candidate','motorsport-f1-news','backup-external',?,'https://www.motorsport.com/f1/news/backup-test/','Source','Excerpt','Motorsport.com',?,?,1,?,?)")
    .run("2".repeat(64), publishedAt, payloadHash, publishedAt, publishedAt);
  let at = Date.parse("2026-08-12T02:00:00.000Z");
  const repository = new ReviewRealRepository(database, () => new Date(at += 1000));
  const revision = repository.revision({ schemaVersion: "admin-review-v0.2", operationId: "backup-revision",
    expected: { candidateId: "backup-candidate", sourceRevision: 1, sourceVersionTag: payloadHash.slice(0, 12), latestBundleId: null, latestBundleVersionTag: null },
    editable: { titleZh: "真实投影测试", summaryZh: "备份恢复一致性测试摘要", notes: "private" }
  }, "/api/admin/reviews/backup-candidate/revision", "operator-test");
  const approval = repository.approve({ schemaVersion: "admin-review-v0.2", operationId: "backup-approve",
    expected: { candidateId: "backup-candidate", sourceRevision: 1, bundleId: revision.bundle.id, bundleVersionTag: revision.bundle.versionTag }
  }, "/api/admin/reviews/backup-candidate/approve", "operator-test");
  const published = repository.publish({ schemaVersion: "admin-review-v0.2", operationId: "backup-publish",
    expected: { publicId: approval.publication.publicId, publishGeneration: 1, publicationStatus: "queued", approvedBundleVersionTag: revision.bundle.versionTag }
  }, `/api/admin/publications/${approval.publication.publicId}/publish`, "operator-test");
  const task = repository.deliveryTask(published.delivery.id);
  const work = repository.leaseNext("operator-test")!;
  const receiver = new ProjectionReceiver({ root, signingKeyId: "projection-test", publicKey: keyPair.publicKey, now: () => at + 1000 });
  const receipt = receiver.receive(signProjectionTaskEnvelope({ envelopeJson: task.envelopeJson, envelopeHash: task.envelopeHash,
    signingKeyId: "projection-test", privateKey: keyPair.privateKey }));
  if (!omitReceipt) repository.markDeliverySucceeded(work, receipt, "operator-test");
}

function transitionControl(database: DatabaseSync, owner: OwnerProcess, policyId: string, action: string, assignments: string) {
  const now = () => new Date();
  const row = database.prepare("SELECT * FROM internal_control").get() as Record<string, unknown>;
  const operationId = `backup-control-${row.version}`;
  const handoff = createOwnerSupervisorHandoff(database, owner, RELEASE, MANIFEST, now().getTime());
  const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: RELEASE, manifestSha256: MANIFEST, schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256, now });
  try {
    const restore = owner === "restore_operator" || owner === "system_supervisor";
    const capability = gateway.request(handoff, {
      schemaVersion: "operation-request-v1", operationId, idempotencyKey: operationId, operationKind: restore ? "restore" : "phase_control",
      ownerProcess: owner, capabilityClass: restore ? "restore" : "control", policyId, authorizationHandoffId: handoff.handoffId,
      controlAction: action as never, identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
      entitySet: [{ entityKind: "internal_control", entityId: "1", identitySelector: "control_singleton", expectedVersion: null, expectedHash: "0".repeat(64) }], requiredFenceSet: [],
      expected: { controlVersion: Number(row.version), entityVersion: null, entityHash: "0".repeat(64), schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
        releaseSha256: RELEASE, manifestSha256: MANIFEST, sourceStopEpoch: null, writerEpoch: Number(row.writer_epoch), epochs: {
          sourceConfig: Number(row.source_config_epoch), sourceSafety: Number(row.source_safety_epoch), authorization: Number(row.authorization_version),
          policy: Number(row.policy_epoch), recovery: Number(row.recovery_epoch) } },
      phase: row.phase as Phase, egressClass: "none", budgetRequest: null, modelRouteRef: null, requestHash: "0".repeat(64), requestFingerprint: "0".repeat(64)
    });
    const authorized = gateway.authorize(capability);
    gateway.runMutationTransaction(authorized, mutate => mutate({ entityKind: "internal_control", entityId: "1", mutationKind: "update", expectedVersion: null,
      expectedHash: "0".repeat(64), statement: `UPDATE internal_control SET ${assignments},version=version+1,updated_by_operation_id=? WHERE singleton_id=1`, parameters: [operationId] }));
  } finally { gateway.close(); }
}

function readyPhase(database: DatabaseSync, phase: Phase) {
  if (phase === "disabled") return;
  transitionControl(database, "restore_operator", "p-restore-control-disabled", "recovery_advance", "recovery_state='restoring'");
  transitionControl(database, "restore_operator", "p-restore-control-disabled", "recovery_advance", "recovery_state='verifying'");
  transitionControl(database, "system_supervisor", "p-supervisor-restore-disabled", "writer_epoch_bump", `writer_epoch=2,recovery_epoch=2,writer_authority_receipt_sha256='${"1".repeat(64)}'`);
  transitionControl(database, "system_supervisor", "p-supervisor-restore-disabled", "recovery_complete", "recovery_state='ready'");
  transitionControl(database, "admin_http", "p-phase-control-disabled", "clear_global_stop", "global_stop_state='clear'");
  transitionControl(database, "admin_http", "p-phase-control-disabled", "enter_backlog", "phase='backlog'");
  if (phase === "live" || phase === "paused") transitionControl(database, "admin_http", "p-phase-control-backlog", "enter_live", "phase='live'");
  if (phase === "paused") transitionControl(database, "admin_http", "p-phase-control-live", "pause", "phase='paused'");
}

function databaseState(database: DatabaseSync): string {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
  return canonicalJsonV1(tables.map(({ name }) => [name, database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()]));
}

export function registerFixture(phase: Phase = "disabled", omitReceipt = false) {
  const workspace = scratch("f1plus1-recovery-v2-");
  const projectionRoot = join(workspace, "projection");
  const backupRoot = join(workspace, "backup");
  const keyPair = generateKeyPairSync("ed25519");
  const observer = generateKeyPairSync("ed25519");
  const applicationObserver = generateKeyPairSync("ed25519");
  const fixture = openAdmittedReviewFixture({ finalVersion: 10, seed: database => seedSchema10(database, db => seedDeliveredProjection(db, projectionRoot, keyPair, omitReceipt)) });
  readyPhase(fixture.database, phase);
  fixture.close();
  const key = randomBytes(32);
  const now = Date.now();
  function snapshot(sequence: number, snapshotTime = now + sequence * 1000) {
    const restoreRoot = join(workspace, `restore-${sequence}`);
    runSnapshotOnce({ sourceDbPath: fixture.path, projectionRoot, outputDir: backupRoot, key, retain: 4, now: () => new Date(snapshotTime) });
    const drillReport = runRestoreDrill({ backupRoot, restoreRoot, key, expectedUserVersion: 10 });
    const offHostReceipt = createOffHostReadReceipt({ backupRoot, packageId: drillReport.packageId!, privateKeyPem: observer.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), now: () => new Date(snapshotTime + 10) });
    const snap = readSnapLatestAndManifest(backupRoot);
    const projection = JSON.parse(readFileSync(join(projectionRoot, "active.json"), "utf8"));
    // Signed synthetic observer evidence exercises registration trust and binding only.
    // Actual application spawning/HTTP probes are tested by the producer's independent suite.
    const applicationDrill = createSignedApplicationDrillReceipt({
      schemaVersion: APPLICATION_DRILL_SCHEMA, packageId: snap.latest.packageId, contentHash: snap.manifest.contentHash,
      manifestSha256: snap.manifestSha256, databaseSnapshotSha256: snap.manifest.members.find(member => member.relativePath === "db/snapshot.sqlite")!.sha256,
      restoreRootSha256: createHash("sha256").update(realpathSync(restoreRoot), "utf8").digest("hex"),
      releaseSha256: RELEASE, deploymentManifestSha256: MANIFEST, schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
      projectionGeneration: projection.snapshotGeneration, projectionManifestSha256: projection.snapshotManifestHash,
      bootable: true, businessPointVerified: true, incidentDeclaredAt: new Date(snapshotTime + 20).toISOString(),
      adminAvailableAt: new Date(snapshotTime + 40).toISOString(), publicAvailableAt: new Date(snapshotTime + 50).toISOString(),
      completedAt: new Date(snapshotTime + 70).toISOString(), elapsedMs: 50,
      adminResponseSha256: createHash("sha256").update("synthetic-admin-probe").digest("hex"),
      publicResponseSha256: createHash("sha256").update("synthetic-public-probe").digest("hex"),
      adminRuntimeSha256: RELEASE, publicRuntimeSha256: RELEASE
    }, applicationObserver.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    const database = openExistingSafeDatabase(fixture.path, "state.sqlite", inspectExistingPrivateDatabase(fixture.path, "state.sqlite"), [10]);
    return { database, backupRoot, restoreRoot, drillReport, snapshotKey: key, applicationDrill,
      applicationDrillPublicKeyPem: applicationObserver.publicKey.export({ type: "spki", format: "pem" }).toString(), projectionSigningKeyId: "projection-test",
      projectionPublicKeyPem: keyPair.publicKey.export({ type: "spki", format: "pem" }).toString(), offHostReceipt,
      offHostPublicKeyPem: observer.publicKey.export({ type: "spki", format: "pem" }).toString(), releaseSha256: RELEASE, manifestSha256: MANIFEST,
      schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256, budgetAccountId: "backup-private", now: () => new Date(snapshotTime + 1000) };
  }
  return { workspace, fixture, snapshot, projectionRoot, applicationObserver };
}

function registerCliArguments(fixture: ReturnType<typeof registerFixture>, input: ReturnType<ReturnType<typeof registerFixture>["snapshot"]>): string[] {
    const write = (name: string, content: string | Buffer) => { const path = join(fixture.workspace, name); writeFileSync(path, content, { mode: 0o600 }); return path; };
    return ["--experimental-transform-types", join(APP_ROOT, "scripts/backup-recovery-point-register.ts"),
      "--db", fixture.fixture.path, "--backup-root", input.backupRoot, "--restore-root", input.restoreRoot,
      "--drill-report", write("drill.json", JSON.stringify(input.drillReport)), "--key-file", write("snapshot.key", input.snapshotKey),
      "--off-host-receipt", write("off-host.json", JSON.stringify(input.offHostReceipt)), "--off-host-public-key", write("off-host.pem", input.offHostPublicKeyPem),
      "--application-drill-receipt", write("application.json", JSON.stringify(input.applicationDrill)), "--application-drill-public-key", write("application.pem", input.applicationDrillPublicKeyPem),
      "--projection-signing-key-id", input.projectionSigningKeyId, "--projection-public-key", write("projection.pem", input.projectionPublicKeyPem),
      "--release-sha256", input.releaseSha256, "--manifest-sha256", input.manifestSha256, "--schema-sha256", input.schemaSha256];
}

describe("recovery-gate tooling v2", () => {
  test("reproduces LOCK_CONTENTION before a backup handoff while another real connection holds the writer", () => {
    const fixture = registerFixture("live"), input = fixture.snapshot(0);
    const writer = new DatabaseSync(fixture.fixture.path);
    try {
      const before = input.database.prepare("SELECT count(*) AS count FROM owner_authorization_handoff WHERE owner_process='backup_worker'").get();
      writer.exec("BEGIN IMMEDIATE");
      let failure: unknown;
      try { runBackupRecoveryPointRegister(input); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: "LOCK_CONTENTION" });
      expect(backupRegistrationFailureCode(failure)).toBe("LOCK_CONTENTION");
      expect(input.database.isTransaction).toBe(false);
      expect(input.database.prepare("SELECT count(*) AS count FROM owner_authorization_handoff WHERE owner_process='backup_worker'").get()).toEqual(before);
      expect(input.database.prepare("SELECT count(*) AS count FROM backup_recovery_point").get()).toEqual({ count: 0 });
      writer.exec("ROLLBACK");
      expect(runBackupRecoveryPointRegister(input)).toMatchObject({ decision: "SUCCESS", reused: false });
    } finally { if (writer.isTransaction) writer.exec("ROLLBACK"); writer.close(); input.database.close(); }
  });
  test("CLI reopens after real writer contention, revalidates the package and registers exactly once", async () => {
    const fixture = registerFixture("live"), input = fixture.snapshot(0, Date.now() - 3000);
    input.database.close();
    const args = registerCliArguments(fixture, input);
    const writer = new DatabaseSync(fixture.fixture.path);
    writer.exec("BEGIN IMMEDIATE");
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    const release = setTimeout(() => { if (writer.isTransaction) writer.exec("ROLLBACK"); }, 2000);
    try {
      const [exit] = await once(child, "close");
      expect(exit, stderr).toBe(0);
      const receipt = JSON.parse(stdout); expect(receipt).toMatchObject({ decision: "SUCCESS", reused: false });
      const failures = stderr.split("\n").filter(line => line.startsWith("{"))
        .map(line => JSON.parse(line));
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0]).toMatchObject({ event: "backup_register_attempt_failed", reasonCode: "LOCK_CONTENTION", retry: true, attempt: 1 });
      expect(stderr).not.toContain(input.snapshotKey.toString("hex"));
      expect(writer.prepare("SELECT count(*) AS count FROM backup_recovery_point").get()).toEqual({ count: 1 });
      expect(writer.prepare("SELECT count(*) AS count FROM internal_operation WHERE owner_process='backup_worker' AND state='succeeded'").get()).toEqual({ count: 1 });
      const before = writer.prepare("SELECT * FROM budget_account WHERE account_id='backup-private'").get();
      const replay = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 10_000 });
      expect(replay.status, replay.stderr).toBe(0);
      expect(JSON.parse(replay.stdout)).toMatchObject({ decision: "SUCCESS", reused: true, operationId: receipt.operationId });
      expect(writer.prepare("SELECT * FROM budget_account WHERE account_id='backup-private'").get()).toEqual(before);
    } finally { clearTimeout(release); if (writer.isTransaction) writer.exec("ROLLBACK"); writer.close(); if (child.exitCode === null) child.kill(); }
  }, 15_000);
  test.each(["permanent-lock", "missing-key", "invalid-signature"] as const)("CLI fails bounded %s without hiding or retrying a different failure", mode => {
    const fixture = registerFixture("live"), input = fixture.snapshot(0, Date.now() - 3000);
    input.database.close(); const args = registerCliArguments(fixture, input), writer = new DatabaseSync(fixture.fixture.path);
    try {
      if (mode === "permanent-lock") writer.exec("BEGIN IMMEDIATE");
      if (mode === "missing-key") rmSync(join(fixture.workspace, "snapshot.key"));
      if (mode === "invalid-signature") writeFileSync(join(fixture.workspace, "application.json"), JSON.stringify({ ...input.applicationDrill, signature: "A".repeat(86) }));
      const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 10_000 });
      expect(result.status, result.stderr).toBe(1);
      const failures = result.stderr.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
      expect(failures).toHaveLength(mode === "permanent-lock" ? 3 : 1);
      expect(failures.at(-1).retry).toBe(false);
      expect(JSON.parse(result.stdout)).toMatchObject({ decision: "FAIL", reasonCode: mode === "permanent-lock" ? "LOCK_CONTENTION" : mode === "invalid-signature" ? "APPLICATION_DRILL_SIGNATURE_INVALID" : "REGISTER_FAILED" });
      if (mode === "missing-key") expect(failures[0]).toMatchObject({ nativeCode: "ENOENT" });
      expect(result.stderr).not.toContain(fixture.workspace);
      expect(result.stderr).not.toContain(input.snapshotKey.toString("hex"));
      expect(writer.prepare("SELECT count(*) AS count FROM backup_recovery_point").get()).toEqual({ count: 0 });
      expect(writer.prepare("SELECT count(*) AS count FROM owner_authorization_handoff WHERE owner_process='backup_worker'").get()).toEqual({ count: 0 });
    } finally { if (writer.isTransaction) writer.exec("ROLLBACK"); writer.close(); }
  }, 15_000);
  test("CLI revalidates changed signed evidence after a lock retry and refuses registration", async () => {
    const fixture = registerFixture("live"), input = fixture.snapshot(0, Date.now() - 3000);
    input.database.close(); const args = registerCliArguments(fixture, input), writer = new DatabaseSync(fixture.fixture.path);
    writer.exec("BEGIN IMMEDIATE");
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", changed = false;
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => {
      stderr += chunk;
      if (!changed && stderr.includes('"retry":true')) {
        changed = true;
        writeFileSync(join(fixture.workspace, "application.json"), JSON.stringify({ ...input.applicationDrill, signature: "A".repeat(86) }));
        writer.exec("ROLLBACK");
      }
    });
    try {
      const [exit] = await once(child, "close"); expect(exit, stderr).toBe(1); expect(changed).toBe(true);
      expect(JSON.parse(stdout)).toMatchObject({ decision: "FAIL", reasonCode: "APPLICATION_DRILL_SIGNATURE_INVALID" });
      const failures = stderr.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
      expect(failures).toHaveLength(2); expect(failures[1]).toMatchObject({ attempt: 2, retry: false });
      expect(writer.prepare("SELECT count(*) AS count FROM backup_recovery_point").get()).toEqual({ count: 0 });
      expect(writer.prepare("SELECT count(*) AS count FROM owner_authorization_handoff WHERE owner_process='backup_worker'").get()).toEqual({ count: 0 });
    } finally { if (writer.isTransaction) writer.exec("ROLLBACK"); writer.close(); if (child.exitCode === null) child.kill(); }
  }, 15_000);
  test("CLI refuses a different fully valid package substituted at the same paths between attempts", async () => {
    const fixture = registerFixture("live"), first = fixture.snapshot(0, Date.now() - 4000);
    const latest = join(first.backupRoot, "latest.json"), firstPointer = readFileSync(latest);
    first.database.close();
    const second = fixture.snapshot(1, Date.now() - 3000), secondPointer = readFileSync(latest);
    second.database.close(); writeFileSync(latest, firstPointer);
    expect(second.drillReport.packageId).not.toBe(first.drillReport.packageId);
    const args = registerCliArguments(fixture, first), writer = new DatabaseSync(fixture.fixture.path);
    writer.exec("BEGIN IMMEDIATE");
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", changed = false;
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => {
      stderr += chunk;
      if (!changed && stderr.includes('"retry":true')) {
        changed = true;
        rmSync(first.restoreRoot, { recursive: true }); cpSync(second.restoreRoot, first.restoreRoot, { recursive: true });
        const replacement = createSignedApplicationDrillReceipt({ ...second.applicationDrill.payload,
          restoreRootSha256: createHash("sha256").update(realpathSync(first.restoreRoot)).digest("hex")
        }, fixture.applicationObserver.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
        writeFileSync(latest, secondPointer);
        writeFileSync(join(fixture.workspace, "drill.json"), JSON.stringify(second.drillReport));
        writeFileSync(join(fixture.workspace, "off-host.json"), JSON.stringify(second.offHostReceipt));
        writeFileSync(join(fixture.workspace, "application.json"), JSON.stringify(replacement));
        writer.exec("ROLLBACK");
      }
    });
    try {
      const [exit] = await once(child, "close"); expect(exit, stderr).toBe(1); expect(changed).toBe(true);
      expect(JSON.parse(stdout)).toMatchObject({ decision: "FAIL", reasonCode: "REGISTER_TARGET_CHANGED" });
      const failures = stderr.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
      expect(failures).toHaveLength(2);
      expect(failures[1]).toMatchObject({ stage: "READ_TARGET", attempt: 2, retry: false });
      expect(writer.prepare("SELECT count(*) AS count FROM backup_recovery_point").get()).toEqual({ count: 0 });
      expect(writer.prepare("SELECT count(*) AS count FROM owner_authorization_handoff WHERE owner_process='backup_worker'").get()).toEqual({ count: 0 });
      // Prove that the replacement was independently registrable; rejection
      // above is tied to this invocation's target, not invalid replacement proof.
      const independent = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 10_000 });
      expect(independent.status, independent.stderr).toBe(0);
      expect(JSON.parse(independent.stdout)).toMatchObject({ decision: "SUCCESS", backupSetId: second.drillReport.packageId });
    } finally { if (writer.isTransaction) writer.exec("ROLLBACK"); writer.close(); if (child.exitCode === null) child.kill(); }
  }, 15_000);
  test.each(["disabled", "paused", "backlog", "live"] as const)("registers %s without activating anchor or changing control/public files", phase => {
    const fixture = registerFixture(phase);
    const input = fixture.snapshot(0);
    try {
      const beforeControl = input.database.prepare("SELECT * FROM internal_control").get();
      const beforeAnchor = input.database.prepare("SELECT * FROM projection_recovery_anchor").all();
      const beforePublic = readFileSync(join(fixture.projectionRoot, "active.json"));
      const receipt = runBackupRecoveryPointRegister(input);
      expect(receipt).toMatchObject({ decision: "SUCCESS", schemaVersion: "backup-recovery-point-register-receipt-v2", activationApplied: false, backupBindingPassed: true, checkpointAlgorithm: "f1plus1-backup-checkpoint-v2", reused: false });
      expect(input.database.prepare("SELECT * FROM internal_control").get()).toEqual(beforeControl);
      expect(input.database.prepare("SELECT * FROM projection_recovery_anchor").all()).toEqual(beforeAnchor);
      expect(readFileSync(join(fixture.projectionRoot, "active.json"))).toEqual(beforePublic);
      expect(input.database.prepare("SELECT count(*) AS count FROM valid_backup_recovery_point_v1").get()).toEqual({ count: 1 });
      const changes = input.database.prepare("SELECT total_changes() AS count").get();
      expect(runBackupRecoveryPointRegister(input)).toMatchObject({ reused: true, operationId: receipt.operationId });
      expect(input.database.prepare("SELECT total_changes() AS count").get()).toEqual(changes);
      const stored = readStoredBackupRecoveryPoint(input.database, receipt.recoveryPointId)!;
      assertBackupCheckpointBinding(stored, { contentHash: input.drillReport.contentHash!, recovery_point_at: receipt.recoveryPointAt, manifestSha256: stored.backupManifestSha256, packageId: stored.backupSetId });
      expect(backupCheckpointHash({ ...stored, operationId: stored.operationId.replace("-v2-", "-") }, input.drillReport.contentHash!).algorithm).toBe("f1plus1-common-checkpoint-v1");
      expect(() => backupCheckpointHash({ ...stored, operationId: stored.operationId.replace("-v2-", "-v3-") }, input.drillReport.contentHash!)).toThrow("RECOVERY_CHECKPOINT_VERSION_UNKNOWN");
    } finally { input.database.close(); }
  });

  test("rejects forged drill duration, missing offhost proof and stale real boundary before writes", () => {
    const fixture = registerFixture();
    const input = fixture.snapshot(0);
    try {
      const before = databaseState(input.database);
      for (const elapsedMs of [undefined, NaN, Infinity, -1]) expect(() => runBackupRecoveryPointRegister({ ...input, drillReport: { ...input.drillReport, elapsedMs } })).toThrow("DRILL_DURATION_UNVERIFIED");
      expect(() => runBackupRecoveryPointRegister({ ...input, drillReport: { ...input.drillReport, elapsedMs: 14_400_001 } })).toThrow("RTO_EXCEEDED");
      expect(() => runBackupRecoveryPointRegister({ ...input, offHostReceipt: { verified: true } })).toThrow();
      expect(() => runBackupRecoveryPointRegister({ ...input, snapshotKey: randomBytes(32) })).toThrow();
      expect(() => runBackupRecoveryPointRegister({ ...input, now: () => new Date(Date.parse(input.drillReport.recoveryPointAt!) + 901_000) })).toThrow();
      expect(databaseState(input.database)).toEqual(before);
      expect(runBackupRecoveryPointRegister({ ...input, drillReport: { ...input.drillReport, elapsedMs: 14_400_000 } })).toMatchObject({ decision: "SUCCESS" });
    } finally { input.database.close(); }
  });

  test("same content with distinct real snapshot cycles creates distinct v2 checkpoints", () => {
    const fixture = registerFixture();
    const first = fixture.snapshot(0);
    first.database.close();
    const second = fixture.snapshot(1);
    second.database.close();
    // Register each immutable package by selecting its authenticated manifest boundary.
    const latestPath = join(first.backupRoot, "latest.json");
    const secondLatest = readFileSync(latestPath);
    const pointer = JSON.parse(secondLatest.toString());
    writeFileSync(latestPath, JSON.stringify({ ...pointer, packageId: first.drillReport.packageId, recovery_point_at: first.drillReport.recoveryPointAt, contentHash: first.drillReport.contentHash }));
    const db = openExistingSafeDatabase(fixture.fixture.path, "state.sqlite", inspectExistingPrivateDatabase(fixture.fixture.path, "state.sqlite"), [10]);
    try {
      const one = runBackupRecoveryPointRegister({ ...first, database: db, now: second.now });
      writeFileSync(latestPath, secondLatest);
      const two = runBackupRecoveryPointRegister({ ...second, database: db });
      expect(first.drillReport.contentHash).toBe(second.drillReport.contentHash);
      expect(one.checkpointSha256).not.toBe(two.checkpointSha256);
      expect(db.prepare("SELECT count(*) AS count FROM backup_recovery_point").get()).toEqual({ count: 2 });
    } finally { db.close(); }
  });

  test("missing or false fence cannot be opened by registration; retry reuses committed record", () => {
    const fixture = registerFixture("live");
    const input = fixture.snapshot(0);
    const fencePath = join(fixture.workspace, "recovery-fence.json");
    try {
      expect(runBackupRecoveryPointRegister({ ...input, fencePath })).toMatchObject({ decision: "REGISTERED_FENCE_NOT_REFRESHED", fenceReasonCode: "RECOVERY_FENCE_MISSING_REQUIRES_ACTIVATION" });
      writeFileSync(fencePath, canonicalJsonV1({ schemaVersion: "admin-recovery-fence-v1", clockTrusted: false, writerReady: false, lastSuccessfulRecoveryPointAt: null }), { mode: 0o600 });
      const before = readFileSync(fencePath);
      expect(runBackupRecoveryPointRegister({ ...input, fencePath })).toMatchObject({ reused: true, decision: "REGISTERED_FENCE_NOT_REFRESHED", fenceReasonCode: "RECOVERY_FENCE_WRITER_NOT_READY" });
      expect(readFileSync(fencePath)).toEqual(before);
      writeFileSync(fencePath, canonicalJsonV1({ schemaVersion: "admin-recovery-fence-v1", clockTrusted: true, writerReady: true, lastSuccessfulRecoveryPointAt: Date.parse(input.drillReport.recoveryPointAt!) - 1000 }), { mode: 0o600 });
      expect(runBackupRecoveryPointRegister({ ...input, fencePath })).toMatchObject({ reused: true, decision: "SUCCESS", fence: { after: { writerReady: true, lastSuccessfulRecoveryPointAt: Date.parse(input.drillReport.recoveryPointAt!) } } });
      expect(input.database.prepare("SELECT count(*) AS count FROM backup_recovery_point").get()).toEqual({ count: 1 });
    } finally { input.database.close(); }
  });

  test("public pointer ahead of the captured DB receipt fails before handoff", () => {
    const fixture = registerFixture("disabled", true);
    const input = fixture.snapshot(0);
    try {
      const before = databaseState(input.database);
      expect(() => runBackupRecoveryPointRegister(input)).toThrow("BACKUP_PROJECTION_DELIVERY_MISSING");
      expect(databaseState(input.database)).toBe(before);
    } finally { input.database.close(); }
  });

  test("tampered restored DB, extra member and incorrect trusted signing key fail without writes", () => {
    const fixture = registerFixture();
    const input = fixture.snapshot(0);
    try {
      const before = databaseState(input.database);
      const original = readFileSync(join(input.restoreRoot, "db/snapshot.sqlite"));
      const tampered = Buffer.from(original); tampered[tampered.length - 100] ^= 1;
      writeFileSync(join(input.restoreRoot, "db/snapshot.sqlite"), tampered);
      expect(() => runBackupRecoveryPointRegister(input)).toThrow("BACKUP_RESTORED_MEMBER_MISMATCH");
      writeFileSync(join(input.restoreRoot, "db/snapshot.sqlite"), original);
      writeFileSync(join(input.restoreRoot, "unexpected.txt"), "unexpected");
      expect(() => runBackupRecoveryPointRegister(input)).toThrow("BACKUP_UNEXPECTED_RESTORED_MEMBER");
      rmSync(join(input.restoreRoot, "unexpected.txt"));
      const wrong = generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }).toString();
      expect(() => runBackupRecoveryPointRegister({ ...input, projectionPublicKeyPem: wrong })).toThrow();
      expect(() => runBackupRecoveryPointRegister({ ...input, schemaSha256: "f".repeat(64) })).toThrow("BACKUP_CURRENT_SCHEMA_MISMATCH");
      expect(databaseState(input.database)).toBe(before);
    } finally { input.database.close(); }
  });

  test("snapshot writer identity remains immutable if the live control advances", () => {
    const fixture = registerFixture();
    const input = fixture.snapshot(0);
    try {
      readyPhase(input.database, "live");
      const before = databaseState(input.database);
      expect(() => runBackupRecoveryPointRegister(input)).toThrow("BACKUP_CURRENT_WRITER_MISMATCH");
      expect(databaseState(input.database)).toBe(before);
    } finally { input.database.close(); }
  });

  test("control version changes after preflight cause atomic admission rollback", () => {
    const fixture = registerFixture("live");
    const input = fixture.snapshot(0);
    const operationCount = input.database.prepare("SELECT count(*) AS count FROM internal_operation").get() as { count: number };
    let calls = 0;
    const now = () => {
      if (++calls === 3) transitionControl(input.database, "admin_http", "p-phase-control-live", "pause", "phase='paused'");
      return input.now();
    };
    try {
      expect(() => runBackupRecoveryPointRegister({ ...input, now })).toThrow();
      expect(input.database.prepare("SELECT count(*) AS count FROM backup_recovery_point").get()).toEqual({ count: 0 });
      expect(input.database.prepare("SELECT count(*) AS count FROM internal_operation").get()).toEqual({ count: operationCount.count + 1 });
      expect(input.database.prepare("SELECT count(*) AS count FROM internal_operation WHERE operation_kind='backup'").get()).toEqual({ count: 0 });
    } finally { input.database.close(); }
  });

  test("fence replacement holds real process-wide file exclusion and a SQLite reserved lock", () => {
    const fixture = registerFixture("live");
    const input = fixture.snapshot(0);
    const fencePath = join(fixture.workspace, "recovery-fence.json");
    const initial = canonicalJsonV1({ schemaVersion: "admin-recovery-fence-v1", clockTrusted: true, writerReady: true,
      lastSuccessfulRecoveryPointAt: Date.parse(input.drillReport.recoveryPointAt!) - 1000 });
    writeFileSync(fencePath, initial, { mode: 0o600 });
    let checks = 0;
    const originalExec = input.database.exec.bind(input.database);
    vi.spyOn(input.database, "exec").mockImplementation(sql => {
      const result = originalExec(sql);
      // The file mutex is already held when this reserved SQLite writer lock is acquired.
      if (sql === "BEGIN IMMEDIATE" && existsSync(`${fencePath}.writer-lock`)) {
        checks++;
        const child = spawnSync(process.execPath, ["--experimental-transform-types", "--input-type=module", "-e", `
          import {DatabaseSync} from 'node:sqlite';
          import {withRecoveryFenceWriterLock} from ${JSON.stringify(pathToFileURL(join(APP_ROOT, "src/server/internal-operation/recovery-fence-write.ts")).href)};
          const db=new DatabaseSync(process.argv[1]); let dbBlocked=false, fileBlocked=false;
          try { db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); } catch(e) { dbBlocked=e.code==='ERR_SQLITE_ERROR' && /locked/.test(e.message); }
          try { withRecoveryFenceWriterLock(process.argv[2],()=>{throw new Error('FILE_LOCK_WAS_NOT_HELD')}); } catch(e) { fileBlocked=e.message==='RECOVERY_FENCE_WRITER_BUSY'; }
          db.close(); process.stdout.write(JSON.stringify({dbBlocked,fileBlocked}));
        `, fixture.fixture.path, fencePath], { encoding: "utf8", timeout: 10_000 });
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual({ dbBlocked: true, fileBlocked: true });
      }
      return result;
    });
    try {
      expect(runBackupRecoveryPointRegister({ ...input, fencePath })).toMatchObject({ decision: "SUCCESS" });
      expect(checks).toBeGreaterThanOrEqual(1);
    } finally { input.database.close(); }
  });

  test("a newer fence remains monotonic when an older verified package retries", () => {
    const fixture = registerFixture("live");
    const input = fixture.snapshot(0);
    const fencePath = join(fixture.workspace, "recovery-fence.json");
    const later = Date.parse(input.drillReport.recoveryPointAt!) + 500;
    writeFileSync(fencePath, canonicalJsonV1({ schemaVersion: "admin-recovery-fence-v1", clockTrusted: true, writerReady: true,
      lastSuccessfulRecoveryPointAt: later }), { mode: 0o600 });
    try {
      expect(runBackupRecoveryPointRegister({ ...input, fencePath })).toMatchObject({ decision: "SUCCESS", fence: { after: { lastSuccessfulRecoveryPointAt: later } } });
      withRecoveryFenceWriterLock(fencePath, () => {
        expect(runBackupRecoveryPointRegister({ ...input, fencePath })).toMatchObject({ reused: true, decision: "REGISTERED_FENCE_NOT_REFRESHED", fenceReasonCode: "RECOVERY_FENCE_WRITER_BUSY" });
      });
      expect(runBackupRecoveryPointRegister({ ...input, fencePath })).toMatchObject({ reused: true, decision: "SUCCESS" });
    } finally { input.database.close(); }
  });

  test("a separate bilingual pointer is explicitly unsupported and cannot acquire a valid backup record", () => {
    const fixture = registerFixture();
    writeFileSync(join(fixture.projectionRoot, "bilingual-active.json"), "{}", { mode: 0o600 });
    const input = fixture.snapshot(0);
    try {
      const before = databaseState(input.database);
      expect(() => runBackupRecoveryPointRegister(input)).toThrow("BACKUP_BILINGUAL_BOUNDARY_UNSUPPORTED");
      expect(databaseState(input.database)).toBe(before);
    } finally { input.database.close(); }
  });

  test("requires a correctly signed application drill bound to this package/root and preserves original successful times", () => {
    const fixture = registerFixture();
    const input = fixture.snapshot(0);
    try {
      const before = databaseState(input.database);
      expect(() => runBackupRecoveryPointRegister({ ...input, applicationDrill: undefined })).toThrow("APPLICATION_DRILL_REQUIRED");
      expect(() => runBackupRecoveryPointRegister({ ...input, applicationDrill: { bootable: true } })).toThrow();
      expect(() => runBackupRecoveryPointRegister({ ...input, applicationDrill: { ...input.applicationDrill, signature: "A".repeat(86) } })).toThrow("APPLICATION_DRILL_SIGNATURE_INVALID");
      const wrongRoot = createSignedApplicationDrillReceipt({ ...input.applicationDrill.payload, restoreRootSha256: "f".repeat(64) }, fixture.applicationObserver.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
      expect(() => runBackupRecoveryPointRegister({ ...input, applicationDrill: wrongRoot })).toThrow("APPLICATION_DRILL_IDENTITY_MISMATCH");
      expect(databaseState(input.database)).toBe(before);
      const result = runBackupRecoveryPointRegister(input);
      const stored = readStoredBackupRecoveryPoint(input.database, result.recoveryPointId)!;
      expect(stored.incidentDeclaredAt).toBe(input.applicationDrill.payload.incidentDeclaredAt);
      expect(stored.adminAvailableAt).toBe(input.applicationDrill.payload.adminAvailableAt);
      expect(stored.publicAvailableAt).toBe(input.applicationDrill.payload.publicAvailableAt);
      expect(stored.adminAvailableAt).not.toBe(stored.completedAt);
      const replacement = createSignedApplicationDrillReceipt({ ...input.applicationDrill.payload, adminResponseSha256: "e".repeat(64) }, fixture.applicationObserver.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
      expect(() => runBackupRecoveryPointRegister({ ...input, applicationDrill: replacement })).toThrow("BACKUP_REPLAY_EVIDENCE_CONFLICT");
      expect(readStoredBackupRecoveryPoint(input.database, result.recoveryPointId)).toEqual(stored);
    } finally { input.database.close(); }
  });

  test("G5 schema10 plist installer writes installed-not-loaded without launchctl or a v1 database open", () => {
    const workspace = scratch("f1plus1-schema10-plist-");
    const releaseManifestSha256 = "c".repeat(64);
    const receipt = installSchema10RssCollectorPlist({
      appRoot: APP_ROOT,
      plistDir: join(workspace, "plist"),
      logDir: join(workspace, "logs"),
      releaseManifestSha256
    });
    expect(receipt).toMatchObject({
      status: "installed-not-loaded",
      label: RSS_COLLECTOR_LABEL,
      scheduleSeconds: RSS_COLLECTOR_INTERVAL_SECONDS,
      launchctlInvoked: false,
      databaseOpened: false,
      releaseManifestSha256
    });
    const plist = readFileSync(receipt.plistPath, "utf8");
    expect(plist).toContain(`RSS_RELEASE_MANIFEST_SHA256=${releaseManifestSha256}`);
    expect(plist).toContain(`<integer>${RSS_COLLECTOR_INTERVAL_SECONDS}</integer>`);
    expect(plist).toContain(receipt.stdoutLog);
    expect(plist).toContain(receipt.stderrLog);
    expect(plist).not.toContain("launchctl");
  });
});
