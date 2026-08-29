import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  ReviewAdminBackend,
  prepareReleaseNowMutation,
  prepareRevisionMutation
} from "../server/review-real/backend.ts";
import { applyProjectionDeliveryRuntimeMigration, applyReviewRealAdminMigration } from "../server/review-real/migration.ts";
import { ReviewRealRepository } from "../server/review-real/repository.ts";
import { ReviewAdminSecurity } from "../server/review-real/security.ts";
import type { RawAdminContext } from "../server/source-management/security.ts";

const migration0001 = readFileSync(new URL("../../migrations/rss-real/0001_rss_real.sql", import.meta.url), "utf8");
const migration0002 = readFileSync(new URL("../../migrations/rss-real/0002_admin_review_publish.sql", import.meta.url), "utf8");
const migration0003 = readFileSync(new URL("../../migrations/rss-real/0003_projection_delivery_runtime.sql", import.meta.url), "utf8");
const ADMIN_ORIGIN = "https://admin.f1.test";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function seedCandidate(database: DatabaseSync, suffix: string, publishedAt: string): string {
  const candidateId = `rss-candidate-release-${suffix}`;
  database.prepare(
    "INSERT INTO pending_review_candidate (candidate_id, source_id, external_id, dedupe_key, canonical_url, title, excerpt, author, published_at, source_payload_hash, source_revision, first_seen_at, last_seen_at) VALUES (?, 'motorsport-f1-news', ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)"
  ).run(
    candidateId,
    `release-${suffix}`,
    sha256(`release-dedupe-${suffix}`),
    `https://www.motorsport.com/f1/news/release-${suffix}/`,
    `Source title ${suffix}`,
    `Source excerpt ${suffix}`,
    publishedAt,
    sha256(`release-source-${suffix}`),
    publishedAt,
    publishedAt
  );
  return candidateId;
}

function rawContext(input: Readonly<{
  cookie: string;
  csrf?: string;
  fresh?: string;
  path?: string;
}>): RawAdminContext {
  const rawHeaders = new Map<string, readonly string[]>();
  rawHeaders.set("cookie", [input.cookie]);
  rawHeaders.set("origin", [ADMIN_ORIGIN]);
  rawHeaders.set("sec-fetch-site", ["same-origin"]);
  if (input.csrf !== undefined) rawHeaders.set("x-csrf-token", [input.csrf]);
  if (input.fresh !== undefined) rawHeaders.set("x-f1-fresh-reauth", [input.fresh]);
  return Object.freeze({
    method: "POST",
    path: input.path ?? "/api/admin/reviews/release",
    authority: "admin.f1.test",
    origin: ADMIN_ORIGIN,
    peer: "loopback" as const,
    rawHeaders,
    noEgressReady: true as const
  });
}

describe("admin one-click and batch release", () => {
  it("publishes one or many approved candidates with a single snapshot", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(migration0001);
    applyReviewRealAdminMigration(database, migration0002);
    const firstId = seedCandidate(database, "one", "2026-08-14T01:00:00.000Z");
    const secondId = seedCandidate(database, "two", "2026-08-14T00:00:00.000Z");
    let repositoryNow = Date.parse("2026-08-14T02:00:00.000Z");
    const repository = new ReviewRealRepository(database, () => {
      const value = new Date(repositoryNow);
      repositoryNow += 1_000;
      return value;
    });
    let securityNow = Date.parse("2026-08-14T02:00:00.000Z");
    let randomCounter = 0;
    const security = new ReviewAdminSecurity({
      canonicalOrigin: ADMIN_ORIGIN,
      sessionHashKey: Buffer.alloc(32, 0x11),
      readRecoveryFence: () => ({
        clockTrusted: true,
        writerReady: true,
        lastSuccessfulRecoveryPointAt: securityNow - 60_000
      }),
      now: () => securityNow,
      randomBytes: (size) => {
        randomCounter += 1;
        return Buffer.alloc(size, randomCounter);
      }
    });
    const backend = new ReviewAdminBackend(repository, security);
    const session = security.acceptVerifiedSession({
      operatorRef: "operator-primary",
      deviceRef: "device-mac",
      tailnetUserRef: "tailnet-owner"
    });
    let cookie = session.cookieHeader;

    const firstRevision = {
      schemaVersion: "admin-review-v0.2" as const,
      operationId: "operation-release-rev-1",
      expected: {
        candidateId: firstId,
        sourceRevision: 1,
        sourceVersionTag: sha256("release-source-one").slice(0, 12),
        latestBundleId: null,
        latestBundleVersionTag: null
      },
      editable: {
        titleZh: "一键发布第一条中文标题",
        summaryZh: "第一条中文摘要用于一键通过并发布。",
        notes: ""
      }
    };
    const preparedFirstRevision = prepareRevisionMutation(firstRevision);
    const firstRevisionCsrf = backend.issueCsrf(rawContext({ cookie, path: "/api/admin/csrf" }), preparedFirstRevision);
    const firstSaved = backend.revision(rawContext({
      cookie,
      csrf: firstRevisionCsrf,
      path: preparedFirstRevision.binding.path
    }), firstRevision);

    const secondRevision = {
      schemaVersion: "admin-review-v0.2" as const,
      operationId: "operation-release-rev-2",
      expected: {
        candidateId: secondId,
        sourceRevision: 1,
        sourceVersionTag: sha256("release-source-two").slice(0, 12),
        latestBundleId: null,
        latestBundleVersionTag: null
      },
      editable: {
        titleZh: "批量发布第二条中文标题",
        summaryZh: "第二条中文摘要用于批量通过并发布。",
        notes: ""
      }
    };
    const preparedSecondRevision = prepareRevisionMutation(secondRevision);
    const secondRevisionCsrf = backend.issueCsrf(rawContext({ cookie, path: "/api/admin/csrf" }), preparedSecondRevision);
    backend.revision(rawContext({
      cookie,
      csrf: secondRevisionCsrf,
      path: preparedSecondRevision.binding.path
    }), secondRevision);

    const list = repository.list();
    const secondItem = list.items.find((item) => item.candidateId === secondId);
    if (!secondItem?.latestBundle) throw new Error("expected second bundle");
    const releaseRequest = {
      schemaVersion: "admin-review-v0.2" as const,
      operationId: "operation-release-batch",
      expected: {
        items: [
          {
            candidateId: firstId,
            sourceRevision: 1,
            sourceVersionTag: sha256("release-source-one").slice(0, 12),
            latestBundleId: firstSaved.bundle.id,
            latestBundleVersionTag: firstSaved.bundle.versionTag
          },
          {
            candidateId: secondId,
            sourceRevision: 1,
            sourceVersionTag: sha256("release-source-two").slice(0, 12),
            latestBundleId: secondItem.latestBundle.id,
            latestBundleVersionTag: secondItem.latestBundle.versionTag
          }
        ]
      },
      editable: null
    };

    const preparedRelease = prepareReleaseNowMutation(releaseRequest);
    const fresh = security.acceptVerifiedFreshReauth(
      rawContext({ cookie, path: "/api/admin/session/fresh-reauth" }),
      {
        operationId: releaseRequest.operationId,
        action: "publish",
        resourceHash: preparedRelease.binding.resourceHash ?? ""
      }
    );
    cookie = fresh.cookieHeader;
    const releaseCsrf = backend.issueCsrf(rawContext({ cookie, path: "/api/admin/csrf" }), preparedRelease);
    const released = backend.releaseNow(rawContext({
      cookie,
      csrf: releaseCsrf,
      fresh: fresh.freshReceipt,
      path: preparedRelease.binding.path
    }), releaseRequest);

    expect(released.status).toBe("delivery_pending");
    expect(released.operation.candidateIds).toEqual([firstId, secondId].sort());
    expect(database.prepare("SELECT COUNT(*) AS count FROM published_projection").get()).toMatchObject({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM projection_outbox").get()).toMatchObject({ count: 1 });
    expect(repository.list().items.filter((item) => item.reviewState === "published_delivery_pending")).toHaveLength(2);

  });

  it("creates a current bundle before publishing an approved candidate whose source changed", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(migration0001);
    applyReviewRealAdminMigration(database, migration0002);
    applyProjectionDeliveryRuntimeMigration(database, migration0003);
    const candidateId = seedCandidate(database, "updated", "2026-08-14T03:00:00.000Z");
    let now = Date.parse("2026-08-14T04:00:00.000Z");
    const repository = new ReviewRealRepository(database, () => {
      const value = new Date(now);
      now += 1_000;
      return value;
    });
    const revision = repository.revision({
      schemaVersion: "admin-review-v0.2",
      operationId: "operation-updated-revision-1",
      expected: {
        candidateId,
        sourceRevision: 1,
        sourceVersionTag: sha256("release-source-updated").slice(0, 12),
        latestBundleId: null,
        latestBundleVersionTag: null
      },
      editable: {
        titleZh: "来源更新前的中文标题",
        summaryZh: "来源更新前已保存并批准的中文摘要。",
        notes: ""
      }
    }, `/api/admin/reviews/${candidateId}/revision`, "operator-test");
    repository.approve({
      schemaVersion: "admin-review-v0.2",
      operationId: "operation-updated-approve-1",
      expected: {
        candidateId,
        sourceRevision: 1,
        bundleId: revision.bundle.id,
        bundleVersionTag: revision.bundle.versionTag
      }
    }, `/api/admin/reviews/${candidateId}/approve`, "operator-test");

    const firstRelease = repository.releaseNow({
      schemaVersion: "admin-review-v0.2",
      operationId: "operation-updated-release-1",
      expected: {
        items: [{
          candidateId,
          sourceRevision: 1,
          sourceVersionTag: sha256("release-source-updated").slice(0, 12),
          latestBundleId: revision.bundle.id,
          latestBundleVersionTag: revision.bundle.versionTag
        }]
      },
      editable: null
    }, "/api/admin/reviews/release", "operator-test");
    expect(firstRelease.operation.candidateIds).toEqual([candidateId]);
    const firstWork = repository.leaseNext("projection-sender-test");
    if (!firstWork) throw new Error("expected first projection work");
    repository.markDeliverySucceeded(firstWork, {
      schemaVersion: "admin-public-projection-receipt-v1",
      deliveryId: firstWork.deliveryId,
      snapshotManifestHash: firstWork.envelope.snapshot.snapshotManifestHash,
      snapshotGeneration: firstWork.envelope.snapshot.snapshotGeneration,
      status: "active",
      activeSnapshotGeneration: firstWork.envelope.snapshot.snapshotGeneration,
      activeSnapshotManifestHash: firstWork.envelope.snapshot.snapshotManifestHash,
      reasonCode: null,
      receivedAt: "2026-08-14T04:03:00.000Z",
      activatedAt: "2026-08-14T04:03:00.000Z"
    }, "projection-sender-test");
    expect(repository.detail(candidateId).reviewState).toBe("published");

    database.prepare(
      "UPDATE pending_review_candidate SET title=?, excerpt=?, source_payload_hash=?, source_revision=2, last_seen_at=? WHERE candidate_id=?"
    ).run(
      "Updated source title",
      "Updated source excerpt",
      sha256("release-source-updated-v2"),
      "2026-08-14T04:05:00.000Z",
      candidateId
    );
    database.exec(`
      CREATE TABLE machine_summary_draft (
        draft_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        source_revision INTEGER NOT NULL,
        source_payload_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        title_zh TEXT NOT NULL,
        summary_zh TEXT NOT NULL,
        key_points_zh_json TEXT NOT NULL,
        generated_at TEXT NOT NULL
      ) STRICT;
    `);
    database.prepare(
      "INSERT INTO machine_summary_draft (draft_id, candidate_id, source_revision, source_payload_hash, model, title_zh, summary_zh, key_points_zh_json, generated_at) VALUES (?, ?, 2, ?, 'deepseek-chat', ?, ?, ?, ?)"
    ).run(
      `draft-${"a".repeat(64)}`,
      candidateId,
      sha256("release-source-updated-v2"),
      "来源更新后重新审核并发布",
      "来源变化后使用当前机器草稿生成审核 Bundle，再完成批准和发布。",
      JSON.stringify(["使用最新来源版本"]),
      "2026-08-14T04:06:00.000Z"
    );
    expect(repository.detail(candidateId).reviewState).toBe("source_updated");

    const released = repository.releaseNow({
      schemaVersion: "admin-review-v0.2",
      operationId: "operation-updated-release-2",
      expected: {
        items: [{
          candidateId,
          sourceRevision: 2,
          sourceVersionTag: sha256("release-source-updated-v2").slice(0, 12),
          latestBundleId: revision.bundle.id,
          latestBundleVersionTag: revision.bundle.versionTag
        }]
      },
      editable: null
    }, "/api/admin/reviews/release", "operator-test");

    expect(released.status).toBe("delivery_pending");
    expect(released.operation.candidateIds).toEqual([candidateId]);
    expect(database.prepare("SELECT review_status, source_revision, editor_based_on_source_revision FROM pending_review_candidate WHERE candidate_id=?").get(candidateId)).toMatchObject({
      review_status: "published",
      source_revision: 2,
      editor_based_on_source_revision: 2
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM review_bundle").get()).toMatchObject({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM review_decision").get()).toMatchObject({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM published_projection").get()).toMatchObject({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM projection_outbox").get()).toMatchObject({ count: 2 });
    const latestOutbox = database.prepare(
      "SELECT task_envelope_json FROM projection_outbox ORDER BY snapshot_generation DESC LIMIT 1"
    ).get() as { task_envelope_json: string };
    const latestEnvelope = JSON.parse(latestOutbox.task_envelope_json) as {
      snapshot: { records: Array<{ titleZh: string }> };
    };
    expect(latestEnvelope.snapshot.records).toHaveLength(1);
    expect(latestEnvelope.snapshot.records[0]?.titleZh).toBe("来源更新后重新审核并发布");
  });
});
