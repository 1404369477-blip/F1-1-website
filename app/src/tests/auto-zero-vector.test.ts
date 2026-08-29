import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  assertAutoAutomationZeroVector,
  autoProcessIdentitySetSha256,
  collectAutoAutomationZeroVector,
  observeAutoProcessRecords,
  readAutoZeroMigrationManifest,
  scheduleInventorySha256,
  type AutoProcessIdentityAllowlistEntry,
  type AutoZeroScheduleInventory,
  type ReviewDatabaseIdentity
} from "../server/quick-launch/auto-zero-vector.ts";
import { applyInternalOperationMigration, reviewRealSchemaFingerprint } from "../server/review-real/migration.ts";
import { applyXManualInboxMigration } from "../server/tweet-inbox/repository.ts";
import { applyBilingualMigration, readBilingualMigrationSql } from "../server/rss/bilingual-migration.ts";
import { applySourceRegistryMigration, readSourceRegistryMigrationSql, sourceRegistrySchemaFingerprint } from "../server/rss/source-registry-migration.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const ZERO = "0".repeat(64);
const MIGRATION_INPUTS = [
  "0001_rss_real.sql",
  "0002_admin_review_publish.sql",
  "0003_projection_delivery_runtime.sql",
  "0004_rss_media_and_chinese_refinement.sql",
  "0005_second_rss_autosport.sql",
  "0006_independent_rss_racefans_the_race.sql",
  "0007_internal_operation_recovery_phase.sql",
  "0008_x_manual_inbox.sql",
  "0009_bilingual_refinement.sql",
  "0010_source_registry.sql"
] as const;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function trustedCurrentMigrationManifest(path: string): ReturnType<typeof readAutoZeroMigrationManifest> {
  const migrationInputs = MIGRATION_INPUTS.map((name, index) => {
    const relativePath = `migrations/rss-real/${name}`;
    return { userVersion: index + 1, path: relativePath, sha256: sha256(readFileSync(join(APP_ROOT, relativePath))) };
  });
  writeFileSync(path, JSON.stringify({ schemaVersion: "auto-zero-migration-manifest-v1", chain: "rss-real-schema10", migrationInputs }), { mode: 0o600 });
  return readAutoZeroMigrationManifest(path);
}

function migrationSql(manifest: ReturnType<typeof readAutoZeroMigrationManifest>, userVersion: number): string {
  const entry = manifest.migrationInputs.find((item) => item.userVersion === userVersion);
  if (entry === undefined) throw new Error(`missing migration ${userVersion}`);
  const sql = readFileSync(join(APP_ROOT, entry.path), "utf8");
  if (sha256(sql) !== entry.sha256) throw new Error(`migration hash drift ${userVersion}`);
  return sql;
}

function sourceRegistryManifest(): Parameters<typeof applySourceRegistryMigration>[2] {
  const common = {
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
  return {
    schemaVersion: "source-registry-migration-manifest-v1",
    migratedAt: "2026-08-25T00:00:00.000Z",
    rss: [
      { ...common, sourceId: "motorsport-f1-news", displayName: "Motorsport F1 News", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
      { ...common, sourceId: "autosport-f1-news", displayName: "Autosport F1 News", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
      { ...common, sourceId: "racefans-f1-news", displayName: "RaceFans F1 News", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
      { ...common, sourceId: "the-race-f1-news", displayName: "The Race F1 News", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" }
    ]
  };
}

function schema7Database(path: string, beforeMigration?: (database: DatabaseSync) => void): void {
  const root = dirname(path);
  const manifest = trustedCurrentMigrationManifest(join(root, "trusted-current-migration-manifest.json"));
  const database = new DatabaseSync(path);
  for (let version = 1; version <= 6; version += 1) database.exec(migrationSql(manifest, version));
  beforeMigration?.(database);
  database.close();
  const migrated = new DatabaseSync(path);
  applyInternalOperationMigration(migrated, migrationSql(manifest, 7));
  migrated.close();
}

function schema10Database(path: string, beforeMigration?: (database: DatabaseSync) => void): void {
  const root = dirname(path);
  const manifest = trustedCurrentMigrationManifest(join(root, "trusted-current-migration-manifest.json"));
  const database = new DatabaseSync(path);
  for (let version = 1; version <= 6; version += 1) database.exec(migrationSql(manifest, version));
  beforeMigration?.(database);
  applyInternalOperationMigration(database, migrationSql(manifest, 7));
  applyXManualInboxMigration(database, migrationSql(manifest, 8));
  applyBilingualMigration(database, readBilingualMigrationSql(), { applyEnabled: true });
  expect(sourceRegistrySchemaFingerprint(database)).toMatch(/^[0-9a-f]{64}$/u);
  const applied = applySourceRegistryMigration(database, readSourceRegistryMigrationSql(), sourceRegistryManifest(), { applyEnabled: true });
  expect(Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version)).toBe(10);
  database.close();
  const reopened = new DatabaseSync(path, { readOnly: true });
  try {
    expect(Number((reopened.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version)).toBe(10);
    expect(reviewRealSchemaFingerprint(reopened)).toBe(applied.schemaFingerprintSha256);
    expect(reopened.prepare("SELECT phase,global_stop_state,recovery_state FROM internal_control WHERE singleton_id=1").get()).toMatchObject({ phase: "disabled", global_stop_state: "stopped", recovery_state: "fenced" });
    expect(Number((reopened.prepare("SELECT count(*) AS count FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher')").get() as Record<string, unknown>).count)).toBe(0);
    expect(Number((reopened.prepare("SELECT count(*) AS count FROM internal_operation_outbox WHERE operation_id IN (SELECT operation_id FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher'))").get() as Record<string, unknown>).count)).toBe(0);
  } finally {
    reopened.close();
  }
}

function databaseIdentity(path: string): ReviewDatabaseIdentity {
  const stat = statSync(path);
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const userVersion = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
    return {
      pathSha256: sha256(path),
      device: Number(stat.dev),
      inode: Number(stat.ino),
      userVersion: userVersion as 10,
      schemaSha256: reviewRealSchemaFingerprint(database)
    };
  } finally {
    database.close();
  }
}

function input(databasePath: string, cutover: string, observedAt: string) {
  const processIdentityAllowlist: readonly AutoProcessIdentityAllowlistEntry[] = [
    { automation: "automatic_review", ownerProcess: "automatic_reviewer", executableRealpathSha256: sha256("review-realpath"), executableBytesSha256: sha256("review-bytes"), argvSha256: sha256("review-argv"), launchAgentLabel: "test.f1plus1.automatic-reviewer" },
    { automation: "automatic_publish", ownerProcess: "automatic_publisher", executableRealpathSha256: sha256("publish-realpath"), executableBytesSha256: sha256("publish-bytes"), argvSha256: sha256("publish-argv"), launchAgentLabel: "test.f1plus1.automatic-publisher" }
  ];
  const scheduleInventory: AutoZeroScheduleInventory = {
    schemaVersion: "auto-zero-schedule-inventory-v1",
    asOf: observedAt,
    releaseClosureSha256: sha256("release"),
    inspectedEntryCount: 6,
    scope: ["release_closure", "launchagent_directory", "plist_directory", "user_cron", "system_cron", "manifest_registry"].map((kind) => ({ kind, locatorSha256: sha256(kind) })) as AutoZeroScheduleInventory["scope"],
    findings: [],
    complete: true
  };
  return {
    releaseRoot: APP_ROOT,
    releasePaths: ["src/server/admin-service/runtime.ts"],
    quickLaunchCutoverAt: cutover,
    observedAt,
    releaseSha256: sha256("release"),
    manifestSha256: sha256("manifest"),
    autoProcessIdentitySetSha256: autoProcessIdentitySetSha256(processIdentityAllowlist),
    scheduleInventorySha256: scheduleInventorySha256(scheduleInventory),
    targetUid: process.getuid!(),
    reviewDatabasePath: databasePath,
    processIdentityAllowlist,
    scheduleInventory,
    expectedReviewDatabaseIdentity: databaseIdentity(databasePath),
    runtimeScheduleObservation: {
      observedAt,
      durationMs: 61_001,
      registeredSchedules: [],
      registrySealed: true as const,
      runtimeError: null
    }
  };
}

describe("AutoAutomationZeroVector", () => {
  test("emits the exact closed DTO with both review and publish five-axis zero", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-auto-zero-"));
    const path = join(root, "review.sqlite");
    try {
      schema10Database(path);
      const vector = collectAutoAutomationZeroVector(input(path, "2026-08-24T12:00:00.000Z", "2026-08-24T12:01:01.000Z"));
      assertAutoAutomationZeroVector(vector);
      expect(vector.state).toBe("pass");
      expect(vector.automaticReview.counts).toEqual({ activeProcessInstances: 0, registeredSchedules: 0, activeOwnerHandoffs: 0, prohibitedOperations: 0, prohibitedEffects: 0 });
      expect(vector.automaticPublish.counts).toEqual({ activeProcessInstances: 0, registeredSchedules: 0, activeOwnerHandoffs: 0, prohibitedOperations: 0, prohibitedEffects: 0 });
      expect(Object.keys(vector)).toEqual(["schemaVersion", "domain", "automaticReview", "automaticPublish", "state"]);
      expect(Object.keys(vector.automaticReview)).toEqual([
        "automation", "ownerProcess", "operationKind", "capabilityClass", "egressChannel", "producers",
        "legacyOperationIdPrefixes", "allowedSchema7OutboxKinds", "schema7OperationNonterminalStates",
        "schema7OperationTerminalStates", "legacyOperationTerminalStates", "counts", "evidence", "state"
      ]);
      expect(Object.keys(vector.automaticPublish)).toContain("schema7OutboxNonterminalStates");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails when the runtime observation has not crossed 61 seconds", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-auto-zero-short-"));
    const path = join(root, "review.sqlite");
    try {
      schema10Database(path);
      const value = input(path, "2026-08-24T12:00:00.000Z", "2026-08-24T12:00:30.000Z");
      const vector = collectAutoAutomationZeroVector({ ...value, runtimeScheduleObservation: { ...value.runtimeScheduleObservation, durationMs: 60_999 } });
      expect(vector.state).toBe("unknown");
      expect(vector.automaticReview.state).toBe("unknown");
      expect(vector.automaticPublish.state).toBe("unknown");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed for runtime errors or an unsealed scheduler registry", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-auto-zero-runtime-unknown-"));
    const path = join(root, "review.sqlite");
    try {
      schema10Database(path);
      const value = input(path, "2026-08-24T12:00:00.000Z", "2026-08-24T12:01:01.000Z");
      const runtime = value.runtimeScheduleObservation!;
      const runtimeError = collectAutoAutomationZeroVector({
        ...value,
        runtimeScheduleObservation: { ...runtime, runtimeError: "scheduler probe failed" }
      });
      expect(runtimeError.state).toBe("unknown");
      const unsealed = collectAutoAutomationZeroVector({
        ...value,
        runtimeScheduleObservation: { ...runtime, registrySealed: false }
      });
      expect(unsealed.state).toBe("unknown");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("preserves and excludes cutover-before terminal legacy history", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-auto-zero-positive-legacy-"));
    const path = join(root, "review.sqlite");
    try {
      schema10Database(path, (database) => {
        database.prepare("INSERT INTO admin_operation(operation_id,operation_type,http_method,request_path,request_hash,response_json,response_hash,http_status,operation_status,reason_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
          "auto-review-approve-history",
          "approve",
          "POST",
          "/api/admin/reviews/approve",
          ZERO,
          "{}",
          ZERO,
          200,
          "completed",
          null,
          "2026-08-23T12:00:00.000Z"
        );
      });
      const vector = collectAutoAutomationZeroVector(input(path, "2026-08-24T12:00:00.000Z", "2026-08-24T12:01:01.000Z"));
      expect(vector.state).toBe("pass");
      expect(vector.automaticReview.counts.prohibitedOperations).toBe(0);
      const database = new DatabaseSync(path);
      try {
        expect(database.prepare("SELECT COUNT(*) AS count FROM admin_operation WHERE operation_id='auto-review-approve-history'").get()).toMatchObject({ count: 1 });
      } finally {
        database.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("counts a post-cutover legacy automatic publish operation even when it is terminal", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-auto-zero-negative-"));
    const path = join(root, "review.sqlite");
    try {
      schema10Database(path, (database) => {
        database.prepare("INSERT INTO admin_operation(operation_id,operation_type,http_method,request_path,request_hash,response_json,response_hash,http_status,operation_status,reason_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
          "auto-publish-batch-negative",
          "publish",
          "POST",
          "/api/admin/reviews/publish",
          ZERO,
          "{}",
          ZERO,
          200,
          "completed",
          null,
          "2026-08-24T12:00:30.000Z"
        );
      });
      const vector = collectAutoAutomationZeroVector(input(path, "2026-08-24T12:00:00.000Z", "2026-08-24T12:01:01.000Z"));
      expect(vector.automaticPublish.counts.prohibitedOperations).toBe(1);
      expect(vector.automaticPublish.state).toBe("fail");
      expect(vector.state).toBe("fail");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed when a release source still registers an automatic review timer", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-auto-zero-static-negative-"));
    const path = join(root, "review.sqlite");
    try {
      schema10Database(path);
      writeFileSync(join(root, "runtime.ts"), "function automaticReviewTick() {}\nsetInterval(automaticReviewTick, 60000);\n", { mode: 0o600 });
      const value = input(path, "2026-08-24T12:00:00.000Z", "2026-08-24T12:01:01.000Z");
      const vector = collectAutoAutomationZeroVector({ ...value, releaseRoot: root, releasePaths: ["runtime.ts"] });
      expect(vector.automaticReview.counts.registeredSchedules).toBe(1);
      expect(vector.automaticReview.state).toBe("fail");
      expect(vector.automaticPublish.state).toBe("pass");
      expect(vector.state).toBe("fail");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("resolves callback aliases in the static call graph", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-auto-zero-alias-negative-"));
    const path = join(root, "review.sqlite");
    try {
      schema10Database(path);
      writeFileSync(join(root, "runtime.ts"), "function automaticReviewTick() {}\nconst tick = automaticReviewTick;\nsetInterval(tick, 60000);\n", { mode: 0o600 });
      const vector = collectAutoAutomationZeroVector({ ...input(path, "2026-08-24T12:00:00.000Z", "2026-08-24T12:01:01.000Z"), releaseRoot: root, releasePaths: ["runtime.ts"] });
      expect(vector.automaticReview.counts.registeredSchedules).toBe(1);
      expect(vector.automaticReview.state).toBe("fail");
      expect(vector.state).toBe("fail");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed when either manifest-bound hash is forged", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-auto-zero-forged-hash-"));
    const path = join(root, "review.sqlite");
    try {
      schema10Database(path);
      const value = input(path, "2026-08-24T12:00:00.000Z", "2026-08-24T12:01:01.000Z");
      expect(collectAutoAutomationZeroVector({ ...value, autoProcessIdentitySetSha256: sha256("forged-process") }).state).toBe("unknown");
      expect(collectAutoAutomationZeroVector({ ...value, scheduleInventorySha256: sha256("forged-schedule") }).state).toBe("unknown");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed for empty process allowlist or unscoped empty schedule evidence", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-auto-zero-empty-evidence-"));
    const path = join(root, "review.sqlite");
    try {
      schema10Database(path);
      const value = input(path, "2026-08-24T12:00:00.000Z", "2026-08-24T12:01:01.000Z");
      expect(collectAutoAutomationZeroVector({ ...value, processIdentityAllowlist: [] }).state).toBe("unknown");
      expect(collectAutoAutomationZeroVector({ ...value, scheduleInventory: [] as unknown as AutoZeroScheduleInventory }).state).toBe("unknown");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("schema7 can only produce UNKNOWN and the emitted DTO remains schema10-only", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-auto-zero-schema7-"));
    const path = join(root, "review.sqlite");
    try {
      schema7Database(path);
      const vector = collectAutoAutomationZeroVector(input(path, "2026-08-24T12:00:00.000Z", "2026-08-24T12:01:01.000Z"));
      expect(vector.state).toBe("unknown");
      expect(vector.domain.reviewDatabaseIdentity.userVersion).toBe(10);
      expect(() => assertAutoAutomationZeroVector(vector)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("same-UID observer classifies a stable process only by exact manifest identity", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "automatic-reviewer-marker"], { stdio: "ignore" });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", () => resolve());
        child.once("error", reject);
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const command = spawnSync("/bin/ps", ["-ww", "-p", String(child.pid), "-o", "command="], { encoding: "utf8" }).stdout.trim();
      const executable = realpathSync(spawnSync("/bin/ps", ["-p", String(child.pid), "-o", "comm="], { encoding: "utf8" }).stdout.trim());
      const allowlist: readonly AutoProcessIdentityAllowlistEntry[] = [
        { automation: "automatic_review", ownerProcess: "automatic_reviewer", executableRealpathSha256: sha256(executable), executableBytesSha256: sha256(readFileSync(executable)), argvSha256: sha256(command), launchAgentLabel: null },
        { automation: "automatic_publish", ownerProcess: "automatic_publisher", executableRealpathSha256: sha256("publish-realpath"), executableBytesSha256: sha256("publish-bytes"), argvSha256: sha256("publish-argv"), launchAgentLabel: "test.f1plus1.automatic-publisher" }
      ];
      const scan = observeAutoProcessRecords(process.getuid!(), allowlist);
      expect(scan.complete).toBe(true);
      expect(scan.records).toHaveLength(1);
      expect(scan.records[0]).toMatchObject({ pid: child.pid, automation: "automatic_review", ownerProcess: "automatic_reviewer", classification: "manifest_exact_auto_owner" });
      const forged = allowlist.map((entry) => entry.automation === "automatic_review" ? { ...entry, argvSha256: sha256("forged-argv") } : entry);
      const rejected = observeAutoProcessRecords(process.getuid!(), forged);
      expect(rejected.complete).toBe(false);
      expect(rejected.records).toHaveLength(0);
      expect(rejected.unknownReasons).toContain(`AUTO_ZERO_PROCESS_UNCLASSIFIED:${child.pid}`);
    } finally {
      child.kill("SIGTERM");
    }
  });

  test("returns unknown when the database snapshot cannot be opened", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-auto-zero-unknown-db-"));
    const path = join(root, "missing.sqlite");
    try {
      const databaseRoot = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-auto-zero-identity-"));
      const existing = join(databaseRoot, "existing.sqlite");
      try {
        schema10Database(existing);
        const value = input(existing, "2026-08-24T12:00:00.000Z", "2026-08-24T12:01:01.000Z");
        const vector = collectAutoAutomationZeroVector({ ...value, reviewDatabasePath: path });
        expect(vector.state).toBe("unknown");
        expect(vector.automaticReview.state).toBe("unknown");
        expect(() => assertAutoAutomationZeroVector(vector)).not.toThrow();
      } finally {
        rmSync(databaseRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
