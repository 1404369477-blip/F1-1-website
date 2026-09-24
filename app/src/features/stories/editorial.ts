import type { StoryCategory } from "./public-api";

export function isImageFirstCategory(category: StoryCategory): boolean {
  return category === "车手社交" || category === "名宿历史" || category === "赛场趣事";
}

export function isSameEditorialText(left: string, right: string): boolean {
  return left.trim() === right.trim();
}

export function isDuplicateEditorialBody(lead: string, body: readonly string[]): boolean {
  if (body.length === 0) return true;
  if (body.length !== 1) return false;
  return isSameEditorialText(body[0] ?? "", lead);
}

export function hasEditorialExtras(lead: string, body: readonly string[], keyPoints: readonly string[]): boolean {
  return keyPoints.length > 0 || !isDuplicateEditorialBody(lead, body);
}

/** Expanded lead is redundant when the closed card already shows the same paragraph. */
export function shouldShowExpandedLead(visibleSummary: string, expandedLead: string): boolean {
  return expandedLead.trim().length > 0 && !isSameEditorialText(visibleSummary, expandedLead);
}

export function uniqueEditorialParagraphs(lead: string, body: readonly string[]): string[] {
  if (isDuplicateEditorialBody(lead, body)) return [];
  return body.filter((paragraph) => !isSameEditorialText(paragraph, lead));
}

export function editorialSectionLabel(
  language: "zh-CN" | "en",
  extras: Readonly<{ lead: string; body: readonly string[]; keyPoints: readonly string[] }>
): string {
  const uniqueBody = uniqueEditorialParagraphs(extras.lead, extras.body);
  if (uniqueBody.length === 0 && extras.keyPoints.length > 0) {
    return language === "en" ? "Key points" : "内容要点";
  }
  return language === "en" ? "English extract" : "中文提炼";
}

export function originalArticleCta(language: "zh-CN" | "en", sourceName: string): string {
  return language === "en" ? `Read the full article on ${sourceName}` : `在 ${sourceName} 阅读完整原文`;
}

export function originalArticleNote(language: "zh-CN" | "en"): string {
  return language === "en"
    ? "This page is an original extract with key points, not a republication of the source."
    : "本页只展示中文提炼与要点，不转载信源全文。";
}

export function formatTimelineKicker(count: number): string {
  if (count <= 0) return "F1 中文精选";
  if (count === 1) return "F1 中文精选 · 1 条";
  return `F1 中文精选 · ${count} 条`;
}

export function shouldShowEndOfFeed(storyCount: number, hasMore: boolean): boolean {
  return hasMore === false && storyCount >= 12;
}

export function formatCardKicker(count: number, index: number): string {
  return `${index + 1} / ${count}`;
}
