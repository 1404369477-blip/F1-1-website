import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { ogImageFromHtml, parseRssFeed } from "../server/rss/parser.ts";
import { applyIndependentRssSourcesMigration, applySecondRssAutosportMigration } from "../server/review-real/migration.ts";
import { MotorsportMediaUrlSchema } from "../server/review-real/schema.ts";
import { RssRepository, applyRssMigration } from "../server/rss/repository.ts";
import { collectOneSource } from "../../scripts/rss-collect-once.ts";
import { liveRssSource } from "../server/rss/sources.ts";
import {
  assertFixedFeedUrl,
  createPinnedRssLookup,
  fetchFixedRss,
  isPublicRssAddress,
  parseDohJsonAnswers,
  selectPublicRssAddresses,
  terminateRejectedRssResponse,
  type RssTrustedTransportInjection
} from "../server/rss/transport.ts";
import { RssAttemptLedger, RssError, rssFailureForReceipt, type RssModifiedResponse } from "../server/rss/types.ts";

const migrationSql = readFileSync(new URL("../../migrations/rss-real/0001_rss_real.sql", import.meta.url), "utf8");
const reviewMigrationSql = readFileSync(new URL("../../migrations/rss-real/0002_admin_review_publish.sql", import.meta.url), "utf8");
const deliveryMigrationSql = readFileSync(new URL("../../migrations/rss-real/0003_projection_delivery_runtime.sql", import.meta.url), "utf8");
const refinementMigrationSql = readFileSync(new URL("../../migrations/rss-real/0004_rss_media_and_chinese_refinement.sql", import.meta.url), "utf8");
const autosportMigrationSql = readFileSync(new URL("../../migrations/rss-real/0005_second_rss_autosport.sql", import.meta.url), "utf8");
const independentSourcesMigrationSql = readFileSync(new URL("../../migrations/rss-real/0006_independent_rss_racefans_the_race.sql", import.meta.url), "utf8");

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
  image?: string;
}>): string {
  return `<item>
    <guid>${input.id}</guid>
    <link>https://www.motorsport.com/f1/news/${input.slug ?? input.id}/</link>
    <title>${input.title ?? `Title ${input.id}`}</title>
    <description><![CDATA[<p>${input.description ?? `Excerpt ${input.id}`}</p>]]></description>
    <author>F1 Desk</author>
    <pubDate>${input.published ?? "Wed, 12 Aug 2026 00:00:00 GMT"}</pubDate>
    ${input.image ? `<enclosure url="${input.image}" type="image/jpeg" length="199697"/>` : ""}
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
  it("runs one RaceFans production-shaped source orchestration through finalize rollback and next-slot retry", async () => {
    const database = new DatabaseSync(":memory:");
    const feed = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0"><channel><title>RaceFans</title><item>
        <guid>orchestration-racefans-guid</guid>
        <link>https://www.racefans.net/2026/08/21/orchestration/</link>
        <title>RaceFans orchestration</title>
        <description><![CDATA[<p>RaceFans orchestration excerpt</p>]]></description>
        <author>RaceFans Desk</author>
        <pubDate>Fri, 21 Aug 2026 00:00:00 GMT</pubDate>
      </item></channel></rss>`, "utf8");
    let dnsQueryCount = 0;
    let feedRequestCount = 0;
    const server = createServer((_request, response) => {
      if (_request.url?.startsWith("/dns-query")) {
        dnsQueryCount += 1;
        response.writeHead(200, { "content-type": "application/dns-json" });
        response.end(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "65.8.180.87" }] }));
        return;
      }
      feedRequestCount += 1;
      response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
      response.end(feed);
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as AddressInfo).port;
    try {
      applyRssMigration(database, migrationSql);
      database.exec(reviewMigrationSql);
      database.exec(deliveryMigrationSql);
      database.exec(refinementMigrationSql);
      applySecondRssAutosportMigration(database, autosportMigrationSql);
      applyIndependentRssSourcesMigration(database, independentSourcesMigrationSql);
      const repository = new RssRepository(database);
      database.exec("CREATE TRIGGER fail_racefans_success_finalize AFTER UPDATE OF last_reason_code ON source WHEN NEW.source_id = 'racefans-f1-news' AND NEW.last_reason_code = 'OK' BEGIN SELECT RAISE(ABORT, 'FINALIZE_FAIL'); END;");
      const productionTransport: RssTrustedTransportInjection = {
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
      const productionArticleHtml = async () => "<meta property=\"og:image\" content=\"https://www.racefans.net/wp-content/uploads/2026/08/racefans.jpg\">";
      const failedReceipt = await collectOneSource(repository, "racefans-f1-news", "2026-08-21T06:00:00.000Z", {
        env: { NODE_ENV: "test", RSS_REAL_IO: "true" },
        trustedTransport: productionTransport,
        fetchArticleHtml: productionArticleHtml
      });
      expect(failedReceipt).toMatchObject({ sourceId: "racefans-f1-news", status: "failed", reasonCode: "SQLITE_FAILURE", nextAction: "manual_review" });
      expect(database.prepare("SELECT status FROM ingest_run WHERE run_id = ?").get(failedReceipt.runId)).toMatchObject({ status: "failed" });
      expect(database.prepare("SELECT next_eligible_at, last_reason_code FROM source WHERE source_id = 'racefans-f1-news'").get()).toMatchObject({ next_eligible_at: null, last_reason_code: "SQLITE_FAILURE" });
      expect(database.prepare("SELECT COUNT(*) AS count FROM pending_review_candidate").get()).toMatchObject({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM rss_media_candidate").get()).toMatchObject({ count: 0 });
      database.exec("DROP TRIGGER fail_racefans_success_finalize;");
      const receipt = await collectOneSource(repository, "racefans-f1-news", "2026-08-21T06:15:00.000Z", {
        env: { NODE_ENV: "test", RSS_REAL_IO: "true" },
        trustedTransport: productionTransport,
        fetchArticleHtml: productionArticleHtml
      });
      expect(receipt.sourceId).toBe("racefans-f1-news");
      expect(receipt.status).toBe("succeeded");
      expect(receipt.externalCallBreakdown).toEqual({ dnsAttempts: 1, dohAttempts: 1, httpAttempts: 1, successfulResourceReads: 1 });
      expect(dnsQueryCount).toBe(2);
      expect(feedRequestCount).toBe(2);
      expect(database.prepare("SELECT status FROM ingest_run WHERE run_id = ?").get(receipt.runId)).toMatchObject({ status: "succeeded" });
      expect(database.prepare("SELECT last_reason_code, next_eligible_at FROM source WHERE source_id = 'racefans-f1-news'").get()).toMatchObject({ last_reason_code: "OK", next_eligible_at: null });
      expect(database.prepare("SELECT COUNT(*) AS count FROM pending_review_candidate").get()).toMatchObject({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM rss_media_candidate").get()).toMatchObject({ count: 1 });
    } finally {
      database.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("keeps a RaceFans source run non-terminal across unresolved article cleanup, then records failure only after an acknowledged close", async () => {
    const database = new DatabaseSync(":memory:");
    const racefansFeed = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0"><channel><title>RaceFans</title><item>
        <guid>racefans-cleanup-guid</guid>
        <link>https://www.racefans.net/2026/08/21/cleanup-case/</link>
        <title>RaceFans cleanup case</title>
        <description><![CDATA[<p>RaceFans cleanup excerpt</p>]]></description>
        <author>RaceFans Desk</author>
        <pubDate>Fri, 21 Aug 2026 00:00:00 GMT</pubDate>
      </item></channel></rss>`, "utf8");
    let feedRequestCount = 0;
    const server = createServer((_request, response) => {
      feedRequestCount += 1;
      if (_request.url?.startsWith("/dns-query")) {
        response.writeHead(200, { "content-type": "application/dns-json" });
        response.end(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "65.8.180.87" }] }));
        return;
      }
      response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
      response.end(racefansFeed);
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as AddressInfo).port;
    const productionTransport: RssTrustedTransportInjection = {
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
    const pending = (promise: Promise<unknown>, waitMs: number): Promise<boolean> => Promise.race([
      promise.then(() => false, () => false),
      new Promise<boolean>((resolveWait) => setTimeout(() => resolveWait(true), waitMs))
    ]);
    try {
      applyRssMigration(database, migrationSql);
      database.exec(reviewMigrationSql);
      database.exec(deliveryMigrationSql);
      database.exec(refinementMigrationSql);
      applySecondRssAutosportMigration(database, autosportMigrationSql);
      applyIndependentRssSourcesMigration(database, independentSourcesMigrationSql);
      const repository = new RssRepository(database);
      const firstState = { active: 0, acknowledge: () => {} };
      let firstLedger: RssAttemptLedger | undefined;
      // The production article-batch function owns concurrency/deadline and
      // accepts this operation as its explicit transport-close seam.
      const firstPromise = collectOneSource(repository, "racefans-f1-news", "2026-08-21T08:00:00.000Z", {
        env: { NODE_ENV: "test", RSS_REAL_IO: "true" },
        trustedTransport: productionTransport,
        runDeadlineMs: 120,
        onLedgerCreated: (ledger) => { firstLedger = ledger; },
        fetchArticleHtml: ({ signal }) => {
          firstState.active += 1;
          let resolveCleanup!: () => void;
          const cleanup = new Promise<void>((resolveCleanupPromise) => { resolveCleanup = resolveCleanupPromise; });
          firstState.acknowledge = () => { firstState.active -= 1; resolveCleanup(); };
          const result = new Promise<string>((_resolveResult, rejectResult) => {
            signal.addEventListener("abort", () => rejectResult(new RssError("BATCH_DEADLINE_EXCEEDED", { nextAction: "next_slot" })), { once: true });
          });
          return { result, cleanup };
        }
      });
      expect(await pending(firstPromise, 300)).toBe(true);
      expect(firstState.active).toBe(1);
      expect(database.prepare("SELECT status FROM ingest_run WHERE source_id = 'racefans-f1-news'").get()).toMatchObject({ status: "running" });
      expect(database.prepare("SELECT COUNT(*) AS count FROM pending_review_candidate").get()).toMatchObject({ count: 0 });
      expect(firstLedger?.isSealed).toBe(false);
      firstState.acknowledge();
      await expect(firstPromise).resolves.toMatchObject({ sourceId: "racefans-f1-news", status: "failed", reasonCode: "BATCH_DEADLINE_EXCEEDED", nextAction: "next_slot" });
      expect(firstState.active).toBe(0);
      expect(firstLedger?.isSealed).toBe(true);
      expect(database.prepare("SELECT status, reason_code FROM ingest_run WHERE source_id = 'racefans-f1-news'").get()).toMatchObject({ status: "failed", reason_code: "BATCH_DEADLINE_EXCEEDED" });

      const secondState = { active: 0, acknowledge: () => {} };
      let secondLedger: RssAttemptLedger | undefined;
      const secondPromise = collectOneSource(repository, "racefans-f1-news", "2026-08-21T08:15:00.000Z", {
        env: { NODE_ENV: "test", RSS_REAL_IO: "true" },
        trustedTransport: productionTransport,
        runDeadlineMs: 120,
        onLedgerCreated: (ledger) => { secondLedger = ledger; },
        fetchArticleHtml: ({ signal }) => {
          secondState.active += 1;
          let resolveCleanup!: () => void;
          const cleanup = new Promise<void>((resolveCleanupPromise) => { resolveCleanup = resolveCleanupPromise; });
          secondState.acknowledge = () => { secondState.active -= 1; resolveCleanup(); };
          const result = new Promise<string>((_resolveResult, rejectResult) => {
            signal.addEventListener("abort", () => rejectResult(new RssError("BATCH_DEADLINE_EXCEEDED", { nextAction: "next_slot" })), { once: true });
          });
          return { result, cleanup };
        }
      });
      expect(await pending(secondPromise, 300)).toBe(true);
      expect(secondState.active).toBe(1);
      expect(database.prepare("SELECT status FROM ingest_run WHERE run_id LIKE 'rss-run-racefans-f1-news-%' AND slot_key = ?").get( Math.floor(Date.parse("2026-08-21T08:15:00.000Z") / 1000 / 900))).toMatchObject({ status: "running" });
      expect(secondLedger?.isSealed).toBe(false);
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 1_100));
      secondState.acknowledge();
      await expect(secondPromise).rejects.toMatchObject({ reasonCode: "RESOURCE_CLEANUP_TIMEOUT" });
      expect(secondState.active).toBe(0);
      expect(secondLedger?.isSealed).toBe(false);
      expect(database.prepare("SELECT status, reason_code FROM ingest_run WHERE source_id = 'racefans-f1-news' ORDER BY slot_key DESC LIMIT 1").get()).toMatchObject({ status: "running", reason_code: "RUNNING" });
      expect(feedRequestCount).toBe(4);
    } finally {
      database.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

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

  it("captures one allowlisted Motorsport RSS image and binds it into the source hash", () => {
    const feed = parseRssFeed(rssDocument(itemXml({
      id: "guid-image",
      image: "https://cdn-8.motorsport.com/images/amp/68VWODG2/s6/example.jpg"
    })));
    expect(feed.items[0].media).toEqual({
      url: "https://cdn-8.motorsport.com/images/amp/68VWODG2/s6/example.jpg",
      mimeType: "image/jpeg",
      declaredBytes: 199697
    });
    const withoutImage = parseRssFeed(rssDocument(itemXml({ id: "guid-image" })));
    expect(feed.items[0].sourcePayloadHash).not.toBe(withoutImage.items[0].sourcePayloadHash);
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
    expect(isPublicRssAddress("198.18.0.161")).toBe(false);
    expect(selectPublicRssAddresses([
      { address: "198.18.0.161", family: 4 },
      { address: "65.8.180.87", family: 4 }
    ])).toEqual([{ address: "65.8.180.87", family: 4 }]);
    expect(parseDohJsonAnswers(JSON.stringify({
      Status: 0,
      Answer: [
        { type: 1, data: "65.8.180.87" },
        { type: 5, data: "www.motorsport.com" },
        { type: 1, data: "198.18.0.161" }
      ]
    }))).toEqual([
      { address: "65.8.180.87", family: 4 },
      { address: "198.18.0.161", family: 4 }
    ]);

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
        schemaVersion: "rss-real-receipt-v2",
        runId: run.runId,
        status: "failed",
        reasonCode: "SOURCE_STOPPED",
        externalCalls: 1,
        logicalAttemptBoundaries: 1,
        attemptDefinition: "dns_resolver_boundary+doh_http_request+resource_http_request",
        resourceReads: 1
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

  it("rolls back a mid-finalize SQL failure, persists a failed deadline receipt, and retries on the next slot", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys=ON;");
      applyRssMigration(database, migrationSql);
      database.exec(reviewMigrationSql);
      database.exec(deliveryMigrationSql);
      database.exec(refinementMigrationSql);
      applySecondRssAutosportMigration(database, autosportMigrationSql);
      applyIndependentRssSourcesMigration(database, independentSourcesMigrationSql);
      const repository = new RssRepository(database);
      const body = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>RaceFans</title><item><guid>rollback-racefans-guid</guid><link>https://www.racefans.net/2026/08/12/rollback/</link><title>RaceFans rollback</title><description><![CDATA[<p>rollback excerpt</p>]]></description><pubDate>Wed, 12 Aug 2026 03:00:00 GMT</pubDate></item></channel></rss>`, "utf8");
      const feed = parseRssFeed(body, "racefans-f1-news");
      const response = modifiedResponse(body, "1");
      const run = repository.claimRun("2026-08-12T03:00:00.000Z", "2026-08-12T03:00:01.000Z", "racefans-f1-news");
      database.exec("CREATE TRIGGER fail_finalize AFTER UPDATE OF last_reason_code ON source BEGIN SELECT RAISE(ABORT, 'FINALIZE_FAIL'); END;");
      expect(() => repository.finalizeModified(
        run,
        response,
        feed,
        { finishedAt: "2026-08-12T03:00:02.000Z", externalCalls: 3 }
      )).toThrow();
      expect(database.prepare("SELECT COUNT(*) AS count FROM pending_review_candidate").get()).toMatchObject({ count: 0 });
      expect(database.prepare("SELECT status, reason_code FROM ingest_run WHERE run_id = ?").get(run.runId)).toMatchObject({
        status: "running",
        reason_code: "RUNNING"
      });
      expect(database.prepare("SELECT next_eligible_at, last_reason_code FROM source WHERE source_id = ?").get("racefans-f1-news")).toMatchObject({
        next_eligible_at: null,
        last_reason_code: "NEVER_RUN"
      });

      database.exec("DROP TRIGGER fail_finalize;");
      const failure = new RssError("BATCH_DEADLINE_EXCEEDED", { nextAction: "next_slot" });
      const failedReceipt = repository.finalizeFailure(run, failure, {
        finishedAt: "2026-08-12T03:00:03.000Z",
        externalCalls: 3,
        externalCallBreakdown: {
          dnsAttempts: 1,
          dohAttempts: 1,
          httpAttempts: 1,
          successfulResourceReads: 0
        },
        httpResponse: response
      });
      expect(failedReceipt).toMatchObject({
        schemaVersion: "rss-real-receipt-v2",
        status: "failed",
        reasonCode: "BATCH_DEADLINE_EXCEEDED",
        nextAction: "next_slot",
        externalCalls: 3,
        logicalAttemptBoundaries: 3,
        resourceReads: 0
      });
      expect(database.prepare("SELECT status, reason_code, next_action FROM ingest_run WHERE run_id = ?").get(run.runId)).toMatchObject({
        status: "failed",
        reason_code: "BATCH_DEADLINE_EXCEEDED",
        next_action: "next_slot"
      });

      const retry = repository.claimRun("2026-08-12T03:15:00.000Z", "2026-08-12T03:15:01.000Z", "racefans-f1-news");
      expect(retry.slotKey).toBeGreaterThan(run.slotKey);
      const retryReceipt = repository.finalizeNotModified(
        retry,
        {
          kind: "not_modified",
          statusCode: 304,
          responseBytes: 0,
          responseSha256: null,
          validators: { etag: null, lastModified: null },
          validatorCapability: "unknown"
        },
        { finishedAt: "2026-08-12T03:15:02.000Z", externalCalls: 1 }
      );
      expect(retryReceipt).toMatchObject({ status: "not_modified", reasonCode: "NOT_MODIFIED" });
    } finally {
      database.close();
    }
  });

  it("stores next_eligible_at for retry-after and refuses an early slot", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys=ON;");
      applyRssMigration(database, migrationSql);
      const repository = new RssRepository(database);
      const run = repository.claimRun("2026-08-12T04:00:00.000Z", "2026-08-12T04:00:01.000Z");
      const receipt = repository.finalizeFailure(run, new RssError("HTTP_429", {
        httpStatus: 429,
        retryAfterSeconds: 120,
        nextAction: "next_slot"
      }), {
        finishedAt: "2026-08-12T04:00:02.000Z",
        externalCalls: 1,
        externalCallBreakdown: { dnsAttempts: 0, dohAttempts: 0, httpAttempts: 1, successfulResourceReads: 0 }
      });
      expect(receipt.nextAction).toBe("next_slot");
      const source = database.prepare("SELECT next_eligible_at FROM source WHERE source_id = ?").get("motorsport-f1-news") as Record<string, unknown>;
      expect(source.next_eligible_at).toBe("2026-08-12T04:02:02.000Z");
      expect(() => repository.claimRun("2026-08-12T04:00:15.000Z", "2026-08-12T04:00:16.000Z")).toThrow(/SOURCE_NOT_ELIGIBLE/);
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

  it("treats an exact historical media payload replay as a duplicate", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
      database.exec(migrationSql);
      database.exec(reviewMigrationSql);
      database.exec(deliveryMigrationSql);
      database.exec(refinementMigrationSql);
      const repository = new RssRepository(database);
      const image = "https://cdn-8.motorsport.com/images/amp/68VWODG2/s6/example.jpg";
      const firstBody = rssDocument(itemXml({ id: "guid-replay", title: "Version A", image }));
      const firstFeed = parseRssFeed(firstBody);
      const firstRun = repository.claimRun("2026-08-12T02:00:00.000Z", "2026-08-12T02:00:01.000Z");
      expect(repository.finalizeModified(
        firstRun,
        modifiedResponse(firstBody, "e"),
        firstFeed,
        { finishedAt: "2026-08-12T02:00:02.000Z", externalCalls: 1 }
      )).toMatchObject({ newCount: 1, updatedCount: 0, duplicateCount: 0 });

      const secondBody = rssDocument(itemXml({ id: "guid-replay", title: "Version B", image }));
      const secondFeed = parseRssFeed(secondBody);
      const secondRun = repository.claimRun("2026-08-12T02:15:00.000Z", "2026-08-12T02:15:01.000Z");
      expect(repository.finalizeModified(
        secondRun,
        modifiedResponse(secondBody, "f"),
        secondFeed,
        { finishedAt: "2026-08-12T02:15:02.000Z", externalCalls: 1 }
      )).toMatchObject({ newCount: 0, updatedCount: 1, duplicateCount: 0 });

      const replayRun = repository.claimRun("2026-08-12T02:30:00.000Z", "2026-08-12T02:30:01.000Z");
      expect(repository.finalizeModified(
        replayRun,
        modifiedResponse(firstBody, "0"),
        firstFeed,
        { finishedAt: "2026-08-12T02:30:02.000Z", externalCalls: 1 }
      )).toMatchObject({ newCount: 0, updatedCount: 0, duplicateCount: 1 });

      expect(database.prepare(
        "SELECT title, source_revision, source_payload_hash FROM pending_review_candidate WHERE external_id = 'guid-replay'"
      ).get()).toMatchObject({
        title: "Version B",
        source_revision: 2,
        source_payload_hash: secondFeed.items[0].sourcePayloadHash
      });
      expect(database.prepare("SELECT COUNT(*) AS count FROM rss_media_candidate").get()).toMatchObject({ count: 2 });
    } finally {
      database.close();
    }
  });

  it("parses Autosport items on the Autosport host and Motorsport Network CDN", () => {
    const body = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Autosport F1</title>
          <item>
            <guid>guid-autosport</guid>
            <link>https://www.autosport.com/f1/news/albon-stays/</link>
            <title>Albon stays</title>
            <description>Williams news</description>
            <author>Autosport</author>
            <pubDate>Wed, 19 Aug 2026 00:00:00 GMT</pubDate>
            <enclosure url="https://cdn-1.motorsport.com/images/amp/example.jpg" type="image/jpeg" length="12345"/>
          </item>
        </channel>
      </rss>`, "utf8");
    const feed = parseRssFeed(body, "autosport-f1-news");
    expect(feed.items[0]).toMatchObject({
      externalId: "guid-autosport",
      canonicalUrl: "https://www.autosport.com/f1/news/albon-stays/",
      media: {
        url: "https://cdn-1.motorsport.com/images/amp/example.jpg",
        mimeType: "image/jpeg",
        declaredBytes: 12345
      }
    });
    expectReason(() => parseRssFeed(body), "ITEM_IDENTITY_INVALID");
  });

  it("parses RaceFans uploads and The Race Ghost images, and rejects unmarked or social hosts", () => {
    const racefansBare = parseRssFeed(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>RaceFans F1</title>
          <item>
            <guid>https://www.racefans.net/?p=12345</guid>
            <link>https://www.racefans.net/2026/08/19/vasseur-ferrari/</link>
            <title>Vasseur on Ferrari | Formula 1</title>
            <description>Short RaceFans excerpt</description>
            <pubDate>Wed, 19 Aug 2026 12:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`, "utf8"), "racefans-f1-news");
    expect(racefansBare.items[0]).toMatchObject({
      externalId: "https://www.racefans.net/?p=12345",
      canonicalUrl: "https://www.racefans.net/2026/08/19/vasseur-ferrari/",
      media: null
    });

    const racefansUpload = parseRssFeed(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>RaceFans F1</title>
          <item>
            <guid>https://www.racefans.net/?p=12346</guid>
            <link>https://www.racefans.net/2026/08/19/vasseur-ferrari/</link>
            <title>Vasseur on Ferrari | Formula 1</title>
            <description>Short RaceFans excerpt</description>
            <pubDate>Wed, 19 Aug 2026 12:00:00 GMT</pubDate>
            <enclosure url="https://www.racefans.net/wp-content/uploads/2026/04/racefansdotnet-example.jpg" type="image/jpeg" length="54321"/>
          </item>
        </channel>
      </rss>`, "utf8"), "racefans-f1-news");
    expect(racefansUpload.items[0].media).toEqual({
      url: "https://www.racefans.net/wp-content/uploads/2026/04/racefansdotnet-example.jpg",
      mimeType: "image/jpeg",
      declaredBytes: 54321
    });

    const ghostImage = "https://storage.ghost.io/c/dd/af/ddafbd99-2ccd-468c-b622-4b3cccf80b49/content/images/2026/08/example.jpg";
    const theRace = parseRssFeed(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>The Race F1</title>
          <item>
            <guid>abcdef1234567890</guid>
            <link>https://www.the-race.com/formula-1/mclaren-f1-2026-car-launch-date/</link>
            <title>McLaren launch date</title>
            <description><![CDATA[<p>${"A".repeat(14000)}</p>]]></description>
            <pubDate>Wed, 19 Aug 2026 12:00:00 GMT</pubDate>
            <media:content url="${ghostImage}" medium="image"/>
          </item>
        </channel>
      </rss>`, "utf8"), "the-race-f1-news");
    expect(theRace.items[0]).toMatchObject({
      externalId: "abcdef1234567890",
      canonicalUrl: "https://www.the-race.com/formula-1/mclaren-f1-2026-car-launch-date/",
      media: {
        url: ghostImage,
        mimeType: "image/jpeg",
        declaredBytes: 1
      }
    });
    expect(theRace.items[0].excerpt.length).toBeGreaterThan(1000);

    const unmarkedGhost = parseRssFeed(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>The Race F1</title>
          <item>
            <guid>unmarked-ghost</guid>
            <link>https://www.the-race.com/formula-1/mclaren-f1-2026-car-launch-date/</link>
            <title>McLaren launch date</title>
            <description>x</description>
            <pubDate>Wed, 19 Aug 2026 12:00:00 GMT</pubDate>
            <media:content url="https://storage.ghost.io/the-race/image.jpg" medium="image"/>
          </item>
        </channel>
      </rss>`, "utf8"), "the-race-f1-news");
    expect(unmarkedGhost.items[0].media).toBeNull();

    const motorsportGhost = parseRssFeed(rssDocument(itemXml({
      id: "guid-ghost",
      image: ghostImage
    })));
    expect(motorsportGhost.items[0].media).toBeNull();

    expect(MotorsportMediaUrlSchema.safeParse(ghostImage).success).toBe(true);
    expect(MotorsportMediaUrlSchema.safeParse("https://www.racefans.net/wp-content/uploads/2026/04/racefansdotnet-example.jpg").success).toBe(true);
    expect(MotorsportMediaUrlSchema.safeParse("https://storage.ghost.io/the-race/image.jpg").success).toBe(false);
    expect(MotorsportMediaUrlSchema.safeParse("https://pbs.twimg.com/media/example.jpg").success).toBe(false);

    const racefansSource = liveRssSource("racefans-f1-news");
    expect(ogImageFromHtml(
      `<html><head><meta property="og:image" content="https://www.racefans.net/wp-content/uploads/2026/04/racefansdotnet-example.jpg"></head></html>`,
      racefansSource
    )).toEqual({
      url: "https://www.racefans.net/wp-content/uploads/2026/04/racefansdotnet-example.jpg",
      mimeType: "image/jpeg",
      declaredBytes: 1
    });
    expect(ogImageFromHtml(
      `<html><head><meta property="og:image" content="https://pbs.twimg.com/media/example.jpg"></head></html>`,
      racefansSource
    )).toBeNull();

    expectReason(
      () => parseRssFeed(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel><item>
          <guid>guid-racefans</guid>
          <link>https://www.racefans.net/2026/08/19/example/</link>
          <title>Wrong host</title>
          <description>x</description>
          <pubDate>Wed, 19 Aug 2026 12:00:00 GMT</pubDate>
        </item></channel></rss>`, "utf8"), "the-race-f1-news"),
      "ITEM_IDENTITY_INVALID"
    );
  });

  it("lets two live sources claim the same slot after 0005", () => {
    const database = new DatabaseSync(":memory:");
    const autosportSql = readFileSync(new URL("../../migrations/rss-real/0005_second_rss_autosport.sql", import.meta.url), "utf8");
    try {
      database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
      applyRssMigration(database, migrationSql);
      database.exec(reviewMigrationSql);
      database.exec(deliveryMigrationSql);
      database.exec(refinementMigrationSql);
      database.exec(autosportSql);
      expect(Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version)).toBe(5);
      const repository = new RssRepository(database);
      const motorsport = repository.claimRun("2026-08-19T01:00:00.000Z", "2026-08-19T01:00:01.000Z", "motorsport-f1-news");
      const autosport = repository.claimRun("2026-08-19T01:00:00.000Z", "2026-08-19T01:00:02.000Z", "autosport-f1-news");
      expect(motorsport.slotKey).toBe(autosport.slotKey);
      expect(motorsport.runId).not.toBe(autosport.runId);
      expect(repository.readEnabledSources().map((source) => source.sourceId)).toEqual([
        "autosport-f1-news",
        "motorsport-f1-news"
      ]);
    } finally {
      database.close();
    }
  });

  it("lets four live sources claim the same slot after 0006", () => {
    const database = new DatabaseSync(":memory:");
    const autosportSql = readFileSync(new URL("../../migrations/rss-real/0005_second_rss_autosport.sql", import.meta.url), "utf8");
    const independentSql = readFileSync(new URL("../../migrations/rss-real/0006_independent_rss_racefans_the_race.sql", import.meta.url), "utf8");
    try {
      database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
      applyRssMigration(database, migrationSql);
      database.exec(reviewMigrationSql);
      database.exec(deliveryMigrationSql);
      database.exec(refinementMigrationSql);
      applySecondRssAutosportMigration(database, autosportSql);
      applyIndependentRssSourcesMigration(database, independentSql);
      expect(Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version)).toBe(6);
      const repository = new RssRepository(database);
      const motorsport = repository.claimRun("2026-08-20T01:00:00.000Z", "2026-08-20T01:00:01.000Z", "motorsport-f1-news");
      const autosport = repository.claimRun("2026-08-20T01:00:00.000Z", "2026-08-20T01:00:02.000Z", "autosport-f1-news");
      const racefans = repository.claimRun("2026-08-20T01:00:00.000Z", "2026-08-20T01:00:03.000Z", "racefans-f1-news");
      const theRace = repository.claimRun("2026-08-20T01:00:00.000Z", "2026-08-20T01:00:04.000Z", "the-race-f1-news");
      expect(new Set([motorsport.slotKey, autosport.slotKey, racefans.slotKey, theRace.slotKey]).size).toBe(1);
      expect(new Set([motorsport.runId, autosport.runId, racefans.runId, theRace.runId]).size).toBe(4);
      expect(repository.readEnabledSources().map((source) => source.sourceId)).toEqual([
        "autosport-f1-news",
        "motorsport-f1-news",
        "racefans-f1-news",
        "the-race-f1-news"
      ]);
    } finally {
      database.close();
    }
  });

  it("applies 0005 with child tables present by turning foreign keys off outside the transaction", () => {
    const database = new DatabaseSync(":memory:");
    const autosportSql = readFileSync(new URL("../../migrations/rss-real/0005_second_rss_autosport.sql", import.meta.url), "utf8");
    try {
      database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
      applyRssMigration(database, migrationSql);
      database.exec(reviewMigrationSql);
      database.exec(deliveryMigrationSql);
      database.exec(refinementMigrationSql);
      applySecondRssAutosportMigration(database, autosportSql);
      expect(Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version)).toBe(5);
      expect(database.prepare("SELECT source_id FROM source ORDER BY source_id").all().map((row) => String((row as Record<string, unknown>).source_id))).toEqual([
        "autosport-f1-news",
        "motorsport-f1-news"
      ]);
    } finally {
      database.close();
    }
  });

  it("applies 0006 with child tables present by turning foreign keys off outside the transaction", () => {
    const database = new DatabaseSync(":memory:");
    const autosportSql = readFileSync(new URL("../../migrations/rss-real/0005_second_rss_autosport.sql", import.meta.url), "utf8");
    const independentSql = readFileSync(new URL("../../migrations/rss-real/0006_independent_rss_racefans_the_race.sql", import.meta.url), "utf8");
    try {
      database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
      applyRssMigration(database, migrationSql);
      database.exec(reviewMigrationSql);
      database.exec(deliveryMigrationSql);
      database.exec(refinementMigrationSql);
      applySecondRssAutosportMigration(database, autosportSql);
      applyIndependentRssSourcesMigration(database, independentSql);
      expect(Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version)).toBe(6);
      expect(database.prepare("SELECT source_id FROM source ORDER BY source_id").all().map((row) => String((row as Record<string, unknown>).source_id))).toEqual([
        "autosport-f1-news",
        "motorsport-f1-news",
        "racefans-f1-news",
        "the-race-f1-news"
      ]);
    } finally {
      database.close();
    }
  });
});
