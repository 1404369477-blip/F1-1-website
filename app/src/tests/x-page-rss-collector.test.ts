import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../server/db/profile.ts";
import { SqliteGatewayMutationPort, type GatewayMutationTransactionInput } from "../server/internal-operation/mutation-port.ts";
import type { GatewayWriteInput } from "../server/internal-operation/gateway.ts";
import { createRssCollectorRuntime, RSS_COLLECTOR_SOURCES, RSS_COLLECTOR_SOURCE_ROUTES } from "../server/rss-automatic/collector.ts";
import { RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 } from "../server/rss-automatic/source-epoch-schema-identity.ts";
import { LIVE_RSS_SOURCES } from "../server/rss/sources.ts";
import type { RssTrustedTransportInjection } from "../server/rss/transport.ts";
import { X_PAGE_ADMISSION_SCHEMA_SHA256 } from "../server/x-page/admission-schema-identity.ts";
import { xPageReleasePair } from "./helpers/x-page-release.ts";
import { xPageServiceFixture } from "./helpers/x-page-service.ts";

// The database, admission migration, opener, release gate and gateway are real.
// All release/backup/browser identities and HTTP content are isolated fixtures.
const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function collectorFixture(options: Readonly<{ stoppedSource?: boolean; paused?: boolean }> = {}) {
  const fixture = await xPageServiceFixture(false);
  cleanups.push(fixture.cleanup);
  if (!options.paused) fixture.live();
  if (options.stoppedSource) fixture.mutate(database => database.exec("UPDATE source SET enabled=0 WHERE source_id='skysports-f1-news'"));
  fixture.closeMutation();
  return fixture;
}

async function localFeed() {
  const requests: string[] = [];
  const dnsHosts: string[] = [];
  let edition = 1;
  const server: Server = createServer((incoming, response) => {
    const host = String(incoming.headers["x-fixture-original-host"]);
    const sourceId = RSS_COLLECTOR_SOURCES.find(id => LIVE_RSS_SOURCES[id].feedHost === host);
    if (!sourceId) { response.writeHead(400).end(); return; }
    requests.push(sourceId);
    const mediaHost = sourceId === "motorsport-f1-news" ? "cdn-1.motorsport.com" : sourceId === "the-race-f1-news" ? "storage.ghost.io" : "e0.365dm.com";
    response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
    response.end(`<rss version="2.0"><channel><title>Synthetic RSS</title><item><guid>${sourceId}-0017-synthetic</guid><link>https://${host}/f1/news/synthetic-0017/</link><title>F1 synthetic edition ${edition}</title><description>Isolated exact0017 collector regression</description><author>Synthetic</author><pubDate>Sun, 06 Sep 2026 23:59:00 GMT</pubDate><enclosure url="https://${mediaHost}/content/images/synthetic.jpg" type="image/jpeg" length="1024"/></item></channel></rss>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const port = (server.address() as AddressInfo).port;
  const trustedTransport: RssTrustedTransportInjection = {
    dnsLookup: async host => { dnsHosts.push(host); return ["8.8.8.8"]; },
    request: (options, callback) => request({ host: "127.0.0.1", port, path: options.path, method: options.method,
      headers: { ...options.headers, "x-fixture-original-host": String(options.servername ?? options.hostname ?? options.host) }, agent: false }, callback)
  };
  return { requests, dnsHosts, trustedTransport, nextEdition: () => { edition += 1; } };
}

describe("exact0017 RSS collector continuity", () => {
  it("collects and updates the three RSS sources through the actual factory with fixed slots, routes and single concurrency", async () => {
    const fixture = await collectorFixture();
    const feed = await localFeed();
    let clock = Date.now();
    const before = new DatabaseSync(fixture.databasePath, { readOnly: true });
    const registryBefore = canonicalJson(before.prepare("SELECT * FROM source_registry_v1 ORDER BY source_id").all());
    before.close();
    const collector = createRssCollectorRuntime(fixture.config, { env: { RSS_REAL_IO: "true", NODE_ENV: "test" },
      now: () => new Date(clock), trustedTransport: feed.trustedTransport });
    cleanups.push(collector.close);
    const first = collector.collect();
    expect(collector.collect()).toBe(first);
    const result = await first;
    expect(result).toMatchObject({ status: "succeeded", slotKey: Math.floor(clock / 900_000) });
    expect(result.scheduledAt).toBe(new Date(result.slotKey * 900_000).toISOString());
    expect(result.receipts.map(row => row.sourceId)).toEqual(RSS_COLLECTOR_SOURCES);
    expect(result.receipts.every(row => row.status === "succeeded" && "newCount" in row && row.newCount === 1)).toBe(true);
    expect((await collector.collect()).receipts.every(row => row.status === "skipped" && row.reasonCode === "SLOT_ALREADY_RECORDED")).toBe(true);
    expect(feed.requests).toEqual(RSS_COLLECTOR_SOURCES);
    clock += 900_000;
    feed.nextEdition();
    expect((await collector.collect()).status).toBe("succeeded");
    expect(feed.requests).toEqual([...RSS_COLLECTOR_SOURCES, ...RSS_COLLECTOR_SOURCES]);
    await collector.close();
    await expect(collector.collect()).rejects.toMatchObject({ reasonCode: "RUN_STATE_INVALID" });
    const observed = new DatabaseSync(fixture.databasePath, { readOnly: true });
    try {
      expect(observed.prepare("PRAGMA user_version").get()!.user_version).toBe(10);
      expect(fixture.config.reviewSchemaSha256).toBe(X_PAGE_ADMISSION_SCHEMA_SHA256);
      expect(observed.prepare("SELECT DISTINCT source_id FROM ingest_run ORDER BY source_id").all().map(row => row.source_id)).toEqual([...RSS_COLLECTOR_SOURCES].sort());
      expect(observed.prepare("SELECT DISTINCT source_revision,title FROM pending_review_candidate").all()).toEqual([{ source_revision: 2, title: "F1 synthetic edition 2" }]);
      expect(observed.prepare("SELECT count(*) n FROM pending_review_candidate").get()!.n).toBe(3);
      expect(canonicalJson(observed.prepare("SELECT * FROM source_registry_v1 ORDER BY source_id").all())).toBe(registryBefore);
      expect(observed.prepare("SELECT count(*) n FROM source_registry_v1 WHERE source_kind='x_page' AND enabled=1").get()!.n).toBe(0);
      expect(observed.prepare("SELECT count(*) n FROM x_page_producer_receipt_v1").get()!.n).toBe(0);
      const attempts = observed.prepare(`SELECT a.route_id,op.owner_process,op.egress_class FROM internal_external_attempt a
        JOIN internal_operation op ON op.operation_id=a.operation_id ORDER BY a.route_id`).all();
      expect(attempts).toHaveLength(6);
      expect([...new Set(attempts.map(row => row.route_id))]).toEqual(Object.values(RSS_COLLECTOR_SOURCE_ROUTES).sort());
      expect(attempts.every(row => row.owner_process === "rss_collector" && row.egress_class === "rss_https")).toBe(true);
      expect(observed.prepare("SELECT DISTINCT account_id FROM budget_reservation").all()).toEqual([{ account_id: "acct-rss" }]);
    } finally { observed.close(); }
  });

  it("rolls back an interrupted source update without losing its previous candidate or media", async () => {
    const fixture = await collectorFixture();
    const feed = await localFeed();
    let clock = Date.now();
    const collector = createRssCollectorRuntime(fixture.config, { env: { RSS_REAL_IO: "true", NODE_ENV: "test" },
      now: () => new Date(clock), trustedTransport: feed.trustedTransport });
    cleanups.push(collector.close);
    expect((await collector.collect()).status).toBe("succeeded");
    const original = SqliteGatewayMutationPort.prototype.runTransaction;
    let interruptions = 0;
    vi.spyOn(SqliteGatewayMutationPort.prototype, "runTransaction").mockImplementation(function<T>(this: SqliteGatewayMutationPort,
      input: GatewayMutationTransactionInput, callback: (mutate: (value: GatewayWriteInput) => number) => T): T {
      return original.call(this, input, mutate => callback(value => {
        if (input.operationKind === "collect" && value.entityKind === "rss_media") { interruptions += 1; throw new Error("SYNTHETIC_0017_MEDIA_INTERRUPTION"); }
        return mutate(value);
      })) as T;
    });
    clock += 900_000;
    feed.nextEdition();
    expect((await collector.collect()).status).toBe("failed");
    expect(interruptions).toBe(3);
    await collector.close();
    const observed = new DatabaseSync(fixture.databasePath, { readOnly: true });
    try {
      expect(observed.prepare("SELECT count(*) n FROM pending_review_candidate").get()!.n).toBe(3);
      expect(observed.prepare("SELECT DISTINCT source_revision,title FROM pending_review_candidate").all()).toEqual([{ source_revision: 1, title: "F1 synthetic edition 1" }]);
      expect(observed.prepare("SELECT count(*) n FROM rss_media_candidate").get()!.n).toBe(3);
      expect(observed.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { observed.close(); }
  });

  it("skips a disabled RSS source before DNS or HTTP after migration", async () => {
    const fixture = await collectorFixture({ stoppedSource: true });
    const feed = await localFeed();
    const collector = createRssCollectorRuntime(fixture.config, { env: { RSS_REAL_IO: "true", NODE_ENV: "test" }, trustedTransport: feed.trustedTransport });
    cleanups.push(collector.close);
    const result = await collector.collect();
    expect(result.status).toBe("succeeded");
    expect(result.receipts.find(row => row.sourceId === "skysports-f1-news")).toMatchObject({ status: "skipped", reasonCode: "SOURCE_STOPPED" });
    expect(feed.requests).toEqual(["motorsport-f1-news", "the-race-f1-news"]);
    expect(feed.dnsHosts).not.toContain(LIVE_RSS_SOURCES["skysports-f1-news"].feedHost);
  });

  it("keeps a paused global state closed before any RSS network attempt", async () => {
    const fixture = await collectorFixture({ paused: true });
    const feed = await localFeed();
    const collector = createRssCollectorRuntime(fixture.config, { env: { RSS_REAL_IO: "true", NODE_ENV: "test" }, trustedTransport: feed.trustedTransport });
    cleanups.push(collector.close);
    expect((await collector.collect()).status).toBe("failed");
    expect(feed.requests).toEqual([]);
    expect(feed.dnsHosts).toEqual([]);
    await collector.close();
    const observed = new DatabaseSync(fixture.databasePath, { readOnly: true });
    try { expect(observed.prepare("SELECT count(*) n FROM internal_external_attempt").get()!.n).toBe(0); }
    finally { observed.close(); }
  });

  it("rejects fallback, absent IO and schema/deployment mismatches before collection", async () => {
    const fixture = await collectorFixture();
    const env: NodeJS.ProcessEnv = { RSS_REAL_IO: "true", NODE_ENV: "test" };
    expect(() => createRssCollectorRuntime(fixture.config, { env: { NODE_ENV: "test" } })).toThrow("RSS_COLLECTOR_IO_DISABLED");
    expect(() => createRssCollectorRuntime({ ...fixture.config, releaseGate: fixture.pair.fallbackGate }, { env })).toThrow("RSS_COLLECTOR_RELEASE_CLOSED");
    expect(() => createRssCollectorRuntime({ ...fixture.config, reviewSchemaSha256: undefined }, { env })).toThrow("RSS_COLLECTOR_RELEASE_CLOSED");
    expect(() => createRssCollectorRuntime({ ...fixture.config, reviewSchemaSha256: RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 }, { env })).toThrow("RSS_COLLECTOR_RELEASE_CLOSED");
    expect(() => createRssCollectorRuntime({ ...fixture.config, expectedDeploymentManifestSha256: undefined }, { env })).toThrow("RSS_COLLECTOR_DEPLOYMENT_IDENTITY_REQUIRED");
    const prior = xPageReleasePair(APP_ROOT, RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256);
    expect(() => createRssCollectorRuntime({ ...fixture.config, reviewSchemaSha256: RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256, releaseGate: prior.fullGate }, { env })).toThrow("RSS_AUTO_SCHEMA_DRIFT");
  });
});
