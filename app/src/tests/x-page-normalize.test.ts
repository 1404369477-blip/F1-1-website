import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { normalizePagePost, X_PAGE_HANDLES, X_PAGE_MAX_TEXT_CODEPOINTS, X_PAGE_SELECTION, type PagePost } from "../server/x-page/normalize.ts";

// Synthetic public-page DTOs only. These tests are not browser/login or production evidence.
const at = "2026-09-06T12:00:00.000Z";
function syntheticId(time = at): string {
  return ((BigInt(Date.parse(time)) - BigInt("1288834974657")) << BigInt(22)).toString();
}
const id = syntheticId();
const oldId = syntheticId("2026-09-06T11:00:00.000Z");
function fixture(): PagePost {
  return {
    schemaVersion: "x-visible-post-v1",
    source: { handle: "F1", enabled: true, identityStatus: "verified" },
    pageUrl: "https://x.com/F1", observedAt: "2026-09-06T12:01:00.000Z",
    statusUrl: `https://x.com/F1/status/${id}`, authorHandle: "F1", authorDisplayName: "Formula 1",
    publishedAt: at, text: "Synthetic race update 🏁", textComplete: true,
    relations: { replyToStatusUrl: null, quotedStatusUrl: null, repostedByHandle: null }, media: []
  };
}

describe("X visible page normalization (synthetic)", () => {
  test("pinned allowlist exactly matches the selected 27 in the fixed repository CSV", () => {
    const csv = readFileSync(new URL("../../../data/x-source-selection-v1.csv", import.meta.url));
    expect(createHash("sha256").update(csv).digest("hex")).toBe(X_PAGE_SELECTION.sha256);
    const selected = csv.toString("utf8").trim().split("\n").slice(1)
      .map(line => line.split(",")).filter(row => row[4] === "keep").map(row => row[0].toLowerCase());
    expect(X_PAGE_HANDLES).toEqual(selected);
    expect(new Set(X_PAGE_HANDLES).size).toBe(27);
    expect(X_PAGE_HANDLES).not.toContain("skysportsf1");
  });

  test("produces a frozen plain-text pending candidate without granting review or publish", () => {
    const input = fixture();
    const result = normalizePagePost(input);
    expect(result).toMatchObject({ authorHandle: "f1", observedOnHandle: "f1", statusId: id,
      canonicalUrl: `https://x.com/f1/status/${id}`, publishedAt: at, contentType: "text/plain", reviewState: "pending" });
    expect(result.identity).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sourceVersionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.relations)).toBe(true);
    expect(Object.isFrozen(result.mediaReferences)).toBe(true);
    expect(input).toEqual(fixture());
  });

  test("same original ID remains deduplicable across reads, URL shares, case and repost observations", () => {
    const direct = normalizePagePost(fixture());
    const repeated = fixture();
    repeated.statusUrl = `https://x.com/f1/status/${id}?s=20&t=public-share-token`;
    repeated.authorHandle = "f1";
    repeated.authorDisplayName = "Formula One";
    repeated.publishedAt = "2026-09-06T12:00:00Z";
    repeated.observedAt = "2026-09-06T12:10:00.000Z";
    repeated.source.handle = "McLarenF1";
    repeated.pageUrl = "https://x.com/McLarenF1/";
    repeated.relations.repostedByHandle = "McLarenF1";
    const repost = normalizePagePost(repeated);
    expect(repost.identity).toBe(direct.identity);
    expect(repost.sourceVersionHash).toBe(direct.sourceVersionHash);
    expect(repost.authorHandle).toBe("f1");
    expect(repost.observedOnHandle).toBe("mclarenf1");
    expect(repost.relations.repostedByHandle).toBe("mclarenf1");
  });

  test("edited text changes source version while preserving original identity", () => {
    const original = normalizePagePost(fixture());
    const edited = normalizePagePost({ ...fixture(), text: "Synthetic corrected race update" });
    expect(edited.identity).toBe(original.identity);
    expect(edited.sourceVersionHash).not.toBe(original.sourceVersionHash);
    const otherId = syntheticId("2026-09-06T12:00:01.000Z");
    const other = normalizePagePost({ ...fixture(), statusUrl: `https://x.com/F1/status/${otherId}`, publishedAt: "2026-09-06T12:00:01.000Z" });
    expect(other.identity).not.toBe(original.identity);
  });

  test("reply and quote links retain their authors without replacing this post author", () => {
    const input = fixture();
    input.relations.replyToStatusUrl = `https://x.com/SomeOtherAuthor/status/${oldId}`;
    input.relations.quotedStatusUrl = `https://x.com/McLarenF1/status/${oldId}`;
    const result = normalizePagePost(input);
    expect(result.authorHandle).toBe("f1");
    expect(result.relations.replyToStatusUrl).toContain("/someotherauthor/status/");
    expect(result.relations.quotedStatusUrl).toContain("/mclarenf1/status/");
    expect(result.sourceVersionHash).not.toBe(normalizePagePost(fixture()).sourceVersionHash);
    expect(() => normalizePagePost({ ...input, relations: { ...input.relations, quotedStatusUrl: input.statusUrl } })).toThrow("X_PAGE_SELF_REFERENCE");
    expect(() => normalizePagePost({ ...input, relations: { ...input.relations,
      quotedStatusUrl: `https://x.com/F1/status/${syntheticId("2026-09-06T12:00:01.000Z")}` } })).toThrow("X_PAGE_RELATION_TIME_INVALID");
  });

  test.each([
    ["author/status mismatch", { authorHandle: "McLarenF1" }, "X_PAGE_AUTHOR_MISMATCH"],
    ["page/source mismatch", { pageUrl: "https://x.com/McLarenF1" }, "X_PAGE_SOURCE_PAGE_MISMATCH"],
    ["cross-account without repost", { source: { handle: "McLarenF1", enabled: true, identityStatus: "verified" }, pageUrl: "https://x.com/McLarenF1" }, "X_PAGE_CROSS_ACCOUNT_POST"],
    ["wrong repost actor", { relations: { replyToStatusUrl: null, quotedStatusUrl: null, repostedByHandle: "McLarenF1" } }, "X_PAGE_REPOST_ACTOR_MISMATCH"]
  ])("rejects %s", (_name, fields, code) => {
    expect(() => normalizePagePost({ ...fixture(), ...fields })).toThrow(code);
  });

  test.each([
    ["disabled", { handle: "F1", enabled: false, identityStatus: "verified" }, "X_PAGE_SOURCE_DISABLED"],
    ["unknown identity", { handle: "F1", enabled: true, identityStatus: "unknown" }, "X_PAGE_SOURCE_IDENTITY_UNVERIFIED"],
    ["needs review", { handle: "audif1_", enabled: true, identityStatus: "needs_review" }, "X_PAGE_SOURCE_IDENTITY_UNVERIFIED"],
    ["RSS replacement", { handle: "SkySportsF1", enabled: true, identityStatus: "verified" }, "X_PAGE_SOURCE_NOT_SELECTED"],
    ["dropped", { handle: "autosport", enabled: true, identityStatus: "verified" }, "X_PAGE_SOURCE_NOT_SELECTED"],
    ["coerced flag", { handle: "F1", enabled: "true", identityStatus: "verified" }, "X_PAGE_INPUT_INVALID"],
    ["unknown source permission", { handle: "F1", enabled: true, identityStatus: "verified", automaticPublish: true }, "X_PAGE_INPUT_INVALID"]
  ])("fails closed on source %s", (_name, source, code) => {
    expect(() => normalizePagePost({ ...fixture(), source })).toThrow(code);
  });

  test.each([
    `http://x.com/F1/status/${id}`, `https://twitter.com/F1/status/${id}`,
    `https://x.com.evil.example/F1/status/${id}`, `https://x.com@evil.example/F1/status/${id}`,
    `https://user@x.com/F1/status/${id}`, `https://x.com:443/F1/status/${id}`,
    `https://x.com/F1/../F1/status/${id}`, `https://x.com/%46%31/status/${id}`,
    `https://x.com/i/web/status/${id}`, `https://x.com/F1/status/${id}/photo/1`,
    `https://x.com/F1/status/${id}#fragment`, `https://x.com/F1/status/${id}?token=secret`,
    `https://x.com/F1/status/0${id}`, "https://x.com/F1/status/18446744073709551616"
  ])("rejects noncanonical or unsafe URL %s", statusUrl => {
    expect(() => normalizePagePost({ ...fixture(), statusUrl })).toThrow(/X_PAGE_STATUS_(URL|ID)_INVALID/);
  });

  test.each(["", "  \n  ", "hello\u0000world", "hidden\u202etext", "hello\tworld", "hello\ud800"])("rejects invalid plain text %j", text => {
    expect(() => normalizePagePost({ ...fixture(), text })).toThrow(/X_PAGE_TEXT_/);
  });

  test("CRLF, CR and LF normalize to identical text and source versions", () => {
    const results = ["\n", "\r\n", "\r"].map(newline => normalizePagePost({ ...fixture(), text: `first${newline}second${newline}🏁`,
      media: [{ kind: "image", url: "https://pbs.twimg.com/media/synthetic?format=jpg&name=small", altText: `first${newline}second` }] }));
    for (const result of results) {
      expect(result.text).toBe("first\nsecond\n🏁");
      expect(result.mediaReferences[0].altText).toBe("first\nsecond");
      expect(result.identity).toBe(results[0].identity);
      expect(result.sourceVersionHash).toBe(results[0].sourceVersionHash);
    }
  });

  test.each(["\t", "\u0000", "\u000b", "\u000c", "\u007f", "\u0085", "\u202e", "\ufeff"])("newline normalization still rejects control %j at boundaries", control => {
    expect(() => normalizePagePost({ ...fixture(), text: `${control}first\r\nsecond` })).toThrow("X_PAGE_TEXT_CONTROL");
    expect(() => normalizePagePost({ ...fixture(), text: `first\rsecond${control}` })).toThrow("X_PAGE_TEXT_CONTROL");
  });

  test("does not interpret HTML; preserves safe Unicode and enforces text length and completeness", () => {
    const text = '<script>alert("synthetic")</script> &amp; <b>plain</b> 👨‍👩‍👧';
    expect(normalizePagePost({ ...fixture(), text }).text).toBe(text);
    expect(() => normalizePagePost({ ...fixture(), textComplete: false })).toThrow("X_PAGE_TEXT_INCOMPLETE");
    expect(normalizePagePost({ ...fixture(), text: "🏁".repeat(X_PAGE_MAX_TEXT_CODEPOINTS) }).text).toHaveLength(X_PAGE_MAX_TEXT_CODEPOINTS * 2);
    expect(() => normalizePagePost({ ...fixture(), text: "a".repeat(X_PAGE_MAX_TEXT_CODEPOINTS + 1) })).toThrow("X_PAGE_TEXT_TOO_LONG");
    expect(() => normalizePagePost({ ...fixture(), html: "<b>hidden</b>" })).toThrow("X_PAGE_INPUT_INVALID");
    expect(() => normalizePagePost({ ...fixture(), sourceCsvPath: "/tmp/untrusted.csv" })).toThrow("X_PAGE_INPUT_INVALID");
  });

  test.each(["", "1m", "2026-02-30T12:00:00Z", "2026-09-06", "2026-09-06T12:00:00+00:00"])("rejects missing/nonabsolute timestamp %s", publishedAt => {
    expect(() => normalizePagePost({ ...fixture(), publishedAt })).toThrow("X_PAGE_TIME_INVALID");
  });

  test("requires original ID/time binding and a read time after publication", () => {
    const missing: Partial<PagePost> = fixture(); delete missing.publishedAt;
    expect(() => normalizePagePost(missing)).toThrow("X_PAGE_INPUT_INVALID");
    expect(() => normalizePagePost({ ...fixture(), publishedAt: "2026-09-06T11:59:59.000Z" })).toThrow("X_PAGE_STATUS_TIME_MISMATCH");
    expect(() => normalizePagePost({ ...fixture(), observedAt: "2026-09-06T11:59:59.000Z" })).toThrow("X_PAGE_TIME_IN_FUTURE");
  });

  test("media references stay separate from text, affect version and grant no download or publication", () => {
    const input = fixture();
    input.media = [{ kind: "image", url: "https://pbs.twimg.com/media/synthetic.jpg?format=jpg&name=small", altText: "<b>plain caption</b>" }];
    const result = normalizePagePost(input);
    expect(result.text).toBe(input.text);
    expect(result.mediaReferences[0]).toEqual(input.media[0]);
    expect(Object.isFrozen(result.mediaReferences[0])).toBe(true);
    expect(result.sourceVersionHash).not.toBe(normalizePagePost(fixture()).sourceVersionHash);
    expect(() => normalizePagePost({ ...input, media: [...input.media, ...input.media] })).toThrow("X_PAGE_MEDIA_DUPLICATE");
    for (const url of ["javascript:alert(1)", "https://evil.example/image.jpg", "https://pbs.twimg.com/media/../private.jpg", "https://pbs.twimg.com/%2e%2e/private.jpg"]) {
      expect(() => normalizePagePost({ ...input, media: [{ ...input.media[0], url }] })).toThrow("X_PAGE_MEDIA_URL_INVALID");
    }
    expect(() => normalizePagePost({ ...input, media: [{ ...input.media[0], altText: "caption\u0000" }] })).toThrow("X_PAGE_TEXT_CONTROL");
  });

  test("documented photo size is presentation-only while exact observed URLs remain available", () => {
    function withUrl(url: string) {
      return normalizePagePost({ ...fixture(), media: [{ kind: "image", url, altText: "Synthetic photo" }] });
    }
    const base = "https://pbs.twimg.com/media/synthetic";
    const small = withUrl(`${base}?format=jpg&name=small`);
    const large = withUrl(`${base}?format=jpg&name=large`);
    expect(large.mediaReferences[0].url).toBe(`${base}?format=jpg&name=large`);
    expect(small.mediaReferences[0].url).toBe(`${base}?format=jpg&name=small`);
    expect(large.identity).toBe(small.identity);
    expect(large.sourceVersionHash).toBe(small.sourceVersionHash);
    expect(withUrl(`${base}?name=medium&format=jpg`).sourceVersionHash).toBe(small.sourceVersionHash);
    for (const url of [`${base}?format=png&name=small`, `${base}-changed?format=jpg&name=small`,
      `${base}?format=jpg&name=unknown`, `${base}?format=jpg&name=small&extra=1`,
      `${base}?format=jpg&name=small&name=large`]) {
      expect(withUrl(url).sourceVersionHash).not.toBe(small.sourceVersionHash);
    }
    expect(() => normalizePagePost({ ...fixture(), media: [small.mediaReferences[0], large.mediaReferences[0]] })).toThrow("X_PAGE_MEDIA_DUPLICATE");
    const thumbnail = "https://pbs.twimg.com/ext_tw_video_thumb/synthetic";
    expect(withUrl(`${thumbnail}?format=jpg&name=small`).sourceVersionHash)
      .not.toBe(withUrl(`${thumbnail}?format=jpg&name=large`).sourceVersionHash);
  });
});
