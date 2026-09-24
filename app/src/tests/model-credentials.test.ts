import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../server/db/profile.ts";
import { ReviewAdminSecurity } from "../server/review-real/security.ts";
import { ModelCredentialRoutes, ModelCredentialStore, MODEL_CREDENTIALS_PATH, prepareModelCredentialMutation } from "../server/admin-service/model-credentials.ts";
import { AdminPasskeyAuth, FreshOptionsRequestSchema, FreshVerifyRequestSchema } from "../server/admin-service/auth.ts";
import { BootstrapTokenStore, PasskeyCredentialStore } from "../server/admin-service/storage.ts";
import type { AdminWebAuthnAdapter } from "../server/admin-service/webauthn.ts";
import { readRefineModelApiKey } from "../server/rss/refine-model.ts";
import type { RawAdminContext } from "../server/source-management/security.ts";
import type { ModelProviderProbe } from "../server/admin-service/model-provider-probe.ts";

const faults = vi.hoisted(() => ({ fsync: 0, fsyncCalls: 0, metadataRename: false }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs,
    fsyncSync: (...args: Parameters<typeof fs.fsyncSync>) => {
      faults.fsyncCalls++;
      if (faults.fsync > 0 && faults.fsyncCalls === faults.fsync) throw new Error("synthetic disk failure");
      return fs.fsyncSync(...args);
    },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (faults.metadataRename && String(args[1]).endsWith(".metadata.json")) throw new Error("synthetic metadata failure");
      return fs.renameSync(...args);
    }
  };
});
const roots: string[] = [];
const oldKey = `sk-${"A".repeat(24)}`;
const nextKey = `sk-${"B".repeat(24)}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); faults.fsync = 0; faults.fsyncCalls = 0; faults.metadataRename = false; });

function harness(probe: ModelProviderProbe = async () => ({ status: "verified", reasonCode: null })) {
  const privateDir = mkdtempSync(join(realpathSync(tmpdir()), "f1-credentials-")); roots.push(privateDir); chmodSync(privateDir, 0o700);
  const keyPath = join(privateDir, "deepseek-api-key");
  writeFileSync(keyPath, oldKey, { mode: 0o600 });
  let now = Date.parse("2026-09-07T00:00:00.000Z");
  let ready = true;
  let network = true;
  const security = new ReviewAdminSecurity({ canonicalOrigin: "https://f1-admin.example.ts.net", sessionHashKey: Buffer.alloc(32, 7), now: () => now,
    readRecoveryFence: () => ({ clockTrusted: true, writerReady: ready, lastSuccessfulRecoveryPointAt: now - 1000 }) });
  let cookie = security.acceptVerifiedSession({ operatorRef: "operator", deviceRef: "device", tailnetUserRef: "tailnet" }).cookieHeader;
  const store = new ModelCredentialStore(privateDir, security);
  const routes = new ModelCredentialRoutes(privateDir, security, probe, () => now, () => network);
  const context = (path: string, extra: Record<string, string> = {}): RawAdminContext => ({ method: "POST", path, authority: "f1-admin.example.ts.net", origin: "https://f1-admin.example.ts.net", peer: "loopback", noEgressReady: true,
    rawHeaders: new Map(Object.entries({ origin: "https://f1-admin.example.ts.net", "sec-fetch-site": "same-origin", cookie, ...extra }).map(([name, value]) => [name, [value]])) });
  let serial = 0;
  function request(input: { action?: "test" | "replaceKey"; apiKey?: string; modelId?: "deepseek-chat" | "glm-5.3-flash"; expectedRevision?: string | null } = {}, fresh = true) {
    serial++;
    const unsigned = { schemaVersion: "admin-model-credential-mutation-v1", modelId: input.modelId ?? "deepseek-chat", action: input.action ?? "replaceKey",
      expectedRevision: input.expectedRevision === undefined ? store.read(input.modelId ?? "deepseek-chat").revision : input.expectedRevision,
      ...(input.apiKey === undefined && input.action === "test" ? {} : { apiKey: input.apiKey ?? nextKey }), idempotencyKey: `credential-test-${serial}`, clientRequestId: `credential-client-${serial}` };
    const mutation = { ...unsigned, requestHash: sha(canonicalJson({ method: "POST", canonicalPath: MODEL_CREDENTIALS_PATH, body: unsigned })) };
    const prepared = prepareModelCredentialMutation(mutation);
    let receipt = "";
    if (fresh) {
      const result = security.acceptVerifiedFreshReauth(context("/api/admin/fresh/verify"), { operationId: prepared.binding.operationId, action: "MODEL_CREDENTIAL", resourceHash: prepared.binding.resourceHash });
      cookie = result.cookieHeader; receipt = result.freshReceipt;
    }
    const csrf = security.issueCsrf(context("/api/admin/csrf"), prepared.binding);
    return { mutation, context: context(MODEL_CREDENTIALS_PATH, { "idempotency-key": mutation.idempotencyKey, "x-csrf-token": csrf, ...(receipt ? { "x-f1-fresh-reauth": receipt } : {}) }) };
  }
  return { privateDir, keyPath, routes, store, security, context, request, setReady: (value: boolean) => { ready = value; }, setNetwork: (value: boolean) => { network = value; }, advance: (ms: number) => { now += ms; } };
}

describe("private model credentials through the authenticated mutation route", () => {
  it("returns only opaque metadata and accepts the exact fresh schemas", () => {
    const h = harness(); const before = h.store.read("deepseek-chat");
    expect(before).toMatchObject({ keyConfigured: true, validation: { status: "unverified", checkedAt: null }, lastOperationId: null });
    expect(before.revision).not.toBe(sha(oldKey));
    expect(JSON.stringify(before)).not.toContain(oldKey);
    const request = h.request();
    expect(FreshOptionsRequestSchema.safeParse({ schemaVersion: "admin-auth-fresh-options-v1", mutation: request.mutation }).success).toBe(true);
    expect(FreshVerifyRequestSchema.safeParse({ schemaVersion: "admin-auth-fresh-verify-v1", mutation: request.mutation, response: {} }).success).toBe(true);
    expect(() => prepareModelCredentialMutation({ ...request.mutation, apiKey: oldKey })).toThrow("ADMIN_REQUEST_INVALID");
  });

  it("requires fresh auth and CSRF before any provider call or write", async () => {
    const probe = vi.fn<ModelProviderProbe>(async () => ({ status: "verified", reasonCode: null })); const h = harness(probe);
    const missingFresh = h.request({}, false);
    await expect(h.routes.mutate(missingFresh.context, missingFresh.mutation)).rejects.toThrow("ADMIN_REAUTH_REQUIRED");
    const request = h.request(); const invalid = { ...request.context, rawHeaders: new Map(request.context.rawHeaders) }; invalid.rawHeaders.delete("x-csrf-token");
    await expect(h.routes.mutate(invalid, request.mutation)).rejects.toThrow("ADMIN_CSRF_REJECTED");
    expect(probe).not.toHaveBeenCalled(); expect(readFileSync(h.keyPath, "utf8")).toBe(oldKey);
  });

  it("defaults model network to disabled and rechecks a changing release permit after the probe", async () => {
    let finish!: (value: { status: "verified"; reasonCode: null }) => void;
    const probe = vi.fn<ModelProviderProbe>(() => new Promise(resolve => { finish = resolve; })); const h = harness(probe);
    const closed = new ModelCredentialRoutes(h.privateDir, h.security, probe);
    let request = h.request();
    expect((await closed.mutate(request.context, request.mutation)).body.reasonCode).toBe("CREDENTIAL_NETWORK_DISABLED"); expect(probe).not.toHaveBeenCalled();
    expect(closed.read({ ...h.context(MODEL_CREDENTIALS_PATH), method: "GET" }).providers[0].keyConfigured).toBe(true);
    request = h.request(); const pending = h.routes.mutate(request.context, request.mutation); h.setNetwork(false); finish({ status: "verified", reasonCode: null });
    expect((await pending).body.reasonCode).toBe("CREDENTIAL_NETWORK_DISABLED"); expect(readFileSync(h.keyPath, "utf8")).toBe(oldKey);
  });

  it("binds passkey challenge to the exact credential input and rotates the session before credential CSRF", async () => {
    const h = harness();
    const credentialStore = new PasskeyCredentialStore(h.privateDir);
    const timestamp = "2026-09-07T00:00:00.000Z";
    credentialStore.addInitial({ operatorRef: "operator", webauthnUserId: Buffer.alloc(32, 2).toString("base64url"), credential: {
      id: "credential_primary", publicKey: Buffer.from("synthetic-public-key").toString("base64url"), counter: 0, transports: ["internal"], deviceType: "multiDevice", backedUp: true, createdAt: timestamp, updatedAt: timestamp, disabledAt: null
    } });
    const webauthn: AdminWebAuthnAdapter = {
      registrationOptions: async () => { throw new Error("unused registration"); },
      verifyRegistration: async () => { throw new Error("unused registration"); },
      authenticationOptions: async () => ({ challenge: Buffer.alloc(32, 8).toString("base64url") }),
      verifyAuthentication: async () => ({ verified: true, credentialId: "credential_primary", newCounter: 1, credentialDeviceType: "multiDevice", credentialBackedUp: true })
    };
    const auth = new AdminPasskeyAuth({ credentialStore, bootstrapStore: new BootstrapTokenStore(h.privateDir), security: h.security, webauthn,
      canonicalOrigin: "https://f1-admin.example.ts.net", rpName: "F1+1 Admin", operatorRef: "operator", now: () => Date.parse(timestamp) });
    const identity = { operatorRef: "operator", deviceRef: "device", tailnetUserRef: "tailnet" };
    const request = h.request({}, false);
    await auth.freshOptions(h.context("/api/admin/auth/fresh/options"), identity, { schemaVersion: "admin-auth-fresh-options-v1", mutation: request.mutation });
    const wrong = { ...request.mutation, apiKey: oldKey }; const { requestHash: _hash, ...unsigned } = wrong;
    wrong.requestHash = sha(canonicalJson({ method: "POST", canonicalPath: MODEL_CREDENTIALS_PATH, body: unsigned }));
    await expect(auth.freshVerify(h.context("/api/admin/auth/fresh/verify"), identity, { schemaVersion: "admin-auth-fresh-verify-v1", mutation: wrong, response: { id: "credential_primary" } })).rejects.toThrow("ADMIN_REAUTH_REQUIRED");
    await auth.freshOptions(h.context("/api/admin/auth/fresh/options"), identity, { schemaVersion: "admin-auth-fresh-options-v1", mutation: request.mutation });
    const fresh = await auth.freshVerify(h.context("/api/admin/auth/fresh/verify"), identity, { schemaVersion: "admin-auth-fresh-verify-v1", mutation: request.mutation, response: { id: "credential_primary" } });
    await expect(h.routes.mutate(request.context, request.mutation)).rejects.toThrow("ADMIN_SESSION_REQUIRED");
    const csrfContext = { ...h.context("/api/admin/csrf"), rawHeaders: new Map(h.context("/api/admin/csrf").rawHeaders) };
    csrfContext.rawHeaders.set("cookie", [fresh.cookieHeader]);
    const csrf = h.security.issueCsrf(csrfContext, prepareModelCredentialMutation(request.mutation).binding);
    const postContext = { ...request.context, rawHeaders: new Map(request.context.rawHeaders) };
    postContext.rawHeaders.set("cookie", [fresh.cookieHeader]); postContext.rawHeaders.set("x-csrf-token", [csrf]);
    postContext.rawHeaders.set("x-f1-fresh-reauth", [(fresh.body as { freshReceipt: string }).freshReceipt]);
    expect((await h.routes.mutate(postContext, request.mutation)).status).toBe(200);
  });

  it("atomically saves after a real probe result and both worker and GET read the same key", async () => {
    const probe = vi.fn<ModelProviderProbe>(async () => ({ status: "verified", reasonCode: null })); const h = harness(probe);
    const before = h.store.read("deepseek-chat"); const request = h.request();
    const result = await h.routes.mutate(request.context, request.mutation);
    expect(result.status).toBe(200); expect(probe).toHaveBeenCalledExactlyOnceWith("deepseek-chat", nextKey);
    expect(result.body).toMatchObject({ status: "succeeded", validationTarget: "saved", credential: { keyConfigured: true, lastOperationId: result.body.operationId, validation: { status: "verified" } } });
    expect(result.body.credential.revision).not.toBe(before.revision);
    expect(readRefineModelApiKey(h.keyPath, "deepseek-chat")).toBe(nextKey); expect(lstatSync(h.keyPath).mode & 0o777).toBe(0o600);
    expect(h.routes.read({ ...h.context(MODEL_CREDENTIALS_PATH), method: "GET" }).providers[0]).toEqual(result.body.credential);
    expect(JSON.stringify(result)).not.toContain(nextKey); expect(JSON.stringify(result)).not.toContain(oldKey);
    expect(existsSync(join(h.privateDir, "refinement-model.json"))).toBe(false);
    await expect(h.routes.mutate(request.context, request.mutation)).rejects.toThrow("ADMIN_CSRF_REJECTED"); expect(probe).toHaveBeenCalledTimes(1);
  });

  it("tests current key without moving keyUpdatedAt; input testing never changes saved metadata", async () => {
    const h = harness(); let request = h.request(); await h.routes.mutate(request.context, request.mutation);
    const before = h.store.read("deepseek-chat"); const bytes = readFileSync(`${h.keyPath}.metadata.json`);
    h.advance(10_000); request = h.request({ action: "test", apiKey: oldKey });
    const input = await h.routes.mutate(request.context, request.mutation);
    expect(input.body.validationTarget).toBe("input"); expect(input.body.credential).toEqual(before); expect(readFileSync(`${h.keyPath}.metadata.json`)).toEqual(bytes);
    request = h.request({ action: "test" }); const saved = await h.routes.mutate(request.context, request.mutation);
    expect(saved.body.validationTarget).toBe("saved"); expect(saved.body.credential.keyUpdatedAt).toBe(before.keyUpdatedAt);
    expect(saved.body.credential.validation.checkedAt).not.toBe(before.validation.checkedAt); expect(saved.body.credential.revision).toBe(before.revision);
  });

  it("retains old bytes, timestamps, revision, and metadata on rejected replacement", async () => {
    const h = harness(async () => ({ status: "failed", reasonCode: "CREDENTIAL_PROVIDER_AUTH_REJECTED" })); const before = h.store.read("deepseek-chat"); const stat = lstatSync(h.keyPath);
    const request = h.request(); const result = await h.routes.mutate(request.context, request.mutation);
    expect(result.status).toBe(422); expect(result.body.credential).toEqual(before); expect(lstatSync(h.keyPath).mtimeMs).toBe(stat.mtimeMs); expect(readFileSync(h.keyPath, "utf8")).toBe(oldKey);
  });

  it("records failed saved-key testing without changing the key", async () => {
    const h = harness(async () => ({ status: "failed", reasonCode: "CREDENTIAL_PROVIDER_RATE_LIMITED" })); const request = h.request({ action: "test" });
    const result = await h.routes.mutate(request.context, request.mutation);
    expect(result.body.credential.validation).toMatchObject({ status: "failed", reasonCode: "CREDENTIAL_PROVIDER_RATE_LIMITED" }); expect(readFileSync(h.keyPath, "utf8")).toBe(oldKey);
  });

  it("rejects stale revision before outbound and coalesces concurrent duplicates by rejecting the second", async () => {
    let finish!: (value: { status: "verified"; reasonCode: null }) => void;
    const probe = vi.fn<ModelProviderProbe>(() => new Promise(resolve => { finish = resolve; })); const h = harness(probe);
    const stale = h.request({ expectedRevision: "0".repeat(64) }); expect((await h.routes.mutate(stale.context, stale.mutation)).body.reasonCode).toBe("CREDENTIAL_REVISION_CONFLICT"); expect(probe).not.toHaveBeenCalled();
    const request = h.request(); const pending = h.routes.mutate(request.context, request.mutation);
    expect((await h.routes.mutate(request.context, request.mutation)).body.reasonCode).toBe("CREDENTIAL_BUSY"); expect(probe).toHaveBeenCalledTimes(1);
    finish({ status: "verified", reasonCode: null }); expect((await pending).status).toBe(200);
  });

  it.each(["version", "fence", "session"])("rechecks %s after the asynchronous provider reply", async kind => {
    let finish!: (value: { status: "verified"; reasonCode: null }) => void;
    const h = harness(() => new Promise(resolve => { finish = resolve; })); const request = h.request(); const pending = h.routes.mutate(request.context, request.mutation);
    if (kind === "version") writeFileSync(h.keyPath, oldKey + "\n", { mode: 0o600 });
    if (kind === "fence") h.setReady(false);
    if (kind === "session") h.advance(9 * 60 * 60 * 1000);
    finish({ status: "verified", reasonCode: null });
    if (kind === "version") expect((await pending).body.reasonCode).toBe("CREDENTIAL_REVISION_CONFLICT");
    else await expect(pending).rejects.toThrow(kind === "fence" ? "ADMIN_BACKUP_STALE" : "ADMIN_SESSION_REQUIRED");
    expect(readFileSync(h.keyPath, "utf8").trim()).toBe(oldKey);
  });

  it("rejects unsafe destinations before replacing and distrusts metadata after external key changes", async () => {
    const h = harness(); const target = join(h.privateDir, "unrelated"); writeFileSync(target, "untouched", { mode: 0o600 }); symlinkSync(target, `${h.keyPath}.metadata.json`);
    let request = h.request(); const result = await h.routes.mutate(request.context, request.mutation);
    expect(result.body.reasonCode).toBe("CREDENTIAL_SAVE_FAILED"); expect(readFileSync(target, "utf8")).toBe("untouched"); expect(readFileSync(h.keyPath, "utf8")).toBe(oldKey);
    rmSync(`${h.keyPath}.metadata.json`); request = h.request(); await h.routes.mutate(request.context, request.mutation);
    writeFileSync(h.keyPath, oldKey, { mode: 0o600 }); expect(h.store.read("deepseek-chat")).toMatchObject({ validation: { status: "unverified" }, lastOperationId: null });
  });

  it.each(["pre-rename", "post-rename", "metadata"])("reports %s storage failure with honest authority state", async stage => {
    const h = harness(); const request = h.request();
    if (stage === "metadata") faults.metadataRename = true; else faults.fsync = stage === "pre-rename" ? 1 : 2;
    const result = await h.routes.mutate(request.context, request.mutation);
    expect(result.body.reasonCode).toBe(stage === "pre-rename" ? "CREDENTIAL_SAVE_FAILED" : "CREDENTIAL_COMMIT_UNKNOWN");
    expect(readFileSync(h.keyPath, "utf8").trim()).toBe(stage === "pre-rename" ? oldKey : nextKey);
    expect(result.body.credential.validation.status).toBe("unverified"); expect(result.body.credential.lastOperationId).toBeNull();
  });

  it("stores and tests the GLM credential independently of the current supported model", async () => {
    const h = harness(); const request = h.request({ modelId: "glm-5.3-flash", apiKey: `${"G".repeat(20)}.${"g".repeat(12)}` });
    const result = await h.routes.mutate(request.context, request.mutation);
    expect(result.status).toBe(200); expect(result.body.credential).toMatchObject({ persistSupported: false, keyConfigured: true }); expect(readFileSync(h.keyPath, "utf8")).toBe(oldKey);
  });

  it("can replace an empty safe private file while keeping it unconfigured until successful validation", async () => {
    const h = harness(); writeFileSync(h.keyPath, "", { mode: 0o600 });
    const before = h.store.read("deepseek-chat"); expect(before.keyConfigured).toBe(false); expect(before.revision).toMatch(/^[0-9a-f]{64}$/u);
    expect(() => readRefineModelApiKey(h.keyPath, "deepseek-chat")).toThrow("DEEPSEEK_API_KEY_INVALID");
    const request = h.request(); const result = await h.routes.mutate(request.context, request.mutation);
    expect(result.status).toBe(200); expect(readRefineModelApiKey(h.keyPath, "deepseek-chat")).toBe(nextKey);
  });

  it("rejects an existing writer lock before provider cost and resumes after exact isolated lock recovery", async () => {
    const probe = vi.fn<ModelProviderProbe>(async () => ({ status: "verified", reasonCode: null })); const h = harness(probe);
    const lockPath = `${h.keyPath}.lock`; writeFileSync(lockPath, "", { mode: 0o600 });
    let request = h.request(); expect((await h.routes.mutate(request.context, request.mutation)).body.reasonCode).toBe("CREDENTIAL_BUSY"); expect(probe).not.toHaveBeenCalled();
    // This isolated fixture has no active holder. Operational recovery requires stopped and verified writers first.
    const stat = lstatSync(lockPath); expect(stat.isFile()).toBe(true); expect(stat.nlink).toBe(1); expect(stat.uid).toBe(process.getuid?.());
    rmSync(lockPath); request = h.request(); expect((await h.routes.mutate(request.context, request.mutation)).status).toBe(200); expect(probe).toHaveBeenCalledTimes(1);
  });
});
