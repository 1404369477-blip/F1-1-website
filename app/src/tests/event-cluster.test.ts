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

import { describe, expect, it } from "vitest";

import {
  extractEventEntities,
  findEventCluster,
  pageClusteredItems,
  sharedEntityCount,
  shouldClusterEvents,
  titleTokenJaccard
} from "../modules/story/event-cluster.ts";
import { encodePublicCursor } from "../server/public/cursor.ts";
import { handlePublicFeed, handlePublicStory } from "../server/public/http.ts";
import { PublicRealSnapshotReader } from "../server/public/snapshot-adapter.ts";
import { publicTimelineAt } from "../server/public/timeline.ts";
import type { PublicFeedItemV1, PublicFeedResponseV1, PublicStoryDetailResponseV1 } from "../server/public/types.ts";
import {
  buildProjectionSnapshot,
  buildProjectionTaskEnvelope,
  buildPublicProjectionRecord,
  derivePublicId
} from "../server/review-real/mapping.ts";
import { ProjectionReceiver, signProjectionTaskEnvelope } from "../server/review-real/projection.ts";
import type { PublicProjectionRecord } from "../server/review-real/schema.ts";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function item(partial: {
  publicId: string;
  titleZh: string;
  sourceId: string;
  displayName?: string;
  sourcePublishedAt: string;
  contentType?: PublicFeedItemV1["contentType"];
  media?: PublicFeedItemV1["media"];
  originalUrl?: string;
}): PublicFeedItemV1 {
  return {
    publicId: partial.publicId,
    contentType: partial.contentType ?? "race_news",
    state: partial.media ? "ready" : "media_missing",
    titleZh: partial.titleZh,
    summaryZh: "摘要",
    publishedAt: "2026-08-18T16:00:00.000Z",
    sourcePublishedAt: partial.sourcePublishedAt,
    sourceTimeStatus: "known",
    source: {
      sourceId: partial.sourceId,
      platform: "rss",
      displayName: partial.displayName ?? partial.sourceId,
      byline: partial.displayName ?? partial.sourceId,
      accessStatus: "available"
    },
    media: partial.media ?? null,
    originalLink: partial.originalUrl
      ? { enabled: true, url: partial.originalUrl, reason: null }
      : { enabled: false, url: null, reason: "synthetic_only" }
  };
}

const albonMotorsport = item({
  publicId: "public-albon-motorsport",
  titleZh: "阿尔本与威廉姆斯续约至2026赛季",
  sourceId: "motorsport-f1-news",
  displayName: "Motorsport.com",
  sourcePublishedAt: "2026-08-18T12:00:00.000Z",
  originalUrl: "https://www.motorsport.com/f1/news/albon-williams/"
});
const albonAutosport = item({
  publicId: "public-albon-autosport",
  titleZh: "威廉姆斯官宣阿尔本留队",
  sourceId: "autosport-f1-news",
  displayName: "Autosport",
  sourcePublishedAt: "2026-08-18T11:30:00.000Z",
  originalUrl: "https://www.autosport.com/f1/news/albon-stays/"
});
const cadillacMotorsport = item({
  publicId: "public-cadillac-motorsport",
  titleZh: "凯迪拉克从零组建赛道团队",
  sourceId: "motorsport-f1-news",
  displayName: "Motorsport.com",
  sourcePublishedAt: "2026-08-18T16:30:00.000Z",
  originalUrl: "https://www.motorsport.com/f1/news/cadillac-team/"
});
const cadillacAutosport = item({
  publicId: "public-cadillac-autosport",
  titleZh: "凯迪拉克公布赛道团队首批名单",
  sourceId: "autosport-f1-news",
  displayName: "Autosport",
  sourcePublishedAt: "2026-08-18T16:10:00.000Z",
  originalUrl: "https://www.autosport.com/f1/news/cadillac-roster/"
});
const hamilton = item({
  publicId: "public-hamilton",
  titleZh: "汉密尔顿谈银石排位策略",
  sourceId: "motorsport-f1-news",
  displayName: "Motorsport.com",
  sourcePublishedAt: "2026-08-18T10:00:00.000Z",
  originalUrl: "https://www.motorsport.com/f1/news/hamilton-silverstone/"
});

describe("event cluster rules", () => {
  it("merges Albon and Cadillac dual-source pairs and keeps Hamilton separate", () => {
    expect(sharedEntityCount(albonMotorsport.titleZh, albonAutosport.titleZh)).toBeGreaterThanOrEqual(2);
    expect(sharedEntityCount(cadillacMotorsport.titleZh, cadillacAutosport.titleZh)).toBeGreaterThanOrEqual(2);
    expect(sharedEntityCount(hamilton.titleZh, albonMotorsport.titleZh)).toBe(0);
    expect(titleTokenJaccard(hamilton.titleZh, albonMotorsport.titleZh)).toBeLessThan(0.14);
    expect(shouldClusterEvents(albonMotorsport, albonAutosport)).toBe(true);
    expect(shouldClusterEvents(cadillacMotorsport, cadillacAutosport)).toBe(true);
    expect(shouldClusterEvents(hamilton, albonMotorsport)).toBe(false);

    const page = pageClusteredItems([
      hamilton,
      albonAutosport,
      albonMotorsport,
      cadillacAutosport,
      cadillacMotorsport
    ], { source: null, cursor: null });
    expect(page.items.map((entry) => entry.publicId)).toEqual([
      "public-cadillac-motorsport",
      "public-albon-motorsport",
      "public-hamilton"
    ]);
    expect(page.items[0].relatedSources).toEqual([{
      publicId: "public-cadillac-autosport",
      sourceId: "autosport-f1-news",
      displayName: "Autosport",
      originalUrl: "https://www.autosport.com/f1/news/cadillac-roster/"
    }]);
    expect(page.items[1].relatedSources?.[0]?.publicId).toBe("public-albon-autosport");
    expect(page.items[2].relatedSources).toBeUndefined();
  });

  it("does not merge same-source stories or a source-filtered feed", () => {
    const sameSource = item({
      ...albonAutosport,
      publicId: "public-albon-motorsport-2",
      sourceId: "motorsport-f1-news",
      displayName: "Motorsport.com",
      sourcePublishedAt: "2026-08-18T11:45:00.000Z"
    });
    expect(shouldClusterEvents(albonMotorsport, sameSource)).toBe(false);
    const filtered = pageClusteredItems(
      [albonMotorsport, albonAutosport].filter((entry) => entry.source.sourceId === "motorsport-f1-news"),
      { source: "motorsport-f1-news", cursor: null }
    );
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].relatedSources).toBeUndefined();
    expect(filtered.items[0].publicId).toBe("public-albon-motorsport");
  });

  it("merges a matching pair inside 18 hours but not at 20 hours", () => {
    const sameEvening = item({
      ...albonAutosport,
      publicId: "public-albon-evening",
      sourceId: "autosport-f1-news",
      sourcePublishedAt: "2026-08-18T18:01:00.000Z"
    });
    const nextMorning = item({
      ...albonAutosport,
      publicId: "public-albon-next-day",
      sourceId: "autosport-f1-news",
      sourcePublishedAt: "2026-08-19T08:01:00.000Z"
    });
    expect(shouldClusterEvents(albonMotorsport, sameEvening)).toBe(true);
    expect(shouldClusterEvents(albonMotorsport, nextMorning)).toBe(false);
  });

  it("merges one shared entity plus the same action family", () => {
    const renewal = item({
      publicId: "public-albon-renewal",
      titleZh: "阿尔本确认续约至2027赛季",
      sourceId: "motorsport-f1-news",
      sourcePublishedAt: "2026-08-18T12:00:00.000Z"
    });
    const stays = item({
      publicId: "public-albon-stays",
      titleZh: "官宣阿尔本留队一年",
      sourceId: "autosport-f1-news",
      sourcePublishedAt: "2026-08-18T11:40:00.000Z"
    });
    expect(sharedEntityCount(renewal.titleZh, stays.titleZh)).toBe(1);
    expect(shouldClusterEvents(renewal, stays)).toBe(true);
  });

  it("does not merge one shared entity with a different action", () => {
    const renewal = item({
      publicId: "public-albon-renewal-only",
      titleZh: "阿尔本确认续约至2027赛季",
      sourceId: "motorsport-f1-news",
      sourcePublishedAt: "2026-08-18T12:00:00.000Z"
    });
    const quali = item({
      publicId: "public-albon-quali",
      titleZh: "阿尔本谈排位圈轮胎选择",
      sourceId: "autosport-f1-news",
      sourcePublishedAt: "2026-08-18T11:40:00.000Z"
    });
    expect(shouldClusterEvents(renewal, quali)).toBe(false);
  });

  it("maps English Cadillac onto the Chinese entity and merges from-zero coverage", () => {
    const english = item({
      publicId: "public-cadillac-en",
      titleZh: "Cadillac builds a trackside team from zero",
      sourceId: "autosport-f1-news",
      sourcePublishedAt: "2026-08-18T16:10:00.000Z"
    });
    expect(extractEventEntities(english.titleZh)).toEqual(["凯迪拉克"]);
    expect(shouldClusterEvents(cadillacMotorsport, english)).toBe(true);
  });

  it("keeps same-day Cadillac leadership and Perez denial as separate events", () => {
    const leadership = item({
      publicId: "public-cadillac-boss",
      titleZh: "凯迪拉克F1车队突发换帅：洛登离任，布德科夫斯基接任",
      sourceId: "motorsport-f1-news",
      sourcePublishedAt: "2026-08-13T07:20:07.000Z"
    });
    const perez = item({
      publicId: "public-cadillac-perez",
      titleZh: "凯迪拉克F1车队否认佩雷斯转会传闻，称其表现未受影响",
      sourceId: "autosport-f1-news",
      sourcePublishedAt: "2026-08-12T20:00:02.000Z"
    });
    expect(shouldClusterEvents(leadership, perez)).toBe(false);
  });

  it("uses sibling media when the newest card has none", () => {
    const withImage = item({
      ...albonAutosport,
      sourceId: "autosport-f1-news",
      sourcePublishedAt: "2026-08-18T11:30:00.000Z",
      media: {
        kind: "source_image",
        assetRef: "https://cdn-1.autosport.com/albon.webp",
        mimeType: "image/webp",
        declaredBytes: 12_000,
        altZh: "阿尔本"
      }
    });
    const page = pageClusteredItems([albonMotorsport, withImage], { source: null, cursor: null });
    expect(page.items[0].publicId).toBe("public-albon-motorsport");
    expect(page.items[0].media).toEqual(withImage.media);
  });

  it("treats a hidden sibling cursor as the whole cluster", () => {
    const page = pageClusteredItems([albonMotorsport, albonAutosport, hamilton], {
      source: null,
      cursor: {
        v: 2,
        publicId: albonAutosport.publicId,
        timelineAt: publicTimelineAt(albonAutosport),
        source: null,
        contentType: null
      }
    });
    expect(page.items.map((entry) => entry.publicId)).toEqual(["public-hamilton"]);
  });

  it("pins cluster siblings first on detail lookup", () => {
    const members = findEventCluster([albonMotorsport, albonAutosport, hamilton], albonAutosport.publicId);
    expect(members.map((entry) => entry.publicId)).toEqual([
      "public-albon-motorsport",
      "public-albon-autosport"
    ]);
  });
});

function projectionRecord(input: {
  candidateId: string;
  sourceId: "motorsport-f1-news" | "autosport-f1-news";
  sourceDisplayName: "Motorsport.com" | "Autosport";
  canonicalUrl: string;
  titleZh: string;
  sourcePublishedAt: string;
}): PublicProjectionRecord {
  const bundleHash = sha256(`cluster-bundle-${input.candidateId}`);
  return buildPublicProjectionRecord({
    publicId: derivePublicId(input.candidateId, bundleHash),
    bundleHash,
    publishedAt: "2026-08-18T17:00:00.000Z",
    publicPayload: {
      candidateId: input.candidateId,
      sourceId: input.sourceId,
      sourceRevision: 1,
      sourcePayloadHash: sha256(`cluster-source-${input.candidateId}`),
      canonicalUrl: input.canonicalUrl,
      sourceTitle: input.titleZh,
      sourceAuthor: input.sourceDisplayName,
      sourcePublishedAt: input.sourcePublishedAt,
      contentType: "race_news",
      titleZh: input.titleZh,
      summaryZh: `${input.titleZh}摘要`,
      media: [],
      sourceDisplayName: input.sourceDisplayName
    }
  });
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
    createdAt: "2026-08-18T17:01:00.000Z",
    deadlineAt: "2026-08-18T17:16:00.000Z"
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

describe("public snapshot event cards", () => {
  it("returns one Albon card and one Cadillac card from a signed dual-source snapshot", async () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-event-cluster-"));
    chmodSync(root, 0o700);
    try {
      const records = [
        projectionRecord({
          candidateId: "rss-albon-motorsport",
          sourceId: "motorsport-f1-news",
          sourceDisplayName: "Motorsport.com",
          canonicalUrl: "https://www.motorsport.com/f1/news/albon-williams/",
          titleZh: "阿尔本与威廉姆斯续约至2026赛季",
          sourcePublishedAt: "2026-08-18T12:00:00.000Z"
        }),
        projectionRecord({
          candidateId: "rss-albon-autosport",
          sourceId: "autosport-f1-news",
          sourceDisplayName: "Autosport",
          canonicalUrl: "https://www.autosport.com/f1/news/albon-stays/",
          titleZh: "威廉姆斯官宣阿尔本留队",
          sourcePublishedAt: "2026-08-18T11:30:00.000Z"
        }),
        projectionRecord({
          candidateId: "rss-cadillac-motorsport",
          sourceId: "motorsport-f1-news",
          sourceDisplayName: "Motorsport.com",
          canonicalUrl: "https://www.motorsport.com/f1/news/cadillac-team/",
          titleZh: "凯迪拉克从零组建赛道团队",
          sourcePublishedAt: "2026-08-18T16:30:00.000Z"
        }),
        projectionRecord({
          candidateId: "rss-cadillac-autosport",
          sourceId: "autosport-f1-news",
          sourceDisplayName: "Autosport",
          canonicalUrl: "https://www.autosport.com/f1/news/cadillac-roster/",
          titleZh: "凯迪拉克公布赛道团队首批名单",
          sourcePublishedAt: "2026-08-18T16:10:00.000Z"
        }),
        projectionRecord({
          candidateId: "rss-hamilton",
          sourceId: "motorsport-f1-news",
          sourceDisplayName: "Motorsport.com",
          canonicalUrl: "https://www.motorsport.com/f1/news/hamilton-silverstone/",
          titleZh: "汉密尔顿谈银石排位策略",
          sourcePublishedAt: "2026-08-18T10:00:00.000Z"
        })
      ];
      const reader = snapshotReader(root, records);
      const feed = await handlePublicFeed(
        new Request("http://127.0.0.1:3000/api/public/feed"),
        reader
      ).json() as PublicFeedResponseV1;
      expect(feed.items).toHaveLength(3);
      expect(feed.items.map((entry) => entry.titleZh)).toEqual([
        "凯迪拉克从零组建赛道团队",
        "阿尔本与威廉姆斯续约至2026赛季",
        "汉密尔顿谈银石排位策略"
      ]);
      expect(feed.items[0].relatedSources?.[0]?.displayName).toBe("Autosport");
      expect(feed.items[1].relatedSources?.[0]?.displayName).toBe("Autosport");
      expect(feed.items[2].relatedSources).toBeUndefined();

      const motorsportOnly = await handlePublicFeed(
        new Request("http://127.0.0.1:3000/api/public/feed?source=motorsport-f1-news"),
        reader
      ).json() as PublicFeedResponseV1;
      expect(motorsportOnly.items).toHaveLength(3);
      expect(motorsportOnly.items.every((entry) => entry.relatedSources === undefined)).toBe(true);

      const hiddenAlbon = records[1];
      const detail = await handlePublicStory(hiddenAlbon.publicId, reader).json() as PublicStoryDetailResponseV1;
      expect(detail.story.publicId).toBe(hiddenAlbon.publicId);
      expect(detail.story.relatedSources?.[0]?.publicId).toBe(records[0].publicId);
      expect(detail.relatedItems[0]?.publicId).toBe(records[0].publicId);

      const hiddenCursor = encodePublicCursor({
        v: 2,
        publicId: hiddenAlbon.publicId,
        timelineAt: publicTimelineAt(hiddenAlbon),
        source: null,
        contentType: null
      });
      const continued = await handlePublicFeed(
        new Request(`http://127.0.0.1:3000/api/public/feed?cursorAt=${encodeURIComponent(publicTimelineAt(hiddenAlbon))}&cursorId=${hiddenCursor}`),
        reader
      ).json() as PublicFeedResponseV1;
      expect(continued.items.map((entry) => entry.publicId)).toEqual([records[4].publicId]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("live dual-rss title pairs", () => {
  const pairs: Array<{ left: string; right: string; merge: boolean }> = [
    {
      left: "哈贾尔或因伤缺席F1荷兰大奖赛，红牛替补计划已就绪",
      right: "伊萨克·哈贾尔或因手腕伤势缺席F1荷兰大奖赛，红牛替补计划已就绪",
      merge: true
    },
    {
      left: "阿尔本确认2027年继续效力威廉姆斯F1车队",
      right: "阿尔本确认2027年继续效力威廉姆斯F1车队",
      merge: true
    },
    {
      left: "凯迪拉克F1车队组建幕后：从零起步的挑战",
      right: "“不是朝九晚五的巡航”——从零组建凯迪拉克赛道团队的回报性挑战",
      merge: true
    },
    {
      left: "FIA：F1“马卡雷纳”尾翼将保留，但红牛需“更多工作”",
      right: "FIA对F1“马卡雷纳”尾翼持开放态度，红牛需“更多工作”",
      merge: true
    },
    {
      left: "本田F1项目为何与红牛时代截然不同",
      right: "纽维谈本田F1项目与红牛时代的根本不同",
      merge: true
    },
    {
      left: "维斯塔潘强调红牛2026赛季下半程“首要任务”",
      right: "维斯塔潘指出红牛2026赛季下半程“首要任务”",
      merge: true
    },
    {
      left: "FIA解除对俄罗斯和白俄罗斯车手的制裁",
      right: "FIA解除对俄罗斯和白俄罗斯车手的制裁",
      merge: true
    },
    {
      left: "凯迪拉克为何此时换帅：洛登被布德科夫斯基取代",
      right: "凯迪拉克F1车队突发换帅：洛登离任，布德科夫斯基接任",
      merge: true
    },
    {
      left: "迈凯伦为何不会很快全面转向2027年赛车研发",
      right: "迈凯伦为何不会停止2026年F1赛车研发",
      merge: true
    },
    {
      left: "麦克尼什谈从塞纳身上学到的经验及其在奥迪的应用",
      right: "专访：艾伦·麦克尼什从塞纳和奥迪学到的赛车人生课",
      merge: true
    },
    {
      left: "梅赛德斯解释与其他F1车队“不同步”的研发策略",
      right: "梅赛德斯技术总监解释为何其他车队的升级“可怕”",
      merge: true
    },
    {
      left: "汉密尔顿谈银石排位策略",
      right: "阿尔本确认2027年继续效力威廉姆斯F1车队",
      merge: false
    },
    {
      left: "布德科夫斯基接替洛登出任凯迪拉克F1车队领队",
      right: "布德科夫斯基：加盟凯迪拉克前曾与F1半数以上车队接触",
      merge: false
    },
    {
      left: "维斯塔潘强调红牛2026赛季下半程“首要任务”",
      right: "施泰纳：梅赛德斯已不再需要维斯塔潘",
      merge: false
    }
  ];

  it("merges rewritten dual-source stories and keeps Hamilton vs Albon apart", () => {
    for (const pair of pairs) {
      const left = item({
        publicId: "live-left",
        titleZh: pair.left,
        sourceId: "autosport-f1-news",
        sourcePublishedAt: "2026-08-18T12:00:00.000Z"
      });
      const right = item({
        publicId: "live-right",
        titleZh: pair.right,
        sourceId: "motorsport-f1-news",
        sourcePublishedAt: "2026-08-18T11:50:00.000Z"
      });
      expect({ title: pair.left, merge: shouldClusterEvents(left, right) }).toEqual({
        title: pair.left,
        merge: pair.merge
      });
    }
  });
});
