import { spawn, type ChildProcess } from "node:child_process";
import { request, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { createConnection } from "node:net";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { appRoot } from "../src/server/runtime-config.ts";
import { encodePublicCursor, isCanonicalUtc } from "../src/server/public/cursor.ts";
import { runSafeCli } from "../src/server/security/cli.ts";

const PUBLIC_HOST = "127.0.0.1";
const PUBLIC_PORT = 3000;
const NEXT_INTERNAL_PORT = 3001;

type HttpResult = {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
};

const FEED_ITEM_KEYS = [
  "publicId",
  "contentType",
  "state",
  "titleZh",
  "summaryZh",
  "publishedAt",
  "sourcePublishedAt",
  "sourceTimeStatus",
  "source",
  "media",
  "originalLink"
] as const;
const STORY_KEYS = [...FEED_ITEM_KEYS, "leadZh", "bodyZh", "keyPointsZh"] as const;
const PROBLEM_KEYS = ["type", "title", "status", "detail", "instance", "reasonCode", "traceId"] as const;
const CONTENT_TYPES = ["race_news", "driver_social", "legends_history", "paddock_fun"] as const;

function childEnvironment(): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    NODE_ENV: "production",
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    TMPDIR: process.env.TMPDIR,
    NEXT_TELEMETRY_DISABLED: "1"
  };
}

function httpGet(path: string): Promise<HttpResult> {
  return new Promise((resolveResult, rejectResult) => {
    const options: RequestOptions = {
      hostname: PUBLIC_HOST,
      port: PUBLIC_PORT,
      path,
      method: "GET",
      timeout: 5_000
    };
    const req = request(options, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size <= 512 * 1024) chunks.push(chunk);
      });
      response.on("end", () => {
        resolveResult({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error("CLI_INTERNAL_ERROR")));
    req.on("error", rejectResult);
    req.end();
  });
}

function jsonRecord(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CLI_INTERNAL_ERROR");
  }
  return parsed as Record<string, unknown>;
}

function str(value: unknown): string {
  if (typeof value !== "string") throw new Error("CLI_INTERNAL_ERROR");
  return value;
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function feedTimelineAt(item: Record<string, unknown>): string | null {
  if (typeof item.publishedAt !== "string" || !isCanonicalUtc(item.publishedAt)) return null;
  if (item.sourceTimeStatus === "known") {
    return typeof item.sourcePublishedAt === "string" && isCanonicalUtc(item.sourcePublishedAt)
      ? item.sourcePublishedAt
      : null;
  }
  if (item.sourceTimeStatus === "unknown" && item.sourcePublishedAt === null) {
    return item.publishedAt;
  }
  return null;
}

async function waitForReady(child: ChildProcess): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("CLI_INTERNAL_ERROR");
    try {
      const result = await httpGet("/api/health");
      if (result.status === 200) {
        const health = jsonRecord(result.body);
        if (health.status === "ready") return health;
      }
    } catch {
      // Not ready yet; keep polling.
    }
    await delay(100);
  }
  throw new Error("CLI_INTERNAL_ERROR");
}

async function stopProcessGroup(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-pid, "SIGINT");
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(100);
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The isolated child process group already stopped.
  }
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolveListening) => {
    const socket = createConnection({ host: PUBLIC_HOST, port });
    const finish = (listening: boolean): void => {
      socket.destroy();
      resolveListening(listening);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

async function assertStopped(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) throw new Error("CLI_INTERNAL_ERROR");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [port3000, port3001] = await Promise.all([isPortListening(PUBLIC_PORT), isPortListening(NEXT_INTERNAL_PORT)]);
    if (!port3000 && !port3001 && !processGroupExists(pid)) return;
    await delay(100);
  }
  throw new Error("CLI_INTERNAL_ERROR");
}

const KNOWN_KEYS = new Set<string>([
  ...FEED_ITEM_KEYS,
  ...STORY_KEYS,
  ...PROBLEM_KEYS,
  "schemaVersion",
  "items",
  "page",
  "pageSize",
  "hasMore",
  "nextCursor",
  "cursorAt",
  "cursorId",
  "story",
  "relatedItems",
  "sourceId",
  "platform",
  "displayName",
  "byline",
  "accessStatus",
  "kind",
  "assetRef",
  "altZh",
  "captionZh",
  "creditDisplay",
  "tone",
  "enabled",
  "url",
  "reason"
]);
const INSTANCE_WHITELIST = new Set(["/api/public/feed", "/api/public/stories"]);
const ABSOLUTE_PATH_PATTERN = /^(?:\/|\\\\|[A-Za-z]:[\\/]|\.{1,2}[\\/])/;
const SCHEME_URL_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const RUNTIME_KEYWORD_PATTERN = /\b(?:private_key|client_secret|password|NODE_OPTIONS|process\.env)\b/i;

type LeakCounts = {
  absolute_path: number;
  scheme_url: number;
  runtime_keyword: number;
  unexpected_field: number;
};

const leak: LeakCounts = { absolute_path: 0, scheme_url: 0, runtime_keyword: 0, unexpected_field: 0 };

// Structural zero-leak classifier: only counts per fixed category are recorded,
// never the matching values or the response bodies they came from.
function walk(value: unknown, key: string | null = null, depth = 0): void {
  if (depth > 12 || value === null) return;
  if (typeof value === "string") {
    if (key === "instance") {
      if (!INSTANCE_WHITELIST.has(value)) leak.unexpected_field += 1;
      return;
    }
    if (ABSOLUTE_PATH_PATTERN.test(value)) leak.absolute_path += 1;
    if (SCHEME_URL_PATTERN.test(value)) leak.scheme_url += 1;
    if (RUNTIME_KEYWORD_PATTERN.test(value)) leak.runtime_keyword += 1;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, null, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const childKey of Object.keys(record)) {
      if (!KNOWN_KEYS.has(childKey)) leak.unexpected_field += 1;
      walk(record[childKey], childKey, depth + 1);
    }
  }
}

const failures: string[] = [];
const matrix: Record<string, boolean> = {};

function check(name: string, ok: boolean): void {
  matrix[name] = ok;
  if (!ok) failures.push(name);
}

function sortedKeys(keys: readonly string[]): string {
  return [...keys].sort().join(",");
}

await runSafeCli(async () => {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("CLI_INTERNAL_ERROR");

  const child = spawn(process.execPath, [npmCli, "--silent", "run", "start"], {
    cwd: appRoot,
    detached: true,
    env: childEnvironment(),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let capturedBytes = 0;
  const capture = (chunk: Buffer): void => {
    capturedBytes += chunk.byteLength;
    if (capturedBytes > 256 * 1024) void stopProcessGroup(child);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);

  const health: Record<string, unknown> = await waitForReady(child);

  try {
    const healthRuntime = health.runtime;
    const runtimeRecord = healthRuntime !== null && typeof healthRuntime === "object" && !Array.isArray(healthRuntime)
      ? (healthRuntime as Record<string, unknown>)
      : {};
    const healthScope = str(health.scope);
    const healthStatus = str(health.status);
    const healthReason = str(health.reasonCode);
    const healthDataGate = str(health.dataGate);
    const healthExternalCalls = Number(health.externalCalls);
    const healthMigration = str(runtimeRecord.migration);
    const healthSeed = str(runtimeRecord.seed);

    check("health:scope", healthScope === "local-only");
    check("health:status", healthStatus === "ready");
    check("health:reason", healthReason === "ok");
    check("health:dataGate", healthDataGate === "accepted-public-synthetic");
    check("health:externalCalls", healthExternalCalls === 0);
    check("health:migration", healthMigration === "public-synthetic-0003");
    check("health:seed", healthSeed === "12-public-synthetic");

    const feed = await httpGet("/api/public/feed");
    check("feed:status", feed.status === 200);
    check("feed:noStore", feed.headers["cache-control"] === "no-store");
    check("feed:noCors", feed.headers["access-control-allow-origin"] === undefined);
    const feedBody = jsonRecord(feed.body);
    walk(feedBody);
    const feedItems = recordArray(feedBody.items);
    check("feed:schema", feedBody.schemaVersion === "public-read-v0.1");
    check("feed:12items", feedItems.length === 12);
    const page = feedBody.page;
    const pageRecord = page !== null && typeof page === "object" && !Array.isArray(page) ? (page as Record<string, unknown>) : {};
    check("feed:pageClosed", pageRecord.pageSize === 12 && pageRecord.hasMore === false && pageRecord.nextCursor === null);
    check(
      "feed:itemKeys",
      feedItems.every((item) => Object.keys(item).length === FEED_ITEM_KEYS.length && FEED_ITEM_KEYS.every((key) => key in item))
    );
    const timelineValues = feedItems.map(feedTimelineAt);
    check("feed:sourceTimeIntegrity", timelineValues.every((value) => value !== null));
    const actualIds = feedItems.map((item) => str(item.publicId));
    const sortedIds = [...feedItems]
      .sort((left, right) => {
        const leftTimelineAt = feedTimelineAt(left) ?? "";
        const rightTimelineAt = feedTimelineAt(right) ?? "";
        const timestamp = Date.parse(rightTimelineAt) - Date.parse(leftTimelineAt);
        if (timestamp !== 0) return timestamp;
        const leftId = str(left.publicId);
        const rightId = str(right.publicId);
        if (leftId === rightId) return 0;
        return leftId < rightId ? 1 : -1;
      })
      .map((item) => str(item.publicId));
    check("feed:sorted", actualIds.join("|") === sortedIds.join("|"));
    check(
      "feed:originalLink",
      feedItems.every((item) => {
        const original = item.originalLink;
        const originalRecord = original !== null && typeof original === "object" && !Array.isArray(original)
          ? (original as Record<string, unknown>)
          : {};
        return originalRecord.enabled === false && originalRecord.url === null;
      })
    );

    for (const contentType of CONTENT_TYPES) {
      const filtered = await httpGet(`/api/public/feed?contentType=${contentType}`);
      const filteredBody = jsonRecord(filtered.body);
      walk(filteredBody);
      const filteredItems = recordArray(filteredBody.items);
      check(
        `feed:filter:${contentType}`,
        filtered.status === 200 && filteredItems.length > 0 && filteredItems.every((item) => item.contentType === contentType)
      );
      check(`feed:filter:${contentType}:noStore`, filtered.headers["cache-control"] === "no-store");
    }

    const sourceActive = await httpGet("/api/public/feed?source=src-active");
    const sourceActiveBody = jsonRecord(sourceActive.body);
    walk(sourceActiveBody);
    check("feed:source:active", sourceActive.status === 200 && recordArray(sourceActiveBody.items).length === 12);
    const sourceMissing = await httpGet("/api/public/feed?source=src-missing");
    const sourceMissingBody = jsonRecord(sourceMissing.body);
    walk(sourceMissingBody);
    check("feed:source:missing", sourceMissing.status === 200 && recordArray(sourceMissingBody.items).length === 0);

    const firstItem = feedItems[0];
    const firstId = str(firstItem?.publicId);
    const firstTimelineAt = firstItem ? feedTimelineAt(firstItem) : null;
    if (firstTimelineAt === null) throw new Error("CLI_INTERNAL_ERROR");
    const cursorId = encodePublicCursor({
      v: 2,
      publicId: firstId,
      timelineAt: firstTimelineAt,
      source: null,
      contentType: null
    });
    const cursorQuery = `?cursorAt=${encodeURIComponent(firstTimelineAt)}&cursorId=${encodeURIComponent(cursorId)}`;
    const cursorPage = await httpGet(`/api/public/feed${cursorQuery}`);
    const cursorBody = jsonRecord(cursorPage.body);
    walk(cursorBody);
    const cursorItems = recordArray(cursorBody.items);
    check("cursor:status", cursorPage.status === 200);
    check("cursor:noStore", cursorPage.headers["cache-control"] === "no-store");
    check("cursor:11items", cursorItems.length === 11);
    check("cursor:firstExcluded", !cursorItems.some((item) => str(item.publicId) === firstId));

    const scopeQuery = `?source=src-active&cursorAt=${encodeURIComponent(firstTimelineAt)}&cursorId=${encodeURIComponent(cursorId)}`;
    const scopeResponse = await httpGet(`/api/public/feed${scopeQuery}`);
    const scopeBody = jsonRecord(scopeResponse.body);
    walk(scopeBody);
    check("cursor:scope:status", scopeResponse.status === 400);
    check("cursor:scope:reason", str(scopeBody.reasonCode) === "PUBLIC_CURSOR_SCOPE_MISMATCH");

    const problemKeys = sortedKeys(PROBLEM_KEYS);
    const invalidQueries: Array<[string, string]> = [
      ["?limit=1", "PUBLIC_QUERY_INVALID"],
      ["?source=", "PUBLIC_QUERY_INVALID"],
      ["?source=src-active&source=src-active", "PUBLIC_QUERY_INVALID"],
      ["?contentType=unknown", "PUBLIC_QUERY_INVALID"],
      [`?source=${"a".repeat(129)}`, "PUBLIC_QUERY_INVALID"],
      ["?cursorAt=2026-08-02T01%3A40%3A00Z", "PUBLIC_CURSOR_PAIR_REQUIRED"],
      ["?cursorAt=2026-08-02T01%3A40%3A00Z&cursorId=e30", "PUBLIC_CURSOR_INVALID"],
      ["?cursorAt=2026-08-02T01%3A40%3A00Z&cursorId=e30%3D", "PUBLIC_CURSOR_INVALID"]
    ];
    for (const [query, reasonCode] of invalidQueries) {
      const response = await httpGet(`/api/public/feed${query}`);
      const problem = jsonRecord(response.body);
      walk(problem);
      check(`invalid:${reasonCode}:status`, response.status === 400);
      check(`invalid:${reasonCode}:problemType`, String(response.headers["content-type"] ?? "").startsWith("application/problem+json"));
      check(`invalid:${reasonCode}:noStore`, response.headers["cache-control"] === "no-store");
      check(`invalid:${reasonCode}:noCors`, response.headers["access-control-allow-origin"] === undefined);
      check(`invalid:${reasonCode}:keys`, Object.keys(problem).sort().join(",") === problemKeys);
      check(`invalid:${reasonCode}:reasonCode`, str(problem.reasonCode) === reasonCode);
      check(`invalid:${reasonCode}:instance`, str(problem.instance) === "/api/public/feed");
      check(`invalid:${reasonCode}:noEcho`, !response.body.includes(query));
    }

    const detail = await httpGet(`/api/public/stories/${firstId}`);
    const detailBody = jsonRecord(detail.body);
    walk(detailBody);
    check("detail:status", detail.status === 200);
    check("detail:noStore", detail.headers["cache-control"] === "no-store");
    check("detail:noCors", detail.headers["access-control-allow-origin"] === undefined);
    check("detail:keys", Object.keys(detailBody).sort().join(",") === ["schemaVersion", "story", "relatedItems"].sort().join(","));
    const story = detailBody.story;
    const storyRecord = story !== null && typeof story === "object" && !Array.isArray(story) ? (story as Record<string, unknown>) : {};
    check("detail:storyId", str(storyRecord.publicId) === firstId);
    check("detail:storyKeys", Object.keys(storyRecord).sort().join(",") === sortedKeys(STORY_KEYS));
    check(
      "detail:content",
      Array.isArray(storyRecord.bodyZh) &&
        (storyRecord.bodyZh as unknown[]).length > 0 &&
        Array.isArray(storyRecord.keyPointsZh) &&
        (storyRecord.keyPointsZh as unknown[]).length > 0
    );
    const relatedItems = recordArray(detailBody.relatedItems);
    const relatedIds = relatedItems.map((item) => str(item.publicId));
    check("detail:related", relatedItems.length <= 3 && new Set(relatedIds).size === relatedItems.length && !relatedIds.includes(firstId));

    const missingResponse = await httpGet("/api/public/stories/public-demo-not-present");
    const missingBody = jsonRecord(missingResponse.body);
    walk(missingBody);
    check("detail:missing:status", missingResponse.status === 404);
    check("detail:missing:reason", str(missingBody.reasonCode) === "PUBLIC_STORY_NOT_FOUND");
    check("detail:missing:keys", Object.keys(missingBody).sort().join(",") === problemKeys);
    check("detail:missing:instance", str(missingBody.instance) === "/api/public/stories");
    check("detail:missing:noStore", missingResponse.headers["cache-control"] === "no-store");

    const invalidIdResponse = await httpGet("/api/public/stories/public-invalid_id");
    const invalidIdBody = jsonRecord(invalidIdResponse.body);
    walk(invalidIdBody);
    check("detail:invalid:status", invalidIdResponse.status === 400);
    check("detail:invalid:reason", str(invalidIdBody.reasonCode) === "PUBLIC_ID_INVALID");
    check("detail:invalid:instance", str(invalidIdBody.instance) === "/api/public/stories");
    check("detail:invalid:noStore", invalidIdResponse.headers["cache-control"] === "no-store");

    check(
      "leak:zero",
      leak.absolute_path === 0 && leak.scheme_url === 0 && leak.runtime_keyword === 0 && leak.unexpected_field === 0
    );
  } finally {
    await stopProcessGroup(child);
    await assertStopped(child);
  }

  const receipt = {
    command: "test:public-http",
    status: failures.length === 0 ? "ok" : "failed",
    bindHost: PUBLIC_HOST,
    port: PUBLIC_PORT,
    health: {
      scope: str(health.scope),
      status: str(health.status),
      reasonCode: str(health.reasonCode),
      dataGate: str(health.dataGate),
      externalCalls: Number(health.externalCalls),
      migration: health.runtime !== null && typeof health.runtime === "object"
        ? String((health.runtime as Record<string, unknown>).migration)
        : "unverified",
      seed: health.runtime !== null && typeof health.runtime === "object"
        ? String((health.runtime as Record<string, unknown>).seed)
        : "unverified"
    },
    matrix,
    leakCategories: { ...leak },
    signal: "SIGINT",
    stopped: true,
    portsClear: [PUBLIC_PORT, NEXT_INTERNAL_PORT],
    processGroupClear: true,
    externalCalls: 0,
    failures
  };
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
});
