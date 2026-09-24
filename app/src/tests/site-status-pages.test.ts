import { createHash } from "node:crypto";
import { createServer, type RequestListener, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PAGES_TIMEOUT_MS, parseSiteStatusConfig, PUBLIC_PAGES_CURRENT_URL, PUBLIC_PAGES_HOME_URL } from "../server/site-status/config.ts";
import { sampleHttp } from "../server/site-status/runtime.ts";

const bridge = vi.hoisted(() => ({ port: 0, calls: [] as { url: string; options: unknown }[] }));
vi.mock("node:https", async () => {
  const http = await import("node:http");
  return { request: (url: string, options: Parameters<typeof http.request>[1], callback: Parameters<typeof http.request>[2]) => {
    bridge.calls.push({ url, options });
    expect(url.startsWith("https://1404369477-blip.github.io/f1plus1/_public/")).toBe(true);
    const target = new URL(url);
    return http.request(`http://127.0.0.1:${bridge.port}${target.pathname}${target.search}`, options, callback);
  } };
});
const config = parseSiteStatusConfig({ schemaVersion: 1,
  database: { databasePath: "/operator/database.sqlite", deploymentManifestPath: "/operator/deployment.json", expectedDeploymentManifestSha256: "a".repeat(64), expectedSchemaSha256: "b".repeat(64), expectedReleaseSha256: "c".repeat(64), expectedDatabaseIdentity: { device: 1, inode: 2, uid: 501 } },
  backup: { backupRoot: "/operator/backups", backupStateRoot: "/operator/backup-state", offHostPublicKeyPath: "/operator/offhost.pem", applicationDrillPublicKeyPath: "/operator/drill.pem", expectedOffHostPublicKeySha256: "d".repeat(64), expectedApplicationDrillPublicKeySha256: "e".repeat(64) },
  publicTarget: { kind: "github-pages", url: PUBLIC_PAGES_CURRENT_URL }, storage: { path: "/operator", warningAvailableBytes: 100, failedAvailableBytes: 20 } });
const generatedAt = "2026-09-01T01:02:03.000Z";
const v1 = { schemaVersion: "public-read-v0.1", items: [], page: { pageSize: 12, hasMore: false, nextCursor: null } };
const v2 = { schemaVersion: "public-read-bilingual-v2", items: [], page: { limit: 12, nextCursor: null, asOf: generatedAt }, generationId: "fixture", generationHash: "a".repeat(64) };
const problem = (status: number, reasonCode: string) => ({ type: "urn:f1plus1:problem", title: "Unavailable", status, detail: "Unavailable", instance: "/api/public/feed", reasonCode, traceId: "fixture" });
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
function fixture(value: unknown = v2, status = 200, fallback: unknown = v1) {
  const bodies = new Map<string, Buffer>();
  const reference = (body: unknown, status: number) => {
    const bytes = encode(body), hash = sha(bytes), path = `responses/${hash}.json`;
    bodies.set(path, bytes); return { status, contentType: status === 200 ? "application/json" : "application/problem+json", path, sha256: hash };
  };
  const index = { schemaVersion: "public-static-index-v1", generatedAt, responses: { "/api/public/feed?limit=12&v=2": reference(value, status), "/api/public/feed": reference(fallback, 200) } };
  const indexBytes = encode(index), bundleId = sha(indexBytes), indexPath = `_public/generations/${bundleId}/index.json`;
  const pointer = { schemaVersion: "public-static-pointer-v1", bundleId, generatedAt, indexPath, indexSha256: bundleId };
  const files = new Map<string, Buffer>([["/f1plus1/_public/current.json", encode(pointer)], [`/f1plus1/${indexPath}`, indexBytes]]);
  for (const [path, body] of bodies) files.set(`/f1plus1/_public/generations/${bundleId}/${path}`, body);
  return { files, pointer, index };
}

describe("Pages semantic probe", () => {
  let server: Server, current = fixture(), custom: RequestListener | undefined;
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (custom) { custom(request, response); return; }
      const bytes = current.files.get(new URL(request.url!, "http://localhost").pathname);
      response.writeHead(bytes ? 200 : 404, { "content-type": "application/json" }); response.end(bytes ?? "missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    bridge.port = (server.address() as { port: number }).port;
  });
  afterEach(() => { current = fixture(); custom = undefined; bridge.calls = []; });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const probe = () => sampleHttp("public-https", config);
  it("accepts an empty V2 feed independently of tunnel identity and never asserts freshness", async () => {
    expect(await probe()).toMatchObject({ status: "healthy", semantic: "public-static-snapshot", staticSnapshot: { visibleItems: 0, generatedAt, schemaVersion: v2.schemaVersion, syncFreshness: "unknown" } });
    expect(bridge.calls).toHaveLength(3);
    for (const { url, options } of bridge.calls) { expect(url.startsWith(PUBLIC_PAGES_HOME_URL)).toBe(true); expect(options).toMatchObject({ method: "GET", agent: false, autoSelectFamilyAttemptTimeout: 1000, headers: { accept: "application/json", "accept-encoding": "gzip" } }); expect(JSON.stringify(options)).not.toMatch(/cookie|authorization/); }
  });
  it.each([[406, "PUBLIC_MEDIA_VERSION_UNSUPPORTED"], [503, "PUBLIC_READ_INTEGRITY_FAILED"]])("accepts only closed exact %s negotiation then reads the same generation V1", async (code, reason) => {
    current = fixture(problem(Number(code), String(reason)), Number(code));
    expect(await probe()).toMatchObject({ status: "healthy", staticSnapshot: { schemaVersion: v1.schemaVersion, visibleItems: 0 } });
    expect(bridge.calls).toHaveLength(4);
    expect(bridge.calls.slice(1).every(({ url }) => url.includes(current.pointer.bundleId))).toBe(true);
  });
  it.each([
    [v1, 200, v1], [v2, 406, v1], [{ ...v2, secret: "blocked" }, 200, v1],
    [problem(406, "PUBLIC_READ_INTEGRITY_FAILED"), 406, v1],
    [{ ...problem(503, "PUBLIC_READ_INTEGRITY_FAILED"), status: 406 }, 503, v1],
    [{ ...problem(503, "PUBLIC_READ_INTEGRITY_FAILED"), secret: "blocked" }, 503, v1],
    [problem(503, "PUBLIC_READ_INTEGRITY_FAILED"), 503, v2],
    [{ ...v2, page: { ...v2.page, limit: 50 } }, 200, v1],
  ])("rejects wrong versions, limits and malformed fallback contracts (%#)", async (body, code, fallback) => {
    current = fixture(body, code, fallback);
    const result = await probe();
    expect(result).toMatchObject({ status: "failed", reasons: ["HTTP_STATIC_INVALID"], staticSnapshot: null });
    expect(JSON.stringify(result)).not.toContain("blocked");
  });
  it("rejects altered index and response bytes before interpreting their content", async () => {
    const path = `/f1plus1/${current.pointer.indexPath}`;
    current.files.set(path, Buffer.concat([current.files.get(path)!, Buffer.from(" ")]));
    expect(await probe()).toMatchObject({ reasons: ["HTTP_STATIC_INVALID"] });
    current = fixture();
    const bodyPath = [...current.files.keys()].find((key) => key.endsWith(`${current.index.responses["/api/public/feed?limit=12&v=2"].sha256}.json`))!;
    current.files.set(bodyPath, encode(v1));
    expect(await probe()).toMatchObject({ reasons: ["HTTP_STATIC_INVALID"] });
  });
  it("rejects pointer traversal and never follows paths outside the closed generation", async () => {
    current.files.set("/f1plus1/_public/current.json", encode({ ...current.pointer, indexPath: "../private" }));
    expect(await probe()).toMatchObject({ reasons: ["HTTP_STATIC_INVALID"] }); expect(bridge.calls).toHaveLength(1);
  });
  it("rejects missing bodies, HTTP redirects and HTML without following or displaying them", async () => {
    current.files.delete(`/f1plus1/${current.pointer.indexPath}`);
    expect(await probe()).toMatchObject({ reasons: ["HTTP_STATUS_UNEXPECTED"], statusCode: 404 });
    custom = (_, response) => { response.writeHead(302, { location: "https://private.invalid/" }); response.end(); };
    const before = bridge.calls.length;
    expect(await probe()).toMatchObject({ reasons: ["HTTP_REDIRECT_REJECTED"] }); expect(bridge.calls.length - before).toBe(1);
    custom = (_, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end("<html>secret</html>"); };
    expect(await probe()).toMatchObject({ reasons: ["HTTP_STATIC_INVALID"] });
  });
  it("bounds streamed bytes even without Content-Length", async () => {
    custom = (_, response) => { response.writeHead(200, { "content-type": "application/json" }); response.write("x".repeat(4097)); response.end(); };
    expect(await probe()).toMatchObject({ reasons: ["HTTP_BODY_TOO_LARGE"] });
  });
  it.each(["index", "body"])("rejects an oversized declared %s before buffering", async (part) => {
    custom = (request, response) => {
      const path = new URL(request.url!, "http://localhost").pathname;
      const hit = part === "index" ? path.endsWith("index.json") : path.includes("/responses/");
      response.writeHead(200, { "content-type": "application/json", ...(hit ? { "content-length": String((part === "index" ? 16 : 2) * 1024 * 1024 + 1) } : {}) });
      response.end(hit ? "x" : current.files.get(path));
    };
    expect(await probe()).toMatchObject({ reasons: ["HTTP_BODY_TOO_LARGE"] });
  });
  it("hashes and validates decoded gzip bytes for both V2 and exact V1 fallback", async () => {
    custom = (request, response) => {
      const path = new URL(request.url!, "http://localhost").pathname;
      const wire = gzipSync(current.files.get(path)!);
      response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "content-length": wire.length }); response.end(wire);
    };
    expect(await probe()).toMatchObject({ status: "healthy", staticSnapshot: { schemaVersion: v2.schemaVersion, visibleItems: 0 } });
    current = fixture(problem(503, "PUBLIC_READ_INTEGRITY_FAILED"), 503);
    expect(await probe()).toMatchObject({ status: "healthy", staticSnapshot: { schemaVersion: v1.schemaVersion, visibleItems: 0 } });
  });
  it.each(["br", "deflate", "gzip, br"])("rejects unsupported or multiple content encoding %s", async (encoding) => {
    custom = (_, response) => { response.writeHead(200, { "content-type": "application/json", "content-encoding": encoding }); response.end("private"); };
    expect(await probe()).toMatchObject({ reasons: ["HTTP_STATIC_INVALID"], staticSnapshot: null });
  });
  it.each(["fake", "truncated", "crc"])("rejects %s gzip without reporting success or exposing bytes", async (kind) => {
    let wire = gzipSync(encode(current.pointer));
    if (kind === "fake") wire = Buffer.from("private-invalid-gzip");
    if (kind === "truncated") wire = wire.subarray(0, wire.length - 5);
    if (kind === "crc") wire[wire.length - 8] ^= 1;
    custom = (_, response) => { response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" }); response.end(wire); };
    const result = await probe();
    expect(result).toMatchObject({ status: "failed", reasons: ["HTTP_STATIC_INVALID"] }); expect(JSON.stringify(result)).not.toContain("private");
  });
  it.each([false, true])("bounds decoded gzip output including concatenated members (%s)", async (concatenated) => {
    const wire = concatenated ? Buffer.concat([gzipSync(Buffer.alloc(3000, 120)), gzipSync(Buffer.alloc(3000, 120))]) : gzipSync(Buffer.alloc(4097, 120));
    expect(wire.length).toBeLessThan(4096);
    custom = (_, response) => { response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" }); response.end(wire); };
    expect(await probe()).toMatchObject({ reasons: ["HTTP_BODY_TOO_LARGE"] });
  });
  it("rejects gzip wire bytes over the resource cap before trying decompression", async () => {
    custom = (_, response) => { response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" }); response.write(Buffer.alloc(4097, 120)); response.end(); };
    expect(await probe()).toMatchObject({ reasons: ["HTTP_BODY_TOO_LARGE"] });
  });
  it("rejects a gzip body whose decoded hash does not match the pinned index", async () => {
    custom = (request, response) => {
      const path = new URL(request.url!, "http://localhost").pathname;
      const bytes = current.files.get(path)!;
      const wire = gzipSync(path.endsWith("index.json") ? Buffer.concat([bytes, Buffer.from(" ")]) : bytes);
      response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" }); response.end(wire);
    };
    expect(await probe()).toMatchObject({ reasons: ["HTTP_STATIC_INVALID"] });
  });
  it("uses one total deadline and aborts a stalled request", async () => {
    custom = (request, response) => {
      const path = new URL(request.url!, "http://localhost").pathname;
      if (path.includes("/responses/")) { response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" }); response.write(gzipSync(current.files.get(path)!).subarray(0, 10)); return; }
      setTimeout(() => { response.writeHead(200, { "content-type": "application/json" }); response.end(current.files.get(path)); }, 1200);
    };
    const begin = performance.now();
    expect(await probe()).toMatchObject({ status: "failed", reasons: ["HTTP_TIMEOUT"] });
    expect(performance.now() - begin).toBeLessThan(PAGES_TIMEOUT_MS + 750);
  }, 18_000);
  it("rejects ambiguous Pages operator configuration and extra capabilities", () => {
    for (const target of [{ kind: "github-pages", url: `${PUBLIC_PAGES_CURRENT_URL}?` }, { kind: "github-pages", url: PUBLIC_PAGES_CURRENT_URL, tunnelPid: 1 }, { kind: "other", url: PUBLIC_PAGES_CURRENT_URL }]) expect(() => parseSiteStatusConfig({ ...config, publicTarget: target })).toThrow("STATUS_CONFIG_INVALID");
  });
});
