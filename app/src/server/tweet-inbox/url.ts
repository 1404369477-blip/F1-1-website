import { TweetInboxError, type NormalizedManualStatusUrl, type NormalizedTweetUrl } from "./types.ts";

const BLOCKED_HANDLES = new Set([
  "home", "explore", "search", "intent", "share", "compose", "settings",
  "messages", "notifications", "i", "hashtag", "login", "signup", "tos",
  "privacy", "about", "download", "jobs"
]);

function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    throw new TweetInboxError("URL_REJECTED");
  }
}

export function snowflakePublishedAt(tweetId: string, now = Date.now()): string | null {
  if (!/^[0-9]{15,19}$/.test(tweetId)) return null;
  const timestamp = Number((BigInt(tweetId) >> BigInt(22)) + BigInt(1_288_834_974_657));
  if (!Number.isFinite(timestamp)) return null;
  if (timestamp < Date.parse("2010-11-01T00:00:00Z") || timestamp > now + 86_400_000) return null;
  return new Date(timestamp).toISOString();
}

export function normalizeTweetStatusUrl(raw: string): NormalizedTweetUrl {
  const submittedUrl = raw.trim();
  if (submittedUrl.length < 20 || submittedUrl.length > 2048) {
    throw new TweetInboxError("URL_REJECTED");
  }
  let url: URL;
  try {
    url = new URL(submittedUrl);
  } catch {
    throw new TweetInboxError("URL_REJECTED");
  }
  const host = url.hostname.toLowerCase();
  const allowedHost =
    host === "x.com" ||
    host === "www.x.com" ||
    host === "twitter.com" ||
    host === "www.twitter.com" ||
    host === "mobile.twitter.com";
  if (
    url.protocol !== "https:" ||
    !allowedHost ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443") ||
    url.hash !== ""
  ) {
    throw new TweetInboxError("URL_REJECTED");
  }

  const path = decodePath(url.pathname).replace(/\/+$/, "") || "/";
  const webStatus = path.match(/^\/i\/web\/status\/([0-9]{1,19})$/);
  if (webStatus) {
    const tweetId = webStatus[1];
    return {
      tweetId,
      handle: null,
      canonicalUrl: `https://x.com/i/web/status/${tweetId}`,
      submittedUrl
    };
  }

  const status = path.match(/^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]{1,19})(?:\/(?:photo|video)\/[0-9]+)?$/);
  if (!status) throw new TweetInboxError("URL_REJECTED");
  const handle = status[1];
  const tweetId = status[2];
  if (BLOCKED_HANDLES.has(handle.toLowerCase())) {
    throw new TweetInboxError("URL_REJECTED");
  }
  return {
    tweetId,
    handle,
    canonicalUrl: `https://x.com/${handle.toLowerCase()}/status/${tweetId}`,
    submittedUrl
  };
}

/**
 * Normalize the quick-launch manual X boundary. This parser deliberately
 * accepts only a human-supplied status URL with a visible screen name. Query
 * strings and fragments are retained in submittedUrl and excluded from the
 * canonical identity; no request is made to X while parsing.
 */
export function normalizeManualStatusUrl(raw: string): NormalizedManualStatusUrl {
  const submittedUrl = raw.trim();
  if (submittedUrl.length < 20 || submittedUrl.length > 2048) {
    throw new TweetInboxError("X_MANUAL_URL_REJECTED");
  }

  let url: URL;
  try {
    url = new URL(submittedUrl);
  } catch {
    throw new TweetInboxError("X_MANUAL_URL_REJECTED");
  }

  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (host !== "x.com" && host !== "twitter.com") ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443")
  ) {
    throw new TweetInboxError("X_MANUAL_URL_REJECTED");
  }

  const path = decodePath(url.pathname);
  const match = path.match(/^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]{1,19})$/);
  if (!match || BLOCKED_HANDLES.has(match[1].toLowerCase())) {
    throw new TweetInboxError("X_MANUAL_URL_REJECTED");
  }

  const handle = match[1];
  const statusId = match[2];
  return {
    statusId,
    handle,
    canonicalUrl: `https://x.com/${handle.toLowerCase()}/status/${statusId}`,
    submittedUrl
  };
}

export function handleFromAuthorUrl(authorUrl: string): string {
  let url: URL;
  try {
    url = new URL(authorUrl);
  } catch {
    throw new TweetInboxError("OEMBED_JSON_REJECTED");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (host !== "x.com" && host !== "twitter.com" && host !== "www.x.com" && host !== "www.twitter.com") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new TweetInboxError("OEMBED_JSON_REJECTED");
  }
  const path = url.pathname.replace(/\/+$/, "");
  const match = path.match(/^\/([A-Za-z0-9_]{1,15})$/);
  if (!match || BLOCKED_HANDLES.has(match[1].toLowerCase())) {
    throw new TweetInboxError("OEMBED_JSON_REJECTED");
  }
  return match[1];
}

export function canonicalStatusUrl(handle: string, tweetId: string): string {
  return `https://x.com/${handle.toLowerCase()}/status/${tweetId}`;
}
