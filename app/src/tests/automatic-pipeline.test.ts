import { describe, expect, it } from "vitest";

import {
  isAutoPipelineSource,
  RSS_AUTO_PIPELINE_SOURCE_IDS,
  selectAutomaticReviewTargets,
  selectRecentApprovedForPublish
} from "../server/review-real/automatic-pipeline.ts";

const TODAY = "2026-09-01T08:00:00.000Z";
const CUTOFF = "2026-09-01T00:00:00.000Z";
const HISTORICAL = "2026-08-14T01:00:00.000Z";

function reviewItem(
  candidateId: string,
  sourceId: string,
  reviewState: string
) {
  return { candidateId, sourceId, reviewState };
}

function approvedItem(
  candidateId: string,
  sourceId: string,
  firstSeenAt: string,
  extras: { approvedAt?: string; allowedActions?: readonly string[]; reviewState?: string } = {}
) {
  return {
    candidateId,
    sourceId,
    reviewState: extras.reviewState ?? "approved_waiting_publish",
    firstSeenAt,
    ...extras
  };
}

describe("automatic pipeline source allowlist", () => {
  it("allows Motorsport, The Race, and Sky Sports; excludes Autosport/RaceFans", () => {
    expect(RSS_AUTO_PIPELINE_SOURCE_IDS).toEqual(["motorsport-f1-news", "the-race-f1-news", "skysports-f1-news"]);
    expect(isAutoPipelineSource("motorsport-f1-news")).toBe(true);
    expect(isAutoPipelineSource("the-race-f1-news")).toBe(true);
    expect(isAutoPipelineSource("skysports-f1-news")).toBe(true);
    expect(isAutoPipelineSource("autosport-f1-news")).toBe(false);
    expect(isAutoPipelineSource("racefans-f1-news")).toBe(false);
  });
});

describe("selectAutomaticReviewTargets", () => {
  it("includes today's Motorsport pending and The Race source_updated, and excludes Autosport/RaceFans", () => {
    const selected = selectAutomaticReviewTargets([
      reviewItem("rss-autosport-pending", "autosport-f1-news", "pending_review"),
      reviewItem("rss-racefans-pending", "racefans-f1-news", "pending_review"),
      reviewItem("rss-motorsport-today", "motorsport-f1-news", "pending_review"),
      reviewItem("rss-the-race-updated", "the-race-f1-news", "source_updated"),
      reviewItem("rss-motorsport-approved", "motorsport-f1-news", "approved_waiting_publish"),
      reviewItem("rss-motorsport-rejected", "motorsport-f1-news", "rejected")
    ]);
    expect(selected.map((item) => item.candidateId)).toEqual([
      "rss-motorsport-today",
      "rss-the-race-updated"
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(selectAutomaticReviewTargets([])).toEqual([]);
  });

  it("honors an explicit limit while keeping input order", () => {
    const selected = selectAutomaticReviewTargets([
      reviewItem("rss-a", "motorsport-f1-news", "pending_review"),
      reviewItem("rss-skip-autosport", "autosport-f1-news", "pending_review"),
      reviewItem("rss-b", "the-race-f1-news", "pending_review"),
      reviewItem("rss-c", "motorsport-f1-news", "source_updated")
    ], { limit: 2 });
    expect(selected.map((item) => item.candidateId)).toEqual(["rss-a", "rss-b"]);
  });

  it("returns nothing when the limit is zero", () => {
    expect(selectAutomaticReviewTargets([
      reviewItem("rss-motorsport-today", "motorsport-f1-news", "pending_review")
    ], { limit: 0 })).toEqual([]);
  });

  it("defaults to 100 allowlisted pending/source_updated items", () => {
    const items = Array.from({ length: 120 }, (_, index) => reviewItem(
      `rss-motorsport-${String(index).padStart(3, "0")}`,
      "motorsport-f1-news",
      "pending_review"
    ));
    const selected = selectAutomaticReviewTargets(items);
    expect(selected).toHaveLength(100);
    expect(selected[0]?.candidateId).toBe("rss-motorsport-000");
    expect(selected[99]?.candidateId).toBe("rss-motorsport-099");
  });
});

describe("selectRecentApprovedForPublish", () => {
  it("excludes approved items first seen before the cutoff, including historical Autosport/RaceFans", () => {
    const selected = selectRecentApprovedForPublish([
      approvedItem("rss-old-motorsport", "motorsport-f1-news", HISTORICAL),
      approvedItem("rss-old-autosport", "autosport-f1-news", HISTORICAL),
      approvedItem("rss-old-racefans", "racefans-f1-news", HISTORICAL),
      approvedItem("rss-today-autosport", "autosport-f1-news", TODAY),
      approvedItem("rss-today-motorsport", "motorsport-f1-news", TODAY),
      approvedItem("rss-today-the-race", "the-race-f1-news", TODAY, { approvedAt: TODAY }),
      approvedItem("rss-today-pending", "motorsport-f1-news", TODAY, { reviewState: "pending_review" })
    ], CUTOFF);
    expect(selected.map((item) => item.candidateId)).toEqual([
      "rss-today-motorsport",
      "rss-today-the-race"
    ]);
  });

  it("never includes an item first seen before cutoff even when approvedAt is recent", () => {
    const selected = selectRecentApprovedForPublish([
      approvedItem("rss-historical-queue", "motorsport-f1-news", HISTORICAL, { approvedAt: TODAY })
    ], CUTOFF);
    expect(selected).toEqual([]);
  });

  it("excludes a recent first-seen item whose approvedAt is before cutoff", () => {
    const selected = selectRecentApprovedForPublish([
      approvedItem("rss-old-approval", "motorsport-f1-news", TODAY, { approvedAt: HISTORICAL })
    ], CUTOFF);
    expect(selected).toEqual([]);
  });

  it("excludes approved allowlisted items that are not publishable", () => {
    const selected = selectRecentApprovedForPublish([
      approvedItem("rss-no-publish-action", "motorsport-f1-news", TODAY, { allowedActions: ["revision"] })
    ], CUTOFF);
    expect(selected).toEqual([]);
  });

  it("returns an empty list for empty input", () => {
    expect(selectRecentApprovedForPublish([], CUTOFF)).toEqual([]);
  });
});
