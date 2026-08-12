export const PUBLIC_CONTENT_TYPES = [
  "race_news",
  "driver_social",
  "legends_history",
  "paddock_fun"
] as const;

export type PublicContentType = (typeof PUBLIC_CONTENT_TYPES)[number];
export type PublicState = "available" | "restricted" | "media_missing";

export type PublicOriginalLink =
  | {
      enabled: false;
      url: null;
      reason: "synthetic_only" | "source_restricted";
    }
  | {
      enabled: true;
      url: string;
      reason: null;
    };

export type PublicFeedItemV1 = {
  publicId: string;
  contentType: PublicContentType;
  state: PublicState;
  titleZh: string;
  summaryZh: string;
  publishedAt: string;
  sourcePublishedAt: string | null;
  sourceTimeStatus: "known" | "unknown";
  source: {
    sourceId: string;
    platform: "x" | "instagram" | "reddit" | "website" | "rss";
    displayName: string;
    byline: string;
    accessStatus: "available" | "restricted";
  };
  media: null | {
    kind: "synthetic_placeholder";
    assetRef: string;
    altZh: string;
    captionZh: string | null;
    creditDisplay: string | null;
    tone: "night" | "blue" | "amber" | "violet" | "slate";
  };
  originalLink: PublicOriginalLink;
};

export type PublicFeedResponseV1 = {
  schemaVersion: "public-read-v0.1";
  items: PublicFeedItemV1[];
  page: {
    pageSize: 12;
    hasMore: boolean;
    nextCursor: null | { cursorAt: string; cursorId: string };
  };
};

export type PublicMediaV2 = {
  kind: "synthetic_placeholder";
  mediaId: string;
  assetRef: string;
  mediaHash: string;
  altZh: string;
  captionZh: string | null;
  creditDisplay: string | null;
  tone: "night" | "blue" | "amber" | "violet" | "slate";
};

export type PublicFeedItemV2 = Omit<PublicFeedItemV1, "media"> & { media: PublicMediaV2[] };

export type PublicFeedResponseV2 = {
  schemaVersion: "public-read-v0.2";
  items: PublicFeedItemV2[];
  page: PublicFeedResponseV1["page"];
};

export type PublicStoryDetailResponseV1 = {
  schemaVersion: "public-read-v0.1";
  story: PublicFeedItemV1 & {
    leadZh: string;
    bodyZh: string[];
    keyPointsZh: string[];
  };
  relatedItems: PublicFeedItemV1[];
};

export type PublicStoryDetailResponseV2 = {
  schemaVersion: "public-read-v0.2";
  story: PublicFeedItemV2 & {
    leadZh: string;
    bodyZh: string[];
    keyPointsZh: string[];
  };
  relatedItems: PublicFeedItemV2[];
};

export type PublicReadVersion = "public-read-v0.1" | "public-read-v0.2";

export type PublicReasonCodeV1 =
  | "PUBLIC_QUERY_INVALID"
  | "PUBLIC_CURSOR_PAIR_REQUIRED"
  | "PUBLIC_CURSOR_INVALID"
  | "PUBLIC_CURSOR_SCOPE_MISMATCH"
  | "PUBLIC_ID_INVALID"
  | "PUBLIC_STORY_NOT_FOUND"
  | "PUBLIC_READ_INCOMPLETE_CHAIN"
  | "PUBLIC_READ_INTEGRITY_FAILED"
  | "PUBLIC_DB_BUSY"
  | "PUBLIC_PROFILE_UNAVAILABLE"
  | "PUBLIC_MEDIA_VERSION_UNSUPPORTED";

export type PublicProblemV1 = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  reasonCode: PublicReasonCodeV1;
  traceId: string;
};

export type PublicCursorPayloadV1 = {
  v: 1;
  publicId: string;
  publishedAt: string;
  source: string | null;
  contentType: PublicContentType | null;
};

export type PublicFeedQuery = {
  source: string | null;
  contentType: PublicContentType | null;
  cursor: PublicCursorPayloadV1 | null;
};
