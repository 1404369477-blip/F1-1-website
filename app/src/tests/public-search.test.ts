import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { loadPublicSearchIndex, matchPublicSearchItems, PublicSearchIndexSchema, type PublicSearchItem } from "../features/stories/public-search";
import { createPublicStaticFetch, PublicStaticGenerationChangedError } from "../features/stories/public-static-transport";
import { normalizePublicStaticRequestKey } from "../features/stories/public-static-schema";
import { publicSearchCard } from "../features/stories/public-api";

const generatedAt = "2026-09-28T00:00:00.000Z";
const story: PublicSearchItem = {
  publicId: "public-archive-max", contentType: "race_news", platform: "rss", titleZh: "维斯塔潘夺冠",
  summaryZh: "红牛赛车升级后赢得比赛。", titleEn: "Verstappen wins", summaryEn: "Red Bull takes a victory.",
  sourceName: "The Race", originalUrl: "https://www.the-race.com/formula-1/2026-title/", publishedAt: generatedAt
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function origin(payload: unknown = { schemaVersion: "public-search-v1", generatedAt, items: [story] }) {
  const body = JSON.stringify(payload);
  const sha = hash(body);
  const index = JSON.stringify({ schemaVersion: "public-static-index-v1", generatedAt, responses: {
    "/api/public/search?v=1": { status: 200, contentType: "application/json; charset=utf-8", path: `responses/${sha}.json`, sha256: sha }
  } });
  const bundleId = hash(index);
  const path = `_public/generations/${bundleId}/index.json`;
  const pointer = { schemaVersion: "public-static-pointer-v1", generatedAt, bundleId, indexPath: path, indexSha256: bundleId };
  const files = new Map([
    ["/_public/current.json", JSON.stringify(pointer)], [`/${path}`, index], [`/_public/generations/${bundleId}/responses/${sha}.json`, body]
  ]);
  const calls: string[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    init?.signal?.throwIfAborted();
    calls.push(input);
    const text = files.get(new URL(input, "https://example.invalid").pathname);
    return new Response(text ?? "404", { status: text === undefined ? 404 : 200 });
  };
  return { files, calls, fetch, bundleId };
}

describe("public archive search", () => {
  it("matches Chinese, case-insensitive English, full-width text and multiple terms across fields with category filtering", () => {
    const social = { ...story, publicId: "public-social", contentType: "driver_social" as const };
    for (const query of ["维斯塔潘", "VERSTAPPEN", "Ｖｅｒｓｔａｐｐｅｎ", "红牛 RACE", "WINs 2026-09-28"]) {
      expect(matchPublicSearchItems([story, social], query)).toHaveLength(2);
    }
    expect(matchPublicSearchItems([story, social], "race", "driver_social").map((row) => row.publicId)).toEqual([social.publicId]);
    expect(matchPublicSearchItems([story], "wins Ferrari")).toEqual([]);
    expect(matchPublicSearchItems([story], "   ")).toEqual([]);
    expect(publicSearchCard(story)).toMatchObject({ publicId: story.publicId, title: story.titleZh, originalUrl: story.originalUrl, images: [], platform: "rss" });
  });

  it("lazily downloads a version-bound index and reuses only its successfully validated completed result", async () => {
    const source = origin();
    expect(source.calls).toHaveLength(0);
    const index = await loadPublicSearchIndex({ fetchImpl: source.fetch, bundleId: source.bundleId });
    expect(index.bundleId).toBe(source.bundleId);
    expect(index.items).toEqual([story]);
    expect(source.calls).toHaveLength(3);
    const cached = await loadPublicSearchIndex({ fetchImpl: source.fetch, bundleId: source.bundleId });
    expect(cached).toBe(index);
    expect(source.calls).toHaveLength(3);
  });

  it("rejects duplicate IDs, private/unknown fields, invalid dates and an unexpected generatedAt", async () => {
    for (const items of [[story, story], [{ ...story, body: "private" }], [{ ...story, publicId: "../../private" }], [{ ...story, publishedAt: "yesterday" }]]) {
      expect(() => PublicSearchIndexSchema.parse({ schemaVersion: "public-search-v1", generatedAt, items })).toThrow();
    }
    for (const originalUrl of ["javascript:alert(1)", "data:text/html,hidden", "https://user:secret@example.com/private", "//example.com/post"]) {
      expect(() => PublicSearchIndexSchema.parse({ schemaVersion: "public-search-v1", generatedAt, items: [{ ...story, originalUrl }] })).toThrow();
    }
    const wrongTime = origin({ schemaVersion: "public-search-v1", generatedAt: "2026-09-27T00:00:00.000Z", items: [story] });
    await expect(loadPublicSearchIndex({ fetchImpl: wrongTime.fetch })).rejects.toThrow("PUBLIC_STATIC_UNAVAILABLE");
    const malformed = origin({ schemaVersion: "public-search-v1", generatedAt, items: [{ ...story, secret: "hidden" }] });
    await expect(loadPublicSearchIndex({ fetchImpl: malformed.fetch })).rejects.toThrow();
  });

  it("does not mix generations and rejects a modified index body before showing any result", async () => {
    const source = origin();
    await expect(loadPublicSearchIndex({ fetchImpl: source.fetch, bundleId: "a".repeat(64) })).rejects.toBeInstanceOf(PublicStaticGenerationChangedError);
    const bodyPath = [...source.files.keys()].find((key) => key.includes("/responses/"))!;
    source.files.set(bodyPath, JSON.stringify({ schemaVersion: "public-search-v1", generatedAt, items: [] }));
    const transport = createPublicStaticFetch({ fetchImpl: source.fetch, retryDelaysMs: [] });
    await expect(transport.fetch("/api/public/search?v=1", { headers: { Accept: "application/json" } })).rejects.toThrow("PUBLIC_STATIC_UNAVAILABLE");
  });

  it("cancels an obsolete query without poisoning the next request using the same generation", async () => {
    const source = origin();
    let blockFirst = true;
    const fetcher = async (input: string, init?: RequestInit): Promise<Response> => {
      if (blockFirst) {
        blockFirst = false;
        return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
      }
      return source.fetch(input, init);
    };
    const controller = new AbortController();
    const first = loadPublicSearchIndex({ fetchImpl: fetcher, bundleId: source.bundleId, signal: controller.signal });
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect((await loadPublicSearchIndex({ fetchImpl: fetcher, bundleId: source.bundleId })).items).toEqual([story]);
    const aborted = new AbortController();
    aborted.abort();
    await expect(loadPublicSearchIndex({ fetchImpl: fetcher, bundleId: source.bundleId, signal: aborted.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses a closed public search endpoint, not arbitrary query or private paths", () => {
    expect(normalizePublicStaticRequestKey("/api/public/search?v=1")).toBe("/api/public/search?v=1");
    for (const path of ["/api/public/search", "/api/public/search?v=2", "/api/public/search?v=1&body=true", "/api/public/search?v=1&v=1"]) {
      expect(() => normalizePublicStaticRequestKey(path)).toThrow();
    }
  });
});
