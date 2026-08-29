import {
  comparePublicTimelineDescending,
  isAfterPublicTimelineCursor,
  publicTimelineAt
} from "../../server/public/timeline.ts";
import type {
  PublicFeedItemV1,
  PublicFeedQuery,
  PublicOriginalLink,
  PublicRelatedSource
} from "../../server/public/types.ts";

export const EVENT_CLUSTER_WINDOW_MS = 18 * 60 * 60 * 1000;
export const EVENT_CLUSTER_MIN_SHARED_ENTITIES = 2;
export const EVENT_CLUSTER_TRIGRAM_JACCARD = 0.22;
export const EVENT_CLUSTER_WEAK_JACCARD = 0.14;
export const EVENT_CLUSTER_TOPIC_JACCARD = 0.1;

const F1_EVENT_ENTITIES = [
  "维斯塔潘",
  "诺里斯",
  "皮亚斯特里",
  "拉塞尔",
  "安东内利",
  "勒克莱尔",
  "汉密尔顿",
  "赛恩斯",
  "塞恩斯",
  "阿隆索",
  "斯特罗尔",
  "阿尔本",
  "贝尔曼",
  "哈贾尔",
  "奥康",
  "加西亚",
  "博陶塔斯",
  "博尔托莱托",
  "霍肯伯格",
  "科拉皮托",
  "科拉平托",
  "麦克尼什",
  "林德布拉德",
  "劳森",
  "佩雷斯",
  "洛登",
  "布德科夫斯基",
  "霍纳",
  "纽维",
  "斯泰纳",
  "施泰纳",
  "阿斯顿马丁",
  "梅赛德斯",
  "威廉姆斯",
  "凯迪拉克",
  "赛道团队",
  "迈凯伦",
  "法拉利",
  "阿尔派",
  "红牛",
  "索伯",
  "哈斯",
  "奥迪",
  "本田"
] as const;

const HAN_ENTITY_ALIASES: Record<string, string> = {
  塞恩斯: "赛恩斯",
  科拉平托: "科拉皮托",
  施泰纳: "斯泰纳"
};

const LATIN_ENTITY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["verstappen", "维斯塔潘"],
  ["norris", "诺里斯"],
  ["piastri", "皮亚斯特里"],
  ["russell", "拉塞尔"],
  ["antonelli", "安东内利"],
  ["leclerc", "勒克莱尔"],
  ["hamilton", "汉密尔顿"],
  ["sainz", "赛恩斯"],
  ["alonso", "阿隆索"],
  ["stroll", "斯特罗尔"],
  ["albon", "阿尔本"],
  ["bearman", "贝尔曼"],
  ["hadjar", "哈贾尔"],
  ["ocon", "奥康"],
  ["gasly", "加西亚"],
  ["bottas", "博陶塔斯"],
  ["bortoleto", "博尔托莱托"],
  ["hulkenberg", "霍肯伯格"],
  ["colapinto", "科拉皮托"],
  ["mcnish", "麦克尼什"],
  ["lindblad", "林德布拉德"],
  ["lawson", "劳森"],
  ["perez", "佩雷斯"],
  ["loden", "洛登"],
  ["lodén", "洛登"],
  ["budkowski", "布德科夫斯基"],
  ["horner", "霍纳"],
  ["newey", "纽维"],
  ["steiner", "斯泰纳"],
  ["cadillac", "凯迪拉克"],
  ["williams", "威廉姆斯"],
  ["mclaren", "迈凯伦"],
  ["mercedes", "梅赛德斯"],
  ["ferrari", "法拉利"],
  ["alpine", "阿尔派"],
  ["honda", "本田"],
  ["haas", "哈斯"],
  ["sauber", "索伯"],
  ["audi", "奥迪"],
  ["aston martin", "阿斯顿马丁"],
  ["red bull", "红牛"]
];

const TOPIC_FAMILIES: readonly (readonly string[])[] = [
  ["续约", "留队", "留下", "继续效力"],
  ["缺席", "因伤", "伤势", "替补计划", "手腕"],
  ["换帅", "离任", "接任", "离队", "接替"],
  ["马卡雷纳"],
  ["最佳驾驶"],
  ["双方协商一致"],
  ["动力单元"],
  ["aduo"],
  ["从零", "from zero"],
  ["发挥关键作用"],
  ["首要任务"],
  ["解除对俄罗斯", "俄罗斯和白俄罗斯"],
  ["红牛时代", "截然不同", "根本不同"],
  ["组建赛道团队", "组建幕后"],
  ["转会", "加盟"],
  ["否认", "传闻"]
];

const ENTITY_BY_LENGTH = [...F1_EVENT_ENTITIES].sort((left, right) => right.length - left.length);

export type EventClusterItem = {
  publicId: string;
  contentType: string;
  titleZh: string;
  summaryZh?: string;
  publishedAt: string;
  sourcePublishedAt: string | null;
  sourceTimeStatus: "known" | "unknown";
  source: {
    sourceId: string;
    displayName: string;
  };
  media: PublicFeedItemV1["media"];
  originalLink: PublicOriginalLink;
};

export type EventCluster<T extends EventClusterItem = EventClusterItem> = {
  representative: T;
  members: T[];
};

function hanCompact(text: string): string {
  return [...text].filter((char) => /\p{Script=Han}/u.test(char)).join("");
}

function entityHaystack(text: string): string {
  return `${text}\n${hanCompact(text)}`;
}

function addUnique(hits: string[], canonical: string): void {
  if (!hits.includes(canonical)) hits.push(canonical);
}

function canonicalizeEntity(name: string): string {
  return HAN_ENTITY_ALIASES[name] ?? name;
}

function hasLatinAlias(text: string, alias: string): boolean {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

export function extractEventEntities(text: string): string[] {
  const hits: string[] = [];
  const haystack = entityHaystack(text);
  for (const entity of ENTITY_BY_LENGTH) {
    if (haystack.includes(entity)) addUnique(hits, canonicalizeEntity(entity));
  }
  for (const [alias, canonical] of LATIN_ENTITY_ALIASES) {
    if (hasLatinAlias(text, alias)) addUnique(hits, canonical);
  }
  if (/安东\s*elli/i.test(text)) addUnique(hits, "安东内利");
  return hits;
}

export function sharedEntityCount(leftText: string, rightText: string): number {
  const right = new Set(extractEventEntities(rightText));
  return extractEventEntities(leftText).filter((entity) => right.has(entity)).length;
}

export function titleTokenJaccard(leftTitle: string, rightTitle: string): number {
  const left = titleTokens(leftTitle);
  const right = titleTokens(rightTitle);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const gram of left) {
    if (right.has(gram)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

/** @deprecated Use titleTokenJaccard; kept so existing tests can keep the old name. */
export function titleTrigramJaccard(leftTitle: string, rightTitle: string): number {
  return titleTokenJaccard(leftTitle, rightTitle);
}

function titleTokens(text: string): Set<string> {
  const grams = new Set<string>();
  const latin = text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  for (const token of latin) {
    if (token === "f1") continue;
    grams.add(token);
  }
  const compact = hanCompact(text);
  if (compact.length >= 2) {
    for (let index = 0; index <= compact.length - 2; index += 1) {
      grams.add(compact.slice(index, index + 2));
    }
  }
  if (compact.length >= 3) {
    for (let index = 0; index <= compact.length - 3; index += 1) {
      grams.add(compact.slice(index, index + 3));
    }
  }
  return grams;
}

export function topicFamiliesOf(title: string): string[] {
  const lower = title.toLowerCase();
  const hits: string[] = [];
  for (const family of TOPIC_FAMILIES) {
    if (family.some((needle) => lower.includes(needle.toLowerCase()))) hits.push(family[0]);
  }
  return hits;
}

export function sharedTopicFamily(leftTitle: string, rightTitle: string): string | null {
  const right = new Set(topicFamiliesOf(rightTitle));
  return topicFamiliesOf(leftTitle).find((family) => right.has(family)) ?? null;
}

function topicsConflict(leftTitle: string, rightTitle: string): boolean {
  const left = topicFamiliesOf(leftTitle);
  const right = topicFamiliesOf(rightTitle);
  if (left.length === 0 || right.length === 0) return false;
  return left.every((family) => !right.includes(family));
}

function withinClusterWindow(left: EventClusterItem, right: EventClusterItem): boolean {
  return Math.abs(Date.parse(publicTimelineAt(left)) - Date.parse(publicTimelineAt(right))) <= EVENT_CLUSTER_WINDOW_MS;
}

export function shouldClusterEvents(left: EventClusterItem, right: EventClusterItem): boolean {
  if (left.publicId === right.publicId) return false;
  if (left.source.sourceId === right.source.sourceId) return false;
  if (left.contentType !== right.contentType) return false;
  if (!withinClusterWindow(left, right)) return false;
  const shared = sharedEntityCount(left.titleZh, right.titleZh);
  const jaccard = titleTokenJaccard(left.titleZh, right.titleZh);
  const topic = sharedTopicFamily(left.titleZh, right.titleZh);
  const conflict = topicsConflict(left.titleZh, right.titleZh);
  if (conflict && jaccard < 0.28) return false;
  if (jaccard >= EVENT_CLUSTER_TRIGRAM_JACCARD) return true;
  if (shared >= EVENT_CLUSTER_MIN_SHARED_ENTITIES && jaccard >= EVENT_CLUSTER_TOPIC_JACCARD) return true;
  if (shared >= 1 && (jaccard >= EVENT_CLUSTER_WEAK_JACCARD || topic !== null)) return true;
  return topic !== null && jaccard >= EVENT_CLUSTER_TOPIC_JACCARD;
}

export function clusterEventItems<T extends EventClusterItem>(
  orderedDesc: readonly T[],
  enabled: boolean
): Array<EventCluster<T>> {
  if (!enabled) {
    return orderedDesc.map((item) => ({ representative: item, members: [item] }));
  }
  const used = new Set<string>();
  const clusters: Array<EventCluster<T>> = [];
  for (let index = 0; index < orderedDesc.length; index += 1) {
    const item = orderedDesc[index];
    if (used.has(item.publicId)) continue;
    const members: T[] = [item];
    used.add(item.publicId);
    for (let next = index + 1; next < orderedDesc.length; next += 1) {
      const other = orderedDesc[next];
      if (used.has(other.publicId)) continue;
      if (!withinClusterWindow(item, other)) break;
      if (members.every((member) => shouldClusterEvents(member, other))) {
        members.push(other);
        used.add(other.publicId);
      }
    }
    clusters.push({ representative: item, members });
  }
  return clusters;
}

export function relatedSourcesFor(
  representative: EventClusterItem,
  members: readonly EventClusterItem[]
): PublicRelatedSource[] | undefined {
  const siblings = members.filter((member) => member.publicId !== representative.publicId);
  if (siblings.length === 0) return undefined;
  return siblings.map((sibling) => ({
    publicId: sibling.publicId,
    sourceId: sibling.source.sourceId,
    displayName: sibling.source.displayName,
    originalUrl: sibling.originalLink.enabled ? sibling.originalLink.url : null
  }));
}

export function displayMediaFor<T extends EventClusterItem>(
  representative: T,
  members: readonly T[]
): T["media"] {
  if (representative.media) return representative.media;
  return members.find((member) => member.media)?.media ?? representative.media;
}

export function materializeClusteredItem<T extends PublicFeedItemV1>(
  representative: T,
  members: readonly T[]
): T {
  const relatedSources = relatedSourcesFor(representative, members);
  const media = displayMediaFor(representative, members);
  if (!relatedSources && media === representative.media) return representative;
  return {
    ...representative,
    media,
    ...(relatedSources ? { relatedSources } : {})
  };
}

function resolveClusterCursor<T extends EventClusterItem>(
  clusters: ReadonlyArray<EventCluster<T>>,
  cursor: Readonly<{ publicId: string; timelineAt: string }>
): { publicId: string; timelineAt: string } {
  const cluster = clusters.find((candidate) => (
    candidate.members.some((member) => member.publicId === cursor.publicId)
  ));
  if (!cluster) return cursor;
  return {
    publicId: cluster.representative.publicId,
    timelineAt: publicTimelineAt(cluster.representative)
  };
}

export function pageClusteredItems<T extends PublicFeedItemV1>(
  items: readonly T[],
  query: Pick<PublicFeedQuery, "source" | "cursor">,
  pageSize = 12
): { items: T[]; hasMore: boolean } {
  const ordered = [...items].sort(comparePublicTimelineDescending);
  const clusters = clusterEventItems(ordered, query.source === null);
  const resolvedCursor = query.cursor ? resolveClusterCursor(clusters, query.cursor) : null;
  const visible = clusters.filter((cluster) => (
    resolvedCursor === null || isAfterPublicTimelineCursor(cluster.representative, resolvedCursor)
  ));
  return {
    items: visible.slice(0, pageSize).map((cluster) => (
      materializeClusteredItem(cluster.representative, cluster.members)
    )),
    hasMore: visible.length > pageSize
  };
}

export function findEventCluster<T extends EventClusterItem>(
  items: readonly T[],
  publicId: string
): T[] {
  const ordered = [...items].sort(comparePublicTimelineDescending);
  const cluster = clusterEventItems(ordered, true).find((candidate) => (
    candidate.members.some((member) => member.publicId === publicId)
  ));
  return cluster?.members ?? items.filter((item) => item.publicId === publicId);
}
