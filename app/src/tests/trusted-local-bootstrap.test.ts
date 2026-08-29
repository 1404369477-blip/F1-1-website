import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, test } from "vitest";

import {
  SqliteInternalOperationGateway,
  type OwnerSupervisorHandoff
} from "../server/internal-operation/gateway.ts";
import { persistOwnerSupervisorHandoff } from "../server/internal-operation/owner-supervisor.ts";
import { trustedLocalBootstrap } from "../server/internal-operation/trusted-local-bootstrap.ts";
import {
  applyIndependentRssSourcesMigration,
  applyInternalOperationMigration
} from "../server/review-real/migration.ts";
import { openAdmittedReviewFixture, openAdmittedReviewDatabase, disposeAdmittedReviewDatabases } from "./helpers/admitted-review-database.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const ZERO = "0".repeat(64);
const RELEASE = "a".repeat(64);
const MANIFEST = "b".repeat(64);
const MIGRATIONS = [
  "0001_rss_real.sql",
  "0002_admin_review_publish.sql",
  "0003_projection_delivery_runtime.sql",
  "0004_rss_media_and_chinese_refinement.sql",
  "0005_second_rss_autosport.sql",
  "0006_independent_rss_racefans_the_race.sql"
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function timestamp(offsetSeconds: number): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

function handoff(handoffId: string): OwnerSupervisorHandoff {
  return {
    schemaVersion: "owner-supervisor-handoff-v1",
    handoffId,
    ownerProcess: "admin_http",
    issuer: "f1plus1-owner-supervisor-v1",
    oneTimeNonce: sha256(`nonce:${handoffId}`).slice(0, 43),
    releaseSha256: RELEASE,
    manifestSha256: MANIFEST,
    receiptSha256: sha256(`receipt:${handoffId}`),
    verifiedAt: timestamp(-5),
    expiresAt: timestamp(3600)
  };
}

function admittedSchema7(seed?: (database: DatabaseSync) => void): DatabaseSync {
  return openAdmittedReviewDatabase({
    finalVersion: 7,
    seed: (database: DatabaseSync) => {
      for (const migration of MIGRATIONS) {
        database.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${migration}`, "utf8"));
      }
      applyIndependentRssSourcesMigration(
        database,
        readFileSync(`${APP_ROOT}/migrations/rss-real/0006_independent_rss_racefans_the_race.sql`, "utf8")
      );
      applyInternalOperationMigration(
        database,
        readFileSync(`${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8")
      );
      seed?.(database);
    }
  });
}

function scalar(database: DatabaseSync, sql: string): number {
  const row = database.prepare(sql).get() as Record<string, unknown>;
  return Number(Object.values(row)[0]);
}

function requiredFenceInventory(database: DatabaseSync): readonly Record<string, unknown>[] {
  return database.prepare(
    "SELECT p.policy_id AS policyId,p.owner_process AS ownerProcess,p.operation_kind AS operationKind,p.phase,p.source_fence_mode AS sourceFenceMode,p.deletion_fence_mode AS deletionFenceMode,p.publication_fence_mode AS publicationFenceMode,t.scope_selector AS scopeSelector,t.fence_kind AS fenceKind,t.required_state AS requiredState FROM internal_operation_policy p LEFT JOIN internal_required_fence_policy t ON t.policy_id=p.policy_id WHERE (p.owner_process='rss_collector' AND p.operation_kind='collect') OR (p.owner_process IN ('rss_refiner','bilingual_refiner') AND p.operation_kind='refine') OR (p.owner_process='admin_http' AND p.operation_kind IN ('review','publish')) ORDER BY p.policy_id,t.scope_selector,t.fence_kind,t.required_state",
  ).all() as Array<Record<string, unknown>>;
}

describe("trusted local quick-launch bootstrap", () => {
  afterEach(() => disposeAdmittedReviewDatabases());

  test("uses existing Admin phase_control/fence_update once per singleton fence", () => {
    const handoffs: OwnerSupervisorHandoff[] = [handoff("bootstrap-deletion"), handoff("bootstrap-publication")];
    const database = admittedSchema7((seedDatabase: DatabaseSync) => {
      for (const value of handoffs) persistOwnerSupervisorHandoff(seedDatabase, value, () => true);
    });
    const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: RELEASE, manifestSha256: MANIFEST });
    try {
      const receipts = trustedLocalBootstrap({
        database,
        gateway,
        handoffProvider: () => {
          const value = handoffs.shift();
          if (!value) throw new Error("HANDOFF_QUEUE_EXHAUSTED");
          return value;
        },
        requests: [
          { operationId: "bootstrap-deletion", fence: "deletion", expectedControlVersion: 1 },
          { operationId: "bootstrap-publication", fence: "publication", expectedControlVersion: 2 }
        ]
      });
      expect(receipts.map((receipt) => receipt.fence)).toEqual(["deletion", "publication"]);
      expect(database.prepare("SELECT phase,global_stop_state,recovery_state,deletion_fence_state,publication_fence_state,version FROM internal_control WHERE singleton_id=1").get()).toMatchObject({
        phase: "disabled",
        global_stop_state: "stopped",
        recovery_state: "fenced",
        deletion_fence_state: "clear",
        publication_fence_state: "clear",
        version: 3
      });
      expect(scalar(database, "SELECT COUNT(*) AS count FROM internal_operation WHERE owner_process='admin_http' AND operation_kind='phase_control' AND control_action='fence_update' AND state='succeeded'")).toBe(2);
      expect(scalar(database, "SELECT COUNT(*) AS count FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher')")).toBe(0);
      expect(scalar(database, "SELECT COUNT(*) AS count FROM internal_operation_outbox")).toBe(0);
    } finally {
      gateway.close();
    }
  });

  test("rejects a dual-fence operation before opening a gateway operation", () => {
    const database = admittedSchema7();
    const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: RELEASE, manifestSha256: MANIFEST });
    try {
      expect(() => trustedLocalBootstrap({
        database,
        gateway,
        handoffProvider: () => { throw new Error("HANDOFF_SHOULD_NOT_BE_REQUESTED"); },
        requests: [
          { operationId: "bootstrap-dual", fence: "deletion", expectedControlVersion: 1 },
          { operationId: "bootstrap-dual", fence: "publication", expectedControlVersion: 1 }
        ]
      })).toThrow("TRUSTED_LOCAL_DUAL_FENCE_OPERATION");
      expect(scalar(database, "SELECT COUNT(*) AS count FROM internal_operation")).toBe(0);
    } finally {
      gateway.close();
    }
  });

  test("rejects stale CAS without changing singleton state", () => {
    const value = handoff("bootstrap-stale");
    const database = admittedSchema7((seedDatabase: DatabaseSync) => {
      persistOwnerSupervisorHandoff(seedDatabase, value, () => true);
    });
    const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: RELEASE, manifestSha256: MANIFEST });
    try {
      expect(() => trustedLocalBootstrap({
        database,
        gateway,
        handoffProvider: () => value,
        requests: [{ operationId: "bootstrap-stale", fence: "deletion", expectedControlVersion: 99 }]
      })).toThrow("TRUSTED_LOCAL_FENCE_CAS_STALE");
      expect(database.prepare("SELECT version,deletion_fence_state,publication_fence_state FROM internal_control WHERE singleton_id=1").get()).toMatchObject({ version: 1, deletion_fence_state: "unknown", publication_fence_state: "blocked" });
      expect(scalar(database, "SELECT COUNT(*) AS count FROM internal_operation")).toBe(0);
    } finally {
      gateway.close();
    }
  });

  test("rejects an invalid operation identifier before gateway request", () => {
    const value = handoff("bootstrap-invalid-op");
    const database = admittedSchema7((seedDatabase: DatabaseSync) => {
      persistOwnerSupervisorHandoff(seedDatabase, value, () => true);
    });
    const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: RELEASE, manifestSha256: MANIFEST });
    try {
      expect(() => trustedLocalBootstrap({
        database,
        gateway,
        handoffProvider: () => { throw new Error("HANDOFF_SHOULD_NOT_BE_REQUESTED"); },
        requests: [{ operationId: "wrong operation", fence: "deletion", expectedControlVersion: 1 }]
      })).toThrow("TRUSTED_LOCAL_OPERATION_ID_INVALID");
      expect(scalar(database, "SELECT COUNT(*) AS count FROM internal_operation")).toBe(0);
    } finally {
      gateway.close();
    }
  });

  test("proves the file-backed schema-6 to shared-0007 Admin bootstrap without a trigger or raw-SQL bypass", () => {
    const handoffs: OwnerSupervisorHandoff[] = [];
    const fixture = openAdmittedReviewFixture({
      finalVersion: 7,
      seed: (seedDatabase: DatabaseSync) => {
        for (const migration of MIGRATIONS) {
          seedDatabase.exec(readFileSync(`${APP_ROOT}/migrations/rss-real/${migration}`, "utf8"));
        }
        applyIndependentRssSourcesMigration(
          seedDatabase,
          readFileSync(`${APP_ROOT}/migrations/rss-real/0006_independent_rss_racefans_the_race.sql`, "utf8")
        );
        applyInternalOperationMigration(
          seedDatabase,
          readFileSync(`${APP_ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8")
        );
        for (const id of ["file-bootstrap-deletion", "file-bootstrap-publication"]) {
          const value = handoff(id);
          handoffs.push(value);
          persistOwnerSupervisorHandoff(seedDatabase, value, () => true);
        }
      }
    });
    const database = fixture.database;
    const databasePath = fixture.path;
    try {
      expect(realpathSync(database.location() ?? "")).toBe(realpathSync(databasePath));
      expect(statSync(databasePath).isFile()).toBe(true);
      expect(database.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 7 });
      expect(scalar(database, "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger' AND name='internal_control_transition_guard'")).toBe(1);
      expect(database.prepare("SELECT phase,global_stop_state,recovery_state,deletion_fence_state,publication_fence_state,version FROM internal_control WHERE singleton_id=1").get()).toMatchObject({
        phase: "disabled",
        global_stop_state: "stopped",
        recovery_state: "fenced",
        deletion_fence_state: "unknown",
        publication_fence_state: "blocked",
        version: 1
      });

      const gateway = new SqliteInternalOperationGateway({ database, releaseSha256: RELEASE, manifestSha256: MANIFEST });
      try {
        const receipts = trustedLocalBootstrap({
          database,
          gateway,
          handoffProvider: () => {
            const value = handoffs.shift();
            if (!value) throw new Error("HANDOFF_QUEUE_EXHAUSTED");
            return value;
          },
          requests: [
            { operationId: "file-bootstrap-deletion", fence: "deletion", expectedControlVersion: 1 },
            { operationId: "file-bootstrap-publication", fence: "publication", expectedControlVersion: 2 }
          ]
        });
        expect(receipts.map((receipt) => [receipt.fence, receipt.previousState, receipt.nextState, receipt.expectedControlVersion, receipt.resultingControlVersion])).toEqual([
          ["deletion", "unknown", "clear", 1, 2],
          ["publication", "blocked", "clear", 2, 3]
        ]);
        expect(database.prepare("SELECT phase,global_stop_state,recovery_state,deletion_fence_state,publication_fence_state,version FROM internal_control WHERE singleton_id=1").get()).toMatchObject({
          phase: "disabled",
          global_stop_state: "stopped",
          recovery_state: "fenced",
          deletion_fence_state: "clear",
          publication_fence_state: "clear",
          version: 3
        });
        expect(scalar(database, "SELECT COUNT(*) AS count FROM internal_operation WHERE owner_process='admin_http' AND operation_kind='phase_control' AND control_action='fence_update' AND state='succeeded'")).toBe(2);
        expect(scalar(database, "SELECT COUNT(*) AS count FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher')")).toBe(0);
        expect(scalar(database, "SELECT COUNT(*) AS count FROM internal_operation_outbox")).toBe(0);
        expect(scalar(database, "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger' AND name='internal_control_transition_guard'")).toBe(1);

        const inventory = requiredFenceInventory(database);
        expect(inventory.filter((row) => row.ownerProcess === "rss_collector").map((row) => [row.policyId, row.sourceFenceMode, row.deletionFenceMode, row.publicationFenceMode])).toEqual([
          ["p-collect-disabled", "must_clear", "not_applicable", "not_applicable"],
          ["p-collect-live", "must_clear", "not_applicable", "not_applicable"]
        ]);
        expect(inventory.filter((row) => row.ownerProcess === "rss_refiner" || row.ownerProcess === "bilingual_refiner").filter((row) => row.scopeSelector !== null).map((row) => [row.policyId, row.scopeSelector, row.fenceKind, row.requiredState])).toEqual([
          ["p-refine-bi-backlog", "candidate_id", "completeness", "clear"],
          ["p-refine-bi-backlog", "candidate_id", "publication", "clear"],
          ["p-refine-bi-live", "candidate_id", "completeness", "clear"],
          ["p-refine-bi-live", "candidate_id", "publication", "clear"],
          ["p-refine-rss-backlog", "candidate_id", "publication", "clear"],
          ["p-refine-rss-live", "candidate_id", "publication", "clear"]
        ]);
        expect(inventory.filter((row) => row.ownerProcess === "admin_http" && row.operationKind === "review").filter((row) => row.scopeSelector !== null).map((row) => [row.policyId, row.scopeSelector, row.fenceKind, row.requiredState])).toEqual([
          ["p-review-admin-backlog", "candidate_id", "completeness", "clear"],
          ["p-review-admin-backlog", "candidate_id", "publication", "clear"],
          ["p-review-admin-backlog", "source_id", "deletion", "clear"],
          ["p-review-admin-backlog", "source_id", "media", "clear"],
          ["p-review-admin-backlog", "source_id", "rights", "clear"],
          ["p-review-admin-live", "candidate_id", "completeness", "clear"],
          ["p-review-admin-live", "candidate_id", "publication", "clear"],
          ["p-review-admin-live", "source_id", "deletion", "clear"],
          ["p-review-admin-live", "source_id", "media", "clear"],
          ["p-review-admin-live", "source_id", "rights", "clear"]
        ]);
        expect(inventory.filter((row) => row.ownerProcess === "admin_http" && row.operationKind === "publish").filter((row) => row.scopeSelector !== null).map((row) => [row.policyId, row.scopeSelector, row.fenceKind, row.requiredState])).toEqual([
          ["p-publish-admin-backlog", "publication_id", "completeness", "clear"],
          ["p-publish-admin-backlog", "publication_id", "deletion", "clear"],
          ["p-publish-admin-backlog", "publication_id", "media", "clear"],
          ["p-publish-admin-backlog", "publication_id", "publication", "clear"],
          ["p-publish-admin-backlog", "publication_id", "rights", "clear"],
          ["p-publish-admin-live", "publication_id", "completeness", "clear"],
          ["p-publish-admin-live", "publication_id", "deletion", "clear"],
          ["p-publish-admin-live", "publication_id", "media", "clear"],
          ["p-publish-admin-live", "publication_id", "publication", "clear"],
          ["p-publish-admin-live", "publication_id", "rights", "clear"]
        ]);

        expect(() => database.exec("UPDATE internal_control SET deletion_fence_state='blocked' WHERE singleton_id=1")).toThrow();
        expect(() => database.exec("DROP TRIGGER internal_control_transition_guard")).toThrow();
      } finally {
        gateway.close();
      }
    } finally {
      fixture.close();
    }
  });
});
