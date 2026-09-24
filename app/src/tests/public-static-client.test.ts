import { createHash } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("NEXT_PUBLIC_F1_STATIC_SITE", "true");
const { fetchPublicFeed, fetchPublicStory, isPublicStoryNotFound } = await import("../features/stories/public-api");
const { publicStoryHref } = await import("../features/stories/public-site-config");

afterEach(() => vi.unstubAllGlobals());
afterAll(() => vi.unstubAllEnvs());

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function installGeneration(generatedAt: string): string {
  const body = JSON.stringify({ schemaVersion: "public-read-bilingual-v2", items: [], page: { limit: 12, nextCursor: null, asOf: generatedAt }, generationId: "public-empty", generationHash: "1".repeat(64) });
  const bodyHash = sha256(body);
  const index = JSON.stringify({ schemaVersion: "public-static-index-v1", generatedAt, responses: { "/api/public/feed?limit=12&v=2": { status: 200, contentType: "application/json; charset=utf-8", path: `responses/${bodyHash}.json`, sha256: bodyHash } } });
  const bundleId = sha256(index);
  const indexPath = `_public/generations/${bundleId}/index.json`;
  const pointer = JSON.stringify({ schemaVersion: "public-static-pointer-v1", generatedAt, bundleId, indexPath, indexSha256: bundleId });
  const files = new Map([
    ["/f1plus1/_public/current.json", pointer],
    [`/f1plus1/${indexPath}`, index],
    [`/f1plus1/_public/generations/${bundleId}/responses/${bodyHash}.json`, body]
  ]);
  vi.stubGlobal("fetch", async (input: string) => {
    const text = files.get(new URL(input, "https://public.invalid").pathname);
    return new Response(text ?? "404", { status: text === undefined ? 404 : 200 });
  });
  return bundleId;
}

describe("default static public client", () => {
  it("selects static data without test fetch injection and carries bundle identity to the caller", async () => {
    const bundleId = installGeneration("2026-09-12T07:00:00.000Z");
    const feed = await fetchPublicFeed();
    expect(feed.staticBundleId).toBe(bundleId);
    expect(feed.stories).toEqual([]);
    expect(feed.page.hasMore).toBe(false);
  });

  it("preserves the generation-change error through the public API for UI cache reset", async () => {
    const previous = installGeneration("2026-09-12T07:00:00.000Z");
    await fetchPublicFeed();
    installGeneration("2026-09-12T07:01:00.000Z");
    await expect(fetchPublicFeed({ staticBundleId: previous })).rejects.toMatchObject({ name: "PublicStaticGenerationChangedError" });
  });

  it("uses a refreshable fixed detail route and reports withdrawn content as not found", async () => {
    installGeneration("2026-09-12T07:00:00.000Z");
    expect(publicStoryHref("public-static-story")).toBe("/stories/?publicId=public-static-story");
    await expect(fetchPublicStory({ publicId: "public-withdrawn" })).rejects.toSatisfy(isPublicStoryNotFound);
  });
});
