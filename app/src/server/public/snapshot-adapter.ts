import { createPublicKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

import { readProjectionSnapshot } from "../review-real/projection.ts";
import type { ProjectionSnapshot, PublicProjectionRecord } from "../review-real/schema.ts";
import { encodePublicCursor } from "./cursor.ts";
import { PublicReadError } from "./error.ts";
import type { PublicStoryReader } from "./http.ts";
import type {
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

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
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

function orderRecords(records: readonly PublicProjectionRecord[]): PublicProjectionRecord[] {
  return [...records].sort((left, right) => {
    const timestamp = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    return timestamp !== 0 ? timestamp : -compareUnicodeCodePoints(left.publicId, right.publicId);
  });
}

function assertV1(version: PublicReadVersion): void {
  if (version !== "public-read-v0.1") throw new PublicReadError("PUBLIC_MEDIA_VERSION_UNSUPPORTED");
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

  getFeed(
    query: PublicFeedQuery,
    version: PublicReadVersion = "public-read-v0.1"
  ): PublicFeedResponseV1 {
    assertV1(version);
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
        cursorRecord?.publishedAt !== query.cursor.publishedAt ||
        (query.source !== null && cursorRecord.source.sourceId !== query.source) ||
        (query.contentType !== null && cursorRecord.contentType !== query.contentType)
      ) throw new PublicReadError("PUBLIC_CURSOR_INVALID");
    }
    const selected = orderRecords(snapshot.records).filter((record) => {
      if (query.source !== null && record.source.sourceId !== query.source) return false;
      if (query.contentType !== null && record.contentType !== query.contentType) return false;
      if (query.cursor === null) return true;
      return record.publishedAt < query.cursor.publishedAt || (
        record.publishedAt === query.cursor.publishedAt &&
        compareUnicodeCodePoints(record.publicId, query.cursor.publicId) < 0
      );
    }).slice(0, 13);
    const hasMore = selected.length > 12;
    const items = selected.slice(0, 12).map(toItem);
    const last = items.at(-1);
    return {
      schemaVersion: "public-read-v0.1",
      items,
      page: {
        pageSize: 12,
        hasMore,
        nextCursor: hasMore && last ? {
          cursorAt: last.publishedAt,
          cursorId: encodePublicCursor({
            v: 1,
            publicId: last.publicId,
            publishedAt: last.publishedAt,
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
  ): PublicStoryDetailResponseV1 | null {
    assertV1(version);
    const snapshot = this.readSnapshot();
    if (snapshot === null) return null;
    const record = snapshot.records.find((candidate) => candidate.publicId === publicId);
    if (!record) return null;
    const ordered = orderRecords(snapshot.records).filter((candidate) => candidate.publicId !== publicId);
    const related = [
      ...ordered.filter((candidate) => candidate.contentType === record.contentType),
      ...ordered.filter((candidate) => candidate.contentType !== record.contentType)
    ].slice(0, 3).map(toItem);
    return {
      schemaVersion: "public-read-v0.1",
      story: {
        ...toItem(record),
        leadZh: record.detail.leadZh,
        bodyZh: record.detail.bodyZh,
        keyPointsZh: record.detail.keyPointsZh
      },
      relatedItems: related
    };
  }
}
