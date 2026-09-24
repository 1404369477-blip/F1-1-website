import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer, request } from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { backup, DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_RELEASE_RUNTIME_FILE_COUNT, ADMIN_RELEASE_RUNTIME_FILES, ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256 } from "../server/admin-service/release-manifest.ts";
import { PUBLIC_RELEASE_RUNTIME_FILE_COUNT, PUBLIC_RELEASE_RUNTIME_FILES, PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256 } from "../server/public/release-manifest.ts";
import { activateReleaseCandidate, assertFullCapabilities, assertFallbackCapabilities, buildReleasePairReceipt, buildReleaseSwitchReceipt, collectReleaseFiles,
  fallbackV10Capabilities, fullV10Capabilities, observeReleaseRuntime, releaseDatabaseLogicalSha256, releaseIdForRole, releasePathRoot, releaseSchemaForBuildOptions, releaseSourcePreimageSha256,
  type ReleaseCandidateManifest, type ReleaseRuntimeObservation } from "../server/internal-operation/release.ts";
import { SOURCE_REGISTRY_MIGRATION_SHA256, SOURCE_REGISTRY_SCHEMA10_SHA256, SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256 } from "../server/rss/source-registry-migration.ts";
import { RSS_AUTOMATIC_SCHEMA_SHA256 } from "../server/rss-automatic/schema-identity.ts";
import { RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 } from "../server/rss-automatic/source-epoch-schema-identity.ts";
import { createReviewAdminRuntime, createRssAutomaticRuntime, rssAutomaticRuntimeEnabled, startAdminBackgroundTasks, type AdminRuntimeConfig } from "../server/admin-service/runtime.ts";
import { ADMIN_REVIEW_DATABASE_PATH, AdminDeploymentManifestSchema } from "../server/admin-service/deployment.ts";
import { persistOwnerSupervisorHandoff } from "../server/internal-operation/owner-supervisor.ts";
import { canonicalJson } from "../server/db/profile.ts";
import { inspectExistingPrivateDatabase } from "../server/db/database.ts";
import { applyRssAutomaticMigration } from "../server/rss-automatic/migration.ts";
import { xPageSchema12 } from "./helpers/x-page-database.ts";
import { rssAutomaticServiceFixture } from "./helpers/rss-automatic-service-fixture.ts";
import { seedRssAutomaticBackup } from "./helpers/rss-automatic-backup.ts";
import { createRssCollectorRuntime, RSS_COLLECTOR_SOURCES, RSS_COLLECTOR_SOURCE_ROUTES } from "../server/rss-automatic/collector.ts";
import { LIVE_RSS_SOURCES } from "../server/rss/sources.ts";
import { ProjectionHttpTransport } from "../server/review-real/sender.ts";
import { ProjectionReceiver } from "../server/review-real/projection.ts";
import { ReviewRealRepository } from "../server/review-real/repository.ts";
import { SqliteGatewayMutationPort, type GatewayMutationTransactionInput } from "../server/internal-operation/mutation-port.ts";
import type { GatewayWriteInput } from "../server/internal-operation/gateway.ts";
import { RssRepository } from "../server/rss/repository.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");
const CUTOFF = "2026-09-05T02:30:00.000Z";
const cleanups: (() => void)[] = [];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function pair(schemaSha256: typeof SOURCE_REGISTRY_SCHEMA10_SHA256 | typeof RSS_AUTOMATIC_SCHEMA_SHA256 | typeof RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 = RSS_AUTOMATIC_SCHEMA_SHA256) {
  const files = collectReleaseFiles(APP_ROOT, [...new Set([...ADMIN_RELEASE_RUNTIME_FILES, ...PUBLIC_RELEASE_RUNTIME_FILES])]);
  const identity = { schemaVersion: 10 as const, sourceCommitSha1: "a".repeat(40), sourceTreeSha1: "b".repeat(40), schemaSha256,
    migration0009RawSha256: SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256, migration0010RawSha256: SOURCE_REGISTRY_MIGRATION_SHA256,
    adminRuntimeFileCount: ADMIN_RELEASE_RUNTIME_FILE_COUNT, adminRuntimePathSetSha256: ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
    publicRuntimeFileCount: PUBLIC_RELEASE_RUNTIME_FILE_COUNT, publicRuntimePathSetSha256: PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256,
    packageLockSha256: files.find(file => file.path === "package-lock.json")!.sha256, packageRootSha256: "c".repeat(64), pathRootSha256: releasePathRoot(files) };
  const sourcePreimageSha256 = releaseSourcePreimageSha256(identity);
  const base = { ...identity, sourcePreimageSha256, files };
  const full: ReleaseCandidateManifest = { ...base, role: "full_v10", releaseId: releaseIdForRole("full_v10", sourcePreimageSha256), capabilities: fullV10Capabilities({ schemaSha256 }) };
  const fallback: ReleaseCandidateManifest = { ...base, role: "manual_only_fallback_v10", releaseId: releaseIdForRole("manual_only_fallback_v10", sourcePreimageSha256), capabilities: fallbackV10Capabilities() };
  const receipt = buildReleasePairReceipt(full, fallback, "2026-09-07T00:00:00.000Z");
  const fullGate = activateReleaseCandidate(full, receipt, "2026-09-07T00:00:01.000Z", null);
  const fallbackGate = activateReleaseCandidate(fallback, receipt, "2026-09-07T00:00:02.000Z", fullGate.receipt.activationId);
  const rollbackGate = activateReleaseCandidate(full, receipt, "2026-09-07T00:00:03.000Z", fallbackGate.receipt.activationId);
  return { full, fallback, receipt, fullGate, fallbackGate, rollbackGate };
}

describe("RSS automatic release and runtime boundaries", () => {
  it("runs the source-epoch successor through automatic publication and sender with real historical epoch shape", async () => {
    const current = pair(RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256);
    const fixture = await rssAutomaticServiceFixture(current.fullGate, true, current.receipt.fallbackManifestSha256, true); cleanups.push(fixture.cleanup);
    const legacy = pair();
    expect(() => createReviewAdminRuntime({ ...fixture.config, reviewSchemaSha256: RSS_AUTOMATIC_SCHEMA_SHA256, releaseGate: legacy.fullGate })).toThrow("ADMIN_REVIEW_SCHEMA_IDENTITY_INVALID");
    expect(rssAutomaticRuntimeEnabled({ ...fixture.config, releaseGate: legacy.fullGate })).toBe(false);
    expect(() => createRssCollectorRuntime({ ...fixture.config, releaseGate: legacy.fullGate }, { env: { RSS_REAL_IO: "true", NODE_ENV: "test" } })).toThrow("RSS_COLLECTOR_RELEASE_CLOSED");
    const runtime = createReviewAdminRuntime(fixture.config); cleanups.push(() => { runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close(); });
    const receiver = new ProjectionReceiver({ root: join(fixture.root, "source-epoch-public"), signingKeyId: fixture.config.projectionSigningKeyId, publicKey: createPublicKey(readFileSync(fixture.config.projectionSigningPrivateKeyPath)) });
    const sent = vi.spyOn(ProjectionHttpTransport.prototype, "post").mockImplementation(async value => ({ kind: "response", status: 200, body: receiver.receive(value) }));
    const automatic = createRssAutomaticRuntime(fixture.config, runtime); cleanups.push(automatic.close);
    const result = await automatic.tick(); expect(result, JSON.stringify(result)).toMatchObject({ status: "processed", considered: 1, approved: 1, published: 1 });
    expect(await runtime.sender.tick()).toEqual({ outcome: "succeeded", deliveryId: result.deliveryId });
    expect(await runtime.sender.tick()).toEqual({ outcome: "idle", deliveryId: null });
    expect(sent).toHaveBeenCalledTimes(1); expect(receiver.readActiveSnapshot()?.snapshotGeneration).toBe(1);
    expect(runtime.database.prepare("SELECT consumed_units,reserved_units FROM budget_account WHERE account_id='acct-projection'").get()).toEqual({ consumed_units: 1, reserved_units: 0 });
    expect(canonicalJson(runtime.database.prepare("SELECT * FROM source_registry_v1 ORDER BY source_id").all())).toBe(fixture.sourceAuthorityBefore);
    expect(observeReleaseRuntime(runtime.database, current.fullGate, "e".repeat(64)).schemaSha256).toBe(RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256);
  });

  it("collects the exact three sources and media through the real gateway with fixed slots and safe receipt identities", async () => {
    const current = pair(); const fixture = await rssAutomaticServiceFixture(current.fullGate, false, current.receipt.fallbackManifestSha256); cleanups.push(fixture.cleanup);
    const requests: string[] = [];
    const claimErrors: string[] = [];
    const originalClaim = RssRepository.prototype.claimRun;
    vi.spyOn(RssRepository.prototype, "claimRun").mockImplementation(function(this: RssRepository, ...args: Parameters<typeof originalClaim>) {
      try { return originalClaim.apply(this, args); } catch (error) { claimErrors.push(String(error)); throw error; }
    });
    let edition = 1, clock = Date.now();
    const server = createServer((incoming, response) => {
      const host = String(incoming.headers["x-fixture-original-host"]);
      const sourceId = RSS_COLLECTOR_SOURCES.find(id => LIVE_RSS_SOURCES[id].feedHost === host)!;
      requests.push(sourceId);
      const mediaHost = sourceId === "motorsport-f1-news" ? "cdn-1.motorsport.com" : sourceId === "the-race-f1-news" ? "storage.ghost.io" : "e0.365dm.com";
      response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
      const guid = edition === 2 && sourceId !== "motorsport-f1-news" ? `${sourceId}-new-synthetic` : `${sourceId}-synthetic`;
      response.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Synthetic RSS</title><item><guid>${guid}</guid><link>https://${host}/f1/news/synthetic/</link><title>F1 synthetic title ${edition}</title><description>Independent collector fixture</description><author>Synthetic</author><pubDate>Sun, 06 Sep 2026 23:59:00 GMT</pubDate><enclosure url="https://${mediaHost}/content/images/synthetic.jpg" type="image/jpeg" length="1024"/></item></channel></rss>`);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const collector = createRssCollectorRuntime(fixture.config, { env: { RSS_REAL_IO: "true", NODE_ENV: "test" }, now: () => new Date(clock),
      trustedTransport: { dnsLookup: async () => ["8.8.8.8"], request: (options, callback) => request({ host: "127.0.0.1", port,
        path: options.path, method: options.method, headers: { ...options.headers, "x-fixture-original-host": String(options.servername ?? options.hostname ?? options.host) }, agent: false }, callback) } });
    try {
      const first = collector.collect(); expect(collector.collect()).toBe(first);
      const receipt = await first;
      expect(receipt, JSON.stringify({ receipt, claimErrors })).toMatchObject({ schemaVersion: "rss-automatic-collector-v1", status: "succeeded" });
      expect(receipt.slotKey).toBe(Math.floor(Date.parse(receipt.scheduledAt) / 900_000));
      expect(receipt.receipts.map(row => row.sourceId)).toEqual(RSS_COLLECTOR_SOURCES);
      expect(receipt.receipts.every(row => row.status === "succeeded" && "newCount" in row && row.newCount === 1)).toBe(true);
      expect((await collector.collect()).receipts.every(row => row.status === "skipped" && row.reasonCode === "SLOT_ALREADY_RECORDED")).toBe(true);
      expect(requests).toEqual(RSS_COLLECTOR_SOURCES);
      const originalTransaction = SqliteGatewayMutationPort.prototype.runTransaction;
      let mediaInterruptions = 0;
      const interrupted = vi.spyOn(SqliteGatewayMutationPort.prototype, "runTransaction").mockImplementation(function<T>(this: SqliteGatewayMutationPort,
        input: GatewayMutationTransactionInput, callback: (mutate: (value: GatewayWriteInput) => number) => T): T {
        return originalTransaction.call(this, input, mutate => callback(value => {
          if (input.operationKind === "collect" && value.entityKind === "rss_media") { mediaInterruptions += 1; throw new Error("SYNTHETIC_MEDIA_INTERRUPTION"); }
          return mutate(value);
        })) as T;
      });
      edition = 2; clock += 900_000;
      expect((await collector.collect()).status).toBe("failed");
      expect(mediaInterruptions).toBe(3); interrupted.mockRestore();
      expect(requests).toEqual([...RSS_COLLECTOR_SOURCES, ...RSS_COLLECTOR_SOURCES]);
    } finally { await collector.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
    const observed = new DatabaseSync(fixture.databasePath, { readOnly: true });
    try {
      expect(observed.prepare("SELECT DISTINCT source_id FROM ingest_run ORDER BY source_id").all().map(row => row.source_id)).toEqual([...RSS_COLLECTOR_SOURCES].sort());
      expect(observed.prepare("SELECT count(*) n FROM rss_media_candidate").get()!.n).toBe(3);
      expect(observed.prepare("SELECT count(*) n FROM pending_review_candidate").get()!.n).toBe(3);
      expect(observed.prepare("SELECT DISTINCT source_revision,title FROM pending_review_candidate").all()).toEqual([{ source_revision: 1, title: "F1 synthetic title 1" }]);
      expect(canonicalJson(observed.prepare("SELECT * FROM source_registry_v1 ORDER BY source_id").all())).toBe(fixture.sourceAuthorityBefore);
      const attempts = observed.prepare("SELECT operation_id,route_id,external_idempotency_key,reconcile_key,provider_resource_identity FROM internal_external_attempt ORDER BY route_id").all();
      expect(attempts).toHaveLength(6);
      expect([...new Set(attempts.map(row => row.route_id))]).toEqual(Object.values(RSS_COLLECTOR_SOURCE_ROUTES).sort());
      expect(attempts.every(row => [row.operation_id, row.external_idempotency_key, row.reconcile_key, row.provider_resource_identity].every(id => /^[A-Za-z0-9_-]{1,100}$/u.test(String(id))))).toBe(true);
      expect(observed.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process='rss_collector' AND state='succeeded'").get()!.n).toBeGreaterThan(3);
      expect(observed.prepare("SELECT DISTINCT account_id FROM budget_reservation").all()).toEqual([{ account_id: "acct-rss" }]);
    } finally { observed.close(); }
    expect(() => createRssCollectorRuntime(fixture.config, { env: { NODE_ENV: "test" } })).toThrow("RSS_COLLECTOR_IO_DISABLED");
    expect(() => createRssCollectorRuntime({ ...fixture.config, releaseGate: current.fallbackGate }, { env: { RSS_REAL_IO: "true", NODE_ENV: "test" } })).toThrow("RSS_COLLECTOR_RELEASE_CLOSED");
    expect(() => createRssCollectorRuntime({ ...fixture.config, reviewSchemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256 }, { env: { RSS_REAL_IO: "true", NODE_ENV: "test" } })).toThrow("RSS_COLLECTOR_RELEASE_CLOSED");
  });
  it("publishes an existing draft through the real split-connection supervisor and persists its scan cursor without network", async () => {
    const current = pair(); const fixture = await rssAutomaticServiceFixture(current.fullGate, true, current.receipt.fallbackManifestSha256); cleanups.push(fixture.cleanup);
    let runtime = createReviewAdminRuntime(fixture.config); cleanups.push(() => { runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close(); });
    expect(runtime.database.prepare("SELECT count(*) n FROM owner_authorization_handoff WHERE owner_process='admin_http'").get()!.n).toBe(0);
    const calls = vi.spyOn(globalThis, "fetch"); const automatic = createRssAutomaticRuntime(fixture.config, runtime); cleanups.push(automatic.close);
    const result = await automatic.tick(); expect(result, JSON.stringify(result)).toMatchObject({ status: "processed", considered: 1, approved: 1, published: 1 });
    expect(calls).not.toHaveBeenCalled();
    expect(runtime.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(1);
    const grants = runtime.database.prepare("SELECT owner_process,verified_at,expires_at,consumed_by_operation_id FROM owner_authorization_handoff WHERE handoff_id LIKE 'rss-auto-handoff-%'").all();
    expect(grants.length).toBeGreaterThanOrEqual(7);
    expect(new Set(grants.map(row => row.owner_process))).toEqual(new Set(["system_supervisor", "automatic_reviewer", "automatic_publisher"]));
    expect(grants.every(row => row.consumed_by_operation_id !== null && Date.parse(String(row.expires_at)) - Date.parse(String(row.verified_at)) === 60_000)).toBe(true);
    expect(JSON.parse(readFileSync(join(fixture.privateDir, "rss-automatic-cursor.json"), "utf8"))).toMatchObject({ schemaVersion: "rss-automatic-cursor-v1", cutoffIso: CUTOFF });
    automatic.close(); runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    const renewalSeed = new DatabaseSync(fixture.databasePath);
    try { seedRssAutomaticBackup(renewalSeed, { releaseSha256: current.receipt.fullManifestSha256, manifestSha256: fixture.config.expectedDeploymentManifestSha256!, nowIso: new Date().toISOString(), id: "rss-delayed-fallback-backup" }); }
    finally { renewalSeed.close(); }
    const fallbackConfig = { ...fixture.config, releaseGate: current.fallbackGate };
    expect(fallbackConfig.expectedBackupReleaseSha256).toBe(current.receipt.fullManifestSha256);
    expect(fallbackConfig.verifiedRssAutomaticFullManifestSha256).toBe(current.receipt.fullManifestSha256);
    expect(rssAutomaticRuntimeEnabled(fallbackConfig)).toBe(false);
    runtime = createReviewAdminRuntime(fallbackConfig);
    const receiver = new ProjectionReceiver({ root: join(fixture.root, "public-projection"), signingKeyId: fixture.config.projectionSigningKeyId,
      publicKey: createPublicKey(readFileSync(fixture.config.projectionSigningPrivateKeyPath)), now: () => Date.now() });
    const sent = vi.spyOn(ProjectionHttpTransport.prototype, "post").mockImplementation(async value => ({ kind: "response", status: 200, body: receiver.receive(value) }));
    expect(await runtime.sender.tick()).toMatchObject({ outcome: "succeeded", deliveryId: result.deliveryId });
    expect(sent).toHaveBeenCalledTimes(1); expect(receiver.readActiveSnapshot()?.snapshotGeneration).toBe(1);
    expect(runtime.database.prepare("SELECT count(*) n FROM generic_fence_receipt WHERE reason_code='RSS_AUTOMATIC_COMMITTED_DELIVERY_V1'").get()!.n).toBe(5);
    expect(runtime.database.prepare("SELECT count(*) n FROM internal_operation WHERE expected_manifest_sha256=? AND owner_process IN ('automatic_reviewer','automatic_publisher')").get(current.fallbackGate.receipt.manifestSha256)!.n).toBe(0);
    expect(runtime.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process='projection_sender' AND state='succeeded'").get()!.n).toBeGreaterThan(0);
    expect(runtime.database.prepare("SELECT consumed_units,reserved_units FROM budget_account WHERE account_id='acct-projection'").get()).toEqual({ consumed_units: 1, reserved_units: 0 });
    expect(runtime.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process='admin_http'").get()!.n).toBe(0);
    runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close();
    runtime = createReviewAdminRuntime(fixture.config);
    const restarted = createRssAutomaticRuntime(fixture.config, runtime); cleanups.push(restarted.close);
    expect((await restarted.tick()).published).toBe(0);
    expect(runtime.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(1);
  });
  it.each([false, true])("recovers an unknown committed delivery across restarts without another POST (outbox interruption=%s)", async (outboxInterruption) => {
    const current = pair(); const fixture = await rssAutomaticServiceFixture(current.fullGate, true, current.receipt.fallbackManifestSha256); cleanups.push(fixture.cleanup);
    let runtime = createReviewAdminRuntime(fixture.config); cleanups.push(() => { runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close(); });
    const automatic = createRssAutomaticRuntime(fixture.config, runtime); cleanups.push(automatic.close);
    const result = await automatic.tick(); expect(result).toMatchObject({ published: 1 });
    const receiver = new ProjectionReceiver({ root: join(fixture.root, "unknown-public-projection"), signingKeyId: fixture.config.projectionSigningKeyId,
      publicKey: createPublicKey(readFileSync(fixture.config.projectionSigningPrivateKeyPath)), now: () => Date.now() });
    const posted = vi.spyOn(ProjectionHttpTransport.prototype, "post").mockImplementation(async value => { receiver.receive(value); return { kind: "unknown" }; });
    expect(await runtime.sender.tick()).toEqual({ outcome: "reconcile_wait", deliveryId: result.deliveryId });
    const original = runtime.database.prepare("SELECT attempt_id,operation_id,reconcile_key FROM internal_external_attempt WHERE endpoint_class='projection_deliver'").get()!;
    expect(runtime.database.prepare("SELECT state FROM internal_external_attempt WHERE attempt_id=?").get(String(original.attempt_id))!.state).toBe("reconcile_required");
    expect(receiver.readActiveSnapshot()?.snapshotGeneration).toBe(1);
    automatic.close(); runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 16 * 60_000);
    const renewalSeed = new DatabaseSync(fixture.databasePath);
    try { seedRssAutomaticBackup(renewalSeed, { releaseSha256: current.receipt.fullManifestSha256, manifestSha256: fixture.config.expectedDeploymentManifestSha256!, nowIso: new Date().toISOString(), id: "rss-unknown-restart-backup" }); }
    finally { renewalSeed.close(); }
    runtime = createReviewAdminRuntime({ ...fixture.config, releaseGate: current.fallbackGate });
    const fetched = vi.spyOn(ProjectionHttpTransport.prototype, "getReceipt").mockImplementation(async deliveryId => ({ kind: "response", status: 200, body: receiver.getReceipt(deliveryId) }));
    if (outboxInterruption) {
      vi.spyOn(ReviewRealRepository.prototype, "markDeliverySucceeded").mockImplementationOnce(() => { throw new Error("SYNTHETIC_CRASH_BEFORE_OUTBOX_COMMIT"); });
      await expect(runtime.sender.tick()).rejects.toThrow("SYNTHETIC_CRASH_BEFORE_OUTBOX_COMMIT");
      expect(runtime.database.prepare("SELECT state,outcome FROM internal_external_attempt WHERE attempt_id=?").get(String(original.attempt_id))).toEqual({ state: "response_committed", outcome: "succeeded" });
      expect(runtime.database.prepare("SELECT status FROM projection_outbox WHERE delivery_id=?").get(result.deliveryId!)!.status).toBe("reconcile_wait");
      runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close();
      runtime = createReviewAdminRuntime(fixture.config);
    }
    expect(await runtime.sender.tick()).toEqual({ outcome: "succeeded", deliveryId: result.deliveryId });
    expect(posted).toHaveBeenCalledTimes(1); expect(fetched).toHaveBeenCalledExactlyOnceWith(result.deliveryId);
    expect(runtime.database.prepare("SELECT state,outcome FROM internal_external_attempt WHERE attempt_id=?").get(String(original.attempt_id))).toEqual({ state: "response_committed", outcome: "succeeded" });
    expect(runtime.database.prepare("SELECT state FROM internal_operation WHERE operation_id=?").get(String(original.operation_id))!.state).toBe("terminal_failed");
    expect(runtime.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process='reconciler' AND operation_kind='reconcile' AND state='succeeded'").get()!.n).toBeGreaterThan(0);
    expect(runtime.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(1);
    expect(runtime.database.prepare("SELECT count(*) n FROM internal_operation WHERE expected_manifest_sha256=? AND owner_process IN ('automatic_reviewer','automatic_publisher')").get(current.fallbackGate.receipt.manifestSha256)!.n).toBe(0);
    expect(await runtime.sender.tick()).toEqual({ outcome: "idle", deliveryId: null });
    expect(posted).toHaveBeenCalledTimes(1); expect(fetched).toHaveBeenCalledTimes(1); expect(receiver.readActiveSnapshot()?.snapshotGeneration).toBe(1);
    expect(runtime.database.prepare("SELECT consumed_units,reserved_units FROM budget_account WHERE account_id='acct-projection'").get()).toEqual({ consumed_units: 2, reserved_units: 0 });
  });
  it.each([false, true])("recovers a successful POST missing local completion across restarts without another POST (outbox interruption=%s)", async (outboxInterruption) => {
    const current = pair(RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256); const fixture = await rssAutomaticServiceFixture(current.fullGate, true, current.receipt.fallbackManifestSha256, true); cleanups.push(fixture.cleanup);
    let runtime = createReviewAdminRuntime(fixture.config); cleanups.push(() => { runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close(); });
    const automatic = createRssAutomaticRuntime(fixture.config, runtime); cleanups.push(automatic.close);
    const result = await automatic.tick(); expect(result).toMatchObject({ published: 1 });
    const receiver = new ProjectionReceiver({ root: join(fixture.root, "success-public-projection"), signingKeyId: fixture.config.projectionSigningKeyId,
      publicKey: createPublicKey(readFileSync(fixture.config.projectionSigningPrivateKeyPath)), now: () => Date.now() });
    const posted = vi.spyOn(ProjectionHttpTransport.prototype, "post").mockImplementation(async value => ({ kind: "response", status: 200, body: receiver.receive(value) }));
    vi.spyOn(ReviewRealRepository.prototype, "markDeliverySucceeded").mockImplementationOnce(() => { throw new Error("SUCCESSFUL_POST_LOCAL_CRASH"); });
    await expect(runtime.sender.tick()).rejects.toThrow("SUCCESSFUL_POST_LOCAL_CRASH");
    const original = runtime.database.prepare("SELECT * FROM internal_external_attempt WHERE endpoint_class='projection_deliver'").get()!;
    const operation = runtime.database.prepare("SELECT * FROM internal_operation WHERE operation_id=?").get(String(original.operation_id))!;
    const budget = runtime.database.prepare("SELECT * FROM budget_reservation WHERE reservation_id=?").get(String(operation.budget_reservation_id))!;
    expect(original).toMatchObject({ state: "response_committed", outcome: "succeeded", reconcile_consumed_at: null });
    expect(operation.state).toBe("succeeded"); expect(budget.state).toBe("consumed");
    expect(receiver.readActiveSnapshot()?.snapshotGeneration).toBe(1);
    automatic.close(); runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 16 * 60_000);
    const renewalSeed = new DatabaseSync(fixture.databasePath);
    try { seedRssAutomaticBackup(renewalSeed, { releaseSha256: current.receipt.fullManifestSha256, manifestSha256: fixture.config.expectedDeploymentManifestSha256!, nowIso: new Date().toISOString(), schemaSha256: RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256, id: "rss-success-restart-backup" }); }
    finally { renewalSeed.close(); }
    runtime = createReviewAdminRuntime({ ...fixture.config, releaseGate: current.fallbackGate });
    const fetched = vi.spyOn(ProjectionHttpTransport.prototype, "getReceipt").mockImplementation(async deliveryId => ({ kind: "response", status: 200, body: receiver.getReceipt(deliveryId) }));
    if (outboxInterruption) {
      vi.spyOn(ReviewRealRepository.prototype, "markDeliverySucceeded").mockImplementationOnce(() => { throw new Error("SYNTHETIC_CRASH_BEFORE_OUTBOX_COMMIT"); });
      await expect(runtime.sender.tick()).rejects.toThrow("SYNTHETIC_CRASH_BEFORE_OUTBOX_COMMIT");
      expect(runtime.database.prepare("SELECT state,outcome FROM internal_external_attempt WHERE attempt_id=?").get(String(original.attempt_id))).toEqual({ state: "response_committed", outcome: "succeeded" });
      expect(runtime.database.prepare("SELECT status FROM projection_outbox WHERE delivery_id=?").get(result.deliveryId!)!.status).toBe("reconcile_wait");
      runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close();
      runtime = createReviewAdminRuntime(fixture.config);
    }
    expect(await runtime.sender.tick()).toEqual({ outcome: "succeeded", deliveryId: result.deliveryId });
    expect(posted).toHaveBeenCalledTimes(1); expect(fetched).toHaveBeenCalledExactlyOnceWith(result.deliveryId);
    expect(runtime.database.prepare("SELECT state,outcome FROM internal_external_attempt WHERE attempt_id=?").get(String(original.attempt_id))).toEqual({ state: "response_committed", outcome: "succeeded" });
    expect(runtime.database.prepare("SELECT * FROM internal_external_attempt WHERE attempt_id=?").get(String(original.attempt_id))).toEqual(original);
    expect(runtime.database.prepare("SELECT * FROM internal_operation WHERE operation_id=?").get(String(original.operation_id))).toEqual(operation);
    expect(runtime.database.prepare("SELECT * FROM budget_reservation WHERE reservation_id=?").get(String(operation.budget_reservation_id))).toEqual(budget);
    expect(runtime.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process='reconciler' AND operation_kind='reconcile' AND state='succeeded'").get()!.n).toBeGreaterThan(0);
    expect(runtime.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(1);
    expect(runtime.database.prepare("SELECT count(*) n FROM internal_operation WHERE expected_manifest_sha256=? AND owner_process IN ('automatic_reviewer','automatic_publisher')").get(current.fallbackGate.receipt.manifestSha256)!.n).toBe(0);
    expect(await runtime.sender.tick()).toEqual({ outcome: "idle", deliveryId: null });
    expect(posted).toHaveBeenCalledTimes(1); expect(fetched).toHaveBeenCalledTimes(1); expect(receiver.readActiveSnapshot()?.snapshotGeneration).toBe(1);
    expect(runtime.database.prepare("SELECT consumed_units,reserved_units FROM budget_account WHERE account_id='acct-projection'").get()).toEqual({ consumed_units: 2, reserved_units: 0 });
  });
  it("recovers a real process exit after receiver commit while the original attempt is still started", async () => {
    const current = pair(); const fixture = await rssAutomaticServiceFixture(current.fullGate, true, current.receipt.fallbackManifestSha256); cleanups.push(fixture.cleanup);
    let runtime = createReviewAdminRuntime(fixture.config); cleanups.push(() => { runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close(); });
    const automatic = createRssAutomaticRuntime(fixture.config, runtime); cleanups.push(automatic.close);
    const result = await automatic.tick(); expect(result).toMatchObject({ published: 1 });
    automatic.close(); runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close();
    const inputPath = join(fixture.root, "started-child-input.json");
    writeFileSync(inputPath, JSON.stringify({ config: { ...fixture.config, releaseGate: undefined }, full: current.full, pair: current.receipt, root: fixture.root }), { mode: 0o600, flag: "wx" });
    const child = spawnSync(process.execPath, ["--experimental-transform-types", join(APP_ROOT, "src/tests/helpers/rss-automatic-started-child.ts"), inputPath], {
      cwd: APP_ROOT, env: { ...process.env, NODE_ENV: "test" }, encoding: "utf8", timeout: 10_000
    });
    expect(child.status, child.stderr).toBe(86);
    expect(JSON.parse(readFileSync(join(fixture.root, "started-child-post-receipt.json"), "utf8"))).toMatchObject({ deliveryId: result.deliveryId, snapshotGeneration: 1 });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 16 * 60_000);
    const renewalSeed = new DatabaseSync(fixture.databasePath);
    try { seedRssAutomaticBackup(renewalSeed, { releaseSha256: current.receipt.fullManifestSha256, manifestSha256: fixture.config.expectedDeploymentManifestSha256!, nowIso: new Date().toISOString(), id: "rss-started-restart-backup" }); }
    finally { renewalSeed.close(); }
    runtime = createReviewAdminRuntime({ ...fixture.config, releaseGate: current.fallbackGate });
    const original = runtime.database.prepare("SELECT attempt_id,operation_id,state,outcome,external_calls FROM internal_external_attempt WHERE endpoint_class='projection_deliver'").get()!;
    expect(original).toMatchObject({ state: "started", outcome: "pending", external_calls: 1 });
    expect(runtime.database.prepare("SELECT state FROM internal_operation WHERE operation_id=?").get(String(original.operation_id))!.state).toBe("in_flight");
    const receiver = new ProjectionReceiver({ root: join(fixture.root, "started-public-projection"), signingKeyId: fixture.config.projectionSigningKeyId,
      publicKey: createPublicKey(readFileSync(fixture.config.projectionSigningPrivateKeyPath)), now: () => Date.now() });
    const posted = vi.spyOn(ProjectionHttpTransport.prototype, "post").mockImplementation(async () => { throw new Error("SECOND_POST_FORBIDDEN"); });
    const fetched = vi.spyOn(ProjectionHttpTransport.prototype, "getReceipt").mockImplementation(async deliveryId => ({ kind: "response", status: 200, body: receiver.getReceipt(deliveryId) }));
    expect(await runtime.sender.tick()).toEqual({ outcome: "succeeded", deliveryId: result.deliveryId });
    expect(posted).not.toHaveBeenCalled(); expect(fetched).toHaveBeenCalledExactlyOnceWith(result.deliveryId);
    expect(runtime.database.prepare("SELECT state,outcome FROM internal_external_attempt WHERE attempt_id=?").get(String(original.attempt_id))).toEqual({ state: "response_committed", outcome: "succeeded" });
    expect(runtime.database.prepare("SELECT state,reason_code FROM internal_operation WHERE operation_id=?").get(String(original.operation_id))).toEqual({ state: "terminal_failed", reason_code: "LOCAL_COMPLETION_AUTHORITY_EXPIRED" });
    expect(runtime.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(1); expect(receiver.readActiveSnapshot()?.snapshotGeneration).toBe(1);
    expect(await runtime.sender.tick()).toEqual({ outcome: "idle", deliveryId: null }); expect(fetched).toHaveBeenCalledTimes(1); expect(posted).not.toHaveBeenCalled();
    expect(runtime.database.prepare("SELECT consumed_units,reserved_units FROM budget_account WHERE account_id='acct-projection'").get()).toEqual({ consumed_units: 2, reserved_units: 0 });
  });
  it("requires the one explicit build switch and exact successor before paired automatic capability activation", () => {
    expect(releaseSchemaForBuildOptions([])).toBe(SOURCE_REGISTRY_SCHEMA10_SHA256);
    expect(releaseSchemaForBuildOptions(["--rss-automatic"])).toBe(RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256);
    for (const args of [["--auto"], ["--rss-automatic", "--rss-automatic"], ["--rss-automatic", "anything"]]) expect(() => releaseSchemaForBuildOptions(args)).toThrow("RELEASE_BUILD_OPTIONS_INVALID");
    expect(fullV10Capabilities()).toMatchObject({ automaticReview: false, automaticPublish: false });
    const current = pair(); assertFullCapabilities(current.full); assertFallbackCapabilities(current.fallback);
    expect(current.fullGate.allows("automatic_review")).toBe(true); expect(current.fullGate.allows("automatic_publish")).toBe(true);
    expect(() => assertFullCapabilities({ ...current.full, capabilities: { ...current.full.capabilities, automaticPublish: false } })).toThrow("FULL_AUTOMATION_REGISTRATION_OPEN");
    const legacy = pair(SOURCE_REGISTRY_SCHEMA10_SHA256);
    expect(() => assertFullCapabilities({ ...legacy.full, capabilities: { ...legacy.full.capabilities, automaticReview: true, automaticPublish: true } })).toThrow("FULL_AUTOMATION_REGISTRATION_OPEN");
    for (const action of ["model_network", "automatic_review", "automatic_publish"] as const) expect(current.fallbackGate.allows(action)).toBe(false);
  });

  it("keeps activated capabilities immutable even if the original parsed manifest object is changed", () => {
    const current = pair();
    const mutable = JSON.parse(JSON.stringify(current.fallback)) as ReleaseCandidateManifest;
    const gate = activateReleaseCandidate(mutable, current.receipt, "2026-09-07T00:00:02.000Z", current.fullGate.receipt.activationId);
    Object.assign(mutable.capabilities, { automaticReview: true });
    expect(gate.allows("automatic_review")).toBe(false);
    expect(Object.isFrozen(gate.capabilities)).toBe(true);
  });

  it("registers only the exact full release with a configured cutoff", () => {
    const current = pair(); const enabled = { reviewSchemaSha256: RSS_AUTOMATIC_SCHEMA_SHA256, releaseGate: current.fullGate, rssAutomaticCutoffIso: CUTOFF } as const;
    expect(rssAutomaticRuntimeEnabled(enabled)).toBe(true);
    expect(rssAutomaticRuntimeEnabled({ ...enabled, releaseGate: current.fallbackGate })).toBe(false);
    expect(rssAutomaticRuntimeEnabled({ ...enabled, reviewSchemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256 })).toBe(false);
    expect(rssAutomaticRuntimeEnabled({ ...enabled, rssAutomaticCutoffIso: undefined })).toBe(false);
    expect(rssAutomaticRuntimeEnabled({ ...enabled, releaseGate: undefined })).toBe(false);
  });

  it("runs one sender and one cycle, signals automatic close immediately and drains both before stop completes", async () => {
    vi.useFakeTimers(); let finishSender!: () => void; let finishAuto!: () => void;
    const senderTick = vi.fn(() => new Promise<void>(resolve => { finishSender = resolve; }));
    let active: Promise<void> | undefined; const resourcesClosed = vi.fn();
    const tick = vi.fn(() => active = new Promise<void>(resolve => { finishAuto = resolve; }));
    const close = vi.fn(async () => { await active; resourcesClosed(); });
    const tasks = startAdminBackgroundTasks({ senderTick, automaticEnabled: true, createAutomatic: () => ({ tick, close }) });
    await vi.advanceTimersByTimeAsync(0); expect(senderTick).toHaveBeenCalledTimes(1); expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * 60_000); expect(senderTick).toHaveBeenCalledTimes(1); expect(tick).toHaveBeenCalledTimes(1);
    const stopped = tasks.stop(); let drained = false; void stopped.then(() => { drained = true; });
    expect(tasks.stop()).toBe(stopped); expect(close).toHaveBeenCalledTimes(1); expect(resourcesClosed).not.toHaveBeenCalled();
    finishAuto(); await vi.advanceTimersByTimeAsync(0); expect(resourcesClosed).toHaveBeenCalledTimes(1); expect(drained).toBe(false);
    finishSender(); await stopped; expect(drained).toBe(true);
    expect(close).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(3 * 60_000); expect(tick).toHaveBeenCalledTimes(1); expect(senderTick).toHaveBeenCalledTimes(1);
  });

  it("keeps fallback zero-automation and suppresses queued initial work when already stopped", async () => {
    vi.useFakeTimers(); const senderTick = vi.fn(async () => undefined); const createAutomatic = vi.fn(() => ({ tick: async () => undefined, close() {} }));
    const fallback = startAdminBackgroundTasks({ senderTick, automaticEnabled: false, createAutomatic });
    expect(fallback).toMatchObject({ automaticReviewRegistrations: 0, automaticPublishRegistrations: 0 });
    await fallback.stop(); expect(senderTick).not.toHaveBeenCalled(); expect(createAutomatic).not.toHaveBeenCalled();
  });

  it("starts another cycle after a failure, but never registers an additional sender", async () => {
    vi.useFakeTimers(); const senderTick = vi.fn(async () => undefined); const tick = vi.fn(async () => { throw new Error("synthetic failure"); }); const reportFailure = vi.fn();
    const tasks = startAdminBackgroundTasks({ senderTick, automaticEnabled: true, createAutomatic: () => ({ tick, close() {} }), reportFailure });
    await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(2); expect(senderTick).toHaveBeenCalledTimes(2); expect(reportFailure).toHaveBeenCalledTimes(2); await tasks.stop();
  });

  it("keeps existing automatic history unchanged across RSS fallback and rejects newly added operations", () => {
    const current = pair();
    const observation = (gate: typeof current.fullGate): ReleaseRuntimeObservation => ({ ...gate.receipt, schemaVersion: 10,
      databaseLogicalSha256: "d".repeat(64), outboxRows: 5, idempotencyRows: 9, externalCalls: 2,
      automaticReviewRegistrations: 3, automaticPublishRegistrations: 2, publicLkgSha256: "e".repeat(64) });
    const before = observation(current.fullGate), fallback = observation(current.fallbackGate), rollback = observation(current.rollbackGate);
    expect(buildReleaseSwitchReceipt(current.receipt, before, fallback, rollback)).toMatchObject({ automaticReviewRegistrations: 3, automaticPublishRegistrations: 2, databaseUnchanged: true });
    expect(() => buildReleaseSwitchReceipt(current.receipt, before, { ...fallback, automaticReviewRegistrations: 4 }, rollback)).toThrow("RELEASE_SWITCH_AUTOMATION_DRIFT");
    const legacy = pair(SOURCE_REGISTRY_SCHEMA10_SHA256);
    expect(() => buildReleaseSwitchReceipt(legacy.receipt, observation(legacy.fullGate), observation(legacy.fallbackGate), observation(legacy.rollbackGate))).toThrow("RELEASE_SWITCH_AUTOMATION_NONZERO");
  });

  it("creates the real RSS Admin runtime for isolated drills without timers, handoff issuance, or network", async () => {
    const current = pair(); const root = mkdtempSync(join(realpathSync(tmpdir()), "rss-runtime-drill-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const databasePath = join(root, "f1plus1-rss-real-private.sqlite"); const memory = xPageSchema12(); applyRssAutomaticMigration(memory, { applyEnabled: true });
    const now = Date.now(); const handoff = { handoffId: "rss-runtime-admin-only", ownerProcess: "admin_http" as const, issuer: "f1plus1-owner-supervisor-v1" as const,
      oneTimeNonce: createHash("sha256").update("rss-runtime-admin").digest("base64url"), releaseSha256: current.fullGate.receipt.sourcePreimageSha256,
      manifestSha256: current.fullGate.receipt.manifestSha256, receiptSha256: hash("rss-runtime-admin"), verifiedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60_000).toISOString() };
    persistOwnerSupervisorHandoff(memory, handoff, () => true); await backup(memory, databasePath); memory.close(); chmodSync(databasePath, 0o600);
    const dataRoot = join(root, "admin"); mkdirSync(dataRoot, { mode: 0o700 }); mkdirSync(join(dataRoot, "private"), { mode: 0o700 });
    const sessionPath = join(dataRoot, "session-hash-key"), fencePath = join(dataRoot, "recovery-fence.json"), signingPath = join(root, "projection.pem");
    writeFileSync(sessionPath, Buffer.alloc(32, 4).toString("base64url"), { mode: 0o600 });
    writeFileSync(fencePath, canonicalJson({ schemaVersion: "admin-recovery-fence-v1", clockTrusted: true, writerReady: true, lastSuccessfulRecoveryPointAt: now }), { mode: 0o600 });
    const keys = generateKeyPairSync("ed25519"); writeFileSync(signingPath, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    const config: AdminRuntimeConfig = { targetReleaseAppRoot: APP_ROOT, reviewDatabasePath: databasePath,
      reviewDatabaseIdentity: inspectExistingPrivateDatabase(databasePath, "f1plus1-rss-real-private.sqlite"), reviewSchemaTarget: 10, reviewSchemaSha256: RSS_AUTOMATIC_SCHEMA_SHA256,
      rssAutomaticCutoffIso: CUTOFF, dataRoot, staticRoot: join(APP_ROOT, "src/admin-ui"), canonicalOrigin: "https://f1-admin.example.ts.net", rpName: "F1+1 Admin", operatorRef: "operator",
      tailscaleAppCapabilityId: "admin.example.com/cap/f1-admin-device", trustedIdentities: [{ login: "owner@example.com", operatorRef: "operator", sourceRefs: ["A".repeat(43), "B".repeat(43), "C".repeat(43)] }],
      sessionHashKeyPath: sessionPath, recoveryFencePath: fencePath, projectionSigningKeyId: "projection-key", projectionSigningPrivateKeyPath: signingPath,
      projectionInternalEndpoint: "http://127.0.0.1:3102/internal/projections", projectionSenderServiceIdentity: "projection-sender", releaseGate: current.fullGate };
    const interval = vi.spyOn(globalThis, "setInterval"); const network = vi.spyOn(globalThis, "fetch");
    const runtime = createReviewAdminRuntime(config); cleanups.push(() => { runtime.gateway?.close(); runtime.database.close(); });
    const before = releaseDatabaseLogicalSha256(runtime.database); await Promise.resolve();
    expect(interval).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled(); expect(releaseDatabaseLogicalSha256(runtime.database)).toBe(before);
    expect(runtime.database.prepare("SELECT count(*) n FROM owner_authorization_handoff").get()!.n).toBe(1);
    expect(runtime.gateway?.expectedSchemaSha256()).toBe(RSS_AUTOMATIC_SCHEMA_SHA256);
    expect(observeReleaseRuntime(runtime.database, current.fullGate, "e".repeat(64)).schemaSha256).toBe(RSS_AUTOMATIC_SCHEMA_SHA256);
    expect(() => createReviewAdminRuntime({ ...config, reviewSchemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256 })).toThrow("ADMIN_REVIEW_SCHEMA_RELEASE_MISMATCH");
    expect(() => createReviewAdminRuntime({ ...config, rssAutomaticCutoffIso: undefined })).toThrow("ADMIN_RSS_AUTOMATIC_CUTOFF_INVALID");
    const manifest = {
      schemaVersion: "admin-service-deployment-v3", label: "com.f1plus1.admin-service", bindHost: "127.0.0.1", bindPort: 3101,
      canonicalOrigin: config.canonicalOrigin, rpName: config.rpName, operatorRef: config.operatorRef,
      tailscaleAppCapabilityId: config.tailscaleAppCapabilityId, trustedIdentities: config.trustedIdentities,
      targetReleaseAppRoot: APP_ROOT, activeReleaseRole: "full_v10", fullReleaseManifestPath: "/release/full.json", fullReleaseManifestSha256: "a".repeat(64),
      fallbackReleaseManifestPath: "/release/fallback.json", fallbackReleaseManifestSha256: "b".repeat(64), releasePairReceiptPath: "/release/pair.json", releasePairReceiptSha256: "c".repeat(64),
      officialReleaseManifestPath: "/release/official.json", officialReleaseManifestSha256: "d".repeat(64), reviewDatabasePath: ADMIN_REVIEW_DATABASE_PATH,
      reviewDatabaseIdentity: config.reviewDatabaseIdentity, reviewSchemaTarget: 10, reviewSchemaSha256: RSS_AUTOMATIC_SCHEMA_SHA256, rssAutomaticCutoffIso: CUTOFF,
      dataRoot, staticRoot: config.staticRoot, sessionHashKeyPath: sessionPath, recoveryFencePath: fencePath, publicProjectionRoot: "/public/projection",
      projectionSigningKeyId: "projection-key", projectionSigningPrivateKeyPath: signingPath, projectionVerifyKeyPath: "/public/key.pem",
      projectionInternalEndpoint: config.projectionInternalEndpoint, publicReadMode: "public-real-snapshot", syntheticRollbackRelease: current.fallback.releaseId,
      syntheticRollbackHash: current.receipt.fallbackManifestSha256, projectionSenderServiceIdentity: "projection-sender", projectionReceiverServiceIdentity: "projection-receiver",
      preparedAt: new Date(now).toISOString(), serviceState: "disabled"
    };
    expect(AdminDeploymentManifestSchema.safeParse(manifest).success).toBe(true);
    expect(AdminDeploymentManifestSchema.safeParse({ ...manifest, rssAutomaticCutoffIso: undefined }).success).toBe(false);
    expect(AdminDeploymentManifestSchema.safeParse({ ...manifest, reviewSchemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256 }).success).toBe(false);
    expect(AdminDeploymentManifestSchema.safeParse({ ...manifest, reviewSchemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256, rssAutomaticCutoffIso: undefined }).success).toBe(true);
    expect(AdminDeploymentManifestSchema.safeParse({ ...manifest, reviewSchemaSha256: "0".repeat(64) }).success).toBe(false);
  });
});
