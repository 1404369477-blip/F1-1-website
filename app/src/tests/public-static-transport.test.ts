import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { appendPublicFeedPage } from "../features/stories/feed-experience";
import { isPublicStaticShellPath, PublicStaticShellBuildSchema } from "../features/stories/public-static-artifact";
import { fetchPublicFeed, fetchPublicStory, isPublicStoryNotFound, PublicApiClientError } from "../features/stories/public-api";
import {
  normalizePublicStaticRequestKey,
  PublicStaticIndexSchema,
  PublicStaticPointerSchema,
  type PublicStaticIndex
} from "../features/stories/public-static-schema";
import { createPublicStaticFetch, PublicStaticGenerationChangedError } from "../features/stories/public-static-transport";
import type { PublicFeedResponseV1, PublicStoryDetailResponseV1 } from "../server/public/types";

const generatedAt = "2026-09-12T06:00:00.000Z";
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
const emptyFeed: PublicFeedResponseV1 = { schemaVersion: "public-read-v0.1", items: [], page: { pageSize: 12, hasMore: false, nextCursor: null } };
const detail: PublicStoryDetailResponseV1 = {
  schemaVersion: "public-read-v0.1",
  story: {
    publicId: "public-static-story", contentType: "race_news", state: "restricted", titleZh: "已公开提炼", summaryZh: "合法中文摘要",
    publishedAt: generatedAt, sourcePublishedAt: null, sourceTimeStatus: "unknown",
    source: { sourceId: "source-news", platform: "rss", displayName: "合法来源", byline: "未知", accessStatus: "restricted" },
    media: null, originalLink: { enabled: false, url: null, reason: "source_restricted" }, leadZh: "公开导语", bodyZh: ["公开正文。"], keyPointsZh: []
  },
  relatedItems: []
};
const readFailure = {
  type: "urn:f1plus1:problem:PUBLIC_READ_INTEGRITY_FAILED", title: "Public read unavailable", status: 503,
  detail: "The signed public snapshot integrity check failed.", instance: "/api/public/feed",
  reasonCode: "PUBLIC_READ_INTEGRITY_FAILED", traceId: "trace-fixture"
};

function artifact(rows: Array<{ key: string; body: unknown; status?: 200 | 400 | 404 | 406 | 500 | 503 }>, at = generatedAt) {
  const responses: PublicStaticIndex["responses"] = {};
  const bodies = new Map<string, string>();
  for (const row of rows) {
    const text = JSON.stringify(row.body);
    const sha256 = hash(text);
    const status = row.status ?? 200;
    responses[normalizePublicStaticRequestKey(row.key)] = { status, contentType: status === 200 ? "application/json; charset=utf-8" : "application/problem+json; charset=utf-8", path: `responses/${sha256}.json`, sha256 };
    bodies.set(sha256, text);
  }
  const index = PublicStaticIndexSchema.parse({ schemaVersion: "public-static-index-v1", generatedAt: at, responses });
  const indexText = JSON.stringify(index);
  const bundleId = hash(indexText);
  const directory = `_public/generations/${bundleId}/`;
  const pointer = PublicStaticPointerSchema.parse({ schemaVersion: "public-static-pointer-v1", bundleId, generatedAt: at, indexPath: `${directory}index.json`, indexSha256: bundleId });
  const files = new Map<string, string>([["/f1plus1/_public/current.json", JSON.stringify(pointer)], [`/f1plus1/${pointer.indexPath}`, indexText]]);
  for (const [sha256, text] of bodies) files.set(`/f1plus1/${directory}responses/${sha256}.json`, text);
  return { files, pointer, index, bundleId };
}

function server(files: Map<string, string>) {
  const calls: string[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    calls.push(input);
    const path = new URL(input, "https://static.invalid").pathname;
    const text = files.get(path);
    return new Response(text ?? "Not found", { status: text === undefined ? 404 : 200, headers: { "Content-Type": "application/json" } });
  };
  return { fetch, calls };
}

describe("public static transport", () => {
  it("allows only public shell artifacts and rejects private routes, code, traversal, and source maps", () => {
    for (const path of ["index.html", "stories/index.html", "404/index.html", "_not-found/__next._full.txt", "_next/static/chunks/app-123.js", ".nojekyll"]) expect(isPublicStaticShellPath(path)).toBe(true);
    for (const path of ["admin/index.html", "api/public/feed.json", ".env", "src/app/page.tsx", "_next/static/app.js.map", "stories/../../private.txt", "/index.html"]) expect(isPublicStaticShellPath(path)).toBe(false);
    const files = ["index.html", "stories/index.html", "404.html", ".nojekyll"].map((path) => ({ path, sha256: "0".repeat(64), bytes: 0 }));
    expect(() => PublicStaticShellBuildSchema.parse({ schemaVersion: "public-static-shell-build-v1", basePath: "/f1plus1", nodeVersion: "v24.18.0", files: [...files, files[0]] })).toThrow();
  });

  it("uses canonical keys and rejects duplicate, foreign, private, and ambiguous requests", () => {
    expect(normalizePublicStaticRequestKey("/api/public/feed?v=2&limit=12&category=race_news")).toBe("/api/public/feed?category=race_news&limit=12&v=2");
    expect(normalizePublicStaticRequestKey("/api/public/feed?source=source-news&v=1")).toBe("/api/public/feed?source=source-news&v=1");
    for (const input of ["https://evil.invalid/api/public/feed", "/api/admin/reviews", "/api/public/feed?v=2&v=1", "/api/public/feed?draft=true", "/api/public/feed#fragment", "/api/public/stories/public-bad%2fadmin", "/api/public/feed?cursorId=abc"]) {
      expect(() => normalizePublicStaticRequestKey(input)).toThrow();
    }
  });

  it("closes pointer/index fields and forbids response path traversal and hash disagreement", () => {
    const data = artifact([{ key: "/api/public/feed", body: emptyFeed }]);
    expect(() => PublicStaticPointerSchema.parse({ ...data.pointer, token: "private" })).toThrow();
    expect(() => PublicStaticPointerSchema.parse({ ...data.pointer, indexPath: "https://evil.invalid/index.json" })).toThrow();
    expect(() => PublicStaticPointerSchema.parse({ ...data.pointer, bundleId: "0".repeat(64) })).toThrow();
    const ref = data.index.responses["/api/public/feed"];
    expect(() => PublicStaticIndexSchema.parse({ ...data.index, responses: { "/api/public/feed": { ...ref, path: "../private.json" } } })).toThrow();
    expect(() => PublicStaticIndexSchema.parse({ ...data.index, responses: { "/api/admin/reviews": ref } })).toThrow();
  });

  it("preserves exact V2 unavailability and negotiates V1 once within the same verified bundle", async () => {
    const data = artifact([{ key: "/api/public/feed?v=2&limit=12", body: readFailure, status: 503 }, { key: "/api/public/feed", body: emptyFeed }]);
    const origin = server(data.files);
    const transport = createPublicStaticFetch({ fetchImpl: origin.fetch });
    const feed = await fetchPublicFeed({ fetchImpl: transport.fetch });
    expect(feed.stories).toEqual([]);
    expect(feed.page).toEqual(emptyFeed.page);
    expect(transport.getBundleId()).toBe(data.bundleId);
    expect(origin.calls.filter((path) => path.includes("current.json"))).toHaveLength(1);
    expect(origin.calls.every((path) => path.startsWith("/f1plus1/_public/"))).toBe(true);
  });

  it("keeps a V2 empty result empty and never fills it with V1 content", async () => {
    const bilingualEmpty = { schemaVersion: "public-read-bilingual-v2", items: [], page: { limit: 12, nextCursor: null, asOf: generatedAt }, generationId: "generation-empty", generationHash: "1".repeat(64) };
    const data = artifact([{ key: "/api/public/feed?v=2&limit=12", body: bilingualEmpty }, { key: "/api/public/feed", body: { ...emptyFeed, items: [detail.story] } }]);
    const origin = server(data.files);
    expect((await fetchPublicFeed({ fetchImpl: createPublicStaticFetch({ fetchImpl: origin.fetch }).fetch })).stories).toEqual([]);
    expect(origin.calls.filter((path) => path.includes("/responses/"))).toHaveLength(1);
  });

  it("rejects successful DTOs whose version disagrees with the static request key", async () => {
    const bilingualEmpty = { schemaVersion: "public-read-bilingual-v2", items: [], page: { limit: 12, nextCursor: null, asOf: generatedAt }, generationId: "generation-empty", generationHash: "1".repeat(64) };
    for (const row of [
      { key: "/api/public/feed?v=2&limit=12", body: emptyFeed },
      { key: "/api/public/feed", body: bilingualEmpty },
      { key: "/api/public/feed?v=1", body: bilingualEmpty },
      { key: "/api/public/stories/public-static-story?v=2", body: detail }
    ]) {
      const data = artifact([row]);
      const transport = createPublicStaticFetch({ fetchImpl: server(data.files).fetch });
      await expect(transport.fetch(row.key, { headers: { Accept: "application/json" } })).rejects.toThrow("PUBLIC_STATIC_UNAVAILABLE");
    }
  });

  it("preserves closed detail DTO permissions and does not fall back after a V2 404", async () => {
    const notFound = { ...readFailure, type: "urn:f1plus1:problem:PUBLIC_STORY_NOT_FOUND", status: 404, reasonCode: "PUBLIC_STORY_NOT_FOUND" };
    const rows = [{ key: "/api/public/stories/public-static-story?v=2", body: readFailure, status: 503 as const }, { key: "/api/public/stories/public-static-story", body: detail }];
    const data = artifact(rows);
    const response = await fetchPublicStory({ publicId: "public-static-story", fetchImpl: createPublicStaticFetch({ fetchImpl: server(data.files).fetch }).fetch });
    expect(response.story.title).toBe(detail.story.titleZh);
    expect(response.story.originalUrl).toBeNull();
    expect(response.story.state).toBe("restricted");
    const removed = artifact([{ ...rows[0], body: notFound, status: 404 }, rows[1]]);
    const origin = server(removed.files);
    await expect(fetchPublicStory({ publicId: "public-static-story", fetchImpl: createPublicStaticFetch({ fetchImpl: origin.fetch }).fetch })).rejects.toSatisfy(isPublicStoryNotFound);
    expect(origin.calls.filter((path) => path.includes("/responses/"))).toHaveLength(1);
  });

  it("rejects damaged body bytes, missing files, HTML, and incorrect closed DTOs instead of rendering empty data", async () => {
    for (const failure of ["hash", "missing", "html", "schema"] as const) {
      const data = artifact([{ key: "/api/public/feed?v=2&limit=12", body: failure === "schema" ? { ...emptyFeed, privateReview: true } : emptyFeed }]);
      const ref = Object.values(data.index.responses)[0];
      const path = `/f1plus1/_public/generations/${data.bundleId}/${ref.path}`;
      if (failure === "hash") data.files.set(path, JSON.stringify({ ...emptyFeed, items: [detail.story] }));
      if (failure === "missing") data.files.delete(path);
      if (failure === "html") data.files.set(`/f1plus1/${data.pointer.indexPath}`, "<html>404</html>");
      await expect(fetchPublicFeed({ fetchImpl: createPublicStaticFetch({ fetchImpl: server(data.files).fetch }).fetch })).rejects.toBeInstanceOf(PublicApiClientError);
    }
  });

  it("detects a newer valid generation before reading a stale cursor or stale detail", async () => {
    const before = artifact([{ key: "/api/public/feed", body: emptyFeed }]);
    const after = artifact([{ key: "/api/public/feed", body: emptyFeed }], "2026-09-12T06:01:00.000Z");
    const origin = server(after.files);
    const transport = createPublicStaticFetch({ fetchImpl: origin.fetch, expectedBundleId: before.bundleId });
    await expect(transport.fetch("/api/public/feed?cursorAt=2026-09-12T06%3A00%3A00.000Z&cursorId=YWJj", { headers: { Accept: "application/json" } })).rejects.toBeInstanceOf(PublicStaticGenerationChangedError);
    expect(origin.calls.some((path) => path.includes("/responses/"))).toBe(false);
  });

  it("cannot append pages across bundles and retains the bundle identity through successive pages", () => {
    const first = { stories: [], page: emptyFeed.page, staticBundleId: "a".repeat(64) };
    expect(appendPublicFeedPage(first, { ...first, staticBundleId: "b".repeat(64) })).toBeNull();
    expect(appendPublicFeedPage(first, first)?.staticBundleId).toBe(first.staticBundleId);
  });

  it("returns closed not-found for withdrawn details and invalid-cursor for unexported cursors", async () => {
    const data = artifact([{ key: "/api/public/feed", body: emptyFeed }]);
    const transport = createPublicStaticFetch({ fetchImpl: server(data.files).fetch });
    const gone = await transport.fetch("/api/public/stories/public-withdrawn?v=2", { headers: { Accept: "application/json" } });
    expect(gone.status).toBe(404);
    expect((await gone.json()).reasonCode).toBe("PUBLIC_STORY_NOT_FOUND");
    const stale = await transport.fetch("/api/public/feed?v=2&limit=12&cursor=oldcursor", { headers: { Accept: "application/json" } });
    expect(stale.status).toBe(400);
    expect((await stale.json()).reasonCode).toBe("PUBLIC_CURSOR_INVALID");
  });

  it("aborts without requests and preserves network failure for normal retry", async () => {
    const origin = server(new Map());
    const controller = new AbortController();
    controller.abort();
    await expect(createPublicStaticFetch({ fetchImpl: origin.fetch }).fetch("/api/public/feed", { headers: { Accept: "application/json" }, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(origin.calls).toEqual([]);
    const offline = async (): Promise<Response> => { throw new TypeError("Network failed"); };
    await expect(fetchPublicFeed({ fetchImpl: createPublicStaticFetch({ fetchImpl: offline }).fetch })).rejects.toMatchObject({ status: 0 });
  });
});
