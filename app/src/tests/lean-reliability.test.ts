import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LeanSource } from "../server/lean/config.ts";
import { publishFailed, runCleanup } from "../server/lean/cleanup.ts";
import { importEditorInbox, markInboxPublished } from "../server/lean/editor-inbox.ts";
import { fetchFeed, parseFeed, type FeedEntry } from "../server/lean/feed.ts";
import { protectPublicationCommit, prunePublicationRefs, publicationArtifacts, stageSite } from "../server/lean/pages-publish.ts";
import { advancePublication, confirmPublication, publicationState, publicationTarget, type PublicationState } from "../server/lean/publication.ts";
import { buildSiteBundle, type SiteBundle } from "../server/lean/site-bundle.ts";
import { LeanStore, linkKey, publicIdFor, refineRetryDelay, type StoredItem } from "../server/lean/store.ts";

const now = new Date("2026-09-27T00:00:00.000Z");
const at = (minutes: number): Date => new Date(now.getTime() + minutes * 60_000);
const source: LeanSource = { sourceId: "test-rss", displayName: "Test", platform: "rss", contentType: "race_news", requireRelevance: false, feedUrl: "https://example.test/rss" };
const paths: string[] = [];
const stores: LeanStore[] = [];
const temp = (): string => { const path = mkdtempSync(join(tmpdir(), "lean-reliability-")); paths.push(path); return path; };
const storeAt = (path: string, clock = now): LeanStore => { const store = new LeanStore(path, clock); stores.push(store); return store; };
const close = (store: LeanStore): void => { store.close(); stores.splice(stores.indexOf(store), 1); };
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
const entry = (link: string): FeedEntry => ({ sourceId: source.sourceId, link, title: "F1 qualifying result", text: "A factual race report", sourcePublishedAt: now.toISOString(), image: null, images: [] });
const story = (n: number, overrides: Partial<StoredItem> = {}): StoredItem => ({
  publicId: publicIdFor("rss", `story${n}`), sourceId: source.sourceId, platform: "rss", displayName: "Test", contentType: "race_news", requireRelevance: false,
  link: `https://example.test/news/${n}`, title: `Race report ${n}`, text: "Original news", sourcePublishedAt: at(-n).toISOString(), firstSeenAt: now.toISOString(), image: null, images: [], status: "ready", attempts: 1,
  titleZh: `比赛报道${n}`, summaryZh: "车手完成比赛", summaryEn: null, keyPointsZh: [], keyPointsEn: [], detailEn: null, detailZh: null, publishedAt: now.toISOString(), ...overrides
});

describe("canonical URL compatibility", () => {
  it("keeps content query identity and path case, unifies YouTube short links, and only drops known tracking", () => {
    expect(linkKey("https://www.youtube.com/watch?v=AAA&utm_source=x&si=track#t=2")).toBe(linkKey("https://youtu.be/AAA?si=other"));
    expect(linkKey("https://youtube.com/watch?v=AAA")).not.toBe(linkKey("https://youtube.com/watch?v=BBB"));
    expect(linkKey("https://example.test/a?id=1&lang=en")).not.toBe(linkKey("https://example.test/a?id=2&lang=en"));
    expect(linkKey("https://example.test/Case")).not.toBe(linkKey("https://example.test/case"));
    expect(linkKey("https://example.test/a/?utm_medium=x&amp;b=2&a=1")).toBe("example.test/a?a=1&b=2");
  });

  it("preserves old public IDs/link keys and inserts a distinct video despite the old UNIQUE watch key", () => {
    const path = join(temp(), "store.sqlite");
    const initial = storeAt(path);
    const old = story(1, { publicId: publicIdFor("rss", "youtube.com/watch"), link: "https://www.youtube.com/watch?v=AAA" });
    initial.importReady(old);
    close(initial);
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE items SET link_key = 'youtube.com/watch', canonical_key = NULL").run();
    raw.close();
    const store = storeAt(path);
    expect(store.addEntries(source, [entry("https://youtu.be/AAA?si=x"), entry("https://youtube.com/watch?v=BBB")], now.toISOString())).toBe(1);
    expect(store.readyItems()[0].publicId).toBe(old.publicId);
    expect(store.pending(10, now).map((item) => item.link)).toEqual(["https://youtube.com/watch?v=BBB"]);
    const inspect = new DatabaseSync(path);
    expect(inspect.prepare("SELECT link_key FROM items WHERE public_id = ?").get(old.publicId)).toEqual({ link_key: "youtube.com/watch" });
    inspect.close();
  });

  it("retains preexisting alias rows without deleting either public route", () => {
    const path = join(temp(), "store.sqlite");
    const store = storeAt(path);
    store.importReady(story(1)); store.importReady(story(2)); close(store);
    const raw = new DatabaseSync(path);
    raw.exec("UPDATE items SET link = 'https://example.test/one?utm_source=legacy', canonical_key = NULL"); raw.close();
    const reopened = storeAt(path);
    expect(reopened.readyItems()).toHaveLength(2);
    expect(reopened.addEntries(source, [entry("https://example.test/one")], now.toISOString())).toBe(0);
  });

  it("preserves distinct published alias IDs and rejects a contradictory reused ID explicitly", () => {
    const store = storeAt(join(temp(), "store.sqlite"));
    store.importReady(story(1));
    store.importReady(story(2, { link: story(1).link }));
    expect(store.readyItems()).toHaveLength(2);
    expect(() => store.importReady(story(3, { publicId: story(1).publicId }))).toThrow("IMPORT_PUBLIC_ID_CONFLICT");
  });

  it("imports a case-distinct editorial URL despite a legacy public-ID collision, with the actual ID in its receipt", () => {
    const root = temp(); const store = storeAt(join(root, "store.sqlite"));
    const oldId = publicIdFor("rss", "example.test/case");
    store.importReady(story(1, { publicId: oldId, link: "https://example.test/Case" }));
    const inbox = join(root, "inbox"); mkdirSync(inbox);
    writeFileSync(join(inbox, "article.json"), JSON.stringify({ schemaVersion: "editor-submission-v1", idempotencyKey: "new-case", originalUrl: "https://example.test/case", sourceName: "Test", sourceDomain: "example.test", originalTitle: "Race recap", sourcePublishedAt: now.toISOString(), contentType: "race_news", credibility: "official", titleZh: "最新比赛报道", summaryZh: "车手完成了比赛。" }));
    expect(importEditorInbox(store, inbox, { enabled: true, publishMode: "auto" }, ["example.test"], now.toISOString())).toMatchObject({ imported: 1, rejected: 0 });
    const actual = store.readyItems().find((item) => item.link.endsWith("/case"))!;
    expect(actual.publicId).not.toBe(oldId);
    expect(JSON.parse(readFileSync(join(inbox, "done/article.receipt.json"), "utf8")).publicId).toBe(actual.publicId);
    expect(JSON.parse(readFileSync(join(inbox, "status.json"), "utf8")).entries[0].publicId).toBe(actual.publicId);
  });
});

describe("persistent model retries", () => {
  it("persists backoff across restart, succeeds after more than three temporary failures, and clears retry scheduling", () => {
    const path = join(temp(), "store.sqlite");
    let store = storeAt(path);
    store.addEntries(source, [entry("https://example.test/retry")], now.toISOString());
    const id = store.pending(1, now)[0].publicId;
    let clock = now;
    for (let attempt = 1; attempt <= 4; attempt++) {
      store.markAttemptFailed(id, { kind: "temporary", code: "MODEL_HTTP_429", now: clock });
      close(store); store = storeAt(path, clock);
      expect(store.pending(1, clock)).toHaveLength(0);
      clock = new Date(clock.getTime() + refineRetryDelay(attempt));
      expect(store.pending(1, clock)).toHaveLength(1);
    }
    store.markReady(id, "成功标题", "成功摘要", [], clock.toISOString());
    expect(store.counts().ready).toBe(1);
    expect(store.retryState(id)?.nextAttemptAt).toBeNull();
  });

  it("keeps permanent failures terminal and bounds repeated quality/temporary failures", () => {
    const path = join(temp(), "store.sqlite");
    let store = storeAt(path);
    store.addEntries(source, [entry("https://example.test/permanent"), entry("https://example.test/quality"), entry("https://example.test/temp")], now.toISOString());
    for (const item of store.pending(10, now)) {
      const kind = item.link.endsWith("permanent") ? "permanent" : item.link.endsWith("quality") ? "quality" : "temporary";
      const attempts = kind === "permanent" ? 1 : kind === "quality" ? 3 : 8;
      for (let n = 0; n < attempts; n++) store.markAttemptFailed(item.publicId, { kind, code: "MODEL_TEST_FAILURE", now: at(n * 400) });
    }
    close(store); store = storeAt(path, at(8000));
    expect(store.pending(10, at(9000))).toHaveLength(0);
    expect(store.counts().failed).toBe(3);
  });

  it("defers unavailable configuration without consuming the draft's attempt budget", () => {
    const store = storeAt(join(temp(), "store.sqlite"));
    store.addEntries(source, [entry("https://example.test/config")], now.toISOString());
    const id = store.pending(1, now)[0].publicId;
    store.deferForConfiguration(id, now);
    expect(store.pending(1, at(30))).toHaveLength(0);
    expect(store.pending(1, at(360))[0].attempts).toBe(0);
  });

  it("recovers reasonless legacy exhaustion once, excluding held, skipped and ready records", () => {
    const path = join(temp(), "store.sqlite");
    const initial = storeAt(path);
    for (let n = 1; n <= 4; n++) initial.importReady(story(n));
    close(initial);
    const raw = new DatabaseSync(path);
    for (const [n, status] of [[1, "failed"], [2, "held"], [3, "skipped"], [4, "ready"]] as const) raw.prepare("UPDATE items SET status = ?, attempts = 3 WHERE public_id = ?").run(status, story(n).publicId);
    raw.close();
    let store = storeAt(path);
    expect(store.pending(10, now)).toHaveLength(0);
    expect(store.pending(10, at(60)).map((item) => item.publicId)).toEqual([story(1).publicId]);
    store.markAttemptFailed(story(1).publicId, { kind: "permanent", code: "MODEL_HTTP_401", now: at(60) });
    close(store); store = storeAt(path, at(120));
    expect(store.pending(10, at(500))).toHaveLength(0);
    expect(store.counts()).toMatchObject({ failed: 1, held: 1, skipped: 1, ready: 1 });
  });

  it("includes recent count overflow in archive and never includes held/retired rows", () => {
    const store = storeAt(join(temp(), "store.sqlite"));
    for (let n = 1; n <= 5; n++) store.importReady(story(n));
    store.addEditorial(story(6, { status: "held" }), "held");
    store.retire(story(5).publicId);
    const feed = store.ready(2, "2026-09-01T00:00:00.000Z");
    expect(feed).toHaveLength(2);
    expect(store.archivedOutside(feed).map((item) => item.publicId).sort()).toEqual([story(3).publicId, story(4).publicId].sort());
  });
});

describe("feed source health", () => {
  it("rejects successful HTTP HTML/error payloads but accepts valid empty RSS and Atom", async () => {
    for (const body of ["<html><body>Upstream failure</body></html>", "<rss><channel>", "<feed>404</feed>", "<feed>temporary upstream error</feed>"]) {
      await expect(fetchFeed(source, vi.fn(async () => new Response(body)) as typeof fetch)).rejects.toThrow(/^FEED_FORMAT_/);
    }
    expect(parseFeed(source, '<rss version="2.0"><channel/></rss>')).toEqual([]);
    expect(parseFeed(source, '<feed xmlns="http://www.w3.org/2005/Atom"/>')).toEqual([]);
  });
});

function bundleFetcher(bundle: SiteBundle, broken?: string): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname.replace(/^\//, "");
    const bytes = bundle.files.get(path);
    return new Response(path === broken ? "{}" : bytes?.toString("utf8") ?? "missing", { status: bytes ? 200 : 404 });
  }) as typeof fetch;
}

describe("online publication confirmation", () => {
  it("protects an unpushed parentless candidate from actual git gc, then releases superseded references", () => {
    const root = temp();
    const git = (args: string[], input?: string): string => {
      const result = spawnSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args], {
        cwd: root, encoding: "utf8", input,
        env: { NODE_ENV: "test", PATH: "/usr/bin:/bin", HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }
      });
      if (result.status !== 0) throw new Error("FIXTURE_GIT_FAILED");
      return result.stdout.trim();
    };
    git(["init", "--initial-branch=main"]);
    const candidate = (body: string): string => {
      const blob = git(["hash-object", "-w", "--stdin"], body);
      const tree = git(["mktree"], `100644 blob ${blob}\tindex.html\n`);
      return git(["commit-tree", tree, "-m", body]);
    };
    const live = candidate("confirmed"); git(["update-ref", "refs/heads/main", live]);
    const pending = candidate("push failed after preparation");
    protectPublicationCommit(root, pending);
    git(["gc", "--prune=now"]);
    expect(git(["cat-file", "-t", pending])).toBe("commit");
    const next = candidate("new pending"); protectPublicationCommit(root, next);
    prunePublicationRefs(root, [live, next]);
    expect(git(["for-each-ref", "--format=%(objectname)", "refs/lean-publications/"])).toBe(next);
    git(["gc", "--prune=now"]);
    expect(git(["cat-file", "-t", next])).toBe("commit");
  });

  it("blocks independent cleanup for unconfirmed states, including a crash with a stale cycle report", () => {
    for (const reason of ["PUBLISH_UNCONFIRMED", "AWAITING_CONFIRMATION", "CONFIRMATION_RETRY_EXHAUSTED"]) expect(publishFailed({ site: { reason } })).toBe(true);
    const root = temp();
    writeFileSync(join(root, "last-cycle.json"), JSON.stringify({ site: { reason: "UNCHANGED" } }));
    writeFileSync(join(root, "state.json"), JSON.stringify({ pending: { commit: "candidate" } }));
    expect(runCleanup({ dataRoot: root, pagesCheckout: join(root, "missing"), dryRun: false, raceWindow: false }).skipped).toBe("PUBLISH_FAILED");
    writeFileSync(join(root, "state.json"), "corrupt state");
    expect(runCleanup({ dataRoot: root, pagesCheckout: join(root, "missing"), dryRun: false, raceWindow: false }).skipped).toBe("PUBLISH_FAILED");
    writeFileSync(join(root, "state.json"), JSON.stringify({ schemaVersion: "lean-publication-state-v2", pending: null }));
    expect(runCleanup({ dataRoot: root, pagesCheckout: join(root, "missing"), dryRun: false, raceWindow: false }).skipped).toBe("PUBLISH_FAILED");
  });

  it("rejects corrupt persisted pending state instead of forgetting it and pushing again", () => {
    const state = publicationState(null);
    expect(() => publicationState({ ...state, pending: { target: { indexPath: "https://other.test/index.json" } } })).toThrow("PUBLISH_STATE_INVALID");
  });
  it("verifies the exact pointer, index, feed and detail and rejects stale or corrupt bytes", async () => {
    const bundle = buildSiteBundle([story(1)], now.toISOString());
    const target = publicationTarget(bundle);
    await expect(confirmPublication(target, bundleFetcher(bundle), "https://example.test/")).resolves.toBeUndefined();
    for (const path of ["_public/current.json", target.indexPath, ...target.samples.map((sample) => `_public/generations/${target.bundleId}/${sample.path}`)]) {
      await expect(confirmPublication(target, bundleFetcher(bundle, path), "https://example.test/")).rejects.toThrow(/^PUBLISH_CONFIRM_/);
    }
    const newer = buildSiteBundle([story(2)], at(10).toISOString());
    await expect(confirmPublication(target, bundleFetcher(newer), "https://example.test/")).rejects.toThrow("PUBLISH_CONFIRM_POINTER_MISMATCH");
  });

  it("allows a verified empty feed without inventing a detail sample", async () => {
    const bundle = buildSiteBundle([], now.toISOString());
    const target = publicationTarget(bundle);
    expect(target.samples).toHaveLength(1);
    await expect(confirmPublication(target, bundleFetcher(bundle), "https://example.test/")).resolves.toBeUndefined();
  });

  it("persists an unconfirmed push, checks again after restart and only then marks published", async () => {
    const bundle = buildSiteBundle([story(1)], now.toISOString());
    let saved: PublicationState = publicationState({ lastPublishedFingerprint: bundle.contentFingerprint, lastCommit: "unverified-old" });
    const confirm = vi.fn(async (): Promise<void> => { throw new Error("PUBLISH_CONFIRM_HTTP_404"); });
    const push = vi.fn((before: (commit: string) => void) => { before("commit-one"); expect(saved.pending?.commit).toBe("commit-one"); return "commit-one"; });
    const retry = vi.fn(() => "retry");
    const dependencies = { save: (state: PublicationState) => { saved = structuredClone(state); }, confirm, push, retry };
    const input = { bundle, fingerprint: bundle.contentFingerprint, publicIds: [story(1).publicId], now, allowPush: true };
    expect(await advancePublication(saved, input, dependencies)).toMatchObject({ published: false, reason: "AWAITING_CONFIRMATION" });
    expect(saved.lastPublishedFingerprint).toBeNull();
    expect(await advancePublication(publicationState(saved), { ...input, now: at(10) }, dependencies)).toMatchObject({ published: false });
    expect(push).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    confirm.mockImplementation(async () => undefined);
    expect(await advancePublication(publicationState(saved), { ...input, now: at(20) }, dependencies)).toMatchObject({ published: true, reason: "PUBLISHED" });
    expect(saved.confirmed?.publicIds).toEqual([story(1).publicId]);
    expect(await advancePublication(publicationState(saved), { ...input, now: at(25) }, dependencies)).toMatchObject({ published: false, reason: "UNCHANGED" });
  });

  it("bounds deployment retriggers while continuing confirmation checks after exhaustion", async () => {
    const bundle = buildSiteBundle([story(1)], now.toISOString());
    const state = publicationState(null);
    const confirm = vi.fn(async (): Promise<void> => { throw new Error("PUBLISH_CONFIRM_HTTP_404"); });
    const push = vi.fn((before: (commit: string) => void) => { before("first"); return "first"; });
    const retry = vi.fn((_pending, before: (commit: string) => void) => { before("retry"); return "retry"; });
    const dependencies = { save: vi.fn(), confirm, push, retry };
    const input = { bundle, fingerprint: bundle.contentFingerprint, publicIds: [story(1).publicId], now, allowPush: true };
    for (const minute of [0, 10, 30, 40, 60, 90]) await advancePublication(state, { ...input, now: at(minute) }, dependencies);
    expect(push).toHaveBeenCalledTimes(1); expect(retry).toHaveBeenCalledTimes(2);
    expect(state.pending?.pushAttempts).toBe(3);
    expect(await advancePublication(state, { ...input, now: at(100) }, dependencies)).toMatchObject({ reason: "CONFIRMATION_RETRY_EXHAUSTED" });
    confirm.mockImplementation(async () => undefined);
    expect(await advancePublication(state, { ...input, now: at(110) }, dependencies)).toMatchObject({ published: true });
  });

  it("bounds failures before staging/commit preparation, and does not push when state cannot be saved", async () => {
    const bundle = buildSiteBundle([story(1)], now.toISOString());
    const state = publicationState(null);
    const push = vi.fn(() => { throw new Error("PUBLISH_STAGE_FAILED"); });
    const dependencies = { save: vi.fn(), confirm: vi.fn(async () => { throw new Error("PUBLISH_CONFIRM_HTTP_404"); }), push, retry: vi.fn(() => "never") };
    const input = { bundle, fingerprint: bundle.contentFingerprint, publicIds: [story(1).publicId], now, allowPush: true };
    for (const minute of [0, 10, 30, 60, 90]) await advancePublication(state, { ...input, now: at(minute) }, dependencies);
    expect(push).toHaveBeenCalledTimes(3); expect(dependencies.retry).not.toHaveBeenCalled();
    const before = push.mock.calls.length;
    await expect(advancePublication(publicationState(null), input, { ...dependencies, save: () => { throw new Error("DISK_FULL"); } })).rejects.toThrow("DISK_FULL");
    expect(push).toHaveBeenCalledTimes(before);
  });

  it("starts deployment cooldown at the actual push after a long staging phase", async () => {
    const bundle = buildSiteBundle([story(1)], now.toISOString());
    const state = publicationState(null);
    let clock = now;
    const dependencies = { save: vi.fn(), clock: () => clock, confirm: vi.fn(async () => { throw new Error("PUBLISH_CONFIRM_HTTP_404"); }),
      push: vi.fn((before: (commit: string) => void) => { clock = at(35); before("staged-commit"); return "staged-commit"; }), retry: vi.fn(() => "never") };
    const input = { bundle, fingerprint: bundle.contentFingerprint, publicIds: [story(1).publicId], now, allowPush: true };
    await advancePublication(state, input, dependencies);
    expect(state.pending?.lastPushAt).toBe(at(35).toISOString());
    clock = at(40);
    await advancePublication(state, { ...input, now: clock }, dependencies);
    expect(dependencies.retry).not.toHaveBeenCalled();
  });

  it("recovers an unknown push by readback, and does not mix newer editorial IDs into the old receipt", async () => {
    const bundle = buildSiteBundle([story(1)], now.toISOString());
    const state = publicationState(null);
    const dependencies = { save: vi.fn(), confirm: vi.fn(async () => undefined), push: vi.fn((before: (commit: string) => void) => { before("unknown-commit"); throw new Error("GIT_PUSH_FAILED"); }), retry: vi.fn(() => "unused") };
    const input = { bundle, fingerprint: bundle.contentFingerprint, publicIds: [story(1).publicId], now, allowPush: true };
    expect(await advancePublication(state, input, dependencies)).toMatchObject({ reason: "PUBLISH_UNCONFIRMED", published: false });
    const newer = buildSiteBundle([story(1), story(2)], at(10).toISOString());
    expect(await advancePublication(state, { ...input, bundle: newer, fingerprint: newer.contentFingerprint, publicIds: [story(1).publicId, story(2).publicId], now: at(10) }, dependencies)).toMatchObject({ published: false });
    expect(state.confirmed?.publicIds).toEqual([story(1).publicId]);
    const root = temp();
    writeFileSync(join(root, "status.json"), JSON.stringify({ entries: [story(1), story(2)].map((item) => ({ file: item.publicId, state: "done", at: now.toISOString(), publicId: item.publicId, publishedHint: "awaiting_publish" })) }));
    markInboxPublished(root, state.confirmed!.commit, at(10).toISOString(), state.confirmed!.publicIds);
    const status = JSON.parse(readFileSync(join(root, "status.json"), "utf8"));
    expect(status.entries.map((item: { publishedHint: string }) => item.publishedHint)).toEqual(["published", "awaiting_publish"]);
  });

  it("can stage with fixture workflow/UI paths without reading the M1 workflow", () => {
    const root = temp(); const ui = join(root, "ui"); mkdirSync(ui);
    writeFileSync(join(ui, "index.html"), "<html>test</html>");
    writeFileSync(join(root, "ui.build-receipt.json"), "{}");
    const workflow = join(root, "pages.yml"); writeFileSync(workflow, "name: fixture workflow\n");
    const bundle = buildSiteBundle([], now.toISOString());
    stageSite(join(root, "checkout"), bundle, { uiDirectory: ui, workflowPath: workflow, now });
    expect(readFileSync(join(root, "checkout/.github/workflows/pages.yml"), "utf8")).toContain("fixture workflow");
  });

  it("stages and verifies shell identity and complete permanent story HTML, rejecting a stale shell or document", async () => {
    const root = temp(); const ui = join(root, "ui"); mkdirSync(join(ui, "stories"), { recursive: true });
    writeFileSync(join(ui, "index.html"), "<html>home</html>");
    writeFileSync(join(ui, "stories/index.html"), '<html><head><title>F1+1</title></head><body><!--F1_PUBLIC_STORY_DOCUMENT--></body></html>');
    writeFileSync(join(root, "ui.build-receipt.json"), "{}");
    const workflow = join(root, "pages.yml"); writeFileSync(workflow, "name: fixture workflow\n");
    const bundle = buildSiteBundle([story(1)], now.toISOString());
    const artifacts = publicationArtifacts(bundle, { uiDirectory: ui, workflowPath: workflow });
    stageSite(join(root, "checkout"), bundle, { uiDirectory: ui, workflowPath: workflow, now });
    const page = readFileSync(join(root, `checkout/site/stories/${story(1).publicId}/index.html`), "utf8");
    expect(page).toContain("比赛报道1"); expect(page).toContain('rel="canonical"');
    expect(page).not.toContain("<!--F1_PUBLIC_STORY_DOCUMENT-->");
    let corrupt: string | null = null;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      let path = new URL(String(url)).pathname.slice(1);
      if (path.endsWith("/")) path += "index.html";
      return new Response(path === corrupt ? "{}" : readFileSync(join(root, "checkout/site", path), "utf8"));
    }) as typeof fetch;
    const target = publicationTarget(bundle, artifacts);
    await expect(confirmPublication(target, fetcher, "https://example.test/")).resolves.toBeUndefined();
    corrupt = "_deployment.json";
    await expect(confirmPublication(target, fetcher, "https://example.test/")).rejects.toThrow("PUBLISH_CONFIRM_DEPLOYMENT_IDENTITY");
    corrupt = `stories/${story(1).publicId}/index.html`;
    await expect(confirmPublication(target, fetcher, "https://example.test/")).rejects.toThrow("PUBLISH_CONFIRM_STORY_HTML_HASH");
  });
});
