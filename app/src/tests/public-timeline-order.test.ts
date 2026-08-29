import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  realpathSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import type { AppConfig } from "../server/config/env.ts";
import {
  buildProjectionSnapshot,
  buildProjectionTaskEnvelope,
  buildPublicProjectionRecord,
  derivePublicId
} from "../server/review-real/mapping.ts";
import { ProjectionReceiver, signProjectionTaskEnvelope } from "../server/review-real/projection.ts";
import { UtcTimestampSchema, type PublicProjectionRecord } from "../server/review-real/schema.ts";
import { encodePublicCursor } from "../server/public/cursor.ts";
import { handlePublicFeed, type PublicStoryReader } from "../server/public/http.ts";
import { PublicStoryRepository } from "../server/public/repository.ts";
import { PublicRealSnapshotReader } from "../server/public/snapshot-adapter.ts";
import {
  comparePublicTimelineDescending,
  publicTimelineAt
} from "../server/public/timeline.ts";
import type { PublicFeedItemV1, PublicFeedResponseV1 } from "../server/public/types.ts";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function projectionRecords(): PublicProjectionRecord[] {
  const publishedAt = "2026-08-14T10:25:37.366Z";
  return Array.from({ length: 15 }, (_, index) => {
    const candidateId = `rss-candidate-timeline-${String(index).padStart(2, "0")}`;
    const bundleHash = sha256(`timeline-bundle-${index}`);
    const minute = index === 7 ? 54 : 59 - index;
    const sourcePublishedAt = index === 0
      ? "2026-08-14T09:59:00.001Z"
      : index === 1
        ? "2026-08-14T09:59:00Z"
        : `2026-08-14T09:${String(minute).padStart(2, "0")}:00.000Z`;
    return buildPublicProjectionRecord({
      publicId: derivePublicId(candidateId, bundleHash),
      bundleHash,
      publishedAt,
      publicPayload: {
        candidateId,
        sourceId: "motorsport-f1-news",
        sourceRevision: 1,
        sourcePayloadHash: sha256(`timeline-source-${index}`),
        canonicalUrl: `https://www.motorsport.com/f1/news/timeline-${index}/`,
        sourceTitle: `Timeline source ${index}`,
        sourceAuthor: "Motorsport.com",
        sourcePublishedAt,
        contentType: "race_news",
        titleZh: `时间线标题 ${index}`,
        summaryZh: `时间线摘要 ${index}`,
        media: [],
        sourceDisplayName: "Motorsport.com"
      }
    });
  });
}

function toItem(record: PublicProjectionRecord): PublicFeedItemV1 {
  return {
    publicId: record.publicId,
    contentType: record.contentType,
    state: record.state,
    titleZh: record.titleZh,
    summaryZh: record.summaryZh,
    publishedAt: record.publishedAt,
    sourcePublishedAt: record.sourcePublishedAt,
    sourceTimeStatus: record.sourceTimeStatus,
    source: record.source,
    media: record.media,
    originalLink: record.originalLink
  };
}

function sqliteReader(root: string, records: readonly PublicProjectionRecord[]): PublicStoryRepository {
  const database = new DatabaseSync(join(root, "timeline.sqlite"));
  database.exec(`
    CREATE TABLE published_projection (
      public_id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      release_bundle_id TEXT NOT NULL
    );
    CREATE TABLE public_publication (
      public_id TEXT PRIMARY KEY,
      published_at TEXT NOT NULL
    );
    CREATE TABLE public_release_bundle (
      release_bundle_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE public_content (
      content_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      editorial_category TEXT NOT NULL
    );
  `);
  const projection = database.prepare(
    "INSERT INTO published_projection (public_id, content_id, release_bundle_id) VALUES (?, ?, ?)"
  );
  const publication = database.prepare(
    "INSERT INTO public_publication (public_id, published_at) VALUES (?, ?)"
  );
  const bundle = database.prepare(
    "INSERT INTO public_release_bundle (release_bundle_id, payload_json) VALUES (?, ?)"
  );
  const content = database.prepare(
    "INSERT INTO public_content (content_id, source_id, editorial_category) VALUES (?, ?, ?)"
  );
  const graph = new Map<string, unknown>();
  records.forEach((record, index) => {
    const contentId = `content-${index}`;
    const bundleId = `bundle-${index}`;
    projection.run(record.publicId, contentId, bundleId);
    publication.run(record.publicId, record.publishedAt);
    bundle.run(bundleId, JSON.stringify({
      canonical_payload: {
        time_snapshot: {
          source_published_at: record.sourcePublishedAt,
          source_time_status: record.sourceTimeStatus
        }
      }
    }));
    content.run(contentId, record.source.sourceId, record.contentType);
    graph.set(record.publicId, {
      item: toItem(record),
      leadZh: record.detail.leadZh,
      bodyZh: record.detail.bodyZh,
      keyPointsZh: record.detail.keyPointsZh
    });
  });
  const repository = new PublicStoryRepository(
    database,
    { dataProfile: "public-synthetic" } as AppConfig,
    root,
    root
  );
  Object.defineProperty(repository, "loadGraph", { value: () => graph });
  return repository;
}

function snapshotReader(root: string, records: readonly PublicProjectionRecord[]): PublicRealSnapshotReader {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const snapshot = buildProjectionSnapshot({
    snapshotGeneration: 1,
    previousSnapshotManifestHash: null,
    records
  });
  const task = buildProjectionTaskEnvelope({
    deliveryId: `op-snapshot-${snapshot.snapshotManifestHash}`,
    idempotencyKey: `snapshot-sync:0:${snapshot.snapshotManifestHash}`,
    reconcileKey: `reconcile:snapshot:${snapshot.snapshotManifestHash}`,
    snapshot,
    attempt: 0,
    createdAt: "2026-08-14T10:26:00.000Z",
    deadlineAt: "2026-08-14T10:41:00.000Z"
  });
  const signingKeyId = "projection-key-v1";
  new ProjectionReceiver({ root: join(root, "projection"), signingKeyId, publicKey }).receive(
    signProjectionTaskEnvelope({
      envelopeJson: task.envelopeJson,
      envelopeHash: task.envelopeHash,
      signingKeyId,
      privateKey
    })
  );
  const verifyKeyPath = join(root, "verify.pem");
  writeFileSync(verifyKeyPath, publicKey.export({ format: "pem", type: "spki" }), { mode: 0o600 });
  return new PublicRealSnapshotReader({
    projectionRoot: join(root, "projection"),
    signingKeyId,
    verifyKeyPath
  });
}

async function readAll(reader: PublicStoryReader): Promise<{
  first: PublicFeedResponseV1;
  second: PublicFeedResponseV1;
  all: PublicFeedItemV1[];
}> {
  const first = await handlePublicFeed(
    new Request("http://127.0.0.1:3000/api/public/feed"),
    reader
  ).json() as PublicFeedResponseV1;
  expect(first.page.hasMore).toBe(true);
  expect(first.page.nextCursor).not.toBeNull();
  const cursor = first.page.nextCursor!;
  const second = await handlePublicFeed(
    new Request(`http://127.0.0.1:3000/api/public/feed?cursorAt=${encodeURIComponent(cursor.cursorAt)}&cursorId=${cursor.cursorId}`),
    reader
  ).json() as PublicFeedResponseV1;
  return { first, second, all: [...first.items, ...second.items] };
}

describe("public source-time timeline order", () => {
  it("accepts canonical UTC variants and rejects normalized calendar dates", () => {
    expect(UtcTimestampSchema.safeParse("2026-08-14T09:59:00Z").success).toBe(true);
    expect(UtcTimestampSchema.safeParse("2026-08-14T09:59:00.001Z").success).toBe(true);
    expect(UtcTimestampSchema.safeParse("2026-02-29T00:00:00.000Z").success).toBe(false);
  });

  it("uses the known source time and falls back to publication time when unknown", () => {
    const base = {
      publicId: "public-timeline-fallback",
      publishedAt: "2026-08-14T10:00:00.000Z"
    };
    expect(publicTimelineAt({
      ...base,
      sourcePublishedAt: "2026-08-14T09:00:00.000Z",
      sourceTimeStatus: "known"
    })).toBe("2026-08-14T09:00:00.000Z");
    expect(publicTimelineAt({
      ...base,
      sourcePublishedAt: null,
      sourceTimeStatus: "unknown"
    })).toBe(base.publishedAt);
  });

  it("rejects a normalized non-leap-day timestamp before a projection can be signed", () => {
    expect(() => {
      const candidateId = "rss-candidate-invalid-leap-day";
      const bundleHash = sha256("invalid-leap-day-bundle");
      const record = buildPublicProjectionRecord({
        publicId: derivePublicId(candidateId, bundleHash),
        bundleHash,
        publishedAt: "2026-03-01T00:01:00.000Z",
        publicPayload: {
          candidateId,
          sourceId: "motorsport-f1-news",
          sourceRevision: 1,
          sourcePayloadHash: sha256("invalid-leap-day-source"),
          canonicalUrl: "https://www.motorsport.com/f1/news/invalid-leap-day/",
          sourceTitle: "Invalid leap day source",
          sourceAuthor: "Motorsport.com",
          sourcePublishedAt: "2026-02-29T00:00:00.000Z",
          contentType: "race_news",
          titleZh: "非法闰日标题",
          summaryZh: "非法闰日摘要",
          media: [],
          sourceDisplayName: "Motorsport.com"
        }
      });
      const snapshot = buildProjectionSnapshot({
        snapshotGeneration: 1,
        previousSnapshotManifestHash: null,
        records: [record]
      });
      const task = buildProjectionTaskEnvelope({
        deliveryId: `op-snapshot-${snapshot.snapshotManifestHash}`,
        idempotencyKey: `snapshot-sync:0:${snapshot.snapshotManifestHash}`,
        reconcileKey: `reconcile:snapshot:${snapshot.snapshotManifestHash}`,
        snapshot,
        attempt: 0,
        createdAt: "2026-03-01T00:02:00.000Z",
        deadlineAt: "2026-03-01T00:17:00.000Z"
      });
      const { privateKey } = generateKeyPairSync("ed25519");
      signProjectionTaskEnvelope({
        envelopeJson: task.envelopeJson,
        envelopeHash: task.envelopeHash,
        signingKeyId: "projection-key-v1",
        privateKey
      });
    }).toThrow(/REVIEW_DATA_INVALID/);
  });

  it("keeps SQLite and signed snapshots identical across stable keyset pages", async () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-public-timeline-"));
    chmodSync(root, 0o700);
    try {
      const records = projectionRecords();
      const expected = records.map(toItem).sort(comparePublicTimelineDescending);
      const sqliteReaderValue = sqliteReader(root, records);
      const snapshotReaderValue = snapshotReader(root, records);
      const sqlite = await readAll(sqliteReaderValue);
      const snapshot = await readAll(snapshotReaderValue);

      expect(sqlite.first).toEqual(snapshot.first);
      expect(sqlite.second).toEqual(snapshot.second);
      expect(sqlite.all).toEqual(expected);
      expect(snapshot.all).toEqual(expected);
      expect(sqlite.first.items).toHaveLength(12);
      expect(sqlite.second.items).toHaveLength(3);
      expect(sqlite.second.page).toEqual({ pageSize: 12, hasMore: false, nextCursor: null });
      expect(new Set(sqlite.all.map((item) => item.publicId)).size).toBe(records.length);
      expect(sqlite.first.page.nextCursor?.cursorAt).toBe(publicTimelineAt(sqlite.first.items.at(-1)!));

      const tied = expected.filter((item) => item.sourcePublishedAt === "2026-08-14T09:54:00.000Z");
      expect(tied).toHaveLength(2);
      expect(tied.map((item) => item.publicId)).toEqual(
        tied.map((item) => item.publicId).sort().reverse()
      );
      expect(new Set(records.map((record) => record.publishedAt))).toEqual(
        new Set(["2026-08-14T10:25:37.366Z"])
      );

      expect(publicTimelineAt(expected[0])).toBe("2026-08-14T09:59:00.001Z");
      expect(publicTimelineAt(expected[1])).toBe("2026-08-14T09:59:00Z");
      const boundaryCursorId = encodePublicCursor({
        v: 2,
        publicId: expected[0].publicId,
        timelineAt: publicTimelineAt(expected[0]),
        source: null,
        contentType: null
      });
      const boundaryPath = `http://127.0.0.1:3000/api/public/feed?cursorAt=${encodeURIComponent(publicTimelineAt(expected[0]))}&cursorId=${boundaryCursorId}`;
      for (const reader of [sqliteReaderValue, snapshotReaderValue]) {
        const response = handlePublicFeed(new Request(boundaryPath), reader);
        expect(response.status).toBe(200);
        const body = await response.json() as PublicFeedResponseV1;
        expect(body.items[0].publicId).toBe(expected[1].publicId);
        expect(publicTimelineAt(body.items[0])).toBe("2026-08-14T09:59:00Z");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
