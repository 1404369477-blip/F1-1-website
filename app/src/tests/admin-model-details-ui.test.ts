import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../admin-ui/settings.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../admin-ui/settings.js", import.meta.url), "utf8");
const MODEL_PATH = "/api/admin/settings/refinement-model";
const KEY_PATH = "/api/admin/settings/model-credentials";
const fixtureKey = `sk-${"F".repeat(24)}`;
const modelIds = ["deepseek-chat", "glm-5.3-flash"] as const;

type ResponseStub = { ok: boolean; status: number; json(): Promise<unknown> };
type RequestLog = { path: string; method: string; body: Record<string, unknown> | undefined; headers?: Record<string, string> };
const response = (body: unknown, status = 200): ResponseStub => ({ ok: status < 400, status, json: async () => body });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

async function harness(options: {
  active?: string;
  beforePasskey?: () => Promise<void>;
  viewport?: { height: number; addEventListener(name: string, callback: () => void): void };
  onRequest?: (request: RequestLog, fallback: () => ResponseStub) => ResponseStub | Promise<ResponseStub>;
} = {}) {
  class Element {
    textContent = ""; innerHTML = ""; className = ""; value = ""; type = "password";
    disabled = false; hidden = false; open = false; focused = false; dataset: Record<string, string> = { theme: "dark" };
    attributes = new Map<string, string>();
    style = { setProperty: (name: string, value: string) => this.attributes.set(name, value) };
    listeners = new Map<string, Array<(event: { preventDefault(): void; detail: number }) => unknown>>();
    classList = { add: () => {}, remove: () => {}, toggle: () => {} };
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    addEventListener(name: string, handler: (event: { preventDefault(): void; detail: number }) => unknown) { this.listeners.set(name, [...this.listeners.get(name) ?? [], handler]); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() { this.focused = true; }
    append() {}
    async dispatch(name = "click") { if (this.disabled && name === "click") return; for (const handler of this.listeners.get(name) ?? []) await handler({ preventDefault() {}, detail: 0 }); await flush(); }
  }
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1]!, new Element()]));
  const node = (id: string) => { const found = nodes.get(id); if (!found) throw new Error(`Missing element ${id}`); return found; };
  const catalog = modelIds.map((modelId, i) => ({ modelId, displayName: i ? "GLM 5.3 Flash" : "DeepSeek Chat", endpointHost: i ? "open.bigmodel.cn" : "api.deepseek.com", keyPresent: !i, persistSupported: !i }));
  let active = options.active ?? "deepseek-chat";
  const providers = catalog.map((item) => ({ ...item, keyConfigured: item.keyPresent, revision: item.keyPresent ? "a".repeat(64) : null, keyUpdatedAt: null as string | null,
    validation: { status: "unverified", checkedAt: null as string | null, reasonCode: null }, lastOperationId: null as string | null }));
  const requests: RequestLog[] = [];
  const pageEvents = new Map<string, (event?: { persisted?: boolean }) => void>();
  const storageWrites: Array<[string, string]> = [];
  const rootElement = new Element();
  const fallback = (request: RequestLog): ResponseStub => {
    if (request.path === MODEL_PATH && request.method === "GET") return response({ schemaVersion: "admin-refinement-model-v1", current: catalog.find((item) => item.modelId === active), catalog, updatedAt: null });
    if (request.path === KEY_PATH && request.method === "GET") return response({ schemaVersion: "admin-model-credentials-v1", providers });
    if (request.path.endsWith("/fresh/options")) return response({ schemaVersion: "admin-auth-fresh-options-v1", publicKey: {} });
    if (request.path.endsWith("/fresh/verify")) return response({ schemaVersion: "admin-auth-fresh-verify-v1", freshReceipt: "fixture-fresh" });
    if (request.path.endsWith("/csrf")) return response({ schemaVersion: "admin-bilingual-v1", csrfToken: "fixture-csrf" });
    if (request.path === KEY_PATH && request.method === "POST") {
      const item = providers.find((provider) => provider.modelId === request.body!.modelId)!;
      if (request.body!.action === "replaceKey") {
        item.keyConfigured = true; item.revision = "b".repeat(64); item.keyUpdatedAt = "2026-09-07T01:00:00.000Z";
        item.lastOperationId = `credential_${createHash("sha256").update(String(request.body!.idempotencyKey)).digest("hex").slice(0, 32)}`;
        item.validation = { status: "verified", checkedAt: "2026-09-07T01:00:00.000Z", reasonCode: null };
      }
      return response({ schemaVersion: "admin-model-credentials-v1", status: "succeeded", action: request.body!.action, modelId: item.modelId,
        credential: item, validationTarget: request.body!.apiKey && request.body!.action === "test" ? "input" : "saved", operationId: `credential_${createHash("sha256").update(String(request.body!.idempotencyKey)).digest("hex").slice(0, 32)}`, validation: { status: "verified", checkedAt: "2026-09-07T01:00:00.000Z", reasonCode: null } });
    }
    if (request.path === MODEL_PATH && request.method === "POST") { active = String(request.body!.modelId); return fallback({ ...request, method: "GET" }); }
    throw new Error(`Unexpected ${request.method} ${request.path}`);
  };
  const credential = { id: "fixture", rawId: new Uint8Array([1]).buffer, type: "public-key", getClientExtensionResults: () => ({}),
    response: { clientDataJSON: new Uint8Array([1]).buffer, authenticatorData: new Uint8Array([2]).buffer, signature: new Uint8Array([3]).buffer } };
  runInNewContext(script, {
    AbortController, TextEncoder, Intl, Uint8Array, navigator: { credentials: { get: async () => { await options.beforePasskey?.(); return credential; } } },
    document: { documentElement: rootElement, getElementById: node, createElement: () => new Element() },
    window: { visualViewport: options.viewport, crypto: webcrypto, PublicKeyCredential: { parseRequestOptionsFromJSON: (value: unknown) => value },
      localStorage: { getItem: () => null, setItem: (key: string, value: string) => storageWrites.push([key, value]) },
      matchMedia: () => ({ matches: false }), atob, btoa,
      setTimeout: (...args: Parameters<typeof setTimeout>) => { const timer = setTimeout(...args); timer.unref?.(); return timer; }, clearTimeout,
      addEventListener: (name: string, fn: (event?: { persisted?: boolean }) => void) => pageEvents.set(name, fn),
      fetch: async (path: string, init: { method: string; body?: string; headers?: Record<string, string> }) => {
        const request = { path, method: init.method, body: init.body ? JSON.parse(init.body) as Record<string, unknown> : undefined, headers: init.headers };
        requests.push(request);
        return await (options.onRequest?.(request, () => fallback(request)) ?? fallback(request));
      }
    }
  });
  await flush();
  return { node, requests, providers, storageWrites, pageEvents, rootElement, open: async (id = "deepseek-chat") => { await node("model-" + id).dispatch(); },
    edit: async () => { await node("replace-key").dispatch(); node("new-key").value = fixtureKey; await node("new-key").dispatch("input"); } };
}

afterEach(() => { vi.useRealTimers(); });

describe("Admin model detail real API UI", () => {
  it("opens the supported and unsupported cards without treating a stored key as verified", async () => {
    const ui = await harness();
    expect(ui.node("summary-status").textContent).toContain("未验证");
    await ui.open();
    expect(ui.node("model-dialog").open).toBe(true);
    expect(ui.node("detail-connection-state").textContent).toBe("未验证");
    await ui.node("footer-close").dispatch();
    await ui.open("glm-5.3-flash");
    expect(ui.node("support-note").hidden).toBe(false);
    expect(ui.node("select-model").hidden).toBe(true);
    expect(ui.node("key-editor").hidden).toBe(false);
  });

  it("requires fresh before CSRF, posts the key only for that mutation, and clears the saved input", async () => {
    const ui = await harness(); await ui.open(); await ui.edit(); await ui.node("save-key").dispatch();
    await vi.waitFor(() => expect(ui.node("inline-message").textContent).toContain("验证通过并已保存"));
    const posts = ui.requests.filter((item) => item.method === "POST");
    expect(posts.map((item) => item.path)).toEqual(["/api/admin/auth/fresh/options", "/api/admin/auth/fresh/verify", "/api/admin/csrf", KEY_PATH]);
    expect(posts.at(-1)!.headers?.["x-f1-fresh-reauth"]).toBe("fixture-fresh");
    expect(posts.at(-1)!.body?.expectedRevision).toBe("a".repeat(64));
    expect(posts.at(-1)!.body?.apiKey).toBe(fixtureKey);
    expect(ui.node("new-key").value).toBe("");
    expect(JSON.stringify(ui.storageWrites)).not.toContain(fixtureKey);
  });

  it("shows a failed provider result even when HTTP succeeds and preserves the old key", async () => {
    const ui = await harness({ onRequest: (request, next) => request.path === KEY_PATH && request.method === "POST"
      ? response({ schemaVersion: "admin-model-credentials-v1", status: "failed", reasonCode: "MODEL_CONNECTION_REJECTED" }) : next() });
    await ui.open(); await ui.edit(); await ui.node("save-key").dispatch();
    await vi.waitFor(() => expect(ui.node("inline-message").textContent).toContain("未接受"));
    expect(ui.providers[0]!.revision).toBe("a".repeat(64));
    expect(ui.node("new-key").value).toBe(fixtureKey);
    expect(ui.node("save-key").disabled).toBe(false);
  });

  it("tests the draft input separately without reporting the stored credential as verified", async () => {
    const ui = await harness(); await ui.open(); await ui.edit(); await ui.node("test-current").dispatch();
    await vi.waitFor(() => expect(ui.node("inline-message").textContent).toContain("尚未保存"));
    expect(ui.node("detail-connection-state").textContent).toBe("未验证");
    expect(ui.node("new-key").value).toBe(fixtureKey);
    expect(ui.requests.at(-1)!.body?.action).toBe("test");
    expect(ui.requests.at(-1)!.body?.apiKey).toBe(fixtureKey);
  });

  it("clears the input on expired sessions and returns to login", async () => {
    const ui = await harness({ onRequest: (request, next) => request.path.endsWith("/fresh/options")
      ? response({ reasonCode: "ADMIN_SESSION_REQUIRED" }, 401) : next() });
    await ui.open(); await ui.edit(); await ui.node("save-key").dispatch();
    await vi.waitFor(() => expect(ui.node("model-dialog").open).toBe(false));
    expect(ui.node("auth-view").hidden).toBe(false);
    expect(ui.node("new-key").value).toBe("");
    expect(ui.requests.some((request) => request.path === KEY_PATH && request.method === "POST")).toBe(false);
  });

  it("asks before discarding and clears both the input and visibility state without network writes", async () => {
    const ui = await harness(); await ui.open(); await ui.edit(); await ui.node("toggle-key").dispatch();
    expect(ui.node("new-key").type).toBe("text");
    await ui.node("footer-close").dispatch();
    expect(ui.node("discard-notice").hidden).toBe(false);
    await ui.node("discard-changes").dispatch();
    expect(ui.node("new-key").value).toBe("");
    expect(ui.node("new-key").type).toBe("password");
    expect(ui.requests.filter((item) => item.method === "POST")).toHaveLength(0);
  });

  it("retains confirmed save success if the follow-up GET fails", async () => {
    let saved = false;
    const ui = await harness({ onRequest: (request, next) => {
      if (request.path === KEY_PATH && request.method === "POST") { saved = true; return next(); }
      if (saved && request.method === "GET") return response({ reasonCode: "ADMIN_INTERNAL_FAILURE" }, 503);
      return next();
    } });
    await ui.open(); await ui.edit(); await ui.node("save-key").dispatch();
    await vi.waitFor(() => expect(ui.node("inline-message").textContent).toContain("新 Key 已保存"));
    await vi.waitFor(() => expect(ui.node("retry-settings").hidden).toBe(false));
    expect(ui.node("new-key").value).toBe("");
    expect(ui.providers[0]!.revision).toBe("b".repeat(64));
  });

  it("allows restoring a supported model from a legacy unsupported selection using its existing CSRF route", async () => {
    const ui = await harness({ active: "glm-5.3-flash" }); await ui.open();
    expect(ui.node("select-model").hidden).toBe(false);
    await ui.node("select-model").dispatch();
    await vi.waitFor(() => expect(ui.node("current-model-name").textContent).toBe("DeepSeek Chat"));
    expect(ui.requests.filter((item) => item.method === "POST").map((item) => item.path)).toEqual(["/api/admin/csrf", MODEL_PATH]);
  });

  it.each(["fetch", "body"])("bounds a hanging %s read and permits retry without an infinite loading state", async (stage) => {
    vi.useFakeTimers();
    const ui = await harness({ onRequest: (request, next) => request.path === KEY_PATH
      ? stage === "fetch" ? new Promise(() => {}) : { ok: true, status: 200, json: () => new Promise(() => {}) } : next() });
    await vi.advanceTimersByTimeAsync(8001); await flush();
    expect(ui.node("retry-settings").hidden).toBe(false);
    expect(ui.node("settings-error").textContent).toContain("超时");
    await ui.open();
    expect(ui.node("model-dialog").open).toBe(false);
  });

  it("disables an old discard prompt during save and stops before mutation if the page leaves during Passkey", async () => {
    let resume!: () => void;
    let waiting = false;
    const ui = await harness({ beforePasskey: () => { waiting = true; return new Promise<void>((resolve) => { resume = resolve; }); } });
    await ui.open(); await ui.edit(); await ui.node("footer-close").dispatch();
    expect(ui.node("discard-notice").hidden).toBe(false);
    await ui.node("save-key").dispatch();
    await vi.waitFor(() => expect(waiting).toBe(true));
    expect(ui.node("discard-notice").hidden).toBe(true);
    expect(ui.node("discard-changes").disabled).toBe(true);
    await ui.node("discard-changes").dispatch();
    expect(ui.node("model-dialog").open).toBe(true);
    ui.pageEvents.get("pagehide")!();
    resume(); await flush();
    expect(ui.node("model-dialog").open).toBe(false);
    ui.pageEvents.get("pageshow")!({ persisted: true }); await flush();
    await ui.open(); await ui.node("replace-key").dispatch();
    expect(ui.node("new-key").disabled).toBe(false);
    await ui.node("footer-close").dispatch();
    expect(ui.node("model-dialog").open).toBe(false);
    expect(ui.node("new-key").value).toBe("");
    expect(ui.requests.some((request) => request.path === KEY_PATH && request.method === "POST")).toBe(false);
  });

  it("recognizes a committed save after a lost response using the exact operation ID", async () => {
    const ui = await harness({ onRequest: (request, next) => {
      const result = next();
      if (request.path === KEY_PATH && request.method === "POST") return Promise.reject(new Error("fixture lost response"));
      return result;
    } });
    await ui.open(); await ui.edit(); await ui.node("save-key").dispatch();
    await vi.waitFor(() => expect(ui.node("inline-message").textContent).toContain("确认本次 Key 保存成功"));
    expect(ui.node("new-key").value).toBe("");
    expect(ui.requests.filter((request) => request.path === KEY_PATH && request.method === "POST")).toHaveLength(1);
  });

  it("rejects an unbound success response without clearing unsaved input or claiming a successful save", async () => {
    const ui = await harness({ onRequest: (request, next) => request.path === KEY_PATH && request.method === "POST" ? response({ status: "succeeded" }) : next() });
    await ui.open(); await ui.edit(); await ui.node("save-key").dispatch();
    await vi.waitFor(() => expect(ui.node("inline-message").textContent).toContain("响应无法校验"));
    expect(ui.node("new-key").value).toBe(fixtureKey);
    expect(ui.providers[0]!.revision).toBe("a".repeat(64));
    expect(ui.node("inline-message").textContent).not.toContain("已保存");
  });

  it("refreshes the recorded current-key failure after the provider returns HTTP 422", async () => {
    const ui = await harness({ onRequest: (request, next) => {
      if (request.path === KEY_PATH && request.method === "POST") return response({ reasonCode: "CREDENTIAL_PROVIDER_AUTH_REJECTED" }, 422);
      if (request.path === KEY_PATH && request.method === "GET" && request !== undefined) {
        const result = next();
        return { ...result, json: async () => {
          const value = await result.json() as { providers: Array<{ validation: { status: string; checkedAt: string | null; reasonCode: string | null } }> };
          value.providers[0]!.validation = { status: "failed", checkedAt: "2026-09-07T02:00:00.000Z", reasonCode: "CREDENTIAL_PROVIDER_AUTH_REJECTED" };
          return value;
        } };
      }
      return next();
    } });
    await ui.open(); await ui.node("test-current").dispatch();
    await vi.waitFor(() => expect(ui.node("inline-message").textContent).toContain("未接受"));
    expect(ui.node("detail-connection-state").textContent).toBe("最近验证失败");
    expect(ui.requests.filter((request) => request.path === KEY_PATH && request.method === "GET")).toHaveLength(2);
  });

  it("tracks the smaller visual viewport so mobile controls remain above the software keyboard", async () => {
    let resize!: () => void;
    const viewport = { height: 844, addEventListener: (_name: string, callback: () => void) => { resize = callback; } };
    const ui = await harness({ viewport });
    expect(ui.rootElement.attributes.get("--model-viewport-height")).toBe("844px");
    viewport.height = 482; resize();
    expect(ui.rootElement.attributes.get("--model-viewport-height")).toBe("482px");
    viewport.height = 844; resize();
    expect(ui.rootElement.attributes.get("--model-viewport-height")).toBe("844px");
  });

  it("contains a native labelled modal and no demo scenario or fake production test branch", () => {
    expect(html).toContain('<dialog id="model-dialog"');
    expect(html).toContain('aria-labelledby="dialog-title"');
    expect(html).toContain('type="password"');
    expect(html).toContain("connect-src 'self'");
    expect(html).not.toContain("demo-scenario");
    expect(script).not.toContain("demo-fixture");
    expect(script).not.toContain("演示验证通过");
  });
});
