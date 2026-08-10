import Link from "next/link";

import type { PublicStoryCardViewModel, StoryCategory } from "../../features/stories/public-api";

type BadgeKind = "available" | "restricted" | "missing";

const badgeDetails: Record<BadgeKind, { icon: string; label: string }> = {
  available: { icon: "◎", label: "公开演示" },
  restricted: { icon: "▣", label: "来源受限" },
  missing: { icon: "◇", label: "无授权图片" }
};

const platformLabels: Record<PublicStoryCardViewModel["platform"], string> = {
  x: "X",
  instagram: "Instagram",
  reddit: "Reddit",
  website: "网站",
  rss: "RSS"
};

function badgeKindForStory(story: PublicStoryCardViewModel): BadgeKind {
  if (story.state === "restricted") return "restricted";
  if (story.state === "media-missing") return "missing";
  return "available";
}

export function F1StatusBadge({ story }: { story: PublicStoryCardViewModel }) {
  const kind = badgeKindForStory(story);
  const detail = badgeDetails[kind];
  return (
    <span className={`status-badge status-badge--${kind}`}>
      <span aria-hidden="true">{detail.icon}</span>
      <span>{detail.label}</span>
    </span>
  );
}

export function F1SourceMeta({ story }: { story: PublicStoryCardViewModel }) {
  return (
    <p className="story-source-meta" aria-label="来源元数据">
      <span>{story.sourceName}</span>
      <span className="source-meta-separator" aria-hidden="true">·</span>
      <span>{platformLabels[story.platform]}</span>
      <span className="source-meta-separator" aria-hidden="true">·</span>
      <span>{story.author}</span>
      <span className="source-meta-separator" aria-hidden="true">·</span>
      <span>{story.publishedAt}</span>
    </p>
  );
}

export function F1DetailBreadcrumb({ category }: { category: StoryCategory }) {
  return (
    <nav className="breadcrumb" aria-label="面包屑">
      <Link className="breadcrumb-back" href="/">资讯流</Link>
      <span aria-hidden="true">/</span>
      <span>{category}</span>
      <span aria-hidden="true">/</span>
      <span aria-current="page">公开内容详情</span>
    </nav>
  );
}

export function SyntheticStoryMedia({ story, detail = false }: { story: PublicStoryCardViewModel; detail?: boolean }) {
  if (story.state === "media-missing") {
    return (
      <div className={`story-media story-media--missing${detail ? " story-detail-media" : ""}`} role="img" aria-label={story.mediaDescription}>
        <div className="media-missing-content">
          <span className="media-missing-mark" aria-hidden="true">◇</span>
          <strong>无授权图片</strong>
          <span>公开内容使用中性占位</span>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`story-media story-media--${story.mediaTone}${detail ? " story-detail-media" : ""}`}
      role="img"
      aria-label={story.mediaDescription}
    >
      <span className="media-demo-mark">{story.mediaLabel}</span>
    </div>
  );
}

export function DisabledOriginalEntry({ story, entryId }: { story: PublicStoryCardViewModel; entryId: string }) {
  const descriptionId = `public-original-entry-note-${entryId}`;
  const restricted = story.originalReason === "source_restricted";
  return (
    <div className="original-entry">
      <button className="disabled-original" type="button" disabled aria-describedby={descriptionId}>
        ↗ {restricted ? "原文入口因来源受限而关闭" : "原文入口待真实内容接入"}
      </button>
      <p id={descriptionId} className="original-entry-note">
        {restricted ? "公开 DTO 只提供安全摘要，不会访问受限来源。" : "公开 synthetic DTO 没有原文 URL，不会发起外部请求。"}
      </p>
    </div>
  );
}

export function F1StoryCard({
  story,
  featured = false,
  heading = "h2"
}: {
  story: PublicStoryCardViewModel;
  featured?: boolean;
  heading?: "h2" | "h3";
}) {
  const Heading = heading;
  return (
    <article className={`story-card${featured ? " story-card--featured" : ""}`} data-public-story={story.publicId}>
      <SyntheticStoryMedia story={story} />
      <div className="story-card-content">
        <div className="story-topline">
          <span className="story-category">{story.category}</span>
          <F1StatusBadge story={story} />
        </div>
        <Heading className="story-title">
          <Link className="story-title-link" href={`/stories/${story.publicId}`}>{story.title}</Link>
        </Heading>
        <p className="story-summary">{story.summary}</p>
        <F1SourceMeta story={story} />
        <DisabledOriginalEntry story={story} entryId={`card-${story.publicId}`} />
      </div>
    </article>
  );
}

export function F1StoryNotFoundState({ onRetry }: { onRetry?: () => void }) {
  return (
    <section className="not-found-content" aria-labelledby="not-found-title">
      <p className="eyebrow">PUBLIC API · 404</p>
      <h1 id="not-found-title">这条公开内容不存在或当前不可用</h1>
      <p>公开 API 没有返回可展示的内容。页面没有查询其他来源，也没有静态内容回退。</p>
      {onRetry ? <button className="not-found-retry" type="button" onClick={onRetry}>重试当前地址 →</button> : null}
      <Link href="/">返回资讯流</Link>
    </section>
  );
}
