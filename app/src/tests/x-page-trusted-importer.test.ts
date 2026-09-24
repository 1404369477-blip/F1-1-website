import { afterEach, describe, expect, test } from "vitest";

import { importTrustedXCapture, readReadyXPageSource, readTrustedXPageInput } from "../server/x-page/trusted-importer.ts";
import { testXFileEnvironment } from "./helpers/x-page-trusted.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function setup() { const env = testXFileEnvironment(); cleanups.push(env.cleanup); return env; }
function counts(env: ReturnType<typeof setup>) {
  return ["pending_review_candidate", "x_page_candidate_capture_v1", "test_producer_receipt", "machine_summary_draft"]
    .map(table => Number(env.database.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n));
}

describe("X trusted importer file-backed port contract (not a production migration/gateway test)", () => {
  test("stores complete text and its exact signed evidence while keeping the preview bounded", () => {
    const env = setup(), text = `${"原帖正文".repeat(1200)}专属尾部`;
    const capture = env.capture({ text });
    const result = env.import(capture);
    expect(result).toMatchObject({ decision: "created", sourceId: "x_f1", sourceRevision: 1 });
    expect(counts(env)).toEqual([1, 1, 1, 0]);
    const candidate = env.database.prepare("SELECT * FROM pending_review_candidate").get()!;
    const stored = env.database.prepare("SELECT * FROM x_page_candidate_capture_v1").get()!;
    expect(String(candidate.excerpt)).not.toContain("专属尾部");
    expect(stored.complete_text).toBe(text);
    expect(JSON.parse(String(stored.evidence_json))).toEqual(capture);
    expect(stored.evidence_sha256).toBe(result.captureSha256);
    const trusted = readTrustedXPageInput({ database: env.database, target: { candidateId: result.candidateId, sourceRevision: 1, inputContentHash: result.sourceVersionHash },
      trust: env.trust, evidencePort: env.evidencePort, receiptLedger: env.receiptLedger, now: env.now() });
    expect(trusted.verified.normalized.text).toBe(text);
  });

  test("same receipt replays durably after reopening without another mutation", () => {
    const env = setup(), capture = env.capture();
    const first = env.import(capture);
    env.reopen();
    expect(env.import(capture, "caller-retry")).toEqual(first);
    expect(env.imports).toHaveLength(1);
    expect(counts(env)).toEqual([1, 1, 1, 0]);
  });

  test.each(["body", "source"] as const)("same receipt cannot be reused with another %s", variation => {
    const env = setup();
    env.import(env.capture());
    const conflict = env.capture(variation === "body" ? { text: "Other signed body" } : { author: "mclarenf1" });
    expect(() => env.import(conflict, "conflicting-receipt")).toThrow("X_IMPORT_RECEIPT_CONFLICT");
    expect(counts(env)).toEqual([1, 1, 1, 0]);
  });

  test("new receipt for identical content is consumed without incrementing candidate revision", () => {
    const env = setup();
    const first = env.import(env.capture());
    const duplicate = env.import(env.capture({ receiptId: "second-observation", observedAt: "2026-09-06T23:59:10.000Z" }), "duplicate",
      { sourceRevision: first.sourceRevision, sourceVersionHash: first.sourceVersionHash });
    expect(duplicate.decision).toBe("duplicate");
    expect(duplicate.sourceRevision).toBe(1);
    expect(counts(env)).toEqual([1, 1, 2, 0]);
  });

  test("newer changed content advances one revision and retains a manual rejection", () => {
    const env = setup(), first = env.import(env.capture());
    env.database.prepare("UPDATE pending_review_candidate SET review_status='rejected'").run();
    const second = env.import(env.capture({ receiptId: "edited-post", text: "Updated source text", observedAt: "2026-09-06T23:59:20.000Z" }), "edit",
      { sourceRevision: first.sourceRevision, sourceVersionHash: first.sourceVersionHash });
    expect(second).toMatchObject({ decision: "updated", sourceRevision: 2 });
    expect(env.database.prepare("SELECT review_status FROM pending_review_candidate").get()!.review_status).toBe("rejected");
    expect(counts(env)).toEqual([1, 2, 2, 0]);
    expect(() => env.import(env.capture({ receiptId: "replayed-old-content", observedAt: "2026-09-06T23:59:30.000Z" }), "old-content",
      { sourceRevision: second.sourceRevision, sourceVersionHash: second.sourceVersionHash })).toThrow("X_IMPORT_HISTORICAL_CONTENT_REPLAY");
  });

  test("same-status body update retains accepted timestamp precision for trusted refinement input", () => {
    const env = setup(), original = env.capture(), first = env.import(original);
    const originalEvidence = env.database.prepare("SELECT * FROM x_page_candidate_capture_v1 WHERE source_revision=1").get();
    const next = env.capture({ receiptId: "more-precise-updated-post", text: "Updated body with a precise visible timestamp", observedAt: "2026-09-06T23:59:20.000Z" });
    const updatedCapture = env.resign({ ...next, post: { ...next.post, publishedAt: "2026-09-06T23:00:00.123Z" } });
    expect(updatedCapture.post.statusUrl).toBe(original.post.statusUrl);
    const second = env.import(updatedCapture, "precision-update", { sourceRevision: first.sourceRevision, sourceVersionHash: first.sourceVersionHash });
    expect(second).toMatchObject({ decision: "updated", candidateId: first.candidateId, sourceRevision: 2 });
    env.reopen();
    const trusted = readTrustedXPageInput({ database: env.database,
      target: { candidateId: second.candidateId, sourceRevision: second.sourceRevision, inputContentHash: second.sourceVersionHash },
      trust: env.trust, evidencePort: env.evidencePort, receiptLedger: env.receiptLedger, now: env.now() });
    expect(trusted.verified.normalized.publishedAt).toBe(updatedCapture.post.publishedAt);
    expect(trusted.verified.normalized.text).toBe(updatedCapture.post.text);
    expect(env.database.prepare("SELECT published_at FROM pending_review_candidate").get()!.published_at).toBe(updatedCapture.post.publishedAt);
    expect(env.database.prepare("SELECT * FROM x_page_candidate_capture_v1 WHERE source_revision=1").get()).toEqual(originalEvidence);
    expect(env.import(updatedCapture, "precision-update-retry")).toEqual(second);
    expect(counts(env)).toEqual([1, 2, 2, 0]);
  });

  test("an old observation cannot overwrite a later body", () => {
    const env = setup(), first = env.import(env.capture());
    expect(() => env.import(env.capture({ receiptId: "stale-observation", text: "Different older text", observedAt: "2026-09-06T23:58:00.000Z" }), "stale-observation",
      { sourceRevision: 1, sourceVersionHash: first.sourceVersionHash })).toThrow("X_IMPORT_OBSERVATION_STALE");
    expect(counts(env)).toEqual([1, 1, 1, 0]);
  });

  test("a durable receipt failure rolls back candidate and capture together", () => {
    const env = setup();
    env.hooks.beforeReceipt = () => { throw new Error("TEST_RECEIPT_DISK_FAILURE"); };
    expect(() => env.import(env.capture())).toThrow("TEST_RECEIPT_DISK_FAILURE");
    expect(counts(env)).toEqual([0, 0, 0, 0]);
    env.reopen();
    delete env.hooks.beforeReceipt;
    expect(env.import(env.capture()).decision).toBe("created");
    expect(counts(env)).toEqual([1, 1, 1, 0]);
  });

  test("a source stopped after admission planning is rejected inside the transaction", () => {
    const env = setup();
    env.hooks.beforeImport = () => env.database.prepare("UPDATE source SET enabled=0 WHERE source_id='x_f1'").run();
    expect(() => env.import(env.capture())).toThrow("X_IMPORT_SOURCE_DISABLED");
    expect(counts(env)).toEqual([0, 0, 0, 0]);
  });

  test("a repost needs current admission for the observed source as well as the author", () => {
    const env = setup();
    env.database.prepare("UPDATE source SET enabled=0 WHERE source_id='x_mclarenf1'").run();
    expect(() => env.import(env.capture({ observedOn: "mclarenf1" }))).toThrow("X_IMPORT_SOURCE_DISABLED");
    expect(counts(env)).toEqual([0, 0, 0, 0]);
  });

  test("status identity cannot move to another author", () => {
    const env = setup();
    env.import(env.capture());
    expect(() => env.import(env.capture({ receiptId: "other-author", author: "mclarenf1" }))).toThrow("X_IMPORT_STATUS_AUTHOR_CONFLICT");
    expect(counts(env)).toEqual([1, 1, 1, 0]);
  });

  test("signature authentication without artifact evidence performs zero mutations", () => {
    const env = setup(), capture = env.capture();
    expect(() => importTrustedXCapture({ database: env.database, gatewayPort: env.gatewayPort, receiptLedger: env.receiptLedger,
      evidencePort: { verifyCaptureArtifacts: () => ({ verified: true }) }, capture, trust: env.trust,
      expectedSourceIdentity: readReadyXPageSource(env.database, env.trust, "x_f1", env.now()), expectedCandidate: null,
      operationId: "no-real-proof", now: env.now })).toThrow("X_CAPTURE_ARTIFACT_PROOF_INVALID");
    expect(counts(env)).toEqual([0, 0, 0, 0]);
    expect(env.imports).toHaveLength(0);
  });

  test("expiration during artifact verification is checked again before admission", () => {
    const env = setup(), capture = env.capture();
    expect(() => importTrustedXCapture({ database: env.database, gatewayPort: env.gatewayPort, receiptLedger: env.receiptLedger,
      evidencePort: { verifyCaptureArtifacts: input => { const proof = env.evidencePort.verifyCaptureArtifacts(input); env.advance(3_600_000); return proof; } },
      capture, trust: env.trust, expectedSourceIdentity: readReadyXPageSource(env.database, env.trust, "x_f1", env.now()), expectedCandidate: null,
      operationId: "expired-during-verification", now: env.now })).toThrow("X_CAPTURE_TOO_OLD");
    expect(counts(env)).toEqual([0, 0, 0, 0]);
  });

  test("stored complete text tampering and stale target hashes cannot become model input", () => {
    const env = setup(), result = env.import(env.capture());
    const input = { database: env.database, target: { candidateId: result.candidateId, sourceRevision: 1, inputContentHash: result.sourceVersionHash },
      trust: env.trust, evidencePort: env.evidencePort, receiptLedger: env.receiptLedger, now: env.now() };
    expect(() => readTrustedXPageInput({ ...input, target: { ...input.target, sourceRevision: 2 } })).toThrow("X_REFINE_INPUT_STALE");
    env.database.prepare("UPDATE x_page_candidate_capture_v1 SET complete_text='tampered'").run();
    expect(() => readTrustedXPageInput(input)).toThrow("X_REFINE_CAPTURE_BINDING_INVALID");
  });
});
