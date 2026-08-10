"use client";

import { useEffect, useState } from "react";

import {
  DisabledOriginalEntry,
  F1DetailBreadcrumb,
  F1SourceMeta,
  F1StatusBadge,
  F1StoryCard,
  F1StoryNotFoundState,
  SyntheticStoryMedia
} from "../../components/f1/story-parts";
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

export function StoryDetailExperience({ publicId }: { publicId: string }) {
  const [requestVersion, setRequestVersion] = useState(0);
  const [detailState, setDetailState] = useState<DetailRequestState>({ status: "loading" });
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

  if (detailState.status === "loading") {
    return (
      <main className="page-content story-page" id="main-content" tabIndex={-1}>
        <section className="empty-state" aria-labelledby="detail-loading-title" aria-live="polite">
          <h1 id="detail-loading-title">正在读取公开内容</h1>
          <p>页面正在通过同源 API 获取详情和相关内容，请稍候。</p>
        </section>
      </main>
    );
  }

  if (detailState.status === "not-found") {
    return (
      <main className="page-content" id="main-content" tabIndex={-1}>
        <F1StoryNotFoundState onRetry={() => setRequestVersion((version) => version + 1)} />
      </main>
    );
  }

  if (detailState.status === "error") {
    return (
      <main className="page-content story-page" id="main-content" tabIndex={-1}>
        <section className="empty-state" aria-labelledby="detail-error-title" role="alert">
          <h1 id="detail-error-title">公开内容暂时不可用</h1>
          <p>详情请求没有返回可用内容。页面没有回退到静态演示数据，可以稍后重试。</p>
          <button className="filter-clear" type="button" onClick={() => setRequestVersion((version) => version + 1)}>重试</button>
        </section>
      </main>
    );
  }

  const { story, relatedStories } = detailState.data;
  return (
    <main className="page-content story-page" id="main-content" tabIndex={-1}>
      <F1DetailBreadcrumb category={story.category} />

      <article aria-labelledby="story-title">
        <header className="story-header">
          <p className="eyebrow">{story.category} · PUBLIC API</p>
          <F1StatusBadge story={story} />
          <h1 id="story-title">{story.title}</h1>
          <p className="story-lead">{story.lead}</p>
          <F1SourceMeta story={story} />
        </header>

        {story.state === "restricted" ? (
          <p className="detail-notice" role="status">▣ 来源受限：页面只显示公开 DTO 中的安全摘要与元数据；原文入口关闭，不会访问来源平台。</p>
        ) : null}

        <SyntheticStoryMedia story={story} detail />

        <div className="detail-layout">
          <div className="article-body">
            <h2>中文摘要</h2>
            {story.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            <section className="key-facts" aria-labelledby="key-facts-title">
              <h2 id="key-facts-title">关键点</h2>
              <ul>{story.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>
            </section>
          </div>
          <aside className="source-evidence" aria-labelledby="source-evidence-title">
            <p className="section-kicker">SOURCE EVIDENCE</p>
            <h2 id="source-evidence-title">来源与原文状态</h2>
            <p>来源名称：{story.sourceName}</p>
            <p>作者：{story.author}</p>
            <p>发布时间：{story.publishedAt}</p>
            <DisabledOriginalEntry story={story} entryId={`detail-${story.publicId}`} />
          </aside>
        </div>
      </article>

      <section className="related-section" aria-labelledby="related-title">
        <p className="section-kicker">RELATED PUBLIC ITEMS</p>
        <h2 id="related-title">相关内容</h2>
        {relatedStories.length > 0 ? (
          <ul className="related-list">
            {relatedStories.map((related) => <li key={related.publicId}><F1StoryCard story={related} heading="h3" /></li>)}
          </ul>
        ) : <p className="section-description">当前公开 API 没有返回相关内容。</p>}
      </section>
    </main>
  );
}
