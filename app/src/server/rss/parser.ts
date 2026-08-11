import { createHash } from "node:crypto";

import { XMLParser } from "fast-xml-parser";

import {
  RSS_FEED_HOST,
  RSS_MAX_FIELD_BYTES,
  RSS_MAX_ITEMS,
  RSS_MAX_RESPONSE_BYTES,
  RSS_SELECTED_ITEMS,
  RssError,
  type ParsedRssFeed,
  type RssItem
} from "./types.ts";

type JsonRecord = Record<string, unknown>;

const XML_NODE_LIMIT = 10_000;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function localName(name: string): string {
  return (name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name).toLowerCase();
}

function valuesByLocalName(record: JsonRecord, expected: string): unknown[] {
  const values: unknown[] = [];
  for (const [name, value] of Object.entries(record)) {
    if (localName(name) !== expected.toLowerCase()) continue;
    if (Array.isArray(value)) values.push(...value);
    else values.push(value);
  }
  return values;
}

function firstValue(record: JsonRecord, names: readonly string[]): unknown {
  for (const name of names) {
    const value = valuesByLocalName(record, name)[0];
    if (value !== undefined) return value;
  }
  return undefined;
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join(" ");
  const record = asRecord(value);
  if (!record) return "";
  return Object.entries(record)
    .filter(([name]) => !name.startsWith("@_"))
    .map(([, child]) => flattenText(child))
    .join(" ");
}

function decodeSafeEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return "\"";
    if (normalized === "apos") return "'";
    if (normalized === "nbsp") return " ";
    const numeric = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 0x10ffff || (numeric >= 0xd800 && numeric <= 0xdfff)) {
      return " ";
    }
    return String.fromCodePoint(numeric);
  });
}

function plainText(value: unknown): string {
  let text = flattenText(value);
  for (let pass = 0; pass < 2; pass += 1) text = decodeSafeEntities(text);
  text = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)\s*>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/&[A-Za-z0-9#]+;/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function assertField(value: string, reasonCode: "ITEM_FIELD_INVALID" | "ITEM_IDENTITY_INVALID", allowEmpty = false): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if ((!allowEmpty && bytes === 0) || bytes > RSS_MAX_FIELD_BYTES || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new RssError(reasonCode);
  }
  return value;
}

function sanitizedField(
  value: unknown,
  reasonCode: "ITEM_FIELD_INVALID" | "ITEM_IDENTITY_INVALID",
  allowEmpty = false
): string {
  const raw = flattenText(value);
  if (Buffer.byteLength(raw, "utf8") > RSS_MAX_FIELD_BYTES) throw new RssError(reasonCode);
  return assertField(plainText(raw), reasonCode, allowEmpty);
}

function canonicalArticleUrl(rawValue: string): string {
  const raw = assertField(rawValue.trim(), "ITEM_IDENTITY_INVALID");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RssError("ITEM_IDENTITY_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== RSS_FEED_HOST ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new RssError("ITEM_IDENTITY_INVALID");
  }
  url.hash = "";
  return assertField(url.toString(), "ITEM_IDENTITY_INVALID");
}

function linkFromEntry(entry: JsonRecord): string {
  const candidates = valuesByLocalName(entry, "link");
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
    const record = asRecord(candidate);
    if (!record) continue;
    const rel = typeof record["@_rel"] === "string" ? record["@_rel"].toLowerCase() : "alternate";
    if (rel !== "alternate") continue;
    if (typeof record["@_href"] === "string" && record["@_href"].trim() !== "") return record["@_href"];
    const text = flattenText(record).trim();
    if (text !== "") return text;
  }
  throw new RssError("ITEM_IDENTITY_INVALID");
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function payloadHash(item: Omit<RssItem, "sourcePayloadHash">): string {
  const payload = JSON.stringify([
    item.externalId,
    item.canonicalUrl,
    item.title,
    item.excerpt,
    item.author,
    item.publishedAt
  ]);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function parseItem(entry: JsonRecord): RssItem {
  const canonicalUrl = canonicalArticleUrl(linkFromEntry(entry));
  const identityValue = firstValue(entry, ["guid", "id"]);
  const identityText = sanitizedField(identityValue, "ITEM_IDENTITY_INVALID", true);
  const externalId = assertField(identityText === "" ? canonicalUrl : identityText, "ITEM_IDENTITY_INVALID");
  const title = sanitizedField(firstValue(entry, ["title"]), "ITEM_FIELD_INVALID");
  const excerpt = sanitizedField(firstValue(entry, ["description", "summary"]), "ITEM_FIELD_INVALID", true);
  const authorText = sanitizedField(firstValue(entry, ["author", "creator"]), "ITEM_FIELD_INVALID", true);
  const author = authorText === "" ? null : authorText;
  const publishedText = sanitizedField(firstValue(entry, ["pubdate", "published", "updated"]), "ITEM_FIELD_INVALID", true);
  const publishedMillis = Date.parse(publishedText);
  if (publishedText === "" || !Number.isFinite(publishedMillis)) throw new RssError("ITEM_TIME_INVALID");
  const publishedAt = new Date(publishedMillis).toISOString();
  const machineFields = { externalId, canonicalUrl, title, excerpt, author, publishedAt };
  return { ...machineFields, sourcePayloadHash: payloadHash(machineFields) };
}

function countXmlNodes(value: unknown): number {
  let count = 0;
  const visit = (node: unknown): void => {
    count += 1;
    if (count > XML_NODE_LIMIT) throw new RssError("XML_NODE_LIMIT");
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    for (const [name, child] of Object.entries(record)) {
      if (!name.startsWith("@_")) visit(child);
    }
  };
  visit(value);
  return count;
}

function feedEntries(parsed: unknown): JsonRecord[] {
  const document = asRecord(parsed);
  if (!document) throw new RssError("XML_PARSE_REJECTED");
  const rssValue = valuesByLocalName(document, "rss")[0];
  const rss = asRecord(rssValue);
  if (rss) {
    const channel = asRecord(valuesByLocalName(rss, "channel")[0]);
    if (!channel) throw new RssError("XML_PARSE_REJECTED");
    return valuesByLocalName(channel, "item").map((item) => {
      const record = asRecord(item);
      if (!record) throw new RssError("XML_PARSE_REJECTED");
      return record;
    });
  }
  const atom = asRecord(valuesByLocalName(document, "feed")[0]);
  if (atom) {
    return valuesByLocalName(atom, "entry").map((entry) => {
      const record = asRecord(entry);
      if (!record) throw new RssError("XML_PARSE_REJECTED");
      return record;
    });
  }
  throw new RssError("XML_PARSE_REJECTED");
}

export function parseRssFeed(body: Uint8Array): ParsedRssFeed {
  if (body.byteLength > RSS_MAX_RESPONSE_BYTES) throw new RssError("RESPONSE_TOO_LARGE");
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new RssError("UTF8_REJECTED");
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new RssError("XML_FORBIDDEN_DECLARATION");
  if (
    /http:\/\/www\.w3\.org\/2001\/XInclude/i.test(xml) ||
    /<(?:[A-Za-z_][\w.-]*:)?(?:include|fallback)\b/i.test(xml)
  ) {
    throw new RssError("XINCLUDE_REJECTED");
  }

  let parsed: unknown;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: false,
      processEntities: false,
      maxNestedTags: 32,
      cdataPropName: "#cdata",
      commentPropName: false,
      ignoreDeclaration: true,
      ignorePiTags: true
    });
    parsed = parser.parse(xml, true) as unknown;
  } catch (error) {
    const message = String((error as { message?: unknown }).message ?? "");
    throw new RssError(/nested|maxNestedTags|depth/i.test(message) ? "XML_DEPTH_EXCEEDED" : "XML_PARSE_REJECTED");
  }
  countXmlNodes(parsed);
  const entries = feedEntries(parsed);
  if (entries.length > RSS_MAX_ITEMS) throw new RssError("ITEM_LIMIT");
  const items = entries.map(parseItem).sort((left, right) => {
    const timeOrder = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    return timeOrder === 0 ? compareCodePoints(left.externalId, right.externalId) : timeOrder;
  });
  return { itemCount: items.length, items: items.slice(0, RSS_SELECTED_ITEMS) };
}
