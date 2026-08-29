export const MOTORSPORT_SOURCE_ID = "motorsport-f1-news" as const;
export const AUTOSPORT_SOURCE_ID = "autosport-f1-news" as const;
export const RACEFANS_SOURCE_ID = "racefans-f1-news" as const;
export const THE_RACE_SOURCE_ID = "the-race-f1-news" as const;

export const LIVE_RSS_SOURCE_IDS = [
  MOTORSPORT_SOURCE_ID,
  AUTOSPORT_SOURCE_ID,
  RACEFANS_SOURCE_ID,
  THE_RACE_SOURCE_ID
] as const;
export type LiveRssSourceId = (typeof LIVE_RSS_SOURCE_IDS)[number];

export const LIVE_RSS_DISPLAY_NAMES = [
  "Motorsport.com",
  "Autosport",
  "RaceFans",
  "The Race"
] as const;
export type LiveRssDisplayName = (typeof LIVE_RSS_DISPLAY_NAMES)[number];

export type LiveRssSource = Readonly<{
  sourceId: LiveRssSourceId;
  displayName: LiveRssDisplayName;
  feedUrl: string;
  feedHost: string;
  feedPath: string;
  articleHost: string;
  mediaHostPattern: RegExp;
}>;

const MOTORSPORT_MEDIA_HOST = /^cdn-[0-9]+\.motorsport\.com$/;
const AUTOSPORT_MEDIA_HOST = /^(cdn-[0-9]+\.motorsport\.com|cdn-[0-9]+\.autosport\.com)$/;
const RACEFANS_MEDIA_HOST = /^www\.racefans\.net$/;
const THE_RACE_MEDIA_HOST = /^storage\.ghost\.io$/;
const IMAGE_PATH_EXTENSION = /\.(?:jpe?g|png|webp|avif)$/i;

export const LIVE_RSS_SOURCES: Readonly<Record<LiveRssSourceId, LiveRssSource>> = Object.freeze({
  [MOTORSPORT_SOURCE_ID]: Object.freeze({
    sourceId: MOTORSPORT_SOURCE_ID,
    displayName: "Motorsport.com",
    feedUrl: "https://www.motorsport.com/rss/f1/news/",
    feedHost: "www.motorsport.com",
    feedPath: "/rss/f1/news/",
    articleHost: "www.motorsport.com",
    mediaHostPattern: MOTORSPORT_MEDIA_HOST
  }),
  [AUTOSPORT_SOURCE_ID]: Object.freeze({
    sourceId: AUTOSPORT_SOURCE_ID,
    displayName: "Autosport",
    feedUrl: "https://www.autosport.com/rss/f1/news/",
    feedHost: "www.autosport.com",
    feedPath: "/rss/f1/news/",
    articleHost: "www.autosport.com",
    mediaHostPattern: AUTOSPORT_MEDIA_HOST
  }),
  [RACEFANS_SOURCE_ID]: Object.freeze({
    sourceId: RACEFANS_SOURCE_ID,
    displayName: "RaceFans",
    feedUrl: "https://www.racefans.net/category/formula-1/feed/",
    feedHost: "www.racefans.net",
    feedPath: "/category/formula-1/feed/",
    articleHost: "www.racefans.net",
    mediaHostPattern: RACEFANS_MEDIA_HOST
  }),
  [THE_RACE_SOURCE_ID]: Object.freeze({
    sourceId: THE_RACE_SOURCE_ID,
    displayName: "The Race",
    feedUrl: "https://www.the-race.com/category/formula-1/rss/",
    feedHost: "www.the-race.com",
    feedPath: "/category/formula-1/rss/",
    articleHost: "www.the-race.com",
    mediaHostPattern: THE_RACE_MEDIA_HOST
  })
});

export const LIVE_RSS_ARTICLE_HOSTS = Object.freeze(
  new Set(Object.values(LIVE_RSS_SOURCES).map((source) => source.articleHost))
);

export function isLiveRssSourceId(value: string): value is LiveRssSourceId {
  return (LIVE_RSS_SOURCE_IDS as readonly string[]).includes(value);
}

export function liveRssSource(sourceId: string): LiveRssSource {
  if (!isLiveRssSourceId(sourceId)) {
    throw new Error(`UNKNOWN_RSS_SOURCE:${sourceId}`);
  }
  return LIVE_RSS_SOURCES[sourceId];
}

export function liveRssSourceByFeedUrl(feedUrl: string): LiveRssSource | null {
  return Object.values(LIVE_RSS_SOURCES).find((source) => source.feedUrl === feedUrl) ?? null;
}

export function liveRssDisplayName(sourceId: string): LiveRssSource["displayName"] {
  return liveRssSource(sourceId).displayName;
}

export function isLiveRssMediaUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443") ||
    url.hash !== ""
  ) {
    return false;
  }
  if (AUTOSPORT_MEDIA_HOST.test(url.hostname)) return true;
  if (
    RACEFANS_MEDIA_HOST.test(url.hostname) &&
    url.pathname.startsWith("/wp-content/uploads/") &&
    IMAGE_PATH_EXTENSION.test(url.pathname)
  ) {
    return true;
  }
  if (
    THE_RACE_MEDIA_HOST.test(url.hostname) &&
    url.pathname.includes("/content/images/") &&
    IMAGE_PATH_EXTENSION.test(url.pathname)
  ) {
    return true;
  }
  return false;
}
