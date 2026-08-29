import { createPublicKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

import { findEventCluster, materializeClusteredItem, pageClusteredItems } from "../../modules/story/event-cluster.ts";
import { readProjectionSnapshot } from "../review-real/projection.ts";
import type { ProjectionSnapshot, PublicProjectionRecord } from "../review-real/schema.ts";
import { encodePublicCursor } from "./cursor.ts";
import { PublicReadError } from "./error.ts";
import type { PublicStoryReader } from "./http.ts";
import { comparePublicTimelineDescending, publicTimelineAt } from "./timeline.ts";
import { publicBilingualCard, readPublicBilingualSnapshot, selectPublicBilingualRecords } from "./bilingual-snapshot.ts";
import type {
  PublicBilingualFeedResponseV2,
  PublicBilingualStoryDetailResponseV2,
  PublicFeedItemV1,
  PublicFeedQuery,
  PublicFeedResponseV1,
  PublicReadVersion,
  PublicStoryDetailResponseV1
} from "./types.ts";

export type PublicRealSnapshotConfig = Readonly<{
  projectionRoot: string;
  signingKeyId: string;
  verifyKeyPath: string;
}>;

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

function orderRecords(records: readonly PublicProjectionRecord[]): PublicProjectionRecord[] {
  return [...records].sort(comparePublicTimelineDescending);
}

export class PublicRealSnapshotReader implements PublicStoryReader {
  private readonly config: PublicRealSnapshotConfig;
  private readonly publicKey: KeyObject;

  constructor(config: PublicRealSnapshotConfig) {
    this.config = config;
    try {
      const publicKey = createPublicKey(readFileSync(config.verifyKeyPath));
      if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("PUBLIC_VERIFY_KEY_INVALID");
      this.publicKey = publicKey;
    } catch {
      throw new PublicReadError("PUBLIC_PROFILE_UNAVAILABLE");
    }
  }

  private readSnapshot(): ProjectionSnapshot | null {
    try {
      return readProjectionSnapshot({
        root: this.config.projectionRoot,
        signingKeyId: this.config.signingKeyId,
        publicKey: this.publicKey
      });
    } catch {
      throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
    }
  }

  private readBilingualSnapshot() {
    return readPublicBilingualSnapshot({ root: this.config.projectionRoot, signingKeyId: this.config.signingKeyId, publicKey: this.publicKey });
  }

  getFeed(
    query: PublicFeedQuery,
    version: PublicReadVersion = "public-read-v0.1"
  ): PublicFeedResponseV1 | PublicBilingualFeedResponseV2 {
    if (version === "public-read-bilingual-v2") {
      const snapshot = this.readBilingualSnapshot();
      const page = selectPublicBilingualRecords(snapshot, query);
      return {
        schemaVersion: "public-read-bilingual-v2",
        items: page.records.map(publicBilingualCard),
        page: { limit: page.limit, nextCursor: page.nextCursor, asOf: snapshot.body.generatedAt },
        generationId: snapshot.body.generationId,
        generationHash: snapshot.generationHash
      };
    }
    if (version !== "public-read-v0.1") throw new PublicReadError("PUBLIC_MEDIA_VERSION_UNSUPPORTED");
    const snapshot = this.readSnapshot();
    if (snapshot === null) {
      return {
        schemaVersion: "public-read-v0.1",
        items: [],
        page: { pageSize: 12, hasMore: false, nextCursor: null }
      };
    }
    const graph = new Map(snapshot.records.map((record) => [record.publicId, record]));
    if (query.cursor) {
      const cursorRecord = graph.get(query.cursor.publicId);
      if (
        !cursorRecord ||
        publicTimelineAt(cursorRecord) !== query.cursor.timelineAt ||
        (query.source !== null && cursorRecord.source.sourceId !== query.source) ||
        (query.contentType !== null && cursorRecord.contentType !== query.contentType)
      ) throw new PublicReadError("PUBLIC_CURSOR_INVALID");
    }
    const filtered = orderRecords(snapshot.records).filter((record) => {
      if (query.source !== null && record.source.sourceId !== query.source) return false;
      if (query.contentType !== null && record.contentType !== query.contentType) return false;
      return true;
    }).map(toItem);
    const { items, hasMore } = pageClusteredItems(filtered, query, 12);
    const last = items.at(-1);
    return {
      schemaVersion: "public-read-v0.1",
      items,
      page: {
        pageSize: 12,
        hasMore,
        nextCursor: hasMore && last ? {
          cursorAt: publicTimelineAt(last),
          cursorId: encodePublicCursor({
            v: 2,
            publicId: last.publicId,
            timelineAt: publicTimelineAt(last),
            source: query.source,
            contentType: query.contentType
          })
        } : null
      }
    };
  }

  getDetail(
    publicId: string,
    version: PublicReadVersion = "public-read-v0.1"
  ): PublicStoryDetailResponseV1 | PublicBilingualStoryDetailResponseV2 | null {
    if (version === "public-read-bilingual-v2") {
      const snapshot = this.readBilingualSnapshot();
      const record = snapshot.body.records.find((candidate) => candidate.payload.publicId === publicId);
      if (!record) return null;
      const ordered = snapshot.body.records
        .filter((candidate) => candidate.payload.publicId !== publicId)
        .sort((left, right) => right.payload.publishedAt.localeCompare(left.payload.publishedAt) || right.payload.publicId.localeCompare(left.payload.publicId));
      const related = [
        ...ordered.filter((candidate) => candidate.payload.category === record.payload.category),
        ...ordered.filter((candidate) => candidate.payload.category !== record.payload.category)
      ].slice(0, 12);
      return {
        schemaVersion: "public-read-bilingual-v2",
        story: publicBilingualCard(record),
        relatedItems: related.map(publicBilingualCard),
        generationId: snapshot.body.generationId,
        generationHash: snapshot.generationHash
      };
    }
    if (version !== "public-read-v0.1") throw new PublicReadError("PUBLIC_MEDIA_VERSION_UNSUPPORTED");
    const snapshot = this.readSnapshot();
    if (snapshot === null) return null;
    const record = snapshot.records.find((candidate) => candidate.publicId === publicId);
    if (!record) return null;
    const allItems = snapshot.records.map(toItem);
    const cluster = findEventCluster(allItems, publicId);
    const siblings = cluster.filter((member) => member.publicId !== publicId);
    const siblingIds = new Set(siblings.map((member) => member.publicId));
    const ordered = orderRecords(snapshot.records).filter((candidate) => candidate.publicId !== publicId);
    const related = [
      ...siblings,
      ...[
        ...ordered.filter((candidate) => candidate.contentType === record.contentType),
        ...ordered.filter((candidate) => candidate.contentType !== record.contentType)
      ].map(toItem).filter((item) => !siblingIds.has(item.publicId))
    ].slice(0, 3);
    return {
      schemaVersion: "public-read-v0.1",
      story: {
        ...materializeClusteredItem(toItem(record), cluster),
        leadZh: record.detail.leadZh,
        bodyZh: record.detail.bodyZh,
        keyPointsZh: record.detail.keyPointsZh
      },
      relatedItems: related
    };
  }
}
