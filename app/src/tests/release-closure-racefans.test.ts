import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  realpathSync
} from "node:fs";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertRuntimeLocalClosure,
  deriveRuntimeLocalClosure,
  deriveRuntimeLocalClosureGraph,
  assertRuntimeGitClosure
} from "../server/release/local-closure.ts";
import {
  deriveAdminBuildClosure,
  assertAdminBuildClosure
} from "../server/release/build-closure.ts";
import {
  assertPublicRuntimeClosure,
  assertPublicReleaseRuntimePathContract,
  buildPublicRuntimeClosure,
  PUBLIC_RELEASE_RUNTIME_FILE_COUNT,
  PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256,
  PUBLIC_RELEASE_RUNTIME_FILES,
  PUBLIC_RUNTIME_CLOSURE_SPEC,
  publicReleaseRuntimePathSetSha256,
  publicRuntimeClosureSha256
} from "../server/public/release-manifest.ts";
import { readPublicProjectionDeploymentManifest } from "../server/public/deployment.ts";
import {
  attachAllowlistedOgImages,
  RSS_ARTICLE_BATCH_CONCURRENCY
} from "../server/rss/article-batch.ts";
import { RSS_MAX_HTML_BYTES, RssAttemptLedger } from "../server/rss/types.ts";
import type { RssTrustedTransportInjection } from "../server/rss/transport.ts";

function item(id: string) {
  return {
    externalId: id,
    canonicalUrl: `https://www.racefans.net/2026/08/article-${id}/`,
    title: `Title ${id}`,
    excerpt: `Excerpt ${id}`,
    author: null,
    publishedAt: "2026-08-21T00:00:00.000Z",
    media: null,
    sourcePayloadHash: createHash("sha256").update(id).digest("hex")
  } as const;
}

const html = "<meta property=\"og:image\" content=\"https://www.racefans.net/wp-content/uploads/2026/08/article.jpg\">";

function writeClosureTsconfig(root: string): void {
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { module: "esnext", moduleResolution: "bundler", baseUrl: ".", paths: { "@/*": ["src/*"] } }
  }));
}

function requestLocal(port: number, path: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const request_ = request({ host: "127.0.0.1", port, path, method: "GET", signal }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => response.statusCode === 200
        ? resolve(Buffer.concat(chunks).toString("utf8"))
        : reject(new Error(`LOCAL_HTTP_${response.statusCode}`)));
    });
    request_.once("error", reject);
    request_.end();
  });
}

function trustedLoopbackTransport(port: number): RssTrustedTransportInjection {
  return {
    // Production resolver seam: native DNS returns no answer, so the real
    // resolver falls through to its DoH request and parses this loopback
    // response. No test code increments the ledger.
    dnsLookup: async () => [],
    request: (options, callback) => request({
      host: "127.0.0.1",
      port,
      path: options.path,
      method: options.method,
      headers: options.headers,
      agent: false
    }, callback)
  };
}

describe("release closure fail-closed checks", () => {
  it("rejects an omitted direct/transitive local import", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-closure-import-"));
    try {
      writeClosureTsconfig(root);
      writeFileSync(join(root, "entry.ts"), "import './nested.ts';\n");
      writeFileSync(join(root, "nested.ts"), "export { value } from './leaf.ts';\n");
      writeFileSync(join(root, "leaf.ts"), "export const value = 1;\n");
      const spec = { entrypoints: ["entry.ts"], requiredFiles: [], migrations: [] } as const;
      expect(deriveRuntimeLocalClosure(root, spec)).toEqual(["entry.ts", "leaf.ts", "nested.ts"]);
      expect(() => assertRuntimeLocalClosure(root, ["entry.ts", "nested.ts"], spec)).toThrow("leaf.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("derives an AST import graph for aliases, require/import-equals, literal dynamic imports and static assets", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-closure-ast-"));
    try {
      writeClosureTsconfig(root);
      mkdirSync(join(root, "src/folder"), { recursive: true });
      mkdirSync(join(root, "assets"), { recursive: true });
      writeFileSync(join(root, "entry.ts"), [
        "import { alias } from '@/alias';",
        "import eq = require('./eq');",
        "const required = require('./required');",
        "void import('./dynamic');",
        "import './style.css';",
        "import '@/folder';",
        "export const asset = new URL('./asset.json', import.meta.url);",
        "export { alias, eq, required };"
      ].join("\n"));
      writeFileSync(join(root, "src/alias.ts"), "export const alias = 1;\n");
      writeFileSync(join(root, "eq.ts"), "export = 2;\n");
      writeFileSync(join(root, "required.ts"), "export const required = 3;\n");
      writeFileSync(join(root, "dynamic.mts"), "export const dynamic = 4;\n");
      writeFileSync(join(root, "src/folder/index.mts"), "export const folder = 5;\n");
      writeFileSync(join(root, "asset.json"), "{\"ok\":true}\n");
      writeFileSync(join(root, "style.css"), "@import './nested.css'; .x{background:url('./assets/pixel.png')}\n");
      writeFileSync(join(root, "nested.css"), ".nested{display:block}\n");
      writeFileSync(join(root, "assets/pixel.png"), Buffer.from([0, 1, 2, 3]));
      writeFileSync(join(root, "shell.html"), "<link href=\"/style.css\"><script src=\"/entry.js\"></script>\n");
      const spec = {
        entrypoints: ["entry.ts"],
        requiredFiles: ["shell.html"],
        migrations: [],
        staticAssets: [
          { from: "shell.html", request: "/style.css", target: "style.css" },
          { from: "shell.html", request: "/entry.js", target: "entry.ts" }
        ]
      } as const;
      const graph = deriveRuntimeLocalClosureGraph(root, spec);
      expect(graph.files).toEqual(expect.arrayContaining([
        "src/alias.ts", "eq.ts", "required.ts", "dynamic.mts", "src/folder/index.mts",
        "asset.json", "style.css", "nested.css", "assets/pixel.png", "shell.html"
      ]));
      expect(graph.edges.map((edge) => edge.kind)).toEqual(expect.arrayContaining([
        "es-module", "dynamic-import", "require", "import-equals", "new-url", "css", "html"
      ]));
      expect(() => assertRuntimeLocalClosure(root, ["entry.ts", "tsconfig.json"], spec)).toThrow(/AST imports|required assets/);

      for (const expression of ["import(path)", "require(path)", "new URL(path, import.meta.url)"]) {
        writeFileSync(join(root, "entry.ts"), `const path = './required'; void ${expression};\n`);
        expect(() => deriveRuntimeLocalClosure(root, { entrypoints: ["entry.ts"], requiredFiles: [], migrations: [] })).toThrow(/computed/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a missing migration and detects runtime tamper", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-closure-migration-"));
    try {
      writeClosureTsconfig(root);
      writeFileSync(join(root, "entry.ts"), "export const ready = true;\n");
      expect(() => deriveRuntimeLocalClosure(root, {
        entrypoints: ["entry.ts"], requiredFiles: [], migrations: ["migrations/0001.sql"]
      })).toThrow("migrations/0001.sql");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    const appRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
    const target = join(appRoot, "src/server/public/types.ts");
    const original = readFileSync(target);
    const closureSha = publicRuntimeClosureSha256(appRoot);
    expect(() => assertPublicRuntimeClosure(appRoot, closureSha)).not.toThrow();
    try {
      writeFileSync(target, Buffer.concat([original, Buffer.from("\n// tamper probe\n", "utf8")]));
      expect(() => assertPublicRuntimeClosure(appRoot, closureSha)).toThrow("bytes changed");
    } finally {
      writeFileSync(target, original);
    }
  });

  it("fails closed for dirty and untracked runtime files", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-closure-git-"));
    try {
      mkdirSync(join(root, "app"), { recursive: true });
      writeFileSync(join(root, "app/runtime.ts"), "export const value = 1;\n");
      execFileSync("/usr/bin/git", ["-C", root, "init", "-q"]);
      execFileSync("/usr/bin/git", ["-C", root, "config", "user.email", "closure@test.invalid"]);
      execFileSync("/usr/bin/git", ["-C", root, "config", "user.name", "closure-test"]);
      execFileSync("/usr/bin/git", ["-C", root, "add", "app/runtime.ts"]);
      execFileSync("/usr/bin/git", ["-C", root, "commit", "-qm", "fixture"]);
      expect(() => assertRuntimeGitClosure(root, ["runtime.ts"])).not.toThrow();
      writeFileSync(join(root, "app/runtime.ts"), "export const value = 2;\n");
      expect(() => assertRuntimeGitClosure(root, ["runtime.ts"])).toThrow(/dirty/);
      writeFileSync(join(root, "app/untracked.ts"), "export const value = 3;\n");
      expect(() => assertRuntimeGitClosure(root, ["untracked.ts"])).toThrow(/ls-files|Git runtime closure/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes the public local closure and all six RSS migrations", () => {
    const appRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
    expect(PUBLIC_RELEASE_RUNTIME_FILES).toHaveLength(PUBLIC_RELEASE_RUNTIME_FILE_COUNT);
    expect(publicReleaseRuntimePathSetSha256(PUBLIC_RELEASE_RUNTIME_FILES)).toBe(PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256);
    expect(() => assertPublicReleaseRuntimePathContract(PUBLIC_RELEASE_RUNTIME_FILES)).not.toThrow();
    expect(PUBLIC_RELEASE_RUNTIME_FILES).not.toContain("scripts/public-release-bootstrap.ts");
    expect(PUBLIC_RUNTIME_CLOSURE_SPEC.entrypoints).not.toContain("scripts/public-release-bootstrap.ts");
    const replacement: string[] = [...PUBLIC_RELEASE_RUNTIME_FILES];
    replacement[replacement.indexOf("src/server/security/cli.ts")] = "src/replaced-runtime.ts";
    expect(() => assertPublicReleaseRuntimePathContract(replacement)).toThrow(/canonical identity changed/);
    const bootstrapReplacement: string[] = [...PUBLIC_RELEASE_RUNTIME_FILES];
    bootstrapReplacement[0] = "scripts/public-release-bootstrap.ts";
    expect(() => assertPublicReleaseRuntimePathContract(bootstrapReplacement)).toThrow(/legacy public release bootstrap/);
    const files = buildPublicRuntimeClosure(appRoot).map((entry) => entry.path);
    expect(files).toContain("src/server/public/release-manifest.ts");
    expect(files).toContain("src/modules/story/event-cluster.ts");
    expect(() => assertRuntimeLocalClosure(
      appRoot,
      PUBLIC_RELEASE_RUNTIME_FILES.filter((path) => path !== "src/modules/story/event-cluster.ts"),
      PUBLIC_RUNTIME_CLOSURE_SPEC
    )).toThrow("event-cluster.ts");
    const migrations = [
      "0001_rss_real.sql",
      "0002_admin_review_publish.sql",
      "0003_projection_delivery_runtime.sql",
      "0004_rss_media_and_chinese_refinement.sql",
      "0005_second_rss_autosport.sql",
      "0006_independent_rss_racefans_the_race.sql"
    ];
    for (const migration of migrations) {
      expect(files).toContain(`migrations/rss-real/${migration}`);
    }
  });

  it("derives a separate Next build closure for all Admin routes/conventions and rejects unapproved env files", () => {
    const appRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
    const closure = deriveAdminBuildClosure(appRoot);
    const adminRoutes = [
      "src/app/api/admin/csrf/route.ts",
      "src/app/api/admin/operations/[commandOperationId]/route.ts",
      "src/app/api/admin/session/refresh/route.ts",
      "src/app/api/admin/session/route.ts",
      "src/app/api/admin/sources/[sourceId]/activate/route.ts",
      "src/app/api/admin/sources/[sourceId]/requeue/route.ts",
      "src/app/api/admin/sources/[sourceId]/retire/route.ts",
      "src/app/api/admin/sources/[sourceId]/route.ts",
      "src/app/api/admin/sources/[sourceId]/stop/route.ts",
      "src/app/api/admin/sources/[sourceId]/validate/route.ts",
      "src/app/api/admin/sources/route.ts"
    ];
    expect(closure.paths).toEqual(expect.arrayContaining([
      ...adminRoutes,
      ".env.example",
      ".npmrc",
      ".node-version",
      ".nvmrc",
      "next.config.ts",
      "next-env.d.ts",
      "package-lock.json",
      "tsconfig.json",
      "src/app/globals.css"
    ]));
    expect(assertAdminBuildClosure(appRoot, closure.paths)).toEqual(closure);
    const rejected = join(appRoot, ".env.production.local");
    writeFileSync(rejected, "SHOULD_NOT_BE_READ=1\n", { mode: 0o600 });
    try {
      expect(() => deriveAdminBuildClosure(appRoot)).toThrow(/unapproved Next environment file/);
    } finally {
      unlinkSync(rejected);
    }
  });

  it("rejects legacy public deployment v2 with an explicit re-prepare or rollback instruction", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-public-v2-"));
    const manifest = join(root, "projection-deployment.json");
    try {
      chmodSync(root, 0o700);
      writeFileSync(manifest, '{"schemaVersion":"public-projection-deployment-v2"}', { mode: 0o600 });
      chmodSync(manifest, 0o600);
      expect(() => readPublicProjectionDeploymentManifest(manifest)).toThrow(
        "PUBLIC_DEPLOYMENT_V2_REPREPARE_OR_ROLLBACK_REQUIRED"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("RaceFans article enrichment receipt boundary", () => {
  it.each([0, 1, 20])("handles a feed with %i article lookups", async (count) => {
    const attempts = new RssAttemptLedger();
    let fetches = 0;
    const result = await attachAllowlistedOgImages({
      itemCount: count,
      items: Array.from({ length: count }, (_, index) => item(String(index)))
    }, "racefans-f1-news", {
      attempts,
      deadlineAt: Date.now() + 5_000,
      fetchArticleHtml: async ({ attempts: ledger }) => {
        fetches += 1;
        ledger.noteDnsAttempt();
        ledger.noteHttpAttempt();
        ledger.noteSuccessfulResourceRead();
        return html;
      }
    });
    expect(fetches).toBe(count);
    expect(result.items).toHaveLength(count);
    expect(result.items.every((entry) => entry.media !== null)).toBe(true);
    expect(attempts.snapshot()).toEqual({
      dnsAttempts: count,
      dohAttempts: 0,
      httpAttempts: count,
      successfulResourceReads: count
    });
    expect(attempts.totalExternalCalls()).toBe(count * 2);
  });

  it("bounds article concurrency and closes partial failures", async () => {
    const attempts = new RssAttemptLedger();
    let inFlight = 0;
    let peak = 0;
    await expect(attachAllowlistedOgImages({
      itemCount: 2,
      items: [item("ok"), item("fail")]
    }, "racefans-f1-news", {
      attempts,
      deadlineAt: Date.now() + 5_000,
      fetchArticleHtml: async ({ attempts: ledger, articleUrl }) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        ledger.noteDnsAttempt();
        ledger.noteHttpAttempt();
        if (articleUrl.includes("fail")) throw new Error("ARTICLE_FETCH_FAIL");
        ledger.noteSuccessfulResourceRead();
        return html;
      }
    })).rejects.toMatchObject({ reasonCode: "ARTICLE_BATCH_PARTIAL" });
    expect(peak).toBeLessThanOrEqual(RSS_ARTICLE_BATCH_CONCURRENCY);
    expect(attempts.totalExternalCalls()).toBe(4);
    expect(attempts.snapshot().successfulResourceReads).toBe(1);
  });

  it("closes a batch deadline before starting work and preserves DNS fallback counts", async () => {
    const attempts = new RssAttemptLedger();
    await expect(attachAllowlistedOgImages({ itemCount: 1, items: [item("late")] }, "racefans-f1-news", {
      attempts,
      deadlineAt: Date.now() - 1,
      fetchArticleHtml: async () => html
    })).rejects.toMatchObject({ reasonCode: "BATCH_DEADLINE_EXCEEDED" });
    expect(attempts.totalExternalCalls()).toBe(0);

    attempts.noteDnsAttempt();
    attempts.noteDohAttempt();
    attempts.noteHttpAttempt();
    attempts.noteSuccessfulResourceRead();
    expect(attempts.snapshot()).toEqual({
      dnsAttempts: 1,
      dohAttempts: 1,
      httpAttempts: 1,
      successfulResourceReads: 1
    });
    expect(attempts.totalExternalCalls()).toBe(3);
  });

  it("uses a real loopback transport for 20 items, caps concurrency at four and closes DNS fallback accounting", async () => {
    let inFlight = 0;
    let peak = 0;
    const server = createServer((request_, response) => {
      if (request_.url?.startsWith("/dns-query")) {
        response.writeHead(200, { "content-type": "application/dns-json" });
        response.end('{"Status":0,"Answer":[{"type":1,"data":"65.8.180.87"}]}');
        return;
      }
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      response.once("close", () => { inFlight -= 1; });
      setTimeout(() => {
        if (response.destroyed) return;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html);
      }, 8);
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as AddressInfo).port;
    const attempts = new RssAttemptLedger();
    try {
      const result = await attachAllowlistedOgImages({
        itemCount: 21,
        items: Array.from({ length: 21 }, (_, index) => item(String(index)))
      }, "racefans-f1-news", {
        attempts,
        deadlineAt: Date.now() + 2_000,
        env: { NODE_ENV: "test", RSS_REAL_IO: "true" },
        trustedTransport: trustedLoopbackTransport(port)
      });
      expect(result.items).toHaveLength(20);
      expect(peak).toBe(RSS_ARTICLE_BATCH_CONCURRENCY);
      expect(inFlight).toBe(0);
      expect(attempts.snapshot()).toEqual({
        dnsAttempts: 20,
        dohAttempts: 20,
        httpAttempts: 20,
        successfulResourceReads: 20
      });
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("runs the production article transport boundary for 0/1/20/21 and records DNS, DoH, HTTPS and reads", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      if (_request.url?.startsWith("/dns-query")) {
        response.writeHead(200, { "content-type": "application/dns-json" });
        response.end(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "65.8.180.87" }] }));
        return;
      }
      requests += 1;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as AddressInfo).port;
    try {
      for (const count of [0, 1, 20, 21] as const) {
        const attempts = new RssAttemptLedger();
        const result = await attachAllowlistedOgImages({
          itemCount: count,
          items: Array.from({ length: count }, (_, index) => item(String(index)))
        }, "racefans-f1-news", {
          attempts,
          deadlineAt: Date.now() + 5_000,
          env: { NODE_ENV: "test", RSS_REAL_IO: "true" },
          trustedTransport: trustedLoopbackTransport(port)
        });
        const expected = Math.min(count, 20);
        expect(result.items).toHaveLength(expected);
        expect(attempts.snapshot()).toEqual({
          dnsAttempts: expected,
          dohAttempts: expected,
          httpAttempts: expected,
          successfulResourceReads: expected
        });
      }
      expect(requests).toBe(41);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("counts a truncated production HTML response as exactly one bounded resource read", async () => {
    const oversized = Buffer.alloc(RSS_MAX_HTML_BYTES + 32, 0x61);
    const server = createServer((_request, response) => {
      if (_request.url?.startsWith("/dns-query")) {
        response.writeHead(200, { "content-type": "application/dns-json" });
        response.end(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "65.8.180.87" }] }));
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(oversized);
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as AddressInfo).port;
    const attempts = new RssAttemptLedger();
    try {
      const result = await attachAllowlistedOgImages({ itemCount: 1, items: [item("truncated")] }, "racefans-f1-news", {
        attempts,
        deadlineAt: Date.now() + 5_000,
        env: { NODE_ENV: "test", RSS_REAL_IO: "true" },
        trustedTransport: trustedLoopbackTransport(port)
      });
      expect(result.items).toHaveLength(1);
      expect(attempts.snapshot()).toEqual({
        dnsAttempts: 1,
        dohAttempts: 1,
        httpAttempts: 1,
        successfulResourceReads: 1
      });
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("hard-aborts all active loopback article requests at a running deadline and freezes counts", async () => {
    let abortedRequests = 0;
    let activeRequests = 0;
    const server = createServer((_request, response) => {
      if (_request.url?.startsWith("/dns-query")) {
        response.writeHead(200, { "content-type": "application/dns-json" });
        response.end(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "65.8.180.87" }] }));
        return;
      }
      activeRequests += 1;
      response.once("close", () => { activeRequests -= 1; });
      response.once("close", () => { if (!response.writableEnded) abortedRequests += 1; });
      setTimeout(() => {
        if (response.destroyed) return;
        response.writeHead(200, { "content-type": "text/html" });
        response.end(html);
      }, 500);
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as AddressInfo).port;
    const attempts = new RssAttemptLedger();
    try {
      await expect(attachAllowlistedOgImages({
        itemCount: 20,
        items: Array.from({ length: 20 }, (_, index) => item(String(index)))
      }, "racefans-f1-news", {
        attempts,
        deadlineAt: Date.now() + 40,
        env: { NODE_ENV: "test", RSS_REAL_IO: "true" },
        trustedTransport: trustedLoopbackTransport(port)
      })).rejects.toMatchObject({ reasonCode: "BATCH_DEADLINE_EXCEEDED" });
      const atReturn = attempts.snapshot();
      expect(activeRequests).toBe(0);
      await new Promise((resolveWait) => setTimeout(resolveWait, 30));
      expect(attempts.snapshot()).toEqual(atReturn);
      expect(atReturn.httpAttempts).toBe(RSS_ARTICLE_BATCH_CONCURRENCY);
      expect(atReturn.dnsAttempts).toBe(RSS_ARTICLE_BATCH_CONCURRENCY);
      expect(atReturn.dohAttempts).toBe(RSS_ARTICLE_BATCH_CONCURRENCY);
      expect(atReturn.successfulResourceReads).toBe(0);
      expect(abortedRequests).toBeGreaterThan(0);
      expect(activeRequests).toBe(0);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("turns a non-cooperative injected worker into an explicit bounded cleanup failure", async () => {
    const startedAt = Date.now();
    let active = 1;
    const cleanup = new Promise<void>((resolveCleanup) => {
      setTimeout(() => { active = 0; resolveCleanup(); }, 1_100);
    });
    await expect(attachAllowlistedOgImages({ itemCount: 1, items: [item("non-cooperative")] }, "racefans-f1-news", {
      attempts: new RssAttemptLedger(),
      deadlineAt: Date.now() + 20,
      fetchArticleHtml: () => ({
        result: new Promise<string>(() => {}),
        cleanup
      })
    })).rejects.toMatchObject({ reasonCode: "RESOURCE_CLEANUP_TIMEOUT" });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    expect(active).toBe(0);
  });
});
