import { refineModelById, type RefineModelId } from "../rss/refine-model.ts";

export const MODEL_PROBE_TIMEOUT_MS = 6000;
export const MODEL_PROBE_MAX_BYTES = 16 * 1024;
export type ModelProbeResult = Readonly<{ status: "verified" | "failed"; reasonCode: string | null }>;
export type ModelProviderProbe = (modelId: RefineModelId, apiKey: string) => Promise<ModelProbeResult>;

/** Fixed provider destinations and a trivial probe; no candidate text, redirects, retries, or raw provider errors. */
export async function probeModelProvider(modelId: RefineModelId, apiKey: string, fetcher: typeof fetch = fetch): Promise<ModelProbeResult> {
  const model = refineModelById(modelId);
  if (!model.apiKeyPattern.test(apiKey)) return { status: "failed", reasonCode: "CREDENTIAL_FORMAT_INVALID" };
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const failed = (reasonCode: string): ModelProbeResult => ({ status: "failed", reasonCode });
  const work = async (): Promise<ModelProbeResult> => {
    try {
      const response = await fetcher(model.endpoint, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "Reply OK." }], max_tokens: 16, stream: false,
          ...(modelId === "glm-5.3-flash" ? { reasoning_effort: "low" } : {}) })
      });
      if (expired) { void response.body?.cancel().catch(() => {}); return failed("CREDENTIAL_PROVIDER_TIMEOUT"); }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        return failed(response.status === 401 || response.status === 403 ? "CREDENTIAL_PROVIDER_AUTH_REJECTED" :
          response.status === 429 ? "CREDENTIAL_PROVIDER_RATE_LIMITED" : "CREDENTIAL_PROVIDER_REJECTED");
      }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MODEL_PROBE_MAX_BYTES)) {
        void response.body?.cancel().catch(() => {}); return failed("CREDENTIAL_PROVIDER_RESPONSE_INVALID");
      }
      if (!response.body) return failed("CREDENTIAL_PROVIDER_RESPONSE_INVALID");
      reader = response.body.getReader();
      let total = 0;
      const chunks: Uint8Array[] = [];
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > MODEL_PROBE_MAX_BYTES) { void reader.cancel().catch(() => {}); return failed("CREDENTIAL_PROVIDER_RESPONSE_INVALID"); }
        chunks.push(chunk.value);
      }
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as { choices?: { message?: { role?: string; content?: unknown; reasoning_content?: unknown } }[]; error?: unknown };
      const message = value.choices?.[0]?.message;
      if (value.error !== undefined || !Array.isArray(value.choices) || value.choices.length !== 1 || message?.role !== "assistant" ||
        ![message.content, message.reasoning_content].some(text => typeof text === "string" && text.trim().length > 0)) return failed("CREDENTIAL_PROVIDER_RESPONSE_INVALID");
      return { status: "verified", reasonCode: null };
    } catch { return failed(expired ? "CREDENTIAL_PROVIDER_TIMEOUT" : "CREDENTIAL_PROVIDER_UNAVAILABLE"); }
  };
  try {
    return await Promise.race([work(), new Promise<ModelProbeResult>(resolve => {
      timer = setTimeout(() => { expired = true; controller.abort(); void reader?.cancel().catch(() => {}); resolve(failed("CREDENTIAL_PROVIDER_TIMEOUT")); }, MODEL_PROBE_TIMEOUT_MS);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
}
