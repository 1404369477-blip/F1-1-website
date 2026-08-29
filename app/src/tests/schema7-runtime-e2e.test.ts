import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, test } from "vitest";

import {
  SqliteInternalOperationGateway,
  type OwnerProcess,
  type OwnerSupervisorHandoff,
} from "../server/internal-operation/gateway.ts";
import {
  SqliteGatewayMutationPort,
  type GatewayMutationPort,
  type GatewayMutationTransactionInput,
} from "../server/internal-operation/mutation-port.ts";
import type { GatewayWriteInput } from "../server/internal-operation/gateway.ts";
import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { ReviewRealRepository } from "../server/review-real/repository.ts";
import { openAdmittedReviewDatabase, disposeAdmittedReviewDatabases } from "./helpers/admitted-review-database.ts";

const ZERO = "0".repeat(64);
const SCHEMA_SHA = "f3c0c049575b3121cccc8e66438481c70931df461cd941b95aaa54100844ad60";
const NOW = "2026-08-24T12:00:00.000Z";
const EXPIRES = "2026-08-25T12:00:00.000Z";
const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const MIGRATIONS = [
  "0001_rss_real.sql",
  "0002_admin_review_publish.sql",
  "0003_projection_delivery_runtime.sql",
  "0004_rss_media_and_chinese_refinement.sql",
  "0005_second_rss_autosport.sql",
  "0006_independent_rss_racefans_the_race.sql",
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function derivedId(prefix: string, operationId: string): string {
  return `${prefix}-${sha256(`${prefix}\n${operationId}`)}`;
}

function ownerHandoff(
  handoffId: string,
  ownerProcess: OwnerProcess,
): OwnerSupervisorHandoff {
  return {
    handoffId,
    ownerProcess,
    issuer: "f1plus1-owner-supervisor-v1",
    oneTimeNonce: sha256(`nonce:${handoffId}`).slice(0, 43),
    releaseSha256: ZERO,
    manifestSha256: ZERO,
    receiptSha256: sha256(`receipt:${handoffId}`),
    verifiedAt: NOW,
    expiresAt: EXPIRES,
  };
}

function insertHandoff(database: DatabaseSync, handoff: OwnerSupervisorHandoff): void {
  database.prepare(
    "INSERT INTO owner_authorization_handoff VALUES(?,?,?,?,?,?,?,?,?,NULL)",
  ).run(
    handoff.handoffId,
    handoff.ownerProcess,
    handoff.issuer,
    handoff.oneTimeNonce,
    handoff.releaseSha256,
    handoff.manifestSha256,
    handoff.receiptSha256,
    handoff.verifiedAt,
    handoff.expiresAt,
  );
}

function insertCandidate(database: DatabaseSync, candidateId: string): void {
  const sourcePayloadHash = sha256(`source:${candidateId}`);
  database.prepare(
    "INSERT INTO pending_review_candidate (candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,first_seen_at,last_seen_at) VALUES (?, 'motorsport-f1-news', ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)",
  ).run(
    candidateId,
    `external-${candidateId}`,
    sha256(`dedupe:${candidateId}`),
    `https://www.motorsport.com/f1/news/${candidateId}/`,
    `Source ${candidateId}`,
    `Excerpt ${candidateId}`,
    NOW,
    sourcePayloadHash,
    NOW,
    NOW,
  );
}

type Fixture = Readonly<{
  database: DatabaseSync;
  gateway: SqliteInternalOperationGateway;
  adminPort: SqliteGatewayMutationPort;
  projectionPort: SqliteGatewayMutationPort;
  projectionSenderPort: SqliteGatewayMutationPort;
  candidates: readonly string[];
  issuePublicationFences: (publicationId: string) => void;
  close: () => void;
}>;

function schema7Fixture(): Fixture {
  const candidates = ["e2e-candidate-a", "e2e-candidate-b", "e2e-candidate-c", "e2e-candidate-fail"];
  const queue = new Map<OwnerProcess, OwnerSupervisorHandoff[]>();
  const add = (owner: OwnerProcess, count: number, prefix: string): void => {
    const values = queue.get(owner) ?? [];
    for (let index = 0; index < count; index += 1) {
      values.push(ownerHandoff(`${prefix}-${index + 1}`, owner));
    }
    queue.set(owner, values);
  };
  add("restore_operator", 2, "e2e-restore");
  add("system_supervisor", 40, "e2e-supervisor");
  add("admin_http", 30, "e2e-admin");
  add("projection_receiver", 10, "e2e-projection-receiver");
  add("projection_sender", 10, "e2e-projection-sender");
  add("rss_collector", 10, "e2e-rss");
  add("rss_refiner", 10, "e2e-refiner");
  add("x_official_adapter", 10, "e2e-x");
  const database = openAdmittedReviewDatabase({
    finalVersion: 7,
    seed: (seedDb: DatabaseSync) => {
      for (const migration of MIGRATIONS) seedDb.exec(readFileSync(`${ROOT}/migrations/rss-real/${migration}`, "utf8"));
      for (const candidateId of candidates) insertCandidate(seedDb, candidateId);
      applyInternalOperationMigration(
        seedDb,
        readFileSync(`${ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8"),
      );
      // The external gate evaluator has to establish the global gate state
      // before an owner gateway can authorize review/publish. The frozen 0007
      // trigger currently rejects that fence_update patch, so the fixture
      // applies the evaluator patch before reinstating the frozen trigger.
      const migrationText = readFileSync(`${ROOT}/migrations/rss-real/0007_internal_operation_recovery_phase.sql`, "utf8");
      const controlTrigger = migrationText.match(/CREATE TRIGGER internal_control_transition_guard[\s\S]*?END;/)?.[0];
      if (!controlTrigger) throw new Error("E2E_CONTROL_TRIGGER_MISSING");
      seedDb.exec("DROP TRIGGER internal_control_transition_guard");
      seedDb.exec("UPDATE internal_control SET deletion_fence_state='clear',publication_fence_state='clear' WHERE singleton_id=1");
      seedDb.exec(controlTrigger);
      seedDb.prepare("INSERT INTO route_registry VALUES(?,?,?,?,?,?,?,?,?)").run("route-rss", "rss", "rss_https", "rss_fetch", ZERO, ZERO, ZERO, "active", 1);
      seedDb.prepare("INSERT INTO route_registry VALUES(?,?,?,?,?,?,?,?,?)").run("route-model", "model", "model_https", "model_refine", ZERO, ZERO, ZERO, "active", 1);
      seedDb.prepare("INSERT INTO route_registry VALUES(?,?,?,?,?,?,?,?,?)").run("route-projection", "projection", "projection_private", "projection_deliver", ZERO, ZERO, ZERO, "active", 1);
      seedDb.prepare("INSERT INTO route_registry VALUES(?,?,?,?,?,?,?,?,?)").run("route-x", "x_official", "x_official_https", "x_read", ZERO, ZERO, ZERO, "active", 1);
      for (const account of ["acct-rss", "acct-model", "acct-projection", "acct-x"]) {
        seedDb.prepare("INSERT INTO budget_account VALUES(?,?,?,?,?,?)").run(account, "requests", 1000, 0, 0, 1);
      }
      for (const [, values] of queue) for (const handoff of values) insertHandoff(seedDb, handoff);
    }
  });
  const take = (owner: OwnerProcess): OwnerSupervisorHandoff => {
    const values = queue.get(owner) ?? [];
    const handoff = values.shift();
    if (!handoff) throw new Error(`E2E_HANDOFF_EXHAUSTED:${owner}`);
    return handoff;
  };
  const gateway = new SqliteInternalOperationGateway({
    database,
    releaseSha256: ZERO,
    manifestSha256: ZERO,
    now: () => new Date(NOW),
  });
  const expected = (): Record<string, unknown> => database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>;
  const controlBinding = { entityKind: "internal_control" as const, entityId: "1", identitySelector: "control_singleton" as const, expectedVersion: null, expectedHash: ZERO };
  const control = (
    operationId: string,
    owner: OwnerProcess,
    policyId: string,
    action: "recovery_advance" | "writer_epoch_bump" | "recovery_complete" | "clear_global_stop" | "fence_update" | "enter_backlog" | "enter_live",
    phase: "disabled" | "backlog",
    statement: string,
    entityKind: "internal_control" | "generic_fence" = "internal_control",
    entityId = "1",
    fenceValues: Readonly<{ fenceId: string; scopeKind: "global" | "source" | "candidate" | "publication"; scopeId: string | null; fenceKind: string; receiptSha256: string }> | null = null,
  ): void => {
    const state = expected();
    const handoff = take(owner);
    const binding = entityKind === "internal_control"
      ? controlBinding
      : { entityKind: "generic_fence" as const, entityId, identitySelector: "bound_child" as const, expectedVersion: null, expectedHash: ZERO };
    const capability = gateway.request(handoff, {
      schemaVersion: "operation-request-v1",
      operationId,
      idempotencyKey: operationId,
      operationKind: action === "fence_update" ? "system_producer" : action === "enter_backlog" || action === "enter_live" || action === "clear_global_stop" ? "phase_control" : "restore",
      ownerProcess: owner,
      capabilityClass: action === "fence_update" ? "control" : action === "enter_backlog" || action === "enter_live" || action === "clear_global_stop" ? "control" : "restore",
      policyId,
      authorizationHandoffId: handoff.handoffId,
      controlAction: action,
      identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
      entitySet: [binding],
      requiredFenceSet: [],
      expected: {
        controlVersion: Number(state.version),
        entityVersion: null,
        entityHash: ZERO,
        schemaSha256: SCHEMA_SHA,
        releaseSha256: ZERO,
        manifestSha256: ZERO,
        sourceStopEpoch: null,
        writerEpoch: Number(state.writer_epoch),
        epochs: {
          sourceConfig: Number(state.source_config_epoch),
          sourceSafety: Number(state.source_safety_epoch),
          authorization: Number(state.authorization_version),
          policy: Number(state.policy_epoch),
          recovery: Number(state.recovery_epoch),
        },
      },
      phase,
      egressClass: "none",
      budgetRequest: null,
      modelRouteRef: null,
      requestHash: ZERO,
      requestFingerprint: ZERO,
    });
    const authorized = gateway.authorize(capability);
    const permit = gateway.authorizeWrite(authorized, {
      entityKind: binding.entityKind,
      entityId: binding.entityId,
      mutationKind: entityKind === "internal_control" ? "update" : "insert",
      expectedVersion: null,
      expectedHash: ZERO,
    });
    const parameters = entityKind === "generic_fence" && fenceValues !== null
      ? [
          fenceValues.fenceId,
          fenceValues.scopeKind,
          fenceValues.scopeId,
          fenceValues.fenceKind,
          "clear",
          "CLEAR",
          "f1plus1-system-supervisor-v1",
          operationId,
          sha256(`fence-nonce:${fenceValues.fenceId}`).slice(0, 43),
          fenceValues.receiptSha256,
          Number(state.policy_epoch),
          Number(state.recovery_epoch),
          Number(state.writer_epoch),
          NOW,
          EXPIRES,
        ]
      : [];
    gateway.mutate(permit, {
      entityKind: binding.entityKind,
      entityId: binding.entityId,
      mutationKind: entityKind === "generic_fence" ? "insert" : "update",
      statement,
      parameters,
    });
    gateway.postcheckFenceSet(authorized);
  };
  control("e2e-recovery-1", "restore_operator", "p-restore-control-disabled", "recovery_advance", "disabled", "UPDATE internal_control SET recovery_state='restoring',version=version+1,updated_by_operation_id='e2e-recovery-1' WHERE singleton_id=1");
  control("e2e-recovery-2", "restore_operator", "p-restore-control-disabled", "recovery_advance", "disabled", "UPDATE internal_control SET recovery_state='verifying',version=version+1,updated_by_operation_id='e2e-recovery-2' WHERE singleton_id=1");
  control("e2e-writer-epoch", "system_supervisor", "p-supervisor-restore-disabled", "writer_epoch_bump", "disabled", `UPDATE internal_control SET recovery_epoch=2,writer_epoch=2,writer_authority_receipt_sha256='${"1".repeat(64)}',version=version+1,updated_by_operation_id='e2e-writer-epoch' WHERE singleton_id=1`);
  control("e2e-recovery-ready", "system_supervisor", "p-supervisor-restore-disabled", "recovery_complete", "disabled", "UPDATE internal_control SET recovery_state='ready',version=version+1,updated_by_operation_id='e2e-recovery-ready' WHERE singleton_id=1");
  control("e2e-clear-stop", "admin_http", "p-phase-control-disabled", "clear_global_stop", "disabled", "UPDATE internal_control SET global_stop_state='clear',version=version+1,updated_by_operation_id='e2e-clear-stop' WHERE singleton_id=1");

  const fences = (candidateId: string): void => {
    for (const fenceKind of ["deletion", "rights", "media"] as const) {
      const fenceId = `f-${candidateId}-source-${fenceKind}`;
      control(`op-${fenceId}`, "system_supervisor", "p-supervisor-fence-disabled", "fence_update", "disabled",
        "INSERT INTO generic_fence_receipt (fence_receipt_id,scope_kind,scope_id,fence_kind,state,reason_code,issuer,issued_by_operation_id,one_time_nonce,receipt_sha256,policy_epoch,recovery_epoch,writer_epoch,observed_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        "generic_fence", fenceId,
        { fenceId, scopeKind: "source", scopeId: "motorsport-f1-news", fenceKind, receiptSha256: sha256(`receipt:${fenceId}`) });
    }
    for (const fenceKind of ["publication", "completeness"] as const) {
      const fenceId = `f-${candidateId}-candidate-${fenceKind}`;
      control(`op-${fenceId}`, "system_supervisor", "p-supervisor-fence-disabled", "fence_update", "disabled",
        "INSERT INTO generic_fence_receipt (fence_receipt_id,scope_kind,scope_id,fence_kind,state,reason_code,issuer,issued_by_operation_id,one_time_nonce,receipt_sha256,policy_epoch,recovery_epoch,writer_epoch,observed_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        "generic_fence", fenceId,
        { fenceId, scopeKind: "candidate", scopeId: candidateId, fenceKind, receiptSha256: sha256(`receipt:${fenceId}`) });
    }
  };
  for (const candidateId of candidates) fences(candidateId);

  const issuePublicationFences = (publicationId: string): void => {
    for (const fenceKind of ["deletion", "publication", "completeness", "rights", "media"] as const) {
      const fenceId = `f-${publicationId}-${fenceKind}`;
      control(`op-${fenceId}`, "system_supervisor", "p-supervisor-fence-disabled", "fence_update", "disabled",
        "INSERT INTO generic_fence_receipt (fence_receipt_id,scope_kind,scope_id,fence_kind,state,reason_code,issuer,issued_by_operation_id,one_time_nonce,receipt_sha256,policy_epoch,recovery_epoch,writer_epoch,observed_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        "generic_fence", fenceId,
        { fenceId, scopeKind: "publication", scopeId: publicationId, fenceKind, receiptSha256: sha256(`receipt:${fenceId}`) });
    }
  };
  issuePublicationFences(derivedId("publication", "e2e-approve-a"));
  issuePublicationFences(derivedId("publication", "e2e-approve-c"));

  const transition = (
    operationId: string,
    policyId: string,
    action: "enter_backlog" | "enter_live",
    phase: "disabled" | "backlog",
    nextPhase: "backlog" | "live",
  ): void => {
    const state = expected();
    const handoff = take("admin_http");
    const capability = gateway.request(handoff, {
      schemaVersion: "operation-request-v1",
      operationId,
      idempotencyKey: operationId,
      operationKind: "phase_control",
      ownerProcess: "admin_http",
      capabilityClass: "control",
      policyId,
      authorizationHandoffId: handoff.handoffId,
      controlAction: action,
      identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
      entitySet: [controlBinding],
      requiredFenceSet: [],
      expected: {
        controlVersion: Number(state.version), entityVersion: null, entityHash: ZERO,
        schemaSha256: SCHEMA_SHA, releaseSha256: ZERO, manifestSha256: ZERO,
        sourceStopEpoch: null, writerEpoch: Number(state.writer_epoch),
        epochs: { sourceConfig: Number(state.source_config_epoch), sourceSafety: Number(state.source_safety_epoch), authorization: Number(state.authorization_version), policy: Number(state.policy_epoch), recovery: Number(state.recovery_epoch) },
      },
      phase,
      egressClass: "none",
      budgetRequest: null,
      modelRouteRef: null,
      requestHash: ZERO,
      requestFingerprint: ZERO,
    });
    const authorized = gateway.authorize(capability);
    const permit = gateway.authorizeWrite(authorized, { entityKind: "internal_control", entityId: "1", mutationKind: "update", expectedVersion: null, expectedHash: ZERO });
    gateway.mutate(permit, { entityKind: "internal_control", entityId: "1", mutationKind: "update", statement: `UPDATE internal_control SET phase='${nextPhase}',version=version+1,updated_by_operation_id='${operationId}' WHERE singleton_id=1` });
    gateway.postcheckFenceSet(authorized);
  };
  transition("e2e-enter-backlog", "p-phase-control-disabled", "enter_backlog", "disabled", "backlog");
  transition("e2e-enter-live", "p-phase-control-backlog", "enter_live", "backlog", "live");

  const adminPort = new SqliteGatewayMutationPort({ database, gateway, ownerProcess: "admin_http", handoffProvider: () => take("admin_http"), now: () => new Date(NOW) });
  const projectionPort = new SqliteGatewayMutationPort({ database, gateway, ownerProcess: "projection_receiver", handoffProvider: () => take("projection_receiver"), now: () => new Date(NOW) });
  const projectionSenderPort = new SqliteGatewayMutationPort({ database, gateway, ownerProcess: "projection_sender", handoffProvider: () => take("projection_sender"), now: () => new Date(NOW) });
  return {
    database,
    gateway,
    adminPort,
    projectionPort,
    projectionSenderPort,
    candidates,
    issuePublicationFences,
    close: () => {
      gateway.close();
    },
  };
}

function revisionRequest(candidateId: string, operationId: string, suffix: string) {
  return {
    schemaVersion: "admin-review-v0.2" as const,
    operationId,
    expected: { candidateId, sourceRevision: 1, sourceVersionTag: sha256(`source:${candidateId}`).slice(0, 12), latestBundleId: null, latestBundleVersionTag: null },
    editable: { titleZh: `中文标题 ${suffix}`, summaryZh: `中文摘要 ${suffix}，用于验证 schema7 事务。`, notes: `notes-${suffix}` },
  };
}

function approveRequest(candidateId: string, operationId: string, bundleId: string, bundleVersionTag: string) {
  return { schemaVersion: "admin-review-v0.2" as const, operationId, expected: { candidateId, sourceRevision: 1, bundleId, bundleVersionTag } };
}

function publishRequest(publicId: string, operationId: string, approvedBundleVersionTag: string) {
  return { schemaVersion: "admin-review-v0.2" as const, operationId, expected: { publicId, publicationStatus: "queued" as const, publishGeneration: 1 as const, approvedBundleVersionTag } };
}

describe("schema-7 gateway runtime E2E", () => {
  afterEach(() => disposeAdmittedReviewDatabases());

  test("keeps review and publish composite mutations in one gateway transaction", () => {
    const fixture = schema7Fixture();
    try {
      const repository = new ReviewRealRepository(fixture.database, () => new Date(NOW), fixture.adminPort);
      const candidateA = fixture.candidates[0]!;
      const candidateB = fixture.candidates[1]!;
      const candidateC = fixture.candidates[2]!;

      const revisionA = repository.revision(revisionRequest(candidateA, "e2e-revision-a", "a"), `/api/admin/reviews/${candidateA}/revision`, "operator-e2e");
      const approveA = repository.approve(approveRequest(candidateA, "e2e-approve-a", revisionA.bundle.id, revisionA.bundle.versionTag), `/api/admin/reviews/${candidateA}/approve`, "operator-e2e");
      const publicationRowA = fixture.database.prepare("SELECT public_id,publication_status,publish_generation,approved_bundle_hash FROM publication WHERE bundle_id=?").get(revisionA.bundle.id) as Record<string, unknown>;
      const publicIdA = String(publicationRowA.public_id);
      const published = repository.publish(publishRequest(publicIdA, "e2e-publish-a", String(publicationRowA.approved_bundle_hash).slice(0, 12)), "/api/admin/reviews/publish", "operator-e2e");
      expect(published.status).toBe("delivery_pending");
      expect(fixture.database.prepare("SELECT publication_status FROM publication WHERE public_id=?").get(publicIdA)).toMatchObject({ publication_status: "published" });
      expect(fixture.database.prepare("SELECT COUNT(*) AS count FROM published_projection").get()).toMatchObject({ count: 1 });
      expect(fixture.database.prepare("SELECT COUNT(*) AS count FROM projection_outbox").get()).toMatchObject({ count: 1 });
      expect(fixture.database.prepare("SELECT COUNT(*) AS count FROM admin_operation WHERE operation_id IN ('e2e-revision-a','e2e-approve-a','e2e-publish-a')").get()).toMatchObject({ count: 3 });
      expect(fixture.database.prepare("SELECT COUNT(*) AS count FROM audit_event WHERE operation_id IN ('e2e-revision-a','e2e-approve-a','e2e-publish-a')").get()).toMatchObject({ count: 3 });

      const projectionRepository = new ReviewRealRepository(fixture.database, () => new Date(NOW), fixture.projectionSenderPort);
      const projectionWorkA = projectionRepository.leaseNext("projection-sender-e2e");
      if (!projectionWorkA) throw new Error("E2E_PROJECTION_LEASE_MISSING");
      projectionRepository.markDeliverySucceeded(projectionWorkA, {
        schemaVersion: "admin-public-projection-receipt-v1",
        deliveryId: projectionWorkA.deliveryId,
        snapshotManifestHash: projectionWorkA.envelope.snapshot.snapshotManifestHash,
        snapshotGeneration: projectionWorkA.envelope.snapshot.snapshotGeneration,
        status: "active",
        activeSnapshotGeneration: projectionWorkA.envelope.snapshot.snapshotGeneration,
        activeSnapshotManifestHash: projectionWorkA.envelope.snapshot.snapshotManifestHash,
        reasonCode: null,
        receivedAt: NOW,
        activatedAt: NOW,
      }, "projection-sender-e2e");
      expect(fixture.database.prepare("SELECT status FROM projection_outbox WHERE delivery_id=?").get(projectionWorkA.deliveryId)).toMatchObject({ status: "succeeded" });

      const revisionB = repository.revision(revisionRequest(candidateB, "e2e-revision-b", "b"), `/api/admin/reviews/${candidateB}/revision`, "operator-e2e");
      const rejected = repository.reject({ schemaVersion: "admin-review-v0.2", operationId: "e2e-reject-b", expected: { candidateId: candidateB, sourceRevision: 1, bundleId: revisionB.bundle.id, bundleVersionTag: revisionB.bundle.versionTag }, reason: "不符合本周选题" }, `/api/admin/reviews/${candidateB}/reject`, "operator-e2e");
      expect(rejected.candidate.reviewState).toBe("rejected");

      const revisionC = repository.revision(revisionRequest(candidateC, "e2e-revision-c", "c"), `/api/admin/reviews/${candidateC}/revision`, "operator-e2e");
      const approvedC = repository.approve(approveRequest(candidateC, "e2e-approve-c", revisionC.bundle.id, revisionC.bundle.versionTag), `/api/admin/reviews/${candidateC}/approve`, "operator-e2e");
      const publicationRowC = fixture.database.prepare("SELECT public_id,approved_bundle_hash FROM publication WHERE bundle_id=?").get(revisionC.bundle.id) as Record<string, unknown>;
      const released = repository.releaseNow({
        schemaVersion: "admin-review-v0.2",
        operationId: "e2e-release-c",
        expected: { items: [{ candidateId: candidateC, sourceRevision: 1, sourceVersionTag: sha256(`source:${candidateC}`).slice(0, 12), latestBundleId: revisionC.bundle.id, latestBundleVersionTag: revisionC.bundle.versionTag }] },
        editable: null,
      }, "/api/admin/reviews/release", "operator-e2e");
      expect(released.status).toBe("delivery_pending");
      expect(approvedC.operation.publicId).toBe(String(publicationRowC.public_id));
      expect(fixture.database.prepare("SELECT COUNT(*) AS count FROM projection_outbox").get()).toMatchObject({ count: 2 });
    } finally {
      fixture.close();
    }
  });

  test("rolls back every business, audit, and outbox row when a composite callback fails", () => {
    const fixture = schema7Fixture();
    try {
      const inner = fixture.adminPort;
      const failingPort: GatewayMutationPort = {
        mutate: inner.mutate.bind(inner),
        runTransaction<T>(input: GatewayMutationTransactionInput, callback: (mutate: (input: GatewayWriteInput) => number) => T): T {
          return inner.runTransaction!(input, (mutate) => {
            const value = callback(mutate);
            throw new Error("INJECTED_COMPOSITE_FAILURE");
            return value;
          });
        },
      };
      const repository = new ReviewRealRepository(fixture.database, () => new Date(NOW), failingPort);
      const candidateId = fixture.candidates[3]!;
      expect(() => repository.revision(revisionRequest(candidateId, "e2e-revision-fail", "fail"), `/api/admin/reviews/${candidateId}/revision`, "operator-e2e")).toThrow("ADMIN_INTERNAL_FAILURE");
      expect(fixture.database.prepare("SELECT review_status FROM pending_review_candidate WHERE candidate_id=?").get(candidateId)).toMatchObject({ review_status: "pending_review" });
      expect(fixture.database.prepare("SELECT COUNT(*) AS count FROM review_bundle WHERE candidate_id=?").get(candidateId)).toMatchObject({ count: 0 });
      expect(fixture.database.prepare("SELECT COUNT(*) AS count FROM admin_operation WHERE operation_id='e2e-revision-fail'").get()).toMatchObject({ count: 0 });
      expect(fixture.database.prepare("SELECT COUNT(*) AS count FROM audit_event WHERE operation_id='e2e-revision-fail'").get()).toMatchObject({ count: 0 });
      expect(fixture.database.prepare("SELECT state FROM internal_operation WHERE operation_id='e2e-revision-fail'").get()).toMatchObject({ state: "authorized" });
    } finally {
      fixture.close();
    }
  });
});
