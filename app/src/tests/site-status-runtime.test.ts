import { execFile } from "node:child_process";
import { createServer, type RequestListener, type Server } from "node:http";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { HTTP_TIMEOUT_MS, parseSiteStatusConfig, PUBLIC_HEALTH_URL, validatePublicHealthUrl } from "../server/site-status/config.ts";
import { assembleSiteStatus, combineStatus, readFixedProcess, sampleHttp, sampleProcess, sampleStorage, SERVICE_LABELS, unknownSiteStatus, type HttpSample, type ProcessSample } from "../server/site-status/runtime.ts";
import type { BackupSample, DatabaseSample } from "../server/site-status/types.ts";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

const config = parseSiteStatusConfig({
  schemaVersion: 1,
  database: { databasePath: "/operator/database.sqlite", deploymentManifestPath: "/operator/deployment.json", expectedDeploymentManifestSha256: "a".repeat(64), expectedSchemaSha256: "b".repeat(64), expectedReleaseSha256: "c".repeat(64), expectedDatabaseIdentity: { device: 1, inode: 2, uid: 501 } },
  backup: { backupRoot: "/operator/backups", backupStateRoot: "/operator/backup-state", offHostPublicKeyPath: "/operator/offhost.pem", applicationDrillPublicKeyPath: "/operator/drill.pem", expectedOffHostPublicKeySha256: "d".repeat(64), expectedApplicationDrillPublicKeySha256: "e".repeat(64) },
  publicTarget: { url: PUBLIC_HEALTH_URL, tunnelPid: 48316, tunnelStartedAt: "Thu Sep 10 11:35:16 2026" },
  storage: { path: "/operator", warningAvailableBytes: 100, failedAvailableBytes: 20 },
});
const health = { status: "ready", reasonCode: "ok", dataGate: "accepted-public-real-snapshot", runtime: { migration: "public-real-snapshot-v1", seed: "signed-active-snapshot" } };

describe("fixed operator configuration", () => {
  it.each([
    "http://blank-wagner-formatting-stories.trycloudflare.com/api/health",
    "https://blank-wagner-formatting-stories.trycloudflare.com.evil.test/api/health",
    "https://user:password@blank-wagner-formatting-stories.trycloudflare.com/api/health",
    `${PUBLIC_HEALTH_URL}?action=restart`, `${PUBLIC_HEALTH_URL}#fragment`, `${PUBLIC_HEALTH_URL}?`,
    "https://127.0.0.1/api/health", "https://198.18.0.1/api/health",
    "https://blank-wagner-formatting-stories.trycloudflare.com:443/api/health",
  ])("rejects arbitrary / ambiguous URL %s", (url) => expect(() => validatePublicHealthUrl(url)).toThrow("STATUS_CONFIG_INVALID"));

  it("rejects extra capability keys at every configuration boundary", () => {
    expect(() => parseSiteStatusConfig({ ...config, shell: "true" })).toThrow();
    expect(() => parseSiteStatusConfig({ ...config, database: { ...config.database, sql: "SELECT 1" } })).toThrow();
    expect(() => parseSiteStatusConfig({ ...config, backup: { ...config.backup, action: "backup" } })).toThrow();
    expect(() => parseSiteStatusConfig({ ...config, publicTarget: { ...config.publicTarget, method: "POST" } })).toThrow();
    expect(() => parseSiteStatusConfig({ ...config, storage: { ...config.storage, url: "x" } })).toThrow();
  });

  it("rejects invalid thresholds, relative paths and oversized SQLite busy limits", () => {
    expect(() => parseSiteStatusConfig({ ...config, storage: { ...config.storage, path: "relative" } })).toThrow();
    expect(() => parseSiteStatusConfig({ ...config, storage: { ...config.storage, failedAvailableBytes: 101 } })).toThrow();
    expect(() => parseSiteStatusConfig({ ...config, database: { ...config.database, busyTimeoutMs: 1001 } })).toThrow();
  });
});

describe("bounded fixed HTTP probes", () => {
  let publicHandler: RequestListener;
  let adminHandler: RequestListener;
  let publicServer: Server;
  let adminServer: Server;
  let requestCount = 0;
  const defaultPublic: RequestListener = (request, response) => {
    expect(request.method).toBe("GET"); expect(request.url).toBe("/api/health");
    expect(request.headers.cookie).toBeUndefined(); expect(request.headers.authorization).toBeUndefined();
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(health));
  };
  beforeAll(async () => {
    publicHandler = defaultPublic;
    adminHandler = (_, response) => { response.writeHead(404, { "content-type": "application/json" }); response.end(JSON.stringify({ schemaVersion: "admin-service-error-v1", reasonCode: "ADMIN_REQUEST_INVALID" })); };
    publicServer = createServer((request, response) => { requestCount++; publicHandler(request, response); });
    adminServer = createServer((request, response) => adminHandler(request, response));
    await Promise.all([new Promise<void>((resolve, reject) => publicServer.once("error", reject).listen(3000, "127.0.0.1", resolve)), new Promise<void>((resolve, reject) => adminServer.once("error", reject).listen(3101, "127.0.0.1", resolve))]);
  });
  afterEach(() => { publicHandler = defaultPublic; });
  afterAll(async () => {
    publicServer.closeAllConnections(); adminServer.closeAllConnections();
    await Promise.all([new Promise<void>((resolve) => publicServer.close(() => resolve())), new Promise<void>((resolve) => adminServer.close(() => resolve()))]);
  });

  it("requires the actual real-snapshot health semantics and sends no credentials", async () => {
    expect(await sampleHttp("local-public", config)).toMatchObject({ status: "healthy", statusCode: 200, semantic: "public-real-snapshot" });
    publicHandler = (_, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ ...health, dataGate: "accepted-local-fixture" })); };
    expect(await sampleHttp("local-public", config)).toMatchObject({ status: "failed", reasons: ["HTTP_HEALTH_INVALID"] });
  });

  it("does not follow redirects or echo response bodies", async () => {
    const before = requestCount;
    publicHandler = (_, response) => { response.writeHead(302, { location: "http://127.0.0.1:3000/private" }); response.end("secret-private-path"); };
    const result = await sampleHttp("local-public", config);
    expect(result).toMatchObject({ status: "failed", reasons: ["HTTP_REDIRECT_REJECTED"] });
    expect(requestCount - before).toBe(1); expect(JSON.stringify(result)).not.toContain("secret-private-path");
  });

  it("rejects wrong HTTP status and malformed JSON with closed reasons", async () => {
    publicHandler = (_, response) => { response.writeHead(503); response.end("secret-key"); };
    expect(await sampleHttp("local-public", config)).toMatchObject({ status: "failed", statusCode: 503, reasons: ["HTTP_STATUS_UNEXPECTED"] });
    publicHandler = (_, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end("{secret-key"); };
    const result = await sampleHttp("local-public", config);
    expect(result.reasons).toEqual(["HTTP_HEALTH_INVALID"]); expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("stops response bodies at 64 KiB", async () => {
    publicHandler = (_, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end("x".repeat(65_537)); };
    expect(await sampleHttp("local-public", config)).toMatchObject({ status: "failed", reasons: ["HTTP_BODY_TOO_LARGE"] });
  });

  it("times out a server that never produces a response", async () => {
    publicHandler = () => {};
    const begin = performance.now();
    expect(await sampleHttp("local-public", config)).toMatchObject({ status: "failed", reasons: ["HTTP_TIMEOUT"] });
    expect(performance.now() - begin).toBeLessThan(HTTP_TIMEOUT_MS + 750);
  }, 6_000);

  it("keeps loopback rejection separate from authenticated private access", async () => {
    const result = await sampleHttp("admin-auth", config);
    expect(result).toMatchObject({ status: "healthy", statusCode: 404, semantic: "loopback-perimeter-rejection", authenticatedPrivateAccess: "unknown" });
    expect(JSON.stringify(result)).not.toContain("ADMIN_REQUEST_INVALID");
  });

  it("does not accept generic 404 or an unprotected Admin response", async () => {
    adminHandler = (_, response) => { response.writeHead(404, { "content-type": "application/json" }); response.end(JSON.stringify({ reasonCode: "NOT_FOUND" })); };
    expect(await sampleHttp("admin-auth", config)).toMatchObject({ status: "failed", reasons: ["HTTP_HEALTH_INVALID"] });
    adminHandler = (_, response) => { response.writeHead(200); response.end("sensitive admin data"); };
    expect(await sampleHttp("admin-auth", config)).toMatchObject({ status: "failed", reasons: ["HTTP_STATUS_UNEXPECTED"] });
  });

  it("marks a restarted or unverifiable tunnel target unknown without requesting an old URL", async () => {
    const tunnel: ProcessSample = { status: "healthy", observedAt: new Date().toISOString(), reasons: [], service: SERVICE_LABELS[2], state: "running", pid: 48316, startedAt: "Thu Sep 10 11:35:16 2026" };
    for (const changed of [{ ...tunnel, pid: 48317 }, { ...tunnel, startedAt: "Thu Sep 10 12:35:16 2026" }, undefined]) {
      expect(await sampleHttp("public-https", config, changed)).toMatchObject({ status: "unknown", reasons: ["PUBLIC_TARGET_IDENTITY_UNKNOWN"], statusCode: null });
    }
  });
});

describe("process identity and capacity", () => {
  it("extracts only top-level running PID and the fixed ps start time", async () => {
    const read = vi.fn().mockResolvedValueOnce({ status: "ok", stdout: "gui/501/example = {\n\tstate = running\n\tpid = 48316\n\tother = {\n\t\tpid = 999\n\t}\n}" }).mockResolvedValueOnce({ status: "ok", stdout: "Thu Sep 10 11:35:16 2026\n" });
    expect(await sampleProcess(SERVICE_LABELS[2], read)).toMatchObject({ status: "healthy", pid: 48316, startedAt: "Thu Sep 10 11:35:16 2026" });
    expect(read.mock.calls).toEqual([["launchctl", SERVICE_LABELS[2]], ["ps", 48316]]);
  });

  it("classifies stopped/missing processes and process inspection timeout", async () => {
    expect(await sampleProcess(SERVICE_LABELS[0], async () => ({ status: "ok", stdout: "\tstate = not running\n" }))).toMatchObject({ status: "failed", reasons: ["PROCESS_NOT_RUNNING"] });
    expect(await sampleProcess(SERVICE_LABELS[0], async () => ({ status: "missing", stdout: "secret" }))).toMatchObject({ status: "failed", reasons: ["PROCESS_NOT_LOADED"] });
    expect(await sampleProcess(SERVICE_LABELS[0], async () => ({ status: "timeout", stdout: "secret" }))).toMatchObject({ status: "unknown", reasons: ["PROCESS_TIMEOUT"] });
    expect(await sampleProcess(SERVICE_LABELS[0], async () => ({ status: "ok", stdout: "\tstate = running\n\tpid = 1\n\tpid = 2\n" }))).toMatchObject({ status: "unknown", reasons: ["PROCESS_OUTPUT_INVALID"] });
  });

  it("uses an absolute fixed executable, fixed verbs and a 1.5 second kill deadline", async () => {
    const promise = readFixedProcess("launchctl", SERVICE_LABELS[0]);
    const args = vi.mocked(execFile).mock.calls.at(-1)!;
    expect(args[0]).toBe("/bin/launchctl"); expect(args[1]).toEqual(["print", "gui/501/com.f1plus1.public-beta"]);
    expect(args[2]).toMatchObject({ timeout: 1500, maxBuffer: 65536, killSignal: "SIGKILL" });
    const callback = args[3] as unknown as (error: { killed: boolean }, output: string) => void;
    callback({ killed: true }, "secret");
    expect(await promise).toEqual({ status: "timeout", stdout: "" });
  });

  it("reports first-sample growth unknown and preserves low/critical capacity", async () => {
    const sample = (available: number) => sampleStorage(config.storage, async () => ({ bsize: BigInt(1), blocks: BigInt(1000), bavail: BigInt(available), device: BigInt(1) }));
    expect(await sample(500)).toMatchObject({ status: "unknown", capacityStatus: "healthy", availableBytes: 500, totalBytes: 1000, growth: { status: "unknown", availableBytesChangePerHour: null } });
    expect(await sample(50)).toMatchObject({ status: "degraded", capacityStatus: "degraded", reasons: ["STORAGE_LOW", "STORAGE_GROWTH_BASELINE_UNAVAILABLE"] });
    expect(await sample(10)).toMatchObject({ status: "failed", capacityStatus: "failed" });
    expect(await sampleStorage(config.storage, async () => { throw new Error("/private/path"); })).toMatchObject({ status: "unknown", availableBytes: null, totalBytes: null, reasons: ["STORAGE_READ_FAILED", "STORAGE_GROWTH_BASELINE_UNAVAILABLE"] });
  });
});

describe("observation envelope", () => {
  it("never promotes unknown or failed components to healthy", () => {
    expect(combineStatus(["healthy", "failed", "unknown"])).toBe("failed");
    expect(combineStatus(["healthy", "unknown"])).toBe("unknown");
    expect(combineStatus(["degraded", "unknown"])).toBe("degraded");
    expect(combineStatus(["healthy", "healthy"])).toBe("healthy");
  });

  it("expires from the earliest sample and rejects stale/future components", async () => {
    const now = new Date();
    const observedAt = new Date(now.getTime() - 61_000).toISOString();
    const database: DatabaseSample = { status: "unknown", observedAt, reasons: ["DATABASE_READ_FAILED"], identity: null, control: null, rss: null, pipeline: null, backupPoint: null };
    const backup: BackupSample = { status: "unknown", observedAt: now.toISOString(), databaseObservedAt: observedAt, reasons: ["BACKUP_DATABASE_UNKNOWN"], point: null, maxRecoveryPointAgeMs: 900000, manifestVerified: null, offHostSignatureVerified: null, applicationSignatureVerified: null, offHostReadCompletedAt: null, applicationDrillCompletedAt: null, verificationScope: "registered-point-and-pinned-signed-receipts", offHostCiphertextReread: false, restoreExecuted: false };
    const http: HttpSample[] = [];
    const storage = await sampleStorage(config.storage, async () => ({ bsize: BigInt(1), blocks: BigInt(1000), bavail: BigInt(500), device: BigInt(1) }));
    expect(assembleSiteStatus(database, backup, http, [], storage, now)).toMatchObject({ status: "unknown", reasons: ["SAMPLE_EXPIRED"] });
    expect(assembleSiteStatus({ ...database, observedAt: new Date(now.getTime() + 10_000).toISOString() }, backup, http, [], storage, now)).toMatchObject({ status: "unknown", reasons: ["SAMPLE_CLOCK_INVALID"] });
    const earlier = new Date(now.getTime() - 10_000).toISOString();
    const result = assembleSiteStatus({ ...database, observedAt: earlier }, backup, http, [], storage, now);
    expect(result.observedAt).toBe(earlier); expect(Date.parse(result.expiresAt) - Date.parse(earlier)).toBe(60000);
    expect(JSON.stringify(unknownSiteStatus("SAMPLER_FAILED"))).not.toContain("/operator");
  });
});
