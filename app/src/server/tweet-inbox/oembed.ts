import { createHash } from "node:crypto";
import { z } from "zod";

import { canonicalStatusUrl, handleFromAuthorUrl, snowflakePublishedAt } from "./url.ts";
import { TweetInboxError, type ParsedTweetOembed } from "./types.ts";

const OembedSchema = z.object({
  url: z.string().url(),
  author_name: z.string().min(1).max(256),
  author_url: z.string().url(),
  html: z.string().min(1).max(16_384),
  type: z.string().min(1),
  provider_name: z.string().min(1),
  provider_url: z.string().url().optional(),
  version: z.string().optional()
}).strip();

const ENTITY_MAP: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " "
});

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    return ENTITY_MAP[entity.toLowerCase()] ?? match;
  });
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTweetText(html: string): string {
  if (/<iframe\b/i.test(html)) throw new TweetInboxError("OEMBED_IFRAME_REJECTED");
  if (/<script\b/i.test(html) || /javascript:/i.test(html) || /\son\w+=/i.test(html)) {
    throw new TweetInboxError("OEMBED_SCRIPT_REJECTED");
  }
  if (!/twitter-tweet/i.test(html)) {
    throw new TweetInboxError("OEMBED_JSON_REJECTED");
  }
  const paragraph = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  if (!paragraph) throw new TweetInboxError("OEMBED_TEXT_MISSING");
  const text = stripTags(decodeEntities(paragraph[1]));
  if (text.length > 4096) throw new TweetInboxError("OEMBED_JSON_REJECTED");
  return text;
}

function tweetIdFromOembedUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TweetInboxError("OEMBED_JSON_REJECTED");
  }
  const match = parsed.pathname.match(/\/status\/([0-9]{1,19})(?:\/|$)/);
  if (!match) throw new TweetInboxError("OEMBED_JSON_REJECTED");
  return match[1];
}

export function parseOfficialTweetOembed(
  body: string,
  expectedTweetId: string,
  now = Date.now()
): ParsedTweetOembed {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    throw new TweetInboxError("OEMBED_JSON_REJECTED");
  }
  const parsed = OembedSchema.safeParse(parsedJson);
  if (!parsed.success) throw new TweetInboxError("OEMBED_JSON_REJECTED");
  const provider = parsed.data.provider_name.toLowerCase();
  if (provider !== "twitter" && provider !== "x") {
    throw new TweetInboxError("OEMBED_JSON_REJECTED");
  }
  const tweetId = tweetIdFromOembedUrl(parsed.data.url);
  if (tweetId !== expectedTweetId) throw new TweetInboxError("OEMBED_JSON_REJECTED");
  const handle = handleFromAuthorUrl(parsed.data.author_url);
  const text = extractTweetText(parsed.data.html);
  return {
    tweetId,
    canonicalUrl: canonicalStatusUrl(handle, tweetId),
    handle: handle.toLowerCase(),
    authorName: parsed.data.author_name.trim(),
    text,
    sourcePublishedAt: snowflakePublishedAt(tweetId, now),
    oembedSha256: createHash("sha256").update(body, "utf8").digest("hex")
  };
}
