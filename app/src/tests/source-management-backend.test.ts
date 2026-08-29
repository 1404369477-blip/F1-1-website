import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  realpathSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { loadAppConfig, type EnvRecord } from "../server/config/env";
import { closeDatabase, openSafeDatabase, type SqliteDatabase } from "../server/db/database";
import {
  assertSourceManagementReady,
  initializeSourceManagementProfile,
  migrateSourceManagementDatabase,
  SOURCE_MANAGEMENT_CONTRACT_SHA256,
  SOURCE_MANAGEMENT_DATA_CONTRACT_SHA256,
  SOURCE_MANAGEMENT_SCHEMA_FINGERPRINT_SHA256,
  SOURCE_MANAGEMENT_SECURITY_REPORT_SHA256
} from "../server/db/source-management-synthetic";
import { canonicalJson } from "../server/db/profile";
import {
  IDENTITY_TEST_VECTORS,
  assertBusinessIdentity,
  assertCommandIdentity,
  assertLiveLease,
  generateBusinessIdentity,
  generateLiveLease
} from "../server/source-management/identity";
import { SourceManagementRepository, sourceExpected } from "../server/source-management/repository";
import { AdminSessionStore, assertRawAdminRequest, canonicalBodyHash } from "../server/source-management/security";
import { AdminError, type RuntimeFences } from "../server/source-management/types";
import { installNoEgressGuard } from "../server/vs1/no-egress";

const projectRoot = resolve(import.meta.dirname, "../../..");
const appRoot = resolve(projectRoot, "app");
const roots: string[] = [];
const noEgress = installNoEgressGuard();

function env(port = 3019): EnvRecord {
  return {
    APP_ENV: "test",
    APP_PORT: String(port),
    APP_BIND_HOST: "127.0.0.1",
    APP_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    F1_DATA_PROFILE: "source-management-synthetic",
    F1_DB_PATH: ".local/f1plus1-source-management-synthetic.sqlite",
    SOURCE_CONFIG_PROVIDER: "fixture",
    SOURCE_FIXTURE_PATH: "../data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json",
    ADAPTER_MODE: "mock",
    SUMMARY_MODE: "fixture",
    MEDIA_MODE: "none",
    PUBLISH_MODE: "manual_only",
    REAL_FEISHU_IO: "false",
    REAL_EXTERNAL_IO: "false",
    REAL_FORM_SUBMIT: "false",
    ADMIN_ACCESS_MODE: "local_dev_only",
    LOG_LEVEL: "info"
  };
}

function config() {
  return loadAppConfig(env(), { appRoot, projectRoot, strictKeys: true });
}

function fixture(): { database: SqliteDatabase; root: string } {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-source-management-"));
  roots.push(root);
  const database = openSafeDatabase(join(root, "f1plus1-source-management-synthetic.sqlite"), { appRoot, allowTestRoot: root });
  migrateSourceManagementDatabase(database, appRoot);
  initializeSourceManagementProfile(database, config(), appRoot, projectRoot);
  return { database, root };
}

function deterministicClock(): () => Date {
  let value = Date.parse("2026-08-09T15:00:00.000Z");
  return () => new Date(value += 1_000);
}

function deterministicBytes(): (size: number) => Buffer {
  let value = 1;
  return (size) => Buffer.alloc(size, value++);
}

function commandIdentity(index: number): { command_operation_id: string; command_idempotency_key: string } {
  return {
    command_operation_id: `op-cmd-${Buffer.alloc(32, index).toString("hex")}`,
    command_idempotency_key: `cmd-key:${Buffer.alloc(32, index + 64).toString("hex")}`
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function addCommand(index: number, suffix = "happy") {
  return {
    schema_version: "admin-source-command-v0.3",
    ...commandIdentity(index),
    platform: "x",
    raw_url: `https://synthetic.invalid/${suffix}/${index}`,
    handle: `synthetic_${index}`,
    entity_type: "official_org_team_event",
    content_focus: "team_or_series_updates",
    priority: "medium"
  };
}

const fences: RuntimeFences = { authorization_version: 1, policy_epoch: 1, recovery_epoch: 1 };

function mutation(index: number, repository: SourceManagementRepository, sourceId: string, extra: Record<string, unknown> = {}) {
  const item = repository.get(sourceId);
  if (!item) throw new Error("TEST_SOURCE_MISSING");
  return {
    schema_version: "admin-source-command-v0.3",
    ...commandIdentity(index),
    expected: sourceExpected(item),
    runtime_fences: fences,
    ...extra
  };
}

function expectReason(action: () => unknown, reasonCode: string): void {
  try {
    action();
    throw new Error("EXPECTED_ADMIN_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(AdminError);
    expect((error as AdminError).reasonCode).toBe(reasonCode);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  expect(noEgress.externalCalls).toBe(0);
  noEgress.restore();
});

describe("SOURCE-MGMT-001 backend golden", () => {
  it("pins the accepted contracts and initializes an isolated 59+0 profile", () => {
    expect(createHash("sha256").update(readFileSync(resolve(projectRoot, "docs/spec/F1+1-SOURCE-MGMT-001本地synthetic信源管理纵切实现合同-v0.3.md"))).digest("hex"))
      .toBe(SOURCE_MANAGEMENT_CONTRACT_SHA256);
    expect(createHash("sha256").update(readFileSync(resolve(projectRoot, "docs/collaboration/部门/数据部/报告/2026-08-09-SOURCE-MGMT-001-SQLite-profile-mutation-successor数据合同.md"))).digest("hex"))
      .toBe(SOURCE_MANAGEMENT_DATA_CONTRACT_SHA256);
    expect(createHash("sha256").update(readFileSync(resolve(projectRoot, "docs/collaboration/部门/安全部/报告/2026-08-09-SOURCE-MGMT-001-v0.3实施前独立安全复验报告.md"))).digest("hex"))
      .toBe(SOURCE_MANAGEMENT_SECURITY_REPORT_SHA256);
    const { database } = fixture();
    const ready = assertSourceManagementReady(database, config(), appRoot, projectRoot);
    expect(ready).toMatchObject({ localRows: 0, sqliteVersion: "3.53.1" });
    expect(ready.effectiveRoot).toMatch(/^[a-f0-9]{64}$/);
    expect(Number((database.prepare("SELECT COUNT(*) AS count FROM source_config_fixture").get() as { count: number }).count)).toBe(0);
    expect(Number((database.prepare("SELECT COUNT(*) AS count FROM fixture_profile_ledger").get() as { count: number }).count)).toBe(1);
    expect(() => database.exec("ATTACH DATABASE ':memory:' AS forbidden")).toThrow();
    expect(SOURCE_MANAGEMENT_SCHEMA_FINGERPRINT_SHA256).toMatch(/^[a-f0-9]{64}$/);
    closeDatabase(database);
  });

  it("keeps baseline read-only and closes add, validate, activate, worker, stop and resume", () => {
    const { database } = fixture();
    const repository = new SourceManagementRepository(database, config(), appRoot, projectRoot, deterministicClock(), deterministicBytes());
    const baseline = repository.list({ limit: 100 });
    expect(baseline.items).toHaveLength(59);
    expect(baseline.items.every((item) => item.meta.origin === "m3_baseline" && item.source.enabled === false)).toBe(true);
    const baselineMutation = {
      schema_version: "admin-source-command-v0.3",
      ...commandIdentity(1),
      expected: sourceExpected(baseline.items[0]),
      runtime_fences: fences
    };
    expectReason(() => repository.validate(baselineMutation, "POST", `/api/admin/sources/${baseline.items[0].source.source_id}/validate`, hash(baselineMutation)), "ADMIN_M3_SHADOW_DENIED");

    const add = addCommand(2);
    const added = repository.add(add, "POST", "/api/admin/sources", hash(add));
    expect(repository.add(add, "POST", "/api/admin/sources", hash(add))).toEqual(added);
    expect(repository.businessCounts()).toMatchObject({ source_config_fixture: 1, operation_receipt: 1, outbox_job: 0, task_attempt: 0 });
    const sourceId = added.source_id;
    const validate = mutation(3, repository, sourceId);
    const validated = repository.validate(validate, "POST", `/api/admin/sources/${sourceId}/validate`, hash(validate));
    expect(repository.validate(validate, "POST", `/api/admin/sources/${sourceId}/validate`, hash(validate))).toEqual(validated);
    const activate = mutation(4, repository, sourceId);
    const activation = repository.activate(activate, "POST", `/api/admin/sources/${sourceId}/activate`, hash(activate));
    expect(activation.business_operation_id).toMatch(/^op-srcact-[a-f0-9]{64}$/);
    expect(repository.businessCounts()).toMatchObject({ outbox_job: 1, inbox: 0, task_attempt: 0 });
    const acquired = repository.runActivationWorker("success");
    expect(acquired?.leaseToken).toMatch(/^synthetic:lease:[a-f0-9]{32}$/);
    expect(repository.get(sourceId)?.source).toMatchObject({ collection_onboarding_status: "active", lifecycle_status: "active", enabled: true });
    const stop = mutation(5, repository, sourceId, { stop_reason: "manual" });
    repository.stop(stop, "POST", `/api/admin/sources/${sourceId}/stop`, hash(stop));
    expect(repository.get(sourceId)?.source).toMatchObject({ collection_onboarding_status: "stopped", enabled: false, source_stop_status: "manual" });
    const resume = mutation(6, repository, sourceId);
    const resumed = repository.activate(resume, "POST", `/api/admin/sources/${sourceId}/activate`, hash(resume));
    expect(resumed.business_operation_id).toBe(activation.business_operation_id);
    expect(repository.businessCounts().outbox_job).toBe(1);
    repository.runActivationWorker("success");
    const stopAgain = mutation(7, repository, sourceId, { stop_reason: "manual" });
    repository.stop(stopAgain, "POST", `/api/admin/sources/${sourceId}/stop`, hash(stopAgain));
    const retire = mutation(8, repository, sourceId);
    repository.retire(retire, "POST", `/api/admin/sources/${sourceId}/retire`, hash(retire));
    expect(repository.get(sourceId)?.source.lifecycle_status).toBe("retired");
    expect(repository.getOperation(retire.command_operation_id)?.operation_type).toBe("source_retire");
    expect((database.prepare("SELECT DISTINCT operation_type FROM outbox_job").all() as Array<{ operation_type: string }>).map((row) => row.operation_type)).toEqual(["source_activation"]);
    closeDatabase(database);
  });

  it("fails stale mutations closed and requeues a dead letter without a second business fact", () => {
    const { database } = fixture();
    const repository = new SourceManagementRepository(database, config(), appRoot, projectRoot, deterministicClock(), deterministicBytes());
    const add = addCommand(10, "dead-letter");
    const sourceId = repository.add(add, "POST", "/api/admin/sources", hash(add)).source_id;
    const stale = mutation(11, repository, sourceId);
    repository.validate(stale, "POST", `/api/admin/sources/${sourceId}/validate`, hash(stale));
    expectReason(() => repository.validate({ ...stale, ...commandIdentity(12) }, "POST", `/api/admin/sources/${sourceId}/validate`, hash({ ...stale, ...commandIdentity(12) })), "ADMIN_SOURCE_STALE");
    const activate = mutation(13, repository, sourceId);
    const activated = repository.activate(activate, "POST", `/api/admin/sources/${sourceId}/activate`, hash(activate));
    repository.runActivationWorker("MOCK_TIMEOUT");
    repository.runActivationWorker("MOCK_TIMEOUT");
    repository.runActivationWorker("MOCK_TIMEOUT");
    expect(repository.get(sourceId)?.source.collection_onboarding_status).toBe("dead_letter");
    expect(repository.businessCounts()).toMatchObject({ outbox_job: 1, task_attempt: 3, dead_letter: 1 });
    const requeue = mutation(14, repository, sourceId);
    const receipt = repository.requeue(requeue, "POST", `/api/admin/sources/${sourceId}/requeue`, hash(requeue));
    expect(receipt.business_operation_id).toBe(activated.business_operation_id);
    expect(repository.businessCounts().outbox_job).toBe(1);
    expect((database.prepare("SELECT retry_generation FROM outbox_job").get() as { retry_generation: number }).retry_generation).toBe(1);
    closeDatabase(database);
  });

  it("keeps same identity, truncated identity collision and canonical conflict distinct", () => {
    const { database } = fixture();
    const collisionIdentity = (platform: string, rawUrl: string) => ({
      sourceId: platform === "x" ? "src-local-aaaaaaaaaaaaaaaaaaaaaaaa" : "src-local-bbbbbbbbbbbbbbbbbbbbbbbb",
      fullIdentityHash: createHash("sha256").update(`${platform}\0${rawUrl}`).digest("hex")
    });
    const repository = new SourceManagementRepository(database, config(), appRoot, projectRoot, deterministicClock(), deterministicBytes(), collisionIdentity);
    const first = addCommand(20, "collision-a");
    repository.add(first, "POST", "/api/admin/sources", hash(first));
    const before = repository.businessCounts();
    const same = { ...first, ...commandIdentity(21) };
    expectReason(() => repository.add(same, "POST", "/api/admin/sources", hash(same)), "ADMIN_SOURCE_ALREADY_PROPOSED");
    const collision = addCommand(22, "collision-b");
    expectReason(() => repository.add(collision, "POST", "/api/admin/sources", hash(collision)), "ADMIN_SOURCE_ID_COLLISION");
    const canonicalConflict = { ...addCommand(23, "unused"), platform: "website", raw_url: first.raw_url };
    expectReason(() => repository.add(canonicalConflict, "POST", "/api/admin/sources", hash(canonicalConflict)), "ADMIN_SOURCE_CANONICAL_CONFLICT");
    expect(repository.businessCounts()).toEqual(before);
    closeDatabase(database);
  });

  it("enforces raw authority, one session, one-use CSRF and exact identity codecs", () => {
    assertCommandIdentity({ command_operation_id: IDENTITY_TEST_VECTORS.commandOperation, command_idempotency_key: IDENTITY_TEST_VECTORS.commandKey });
    assertBusinessIdentity({
      businessOperationId: IDENTITY_TEST_VECTORS.businessOperation,
      businessIdempotencyKey: IDENTITY_TEST_VECTORS.businessKey,
      jobId: IDENTITY_TEST_VECTORS.jobId,
      taskId: IDENTITY_TEST_VECTORS.taskId
    });
    assertLiveLease(IDENTITY_TEST_VECTORS.liveLease);
    expect(() => generateBusinessIdentity(() => true, () => Buffer.alloc(32, 1))).toThrow("ADMIN_BUSINESS_IDENTITY_GENERATION_FAILED");
    expect(() => generateLiveLease(() => true, () => Buffer.alloc(16, 1))).toThrow("ADMIN_LEASE_IDENTITY_GENERATION_FAILED");

    let now = 1_000;
    let random = 1;
    const sessions = new AdminSessionStore(() => now, (size) => Buffer.alloc(size, random++));
    const created = sessions.create(null);
    const setCookie = created.setCookie ?? "";
    const cookie = setCookie.split(";")[0];
    expect(created.status).toBe(201);
    expect(setCookie).toContain("HttpOnly; SameSite=Strict; Path=/");
    expect(() => sessions.create(null)).toThrow("ADMIN_SESSION_ALREADY_ACTIVE");
    const body = canonicalJson({ value: "synthetic" });
    const binding = { method: "POST", path: "/api/admin/sources", bodyHash: canonicalBodyHash(JSON.parse(body), body) };
    const issued = sessions.issueCsrf(cookie, { body_sha256: binding.bodyHash, method: binding.method, path: binding.path }, new Set([binding.path]));
    sessions.consumeCsrf(cookie, issued.csrf_token, binding);
    expect(() => sessions.consumeCsrf(cookie, issued.csrf_token, binding)).toThrow("ADMIN_CSRF_REPLAY");
    now += 1;
    const refreshBody = canonicalJson({});
    const refreshBinding = { method: "POST", path: "/api/admin/session/refresh", bodyHash: canonicalBodyHash({}, refreshBody) };
    const refreshCsrf = sessions.issueCsrf(cookie, { body_sha256: refreshBinding.bodyHash, method: refreshBinding.method, path: refreshBinding.path }, new Set([refreshBinding.path]));
    sessions.consumeCsrf(cookie, refreshCsrf.csrf_token, refreshBinding);
    const refreshed = sessions.refresh(cookie).setCookie.split(";")[0];
    expect(() => sessions.get(cookie)).toThrow("ADMIN_SESSION_REQUIRED");
    expect(sessions.get(refreshed).state).toBe("active");

    const valid = {
      rawHeaders: ["Host", "127.0.0.1:3019", "Origin", "http://127.0.0.1:3019"],
      socket: { remoteAddress: "127.0.0.1" },
      url: "/api/admin/session",
      method: "POST",
      httpVersion: "1.1"
    };
    expect(assertRawAdminRequest(valid as never, "http://127.0.0.1:3019", true).peer).toBe("loopback");
    for (const candidate of [
      { ...valid, rawHeaders: ["Host", "127.0.0.1:3019", "Host", "127.0.0.1:3019", "Origin", "http://127.0.0.1:3019"], reason: "ADMIN_HOST_DENIED" },
      { ...valid, rawHeaders: ["Host", "127.0.0.1:3019", "Origin", "http://localhost:3019"], reason: "ADMIN_ORIGIN_DENIED" },
      { ...valid, rawHeaders: ["Host", "127.0.0.1:3019", "Origin", "http://127.0.0.1:3019", "X-Forwarded-For", "127.0.0.1"], reason: "ADMIN_PROXY_HEADER_DENIED" },
      { ...valid, socket: { remoteAddress: "192.0.2.1" }, reason: "ADMIN_PEER_DENIED" },
      { ...valid, url: "http://127.0.0.1:3019/api/admin/session", reason: "ADMIN_HOST_DENIED" }
    ]) expectReason(() => assertRawAdminRequest(candidate as never, "http://127.0.0.1:3019", true), candidate.reason);
  });
});
