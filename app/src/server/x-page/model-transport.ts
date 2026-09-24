import { join } from "node:path";

import type { StartedAttemptHandle } from "../internal-operation/gateway.ts";
import type { GatewayExternalAttemptInput, GatewayMutationPort } from "../internal-operation/mutation-port.ts";
import { readRefinementModelConfig, readRefineModelApiKey, refineModelById, type RefineModelId } from "../rss/refine-model.ts";
import type { XPageModelTransport } from "./refinement.ts";
import { xCaptureSha256 } from "./trusted-capture.ts";

export const X_PAGE_MODEL_TIMEOUT_MS = 30_000;
export const X_PAGE_MODEL_RESPONSE_LIMIT = 128 * 1024;
const REQUEST_LIMIT = 256 * 1024;
const RESPONSE_ERRORS = new Set(["X_MODEL_TRANSPORT_TIMEOUT", "X_MODEL_RESPONSE_STATUS_INVALID",
  "X_MODEL_RESPONSE_TOO_LARGE", "X_MODEL_RESPONSE_EMPTY", "X_MODEL_RESPONSE_ENCODING_INVALID"]);
type ExternalPort = Required<Pick<GatewayMutationPort, "runExternal">>;
type Lease = {
  modelId: RefineModelId;
  endpoint: string;
  bodySha256: string;
  key: string;
  used: boolean;
  controller: AbortController | null;
};
function assert(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }

/** Runtime construction only: externalPort must be the verified runtime's real
 * gateway port. It cannot be selected by a capture file, HTTP request or CLI flag.
 * Credentials are checked before the gateway records a paid attempt. The model
 * transport receives a single-use grant only during that gateway's execute call.
 */
export function createXPageModelGateway(input: Readonly<{
  externalPort: ExternalPort;
  privateDir: string;
  fetcher?: typeof fetch;
}>): Readonly<{ externalPort: ExternalPort; modelTransport: XPageModelTransport }> {
  assert(typeof input.externalPort?.runExternal === "function", "X_MODEL_GATEWAY_REQUIRED");
  const fetcher = input.fetcher ?? fetch;
  const leases = new WeakMap<StartedAttemptHandle, Lease>();
  const seen = new WeakSet<StartedAttemptHandle>();

  const modelTransport: XPageModelTransport = Object.freeze({
    async complete(request) {
      const lease = leases.get(request.handle);
      assert(lease && !lease.used, "X_MODEL_ATTEMPT_GRANT_REQUIRED");
      // Consume before validation, await or network; a malformed first use cannot
      // be corrected into a second send under the same recorded attempt.
      lease.used = true;
      assert(request.modelId === lease.modelId && request.endpoint === lease.endpoint
        && request.bodySha256 === lease.bodySha256 && typeof request.body === "string"
        && Buffer.byteLength(request.body) <= REQUEST_LIMIT && xCaptureSha256(request.body) === lease.bodySha256,
      "X_MODEL_ATTEMPT_REQUEST_MISMATCH");
      const controller = new AbortController(); lease.controller = controller;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let expired = false;
      const cancel = () => { controller.abort(); void reader?.cancel().catch(() => {}); };
      const work = async (): Promise<Readonly<{ status: number; rawResponse: string }>> => {
        try {
          const response = await fetcher(lease.endpoint, {
            method: "POST", redirect: "error", signal: controller.signal,
            headers: { Authorization: `Bearer ${lease.key}`, "Content-Type": "application/json", Accept: "application/json" },
            body: request.body,
          });
          if (expired || controller.signal.aborted) {
            void response.body?.cancel().catch(() => {}); throw new Error("X_MODEL_TRANSPORT_TIMEOUT");
          }
          if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 600
            || response.status >= 300 && response.status < 400 || response.redirected) {
            void response.body?.cancel().catch(() => {}); throw new Error("X_MODEL_RESPONSE_STATUS_INVALID");
          }
          const size = response.headers.get("content-length");
          if (size !== null && (!/^\d+$/.test(size) || Number(size) > X_PAGE_MODEL_RESPONSE_LIMIT)) {
            void response.body?.cancel().catch(() => {}); throw new Error("X_MODEL_RESPONSE_TOO_LARGE");
          }
          assert(response.body, "X_MODEL_RESPONSE_EMPTY");
          reader = response.body.getReader();
          let total = 0; const chunks: Uint8Array[] = [];
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > X_PAGE_MODEL_RESPONSE_LIMIT) {
              void reader.cancel().catch(() => {}); throw new Error("X_MODEL_RESPONSE_TOO_LARGE");
            }
            chunks.push(part.value);
          }
          assert(!expired && !controller.signal.aborted, "X_MODEL_TRANSPORT_TIMEOUT");
          let rawResponse: string;
          try { rawResponse = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
          catch { throw new Error("X_MODEL_RESPONSE_ENCODING_INVALID"); }
          return Object.freeze({ status: response.status, rawResponse });
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          throw new Error(expired ? "X_MODEL_TRANSPORT_TIMEOUT" : RESPONSE_ERRORS.has(code) ? code : "X_MODEL_TRANSPORT_UNAVAILABLE");
        }
      };
      try {
        return await Promise.race([work(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { expired = true; cancel(); reject(new Error("X_MODEL_TRANSPORT_TIMEOUT")); }, X_PAGE_MODEL_TIMEOUT_MS);
        })]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        cancel(); lease.controller = null;
      }
    },
  });

  const externalPort: ExternalPort = Object.freeze({
    async runExternal<T>(request: GatewayExternalAttemptInput<T>): Promise<T> {
      assert(request.ownerProcess === "bilingual_refiner" && request.operationKind === "refine"
        && request.policyId === "p-x-page-refine-live" && request.endpointClass === "model_refine"
        && request.egressClass === "model_https" && request.method === "POST"
        && (request.query?.length ?? 0) === 0 && typeof request.bodySha256 === "string"
        && /^[0-9a-f]{64}$/.test(request.bodySha256), "X_MODEL_GATEWAY_REQUEST_INVALID");
      const model = refineModelById(request.providerResource);
      assert(model.persistMachineSummaryDraft && request.routeId === model.routeId && request.modelRouteRef === model.modelId,
        "X_MODEL_GATEWAY_MODEL_INVALID");
      const saved = readRefinementModelConfig(join(input.privateDir, "refinement-model.json"));
      assert(saved.modelId === model.modelId, "X_MODEL_CONFIG_CHANGED");
      let key = readRefineModelApiKey(join(input.privateDir, model.keyFileName), model.modelId);
      let callbackEntered = false;
      try {
        return await input.externalPort.runExternal({ ...request, execute: async handle => {
          assert(!callbackEntered && !seen.has(handle), "X_MODEL_GATEWAY_CALLBACK_REPLAY");
          callbackEntered = true; seen.add(handle);
          assert(handle.operationId === request.operationId && Number.isSafeInteger(handle.attemptNumber)
            && handle.attemptNumber > 0 && Number.isFinite(Date.parse(handle.startedAt)), "X_MODEL_STARTED_HANDLE_INVALID");
          const lease: Lease = { modelId: model.modelId, endpoint: model.endpoint,
            bodySha256: request.bodySha256!, key, used: false, controller: null };
          leases.set(handle, lease);
          try { return await request.execute(handle); }
          finally { leases.delete(handle); lease.controller?.abort(); lease.key = ""; }
        } });
      } finally { key = ""; }
    },
  });
  return Object.freeze({ externalPort, modelTransport });
}
