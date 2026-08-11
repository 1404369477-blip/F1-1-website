import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { parseRssFeed } from "../server/rss/parser.ts";
import { RssRepository, applyRssMigration } from "../server/rss/repository.ts";
import {
  assertFixedFeedUrl,
  createPinnedRssLookup,
  fetchFixedRss,
  isPublicRssAddress,
  terminateRejectedRssResponse
} from "../server/rss/transport.ts";
import { RssError, rssFailureForReceipt, type RssModifiedResponse } from "../server/rss/types.ts";

const migrationSql = readFileSync(new URL("../../migrations/rss-real/0001_rss_real.sql", import.meta.url), "utf8");

function rssDocument(items: string): Uint8Array {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Motorsport F1</title>
        ${items}
      </channel>
    </rss>`, "utf8");
}

function itemXml(input: Readonly<{
  id: string;
  slug?: string;
  title?: string;
  description?: string;
  published?: string;
}>): string {
  return `<item>
    <guid>${input.id}</guid>
    <link>https://www.motorsport.com/f1/news/${input.slug ?? input.id}/</link>
    <title>${input.title ?? `Title ${input.id}`}</title>
    <description><![CDATA[<p>${input.description ?? `Excerpt ${input.id}`}</p>]]></description>
    <author>F1 Desk</author>
    <pubDate>${input.published ?? "Wed, 12 Aug 2026 00:00:00 GMT"}</pubDate>
  </item>`;
}

function expectReason(action: () => unknown, expected: string): void {
  try {
    action();
    throw new Error("expected action to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(RssError);
    expect((error as RssError).reasonCode).toBe(expected);
  }
}

function modifiedResponse(body: Uint8Array, suffix: string): RssModifiedResponse {
  return {
    kind: "modified",
    statusCode: 200,
    body,
    responseBytes: body.byteLength,
    responseSha256: suffix.repeat(64),
    validators: { etag: `\"${suffix}\"`, lastModified: null },
    validatorCapability: "supported"
  };
}

describe("RSS-REAL-001 focused contract", () => {
  it("parses a legal feed completely and selects newest items deterministically", () => {
    const feed = parseRssFeed(rssDocument([
      itemXml({ id: "guid-b", published: "Wed, 12 Aug 2026 00:01:00 GMT", description: "Second &amp; safe" }),
      itemXml({ id: "guid-a", published: "Wed, 12 Aug 2026 00:01:00 GMT", description: "First &amp; safe" }),
      itemXml({ id: "guid-c", published: "Wed, 12 Aug 2026 00:00:00 GMT" })
    ].join("")));

    expect(feed.itemCount).toBe(3);
    expect(feed.items.map((item) => item.externalId)).toEqual(["guid-a", "guid-b", "guid-c"]);
    expect(feed.items[0].excerpt).toBe("First & safe");
    expect(feed.items.every((item) => /^[0-9a-f]{64}$/.test(item.sourcePayloadHash))).toBe(true);
  });

  it("rejects DTD before parser construction, item overflow, and non-allowlist URLs", () => {
    expectReason(
      () => parseRssFeed(Buffer.from("<!DOCTYPE rss [<!ENTITY x 'boom'>]><rss><channel/></rss>", "utf8")),
      "XML_FORBIDDEN_DECLARATION"
    );
    const tooMany = Array.from({ length: 61 }, (_, index) => itemXml({
      id: `guid-${index}`,
      published: `Wed, 12 Aug 2026 00:${String(index % 60).padStart(2, "0")}:00 GMT`
    })).join("");
    expectReason(() => parseRssFeed(rssDocument(tooMany)), "ITEM_LIMIT");
    expectReason(() => assertFixedFeedUrl("https://example.com/rss/f1/news/"), "URL_REJECTED");
  });

  it("rejects IPv6 special ranges and terminates rejected responses", () => {
    for (const address of [
      "2001::",
      "2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff",
      "2001:db8::1",
      "2002::",
      "2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "3ffe::1",
      "3fff::",
      "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff",
      "2620:4f:8000::1",
      "::ffff:192.0.2.1"
    ]) {
      expect(isPublicRssAddress(address), address).toBe(false);
    }
    expect(isPublicRssAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicRssAddress("2001:4860:4860::8888")).toBe(true);

    let destroyed = 0;
    terminateRejectedRssResponse({
      destroy: () => {
        destroyed += 1;
      }
    });
    expect(destroyed).toBe(1);
  });

  it("returns Node 24 lookup callback shapes for one pinned address", () => {
    let allCalls = 0;
    createPinnedRssLookup({ address: "8.8.8.8", family: 4 })(
      "www.motorsport.com",
      { all: true },
      (error, address, family) => {
        allCalls += 1;
        expect(error).toBeNull();
        expect(address).toEqual([{ address: "8.8.8.8", family: 4 }]);
        expect(family).toBeUndefined();
      }
    );
    expect(allCalls).toBe(1);

    let scalarCalls = 0;
    createPinnedRssLookup({ address: "2606:4700:4700::1111", family: 6 })(
      "www.motorsport.com",
      { all: false },
      (error, address, family) => {
        scalarCalls += 1;
        expect(error).toBeNull();
        expect(address).toBe("2606:4700:4700::1111");
        expect(Array.isArray(address)).toBe(false);
        expect(family).toBe(6);
      }
    );
    expect(scalarCalls).toBe(1);
  });

  it("keeps pre-I/O failures at zero and preserves post-network failure metadata", async () => {
    let networkAttempted = false;
    await expect(fetchFixedRss({
      feedUrl: "https://example.com/rss/f1/news/",
      validators: { etag: null, lastModified: null },
      env: { NODE_ENV: "test", RSS_REAL_IO: "true" },
      onNetworkAttempt: () => {
        networkAttempted = true;
      }
    })).rejects.toMatchObject({ reasonCode: "URL_REJECTED", externalCalls: 0 });
    expect(networkAttempted).toBe(false);

    await expect(fetchFixedRss({
      validators: { etag: null, lastModified: null },
      env: { NODE_ENV: "test", RSS_REAL_IO: "false" },
      onNetworkAttempt: () => {
        networkAttempted = true;
      }
    })).rejects.toMatchObject({ reasonCode: "RSS_IO_DISABLED", externalCalls: 0 });
    expect(networkAttempted).toBe(false);

    await expect(fetchFixedRss({
      validators: { etag: null, lastModified: null },
      env: { NODE_ENV: "test", RSS_REAL_IO: "true", HTTPS_PROXY: "http://127.0.0.1:8888" },
      onNetworkAttempt: () => {
        networkAttempted = true;
      }
    })).rejects.toMatchObject({ reasonCode: "PROXY_ENV_FORBIDDEN", externalCalls: 0 });
    expect(networkAttempted).toBe(false);

    await expect(fetchFixedRss({
      validators: { etag: "bad\nvalidator", lastModified: null },
      env: { NODE_ENV: "test", RSS_REAL_IO: "true" },
      onNetworkAttempt: () => {
        networkAttempted = true;
      }
    })).rejects.toMatchObject({ reasonCode: "VALIDATOR_REJECTED", externalCalls: 0 });
    expect(networkAttempted).toBe(false);

    const original = new RssError("HTTP_429", {
      nextAction: "next_slot",
      externalCalls: 0,
      httpStatus: 429,
      retryAfterSeconds: 120,
      stopSource: true
    });
    const afterNetwork = rssFailureForReceipt(original, true);
    expect(afterNetwork).toMatchObject({
      reasonCode: "HTTP_429",
      nextAction: "next_slot",
      externalCalls: 1,
      httpStatus: 429,
      retryAfterSeconds: 120,
      stopSource: true
    });
    expect(rssFailureForReceipt(new RssError("RSS_IO_DISABLED"), false).externalCalls).toBe(0);
  });

  it("rejects a stale stop fence before candidate or validator writes and closes the same run as failed", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys=ON;");
      applyRssMigration(database, migrationSql);
      const repository = new RssRepository(database);
      const body = rssDocument(itemXml({ id: "stopped-guid", title: "Must not commit" }));
      const feed = parseRssFeed(body);
      const response = modifiedResponse(body, "d");
      const run = repository.claimRun("2026-08-12T01:00:00.000Z", "2026-08-12T01:00:01.000Z");
      expect(run.stopEpoch).toBe(1);
      database.prepare("UPDATE source SET enabled = 0, stop_epoch = stop_epoch + 1 WHERE source_id = 'motorsport-f1-news'").run();

      let stopped: RssError | undefined;
      try {
        repository.finalizeModified(
          run,
          response,
          feed,
          { finishedAt: "2026-08-12T01:00:02.000Z", externalCalls: 1 }
        );
      } catch (error) {
        if (error instanceof RssError) stopped = error;
      }
      expect(stopped?.reasonCode).toBe("SOURCE_STOPPED");
      expect(Number((database.prepare("SELECT COUNT(*) AS count FROM pending_review_candidate").get() as Record<string, unknown>).count)).toBe(0);
      expect(database.prepare("SELECT status FROM ingest_run WHERE run_id = ?").get(run.runId)).toMatchObject({ status: "running" });
      expect(database.prepare("SELECT enabled, stop_epoch, etag, last_modified, last_success_at FROM source").get()).toMatchObject({
        enabled: 0,
        stop_epoch: 2,
        etag: null,
        last_modified: null,
        last_success_at: null
      });

      if (!stopped) throw new Error("missing stop fence error");
      const failure = rssFailureForReceipt(stopped, true);
      const failureReceipt = repository.finalizeFailure(run, failure, {
        finishedAt: "2026-08-12T01:00:03.000Z",
        externalCalls: 1,
        httpResponse: response
      });
      expect(failureReceipt).toMatchObject({
        runId: run.runId,
        status: "failed",
        reasonCode: "SOURCE_STOPPED",
        externalCalls: 1
      });
      expect(database.prepare("SELECT status, reason_code FROM ingest_run WHERE run_id = ?").get(run.runId)).toMatchObject({
        status: "failed",
        reason_code: "SOURCE_STOPPED"
      });
      expect(database.prepare("SELECT enabled, stop_epoch, etag, last_modified, last_success_at FROM source").get()).toMatchObject({
        enabled: 0,
        stop_epoch: 2,
        etag: null,
        last_modified: null,
        last_success_at: null
      });

      database.prepare("UPDATE source SET enabled = 1 WHERE source_id = 'motorsport-f1-news'").run();
      const notModifiedRun = repository.claimRun("2026-08-12T01:15:00.000Z", "2026-08-12T01:15:01.000Z");
      expect(notModifiedRun.stopEpoch).toBe(2);
      database.prepare("UPDATE source SET enabled = 0, stop_epoch = stop_epoch + 1 WHERE source_id = 'motorsport-f1-news'").run();

      let notModifiedStopped: RssError | undefined;
      try {
        repository.finalizeNotModified(
          notModifiedRun,
          {
            kind: "not_modified",
            statusCode: 304,
            responseBytes: 0,
            responseSha256: null,
            validators: { etag: "\"must-not-commit\"", lastModified: "Wed, 12 Aug 2026 01:15:00 GMT" },
            validatorCapability: "supported"
          },
          { finishedAt: "2026-08-12T01:15:02.000Z", externalCalls: 1 }
        );
      } catch (error) {
        if (error instanceof RssError) notModifiedStopped = error;
      }
      expect(notModifiedStopped?.reasonCode).toBe("SOURCE_STOPPED");
      expect(database.prepare("SELECT status FROM ingest_run WHERE run_id = ?").get(notModifiedRun.runId)).toMatchObject({
        status: "running"
      });
      expect(database.prepare("SELECT enabled, stop_epoch, etag, last_modified, last_success_at FROM source").get()).toMatchObject({
        enabled: 0,
        stop_epoch: 3,
        etag: null,
        last_modified: null,
        last_success_at: null
      });

      if (!notModifiedStopped) throw new Error("missing 304 stop fence error");
      const notModifiedFailure = rssFailureForReceipt(notModifiedStopped, true);
      repository.finalizeFailure(notModifiedRun, notModifiedFailure, {
        finishedAt: "2026-08-12T01:15:03.000Z",
        externalCalls: 1
      });
      expect(database.prepare("SELECT status, reason_code FROM ingest_run WHERE run_id = ?").get(notModifiedRun.runId)).toMatchObject({
        status: "failed",
        reason_code: "SOURCE_STOPPED"
      });
      expect(database.prepare("SELECT enabled, stop_epoch, etag, last_modified, last_success_at FROM source").get()).toMatchObject({
        enabled: 0,
        stop_epoch: 3,
        etag: null,
        last_modified: null,
        last_success_at: null
      });
    } finally {
      database.close();
    }
  });

  it("keeps one candidate across re-seen content and never overwrites manual fields", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys=ON;");
      applyRssMigration(database, migrationSql);
      const repository = new RssRepository(database);
      const firstBody = rssDocument(itemXml({ id: "guid-1", title: "Original title", description: "Original excerpt" }));
      const firstFeed = parseRssFeed(firstBody);

      const firstRun = repository.claimRun("2026-08-12T00:00:00.000Z", "2026-08-12T00:00:01.000Z");
      const firstReceipt = repository.finalizeModified(
        firstRun,
        modifiedResponse(firstBody, "a"),
        firstFeed,
        { finishedAt: "2026-08-12T00:00:02.000Z", externalCalls: 1 }
      );
      expect(firstReceipt.newCount).toBe(1);

      const secondRun = repository.claimRun("2026-08-12T00:15:00.000Z", "2026-08-12T00:15:01.000Z");
      const secondReceipt = repository.finalizeModified(
        secondRun,
        modifiedResponse(firstBody, "b"),
        firstFeed,
        { finishedAt: "2026-08-12T00:15:02.000Z", externalCalls: 1 }
      );
      expect(secondReceipt.duplicateCount).toBe(1);
      expect(Number((database.prepare("SELECT COUNT(*) AS count FROM pending_review_candidate").get() as Record<string, unknown>).count)).toBe(1);

      database.prepare(
        "UPDATE pending_review_candidate SET editor_title = ?, editor_excerpt = ?, editor_notes = ?, editor_based_on_source_revision = 1, review_status = 'approved'"
      ).run("人工标题", "人工摘要", "人工备注");

      const changedBody = rssDocument(itemXml({ id: "guid-1", title: "Machine title v2", description: "Machine excerpt v2" }));
      const changedFeed = parseRssFeed(changedBody);
      const thirdRun = repository.claimRun("2026-08-12T00:30:00.000Z", "2026-08-12T00:30:01.000Z");
      const thirdReceipt = repository.finalizeModified(
        thirdRun,
        modifiedResponse(changedBody, "c"),
        changedFeed,
        { finishedAt: "2026-08-12T00:30:02.000Z", externalCalls: 1 }
      );
      expect(thirdReceipt.updatedCount).toBe(1);

      const candidate = database.prepare(
        "SELECT title, excerpt, source_revision, editor_title, editor_excerpt, editor_notes, editor_based_on_source_revision, review_status, (editor_based_on_source_revision IS NULL OR editor_based_on_source_revision < source_revision) AS needs_rereview FROM pending_review_candidate"
      ).get() as Record<string, unknown>;
      expect(candidate).toMatchObject({
        title: "Machine title v2",
        excerpt: "Machine excerpt v2",
        source_revision: 2,
        editor_title: "人工标题",
        editor_excerpt: "人工摘要",
        editor_notes: "人工备注",
        editor_based_on_source_revision: 1,
        review_status: "approved",
        needs_rereview: 1
      });
    } finally {
      database.close();
    }
  });
});
