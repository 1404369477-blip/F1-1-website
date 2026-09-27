import { XMLParser, XMLValidator } from "fast-xml-parser";

import type { LeanSource } from "./config.ts";

export type FeedImage = Readonly<{
  url: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
  declaredBytes: number;
  width?: number;
  height?: number;
  kind?: "photo" | "video_poster";
}>;

export type FeedEntry = Readonly<{
  sourceId: string;
  link: string;
  title: string;
  text: string;
  sourcePublishedAt: string | null;
  image: FeedImage | null;
  images: readonly FeedImage[];
}>;

const FETCH_TIMEOUT_MS = 20_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 4000;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", processEntities: true, htmlEntities: true });

type Node = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) return text((value as Node)["#text"]);
  return "";
}

const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
      return HTML_ENTITIES[lower] ?? entity;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/** `Date.parse` only knows the North American zone names; feeds such as Sky Sports use European ones. */
const ZONE_OFFSETS: Record<string, string> = { BST: "+0100", CET: "+0100", CEST: "+0200", IST: "+0100", WET: "+0000", WEST: "+0100", EET: "+0200", EEST: "+0300" };

function isoOrNull(value: string): string | null {
  const normalized = value.trim().replace(/\s([A-Z]{3,4})$/, (match, zone: string) => ZONE_OFFSETS[zone] ? ` ${ZONE_OFFSETS[zone]}` : match);
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function imageMime(url: string, declared: string): FeedImage["mimeType"] | null {
  const type = declared.toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") return "image/jpeg";
  if (type === "image/png" || type === "image/webp" || type === "image/avif") return type;
  const extension = /\.(jpe?g|png|webp|avif)(?:$|[?#])/i.exec(url)?.[1]?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png" || extension === "webp" || extension === "avif") return `image/${extension}`;
  return null;
}

function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Photo-agency pictures (Getty, XPB, AFP, …) are licensed to the publisher, not to us; they are never shown.
 * Feeds rarely carry a credit, so the file name or URL is usually the only signal.
 */
const AGENCY_PATTERN = /getty|\bgi-\d|xpb[_-]|\bafp\b|reuters|shutterstock|imago|alamy|\bepa[_-]|pa[_-]?images|actionplus|sutton[_-]?images/i;

export function isAgencyImage(url: string, credit = ""): boolean {
  return AGENCY_PATTERN.test(decodeURIComponent(new URL(url).pathname)) || AGENCY_PATTERN.test(credit);
}

function pickImage(item: Node): FeedImage | null {
  const candidates = [...asArray(item.enclosure), ...asArray(item["media:content"]), ...asArray(item["media:thumbnail"])];
  const itemCredit = text(item["media:credit"]);
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const node = candidate as Node;
    const url = httpsUrl(text(node["@_url"]));
    if (!url || isAgencyImage(url, `${itemCredit} ${text(node["media:credit"])}`)) continue;
    const mimeType = imageMime(url, text(node["@_type"]));
    if (!mimeType) continue;
    const bytes = Number(text(node["@_length"]) || text(node["@_fileSize"]));
    return { url, mimeType, declaredBytes: Number.isInteger(bytes) && bytes > 0 ? bytes : 1 };
  }
  return null;
}

const TWIMG_FORMATS: Record<string, FeedImage["mimeType"]> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Normalizes a hosted tweet picture to its `name=large` rendition. Avatars, cards and other hosts are ignored. */
export function largeTwimgUrl(value: string): { url: string; mimeType: FeedImage["mimeType"] } | null {
  let url: URL;
  try {
    url = new URL(value.replace(/&amp;/g, "&"));
  } catch {
    return null;
  }
  const allowed = url.pathname.startsWith("/media/") || url.pathname.startsWith("/amplify_video_thumb/") || url.pathname.startsWith("/ext_tw_video_thumb/");
  if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com" || !allowed) return null;
  const extension = /\.(jpe?g|png|webp)$/i.exec(url.pathname)?.[1];
  if (extension) {
    url.pathname = url.pathname.slice(0, -extension.length - 1);
    url.searchParams.set("format", extension.toLowerCase() === "jpeg" ? "jpg" : extension.toLowerCase());
  }
  const mimeType = TWIMG_FORMATS[(url.searchParams.get("format") ?? "jpg").toLowerCase()];
  if (!mimeType) return null;
  url.searchParams.set("name", "large");
  return { url: url.toString(), mimeType };
}

const TWEET_IMAGE_LIMIT = 4;

function positiveInt(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function tagAttribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1];
}

/** Photos and video posters from the post itself, in order, at most four. Quoted posts and avatars are left out. */
export function pickTweetImages(html: string): FeedImage[] {
  const ownPost = html.replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, " ");
  const images: FeedImage[] = [];
  const seen = new Set<string>();
  for (const match of ownPost.matchAll(/<(img|video)\b[^>]*>/gi)) {
    const tag = match[0];
    const video = match[1]?.toLowerCase() === "video";
    const value = tagAttribute(tag, video ? "poster" : "src");
    const hosted = value ? largeTwimgUrl(value) : null;
    if (!hosted || seen.has(hosted.url) || isAgencyImage(hosted.url)) continue;
    seen.add(hosted.url);
    const width = positiveInt(tagAttribute(tag, "width"));
    const height = positiveInt(tagAttribute(tag, "height"));
    images.push({
      ...hosted,
      declaredBytes: 1,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      kind: video ? "video_poster" : "photo"
    });
    if (images.length >= TWEET_IMAGE_LIMIT) break;
  }
  return images;
}

function atomLink(value: unknown): string {
  for (const link of asArray(value)) {
    if (typeof link === "string") return link;
    const node = link as Node;
    const rel = text(node["@_rel"]);
    if (!rel || rel === "alternate") return text(node["@_href"]);
  }
  return "";
}

/** Parses RSS 2.0 and Atom documents into normalized entries; invalid items are dropped. */
export function parseFeed(source: LeanSource, xml: string): FeedEntry[] {
  if (XMLValidator.validate(xml) !== true) throw new Error("FEED_FORMAT_INVALID_XML");
  const document = parser.parse(xml) as Node;
  const rss = document.rss;
  const isRss = rss !== null && typeof rss === "object" && "channel" in rss;
  const isAtom = Object.hasOwn(document, "feed");
  if (!isRss && !isAtom) throw new Error("FEED_FORMAT_UNSUPPORTED");
  // Empty channel/feed elements may parse as an empty string; those are healthy empty feeds.
  const channel = isRss ? (rss as Node).channel : undefined;
  const feed = document.feed;
  const root = isRss ? channel : feed;
  if ((typeof root !== "object" && root !== "") || root === null || Array.isArray(root)) throw new Error("FEED_FORMAT_INVALID_ROOT");
  const rawItems = isRss ? asArray(channel && typeof channel === "object" ? (channel as Node).item : undefined)
    : asArray(feed && typeof feed === "object" ? (feed as Node).entry : undefined);
  const entries: FeedEntry[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Node;
    const link = httpsUrl(isRss ? text(item.link) : atomLink(item.link));
    if (!link) continue;
    const title = htmlToText(text(item.title));
    const body = text(item["content:encoded"]) || text(item.description) || text(item.content) || text(item.summary);
    const published = text(item.pubDate) || text(item["dc:date"]) || text(item.published) || text(item.updated);
    const rssImage = source.platform === "rss" ? pickImage(item) : null;
    const images = source.platform === "rss" ? (rssImage ? [rssImage] : []) : pickTweetImages(body);
    entries.push({
      sourceId: source.sourceId,
      link,
      title,
      text: htmlToText(body),
      sourcePublishedAt: published ? isoOrNull(published) : null,
      image: images[0] ?? null,
      images
    });
  }
  return entries.filter((entry) => entry.title.length > 0 || entry.text.length > 0);
}

export async function fetchFeed(source: LeanSource, fetcher: typeof fetch = fetch): Promise<FeedEntry[]> {
  const response = await fetcher(source.feedUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": "F1Plus1-Reader/1.0 (+https://f1plus1.com/)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`FEED_HTTP_${response.status}`);
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_FEED_BYTES) throw new Error("FEED_TOO_LARGE");
  return parseFeed(source, body);
}
