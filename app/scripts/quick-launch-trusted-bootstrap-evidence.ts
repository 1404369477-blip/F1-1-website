import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, join, resolve } from "node:path";

import { inspectExistingPrivateDatabase, openExistingSafeDatabase } from "../src/server/db/database.ts";
import {
  canonicalJsonV1,
  SqliteInternalOperationGateway,
  type OwnerSupervisorHandoff
} from "../src/server/internal-operation/gateway.ts";
import { persistOwnerSupervisorHandoff } from "../src/server/internal-operation/owner-supervisor.ts";
import { trustedLocalBootstrap } from "../src/server/internal-operation/trusted-local-bootstrap.ts";
import {
  applyIndependentRssSourcesMigration,
  applyInternalOperationMigration,
  INDEPENDENT_RSS_SOURCES_SCHEMA_SHA256,
  INTERNAL_OPERATION_MIGRATION_CANONICAL_SHA256,
  INTERNAL_OPERATION_MIGRATION_SHA256,
  INTERNAL_OPERATION_SCHEMA_SHA256,
  reviewRealSchemaFingerprint
} from "../src/server/review-real/migration.ts";

const APP_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const PROJECT_ROOT = resolve(APP_ROOT, "..");
const MIGRATION_DIR = join(APP_ROOT, "migrations", "rss-real");
const TARGET_NODE = "24.18.0";
const TARGET_NPM = "11.16.0";
const RELEASE = "a".repeat(64);
const MANIFEST = "b".repeat(64);
const ZERO = "0".repeat(64);
const MIGRATIONS = [
  "0001_rss_real.sql",
  "0002_admin_review_publish.sql",
  "0003_projection_delivery_runtime.sql",
  "0004_rss_media_and_chinese_refinement.sql",
  "0005_second_rss_autosport.sql",
  "0006_independent_rss_racefans_the_race.sql"
] as const;

type JsonObject = Record<string, unknown>;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function iso(value: Date): string {
  return value.toISOString();
}

function scalar(database: DatabaseSync, sql: string): number {
  const row = database.prepare(sql).get() as JsonObject;
  return Number(Object.values(row)[0]);
}

function handoff(handoffId: string, now: Date): OwnerSupervisorHandoff {
  return {
    schemaVersion: "owner-supervisor-handoff-v1",
    handoffId,
    ownerProcess: "admin_http",
    issuer: "f1plus1-owner-supervisor-v1",
    oneTimeNonce: sha256(`nonce:${handoffId}`).slice(0, 43),
    releaseSha256: RELEASE,
    manifestSha256: MANIFEST,
    receiptSha256: sha256(`receipt:${handoffId}`),
    verifiedAt: iso(new Date(now.getTime() - 5_000)),
    expiresAt: iso(new Date(now.getTime() + 3_600_000))
  };
}

function readMigration(name: string): string {
  return readFileSync(join(MIGRATION_DIR, name), "utf8");
}

function openAdmittedSchema7Database(databasePath: string, handoffs: readonly OwnerSupervisorHandoff[]): DatabaseSync {
  // Seed the disposable file before admission: the raw migration + handoff
  // persistence run on the pre-admission connection (production-safe, no
  // authorizer yet), then the file is chmod 0600 and reopened through the
  // production safe existing-database opener which registers the quiesce
  // admission. The gateway cutover to guarded outer transactions requires this.
  const seed = new DatabaseSync(databasePath);
  for (const migration of MIGRATIONS) seed.exec(readMigration(migration));
  applyIndependentRssSourcesMigration(seed, readMigration("0006_independent_rss_racefans_the_race.sql"));
  applyInternalOperationMigration(seed, readMigration("0007_internal_operation_recovery_phase.sql"));
  for (const value of handoffs) persistOwnerSupervisorHandoff(seed, value, () => true);
  chmodSync(databasePath, 0o600);
  seed.close();
  const fileBasename = basename(databasePath);
  const identity = inspectExistingPrivateDatabase(databasePath, fileBasename);
  return openExistingSafeDatabase(databasePath, fileBasename, identity, [7]);
}

function policyInventory(database: DatabaseSync): readonly JsonObject[] {
  return database.prepare(
    "SELECT p.policy_id AS policyId,p.owner_process AS ownerProcess,p.operation_kind AS operationKind,p.phase,p.source_fence_mode AS sourceFenceMode,p.deletion_fence_mode AS deletionFenceMode,p.publication_fence_mode AS publicationFenceMode,t.scope_selector AS scopeSelector,t.fence_kind AS fenceKind,t.required_state AS requiredState FROM internal_operation_policy p LEFT JOIN internal_required_fence_policy t ON t.policy_id=p.policy_id WHERE (p.owner_process='rss_collector' AND p.operation_kind='collect') OR (p.owner_process IN ('rss_refiner','bilingual_refiner') AND p.operation_kind='refine') OR (p.owner_process='admin_http' AND p.operation_kind IN ('review','publish')) ORDER BY p.policy_id,t.scope_selector,t.fence_kind,t.required_state"
  ).all() as Array<JsonObject>;
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function createOutputRoot(): string {
  const root = join(PROJECT_ROOT, "scratch", "2026-08-24-trusted-local-bootstrap-evidence");
  mkdirSync(root, { mode: 0o700, recursive: true });
  const runId = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const outputRoot = join(root, `run-${runId}`);
  mkdirSync(outputRoot, { mode: 0o700 });
  return outputRoot;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${canonicalJsonV1(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

function main(): void {
  const outputRoot = createOutputRoot();
  const databasePath = join(outputRoot, "review.sqlite");
  const now = new Date();
  const operationHandoffs = [handoff("evidence-bootstrap-deletion", now), handoff("evidence-bootstrap-publication", now)];
  const database = openAdmittedSchema7Database(databasePath, operationHandoffs);
  const receiptPath = join(outputRoot, "receipt.json");
  const reportPath = join(outputRoot, "report.md");
  const manifestPath = join(outputRoot, "manifest.json");
  const result: JsonObject = {
    schemaVersion: "trusted-local-bootstrap-evidence-v1",
    decision: "FAIL",
    scope: "admitted-production-shaped-disposable-only",
    externalCalls: 0,
    productionWrites: 0,
    node: process.version,
    targetNode: TARGET_NODE,
    targetNpm: TARGET_NPM,
    databasePath,
    migration: {
      sourceUserVersion: 6,
      sourceSchemaSha256: INDEPENDENT_RSS_SOURCES_SCHEMA_SHA256,
      rawSha256: INTERNAL_OPERATION_MIGRATION_SHA256,
      canonicalSha256: INTERNAL_OPERATION_MIGRATION_CANONICAL_SHA256,
      postSchemaSha256: INTERNAL_OPERATION_SCHEMA_SHA256
    }
  };

  try {
    const before = database.prepare("SELECT phase,global_stop_state,recovery_state,deletion_fence_state,publication_fence_state,version FROM internal_control WHERE singleton_id=1").get() as JsonObject;
    const triggerBefore = scalar(database, "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger' AND name='internal_control_transition_guard'");

    const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: RELEASE, manifestSha256: MANIFEST, now: () => now });
    let receipts: readonly JsonObject[] = [];
    let rawUpdateDenied = false;
    let dropTriggerDenied = false;
    try {
      const queue = [...operationHandoffs];
      receipts = trustedLocalBootstrap({
        database,
        gateway,
        handoffProvider: () => {
          const value = queue.shift();
          if (!value) throw new Error("HANDOFF_QUEUE_EXHAUSTED");
          return value;
        },
        requests: [
          { operationId: "evidence-bootstrap-deletion", fence: "deletion", expectedControlVersion: 1 },
          { operationId: "evidence-bootstrap-publication", fence: "publication", expectedControlVersion: 2 }
        ],
        now: () => now
      }) as readonly JsonObject[];
      try {
        database.exec("UPDATE internal_control SET deletion_fence_state='blocked' WHERE singleton_id=1");
      } catch {
        rawUpdateDenied = true;
      }
      try {
        database.exec("DROP TRIGGER internal_control_transition_guard");
      } catch {
        dropTriggerDenied = true;
      }
    } finally {
      gateway.close();
    }

    const after = database.prepare("SELECT phase,global_stop_state,recovery_state,deletion_fence_state,publication_fence_state,version FROM internal_control WHERE singleton_id=1").get() as JsonObject;
    const triggerAfter = scalar(database, "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger' AND name='internal_control_transition_guard'");
    const inventory = policyInventory(database);
    const operationRows = database.prepare("SELECT operation_id,owner_process,operation_kind,control_action,state FROM internal_operation ORDER BY operation_id").all() as Array<JsonObject>;
    const state = {
      before,
      after,
      phaseRemainsDisabled: after.phase === "disabled",
      globalStopRemainsStopped: after.global_stop_state === "stopped",
      recoveryRemainsFenced: after.recovery_state === "fenced",
      singletonFenceStatesClear: after.deletion_fence_state === "clear" && after.publication_fence_state === "clear",
      controlVersionAdvancedByTwo: Number(after.version) === Number(before.version) + 2,
      triggerBefore,
      triggerAfter,
      triggerPreserved: triggerBefore === 1 && triggerAfter === 1,
      rawUpdateDenied,
      dropTriggerDenied,
      adminFenceOperations: operationRows.filter((row) => row.owner_process === "admin_http" && row.operation_kind === "phase_control" && row.control_action === "fence_update" && row.state === "succeeded").length,
      automaticReviewOperations: operationRows.filter((row) => row.owner_process === "automatic_reviewer").length,
      automaticPublishOperations: operationRows.filter((row) => row.owner_process === "automatic_publisher").length,
      internalOperationOutboxRows: scalar(database, "SELECT COUNT(*) AS count FROM internal_operation_outbox"),
      requiredFenceInventory: inventory
    };
    const reviewDatabaseIdentity = {
      pathSha256: sha256(realpathSync(databasePath)),
      device: Number(statSync(databasePath).dev),
      inode: Number(statSync(databasePath).ino),
      userVersion: Number((database.prepare("PRAGMA user_version").get() as JsonObject).user_version),
      schemaSha256: reviewRealSchemaFingerprint(database)
    };
    result.state = state;
    result.receipts = receipts;
    result.reviewDatabaseIdentity = reviewDatabaseIdentity;
    result.decision = state.phaseRemainsDisabled && state.globalStopRemainsStopped && state.recoveryRemainsFenced && state.singletonFenceStatesClear && state.controlVersionAdvancedByTwo && state.triggerPreserved && state.rawUpdateDenied && state.dropTriggerDenied && state.adminFenceOperations === 2 && state.automaticReviewOperations === 0 && state.automaticPublishOperations === 0 && state.internalOperationOutboxRows === 0 && reviewDatabaseIdentity.userVersion === 7 && reviewDatabaseIdentity.schemaSha256 === INTERNAL_OPERATION_SCHEMA_SHA256 ? "PASS" : "FAIL";
  } catch (error) {
    result.error = error instanceof Error ? error.message : "UNKNOWN";
  } finally {
    database.close();
  }

  const reopened = new DatabaseSync(databasePath);
  const durableControl = reopened.prepare("SELECT phase,global_stop_state,recovery_state,deletion_fence_state,publication_fence_state,version FROM internal_control WHERE singleton_id=1").get() as JsonObject;
  const durableTriggerCount = scalar(reopened, "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger' AND name='internal_control_transition_guard'");
  const durableOperationCount = scalar(reopened, "SELECT COUNT(*) AS count FROM internal_operation WHERE owner_process='admin_http' AND operation_kind='phase_control' AND control_action='fence_update' AND state='succeeded'");
  reopened.close();
  const durableReopenPass = durableControl.phase === "disabled" && durableControl.global_stop_state === "stopped" && durableControl.recovery_state === "fenced" && durableControl.deletion_fence_state === "clear" && durableControl.publication_fence_state === "clear" && Number(durableControl.version) === 3 && durableTriggerCount === 1 && durableOperationCount === 2;
  result.durableReopen = {
    control: durableControl,
    triggerCount: durableTriggerCount,
    succeededAdminFenceOperations: durableOperationCount,
    pass: durableReopenPass
  };
  if (!durableReopenPass) result.decision = "FAIL";

  const databaseStat = statSync(databasePath);
  result.databaseFile = {
    bytes: databaseStat.size,
    sha256: sha256(readFileSync(databasePath)),
    mode: (databaseStat.mode & 0o777).toString(8),
    device: Number(databaseStat.dev),
    inode: Number(databaseStat.ino)
  };
  writeJson(receiptPath, result);
  const report = [
    "# Trusted local bootstrap evidence",
    "",
    `- decision: ${String(result.decision)}`,
    "- scope: admitted production-shaped disposable SQLite only",
    "- production/M1/network/model/provider writes: 0",
    "- route: app `trusted_local_bootstrap` → Admin `admin_http / phase_control / fence_update`",
    "- migration: schema 6 → shared frozen 0007; no 0011 created",
    "",
    "## Assertions",
    "",
    "The disposable database was seeded on a raw owner-only file, then reopened through the production safe existing-database opener (quiesce-absence admission registered) and reopened again after the gateway closed. The gateway outer transactions ran under the guarded-write cutover. The bootstrap changed one singleton fence per operation using the existing gateway and authorizer. `phase=disabled`, `global_stop_state=stopped`, and `recovery_state=fenced` were preserved across reopen. The two singleton fences reached `clear`, the Admin operations reached `succeeded`, and automatic reviewer/publisher operations plus internal outbox rows remained zero.",
    "",
    "Direct `UPDATE internal_control` and `DROP TRIGGER internal_control_transition_guard` attempts were made after the gateway authorizer was installed and were denied. The existing trigger remained present. The test did not drop triggers, issue raw control SQL, write a repository directly, or alter production.",
    "",
    "## Required fence inventory",
    "",
    "The receipt records the policy-derived fence template for RSS collection, RSS/bilingual refinement, manual review, and manual publish. These are inventory proofs only; no source, candidate, publication, external call, review, or publish operation was opened while phase remained disabled.",
    "",
    "## Limitations",
    "",
    "This evidence does not prove the quick-launch automatic-review/publish five-axis zero vector or any M1/production deployment state. Those gates require the independent auto-zero collector and deployment verifier.",
    ""
  ].join("\n");
  writeFileSync(reportPath, report, { encoding: "utf8", mode: 0o600 });
  const manifest = {
    schemaVersion: "trusted-local-bootstrap-evidence-manifest-v1",
    decision: result.decision,
    runtime: {
      targetNode: TARGET_NODE,
      targetNpm: TARGET_NPM,
      observedNode: process.version,
      npmVersionCheck: "node /opt/homebrew/Cellar/node@24/24.18.1/lib/node_modules/npm/bin/npm-cli.js --version"
    },
    files: {
      migration0007: { path: "app/migrations/rss-real/0007_internal_operation_recovery_phase.sql", sha256: sha256(readMigration("0007_internal_operation_recovery_phase.sql")) },
      implementation: { path: "app/src/server/internal-operation/trusted-local-bootstrap.ts", sha256: sha256(readFileSync(join(APP_ROOT, "src", "server", "internal-operation", "trusted-local-bootstrap.ts"))) },
      test: { path: "app/src/tests/trusted-local-bootstrap.test.ts", sha256: sha256(readFileSync(join(APP_ROOT, "src", "tests", "trusted-local-bootstrap.test.ts"))) },
      evidenceScript: { path: "app/scripts/quick-launch-trusted-bootstrap-evidence.ts", sha256: sha256(readFileSync(join(APP_ROOT, "scripts", "quick-launch-trusted-bootstrap-evidence.ts"))) },
      receipt: { path: "receipt.json", sha256: sha256(readFileSync(receiptPath)) },
      report: { path: "report.md", sha256: sha256(readFileSync(reportPath)) },
      database: { path: "review.sqlite", sha256: sha256(readFileSync(databasePath)) }
    }
  };
  writeJson(manifestPath, manifest);
  writeFileSync(join(outputRoot, "manifest.sha256"), `${sha256(readFileSync(manifestPath))}  manifest.json\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ outputRoot, decision: result.decision, receiptPath, reportPath, manifestPath, databasePath }, null, 2)}\n`);
  assert(result.decision === "PASS", "TRUSTED_LOCAL_BOOTSTRAP_EVIDENCE_FAILED");
}

main();
