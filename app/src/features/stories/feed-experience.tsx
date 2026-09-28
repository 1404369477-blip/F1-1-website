"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

import {
  PublicApiClientError,
  contentTypeForCategory,
  fetchPublicFeed,
  fetchPublicStory,
  publicSearchCard,
  isPublicStoryNotFound,
  type PublicFeedViewModel,
  type PublicStoryCardViewModel,
  type PublicStoryDetailViewModel,
  type PublicStoryImage,
  type StoryCategory
} from "./public-api";
import {
  formatCardKicker,
  editorialSectionLabel,
  hasEditorialExtras,
  isImageFirstCategory,
  shouldShowEndOfFeed,
  shouldShowExpandedLead,
  uniqueEditorialParagraphs
} from "./editorial";
import { readHashParam, setHashParams } from "./hash-params";
import { getTimelineSearchQuery, setTimelineSearchQuery, subscribeTimelineSearch } from "./timeline-search";
import { RaceStrip } from "../../components/RaceStrip";
import { PlayBadge } from "./play-badge";
import { IS_PUBLIC_STATIC_SITE, publicStoryHref } from "./public-site-config";
import { PublicStaticGenerationChangedError } from "./public-static-transport";
import { usePublicSearch } from "./use-public-search";

export type FeedRequestState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not-found" }
  | { status: "ready"; data: PublicFeedViewModel };

type DisplayState = "timeline" | "loading" | "empty" | "error" | "404" | "nomore" | "partial" | "offline";

type DetailState =
  | { status: "loading" }
  | { status: "ready"; data: PublicStoryDetailViewModel }
  | { status: "not-found" }
  | { status: "error" };

type ImageItem = PublicStoryImage;

type LightboxState = {
  images: ImageItem[];
  index: number;
  origin: { left: number; top: number; width: number; height: number } | null;
  originalUrl: string | null;
};

type LightboxTrigger = {
  element: HTMLElement;
  publicId: string;
};

type SwipeState = {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  dx: number;
  locked: boolean;
};

type WheelState = { accumulated: number; lastAt: number; flipped: boolean };

type ViewMode = "timeline" | "cards";

const MOBILE_QUERY = "(max-width: 700px)";

function subscribeMobileQuery(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function getMobileQuerySnapshot(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
}

function getMobileQueryServerSnapshot(): boolean {
  return false;
}

function subscribeOnlineStatus(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleOnline = (): void => onStoreChange();
  const handleOffline = (): void => onStoreChange();
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}

function getOnlineStatusSnapshot(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function formatVisibleStoryCount(count: number): string {
  return `${count} 条`;
}

export function appendPublicFeedPage(
  current: PublicFeedViewModel,
  next: PublicFeedViewModel
): PublicFeedViewModel | null {
  if (current.staticBundleId !== next.staticBundleId) return null;
  const currentIds = new Set(current.stories.map((story) => story.publicId));
  const nextIds = new Set(next.stories.map((story) => story.publicId));
  if (currentIds.size !== current.stories.length || nextIds.size !== next.stories.length) return null;
  if (next.stories.some((story) => currentIds.has(story.publicId))) return null;
  if (
    next.page.hasMore && next.page.nextCursor && current.page.nextCursor &&
    next.page.nextCursor.cursorAt === current.page.nextCursor.cursorAt &&
    next.page.nextCursor.cursorId === current.page.nextCursor.cursorId
  ) return null;
  return { ...next, stories: [...current.stories, ...next.stories] };
}

export function retainLoadedFeed(
  current: FeedRequestState,
  fallback: FeedRequestState
): FeedRequestState {
  return current.status === "ready" && current.data.stories.length > 0 ? current : fallback;
}

const STATE_COPY: Record<Exclude<DisplayState, "timeline" | "loading">, { code: string; title: string; message: string; action: string }> = {
  empty: { code: "0", title: "暂无内容", message: "当前没有可显示的聚合内容。", action: "刷新" },
  error: { code: "!", title: "加载失败", message: "聚合服务暂时不可用，请稍后再试。", action: "重试" },
  "404": { code: "404", title: "未找到这条内容", message: "链接可能已失效。", action: "返回时间线" },
  nomore: { code: "∅", title: "已无更多内容", message: "已经到底了，没有更多聚合内容。", action: "返回顶部" },
  partial: { code: "i", title: "部分内容加载成功", message: "部分内容加载成功，部分失败；可重试失败项。", action: "重试失败项" },
  offline: { code: "ⓘ", title: "离线 / 受限", message: "当前网络受限，展示最近可用信息。", action: "刷新" }
};

const clockFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai"
});

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Shanghai"
});

function categoryLabelEn(category: string): string {
  if (category === "赛事新闻") return "Race news";
  if (category === "车手近况") return "Driver news";
  if (category === "名宿历史") return "Legends";
  if (category === "围场趣闻") return "Paddock";
  return category;
}

function formatClock(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "--:--";
  return clockFormatter.format(time);
}

function formatDate(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "--";
  return dateFormatter.format(time);
}

function hasAuthor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "unknown" && normalized !== "未知";
}

function StateBox({
  id,
  code,
  title,
  message,
  actionLabel,
  onAction,
  urgent = false
}: {
  id?: string;
  code: string;
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  urgent?: boolean;
}) {
  return (
    <div className="state-box" id={id} role={urgent ? "alert" : "status"} aria-label={title}>
      <span className="sb-code" aria-hidden="true">{code}</span>
      <span className="sb-title">{title}</span>
      <span className="sb-msg">{message}</span>
      <button type="button" className="sb-action" onClick={onAction}>{actionLabel} →</button>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <ol className="tl" id="tl" aria-label="正在加载时间线" aria-busy="true">
      {Array.from({ length: 5 }, (_, index) => (
        <li className="tl-item" key={index} aria-hidden="true">
          <div className="tl-time"><span className="skel-time" /></div>
          <div className="skel-lines"><i /><i /><i /></div>
        </li>
      ))}
    </ol>
  );
}

type CardDeckProps = {
  stories: PublicStoryCardViewModel[];
  onOpenLightbox: (images: PublicStoryImage[], index: number, trigger: HTMLElement, publicId: string, originalUrl?: string | null) => void;
  onLoadMore: (() => void) | null;
};

function sourceLinkLabel(language: "zh-CN" | "en", platform: string): string {
  const post = platform === "x";
  if (language === "en") return post ? "View post →" : "View article →";
  return post ? "查看原帖 →" : "查看原文 →";
}

function uniqueCopy(summary: string, values: readonly string[]): string[] {
  const seen = new Set(summary.split("\n").map((part) => part.trim()).filter((part) => part !== ""));
  return values.filter((value) => {
    const trimmed = value.trim();
    if (trimmed === "" || seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });
}

function contentHeight(element: HTMLElement): number {
  let height = 0;
  for (const child of element.children) {
    const box = child as HTMLElement;
    const style = getComputedStyle(box);
    height += box.offsetHeight + (Number.parseFloat(style.marginTop) || 0) + (Number.parseFloat(style.marginBottom) || 0);
  }
  return height;
}

function textSelectionInside(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.toString().trim() === "") return false;
  return selection.anchorNode !== null && root.contains(selection.anchorNode);
}

function TimelineTitle({ isX, paragraphs, summary, title, category, open, controlsId, onToggle }: {
  isX: boolean;
  paragraphs: readonly string[];
  summary: string;
  title: string;
  category: string;
  open: boolean;
  controlsId?: string;
  onToggle: () => void;
}): ReactNode {
  const textRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const signature = paragraphs.join("\n");
  useLayoutEffect(() => {
    if (!isX) return;
    const element = textRef.current;
    if (!element || open) return;
    const measure = (): void => setOverflows(element.scrollHeight > element.clientHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isX, signature, open]);
  const canToggle = isX ? overflows || open : true;
  const body = isX
    ? (paragraphs.length > 0 ? (
      <div ref={textRef} className={`x-post-text${open ? " is-open" : ""}`}>
        {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </div>
    ) : null)
    : <span className="tl-lead">{summary}</span>;
  const heading = (
    <>
      <span className="tl-head">
        <span className="tl-cat">{category}</span>
        {canToggle ? <span className="tl-chevron" aria-hidden="true">{open ? "▴" : "▾"}</span> : null}
      </span>
      <span className="tl-title">{title}</span>
      {body}
    </>
  );
  if (!canToggle) return <div className="tl-summary-btn">{heading}</div>;
  return (
    <div
      className={`tl-summary-btn is-toggle${open ? " is-open" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-controls={controlsId ? `det-${controlsId}` : undefined}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("a, button")) {
          event.stopPropagation();
          return;
        }
        if (textSelectionInside(event.currentTarget)) return;
        onToggle();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onToggle();
      }}
    >
      {heading}
    </div>
  );
}

function CardFill({ summary, body, keyPoints, language, variant = "article" }: {
  summary: string;
  body: readonly string[];
  keyPoints: readonly string[];
  language: "zh-CN" | "en";
  variant?: "article" | "x";
}): ReactNode {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const article = variant === "x"
    ? (body.length > 0 ? uniqueCopy("", body) : (summary ? [summary] : []))
    : uniqueCopy(summary, body);
  const points = variant === "x" ? [] : uniqueCopy([summary, ...article].join("\n"), keyPoints);
  const signature = `${language}\n${summary}\n${article.join("\n")}\n${points.join("\n")}`;

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const text = textRef.current;
    if (!frame || !text) return;
    const measure = (): void => {
      if (expanded) return;
      setOverflows(contentHeight(text) > text.clientHeight + 8);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(document.documentElement);
    const probe = text.querySelector("p, li");
    if (probe) observer.observe(probe);
    const root = new MutationObserver(measure);
    root.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      root.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [signature, expanded]);

  const showToggle = expanded || overflows;
  return (
    <div className="card-fill" ref={frameRef}>
      <div ref={textRef} className={`card-fill-text${variant === "x" ? " is-x" : ""}${expanded ? " is-open" : ""}${overflows && !expanded ? " is-faded" : ""}`}>
        {variant === "x" || !summary ? null : <p className="card-snap-summary is-inline">{summary}</p>}
        {article.map((paragraph) => <p className="card-fill-p" key={paragraph}>{paragraph}</p>)}
        {points.length > 0 ? (
          <ul className="card-snap-keypoints">
            {points.map((point) => <li key={point}>{point}</li>)}
          </ul>
        ) : null}
      </div>
      {showToggle ? (
        <button type="button" className="card-snap-expand" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
          {expanded ? (language === "en" ? "Hide" : "收起") : (language === "en" ? "Expand" : "展开全文")}
        </button>
      ) : null}
    </div>
  );
}

function CardDeck({ stories, onOpenLightbox, onLoadMore }: CardDeckProps): ReactNode {
  const deckRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [language, setLanguage] = useState<Record<string, "zh-CN" | "en">>({});
  const [cardMedia, setCardMedia] = useState<Record<string, number>>({});
  const cardPointer = useRef<{ id: string; x: number; y: number; horizontal: boolean } | null>(null);

  useEffect(() => {
    if (!onLoadMore || !sentinelRef.current) return;
    const sentinel = sentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { root: deckRef.current, rootMargin: "200px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadMore]);

  const handleImageClick = useCallback(
    (event: React.MouseEvent<HTMLImageElement>, story: PublicStoryCardViewModel, index: number): void => {
      onOpenLightbox(story.images, index, event.currentTarget, story.publicId, story.originalUrl);
    },
    [onOpenLightbox]
  );

  if (stories.length === 0) {
    return (
      <div className="card-deck-empty" role="status">
        <p>暂无可浏览的内容</p>
      </div>
    );
  }

  return (
    <div className="card-deck" ref={deckRef} aria-label="沉浸卡片流">
      {stories.map((story, storyIndex) => {
        const storyCopy = story.localized["zh-CN"] ?? { title: story.title, summary: story.summary, lead: story.summary, body: [], keyPoints: [] };
        const imageIndex = Math.min(cardMedia[story.publicId] ?? 0, Math.max(0, story.images.length - 1));
        const mainImage = story.images[imageIndex] ?? null;
        const hasImage = mainImage !== null;
        const clock = formatClock(story.publishedAtIso);
        const date = formatDate(story.publishedAtIso);
        const english = story.localized.en;
        const selected = language[story.publicId] === "en" && english ? "en" : "zh-CN";
        const copy = story.localized[selected] ?? storyCopy;

        return (
          <article
            className={`card-snap${hasImage ? "" : " card-snap--no-image"}`}
            key={story.publicId}
            data-tone={story.mediaTone}
          >
            <div className="card-snap-header">
              <span className="card-snap-cat">{selected === "en" ? categoryLabelEn(story.category) : story.category}</span>
              <span className="card-snap-counter" aria-label={selected === "en" ? "Card position" : "卡片位置"}>
                {formatCardKicker(stories.length, storyIndex)}
              </span>
              <time className="card-snap-time" dateTime={story.publishedAtIso}>
                {date} {clock}
              </time>
            </div>

            {hasImage && mainImage ? (
              <div
                className="card-snap-visual"
                style={mainImage.width && mainImage.height ? { aspectRatio: `${mainImage.width} / ${mainImage.height}` } : undefined}
                onPointerDown={(event) => {
                  cardPointer.current = { id: story.publicId, x: event.clientX, y: event.clientY, horizontal: false };
                }}
                onPointerMove={(event) => {
                  const start = cardPointer.current;
                  if (!start || start.id !== story.publicId) return;
                  const dx = event.clientX - start.x;
                  const dy = event.clientY - start.y;
                  if (!start.horizontal && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
                    start.horizontal = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }
                }}
                onPointerUp={(event) => {
                  const start = cardPointer.current;
                  cardPointer.current = null;
                  if (!start || !start.horizontal || story.images.length < 2) return;
                  const dx = event.clientX - start.x;
                  if (Math.abs(dx) < 36) return;
                  setCardMedia((current) => {
                    const next = (current[story.publicId] ?? 0) + (dx < 0 ? 1 : -1);
                    return { ...current, [story.publicId]: (next + story.images.length) % story.images.length };
                  });
                }}
                onPointerCancel={() => { cardPointer.current = null; }}
              >
                <img
                  className="card-snap-img"
                  src={mainImage.src}
                  alt={mainImage.alt}
                  width={mainImage.width}
                  height={mainImage.height}
                  loading={storyIndex <= 2 ? "eager" : "lazy"}
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onClick={(event) => {
                    if (mainImage.kind === "video_poster" && story.originalUrl) {
                      window.open(story.originalUrl, "_blank", "noopener,noreferrer");
                      return;
                    }
                    handleImageClick(event, story, imageIndex);
                  }}
                />
                {mainImage.kind === "video_poster" ? <PlayBadge /> : null}
                {story.images.length > 1 ? (
                  <span className="card-snap-img-count" aria-label={`${story.images.length} 张图片`}>
                    {story.images.length} 图
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="card-snap-body">
              <h2 className="card-snap-title">{copy.title}</h2>
              <CardFill summary={copy.summary} body={copy.body} keyPoints={copy.keyPoints} language={selected} variant={story.platform === "x" ? "x" : "article"} />

              <footer className="card-snap-source">
                <span className="card-snap-source-name">
                  {story.sourceName}
                  {story.author && story.author !== story.sourceName ? ` · ${story.author}` : ""}
                </span>
                {story.originalUrl ? (
                  <a
                    className="card-snap-original"
                    href={story.originalUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {sourceLinkLabel(selected, story.platform)}
                  </a>
                ) : <a className="card-snap-original" href={publicStoryHref(story.publicId)}>查看详情 →</a>}
                {english ? (
                  <span className="lang-pill" role="group" aria-label={selected === "en" ? "Language" : "提炼语言"}>
                    <button type="button" className={`lang-pill-btn${selected === "zh-CN" ? " is-active" : ""}`} aria-pressed={selected === "zh-CN"} onClick={() => setLanguage((current) => ({ ...current, [story.publicId]: "zh-CN" }))}>中</button>
                    <span className="lang-pill-sep" aria-hidden="true">/</span>
                    <button type="button" className={`lang-pill-btn${selected === "en" ? " is-active" : ""}`} aria-pressed={selected === "en"} onClick={() => setLanguage((current) => ({ ...current, [story.publicId]: "en" }))}>EN</button>
                  </span>
                ) : null}
              </footer>
            </div>
          </article>
        );
      })}

      <div ref={sentinelRef} className="card-deck-sentinel" aria-hidden="true" />
    </div>
  );
}

export function FeedExperience() {
  const [feedState, setFeedState] = useState<FeedRequestState>({ status: "loading" });
  const [activeCategory, setActiveCategory] = useState<StoryCategory | "全部">("全部");
  const [requestVersion, setRequestVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const isOnline = useSyncExternalStore(subscribeOnlineStatus, getOnlineStatusSnapshot, () => true);
  const query = useSyncExternalStore(subscribeTimelineSearch, getTimelineSearchQuery, () => "");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailStates, setDetailStates] = useState<Record<string, DetailState>>({});
  const [detailRequestVersion, setDetailRequestVersion] = useState(0);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  /** 每条内容当前"固定"的主图索引(点击缩略图/键盘切换)。 */
  const [mediaIndex, setMediaIndex] = useState<Record<string, number>>({});
  /** 每条内容临时悬停预览的索引;null 表示无悬停。 */
  const [mediaHover, setMediaHover] = useState<Record<string, number | null>>({});
  const [languageByPublicId, setLanguageByPublicId] = useState<Record<string, "zh-CN" | "en">>({});
  const [fullTextByPublicId, setFullTextByPublicId] = useState<Record<string, boolean>>({});
  const isMobile = useSyncExternalStore(subscribeMobileQuery, getMobileQuerySnapshot, getMobileQueryServerSnapshot);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "timeline";
    const fromHash = readHashParam("mode");
    if (fromHash === "cards") return "cards";
    if (fromHash === "timeline") return "timeline";
    try {
      return window.localStorage?.getItem("f1_view_mode") === "cards" ? "cards" : "timeline";
    } catch {
      return "timeline";
    }
  });

  useEffect(() => {
    const handleModeChange = () => {
      const fromHash = readHashParam("mode");
      if (fromHash === "cards") {
        setViewMode("cards");
        return;
      }
      if (fromHash === "timeline") {
        setViewMode("timeline");
        return;
      }
      try {
        const stored = window.localStorage?.getItem("f1_view_mode");
        setViewMode(stored === "cards" ? "cards" : "timeline");
      } catch {}
    };
    window.addEventListener("hashchange", handleModeChange);
    window.addEventListener("storage", handleModeChange);
    return () => {
      window.removeEventListener("hashchange", handleModeChange);
      window.removeEventListener("storage", handleModeChange);
    };
  }, []);

  const loadMoreControllerRef = useRef<AbortController | null>(null);
  const pendingFeedRecoveryFocusRef = useRef(false);
  const pendingAppendFocusIndexRef = useRef<number | null>(null);
  const pendingDetailRecoveryFocusRef = useRef<string | null>(null);
  const detailRequestedRef = useRef<Set<string>>(new Set());
  const openIdRef = useRef<string | null>(null);
  const lastTriggerRef = useRef<LightboxTrigger | null>(null);
  const pendingFocusReturnRef = useRef<LightboxTrigger | null>(null);
  const lightboxClosingRef = useRef(false);
  const lightboxRef = useRef<HTMLDivElement | null>(null);
  const lightboxImgRef = useRef<HTMLImageElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipedRef = useRef(false);
  const lightboxLockUntilRef = useRef(0);
  const lightboxWheelRef = useRef<WheelState>({ accumulated: 0, lastAt: 0, flipped: false });
  const mediaSwipeRef = useRef<SwipeState | null>(null);
  const mediaLockUntilRef = useRef<Map<string, number>>(new Map());
  const mediaWheelRef = useRef<Map<string, WheelState>>(new Map());
  const mediaSuppressClickUntilRef = useRef<Map<string, number>>(new Map());
  const staticBundleIdRef = useRef<string | undefined>(undefined);

  const clearStaticReadingState = useCallback((): void => {
    loadMoreControllerRef.current?.abort();
    detailRequestedRef.current.clear();
    pendingAppendFocusIndexRef.current = null;
    pendingDetailRecoveryFocusRef.current = null;
    setDetailStates({});
    setOpenId(null);
    setLightbox(null);
    setMediaIndex({});
    setMediaHover({});
    setLanguageByPublicId({});
    setLoadingMore(false);
    setLoadMoreFailed(false);
    setHashParams({ open: undefined });
  }, []);

  const reloadChangedStaticGeneration = useCallback((): void => {
    clearStaticReadingState();
    staticBundleIdRef.current = undefined;
    setFeedState({ status: "loading" });
    setRequestVersion((version) => version + 1);
  }, [clearStaticReadingState]);

  const publicSearch = usePublicSearch({
    enabled: IS_PUBLIC_STATIC_SITE,
    query,
    contentType: contentTypeForCategory(activeCategory),
    bundleId: feedState.status === "ready" ? feedState.data.staticBundleId : undefined,
    onGenerationChange: reloadChangedStaticGeneration
  });
  const readingBundleId = publicSearch.active ? publicSearch.bundleId : feedState.status === "ready" ? feedState.data.staticBundleId : undefined;

  useEffect(() => {
    openIdRef.current = openId;
  }, [openId]);

  useEffect(() => {
    if (pendingFeedRecoveryFocusRef.current) {
      const settled = feedState.status === "ready" || feedState.status === "error" || feedState.status === "not-found";
      if (settled) {
        pendingFeedRecoveryFocusRef.current = false;
        queueMicrotask(() => {
          const failureAction = feedState.status === "error" || feedState.status === "not-found"
            ? document.querySelector<HTMLElement>("#state-box .sb-action")
            : null;
          (failureAction ?? document.getElementById("main-content"))?.focus({ preventScroll: true });
        });
      }
    }
    if (feedState.status !== "ready") return;
    const nextIndex = pendingAppendFocusIndexRef.current;
    if (nextIndex === null || feedState.data.stories.length <= nextIndex) return;
    pendingAppendFocusIndexRef.current = null;
    const nextItem = document.querySelectorAll<HTMLElement>(".tl-item")[nextIndex];
    nextItem?.querySelector<HTMLElement>(".tl-summary-btn")?.focus({ preventScroll: true });
  }, [feedState]);

  useEffect(() => {
    const publicId = pendingDetailRecoveryFocusRef.current;
    if (!publicId) return;
    if (openId !== publicId) {
      pendingDetailRecoveryFocusRef.current = null;
      return;
    }
    const detail = detailStates[publicId];
    if (!detail || detail.status === "loading") return;
    pendingDetailRecoveryFocusRef.current = null;
    queueMicrotask(() => {
      const item = Array.from(document.querySelectorAll<HTMLElement>(".tl-item"))
        .find((candidate) => candidate.dataset.id === publicId);
      const target = detail.status === "error" || detail.status === "not-found"
        ? item?.querySelector<HTMLElement>(".tl-detail-retry")
        : item?.querySelector<HTMLElement>(".tl-summary-btn");
      (target ?? document.getElementById("main-content"))?.focus({ preventScroll: true });
    });
  }, [detailStates, openId]);

  useEffect(() => {
    loadMoreControllerRef.current?.abort();
    const controller = new AbortController();
    const contentType = contentTypeForCategory(activeCategory);
    void fetchPublicFeed({ contentType, signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (staticBundleIdRef.current && data.staticBundleId !== staticBundleIdRef.current) clearStaticReadingState();
        staticBundleIdRef.current = data.staticBundleId;
        setFeedState({ status: "ready", data });
        const openParam = readHashParam("open");
        if (openParam && data.stories.some((story) => story.publicId === openParam)) {
          setOpenId(openParam);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        if (error instanceof PublicStaticGenerationChangedError) {
          reloadChangedStaticGeneration();
          return;
        }
        if (!controller.signal.aborted) {
          setFeedState((current) => retainLoadedFeed(current, {
            status: error instanceof PublicApiClientError && error.status === 404 ? "not-found" : "error"
          }));
        }
      });
    return () => controller.abort();
  }, [activeCategory, requestVersion, clearStaticReadingState, reloadChangedStaticGeneration]);

  useEffect(() => {
    const searchParam = readHashParam("search");
    if (searchParam) setTimelineSearchQuery(searchParam);
  }, []);

  useEffect(() => {
    if (!openId) return;
    if (detailRequestedRef.current.has(openId)) return;
    detailRequestedRef.current.add(openId);
    const controller = new AbortController();
    setDetailStates((current) => ({ ...current, [openId]: { status: "loading" } }));
    void fetchPublicStory({ publicId: openId, signal: controller.signal, staticBundleId: readingBundleId })
      .then((data) => {
        if (controller.signal.aborted) return;
        setDetailStates((current) => ({ ...current, [openId]: { status: "ready", data: data.story } }));
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          detailRequestedRef.current.delete(openId);
          return;
        }
        if (controller.signal.aborted) {
          detailRequestedRef.current.delete(openId);
          return;
        }
        if (error instanceof PublicStaticGenerationChangedError) {
          reloadChangedStaticGeneration();
          return;
        }
        if (isPublicStoryNotFound(error)) {
          setDetailStates((current) => ({ ...current, [openId]: { status: "not-found" } }));
          return;
        }
        detailRequestedRef.current.delete(openId);
        setDetailStates((current) => ({ ...current, [openId]: { status: "error" } }));
      });
    return () => controller.abort();
  }, [detailRequestVersion, readingBundleId, openId, reloadChangedStaticGeneration]);

  useEffect(() => {
    if (!openId) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = Array.from(document.querySelectorAll<HTMLElement>(".tl-item"))
      .find((item) => item.dataset.id === openId);
    target?.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
  }, [openId]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent): void => {
      const current = openIdRef.current;
      if (!current) return;
      const target = event.target as HTMLElement;
      if (target.closest(".tl-summary-btn")) return;
      if (target.closest(".lightbox")) return;
      const item = target.closest<HTMLElement>(".tl-item");
      if (item && item.dataset.id === current) return;
      setOpenId(null);
      setHashParams({ open: undefined });
    };
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, []);

  // 用 layout effect:在浏览器绘制前同步设置动画首帧,避免 React 先画出全尺寸图片再跳回原点造成"闪一下"。
  useLayoutEffect(() => {
    if (!lightbox) {
      const pending = pendingFocusReturnRef.current;
      if (!pending) return;
      pendingFocusReturnRef.current = null;
      lightboxClosingRef.current = false;

      const sameItem = Array.from(document.querySelectorAll<HTMLElement>(".tl-item"))
        .find((item) => item.dataset.id === pending.publicId);
      const candidates: Array<HTMLElement | null> = [
        pending.element.isConnected ? pending.element : null,
        sameItem?.querySelector<HTMLElement>('[data-lightbox-trigger="media"]') ?? null,
        sameItem?.querySelector<HTMLElement>(".tl-summary-btn") ?? null,
        document.getElementById("search-input"),
        document.querySelector<HTMLElement>(".brand-min"),
        document.querySelector<HTMLElement>('.utility-row button')
      ];
      const target = candidates.find((candidate) => candidate?.isConnected && !candidate.closest("[inert]"));
      target?.focus({ preventScroll: true });
      return;
    }
    lightboxRef.current?.focus();
    const pageMain = document.getElementById("main-content");
    if (pageMain) pageMain.inert = true;
    document.body.classList.add("lb-open");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const img = lightboxImgRef.current;
    if (img) {
      img.style.opacity = "1";
      if (lightbox.origin && !reducedMotion) {
        // 位移量按左上角对齐计算,缩放锚点必须是 0 0,否则缩放会绕中心偏移(demo 同款)。
        img.style.transformOrigin = "0 0";
        const targetRect = img.getBoundingClientRect();
        const scaleX = lightbox.origin.width && targetRect.width ? lightbox.origin.width / targetRect.width : 1;
        const scaleY = lightbox.origin.height && targetRect.height ? lightbox.origin.height / targetRect.height : 1;
        const scale = Math.min(scaleX, scaleY);
        const dx = lightbox.origin.left - targetRect.left;
        const dy = lightbox.origin.top - targetRect.top;
        img.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.6 },
            { transform: "translate(0,0) scale(1)", opacity: 1 }
          ],
          { duration: 340, easing: "cubic-bezier(.2,.8,.2,1)" }
        );
      }
    }
    return () => {
      if (pageMain) pageMain.inert = false;
      document.body.classList.remove("lb-open");
    };
  }, [lightbox]);

  const closeModal = useCallback((): void => {
    setOpenId(null);
    setHashParams({ open: undefined });
  }, []);

  useEffect(() => {
    if (!openId) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpenId(null);
        setHashParams({ open: undefined });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [openId, setHashParams]);

  const toggleItem = useCallback((publicId: string): void => {
    const next = openId === publicId ? null : publicId;
    setOpenId(next);
    setHashParams({ open: next ?? undefined });
  }, [openId]);

  /** 缩略图点击/键盘:固定(永久切换)主图。 */
  const pinMedia = useCallback((publicId: string, index: number): void => {
    setMediaIndex((current) => ({ ...current, [publicId]: index }));
    setMediaHover((current) => ({ ...current, [publicId]: null }));
  }, []);

  /** 缩略图悬停:临时预览;移走恢复固定图(null)。 */
  const previewMedia = useCallback((publicId: string, index: number | null): void => {
    setMediaHover((current) => ({ ...current, [publicId]: index }));
  }, []);

  const navigateMedia = useCallback((publicId: string, count: number, delta: number): void => {
    if (count < 2) return;
    setMediaHover((current) => ({ ...current, [publicId]: null }));
    setMediaIndex((current) => {
      const active = current[publicId] ?? 0;
      return { ...current, [publicId]: (active + delta + count) % count };
    });
  }, []);

  const handleMediaPointerDown = (event: ReactPointerEvent<HTMLSpanElement>, publicId: string): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    mediaSwipeRef.current = {
      id: publicId,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      locked: false
    };
  };

  const handleMediaPointerMove = (event: ReactPointerEvent<HTMLSpanElement>, publicId: string): void => {
    const swipe = mediaSwipeRef.current;
    if (!swipe || swipe.id !== publicId) return;
    if (swipe.pointerId !== event.pointerId) {
      if (event.pointerType === "mouse") return;
      swipe.pointerId = event.pointerId;
    }
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (!swipe.locked && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    if (!swipe.locked && Math.abs(dx) <= Math.abs(dy)) return;
    swipe.locked = true;
    swipe.dx = dx;
    event.currentTarget.classList.add("swiping");
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be rejected by embedded or closing browsing contexts.
    }
    const image = event.currentTarget.querySelector<HTMLImageElement>(".ph-main");
    if (image) image.style.transform = `translateX(${dx}px)`;
  };

  const finishMediaPointer = (
    event: ReactPointerEvent<HTMLSpanElement>,
    story: PublicStoryCardViewModel,
    images: ImageItem[],
    activeIndex: number
  ): void => {
    const publicId = story.publicId;
    const swipe = mediaSwipeRef.current;
    mediaSwipeRef.current = null;
    const image = event.currentTarget.querySelector<HTMLImageElement>(".ph-main");
    event.currentTarget.classList.remove("swiping");
    if (image) image.style.transform = "";
    if (!swipe || swipe.id !== publicId) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    const count = images.length;
    const openPicture = (): void => {
      if (!image) return;
      mediaSuppressClickUntilRef.current.set(publicId, event.timeStamp + 400);
      const current = images[activeIndex];
      if (current?.kind === "video_poster" && story.originalUrl) {
        window.open(story.originalUrl, "_blank", "noopener,noreferrer");
        return;
      }
      openLightbox(images, activeIndex, image, publicId, story.originalUrl);
    };
    if (!swipe.locked) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) openPicture();
      return;
    }
    const threshold = Math.max(44, Math.round(event.currentTarget.getBoundingClientRect().width * 0.12));
    if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) {
      openPicture();
      return;
    }
    mediaSuppressClickUntilRef.current.set(publicId, event.timeStamp + 400);
    const now = event.timeStamp;
    if (now < (mediaLockUntilRef.current.get(publicId) ?? 0)) return;
    mediaLockUntilRef.current.set(publicId, now + 400);
    navigateMedia(publicId, count, dx < 0 ? 1 : -1);
  };

  const cancelMediaPointer = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    mediaSwipeRef.current = null;
    event.currentTarget.classList.remove("swiping");
    const image = event.currentTarget.querySelector<HTMLImageElement>(".ph-main");
    if (image) image.style.transform = "";
  };

  const handleMediaWheel = (
    event: ReactWheelEvent<HTMLSpanElement>,
    publicId: string,
    count: number
  ): void => {
    if (count < 2 || event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    const now = event.timeStamp;
    const state = mediaWheelRef.current.get(publicId) ?? { accumulated: 0, lastAt: 0, flipped: false };
    if (now - state.lastAt > 100) {
      state.accumulated = 0;
      state.flipped = false;
    }
    state.lastAt = now;
    if (state.flipped || now < (mediaLockUntilRef.current.get(publicId) ?? 0)) {
      state.accumulated = 0;
      mediaWheelRef.current.set(publicId, state);
      return;
    }
    state.accumulated += event.deltaX;
    const threshold = Math.max(44, Math.round(event.currentTarget.getBoundingClientRect().width * 0.12));
    if (Math.abs(state.accumulated) >= threshold) {
      state.flipped = true;
      mediaLockUntilRef.current.set(publicId, now + 400);
      mediaSuppressClickUntilRef.current.set(publicId, now + 400);
      navigateMedia(publicId, count, state.accumulated > 0 ? 1 : -1);
      state.accumulated = 0;
    }
    mediaWheelRef.current.set(publicId, state);
  };

  const retryFeed = useCallback((): void => {
    pendingFeedRecoveryFocusRef.current = true;
    setLoadMoreFailed(false);
    setFeedState((current) => retainLoadedFeed(current, { status: "loading" }));
    setRequestVersion((version) => version + 1);
  }, []);

  const retryDetail = useCallback((publicId: string): void => {
    pendingDetailRecoveryFocusRef.current = publicId;
    detailRequestedRef.current.delete(publicId);
    setDetailRequestVersion((version) => version + 1);
  }, []);

  const scrollToTop = useCallback((): void => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const toggleViewMode = useCallback((mode: ViewMode): void => {
    setViewMode(mode);
    setHashParams({ mode: mode === "cards" ? "cards" : undefined });
  }, []);

  const loadMore = useCallback(async (): Promise<void> => {
    if (feedState.status !== "ready") return;
    const page = feedState.data.page;
    if (!page.hasMore || !page.nextCursor || loadingMore) return;
    const controller = new AbortController();
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = controller;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    pendingAppendFocusIndexRef.current ??= feedState.data.stories.length;
    try {
      const next = await fetchPublicFeed({
        contentType: contentTypeForCategory(activeCategory),
        cursor: page.nextCursor,
        signal: controller.signal,
        staticBundleId: feedState.data.staticBundleId
      });
      if (controller.signal.aborted) return;
      const appended = appendPublicFeedPage(feedState.data, next);
      if (!appended) {
        if (next.staticBundleId && next.staticBundleId !== feedState.data.staticBundleId) {
          reloadChangedStaticGeneration();
          return;
        }
        setLoadMoreFailed(true);
        return;
      }
      setFeedState((current) => current.status === "ready"
        ? { status: "ready", data: appended }
        : current);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (error instanceof PublicStaticGenerationChangedError && !controller.signal.aborted) {
        reloadChangedStaticGeneration();
        return;
      }
      if (!controller.signal.aborted) setLoadMoreFailed(true);
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }, [activeCategory, feedState, loadingMore, reloadChangedStaticGeneration]);

  const openLightbox = useCallback((images: ImageItem[], index: number, trigger: HTMLElement, publicId: string, originalUrl: string | null = null): void => {
    lightboxClosingRef.current = false;
    lastTriggerRef.current = { element: trigger, publicId };
    const rect = trigger.getBoundingClientRect();
    setLightbox({
      images,
      index,
      origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      originalUrl
    });
  }, []);

  const closeLightbox = useCallback((): void => {
    if (lightboxClosingRef.current) return;
    lightboxClosingRef.current = true;
    const container = lightboxRef.current;
    const img = lightboxImgRef.current;
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      pendingFocusReturnRef.current = lastTriggerRef.current;
      setLightbox(null);
    };
    if (!lightbox) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !container || !img || !lightbox.origin) {
      finish();
      return;
    }
    // 镜像开启动画:图片从全尺寸缩小回触发点,同时遮罩淡出,避免关闭时"闪一下"。
    // 必须 fill:"forwards"——否则动画结束瞬间元素会跳回全尺寸(闪现一帧)后才卸载。
    img.style.transformOrigin = "0 0"; // 缩放锚点与位移计算一致(左上角),否则缩往错误方向
    const targetRect = img.getBoundingClientRect();
    const scaleX = lightbox.origin.width && targetRect.width ? lightbox.origin.width / targetRect.width : 1;
    const scaleY = lightbox.origin.height && targetRect.height ? lightbox.origin.height / targetRect.height : 1;
    const scale = Math.min(scaleX, scaleY);
    const dx = lightbox.origin.left - targetRect.left;
    const dy = lightbox.origin.top - targetRect.top;
    try {
      container.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" });
      const anim = img.animate(
        [
          { transform: "translate(0,0) scale(1)" },
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }
        ],
        { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" }
      );
      anim.onfinish = finish;
      anim.oncancel = finish;
    } catch {
      finish();
    }
  }, [lightbox]);

  const navigateLightbox = useCallback((delta: number): void => {
    setLightbox((current) => {
      if (!current) return current;
      const count = current.images.length;
      if (count < 2) return current;
      const nextIndex = (current.index + delta + count) % count;
      return { ...current, index: nextIndex };
    });
  }, []);

  const handleLightboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeLightbox();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      navigateLightbox(1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigateLightbox(-1);
      return;
    }
    if (event.key === "Tab") {
      const focusables = Array.from(
        lightboxRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const focusIsInside = active instanceof HTMLElement && focusables.includes(active);
      if (event.shiftKey && (!focusIsInside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!focusIsInside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const handleLightboxBackgroundClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // 点击图片或背景任意处关闭(光标为 zoom-out);关闭/翻页按钮、以及刚发生的滑动翻页除外。
    if (swipedRef.current) {
      swipedRef.current = false;
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    closeLightbox();
  };

  const handleLightboxPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    swipedRef.current = false; // 新手势开始,清除上次滑动标记,避免误吞后续点击
    swipeStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleLightboxPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return; // 不是明显横向滑动
    swipedRef.current = true;
    const now = Date.now();
    if (now < lightboxLockUntilRef.current) return;
    lightboxLockUntilRef.current = now + 400;
    if (dx < 0) navigateLightbox(1); // 左滑 → 下一张
    else navigateLightbox(-1); // 右滑 → 上一张
  };

  const handleLightboxPointerCancel = (): void => {
    swipeStartRef.current = null;
  };

  const handleLightboxWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (!lightbox || lightbox.images.length < 2 || event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    const now = Date.now();
    const state = lightboxWheelRef.current;
    if (now - state.lastAt > 100) {
      state.accumulated = 0;
      state.flipped = false;
    }
    state.lastAt = now;
    if (state.flipped || now < lightboxLockUntilRef.current) {
      state.accumulated = 0;
      return;
    }
    state.accumulated += event.deltaX;
    if (Math.abs(state.accumulated) < 48) return;
    state.flipped = true;
    lightboxLockUntilRef.current = now + 400;
    swipedRef.current = true;
    navigateLightbox(state.accumulated > 0 ? 1 : -1);
    state.accumulated = 0;
  };

  const handleMainImageKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    images: ImageItem[],
    index: number,
    trigger: HTMLElement,
    publicId: string,
    originalUrl: string | null
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const current = images[index];
      if (current?.kind === "video_poster" && originalUrl) {
        window.open(originalUrl, "_blank", "noopener,noreferrer");
        return;
      }
      openLightbox(images, index, trigger, publicId, originalUrl);
    }
  };

  const handleStateAction = (state: DisplayState): void => {
    if (publicSearch.active && (state === "error" || state === "offline" || state === "empty")) {
      publicSearch.retry();
      return;
    }
    switch (state) {
      case "empty":
      case "offline":
      case "error":
      case "404":
        retryFeed();
        break;
      case "nomore":
        scrollToTop();
        break;
      case "partial":
        setLoadMoreFailed(false);
        void loadMore();
        break;
      default:
        break;
    }
  };

  const stories = useMemo(() => feedState.status === "ready" ? feedState.data.stories : [], [feedState]);
  const page = feedState.status === "ready" ? feedState.data.page : null;

  const trimmedQuery = query.trim().toLowerCase();
  const filteredStories = useMemo(() => {
    if (publicSearch.active) {
      const loaded = new Map(stories.map((story) => [story.publicId, story]));
      return publicSearch.items.map((item) => readingBundleId === (feedState.status === "ready" ? feedState.data.staticBundleId : undefined)
        ? loaded.get(item.publicId) ?? publicSearchCard(item) : publicSearchCard(item));
    }
    if (!trimmedQuery) return stories;
    return stories.filter((story) => {
      const localized = Object.values(story.localized).filter((value) => value !== null);
      return `${localized.map((value) => `${value.title} ${value.summary}`).join(" ")} ${story.sourceName} ${story.author} ${story.category} ${story.publishedAt}`
        .toLowerCase()
        .includes(trimmedQuery);
    });
  }, [stories, trimmedQuery, publicSearch.active, publicSearch.items, readingBundleId, feedState]);

  const canLoadMore = publicSearch.active ? publicSearch.hasMore : page?.hasMore === true && page.nextCursor !== null;
  const loadVisibleMore = (): void => { if (publicSearch.active) publicSearch.loadMore(); else void loadMore(); };
  const visibleLoadingMore = !publicSearch.active && loadingMore;

  let displayState: DisplayState;
  if (publicSearch.active) {
    displayState = publicSearch.status === "ready" ? "timeline" : publicSearch.status === "error" ? "error" : "loading";
  } else if (feedState.status === "loading") {
    displayState = "loading";
  } else if (!isOnline) {
    displayState = feedState.status === "ready" && stories.length > 0 ? "timeline" : "offline";
  } else if (feedState.status === "error") {
    displayState = "error";
  } else if (feedState.status === "not-found") {
    displayState = "404";
  } else if (stories.length === 0) {
    displayState = "empty";
  } else {
    displayState = "timeline";
  }

  const renderItem = (story: PublicStoryCardViewModel): ReactNode => {
    const clock = formatClock(story.publishedAtIso);
    const date = formatDate(story.publishedAtIso);
    const open = openId === story.publicId;
    const detail = detailStates[story.publicId];
    const images = story.images;
    const activeIndex = mediaHover[story.publicId] ?? mediaIndex[story.publicId] ?? 0;
    const mainImage = images[activeIndex] ?? null;
    const author = hasAuthor(story.author) && story.author.trim() !== story.sourceName.trim() ? story.author : null;
    const hasOriginalUrl = story.originalUrl !== null && story.originalUrl !== "";
    const imageFirst = isImageFirstCategory(story.category);
    const hasEnglishExtract = story.localized.en !== null;
    const requestedLanguage = languageByPublicId[story.publicId] ?? story.defaultLanguage;
    const selectedLanguage = requestedLanguage === "en" && hasEnglishExtract ? "en" : "zh-CN";
    const englishCopy = story.localized.en;
    const storyCopy = selectedLanguage === "en" && englishCopy
      ? englishCopy
      : (story.localized["zh-CN"] ?? { title: story.title, summary: story.summary, lead: story.summary, body: [], keyPoints: [] });
    const detailCopy = detail?.status === "ready"
      ? (selectedLanguage === "en"
          ? (detail.data.localized?.en ?? null)
          : (detail.data.localized?.["zh-CN"] ?? {
              title: detail.data.title,
              summary: detail.data.summary,
              lead: detail.data.lead,
              body: detail.data.body,
              keyPoints: detail.data.keyPoints
            }))
      : null;
    const originalLabel = sourceLinkLabel(selectedLanguage, story.platform);
    const isX = story.platform === "x";
    const xParagraphs = isX
      ? (storyCopy.body.length > 0 ? [...storyCopy.body] : (storyCopy.summary ? [storyCopy.summary] : []))
      : [];

    const media = mainImage ? (
            <span
              className={`tl-media${images.length > 1 ? " multi" : ""}`}
              data-cur={activeIndex}
              data-count={images.length}
              onPointerDown={(event) => handleMediaPointerDown(event, story.publicId)}
              onPointerMove={(event) => handleMediaPointerMove(event, story.publicId)}
              onPointerUp={(event) => finishMediaPointer(event, story, images, activeIndex)}
              onPointerCancel={cancelMediaPointer}
              onWheel={(event) => handleMediaWheel(event, story.publicId, images.length)}
            >
              <img
                className="ph-main"
                src={mainImage.src}
                alt={mainImage.alt}
                width={mainImage.width}
                height={mainImage.height}
                loading="lazy"
                decoding="async"
                draggable={false}
                referrerPolicy="no-referrer"
                tabIndex={0}
                role="button"
                aria-label="放大图片"
                data-lightbox-trigger="media"
                data-index={activeIndex}
                onClick={(event) => {
                  if (event.timeStamp < (mediaSuppressClickUntilRef.current.get(story.publicId) ?? 0)) return;
                  if (mainImage.kind === "video_poster" && story.originalUrl) {
                    window.open(story.originalUrl, "_blank", "noopener,noreferrer");
                    return;
                  }
                  openLightbox(images, activeIndex, event.currentTarget, story.publicId, story.originalUrl);
                }}
                onKeyDown={(event) => handleMainImageKeyDown(event, images, activeIndex, event.currentTarget, story.publicId, story.originalUrl)}
              />
              {mainImage.kind === "video_poster" ? <PlayBadge /> : null}
            </span>
          ) : null;

    return (
      <li
        className={`tl-item${open ? " is-open" : ""}`}
        data-id={story.publicId}
        data-kind={imageFirst ? "image-first" : "event"}
        key={story.publicId}
      >
        <div className="tl-time" aria-hidden="true">
          <span className="tl-t">{clock}</span>
          <span className="tl-d">{date}</span>
        </div>
        <div className="tl-entry">
          {imageFirst ? media : null}
          <TimelineTitle
            isX={isX}
            paragraphs={xParagraphs}
            summary={storyCopy?.summary ?? story.summary}
            title={storyCopy?.title ?? story.title}
            category={selectedLanguage === "en" ? categoryLabelEn(story.category) : story.category}
            open={isX ? fullTextByPublicId[story.publicId] === true : open}
            controlsId={isX ? undefined : story.publicId}
            onToggle={() => {
              if (isX) setFullTextByPublicId((current) => ({ ...current, [story.publicId]: !current[story.publicId] }));
              else toggleItem(story.publicId);
            }}
          />
          {imageFirst ? null : media}

          {isX ? null : (
          <div className={`tl-collapse${open ? " is-open" : ""}`}>
            <div className="tl-detail" id={`det-${story.publicId}`}>
              <div className="tl-zh-head">
                <span className="tl-zh-label">{editorialSectionLabel(selectedLanguage, {
                  lead: detailCopy?.lead ?? storyCopy?.summary ?? story.summary,
                  body: detailCopy?.body ?? [],
                  keyPoints: detailCopy?.keyPoints ?? []
                })}</span>
                <div className="public-language-toggle lang-pill" role="group" aria-label={selectedLanguage === "en" ? "Language" : "提炼语言"}>
                  <button
                    type="button"
                    className={`lang-pill-btn${selectedLanguage === "zh-CN" ? " is-active" : ""}`}
                    aria-pressed={selectedLanguage === "zh-CN"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setLanguageByPublicId((current) => ({ ...current, [story.publicId]: "zh-CN" }));
                    }}
                  >中</button>
                  <span className="lang-pill-sep" aria-hidden="true">/</span>
                    <button
                      type="button"
                      className={`lang-pill-btn${selectedLanguage === "en" ? " is-active" : ""}`}
                      aria-pressed={selectedLanguage === "en"}
                      disabled={!hasEnglishExtract}
                      onClick={(e) => {
                        e.stopPropagation();
                        setLanguageByPublicId((current) => ({ ...current, [story.publicId]: "en" }));
                      }}
                    >EN</button>
                </div>
              </div>
                  {detail?.status === "loading" ? (
                    <p className="tl-zh tl-zh-pending" aria-live="polite">正在读取深度要点…</p>
                  ) : detail?.status === "error" ? (
                    <p className="tl-zh tl-zh-error" role="alert">
                      提炼内容暂不可用。
                      <button
                        type="button"
                        className="tl-detail-retry"
                        onClick={() => retryDetail(story.publicId)}
                      >重试</button>
                    </p>
                  ) : detail?.status === "not-found" ? (
                    <p className="tl-zh tl-zh-error" role="alert">
                      这条内容已不可用（404）。
                      <button
                        type="button"
                        className="tl-detail-retry"
                        onClick={() => retryDetail(story.publicId)}
                      >重试</button>
                    </p>
                  ) : detail?.status === "ready" ? (
                    detailCopy && hasEditorialExtras(detailCopy.lead, detailCopy.body, detailCopy.keyPoints) ? (
                      <>
                        {detailCopy.keyPoints.length > 0 ? (
                          <ul className="tl-keypoints">
                            {detailCopy.keyPoints.map((point) => <li key={point}>{point}</li>)}
                          </ul>
                        ) : null}
                        {shouldShowExpandedLead(storyCopy?.summary ?? story.summary, detailCopy.lead)
                          ? <p className="tl-zh tl-detail-lead">{detailCopy.lead}</p>
                          : null}
                        {uniqueEditorialParagraphs(detailCopy.lead, detailCopy.body)
                          .map((paragraph) => <p className="tl-zh" key={paragraph}>{paragraph}</p>)}
                        {(storyCopy?.body ?? []).map((paragraph) => <p className="tl-zh" key={paragraph}>{paragraph}</p>)}
                      </>
                    ) : null
                  ) : null}
                  <p className="tl-detail-actions">
                    <a className="tl-detail-page-link" href={publicStoryHref(story.publicId)} onClick={(event) => event.stopPropagation()}>
                      {selectedLanguage === "en" ? "Open full extract page" : "打开站内详情"}
                    </a>
                  </p>
            </div>
          </div>
          )}

          <div className="tl-ev">
            <span className="evs">
              <span><b>{story.sourceName}</b></span>
              {author ? <span className="sep" aria-hidden="true">·</span> : null}
              {author ? <span><b>{author}</b></span> : null}
              <span className="sep" aria-hidden="true">·</span>
              <span><b>{date} {clock}</b></span>
            </span>
            <span className="ev-right">
              {hasOriginalUrl ? (
                <a
                  className="tl-original-link"
                  href={story.originalUrl ?? ""}
                  rel="noopener noreferrer"
                  target="_blank"
                  onClick={(event) => event.stopPropagation()}
                >{originalLabel}</a>
              ) : (
                <span className="tl-original-disabled">原文暂不可用</span>
              )}
              {isX ? (
                <a className="tl-original-link" href={publicStoryHref(story.publicId)} onClick={(event) => event.stopPropagation()}>
                  {selectedLanguage === "en" ? "Details" : "站内详情"}
                </a>
              ) : null}
              {story.relatedSources.map((source) => source.originalUrl ? (
                <a
                  key={source.publicId}
                  className="tl-original-link"
                  href={source.originalUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >{source.displayName} {selectedLanguage === "en" ? "source" : "原文"}</a>
              ) : null)}
              {images.length > 1 ? (
                <span className="ph-thumbs" aria-label="图片导航">
                  {images.map((image, index) => (
                    <button
                      key={`${story.publicId}-${index}`}
                      type="button"
                      className="ph-thumb-button"
                      data-index={index}
                      aria-label={`查看第 ${index + 1} 张图`}
                      aria-pressed={index === activeIndex}
                      aria-current={index === activeIndex ? "true" : undefined}
                      onClick={() => pinMedia(story.publicId, index)}
                      onMouseEnter={() => previewMedia(story.publicId, index)}
                      onMouseLeave={() => previewMedia(story.publicId, null)}
                    >
                      <img
                        className={`ph-thumb${index === activeIndex ? " is-active" : ""}`}
                        src={image.src}
                        alt=""
                        loading="lazy"
                      />
                    </button>
                  ))}
                </span>
              ) : null}
            </span>
          </div>
          <p className="tl-source-notice">{selectedLanguage === "en"
            ? "This site shows an original summary. The full piece is on the source site."
            : story.sourceNotice}</p>
        </div>
      </li>
    );
  };

  const renderLightbox = (): ReactNode => {
    if (!lightbox) return null;
    const { images, index } = lightbox;
    const hasMultiple = images.length > 1;
    return createPortal(
      <div
        className="lightbox"
        ref={lightboxRef}
        role="dialog"
        aria-modal="true"
        aria-label="图片放大预览"
        tabIndex={-1}
        onKeyDown={handleLightboxKeyDown}
        onClick={handleLightboxBackgroundClick}
        onPointerDown={handleLightboxPointerDown}
        onPointerUp={handleLightboxPointerUp}
        onPointerCancel={handleLightboxPointerCancel}
        onWheel={handleLightboxWheel}
      >
        <div className="lb-top">
          {hasMultiple ? <span className="lb-count" aria-live="polite">{index + 1} / {images.length}</span> : <span />}
          <button type="button" className="lb-close" aria-label="关闭图片预览" onClick={closeLightbox}>×</button>
        </div>
        {hasMultiple ? (
          <button type="button" className="lb-nav lb-prev" aria-label="上一张" onClick={() => navigateLightbox(-1)}>‹</button>
        ) : null}
        {hasMultiple ? (
          <button type="button" className="lb-nav lb-next" aria-label="下一张" onClick={() => navigateLightbox(1)}>›</button>
        ) : null}
        <span className="lb-frame">
          <img
            ref={lightboxImgRef}
            src={images[index]?.src ?? ""}
            alt={images[index]?.alt ?? ""}
            onClick={(event) => {
              event.stopPropagation();
              if (images[index]?.kind === "video_poster" && lightbox.originalUrl) {
                window.open(lightbox.originalUrl, "_blank", "noopener,noreferrer");
              }
            }}
          />
          {images[index]?.kind === "video_poster" ? <PlayBadge /> : null}
        </span>
        {hasMultiple ? (
          <span className="lb-count lb-count-desktop" aria-live="polite">{index + 1} / {images.length}</span>
        ) : null}
      </div>,
      document.body
    );
  };

  return (
    <main className={`app${openId ? " is-focusing" : ""}`} id="main-content" tabIndex={-1}>
      <div className="shell">
        <RaceStrip />
        <section className="timeline" aria-label="F1+1 信息时间线">
          {displayState === "loading" ? <TimelineSkeleton /> : null}

          {displayState !== "loading" && displayState !== "timeline" ? (
            <StateBox
              id="state-box"
              code={STATE_COPY[displayState].code}
              title={STATE_COPY[displayState].title}
              message={STATE_COPY[displayState].message}
              actionLabel={STATE_COPY[displayState].action}
              onAction={() => handleStateAction(displayState)}
              urgent={displayState === "error" || displayState === "404"}
            />
          ) : null}

          {displayState === "timeline" ? (
            <>
              {!isOnline ? (
                <StateBox
                  id="offline-box"
                  code={STATE_COPY.offline.code}
                  title={STATE_COPY.offline.title}
                  message={STATE_COPY.offline.message}
                  actionLabel={STATE_COPY.offline.action}
                  onAction={() => handleStateAction("offline")}
                />
              ) : null}

              {publicSearch.active && publicSearch.status === "ready" && filteredStories.length > 0 ? (
                <p className="timeline-kicker" role="status">找到 {publicSearch.total} 条公开资讯（含归档）</p>
              ) : null}
              {trimmedQuery && filteredStories.length === 0 ? (
                <p id="search-empty" className="search-empty" role="status">{publicSearch.active ? "全部公开资讯与归档中没有匹配的条目" : "没有匹配的条目"}</p>
              ) : null}

              {/* Card deck mode (mobile only) */}
              {isMobile && viewMode === "cards" && filteredStories.length > 0 ? (
                <CardDeck
                  stories={filteredStories}
                  onOpenLightbox={openLightbox}
                  onLoadMore={canLoadMore && !visibleLoadingMore ? loadVisibleMore : null}
                />
              ) : null}

              {/* Standard timeline mode (or desktop always) */}
              {(!isMobile || viewMode === "timeline") ? (
                <>
                  <ol
                    className={`tl${openId ? " is-focusing" : ""}`}
                    id="tl"
                    aria-label="公开资讯时间线"
                    aria-live="polite"
                    aria-busy={visibleLoadingMore}
                  >
                    {filteredStories.map((story) => renderItem(story))}
                  </ol>

                  {!(trimmedQuery && filteredStories.length === 0) ? (
                    <>
                      {!publicSearch.active && loadMoreFailed ? (
                        <StateBox
                          id="partial-box"
                          code={STATE_COPY.partial.code}
                          title={STATE_COPY.partial.title}
                          message={STATE_COPY.partial.message}
                          actionLabel={STATE_COPY.partial.action}
                          onAction={() => handleStateAction("partial")}
                        />
                      ) : canLoadMore ? (
                        <div className="load-more-wrap">
                          <button className="load-more" type="button" disabled={visibleLoadingMore} onClick={loadVisibleMore}>
                            {visibleLoadingMore ? "正在加载" : "加载更多"}
                          </button>
                        </div>
                      ) : !publicSearch.active && shouldShowEndOfFeed(stories.length, page?.hasMore === true) ? (
                        <StateBox
                          id="nomore-box"
                          code={STATE_COPY.nomore.code}
                          title={STATE_COPY.nomore.title}
                          message={STATE_COPY.nomore.message}
                          actionLabel={STATE_COPY.nomore.action}
                          onAction={() => handleStateAction("nomore")}
                        />
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </section>
      </div>

      <footer className="site-footer">
        <div className="fs">
          <span>F1+1 · F1 中文资讯时间线</span>
          <a href="/archive/">已归档</a>
        </div>
        <p>{IS_PUBLIC_STATIC_SITE ? "内容来自最近一次成功同步的公开资讯；聚合内容版权归原作者与来源所有。" : "内容通过公开 API 提供；聚合内容版权归原作者与来源所有。"}</p>
      </footer>

      {renderLightbox()}
    </main>
  );
}
