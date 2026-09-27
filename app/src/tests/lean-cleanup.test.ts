import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cleanupSkip, expiredUnreferenced, referencedMediaNames, runCleanup } from "../server/lean/cleanup.ts";
import { buildSiteBundle } from "../server/lean/site-bundle.ts";
import type { StoredItem } from "../server/lean/store.ts";

function item(id: string, at: string): StoredItem {
  return {
    publicId: id, sourceId: "motorsport-f1-news", platform: "rss", displayName: "Motorsport.com", contentType: "race_news",
    requireRelevance: false, link: `https://www.motorsport.com/f1/news/${id}/`, title: "English title", text: "body",
    sourcePublishedAt: at, firstSeenAt: at, image: null, images: [], status: "ready", attempts: 1,
    titleZh: "旧闻", summaryZh: "摘要", summaryEn: null, keyPointsZh: [], keyPointsEn: [], detailEn: null, detailZh: null, publishedAt: at
  };
}

describe("lean cleanup", () => {
  it("skips when the cycle lock is held or a race is on or the last publish failed", () => {
    expect(cleanupSkip({ lockHeld: true, raceWindow: false, publishFailed: false })).toBe("LOCK_HELD");
    expect(cleanupSkip({ lockHeld: false, raceWindow: true, publishFailed: false })).toBe("RACE_WINDOW");
    expect(cleanupSkip({ lockHeld: false, raceWindow: false, publishFailed: true })).toBe("PUBLISH_FAILED");
    expect(cleanupSkip({ lockHeld: false, raceWindow: false, publishFailed: false })).toBeNull();
  });

  it("does not delete during a dry-run, a lock conflict, or a race window", () => {
    const root = mkdtempSync(join(tmpdir(), "lean-cleanup-"));
    const media = join(root, "media");
    mkdirSync(media);
    const file = join(media, `${"a".repeat(32)}.webp`);
    writeFileSync(file, "picture");
    utimesSync(file, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    const removed: string[] = [];
    const now = new Date("2026-09-23T04:00:00Z");
    const dry = runCleanup({ now, dryRun: true, dataRoot: root, pagesCheckout: join(root, "missing"), removeFile: (path) => removed.push(path) });
    expect(dry.mediaFiles).toBe(1);
    expect(dry.mediaBytes).toBe(7);
    expect(removed).toEqual([]);
    const locked = runCleanup({ now, dryRun: false, lockHeld: true, dataRoot: root, pagesCheckout: join(root, "missing"), removeFile: (path) => removed.push(path) });
    expect(locked.skipped).toBe("LOCK_HELD");
    const racing = runCleanup({ now, dryRun: false, raceWindow: true, dataRoot: root, pagesCheckout: join(root, "missing"), removeFile: (path) => removed.push(path) });
    expect(racing.skipped).toBe("RACE_WINDOW");
    expect(removed).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps media that an older generation still references", () => {
    const name = `${"b".repeat(32)}.webp`;
    const old = { name, path: `/tmp/${name}`, bytes: 10, mtimeMs: Date.parse("2026-01-01T00:00:00Z") };
    const loose = { name: `${"c".repeat(32)}.webp`, path: "/tmp/c.webp", bytes: 4, mtimeMs: old.mtimeMs };
    const referenced = referencedMediaNames([], [`https://f1plus1.com/media/${name}`], []);
    const expired = expiredUnreferenced([old, loose], referenced, Date.parse("2026-09-23T00:00:00Z"), 7 * 24 * 3600 * 1000);
    expect(expired.map((file) => file.name)).toEqual([loose.name]);
  });

  it("publishes an archive page for stories outside the homepage window and keeps their detail URL", () => {
    const recent = item("public-rss-recent", "2026-09-20T00:00:00.000Z");
    const archived = item("public-rss-archived", "2026-06-01T00:00:00.000Z");
    const bundle = buildSiteBundle([recent], "2026-09-26T00:00:00.000Z", new Map(), new Set(), [archived]);
    const archive = JSON.parse(bundle.files.get("archive.json")!.toString()) as { months: { id: string; items: { publicId: string }[] }[] };
    expect(archive.months.map((month) => month.id)).toEqual(["2026-06"]);
    expect(archive.months[0]?.items[0]?.publicId).toBe(archived.publicId);
    const texts = [...bundle.files.values()].map((bytes) => bytes.toString());
    expect(texts.filter((text) => text.includes('"hasMore"')).some((text) => text.includes(archived.publicId))).toBe(false);
    expect(texts.some((text) => text.includes('"story"') && text.includes(archived.publicId))).toBe(true);
    expect(bundle.itemCount).toBe(1);
  });
});
