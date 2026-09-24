import { afterEach, describe, expect, it, vi } from "vitest";
import { MODEL_PROBE_TIMEOUT_MS, probeModelProvider } from "../server/admin-service/model-provider-probe.ts";

const key = `sk-${"T".repeat(24)}`;
const valid = { choices: [{ message: { role: "assistant", content: "OK" } }] };
afterEach(() => vi.useRealTimers());
describe("bounded fixed-provider credential probe", () => {
  it("uses only the catalog endpoint, minimal request, and redirect error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(valid));
    expect(await probeModelProvider("deepseek-chat", key, fetcher)).toEqual({ status: "verified", reasonCode: null });
    const [url, init] = fetcher.mock.calls[0]; expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: `Bearer ${key}` } });
    expect(JSON.parse(String(init?.body))).toEqual({ model: "deepseek-chat", messages: [{ role: "user", content: "Reply OK." }], max_tokens: 16, stream: false });
  });
  it.each([401, 403, 429, 500, 302])("returns a closed error for provider HTTP %s and no raw body", async status => {
    const result = await probeModelProvider("deepseek-chat", key, async () => new Response(key, { status }));
    expect(result.status).toBe("failed"); expect(JSON.stringify(result)).not.toContain(key);
  });
  it.each(["oversized", "invalid-json", "invalid-envelope", "provider-error", "truncated-stream"])("rejects %s responses", async kind => {
    const body = kind === "oversized" ? "a".repeat(16 * 1024 + 1) : kind === "invalid-json" ? "{" : kind === "invalid-envelope" ? "{}" : kind === "provider-error" ? JSON.stringify({ ...valid, error: key }) : null;
    const response = body === null ? new Response(new ReadableStream({ start(controller) { controller.error(new Error(key)); } })) : new Response(body);
    const result = await probeModelProvider("deepseek-chat", key, async () => response); expect(result.status).toBe("failed"); expect(JSON.stringify(result)).not.toContain(key);
  });
  it.each(["headers", "body"])("bounds total time when %s never completes", async stage => {
    vi.useFakeTimers();
    const fetcher: typeof fetch = stage === "headers" ? () => new Promise(() => {}) : async () => new Response(new ReadableStream({ start() {} }));
    const result = probeModelProvider("deepseek-chat", key, fetcher); await vi.advanceTimersByTimeAsync(MODEL_PROBE_TIMEOUT_MS);
    expect(await result).toEqual({ status: "failed", reasonCode: "CREDENTIAL_PROVIDER_TIMEOUT" });
  });
  it("accepts a bounded reasoning reply for the GLM probe and never claims draft persistence", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { role: "assistant", content: "", reasoning_content: "OK" } }] }));
    expect((await probeModelProvider("glm-5.3-flash", `${"G".repeat(20)}.${"g".repeat(12)}`, fetcher)).status).toBe("verified");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ model: "glm-5.3-flash", reasoning_effort: "low", max_tokens: 16 });
  });
});
