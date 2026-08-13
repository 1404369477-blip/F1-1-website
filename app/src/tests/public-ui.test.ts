import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { F1StoryCard } from "../components/f1/story-parts";
import {
  F1_THEME_STORAGE_KEY,
  readThemePreference,
  writeThemePreference,
  type ThemePreferenceStorage
} from "../components/f1/theme-preference";
import {
  PublicApiClientError,
  STORY_CATEGORY_OPTIONS,
  buildPublicFeedPath,
  contentTypeForCategory,
  fetchPublicFeed,
  fetchPublicStory,
  isPublicStoryNotFound,
  type PublicApiFetch
} from "../features/stories/public-api";
import {
  FeedExperience,
  appendPublicFeedPage,
  formatVisibleStoryCount,
  retainLoadedFeed
} from "../features/stories/feed-experience";
import type {
  PublicContentType,
  PublicFeedItemV1,
  PublicFeedResponseV1,
  PublicProblemV1,
  PublicStoryDetailResponseV1
} from "../server/public/types";

const appRoot = resolve(import.meta.dirname, "../..");
const globalCss = readFileSync(resolve(appRoot, "src/app/globals.css"), "utf8");
const feedSource = readFileSync(resolve(appRoot, "src/features/stories/feed-experience.tsx"), "utf8");
const detailSource = readFileSync(resolve(appRoot, "src/features/stories/story-detail-experience.tsx"), "utf8");
const publicApiSource = readFileSync(resolve(appRoot, "src/features/stories/public-api.ts"), "utf8");
const layoutSource = readFileSync(resolve(appRoot, "src/app/layout.tsx"), "utf8");
const shellSource = readFileSync(resolve(appRoot, "src/components/f1/f1-page-shell.tsx"), "utf8");
const searchStoreSource = readFileSync(resolve(appRoot, "src/features/stories/timeline-search.ts"), "utf8");

const contentTypes: PublicContentType[] = ["race_news", "driver_social", "legends_history", "paddock_fun"];

function feedItem(index: number): PublicFeedItemV1 {
  const state = index === 2 ? "media_missing" : index === 5 ? "restricted" : "available";
  return {
    publicId: `public-demo-${String(index + 1).padStart(2, "0")}`,
    contentType: contentTypes[index % contentTypes.length],
    state,
    titleZh: `公开合成标题 ${index + 1}`,
    summaryZh: `公开 API 摘要 ${index + 1}`,
    publishedAt: `2026-08-02T${String(12 - index).padStart(2, "0")}:00:00Z`,
    sourcePublishedAt: `2026-08-02T${String(12 - index).padStart(2, "0")}:00:00Z`,
    sourceTimeStatus: "known",
    source: {
      sourceId: "src-active",
      platform: "website",
      displayName: "公开合成来源",
      byline: "F1+1 编辑台",
      accessStatus: state === "restricted" ? "restricted" : "available"
    },
    media: state === "media_missing" ? null : {
      kind: "synthetic_placeholder",
      assetRef: `asset-${index + 1}`,
      altZh: `公开合成媒体 ${index + 1}`,
      captionZh: "公开合成示意",
      creditDisplay: null,
      tone: ["night", "blue", "amber", "violet", "slate"][index % 5] as "night" | "blue" | "amber" | "violet" | "slate"
    },
    originalLink: {
      enabled: false,
      url: null,
      reason: state === "restricted" ? "source_restricted" : "synthetic_only"
    }
  };
}

const feedItems = Array.from({ length: 12 }, (_, index) => feedItem(index));
const feedResponse: PublicFeedResponseV1 = {
  schemaVersion: "public-read-v0.1",
  items: feedItems,
  page: { pageSize: 12, hasMore: false, nextCursor: null }
};
const detailResponse: PublicStoryDetailResponseV1 = {
  schemaVersion: "public-read-v0.1",
  story: {
    ...feedItems[0],
    leadZh: "公开 API 详情导语",
    bodyZh: ["第一段公开正文。", "第二段公开正文。"],
    keyPointsZh: ["关键点一", "关键点二"]
  },
  relatedItems: feedItems.slice(1, 4)
};

function problem(status: number, reasonCode: PublicProblemV1["reasonCode"]): PublicProblemV1 {
  return {
    type: "about:blank",
    title: "请求失败",
    status,
    detail: "公开内容暂时不可用。",
    instance: "/api/public/stories/public-demo-missing",
    reasonCode,
    traceId: "trace-safe"
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" }
  });
}

function integrationFetch(calls: Array<{ input: string; init?: RequestInit }>): PublicApiFetch {
  return async (input, init) => {
    calls.push({ input, init });
    if (input.startsWith("/api/public/feed")) return jsonResponse(feedResponse);
    if (input === "/api/public/stories/public-demo-01") return jsonResponse(detailResponse);
    if (input === "/api/public/stories/public-demo-missing") {
      return jsonResponse(problem(404, "PUBLIC_STORY_NOT_FOUND"), 404);
    }
    return jsonResponse(problem(500, "PUBLIC_READ_INTEGRITY_FAILED"), 500);
  };
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  if (!channels || channels.length !== 3) throw new Error("Expected a six-digit RGB color");
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("public frontend API single-source integration", () => {
  it("loads the closed 12-item feed through a relative no-store request and maps all four categories", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const result = await fetchPublicFeed({ fetchImpl: integrationFetch(calls) });

    expect(result.stories).toHaveLength(12);
    expect(new Set(result.stories.map((story) => story.category))).toEqual(new Set(STORY_CATEGORY_OPTIONS.map((option) => option.label)));
    expect(result.page).toEqual({ pageSize: 12, hasMore: false, nextCursor: null });
    expect(result.stories.find((story) => story.publicId === "public-demo-03")?.state).toBe("media-missing");
    expect(result.stories.filter((story) => story.images.length > 0).every((story) => story.images.length === 1)).toBe(true);
    expect(publicApiSource).not.toContain("PLACEHOLDER_ASPECTS");
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("/api/public/feed");
    expect(calls[0].input).not.toMatch(/^https?:|^\/\//);
    expect(calls[0].init).toMatchObject({ method: "GET", cache: "no-store" });
  });

  it("binds category and cursor pairs to the accepted feed query", () => {
    expect(contentTypeForCategory("赛事新闻")).toBe("race_news");
    expect(contentTypeForCategory("名宿历史")).toBe("legends_history");
    expect(contentTypeForCategory("全部")).toBeNull();
    expect(buildPublicFeedPath({ contentType: "driver_social" })).toBe("/api/public/feed?contentType=driver_social");
    expect(buildPublicFeedPath({
      contentType: "race_news",
      cursor: { cursorAt: "2026-08-02T12:00:00Z", cursorId: "opaque_cursor" }
    })).toBe("/api/public/feed?contentType=race_news&cursorAt=2026-08-02T12%3A00%3A00Z&cursorId=opaque_cursor");
  });

  it("appends one cursor page without reorder or duplicates and rejects cursor drift", async () => {
    const firstResponse: PublicFeedResponseV1 = {
      ...feedResponse,
      page: {
        pageSize: 12,
        hasMore: true,
        nextCursor: { cursorAt: "2026-08-02T01:00:00Z", cursorId: "cursor_page_2" }
      }
    };
    const secondItems = Array.from({ length: 12 }, (_, index) => ({
      ...feedItem(index),
      publicId: `public-page-2-${String(index + 1).padStart(2, "0")}`
    }));
    const secondResponse: PublicFeedResponseV1 = {
      schemaVersion: "public-read-v0.1",
      items: secondItems,
      page: { pageSize: 12, hasMore: false, nextCursor: null }
    };
    const first = await fetchPublicFeed({ fetchImpl: async () => jsonResponse(firstResponse) });
    const second = await fetchPublicFeed({ fetchImpl: async () => jsonResponse(secondResponse) });
    const appended = appendPublicFeedPage(first, second);

    expect(appended?.stories).toHaveLength(24);
    expect(appended?.stories.slice(0, 12).map((story) => story.publicId)).toEqual(first.stories.map((story) => story.publicId));
    expect(appended?.stories.slice(12).map((story) => story.publicId)).toEqual(second.stories.map((story) => story.publicId));
    expect(new Set(appended?.stories.map((story) => story.publicId))).toHaveProperty("size", 24);
    expect(appended?.page).toEqual(second.page);
    expect(appendPublicFeedPage(first, { ...second, stories: [first.stories[0], ...second.stories.slice(1)] })).toBeNull();
    expect(appendPublicFeedPage(first, { ...second, page: first.page })).toBeNull();
  });

  it("keeps already loaded stories visible throughout offline recovery", async () => {
    const loaded = await fetchPublicFeed({ fetchImpl: integrationFetch([]) });
    const ready = { status: "ready" as const, data: loaded };

    expect(retainLoadedFeed(ready, { status: "loading" })).toBe(ready);
    expect(retainLoadedFeed(ready, { status: "error" })).toBe(ready);
    expect(retainLoadedFeed({ status: "ready", data: { stories: [], page: loaded.page } }, { status: "loading" }))
      .toEqual({ status: "loading" });
  });

  it("loads detail and related items without exposing an original URL", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const result = await fetchPublicStory({ publicId: "public-demo-01", fetchImpl: integrationFetch(calls) });

    expect(result.story.publicId).toBe("public-demo-01");
    expect(result.story.body).toEqual(detailResponse.story.bodyZh);
    expect(result.story.keyPoints).toEqual(["关键点一", "关键点二"]);
    expect(result.relatedStories).toHaveLength(3);
    expect(result.relatedStories.every((story) => story.publicId !== result.story.publicId)).toBe(true);
    expect(calls[0].input).toBe("/api/public/stories/public-demo-01");
    const markup = renderToStaticMarkup(createElement(F1StoryCard, { story: result.story }));
    expect(markup).toContain("原文入口待真实内容接入");
    expect(markup).not.toMatch(/href="https?:/);
  });

  it("renders an HTTPS source image while keeping synthetic media as a local placeholder", async () => {
    const sourceImageItem: PublicFeedItemV1 = {
      ...feedItems[0],
      media: {
        kind: "source_image",
        assetRef: "https://media.example.com/f1/source-image.webp",
        mimeType: "image/webp",
        declaredBytes: 42_000,
        altZh: "F1 车辆来源配图"
      }
    };
    const sourceImageResponse: PublicFeedResponseV1 = {
      ...feedResponse,
      items: [sourceImageItem]
    };
    const sourceImageFetch: PublicApiFetch = async () => jsonResponse(sourceImageResponse);
    const result = await fetchPublicFeed({ fetchImpl: sourceImageFetch });
    const markup = renderToStaticMarkup(createElement(F1StoryCard, { story: result.stories[0] }));

    expect(markup).toContain('src="https://media.example.com/f1/source-image.webp"');
    expect(markup).toContain('alt="F1 车辆来源配图"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain("已公开");
    expect(markup).not.toContain("公开演示");

    const synthetic = await fetchPublicFeed({ fetchImpl: integrationFetch([]) });
    const syntheticMarkup = renderToStaticMarkup(createElement(F1StoryCard, { story: synthetic.stories[0] }));
    expect(syntheticMarkup).toContain("public-demo-01");
    expect(syntheticMarkup).toContain("公开合成示意");
    expect(syntheticMarkup).not.toContain('src="https://');
  });

  it("maps 404 separately and keeps 500 or malformed responses closed with no static fallback", async () => {
    const fetchImpl = integrationFetch([]);
    const missing = await fetchPublicStory({ publicId: "public-demo-missing", fetchImpl }).catch((error: unknown) => error);
    const failed = await fetchPublicStory({ publicId: "public-demo-failed", fetchImpl }).catch((error: unknown) => error);

    expect(isPublicStoryNotFound(missing)).toBe(true);
    expect(failed).toBeInstanceOf(PublicApiClientError);
    expect((failed as PublicApiClientError).status).toBe(500);
    expect(feedSource).not.toMatch(/demo-data|DEMO_STORIES|fixture|node:sqlite|server\/public\/(runtime|repository)/);
    expect(detailSource).not.toMatch(/demo-data|DEMO_STORIES|fixture|node:sqlite|server\/public\/(runtime|repository)/);
    // 允许 SVG data-URI 的 w3.org 命名空间标识符(非网络请求);仍拦截一切真实外链与头
    expect(publicApiSource).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)|\bHost\b|Forwarded|node:sqlite|server\/public\/(runtime|repository)/);
    expect(existsSync(resolve(appRoot, "src/features/stories/demo-data.ts"))).toBe(false);
  });

  it("keeps visible counts exact and never re-introduces v0.1 no-more copy", () => {
    for (const count of [0, 1, 3, 12]) {
      expect(formatVisibleStoryCount(count)).toBe(`${count} 条`);
    }
    expect(feedSource).not.toContain("12 条公开合成内容已全部显示");
  });

  it("uses runtime-neutral public copy for the real snapshot rollout", () => {
    expect(layoutSource).toContain('title: "F1+1 · F1 中文资讯"');
    expect(layoutSource).toContain("聚合已发布的 F1 中文资讯、来源与原文入口");
    expect(shellSource).toContain("公开资讯页面，通过同源公开 API 读取已发布内容。");
    expect(feedSource).toContain("F1+1 · F1 中文资讯时间线");
    expect(feedSource).toContain("内容通过公开 API 提供；聚合内容版权归原作者与来源所有。");
    for (const source of [layoutSource, shellSource, feedSource]) {
      expect(source).not.toMatch(/公开合成资讯|合成占位|未连接外部服务/);
    }
  });

  it("renders the v0.2 timeline loading skeleton server-side with no external href", () => {
    const markup = renderToStaticMarkup(createElement(FeedExperience));
    expect(markup).toContain('id="main-content"');
    expect(markup).toContain('aria-label="F1+1 信息时间线"');
    expect(markup).toContain('class="tl"');
    expect(markup).toContain("skel-time");
    expect(markup).toContain("skel-lines");
    expect(markup).not.toMatch(/href="https?:/);
  });

  it("keeps timeline slots, accordion wiring, lightbox and seven-state copy in the feed source", () => {
    expect(feedSource).toContain("tl-summary-btn");
    expect(feedSource).toContain('aria-controls={`det-');
    expect(feedSource).toContain("aria-expanded={open}");
    expect(feedSource).toContain("ph-main");
    expect(feedSource).toContain("tl-collapse");
    expect(feedSource).toContain("tl-ev");
    expect(feedSource).toContain('role="dialog"');
    expect(feedSource).toContain("aria-modal=\"true\"");
    expect(feedSource).toContain("lb-close");
    expect(feedSource).toContain("关闭图片预览");
    expect(feedSource).toContain("handleMediaWheel");
    expect(feedSource).toContain("handleLightboxWheel");
    expect(feedSource).toContain('block: "center"');
    expect(feedSource).toContain("mediaLockUntilRef");
    expect(feedSource).toContain("event.timeStamp < (mediaSuppressClickUntilRef");
    expect(feedSource).not.toMatch(/mediaSuppressClickUntilRef[\s\S]{0,180}Date\.now/);
    expect(feedSource).toContain("pageMain.inert = true");
    expect(feedSource).toContain("!focusIsInside || active === first");
    expect(feedSource).toContain("pendingFocusReturnRef.current = lastTriggerRef.current");
    expect(feedSource).toContain("pending.element.isConnected ? pending.element : null");
    expect(feedSource).toContain("sameItem?.querySelector<HTMLElement>(\".tl-summary-btn\")");
    expect(feedSource).toContain("target?.focus({ preventScroll: true })");
    expect(feedSource).toContain('data-lightbox-trigger="media"');
    expect(feedSource).toContain("if (lightboxClosingRef.current) return");
    expect(feedSource).toContain("anim.oncancel = finish");
    expect(feedSource).toMatch(/catch \{\s*finish\(\);\s*\}/);
    expect(feedSource).toContain('.find((item) => item.dataset.id === openId)');
    expect(feedSource).not.toContain('data-id="${openId}"');
    expect(feedSource).toContain("detailRequestedRef.current.delete(openId)");
    expect(feedSource).toContain("detailRequestedRef.current.delete(publicId)");
    expect(feedSource).toContain("onClick={() => retryDetail(story.publicId)}");
    expect(feedSource).toMatch(/这条内容已不可用（404）。[\s\S]{0,260}>重试<\/button>/);
    expect(detailSource).toContain('code="404"');
    expect(detailSource).toContain("setRequestVersion((version) => version + 1)");
    expect(feedSource).toContain('id="main-content" tabIndex={-1}');
    expect(shellSource).toContain('document.getElementById("main-content")');
    expect(shellSource).toContain('window.addEventListener("scrollend", finish, { once: true })');
    expect(shellSource).toContain("queueMicrotask(focusReadingStart)");
    expect(shellSource).toContain("onKeyDown={handleScrollToTopKeyDown}");
    expect(shellSource).toContain('event.key !== "Enter" && event.key !== " "');
    expect(feedSource).toContain('target?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" })');
    expect(feedSource).toContain("document.addEventListener(\"click\", handleDocumentClick)");
    expect(feedSource).toContain("isPublicStoryNotFound(error)");
    // 状态矩阵文案与合同 §7 一致
    expect(feedSource).toContain("暂无内容");
    expect(feedSource).toContain("当前没有可显示的聚合内容。");
    expect(feedSource).toContain("聚合服务暂时不可用，请稍后再试。");
    expect(feedSource).toContain("未找到这条内容");
    expect(feedSource).toContain("已经到底了，没有更多聚合内容。");
    expect(feedSource).toContain("部分内容加载成功");
    expect(feedSource).toContain("离线 / 受限");
    expect(feedSource).not.toContain("feed-category-filter");
    expect(feedSource).not.toContain('aria-label="按内容类型筛选时间线"');
    expect(feedSource).toContain("contentTypeForCategory(activeCategory)");
    expect(feedSource).toContain("appendPublicFeedPage(feedState.data, next)");
    expect(feedSource).toContain("setLoadMoreFailed(true)");
    expect(feedSource).toContain("pendingFeedRecoveryFocusRef.current = true");
    expect(feedSource).toContain('document.querySelector<HTMLElement>("#state-box .sb-action")');
    expect(feedSource).toContain("pendingDetailRecoveryFocusRef.current = publicId");
    expect(feedSource).toContain('item?.querySelector<HTMLElement>(".tl-detail-retry")');
    expect(detailSource).toContain("pendingRecoveryFocusRef.current = true");
    expect(detailSource).toContain('document.querySelector<HTMLElement>(".not-found-retry")');
    expect(detailSource).toContain('document.querySelector<HTMLElement>(".detail-retry")');
    expect(feedSource).toContain("pendingAppendFocusIndexRef.current ??= feedState.data.stories.length");
    expect(feedSource).toContain('nextItem?.querySelector<HTMLElement>(".tl-summary-btn")?.focus({ preventScroll: true })');
    expect(feedSource).toContain('aria-live="polite"');
    expect(feedSource).toContain("aria-busy={loadingMore}");
    expect(feedSource).toContain('status: error instanceof PublicApiClientError && error.status === 404 ? "not-found" : "error"');
    expect(feedSource).not.toContain("DEV_STATES");
    expect(feedSource).not.toContain("forcedState");
    expect(feedSource).not.toContain('readHashParam("state")');
    // 保持单列信息架构，不恢复 featured 网格或演示说明卡
    expect(feedSource).not.toContain("featured-stories-title");
    expect(feedSource).not.toContain("DEMO_STORIES");
  });

  it("exposes only user-facing theme/open/search URL params and removes draft state controls", () => {
    expect(feedSource).toContain("readHashParam(\"open\")");
    expect(feedSource).toContain("readHashParam(\"search\")");
    expect(shellSource).toContain("setHashParams({ search:");
    expect(shellSource).toContain("readHashParam(\"theme\")");
    expect(shellSource).toContain("setHashParams({ theme: next })");
    expect(feedSource).not.toContain("parseHashParams");
    expect(feedSource).not.toContain("dataset.width");
    expect(feedSource).not.toContain("dataset.reveal");
    expect(globalCss).not.toContain('body[data-width="1024"]');
    expect(globalCss).not.toContain('html[data-reveal="true"]');
  });

  it("wires client-side timeline search through the search store", () => {
    expect(searchStoreSource).toContain("subscribeTimelineSearch");
    expect(searchStoreSource).toContain("setTimelineSearchQuery");
    expect(feedSource).toContain("subscribeTimelineSearch");
    expect(shellSource).toContain("subscribeTimelineSearch");
    expect(shellSource).toContain("setTimelineSearchQuery");
  });

  it("keeps theme, media-label contrast, detail target and semantic shell contracts", () => {
    const ratio = contrastRatio("#ffffff", "#141417");
    const values = new Map<string, string>();
    const storage: ThemePreferenceStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    };

    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(globalCss.match(/--f1-media-label-bg: #141417;/g)).toHaveLength(2);
    expect(globalCss.match(/--f1-media-label-text: #ffffff;/g)).toHaveLength(2);
    expect(detailSource).toContain('className="detail-back-link" href="/"');
    expect(detailSource).toContain('className="tl-item is-open"');
    expect(detailSource).not.toContain("F1DetailBreadcrumb");
    expect(detailSource).not.toContain("PUBLIC API");
    expect(globalCss).toMatch(/\.detail-back-link\s*\{[\s\S]*?min-height: 44px;/);
    expect(globalCss).toMatch(/\.not-found-retry\s*\{[\s\S]*?min-height: 44px;[\s\S]*?background: transparent;/);
    expect(readThemePreference(storage)).toBe("dark");
    expect(writeThemePreference(storage, "light")).toBe(true);
    expect(values.get(F1_THEME_STORAGE_KEY)).toBe("light");
    expect(readThemePreference(storage)).toBe("light");
    const deniedStorage: ThemePreferenceStorage = {
      getItem: () => { throw new DOMException("denied", "SecurityError"); },
      setItem: () => { throw new DOMException("denied", "SecurityError"); }
    };
    expect(readThemePreference(deniedStorage)).toBe("dark");
    expect(readThemePreference(deniedStorage, "light")).toBe("light");
    expect(writeThemePreference(deniedStorage, "light")).toBe(false);
    expect(layoutSource).toContain("<F1PageShell initialTheme={initialTheme}>");
    expect(shellSource).toContain("readThemePreference(getClientThemeStorage(), fallback)");
    expect(shellSource).toContain("const theme = useSyncExternalStore(");
    expect(shellSource).toContain("subscribeThemePreference");
    expect(shellSource).toContain("() => readClientThemePreference(initialTheme)");
    expect(shellSource).toContain("() => initialTheme");
    expect(shellSource).toContain("publishThemePreferenceChange()");
    expect(shellSource).toContain("writeThemePreferenceCookie(next)");
    expect(shellSource).toContain("function getClientThemeStorage()");
    expect(shellSource).toMatch(/try \{\s*return window\.localStorage;\s*\} catch \{\s*return undefined;/);
    expect(shellSource).toContain("SameSite=Strict");
    expect(layoutSource).toContain("await cookies()");
    expect(layoutSource).toContain("cookieStore.get(F1_THEME_COOKIE_KEY)");
    expect(layoutSource).toContain("data-theme={initialTheme}");
    expect(layoutSource).toContain("<F1PageShell initialTheme={initialTheme}>");
    expect(layoutSource).toContain('viewportFit: "cover"');
    expect(shellSource).not.toContain("requestAnimationFrame");
    expect(shellSource).not.toContain("useState<F1Theme>(initialTheme)");
    expect(layoutSource).not.toContain("suppressHydrationWarning");
    expect(shellSource).toContain("writeThemePreference(getClientThemeStorage(), next)");
    expect(shellSource).toContain('className="brand-min trace"');
    expect(shellSource).toContain("utility-anchor");
    expect(shellSource).toContain("site-settings-panel");
    expect(shellSource).toContain("这些选项暂不保存，也不会调用 API");
    expect(shellSource).toContain("document.addEventListener(\"pointerdown\", closeOutside)");
    expect(shellSource).not.toContain("v0.2 DRAFT");
  });

  it("applies v0.2 tokens, timeline geometry, lightbox and touch/a11y contracts in the stylesheet", () => {
    const finalCss = globalCss.slice(globalCss.indexOf("v0.2 final product contract"));
    // token 权威值（深/浅）
    expect(globalCss).toContain("--bg: oklch(0.145 0.008 252)");
    expect(globalCss).toContain("--bg: oklch(0.97 0.005 250)");
    expect(globalCss).toContain("--border-strong: oklch(0.48 0.014 252)");
    expect(globalCss).toContain("--border-strong: oklch(0.64 0.01 250)");
    // 时间线几何：冻结基准 64px 1fr gap 32px、发丝轴 left 78px、节点 top 38px
    expect(globalCss).toMatch(/\.tl-item\s*\{[\s\S]*?grid-template-columns: 64px 1fr;[\s\S]*?gap: var\(--s4\);/);
    expect(globalCss).toMatch(/\.tl::before\s*\{[\s\S]*?left: 78px;/);
    expect(globalCss).toMatch(/\.tl-item::before\s*\{[\s\S]*?top: 38px;/);
    // 最终主图不裁切 + 证据行横向缩略图
    expect(finalCss).toMatch(/\.ph-main\s*\{[\s\S]*?max-width: 100%;[\s\S]*?max-height: 360px;/);
    expect(finalCss).toMatch(/\.ph-thumbs\s*\{[\s\S]*?flex-direction: row;/);
    expect(finalCss).toMatch(/\.ph-thumb\s*\{[\s\S]*?height: 40px;/);
    expect(finalCss).toMatch(/\.ph-thumb-button\s*\{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
    expect(finalCss).toMatch(/\.tl-lead\s*\{[\s\S]*?-webkit-line-clamp: unset;/);
    expect(finalCss).toMatch(/\.utility-anchor\s*\{[\s\S]*?position: fixed;/);
    expect(finalCss).toMatch(/@media \(max-width: 1100px\)\s*\{[\s\S]*?env\(safe-area-inset-bottom, 0px\)/);
    expect(finalCss).toMatch(/@media \(max-width: 1100px\)\s*\{[\s\S]*?linear-gradient[\s\S]*?backdrop-filter: blur\(16px\)/);
    expect(finalCss).toMatch(/@supports not \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)/);
    expect(feedSource).not.toContain("feed-filters");
    expect(feedSource).not.toContain("feed-category-filter");
    expect(globalCss).toMatch(/\.app\s*\{[\s\S]*?max-width: 880px;[\s\S]*?padding-inline: clamp\(16px, 3\.5vw, 40px\);/);
    expect(finalCss).toMatch(/@media \(max-width: 1100px\)\s*\{[\s\S]*?\.utility-anchor\s*\{[\s\S]*?max-width: 880px;[\s\S]*?max-height: calc\(48px \+ env\(safe-area-inset-bottom, 0px\)\);/);
    expect(finalCss).toMatch(/\.utility-anchor\.is-open\s*\{[\s\S]*?max-height: calc\(440px \+ env\(safe-area-inset-bottom, 0px\)\);/);
    expect(finalCss).toMatch(/@media \(max-width: 1100px\)\s*\{[\s\S]*?scroll-padding-bottom: calc\(72px \+ env\(safe-area-inset-bottom, 0px\)\)/);
    expect(globalCss).toMatch(/button\s*\{[\s\S]*?padding: 0;[\s\S]*?border: 0;[\s\S]*?background: none;/);
    expect(globalCss).not.toContain(".feed-filters");
    // 状态码 44px display + 触控 44px
    expect(globalCss).toMatch(/\.state-box \.sb-code\s*\{[\s\S]*?font-size: 44px;/);
    expect(globalCss).toMatch(/\.tl-ev a\s*\{[\s\S]*?min-height: 44px;/);
    expect(globalCss).toMatch(/\.state-box \.sb-action\s*\{[\s\S]*?min-height: 44px;/);
    // lightbox：背景降对比、48px 关闭按钮
    expect(globalCss).toMatch(/body\.lb-open \.app\s*\{[\s\S]*?grayscale\(\.85\)/);
    expect(globalCss).toMatch(/\.lb-close\s*\{[\s\S]*?width: 48px;[\s\S]*?height: 48px;/);
    // 可见焦点环
    expect(globalCss).toMatch(/:focus-visible\s*\{[\s\S]*?outline: 3px solid var\(--focus\);[\s\S]*?outline-offset: 2px;/);
    // reduced-motion 直播圆点静止
    expect(globalCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.tl-live::before \{ animation: none;/);
  });

  it("reflows to the 390 mobile timeline inside the container and media fallback", () => {
    const finalCss = globalCss.slice(globalCss.indexOf("v0.2 final product contract"));
    const containerRules = finalCss.slice(finalCss.indexOf("@container (max-width: 700px)"));
    const mediaRules = finalCss.slice(finalCss.indexOf("@media (max-width: 700px)"));

    // 时间/日期并排（日期在前）+ 轴节点隐藏
    expect(containerRules).toMatch(/\.tl-time \{ justify-self: start; \}/);
    expect(containerRules).toMatch(/\.ph-main \{ max-width: 100%; max-height: 280px; \}/);
    expect(containerRules).toMatch(/\.ph-thumb \{ width: auto; height: 22px; \}/);
    expect(containerRules).toMatch(/\.tl-ev \{ flex-wrap: nowrap;/);
    // @media 兜底与 container 规则同构
    expect(mediaRules).toMatch(/\.ph-main \{ max-width: 100%; max-height: 280px; \}/);
    expect(mediaRules).toMatch(/\.ph-thumb \{ width: auto; height: 22px; \}/);
    expect(shellSource).not.toContain("draft-mark");
  });
});
