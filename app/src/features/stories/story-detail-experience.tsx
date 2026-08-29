"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { hasEditorialExtras, isDuplicateEditorialBody, isImageFirstCategory } from "./editorial";
import {
  fetchPublicStory,
  isPublicStoryNotFound,
  type PublicStoryDetailPageViewModel
} from "./public-api";

type DetailRequestState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "ready"; data: PublicStoryDetailPageViewModel };

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
  return Number.isNaN(time.getTime()) ? "--:--" : clockFormatter.format(time);
}

function formatDate(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "--" : dateFormatter.format(time);
}

function hasAuthor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "unknown" && normalized !== "未知";
}

function DetailFrame({ children }: { children: ReactNode }) {
  return (
    <main className="app timeline-detail-page" id="main-content" tabIndex={-1}>
      <div className="shell">
        <section className="timeline" aria-label="F1+1 公开内容详情">
          <Link className="detail-back-link" href="/">← 返回资讯流</Link>
          {children}
        </section>
      </div>
    </main>
  );
}

function DetailStateScreen({
  code,
  title,
  message,
  onRetry,
  urgent = false
}: {
  code: string;
  title: string;
  message: string;
  onRetry?: () => void;
  urgent?: boolean;
}) {
  return (
    <DetailFrame>
      <p className="timeline-kicker">F1 中文精选 · 公开详情</p>
      <div className="state-box" role={urgent ? "alert" : "status"} aria-label={title}>
        <span className="sb-code" aria-hidden="true">{code}</span>
        <h1 className="sb-title">{title}</h1>
        <p className="sb-msg">{message}</p>
        {onRetry ? (
          <button
            className={code === "404" ? "sb-action not-found-retry" : "sb-action detail-retry"}
            type="button"
            onClick={onRetry}
          >重试 →</button>
        ) : null}
      </div>
    </DetailFrame>
  );
}

export function StoryDetailExperience({ publicId }: { publicId: string }) {
  const [requestVersion, setRequestVersion] = useState(0);
  const [language, setLanguage] = useState<"zh-CN" | "en">("zh-CN");
  const [detailState, setDetailState] = useState<DetailRequestState>({ status: "loading" });
  const pendingRecoveryFocusRef = useRef(false);
  const mediaTriggerRef = useRef<HTMLButtonElement | null>(null);
  const lightboxCloseRef = useRef<HTMLButtonElement | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [fetchKey, setFetchKey] = useState<{ publicId: string; requestVersion: number }>({
    publicId,
    requestVersion: 0
  });
  if (fetchKey.publicId !== publicId || fetchKey.requestVersion !== requestVersion) {
    setFetchKey({ publicId, requestVersion });
    setDetailState({ status: "loading" });
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetchPublicStory({ publicId, signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setDetailState({ status: "ready", data });
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") return;
      if (controller.signal.aborted) return;
      setDetailState(isPublicStoryNotFound(error) ? { status: "not-found" } : { status: "error" });
    });
    return () => controller.abort();
  }, [publicId, requestVersion]);

  useEffect(() => {
    if (!pendingRecoveryFocusRef.current || detailState.status === "loading") return;
    pendingRecoveryFocusRef.current = false;
    queueMicrotask(() => {
      const failureAction = detailState.status === "not-found"
        ? document.querySelector<HTMLElement>(".not-found-retry")
        : detailState.status === "error"
          ? document.querySelector<HTMLElement>(".detail-retry")
          : null;
      (failureAction ?? document.getElementById("main-content"))?.focus({ preventScroll: true });
    });
  }, [detailState]);

  useEffect(() => {
    if (!mediaOpen) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMediaOpen(false);
    };
    document.body.classList.add("lb-open");
    document.addEventListener("keydown", closeOnEscape);
    queueMicrotask(() => lightboxCloseRef.current?.focus({ preventScroll: true }));
    return () => {
      document.body.classList.remove("lb-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mediaOpen]);

  const retry = (): void => {
    pendingRecoveryFocusRef.current = true;
    setRequestVersion((version) => version + 1);
  };

  const closeMedia = (): void => {
    setMediaOpen(false);
    queueMicrotask(() => mediaTriggerRef.current?.focus({ preventScroll: true }));
  };

  if (detailState.status === "loading") {
    return (
      <DetailStateScreen
        code="…"
        title="正在读取公开内容"
        message="页面正在读取详情与相关内容，请稍候。"
      />
    );
  }

  if (detailState.status === "not-found") {
    return (
      <DetailStateScreen
        code="404"
        title="这条公开内容不存在或当前不可用"
        message="链接可能已经失效，也可能尚未公开。"
        onRetry={retry}
        urgent
      />
    );
  }

  if (detailState.status === "error") {
    return (
      <DetailStateScreen
        code="!"
        title="公开内容暂时不可用"
        message="详情请求没有返回可用内容，可以稍后重试。"
        onRetry={retry}
        urgent
      />
    );
  }

  const { story, relatedStories } = detailState.data;
  const clock = formatClock(story.publishedAtIso);
  const date = formatDate(story.publishedAtIso);
  const author = hasAuthor(story.author) && story.author.trim() !== story.sourceName.trim() ? story.author : null;
  const mainImage = story.images[0] ?? null;
  const hasOriginalUrl = story.originalUrl !== null && story.originalUrl !== "";
  const imageFirst = isImageFirstCategory(story.category);
  const selectedLanguage = story.localized[language] ? language : "zh-CN";
  const copy = story.localized[selectedLanguage] ?? story.localized["zh-CN"];
  const originalLabel = selectedLanguage === "en" ? "View source" : imageFirst ? "查看原帖" : "查看原文";

  return (
    <DetailFrame>
      <p className="timeline-kicker">F1 中英提炼 · 公开详情</p>
      <ol className="tl detail-timeline">
        <li className="tl-item is-open" data-kind={imageFirst ? "image-first" : "event"}>
          <div className="tl-time" aria-hidden="true">
            <span className="tl-t">{clock}</span>
            <span className="tl-d">{date}</span>
          </div>
          <article className="tl-entry" aria-labelledby="story-title">
            {imageFirst && mainImage ? (
              <button
                className="timeline-detail-media"
                type="button"
                ref={mediaTriggerRef}
                aria-label="放大图片"
                onClick={() => setMediaOpen(true)}
              >
                <img
                  className="ph-main"
                  src={mainImage.src}
                  alt={mainImage.alt}
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  referrerPolicy="no-referrer"
                />
              </button>
            ) : null}
            <header className="timeline-detail-summary">
              <span className="tl-head">
                <span className="tl-cat">{story.category}</span>
              </span>
              <h1 className="tl-title" id="story-title">{copy?.title ?? story.title}</h1>
              <p className="tl-lead">{copy?.lead ?? story.lead}</p>
            </header>

            {story.state === "restricted" ? (
              <p className="timeline-detail-notice" role="status">来源受限，仅显示可以公开的摘要与元数据。</p>
            ) : null}

            {!imageFirst && mainImage ? (
              <button
                className="timeline-detail-media"
                type="button"
                ref={mediaTriggerRef}
                aria-label="放大图片"
                onClick={() => setMediaOpen(true)}
              >
                <img
                  className="ph-main"
                  src={mainImage.src}
                  alt={mainImage.alt}
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  referrerPolicy="no-referrer"
                />
              </button>
            ) : null}

            {copy && hasEditorialExtras(copy.lead, copy.body, copy.keyPoints) ? (
              <section className="tl-detail timeline-detail-body" aria-labelledby="detail-summary-title">
                <div className="tl-zh-head">
                  <h2 className="tl-zh-label" id="detail-summary-title">{selectedLanguage === "en" ? "English extract" : "中文提炼"}</h2>
                  <div className="public-language-toggle lang-pill" role="group" aria-label="提炼语言">
                    <button
                      type="button"
                      className={`lang-pill-btn${selectedLanguage === "zh-CN" ? " is-active" : ""}`}
                      aria-pressed={selectedLanguage === "zh-CN"}
                      onClick={() => setLanguage("zh-CN")}
                    >中</button>
                    <span className="lang-pill-sep" aria-hidden="true">/</span>
                    <button
                      type="button"
                      className={`lang-pill-btn${selectedLanguage === "en" ? " is-active" : ""}`}
                      aria-pressed={selectedLanguage === "en"}
                      disabled={story.localized.en === null}
                      onClick={() => setLanguage("en")}
                    >EN</button>
                  </div>
                </div>
                {!isDuplicateEditorialBody(copy.lead, copy.body)
                  ? copy.body.map((paragraph) => <p className="tl-zh" key={paragraph}>{paragraph}</p>)
                  : null}
                {copy.keyPoints.length > 0 ? (
                  <ul className="tl-keypoints">
                    {copy.keyPoints.map((point) => <li key={point}>{point}</li>)}
                  </ul>
                ) : null}
              </section>
            ) : null}

            <div className="tl-ev">
              <span className="evs">
                <span><b>{story.sourceName}</b></span>
                {author ? <span className="sep" aria-hidden="true">·</span> : null}
                {author ? <span><b>{author}</b></span> : null}
                <span className="sep" aria-hidden="true">·</span>
                <span><b>{date} {clock}</b></span>
              </span>
              {hasOriginalUrl ? (
                <a
                  className="tl-original-link"
                  href={story.originalUrl ?? ""}
                  rel="noopener noreferrer"
                  target="_blank"
                >{originalLabel}</a>
              ) : (
                <span className="tl-original-disabled">原文暂不可用</span>
              )}
              {story.relatedSources.map((source) => source.originalUrl ? (
                <a
                  key={source.publicId}
                  className="tl-original-link"
                  href={source.originalUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >{source.displayName} {selectedLanguage === "en" ? "source" : "原文"}</a>
              ) : null)}
            </div>
            <p className="tl-source-notice">{story.sourceNotice}</p>

            {relatedStories.length > 0 ? (
              <nav className="timeline-detail-related" aria-labelledby="related-title">
                <h2 className="tl-zh-label" id="related-title">相关内容</h2>
                <ul>
                  {relatedStories.map((related) => (
                    <li key={related.publicId}>
                      <Link href={`/stories/${related.publicId}`}>
                        <span>{related.category}</span>
                        <strong>{related.localized[selectedLanguage]?.title ?? related.localized["zh-CN"]?.title ?? related.title}</strong>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </article>
        </li>
      </ol>

      {mediaOpen && mainImage ? createPortal(
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="图片放大预览"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeMedia();
          }}
        >
          <button ref={lightboxCloseRef} type="button" className="lb-close" aria-label="关闭图片预览" onClick={closeMedia}>×</button>
          <img src={mainImage.src} alt={mainImage.alt} referrerPolicy="no-referrer" />
        </div>,
        document.body
      ) : null}
    </DetailFrame>
  );
}
