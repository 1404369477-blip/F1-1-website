export const RSS_CATALOG_SCHEMA = "rss-source-catalog-v1" as const;

export type RssCatalogStatus = "live" | "ready" | "blocked";

export type RssCatalogEntry = Readonly<{
  sourceId: string;
  displayName: string;
  feedUrl: string;
  status: RssCatalogStatus;
  reason: string;
  nextAction: string;
}>;

export const RSS_SOURCE_CATALOG: readonly RssCatalogEntry[] = Object.freeze([
  Object.freeze({
    sourceId: "motorsport-f1-news",
    displayName: "Motorsport.com",
    feedUrl: "https://www.motorsport.com/rss/f1/news/",
    status: "live",
    reason: "固定 M1 已按 900 秒调度采集，DoH 绕过 VPN fake-ip。",
    nextAction: "保持现有采集与自动初审/发布。"
  }),
  Object.freeze({
    sourceId: "autosport-f1-news",
    displayName: "Autosport",
    feedUrl: "https://www.autosport.com/rss/f1/news/",
    status: "live",
    reason: "与 Motorsport 同属 Motorsport Network；0005 已放开第二源与 per-source slot。",
    nextAction: "保持 15 分钟调度，观察图片 CDN 与去重。"
  }),
  Object.freeze({
    sourceId: "racefans-f1-news",
    displayName: "RaceFans",
    feedUrl: "https://www.racefans.net/category/formula-1/feed/",
    status: "live",
    reason: "独立 WordPress F1 分类 RSS；0006 已接入。全站 /feed/ 混有 IndyCar，故只用 category URL。配图只热链 www.racefans.net/wp-content/uploads/；分类 RSS 无 enclosure 时从文章 og:image 取。",
    nextAction: "保持 15 分钟调度；不要热链 wp.com / 社交 CDN。"
  }),
  Object.freeze({
    sourceId: "the-race-f1-news",
    displayName: "The Race",
    feedUrl: "https://www.the-race.com/category/formula-1/rss/",
    status: "live",
    reason: "独立分析站 F1 分类 RSS；0006 已接入。必须用 /rss/，/feed/ 会 301，现有 transport 拒绝跳转。配图只热链 storage.ghost.io/.../content/images/。",
    nextAction: "保持 15 分钟调度；描述接近 16KiB 上限，超限条目整条拒绝。"
  }),
  Object.freeze({
    sourceId: "formula1-latest-news",
    displayName: "Formula1.com",
    feedUrl: "https://www.formula1.com/en/latest/all.xml",
    status: "blocked",
    reason: "官方 RSS 条款限制商业聚合，并限制编辑或翻译 feed 内容。",
    nextAction: "不要自动中文整理；如需引用，只保留原链卡片并单独过权利门。"
  }),
  Object.freeze({
    sourceId: "operator-manual",
    displayName: "手工投递",
    feedUrl: "",
    status: "ready",
    reason: "X / Instagram / 记者长文短期内不适合自动抓。编辑粘贴原链和中文稿，是小范围可用的最快增量。",
    nextAction: "下一刀放开 source 表单源约束，在 Admin 增加“投递一条”，不抓任意网页。"
  })
]);

export function liveRssSources(): readonly RssCatalogEntry[] {
  return RSS_SOURCE_CATALOG.filter((entry) => entry.status === "live");
}

export function readyRssSources(): readonly RssCatalogEntry[] {
  return RSS_SOURCE_CATALOG.filter((entry) => entry.status === "ready");
}
