import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StartedAttemptHandle } from "../server/internal-operation/gateway.ts";
import type { GatewayExternalAttemptInput, GatewayMutationPort } from "../server/internal-operation/mutation-port.ts";
import { createXPageModelGateway, X_PAGE_MODEL_RESPONSE_LIMIT, X_PAGE_MODEL_TIMEOUT_MS } from "../server/x-page/model-transport.ts";
import { refineModelById } from "../server/rss/refine-model.ts";
import { xCaptureSha256 } from "../server/x-page/trusted-capture.ts";

const roots: string[] = [];
afterEach(() => { vi.useRealTimers(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function setup(fetcher: typeof fetch = vi.fn(async () => new Response("{}"))) {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "f1-x-model-contract-"))); roots.push(root); chmodSync(root, 0o700);
  const key = "sk-" + "SYNTHETIC_TEST_ONLY_KEY_".repeat(2);
  writeFileSync(join(root, "deepseek-api-key"), key, { mode: 0o600 });
  let entries = 0;
  const handle = Object.freeze({ operationId: "synthetic-x-model", attemptId: "synthetic-attempt", attemptNumber: 1,
    attemptNonce: "synthetic-nonce", canonicalRequestSha256: "a".repeat(64), requestFingerprintSha256: "b".repeat(64),
    reconcileIdentitySha256: "c".repeat(64), capabilitySecret: "SYNTHETIC_ONLY", startedAt: "2026-09-07T00:00:00.000Z" }) as StartedAttemptHandle;
  const underlying: Required<Pick<GatewayMutationPort, "runExternal">> = {
    async runExternal<T>(request: GatewayExternalAttemptInput<T>): Promise<T> { entries++; return (await request.execute(handle)).value; },
  };
  const gateway = createXPageModelGateway({ externalPort: underlying, privateDir: root, fetcher });
  const model = refineModelById("deepseek-chat"), body = '{"synthetic":true}', bodySha256 = xCaptureSha256(body);
  const complete = (h = handle, overrides = {}) => gateway.modelTransport.complete({ handle: h, modelId: model.modelId, endpoint: model.endpoint, body, bodySha256, ...overrides });
  async function run(callback: (handle: StartedAttemptHandle) => Promise<Readonly<{ status: number; rawResponse: string }>> = complete, overrides = {}) {
    const input = { operationId: handle.operationId, operationKind: "refine", ownerProcess: "bilingual_refiner", policyId: "p-x-page-refine-live",
      endpointClass: "model_refine", providerResource: model.modelId, routeId: model.routeId, method: "POST", bodySha256,
      modelRouteRef: model.modelId, egressClass: "model_https", identity: { sourceId: "x_f1", candidateId: "synthetic", publicationId: null, publicId: null },
      externalIdempotencyKey: "synthetic-model", reconcileKey: "synthetic-model-reconcile", entityKind: "candidate", entityId: "synthetic",
      execute: async (h: StartedAttemptHandle) => ({ value: await callback(h), response: { providerResourceIdentity: model.endpoint,
        providerStatus: "200", responseBodySha256: xCaptureSha256("{}"), responseHeaderHashes: [], outcome: "succeeded", reasonCode: null } }), ...overrides };
    return gateway.externalPort.runExternal(input as GatewayExternalAttemptInput<unknown>);
  }
  return { root, key, handle, model, complete, run, gateway, fetcher, get entries() { return entries; } };
}
describe("single-use X model HTTP grant", () => {
  it("uses the saved credential, fixed catalog URL and one bounded POST", async () => {
    const env = setup(); expect(await env.run()).toEqual({ status: 200, rawResponse: "{}" });
    expect(env.fetcher).toHaveBeenCalledTimes(1);
    expect(env.fetcher).toHaveBeenCalledWith(env.model.endpoint, expect.objectContaining({ method: "POST", redirect: "error",
      headers: expect.objectContaining({ Authorization: `Bearer ${env.key}` }) }));
    await expect(env.complete()).rejects.toThrow("GRANT_REQUIRED");
  });
  it("rejects fabricated/copied handles without consuming the real handle", async () => {
    const env = setup(); await expect(env.complete()).rejects.toThrow("GRANT_REQUIRED");
    await env.run(async handle => { await expect(env.complete({ ...handle })).rejects.toThrow("GRANT_REQUIRED"); return env.complete(handle); });
    expect(env.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([ { body: "changed" }, { bodySha256: "f".repeat(64) }, { endpoint: "https://invalid.example" },
    { modelId: "glm-5.3-flash" }, { body: "x".repeat(256 * 1024 + 1) } ])("consumes malformed first use before any network: %j", async overrides => {
    const env = setup(); await env.run(async handle => {
      await expect(env.complete(handle, overrides)).rejects.toThrow("REQUEST_MISMATCH");
      await expect(env.complete(handle)).rejects.toThrow("GRANT_REQUIRED"); return { status: 200, rawResponse: "{}" };
    }); expect(env.fetcher).not.toHaveBeenCalled();
  });
  it("concurrent calls create at most one POST", async () => {
    const env = setup(); await env.run(async handle => {
      const outcomes = await Promise.allSettled([env.complete(handle), env.complete(handle)]);
      expect(outcomes.map(item => item.status)).toEqual(["fulfilled", "rejected"]); return { status: 200, rawResponse: "{}" };
    }); expect(env.fetcher).toHaveBeenCalledTimes(1);
  });
  it("revokes unused grants when callback exits and rejects callback handle replay", async () => {
    const env = setup(); await env.run(async () => ({ status: 200, rawResponse: "unused" }));
    await expect(env.complete()).rejects.toThrow("GRANT_REQUIRED");
    await expect(env.run()).rejects.toThrow("CALLBACK_REPLAY"); expect(env.fetcher).not.toHaveBeenCalled();
  });
  it.each(["key-missing", "key-invalid", "key-permission", "config-changed", "wrong-policy", "wrong-route"])("checks %s before recording an attempt", async part => {
    const env = setup(); let overrides = {};
    if (part === "key-missing") rmSync(join(env.root, "deepseek-api-key"));
    else if (part === "key-invalid") writeFileSync(join(env.root, "deepseek-api-key"), "bad");
    else if (part === "key-permission") chmodSync(join(env.root, "deepseek-api-key"), 0o644);
    else if (part === "config-changed") writeFileSync(join(env.root, "refinement-model.json"), JSON.stringify({ schemaVersion: "refinement-model-v1", modelId: "glm-5.3-flash", updatedAt: "2026-09-07T00:00:00.000Z" }), { mode: 0o600 });
    else overrides = part === "wrong-policy" ? { policyId: "p-rss-refine" } : { routeId: "route-glm" };
    await expect(env.run(undefined, overrides)).rejects.toThrow(); expect(env.entries).toBe(0); expect(env.fetcher).not.toHaveBeenCalled();
  });
  it("preserves a known HTTP failure as one response without retry", async () => {
    const env = setup(vi.fn(async () => new Response("limited", { status: 429 })));
    expect(await env.run()).toEqual({ status: 429, rawResponse: "limited" }); expect(env.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["redirect", "length", "stream-size", "encoding"])("rejects invalid %s responses and does not retry", async kind => {
    const env = setup(vi.fn(async () => kind === "redirect" ? new Response("redirect", { status: 302 })
      : kind === "length" ? new Response("{}", { headers: { "content-length": String(X_PAGE_MODEL_RESPONSE_LIMIT + 1) } })
      : kind === "stream-size" ? new Response("x".repeat(X_PAGE_MODEL_RESPONSE_LIMIT + 1)) : new Response(new Uint8Array([0xc3, 0x28]))));
    await expect(env.run()).rejects.toThrow(/^X_MODEL_RESPONSE_/); expect(env.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["headers", "body"])("bounds stalled %s by 30 seconds and aborts", async stage => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined; const cancelled = vi.fn();
    const env = setup(vi.fn(async (_url, options) => { signal = options?.signal as AbortSignal;
      if (stage === "headers") return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("prefix")); }, cancel: cancelled }));
    }));
    const result = env.run(); const assertion = expect(result).rejects.toThrow("X_MODEL_TRANSPORT_TIMEOUT");
    await vi.advanceTimersByTimeAsync(X_PAGE_MODEL_TIMEOUT_MS); await assertion;
    expect(signal?.aborted).toBe(true); if (stage === "body") expect(cancelled).toHaveBeenCalled();
    expect(env.fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not expose raw network errors containing credential or response content", async () => {
    const env = setup(vi.fn(async () => { throw new Error("sk-SECRET_RAW_NETWORK_BODY"); }));
    await expect(env.run()).rejects.toThrow(/^X_MODEL_TRANSPORT_UNAVAILABLE$/);
  });
});
