export const RSS_AUTO_PIPELINE_SOURCE_IDS = ["motorsport-f1-news", "the-race-f1-news", "skysports-f1-news"] as const;
export type AutoPipelineSourceId = (typeof RSS_AUTO_PIPELINE_SOURCE_IDS)[number];

const AUTO_PIPELINE_SOURCE_ID_SET: ReadonlySet<string> = new Set(RSS_AUTO_PIPELINE_SOURCE_IDS);
const AUTOMATIC_REVIEW_STATES = new Set(["pending_review", "source_updated"]);
const DEFAULT_AUTOMATIC_REVIEW_LIMIT = 100;

export type AutomaticReviewTarget = Readonly<{
  candidateId: string;
  sourceId: string;
  reviewState: string;
}>;

export type RecentApprovedPublishCandidate = Readonly<{
  candidateId: string;
  sourceId: string;
  reviewState: string;
  firstSeenAt: string;
  approvedAt?: string;
  allowedActions?: readonly string[];
}>;

export function isAutoPipelineSource(sourceId: string): boolean {
  return AUTO_PIPELINE_SOURCE_ID_SET.has(sourceId);
}

function isAtOrAfterCutoff(iso: string, cutoffIso: string): boolean {
  const value = Date.parse(iso);
  const cutoff = Date.parse(cutoffIso);
  return Number.isFinite(value) && Number.isFinite(cutoff) && value >= cutoff;
}

export function selectAutomaticReviewTargets<T extends AutomaticReviewTarget>(
  items: readonly T[],
  options?: { limit?: number },
): T[] {
  const requested = options?.limit ?? DEFAULT_AUTOMATIC_REVIEW_LIMIT;
  const limit = Number.isSafeInteger(requested) ? Math.max(0, requested) : 0;
  const selected: T[] = [];
  for (const item of items) {
    if (selected.length >= limit) break;
    if (!AUTOMATIC_REVIEW_STATES.has(item.reviewState)) continue;
    if (!isAutoPipelineSource(item.sourceId)) continue;
    selected.push(item);
  }
  return selected;
}

export function selectRecentApprovedForPublish<T extends RecentApprovedPublishCandidate>(
  details: readonly T[],
  cutoffIso: string,
): T[] {
  return details.filter((item) => {
    if (item.reviewState !== "approved_waiting_publish") return false;
    if (!isAutoPipelineSource(item.sourceId)) return false;
    if (!isAtOrAfterCutoff(item.firstSeenAt, cutoffIso)) return false;
    if (item.approvedAt !== undefined && !isAtOrAfterCutoff(item.approvedAt, cutoffIso)) return false;
    if (item.allowedActions !== undefined && !item.allowedActions.includes("publish")) return false;
    return true;
  });
}
