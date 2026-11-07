import { readFileSync } from "node:fs";
import { join } from "node:path";

export const LEAN_CONTENT_TYPES = ["race_news", "driver_social", "legends_history", "paddock_fun"] as const;
export type LeanContentType = typeof LEAN_CONTENT_TYPES[number];

export type XFetchTier = "frequent" | "sparse";

export type LeanSource = Readonly<{
  sourceId: string;
  platform: "rss" | "x";
  displayName: string;
  feedUrl: string;
  contentType: LeanContentType;
  /** Low-signal accounts must pass the model's F1 relevance check. */
  requireRelevance: boolean;
  /** X only: 常更层 vs 稀更层. RSS omits this. */
  fetchTier?: XFetchTier;
}>;

export const LEAN_DATA_ROOT = "/Users/chanai/F1-1-website/lean-data";
export const LEAN_BACKUP_DIR = "/Users/chanai/F1-1-website/lean-backups";
/** iCloud Drive keeps one copy per day off this machine; the store holds only already-public stories. */
export const LEAN_OFFSITE_BACKUP_DIR = "/Users/chanai/Library/Mobile Documents/com~apple~CloudDocs/F1Plus1-Backups";
/** Hostnames an editor submission may link to unless `settings.json` lists its own `editorialDomains`. */
export const DEFAULT_EDITORIAL_DOMAINS: readonly string[] = [
  "www.formula1.com", "www.crash.net", "racingnews365.com", "www.racingnews365.com", "www.motorsport.com",
  "www.the-race.com", "www.skysports.com", "www.youtube.com", "youtu.be", "x.com", "twitter.com"
];
/** Picture hosts an editor submission's `imageUrl` may use: F1 official media, YouTube covers, tweet photos. */
export const EDITORIAL_IMAGE_HOSTS: readonly string[] = ["media.formula1.com", "www.formula1.com", "i.ytimg.com", "pbs.twimg.com"];
export const PAGES_CNAME = "f1plus1.com";
export const PAGES_URL = "https://f1plus1.com/";
export const PAGES_REMOTE = "ssh://git@ssh.github.com:443/1404369477-blip/f1plus1.git";
export const PAGES_HTTPS_REMOTE = "https://github.com/1404369477-blip/f1plus1.git";
/** Fine-grained token limited to Contents read/write on f1plus1; when present, publishing uses HTTPS instead of SSH. */
export const PAGES_TOKEN_PATH = "/Users/chanai/F1-1-website/.pages-publisher/credentials-lean/github-token";
export const PAGES_BRANCH = "gh-pages";
export const PAGES_DEPLOY_KEY = "/Users/chanai/F1-1-website/.pages-publisher/credentials-20260912/id_ed25519";
export const PAGES_KNOWN_HOSTS = "/Users/chanai/F1-1-website/.pages-publisher/credentials-20260912/known_hosts";
export const PAGES_UI_DIRECTORY = "/Users/chanai/F1-1-website/.pages-publisher/runtime-20260928-touch/ui";
export const PAGES_WORKFLOW = "/Users/chanai/F1-1-website/.pages-publisher/runtime-20260912-r2/pages.yml";
export const MODEL_PRIVATE_DIR = "/Users/chanai/Library/Application Support/F1Plus1/Admin/private";
export const RSSHUB_ORIGIN = "http://127.0.0.1:1200";
export const RSSHUB_ACCESS_KEY_PATH = "/Users/chanai/Library/Application Support/F1Plus1/RSSHub/config/access-key";

export const SITE_MAX_ITEMS = 1500;
export const SITE_MAX_AGE_DAYS = 60;
/** Missing media is downloaded only for items this young (source_published_at or first_seen); older keep cache only. */
export const MEDIA_DOWNLOAD_MAX_AGE_DAYS = 7;
export const REFINE_BATCH_LIMIT = 40;

const RSS_SOURCES: readonly LeanSource[] = [
  { sourceId: "motorsport-f1-news", platform: "rss", displayName: "Motorsport.com", feedUrl: "https://www.motorsport.com/rss/f1/news/", contentType: "race_news", requireRelevance: false },
  { sourceId: "the-race-f1-news", platform: "rss", displayName: "The Race", feedUrl: "https://www.the-race.com/category/formula-1/rss/", contentType: "race_news", requireRelevance: false },
  { sourceId: "skysports-f1-news", platform: "rss", displayName: "Sky Sports F1", feedUrl: "https://www.skysports.com/rss/12433", contentType: "race_news", requireRelevance: false }
];

type XAccount = readonly [handle: string, contentType: LeanContentType, requireRelevance: boolean, fetchTier: XFetchTier];

/** 常更层 = frequent (core ~17); 稀更层 = sparse (legendary / casual / rarely updating). */
const X_ACCOUNTS: readonly XAccount[] = [
  ["F1", "race_news", false, "frequent"], ["fia", "race_news", false, "frequent"],
  ["McLarenF1", "race_news", false, "frequent"], ["ScuderiaFerrari", "race_news", false, "frequent"], ["MercedesAMGF1", "race_news", false, "frequent"],
  ["redbullracing", "race_news", false, "frequent"], ["WilliamsRacing", "race_news", false, "frequent"], ["AlpineF1Team", "race_news", false, "frequent"],
  ["AstonMartinF1", "race_news", false, "frequent"], ["HaasF1Team", "race_news", false, "frequent"],
  ["LewisHamilton", "driver_social", false, "frequent"], ["Charles_Leclerc", "driver_social", false, "frequent"], ["LandoNorris", "driver_social", false, "frequent"],
  ["Max33Verstappen", "driver_social", false, "frequent"], ["GeorgeRussell63", "driver_social", false, "frequent"],
  ["ChrisMedlandF1", "race_news", false, "frequent"], ["tgruener", "race_news", false, "frequent"],
  ["audif1_", "race_news", false, "sparse"], ["visacashapprb", "race_news", false, "sparse"],
  ["PierreGASLY", "driver_social", false, "sparse"], ["alex_albon", "driver_social", false, "sparse"], ["alo_oficial", "driver_social", false, "sparse"],
  ["ZhouGuanyu24", "legends_history", true, "sparse"], ["NicoRosberg", "legends_history", true, "sparse"],
  ["RichardHammond", "paddock_fun", true, "sparse"], ["MrJamesMay", "paddock_fun", true, "sparse"], ["JeremyClarkson", "paddock_fun", true, "sparse"]
];

export function xSourceId(handle: string): string {
  return `x-${handle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/** X accounts are read through the local RSSHub; `enabledHandles` limits the rollout. */
export function leanSources(enabledHandles: readonly string[] | "all"): LeanSource[] {
  const accessKey = readFileSync(RSSHUB_ACCESS_KEY_PATH, "utf8").trim();
  const x = X_ACCOUNTS
    .filter(([handle]) => enabledHandles === "all" || enabledHandles.includes(handle))
    .map(([handle, contentType, requireRelevance, fetchTier]): LeanSource => ({
      sourceId: xSourceId(handle),
      platform: "x",
      displayName: `@${handle}`,
      feedUrl: `${RSSHUB_ORIGIN}/twitter/user/${handle}/excludeReplies=1&includeRts=0?key=${accessKey}`,
      contentType,
      requireRelevance,
      fetchTier
    }));
  return [...RSS_SOURCES, ...x];
}

export function leanPath(...parts: string[]): string {
  return join(LEAN_DATA_ROOT, ...parts);
}
