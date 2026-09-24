import { createHash, randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";

import { openReviewAdminDatabase } from "../server/admin-service/runtime.ts";
import { BilingualAdminRepository } from "../server/admin-service/bilingual-admin.ts";
import { inspectExistingPrivateDatabase } from "../server/db/database.ts";
import { canonicalJson } from "../server/db/profile.ts";
import { getInstalledSqliteAuthorizer } from "../server/internal-operation/authorizer.ts";
import { type OwnerSupervisorHandoff } from "../server/internal-operation/gateway.ts";
import { persistOwnerSupervisorHandoff } from "../server/internal-operation/owner-supervisor.ts";
import { SOURCE_REGISTRY_SCHEMA10_SHA256, sourceRegistrySchemaFingerprint } from "../server/rss/source-registry-migration.ts";
import { RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 } from "../server/rss-automatic/source-epoch-schema-identity.ts";
import { applyXPageAdmissionMigration } from "../server/x-page/admission-migration.ts";
import { X_PAGE_ADMISSION_SCHEMA_SHA256 } from "../server/x-page/admission-schema-identity.ts";
import { X_PAGE_HANDLES } from "../server/x-page/normalize.ts";
import { rssSourceEpochFixture } from "./helpers/rss-source-epoch.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");
const BASENAME = "f1plus1-rss-real-private.sqlite", ZERO = "0".repeat(64);
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
type Row = Record<string, unknown>;
type Opened = ReturnType<typeof openReviewAdminDatabase>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

// Only fixture construction can bypass transition guards. The actual opener,
// manual submission and source mutation assertions use installed authorizers.
async function fixture(successor: boolean, corrupt?: (database: DatabaseSync) => void) {
  const env = await rssSourceEpochFixture(); cleanup.push(env.close);
  env.gateway.close();
  env.fixtureMutation((database) => database.exec("UPDATE internal_control SET phase='disabled',global_stop_state='stopped',recovery_state='fenced'"));
  if (successor) applyXPageAdmissionMigration(env.database, { applyEnabled: true, appliedAt: env.now().toISOString() });
  if (corrupt) env.fixtureMutation(corrupt);
  const handoffs: OwnerSupervisorHandoff[] = [];
  for (let n = 0; n < 6; n++) {
    const id = `opener-${randomUUID()}`, now = Date.now();
    const handoff: OwnerSupervisorHandoff = {
      handoffId: id, ownerProcess: "admin_http", issuer: "f1plus1-owner-supervisor-v1",
      oneTimeNonce: createHash("sha256").update(id).digest("base64url"), releaseSha256: ZERO, manifestSha256: ZERO,
      receiptSha256: hash(id), verifiedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString()
    };
    persistOwnerSupervisorHandoff(env.database, handoff, () => true); handoffs.push(handoff);
  }
  const path = join(env.root, BASENAME); await backup(env.database, path); chmodSync(path, 0o600);
  const input: Parameters<typeof openReviewAdminDatabase>[0] = {
    targetReleaseAppRoot: APP_ROOT, reviewDatabasePath: path,
    reviewDatabaseIdentity: inspectExistingPrivateDatabase(path, BASENAME), requiredSchemaVersion: 10,
    requiredSchemaSha256: successor ? X_PAGE_ADMISSION_SCHEMA_SHA256 : RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256,
    gatewayReleaseSha256: ZERO, gatewayManifestSha256: ZERO,
    ownerSupervisorHandoffProvider: () => { const handoff = handoffs.shift(); if (!handoff) throw new Error("SYNTHETIC_HANDOFF_EXHAUSTED"); return handoff; }
  };
  const open = (overrides: Partial<typeof input> = {}) => {
    const opened = openReviewAdminDatabase({ ...input, ...overrides }); let closed = false;
    const close = () => { if (!closed) { closed = true; opened.gateway?.close(); opened.database.close(); } };
    cleanup.push(close); return { ...opened, close };
  };
  return { ...env, input, open, path };
}

function manualSnapshot(opened: Opened) {
  return canonicalJson(["x_manual_submission", "x_manual_operation", "x_manual_audit", "internal_operation", "owner_authorization_handoff"].map((table) => ({
    table, rows: opened.database.prepare(`SELECT * FROM ${table}`).all()
  })));
}

describe("exact 0017 real Admin opener compatibility", () => {
  test("opens the real repository chain with 27 page sources and 32 remaining manual sources", async () => {
    const env = await fixture(true), opened = env.open(), manual = opened.xManualRepository!;
    expect(opened.gateway).not.toBeNull(); expect(opened.mutationPort).not.toBeNull();
    expect(getInstalledSqliteAuthorizer(opened.database)).not.toBeNull();
    expect(sourceRegistrySchemaFingerprint(opened.database)).toBe(X_PAGE_ADMISSION_SCHEMA_SHA256);
    expect(manual.listSources()).toHaveLength(32); expect(manual.snapshot().sourceCount).toBe(32);
    for (const handle of X_PAGE_HANDLES) expect(manual.readSource(`x_${handle}`)).toBeNull();
    const admin = new BilingualAdminRepository(opened.database);
    const sources = admin.sources();
    expect(sources.xManualDisabled).toBe(32);
    expect((sources.items as Array<{ sourceKind: string }>).filter((row) => row.sourceKind === "x_page")).toHaveLength(27);
    expect(admin.sourceDetail("x_f1")).toHaveProperty("schemaVersion", "admin-source-registry-v1");
    expect(() => opened.database.exec("UPDATE source_registry_v1 SET enabled=1 WHERE source_id='x_f1'")).toThrow();
  });

  test("all 27 selected accounts reject manual URLs before any mutation or handoff use", async () => {
    const env = await fixture(true), opened = env.open(), before = manualSnapshot(opened);
    for (const handle of X_PAGE_HANDLES) {
      expect(() => opened.xManualRepository!.submitManualStatusUrl({ submittedUrl: `https://x.com/${handle.toUpperCase()}/status/1900000000000000001`, nowIso: new Date().toISOString() })).toThrow("X_MANUAL_URL_REJECTED");
      for (const action of ["enable", "requeue"] as const) expect(() => opened.mutationPort!.mutateSourceRegistry({
        operationId: `manual-bypass-${action}-${handle}`, action, sourceId: `x_${handle}`, expectedRevision: 2, reasonCode: "OPERATOR_REQUEST"
      })).toThrow("X_PAGE_TRUSTED_READMISSION_REQUIRED");
    }
    expect(manualSnapshot(opened)).toBe(before);
  });

  test("remaining manual accounts still submit, deduplicate and retire through the real Admin gateway", async () => {
    const env = await fixture(true), opened = env.open(), manual = opened.xManualRepository!, source = manual.listSources()[0];
    const request = { submittedUrl: `https://x.com/${source.handle}/status/1900000000000000002`, nowIso: new Date().toISOString() };
    const submitted = manual.submitManualStatusUrl(request);
    expect(submitted).toMatchObject({ duplicate: false, externalCalls: 0, automaticReview: false, automaticPublish: false, submission: { sourceId: source.sourceId, state: "submitted" } });
    expect(manual.submitManualStatusUrl(request)).toMatchObject({ duplicate: true, submission: { submissionId: submitted.submission.submissionId } });
    expect(manual.retireManualStatus({ submissionId: submitted.submission.submissionId, expectedRevision: submitted.submission.revision, nowIso: new Date().toISOString() })).toMatchObject({ state: "retired", revision: submitted.submission.revision + 1 });
    expect(opened.database.prepare("SELECT count(*) AS n FROM internal_external_attempt").get()!.n).toBe(0);
    expect(opened.database.prepare("SELECT state FROM internal_operation WHERE owner_process='admin_http'").all()).toEqual([{ state: "succeeded" }, { state: "succeeded" }]);
  });

  test("unmigrated ae757 opens with all 59 manual sources and retains F1 submission behavior", async () => {
    const env = await fixture(false), opened = env.open(), manual = opened.xManualRepository!;
    expect(sourceRegistrySchemaFingerprint(opened.database)).toBe(RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256);
    expect(manual.listSources()).toHaveLength(59); expect(manual.snapshot().sourceCount).toBe(59);
    expect(manual.submitManualStatusUrl({ submittedUrl: "https://x.com/f1/status/1900000000000000003", nowIso: new Date().toISOString() })).toMatchObject({ duplicate: false, submission: { sourceId: "x_f1" } });
  });

  test("historical selected-source submissions survive migration but cannot re-enter the manual submit path", async () => {
    const env = await fixture(false), legacy = env.open();
    const request = { submittedUrl: "https://x.com/f1/status/1900000000000000004", nowIso: new Date().toISOString() };
    const old = legacy.xManualRepository!.submitManualStatusUrl(request); legacy.close();
    const offline = new DatabaseSync(env.path);
    try {
      offline.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");
      applyXPageAdmissionMigration(offline, { applyEnabled: true, appliedAt: new Date().toISOString() });
    } finally { offline.close(); }
    const opened = env.open({ requiredSchemaSha256: X_PAGE_ADMISSION_SCHEMA_SHA256 }), before = manualSnapshot(opened);
    expect(opened.xManualRepository!.readSubmission(old.submission.submissionId)).toEqual(old.submission);
    expect(() => opened.xManualRepository!.submitManualStatusUrl(request)).toThrow("X_MANUAL_URL_REJECTED");
    expect(manualSnapshot(opened)).toBe(before);
    expect(opened.xManualRepository!.retireManualStatus({ submissionId: old.submission.submissionId, expectedRevision: old.submission.revision, nowIso: new Date().toISOString() }).state).toBe("retired");
  });

  test("requires the exact release identity in both directions", async () => {
    const current = await fixture(true), old = await fixture(false);
    expect(() => current.open({ requiredSchemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256 })).toThrow("ADMIN_REVIEW_SCHEMA_IDENTITY_INVALID");
    expect(() => current.open({ requiredSchemaSha256: RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 })).toThrow("ADMIN_REVIEW_SCHEMA_IDENTITY_INVALID");
    expect(() => old.open({ requiredSchemaSha256: X_PAGE_ADMISSION_SCHEMA_SHA256 })).toThrow("ADMIN_REVIEW_SCHEMA_IDENTITY_INVALID");
  });

  test.each([
    ["selected source retyped", "UPDATE source_registry_v1 SET source_kind='x_manual',collection_mode='manual_url' WHERE source_id='x_f1'"],
    ["selected source URL changed", "UPDATE source_registry_v1 SET site_url='https://x.com/forged_source' WHERE source_id='x_f1'"],
    ["manual source handle changed", "UPDATE source_registry_v1 SET display_name='forged_handle' WHERE source_id=(SELECT source_id FROM source_registry_v1 WHERE source_kind='x_manual' LIMIT 1)"],
    ["selected identity substituted", "UPDATE source_registry_v1 SET identity_sha256='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE source_id='x_f1'"]
  ])("rejects inventory drift without a physical schema change: %s", async (_label, sql) => {
    const env = await fixture(true, (database) => database.exec(sql));
    expect(sourceRegistrySchemaFingerprint(env.database)).toBe(X_PAGE_ADMISSION_SCHEMA_SHA256);
    expect(() => env.open()).toThrow("SQLITE_FAILURE");
  });

  test("the fixed SQL selection rejects retyping a remaining manual source even during offline fixture construction", async () => {
    const env = await fixture(true, (database) => {
      expect(() => database.exec("UPDATE source_registry_v1 SET source_kind='x_page',collection_mode='browser_visible_dom' WHERE source_id=(SELECT source_id FROM source_registry_v1 WHERE source_kind='x_manual' LIMIT 1)")).toThrow("CHECK constraint failed");
    });
    expect(env.open().xManualRepository!.listSources()).toHaveLength(32);
  });

  test("rejects an extra manual source even with an unchanged physical fingerprint", async () => {
    const env = await fixture(true, (database) => {
      const original = database.prepare("SELECT * FROM source_registry_v1 WHERE source_kind='x_manual' LIMIT 1").get() as Row;
      const row = { ...original, source_id: "x_extra_source", display_name: "extra_source", site_url: "https://x.com/extra_source", identity_sha256: hash("extra source") };
      database.prepare(`INSERT INTO source_registry_v1(${Object.keys(row).map((name) => `"${name}"`).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row) as Array<string | number | null>);
    });
    expect(sourceRegistrySchemaFingerprint(env.database)).toBe(X_PAGE_ADMISSION_SCHEMA_SHA256);
    expect(() => env.open()).toThrow("SQLITE_FAILURE");
  });

  test("rejects physical drift and admission identity drift through the actual opener", async () => {
    const physical = await fixture(true, (database) => database.exec("CREATE INDEX synthetic_opener_drift ON x_page_producer_receipt_v1(accepted_at)"));
    expect(() => physical.open()).toThrow("SCHEMA10_DRIFT");
    const identity = await fixture(true, (database) => database.exec("UPDATE x_page_admission_identity_v1 SET selection_sha256='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'"));
    expect(() => identity.open()).toThrow("X_PAGE_ADMISSION_IDENTITY_DRIFT");
  });
});
