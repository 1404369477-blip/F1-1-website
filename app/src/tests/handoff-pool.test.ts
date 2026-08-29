import { readFileSync } from "node:fs";

import { afterEach, describe, expect, test } from "vitest";

import {
  FORBIDDEN_AUTOMATIC_HANDOFF_OWNERS,
  HANDOFF_POOL_MAX_PER_OWNER,
  HANDOFF_POOL_TTL_MS,
  topUpOwnerHandoffPool
} from "../server/internal-operation/handoff-pool.ts";
import type { OwnerSupervisorHandoff } from "../server/internal-operation/gateway.ts";
import { applyIndependentRssSourcesMigration, applyInternalOperationMigration } from "../server/review-real/migration.ts";
import {
  disposeAdmittedReviewDatabases,
  openAdmittedReviewDatabase
} from "./helpers/admitted-review-database.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
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

function admittedSchema7(): ReturnType<typeof openAdmittedReviewDatabase> {
  return openAdmittedReviewDatabase({
    finalVersion: 7,
    seed: (database) => {
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
    }
  });
}

function handoffCount(database: NonNullable<ReturnType<typeof admittedSchema7>>, owner: string): number {
  return Number((database.prepare(
    "SELECT COUNT(*) AS count FROM owner_authorization_handoff WHERE owner_process=?"
  ).get(owner) as Record<string, unknown>).count);
}

function activeHandoffCount(database: NonNullable<ReturnType<typeof admittedSchema7>>, owner: string, now: string): number {
  return Number((database.prepare(
    "SELECT COUNT(*) AS count FROM owner_authorization_handoff WHERE owner_process=? AND consumed_by_operation_id IS NULL AND expires_at>?"
  ).get(owner, now) as Record<string, unknown>).count);
}

function verify(candidate: OwnerSupervisorHandoff): boolean {
  return candidate.issuer === "f1plus1-owner-supervisor-v1" &&
    candidate.releaseSha256 === RELEASE &&
    candidate.manifestSha256 === MANIFEST;
}

afterEach(() => disposeAdmittedReviewDatabases());

describe("bounded owner handoff pool", () => {
  test("explicitly rejects automatic owners without writing history", () => {
    const database = admittedSchema7();
    for (const owner of FORBIDDEN_AUTOMATIC_HANDOFF_OWNERS) {
      expect(() => topUpOwnerHandoffPool({
        database,
        ownerProcess: owner,
        count: 1,
        releaseSha256: RELEASE,
        manifestSha256: MANIFEST,
        now: 1000,
        verifyReceipt: verify
      })).toThrow("HANDOFF_POOL_AUTOMATIC_OWNER_FORBIDDEN");
    }
    expect(() => topUpOwnerHandoffPool({
      database,
      ownerProcess: "admin_http",
      count: 1,
      releaseSha256: RELEASE,
      manifestSha256: MANIFEST,
      now: 1000,
      verifyReceipt: verify
    })).toThrow("HANDOFF_POOL_OWNER_NOT_ALLOWLISTED");
    expect(handoffCount(database, "automatic_reviewer")).toBe(0);
    expect(handoffCount(database, "automatic_publisher")).toBe(0);
    expect(handoffCount(database, "admin_http")).toBe(0);
  });

  test("tops up an allowlisted owner with short-lived identity-bound one-time rows", () => {
    const database = admittedSchema7();
    const now = Date.now();
    const result = topUpOwnerHandoffPool({
      database,
      ownerProcess: "rss_collector",
      count: HANDOFF_POOL_MAX_PER_OWNER,
      releaseSha256: RELEASE,
      manifestSha256: MANIFEST,
      now,
      verifyReceipt: verify
    });
    expect(result).toMatchObject({
      ownerProcess: "rss_collector",
      requested: HANDOFF_POOL_MAX_PER_OWNER,
      created: HANDOFF_POOL_MAX_PER_OWNER,
      active: HANDOFF_POOL_MAX_PER_OWNER,
      cap: HANDOFF_POOL_MAX_PER_OWNER
    });
    expect(result.handoffIds).toHaveLength(HANDOFF_POOL_MAX_PER_OWNER);
    expect(result.expiresAt).toBe(new Date(now + HANDOFF_POOL_TTL_MS).toISOString());
    for (const row of database.prepare(
      "SELECT handoff_id,owner_process,issuer,one_time_nonce,release_sha256,manifest_sha256,verified_at,expires_at,consumed_by_operation_id FROM owner_authorization_handoff ORDER BY handoff_id"
    ).all() as Array<Record<string, unknown>>) {
      expect(row.owner_process).toBe("rss_collector");
      expect(row.issuer).toBe("f1plus1-owner-supervisor-v1");
      expect(row.release_sha256).toBe(RELEASE);
      expect(row.manifest_sha256).toBe(MANIFEST);
      expect(row.verified_at).toBe(new Date(now).toISOString());
      expect(row.expires_at).toBe(new Date(now + HANDOFF_POOL_TTL_MS).toISOString());
      expect(row.consumed_by_operation_id).toBeNull();
      expect(String(row.one_time_nonce)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    for (const receipt of [result]) {
      expect(receipt).not.toHaveProperty("oneTimeNonce");
      expect(receipt).not.toHaveProperty("receiptSha256");
    }
  });

  test("never exceeds the fixed owner cap and never deletes expired history", () => {
    const database = admittedSchema7();
    const now = Date.now();
    const first = topUpOwnerHandoffPool({
      database,
      ownerProcess: "projection_sender",
      count: HANDOFF_POOL_MAX_PER_OWNER,
      releaseSha256: RELEASE,
      manifestSha256: MANIFEST,
      now,
      verifyReceipt: verify
    });
    expect(first.created).toBe(HANDOFF_POOL_MAX_PER_OWNER);
    expect(topUpOwnerHandoffPool({
      database,
      ownerProcess: "projection_sender",
      count: 1,
      releaseSha256: RELEASE,
      manifestSha256: MANIFEST,
      now: now + 1,
      verifyReceipt: verify
    }).created).toBe(0);
    expect(() => topUpOwnerHandoffPool({
      database,
      ownerProcess: "projection_sender",
      count: HANDOFF_POOL_MAX_PER_OWNER + 1,
      releaseSha256: RELEASE,
      manifestSha256: MANIFEST,
      now: now + 1,
      verifyReceipt: verify
    })).toThrow("HANDOFF_POOL_COUNT_INVALID");
    const later = topUpOwnerHandoffPool({
      database,
      ownerProcess: "projection_sender",
      count: 1,
      releaseSha256: RELEASE,
      manifestSha256: MANIFEST,
      now: now + HANDOFF_POOL_TTL_MS + 1,
      verifyReceipt: verify
    });
    expect(later.created).toBe(1);
    expect(later.active).toBe(1);
    expect(handoffCount(database, "projection_sender")).toBe(HANDOFF_POOL_MAX_PER_OWNER + 1);
    expect(activeHandoffCount(database, "projection_sender", new Date(now + HANDOFF_POOL_TTL_MS + 1).toISOString())).toBe(1);
    expect(() => topUpOwnerHandoffPool({
      database,
      ownerProcess: "rss_refiner",
      count: 0,
      releaseSha256: RELEASE,
      manifestSha256: MANIFEST,
      now,
      verifyReceipt: verify
    })).toThrow("HANDOFF_POOL_COUNT_INVALID");
  });
});
