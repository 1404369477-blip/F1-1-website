import type { StoryCategory } from "./public-api";

export function isImageFirstCategory(category: StoryCategory): boolean {
  return category === "车手社交" || category === "名宿历史" || category === "赛场趣事";
}

export function isDuplicateEditorialBody(lead: string, body: readonly string[]): boolean {
  if (body.length !== 1) return false;
  return body[0]?.trim() === lead.trim();
}

export function hasEditorialExtras(lead: string, body: readonly string[], keyPoints: readonly string[]): boolean {
  return keyPoints.length > 0 || !isDuplicateEditorialBody(lead, body);
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
