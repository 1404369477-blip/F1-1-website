import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadAppConfig, type AppConfig, type EnvRecord } from "../server/config/env";
import { closeDatabase, migrateDatabase, openSafeDatabase, type SqliteDatabase } from "../server/db/database";
import { seedPublicSyntheticFixture } from "../server/db/public-synthetic";
import { seedSourceFixture } from "../server/db/source";
import { encodePublicCursor } from "../server/public/cursor";
import { handlePublicFeed, handlePublicStory, publicProblem } from "../server/public/http";
import { PublicStoryRepository } from "../server/public/repository";
import type { PublicContentType, PublicFeedResponseV1, PublicProblemV1, PublicStoryDetailResponseV1 } from "../server/public/types";

const appRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const projectRoot = resolve(appRoot, "..");

function env(profile: "m3-shadow" | "public-synthetic"): EnvRecord {
  const publicProfile = profile === "public-synthetic";
  return {
    APP_ENV: "test",
    APP_PORT: "3010",
    APP_BIND_HOST: "127.0.0.1",
    APP_PUBLIC_ORIGIN: "http://127.0.0.1:3010",
    F1_DATA_PROFILE: profile,
    F1_DB_PATH: publicProfile ? ".local/f1plus1-public-synthetic.sqlite" : ".local/f1plus1.sqlite",
    SOURCE_CONFIG_PROVIDER: "fixture",
    SOURCE_FIXTURE_PATH: publicProfile
      ? "../data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json"
      : "../data/m3-base-shadow-import-v0/main-source-record-batch.json",
    ADAPTER_MODE: "mock",
    SUMMARY_MODE: "fixture",
    MEDIA_MODE: "fixture",
    PUBLISH_MODE: "manual_only",
    REAL_FEISHU_IO: "false",
    REAL_EXTERNAL_IO: "false",
    REAL_FORM_SUBMIT: "false",
    ADMIN_ACCESS_MODE: "local_dev_only",
    LOG_LEVEL: "info"
  };
}

function config(profile: "m3-shadow" | "public-synthetic"): AppConfig {
  return loadAppConfig(env(profile), { appRoot, projectRoot });
}

type Runtime = {
  root: string;
  database: SqliteDatabase;
  repository: PublicStoryRepository;
  cleanup(): void;
};

function publicRuntime(): Runtime {
  const root = mkdtempSync(join(tmpdir(), "f1plus1-public-api-"));
  mkdirSync(root, { mode: 0o700, recursive: true });
  const profile = config("public-synthetic");
  const database = openSafeDatabase(join(root, "f1plus1-public-synthetic.sqlite"), { appRoot: root, allowTestRoot: root });
  migrateDatabase(database, resolve(appRoot, "migrations"));
  seedPublicSyntheticFixture(database, profile, appRoot, projectRoot);
  return {
    root,
    database,
    repository: new PublicStoryRepository(database, profile, appRoot, projectRoot),
    cleanup: () => {
      closeDatabase(database);
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function feedRequest(query = ""): Request {
  return new Request(`http://untrusted.invalid/api/public/feed${query}`);
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

function expectSuccessHeaders(response: Response): void {
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
}

function expectProblemHeaders(response: Response): void {
  expect(response.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
}

function mutatePayload(database: SqliteDatabase, table: string, idColumn: string, path: string, value: unknown): void {
  const row = database.prepare(`SELECT ${idColumn} AS id, payload_json FROM ${table} LIMIT 1`).get() as Record<string, unknown>;
  const payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
  const segments = path.split(".");
  let target: Record<string, unknown> = payload;
  for (const segment of segments.slice(0, -1)) target = target[segment] as Record<string, unknown>;
  target[segments.at(-1)!] = value;
  database.prepare(`UPDATE ${table} SET payload_json = ? WHERE ${idColumn} = ?`).run(JSON.stringify(payload), row.id as string);
}

describe("public feed and detail API v0.1", () => {
  it("returns the 12 projection-first feed items with filters and canonical cursor handling", async () => {
    const runtime = publicRuntime();
    try {
      const response = handlePublicFeed(feedRequest(), runtime.repository);
      expect(response.status).toBe(200);
      expectSuccessHeaders(response);
      const body = await json<PublicFeedResponseV1>(response);
      expect(Object.keys(body)).toEqual(["schemaVersion", "items", "page"]);
      expect(body.schemaVersion).toBe("public-read-v0.1");
      expect(body.items).toHaveLength(12);
      expect(body.page).toEqual({ pageSize: 12, hasMore: false, nextCursor: null });
      expect(new Set(body.items.map((item) => item.publicId)).size).toBe(12);
      expect(body.items.every((item) => item.publicId.startsWith("public-demo-"))).toBe(true);
      expect(body.items).toEqual([...body.items].sort((left, right) =>
        right.publishedAt.localeCompare(left.publishedAt) || right.publicId.localeCompare(left.publicId)
      ));

      const itemKeys = ["publicId", "contentType", "state", "titleZh", "summaryZh", "publishedAt", "sourcePublishedAt", "sourceTimeStatus", "source", "media", "originalLink"];
      for (const item of body.items) {
        expect(Object.keys(item)).toEqual(itemKeys);
        expect(item.originalLink).toEqual({ enabled: false, url: null, reason: expect.stringMatching(/^(synthetic_only|source_restricted)$/) });
      }
      for (const contentType of ["race_news", "driver_social", "legends_history", "paddock_fun"] as PublicContentType[]) {
        const filtered = await json<PublicFeedResponseV1>(handlePublicFeed(feedRequest(`?contentType=${contentType}`), runtime.repository));
        expect(filtered.items.length).toBeGreaterThan(0);
        expect(filtered.items.every((item) => item.contentType === contentType)).toBe(true);
      }
      expect((await json<PublicFeedResponseV1>(handlePublicFeed(feedRequest("?source=src-active"), runtime.repository))).items).toHaveLength(12);
      expect((await json<PublicFeedResponseV1>(handlePublicFeed(feedRequest("?source=src-missing"), runtime.repository))).items).toHaveLength(0);

      const first = body.items[0];
      const cursorId = encodePublicCursor({ v: 1, publicId: first.publicId, publishedAt: first.publishedAt, source: null, contentType: null });
      const continued = await json<PublicFeedResponseV1>(handlePublicFeed(
        feedRequest(`?cursorAt=${encodeURIComponent(first.publishedAt)}&cursorId=${cursorId}`),
        runtime.repository
      ));
      expect(continued.items).toHaveLength(11);
      expect(continued.items.some((item) => item.publicId === first.publicId)).toBe(false);
      const scopeMismatch = handlePublicFeed(
        feedRequest(`?source=src-active&cursorAt=${encodeURIComponent(first.publishedAt)}&cursorId=${cursorId}`),
        runtime.repository
      );
      expect(scopeMismatch.status).toBe(400);
      expect((await json<PublicProblemV1>(scopeMismatch)).reasonCode).toBe("PUBLIC_CURSOR_SCOPE_MISMATCH");
      const unknownCursor = encodePublicCursor({ v: 1, publicId: "public-demo-missing", publishedAt: first.publishedAt, source: null, contentType: null });
      const unknownTarget = handlePublicFeed(
        feedRequest(`?cursorAt=${encodeURIComponent(first.publishedAt)}&cursorId=${unknownCursor}`),
        runtime.repository
      );
      expect((await json<PublicProblemV1>(unknownTarget)).reasonCode).toBe("PUBLIC_CURSOR_INVALID");
    } finally {
      runtime.cleanup();
    }
  });

  it("returns closed query, cursor and detail errors without echoing inputs", async () => {
    const runtime = publicRuntime();
    try {
      const invalidQueries = [
        ["?limit=1", "PUBLIC_QUERY_INVALID"],
        ["?source=", "PUBLIC_QUERY_INVALID"],
        ["?source=src-active&source=src-active", "PUBLIC_QUERY_INVALID"],
        ["?contentType=unknown", "PUBLIC_QUERY_INVALID"],
        [`?source=${"a".repeat(129)}`, "PUBLIC_QUERY_INVALID"],
        ["?cursorAt=2026-08-02T01%3A40%3A00Z", "PUBLIC_CURSOR_PAIR_REQUIRED"],
        ["?cursorAt=2026-02-30T00%3A00%3A00Z&cursorId=e30", "PUBLIC_CURSOR_INVALID"],
        ["?cursorAt=2026-08-02T01%3A40%3A00Z&cursorId=e30%3D", "PUBLIC_CURSOR_INVALID"]
      ] as const;
      for (const [query, reasonCode] of invalidQueries) {
        const response = handlePublicFeed(feedRequest(query), runtime.repository);
        expect(response.status).toBe(400);
        expectProblemHeaders(response);
        const problem = await json<PublicProblemV1>(response);
        expect(Object.keys(problem)).toEqual(["type", "title", "status", "detail", "instance", "reasonCode", "traceId"]);
        expect(problem.reasonCode).toBe(reasonCode);
        expect(problem.instance).toBe("/api/public/feed");
        expect(JSON.stringify(problem)).not.toContain(query);
      }

      const invalidId = handlePublicStory("../private", runtime.repository);
      expect(invalidId.status).toBe(400);
      expect((await json<PublicProblemV1>(invalidId)).reasonCode).toBe("PUBLIC_ID_INVALID");
      const missing = handlePublicStory("public-demo-not-present", runtime.repository);
      expect(missing.status).toBe(404);
      expect((await json<PublicProblemV1>(missing)).reasonCode).toBe("PUBLIC_STORY_NOT_FOUND");
    } finally {
      runtime.cleanup();
    }
  });

  it("returns all 12 details with 0-3 ordered related items and no private fields", async () => {
    const runtime = publicRuntime();
    try {
      const feed = await json<PublicFeedResponseV1>(handlePublicFeed(feedRequest(), runtime.repository));
      for (const item of feed.items) {
        const response = handlePublicStory(item.publicId, runtime.repository);
        expect(response.status).toBe(200);
        expectSuccessHeaders(response);
        const detail = await json<PublicStoryDetailResponseV1>(response);
        expect(Object.keys(detail)).toEqual(["schemaVersion", "story", "relatedItems"]);
        expect(detail.story.publicId).toBe(item.publicId);
        expect(detail.story.bodyZh.length).toBeGreaterThan(0);
        expect(detail.story.keyPointsZh.length).toBeGreaterThan(0);
        expect(detail.relatedItems.length).toBeLessThanOrEqual(3);
        expect(detail.relatedItems.every((related) => related.publicId !== item.publicId)).toBe(true);
        expect(new Set(detail.relatedItems.map((related) => related.publicId)).size).toBe(detail.relatedItems.length);
        const serialized = JSON.stringify(detail);
        expect(serialized).not.toMatch(/synthetic\.invalid|canonical_url|external_url|evidence_url|reviewer|decision_reason|hash|fence|epoch|raw_|SQL|\/Users\//i);
      }
    } finally {
      runtime.cleanup();
    }
  });

  it("fails the whole response for hash, fence, ledger, status or missing-chain damage", async () => {
    const attacks: Array<(runtime: Runtime) => void> = [
      (runtime) => mutatePayload(runtime.database, "public_content", "content_id", "content_version_hash", "0".repeat(64)),
      (runtime) => mutatePayload(runtime.database, "public_release_bundle", "release_bundle_id", "source_config_epoch", 2),
      (runtime) => runtime.database.prepare("UPDATE fixture_profile_ledger SET row_counts_json = ?").run("{}"),
      (runtime) => mutatePayload(runtime.database, "public_publication", "publication_id", "publication_status", "withdrawn"),
      (runtime) => runtime.database.prepare("DELETE FROM published_projection WHERE projection_id = (SELECT projection_id FROM published_projection LIMIT 1)").run()
    ];
    for (const [index, attack] of attacks.entries()) {
      const runtime = publicRuntime();
      try {
        attack(runtime);
        const response = handlePublicFeed(feedRequest(), runtime.repository);
        expect(response.status, `attack ${index}`).toBe(500);
        expectProblemHeaders(response);
        const problem = await json<PublicProblemV1>(response);
        expect(["PUBLIC_READ_INTEGRITY_FAILED", "PUBLIC_READ_INCOMPLETE_CHAIN"]).toContain(problem.reasonCode);
        const serialized = JSON.stringify(problem);
        expect(serialized).not.toContain('"items":');
        expect(serialized).not.toContain('"story":');
        expect(serialized).not.toMatch(/0{32}|SELECT|sqlite|payload|\/private\/|\/Users\//i);
      } finally {
        runtime.cleanup();
      }
    }
  });

  it("rejects m3-shadow public reads and exposes the bounded busy Problem header", async () => {
    const root = mkdtempSync(join(tmpdir(), "f1plus1-public-api-m3-"));
    const m3Config = config("m3-shadow");
    const database = openSafeDatabase(join(root, "f1plus1.sqlite"), { appRoot: root, allowTestRoot: root });
    try {
      migrateDatabase(database, resolve(appRoot, "migrations"));
      seedSourceFixture(database, m3Config, appRoot, projectRoot);
      const response = handlePublicFeed(feedRequest(), new PublicStoryRepository(database, m3Config, appRoot, projectRoot));
      expect(response.status).toBe(503);
      expect((await json<PublicProblemV1>(response)).reasonCode).toBe("PUBLIC_PROFILE_UNAVAILABLE");
      const busy = publicProblem("PUBLIC_DB_BUSY", "/api/public/feed");
      expect(busy.status).toBe(503);
      expect(busy.headers.get("retry-after")).toBe("1");
      expect(Object.keys(await json<PublicProblemV1>(busy))).toEqual(["type", "title", "status", "detail", "instance", "reasonCode", "traceId"]);
    } finally {
      closeDatabase(database);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
