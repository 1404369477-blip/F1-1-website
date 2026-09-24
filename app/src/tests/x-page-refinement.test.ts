import { afterEach, describe, expect, test, vi } from "vitest";

import type { GatewayExternalAttemptInput } from "../server/internal-operation/mutation-port.ts";
import { refineOneXCandidate, X_PAGE_REFINE_PROMPT_SHA256, type XPageModelTransport } from "../server/x-page/refinement.ts";
import { testChineseCompletion, testHash, testXFileEnvironment } from "./helpers/x-page-trusted.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function setup(text = "The team announces a new testing schedule.") {
  const env = testXFileEnvironment(); cleanups.push(env.cleanup);
  const imported = env.import(env.capture({ text }));
  const target = { candidateId: imported.candidateId, sourceRevision: imported.sourceRevision, inputContentHash: imported.sourceVersionHash };
  const complete = vi.fn<XPageModelTransport["complete"]>(async () => ({ status: 200, rawResponse: testChineseCompletion() }));
  const request = () => ({ database: env.database, target, trust: env.trust, receiptLedger: env.receiptLedger, evidencePort: env.evidencePort,
    mutationPort: env.mutationPort, externalPort: env.externalPort, modelTransport: { complete }, budgetAccountId: "test-only-x-model-budget", now: env.now });
  return { env, imported, target, complete, request, run: () => refineOneXCandidate(request()),
    drafts: () => env.database.prepare("SELECT * FROM machine_summary_draft").all() };
}

describe("X refinement file-backed module/port contract (synthetic transport and gateway)", () => {
  test("model input contains the complete body tail and stores a Chinese draft bound to that exact revision", async () => {
    const text = `${"A complete source paragraph. ".repeat(180)}END_OF_COMPLETE_CAPTURE`;
    const { env, complete, run, target, drafts } = setup(text);
    const receipt = await run();
    expect(receipt).toMatchObject({ status: "generated", externalCalls: 1, sourceRevision: 1, inputContentHash: target.inputContentHash,
      promptSha256: X_PAGE_REFINE_PROMPT_SHA256, inputTokens: 180, outputTokens: 85 });
    const input = complete.mock.calls[0][0];
    const body = JSON.parse(input.body);
    const payload = JSON.parse(body.messages[1].content);
    expect(payload.completeText).toBe(text);
    expect(body.messages[0].content).toContain("完整正文");
    expect(String(env.database.prepare("SELECT excerpt FROM pending_review_candidate").get()!.excerpt)).not.toContain("END_OF_COMPLETE_CAPTURE");
    expect(drafts()).toHaveLength(1);
    expect(drafts()[0]).toMatchObject({ candidate_id: target.candidateId, source_revision: 1, source_payload_hash: target.inputContentHash,
      title_zh: "车队公布测试安排", prompt_sha256: X_PAGE_REFINE_PROMPT_SHA256 });
    expect(env.stores[0]).toMatchObject({ ownerProcess: "bilingual_refiner", policyId: "p-x-page-refine-store-live", egressClass: "none" });
    env.reopen();
    expect(await run()).toMatchObject({ status: "already_generated", externalCalls: 0 });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  test("a timeout stays unresolved across a file reopen and never issues a second paid request", async () => {
    const { env, complete, run, drafts } = setup();
    complete.mockRejectedValue(new Error("TEST_MODEL_TIMEOUT"));
    await expect(run()).rejects.toThrow("TEST_MODEL_TIMEOUT");
    expect(env.database.prepare("SELECT state,outcome,external_calls FROM internal_external_attempt").get())
      .toMatchObject({ state: "reconcile_required", outcome: "unknown", external_calls: 1 });
    env.reopen(); env.advance(7_200_000);
    await expect(run()).rejects.toThrow("X_REFINE_ATTEMPT_UNRESOLVED");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(env.externalCalls).toBe(1);
    expect(drafts()).toEqual([]);
  });

  test("a known HTTP failure is durably recorded and only retries after backoff", async () => {
    const { env, complete, run, drafts } = setup();
    complete.mockResolvedValueOnce({ status: 500, rawResponse: "provider failed" });
    await expect(run()).rejects.toThrow("X_REFINE_MODEL_HTTP_500");
    expect(env.database.prepare("SELECT state,outcome FROM internal_external_attempt").get()).toMatchObject({ state: "response_committed", outcome: "known_failed" });
    await expect(run()).rejects.toThrow("X_REFINE_RETRY_BACKOFF");
    env.reopen(); env.advance(60_000);
    expect(await run()).toMatchObject({ status: "generated", externalCalls: 1 });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0].body).toBe(complete.mock.calls[0][0].body);
    expect(env.database.prepare("SELECT operation_id FROM internal_external_attempt ORDER BY operation_id").all().some(row => String(row.operation_id).endsWith("-retry-1"))).toBe(true);
    expect(drafts()).toHaveLength(1);
  });

  test("invalid Chinese output has a known provider response and no draft; immediate retry is blocked", async () => {
    const { env, complete, run, drafts } = setup();
    complete.mockResolvedValue({ status: 200, rawResponse: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ titleZh: "English only",
      summaryZh: "English", keyPointsZh: ["English"] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) });
    await expect(run()).rejects.toThrow("DEEPSEEK_CONTENT_INVALID");
    expect(env.database.prepare("SELECT outcome FROM internal_external_attempt").get()!.outcome).toBe("succeeded");
    await expect(run()).rejects.toThrow("X_REFINE_RETRY_BACKOFF");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(drafts()).toEqual([]);
  });

  test("a current source revision changed while the model responds cannot receive the old draft", async () => {
    const { env, imported, complete, run, drafts } = setup();
    complete.mockImplementation(async () => {
      env.import(env.capture({ text: "An edited full source post.", receiptId: "new-source-version", observedAt: "2026-09-06T23:59:20.000Z" }), "edit-during-model",
        { sourceRevision: imported.sourceRevision, sourceVersionHash: imported.sourceVersionHash });
      return { status: 200, rawResponse: testChineseCompletion() };
    });
    await expect(run()).rejects.toThrow("X_REFINE_INPUT_STALE");
    expect(drafts()).toEqual([]);
    expect(env.database.prepare("SELECT source_revision FROM pending_review_candidate").get()!.source_revision).toBe(2);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  test("source stop after a genuine response blocks draft storage", async () => {
    const { env, complete, run, drafts } = setup();
    env.hooks.afterExternal = () => env.database.prepare("UPDATE source SET enabled=0 WHERE source_id='x_f1'").run();
    await expect(run()).rejects.toThrow("X_IMPORT_SOURCE_DISABLED");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(drafts()).toEqual([]);
    expect(env.database.prepare("SELECT outcome FROM internal_external_attempt").get()!.outcome).toBe("succeeded");
  });

  test("source changes after a draft write cause the whole store transaction to roll back", async () => {
    const { env, run, drafts } = setup();
    env.hooks.afterStoreWrite = () => env.database.prepare("UPDATE source SET stop_epoch=stop_epoch+1 WHERE source_id='x_f1'").run();
    await expect(run()).rejects.toThrow("X_REFINE_SOURCE_AUTHORITY_STALE");
    expect(drafts()).toEqual([]);
    expect(env.database.prepare("SELECT stop_epoch FROM source WHERE source_id='x_f1'").get()!.stop_epoch).toBe(1);
  });

  test("an altered durable response carrier cannot justify a stored draft", async () => {
    const { env, run, drafts } = setup();
    env.hooks.afterExternal = () => env.database.prepare("UPDATE internal_external_attempt SET response_identity_sha256=?").run(testHash("wrong-response"));
    await expect(run()).rejects.toThrow("X_REFINE_RESPONSE_CARRIER_INVALID");
    expect(drafts()).toEqual([]);
  });

  test("the returned response body must hash to the genuine carrier, even through an altered port return", async () => {
    const { env, request, drafts } = setup();
    const externalPort = { runExternal: async <T,>(input: GatewayExternalAttemptInput<T>): Promise<T> => {
      const result = await env.externalPort.runExternal(input);
      return { ...result, rawResponse: testChineseCompletion().replace("测试安排", "伪造标题") };
    } };
    await expect(refineOneXCandidate({ ...request(), externalPort })).rejects.toThrow("X_REFINE_RESPONSE_VALUE_MISMATCH");
    expect(drafts()).toEqual([]);
  });

  test("two concurrent invocations cannot send two completions for one unresolved revision", async () => {
    const { complete, run, drafts } = setup();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    complete.mockImplementation(async () => { await barrier; return { status: 200, rawResponse: testChineseCompletion() }; });
    const first = run();
    await expect(run()).rejects.toThrow("X_REFINE_ATTEMPT_UNRESOLVED");
    release();
    expect(await first).toMatchObject({ status: "generated" });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(drafts()).toHaveLength(1);
  });

  test("stored body tampering is rejected before the model port or budget is touched", async () => {
    const { env, complete, run } = setup();
    env.database.prepare("UPDATE x_page_candidate_capture_v1 SET complete_text='altered body'").run();
    await expect(run()).rejects.toThrow("X_REFINE_CAPTURE_BINDING_INVALID");
    expect(complete).not.toHaveBeenCalled();
    expect(env.externalCalls).toBe(0);
  });

  test("a manual rejection prevents automatic model spending", async () => {
    const { env, complete, run } = setup();
    env.database.prepare("UPDATE pending_review_candidate SET review_status='rejected'").run();
    await expect(run()).rejects.toThrow("X_REFINE_CANDIDATE_NOT_ELIGIBLE");
    expect(complete).not.toHaveBeenCalled();
    expect(env.externalCalls).toBe(0);
  });

  test("unsupported draft model schema is a local blocked result with zero calls", async () => {
    const { env, complete, request, drafts } = setup();
    expect(await refineOneXCandidate({ ...request(), modelId: "glm-5.3-flash" })).toMatchObject({ status: "blocked", externalCalls: 0,
      reasonCode: "MODEL_SCHEMA_UNSUPPORTED" });
    expect(complete).not.toHaveBeenCalled();
    expect(env.externalCalls).toBe(0);
    expect(drafts()).toEqual([]);
  });

  test("oversized/unknown transport outcomes remain unreplayable", async () => {
    const { env, complete, run } = setup();
    complete.mockResolvedValue({ status: 200, rawResponse: "x".repeat(128 * 1024 + 1) });
    await expect(run()).rejects.toThrow("X_REFINE_RESPONSE_INVALID");
    env.advance(3_600_000);
    await expect(run()).rejects.toThrow("X_REFINE_ATTEMPT_UNRESOLVED");
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
