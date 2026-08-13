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
  isPublicStoryNotFound,
  type PublicFeedViewModel,
  type PublicStoryCardViewModel,
  type PublicStoryDetailViewModel,
  type PublicStoryImage,
  type StoryCategory
} from "./public-api";
import { readHashParam, setHashParams } from "./hash-params";
import { getTimelineSearchQuery, setTimelineSearchQuery, subscribeTimelineSearch } from "./timeline-search";

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
  const currentIds = new Set(current.stories.map((story) => story.publicId));
  const nextIds = new Set(next.stories.map((story) => story.publicId));
  if (currentIds.size !== current.stories.length || nextIds.size !== next.stories.length) return null;
  if (next.stories.some((story) => currentIds.has(story.publicId))) return null;
  if (
    next.page.hasMore && next.page.nextCursor && current.page.nextCursor &&
    next.page.nextCursor.cursorAt === current.page.nextCursor.cursorAt &&
    next.page.nextCursor.cursorId === current.page.nextCursor.cursorId
  ) return null;
  return { stories: [...current.stories, ...next.stories], page: next.page };
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
        setFeedState({ status: "ready", data });
        const openParam = readHashParam("open");
        if (openParam && data.stories.some((story) => story.publicId === openParam)) {
          setOpenId(openParam);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setFeedState((current) => retainLoadedFeed(current, {
            status: error instanceof PublicApiClientError && error.status === 404 ? "not-found" : "error"
          }));
        }
      });
    return () => controller.abort();
  }, [activeCategory, requestVersion]);

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
    void fetchPublicStory({ publicId: openId, signal: controller.signal })
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
        if (isPublicStoryNotFound(error)) {
          setDetailStates((current) => ({ ...current, [openId]: { status: "not-found" } }));
          return;
        }
        detailRequestedRef.current.delete(openId);
        setDetailStates((current) => ({ ...current, [openId]: { status: "error" } }));
      });
    return () => controller.abort();
  }, [detailRequestVersion, openId]);

  useEffect(() => {
    if (!openId) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const runScroll = (): void => {
      // 滚动到该条目的整体(而非展开详情),保证标题与展开内容都可见(demo 同款行为)。
      const target = Array.from(document.querySelectorAll<HTMLElement>(".tl-item"))
        .find((item) => item.dataset.id === openId);
      target?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    };
    if (reducedMotion) {
      runScroll();
      return;
    }
    const timer = window.setTimeout(runScroll, 260);
    return () => window.clearTimeout(timer);
  }, [detailStates, openId]);

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
    if (!swipe || swipe.id !== publicId || swipe.pointerId !== event.pointerId) return;
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
    publicId: string,
    count: number
  ): void => {
    const swipe = mediaSwipeRef.current;
    mediaSwipeRef.current = null;
    const image = event.currentTarget.querySelector<HTMLImageElement>(".ph-main");
    event.currentTarget.classList.remove("swiping");
    if (image) image.style.transform = "";
    if (!swipe || swipe.id !== publicId || !swipe.locked) return;
    const dx = swipe.dx || event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    const threshold = Math.max(44, Math.round(event.currentTarget.getBoundingClientRect().width * 0.12));
    mediaSuppressClickUntilRef.current.set(publicId, event.timeStamp + 400);
    if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return;
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
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      const appended = appendPublicFeedPage(feedState.data, next);
      if (!appended) {
        setLoadMoreFailed(true);
        return;
      }
      setFeedState((current) => current.status === "ready"
        ? { status: "ready", data: appended }
        : current);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (!controller.signal.aborted) setLoadMoreFailed(true);
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }, [activeCategory, feedState, loadingMore]);

  const openLightbox = useCallback((images: ImageItem[], index: number, trigger: HTMLElement, publicId: string): void => {
    lightboxClosingRef.current = false;
    lastTriggerRef.current = { element: trigger, publicId };
    const rect = trigger.getBoundingClientRect();
    setLightbox({
      images,
      index,
      origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
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
    publicId: string
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openLightbox(images, index, trigger, publicId);
    }
  };

  const handleStateAction = (state: DisplayState): void => {
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
    if (!trimmedQuery) return stories;
    return stories.filter((story) =>
      `${story.title} ${story.summary} ${story.sourceName} ${story.author} ${story.category} ${story.publishedAt}`
        .toLowerCase()
        .includes(trimmedQuery)
    );
  }, [stories, trimmedQuery]);

  let displayState: DisplayState;
  if (feedState.status === "loading") {
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

    return (
      <li className={`tl-item${open ? " is-open" : ""}`} data-id={story.publicId} key={story.publicId}>
        <div className="tl-time" aria-hidden="true">
          <span className="tl-t">{clock}</span>
          <span className="tl-d">{date}</span>
        </div>
        <div className="tl-entry">
          <button
            type="button"
            className={`tl-summary-btn${open ? " is-open" : ""}`}
            aria-expanded={open}
            aria-controls={`det-${story.publicId}`}
            onClick={() => toggleItem(story.publicId)}
          >
            <span className="tl-head">
              <span className="tl-cat">{story.category}</span>
              <span className="tl-caret" aria-hidden="true" />
            </span>
            <span className="tl-title">{story.title}</span>
            <span className="tl-lead">{story.summary}</span>
          </button>

          {mainImage ? (
            <span
              className={`tl-media${images.length > 1 ? " multi" : ""}`}
              data-cur={activeIndex}
              data-count={images.length}
              onPointerDown={(event) => handleMediaPointerDown(event, story.publicId)}
              onPointerMove={(event) => handleMediaPointerMove(event, story.publicId)}
              onPointerUp={(event) => finishMediaPointer(event, story.publicId, images.length)}
              onPointerCancel={cancelMediaPointer}
              onWheel={(event) => handleMediaWheel(event, story.publicId, images.length)}
            >
              <img
                className="ph-main"
                src={mainImage.src}
                alt={mainImage.alt}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                tabIndex={0}
                role="button"
                aria-label="放大图片"
                data-lightbox-trigger="media"
                data-index={activeIndex}
                onClick={(event) => {
                  if (event.timeStamp < (mediaSuppressClickUntilRef.current.get(story.publicId) ?? 0)) return;
                  openLightbox(images, activeIndex, event.currentTarget, story.publicId);
                }}
                onKeyDown={(event) => handleMainImageKeyDown(event, images, activeIndex, event.currentTarget, story.publicId)}
              />
            </span>
          ) : null}

          <div className={`tl-collapse${open ? " is-open" : ""}`}>
            <div className="tl-detail" id={`det-${story.publicId}`}>
              <span className="tl-zh-label">中文提炼</span>
              {detail?.status === "loading" ? (
                <p className="tl-zh tl-zh-pending" aria-live="polite">正在读取提炼内容…</p>
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
                <>
                  {detail.data.body.map((paragraph) => <p className="tl-zh" key={paragraph}>{paragraph}</p>)}
                  {detail.data.keyPoints.length > 0 ? (
                    <ul className="tl-keypoints">
                      {detail.data.keyPoints.map((point) => <li key={point}>{point}</li>)}
                    </ul>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

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
                >前往原文 ↗</a>
              ) : (
                <span className="tl-original-disabled">原文暂不可用</span>
              )}
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
        <button type="button" className="lb-close" aria-label="关闭图片预览" onClick={closeLightbox}>×</button>
        {hasMultiple ? (
          <button type="button" className="lb-nav lb-prev" aria-label="上一张" onClick={() => navigateLightbox(-1)}>‹</button>
        ) : null}
        {hasMultiple ? (
          <button type="button" className="lb-nav lb-next" aria-label="下一张" onClick={() => navigateLightbox(1)}>›</button>
        ) : null}
        <img ref={lightboxImgRef} src={images[index]?.src ?? ""} alt={images[index]?.alt ?? ""} />
        {hasMultiple ? (
          <span className="lb-count" aria-live="polite">{index + 1} / {images.length}</span>
        ) : null}
      </div>,
      document.body
    );
  };

  return (
    <main className="app" id="main-content" tabIndex={-1}>
      <div className="shell">
        <section className="timeline" aria-label="F1+1 信息时间线">
          <p className="timeline-kicker">信息 + 时间 + 时间线 · {formatVisibleStoryCount(stories.length)} · 倒序</p>

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

              {trimmedQuery && filteredStories.length === 0 ? (
                <p id="search-empty" className="search-empty" role="status">没有匹配的条目</p>
              ) : null}

              <ol
                className={`tl${openId ? " is-focusing" : ""}`}
                id="tl"
                aria-label="公开资讯时间线"
                aria-live="polite"
                aria-busy={loadingMore}
              >
                {filteredStories.map((story) => renderItem(story))}
              </ol>

              {!(trimmedQuery && filteredStories.length === 0) ? (
                <>
                  {loadMoreFailed ? (
                    <StateBox
                      id="partial-box"
                      code={STATE_COPY.partial.code}
                      title={STATE_COPY.partial.title}
                      message={STATE_COPY.partial.message}
                      actionLabel={STATE_COPY.partial.action}
                      onAction={() => handleStateAction("partial")}
                    />
                  ) : page?.hasMore && page.nextCursor ? (
                    <div className="load-more-wrap">
                      <button className="load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
                        {loadingMore ? "正在加载" : "加载更多"}
                      </button>
                    </div>
                  ) : (
                    <StateBox
                      id="nomore-box"
                      code={STATE_COPY.nomore.code}
                      title={STATE_COPY.nomore.title}
                      message={STATE_COPY.nomore.message}
                      actionLabel={STATE_COPY.nomore.action}
                      onAction={() => handleStateAction("nomore")}
                    />
                  )}
                </>
              ) : null}
            </>
          ) : null}
        </section>
      </div>

      <footer className="site-footer">
        <div className="fs">
          <span>F1+1 · F1 中文资讯时间线</span>
        </div>
        <p>内容通过公开 API 提供；聚合内容版权归原作者与来源所有。</p>
      </footer>

      {renderLightbox()}
    </main>
  );
}
