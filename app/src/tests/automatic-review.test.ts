import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  applyProjectionDeliveryRuntimeMigration,
  applyReviewRealAdminMigration,
  applyRssMediaRefinementMigration
} from "../server/review-real/migration.ts";
import { ReviewRealRepository } from "../server/review-real/repository.ts";

const migration = (name: string) => readFileSync(
  new URL(`../../migrations/rss-real/${name}`, import.meta.url),
  "utf8"
);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function seedCandidate(database: DatabaseSync, suffix: string, title: string): string {
  const candidateId = `rss-candidate-auto-${suffix}`;
  const sourceHash = sha256(`auto-source-${suffix}-v1`);
  database.prepare(`
    INSERT INTO pending_review_candidate (
      candidate_id, source_id, external_id, dedupe_key, canonical_url, title, excerpt,
      author, published_at, source_payload_hash, source_revision, first_seen_at, last_seen_at
    ) VALUES (?, 'motorsport-f1-news', ?, ?, ?, ?, ?, 'F1 Desk', ?, ?, 1, ?, ?)
  `).run(
    candidateId,
    `auto-${suffix}`,
    sha256(`auto-dedupe-${suffix}`),
    `https://www.motorsport.com/f1/news/auto-${suffix}/`,
    title,
    `Source excerpt ${suffix}`,
    "2026-08-14T01:00:00.000Z",
    sourceHash,
    "2026-08-14T01:00:00.000Z",
    "2026-08-14T01:00:00.000Z"
  );
  return candidateId;
}

function seedDraft(database: DatabaseSync, candidateId: string, suffix: string, revision = 1): void {
  const sourceHash = sha256(`auto-source-${suffix}-v${revision}`);
  database.prepare(`
    INSERT INTO machine_summary_draft (
      draft_id, candidate_id, source_revision, source_payload_hash, model, prompt_sha256,
      response_sha256, title_zh, summary_zh, key_points_zh_json, input_tokens,
      output_tokens, generated_at
    ) VALUES (?, ?, ?, ?, 'deepseek-chat', ?, ?, ?, ?, ?, 10, 8, ?)
  `).run(
    `draft-${sha256(`auto-draft-${suffix}-v${revision}`)}`,
    candidateId,
    revision,
    sourceHash,
    sha256(`auto-prompt-${suffix}-v${revision}`),
    sha256(`auto-response-${suffix}-v${revision}`),
    `自动初审${suffix}中文标题`,
    `自动初审${suffix}中文摘要用于验证安全通过、拒绝记录和人工恢复。`,
    JSON.stringify([`自动初审${suffix}要点`]),
    `2026-08-14T01:0${revision}:00.000Z`
  );
}

describe("automatic initial review", () => {
  it("approves safe drafts, records security rejections, and honors manual restoration until the source changes", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(migration("0001_rss_real.sql"));
    applyReviewRealAdminMigration(database, migration("0002_admin_review_publish.sql"));
    applyProjectionDeliveryRuntimeMigration(database, migration("0003_projection_delivery_runtime.sql"));
    applyRssMediaRefinementMigration(database, migration("0004_rss_media_and_chinese_refinement.sql"));

    const safeId = seedCandidate(database, "safe", "Safe source title");
    const unsafeId = seedCandidate(database, "unsafe", "Spoofed source \u202Etitle");
    const waitingId = seedCandidate(database, "waiting", "Waiting source title");
    seedDraft(database, safeId, "safe");
    seedDraft(database, unsafeId, "unsafe");

    let now = Date.parse("2026-08-14T02:00:00.000Z");
    const repository = new ReviewRealRepository(database, () => {
      const value = new Date(now);
      now += 1_000;
      return value;
    });

    const first = repository.automaticReviewBatch();
    expect(first).toMatchObject({
      considered: 3,
      approved: 1,
      rejected: 1,
      waiting: 1,
      manualOverride: 0,
      failed: 0
    });
    expect(repository.detail(safeId).reviewState).toBe("approved_waiting_publish");
    const published = repository.automaticPublishBatch();
    expect(published).toMatchObject({
      considered: 1,
      published: 1,
      blocked: 0,
      failed: 0
    });
    expect(published.deliveryId).toEqual(expect.stringMatching(/^op-snapshot-/));
    expect(repository.detail(safeId).reviewState).toBe("published_delivery_pending");
    expect(database.prepare("SELECT COUNT(*) AS count FROM published_projection").get()).toMatchObject({ count: 1 });
    expect(database.prepare(
      "SELECT actor_ref FROM audit_event WHERE event_type='publication_published' ORDER BY audit_seq DESC LIMIT 1"
    ).get()).toMatchObject({ actor_ref: "system-auto-publish-v1" });
    const blockedWhilePending = repository.automaticPublishBatch();
    expect(blockedWhilePending).toMatchObject({
      published: 0,
      blocked: 1,
      failed: 0
    });
    expect(blockedWhilePending.items[0]?.reasonCode).toBe("PUBLICATION_RECONCILE_WAIT");
    expect(repository.detail(waitingId).reviewState).toBe("pending_review");
    const rejected = repository.detail(unsafeId);
    expect(rejected.reviewState).toBe("rejected");
    expect(rejected.decision?.rejectionReason).toContain("AUTO_SECURITY_UNSAFE_TEXT_CONTROL");
    expect(rejected.allowedActions).toContain("revision");
    expect(database.prepare(
      "SELECT actor_ref FROM audit_event WHERE event_type='review_rejected'"
    ).get()).toMatchObject({ actor_ref: "system-auto-review-v1" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM published_projection").get()).toMatchObject({ count: 1 });

    const restored = repository.revision({
      schemaVersion: "admin-review-v0.2",
      operationId: "manual-restore-unsafe-v1",
      expected: {
        candidateId: unsafeId,
        sourceRevision: 1,
        sourceVersionTag: sha256("auto-source-unsafe-v1").slice(0, 12),
        latestBundleId: rejected.latestBundle!.id,
        latestBundleVersionTag: rejected.latestBundle!.versionTag
      },
      editable: {
        titleZh: rejected.machineDraft!.titleZh,
        summaryZh: rejected.machineDraft!.summaryZh,
        notes: "人工确认该来源版本可继续审核"
      }
    }, `/api/admin/reviews/${unsafeId}/revision`, "operator-primary");
    expect(restored.candidate.reviewState).toBe("pending_review");

    const overridden = repository.automaticReviewBatch();
    expect(overridden.manualOverride).toBe(1);
    expect(repository.detail(unsafeId).reviewState).toBe("pending_review");
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM review_decision WHERE decision='rejected'"
    ).get()).toMatchObject({ count: 1 });

    const sourceHashV2 = sha256("auto-source-unsafe-v2");
    database.prepare(`
      UPDATE pending_review_candidate
      SET source_revision=2, source_payload_hash=?, title='Safe updated source title',
          excerpt='Safe updated source excerpt', review_status='pending_review',
          last_seen_at='2026-08-14T03:00:00.000Z'
      WHERE candidate_id=?
    `).run(sourceHashV2, unsafeId);
    seedDraft(database, unsafeId, "unsafe", 2);

    const changedSource = repository.automaticReviewBatch();
    expect(changedSource.approved).toBe(1);
    expect(repository.detail(unsafeId).reviewState).toBe("approved_waiting_publish");
    expect(repository.automaticPublishBatch().items[0]?.reasonCode).toBe("PUBLICATION_RECONCILE_WAIT");
    expect(database.prepare("SELECT COUNT(*) AS count FROM published_projection").get()).toMatchObject({ count: 1 });
    database.close();
  });
});
