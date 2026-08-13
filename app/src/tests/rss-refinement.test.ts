import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { applyProjectionDeliveryRuntimeMigration, applyReviewRealAdminMigration, applyRssMediaRefinementMigration } from "../server/review-real/migration.ts";
import { refineOneCandidate } from "../server/rss/refinement.ts";
import { readFileSync } from "node:fs";
import { ReviewRealRepository } from "../server/review-real/repository.ts";

const migration = (name: string) => readFileSync(new URL(`../../migrations/rss-real/${name}`, import.meta.url), "utf8");

describe("RSS Chinese refinement", () => {
  it("stores one hash-bound Chinese draft and sends no source beyond the fixed payload", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
    database.exec(migration("0001_rss_real.sql"));
    applyReviewRealAdminMigration(database, migration("0002_admin_review_publish.sql"));
    applyProjectionDeliveryRuntimeMigration(database, migration("0003_projection_delivery_runtime.sql"));
    applyRssMediaRefinementMigration(database, migration("0004_rss_media_and_chinese_refinement.sql"));
    database.prepare(`
      INSERT INTO pending_review_candidate (
        candidate_id, source_id, external_id, dedupe_key, canonical_url, title, excerpt,
        author, published_at, source_payload_hash, source_revision, first_seen_at, last_seen_at
      ) VALUES (?, 'motorsport-f1-news', 'guid-refine', ?, 'https://www.motorsport.com/f1/news/refine/',
        'Cadillac names new F1 team boss', 'Graeme Lowdon leaves the role after a leadership change.',
        'F1 Desk', '2026-08-13T00:00:00.000Z', ?, 1, '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z')
    `).run("rss-candidate-refine", "a".repeat(64), "b".repeat(64));
    const root = mkdtempSync(join(tmpdir(), "f1-refine-"));
    const keyPath = join(root, "deepseek-api-key");
    writeFileSync(keyPath, `sk-${"x".repeat(30)}`, { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    let requestBody = "";
    const receipt = await refineOneCandidate({
      database,
      apiKeyPath: keyPath,
      now: () => new Date("2026-08-13T01:00:00.000Z"),
      fetchImpl: async (_url, init) => {
        requestBody = String(init?.body);
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            titleZh: "凯迪拉克任命新F1领队，格雷姆·洛登离任",
            summaryZh: "凯迪拉克F1项目调整管理层，格雷姆·洛登离开原职，新任负责人将接手车队领导工作。",
            keyPointsZh: ["管理层完成调整", "洛登离开原职"]
          }) } }],
          usage: { prompt_tokens: 80, completion_tokens: 60 }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    expect(receipt.status).toBe("generated");
    expect(receipt.externalCalls).toBe(1);
    expect(requestBody).toContain("Cadillac names new F1 team boss");
    expect(requestBody).not.toContain(`sk-${"x".repeat(30)}`);
    expect(database.prepare("SELECT title_zh, summary_zh, key_points_zh_json FROM machine_summary_draft").get()).toMatchObject({
      title_zh: "凯迪拉克任命新F1领队，格雷姆·洛登离任"
    });
    database.prepare(`
      INSERT INTO rss_media_candidate (
        candidate_id, source_revision, source_payload_hash, media_url, media_type, declared_bytes, observed_at
      ) VALUES (?, 1, ?, ?, 'image/jpeg', 199697, '2026-08-13T01:00:00.000Z')
    `).run(
      "rss-candidate-refine",
      "b".repeat(64),
      "https://cdn-8.motorsport.com/images/amp/68VWODG2/s6/example.jpg"
    );
    const repository = new ReviewRealRepository(database, () => new Date("2026-08-13T01:01:00.000Z"));
    const detail = repository.detail("rss-candidate-refine");
    expect(detail.machineDraft?.titleZh).toContain("凯迪拉克");
    expect(detail.sourceMedia?.kind).toBe("source_image");
    const revision = repository.revision({
      schemaVersion: "admin-review-v0.2",
      operationId: "op-refinement-accept",
      expected: {
        candidateId: "rss-candidate-refine",
        sourceRevision: 1,
        sourceVersionTag: "b".repeat(12),
        latestBundleId: null,
        latestBundleVersionTag: null
      },
      editable: {
        titleZh: detail.machineDraft!.titleZh,
        summaryZh: detail.machineDraft!.summaryZh,
        notes: ""
      }
    }, "/api/admin/reviews/rss-candidate-refine/revisions", "operator-test");
    const payload = JSON.parse(String((database.prepare(
      "SELECT public_payload_json FROM review_bundle WHERE bundle_id = ?"
    ).get(revision.bundle.id) as Record<string, unknown>).public_payload_json)) as Record<string, unknown>;
    expect(payload.media).toEqual([{
      kind: "source_image",
      url: "https://cdn-8.motorsport.com/images/amp/68VWODG2/s6/example.jpg",
      mimeType: "image/jpeg",
      declaredBytes: 199697
    }]);
    database.close();
  });
});
