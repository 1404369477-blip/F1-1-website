import { afterEach, describe, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";

import { canonicalJson } from "../server/db/profile.ts";
import type { FenceKind, GatewayWriteInput, OperationCapability } from "../server/internal-operation/gateway.ts";
import { issueXPageAutomaticFences, readXPageCaptureCommitment, xPageAutomaticContentBindings } from "../server/x-page/content-authority.ts";
import { X_PAGE_AUTOMATIC_FENCE_REASON, X_PAGE_COMMITTED_DELIVERY_FENCE_REASON } from "../server/x-page/current-fences.ts";
import { runXPageAutomaticCycle } from "../server/x-page/automatic-worker.ts";
import { prepareXPageAutomaticDelivery } from "../server/x-page/delivery-authority.ts";
import { issueRssAutomaticFences } from "../server/rss-automatic/admission.ts";
import { refineOneCandidate } from "../server/rss/refinement.ts";
import { xPageAutomaticFixture, xPageProjectionSender } from "./helpers/x-page-automatic.ts";

type Environment = Awaited<ReturnType<typeof xPageAutomaticFixture>>;
type Scope = "source" | "candidate" | "observed" | "global" | "publication" | "unrelated";
const cases = [["source", "deletion"], ["source", "rights"], ["source", "media"], ["candidate", "publication"],
  ["candidate", "completeness"], ["observed", "rights"], ["global", "deletion"]] as const;
const cleanups: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) close(); });
async function ready(repost = true) { const e = await xPageAutomaticFixture({ repost }); cleanups.push(e.close); return e; }
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const zero = "0".repeat(64), revoked = "X_PAGE_AUTOMATIC_FENCE_REVOKED";

// All denials/releases below use the real owner handoff, gateway transaction,
// permits and immutable receipt table. No authorizer bypass after setup.
function writeFence(e: Environment, scope: Scope, fenceKind: FenceKind, options: Readonly<{
  state?: "blocked" | "unknown" | "clear"; reason?: string; observedAt?: string; expiresAt?: string; publicationId?: string;
}> = {}) {
  const proof = readXPageCaptureCommitment(e.database, e.target, e.now());
  const scopeKind = scope === "observed" || scope === "unrelated" ? "source" : scope;
  const scopeId = scope === "global" ? null : scope === "observed" || scope === "unrelated" ? "x_mclarenf1"
    : scope === "source" ? "x_f1" : scope === "candidate" ? e.target.candidateId : options.publicationId!;
  const state = options.state ?? "blocked", observedAt = options.observedAt ?? e.now().toISOString();
  const reason = options.reason ?? (state === "clear" ? "EXPLICIT_SCOPED_RELEASE" : "EXPLICIT_SCOPED_DENIAL");
  const seed = hash({ scopeKind, scopeId, fenceKind, state, observedAt, reason }), operationId = `test-scoped-${seed}`, fenceId = `test-fence-${seed}`;
  e.supervisorPort.runTransaction({ operationId, operationKind: "system_producer", ownerProcess: "system_supervisor",
    policyId: "p-x-page-fence-live", capabilityClass: "control", egressClass: "none", controlAction: "fence_update",
    identity: { sourceId: "x_f1", candidateId: e.target.candidateId, publicationId: null, publicId: null },
    entitySet: [...xPageAutomaticContentBindings(proof, e.target), { entityKind: "generic_fence", entityId: fenceId,
      identitySelector: "bound_child", expectedVersion: null, expectedHash: zero }], requiredFenceSet: [],
    sourceStopEpoch: Number(proof.source.stop_epoch), requestHash: seed }, mutate => {
    const control = e.database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get()!;
    expect(mutate({ entityKind: "generic_fence", entityId: fenceId, mutationKind: "insert", expectedVersion: null, expectedHash: zero,
      statement: "INSERT INTO generic_fence_receipt VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", parameters: [fenceId, scopeKind, scopeId, fenceKind,
        state, reason, "f1plus1-system-supervisor-v1", operationId, Buffer.from(seed, "hex").toString("base64url"), seed,
        control.policy_epoch, control.recovery_epoch, control.writer_epoch, observedAt,
        options.expiresAt ?? new Date(e.now().getTime() + 900_000).toISOString()] })).toBe(1);
  });
  expect(e.database.prepare("SELECT state FROM internal_operation WHERE operation_id=?").get(operationId)?.state).toBe("succeeded");
  return e.database.prepare("SELECT * FROM generic_fence_receipt WHERE fence_receipt_id=?").get(fenceId)!;
}
function count(e: Environment, table: "machine_summary_draft" | "review_decision" | "publication" | "projection_outbox") {
  return Number(e.database.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);
}
function expectNoPublication(e: Environment) { expect(count(e, "projection_outbox")).toBe(0); expect(e.database.prepare("SELECT 1 FROM publication WHERE publication_status='published'").get()).toBeUndefined(); }

describe("current X scoped fences across real gateway boundaries", () => {
  test.each(cases)("%s/%s blocks payment/review/publication until an explicit release, retaining the denial", async (scope, kind) => {
    const e = await ready(), delivery = xPageProjectionSender(e); issueXPageAutomaticFences(e); e.advanceNow(1000);
    const denial = writeFence(e, scope, kind); e.advanceNow(1000);
    const fenceCount = e.database.prepare("SELECT count(*) n FROM generic_fence_receipt").get()!.n;
    expect(() => issueXPageAutomaticFences(e)).toThrow(revoked);
    expect(e.database.prepare("SELECT count(*) n FROM generic_fence_receipt").get()!.n).toBe(fenceCount);
    const blocked = await runXPageAutomaticCycle(e);
    expect(blocked).toMatchObject({ status: "blocked", reasonCode: revoked, refined: 0, approved: 0, published: 0 });
    expect(e.modelCalls).toBe(0); expect(count(e, "machine_summary_draft")).toBe(0); expect(count(e, "review_decision")).toBe(0);
    expect(count(e, "publication")).toBe(0); expectNoPublication(e);
    await delivery.sender.tick(); expect(delivery.counts()).toEqual({ posts: 0, gets: 0 });
    e.advanceNow(1000); writeFence(e, scope, kind, { state: "clear" }); e.advanceNow(1000);
    expect(await runXPageAutomaticCycle(e)).toMatchObject({ refined: 1, approved: 1, published: 1 });
    expect(e.modelCalls).toBe(1); expect(await delivery.sender.tick()).toMatchObject({ outcome: "succeeded" });
    expect(delivery.counts()).toEqual({ posts: 1, gets: 0 });
    expect(e.database.prepare("SELECT * FROM generic_fence_receipt WHERE fence_receipt_id=?").get(String(denial.fence_receipt_id))).toEqual(denial);
  });

  test.each([X_PAGE_AUTOMATIC_FENCE_REASON, X_PAGE_COMMITTED_DELIVERY_FENCE_REASON])("a later automatic %s clear cannot erase a denial", async reason => {
    const e = await ready(); issueXPageAutomaticFences(e); e.advanceNow(1000); writeFence(e, "source", "deletion"); e.advanceNow(1000);
    writeFence(e, "source", "deletion", { state: "clear", reason });
    expect(await runXPageAutomaticCycle(e)).toMatchObject({ reasonCode: revoked, approved: 0, published: 0 }); expect(e.modelCalls).toBe(0);
  });

  test("expired and unknown denials remain closed; older, equal-time, future and wrong-scope releases do not unblock them", async () => {
    const e = await ready(); issueXPageAutomaticFences(e); e.advanceNow(1000);
    const observedAt = e.now().toISOString(); writeFence(e, "source", "deletion", { state: "unknown", expiresAt: new Date(e.now().getTime() + 1000).toISOString() });
    writeFence(e, "source", "deletion", { state: "clear", observedAt: new Date(e.now().getTime() - 1).toISOString() });
    writeFence(e, "source", "deletion", { state: "clear", observedAt });
    writeFence(e, "source", "deletion", { state: "clear", observedAt: new Date(e.now().getTime() + 60_000).toISOString() });
    e.advanceNow(2000); writeFence(e, "candidate", "deletion", { state: "clear" });
    expect(await runXPageAutomaticCycle(e)).toMatchObject({ reasonCode: revoked, published: 0 }); expect(e.modelCalls).toBe(0);
    e.advanceNow(1000); writeFence(e, "source", "deletion", { state: "clear" });
    // A late-arriving older observation stays historical after the release.
    writeFence(e, "source", "deletion", { observedAt, reason: "OLDER_DENIAL_RECORDED_LATER" });
    expect(await runXPageAutomaticCycle(e)).toMatchObject({ published: 1 }); expect(e.modelCalls).toBe(1);
    e.advanceNow(1000); writeFence(e, "source", "deletion");
    expect(() => issueXPageAutomaticFences(e)).toThrow(revoked);
  });

  test.each(["deletion", "publication", "completeness", "rights", "media"] as const)("publication/%s blocks its queued publication and allows explicit recovery", async kind => {
    const e = await ready(); issueXPageAutomaticFences(e); await e.refine(); const reviewed = e.reviewer.reviewXPageAutomaticCandidate(e.target);
    issueXPageAutomaticFences({ ...e, publicationId: reviewed.publicationId }); e.advanceNow(1000);
    writeFence(e, "publication", kind, { publicationId: reviewed.publicationId }); e.advanceNow(1000);
    expect(() => e.publisher.publishXPageAutomaticCandidate(e.target)).toThrow(revoked);
    expect(await runXPageAutomaticCycle(e)).toMatchObject({ reasonCode: revoked, published: 0 }); expect(e.modelCalls).toBe(1); expectNoPublication(e);
    e.advanceNow(1000); writeFence(e, "publication", kind, { publicationId: reviewed.publicationId, state: "clear" });
    expect(await runXPageAutomaticCycle(e)).toMatchObject({ published: 1 }); expect(e.modelCalls).toBe(1);
  });

  test("block arriving after model storage prevents review with no second model call", async () => {
    const e = await ready();
    const result = await runXPageAutomaticCycle({ ...e, refine: async target => {
      const receipt = await e.refine(target); e.advanceNow(1000); writeFence(e, "observed", "rights"); return receipt;
    } });
    expect(result).toMatchObject({ reasonCode: null, refined: 1, approved: 0, published: 0 });
    expect(result.items[0].reasonCode).toBe(revoked); expect(e.modelCalls).toBe(1); expect(count(e, "review_decision")).toBe(0); expectNoPublication(e);
  });

  test.each(["bilingual_refiner", "automatic_reviewer", "automatic_publisher"] as const)("block after %s request is checked at authorization", async owner => {
    const e = await ready(), authorize = e.gateway.authorize.bind(e.gateway); let injected = false, deniedOperationId = "";
    vi.spyOn(e.gateway, "authorize").mockImplementation(capability => {
      if (!injected && capability.ownerProcess === owner) { injected = true; deniedOperationId = capability.operationId; e.advanceNow(1000); writeFence(e, "source", "rights"); }
      return authorize(capability);
    });
    const result = await runXPageAutomaticCycle(e); expect(injected).toBe(true); expect(result.items[0].reasonCode).toBe(revoked);
    expect(e.database.prepare("SELECT state FROM internal_operation WHERE operation_id=?").get(deniedOperationId)?.state).toBe("requested");
    expect(e.database.prepare("SELECT 1 FROM internal_external_attempt WHERE operation_id=?").get(deniedOperationId)).toBeUndefined();
    expect(e.modelCalls).toBe(owner === "bilingual_refiner" ? 0 : 1); expect(result.approved).toBe(owner === "automatic_publisher" ? 1 : 0);
    expect(result.published).toBe(0); expectNoPublication(e);
  });

  test.each(["automatic_reviewer", "automatic_publisher"] as const)("block after %s authorization is checked in the actual write transaction", async owner => {
    const e = await ready(), transaction = e.gateway.runMutationTransaction.bind(e.gateway); let injected = false, callbackEntered = false;
    vi.spyOn(e.gateway, "runMutationTransaction").mockImplementation(<T,>(capability: OperationCapability, callback: (mutate: (input: GatewayWriteInput) => number) => T): T => {
      if (!injected && capability.ownerProcess === owner) { injected = true; e.advanceNow(1000); writeFence(e, "global", "deletion"); }
      return transaction(capability, mutate => { if (capability.ownerProcess === owner) callbackEntered = true; return callback(mutate); });
    });
    const result = await runXPageAutomaticCycle(e); expect(injected).toBe(true); expect(callbackEntered).toBe(false); expect(result.items[0].reasonCode).toBe(revoked);
    expect(e.modelCalls).toBe(1); expect(result.approved).toBe(owner === "automatic_publisher" ? 1 : 0); expect(result.published).toBe(0); expectNoPublication(e);
  });

  test("a block after the model attempt starts is checked again before entering paid transport", async () => {
    const e = await ready(), started = e.gateway.markAttemptStarted.bind(e.gateway); let injected = false;
    vi.spyOn(e.gateway, "markAttemptStarted").mockImplementation(handle => {
      const value = started(handle);
      if (!injected) { injected = true; e.advanceNow(1000); writeFence(e, "observed", "rights"); }
      return value;
    });
    expect(await runXPageAutomaticCycle(e)).toMatchObject({ reasonCode: revoked, approved: 0, published: 0 });
    expect(e.modelCalls).toBe(0); expect(count(e, "machine_summary_draft")).toBe(0); expectNoPublication(e);
    // The gateway's started attempt remains unresolved, never silently retried.
    expect(e.database.prepare("SELECT state FROM internal_external_attempt").get()?.state).toBe("reconcile_required");
    e.advanceNow(1000); writeFence(e, "observed", "rights", { state: "clear" });
    expect(await runXPageAutomaticCycle(e)).toMatchObject({ published: 0 }); expect(e.modelCalls).toBe(0);
  });

  test("the publish transaction postcheck rolls back publication if its atomic unit also records a denial", async () => {
    const e = await ready(); issueXPageAutomaticFences(e); await e.refine(); const reviewed = e.reviewer.reviewXPageAutomaticCandidate(e.target);
    issueXPageAutomaticFences({ ...e, publicationId: reviewed.publicationId }); e.advanceNow(1000);
    const transaction = e.gateway.runMutationTransaction.bind(e.gateway); let injected = false;
    vi.spyOn(e.gateway, "runMutationTransaction").mockImplementation(<T,>(capability: OperationCapability, callback: (mutate: (input: GatewayWriteInput) => number) => T): T =>
      transaction(capability, mutate => {
        const result = callback(mutate);
        if (capability.ownerProcess === "automatic_publisher") { writeFence(e, "source", "deletion"); injected = true; }
        return result;
      }));
    expect(() => e.gateway.runAtomicAdmission(() => e.publisher.publishXPageAutomaticCandidate(e.target))).toThrow(revoked);
    expect(injected).toBe(true); expectNoPublication(e);
    expect(e.database.prepare("SELECT publication_status FROM publication WHERE publication_id=?").get(reviewed.publicationId)?.publication_status).toBe("queued");
  });

  test.each(["source", "publication"] as const)("a post-publication %s block survives automatic renewal until explicit release", async scope => {
    const e = await ready(), delivery = xPageProjectionSender(e), cycle = await runXPageAutomaticCycle(e);
    expect(cycle.published).toBe(1);
    const outbox = e.database.prepare("SELECT publication_id,task_envelope_hash,task_envelope_json FROM projection_outbox WHERE delivery_id=?").get(cycle.deliveryId!)!;
    const publicationId = String(outbox.publication_id); e.advanceNow(1000); const denial = writeFence(e, scope, "deletion", { publicationId });
    e.advanceNow(1000); writeFence(e, scope, "deletion", { state: "clear", reason: X_PAGE_COMMITTED_DELIVERY_FENCE_REASON, publicationId });
    expect(() => prepareXPageAutomaticDelivery(e)).toThrow("X_PAGE_DELIVERY_FENCE_REVOKED");
    await expect(delivery.sender.tick()).rejects.toThrow("X_PAGE_DELIVERY_FENCE_REVOKED"); expect(delivery.counts()).toEqual({ posts: 0, gets: 0 });
    expect(e.database.prepare("SELECT status FROM projection_outbox WHERE delivery_id=?").get(cycle.deliveryId!)?.status).toBe("pending");
    e.advanceNow(1000); writeFence(e, scope, "deletion", { state: "clear", publicationId });
    expect(await delivery.sender.tick()).toMatchObject({ outcome: "succeeded" }); expect(delivery.counts()).toEqual({ posts: 1, gets: 0 });
    expect(e.database.prepare("SELECT publication_id,task_envelope_hash,task_envelope_json FROM projection_outbox WHERE delivery_id=?").get(cycle.deliveryId!)).toEqual(outbox);
    expect(e.database.prepare("SELECT * FROM generic_fence_receipt WHERE fence_receipt_id=?").get(String(denial.fence_receipt_id))).toEqual(denial);
  });

  test("an unrelated source denial does not stop this X author", async () => {
    const e = await ready(false); issueXPageAutomaticFences(e); e.advanceNow(1000);
    writeFence(e, "unrelated", "rights"); expect(await runXPageAutomaticCycle(e)).toMatchObject({ published: 1 }); expect(e.modelCalls).toBe(1);
  });

  test("blocked X does not occupy the shared outbox or stop the existing RSS chain", async () => {
    const e = await ready(), delivery = xPageProjectionSender(e); issueXPageAutomaticFences(e); e.advanceNow(1000); writeFence(e, "source", "deletion");
    expect(await runXPageAutomaticCycle(e)).toMatchObject({ published: 0 }); expect(e.modelCalls).toBe(0); expectNoPublication(e);
    const rss = { ...e, target: e.rssTarget }; issueRssAutomaticFences(rss); let rssCalls = 0;
    await refineOneCandidate({ database: e.database, mutationPort: e.port("rss_refiner"), target: e.rssTarget, apiKeyPath: e.keyPath,
      budgetAccountId: "acct-rss", now: e.now, fetchImpl: async () => { rssCalls++; return new Response(JSON.stringify({ choices: [{ message: {
        content: JSON.stringify({ titleZh: "现有RSS中文标题", summaryZh: "这条现有RSS新闻继续使用原有审核和公开字段。", keyPointsZh: ["独立来源继续处理"] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 12 } }), { status: 200 }); } });
    const reviewed = e.reviewer.reviewAutomaticCandidate(e.rssTarget); issueRssAutomaticFences({ ...rss, publicationId: reviewed.publicationId });
    expect(e.publisher.publishAutomaticCandidate(e.rssTarget)).toMatchObject({ kind: "publish", generation: 1 }); expect(rssCalls).toBe(1);
    expect(await delivery.sender.tick()).toMatchObject({ outcome: "succeeded" });
    expect(delivery.counts()).toEqual({ posts: 1, gets: 0 });
  });
});
